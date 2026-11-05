// Loot Arena 1.2: despliega LootGold v2 (varios minters), un Mercado nuevo que apunta
// a ese ORO y Recompensas; reutiliza GameItem y LootCosmetics (no se redespliegan).
// Configura permisos (idempotente: solo envía las tx que falten) y actualiza /shared:
//   - shared/deployments.json → en la entrada de la red: "oro", "mercado",
//     "recompensas" y "bloqueDespliegue" (conserva "address", "cosmeticos" y el resto).
//   - shared/LootGold.abi.json, Mercado.abi.json, Recompensas.abi.json
//
// Uso:
//   npx hardhat run scripts/deploy-1.2.js --network localhost
//   npx hardhat run scripts/deploy-1.2.js --network sepolia
// Variables opcionales (PowerShell: $env:OPERADOR="0x...";):
//   OPERADOR               → wallet del servidor que llama a Recompensas.recompensar
//                            (por defecto, la cuenta que despliega)
//   LOOTGOLD_EXISTENTE     → reutiliza ese LootGold v2 (si un despliegue se cortó)
//   MERCADO_EXISTENTE      → reutiliza ese Mercado
//   RECOMPENSAS_EXISTENTE  → reutiliza ese Recompensas
//   LOOTCOSMETICS_EXISTENTE→ LootCosmetics a usar (por defecto deployments[red].cosmeticos)
//   CAJA_ETH               → ETH para la caja del Mercado nuevo (1 en local, 0 fuera)
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const SHARED_DIR = path.join(__dirname, "..", "..", "shared");
const DEPLOYMENTS_FILE = path.join(SHARED_DIR, "deployments.json");

async function main() {
  const { ethers, network } = hre;
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error(`No hay cuenta para la red "${network.name}". Revisa PRIVATE_KEY en contracts/.env`);

  const entrada = JSON.parse(fs.readFileSync(DEPLOYMENTS_FILE, "utf8"))[network.name] || {};
  const gameItemAddr = entrada.address;
  const cosmeticosAddr = process.env.LOOTCOSMETICS_EXISTENTE || entrada.cosmeticos;
  if (!gameItemAddr || !cosmeticosAddr) {
    throw new Error(`Faltan GameItem ("address") o LootCosmetics ("cosmeticos") en deployments.json["${network.name}"]. Ejecuta antes deploy.js y deploy-economia.js.`);
  }
  for (const [n, a] of [["GameItem", gameItemAddr], ["LootCosmetics", cosmeticosAddr]]) {
    if ((await ethers.provider.getCode(a)) === "0x") throw new Error(`No hay contrato ${n} en ${a} (red ${network.name}).`);
  }

  const local = network.name === "localhost" || network.name === "hardhat";
  const operadorTexto = process.env.OPERADOR || deployer.address;
  if (!ethers.isAddress(operadorTexto)) throw new Error(`OPERADOR no es una dirección válida: ${operadorTexto}`);
  const operador = ethers.getAddress(operadorTexto);
  const cajaEth = ethers.parseEther(process.env.CAJA_ETH || (local ? "1" : "0"));
  const chainId = Number((await ethers.provider.getNetwork()).chainId);

  console.log(`Red: ${network.name} (chainId ${chainId})`);
  console.log(`Desplegando con: ${deployer.address} (saldo ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH)`);
  console.log(`GameItem: ${gameItemAddr}  ·  LootCosmetics: ${cosmeticosAddr}  ·  operador: ${operador}`);

  let gasTotal = 0n;
  let bloqueDespliegue = null;
  async function esperar(tx, que) {
    const rc = await tx.wait();
    gasTotal += rc.gasUsed;
    console.log(`  ${que}: gas ${rc.gasUsed} (bloque ${rc.blockNumber}, tx ${rc.hash})`);
    return rc;
  }
  // Nonce explícito: los RPC públicos balanceados a veces devuelven un "pending" desactualizado.
  const nonce = async () => {
    const [a, b] = await Promise.all([
      ethers.provider.getTransactionCount(deployer.address, "latest"),
      ethers.provider.getTransactionCount(deployer.address, "pending"),
    ]);
    return { nonce: Math.max(a, b) };
  };
  async function desplegar(nombre, args) {
    const existente = process.env[`${nombre.toUpperCase()}_EXISTENTE`];
    if (existente) {
      console.log(`  ${nombre} → ${existente} (reutilizado)`);
      return ethers.getContractAt(nombre, existente);
    }
    const c = await (await ethers.getContractFactory(nombre)).deploy(...args, await nonce());
    const rc = await esperar(c.deploymentTransaction(), `deploy ${nombre}`);
    if (bloqueDespliegue === null) bloqueDespliegue = rc.blockNumber;
    console.log(`  ${nombre} → ${await c.getAddress()}`);
    return c;
  }

  // 1-3. Contratos (orden obligatorio: Recompensas necesita ORO y Mercado)
  const oro = await desplegar("LootGold", []);
  const oroAddr = await oro.getAddress();
  const mercado = await desplegar("Mercado", [gameItemAddr, oroAddr, cosmeticosAddr]);
  const mercadoAddr = await mercado.getAddress();
  const recompensas = await desplegar("Recompensas", [oroAddr, mercadoAddr, operador]);
  const recAddr = await recompensas.getAddress();
  const cosmeticos = await ethers.getContractAt("LootCosmetics", cosmeticosAddr);

  // 4-8. Permisos (solo los que falten)
  if (!(await oro.esMinter(mercadoAddr))) await esperar(await oro.setMinter(mercadoAddr, true, await nonce()), "LootGold.setMinter(mercado, true)");
  if (!(await oro.esMinter(recAddr))) await esperar(await oro.setMinter(recAddr, true, await nonce()), "LootGold.setMinter(recompensas, true)");
  if ((await cosmeticos.minter()) !== mercadoAddr) {
    if ((await cosmeticos.owner()) !== deployer.address) throw new Error(`La cuenta ${deployer.address} no es owner de LootCosmetics: no puede pasar su minter al Mercado nuevo.`);
    await esperar(await cosmeticos.setMinter(mercadoAddr, await nonce()), "LootCosmetics.setMinter(mercado nuevo)");
  }
  if ((await mercado.recompensas()) !== recAddr) await esperar(await mercado.setRecompensas(recAddr, await nonce()), "Mercado.setRecompensas(recompensas)");
  if ((await recompensas.operador()) !== operador) await esperar(await recompensas.setOperador(operador, await nonce()), "Recompensas.setOperador(operador)");
  if (cajaEth > 0n) {
    await esperar(await deployer.sendTransaction({ to: mercadoAddr, value: cajaEth, ...(await nonce()) }), `recargar caja con ${ethers.formatEther(cajaEth)} ETH`);
  }
  console.log(`Gas total: ${gasTotal}`);

  // --- Artefactos compartidos (relee por si otro proceso lo cambió) ---
  const actual = JSON.parse(fs.readFileSync(DEPLOYMENTS_FILE, "utf8"));
  const previa = actual[network.name] || {};
  actual[network.name] = {
    ...previa,
    oro: oroAddr,
    cosmeticos: cosmeticosAddr,
    mercado: mercadoAddr,
    recompensas: recAddr,
    bloqueDespliegue: bloqueDespliegue ?? previa.bloqueDespliegue ?? null,
  };
  fs.writeFileSync(DEPLOYMENTS_FILE, JSON.stringify(actual, null, 2) + "\n");
  console.log(`Actualizado: ${path.relative(process.cwd(), DEPLOYMENTS_FILE)}`);
  for (const nombre of ["LootGold", "Mercado", "Recompensas"]) {
    const art = await hre.artifacts.readArtifact(nombre);
    const f = path.join(SHARED_DIR, `${nombre}.abi.json`);
    fs.writeFileSync(f, JSON.stringify(art.abi, null, 2) + "\n");
    console.log(`Actualizado: ${path.relative(process.cwd(), f)}`);
  }

  if (network.name === "sepolia") {
    console.log("\nPara verificar en Etherscan (espera ~1 min a que se indexe):");
    console.log(`  npx hardhat verify --network sepolia ${oroAddr}`);
    console.log(`  npx hardhat verify --network sepolia ${mercadoAddr} ${gameItemAddr} ${oroAddr} ${cosmeticosAddr}`);
    console.log(`  npx hardhat verify --network sepolia ${recAddr} ${oroAddr} ${mercadoAddr} ${operador}`);
    console.log(`\nServidor: MERCADO_ADDRESS=${mercadoAddr} RECOMPENSAS_ADDRESS=${recAddr} DEPLOY_BLOCK=${bloqueDespliegue}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
