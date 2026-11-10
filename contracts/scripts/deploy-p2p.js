// Loot Arena 1.4 (fase C): despliega MercadoP2P, el mercado entre jugadores.
// No redespliega nada: reutiliza el GameItem ("address") y el LootGold ("oro") que ya
// estén en ../shared/deployments.json[red]. El MercadoP2P **no necesita permisos**: no
// es minter de ORO ni owner de GameItem (quema la comisión con la aprobación del
// comprador y solo mueve los NFT que un vendedor le entrega al listar).
//
// Actualiza /shared:
//   - shared/deployments.json → en la entrada de la red: "mercadoP2P" y
//     "bloqueMercadoP2P" (el bloque del despliegue, para que el servidor sepa desde
//     dónde indexar los eventos). Conserva el resto de la entrada y las otras redes.
//   - shared/MercadoP2P.abi.json
//
// Uso:
//   npx hardhat run scripts/deploy-p2p.js --network localhost
//   npx hardhat run scripts/deploy-p2p.js --network sepolia
// Variables opcionales (PowerShell: $env:COMISION_BPS="300";):
//   MERCADOP2P_EXISTENTE → reutiliza ese MercadoP2P (si un despliegue se cortó)
//   GAMEITEM_DIR         → GameItem a usar (por defecto deployments[red].address)
//   LOOTGOLD_DIR         → LootGold a usar (por defecto deployments[red].oro)
//   COMISION_BPS         → comisión en puntos básicos (500 = 5 %, tope 1000); solo
//                          envía la transacción si no es la que ya tiene el contrato
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
  const gameItemAddr = process.env.GAMEITEM_DIR || entrada.address;
  const oroAddr = process.env.LOOTGOLD_DIR || entrada.oro;
  if (!gameItemAddr || !oroAddr) {
    throw new Error(
      `Faltan GameItem ("address") o LootGold ("oro") en deployments.json["${network.name}"]. Ejecuta antes deploy.js y deploy-1.2.js.`
    );
  }
  for (const [n, a] of [["GameItem", gameItemAddr], ["LootGold", oroAddr]]) {
    if (!ethers.isAddress(a)) throw new Error(`La dirección de ${n} no es válida: ${a}`);
    if ((await ethers.provider.getCode(a)) === "0x") throw new Error(`No hay contrato ${n} en ${a} (red ${network.name}).`);
  }

  const comisionBps = BigInt(process.env.COMISION_BPS ?? 500);
  if (comisionBps > 1000n) throw new Error(`COMISION_BPS=${comisionBps} pasa del tope del contrato (1000 = 10 %).`);
  const chainId = Number((await ethers.provider.getNetwork()).chainId);

  console.log(`Red: ${network.name} (chainId ${chainId})`);
  console.log(`Desplegando con: ${deployer.address} (saldo ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH)`);
  console.log(`GameItem: ${gameItemAddr}  ·  LootGold (ORO): ${oroAddr}  ·  comisión: ${comisionBps} bps`);

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

  // 1. El contrato. No hay paso 2: no necesita ningún permiso.
  const p2p = await desplegar("MercadoP2P", [gameItemAddr, oroAddr]);
  const p2pAddr = await p2p.getAddress();

  // 2. Comisión, solo si no es la que ya tiene (idempotente).
  if ((await p2p.comisionBps()) !== comisionBps) {
    await esperar(await p2p.setComision(comisionBps, await nonce()), `MercadoP2P.setComision(${comisionBps})`);
  }

  // Comprobación de seguridad: que no se le hayan dado permisos de más por error.
  const oro = await ethers.getContractAt("LootGold", oroAddr);
  if (await oro.esMinter(p2pAddr)) {
    console.warn("  AVISO: el MercadoP2P es minter de ORO y no debería serlo. Quítalo con LootGold.setMinter(p2p, false).");
  }
  console.log(`Gas total: ${gasTotal}`);

  // --- Artefactos compartidos (relee por si otro proceso lo cambió) ---
  const actual = JSON.parse(fs.readFileSync(DEPLOYMENTS_FILE, "utf8"));
  const previa = actual[network.name] || {};
  actual[network.name] = {
    ...previa,
    mercadoP2P: p2pAddr,
    bloqueMercadoP2P: bloqueDespliegue ?? previa.bloqueMercadoP2P ?? null,
  };
  fs.writeFileSync(DEPLOYMENTS_FILE, JSON.stringify(actual, null, 2) + "\n");
  console.log(`Actualizado: ${path.relative(process.cwd(), DEPLOYMENTS_FILE)}`);
  const art = await hre.artifacts.readArtifact("MercadoP2P");
  const f = path.join(SHARED_DIR, "MercadoP2P.abi.json");
  fs.writeFileSync(f, JSON.stringify(art.abi, null, 2) + "\n");
  console.log(`Actualizado: ${path.relative(process.cwd(), f)}`);

  console.log(`\nEl jugador necesita dos aprobaciones (una vez cada una):`);
  console.log(`  GameItem.setApprovalForAll(${p2pAddr}, true)   ← para poder listar`);
  console.log(`  LootGold.approve(${p2pAddr}, cantidad)          ← para poder comprar`);

  if (network.name === "sepolia") {
    console.log("\nPara verificar en Etherscan (espera ~1 min a que se indexe):");
    console.log(`  npx hardhat verify --network sepolia ${p2pAddr} ${gameItemAddr} ${oroAddr}`);
    console.log(`\nServidor: MERCADO_P2P_ADDRESS=${p2pAddr} P2P_DEPLOY_BLOCK=${bloqueDespliegue}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
