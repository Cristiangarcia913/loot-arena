// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

// SOLO PARA TESTS (contracts/test/mercado-p2p.test.js). No se despliega.
//
// Un ORO falso, con la misma interfaz que LootGold, que **reentra en el MercadoP2P**
// desde `transferFrom` (es decir, justo en medio de `comprar`, cuando el mercado paga
// al vendedor). Sirve para comprobar que `ReentrancyGuard` corta el ataque aunque el
// token ERC-20 sea hostil: el escenario más pesimista, porque el LootGold real no
// tiene ningún callback.
interface IMercadoP2PAtacado {
    function comprar(uint256 tokenId) external returns (uint256, uint256);
    function cancelar(uint256 tokenId) external;
    function listar(uint256 tokenId, uint256 precioOro) external;
}

contract OroReentrante is ERC20, ERC20Burnable {
    IMercadoP2PAtacado public mercado;

    /// 0 = no reentrar; 1 = reentrar en `comprar(tokenReentrada)` capturando el error;
    /// 2 = reentrar en `cancelar(tokenReentrada)` capturando el error;
    /// 3 = reentrar en `comprar(tokenReentrada)` **propagando** el error (toda la tx cae).
    uint8 public modo;
    uint256 public tokenReentrada;
    /// @notice Queda a true si la reentrada fue rechazada (modos 1 y 2, con try/catch).
    bool public reentradaBloqueada;
    uint256 public vecesReentrado;

    constructor() ERC20("Oro falso", "FAKE") {}

    function setMercado(address m) external {
        mercado = IMercadoP2PAtacado(m);
    }

    function setModo(uint8 m, uint256 token) external {
        modo = m;
        tokenReentrada = token;
    }

    function acunar(address a, uint256 cantidad) external {
        _mint(a, cantidad);
    }

    function transferFrom(address de, address a, uint256 cantidad) public override returns (bool) {
        bool ok = super.transferFrom(de, a, cantidad);
        if (modo != 0) {
            vecesReentrado++;
            uint8 m = modo;
            modo = 0; // una sola reentrada, para que el error que se vea sea el del guard
            if (m == 1) {
                try mercado.comprar(tokenReentrada) {} catch {
                    reentradaBloqueada = true;
                }
            } else if (m == 2) {
                try mercado.cancelar(tokenReentrada) {} catch {
                    reentradaBloqueada = true;
                }
            } else if (m == 3) {
                mercado.comprar(tokenReentrada); // propaga el error
            }
        }
        return ok;
    }
}
