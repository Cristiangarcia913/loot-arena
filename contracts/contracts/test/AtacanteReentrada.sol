// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// SOLO PARA TESTS (contracts/test/economia.test.js). No se despliega.
// Intenta reentrar en el Mercado desde el callback onERC1155Received (al acuñarse
// un cosmético) o desde receive() (al cobrar el ETH de una venta).

interface IMercadoAtacado {
    function reclamarBienvenida() external;
    function comprarCosmetico(uint256 id, uint256 cantidad) external;
    function abrirCofre() external returns (uint256);
    function venderItem(uint256 tokenId) external returns (uint256, uint256);
}

interface IAprobable {
    function setApprovalForAll(address operador, bool aprobado) external;
}

contract AtacanteReentrada {
    IMercadoAtacado public immutable mercado;
    /// 0 = no reentrar, 1 = reentrar en comprarCosmetico, 2 = reentrar en abrirCofre,
    /// 3 = reentrar en venderItem desde receive() (propaga el error),
    /// 4 = igual que 3 pero capturando el error (try/catch) y anotándolo
    uint8 public modo;
    uint256 public tokenReentrada;
    bool public reentradaBloqueada;
    uint256 public vecesCobrado;

    constructor(address mercado_) {
        mercado = IMercadoAtacado(mercado_);
    }

    function setModo(uint8 m) external {
        modo = m;
    }

    function setTokenReentrada(uint256 t) external {
        tokenReentrada = t;
    }

    function aprobar(address gameItem) external {
        IAprobable(gameItem).setApprovalForAll(address(mercado), true);
    }

    function vender(uint256 tokenId) external {
        mercado.venderItem(tokenId);
    }

    receive() external payable {
        vecesCobrado++;
        if (modo == 3) {
            mercado.venderItem(tokenReentrada);
        } else if (modo == 4) {
            try mercado.venderItem(tokenReentrada) {} catch {
                reentradaBloqueada = true;
            }
        }
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    function reclamar() external {
        mercado.reclamarBienvenida();
    }

    function comprar(uint256 id, uint256 cantidad) external {
        mercado.comprarCosmetico(id, cantidad);
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external returns (bytes4) {
        if (modo == 1) mercado.comprarCosmetico(14, 1);
        else if (modo == 2) mercado.abrirCofre();
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return this.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4) external pure returns (bool) {
        return true;
    }
}
