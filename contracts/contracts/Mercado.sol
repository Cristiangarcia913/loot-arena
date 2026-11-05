// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {LootGold} from "./LootGold.sol";
import {LootCosmetics} from "./LootCosmetics.sol";

/// @dev Lo mínimo que el Mercado necesita de GameItem (ya desplegado; no se cambia).
interface IGameItem {
    struct Item {
        string nombre;
        string tipo;
        uint8 rareza;
        uint16 ataque;
        uint16 defensa;
    }

    function getItem(uint256 tokenId) external view returns (Item memory);
    function ownerOf(uint256 tokenId) external view returns (address);
    function transferFrom(address from, address to, uint256 tokenId) external;
}

/// @title Mercado — vende objetos de Loot Arena por ORO y gasta ORO en cosméticos
/// @notice
///  - Vender: el jugador (dueño del NFT y con `setApprovalForAll(mercado, true)` en
///    GameItem) entrega el objeto, que se envía a `0x…dEaD`, y recibe ORO según sus
///    stats on-chain: `precio = base[rareza] + 2 × (ataque + defensa)` ORO,
///    con `base = [10, 40, 200]`.
///  - Además, al vender se paga un poco de ETH de la "caja" del Mercado
///    (`recompensaEth[rareza]`, por defecto 0.0001 / 0.0005 / 0.002 ETH), con un
///    máximo de `maxEthDiario` por dirección y día (`block.timestamp / 1 days`).
///    La recompensa se recorta a lo que quede del límite diario; si la caja no
///    tiene saldo para pagarla, se paga 0 ETH y la venta sigue (solo ORO).
///  - Comprar: quema ORO del jugador (sin `approve`) y acuña el cosmético ERC-1155.
///  - Cofre: quema `PRECIO_COFRE` ORO y acuña un cosmético al azar (común 60 %,
///    rara 32 %, legendaria 8 %; nunca consumibles).
///
///  Todas las cantidades de ORO están en unidades base (18 decimales):
///  `precioVenta` devuelve p. ej. `54e18` para 54 ORO.
///
///  - Premios (1.2): el contrato `Recompensas` (fijado por el owner con
///    `setRecompensas`) puede pedir al Mercado `acunarPremio(jugador, id)` para
///    regalar un cosmético (id concreto) o un cofre gratis (id = 0, misma tirada
///    que `abrirCofre` pero sin cobrar ORO). Así LootCosmetics no se redespliega
///    y sigue teniendo un único minter: el Mercado.
///
///  AVISO sobre el azar del cofre: se usa `block.prevrandao` + nonce + remitente.
///  Es predecible/manipulable por validadores y por contratos que simulen antes de
///  llamar; aceptable en testnet (Sepolia) para un juego sin valor real, NO en mainnet
///  (habría que usar Chainlink VRF o commit-reveal).
contract Mercado is Ownable, ReentrancyGuard {
    /// @dev 0 = común, 1 = rara, 2 = legendaria.
    struct Cosmetico {
        string nombre;
        string ranura; // color | sombrero | capa | aura | mascota | consumible
        uint8 rareza;
        uint256 precio; // ORO en unidades base; 0 = no está a la venta
        bool enCofre; // puede salir en el cofre (los consumibles no)
    }

    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 public constant BIENVENIDA = 50 ether; // 50 ORO

    IGameItem public immutable gameItem;
    LootGold public immutable oro;
    LootCosmetics public immutable cosmeticos;

    /// @notice Base del precio de venta por rareza (unidades base de ORO).
    uint256[3] public basesVenta = [uint256(10 ether), 40 ether, 200 ether];
    /// @notice ORO por cada punto de ataque + defensa (unidades base).
    uint256 public oroPorPunto = 2 ether;
    /// @notice Precio del cofre cosmético (unidades base). Ajustable por el owner.
    uint256 public PRECIO_COFRE = 120 ether;
    /// @notice Probabilidades del cofre en % por rareza (común, rara, legendaria).
    uint8[3] public probCofre = [60, 32, 8];

    /// @notice ETH (wei) que se paga por vender un objeto de cada rareza.
    uint256[3] public recompensaEth = [uint256(0.0001 ether), 0.0005 ether, 0.002 ether];
    /// @notice Máximo de ETH (wei) que una dirección puede recibir por ventas en un día.
    uint256 public maxEthDiario = 0.005 ether;
    /// @notice ETH ya pagado a `jugador` el día `dia` (= block.timestamp / 1 days).
    mapping(address => mapping(uint256 => uint256)) public ethPagadoDia;

    /// @notice Contrato Recompensas autorizado a llamar a `acunarPremio` (0 = ninguno).
    address public recompensas;

    /// @notice Si una dirección ya reclamó el bono de bienvenida.
    mapping(address => bool) public bienvenidaReclamada;

    /// @dev Catálogo: el id del cosmético es índice + 1.
    Cosmetico[] private _catalogo;
    uint256 private _nonce;

    event ItemVendido(address indexed jugador, uint256 indexed tokenId, uint256 oro, uint256 eth);
    event CajaRecargada(address indexed de, uint256 cantidad);
    event EthRetirado(address indexed a, uint256 cantidad);
    event RecompensaEthCambiada(uint256[3] recompensa);
    event MaxEthDiarioCambiado(uint256 maximo);
    event CosmeticoComprado(address indexed jugador, uint256 indexed id, uint256 cantidad, uint256 oro);
    event CofreAbierto(address indexed jugador, uint256 indexed id);
    event BienvenidaReclamada(address indexed jugador, uint256 oro);
    event CosmeticoAnadido(uint256 indexed id, string nombre, string ranura, uint8 rareza, uint256 precio, bool enCofre);
    event PrecioCosmeticoCambiado(uint256 indexed id, uint256 precio);
    event EnCofreCambiado(uint256 indexed id, bool enCofre);
    event FormulaVentaCambiada(uint256[3] bases, uint256 oroPorPunto);
    event PrecioCofreCambiado(uint256 precio);
    event RecompensasCambiado(address indexed anterior, address indexed nuevo);
    /// @notice `cofre` = true si salió de una tirada de cofre gratis (id pedido = 0).
    event PremioAcunado(address indexed jugador, uint256 indexed id, bool cofre);

    error NoEresDueno(uint256 tokenId, address dueno);
    error ListaVacia();
    error CantidadCero();
    error CosmeticoInexistente(uint256 id);
    error NoALaVenta(uint256 id);
    error SaldoInsuficiente(uint256 tienes, uint256 necesitas);
    error YaReclamada();
    error RarezaInvalida(uint8 rareza);
    error CofreVacio();
    error SaldoEthInsuficiente(uint256 caja, uint256 pedido);
    error SoloRecompensas(address cuenta);

    constructor(address gameItem_, address oro_, address cosmeticos_) Ownable(msg.sender) {
        gameItem = IGameItem(gameItem_);
        oro = LootGold(oro_);
        cosmeticos = LootCosmetics(cosmeticos_);

        // Catálogo inicial (MEJORAS.md §5). Ids 1..14 en este orden.
        _agregar(unicode"Armadura carmesí", "color", 0, 60 ether, true);
        _agregar("Armadura esmeralda", "color", 0, 60 ether, true);
        _agregar("Armadura obsidiana", "color", 1, 150 ether, true);
        _agregar("Capucha del cazador", "sombrero", 0, 80 ether, true);
        _agregar("Yelmo con cuernos", "sombrero", 1, 180 ether, true);
        _agregar(unicode"Corona del campeón", "sombrero", 2, 600 ether, true);
        _agregar("Capa de viajero", "capa", 0, 90 ether, true);
        _agregar(unicode"Capa real púrpura", "capa", 1, 220 ether, true);
        _agregar(unicode"Alas de fénix", "capa", 2, 800 ether, true);
        _agregar("Aura de escarcha", "aura", 1, 250 ether, true);
        _agregar("Aura de llamas", "aura", 2, 700 ether, true);
        _agregar("Gato negro", "mascota", 1, 300 ether, true);
        _agregar(unicode"Mini dragón", "mascota", 2, 900 ether, true);
        _agregar(unicode"Poción extra", "consumible", 0, 25 ether, false);
    }

    // ------------------------------------------------------------------ vender

    /// @notice ORO (unidades base) que se recibe por vender `tokenId`.
    ///         Revierte si el objeto no existe.
    function precioVenta(uint256 tokenId) public view returns (uint256) {
        IGameItem.Item memory it = gameItem.getItem(tokenId);
        return basesVenta[it.rareza] + oroPorPunto * (uint256(it.ataque) + uint256(it.defensa));
    }

    /// @notice Vende un objeto propio. Requiere `GameItem.setApprovalForAll(mercado, true)`.
    /// @return pago ORO acuñado (unidades base)  @return eth ETH pagado (wei)
    function venderItem(uint256 tokenId) external nonReentrant returns (uint256 pago, uint256 eth) {
        (pago, eth) = _vender(tokenId, 0);
        _pagar(pago, eth);
    }

    /// @notice Vende varios objetos propios en una sola transacción.
    function venderVarios(uint256[] calldata tokenIds) external nonReentrant returns (uint256 pago, uint256 eth) {
        if (tokenIds.length == 0) revert ListaVacia();
        for (uint256 i = 0; i < tokenIds.length; i++) {
            (uint256 o, uint256 e) = _vender(tokenIds[i], eth);
            pago += o;
            eth += e;
        }
        _pagar(pago, eth);
    }

    /// @notice ETH (wei) que `jugador` recibiría hoy por vender un objeto de `rareza`
    ///         (recorta por límite diario y por saldo de la caja).
    function ethPorVenta(address jugador, uint8 rareza) public view returns (uint256) {
        return _ethPorVenta(jugador, rareza, 0);
    }

    /// @notice ETH (wei) que a `jugador` le queda por recibir hoy.
    function ethRestanteHoy(address jugador) public view returns (uint256) {
        uint256 pagado = ethPagadoDia[jugador][block.timestamp / 1 days];
        return pagado >= maxEthDiario ? 0 : maxEthDiario - pagado;
    }

    /// @notice Saldo de ETH de la caja del Mercado (wei).
    function cajaEth() external view returns (uint256) {
        return address(this).balance;
    }

    /// @dev `comprometido` = ETH ya reservado en esta misma tx (venderVarios).
    function _ethPorVenta(address jugador, uint8 rareza, uint256 comprometido) private view returns (uint256 eth) {
        eth = recompensaEth[rareza];
        uint256 restante = ethRestanteHoy(jugador);
        if (eth > restante) eth = restante;
        if (address(this).balance < comprometido + eth) eth = 0; // caja sin saldo: solo ORO
    }

    function _vender(uint256 tokenId, uint256 comprometido) private returns (uint256 pago, uint256 eth) {
        address dueno = gameItem.ownerOf(tokenId);
        if (dueno != msg.sender) revert NoEresDueno(tokenId, dueno);
        IGameItem.Item memory it = gameItem.getItem(tokenId);
        pago = basesVenta[it.rareza] + oroPorPunto * (uint256(it.ataque) + uint256(it.defensa));
        eth = _ethPorVenta(msg.sender, it.rareza, comprometido);
        if (eth > 0) ethPagadoDia[msg.sender][block.timestamp / 1 days] += eth; // efecto antes de pagar
        // Revierte con ERC721InsufficientApproval si el jugador no aprobó al Mercado.
        gameItem.transferFrom(msg.sender, DEAD, tokenId);
        emit ItemVendido(msg.sender, tokenId, pago, eth);
    }

    /// @dev Interacciones al final (checks-effects-interactions). Si el receptor
    ///      rechaza el ETH, la venta entera revierte con su motivo.
    function _pagar(uint256 pago, uint256 eth) private {
        oro.mint(msg.sender, pago);
        if (eth > 0) _enviarEth(msg.sender, eth);
    }

    function _enviarEth(address a, uint256 cantidad) private {
        (bool ok, bytes memory motivo) = payable(a).call{value: cantidad}("");
        if (!ok) {
            assembly {
                revert(add(motivo, 32), mload(motivo))
            }
        }
    }

    // ------------------------------------------------------------------- caja

    /// @notice Cualquiera puede recargar la caja enviando ETH al Mercado.
    receive() external payable {
        emit CajaRecargada(msg.sender, msg.value);
    }

    /// @notice El owner retira `cantidad` wei de la caja a su cuenta.
    function retirarEth(uint256 cantidad) external onlyOwner nonReentrant {
        uint256 caja = address(this).balance;
        if (cantidad > caja) revert SaldoEthInsuficiente(caja, cantidad);
        emit EthRetirado(msg.sender, cantidad);
        _enviarEth(msg.sender, cantidad);
    }

    /// @notice Cambia el ETH (wei) pagado por venta según rareza.
    function setRecompensaEth(uint256[3] calldata recompensa) external onlyOwner {
        recompensaEth = recompensa;
        emit RecompensaEthCambiada(recompensa);
    }

    /// @notice Cambia el máximo de ETH (wei) por dirección y día.
    function setMaxEthDiario(uint256 maximo) external onlyOwner {
        maxEthDiario = maximo;
        emit MaxEthDiarioCambiado(maximo);
    }

    // ----------------------------------------------------------------- comprar

    /// @notice Compra `cantidad` unidades del cosmético `id` quemando su precio en ORO.
    function comprarCosmetico(uint256 id, uint256 cantidad) external nonReentrant {
        if (cantidad == 0) revert CantidadCero();
        Cosmetico storage c = _cosmetico(id);
        if (c.precio == 0) revert NoALaVenta(id);
        uint256 total = c.precio * cantidad;
        _cobrar(total);
        cosmeticos.mint(msg.sender, id, cantidad);
        emit CosmeticoComprado(msg.sender, id, cantidad, total);
    }

    /// @notice Abre un cofre cosmético: quema `PRECIO_COFRE` ORO y acuña un cosmético
    ///         al azar ponderado por rareza. Ver el aviso sobre el azar arriba.
    function abrirCofre() external nonReentrant returns (uint256 id) {
        _cobrar(PRECIO_COFRE);
        id = _tirarCofre(msg.sender);
        cosmeticos.mint(msg.sender, id, 1);
        emit CofreAbierto(msg.sender, id);
    }

    /// @notice Regala a `jugador` el cosmético `id`, o un cofre gratis si `id == 0`.
    ///         Solo lo puede llamar el contrato `recompensas`. Devuelve el id acuñado.
    function acunarPremio(address jugador, uint256 id) external nonReentrant returns (uint256) {
        if (msg.sender != recompensas || recompensas == address(0)) revert SoloRecompensas(msg.sender);
        bool cofre = id == 0;
        if (cofre) id = _tirarCofre(jugador);
        else _cosmetico(id); // revierte si no existe
        cosmeticos.mint(jugador, id, 1);
        emit PremioAcunado(jugador, id, cofre);
        return id;
    }

    /// @dev Tirada ponderada por rareza (ver aviso sobre el azar arriba).
    function _tirarCofre(address jugador) private returns (uint256) {
        uint256 r = uint256(keccak256(abi.encode(block.prevrandao, block.timestamp, jugador, _nonce++)));
        uint256 tirada = r % 100;
        uint8 rareza = tirada < probCofre[0] ? 0 : (tirada < uint256(probCofre[0]) + probCofre[1] ? 1 : 2);
        return _elegir(rareza, r >> 128);
    }

    /// @dev Elige uniformemente entre los cosméticos de esa rareza que pueden salir
    ///      en el cofre; si no hay ninguno de esa rareza, entre todos los elegibles.
    function _elegir(uint8 rareza, uint256 azar) private view returns (uint256) {
        uint256 n = _catalogo.length;
        uint256 deRareza;
        uint256 elegibles;
        for (uint256 i = 0; i < n; i++) {
            if (!_catalogo[i].enCofre) continue;
            elegibles++;
            if (_catalogo[i].rareza == rareza) deRareza++;
        }
        if (elegibles == 0) revert CofreVacio();
        bool filtrar = deRareza > 0;
        uint256 objetivo = azar % (filtrar ? deRareza : elegibles);
        for (uint256 i = 0; i < n; i++) {
            Cosmetico storage c = _catalogo[i];
            if (!c.enCofre || (filtrar && c.rareza != rareza)) continue;
            if (objetivo == 0) return i + 1;
            objetivo--;
        }
        revert CofreVacio(); // inalcanzable
    }

    function _cobrar(uint256 total) private {
        uint256 saldo = oro.balanceOf(msg.sender);
        if (saldo < total) revert SaldoInsuficiente(saldo, total);
        oro.quemarDe(msg.sender, total);
    }

    // -------------------------------------------------------------- bienvenida

    /// @notice Da 50 ORO de regalo, una sola vez por dirección.
    function reclamarBienvenida() external nonReentrant {
        if (bienvenidaReclamada[msg.sender]) revert YaReclamada();
        bienvenidaReclamada[msg.sender] = true;
        oro.mint(msg.sender, BIENVENIDA);
        emit BienvenidaReclamada(msg.sender, BIENVENIDA);
    }

    // ------------------------------------------------------------------- vistas

    /// @notice Catálogo completo; el elemento i es el cosmético con id i + 1.
    function catalogo() external view returns (Cosmetico[] memory) {
        return _catalogo;
    }

    /// @notice Un cosmético del catálogo. Revierte si el id no existe.
    function cosmetico(uint256 id) external view returns (Cosmetico memory) {
        return _cosmetico(id);
    }

    /// @notice Número de cosméticos del catálogo (el último id).
    function totalCosmeticos() external view returns (uint256) {
        return _catalogo.length;
    }

    // -------------------------------------------------------------------- owner

    /// @notice Añade un cosmético al catálogo y devuelve su id.
    function agregarCosmetico(
        string calldata nombre,
        string calldata ranura,
        uint8 rareza,
        uint256 precio,
        bool enCofre
    ) external onlyOwner returns (uint256) {
        return _agregar(nombre, ranura, rareza, precio, enCofre);
    }

    /// @notice Cambia el precio de un cosmético (0 = retirarlo de la venta directa).
    function setPrecioCosmetico(uint256 id, uint256 precio) external onlyOwner {
        _cosmetico(id).precio = precio;
        emit PrecioCosmeticoCambiado(id, precio);
    }

    /// @notice Indica si un cosmético puede salir en el cofre.
    function setEnCofre(uint256 id, bool enCofre) external onlyOwner {
        _cosmetico(id).enCofre = enCofre;
        emit EnCofreCambiado(id, enCofre);
    }

    /// @notice Cambia la fórmula de venta: `bases[rareza] + porPunto × (ataque + defensa)`.
    function setFormulaVenta(uint256[3] calldata bases, uint256 porPunto) external onlyOwner {
        basesVenta = bases;
        oroPorPunto = porPunto;
        emit FormulaVentaCambiada(bases, porPunto);
    }

    /// @notice Fija el contrato Recompensas que puede llamar a `acunarPremio`.
    function setRecompensas(address nuevo) external onlyOwner {
        emit RecompensasCambiado(recompensas, nuevo);
        recompensas = nuevo;
    }

    /// @notice Cambia el precio del cofre.
    function setPrecioCofre(uint256 precio) external onlyOwner {
        PRECIO_COFRE = precio;
        emit PrecioCofreCambiado(precio);
    }

    // ----------------------------------------------------------------- internas

    function _agregar(
        string memory nombre,
        string memory ranura,
        uint8 rareza,
        uint256 precio,
        bool enCofre
    ) private returns (uint256 id) {
        if (rareza > 2) revert RarezaInvalida(rareza);
        _catalogo.push(Cosmetico(nombre, ranura, rareza, precio, enCofre));
        id = _catalogo.length;
        emit CosmeticoAnadido(id, nombre, ranura, rareza, precio, enCofre);
    }

    function _cosmetico(uint256 id) private view returns (Cosmetico storage) {
        if (id == 0 || id > _catalogo.length) revert CosmeticoInexistente(id);
        return _catalogo[id - 1];
    }
}
