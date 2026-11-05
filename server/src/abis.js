// ABIs mínimos (human-readable) de lo que el servidor lee o llama en los contratos
// de la 1.2 (MEJORAS-1.2.md §3). Los tests comprueban que cada firma, incluidos los
// `indexed`, coincide con los ABI completos de ../shared/ cuando existen.

/** GameItem (ya desplegado; no cambia). */
export const ABI_GAMEITEM_EVENTOS = Object.freeze([
  'event ItemMinted(address indexed to, uint256 indexed tokenId, string nombre, string tipo, uint8 rareza, uint16 ataque, uint16 defensa)',
]);

/** Mercado (se redespliega en la 1.2 con el mismo código). */
export const ABI_MERCADO_EVENTOS = Object.freeze([
  'event ItemVendido(address indexed jugador, uint256 indexed tokenId, uint256 oro, uint256 eth)',
]);

/** Recompensas (nuevo en la 1.2). */
export const ABI_RECOMPENSAS = Object.freeze([
  'function recompensar(address jugador, uint256 cantidad, string motivo)',
  'function operador() view returns (address)',
  'event DiarioReclamado(address indexed jugador, uint256 indexed dia, uint256 racha, uint256 oro, uint256 cosmeticoId)',
  'event Recompensado(address indexed jugador, uint256 cantidad, string motivo)',
  // Errores, para que ethers los decodifique (err.revert.name) y el servidor dé un mensaje claro.
  'error SoloOperador(address cuenta)',
  'error CantidadCero()',
  'error TopeJugadorSuperado(uint256 restante, uint256 pedido)',
  'error TopeGlobalSuperado(uint256 restante, uint256 pedido)',
]);

/** Decimales de LootGold (ERC-20 estándar). */
export const DECIMALES_ORO = 18;
