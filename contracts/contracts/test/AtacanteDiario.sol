// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// SOLO PARA TESTS (contracts/test/recompensas.test.js). No se despliega.
// Reclama el diario y, al recibir el cosmético del día 7 (onERC1155Received),
// intenta reclamar otra vez.

interface IRecompensasAtacadas {
    function reclamarDiario() external returns (uint256, uint256, uint256);
}

contract AtacanteDiario {
    IRecompensasAtacadas public immutable recompensas;
    bool public reentrar;

    constructor(address recompensas_) {
        recompensas = IRecompensasAtacadas(recompensas_);
    }

    function setReentrar(bool r) external {
        reentrar = r;
    }

    function reclamar() external {
        recompensas.reclamarDiario();
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external returns (bytes4) {
        if (reentrar) recompensas.reclamarDiario();
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
