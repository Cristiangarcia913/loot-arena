// Historial local de actividad del jugador: compras en la tienda, botines de jefe y
// recompensas reclamadas. Pensado para rellenar «Tus transacciones» (cadena/vista.js) cuando
// el RPC público no tiene eventos recientes que enseñar: nunca sustituye a un evento real de la
// cadena, solo cubre el hueco mientras no lo hay.
//
// Lógica pura, sin localStorage directo (igual que botin-local.js): quien lo use lee y guarda
// con storage.js y estas funciones solo parsean, añaden y serializan.

export const CLAVE_HISTORIAL_LOCAL = "lootarena:historial-local";
/** Cuántas entradas como mucho se guardan (la más reciente primero). */
export const MAX_ENTRADAS = 30;

/**
 * @typedef {object} EntradaHistorialLocal
 * @property {"compra"|"venta"|"botin"|"recompensa"} tipo
 * @property {string} titulo        línea lista para mostrar (texto plano, sin HTML)
 * @property {string[]} detalle     líneas de detalle, igual que en una tx de la cadena
 * @property {bigint|null} oro      unidades base de ORO (+ ganado, − gastado)
 * @property {bigint|null} eth      wei de ETH
 * @property {string|null} hash     hash de la transacción, si la hubo (se puede enlazar al explorador)
 * @property {number} fecha         Date.now() de cuando ocurrió
 */

function entradaValida(e) {
  return !!e && typeof e === "object" && typeof e.tipo === "string" && e.tipo !== ""
    && typeof e.titulo === "string" && e.titulo !== "";
}

/**
 * Añade una entrada (ya parseada o recién creada) al principio de la lista y recorta a
 * MAX_ENTRADAS. Una entrada inválida (sin tipo o sin título) se ignora en vez de ensuciar la lista.
 * @param {EntradaHistorialLocal[]} lista
 * @param {Partial<EntradaHistorialLocal>} entrada
 * @returns {EntradaHistorialLocal[]}
 */
export function anadirEntrada(lista, entrada) {
  if (!entradaValida(entrada)) return lista ?? [];
  const limpia = {
    tipo: entrada.tipo,
    titulo: entrada.titulo,
    detalle: Array.isArray(entrada.detalle) ? entrada.detalle.map(String) : [],
    oro: entrada.oro ?? null,
    eth: entrada.eth ?? null,
    hash: entrada.hash || null,
    fecha: Number(entrada.fecha ?? Date.now()) || Date.now(),
  };
  return [limpia, ...(lista ?? [])].slice(0, MAX_ENTRADAS);
}

/** Serializa la lista a JSON para guardar (bigint → string: JSON no admite bigint). */
export function serializarHistorial(lista) {
  return JSON.stringify((lista ?? []).map((e) => ({
    ...e,
    oro: e.oro != null ? String(e.oro) : null,
    eth: e.eth != null ? String(e.eth) : null,
  })));
}

/**
 * Parsea el texto guardado. Tolerante: JSON roto, algo que no es un array, o entradas sueltas
 * corruptas (bigint ilegible, campos que faltan) se descartan en vez de romper la pestaña.
 * @param {string|null} texto
 * @returns {EntradaHistorialLocal[]}
 */
export function parsearHistorial(texto) {
  let d;
  try { d = JSON.parse(texto ?? "[]"); } catch { return []; }
  if (!Array.isArray(d)) return [];
  const out = [];
  for (const e of d) {
    if (!entradaValida(e)) continue;
    try {
      out.push({
        tipo: e.tipo,
        titulo: e.titulo,
        detalle: Array.isArray(e.detalle) ? e.detalle.map(String) : [],
        oro: e.oro != null ? BigInt(e.oro) : null,
        eth: e.eth != null ? BigInt(e.eth) : null,
        hash: typeof e.hash === "string" ? e.hash : null,
        fecha: Number(e.fecha) || 0,
      });
    } catch { /* entrada corrupta: se descarta, el resto del historial sigue valiendo */ }
  }
  return out.slice(0, MAX_ENTRADAS);
}
