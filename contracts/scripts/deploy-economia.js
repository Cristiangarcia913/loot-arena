// Despliega la economía de Loot Arena (LootGold, LootCosmetics, Mercado) sobre el
// GameItem ya desplegado en la red elegida, enlaza permisos y actualiza /shared:
//   - shared/deployments.json → añade "oro", "cosmeticos", "mercado" a la entrada
//     de la red (conserva "address" de GameItem y el resto de redes).
//   - shared/LootGold.abi.json, LootCosmetics.abi.json, Mercado.abi.json
//
// Uso:
//   npx hardhat run scripts/deploy-economia.js --network localhost
//   npx hardhat run scripts/deploy-economia.js --network sepolia
// Variables opcionales (PowerShell: $env:CAJA_ETH="0.05"):
//   COSMETICOS_URI → prefijo de metadatos (por defecto GitHub Pages)
//   CAJA_ETH       → ETH con el que recargar la caja del Mercado al desplegar
//                    (por defecto 1 en localhost/hardhat y 0 en otras redes)
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const SHARED_DIR = path.join(__dirname, "..", "..", "shared");
const DEPLOYMENTS_FILE = path.join(SHARED_DIR, "deployments.json");
const URI_POR_DEFECTO = "https://cristiangarcia913.github.io/loot-arena/meta/cosmeticos/";

async function main() {
  const { ethers, network } = hre;
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error(`No hay cuenta para la red "${network.name}". Revisa PRIVATE_KEY en contracts/.env`);
  }

  const deployments = JSON.parse(fs.readFileSync(DEPLOYMENTS_FILE, "utf8"));
  const entrada = deployments[network.name];
  if (!entrada || !entrada.address) {
    throw new Error(`No hay GameItem para la red "${network.name}" en shared/deployments.json. Ejecuta deploy.js antes.`);
  }
  const gameItemAddr = entrada.address;
  if ((await ethers.provider.getCode(gameItemAddr)) === "0x") {
    throw new Error(`No hay contrato en ${gameItemAddr} (red ${network.name}). ¿Reiniciaste el nodo? Ejecuta deploy.js.`);
  }

  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const uri = process.env.COSMETICOS_URI || URI_POR_DEFECTO;
  const local = network.name === "localhost" || network.name === "hardhat";
  const cajaEth = ethers.parseEther(process.env.CAJA_ETH || (local ? "1" : "0"));

  console.log(`Red: ${network.name} (chainId ${chainId})`);
  console.log(`Desplegando con: ${deployer.address} (saldo ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH)`);
  console.log(`GameItem: ${gameItemAddr}`);

  let gasTotal = 0n;
  async function esperar(tx, que) {
    const rc = await tx.wait();
    gasTotal += rc.gasUsed;
    console.log(`  ${que}: gas ${rc.gasUsed} (tx ${rc.hash})`);
    return rc;
  }
  // Nonce explícito leído de la cadena tras cada confirmación: los RPC públicos
  // balanceados a veces devuelven un nonce "pending" desactualizado.
  const nonce = async () => { const [a, b] = await Promise.all([ethers.provider.getTransactionCount(deployer.address, "latest"), ethers.provider.getTransactionCount(deployer.address, "pending")]); return { nonce: Math.max(a, b) }; };
  async function desplegar(nombre, args) {
    const existente = process.env[`${nombre.toUpperCase()}_EXISTENTE`];
    if (existente) {
      console.log(`  ${nombre} → ${existente} (reutilizado)`);
      return ethers.getContractAt(nombre, existente);
    }
    const c = await (await ethers.getContractFactory(nombre)).deploy(...args, await nonce());
    await esperar(c.deploymentTransaction(), `deploy ${nombre}`);
    const addr = await c.getAddress();
    console.log(`  ${nombre} → ${addr}`);
    return c;
  }

  const oro = await desplegar("LootGold", []);
  const cosmeticos = await desplegar("LootCosmetics", [uri]);
  const mercado = await desplegar("Mercado", [gameItemAddr, await oro.getAddress(), await cosmeticos.getAddress()]);
  const mercadoAddr = await mercado.getAddress();

  await esperar(await oro.setMinter(mercadoAddr, true, await nonce()), "LootGold.setMinter(mercado)");
  await esperar(await cosmeticos.setMinter(mercadoAddr, await nonce()), "LootCosmetics.setMinter(mercado)");
  if (cajaEth > 0n) {
    await esperar(await deployer.sendTransaction({ to: mercadoAddr, value: cajaEth, ...(await nonce()) }), `recargar caja con ${ethers.formatEther(cajaEth)} ETH`);
  }
  console.log(`Gas total: ${gasTotal}`);

  // --- Artefactos compartidos (relee por si otro proceso lo cambió) ---
  const actual = JSON.parse(fs.readFileSync(DEPLOYMENTS_FILE, "utf8"));
  actual[network.name] = {
    ...actual[network.name],
    oro: await oro.getAddress(),
    cosmeticos: await cosmeticos.getAddress(),
    mercado: mercadoAddr,
  };
  fs.writeFileSync(DEPLOYMENTS_FILE, JSON.stringify(actual, null, 2) + "\n");
  console.log(`Actualizado: ${path.relative(process.cwd(), DEPLOYMENTS_FILE)}`);

  for (const nombre of ["LootGold", "LootCosmetics", "Mercado"]) {
    const art = await hre.artifacts.readArtifact(nombre);
    const f = path.join(SHARED_DIR, `${nombre}.abi.json`);
    fs.writeFileSync(f, JSON.stringify(art.abi, null, 2) + "\n");
    console.log(`Actualizado: ${path.relative(process.cwd(), f)}`);
  }

  if (network.name === "sepolia") {
    console.log("\nPara verificar en Etherscan (espera ~1 min a que se indexe):");
    console.log(`  npx hardhat verify --network sepolia ${await oro.getAddress()}`);
    console.log(`  npx hardhat verify --network sepolia ${await cosmeticos.getAddress()} "${uri}"`);
    console.log(`  npx hardhat verify --network sepolia ${mercadoAddr} ${gameItemAddr} ${await oro.getAddress()} ${await cosmeticos.getAddress()}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
