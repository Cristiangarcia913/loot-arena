// Telemetría Emocional opcional para UX research (MEJORAS: "Radiografía de Satisfacción del
// Jugador"). 100 % local y privado: el análisis se hace en el navegador del jugador con
// face-api.js (CDN jsDelivr); nunca se guarda ni se envía ninguna foto, solo la reacción
// detectada. No toca el DOM ni la cámara al importarse.
//
// La cara de reposo de cada jugador ante una webcam normal varía demasiado (luz, ángulo,
// expresividad) para fiarse del valor ABSOLUTO de un solo fotograma: por eso se comparan 3
// fotogramas por evento (antes/durante/después, ver `capturarPico`) y se juzga por el CAMBIO
// respecto al "antes" (`clasificarReaccion`), no por la emoción "en bruto" de cada uno.
//
// Partes:
//   1. Utilidades puras (puntuar expresiones, comparar 3 fotogramas, resumen de sesión) →
//      testeables sin DOM.
//   2. Cámara y face-api.js: 3 fotogramas puntuales por evento clave, nunca un bucle continuo
//      (cero impacto en los 60 FPS). Cualquier fallo (sin webcam, permiso denegado, CDN caído,
//      sin rostro…) se traga en silencio: el juego sigue exactamente igual.
//   3. Widget de UI: botón "📷 Medidor Emocional (Opcional)", indicador de esquina y el modal
//      de resumen al terminar la sesión.

import { toast } from "./ui.js";

// ───────────────────────── 1. Utilidades puras ─────────────────────────

/** Expresiones de face-api.js que cuentan como reacción positiva (alegría/sorpresa) y negativa
 * (tristeza, enfado, asco, miedo: decepción al perder). `neutral` no entra en ninguna: es la base. */
const CLAVES_POSITIVAS = ["happy", "surprised"];
const CLAVES_NEGATIVAS = ["sad", "angry", "disgusted", "fearful"];

/** 3 reacciones posibles (lo único que ve el jugador: no hace falta más granularidad). */
export const REACCIONES = Object.freeze({
  contento_sorprendido: Object.freeze({ icono: "😲", texto: "Contento / Sorprendido" }),
  triste_decepcion: Object.freeze({ icono: "😢", texto: "Triste / Decepción" }),
  sin_reaccion: Object.freeze({ icono: "😐", texto: "Sin reacción" }),
});

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
 * Suma de probabilidad positiva/negativa de UN fotograma de expresiones de face-api.js
 * (`{neutral, happy, sad, …}` en 0..1 cada una). `null` (sin rostro detectado) puntúa 0 en ambas.
 * Pura.
 * @param {Record<string, number>|null} expresiones
 * @returns {{positivo:number, negativo:number}}
 */
export function puntuarEmocion(expresiones) {
  const suma = (claves) => claves.reduce((s, k) => s + (Number(expresiones?.[k]) || 0), 0);
  return { positivo: suma(CLAVES_POSITIVAS), negativo: suma(CLAVES_NEGATIVAS) };
}

/** A partir de qué subida (0..1) de positivo/negativo respecto al "antes" se considera una reacción de verdad. */
export const UMBRAL_REACCION = 0.15;

/**
 * Compara 3 fotogramas de un mismo evento (`antes` del momento clave, `durante` y `después`,
 * cada uno expresiones de face-api.js o `null` si no se detectó rostro) y decide la reacción
 * por el CAMBIO respecto al "antes": cuánto sube lo positivo o lo negativo en el pico de
 * durante/después frente a la cara de referencia. Pura.
 * @param {{antes?: object|null, durante?: object|null, despues?: object|null}} fotogramas
 * @returns {{reaccion: keyof typeof REACCIONES, deltaPositivo:number, deltaNegativo:number}}
 */
export function clasificarReaccion({ antes = null, durante = null, despues = null } = {}) {
  const base = puntuarEmocion(antes);
  const pico = [durante, despues].map(puntuarEmocion);
  const picoPositivo = Math.max(0, ...pico.map((p) => p.positivo));
  const picoNegativo = Math.max(0, ...pico.map((p) => p.negativo));
  const deltaPositivo = Math.round((picoPositivo - base.positivo) * 100) / 100;
  const deltaNegativo = Math.round((picoNegativo - base.negativo) * 100) / 100;
  let reaccion = "sin_reaccion";
  if (deltaPositivo >= UMBRAL_REACCION && deltaPositivo >= deltaNegativo) reaccion = "contento_sorprendido";
  else if (deltaNegativo >= UMBRAL_REACCION && deltaNegativo > deltaPositivo) reaccion = "triste_decepcion";
  return { reaccion, deltaPositivo, deltaNegativo };
}

/**
 * Pico de reacción para un evento clave: `{evento, reaccion, deltaPositivo, deltaNegativo, timestamp}`.
 * @param {string} evento una clave de EVENTOS_EMOCION
 * @param {{antes?: object|null, durante?: object|null, despues?: object|null}} fotogramas
 */
export function crearPico(evento, fotogramas, ahora = Date.now()) {
  return { evento, ...clasificarReaccion(fotogramas), timestamp: ahora };
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

/** Intensidad (0..100) de un pico: lo que más cambió, sea positivo o negativo. */
const intensidad = (p) => Math.max(0, Math.round(Math.max(p.deltaPositivo, p.deltaNegativo) * 100));

/**
 * Resumen de UX research de una sesión: el pico más intenso (mayor cambio frente al "antes")
 * de cada tipo de evento que haya ocurrido, más una conclusión. Pura.
 * @param {Array<{evento:string, reaccion:string, deltaPositivo:number, deltaNegativo:number, timestamp:number}>} historial
 * @returns {{picos: Array<{evento:string, etiqueta:string, icono:string, reaccion:string, reaccionIcono:string, reaccionTexto:string, porcentaje:number}>, media:number, conclusion:string}}
 */
export function resumenSesion(historial = []) {
  const picos = [];
  for (const [evento, meta] of Object.entries(EVENTOS_EMOCION)) {
    const deEsteTipo = historial.filter((p) => p.evento === evento);
    if (!deEsteTipo.length) continue;
    const pico = deEsteTipo.reduce((a, b) => (intensidad(b) > intensidad(a) ? b : a));
    const r = REACCIONES[pico.reaccion] ?? REACCIONES.sin_reaccion;
    picos.push({ evento, etiqueta: meta.etiqueta, icono: meta.icono, reaccion: pico.reaccion, reaccionIcono: r.icono, reaccionTexto: r.texto, porcentaje: intensidad(pico) });
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
  ultimoPico: null,
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

/** "hace 3 s" / "hace 2 min", para el detalle del último pico en el popover. */
function haceTiempo(timestamp) {
  const s = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (s < 5) return "justo ahora";
  if (s < 60) return `hace ${s} s`;
  return `hace ${Math.round(s / 60)} min`;
}

function cerrarPopover() {
  const el = document.getElementById("emo-popover");
  if (el) el.hidden = true;
  document.removeEventListener("click", alClicFueraPopover, true);
  document.removeEventListener("keydown", alEscapePopover);
}
function alClicFueraPopover(ev) {
  if (!ev.target.closest?.("#emo-popover, #emo-indicador")) cerrarPopover();
}
function alEscapePopover(ev) {
  if (ev.key === "Escape") cerrarPopover();
}

/** Popover con la última reacción detectada (o un aviso si aún no hay ninguna). Al pulsar el icono de la esquina. */
function abrirPopover() {
  let el = document.getElementById("emo-popover");
  if (!el) {
    el = document.createElement("div");
    el.id = "emo-popover";
    el.className = "emo-popover";
    el.setAttribute("role", "status");
    document.body.append(el);
  }
  const p = estado.ultimoPico;
  const meta = p ? EVENTOS_EMOCION[p.evento] : null;
  const r = p ? (REACCIONES[p.reaccion] ?? REACCIONES.sin_reaccion) : null;
  el.replaceChildren(
    h("div", { class: "emo-popover-cabeza" }, "📷 Medidor emocional"),
    p
      ? h("div", { class: "emo-popover-cuerpo" },
          h("div", { class: "emo-popover-evento" }, `${meta?.icono ?? ""} ${meta?.etiqueta ?? p.evento}`),
          h("div", { class: "emo-popover-reaccion" }, `${r.icono} ${r.texto}`),
          h("div", { class: "emo-popover-detalle" }, `Cambio frente al "antes": +${Math.round(p.deltaPositivo * 100)} % positivo · +${Math.round(p.deltaNegativo * 100)} % negativo`),
          h("div", { class: "emo-popover-hace" }, haceTiempo(p.timestamp)))
      : h("p", { class: "tenue" }, "Aún no se detectó ninguna reacción. Se mide en el próximo cofre Raro/Legendario, Jefe vencido o derrota con racha."),
    h("p", { class: "emo-popover-nota" }, "100 % local: nada se envía ni se guarda ninguna foto."));
  el.hidden = false;
  document.addEventListener("click", alClicFueraPopover, true);
  document.addEventListener("keydown", alEscapePopover);
}

function indicador() {
  let el = document.getElementById("emo-indicador");
  if (!el) {
    el = document.createElement("button");
    el.type = "button";
    el.id = "emo-indicador";
    el.className = "emo-indicador";
    el.hidden = true;
    el.setAttribute("aria-haspopup", "true");
    el.title = "Medidor emocional: pulsa para ver el detalle";
    el.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const popoverAbierto = document.getElementById("emo-popover") && !document.getElementById("emo-popover").hidden;
      if (popoverAbierto) cerrarPopover(); else abrirPopover();
    });
    document.body.append(el);
  }
  return el;
}

function actualizarIndicador(reaccion) {
  const el = indicador();
  el.textContent = (REACCIONES[reaccion] ?? REACCIONES.sin_reaccion).icono;
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
    actualizarIndicador("sin_reaccion");
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
  cerrarPopover();
  const el = document.getElementById("emo-indicador");
  if (el) el.hidden = true;
}

/** Enciende/apaga el medidor (botón de la barra superior). Devuelve si quedó activo. */
export async function alternarMedidor() {
  if (estado.activo) { desactivarMedidor(); return false; }
  return activarMedidor();
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
/** Cuándo se toman los fotogramas "durante" y "después", en ms desde la llamada a `capturarPico`
 * (que en sí misma ya captura el "antes": el instante exacto del evento clave). */
const RETRASO_DURANTE_MS = 500;
const RETRASO_DESPUES_MS = 1400;

/** Un fotograma suelto del vídeo oculto, analizado con face-api.js. `null` si no hay rostro o algo falla. */
async function fotogramaExpresiones() {
  if (!estado.video) return null;
  try {
    const faceapi = await cargarFaceApi();
    if (!estado.canvas) estado.canvas = document.createElement("canvas");
    const cv = estado.canvas;
    cv.width = estado.video.videoWidth || 160;
    cv.height = estado.video.videoHeight || 120;
    cv.getContext("2d").drawImage(estado.video, 0, 0, cv.width, cv.height);
    const deteccion = await faceapi.detectSingleFace(cv, new faceapi.TinyFaceDetectorOptions()).withFaceExpressions();
    return deteccion?.expressions ?? null;
  } catch (e) {
    console.warn("[emociones] fotograma omitido:", e?.message ?? e);
    return null;
  }
}

/**
 * Mide la reacción del jugador ante un evento clave con 3 fotogramas puntuales (nunca un bucle,
 * cero impacto en los 60 FPS): uno AHORA ("antes", el instante exacto del evento), otro a los
 * `RETRASO_DURANTE_MS` ("durante", mientras procesa lo que ha pasado) y otro a los
 * `RETRASO_DESPUES_MS` ("después", reacción ya asentada). Se compara el cambio frente al "antes"
 * (ver `clasificarReaccion`) en vez de fiarse de un único fotograma absoluto, porque una sola foto
 * de una webcam normal no es fiable para saber si alguien está "contento" o solo tiene esa cara.
 * No hace nada si el medidor no está activo. Nunca lanza ni bloquea el flujo del juego: los
 * fotogramas de después se toman en segundo plano, así que esta función no bloquea al llamador
 * más que lo que tarda el primer fotograma ("antes").
 * @param {keyof typeof EVENTOS_EMOCION} tipoEvento
 * @returns {Promise<void>}
 */
export async function capturarPico(tipoEvento) {
  if (!estado.activo || !estado.video || !EVENTOS_EMOCION[tipoEvento]) return;
  const antes = await fotogramaExpresiones();
  (async () => {
    await esperar(RETRASO_DURANTE_MS);
    const durante = await fotogramaExpresiones();
    await esperar(RETRASO_DESPUES_MS - RETRASO_DURANTE_MS);
    const despues = await fotogramaExpresiones();
    const pico = crearPico(tipoEvento, { antes, durante, despues });
    estado.historial = registrarPico(estado.historial, pico);
    estado.ultimoPico = pico;
    actualizarIndicador(pico.reaccion);
  })().catch((e) => console.warn("[emociones] captura omitida:", e?.message ?? e));
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
        h("strong", {}, `${p.reaccionIcono} ${p.reaccionTexto} (${p.porcentaje}%)`))));
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
