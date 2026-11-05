const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("GameItem", function () {
  // Despliega un contrato limpio para cada test
  async function desplegar() {
    const [owner, jugador, otro] = await ethers.getSigners();
    const GameItem = await ethers.getContractFactory("GameItem");
    const gameItem = await GameItem.deploy();
    await gameItem.waitForDeployment();
    return { gameItem, owner, jugador, otro };
  }

  describe("Despliegue", function () {
    it("tiene nombre, símbolo y owner correctos", async function () {
      const { gameItem, owner } = await loadFixture(desplegar);
      expect(await gameItem.name()).to.equal("Loot Arena Item");
      expect(await gameItem.symbol()).to.equal("LOOT");
      expect(await gameItem.owner()).to.equal(owner.address);
      expect(await gameItem.totalMinted()).to.equal(0n);
    });
  });

  describe("mintItem", function () {
    it("mintea al destinatario con tokenId 1 y emite ItemMinted", async function () {
      const { gameItem, jugador } = await loadFixture(desplegar);

      await expect(gameItem.mintItem(jugador.address, "Espada Rúnica", "Espada", 1, 12, 3))
        .to.emit(gameItem, "ItemMinted")
        .withArgs(jugador.address, 1n, "Espada Rúnica", "Espada", 1, 12, 3);

      expect(await gameItem.ownerOf(1)).to.equal(jugador.address);
      expect(await gameItem.balanceOf(jugador.address)).to.equal(1n);
      expect(await gameItem.totalMinted()).to.equal(1n);
    });

    it("devuelve el tokenId (staticCall) y los ids son consecutivos desde 1", async function () {
      const { gameItem, jugador } = await loadFixture(desplegar);
      expect(
        await gameItem.mintItem.staticCall(jugador.address, "Casco", "Casco", 0, 0, 2)
      ).to.equal(1n);

      await gameItem.mintItem(jugador.address, "Casco", "Casco", 0, 0, 2);
      await gameItem.mintItem(jugador.address, "Botas", "Botas", 0, 0, 1);
      expect(await gameItem.ownerOf(2)).to.equal(jugador.address);
      expect(await gameItem.totalMinted()).to.equal(2n);
    });

    it("un no-owner no puede mintear", async function () {
      const { gameItem, jugador } = await loadFixture(desplegar);
      await expect(
        gameItem.connect(jugador).mintItem(jugador.address, "Trampa", "Espada", 2, 25, 6)
      )
        .to.be.revertedWithCustomError(gameItem, "OwnableUnauthorizedAccount")
        .withArgs(jugador.address);
    });

    it("revierte si la rareza es mayor que 2", async function () {
      const { gameItem, jugador } = await loadFixture(desplegar);
      await expect(gameItem.mintItem(jugador.address, "Bug", "Espada", 3, 1, 1))
        .to.be.revertedWithCustomError(gameItem, "RarezaInvalida")
        .withArgs(3);
      expect(await gameItem.totalMinted()).to.equal(0n);
    });

    it("acepta las tres rarezas válidas (0, 1, 2)", async function () {
      const { gameItem, jugador } = await loadFixture(desplegar);
      for (const r of [0, 1, 2]) {
        await gameItem.mintItem(jugador.address, `Objeto ${r}`, "Escudo", r, 0, 5);
      }
      expect(await gameItem.totalMinted()).to.equal(3n);
    });
  });

  describe("getItem", function () {
    it("guarda y devuelve las estadísticas del objeto", async function () {
      const { gameItem, jugador } = await loadFixture(desplegar);
      await gameItem.mintItem(jugador.address, "Armadura del Dragón", "Armadura", 2, 5, 20);

      const item = await gameItem.getItem(1);
      expect(item.nombre).to.equal("Armadura del Dragón");
      expect(item.tipo).to.equal("Armadura");
      expect(item.rareza).to.equal(2n);
      expect(item.ataque).to.equal(5n);
      expect(item.defensa).to.equal(20n);
    });

    it("revierte para un token inexistente", async function () {
      const { gameItem } = await loadFixture(desplegar);
      await expect(gameItem.getItem(1))
        .to.be.revertedWithCustomError(gameItem, "ERC721NonexistentToken")
        .withArgs(1n);
      await expect(gameItem.getItem(0)).to.be.revertedWithCustomError(
        gameItem,
        "ERC721NonexistentToken"
      );
    });
  });

  describe("Transferencias", function () {
    it("el jugador puede transferir su objeto a otra cuenta", async function () {
      const { gameItem, jugador, otro } = await loadFixture(desplegar);
      await gameItem.mintItem(jugador.address, "Espada", "Espada", 0, 4, 1);

      await expect(
        gameItem
          .connect(jugador)
          ["safeTransferFrom(address,address,uint256)"](jugador.address, otro.address, 1)
      )
        .to.emit(gameItem, "Transfer")
        .withArgs(jugador.address, otro.address, 1n);

      expect(await gameItem.ownerOf(1)).to.equal(otro.address);
      expect(await gameItem.balanceOf(jugador.address)).to.equal(0n);
      expect(await gameItem.balanceOf(otro.address)).to.equal(1n);
      // Las estadísticas viajan con el token
      expect((await gameItem.getItem(1)).ataque).to.equal(4n);
    });

    it("un tercero no puede transferir un objeto ajeno", async function () {
      const { gameItem, jugador, otro } = await loadFixture(desplegar);
      await gameItem.mintItem(jugador.address, "Espada", "Espada", 0, 4, 1);
      await expect(
        gameItem.connect(otro).transferFrom(jugador.address, otro.address, 1)
      ).to.be.revertedWithCustomError(gameItem, "ERC721InsufficientApproval");
    });
  });

  describe("Enumerable", function () {
    it("lista los tokens de una wallet con tokenOfOwnerByIndex", async function () {
      const { gameItem, jugador, otro } = await loadFixture(desplegar);
      await gameItem.mintItem(jugador.address, "A", "Espada", 0, 3, 0); // 1
      await gameItem.mintItem(otro.address, "B", "Escudo", 0, 0, 3); // 2
      await gameItem.mintItem(jugador.address, "C", "Casco", 1, 1, 8); // 3

      expect(await gameItem.totalSupply()).to.equal(3n);
      expect(await gameItem.balanceOf(jugador.address)).to.equal(2n);
      expect(await gameItem.tokenOfOwnerByIndex(jugador.address, 0)).to.equal(1n);
      expect(await gameItem.tokenOfOwnerByIndex(jugador.address, 1)).to.equal(3n);
      expect(await gameItem.tokenOfOwnerByIndex(otro.address, 0)).to.equal(2n);

      // Tras transferir, el índice se actualiza
      await gameItem.connect(jugador).transferFrom(jugador.address, otro.address, 1);
      expect(await gameItem.balanceOf(jugador.address)).to.equal(1n);
      expect(await gameItem.tokenOfOwnerByIndex(jugador.address, 0)).to.equal(3n);
      expect(await gameItem.balanceOf(otro.address)).to.equal(2n);
    });

    it("soporta las interfaces ERC721 y ERC721Enumerable", async function () {
      const { gameItem } = await loadFixture(desplegar);
      expect(await gameItem.supportsInterface("0x80ac58cd")).to.equal(true); // ERC721
      expect(await gameItem.supportsInterface("0x780e9d63")).to.equal(true); // Enumerable
    });
  });
});
