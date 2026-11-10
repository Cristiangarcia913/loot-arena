// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {LootGold} from "./LootGold.sol";

/// @dev Lo mínimo que el MercadoP2P necesita de GameItem (ya desplegado; no se cambia).
interface IGameItemP2P {
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

/// @title MercadoP2P — mercado entre jugadores de Loot Arena (NFT por ORO)
/// @notice Aquí **el precio lo pone el jugador**, no el contrato. Es la diferencia con
///         `Mercado.sol`, que es una tienda: compra al jugador a precio fijo calculado
///         con los stats del objeto. Este contrato solo casa a dos jugadores y cobra
///         una comisión que se **quema** (el ORO sale de circulación).
///
///  Flujo de una venta:
///   1. El vendedor aprueba el NFT: `GameItem.setApprovalForAll(mercadoP2P, true)`
///      (o `approve(mercadoP2P, tokenId)` para uno solo).
///   2. `listar(tokenId, precioOro)` → el NFT pasa a **custodia del contrato** (escrow).
///      Así nadie puede vender dos veces lo mismo ni retirar la aprobación a traición:
///      cuando el comprador paga, el objeto ya está aquí.
///   3. El comprador aprueba el ORO: `LootGold.approve(mercadoP2P, precio)`.
///   4. `comprar(tokenId)` → en una sola transacción: `precio - comisión` ORO al
///      vendedor, `comisión` ORO quemado y el NFT al comprador.
///
///  El vendedor puede `cambiarPrecio` o `cancelar` mientras no se haya vendido.
///
///  Todas las cantidades de ORO van en unidades base (18 decimales): 25 ORO = `25e18`.
///
///  Comisión: `comisionBps` puntos básicos (500 = 5 %), ajustable por el owner con
///  tope de `COMISION_MAXIMA` = 1000 (10 %). Se quema con `LootGold.burnFrom`, que
///  gasta la aprobación del comprador: el contrato **nunca llega a tener ORO**.
///
///  Pausa de emergencia: el owner puede `pausar()`. Entonces no se puede listar,
///  cambiar precio ni comprar; el vendedor recupera su NFT con `rescatar(tokenId)`.
///
///  Permisos que NO necesita (a propósito): no es minter de LootGold (no puede acuñar
///  ORO) y no es owner de GameItem (no puede mintear objetos). Lo único que puede
///  mover son los NFT que un vendedor le ha entregado para venderlos.
///
///  Datos de mercado: además de los eventos, el contrato lleva contadores agregados
///  (`totalMercado`, `estadisticaRareza`, `oroQuemado`) para que la interfaz pueda
///  pintar precio medio y volumen con una sola llamada, sin indexador.
contract MercadoP2P is Ownable, Pausable, ReentrancyGuard {
    /// @notice Oferta guardada. `vendedor == address(0)` significa "no listado".
    /// @dev Caben vendedor + rareza + creado en una sola ranura (20 + 1 + 8 bytes).
    struct Oferta {
        address vendedor;
        uint8 rareza; // copiada de GameItem al listar (los stats no cambian nunca)
        uint64 creado; // block.timestamp del listado o del último cambio de precio
        uint256 precio; // ORO en unidades base; siempre > 0 si está listada
    }

    /// @dev Cómo se guarda una oferta: **2 ranuras** de almacenamiento, no 4.
    ///      Ranura 1: vendedor (20 bytes) + rareza (1) + creado (8) = 29 bytes.
    ///      Ranura 2: precio (16, cabe por `PRECIO_MAXIMO`) + las dos posiciones en los
    ///      índices (4 + 4) = 24 bytes. Meter las posiciones aquí ahorra dos escrituras
    ///      de almacenamiento por listado (unas 40 000 de gas) frente a tenerlas en
    ///      mappings aparte. `pos`/`posVendedor` son la posición + 1 (0 = no está).
    struct OfertaAlmacen {
        address vendedor;
        uint8 rareza;
        uint64 creado;
        uint128 precio;
        uint32 pos;
        uint32 posVendedor;
    }

    /// @notice Oferta con el tokenId dentro, para las vistas de la interfaz.
    struct OfertaVista {
        uint256 tokenId;
        address vendedor;
        uint8 rareza;
        uint64 creado;
        uint256 precio;
    }

    /// @notice Agregados de mercado. Cabe en una ranura (16 + 12 + 4 bytes).
    struct Estadistica {
        uint128 volumen; // ORO bruto (precio, comisión incluida) acumulado
        uint96 ventas; // número de ventas cerradas
        uint32 ultimoDia; // día UTC de la última venta (block.timestamp / 1 days)
    }

    /// @notice Tope de la comisión en puntos básicos (10 % = 1000 bps).
    uint256 public constant COMISION_MAXIMA = 1000;
    /// @notice Precio máximo por oferta: 1e12 ORO. Sobra de lejos (el ORO en circulación
    ///         son unos miles) y garantiza que el volumen acumulado quepa en `uint128`,
    ///         así el agregado nunca se trunca ni desborda.
    uint256 public constant PRECIO_MAXIMO = 1e12 ether;
    /// @dev 100 % en puntos básicos.
    uint256 private constant BPS = 10_000;

    IGameItemP2P public immutable gameItem;
    LootGold public immutable oro;

    /// @notice Comisión del juego en puntos básicos (500 = 5 %). Se quema.
    uint256 public comisionBps = 500;

    /// @notice ORO total quemado en comisiones (unidades base).
    uint256 public oroQuemado;
    /// @notice Agregados de todas las ventas.
    Estadistica public totalMercado;
    /// @notice Agregados por rareza (0 común, 1 raro, 2 legendario).
    Estadistica[3] public estadisticaRareza;

    /// @dev tokenId → oferta guardada (2 ranuras, contadas arriba).
    mapping(uint256 => OfertaAlmacen) private _ofertas;
    /// @dev Todos los tokenId listados. Sin orden garantizado (se compacta al quitar).
    uint256[] private _ids;
    /// @dev vendedor → sus tokenId listados.
    mapping(address => uint256[]) private _deVendedor;

    /// @notice Un objeto se pone a la venta.
    event Listado(uint256 indexed tokenId, address indexed vendedor, uint8 indexed rareza, uint256 precio);
    /// @notice Venta cerrada. `comision` ya está incluida en `precio` (el vendedor cobra `precio - comision`).
    event Vendido(
        uint256 indexed tokenId,
        address indexed vendedor,
        address indexed comprador,
        uint256 precio,
        uint256 comision,
        uint8 rareza
    );
    /// @notice El vendedor retira su oferta y recupera el NFT.
    event Cancelado(uint256 indexed tokenId, address indexed vendedor);
    /// @notice El vendedor cambia el precio de una oferta viva.
    event PrecioCambiado(uint256 indexed tokenId, address indexed vendedor, uint256 anterior, uint256 nuevo);
    /// @notice El vendedor recupera su NFT con el mercado pausado.
    event Rescatado(uint256 indexed tokenId, address indexed vendedor);
    event ComisionCambiada(uint256 anterior, uint256 nueva);
    /// @notice El owner devuelve un NFT que alguien envió al contrato sin listarlo.
    event NftPerdidoDevuelto(uint256 indexed tokenId, address indexed a);

    /// @dev No eres el dueño del objeto que intentas listar.
    error NoEresDueno(uint256 tokenId, address dueno);
    /// @dev No eres el vendedor de esa oferta.
    error NoEresVendedor(uint256 tokenId, address vendedor);
    /// @dev Un precio de 0 ORO no es una venta: se usaría para regalar sin control.
    error PrecioCero();
    /// @dev El precio pedido supera `PRECIO_MAXIMO`.
    error PrecioExcesivo(uint256 precio, uint256 maximo);
    /// @dev Ese objeto ya está a la venta.
    error YaListado(uint256 tokenId);
    /// @dev Ese objeto no está a la venta (nunca lo estuvo, o ya se vendió o se canceló).
    error NoListado(uint256 tokenId);
    /// @dev No puedes comprarte a ti mismo (falsearía el volumen y el precio medio).
    error CompradorEsVendedor(uint256 tokenId);
    /// @dev El precio subió por encima del tope que puso el comprador en `comprarHasta`.
    error PrecioSubio(uint256 precio, uint256 maximo);
    /// @dev El comprador no tiene bastante ORO.
    error OroInsuficiente(uint256 tienes, uint256 necesitas);
    /// @dev El comprador no ha aprobado bastante ORO al mercado.
    error SinAprobacionOro(uint256 aprobado, uint256 necesitas);
    /// @dev La comisión pedida supera `COMISION_MAXIMA`.
    error ComisionExcesiva(uint256 bps, uint256 maximo);
    /// @dev Ese NFT sí está listado: se retira con `cancelar` o `rescatar`, no con `devolverNftPerdido`.
    error EstaListado(uint256 tokenId);
    /// @dev El contrato no tiene ese NFT.
    error NoEsNuestro(uint256 tokenId, address dueno);
    /// @dev El precio nuevo es el que ya tenía.
    error MismoPrecio(uint256 precio);

    constructor(address gameItem_, address oro_) Ownable(msg.sender) {
        gameItem = IGameItemP2P(gameItem_);
        oro = LootGold(oro_);
    }

    // ------------------------------------------------------------------- vender

    /// @notice Pone `tokenId` a la venta por `precioOro` (unidades base) y entrega el
    ///         NFT en custodia al contrato. Requiere aprobación previa en GameItem
    ///         (`setApprovalForAll(mercadoP2P, true)` o `approve(mercadoP2P, tokenId)`);
    ///         si no, revierte con `ERC721InsufficientApproval`.
    function listar(uint256 tokenId, uint256 precioOro) external nonReentrant whenNotPaused {
        _validarPrecio(precioOro);
        if (_ofertas[tokenId].vendedor != address(0)) revert YaListado(tokenId);
        address dueno = gameItem.ownerOf(tokenId);
        if (dueno != msg.sender) revert NoEresDueno(tokenId, dueno);

        uint8 rareza = gameItem.getItem(tokenId).rareza;
        _ids.push(tokenId);
        _deVendedor[msg.sender].push(tokenId);
        _ofertas[tokenId] = OfertaAlmacen({
            vendedor: msg.sender,
            rareza: rareza,
            creado: uint64(block.timestamp),
            precio: uint128(precioOro), // cabe: `_validarPrecio` tope en PRECIO_MAXIMO
            pos: uint32(_ids.length),
            posVendedor: uint32(_deVendedor[msg.sender].length)
        });

        emit Listado(tokenId, msg.sender, rareza, precioOro);
        // Interacción al final (checks-effects-interactions).
        gameItem.transferFrom(msg.sender, address(this), tokenId);
    }

    /// @notice Cambia el precio de una oferta propia. Solo el vendedor.
    function cambiarPrecio(uint256 tokenId, uint256 nuevo) external whenNotPaused {
        _validarPrecio(nuevo);
        OfertaAlmacen storage o = _vigente(tokenId);
        if (o.vendedor != msg.sender) revert NoEresVendedor(tokenId, o.vendedor);
        uint256 anterior = o.precio;
        if (nuevo == anterior) revert MismoPrecio(nuevo);
        o.precio = uint128(nuevo);
        o.creado = uint64(block.timestamp);
        emit PrecioCambiado(tokenId, msg.sender, anterior, nuevo);
    }

    /// @notice Retira una oferta propia y recupera el NFT. Solo el vendedor.
    ///         Con el mercado pausado se usa `rescatar`.
    function cancelar(uint256 tokenId) external nonReentrant whenNotPaused {
        address vendedor = _retirarPropia(tokenId);
        emit Cancelado(tokenId, vendedor);
        gameItem.transferFrom(address(this), vendedor, tokenId);
    }

    /// @notice Con el mercado **pausado**, el vendedor recupera su NFT. Es la salida de
    ///         emergencia: la pausa nunca deja un objeto atrapado en el contrato.
    function rescatar(uint256 tokenId) external nonReentrant whenPaused {
        address vendedor = _retirarPropia(tokenId);
        emit Rescatado(tokenId, vendedor);
        gameItem.transferFrom(address(this), vendedor, tokenId);
    }

    // ------------------------------------------------------------------ comprar

    /// @notice Compra `tokenId` al precio publicado. El comprador paga en ORO:
    ///         `precio - comision` al vendedor y `comision` quemada. Requiere
    ///         `LootGold.approve(mercadoP2P, precio)`.
    /// @return precio ORO pagado  @return comision ORO quemado
    function comprar(uint256 tokenId) external nonReentrant whenNotPaused returns (uint256 precio, uint256 comision) {
        return _comprar(tokenId, type(uint256).max);
    }

    /// @notice Igual que `comprar`, pero **no paga más de `precioMaximo`**. Es lo que debe
    ///         usar la interfaz: entre que el jugador ve un precio y su transacción entra
    ///         en un bloque, el vendedor podría haber llamado a `cambiarPrecio` para
    ///         subirlo (y, si el comprador aprobó ORO de sobra, se le cobraría el nuevo).
    ///         Con este tope, si el precio ha subido la compra revierte con `PrecioSubio`
    ///         en vez de cobrar de más.
    function comprarHasta(uint256 tokenId, uint256 precioMaximo)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 precio, uint256 comision)
    {
        return _comprar(tokenId, precioMaximo);
    }

    function _comprar(uint256 tokenId, uint256 precioMaximo) private returns (uint256 precio, uint256 comision) {
        OfertaAlmacen memory o = _ofertas[tokenId];
        if (o.vendedor == address(0)) revert NoListado(tokenId);
        if (o.vendedor == msg.sender) revert CompradorEsVendedor(tokenId);

        precio = o.precio;
        if (precio > precioMaximo) revert PrecioSubio(precio, precioMaximo);
        comision = (precio * comisionBps) / BPS;
        uint256 neto = precio - comision;

        uint256 saldo = oro.balanceOf(msg.sender);
        if (saldo < precio) revert OroInsuficiente(saldo, precio);
        uint256 aprobado = oro.allowance(msg.sender, address(this));
        if (aprobado < precio) revert SinAprobacionOro(aprobado, precio);

        // --- Efectos antes de las interacciones: la oferta desaparece ya, así que
        //     una reentrada no puede volver a comprar el mismo objeto.
        _quitar(tokenId, o.vendedor);
        oroQuemado += comision;
        _anotarVenta(o.rareza, precio);

        emit Vendido(tokenId, o.vendedor, msg.sender, precio, comision, o.rareza);

        // --- Interacciones. ORO y GameItem son contratos propios y sin callbacks.
        oro.transferFrom(msg.sender, o.vendedor, neto);
        if (comision > 0) oro.burnFrom(msg.sender, comision); // gasta la misma aprobación
        gameItem.transferFrom(address(this), msg.sender, tokenId);
    }

    /// @notice Cómo se reparte `precio`: cuánto se quema y cuánto cobra el vendedor.
    function desglose(uint256 precio) public view returns (uint256 comision, uint256 neto) {
        comision = (precio * comisionBps) / BPS;
        neto = precio - comision;
    }

    // ------------------------------------------------------------------- vistas

    /// @notice Oferta de `tokenId`. Si no está a la venta devuelve la oferta vacía
    ///         (`vendedor == address(0)`), no revierte.
    function listado(uint256 tokenId) external view returns (Oferta memory) {
        OfertaAlmacen storage o = _ofertas[tokenId];
        return Oferta(o.vendedor, o.rareza, o.creado, o.precio);
    }

    /// @notice `true` si `tokenId` está a la venta ahora mismo.
    function estaListado(uint256 tokenId) external view returns (bool) {
        return _ofertas[tokenId].vendedor != address(0);
    }

    /// @notice Número de ofertas vivas.
    function totalListados() external view returns (uint256) {
        return _ids.length;
    }

    /// @notice Todas las ofertas vivas de `vendedor`.
    function listadosDe(address vendedor) external view returns (OfertaVista[] memory lista) {
        uint256[] storage ids = _deVendedor[vendedor];
        lista = new OfertaVista[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) lista[i] = _vista(ids[i]);
    }

    /// @notice Página de ofertas vivas: hasta `cuantos` desde la posición `desde`.
    ///         Devuelve menos (o vacío) si se pasa del final; nunca revierte.
    /// @dev El orden no es estable: al quitar una oferta, la última ocupa su hueco.
    ///      Para la interfaz es una foto del momento, suficiente para paginar.
    function listados(uint256 desde, uint256 cuantos) external view returns (OfertaVista[] memory lista) {
        uint256 n = _ids.length;
        if (desde >= n || cuantos == 0) return new OfertaVista[](0);
        uint256 fin = desde + cuantos;
        if (fin > n) fin = n;
        lista = new OfertaVista[](fin - desde);
        for (uint256 i = desde; i < fin; i++) lista[i - desde] = _vista(_ids[i]);
    }

    /// @notice Agregados de mercado de una rareza: volumen, ventas y precio medio
    ///         (ORO en unidades base; medio = 0 si todavía no hubo ventas).
    function mercadoRareza(uint8 rareza) external view returns (uint256 volumen, uint256 ventas, uint256 medio) {
        Estadistica memory e = estadisticaRareza[rareza]; // revierte si rareza > 2
        volumen = e.volumen;
        ventas = e.ventas;
        medio = e.ventas == 0 ? 0 : e.volumen / e.ventas;
    }

    /// @notice Agregados de todo el mercado: volumen, ventas, precio medio y ORO quemado.
    function mercadoTotal()
        external
        view
        returns (uint256 volumen, uint256 ventas, uint256 medio, uint256 quemado)
    {
        Estadistica memory e = totalMercado;
        volumen = e.volumen;
        ventas = e.ventas;
        medio = e.ventas == 0 ? 0 : e.volumen / e.ventas;
        quemado = oroQuemado;
    }

    // -------------------------------------------------------------------- owner

    /// @notice Cambia la comisión (puntos básicos; 500 = 5 %). Tope `COMISION_MAXIMA`.
    function setComision(uint256 bps) external onlyOwner {
        if (bps > COMISION_MAXIMA) revert ComisionExcesiva(bps, COMISION_MAXIMA);
        emit ComisionCambiada(comisionBps, bps);
        comisionBps = bps;
    }

    /// @notice Pausa de emergencia: nada se lista, cambia de precio ni se compra.
    ///         Los vendedores recuperan sus NFT con `rescatar`.
    function pausar() external onlyOwner {
        _pause();
    }

    /// @notice Reanuda el mercado.
    function reanudar() external onlyOwner {
        _unpause();
    }

    /// @notice Devuelve a `a` un NFT que alguien transfirió al contrato sin listarlo.
    ///         Solo sirve para objetos **no listados**: el owner no puede tocar lo que
    ///         un vendedor tiene en custodia.
    function devolverNftPerdido(uint256 tokenId, address a) external onlyOwner nonReentrant {
        if (_ofertas[tokenId].vendedor != address(0)) revert EstaListado(tokenId);
        address dueno = gameItem.ownerOf(tokenId);
        if (dueno != address(this)) revert NoEsNuestro(tokenId, dueno);
        emit NftPerdidoDevuelto(tokenId, a);
        gameItem.transferFrom(address(this), a, tokenId);
    }

    // ----------------------------------------------------------------- internas

    function _validarPrecio(uint256 precio) private pure {
        if (precio == 0) revert PrecioCero();
        if (precio > PRECIO_MAXIMO) revert PrecioExcesivo(precio, PRECIO_MAXIMO);
    }

    function _vigente(uint256 tokenId) private view returns (OfertaAlmacen storage o) {
        o = _ofertas[tokenId];
        if (o.vendedor == address(0)) revert NoListado(tokenId);
    }

    /// @dev Comprueba que la oferta existe y es de `msg.sender`, y la quita.
    function _retirarPropia(uint256 tokenId) private returns (address vendedor) {
        vendedor = _ofertas[tokenId].vendedor;
        if (vendedor == address(0)) revert NoListado(tokenId);
        if (vendedor != msg.sender) revert NoEresVendedor(tokenId, vendedor);
        _quitar(tokenId, vendedor);
    }

    /// @dev Borra la oferta y la saca de los dos índices: el último elemento de cada
    ///      lista ocupa el hueco (swap-and-pop), así no quedan huecos que recorrer.
    function _quitar(uint256 tokenId, address vendedor) private {
        uint32 i = _ofertas[tokenId].pos;
        if (i != 0) {
            uint256 ultimo = _ids[_ids.length - 1];
            _ids[i - 1] = ultimo;
            _ofertas[ultimo].pos = i; // si ultimo == tokenId, lo borra el delete de abajo
            _ids.pop();
        }
        uint32 j = _ofertas[tokenId].posVendedor;
        if (j != 0) {
            uint256[] storage propios = _deVendedor[vendedor];
            uint256 ultimo = propios[propios.length - 1];
            propios[j - 1] = ultimo;
            _ofertas[ultimo].posVendedor = j;
            propios.pop();
        }
        delete _ofertas[tokenId];
    }

    function _anotarVenta(uint8 rareza, uint256 precio) private {
        uint32 dia = uint32(block.timestamp / 1 days);
        Estadistica storage t = totalMercado;
        t.volumen += uint128(precio);
        t.ventas += 1;
        t.ultimoDia = dia;
        Estadistica storage r = estadisticaRareza[rareza];
        r.volumen += uint128(precio);
        r.ventas += 1;
        r.ultimoDia = dia;
    }

    function _vista(uint256 tokenId) private view returns (OfertaVista memory) {
        OfertaAlmacen storage o = _ofertas[tokenId];
        return OfertaVista(tokenId, o.vendedor, o.rareza, o.creado, o.precio);
    }
}
