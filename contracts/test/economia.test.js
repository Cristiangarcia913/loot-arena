const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const DEAD = "0x000000000000000000000000000000000000dEaD";
const ORO = (n) => ethers.parseEther(String(n)); // ORO tiene 18 decimales
const ETH = (n) => ethers.parseEther(String(n));
const RECOMPENSA = [ETH("0.0001"), ETH("0.0005"), ETH("0.002")];
const BASE_URI = "https://cristiangarcia913.github.io/loot-arena/meta/cosmeticos/";

// Catálogo de MEJORAS.md §5: [nombre, ranura, rareza, precio, enCofre]
const CATALOGO = [
  ["Armadura carmesí", "color", 0, 60, true],
  ["Armadura esmeralda", "color", 0, 60, true],
  ["Armadura obsidiana", "color", 1, 150, true],
  ["Capucha del cazador", "sombrero", 0, 80, true],
  ["Yelmo con cuernos", "sombrero", 1, 180, true],
  ["Corona del campeón", "sombrero", 2, 600, true],
  ["Capa de viajero", "capa", 0, 90, true],
  ["Capa real púrpura", "capa", 1, 220, true],
  ["Alas de fénix", "capa", 2, 800, true],
  ["Aura de escarcha", "aura", 1, 250, true],
  ["Aura de llamas", "aura", 2, 700, true],
  ["Gato negro", "mascota", 1, 300, true],
  ["Mini dragón", "mascota", 2, 900, true],
  ["Poción extra", "consumible", 0, 25, false],
];

// Misma fórmula que el contrato (y que precioVentaLocal de la web).
const precioEsperado = (rareza, ataque, defensa) => ORO([10, 40, 200][rareza] + 2 * (ataque + defensa));

describe("Economía (LootGold, LootCosmetics, Mercado)", function () {
  async function desplegar() {
    const [owner, jugador, otro] = await ethers.getSigners();

    const gameItem = await (await ethers.getContractFactory("GameItem")).deploy();
    const oro = await (await ethers.getContractFactory("LootGold")).deploy();
    const cosmeticos = await (await ethers.getContractFactory("LootCosmetics")).deploy(BASE_URI);
    const mercado = await (await ethers.getContractFactory("Mercado")).deploy(
      await gameItem.getAddress(),
      await oro.getAddress(),
      await cosmeticos.getAddress()
    );
    const mercadoAddr = await mercado.getAddress();
    await oro.setMinter(mercadoAddr);
    await cosmeticos.setMinter(mercadoAddr);

    // Objetos de prueba: 1 común (5/3), 2 raro (12/4), 3 legendario (30/20) para jugador; 4 para otro
    await gameItem.mintItem(jugador.address, "Espada Oxidada", "Espada", 0, 5, 3);
    await gameItem.mintItem(jugador.address, "Escudo Rúnico", "Escudo", 1, 12, 4);
    await gameItem.mintItem(jugador.address, "Corona Eterna", "Casco", 2, 30, 20);
    await gameItem.mintItem(otro.address, "Botas Ajenas", "Botas", 0, 1, 1);

    return { gameItem, oro, cosmeticos, mercado, mercadoAddr, owner, jugador, otro };
  }

  // Jugador con ORO de sobra: aprueba y vende el legendario (200 + 2·50 = 300 ORO) + bienvenida (50).
  async function conOro() {
    const f = await desplegar();
    await f.gameItem.connect(f.jugador).setApprovalForAll(f.mercadoAddr, true);
    await f.mercado.connect(f.jugador).venderItem(3);
    await f.mercado.connect(f.jugador).reclamarBienvenida();
    return f; // jugador tiene 350 ORO
  }

  describe("Despliegue y catálogo", function () {
    it("ORO es un ERC-20 'Oro de Loot Arena' con 18 decimales", async function () {
      const { oro, mercadoAddr, owner } = await loadFixture(desplegar);
      expect(await oro.name()).to.equal("Oro de Loot Arena");
      expect(await oro.symbol()).to.equal("ORO");
      expect(await oro.decimals()).to.equal(18n);
      expect(await oro.minter()).to.equal(mercadoAddr);
      expect(await oro.owner()).to.equal(owner.address);
    });

    it("cosméticos: minter = mercado y uri apunta al JSON estático", async function () {
      const { cosmeticos, mercadoAddr } = await loadFixture(desplegar);
      expect(await cosmeticos.minter()).to.equal(mercadoAddr);
      expect(await cosmeticos.uri(7)).to.equal(BASE_URI + "7.json");
    });

    it("catalogo() devuelve los 14 cosméticos de §5 con ranura, rareza y precio", async function () {
      const { mercado } = await loadFixture(desplegar);
      const cat = await mercado.catalogo();
      expect(cat.length).to.equal(14);
      expect(await mercado.totalCosmeticos()).to.equal(14n);
      CATALOGO.forEach(([nombre, ranura, rareza, precio, enCofre], i) => {
        expect(cat[i].nombre).to.equal(nombre);
        expect(cat[i].ranura).to.equal(ranura);
        expect(cat[i].rareza).to.equal(BigInt(rareza));
        expect(cat[i].precio).to.equal(ORO(precio));
        expect(cat[i].enCofre).to.equal(enCofre);
      });
      expect(await mercado.PRECIO_COFRE()).to.equal(ORO(120));
      expect(await mercado.BIENVENIDA()).to.equal(ORO(50));
      await expect(mercado.cosmetico(0)).to.be.revertedWithCustomError(mercado, "CosmeticoInexistente");
      await expect(mercado.cosmetico(15)).to.be.revertedWithCustomError(mercado, "CosmeticoInexistente");
    });
  });

  describe("Vender", function () {
    it("precioVenta = base[rareza] + 2·(ataque + defensa)", async function () {
      const { mercado } = await loadFixture(desplegar);
      expect(await mercado.precioVenta(1)).to.equal(precioEsperado(0, 5, 3)); // 26
      expect(await mercado.precioVenta(2)).to.equal(precioEsperado(1, 12, 4)); // 72
      expect(await mercado.precioVenta(3)).to.equal(precioEsperado(2, 30, 20)); // 300
      await expect(mercado.precioVenta(99)).to.be.reverted; // no existe
    });

    it("venta correcta: el NFT va a 0x…dEaD, el jugador recibe ORO y se emite ItemVendido", async function () {
      const { gameItem, oro, mercado, mercadoAddr, jugador } = await loadFixture(desplegar);
      await gameItem.connect(jugador).setApprovalForAll(mercadoAddr, true);
      await expect(mercado.connect(jugador).venderItem(2))
        .to.emit(mercado, "ItemVendido")
        .withArgs(jugador.address, 2n, ORO(72), 0n);
      expect(await gameItem.ownerOf(2)).to.equal(DEAD);
      expect(await oro.balanceOf(jugador.address)).to.equal(ORO(72));
      expect(await oro.totalSupply()).to.equal(ORO(72));
    });

    it("venderVarios suma los precios y entrega todos los NFT", async function () {
      const { gameItem, oro, mercado, mercadoAddr, jugador } = await loadFixture(desplegar);
      await gameItem.connect(jugador).setApprovalForAll(mercadoAddr, true);
      const tx = mercado.connect(jugador).venderVarios([1, 2, 3]);
      await expect(tx).to.emit(mercado, "ItemVendido").withArgs(jugador.address, 1n, ORO(26), 0n);
      await expect(tx).to.emit(mercado, "ItemVendido").withArgs(jugador.address, 3n, ORO(300), 0n);
      expect(await oro.balanceOf(jugador.address)).to.equal(ORO(26 + 72 + 300));
      for (const id of [1, 2, 3]) expect(await gameItem.ownerOf(id)).to.equal(DEAD);
      await expect(mercado.connect(jugador).venderVarios([])).to.be.revertedWithCustomError(mercado, "ListaVacia");
    });

    it("no puedes vender lo que no es tuyo (aunque el dueño haya aprobado al mercado)", async function () {
      const { gameItem, mercado, mercadoAddr, jugador, otro } = await loadFixture(desplegar);
      await gameItem.connect(otro).setApprovalForAll(mercadoAddr, true);
      await expect(mercado.connect(jugador).venderItem(4))
        .to.be.revertedWithCustomError(mercado, "NoEresDueno")
        .withArgs(4n, otro.address);
      // venderVarios con uno ajeno revierte entero
      await gameItem.connect(jugador).setApprovalForAll(mercadoAddr, true);
      await expect(mercado.connect(jugador).venderVarios([1, 4])).to.be.revertedWithCustomError(mercado, "NoEresDueno");
      expect(await gameItem.ownerOf(1)).to.equal(jugador.address);
    });

    it("sin setApprovalForAll la venta revierte", async function () {
      const { gameItem, mercado, jugador } = await loadFixture(desplegar);
      await expect(mercado.connect(jugador).venderItem(1)).to.be.revertedWithCustomError(
        gameItem,
        "ERC721InsufficientApproval"
      );
    });

    it("un objeto vendido no se puede volver a vender", async function () {
      const { gameItem, mercado, mercadoAddr, jugador } = await loadFixture(desplegar);
      await gameItem.connect(jugador).setApprovalForAll(mercadoAddr, true);
      await mercado.connect(jugador).venderItem(1);
      await expect(mercado.connect(jugador).venderItem(1)).to.be.revertedWithCustomError(mercado, "NoEresDueno");
    });
  });

  describe("ORO", function () {
    it("solo el mercado puede acuñar o quemar sin permiso", async function () {
      const { oro, owner, jugador } = await loadFixture(desplegar);
      await expect(oro.connect(owner).mint(owner.address, ORO(1)))
        .to.be.revertedWithCustomError(oro, "SoloMinter")
        .withArgs(owner.address);
      await expect(oro.connect(jugador).mint(jugador.address, ORO(1))).to.be.revertedWithCustomError(oro, "SoloMinter");
      await expect(oro.connect(jugador).quemarDe(owner.address, 0)).to.be.revertedWithCustomError(oro, "SoloMinter");
    });

    it("solo el owner puede cambiar el minter", async function () {
      const { oro, cosmeticos, jugador } = await loadFixture(desplegar);
      await expect(oro.connect(jugador).setMinter(jugador.address)).to.be.revertedWithCustomError(
        oro,
        "OwnableUnauthorizedAccount"
      );
      await expect(cosmeticos.connect(jugador).setMinter(jugador.address)).to.be.revertedWithCustomError(
        cosmeticos,
        "OwnableUnauthorizedAccount"
      );
    });

    it("el jugador puede quemar su ORO (burn / burnFrom)", async function () {
      const { oro, jugador, otro } = await loadFixture(conOro);
      await oro.connect(jugador).burn(ORO(10));
      await oro.connect(jugador).approve(otro.address, ORO(5));
      await oro.connect(otro).burnFrom(jugador.address, ORO(5));
      expect(await oro.balanceOf(jugador.address)).to.equal(ORO(335));
    });
  });

  describe("Comprar cosméticos", function () {
    it("la compra quema el ORO, acuña el cosmético y emite CosmeticoComprado", async function () {
      const { oro, cosmeticos, mercado, jugador } = await loadFixture(conOro);
      const supplyAntes = await oro.totalSupply();
      await expect(mercado.connect(jugador).comprarCosmetico(5, 1))
        .to.emit(mercado, "CosmeticoComprado")
        .withArgs(jugador.address, 5n, 1n, ORO(180));
      expect(await oro.balanceOf(jugador.address)).to.equal(ORO(350 - 180));
      expect(await oro.totalSupply()).to.equal(supplyAntes - ORO(180));
      expect(await cosmeticos.balanceOf(jugador.address, 5)).to.equal(1n);
    });

    it("se pueden comprar varias unidades (pociones) y quemarlas al gastarlas", async function () {
      const { oro, cosmeticos, mercado, jugador } = await loadFixture(conOro);
      await mercado.connect(jugador).comprarCosmetico(14, 3);
      expect(await cosmeticos.balanceOf(jugador.address, 14)).to.equal(3n);
      expect(await oro.balanceOf(jugador.address)).to.equal(ORO(350 - 75));
      await cosmeticos.connect(jugador).burn(jugador.address, 14, 1);
      expect(await cosmeticos.balanceOf(jugador.address, 14)).to.equal(2n);
    });

    it("saldo insuficiente revierte", async function () {
      const { mercado, jugador } = await loadFixture(conOro);
      await expect(mercado.connect(jugador).comprarCosmetico(13, 1)) // 900 > 350
        .to.be.revertedWithCustomError(mercado, "SaldoInsuficiente")
        .withArgs(ORO(350), ORO(900));
    });

    it("id inexistente, cantidad 0 o cosmético retirado revierten", async function () {
      const { mercado, owner, jugador } = await loadFixture(conOro);
      await expect(mercado.connect(jugador).comprarCosmetico(15, 1)).to.be.revertedWithCustomError(
        mercado,
        "CosmeticoInexistente"
      );
      await expect(mercado.connect(jugador).comprarCosmetico(1, 0)).to.be.revertedWithCustomError(mercado, "CantidadCero");
      await mercado.connect(owner).setPrecioCosmetico(1, 0);
      await expect(mercado.connect(jugador).comprarCosmetico(1, 1)).to.be.revertedWithCustomError(mercado, "NoALaVenta");
    });

    it("solo el mercado puede acuñar cosméticos", async function () {
      const { cosmeticos, owner } = await loadFixture(desplegar);
      await expect(cosmeticos.mint(owner.address, 1, 1)).to.be.revertedWithCustomError(cosmeticos, "SoloMinter");
    });
  });

  describe("Cofre cosmético", function () {
    it("quema 120 ORO, acuña un id válido (nunca consumible) y emite CofreAbierto", async function () {
      const { oro, cosmeticos, mercado, jugador } = await loadFixture(conOro);
      const id = await mercado.connect(jugador).abrirCofre.staticCall();
      const tx = await mercado.connect(jugador).abrirCofre();
      const rc = await tx.wait();
      const ev = rc.logs.map((l) => mercado.interface.parseLog(l)).find((e) => e && e.name === "CofreAbierto");
      const idReal = ev.args.id;
      expect(ev.args.jugador).to.equal(jugador.address);
      expect(idReal >= 1n && idReal <= 13n).to.equal(true);
      expect(id >= 1n && id <= 13n).to.equal(true);
      expect(await cosmeticos.balanceOf(jugador.address, idReal)).to.equal(1n);
      expect(await oro.balanceOf(jugador.address)).to.equal(ORO(350 - 120));
    });

    it("muchas aperturas: siempre ids 1..13 y salen comunes y raras", async function () {
      const { gameItem, mercado, mercadoAddr, owner, otro } = await loadFixture(desplegar);
      // Damos mucho ORO a `otro` con un objeto muy valioso
      await gameItem.mintItem(otro.address, "Tesoro", "Armadura", 2, 65535, 65535);
      await gameItem.connect(otro).setApprovalForAll(mercadoAddr, true);
      await mercado.connect(otro).venderItem(5); // 200 + 2·131070 ORO
      const cat = await mercado.catalogo();
      const rarezas = new Set();
      for (let i = 0; i < 60; i++) {
        const rc = await (await mercado.connect(otro).abrirCofre()).wait();
        const ev = rc.logs.map((l) => mercado.interface.parseLog(l)).find((e) => e && e.name === "CofreAbierto");
        const id = Number(ev.args.id);
        expect(id).to.be.within(1, 13);
        rarezas.add(Number(cat[id - 1].rareza));
      }
      expect(rarezas.has(0)).to.equal(true);
      expect(rarezas.has(1)).to.equal(true);

    });

    it("sin ORO suficiente el cofre revierte", async function () {
      const { mercado, jugador } = await loadFixture(desplegar);
      await mercado.connect(jugador).reclamarBienvenida(); // 50 < 120
      await expect(mercado.connect(jugador).abrirCofre())
        .to.be.revertedWithCustomError(mercado, "SaldoInsuficiente")
        .withArgs(ORO(50), ORO(120));
    });
  });

  describe("Bienvenida", function () {
    it("da 50 ORO una sola vez por dirección", async function () {
      const { oro, mercado, jugador, otro } = await loadFixture(desplegar);
      expect(await mercado.bienvenidaReclamada(jugador.address)).to.equal(false);
      await expect(mercado.connect(jugador).reclamarBienvenida())
        .to.emit(mercado, "BienvenidaReclamada")
        .withArgs(jugador.address, ORO(50));
      expect(await oro.balanceOf(jugador.address)).to.equal(ORO(50));
      expect(await mercado.bienvenidaReclamada(jugador.address)).to.equal(true);
      await expect(mercado.connect(jugador).reclamarBienvenida()).to.be.revertedWithCustomError(mercado, "YaReclamada");
      await mercado.connect(otro).reclamarBienvenida(); // otra dirección sí puede
      expect(await oro.balanceOf(otro.address)).to.equal(ORO(50));
    });
  });

  describe("Administración", function () {
    it("el owner cambia precios, fórmula, cofre y añade cosméticos", async function () {
      const { mercado, owner } = await loadFixture(desplegar);
      await expect(mercado.connect(owner).setPrecioCosmetico(1, ORO(70)))
        .to.emit(mercado, "PrecioCosmeticoCambiado")
        .withArgs(1n, ORO(70));
      expect((await mercado.cosmetico(1)).precio).to.equal(ORO(70));

      await mercado.connect(owner).setFormulaVenta([ORO(1), ORO(2), ORO(3)], ORO(1));
      expect(await mercado.precioVenta(1)).to.equal(ORO(1 + 8)); // común 5/3

      await mercado.connect(owner).setPrecioCofre(ORO(99));
      expect(await mercado.PRECIO_COFRE()).to.equal(ORO(99));

      await expect(mercado.connect(owner).agregarCosmetico("Sombrero de bruja", "sombrero", 1, ORO(200), true))
        .to.emit(mercado, "CosmeticoAnadido")
        .withArgs(15n, "Sombrero de bruja", "sombrero", 1, ORO(200), true);
      expect(await mercado.totalCosmeticos()).to.equal(15n);
      await expect(mercado.connect(owner).agregarCosmetico("X", "aura", 3, 1, true)).to.be.revertedWithCustomError(
        mercado,
        "RarezaInvalida"
      );

      await mercado.connect(owner).setEnCofre(14, true);
      expect((await mercado.cosmetico(14)).enCofre).to.equal(true);
    });

    it("un no-owner no puede cambiar nada", async function () {
      const { mercado, jugador } = await loadFixture(desplegar);
      const m = mercado.connect(jugador);
      const err = "OwnableUnauthorizedAccount";
      await expect(m.setPrecioCosmetico(1, 1)).to.be.revertedWithCustomError(mercado, err);
      await expect(m.setFormulaVenta([1, 1, 1], 1)).to.be.revertedWithCustomError(mercado, err);
      await expect(m.setPrecioCofre(1)).to.be.revertedWithCustomError(mercado, err);
      await expect(m.setEnCofre(1, false)).to.be.revertedWithCustomError(mercado, err);
      await expect(m.agregarCosmetico("X", "aura", 0, 1, true)).to.be.revertedWithCustomError(mercado, err);
    });
  });

  describe("Reentrada", function () {
    async function conAtacante() {
      const f = await desplegar();
      const atacante = await (await ethers.getContractFactory("AtacanteReentrada")).deploy(f.mercadoAddr);
      await atacante.reclamar(); // 50 ORO
      return { ...f, atacante };
    }

    it("reentrar en comprarCosmetico desde onERC1155Received revierte", async function () {
      const { mercado, atacante, cosmeticos } = await loadFixture(conAtacante);
      await atacante.setModo(1);
      await expect(atacante.comprar(14, 1)).to.be.revertedWithCustomError(mercado, "ReentrancyGuardReentrantCall");
      expect(await cosmeticos.balanceOf(await atacante.getAddress(), 14)).to.equal(0n);
    });

    it("reentrar en abrirCofre desde onERC1155Received revierte", async function () {
      const { mercado, atacante } = await loadFixture(conAtacante);
      await atacante.setModo(2);
      await expect(atacante.comprar(14, 1)).to.be.revertedWithCustomError(mercado, "ReentrancyGuardReentrantCall");
    });

    async function conAtacanteVendedor() {
      const f = await conAtacante();
      const a = await f.atacante.getAddress();
      await f.gameItem.mintItem(a, "Cebo 1", "Espada", 2, 1, 1); // id 5
      await f.gameItem.mintItem(a, "Cebo 2", "Espada", 2, 1, 1); // id 6
      await f.atacante.aprobar(await f.gameItem.getAddress());
      await f.atacante.setTokenReentrada(6);
      await f.owner.sendTransaction({ to: f.mercadoAddr, value: ETH(1) });
      return { ...f, a };
    }

    it("reentrar en venderItem desde receive() al cobrar el ETH revierte", async function () {
      const { mercado, atacante, gameItem, a } = await loadFixture(conAtacanteVendedor);
      await atacante.setModo(3);
      await expect(atacante.vender(5)).to.be.revertedWithCustomError(mercado, "ReentrancyGuardReentrantCall");
      expect(await gameItem.ownerOf(5)).to.equal(a);
      expect(await mercado.cajaEth()).to.equal(ETH(1));
    });

    it("si el receptor captura el error, la reentrada queda bloqueada y solo cobra una vez", async function () {
      const { mercado, atacante, gameItem, oro, a } = await loadFixture(conAtacanteVendedor);
      await atacante.setModo(4);
      await expect(atacante.vender(5)).to.changeEtherBalance(a, RECOMPENSA[2]);
      expect(await atacante.reentradaBloqueada()).to.equal(true);
      expect(await atacante.vecesCobrado()).to.equal(1n);
      expect(await gameItem.ownerOf(5)).to.equal(DEAD);
      expect(await gameItem.ownerOf(6)).to.equal(a);
      expect(await oro.balanceOf(a)).to.equal(ORO(50 + 204));
      void mercado;
    });

    it("sin reentrada el mismo contrato compra con normalidad", async function () {
      const { cosmeticos, atacante } = await loadFixture(conAtacante);
      await atacante.comprar(14, 2);
      expect(await cosmeticos.balanceOf(await atacante.getAddress(), 14)).to.equal(2n);
    });
  });

  describe("Pago en ETH de la caja", function () {
    // Caja con 1 ETH
    async function conCaja() {
      const f = await desplegar();
      await f.owner.sendTransaction({ to: f.mercadoAddr, value: ETH(1) });
      await f.gameItem.connect(f.jugador).setApprovalForAll(f.mercadoAddr, true);
      return f;
    }

    it("valores por defecto: recompensa [0.0001, 0.0005, 0.002] ETH y 0.005 ETH/día", async function () {
      const { mercado } = await loadFixture(desplegar);
      for (let r = 0; r < 3; r++) expect(await mercado.recompensaEth(r)).to.equal(RECOMPENSA[r]);
      expect(await mercado.maxEthDiario()).to.equal(ETH("0.005"));
      expect(await mercado.cajaEth()).to.equal(0n);
    });

    it("al vender paga ORO y el ETH de su rareza (ItemVendido lleva el ETH)", async function () {
      const { oro, mercado, mercadoAddr, jugador } = await loadFixture(conCaja);
      expect(await mercado.ethPorVenta(jugador.address, 2)).to.equal(RECOMPENSA[2]);
      const tx = mercado.connect(jugador).venderItem(3);
      await expect(tx).to.emit(mercado, "ItemVendido").withArgs(jugador.address, 3n, ORO(300), RECOMPENSA[2]);
      await expect(tx).to.changeEtherBalances([jugador, mercadoAddr], [RECOMPENSA[2], -RECOMPENSA[2]]);
      expect(await oro.balanceOf(jugador.address)).to.equal(ORO(300));
      expect(await mercado.ethRestanteHoy(jugador.address)).to.equal(ETH("0.003"));
    });

    it("venderVarios paga la suma de ETH de todas las rarezas", async function () {
      const { mercado, jugador } = await loadFixture(conCaja);
      const total = RECOMPENSA[0] + RECOMPENSA[1] + RECOMPENSA[2];
      const tx = mercado.connect(jugador).venderVarios([1, 2, 3]);
      await expect(tx).to.emit(mercado, "ItemVendido").withArgs(jugador.address, 1n, ORO(26), RECOMPENSA[0]);
      await expect(tx).to.emit(mercado, "ItemVendido").withArgs(jugador.address, 2n, ORO(72), RECOMPENSA[1]);
      await expect(tx).to.changeEtherBalance(jugador, total);
    });

    it("caja vacía o insuficiente: la venta no revierte y solo paga ORO", async function () {
      const { gameItem, oro, mercado, mercadoAddr, owner, jugador } = await loadFixture(desplegar);
      await gameItem.connect(jugador).setApprovalForAll(mercadoAddr, true);
      const tx = mercado.connect(jugador).venderItem(1);
      await expect(tx).to.emit(mercado, "ItemVendido").withArgs(jugador.address, 1n, ORO(26), 0n);
      await expect(tx).to.changeEtherBalance(jugador, 0n);
      // 0.001 ETH en caja: alcanza para el raro (0.0005) pero no para el legendario (0.002)
      await owner.sendTransaction({ to: mercadoAddr, value: ETH("0.001") });
      await expect(mercado.connect(jugador).venderItem(3))
        .to.emit(mercado, "ItemVendido")
        .withArgs(jugador.address, 3n, ORO(300), 0n);
      await expect(mercado.connect(jugador).venderItem(2))
        .to.emit(mercado, "ItemVendido")
        .withArgs(jugador.address, 2n, ORO(72), RECOMPENSA[1]);
      expect(await oro.balanceOf(jugador.address)).to.equal(ORO(26 + 300 + 72));
      expect(await mercado.cajaEth()).to.equal(ETH("0.0005"));
    });

    it("límite diario por dirección: recorta, luego 0, y se renueva al día siguiente", async function () {
      const { gameItem, mercado, jugador, otro, mercadoAddr } = await loadFixture(conCaja);
      for (let i = 0; i < 4; i++) await gameItem.mintItem(jugador.address, "Leg", "Espada", 2, 0, 0); // ids 5..8
      // 3 legendarios: 0.002 + 0.002 + 0.001 (recortado) = 0.005
      const tx = mercado.connect(jugador).venderVarios([5, 6, 7]);
      await expect(tx).to.emit(mercado, "ItemVendido").withArgs(jugador.address, 7n, ORO(200), ETH("0.001"));
      await expect(tx).to.changeEtherBalance(jugador, ETH("0.005"));
      expect(await mercado.ethRestanteHoy(jugador.address)).to.equal(0n);
      await expect(mercado.connect(jugador).venderItem(1))
        .to.emit(mercado, "ItemVendido")
        .withArgs(jugador.address, 1n, ORO(26), 0n);
      // otra dirección tiene su propio límite
      await gameItem.connect(otro).setApprovalForAll(mercadoAddr, true);
      await expect(mercado.connect(otro).venderItem(4)).to.changeEtherBalance(otro, RECOMPENSA[0]);
      // al día siguiente vuelve a cobrar
      await time.increase(24 * 60 * 60);
      expect(await mercado.ethRestanteHoy(jugador.address)).to.equal(ETH("0.005"));
      await expect(mercado.connect(jugador).venderItem(8)).to.changeEtherBalance(jugador, RECOMPENSA[2]);
    });

    it("cualquiera recarga la caja; el owner retira; el exceso revierte", async function () {
      const { mercado, mercadoAddr, owner, otro } = await loadFixture(desplegar);
      await expect(otro.sendTransaction({ to: mercadoAddr, value: ETH("0.3") }))
        .to.emit(mercado, "CajaRecargada")
        .withArgs(otro.address, ETH("0.3"));
      expect(await mercado.cajaEth()).to.equal(ETH("0.3"));
      const tx = mercado.connect(owner).retirarEth(ETH("0.1"));
      await expect(tx).to.emit(mercado, "EthRetirado").withArgs(owner.address, ETH("0.1"));
      await expect(tx).to.changeEtherBalances([owner, mercadoAddr], [ETH("0.1"), -ETH("0.1")]);
      await expect(mercado.connect(owner).retirarEth(ETH("1")))
        .to.be.revertedWithCustomError(mercado, "SaldoEthInsuficiente")
        .withArgs(ETH("0.2"), ETH("1"));
    });

    it("un no-owner no puede retirar ni cambiar recompensas o límite", async function () {
      const { mercado, owner, otro } = await loadFixture(conCaja);
      const err = "OwnableUnauthorizedAccount";
      await expect(mercado.connect(otro).retirarEth(1)).to.be.revertedWithCustomError(mercado, err);
      await expect(mercado.connect(otro).setRecompensaEth([1, 1, 1])).to.be.revertedWithCustomError(mercado, err);
      await expect(mercado.connect(otro).setMaxEthDiario(1)).to.be.revertedWithCustomError(mercado, err);
      await mercado.connect(owner).setRecompensaEth([1, 2, 3]);
      expect(await mercado.recompensaEth(2)).to.equal(3n);
      await mercado.connect(owner).setMaxEthDiario(ETH("0.01"));
      expect(await mercado.maxEthDiario()).to.equal(ETH("0.01"));
    });
  });

  describe("Extremo a extremo", function () {
    it("mint GameItem → aprobar → vender → comprar cosmético → abrir cofre", async function () {
      const { gameItem, oro, cosmeticos, mercado, mercadoAddr, owner, jugador } = await loadFixture(desplegar);

      // 1. El servidor (owner) mintea un objeto legendario al jugador
      const rc = await (await gameItem.connect(owner).mintItem(jugador.address, "Hacha", "Espada", 2, 40, 10)).wait();
      const tokenId = rc.logs.map((l) => gameItem.interface.parseLog(l)).find((e) => e && e.name === "ItemMinted")
        .args.tokenId;
      const precio = await mercado.precioVenta(tokenId);
      expect(precio).to.equal(ORO(300));

      // 2. El owner recarga la caja, el jugador aprueba al mercado y 3. vende (ORO + ETH)
      await owner.sendTransaction({ to: mercadoAddr, value: ETH("0.1") });
      await gameItem.connect(jugador).setApprovalForAll(mercadoAddr, true);
      await expect(mercado.connect(jugador).venderItem(tokenId)).to.changeEtherBalance(jugador, RECOMPENSA[2]);
      expect(await gameItem.ownerOf(tokenId)).to.equal(DEAD);
      expect(await oro.balanceOf(jugador.address)).to.equal(ORO(300));

      // 4. Compra la capucha (80) y 5. abre un cofre (120)
      await mercado.connect(jugador).comprarCosmetico(4, 1);
      expect(await cosmeticos.balanceOf(jugador.address, 4)).to.equal(1n);
      await expect(mercado.connect(jugador).abrirCofre()).to.emit(mercado, "CofreAbierto");
      expect(await oro.balanceOf(jugador.address)).to.equal(ORO(300 - 80 - 120));

      // El jugador tiene 2 cosméticos en total (la capucha y el del cofre)
      const ids = Array.from({ length: 14 }, (_, i) => i + 1);
      const saldos = await cosmeticos.balanceOfBatch(ids.map(() => jugador.address), ids);
      expect(saldos.reduce((a, b) => a + b, 0n)).to.equal(2n);
    });
  });
});
