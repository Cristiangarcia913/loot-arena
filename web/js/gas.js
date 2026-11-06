// Gas gratis para los jugadores de Loot Arena (MEJORAS-1.3.md §2). Sin DOM: testeable con node.
//
// Antes de cualquier transacción del jugador (vender, comprar, abrir cofre, transferir) se llama a
// asegurarGas(): si el ETH de Sepolia no llega, pide al servidor `POST {serverUrl}/gas {address}` y
// espera (releyendo el saldo con reintentos) a que llegue. El aviso «Necesitas ETH de Sepolia» solo
// debe salir si esto también falla.
//
//   import { asegurarGas } from "./gas.js";
//   const r = await asegurarGas({ provider, cuenta, serverUrl: cfg.serverUrl, onEstado: (txt) => … });
//   if (!r.ok) { /* mostrar r.mensaje + faucet */ return; }
//
// Servidor:
//   POST /gas {address} → 200 {ok, enviado, txHash} | 200 {ok, enviado:0, motivo} | 409 ya pedido hoy | 503 sin fondos
//   GET  /gas/:address  → {saldo, puedePedir, proximoEn}

import { ETH_BLOQUEO_GAS } from "./wallet-errores.js";

/** Saldo mínimo (wei) para dejar firmar: 0,0001 ETH (el mismo bloqueo que usa la tienda). */
export const GAS_MINIMO = ETH_BLOQUEO_GAS;
/** Por debajo de este saldo (wei) se pide gas al servidor: 0,0003 ETH (el umbral del grifo del servidor). */
export const GAS_UMBRAL_GRIFO = 3n * 10n ** 14n;
/** Espera máxima a que llegue el ETH enviado (ms). */
export const GAS_ESPERA_MAX_MS = 60_000;
/** Esperas entre lecturas del saldo (ms); la última se repite hasta agotar GAS_ESPERA_MAX_MS. */
export const GAS_BACKOFF_MS = Object.freeze([1500, 2500, 4000, 6000, 8000, 10_000]);

export const MSG_GAS = Object.freeze({
  pidiendo: "⛽ Consiguiendo gas gratis…",
  enviado: "⛽ Te hemos enviado gas gratis, un momento…",
  llegado: "⛽ ¡Gas gratis recibido! Ya puedes firmar.",
  noHaceFalta: "El servidor dice que ya tienes gas suficiente.",
  yaPedido: "Ya pediste gas hoy. Vuelve mañana o consigue ETH en el faucet de Sepolia.",
  sinFondos: "El servidor no tiene fondos ahora para regalar gas. Prueba más tarde o usa el faucet de Sepolia.",
  demasiadas: "Demasiadas peticiones de gas. Espera un poco y vuelve a intentarlo.",
  sinServidor: "No hay servidor configurado para pedir gas gratis.",
  sinRed: "No se pudo contactar con el servidor de gas (puede estar despertando). Reintenta en unos segundos.",
  tarda: "El gas gratis está en camino pero aún no ha llegado. Espera un minuto y vuelve a intentarlo.",
});

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const base = (url) => String(url ?? "").replace(/\/+$/, "");

/** bigint | number | string (wei) → bigint; null si no se puede. */
function aWei(v) {
  if (v == null) return null;
  if (typeof v === "bigint") return v;
  try {
    if (typeof v === "number") return Number.isFinite(v) ? BigInt(Math.trunc(v)) : null;
    if (typeof v === "string" && /^\s*(0x[0-9a-f]+|\d+)\s*$/i.test(v)) return BigInt(v.trim());
    if (typeof v?.toString === "function" && typeof v !== "string") return aWei(v.toString());
  } catch { /* no es un número */ }
  return null;
}

/** "0.0005" (ETH, como formatEther del servidor) o "500000000000000" (wei) → wei; null si no se puede. */
function weiDeTexto(v) {
  if (typeof v === "string" && /^\s*\d+\.\d*\s*$/.test(v)) {
    const [ent, dec = ""] = v.trim().split(".");
    return BigInt(ent) * 10n ** 18n + BigInt((dec + "0".repeat(18)).slice(0, 18));
  }
  return aWei(v);
}

async function json(res) {
  try { return await res.json(); } catch { return null; }
}

async function peticion(f, url, init, timeoutMs) {
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  const t = ctrl && timeoutMs > 0 ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await f(url, { ...init, ...(ctrl ? { signal: ctrl.signal } : {}) });
    return { res, body: await json(res) };
  } finally {
    if (t) clearTimeout(t);
  }
}

/**
 * Se asegura de que `cuenta` tiene ETH de Sepolia para pagar el gas; si no, lo pide al servidor y
 * espera a que llegue. Nunca lanza.
 *
 * @param {object} o
 * @param {{getBalance:(a:string)=>Promise<any>}} [o.provider]  provider de ethers (lee el saldo)
 * @param {string} o.cuenta                 dirección del jugador
 * @param {string} o.serverUrl              URL del servidor (sin barra final, aunque se tolera)
 * @param {() => Promise<bigint|null>} [o.leerSaldo]  alternativa a provider.getBalance (p. ej. eco.saldoEth)
 * @param {typeof fetch} [o.fetch]          fetch inyectable (tests)
 * @param {(ms:number) => Promise<void>} [o.esperar]  espera inyectable (tests)
 * @param {(texto:string, fase:"pidiendo"|"esperando") => void} [o.onEstado]  estado intermedio para la UI
 * @param {bigint} [o.minimo=GAS_MINIMO]    saldo necesario para dejar firmar
 * @param {bigint} [o.umbral=GAS_UMBRAL_GRIFO]  por debajo se pide gas (si es ≥ minimo y el grifo falla, se deja pasar)
 * @param {number} [o.esperaMaxMs=GAS_ESPERA_MAX_MS]
 * @param {number} [o.timeoutMs=60000]      tiempo máximo de la petición HTTP (Render puede estar dormido)
 * @returns {Promise<{ok:boolean, mensaje:string, txHash?:string, pedido:boolean, saldo:bigint|null, codigo:string}>}
 *   codigo: "suficiente" | "desconocido" | "recibido" | "en-camino" | "no-hace-falta" | "ya-pedido" |
 *           "sin-fondos" | "demasiadas" | "sin-servidor" | "sin-red" | "error" | "tarda"
 *   `mensaje` es "" cuando no hubo nada que contar (saldo suficiente).
 */
export async function asegurarGas({
  provider, cuenta, serverUrl, leerSaldo, fetch: f = globalThis.fetch, esperar = dormir, onEstado,
  minimo = GAS_MINIMO, umbral = GAS_UMBRAL_GRIFO, esperaMaxMs = GAS_ESPERA_MAX_MS, timeoutMs = 60_000,
} = {}) {
  const leer = async () => {
    try { return aWei(leerSaldo ? await leerSaldo() : await provider.getBalance(cuenta)); } catch { return null; }
  };
  const fin = (ok, codigo, mensaje, extra = {}) => ({ ok, codigo, mensaje, pedido: false, saldo, ...extra });

  let saldo = await leer();
  // Sin lectura (RPC caído) no se bloquea: si de verdad falta gas, MetaMask/la tx lo dirán.
  if (saldo == null) return fin(true, "desconocido", "");
  if (saldo >= umbral) return fin(true, "suficiente", "");
  const basta = saldo >= minimo; // hay poco pero se puede firmar aunque el grifo falle
  const fallo = (codigo, mensaje, extra) => fin(basta, codigo, basta ? "" : mensaje, { pedido: true, ...extra });

  if (!base(serverUrl) || typeof f !== "function") return fin(basta, "sin-servidor", basta ? "" : MSG_GAS.sinServidor);

  onEstado?.(MSG_GAS.pidiendo, "pidiendo");
  let res, body;
  try {
    ({ res, body } = await peticion(f, `${base(serverUrl)}/gas`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: cuenta }),
    }, timeoutMs));
  } catch {
    return fallo("sin-red", MSG_GAS.sinRed);
  }

  if (res.status === 409) return fallo("ya-pedido", MSG_GAS.yaPedido);
  // El 503 del servidor distingue «sin ETH», «cupo del día agotado» y «grifo no disponible»: se usa su texto.
  if (res.status === 503) return fallo("sin-fondos", body?.error ? `${body.error}. Mientras, usa el faucet de Sepolia.` : MSG_GAS.sinFondos);
  if (res.status === 429) return fallo("demasiadas", MSG_GAS.demasiadas);
  if (!res.ok || !body) return fallo("error", body?.error ? `No se pudo conseguir gas gratis: ${body.error}` : `No se pudo conseguir gas gratis (HTTP ${res.status}).`);

  const txHash = typeof body.txHash === "string" && body.txHash ? body.txHash : undefined;
  // `enviado` puede venir en wei (entero) o en ETH ("0.0005"): basta con saber si es > 0.
  const huboEnvio = !!txHash || (aWei(body.enviado) ?? 0n) > 0n || Number(body.enviado) > 0;
  if (!huboEnvio) {
    // El servidor cree que ya hay saldo (su RPC puede ir por delante del nuestro): se relee un par de veces.
    const r = await esperarSaldo({ leer, esperar, listo: (v) => v >= minimo, esperaMaxMs: Math.min(esperaMaxMs, 8000) });
    saldo = r.saldo ?? saldo;
    if (r.ok) return fin(true, "no-hace-falta", "", { pedido: true });
    const motivo = typeof body.motivo === "string" && body.motivo ? ` (${body.motivo})` : "";
    return fallo("no-hace-falta", `${MSG_GAS.noHaceFalta}${motivo} Si no puedes firmar, usa el faucet de Sepolia.`);
  }

  // Si ya se podía firmar, no hace falta esperar a que llegue.
  if (basta) return fin(true, "en-camino", MSG_GAS.enviado, { pedido: true, txHash });

  onEstado?.(MSG_GAS.enviado, "esperando");
  const inicial = saldo;
  const r = await esperarSaldo({ leer, esperar, listo: (v) => v > inicial && v >= minimo, esperaMaxMs });
  saldo = r.saldo ?? saldo;
  if (r.ok) return fin(true, "recibido", MSG_GAS.llegado, { pedido: true, txHash });
  return fin(false, "tarda", MSG_GAS.tarda, { pedido: true, txHash });
}

/** Relee el saldo con esperas crecientes (GAS_BACKOFF_MS) hasta `listo` o hasta agotar esperaMaxMs. */
async function esperarSaldo({ leer, esperar, listo, esperaMaxMs }) {
  let total = 0, i = 0, saldo = null;
  for (;;) {
    const ms = Math.min(GAS_BACKOFF_MS[Math.min(i++, GAS_BACKOFF_MS.length - 1)], esperaMaxMs - total);
    if (ms <= 0) return { ok: false, saldo };
    await esperar(ms);
    total += ms;
    const v = await leer(); // null = RPC desfasado/caído: se sigue intentando
    if (v != null) { saldo = v; if (listo(v)) return { ok: true, saldo }; }
  }
}

/**
 * GET {serverUrl}/gas/:address → ¿puede pedir gas gratis? Nunca lanza.
 * @param {string} serverUrl @param {string} cuenta
 * @param {{fetch?:typeof fetch, timeoutMs?:number, ahora?:number}} [o]
 * @returns {Promise<{ok:true, saldo:bigint|null, puedePedir:boolean, motivo:string|null, proximoEn:any, proximoMs:number|null}|{ok:false, mensaje:string, status?:number}>}
 *   `saldo` en wei (el servidor lo manda en ETH: "0.0005"); `motivo` si no puede pedir; `proximoEn` tal cual lo manda el servidor; `proximoMs` = instante (ms) estimado si es un nº de segundos
 *   que faltan (como /recompensa/diaria) o una fecha ISO.
 */
export async function estadoGas(serverUrl, cuenta, { fetch: f = globalThis.fetch, timeoutMs = 60_000, ahora = Date.now() } = {}) {
  if (!base(serverUrl) || typeof f !== "function") return { ok: false, mensaje: MSG_GAS.sinServidor };
  try {
    const { res, body } = await peticion(f, `${base(serverUrl)}/gas/${encodeURIComponent(cuenta ?? "")}`, { method: "GET" }, timeoutMs);
    if (!res.ok || !body) return { ok: false, status: res.status, mensaje: body?.error ?? `El servidor respondió ${res.status}.` };
    return {
      ok: true,
      saldo: weiDeTexto(body.saldo),
      motivo: typeof body.motivo === "string" ? body.motivo : null,
      puedePedir: !!body.puedePedir,
      proximoEn: body.proximoEn ?? null,
      proximoMs: instante(body.proximoEn, ahora),
    };
  } catch {
    return { ok: false, mensaje: MSG_GAS.sinRed };
  }
}

function instante(v, ahora) {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return v > 1e11 ? v : ahora + v * 1000; // ms absolutos o segundos que faltan
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}
