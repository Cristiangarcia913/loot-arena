// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title LootGold v2 — "Oro de Loot Arena" (ORO), moneda ERC-20 del juego
/// @notice 18 decimales. Admite VARIOS minters (Mercado y Recompensas), que activa o
///         desactiva el owner con `setMinter(cuenta, activo)`. Solo un minter puede
///         acuñar y quemar ORO de un jugador en una compra (`quemarDe`). Cualquiera
///         puede quemar su propio ORO (`burn`) o el que le hayan aprobado (`burnFrom`).
contract LootGold is ERC20, ERC20Burnable, Ownable {
    /// @notice Cuentas autorizadas a acuñar (Mercado, Recompensas).
    mapping(address => bool) public esMinter;

    event MinterCambiado(address indexed cuenta, bool activo);

    /// @dev La cuenta que llama no es minter.
    error SoloMinter(address cuenta);

    constructor() ERC20("Oro de Loot Arena", "ORO") Ownable(msg.sender) {}

    modifier soloMinter() {
        if (!esMinter[msg.sender]) revert SoloMinter(msg.sender);
        _;
    }

    /// @notice Activa (`true`) o retira (`false`) el permiso de acuñar a `cuenta`.
    function setMinter(address cuenta, bool activo) external onlyOwner {
        esMinter[cuenta] = activo;
        emit MinterCambiado(cuenta, activo);
    }

    /// @notice Acuña `cantidad` (unidades base, 18 decimales) a `to`.
    function mint(address to, uint256 cantidad) external soloMinter {
        _mint(to, cantidad);
    }

    /// @notice Quema ORO de `de` sin necesidad de `approve`. Solo minters; el Mercado
    ///         únicamente la usa sobre `msg.sender` (quien compra), así el jugador paga
    ///         en una sola transacción. Recompensas no la usa.
    function quemarDe(address de, uint256 cantidad) external soloMinter {
        _burn(de, cantidad);
    }
}
