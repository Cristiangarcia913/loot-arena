// Cliente del servidor de botín (SPEC.md §2). Sin DOM: testeable con node.
import { normalizarItem } from "./equipment.js";

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

/**
 * Traduce la respuesta HTTP de POST /ganar a un resultado para la UI.
 * @returns {{tipo:"drop", tokenId:string, txHash:string|null, item:object}
 *         | {tipo:"sin_drop"} | {tipo:"limite", mensaje:string} | {tipo:"error", mensaje:string}}
 */
export function interpretarRespuesta(status, body) {
  const error = typeof body?.error === "string" ? body.error : null;
  if (status === 200 && body?.drop === true && body.item) {
    return {
      tipo: "drop",
      tokenId: String(body.tokenId),
      txHash: TX_HASH.test(body.txHash ?? "") ? body.txHash : null,
      item: normalizarItem(body.item, body.tokenId),
    };
  }
  if (status === 200 && body?.drop === false) return { tipo: "sin_drop" };
  if (status === 429) return { tipo: "limite", mensaje: error ?? "Demasiadas peticiones, espera unos segundos" };
  if (status === 400) return { tipo: "error", mensaje: error ?? "Petición inválida" };
  return { tipo: "error", mensaje: error ?? `Respuesta inesperada del servidor (HTTP ${status})` };
}

/** POST {serverUrl}/ganar con {address, enemyLevel}. Nunca lanza: los fallos de red se devuelven como error. */
export async function reclamarBotin(serverUrl, address, enemyLevel, { fetchImpl = fetch, timeoutMs = 90_000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${serverUrl}/ganar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, enemyLevel }),
      signal: ctrl.signal,
    });
    let body = null;
    try { body = await res.json(); } catch { /* cuerpo no JSON */ }
    return interpretarRespuesta(res.status, body);
  } catch (e) {
    const mensaje = e?.name === "AbortError"
      ? "El servidor tardó demasiado en responder"
      : `No se pudo contactar con el servidor (${serverUrl})`;
    return { tipo: "error", mensaje };
  } finally {
    clearTimeout(t);
  }
}
