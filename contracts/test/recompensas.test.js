const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const ORO = (n) => ethers.parseEther(String(n));
const DIA = 24 * 60 * 60;
const TABLA = [10, 15, 20, 25, 30, 35, 40];

describe("Recompensas (Loot Arena 1.2) y LootGold v2", function () {
  async function desplegar() {
    const [owner, jugador, otro, servidor] = await ethers.getSigners();
    const gameItem = await (await ethers.getContractFactory("GameItem")).deploy();
    const oro = await (await ethers.getContractFactory("LootGold")).deploy();
    const cosmeticos = await (await ethers.getContractFactory("LootCosmetics")).deploy("ipfs://x/");
    const mercado = await (await ethers.getContractFactory("Mercado")).deploy(
      await gameItem.getAddress(),
      await oro.getAddress(),
      await cosmeticos.getAddress()
    );
    const mercadoAddr = await mercado.getAddress();
    const recompensas = await (await ethers.getContractFactory("Recompensas")).deploy(
      await oro.getAddress(),
      mercadoAddr,
      servidor.address
    );
    const recAddr = await recompensas.getAddress();
    await oro.setMinter(mercadoAddr, true);
    await oro.setMinter(recAddr, true);
    await cosmeticos.setMinter(mercadoAddr);
    await mercado.setRecompensas(recAddr);

    // Empezamos a media mañana UTC de un día "limpio" para que los saltos de día sean claros
    const ahora = await time.latest();
    await time.increaseTo(Math.floor(ahora / DIA) * DIA + DIA + 10 * 3600);
    return { gameItem, oro, cosmeticos, mercado, mercadoAddr, recompensas, recAddr, owner, jugador, otro, servidor };
  }

  const hoy = async () => BigInt(Math.floor((await time.latest()) / DIA));
  const siguienteDia = () => time.increase(DIA);

  function eventoDiario(rc, recompensas) {
    return rc.logs.map((l) => { try { return recompensas.interface.parseLog(l); } catch { return null; } })
      .find((e) => e && e.name === "DiarioReclamado");
  }

  describe("LootGold v2: varios minters", function () {
    it("Mercado y Recompensas son minters; el owner puede añadir y retirar", async function () {
      const { oro, mercadoAddr, recAddr, owner, jugador } = await loadFixture(desplegar);
      expect(await oro.esMinter(mercadoAddr)).to.equal(true);
      expect(await oro.esMinter(recAddr)).to.equal(true);
      expect(await oro.esMinter(owner.address)).to.equal(false);

      await expect(oro.setMinter(owner.address, true)).to.emit(oro, "MinterCambiado").withArgs(owner.address, true);
      await oro.mint(jugador.address, ORO(5));
      expect(await oro.balanceOf(jugador.address)).to.equal(ORO(5));
      await expect(oro.setMinter(owner.address, false)).to.emit(oro, "MinterCambiado").withArgs(owner.address, false);
      await expect(oro.mint(jugador.address, 1)).to.be.revertedWithCustomError(oro, "SoloMinter").withArgs(owner.address);
    });

    it("un no-owner no puede nombrar minters", async function () {
      const { oro, jugador } = await loadFixture(desplegar);
      await expect(oro.connect(jugador).setMinter(jugador.address, true)).to.be.revertedWithCustomError(
        oro,
        "OwnableUnauthorizedAccount"
      );
    });

    it("retirar a Recompensas como minter hace fallar sus pagos", async function () {
      const { oro, recompensas, recAddr, jugador } = await loadFixture(desplegar);
      await oro.setMinter(recAddr, false);
      await expect(recompensas.connect(jugador).reclamarDiario()).to.be.revertedWithCustomError(oro, "SoloMinter");
    });
  });

  describe("reclamarDiario", function () {
    it("día 1 paga 10 ORO, emite DiarioReclamado y no deja reclamar dos veces el mismo día", async function () {
      const { oro, recompensas, jugador } = await loadFixture(desplegar);
      const dia = await hoy();
      await expect(recompensas.connect(jugador).reclamarDiario())
        .to.emit(recompensas, "DiarioReclamado")
        .withArgs(jugador.address, dia, 1n, ORO(10), 0n);
      expect(await oro.balanceOf(jugador.address)).to.equal(ORO(10));
      await expect(recompensas.connect(jugador).reclamarDiario()).to.be.revertedWithCustomError(
        recompensas,
        "YaReclamadoHoy"
      );
    });

    it("7 días seguidos: 10, 15 … 40 ORO y el día 7 regala un cofre cosmético; el día 8 vuelve a 10", async function () {
      const { oro, cosmeticos, mercado, recompensas, jugador } = await loadFixture(desplegar);
      let total = 0;
      for (let d = 1; d <= 7; d++) {
        const tx = await recompensas.connect(jugador).reclamarDiario();
        const ev = eventoDiario(await tx.wait(), recompensas);
        expect(ev.args.racha).to.equal(BigInt(d));
        expect(ev.args.oro).to.equal(ORO(TABLA[d - 1]));
        total += TABLA[d - 1];
        if (d < 7) {
          expect(ev.args.cosmeticoId).to.equal(0n);
        } else {
          const id = ev.args.cosmeticoId;
          expect(id >= 1n && id <= 13n).to.equal(true); // nunca la poción (consumible)
          expect(await cosmeticos.balanceOf(jugador.address, id)).to.equal(1n);
          await expect(tx).to.emit(mercado, "PremioAcunado").withArgs(jugador.address, id, true);
        }
        await siguienteDia();
      }
      expect(await oro.balanceOf(jugador.address)).to.equal(ORO(total)); // 175
      // día 8: la racha sigue contando pero el ciclo vuelve al día 1
      const ev8 = eventoDiario(await (await recompensas.connect(jugador).reclamarDiario()).wait(), recompensas);
      expect(ev8.args.racha).to.equal(8n);
      expect(ev8.args.oro).to.equal(ORO(10));
      expect(ev8.args.cosmeticoId).to.equal(0n);
    });

    it("si te saltas un día la racha vuelve a 1", async function () {
      const { recompensas, jugador } = await loadFixture(desplegar);
      await recompensas.connect(jugador).reclamarDiario();
      await siguienteDia();
      await recompensas.connect(jugador).reclamarDiario(); // racha 2
      await siguienteDia();
      await siguienteDia(); // se salta un día
      const ev = eventoDiario(await (await recompensas.connect(jugador).reclamarDiario()).wait(), recompensas);
      expect(ev.args.racha).to.equal(1n);
      expect(ev.args.oro).to.equal(ORO(10));
    });

    it("el día UTC cambia a medianoche, no 24 h después del reclamo", async function () {
      const { recompensas, jugador } = await loadFixture(desplegar);
      const t = await time.latest();
      await time.increaseTo(Math.floor(t / DIA) * DIA + DIA - 60); // 23:59 UTC
      await recompensas.connect(jugador).reclamarDiario();
      await time.increase(120); // 00:01 UTC del día siguiente
      const ev = eventoDiario(await (await recompensas.connect(jugador).reclamarDiario()).wait(), recompensas);
      expect(ev.args.racha).to.equal(2n);
    });

    it("estadoDiario: nunca, tras reclamar y con la racha rota", async function () {
      const { recompensas, jugador } = await loadFixture(desplegar);
      let e = await recompensas.estadoDiario(jugador.address);
      expect([e.racha, e.ultimoDia, e.puedeReclamar, e.segundosHastaSiguiente, e.proximaRecompensa]).to.deep.equal([
        0n, 0n, true, 0n, ORO(10),
      ]);
      expect(await recompensas.proximoDiaCiclo(jugador.address)).to.equal(1n);

      await recompensas.connect(jugador).reclamarDiario();
      const dia = await hoy();
      const t = BigInt(await time.latest());
      e = await recompensas.estadoDiario(jugador.address);
      expect(e.racha).to.equal(1n);
      expect(e.ultimoDia).to.equal(dia);
      expect(e.puedeReclamar).to.equal(false);
      expect(e.segundosHastaSiguiente).to.equal((dia + 1n) * BigInt(DIA) - t);
      expect(e.proximaRecompensa).to.equal(ORO(15));

      await siguienteDia();
      e = await recompensas.estadoDiario(jugador.address);
      expect(e.racha).to.equal(1n); // sigue vigente: puede continuarla hoy
      expect(e.puedeReclamar).to.equal(true);
      expect(e.proximaRecompensa).to.equal(ORO(15));

      await siguienteDia(); // se la saltó
      e = await recompensas.estadoDiario(jugador.address);
      expect(e.racha).to.equal(0n);
      expect(e.proximaRecompensa).to.equal(ORO(10));
    });

    it("proximoDiaCiclo avisa del cofre (7) la víspera", async function () {
      const { recompensas, jugador } = await loadFixture(desplegar);
      for (let d = 1; d <= 6; d++) {
        await recompensas.connect(jugador).reclamarDiario();
        await siguienteDia();
      }
      expect(await recompensas.proximoDiaCiclo(jugador.address)).to.equal(7n);
      expect((await recompensas.estadoDiario(jugador.address)).proximaRecompensa).to.equal(ORO(40));
    });

    it("el owner puede fijar un cosmético concreto para el día 7 o desactivarlo", async function () {
      const { cosmeticos, recompensas, owner, jugador, otro } = await loadFixture(desplegar);
      await expect(recompensas.connect(owner).setPremioDia7(true, 9))
        .to.emit(recompensas, "PremioDia7Cambiado")
        .withArgs(true, 9n);
      for (let d = 1; d <= 7; d++) {
        await recompensas.connect(jugador).reclamarDiario();
        if (d < 7) await siguienteDia();
      }
      expect(await cosmeticos.balanceOf(jugador.address, 9)).to.equal(1n);

      await recompensas.connect(owner).setPremioDia7(false, 0);
      for (let d = 1; d <= 7; d++) {
        const ev = eventoDiario(await (await recompensas.connect(otro).reclamarDiario()).wait(), recompensas);
        if (d === 7) expect(ev.args.cosmeticoId).to.equal(0n);
        await siguienteDia();
      }
    });

    it("el owner cambia la tabla; un no-owner no", async function () {
      const { recompensas, owner, jugador } = await loadFixture(desplegar);
      const nueva = [1, 2, 3, 4, 5, 6, 7].map(ORO);
      await expect(recompensas.connect(jugador).setTablaDiaria(nueva)).to.be.revertedWithCustomError(
        recompensas,
        "OwnableUnauthorizedAccount"
      );
      await recompensas.connect(owner).setTablaDiaria(nueva);
      expect(await recompensas.tablaDiaria(6)).to.equal(ORO(7));
      await expect(recompensas.connect(jugador).reclamarDiario())
        .to.emit(recompensas, "DiarioReclamado")
        .withArgs(jugador.address, await hoy(), 1n, ORO(1), 0n);
    });

    it("reentrar en reclamarDiario al recibir el cofre del día 7 revierte", async function () {
      const { recompensas, recAddr } = await loadFixture(desplegar);
      const at = await (await ethers.getContractFactory("AtacanteDiario")).deploy(recAddr);
      for (let d = 1; d <= 6; d++) {
        await at.reclamar();
        await siguienteDia();
      }
      await at.setReentrar(true);
      await expect(at.reclamar()).to.be.revertedWithCustomError(recompensas, "ReentrancyGuardReentrantCall");
      await at.setReentrar(false);
      await at.reclamar(); // sin reentrada funciona
    });
  });

  describe("Mercado.acunarPremio", function () {
    it("solo lo puede llamar Recompensas", async function () {
      const { mercado, owner, jugador } = await loadFixture(desplegar);
      await expect(mercado.connect(jugador).acunarPremio(jugador.address, 0))
        .to.be.revertedWithCustomError(mercado, "SoloRecompensas")
        .withArgs(jugador.address);
      await expect(mercado.connect(owner).acunarPremio(jugador.address, 3)).to.be.revertedWithCustomError(
        mercado,
        "SoloRecompensas"
      );
    });

    it("con recompensas sin fijar, nadie puede (ni la dirección 0 por error)", async function () {
      const { mercado, owner, jugador } = await loadFixture(desplegar);
      await expect(mercado.connect(owner).setRecompensas(ethers.ZeroAddress))
        .to.emit(mercado, "RecompensasCambiado");
      await expect(mercado.connect(jugador).acunarPremio(jugador.address, 1)).to.be.revertedWithCustomError(
        mercado,
        "SoloRecompensas"
      );
    });

    it("un no-owner no puede cambiar el contrato de recompensas", async function () {
      const { mercado, jugador } = await loadFixture(desplegar);
      await expect(mercado.connect(jugador).setRecompensas(jugador.address)).to.be.revertedWithCustomError(
        mercado,
        "OwnableUnauthorizedAccount"
      );
    });

    it("acuña el id pedido o una tirada de cofre (owner como 'recompensas' de prueba)", async function () {
      const { cosmeticos, mercado, owner, jugador } = await loadFixture(desplegar);
      await mercado.connect(owner).setRecompensas(owner.address);
      await expect(mercado.connect(owner).acunarPremio(jugador.address, 12))
        .to.emit(mercado, "PremioAcunado")
        .withArgs(jugador.address, 12n, false);
      expect(await cosmeticos.balanceOf(jugador.address, 12)).to.equal(1n);
      await expect(mercado.connect(owner).acunarPremio(jugador.address, 99)).to.be.revertedWithCustomError(
        mercado,
        "CosmeticoInexistente"
      );
      const id = await mercado.connect(owner).acunarPremio.staticCall(jugador.address, 0);
      expect(id >= 1n && id <= 13n).to.equal(true);
    });
  });

  describe("recompensar (operador)", function () {
    it("el operador paga ORO con motivo y se emite Recompensado", async function () {
      const { oro, recompensas, servidor, jugador } = await loadFixture(desplegar);
      expect(await recompensas.operador()).to.equal(servidor.address);
      await expect(recompensas.connect(servidor).recompensar(jugador.address, ORO(100), "pase10"))
        .to.emit(recompensas, "Recompensado")
        .withArgs(jugador.address, ORO(100), "pase10");
      expect(await oro.balanceOf(jugador.address)).to.equal(ORO(100));
      const r = await recompensas.restanteHoy(jugador.address);
      expect(r.jugadorRestante).to.equal(ORO(400));
      expect(r.globalRestante).to.equal(ORO(4900));
    });

    it("solo el operador; cantidad 0 revierte", async function () {
      const { recompensas, owner, jugador, servidor } = await loadFixture(desplegar);
      await expect(recompensas.connect(jugador).recompensar(jugador.address, 1, "x"))
        .to.be.revertedWithCustomError(recompensas, "SoloOperador")
        .withArgs(jugador.address);
      await expect(recompensas.connect(owner).recompensar(jugador.address, 1, "x")).to.be.revertedWithCustomError(
        recompensas,
        "SoloOperador"
      );
      await expect(recompensas.connect(servidor).recompensar(jugador.address, 0, "x")).to.be.revertedWithCustomError(
        recompensas,
        "CantidadCero"
      );
    });

    it("tope diario por jugador (500 ORO por defecto) y se renueva al día siguiente", async function () {
      const { recompensas, servidor, jugador, otro } = await loadFixture(desplegar);
      const r = recompensas.connect(servidor);
      await r.recompensar(jugador.address, ORO(400), "pase30");
      await expect(r.recompensar(jugador.address, ORO(101), "misiones_diarias"))
        .to.be.revertedWithCustomError(recompensas, "TopeJugadorSuperado")
        .withArgs(ORO(100), ORO(101));
      await r.recompensar(jugador.address, ORO(100), "misiones_diarias"); // justo el tope
      await r.recompensar(otro.address, ORO(25), "misiones_diarias"); // otro jugador, su propio tope
      await siguienteDia();
      await r.recompensar(jugador.address, ORO(500), "pase30");
    });

    it("tope global diario", async function () {
      const { recompensas, owner, servidor, jugador, otro } = await loadFixture(desplegar);
      await expect(recompensas.connect(owner).setTopes(ORO(500), ORO(600)))
        .to.emit(recompensas, "TopesCambiados")
        .withArgs(ORO(500), ORO(600));
      const r = recompensas.connect(servidor);
      await r.recompensar(jugador.address, ORO(500), "pase30");
      await expect(r.recompensar(otro.address, ORO(101), "pase10"))
        .to.be.revertedWithCustomError(recompensas, "TopeGlobalSuperado")
        .withArgs(ORO(100), ORO(101));
      await siguienteDia();
      await r.recompensar(otro.address, ORO(101), "pase10");
    });

    it("el owner cambia el operador; un no-owner no puede tocar operador ni topes", async function () {
      const { recompensas, owner, servidor, jugador, otro } = await loadFixture(desplegar);
      await expect(recompensas.connect(jugador).setOperador(jugador.address)).to.be.revertedWithCustomError(
        recompensas,
        "OwnableUnauthorizedAccount"
      );
      await expect(recompensas.connect(jugador).setTopes(1, 1)).to.be.revertedWithCustomError(
        recompensas,
        "OwnableUnauthorizedAccount"
      );
      await expect(recompensas.connect(jugador).setPremioDia7(false, 0)).to.be.revertedWithCustomError(
        recompensas,
        "OwnableUnauthorizedAccount"
      );
      await expect(recompensas.connect(owner).setOperador(otro.address))
        .to.emit(recompensas, "OperadorCambiado")
        .withArgs(servidor.address, otro.address);
      await expect(recompensas.connect(servidor).recompensar(jugador.address, 1, "x")).to.be.revertedWithCustomError(
        recompensas,
        "SoloOperador"
      );
      await recompensas.connect(otro).recompensar(jugador.address, 1, "x");
    });
  });

  describe("Extremo a extremo 1.2", function () {
    it("diario + premio del servidor + vender + comprar con el ORO ganado", async function () {
      const { gameItem, oro, cosmeticos, mercado, mercadoAddr, recompensas, servidor, jugador } =
        await loadFixture(desplegar);
      await recompensas.connect(jugador).reclamarDiario(); // 10
      await recompensas.connect(servidor).recompensar(jugador.address, ORO(25), "misiones_diarias"); // 35
      await gameItem.mintItem(jugador.address, "Hacha", "Espada", 1, 10, 5); // 40 + 30 = 70
      await gameItem.connect(jugador).setApprovalForAll(mercadoAddr, true);
      await mercado.connect(jugador).venderItem(1); // 105
      expect(await oro.balanceOf(jugador.address)).to.equal(ORO(105));
      await mercado.connect(jugador).comprarCosmetico(4, 1); // capucha 80
      expect(await cosmeticos.balanceOf(jugador.address, 4)).to.equal(1n);
      expect(await oro.balanceOf(jugador.address)).to.equal(ORO(25));
    });
  });
});
