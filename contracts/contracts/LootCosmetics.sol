// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ERC1155Burnable} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Burnable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title LootCosmetics — cosméticos de Loot Arena como tokens ERC-1155
/// @notice Los ids son los del catálogo del Mercado. Solo el minter (el Mercado)
///         puede acuñar. Los jugadores pueden transferirlos y quemar los suyos
///         (`burn` / `burnBatch`, p. ej. para gastar la poción extra, id 14).
contract LootCosmetics is ERC1155, ERC1155Burnable, Ownable {
    using Strings for uint256;

    string public constant name = "Cosmeticos de Loot Arena";
    string public constant symbol = "LOOTC";

    /// @notice Única dirección autorizada a acuñar (el Mercado).
    address public minter;
    /// @notice Prefijo de los metadatos: uri(id) = baseURI + id + ".json".
    string public baseURI;

    event MinterCambiado(address indexed anterior, address indexed nuevo);

    error SoloMinter(address cuenta);

    constructor(string memory baseURI_) ERC1155("") Ownable(msg.sender) {
        baseURI = baseURI_;
    }

    /// @notice Fija el minter (normalmente la dirección del Mercado).
    function setMinter(address nuevo) external onlyOwner {
        emit MinterCambiado(minter, nuevo);
        minter = nuevo;
    }

    /// @notice Cambia el prefijo de los metadatos.
    function setBaseURI(string calldata nuevo) external onlyOwner {
        baseURI = nuevo;
    }

    /// @notice Acuña `cantidad` unidades del cosmético `id` a `to`.
    function mint(address to, uint256 id, uint256 cantidad) external {
        if (msg.sender != minter) revert SoloMinter(msg.sender);
        _mint(to, id, cantidad, "");
    }

    /// @notice URL del JSON de metadatos, p. ej. `.../meta/cosmeticos/7.json`.
    function uri(uint256 id) public view override returns (string memory) {
        return string.concat(baseURI, id.toString(), ".json");
    }
}
