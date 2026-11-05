// Despliega GameItem y actualiza los artefactos compartidos en /shared:
//   - shared/deployments.json  → { "<red>": { "address": "0x...", "chainId": N } }
//   - shared/GameItem.abi.json → array ABI puro
//
// Uso:
//   npx hardhat run scripts/deploy.js --network localhost
//   npx hardhat run scripts/deploy.js --network sepolia
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const SHARED_DIR = path.join(__dirname, "..", "..", "shared");
const DEPLOYMENTS_FILE = path.join(SHARED_DIR, "deployments.json");
const ABI_FILE = path.join(SHARED_DIR, "GameItem.abi.json");

async function main() {
  const { ethers, network } = hre;
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error(
      `No hay cuenta para la red "${network.name}". Revisa PRIVATE_KEY en contracts/.env`
    );
  }

  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const saldo = await ethers.provider.getBalance(deployer.address);
  console.log(`Red: ${network.name} (chainId ${chainId})`);
  console.log(`Desplegando con: ${deployer.address} (saldo ${ethers.formatEther(saldo)} ETH)`);

  const GameItem = await ethers.getContractFactory("GameItem");
  const gameItem = await GameItem.deploy();
  const tx = gameItem.deploymentTransaction();
  console.log(`Tx de despliegue: ${tx.hash}`);
  await gameItem.waitForDeployment();
  const address = await gameItem.getAddress();
  console.log(`GameItem desplegado en: ${address}`);

  // --- Escribir artefactos compartidos ---
  fs.mkdirSync(SHARED_DIR, { recursive: true });

  let deployments = {};
  if (fs.existsSync(DEPLOYMENTS_FILE)) {
    try {
      deployments = JSON.parse(fs.readFileSync(DEPLOYMENTS_FILE, "utf8"));
    } catch {
      console.warn("deployments.json no era JSON válido; se reescribe.");
    }
  }
  deployments[network.name] = { address, chainId };
  fs.writeFileSync(DEPLOYMENTS_FILE, JSON.stringify(deployments, null, 2) + "\n");

  const artifact = await hre.artifacts.readArtifact("GameItem");
  fs.writeFileSync(ABI_FILE, JSON.stringify(artifact.abi, null, 2) + "\n");

  console.log(`Actualizado: ${path.relative(process.cwd(), DEPLOYMENTS_FILE)}`);
  console.log(`Actualizado: ${path.relative(process.cwd(), ABI_FILE)}`);

  if (network.name === "sepolia") {
    console.log("\nPara verificar en Etherscan (espera ~1 min a que se indexe):");
    console.log(`  npx hardhat verify --network sepolia ${address}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
