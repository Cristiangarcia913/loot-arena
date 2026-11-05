// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title LootGold — "Oro de Loot Arena" (ORO), moneda ERC-20 del juego
/// @notice 18 decimales. Solo el minter (el contrato Mercado, fijado por el owner)
///         puede acuñar y quemar ORO de un jugador en una compra. Cualquiera puede
///         quemar su propio ORO (`burn`) o el que le hayan aprobado (`burnFrom`).
contract LootGold is ERC20, ERC20Burnable, Ownable {
    /// @notice Única dirección autorizada a acuñar (el Mercado).
    address public minter;

    event MinterCambiado(address indexed anterior, address indexed nuevo);

    /// @dev La cuenta que llama no es el minter.
    error SoloMinter(address cuenta);

    constructor() ERC20("Oro de Loot Arena", "ORO") Ownable(msg.sender) {}

    modifier soloMinter() {
        if (msg.sender != minter) revert SoloMinter(msg.sender);
        _;
    }

    /// @notice Fija el minter (normalmente la dirección del Mercado).
    function setMinter(address nuevo) external onlyOwner {
        emit MinterCambiado(minter, nuevo);
        minter = nuevo;
    }

    /// @notice Acuña `cantidad` (unidades base, 18 decimales) a `to`.
    function mint(address to, uint256 cantidad) external soloMinter {
        _mint(to, cantidad);
    }

    /// @notice Quema ORO de `de` sin necesidad de `approve`. Solo el Mercado,
    ///         que únicamente la usa sobre `msg.sender` (quien compra), así el
    ///         jugador paga en una sola transacción.
    function quemarDe(address de, uint256 cantidad) external soloMinter {
        _burn(de, cantidad);
    }
}
