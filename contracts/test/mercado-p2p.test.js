const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const ORO = (n) => ethers.parseEther(String(n)); // ORO tiene 18 decimales
const CERO = ethers.ZeroAddress;

// Rareza de los objetos de prueba: 1 común, 2 raro, 3 legendario (del vendedor),
// 4 común (de otro jugador), 5 raro (del vendedor, para las estadísticas).
describe("MercadoP2P (mercado entre jugadores)", function () {
  async function desplegar() {
    const [owner, vendedor, comprador, otro] = await ethers.getSigners();

    const gameItem = await (await ethers.getContractFactory("GameItem")).deploy();
    const oro = await (await ethers.getContractFactory("LootGold")).deploy();
    const p2p = await (await ethers.getContractFactory("MercadoP2P")).deploy(
      await gameItem.getAddress(),
      await oro.getAddress()
    );
    const p2pAddr = await p2p.getAddress();

    // Para repartir ORO en los tests sin montar todo el Mercado: el owner acuña.
    await oro.setMinter(owner.address, true);
    await oro.mint(comprador.address, ORO(10_000));
    await oro.mint(otro.address, ORO(500));

    await gameItem.mintItem(vendedor.address, "Espada Oxidada", "Espada", 0, 5, 3); // 1
    await gameItem.mintItem(vendedor.address, "Escudo Rúnico", "Escudo", 1, 12, 4); // 2
    await gameItem.mintItem(vendedor.address, "Corona Eterna", "Casco", 2, 30, 20); // 3
    await gameItem.mintItem(otro.address, "Botas Ajenas", "Botas", 0, 1, 1); // 4
    await gameItem.mintItem(vendedor.address, "Daga Rara", "Daga", 1, 9, 2); // 5

    return { gameItem, oro, p2p, p2pAddr, owner, vendedor, comprador, otro };
  }

  // Vendedor con aprobación dada y el objeto 1 a la venta por 100 ORO.
  async function conOferta() {
    const f = await desplegar();
    await f.gameItem.connect(f.vendedor).setApprovalForAll(f.p2pAddr, true);
    await f.p2p.connect(f.vendedor).listar(1, ORO(100));
    return f;
  }

  // Oferta lista para comprar: el comprador ya aprobó 100 ORO al mercado.
  async function listaParaComprar() {
    const f = await conOferta();
    await f.oro.connect(f.comprador).approve(f.p2pAddr, ORO(100));
    return f;
  }

  // ------------------------------------------------------------------ despliegue

  describe("Despliegue", function () {
    it("arranca con comisión del 5 %, tope del 10 %, sin pausa y sin ofertas", async function () {
      const { p2p, gameItem, oro, owner } = await loadFixture(desplegar);
      expect(await p2p.comisionBps()).to.equal(500n);
      expect(await p2p.COMISION_MAXIMA()).to.equal(1000n);
      expect(await p2p.PRECIO_MAXIMO()).to.equal(ORO(1e12));
      expect(await p2p.owner()).to.equal(owner.address);
      expect(await p2p.paused()).to.equal(false);
      expect(await p2p.gameItem()).to.equal(await gameItem.getAddress());
      expect(await p2p.oro()).to.equal(await oro.getAddress());
      expect(await p2p.totalListados()).to.equal(0n);
      expect(await p2p.oroQuemado()).to.equal(0n);
    });

    it("NO es minter de ORO ni owner de GameItem: no puede acuñar nada", async function () {
      const { p2p, p2pAddr, oro, gameItem, owner } = await loadFixture(desplegar);
      expect(await oro.esMinter(p2pAddr)).to.equal(false);
      expect(await gameItem.owner()).to.equal(owner.address);
      expect(await p2p.oroQuemado()).to.equal(0n);
    });

    it("desglose reparte el precio: 5 % se quema, 95 % al vendedor", async function () {
      const { p2p } = await loadFixture(desplegar);
      const [comision, neto] = await p2p.desglose(ORO(100));
      expect(comision).to.equal(ORO(5));
      expect(neto).to.equal(ORO(95));
    });
  });

  // ---------------------------------------------------------------------- listar

  describe("listar", function () {
    it("pone el objeto a la venta, lo deja en custodia y emite Listado", async function () {
      const { gameItem, p2p, p2pAddr, vendedor } = await loadFixture(desplegar);
      await gameItem.connect(vendedor).setApprovalForAll(p2pAddr, true);

      await expect(p2p.connect(vendedor).listar(2, ORO(250)))
        .to.emit(p2p, "Listado")
        .withArgs(2n, vendedor.address, 1, ORO(250));

      expect(await gameItem.ownerOf(2)).to.equal(p2pAddr); // custodia del contrato
      const o = await p2p.listado(2);
      expect(o.vendedor).to.equal(vendedor.address);
      expect(o.precio).to.equal(ORO(250));
      expect(o.rareza).to.equal(1); // copiada de GameItem
      expect(o.creado).to.be.greaterThan(0n);
      expect(await p2p.estaListado(2)).to.equal(true);
      expect(await p2p.totalListados()).to.equal(1n);
    });

    it("vale la aprobación de un solo token (approve), no solo setApprovalForAll", async function () {
      const { gameItem, p2p, p2pAddr, vendedor } = await loadFixture(desplegar);
      await gameItem.connect(vendedor).approve(p2pAddr, 3);
      await p2p.connect(vendedor).listar(3, ORO(900));
      expect(await gameItem.ownerOf(3)).to.equal(p2pAddr);
    });

    it("rechaza precio 0", async function () {
      const { gameItem, p2p, p2pAddr, vendedor } = await loadFixture(desplegar);
      await gameItem.connect(vendedor).setApprovalForAll(p2pAddr, true);
      await expect(p2p.connect(vendedor).listar(1, 0)).to.be.revertedWithCustomError(p2p, "PrecioCero");
      expect(await gameItem.ownerOf(1)).to.equal(vendedor.address);
    });

    it("rechaza un precio absurdo (por encima de PRECIO_MAXIMO)", async function () {
      const { gameItem, p2p, p2pAddr, vendedor } = await loadFixture(desplegar);
      await gameItem.connect(vendedor).setApprovalForAll(p2pAddr, true);
      const max = await p2p.PRECIO_MAXIMO();
      await expect(p2p.connect(vendedor).listar(1, max + 1n))
        .to.be.revertedWithCustomError(p2p, "PrecioExcesivo")
        .withArgs(max + 1n, max);
      await p2p.connect(vendedor).listar(1, max); // el tope justo sí vale
    });

    it("no se puede listar un objeto de otro jugador", async function () {
      const { gameItem, p2p, p2pAddr, vendedor, otro } = await loadFixture(desplegar);
      await gameItem.connect(vendedor).setApprovalForAll(p2pAddr, true);
      await gameItem.connect(otro).setApprovalForAll(p2pAddr, true);
      // El objeto 4 es de `otro`; el vendedor lo intenta aunque haya aprobación de ambos.
      await expect(p2p.connect(vendedor).listar(4, ORO(10)))
        .to.be.revertedWithCustomError(p2p, "NoEresDueno")
        .withArgs(4n, otro.address);
      expect(await gameItem.ownerOf(4)).to.equal(otro.address);
    });

    it("sin aprobación en GameItem no se puede listar", async function () {
      const { gameItem, p2p, vendedor } = await loadFixture(desplegar);
      await expect(p2p.connect(vendedor).listar(1, ORO(100))).to.be.revertedWithCustomError(
        gameItem,
        "ERC721InsufficientApproval"
      );
      expect(await p2p.totalListados()).to.equal(0n);
    });

    it("no se puede listar dos veces el mismo objeto", async function () {
      const { p2p, vendedor } = await loadFixture(conOferta);
      await expect(p2p.connect(vendedor).listar(1, ORO(50)))
        .to.be.revertedWithCustomError(p2p, "YaListado")
        .withArgs(1n);
    });

    it("no se puede listar un objeto que no existe", async function () {
      const { gameItem, p2p, vendedor } = await loadFixture(desplegar);
      await expect(p2p.connect(vendedor).listar(999, ORO(1))).to.be.revertedWithCustomError(
        gameItem,
        "ERC721NonexistentToken"
      );
    });
  });

  // -------------------------------------------------------------- cambiar precio

  describe("cambiarPrecio", function () {
    it("el vendedor cambia su precio y emite PrecioCambiado", async function () {
      const { p2p, vendedor } = await loadFixture(conOferta);
      await expect(p2p.connect(vendedor).cambiarPrecio(1, ORO(80)))
        .to.emit(p2p, "PrecioCambiado")
        .withArgs(1n, vendedor.address, ORO(100), ORO(80));
      expect((await p2p.listado(1)).precio).to.equal(ORO(80));
    });

    it("otro jugador no puede cambiar el precio de una oferta ajena", async function () {
      const { p2p, vendedor, otro } = await loadFixture(conOferta);
      await expect(p2p.connect(otro).cambiarPrecio(1, ORO(1)))
        .to.be.revertedWithCustomError(p2p, "NoEresVendedor")
        .withArgs(1n, vendedor.address);
      expect((await p2p.listado(1)).precio).to.equal(ORO(100));
    });

    it("rechaza precio 0, el mismo precio y una oferta que no existe", async function () {
      const { p2p, vendedor } = await loadFixture(conOferta);
      await expect(p2p.connect(vendedor).cambiarPrecio(1, 0)).to.be.revertedWithCustomError(p2p, "PrecioCero");
      await expect(p2p.connect(vendedor).cambiarPrecio(1, ORO(100)))
        .to.be.revertedWithCustomError(p2p, "MismoPrecio")
        .withArgs(ORO(100));
      await expect(p2p.connect(vendedor).cambiarPrecio(2, ORO(1)))
        .to.be.revertedWithCustomError(p2p, "NoListado")
        .withArgs(2n);
    });

    it("el comprador paga el precio nuevo, no el viejo", async function () {
      const { p2p, p2pAddr, oro, vendedor, comprador } = await loadFixture(conOferta);
      await p2p.connect(vendedor).cambiarPrecio(1, ORO(200));
      await oro.connect(comprador).approve(p2pAddr, ORO(200));
      await p2p.connect(comprador).comprar(1);
      expect(await oro.balanceOf(vendedor.address)).to.equal(ORO(190)); // 200 − 5 %
    });
  });

  // -------------------------------------------------------------------- cancelar

  describe("cancelar", function () {
    it("el vendedor retira la oferta y recupera el NFT", async function () {
      const { gameItem, p2p, vendedor } = await loadFixture(conOferta);
      await expect(p2p.connect(vendedor).cancelar(1)).to.emit(p2p, "Cancelado").withArgs(1n, vendedor.address);
      expect(await gameItem.ownerOf(1)).to.equal(vendedor.address);
      expect(await p2p.totalListados()).to.equal(0n);
      expect(await p2p.estaListado(1)).to.equal(false);
      expect((await p2p.listado(1)).vendedor).to.equal(CERO);
      expect(await p2p.listadosDe(vendedor.address)).to.deep.equal([]);
    });

    it("otro jugador no puede cancelar una oferta ajena", async function () {
      const { gameItem, p2p, p2pAddr, vendedor, otro } = await loadFixture(conOferta);
      await expect(p2p.connect(otro).cancelar(1))
        .to.be.revertedWithCustomError(p2p, "NoEresVendedor")
        .withArgs(1n, vendedor.address);
      expect(await gameItem.ownerOf(1)).to.equal(p2pAddr);
    });

    it("no se puede cancelar lo que no está listado, ni cancelar dos veces", async function () {
      const { p2p, vendedor } = await loadFixture(conOferta);
      await p2p.connect(vendedor).cancelar(1);
      await expect(p2p.connect(vendedor).cancelar(1))
        .to.be.revertedWithCustomError(p2p, "NoListado")
        .withArgs(1n);
    });

    it("después de cancelar, nadie puede comprar", async function () {
      const { p2p, p2pAddr, oro, vendedor, comprador } = await loadFixture(conOferta);
      await p2p.connect(vendedor).cancelar(1);
      await oro.connect(comprador).approve(p2pAddr, ORO(100));
      await expect(p2p.connect(comprador).comprar(1))
        .to.be.revertedWithCustomError(p2p, "NoListado")
        .withArgs(1n);
    });

    it("tras cancelar, el vendedor puede volver a listar al precio que quiera", async function () {
      const { p2p, vendedor } = await loadFixture(conOferta);
      await p2p.connect(vendedor).cancelar(1);
      await p2p.connect(vendedor).listar(1, ORO(42));
      expect((await p2p.listado(1)).precio).to.equal(ORO(42));
    });
  });

  // --------------------------------------------------------------------- comprar

  describe("comprar", function () {
    it("extremo a extremo: mint → listar → comprar → cambia de dueño y el ORO se reparte", async function () {
      const { gameItem, oro, p2p, p2pAddr, vendedor, comprador } = await loadFixture(listaParaComprar);

      const supplyAntes = await oro.totalSupply();
      const compradorAntes = await oro.balanceOf(comprador.address);

      await expect(p2p.connect(comprador).comprar(1))
        .to.emit(p2p, "Vendido")
        .withArgs(1n, vendedor.address, comprador.address, ORO(100), ORO(5), 0);

      // El objeto es del comprador y ya no está en custodia ni a la venta.
      expect(await gameItem.ownerOf(1)).to.equal(comprador.address);
      expect(await p2p.estaListado(1)).to.equal(false);
      expect(await p2p.totalListados()).to.equal(0n);

      // ORO: el vendedor cobra 95, el comprador paga 100 y 5 desaparecen.
      expect(await oro.balanceOf(vendedor.address)).to.equal(ORO(95));
      expect(await oro.balanceOf(comprador.address)).to.equal(compradorAntes - ORO(100));
      expect(await oro.balanceOf(p2pAddr)).to.equal(0n); // el contrato nunca retiene ORO
      expect(await oro.totalSupply()).to.equal(supplyAntes - ORO(5));
      expect(await p2p.oroQuemado()).to.equal(ORO(5));

      // La aprobación de ORO queda gastada por completo.
      expect(await oro.allowance(comprador.address, p2pAddr)).to.equal(0n);
    });

    it("devuelve (precio, comision)", async function () {
      const { p2p, comprador } = await loadFixture(listaParaComprar);
      const [precio, comision] = await p2p.connect(comprador).comprar.staticCall(1);
      expect(precio).to.equal(ORO(100));
      expect(comision).to.equal(ORO(5));
    });

    it("comprarHasta protege del vendedor que sube el precio en el último momento", async function () {
      const { gameItem, oro, p2p, p2pAddr, vendedor, comprador } = await loadFixture(conOferta);
      // El comprador aprueba de sobra (lo típico de una interfaz) y ve un precio de 100.
      await oro.connect(comprador).approve(p2pAddr, ORO(10_000));
      // El vendedor se adelanta y lo sube a 5 000.
      await p2p.connect(vendedor).cambiarPrecio(1, ORO(5000));

      // Con `comprar` a secas se pagaría el precio nuevo: 5 000 ORO.
      const [precioSinTope] = await p2p.connect(comprador).comprar.staticCall(1);
      expect(precioSinTope).to.equal(ORO(5000));

      // Con el tope, la compra revierte en vez de cobrar de más.
      await expect(p2p.connect(comprador).comprarHasta(1, ORO(100)))
        .to.be.revertedWithCustomError(p2p, "PrecioSubio")
        .withArgs(ORO(5000), ORO(100));
      expect(await gameItem.ownerOf(1)).to.equal(p2pAddr);
      expect(await oro.balanceOf(vendedor.address)).to.equal(0n);
    });

    it("comprarHasta compra igual si el precio no ha subido (y acepta una bajada)", async function () {
      const { gameItem, oro, p2p, p2pAddr, vendedor, comprador } = await loadFixture(listaParaComprar);
      await p2p.connect(vendedor).cambiarPrecio(1, ORO(60)); // rebaja
      await p2p.connect(comprador).comprarHasta(1, ORO(100));
      expect(await gameItem.ownerOf(1)).to.equal(comprador.address);
      expect(await oro.balanceOf(vendedor.address)).to.equal(ORO(57)); // 60 − 5 %
      expect(await oro.allowance(comprador.address, p2pAddr)).to.equal(ORO(40)); // solo gastó 60
    });

    it("el vendedor no puede comprarse a sí mismo", async function () {
      const { oro, p2p, p2pAddr, vendedor } = await loadFixture(conOferta);
      await oro.mint(vendedor.address, ORO(500)); // el owner del fixture es minter de ORO
      await oro.connect(vendedor).approve(p2pAddr, ORO(100));
      await expect(p2p.connect(vendedor).comprar(1))
        .to.be.revertedWithCustomError(p2p, "CompradorEsVendedor")
        .withArgs(1n);
      expect(await p2p.estaListado(1)).to.equal(true);
    });

    it("sin ORO suficiente no se compra", async function () {
      const { p2p, p2pAddr, oro, vendedor, otro } = await loadFixture(conOferta);
      // `otro` tiene 500 ORO y aprueba de sobra, pero el legendario vale 900.
      await p2p.connect(vendedor).listar(3, ORO(900));
      await oro.connect(otro).approve(p2pAddr, ORO(900));
      expect(await oro.balanceOf(otro.address)).to.equal(ORO(500));
      await expect(p2p.connect(otro).comprar(3))
        .to.be.revertedWithCustomError(p2p, "OroInsuficiente")
        .withArgs(ORO(500), ORO(900));
      expect(await p2p.estaListado(3)).to.equal(true);
    });

    it("sin aprobar el ORO no se compra (y con una aprobación corta tampoco)", async function () {
      const { oro, p2p, p2pAddr, comprador } = await loadFixture(conOferta);
      await expect(p2p.connect(comprador).comprar(1))
        .to.be.revertedWithCustomError(p2p, "SinAprobacionOro")
        .withArgs(0n, ORO(100));
      await oro.connect(comprador).approve(p2pAddr, ORO(99));
      await expect(p2p.connect(comprador).comprar(1))
        .to.be.revertedWithCustomError(p2p, "SinAprobacionOro")
        .withArgs(ORO(99), ORO(100));
      expect(await p2p.estaListado(1)).to.equal(true);
    });

    it("si el comprador retira la aprobación del ORO justo antes, la compra falla y no se mueve nada", async function () {
      const { gameItem, p2p, p2pAddr, oro, comprador } = await loadFixture(listaParaComprar);
      await oro.connect(comprador).approve(p2pAddr, 0);
      await expect(p2p.connect(comprador).comprar(1)).to.be.revertedWithCustomError(p2p, "SinAprobacionOro");
      expect(await gameItem.ownerOf(1)).to.equal(p2pAddr);
    });

    it("lo ya vendido no se puede comprar otra vez", async function () {
      const { oro, p2p, p2pAddr, comprador, otro } = await loadFixture(listaParaComprar);
      await p2p.connect(comprador).comprar(1);
      await oro.connect(otro).approve(p2pAddr, ORO(100));
      await expect(p2p.connect(otro).comprar(1))
        .to.be.revertedWithCustomError(p2p, "NoListado")
        .withArgs(1n);
    });

    it("no se puede comprar algo que nunca se listó", async function () {
      const { p2p, comprador } = await loadFixture(listaParaComprar);
      await expect(p2p.connect(comprador).comprar(77))
        .to.be.revertedWithCustomError(p2p, "NoListado")
        .withArgs(77n);
    });

    it("la custodia protege al comprador: aunque el vendedor retire la aprobación del NFT, la venta se cierra", async function () {
      const { gameItem, p2p, p2pAddr, vendedor, comprador } = await loadFixture(listaParaComprar);
      // Clásico del mercado sin custodia: el vendedor revoca y la compra del otro falla.
      await gameItem.connect(vendedor).setApprovalForAll(p2pAddr, false);
      await p2p.connect(comprador).comprar(1);
      expect(await gameItem.ownerOf(1)).to.equal(comprador.address);
    });

    it("el vendedor tampoco puede sacar el NFT por su cuenta mientras está listado", async function () {
      const { gameItem, p2p, p2pAddr, vendedor, otro } = await loadFixture(conOferta);
      await expect(
        gameItem.connect(vendedor).transferFrom(p2pAddr, otro.address, 1)
      ).to.be.revertedWithCustomError(gameItem, "ERC721InsufficientApproval");
    });

    it("con comisión del 0 % no se quema nada y el vendedor cobra todo", async function () {
      const { oro, p2p, owner, vendedor, comprador } = await loadFixture(listaParaComprar);
      await p2p.connect(owner).setComision(0);
      const supplyAntes = await oro.totalSupply();
      await expect(p2p.connect(comprador).comprar(1))
        .to.emit(p2p, "Vendido")
        .withArgs(1n, vendedor.address, comprador.address, ORO(100), 0n, 0);
      expect(await oro.balanceOf(vendedor.address)).to.equal(ORO(100));
      expect(await oro.totalSupply()).to.equal(supplyAntes);
      expect(await p2p.oroQuemado()).to.equal(0n);
    });

    it("con la comisión al máximo (10 %) se queman 10 de cada 100", async function () {
      const { oro, p2p, owner, vendedor, comprador } = await loadFixture(listaParaComprar);
      await p2p.connect(owner).setComision(1000);
      await p2p.connect(comprador).comprar(1);
      expect(await oro.balanceOf(vendedor.address)).to.equal(ORO(90));
      expect(await p2p.oroQuemado()).to.equal(ORO(10));
    });

    it("precios diminutos: la comisión redondea a la baja y el vendedor cobra el resto", async function () {
      const { gameItem, oro, p2p, p2pAddr, vendedor, comprador } = await loadFixture(desplegar);
      await gameItem.connect(vendedor).setApprovalForAll(p2pAddr, true);
      await p2p.connect(vendedor).listar(1, 19n); // 19 unidades base (1,9e-17 ORO)
      await oro.connect(comprador).approve(p2pAddr, 19n);
      await p2p.connect(comprador).comprar(1);
      expect(await oro.balanceOf(vendedor.address)).to.equal(19n); // 19 × 5 % = 0,95 → 0
      expect(await p2p.oroQuemado()).to.equal(0n); // nada que quemar, y la venta no revierte
      expect(await gameItem.ownerOf(1)).to.equal(comprador.address);
    });
  });

  // -------------------------------------------------------------------- reentrada

  describe("Reentrada", function () {
    // ORO hostil: reentra en el mercado desde `transferFrom`, justo cuando el mercado
    // paga al vendedor. El LootGold real no tiene callbacks, así que esto es el peor caso.
    async function conOroHostil() {
      const [owner, vendedor, comprador] = await ethers.getSigners();
      const gameItem = await (await ethers.getContractFactory("GameItem")).deploy();
      const oroMalo = await (await ethers.getContractFactory("OroReentrante")).deploy();
      const p2p = await (await ethers.getContractFactory("MercadoP2P")).deploy(
        await gameItem.getAddress(),
        await oroMalo.getAddress()
      );
      const p2pAddr = await p2p.getAddress();
      await oroMalo.setMercado(p2pAddr);
      await oroMalo.acunar(comprador.address, ORO(1000));

      await gameItem.mintItem(vendedor.address, "Espada", "Espada", 0, 5, 3); // 1
      await gameItem.mintItem(vendedor.address, "Escudo", "Escudo", 1, 12, 4); // 2
      await gameItem.connect(vendedor).setApprovalForAll(p2pAddr, true);
      await p2p.connect(vendedor).listar(1, ORO(100));
      await p2p.connect(vendedor).listar(2, ORO(200));
      await oroMalo.connect(comprador).approve(p2pAddr, ORO(1000));

      return { gameItem, oroMalo, p2p, p2pAddr, owner, vendedor, comprador };
    }

    it("reentrar en comprar desde el pago revierte toda la transacción", async function () {
      const { gameItem, oroMalo, p2p, p2pAddr, comprador } = await loadFixture(conOroHostil);
      await oroMalo.setModo(3, 1); // reentra en comprar(1) y propaga el error
      await expect(p2p.connect(comprador).comprar(1)).to.be.revertedWithCustomError(
        p2p,
        "ReentrancyGuardReentrantCall"
      );
      expect(await gameItem.ownerOf(1)).to.equal(p2pAddr); // nada se movió
      expect(await p2p.estaListado(1)).to.equal(true);
    });

    it("si el atacante se traga el error, la reentrada queda bloqueada y la venta se cierra una sola vez", async function () {
      const { gameItem, oroMalo, p2p, comprador } = await loadFixture(conOroHostil);
      await oroMalo.setModo(1, 1); // reentra en comprar(1) con try/catch
      await p2p.connect(comprador).comprar(1);
      expect(await oroMalo.vecesReentrado()).to.equal(1n);
      expect(await oroMalo.reentradaBloqueada()).to.equal(true);
      expect(await gameItem.ownerOf(1)).to.equal(comprador.address);
      const [, ventas] = await p2p.mercadoTotal();
      expect(ventas).to.equal(1n); // una sola venta anotada
    });

    it("reentrar para comprar OTRA oferta en medio del pago también se bloquea", async function () {
      const { gameItem, oroMalo, p2p, p2pAddr, comprador } = await loadFixture(conOroHostil);
      await oroMalo.setModo(1, 2); // mientras compra el 1, intenta colarse en el 2
      await p2p.connect(comprador).comprar(1);
      expect(await oroMalo.reentradaBloqueada()).to.equal(true);
      expect(await gameItem.ownerOf(2)).to.equal(p2pAddr); // el 2 sigue en custodia
      expect(await p2p.estaListado(2)).to.equal(true);
    });

    it("reentrar para cancelar una oferta en medio del pago también se bloquea", async function () {
      const { oroMalo, p2p, comprador } = await loadFixture(conOroHostil);
      await oroMalo.setModo(2, 2); // intenta cancelar la oferta 2 durante la compra
      await p2p.connect(comprador).comprar(1);
      expect(await oroMalo.reentradaBloqueada()).to.equal(true);
      expect(await p2p.estaListado(2)).to.equal(true);
    });
  });

  // ----------------------------------------------------------------------- pausa

  describe("Pausa de emergencia y rescate", function () {
    it("solo el owner pausa y reanuda", async function () {
      const { p2p, otro } = await loadFixture(conOferta);
      await expect(p2p.connect(otro).pausar()).to.be.revertedWithCustomError(p2p, "OwnableUnauthorizedAccount");
      await expect(p2p.pausar()).to.emit(p2p, "Paused");
      await expect(p2p.connect(otro).reanudar()).to.be.revertedWithCustomError(p2p, "OwnableUnauthorizedAccount");
      await expect(p2p.reanudar()).to.emit(p2p, "Unpaused");
    });

    it("pausado no se puede listar, cambiar precio, cancelar ni comprar", async function () {
      const { gameItem, p2p, p2pAddr, vendedor, comprador } = await loadFixture(listaParaComprar);
      await gameItem.connect(vendedor).setApprovalForAll(p2pAddr, true);
      await p2p.pausar();
      for (const llamada of [
        p2p.connect(vendedor).listar(2, ORO(10)),
        p2p.connect(vendedor).cambiarPrecio(1, ORO(10)),
        p2p.connect(vendedor).cancelar(1),
        p2p.connect(comprador).comprar(1),
      ]) {
        await expect(llamada).to.be.revertedWithCustomError(p2p, "EnforcedPause");
      }
    });

    it("pausado, el vendedor rescata su NFT", async function () {
      const { gameItem, p2p, vendedor } = await loadFixture(conOferta);
      await p2p.pausar();
      await expect(p2p.connect(vendedor).rescatar(1)).to.emit(p2p, "Rescatado").withArgs(1n, vendedor.address);
      expect(await gameItem.ownerOf(1)).to.equal(vendedor.address);
      expect(await p2p.totalListados()).to.equal(0n);
    });

    it("solo el vendedor rescata, y solo con el mercado pausado", async function () {
      const { p2p, vendedor, otro } = await loadFixture(conOferta);
      await expect(p2p.connect(vendedor).rescatar(1)).to.be.revertedWithCustomError(p2p, "ExpectedPause");
      await p2p.pausar();
      await expect(p2p.connect(otro).rescatar(1))
        .to.be.revertedWithCustomError(p2p, "NoEresVendedor")
        .withArgs(1n, vendedor.address);
      await expect(p2p.connect(vendedor).rescatar(2))
        .to.be.revertedWithCustomError(p2p, "NoListado")
        .withArgs(2n);
    });

    it("al reanudar, el mercado vuelve a funcionar", async function () {
      const { gameItem, p2p, comprador } = await loadFixture(listaParaComprar);
      await p2p.pausar();
      await p2p.reanudar();
      await p2p.connect(comprador).comprar(1);
      expect(await gameItem.ownerOf(1)).to.equal(comprador.address);
    });
  });

  // -------------------------------------------------------- administración y owner

  describe("Comisión y administración", function () {
    it("el owner cambia la comisión dentro del tope", async function () {
      const { p2p } = await loadFixture(desplegar);
      await expect(p2p.setComision(250)).to.emit(p2p, "ComisionCambiada").withArgs(500n, 250n);
      expect(await p2p.comisionBps()).to.equal(250n);
      const [comision, neto] = await p2p.desglose(ORO(100));
      expect(comision).to.equal(ORO(2.5));
      expect(neto).to.equal(ORO(97.5));
    });

    it("la comisión no puede pasar del 10 %", async function () {
      const { p2p } = await loadFixture(desplegar);
      await expect(p2p.setComision(1001))
        .to.be.revertedWithCustomError(p2p, "ComisionExcesiva")
        .withArgs(1001n, 1000n);
      expect(await p2p.comisionBps()).to.equal(500n);
    });

    it("solo el owner cambia la comisión", async function () {
      const { p2p, otro } = await loadFixture(desplegar);
      await expect(p2p.connect(otro).setComision(0)).to.be.revertedWithCustomError(
        p2p,
        "OwnableUnauthorizedAccount"
      );
    });

    it("el owner devuelve un NFT que alguien envió al contrato sin listarlo", async function () {
      const { gameItem, p2p, p2pAddr, vendedor } = await loadFixture(desplegar);
      await gameItem.connect(vendedor).transferFrom(vendedor.address, p2pAddr, 1); // error del jugador
      await expect(p2p.devolverNftPerdido(1, vendedor.address))
        .to.emit(p2p, "NftPerdidoDevuelto")
        .withArgs(1n, vendedor.address);
      expect(await gameItem.ownerOf(1)).to.equal(vendedor.address);
    });

    it("el owner NO puede tocar un NFT que está en custodia de una oferta", async function () {
      const { gameItem, p2p, p2pAddr, owner } = await loadFixture(conOferta);
      await expect(p2p.connect(owner).devolverNftPerdido(1, owner.address))
        .to.be.revertedWithCustomError(p2p, "EstaListado")
        .withArgs(1n);
      expect(await gameItem.ownerOf(1)).to.equal(p2pAddr);
    });

    it("devolverNftPerdido falla si el contrato no tiene ese NFT, y solo lo llama el owner", async function () {
      const { p2p, vendedor, otro } = await loadFixture(desplegar);
      await expect(p2p.devolverNftPerdido(1, vendedor.address))
        .to.be.revertedWithCustomError(p2p, "NoEsNuestro")
        .withArgs(1n, vendedor.address);
      await expect(p2p.connect(otro).devolverNftPerdido(1, otro.address)).to.be.revertedWithCustomError(
        p2p,
        "OwnableUnauthorizedAccount"
      );
    });

    it("el contrato rechaza safeTransferFrom: no se le pueden colar NFT por accidente", async function () {
      const { gameItem, p2pAddr, vendedor } = await loadFixture(desplegar);
      await expect(
        gameItem.connect(vendedor)["safeTransferFrom(address,address,uint256)"](vendedor.address, p2pAddr, 1)
      ).to.be.revertedWithCustomError(gameItem, "ERC721InvalidReceiver");
    });
  });

  // -------------------------------------------------------- vistas y paginación

  describe("Vistas y paginación", function () {
    async function conVariasOfertas() {
      const f = await desplegar();
      await f.gameItem.connect(f.vendedor).setApprovalForAll(f.p2pAddr, true);
      await f.gameItem.connect(f.otro).setApprovalForAll(f.p2pAddr, true);
      await f.p2p.connect(f.vendedor).listar(1, ORO(100)); // común
      await f.p2p.connect(f.vendedor).listar(2, ORO(300)); // raro
      await f.p2p.connect(f.vendedor).listar(3, ORO(900)); // legendario
      await f.p2p.connect(f.otro).listar(4, ORO(50)); // común, de otro vendedor
      return f;
    }

    it("totalListados y listados(desde, cuantos) paginan sin revertir nunca", async function () {
      const { p2p } = await loadFixture(conVariasOfertas);
      expect(await p2p.totalListados()).to.equal(4n);

      const pagina1 = await p2p.listados(0, 2);
      expect(pagina1.length).to.equal(2);
      const pagina2 = await p2p.listados(2, 2);
      expect(pagina2.length).to.equal(2);

      // Las dos páginas juntas son las cuatro ofertas, sin repetir.
      const ids = [...pagina1, ...pagina2].map((o) => Number(o.tokenId)).sort();
      expect(ids).to.deep.equal([1, 2, 3, 4]);

      expect((await p2p.listados(3, 50)).length).to.equal(1); // recorta al final
      expect((await p2p.listados(4, 1)).length).to.equal(0); // fuera de rango: vacío
      expect((await p2p.listados(999, 10)).length).to.equal(0);
      expect((await p2p.listados(0, 0)).length).to.equal(0);
    });

    it("cada oferta de la página trae tokenId, vendedor, rareza, precio y fecha", async function () {
      const { p2p, vendedor } = await loadFixture(conVariasOfertas);
      const todas = await p2p.listados(0, 100);
      const o3 = todas.find((o) => o.tokenId === 3n);
      expect(o3.vendedor).to.equal(vendedor.address);
      expect(o3.precio).to.equal(ORO(900));
      expect(o3.rareza).to.equal(2);
      expect(o3.creado).to.be.greaterThan(0n);
    });

    it("listadosDe devuelve solo las ofertas de ese jugador", async function () {
      const { p2p, vendedor, otro, comprador } = await loadFixture(conVariasOfertas);
      const suyas = await p2p.listadosDe(vendedor.address);
      expect(suyas.map((o) => Number(o.tokenId)).sort()).to.deep.equal([1, 2, 3]);
      const deOtro = await p2p.listadosDe(otro.address);
      expect(deOtro.length).to.equal(1);
      expect(deOtro[0].tokenId).to.equal(4n);
      expect(deOtro[0].precio).to.equal(ORO(50));
      expect(await p2p.listadosDe(comprador.address)).to.deep.equal([]);
    });

    it("los índices se mantienen bien al quitar ofertas del medio", async function () {
      const { p2p, vendedor, otro } = await loadFixture(conVariasOfertas);
      await p2p.connect(vendedor).cancelar(2); // la del medio
      expect(await p2p.totalListados()).to.equal(3n);
      expect((await p2p.listados(0, 10)).map((o) => Number(o.tokenId)).sort()).to.deep.equal([1, 3, 4]);
      expect((await p2p.listadosDe(vendedor.address)).map((o) => Number(o.tokenId)).sort()).to.deep.equal([1, 3]);

      await p2p.connect(otro).cancelar(4); // la última
      await p2p.connect(vendedor).cancelar(1); // la primera
      expect(await p2p.totalListados()).to.equal(1n);
      expect((await p2p.listados(0, 10))[0].tokenId).to.equal(3n);
      expect(await p2p.listadosDe(otro.address)).to.deep.equal([]);

      await p2p.connect(vendedor).cancelar(3);
      expect(await p2p.totalListados()).to.equal(0n);
      expect((await p2p.listados(0, 10)).length).to.equal(0);
    });

    it("listado() de algo no listado devuelve la oferta vacía en vez de revertir", async function () {
      const { p2p } = await loadFixture(desplegar);
      const o = await p2p.listado(12345);
      expect(o.vendedor).to.equal(CERO);
      expect(o.precio).to.equal(0n);
      expect(await p2p.estaListado(12345)).to.equal(false);
    });
  });

  // ------------------------------------------------------------ datos de mercado

  describe("Datos de mercado (agregados on-chain)", function () {
    it("acumula volumen, ventas y precio medio por rareza y en total", async function () {
      const { gameItem, oro, p2p, p2pAddr, vendedor, comprador } = await loadFixture(desplegar);
      await gameItem.connect(vendedor).setApprovalForAll(p2pAddr, true);
      await oro.connect(comprador).approve(p2pAddr, ORO(10_000));

      // Dos ventas de objetos raros (300 y 500) y una de un legendario (900).
      await p2p.connect(vendedor).listar(2, ORO(300));
      await p2p.connect(comprador).comprar(2);
      await p2p.connect(vendedor).listar(5, ORO(500));
      await p2p.connect(comprador).comprar(5);
      await p2p.connect(vendedor).listar(3, ORO(900));
      await p2p.connect(comprador).comprar(3);

      const [volRaro, ventasRaro, medioRaro] = await p2p.mercadoRareza(1);
      expect(volRaro).to.equal(ORO(800));
      expect(ventasRaro).to.equal(2n);
      expect(medioRaro).to.equal(ORO(400));

      const [volLeg, ventasLeg, medioLeg] = await p2p.mercadoRareza(2);
      expect(volLeg).to.equal(ORO(900));
      expect(ventasLeg).to.equal(1n);
      expect(medioLeg).to.equal(ORO(900));

      const [volComun, ventasComun, medioComun] = await p2p.mercadoRareza(0);
      expect(volComun).to.equal(0n);
      expect(ventasComun).to.equal(0n);
      expect(medioComun).to.equal(0n); // sin ventas: 0, no división por cero

      const [vol, ventas, medio, quemado] = await p2p.mercadoTotal();
      expect(vol).to.equal(ORO(1700));
      expect(ventas).to.equal(3n);
      expect(medio).to.equal(ORO(1700) / 3n);
      expect(quemado).to.equal(ORO(85)); // 5 % de 1700
      expect(await p2p.oroQuemado()).to.equal(ORO(85));

      // `ultimoDia` es el día UTC de la última venta.
      const dia = BigInt(Math.floor(Date.now() / 1000 / 86400));
      const total = await p2p.totalMercado();
      expect(total.ultimoDia).to.be.closeTo(dia, 2n);
    });

    it("mercadoRareza revierte con una rareza que no existe", async function () {
      const { p2p } = await loadFixture(desplegar);
      await expect(p2p.mercadoRareza(3)).to.be.reverted;
    });

    it("cancelar no cuenta como venta", async function () {
      const { p2p, vendedor } = await loadFixture(conOferta);
      await p2p.connect(vendedor).cancelar(1);
      const [vol, ventas] = await p2p.mercadoTotal();
      expect(vol).to.equal(0n);
      expect(ventas).to.equal(0n);
    });
  });

  // -------------------------------------------------------------------------- gas

  describe("Gas por operación", function () {
    it("mide el gas de listar, cambiarPrecio, cancelar y comprar", async function () {
      const { gameItem, oro, p2p, p2pAddr, vendedor, comprador } = await loadFixture(desplegar);
      const medir = async (que, promesa) => {
        const rc = await (await promesa).wait();
        console.log(`        ${que}: ${rc.gasUsed} gas`);
        return rc.gasUsed;
      };

      await medir("setApprovalForAll (una vez)", gameItem.connect(vendedor).setApprovalForAll(p2pAddr, true));
      await medir("approve de ORO (comprador)", oro.connect(comprador).approve(p2pAddr, ORO(10_000)));
      const gasListar = await medir("listar", p2p.connect(vendedor).listar(1, ORO(100)));
      await medir("cambiarPrecio", p2p.connect(vendedor).cambiarPrecio(1, ORO(120)));
      await medir("cancelar", p2p.connect(vendedor).cancelar(1));
      await medir("listar (2.ª vez)", p2p.connect(vendedor).listar(1, ORO(120)));
      const gasComprar = await medir("comprar", p2p.connect(comprador).comprar(1));
      await medir("listar (otro objeto)", p2p.connect(vendedor).listar(2, ORO(300)));
      await medir("comprar (2.ª venta)", p2p.connect(comprador).comprar(2));
      await medir("listar (tercer objeto)", p2p.connect(vendedor).listar(3, ORO(900)));
      await medir("comprarHasta", p2p.connect(comprador).comprarHasta(3, ORO(900)));

      // Topes amplios: si una operación se dispara, el test lo avisa.
      expect(gasListar).to.be.lessThan(260_000n);
      expect(gasComprar).to.be.lessThan(300_000n);
    });
  });
});
