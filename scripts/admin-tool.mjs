#!/usr/bin/env node
// CLI de administración local. Usa las claves de server/.env (nunca se suben a git).
//   node scripts/admin-tool.mjs estado
//   node scripts/admin-tool.mjs mint <0xDestino> [tipo] [rareza 0-2] [ataque] [defensa]
//   node scripts/admin-tool.mjs oro <0xDestino> <cantidad>
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(resolve(raiz, "server/package.json"));
const { ethers } = require("ethers");
require("dotenv").config({ path: resolve(raiz, "server/.env") });

const TIPOS = ["Espada", "Escudo", "Casco", "Armadura", "Botas"];
const RAREZAS = ["Común", "Raro", "Legendario"];
const ABI_ORO = [
  "function mint(address to, uint256 cantidad)", "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
];
const ABI_ITEM = JSON.parse(readFileSync(resolve(raiz, "server/abi/GameItem.abi.json"), "utf8"));
const red = process.env.RED_BLOCKCHAIN || "sepolia";
const despliegue = JSON.parse(readFileSync(resolve(raiz, "shared/deployments.json"), "utf8"))[red];

function uso(msg) {
  if (msg) console.error(`Error: ${msg}\n`);
  console.error("Uso:\n  node scripts/admin-tool.mjs estado\n  node scripts/admin-tool.mjs mint <0xDestino> [tipo] [rareza 0-2] [ataque] [defensa]\n  node scripts/admin-tool.mjs oro <0xDestino> <cantidad>");
  process.exit(1);
}

const { RPC_URL, PRIVATE_KEY, CONTRACT_ADDRESS } = process.env;
if (!RPC_URL || !PRIVATE_KEY) uso("faltan RPC_URL / PRIVATE_KEY en server/.env");
const prov = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY.startsWith("0x") ? PRIVATE_KEY : `0x${PRIVATE_KEY}`, prov);
const item = new ethers.Contract(CONTRACT_ADDRESS || despliegue.address, ABI_ITEM, wallet);
const oro = new ethers.Contract(despliegue.oro, ABI_ORO, wallet);

const [cmd, destino, ...resto] = process.argv.slice(2);
const dirOk = (d) => { if (!ethers.isAddress(d ?? "")) uso("dirección destino no válida"); return ethers.getAddress(d); };

try {
  if (cmd === "estado") {
    const [bloque, eth, supOro, objetos, owner] = await Promise.all([
      prov.getBlockNumber(), prov.getBalance(wallet.address), oro.totalSupply(), item.totalSupply(), item.owner()]);
    console.log(`Red: ${red} · bloque ${bloque}\nOwner del contrato: ${owner}\nWallet del servidor: ${wallet.address} (${ethers.formatEther(eth)} ETH)\nORO en circulación: ${ethers.formatUnits(supOro, 18)}\nObjetos acuñados: ${objetos}`);
  } else if (cmd === "mint") {
    const to = dirOk(destino);
    const tipo = resto[0] ?? "Espada", rareza = Number(resto[1] ?? 0), ataque = Number(resto[2] ?? 10), defensa = Number(resto[3] ?? 10);
    if (!TIPOS.includes(tipo)) uso(`tipo debe ser uno de: ${TIPOS.join(", ")}`);
    if (![0, 1, 2].includes(rareza)) uso("rareza debe ser 0, 1 o 2");
    for (const v of [ataque, defensa]) if (!Number.isInteger(v) || v < 0 || v > 999) uso("ataque/defensa deben ser enteros 0–999");
    const tx = await item.mintItem(to, `${tipo} Admin (${RAREZAS[rareza]})`, tipo, rareza, ataque, defensa);
    console.log(`Enviada ${tx.hash}…`);
    await tx.wait();
    console.log(`✔ ${tipo} (${RAREZAS[rareza]}, +${ataque}/+${defensa}) acuñado para ${to}`);
  } else if (cmd === "oro") {
    const to = dirOk(destino), n = Number(resto[0]);
    if (!Number.isInteger(n) || n <= 0) uso("cantidad debe ser un entero positivo");
    const tx = await oro.mint(to, ethers.parseUnits(String(n), 18));
    console.log(`Enviada ${tx.hash}…`);
    await tx.wait();
    console.log(`✔ ${n} ORO enviados a ${to}`);
  } else uso(cmd ? `comando desconocido "${cmd}"` : "falta comando");
} catch (err) {
  console.error(`Fallo: ${err.shortMessage ?? err.message}`);
  process.exit(1);
}
