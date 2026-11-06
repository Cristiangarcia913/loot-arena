// Expediciones de Loot Arena 1.3 (MEJORAS-1.3.md §4): el héroe sale mientras el jugador no está.
//
// Partes:
//   1. Lógica pura (reloj y storage inyectables, una clave por dirección) → tests con node --test.
//      Una expedición a la vez; 15 min, 1 h, 4 h u 8 h. Al recoger da XP, pociones y quizá botín
//      (que main.js reclama con POST /ganar normal). Las largas dan menos XP por hora pero más botín.
//   2. UI: renderExpediciones(contenedor, {estado, onEnviar, onRecoger}) con cuenta atrás en vivo.
//
// No toca el DOM al importarse (solo dentro de renderExpediciones).

// ───────────────────────── 1. Lógica pura ─────────────────────────

const MIN = 60_000;
const HORA = 60 * MIN;

/**
 * Duraciones disponibles. xp por hora: 15 min → 120/h, 1 h → 90/h, 4 h → 70/h, 8 h → 60/h
 * (las cortas premian volver a menudo); el botín sube con la duración (probabilidad, nivel, jefe).
 */
export const DURACIONES = Object.freeze([
  Object.freeze({ id: "15m", nombre: "Patrulla", etiqueta: "15 min", ms: 15 * MIN, icono: "🌲", xp: 30, pociones: 0, probPocionExtra: 0.5, probBotin: 0.10, nivelBotin: 2, probJefe: 0 }),
  Object.freeze({ id: "1h", nombre: "Incursión", etiqueta: "1 h", ms: HORA, icono: "⛰️", xp: 90, pociones: 1, probPocionExtra: 0.3, probBotin: 0.25, nivelBotin: 4, probJefe: 0 }),
  Object.freeze({ id: "4h", nombre: "Mazmorra", etiqueta: "4 h", ms: 4 * HORA, icono: "🏰", xp: 280, pociones: 2, probPocionExtra: 0.3, probBotin: 0.5, nivelBotin: 6, probJefe: 0.1 }),
  Object.freeze({ id: "8h", nombre: "Gran viaje", etiqueta: "8 h", ms: 8 * HORA, icono: "🐉", xp: 480, pociones: 3, probPocionExtra: 0.5, probBotin: 0.8, nivelBotin: 8, probJefe: 0.3 }),
]);

/** Busca una duración por id ("15m", "1h", "4h", "8h"). */
export const duracionPorId = (id) => DURACIONES.find((d) => d.id === id) ?? null;

/** Clave de storage por dirección (minúsculas) o "invitado" en modo demo. */
export function claveExpedicion(address) {
  return `lootarena:expedicion:${address ? String(address).toLowerCase() : "invitado"}`;
}

/** Cuenta atrás "1:02:05" / "14:59" (nunca negativa). */
export function formatearRestante(ms) {
  const t = Math.max(0, Math.ceil(ms / 1000));
  const hh = Math.floor(t / 3600), mm = Math.floor((t % 3600) / 60), ss = t % 60;
  const p = (n) => String(n).padStart(2, "0");
  return hh ? `${hh}:${p(mm)}:${p(ss)}` : `${p(mm)}:${p(ss)}`;
}

/** Normaliza lo guardado (datos corruptos → sin expedición). */
function sanear(d) {
  const out = { actual: null, pendiente: null, completadas: 0 };
  if (!d || typeof d !== "object") return out;
  const a = d.actual;
  const dur = duracionPorId(a?.duracion);
  if (dur && Number.isFinite(a.inicio)) out.actual = { duracion: dur.id, inicio: a.inicio };
  const b = d.pendiente;
  if (b && Number.isInteger(b.nivel) && b.nivel >= 1 && b.nivel <= 10) out.pendiente = { nivel: b.nivel, jefe: !!b.jefe };
  out.completadas = Math.max(0, Math.floor(Number(d.completadas) || 0));
  return out;
}

/**
 * Crea las funciones de expedición con storage y reloj inyectables.
 * @param {{storage?: {getItem(k):string|null, setItem(k,v):void}, reloj?: () => number}} [opts]
 */
export function crearExpediciones({ storage, reloj = () => Date.now() } = {}) {
  const st = () => storage ?? globalThis.localStorage;
  const cargar = (clave) => {
    try { return sanear(JSON.parse(st()?.getItem(clave) ?? "null")); } catch { return sanear(null); }
  };
  const guardar = (clave, d) => { try { st()?.setItem(clave, JSON.stringify(d)); } catch { /* storage lleno o bloqueado */ } };

  /** ms que faltan (0 si está lista o no hay expedición). Si el reloj va hacia atrás, nunca más que la duración. */
  function tiempoRestante(clave, ahora = reloj()) {
    const { actual } = cargar(clave);
    if (!actual) return 0;
    const dur = duracionPorId(actual.duracion);
    return Math.min(dur.ms, Math.max(0, actual.inicio + dur.ms - ahora));
  }

  /**
   * @returns {{estado:"libre"|"en_curso"|"lista", duracion:object|null, inicio:number|null, fin:number|null,
   *            restanteMs:number, progreso:number, botinPendiente:{nivel:number, jefe:boolean}|null, completadas:number}}
   */
  function estadoExpedicion(clave, ahora = reloj()) {
    const d = cargar(clave);
    const base = { botinPendiente: d.pendiente, completadas: d.completadas };
    if (!d.actual) return { estado: "libre", duracion: null, inicio: null, fin: null, restanteMs: 0, progreso: 0, ...base };
    const dur = duracionPorId(d.actual.duracion);
    const restanteMs = tiempoRestante(clave, ahora);
    return {
      estado: restanteMs === 0 ? "lista" : "en_curso",
      duracion: dur, inicio: d.actual.inicio, fin: d.actual.inicio + dur.ms,
      restanteMs, progreso: 1 - restanteMs / dur.ms, ...base,
    };
  }

  /** Envía al héroe. Falla si ya hay una expedición (en curso o sin recoger) o la duración no existe. */
  function enviar(clave, duracion, ahora = reloj()) {
    const dur = duracionPorId(typeof duracion === "object" ? duracion?.id : duracion);
    if (!dur) return { ok: false, motivo: "duracion", mensaje: "Duración de expedición no válida." };
    const d = cargar(clave);
    if (d.actual) {
      const lista = tiempoRestante(clave, ahora) === 0;
      return { ok: false, motivo: lista ? "sin_recoger" : "en_curso", mensaje: lista ? "Recoge primero la expedición que ha vuelto." : "Tu héroe ya está de expedición." };
    }
    d.actual = { duracion: dur.id, inicio: ahora };
    guardar(clave, d);
    return { ok: true, estado: estadoExpedicion(clave, ahora) };
  }

  /**
   * Recoge la expedición terminada. El botín (si sale) queda además como `botinPendiente` hasta que
   * main.js llame a `resolverBotin(clave)` tras reclamarlo con éxito en POST /ganar.
   * @returns {{ok:true, duracion:object, xp:number, pociones:number, botin:{nivel:number, jefe:boolean}|null}
   *         | {ok:false, motivo:"sin_expedicion"|"aun_no", mensaje:string, restanteMs?:number}}
   */
  function recoger(clave, ahora = reloj(), rng = Math.random) {
    const d = cargar(clave);
    if (!d.actual) return { ok: false, motivo: "sin_expedicion", mensaje: "No hay ninguna expedición que recoger." };
    const restanteMs = tiempoRestante(clave, ahora);
    if (restanteMs > 0) return { ok: false, motivo: "aun_no", mensaje: `Tu héroe vuelve en ${formatearRestante(restanteMs)}.`, restanteMs };
    const dur = duracionPorId(d.actual.duracion);
    const pociones = dur.pociones + (rng() < dur.probPocionExtra ? 1 : 0);
    let botin = null;
    if (rng() < dur.probBotin) {
      const jefe = rng() < dur.probJefe;
      botin = { nivel: Math.min(10, dur.nivelBotin + (jefe ? 2 : 0)), jefe };
    }
    d.actual = null;
    d.completadas += 1;
    if (botin) d.pendiente = botin;
    guardar(clave, d);
    return { ok: true, duracion: dur, xp: dur.xp, pociones, botin };
  }

  /** Cancela una expedición en curso sin recompensa. */
  function cancelar(clave) {
    const d = cargar(clave);
    if (!d.actual) return false;
    d.actual = null;
    guardar(clave, d);
    return true;
  }

  /** Botín ganado aún sin reclamar al servidor (p. ej. /ganar falló o se cerró la página). */
  const botinPendiente = (clave) => cargar(clave).pendiente;
  /** Marca el botín pendiente como reclamado. */
  function resolverBotin(clave) {
    const d = cargar(clave);
    d.pendiente = null;
    guardar(clave, d);
  }

  /** true si hay una expedición terminada sin recoger (aviso del menú). */
  const hayExpedicionLista = (clave, ahora = reloj()) => estadoExpedicion(clave, ahora).estado === "lista";

  return { estadoExpedicion, enviar, recoger, tiempoRestante, cancelar, botinPendiente, resolverBotin, hayExpedicionLista };
}

// Funciones listas para usar con localStorage y Date.now.
const DEF = crearExpediciones();
export const { estadoExpedicion, enviar, recoger, tiempoRestante, cancelar, botinPendiente, resolverBotin, hayExpedicionLista } = DEF;

// ───────────────────────── 2. UI ─────────────────────────

function el(tag, props = {}, ...hijos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of hijos.flat()) if (c != null && c !== false) e.append(c instanceof Node ? c : String(c));
  return e;
}

const pct = (p) => `${Math.round(p * 100)}%`;

function tarjetaDuracion(dur, onEnviar, ocupado) {
  const pBotin = Math.round(dur.probBotin * 100);
  return el("button", {
    type: "button", class: "exp-tarjeta", "data-duracion": dur.id, disabled: ocupado || !onEnviar,
    "aria-label": `${dur.nombre}, ${dur.etiqueta}: ${dur.xp} XP, ${pBotin}% de botín`,
    onclick: () => onEnviar?.(dur.id),
  },
  el("span", { class: "exp-icono", "aria-hidden": "true" }, dur.icono),
  el("strong", { class: "exp-nombre" }, dur.nombre),
  el("span", { class: "exp-tiempo" }, `⏳ ${dur.etiqueta}`),
  el("ul", { class: "exp-premios" },
    el("li", {}, `✨ ${dur.xp} XP`),
    el("li", {}, `🧪 ${dur.pociones}${dur.probPocionExtra ? "–" + (dur.pociones + 1) : ""} pociones`),
    el("li", {}, `🎁 ${pBotin}% botín · nv ${dur.nivelBotin}${dur.probJefe ? " · jefe" : ""}`)));
}

/**
 * Pinta la sección de expediciones dentro de `contenedor`.
 * @param {HTMLElement} contenedor
 * @param {{estado: ReturnType<typeof estadoExpedicion>, onEnviar?: (id:string) => void,
 *          onRecoger?: () => void, resultado?: object|null, reloj?: () => number,
 *          onLista?: () => void}} opts
 *   - `resultado`: lo que devolvió `recoger` para mostrar el resumen animado del regreso.
 *   - `reloj`: reloj de la cuenta atrás (por defecto Date.now; la demo lo acelera).
 *   - `onLista`: se llama una vez cuando la cuenta atrás llega a 0 (para refrescar estado y aviso del menú).
 * @returns {{destruir(): void}}
 */
export function renderExpediciones(contenedor, { estado, onEnviar, onRecoger, resultado = null, reloj = () => Date.now(), onLista } = {}) {
  contenedor._expediciones?.destruir();
  contenedor.replaceChildren();
  contenedor.classList.add("exp");
  const e = estado ?? { estado: "libre" };
  let timer = null;

  contenedor.append(el("header", { class: "exp-cabecera" },
    el("h2", {}, "🧭 Expediciones"),
    el("p", { class: "exp-sub" }, "Envía a tu héroe mientras no juegas. Vuelve con XP, pociones y, a veces, botín.")));

  if (resultado?.ok) {
    const b = resultado.botin;
    contenedor.append(el("div", { class: "exp-resultado", role: "status" },
      el("strong", {}, `${resultado.duracion?.icono ?? "🎒"} ¡Tu héroe ha vuelto!`),
      el("div", { class: "exp-res-lista" },
        el("span", { class: "exp-res-item" }, `✨ +${resultado.xp} XP`),
        resultado.pociones > 0 && el("span", { class: "exp-res-item" }, `🧪 +${resultado.pociones} poción(es)`),
        el("span", { class: `exp-res-item${b ? " exp-res-botin" : ""}` }, b ? `🎁 Botín de nivel ${b.nivel}${b.jefe ? " (jefe)" : ""}` : "Sin botín esta vez"))));
  }

  if (e.estado === "en_curso" || e.estado === "lista") {
    const lista = e.estado === "lista";
    const dur = e.duracion;
    const tiempo = el("span", { class: "exp-cuenta", "aria-live": "off" }, lista ? "¡Ha vuelto!" : formatearRestante(e.restanteMs));
    const barra = el("span", { class: "exp-barra-relleno" });
    barra.style.width = pct(lista ? 1 : e.progreso);
    const btn = el("button", { type: "button", class: "btn btn-gold exp-recoger", disabled: !lista || !onRecoger, onclick: () => onRecoger?.() }, lista ? "🎒 Recoger" : "En camino…");
    const panel = el("div", { class: `exp-activa${lista ? " exp-lista" : ""}`, "data-estado": e.estado },
      el("div", { class: "exp-escena", "aria-hidden": "true" },
        el("span", { class: "exp-heroe" }, "🧙"), el("span", { class: "exp-destino" }, dur.icono), lista && el("span", { class: "exp-cofre" }, "🎁")),
      el("div", { class: "exp-info" },
        el("strong", {}, `${dur.nombre} · ${dur.etiqueta}`),
        el("span", { class: "exp-barra", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round((lista ? 1 : e.progreso) * 100)) }, barra),
        tiempo),
      btn);
    contenedor.append(panel);

    if (!lista) {
      let avisado = false;
      const tic = () => {
        if (!contenedor.isConnected) return parar();
        const restante = Math.min(dur.ms, Math.max(0, e.fin - reloj()));
        const p = 1 - restante / dur.ms;
        tiempo.textContent = formatearRestante(restante);
        barra.style.width = pct(p);
        barra.parentElement.setAttribute("aria-valuenow", String(Math.round(p * 100)));
        if (restante === 0 && !avisado) {
          avisado = true;
          parar();
          // Re-pinta en estado "lista" (con animación de regreso) y avisa al integrador.
          renderExpediciones(contenedor, { estado: { ...e, estado: "lista", restanteMs: 0, progreso: 1 }, onEnviar, onRecoger, reloj, onLista });
          onLista?.();
        }
      };
      timer = setInterval(tic, 250);
    }
  }

  const ocupado = e.estado !== "libre";
  contenedor.append(el("div", { class: "exp-tarjetas" }, DURACIONES.map((d) => tarjetaDuracion(d, onEnviar, ocupado))));
  if (ocupado) contenedor.append(el("p", { class: "exp-nota" }, "Solo una expedición a la vez."));

  function parar() { if (timer) { clearInterval(timer); timer = null; } }
  const handle = { destruir: parar };
  contenedor._expediciones = handle;
  return handle;
}
