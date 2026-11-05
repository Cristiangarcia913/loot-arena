// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title GameItem — objetos de equipo de Loot Arena como NFTs ERC-721
/// @notice Solo el owner (el servidor del juego) puede mintear objetos.
///         Los jugadores pueden transferirlos libremente.
contract GameItem is ERC721, ERC721Enumerable, Ownable {
    /// @dev Rareza: 0 = Común, 1 = Raro, 2 = Legendario.
    struct Item {
        string nombre;
        string tipo;
        uint8 rareza; // 0..2
        uint16 ataque;
        uint16 defensa;
    }

    event ItemMinted(
        address indexed to,
        uint256 indexed tokenId,
        string nombre,
        string tipo,
        uint8 rareza,
        uint16 ataque,
        uint16 defensa
    );

    /// @dev Se lanza cuando la rareza no está en 0..2.
    error RarezaInvalida(uint8 rareza);

    /// @dev Contador de objetos minteados; el siguiente tokenId es _totalMinted + 1.
    uint256 private _totalMinted;

    mapping(uint256 => Item) private _items;

    constructor() ERC721("Loot Arena Item", "LOOT") Ownable(msg.sender) {}

    /// @notice Mintea un objeto nuevo a `to`. Los tokenId empiezan en 1.
    function mintItem(
        address to,
        string calldata nombre,
        string calldata tipo,
        uint8 rareza,
        uint16 ataque,
        uint16 defensa
    ) external onlyOwner returns (uint256 tokenId) {
        if (rareza > 2) revert RarezaInvalida(rareza);

        tokenId = ++_totalMinted;
        _items[tokenId] = Item(nombre, tipo, rareza, ataque, defensa);
        _safeMint(to, tokenId);

        emit ItemMinted(to, tokenId, nombre, tipo, rareza, ataque, defensa);
    }

    /// @notice Devuelve las estadísticas de un objeto. Revierte si no existe.
    function getItem(uint256 tokenId) external view returns (Item memory) {
        _requireOwned(tokenId); // revierte con ERC721NonexistentToken
        return _items[tokenId];
    }

    /// @notice Número total de objetos minteados.
    function totalMinted() external view returns (uint256) {
        return _totalMinted;
    }

    // ---- Overrides requeridos por ERC721Enumerable (OpenZeppelin v5) ----

    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721, ERC721Enumerable)
        returns (address)
    {
        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(address account, uint128 value)
        internal
        override(ERC721, ERC721Enumerable)
    {
        super._increaseBalance(account, value);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721Enumerable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
