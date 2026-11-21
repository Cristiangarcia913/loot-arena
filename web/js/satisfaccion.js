// Sistema de UX Research: mini-encuesta de satisfacción (MEJORAS "Radiografía de Satisfacción
// del Jugador"). Al terminar una sesión, ser derrotado o pulsar "📊 Evaluar Juego": 1 a 5
// estrellas, chips de selección rápida y un comentario breve opcional. Se empaquetan también los
// datos del Medidor Emocional si estuvo activo (emoción dominante + tensión media; nunca fotos,
// ver emociones.js) junto a las estadísticas de la partida, se envían al servidor
// (POST /api/satisfaccion, que los añade a un .csv listo para Excel) y se guarda una copia local.
//
// Parte 1 (abajo): funciones puras, testeables sin DOM. Parte 2: el modal.
import { resumenSesion } from "./emociones.js";
import { leer, guardar } from "./storage.js";
import { h } from "./ui.js";

/** Clave de localStorage de la copia local de respuestas enviadas. */
export const CLAVE_LOCAL = "lootarena:satisfaccion";
/** Cuántas respuestas locales como mucho se guardan (la más reciente primero). */
export const MAX_LOCAL = 20;

/** Chips de selección rápida del modal (MEJORAS: UX Research). */
export const CHIPS = Object.freeze([
  Object.freeze({ id: "adictivo", texto: "🔥 Muy Adictivo" }),
  Object.freeze({ id: "tactico", texto: "⚔️ Combate Táctico" }),
  Object.freeze({ id: "jefes", texto: "🐉 Jefes Épicos" }),
  Object.freeze({ id: "justo", texto: "📈 Justo y Desafiante" }),
]);

// ───────────────────────── 1. Funciones puras ─────────────────────────

/**
 * Emoción dominante y tensión media de la sesión, a partir del historial de picos de
 * emociones.js. `null` en ambas si el Medidor Emocional no estuvo activo o no detectó nada:
 * no se envía un dato biométrico inventado. Pura.
 * @param {Array} historialEmocion historial de emociones.js (vacío si no hubo cámara)
 * @returns {{emocionDominante:string|null, tensionMedia:number|null}}
 */
export function datosBiometricos(historialEmocion = []) {
  if (!historialEmocion?.length) return { emocionDominante: null, tensionMedia: null };
  const r = resumenSesion(historialEmocion);
  if (!r.picos.length) return { emocionDominante: null, tensionMedia: null };
  const dominante = r.picos.reduce((a, b) => (b.porcentaje > a.porcentaje ? b : a));
  return { emocionDominante: dominante.reaccionTexto, tensionMedia: Math.round(r.media) / 100 };
}

/**
 * Construye el cuerpo de `POST /api/satisfaccion` a partir de la respuesta del jugador y las
 * estadísticas de la partida. Pura (no toca localStorage ni la red).
 * @param {{estrellas:number, tags?:string[], comentario?:string,
 *   stats?:{jugador?:string, nivel?:number, rachaMax?:number, tiempoMinutos?:number},
 *   historialEmocion?:Array, ahora?:() => number}} o
 */
export function construirPayload({
  estrellas, tags = [], comentario = "", stats = {}, historialEmocion = [], ahora = Date.now,
}) {
  const bio = datosBiometricos(historialEmocion);
  return {
    fecha: new Date(ahora()).toISOString(),
    jugador: stats.jugador ?? null,
    nivel: stats.nivel ?? null,
    rachaMax: stats.rachaMax ?? null,
    estrellas,
    emocionDominante: bio.emocionDominante,
    tensionMedia: bio.tensionMedia,
    tiempoMinutos: stats.tiempoMinutos ?? null,
    tags,
    comentario: comentario?.trim() || null,
  };
}

/** Parsea la copia local guardada; ante datos corruptos devuelve la lista vacía. */
export function parsearLocal(texto) {
  try {
    const d = JSON.parse(texto ?? "[]");
    return Array.isArray(d) ? d : [];
  } catch { return []; }
}

/** Añade `datos` al principio de la lista y recorta a MAX_LOCAL. Pura. */
export function anadirLocal(lista, datos) {
  return [datos, ...(lista ?? [])].slice(0, MAX_LOCAL);
}

/** Guarda `datos` en la copia local (localStorage), tolerante a fallos (modo privado…). */
export function guardarLocal(datos) {
  try { guardar(CLAVE_LOCAL, JSON.stringify(anadirLocal(parsearLocal(leer(CLAVE_LOCAL)), datos))); }
  catch { /* la copia local es un extra: si falla, lo que importa es el envío al servidor */ }
}

/**
 * Envía la respuesta al servidor. Nunca lanza: un fallo de red se devuelve como error, igual
 * que `api.js: reclamarBotin`.
 * @returns {Promise<{ok:true} | {ok:false, mensaje:string}>}
 */
export async function enviarSatisfaccion(serverUrl, datos, { fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
  if (!serverUrl) return { ok: false, mensaje: "Sin servidor configurado" };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${serverUrl}/api/satisfaccion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(datos),
      signal: ctrl.signal,
    });
    if (res.ok) return { ok: true };
    let mensaje = `Respuesta inesperada del servidor (HTTP ${res.status})`;
    try { const body = await res.json(); if (body?.error) mensaje = body.error; } catch { /* sin cuerpo JSON */ }
    return { ok: false, mensaje };
  } catch (e) {
    const mensaje = e?.name === "AbortError"
      ? "El servidor tardó demasiado en responder"
      : `No se pudo contactar con el servidor (${serverUrl})`;
    return { ok: false, mensaje };
  } finally {
    clearTimeout(t);
  }
}

/** Enlace de descarga del .csv de satisfacción, o `null` sin servidor configurado. */
export function urlDescarga(serverUrl) {
  return serverUrl ? `${serverUrl}/api/satisfaccion/descargar` : null;
}

/** Misma cabecera que el .csv del servidor (server/src/satisfaccion.js). */
export const CABECERA_CSV = Object.freeze([
  "Fecha", "Jugador", "Nivel", "RachaMax", "Estrellas", "EmocionDominante",
  "TensionMedia", "TiempoJuegoMin", "Comentario", "Tags",
]);

const campoCsv = (v) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * .csv para Excel (BOM UTF-8, separador ';', CRLF) con las respuestas guardadas en este
 * navegador: lo que descarga el botón "📥 Descargar Datos de Satisfacción" cuando no hay
 * servidor (modo local/demo). Mismo formato que el del servidor, de la más antigua a la más
 * reciente. Pura.
 * @param {Array<object>} lista respuestas como las guarda `guardarLocal` (la más reciente primero)
 * @returns {string}
 */
export function csvLocal(lista = []) {
  const fila = (vals) => `${vals.map(campoCsv).join(";")}\r\n`;
  const filas = [...(lista ?? [])].reverse().map((d) => fila([
    d.fecha, d.jugador || "Anónimo", d.nivel, d.rachaMax, d.estrellas, d.emocionDominante,
    d.tensionMedia, d.tiempoMinutos, d.comentario, Array.isArray(d.tags) ? d.tags.join(", ") : d.tags,
  ]));
  return `\uFEFF${fila(CABECERA_CSV)}${filas.join("")}`;
}

/** Descarga `csvLocal` de la copia local como archivo (sin servidor). Devuelve cuántas filas lleva. */
export function descargarCsvLocal({ documento = document } = {}) {
  const lista = parsearLocal(leer(CLAVE_LOCAL));
  const blob = new Blob([csvLocal(lista)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = documento.createElement("a");
  a.href = url;
  a.download = "satisfaccion_jugadores.csv";
  documento.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return lista.length;
}

// ───────────────────────── 2. Modal ─────────────────────────

function estrellasUI(onCambio) {
  const botones = [];
  const pintar = (n) => botones.forEach((b, i) => {
    const activa = i < n;
    b.classList.toggle("sat-estrella-activa", activa);
    b.setAttribute("aria-pressed", String(activa));
  });
  const fila = h("div", { class: "sat-estrellas", role: "radiogroup", "aria-label": "Valoración de 1 a 5 estrellas" });
  for (let i = 1; i <= 5; i++) {
    const b = h("button", {
      type: "button", class: "sat-estrella", "aria-pressed": "false", "aria-label": `${i} estrella${i > 1 ? "s" : ""}`,
      onclick: () => { pintar(i); onCambio(i); },
    }, "⭐");
    botones.push(b);
    fila.append(b);
  }
  return fila;
}

function chipsUI(seleccion) {
  const fila = h("div", { class: "sat-chips", role: "group", "aria-label": "Qué describe mejor la sesión (opcional, varias a la vez)" });
  for (const c of CHIPS) {
    const b = h("button", { type: "button", class: "sat-chip", "aria-pressed": "false" }, c.texto);
    b.addEventListener("click", () => {
      const activo = !seleccion.has(c.id);
      activo ? seleccion.add(c.id) : seleccion.delete(c.id);
      b.classList.toggle("sat-chip-activo", activo);
      b.setAttribute("aria-pressed", String(activo));
    });
    fila.append(b);
  }
  return fila;
}

/**
 * Muestra el modal de la encuesta ("📊 ¿Qué te ha parecido esta sesión?"): estrellas, chips y
 * comentario opcional. Al enviar, guarda copia local y lo manda al servidor; "Omitir" cierra sin
 * enviar nada. Nunca lanza ni bloquea el juego si el servidor no responde.
 * @param {{stats?:object, historialEmocion?:Array, serverUrl?:string|null,
 *   fetchImpl?:Function, documento?:Document}} [o]
 * @returns {Promise<void>}
 */
export function mostrarEncuesta({ stats = {}, historialEmocion = [], serverUrl = null, fetchImpl = fetch, documento = document } = {}) {
  return new Promise((resolver) => {
    let estrellas = 0;
    const seleccion = new Set();
    let overlay;
    const cerrar = () => { overlay.remove(); documento.removeEventListener("keydown", alEscape); resolver(); };
    const alEscape = (ev) => { if (ev.key === "Escape") cerrar(); };

    const comentario = h("textarea", {
      class: "sat-comentario", maxlength: "300", rows: "2", "aria-label": "Comentario (opcional)",
      placeholder: "Cuéntanos algo más (opcional)…",
    });
    const estado = h("p", { class: "sat-estado tenue" }, "");
    const enviarBtn = h("button", { type: "button", class: "btn btn-gold btn-small", disabled: true }, "Enviar");
    enviarBtn.addEventListener("click", async () => {
      if (!estrellas || enviarBtn.disabled) return;
      enviarBtn.disabled = true;
      estado.textContent = "Enviando…";
      const tags = [...seleccion].map((id) => CHIPS.find((c) => c.id === id)?.texto).filter(Boolean);
      const datos = construirPayload({ estrellas, tags, comentario: comentario.value, stats, historialEmocion });
      guardarLocal(datos);
      const r = await enviarSatisfaccion(serverUrl, datos, { fetchImpl });
      estado.textContent = r.ok ? "¡Gracias por tu valoración!" : "Guardado en este navegador (no se pudo enviar al servidor).";
      setTimeout(cerrar, r.ok ? 900 : 1700);
    });

    overlay = h("div", { class: "pantalla sat-pantalla" },
      h("div", { class: "sat-caja" },
        h("h3", {}, "📊 ¿Qué te ha parecido esta sesión?"),
        h("p", { class: "sat-sub tenue" }, "Solo 5 segundos: toca las estrellas y, si quieres, una etiqueta."),
        estrellasUI((n) => { estrellas = n; enviarBtn.disabled = false; }),
        chipsUI(seleccion),
        comentario,
        estado,
        h("div", { class: "sat-acciones" },
          h("button", { type: "button", class: "btn btn-small btn-ghost", onclick: cerrar }, "Omitir"),
          enviarBtn)));
    documento.body.append(overlay);
    documento.addEventListener("keydown", alEscape);
  });
}
