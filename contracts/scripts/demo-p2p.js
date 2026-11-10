// Prueba de extremo a extremo del MercadoP2P contra un nodo **local** ya desplegado
// (deploy.js → deploy-economia.js → deploy-1.2.js → deploy-p2p.js). Deja además una
// oferta viva para que la web tenga algo que mostrar en local.
//
// Hace, con cuentas distintas y sin ningún permiso especial:
//   1. el owner mintea dos objetos al vendedor;
//   2. el comprador consigue ORO del Mercado (bono de bienvenida, 50 ORO);
//   3. el vendedor aprueba GameItem y lista uno de los objetos;
//   4. el comprador aprueba el ORO y compra: cambia el dueño y el ORO se reparte;
//   5. el vendedor deja el segundo objeto a la venta y se imprimen los datos de mercado.
//
// Uso (el nodo local arrancado y los cuatro deploy ejecutados):
//   npx hardhat run scripts/demo-p2p.js --network localhost
//
// Se niega a ejecutarse fuera de una red local: mueve objetos y ORO de verdad.
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const DEPLOYMENTS_FILE = path.join(__dirname, "..", "..", "shared", "deployments.json");

async function main() {
  const { ethers, network } = hre;
  if (network.name !== "localhost" && network.name !== "hardhat") {
    throw new Error(`demo-p2p.js es solo para el nodo local (red "${network.name}"). No se ejecuta en Sepolia.`);
  }

  const d = JSON.parse(fs.readFileSync(DEPLOYMENTS_FILE, "utf8"))[network.name] || {};
  for (const clave of ["address", "oro", "mercado", "mercadoP2P"]) {
    if (!d[clave]) throw new Error(`Falta "${clave}" en deployments.json["${network.name}"]. Ejecuta los deploy en orden.`);
  }

  const cuentas = await ethers.getSigners();
  if (cuentas.length < 3) throw new Error("Hacen falta al menos 3 cuentas (owner, vendedor, comprador).");
  const [owner, vendedor, comprador] = cuentas;

  const gameItem = await ethers.getContractAt("GameItem", d.address);
  const oro = await ethers.getContractAt("LootGold", d.oro);
  const mercado = await ethers.getContractAt("Mercado", d.mercado);
  const p2p = await ethers.getContractAt("MercadoP2P", d.mercadoP2P);
  const p2pAddr = await p2p.getAddress();

  const ORO = (n) => ethers.parseEther(String(n));
  const fmt = (n) => `${ethers.formatEther(n)} ORO`;
  const paso = (t) => console.log(`\n--- ${t}`);

  console.log(`Red ${network.name}  ·  MercadoP2P ${p2pAddr}  ·  comisión ${await p2p.comisionBps()} bps`);
  console.log(`vendedor ${vendedor.address}\ncomprador ${comprador.address}`);

  paso("1. El owner mintea dos objetos al vendedor");
  const minteado = async (nombre, tipo, rareza, ataque, defensa) => {
    const rc = await (await gameItem.mintItem(vendedor.address, nombre, tipo, rareza, ataque, defensa)).wait();
    const ev = rc.logs.map((l) => gameItem.interface.parseLog(l)).find((e) => e && e.name === "ItemMinted");
    const id = ev.args.tokenId;
    console.log(`   ${nombre} (rareza ${rareza}) → tokenId ${id}`);
    return id;
  };
  const token1 = await minteado("Espada del Tutorial", "Espada", 0, 6, 2);
  const token2 = await minteado("Yelmo Rúnico", "Casco", 1, 11, 7);

  paso("2. El comprador consigue ORO (bono de bienvenida del Mercado)");
  if (!(await mercado.bienvenidaReclamada(comprador.address))) {
    await (await mercado.connect(comprador).reclamarBienvenida()).wait();
  }
  console.log(`   saldo del comprador: ${fmt(await oro.balanceOf(comprador.address))}`);

  paso("3. El vendedor aprueba GameItem y lista el objeto por 30 ORO");
  if (!(await gameItem.isApprovedForAll(vendedor.address, p2pAddr))) {
    await (await gameItem.connect(vendedor).setApprovalForAll(p2pAddr, true)).wait();
  }
  const rcListar = await (await p2p.connect(vendedor).listar(token1, ORO(30))).wait();
  console.log(`   listar: gas ${rcListar.gasUsed}  ·  custodia: ${await gameItem.ownerOf(token1)}`);
  const [comision, neto] = await p2p.desglose(ORO(30));
  console.log(`   desglose: ${fmt(neto)} al vendedor y ${fmt(comision)} quemados`);

  paso("4. El comprador aprueba el ORO y compra");
  await (await oro.connect(comprador).approve(p2pAddr, ORO(30))).wait();
  const supplyAntes = await oro.totalSupply();
  const rcComprar = await (await p2p.connect(comprador).comprar(token1)).wait();
  console.log(`   comprar: gas ${rcComprar.gasUsed}`);
  console.log(`   dueño del objeto ${token1}: ${await gameItem.ownerOf(token1)} (comprador: ${await gameItem.ownerOf(token1) === comprador.address})`);
  console.log(`   vendedor: ${fmt(await oro.balanceOf(vendedor.address))}  ·  comprador: ${fmt(await oro.balanceOf(comprador.address))}`);
  console.log(`   ORO en el contrato: ${fmt(await oro.balanceOf(p2pAddr))} (debe ser 0)`);
  console.log(`   oferta monetaria: ${fmt(supplyAntes)} → ${fmt(await oro.totalSupply())} (quemado ${fmt(await p2p.oroQuemado())})`);

  paso("5. Queda una oferta viva para la interfaz y se leen los datos de mercado");
  await (await p2p.connect(vendedor).listar(token2, ORO(120))).wait();
  console.log(`   ofertas vivas: ${await p2p.totalListados()}`);
  for (const o of await p2p.listados(0, 20)) {
    console.log(`   · tokenId ${o.tokenId}  rareza ${o.rareza}  ${fmt(o.precio)}  de ${o.vendedor}`);
  }
  const [vol, ventas, medio, quemado] = await p2p.mercadoTotal();
  console.log(`   mercado: ${ventas} ventas, volumen ${fmt(vol)}, precio medio ${fmt(medio)}, quemado ${fmt(quemado)}`);
  for (const r of [0, 1, 2]) {
    const [v, n, m] = await p2p.mercadoRareza(r);
    console.log(`   rareza ${r}: ${n} ventas, volumen ${fmt(v)}, medio ${fmt(m)}`);
  }
  void owner;
  console.log("\nListo.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
