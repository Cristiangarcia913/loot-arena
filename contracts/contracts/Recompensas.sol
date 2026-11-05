// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {LootGold} from "./LootGold.sol";

/// @dev Lo que Recompensas usa del Mercado para regalar el cofre del día 7.
interface IMercadoPremios {
    function acunarPremio(address jugador, uint256 id) external returns (uint256);
}

/// @title Recompensas — recompensa diaria con racha y premios del servidor (Loot Arena 1.2)
/// @notice
///  - `reclamarDiario()`: un reclamo por día UTC (`block.timestamp / 1 days`). La racha
///    sube si el reclamo anterior fue el día anterior; si no, vuelve a 1. El ORO sigue
///    un ciclo de 7 días: día 1 → 10, +5 por día … día 7 → 40 ORO, y el día 7 regala
///    además un cofre cosmético (acuñado por el Mercado con `acunarPremio`). Después
///    del día 7 el ciclo vuelve al día 1, pero `racha` sigue contando (8, 9, …) para
///    el ranking de "mayor racha".
///  - `recompensar(jugador, cantidad, motivo)`: solo el `operador` (la wallet del
///    servidor), con tope diario por jugador y tope global diario.
///  Necesita ser minter de LootGold y estar fijado como `recompensas` en el Mercado.
contract Recompensas is Ownable, ReentrancyGuard {
    LootGold public immutable oro;
    IMercadoPremios public immutable mercado;

    /// @notice Wallet del servidor autorizada a llamar a `recompensar`.
    address public operador;

    /// @notice ORO (unidades base) por día del ciclo; índice 0 = día 1 … índice 6 = día 7.
    uint256[7] public tablaDiaria = [uint256(10 ether), 15 ether, 20 ether, 25 ether, 30 ether, 35 ether, 40 ether];
    /// @notice Si el día 7 del ciclo regala un cosmético.
    bool public premioDia7Activo = true;
    /// @notice Cosmético del día 7: 0 = cofre aleatorio; otro valor = ese id del catálogo.
    uint256 public premioDia7Id = 0;

    /// @notice Tope de `recompensar` por jugador y día (unidades base).
    uint256 public topeJugadorDiario = 500 ether;
    /// @notice Tope de `recompensar` para todos los jugadores juntos por día.
    uint256 public topeGlobalDiario = 5000 ether;

    struct Diario {
        uint64 racha; // días consecutivos reclamados (0 = nunca)
        uint64 ultimoDia; // día UTC del último reclamo
    }

    mapping(address => Diario) private _diario;
    /// @notice ORO dado por `recompensar` a `jugador` el día `dia`.
    mapping(address => mapping(uint256 => uint256)) public recompensadoJugadorDia;
    /// @notice ORO dado por `recompensar` a todos el día `dia`.
    mapping(uint256 => uint256) public recompensadoGlobalDia;

    event DiarioReclamado(address indexed jugador, uint256 indexed dia, uint256 racha, uint256 oro, uint256 cosmeticoId);
    event Recompensado(address indexed jugador, uint256 cantidad, string motivo);
    event OperadorCambiado(address indexed anterior, address indexed nuevo);
    event TablaDiariaCambiada(uint256[7] tabla);
    event PremioDia7Cambiado(bool activo, uint256 id);
    event TopesCambiados(uint256 porJugador, uint256 global);

    error YaReclamadoHoy(uint256 segundosHastaSiguiente);
    error SoloOperador(address cuenta);
    error CantidadCero();
    error TopeJugadorSuperado(uint256 restante, uint256 pedido);
    error TopeGlobalSuperado(uint256 restante, uint256 pedido);

    constructor(address oro_, address mercado_, address operador_) Ownable(msg.sender) {
        oro = LootGold(oro_);
        mercado = IMercadoPremios(mercado_);
        operador = operador_;
        emit OperadorCambiado(address(0), operador_);
    }

    // ----------------------------------------------------------------- diario

    /// @notice Reclama la recompensa diaria. Devuelve la racha, el ORO y el cosmético (0 si no hay).
    function reclamarDiario() external nonReentrant returns (uint256 racha, uint256 pago, uint256 cosmeticoId) {
        uint256 hoy = _hoy();
        Diario storage d = _diario[msg.sender];
        if (d.racha > 0 && d.ultimoDia == hoy) revert YaReclamadoHoy(_segundosHastaManana());

        racha = (d.racha > 0 && d.ultimoDia + 1 == hoy) ? uint256(d.racha) + 1 : 1;
        d.racha = uint64(racha);
        d.ultimoDia = uint64(hoy);

        uint256 diaCiclo = _diaCiclo(racha);
        pago = tablaDiaria[diaCiclo - 1];
        if (pago > 0) oro.mint(msg.sender, pago);
        if (diaCiclo == 7 && premioDia7Activo) {
            cosmeticoId = mercado.acunarPremio(msg.sender, premioDia7Id);
        }
        emit DiarioReclamado(msg.sender, hoy, racha, pago, cosmeticoId);
    }

    /// @notice Estado de la recompensa diaria de `jugador`.
    /// @return racha racha vigente (0 si nunca reclamó o si ya se rompió)
    /// @return ultimoDia día UTC del último reclamo (`timestamp / 86400`; 0 si nunca)
    /// @return puedeReclamar si puede reclamar ahora
    /// @return segundosHastaSiguiente 0 si puede reclamar; si no, segundos hasta las 00:00 UTC
    /// @return proximaRecompensa ORO (unidades base) del próximo reclamo
    function estadoDiario(address jugador)
        external
        view
        returns (
            uint256 racha,
            uint256 ultimoDia,
            bool puedeReclamar,
            uint256 segundosHastaSiguiente,
            uint256 proximaRecompensa
        )
    {
        uint256 hoy = _hoy();
        Diario memory d = _diario[jugador];
        ultimoDia = d.ultimoDia;
        bool reclamoHoy = d.racha > 0 && d.ultimoDia == hoy;
        bool vigente = d.racha > 0 && (reclamoHoy || d.ultimoDia + 1 == hoy);
        racha = vigente ? d.racha : 0;
        puedeReclamar = !reclamoHoy;
        segundosHastaSiguiente = puedeReclamar ? 0 : _segundosHastaManana();
        proximaRecompensa = tablaDiaria[_diaCiclo(racha + 1) - 1];
    }

    /// @notice Día del ciclo (1..7) que tocará en el próximo reclamo de `jugador`;
    ///         7 significa que el próximo reclamo trae cofre.
    function proximoDiaCiclo(address jugador) external view returns (uint256) {
        uint256 hoy = _hoy();
        Diario memory d = _diario[jugador];
        bool reclamoHoy = d.racha > 0 && d.ultimoDia == hoy;
        bool vigente = d.racha > 0 && (reclamoHoy || d.ultimoDia + 1 == hoy);
        return _diaCiclo((vigente ? uint256(d.racha) : 0) + 1);
    }

    // --------------------------------------------------------------- operador

    /// @notice El servidor premia a `jugador` con `cantidad` ORO (unidades base).
    ///         Revierte si supera el tope del jugador o el global de hoy.
    function recompensar(address jugador, uint256 cantidad, string calldata motivo) external nonReentrant {
        if (msg.sender != operador) revert SoloOperador(msg.sender);
        if (cantidad == 0) revert CantidadCero();
        uint256 hoy = _hoy();
        uint256 restJ = _restante(topeJugadorDiario, recompensadoJugadorDia[jugador][hoy]);
        if (cantidad > restJ) revert TopeJugadorSuperado(restJ, cantidad);
        uint256 restG = _restante(topeGlobalDiario, recompensadoGlobalDia[hoy]);
        if (cantidad > restG) revert TopeGlobalSuperado(restG, cantidad);

        recompensadoJugadorDia[jugador][hoy] += cantidad;
        recompensadoGlobalDia[hoy] += cantidad;
        oro.mint(jugador, cantidad);
        emit Recompensado(jugador, cantidad, motivo);
    }

    /// @notice ORO que `recompensar` aún puede dar hoy a `jugador` (tope por jugador y global).
    function restanteHoy(address jugador) external view returns (uint256 jugadorRestante, uint256 globalRestante) {
        uint256 hoy = _hoy();
        jugadorRestante = _restante(topeJugadorDiario, recompensadoJugadorDia[jugador][hoy]);
        globalRestante = _restante(topeGlobalDiario, recompensadoGlobalDia[hoy]);
    }

    // ------------------------------------------------------------------ owner

    function setOperador(address nuevo) external onlyOwner {
        emit OperadorCambiado(operador, nuevo);
        operador = nuevo;
    }

    /// @notice Cambia el ORO (unidades base) de cada día del ciclo (índice 0 = día 1).
    function setTablaDiaria(uint256[7] calldata tabla) external onlyOwner {
        tablaDiaria = tabla;
        emit TablaDiariaCambiada(tabla);
    }

    /// @notice Activa/desactiva el premio del día 7 y elige el cosmético (0 = cofre aleatorio).
    function setPremioDia7(bool activo, uint256 id) external onlyOwner {
        premioDia7Activo = activo;
        premioDia7Id = id;
        emit PremioDia7Cambiado(activo, id);
    }

    function setTopes(uint256 porJugador, uint256 global) external onlyOwner {
        topeJugadorDiario = porJugador;
        topeGlobalDiario = global;
        emit TopesCambiados(porJugador, global);
    }

    // --------------------------------------------------------------- internas

    function _hoy() private view returns (uint256) {
        return block.timestamp / 1 days;
    }

    function _segundosHastaManana() private view returns (uint256) {
        return 1 days - (block.timestamp % 1 days);
    }

    function _diaCiclo(uint256 racha) private pure returns (uint256) {
        return ((racha - 1) % 7) + 1;
    }

    function _restante(uint256 tope, uint256 usado) private pure returns (uint256) {
        return usado >= tope ? 0 : tope - usado;
    }
}
