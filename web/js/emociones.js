// Telemetría Emocional opcional para UX research (MEJORAS: "Radiografía de Satisfacción del
// Jugador"). 100 % local y privado: el análisis se hace en el navegador del jugador con
// face-api.js (CDN jsDelivr); nunca se guarda ni se envía ninguna foto, solo la emoción
// dominante y su porcentaje. No toca el DOM ni la cámara al importarse.
//
// Partes:
//   1. Utilidades puras (interpretar expresiones, resumen de sesión) → testeables sin DOM.
//   2. Cámara y face-api.js: un fotograma puntual por evento clave, nunca un bucle continuo
//      (cero impacto en los 60 FPS). Cualquier fallo (sin webcam, permiso denegado, CDN caído,
//      sin rostro…) se traga en silencio: el juego sigue exactamente igual.
//   3. Widget de UI: botón "📷 Medidor Emocional (Opcional)", indicador de esquina y el modal
//      de resumen al terminar la sesión.

import { toast } from "./ui.js";

// ───────────────────────── 1. Utilidades puras ─────────────────────────

/** Claves de expresión que entiende face-api.js (orden fijo, no depende del objeto de la lib). */
const CLAVES_EMOCION = ["neutral", "happy", "sad", "angry", "fearful", "disgusted", "surprised"];

/** Emoji por emoción dominante, para el indicador de esquina y el resumen. */
export const ICONOS_EMOCION = Object.freeze({
  neutral: "😐", happy: "😃", surprised: "😮", sad: "😢", angry: "😠", fearful: "😨", disgusted: "🤢",
});
export const icono = (emocion) => ICONOS_EMOCION[emocion] ?? "😐";

/**
 * Los 3 disparadores de combate/cofre que alimentan la telemetría, con su etiqueta para el
 * resumen final (MEJORAS: "Sorpresa al obtener botín: 85%", "Nivel de Tensión en combate: 70%").
 */
export const EVENTOS_EMOCION = Object.freeze({
  botin_raro: Object.freeze({ etiqueta: "Sorpresa al obtener botín", icono: "🎁" }),
  jefe_vencido: Object.freeze({ etiqueta: "Euforia al vencer al Jefe", icono: "👑" }),
  racha_perdida: Object.freeze({ etiqueta: "Nivel de Tensión al perder la racha", icono: "💔" }),
});

/** Nº máximo de picos que se guardan en memoria (no persiste en storage: solo dura la sesión). */
export const MAX_HISTORIAL = 200;

/**
 * Emoción dominante de un objeto de expresiones de face-api.js (`{neutral, happy, sad, …}` en
 * 0..1). Pura: no depende de la forma exacta del objeto (admite plano o con `.asSortedArray`).
 * @param {Record<string, number>} expresiones
 * @returns {{emocion:string, porcentaje:number}}
 */
export function interpretarExpresiones(expresiones) {
  if (!expresiones || typeof expresiones !== "object") return { emocion: "neutral", porcentaje: 0 };
  let mejor = "neutral", valor = -1;
  for (const clave of CLAVES_EMOCION) {
    const v = Number(expresiones[clave]);
    if (Number.isFinite(v) && v > valor) { valor = v; mejor = clave; }
  }
  return { emocion: mejor, porcentaje: Math.round(Math.max(0, valor) * 100) };
}

/**
 * Pico de emoción para un evento clave: `{evento, emocionDominante, porcentaje, timestamp}`.
 * @param {string} evento una clave de EVENTOS_EMOCION
 * @param {Record<string, number>} expresiones
 */
export function crearPico(evento, expresiones, ahora = Date.now()) {
  const { emocion, porcentaje } = interpretarExpresiones(expresiones);
  return { evento, emocionDominante: emocion, porcentaje, timestamp: ahora };
}

/** Añade un pico al historial sin mutar, recortando a `max` (se descartan los más antiguos). */
export function registrarPico(historial, pico, max = MAX_HISTORIAL) {
  const lista = [...(historial ?? []), pico];
  return lista.length > max ? lista.slice(lista.length - max) : lista;
}

/**
 * Conclusión de UX según la intensidad media de los picos de la sesión.
 * @param {number} media 0..100
 * @param {number} nPicos cuántos eventos con pico hubo
 */
export function conclusionUX(media, nPicos) {
  if (!nPicos) return "Sin datos suficientes para una conclusión de UX.";
  if (media >= 65) return "¡Partida con alta implicación emocional!";
  if (media >= 40) return "Partida con implicación emocional moderada.";
  return "Partida con baja intensidad emocional detectada.";
}

/**
 * Resumen de UX research de una sesión: el pico (máximo porcentaje) de cada tipo de evento que
 * haya ocurrido, más una conclusión. Pura.
 * @param {Array<{evento:string, emocionDominante:string, porcentaje:number, timestamp:number}>} historial
 * @returns {{picos: Array<{evento:string, etiqueta:string, icono:string, emocionDominante:string, porcentaje:number}>, media:number, conclusion:string}}
 */
export function resumenSesion(historial = []) {
  const picos = [];
  for (const [evento, meta] of Object.entries(EVENTOS_EMOCION)) {
    const deEsteTipo = historial.filter((p) => p.evento === evento);
    if (!deEsteTipo.length) continue;
    const pico = deEsteTipo.reduce((a, b) => (b.porcentaje > a.porcentaje ? b : a));
    picos.push({ evento, etiqueta: meta.etiqueta, icono: meta.icono, emocionDominante: pico.emocionDominante, porcentaje: pico.porcentaje });
  }
  const media = picos.length ? Math.round(picos.reduce((s, p) => s + p.porcentaje, 0) / picos.length) : 0;
  return { picos, media, conclusion: conclusionUX(media, picos.length) };
}

// ───────────────────────── 2. Cámara y face-api.js ─────────────────────────
// Carga perezosa desde jsDelivr: el script de la librería y los pesos del modelo (detector
// ligero + expresiones). Si cualquier paso falla (sin red, CDN caído…) se tira el error hacia
// quien llama, que lo traga: nunca se propaga al juego.

const FACE_API_CDN = "https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js";
const MODELOS_CDN = "https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights";

const estado = {
  activo: false,
  stream: null,
  video: null,
  canvas: null,
  historial: [],
  cargaModelos: null,
};

/** ¿El navegador puede, en principio, dar acceso a una cámara? (no pide permiso todavía). */
export function soportaCamara() {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

/** ¿El medidor está activo (cámara concedida y en marcha) en este momento? */
export function medidorActivo() {
  return estado.activo;
}

function cargarScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
    document.head.append(s);
  });
}

/** Carga face-api.js y sus modelos una sola vez (promesa en caché; se limpia si falla, para poder reintentar). */
function cargarFaceApi() {
  if (estado.cargaModelos) return estado.cargaModelos;
  estado.cargaModelos = (async () => {
    if (!globalThis.faceapi) await cargarScript(FACE_API_CDN);
    const faceapi = globalThis.faceapi;
    if (!faceapi) throw new Error("face-api.js no disponible tras cargar el script.");
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODELOS_CDN),
      faceapi.nets.faceExpressionNet.loadFromUri(MODELOS_CDN),
    ]);
    return faceapi;
  })();
  estado.cargaModelos.catch(() => { estado.cargaModelos = null; });
  return estado.cargaModelos;
}

function crearVideoOculto(stream) {
  const video = document.createElement("video");
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.width = 160;
  video.height = 120;
  // Oculto pero NO display:none (algunos navegadores pausan el decodificado de un vídeo así,
  // y entonces nunca habría un fotograma nuevo que capturar).
  video.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:2px;height:2px;opacity:0;pointer-events:none;";
  video.srcObject = stream;
  document.body.append(video);
  return video;
}

function indicador() {
  let el = document.getElementById("emo-indicador");
  if (!el) {
    el = document.createElement("div");
    el.id = "emo-indicador";
    el.className = "emo-indicador";
    el.hidden = true;
    el.setAttribute("aria-hidden", "true");
    el.title = "Medidor emocional (opcional, 100% local)";
    document.body.append(el);
  }
  return el;
}

function actualizarIndicador(emocion) {
  const el = indicador();
  el.textContent = icono(emocion);
  el.hidden = !estado.activo;
}

/**
 * Pide permiso de cámara y, si lo consigue, activa el medidor. Si el navegador no tiene webcam
 * o el jugador deniega el permiso, muestra un aviso elegante y devuelve false: el juego sigue
 * exactamente igual, sin bloquear nada ni lanzar ningún error.
 * @returns {Promise<boolean>}
 */
export async function activarMedidor() {
  if (estado.activo) return true;
  if (!soportaCamara()) {
    toast("📷 Este navegador no tiene cámara disponible: el medidor emocional se queda desactivado (el resto del juego funciona igual).", "info", 6000);
    return false;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 160, height: 120 }, audio: false });
    estado.stream = stream;
    estado.video = crearVideoOculto(stream);
    estado.activo = true;
    actualizarIndicador("neutral");
    toast("📷 Medidor emocional activado: se analiza en tu navegador, nunca se guarda ni se envía ninguna foto.", "ok", 6000);
    // Los modelos se precargan en segundo plano; si fallan, cada captura simplemente no hará nada.
    cargarFaceApi().catch((e) => console.warn("[emociones] modelos no disponibles:", e?.message ?? e));
    return true;
  } catch {
    toast("📷 No se pudo activar la cámara (sin permiso o sin webcam). El juego sigue sin el medidor emocional.", "info", 6000);
    return false;
  }
}

/** Apaga la cámara y oculta el indicador. No afecta al historial ya registrado. */
export function desactivarMedidor() {
  if (!estado.activo) return;
  for (const t of estado.stream?.getTracks() ?? []) t.stop();
  estado.video?.remove();
  estado.stream = null;
  estado.video = null;
  estado.activo = false;
  const el = document.getElementById("emo-indicador");
  if (el) el.hidden = true;
}

/** Enciende/apaga el medidor (botón de la barra superior). Devuelve si quedó activo. */
export async function alternarMedidor() {
  if (estado.activo) { desactivarMedidor(); return false; }
  return activarMedidor();
}

/**
 * Captura UN fotograma puntual y lo analiza, solo si el medidor está activo. Se usa en los 3
 * instantes clave del juego (cofre con botín Raro/Legendario, Jefe derrotado, racha perdida).
 * PROHIBIDO llamarla en bucle: cada llamada es una foto suelta, nunca un stream. Cualquier fallo
 * (sin rostro en cámara, modelos sin cargar, CDN caído…) se traga y devuelve null: nunca bloquea
 * ni rompe el flujo del juego.
 * @param {keyof typeof EVENTOS_EMOCION} tipoEvento
 * @returns {Promise<{evento:string, emocionDominante:string, porcentaje:number, timestamp:number}|null>}
 */
export async function capturarPico(tipoEvento) {
  if (!estado.activo || !estado.video || !EVENTOS_EMOCION[tipoEvento]) return null;
  try {
    const faceapi = await cargarFaceApi();
    if (!estado.canvas) estado.canvas = document.createElement("canvas");
    const cv = estado.canvas;
    cv.width = estado.video.videoWidth || 160;
    cv.height = estado.video.videoHeight || 120;
    cv.getContext("2d").drawImage(estado.video, 0, 0, cv.width, cv.height);
    const deteccion = await faceapi.detectSingleFace(cv, new faceapi.TinyFaceDetectorOptions()).withFaceExpressions();
    if (!deteccion) return null;
    const pico = crearPico(tipoEvento, deteccion.expressions);
    estado.historial = registrarPico(estado.historial, pico);
    actualizarIndicador(pico.emocionDominante);
    return pico;
  } catch (e) {
    console.warn("[emociones] captura omitida:", e?.message ?? e);
    return null;
  }
}

/** Historial de picos de la sesión actual (copia). */
export function obtenerHistorial() {
  return [...estado.historial];
}

/** ¿Hay algo que mostrar en el resumen de fin de sesión? */
export function hayDatosSesion() {
  return estado.historial.length > 0;
}

// ───────────────────────── 3. Widget de UI ─────────────────────────

function h(tag, props = {}, ...hijos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of hijos.flat(Infinity)) { if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c))); }
  return el;
}

/**
 * Conecta el botón "📷 Medidor Emocional (Opcional)" de la barra superior (#btn-emociones).
 * Idempotente y sin efecto si el botón no existe en la página. Llamar una vez al arrancar.
 */
export function iniciar() {
  const boton = document.getElementById("btn-emociones");
  if (!boton || boton.dataset.emoListo) return;
  boton.dataset.emoListo = "1";
  boton.addEventListener("click", async () => {
    boton.disabled = true;
    const activo = await alternarMedidor();
    boton.setAttribute("aria-pressed", String(activo));
    boton.classList.toggle("activo", activo);
    boton.disabled = false;
  });
}

/**
 * Modal "📊 Radiografía de Satisfacción del Jugador" al terminar la sesión (expedición). No hace
 * nada si no se registró ningún pico (medidor desactivado o sin rostro detectado nunca): no vale
 * la pena interrumpir al jugador con un resumen vacío. Vacía el historial al cerrarse.
 * @returns {Promise<void>}
 */
export function mostrarResumenSesion() {
  if (!hayDatosSesion()) return Promise.resolve();
  const resumen = resumenSesion(estado.historial);
  estado.historial = [];
  return new Promise((resolver) => {
    let overlay;
    const cerrar = () => { overlay.remove(); document.removeEventListener("keydown", alEscape); resolver(); };
    const alEscape = (ev) => { if (ev.key === "Escape") cerrar(); };
    const filas = resumen.picos.map((p) => h("div", { class: "emo-fila" },
      h("span", { class: "emo-fila-icono", "aria-hidden": "true" }, p.icono),
      h("span", { class: "emo-fila-texto" }, `${p.etiqueta}: `,
        h("strong", {}, `${icono(p.emocionDominante)} ${p.porcentaje}%`))));
    overlay = h("div", { class: "pantalla emo-pantalla" },
      h("div", { class: "emo-caja" },
        h("h3", {}, "📊 Radiografía de Satisfacción del Jugador"),
        filas.length ? h("div", { class: "emo-filas" }, filas) : h("p", { class: "tenue" }, "No se detectó tu rostro en los momentos clave de esta sesión."),
        h("p", { class: "emo-conclusion" }, resumen.conclusion),
        h("p", { class: "emo-nota" }, "📷 100 % local: nada se envió a ningún servidor y no se guardó ninguna foto."),
        h("button", { class: "btn btn-gold btn-small", type: "button", onclick: cerrar }, "Cerrar")));
    document.body.append(overlay);
    document.addEventListener("keydown", alEscape);
    overlay.querySelector("button")?.focus();
  });
}
