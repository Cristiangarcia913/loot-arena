// Mintea un objeto de prueba usando la dirección de shared/deployments.json.
//
// Uso:
//   npx hardhat run scripts/mint-demo.js --network localhost
// Variables opcionales (en PowerShell: $env:TO="0x..."):
//   TO      → destinatario (por defecto, la propia cuenta del owner)
//   NOMBRE, TIPO, RAREZA, ATAQUE, DEFENSA → datos del objeto
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const { ethers, network } = hre;
  const deployments = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "..", "shared", "deployments.json"), "utf8")
  );
  const entry = deployments[network.name];
  if (!entry) throw new Error(`No hay despliegue para la red "${network.name}". Ejecuta deploy.js antes.`);

  const [owner] = await ethers.getSigners();
  const gameItem = await ethers.getContractAt("GameItem", entry.address, owner);

  const to = process.env.TO || owner.address;
  const nombre = process.env.NOMBRE || "Espada de Prueba";
  const tipo = process.env.TIPO || "Espada";
  const rareza = Number(process.env.RAREZA ?? 1);
  const ataque = Number(process.env.ATAQUE ?? 8);
  const defensa = Number(process.env.DEFENSA ?? 2);

  const tx = await gameItem.mintItem(to, nombre, tipo, rareza, ataque, defensa);
  const receipt = await tx.wait();
  const evento = receipt.logs
    .map((log) => {
      try {
        return gameItem.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((e) => e && e.name === "ItemMinted");

  const tokenId = evento.args.tokenId;
  console.log(`Minteado tokenId ${tokenId} a ${to} (tx ${tx.hash})`);
  console.log(await gameItem.getItem(tokenId));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
