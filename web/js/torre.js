// Torre infinita (MEJORAS-1.3 §5): subida de pisos con la vida acumulada.
//
// · Lógica pura (sin DOM ni red): `nuevaTorre`, `enemigoDePiso`, `combateDePiso`, `trasVictoria`,
//   `trasDerrota`, récord personal con `storage` inyectable. Usa combat.js sin modificarlo.
// · Cliente del servidor: `enviarPiso` (POST /torre) y `pedirRankingTorre` (GET /torre/ranking),
//   con timeout y reintento ante 503 (Render dormido). Nunca lanzan.
// · UI: `renderTorre(contenedor, {...})`. El combate en sí lo pinta la arena de main.js.
//
// Convención de pisos: `torre.piso` es el piso que se está luchando (empieza en 1).
// Lo que se registra (récord, ranking, POST /torre) son los PISOS SUPERADOS: caer en el piso 7
// cuenta como 6. Tras cada victoria se envía el piso recién superado, así el servidor ve que
// el récord sube de uno en uno (valida récord + 1 como máximo).

import { generarEnemigo, crearCombate, clampNivel, NIVEL_MAX, POCIONES_POR_EXPEDICION, pocionesRestantes } from "./combat.js";

export const TORRE = Object.freeze({
  /** Cada cuántos pisos hay jefe (y botín). */
  cadaJefe: 5,
  /** Curación entre pisos: fracción de la vida máxima. */
  curaEntrePisos: 0.2,
  /** Pisos por cada nivel de enemigo (1..10). */
  pisosPorNivel: 3,
  /**
   * Multiplicadores de vida y ataque enemigos: empiezan bajos (la vida no se recupera del todo)
   * y crecen por piso. `factorAtaque.inicial` subió de 0,5 a 0,64 cuando se suavizó la curva de
   * `ESCALA_ENEMIGO` (combat.js) para arreglar el recibimiento: los pisos bajos se volvieron
   * fáciles y la mediana de la subida sin equipo se fue de 7 a 9 pisos. Con 0,64 vuelve a 5–8.
   */
  factorVida: Object.freeze({ inicial: 0.6, porPiso: 0.03 }),
  factorAtaque: Object.freeze({ inicial: 0.64, porPiso: 0.02 }),
  /** Ajuste extra de los jefes de la torre (los de combat.js están pensados para llegar con la vida llena). */
  jefe: Object.freeze({ vida: 0.65, ataque: 0.9 }),
  /** Pociones al empezar la subida (se conservan entre pisos). */
  pociones: POCIONES_POR_EXPEDICION,
  /** XP por piso superado: base + porPiso × piso (×multJefe en pisos de jefe). */
  xpBase: 8,
  xpPorPiso: 3,
  multXpJefe: 2,
});

const VERSION = 1;
const ent = (x, def = 0) => (Number.isFinite(Number(x)) ? Math.floor(Number(x)) : def);

// ───────────────────────── Escalado ─────────────────────────

/** ¿El piso `piso` es de jefe? (5, 10, 15…) */
export function esPisoJefe(piso) {
  const p = ent(piso);
  return p > 0 && p % TORRE.cadaJefe === 0;
}

/** Nivel de enemigo (1..10) del piso: sube uno cada `pisosPorNivel` pisos. */
export function nivelDePiso(piso) {
  return clampNivel(1 + Math.floor((Math.max(1, ent(piso, 1)) - 1) / TORRE.pisosPorNivel));
}

/** Multiplicadores de vida y ataque enemigos del piso (suaves, sin techo: la torre no se acaba). */
export function factorDePiso(piso) {
  const k = Math.max(1, ent(piso, 1)) - 1;
  return { vida: TORRE.factorVida.inicial + TORRE.factorVida.porPiso * k, ataque: TORRE.factorAtaque.inicial + TORRE.factorAtaque.porPiso * k };
}

/**
 * Enemigo del piso: `generarEnemigo` del nivel del piso (jefe cada 5) con vida y ataque
 * escalados por `factorDePiso`. Añade `piso` y antepone «Piso N» al nombre.
 * @param {number} piso ≥ 1
 * @param {() => number} [rng]
 */
export function enemigoDePiso(piso, rng = Math.random) {
  const p = Math.max(1, ent(piso, 1));
  const jefe = esPisoJefe(p);
  const base = generarEnemigo(nivelDePiso(p), rng, { jefe });
  const f = factorDePiso(p);
  const fj = jefe ? TORRE.jefe : { vida: 1, ataque: 1 };
  return {
    ...base,
    piso: p,
    vidaMax: Math.max(1, Math.round(base.vidaMax * f.vida * fj.vida)),
    ataque: Math.max(1, Math.round(base.ataque * f.ataque * fj.ataque)),
    // La defensa crece aparte y muy despacio a partir del nivel máximo.
    defensa: base.defensa + (p > NIVEL_MAX * TORRE.pisosPorNivel ? Math.floor((p - NIVEL_MAX * TORRE.pisosPorNivel) / 6) : 0),
  };
}

// ───────────────────────── Estado de la subida ─────────────────────────

/**
 * Empieza una subida.
 * @param {object} heroe stats de `progression.statsHeroe(progreso, equipados)`
 * @param {{pocionesExtra?:number}} [opciones] pociones compradas que se llevan a la torre
 * @returns {Torre}
 *
 * @typedef {Object} Torre
 * @property {number} version
 * @property {"en_curso"|"terminada"} estado
 * @property {object} heroe copia de las stats (vidaMax, ataque, defensa, habilidades…)
 * @property {number} piso piso que toca luchar (1, 2, …)
 * @property {number} vida vida actual (se conserva entre pisos)
 * @property {number} vidaMax
 * @property {number} pociones pociones normales que quedan
 * @property {number} pocionesExtra pociones compradas que quedan
 * @property {number} pocionesExtraGastadas pociones compradas gastadas (a quemar del ERC-1155)
 * @property {number} xp XP acumulada en la subida
 * @property {Array<{nivel:number, jefe:true, piso:number}>} botines botines ganados (reclamar con /ganar jefe:true)
 * @property {number} turnos turnos totales luchados
 */
export function nuevaTorre(heroe, { pocionesExtra = 0 } = {}) {
  if (!heroe || !Number.isFinite(Number(heroe.vidaMax ?? heroe.vida))) throw new Error("nuevaTorre: faltan las stats del héroe");
  const vidaMax = Math.round(Number(heroe.vidaMax ?? heroe.vida));
  return {
    version: VERSION,
    estado: "en_curso",
    heroe: { ...heroe, vidaMax, vida: vidaMax },
    piso: 1,
    vida: vidaMax,
    vidaMax,
    pociones: TORRE.pociones,
    pocionesExtra: Math.max(0, ent(pocionesExtra)),
    pocionesExtraGastadas: 0,
    xp: 0,
    botines: [],
    turnos: 0,
  };
}

/**
 * Crea el combate del piso actual con la vida y pociones acumuladas.
 * (crearCombate siempre empieza con la vida llena; aquí se ajusta sin tocar combat.js.)
 * @param {Torre} torre
 * @param {() => number} [rng]
 * @param {object} [enemigo] por defecto `enemigoDePiso(torre.piso, rng)`
 */
export function combateDePiso(torre, rng = Math.random, enemigo = null) {
  if (torre?.estado !== "en_curso") throw new Error("La subida ya ha terminado");
  const en = enemigo ?? enemigoDePiso(torre.piso, rng);
  const c = crearCombate({ ...torre.heroe, pociones: torre.pociones, pocionesExtra: torre.pocionesExtra }, en, rng);
  const vida = Math.max(1, Math.min(c.jugador.vidaMax, torre.vida));
  const log = c.log.map((e, i) => (i === 0 ? { ...e, vidas: { ...e.vidas, jugador: vida }, piso: torre.piso } : e));
  return { ...c, piso: torre.piso, jugador: { ...c.jugador, vida }, log };
}

/** XP por superar el piso `piso`. */
export function xpDePiso(piso) {
  const p = Math.max(1, ent(piso, 1));
  return Math.round((TORRE.xpBase + TORRE.xpPorPiso * p) * (esPisoJefe(p) ? TORRE.multXpJefe : 1));
}

/** Botín del piso (solo en pisos de jefe): `{nivel, jefe:true, piso}` para POST /ganar, o null. */
export function botinDePiso(piso) {
  const p = Math.max(1, ent(piso, 1));
  return esPisoJefe(p) ? { nivel: nivelDePiso(p), jefe: true, piso: p } : null;
}

/** Copia vida/pociones/turnos del combate terminado a la torre. */
function absorberCombate(torre, combate) {
  if (!combate) return { ...torre, botines: [...torre.botines] };
  const pr = pocionesRestantes(combate);
  return {
    ...torre,
    botines: [...torre.botines],
    vida: Math.max(0, Math.min(torre.vidaMax, combate.jugador.vida)),
    pociones: pr.pociones,
    pocionesExtra: pr.pocionesExtra,
    pocionesExtraGastadas: torre.pocionesExtraGastadas + pr.extraGastadas,
    turnos: torre.turnos + (combate.resumen?.turnos ?? 0),
  };
}

/**
 * Piso superado: toma vida y pociones del combate, cura `curaEntrePisos`, da XP y (cada 5) botín,
 * y sube al piso siguiente. No muta.
 * @param {Torre} torre
 * @param {object} [combate] combate ganado (de combateDePiso + turnoJugador); sin él se usa la vida de `torre`
 * @returns {{torre:Torre, superado:number, xp:number, botin:null|{nivel:number, jefe:true, piso:number}, curacion:number}}
 */
export function trasVictoria(torre, combate = null) {
  if (torre?.estado !== "en_curso") throw new Error("La subida ya ha terminado");
  if (combate && combate.fase !== "victoria") throw new Error("trasVictoria: el combate no es una victoria");
  const t = absorberCombate(torre, combate);
  const superado = t.piso;
  const vidaAntes = Math.max(1, t.vida);
  const vida = Math.min(t.vidaMax, vidaAntes + Math.round(t.vidaMax * TORRE.curaEntrePisos));
  const xp = xpDePiso(superado);
  const botin = botinDePiso(superado);
  if (botin) t.botines.push(botin);
  return {
    torre: { ...t, piso: superado + 1, vida, xp: t.xp + xp },
    superado, xp, botin, curacion: vida - vidaAntes,
  };
}

/**
 * Caída (derrota o huida): cierra la subida y actualiza el récord si se pasa `storage`.
 * @param {Torre} torre
 * @param {object} [combate] combate perdido (para sumar turnos y pociones gastadas)
 * @param {{storage?:Storage, address?:string}} [opciones] si se da `storage`, guarda el récord
 * @returns {Resultado}
 *
 * @typedef {Object} Resultado
 * @property {"terminada"} estado
 * @property {number} piso piso en el que se cayó
 * @property {number} pisosSuperados lo que cuenta para récord y ranking (piso − 1)
 * @property {number} xp XP total ganada
 * @property {Array} botines botines ganados
 * @property {number} turnos
 * @property {number} pocionesExtraGastadas
 * @property {number} recordAnterior
 * @property {number} record
 * @property {boolean} nuevoRecord
 */
export function trasDerrota(torre, combate = null, { storage = null, address = null } = {}) {
  if (!torre || !Number.isFinite(torre.piso)) throw new Error("trasDerrota: torre inválida");
  const t = absorberCombate(torre, combate);
  const pisosSuperados = Math.max(0, t.piso - 1);
  const recordAnterior = storage ? cargarRecord(storage, address) : 0;
  const record = Math.max(recordAnterior, pisosSuperados);
  if (storage && record > recordAnterior) guardarRecord(storage, address, record);
  return {
    estado: "terminada",
    piso: t.piso,
    pisosSuperados,
    xp: t.xp,
    botines: t.botines,
    turnos: t.turnos,
    pocionesExtraGastadas: t.pocionesExtraGastadas,
    vidaMax: t.vidaMax,
    recordAnterior,
    record,
    nuevoRecord: pisosSuperados > recordAnterior,
  };
}

// ───────────────────────── Récord personal ─────────────────────────

/** Clave de storage del récord (por dirección en minúsculas, o "invitado"). */
export function claveRecord(address) {
  return `lootarena:torre:record:${address ? String(address).toLowerCase() : "invitado"}`;
}

/** Récord de pisos superados (0 si no hay o está corrupto). Nunca lanza. */
export function cargarRecord(storage = globalThis.localStorage, address = null) {
  try {
    const v = ent(storage?.getItem(claveRecord(address)), 0);
    return v > 0 ? v : 0;
  } catch { return 0; }
}

/** Guarda el récord (solo si es mayor que el guardado). Devuelve el récord resultante. Nunca lanza. */
export function guardarRecord(storage = globalThis.localStorage, address = null, pisos = 0) {
  const actual = cargarRecord(storage, address);
  const nuevo = Math.max(actual, Math.max(0, ent(pisos)));
  try { if (nuevo > actual) storage?.setItem(claveRecord(address), String(nuevo)); } catch { /* sin almacenamiento */ }
  return nuevo;
}

// ───────────────────────── Cliente del servidor ─────────────────────────

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/** fetch con timeout y reintentos ante 503 (y fallos de red). Devuelve {status, body} o {error}. */
async function pedir(url, init, { fetchImpl = fetch, timeoutMs = 15_000, reintentos = 2, esperaMs = 2_000, dormir = esperar } = {}) {
  let ultimo = null;
  for (let intento = 0; intento <= reintentos; intento++) {
    if (intento > 0) await dormir(esperaMs * intento);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { ...init, signal: ctrl.signal });
      let body = null;
      try { body = await res.json(); } catch { /* cuerpo no JSON */ }
      if (res.status === 503 && intento < reintentos) { ultimo = { status: 503, body }; continue; }
      return { status: res.status, body };
    } catch (e) {
      ultimo = { error: e?.name === "AbortError" ? "El servidor tardó demasiado en responder" : "No se pudo contactar con el servidor" };
      if (e?.name === "AbortError") return ultimo; // un timeout no se reintenta (ya esperamos bastante)
    } finally {
      clearTimeout(t);
    }
  }
  return ultimo;
}

const mensajeError = (r, def) => r?.error ?? (typeof r?.body?.error === "string" ? r.body.error : r?.status === 503 ? "El servidor está arrancando; inténtalo en un minuto" : `${def} (HTTP ${r?.status})`);

/**
 * POST {serverUrl}/torre {address, piso, turnos}: registra los pisos superados.
 * @param {string} serverUrl
 * @param {string} address
 * @param {number} piso pisos superados (récord + 1 como máximo, lo valida el servidor)
 * @param {number} turnos turnos totales de la subida
 * @param {{fetchImpl?, timeoutMs?, reintentos?, esperaMs?, dormir?}} [opciones]
 * @returns {Promise<{ok:true, body:object|null} | {ok:false, mensaje:string, status?:number}>}
 */
export async function enviarPiso(serverUrl, address, piso, turnos, opciones = {}) {
  if (!serverUrl || !address) return { ok: false, mensaje: "Conecta la cartera para entrar en el ranking" };
  const r = await pedir(`${serverUrl}/torre`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, piso: Math.max(0, ent(piso)), turnos: Math.max(0, ent(turnos)) }),
  }, opciones);
  if (r?.status >= 200 && r.status < 300) return { ok: true, body: r.body };
  return { ok: false, mensaje: mensajeError(r, "No se pudo registrar el piso"), ...(r?.status ? { status: r.status } : {}) };
}

/** Normaliza la lista del ranking: acepta `[...]`, `{ranking:[...]}` o `{top:[...]}`; ordena y corta a 20. */
export function normalizarRanking(body) {
  const lista = Array.isArray(body) ? body : Array.isArray(body?.ranking) ? body.ranking : Array.isArray(body?.top) ? body.top : [];
  return lista
    .filter((e) => e && typeof e.address === "string" && Number.isFinite(Number(e.piso)))
    .map((e) => ({ address: e.address, piso: Math.max(0, ent(e.piso)) }))
    .sort((a, b) => b.piso - a.piso)
    .slice(0, 20);
}

/**
 * GET {serverUrl}/torre/ranking → top 20 `{address, piso}`.
 * @returns {Promise<{ok:true, ranking:Array<{address:string, piso:number}>} | {ok:false, mensaje:string}>}
 */
export async function pedirRankingTorre(serverUrl, opciones = {}) {
  if (!serverUrl) return { ok: false, mensaje: "Sin servidor configurado" };
  const r = await pedir(`${serverUrl}/torre/ranking`, { method: "GET" }, opciones);
  if (r?.status === 200) return { ok: true, ranking: normalizarRanking(r.body) };
  return { ok: false, mensaje: mensajeError(r, "No se pudo cargar el ranking") };
}

/** Posición (1..20) de `address` en el ranking, o 0 si no está. */
export function posicionEnRanking(ranking, address) {
  if (!address || !Array.isArray(ranking)) return 0;
  const a = String(address).toLowerCase();
  return ranking.findIndex((e) => String(e.address).toLowerCase() === a) + 1;
}

// ───────────────────────── UI ─────────────────────────

const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const corta = (a) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const MEDALLA = ["🥇", "🥈", "🥉"];

function htmlRanking(ranking, cuenta, record) {
  if (ranking == null) return `<p class="torre-tenue">Cargando ranking…</p>`;
  if (!Array.isArray(ranking)) return `<p class="torre-tenue">⚠️ ${esc(ranking.error ?? ranking.mensaje ?? "Ranking no disponible")}</p>`;
  if (!ranking.length) return `<p class="torre-tenue">Nadie ha subido todavía. ¡Sé el primero!</p>`;
  const pos = posicionEnRanking(ranking, cuenta);
  const filas = ranking.map((e, i) => {
    const yo = i + 1 === pos;
    return `<li class="torre-fila${yo ? " torre-yo" : ""}"${yo ? ' aria-current="true"' : ""}>
      <span class="torre-pos">${MEDALLA[i] ?? i + 1}</span>
      <span class="torre-dir" title="${esc(e.address)}">${yo ? "Tú · " : ""}${esc(corta(e.address))}</span>
      <span class="torre-pisos">${e.piso} ${e.piso === 1 ? "piso" : "pisos"}</span></li>`;
  }).join("");
  const pie = !cuenta ? `<p class="torre-tenue">Conecta la cartera para aparecer en el ranking.</p>`
    : pos ? `<p class="torre-tenue">Vas <strong>${pos}.º</strong> del ranking.</p>`
    : `<p class="torre-tenue">Aún no estás en el top 20${record ? ` (tu récord: ${record})` : ""}. ¡Sube más!</p>`;
  return `<ol class="torre-ranking">${filas}</ol>${pie}`;
}

function htmlVida(vida, vidaMax) {
  const pct = vidaMax > 0 ? Math.max(0, Math.min(100, Math.round((100 * vida) / vidaMax))) : 0;
  const tono = pct <= 30 ? " torre-vida-baja" : pct <= 60 ? " torre-vida-media" : "";
  return `<div class="torre-vida${tono}" role="meter" aria-label="Vida" aria-valuemin="0" aria-valuemax="${vidaMax}" aria-valuenow="${vida}">
    <div class="torre-vida-barra" style="width:${pct}%"></div><span>❤️ ${vida} / ${vidaMax}</span></div>`;
}

/**
 * Pinta la sección Torre.
 * @param {HTMLElement} contenedor
 * @param {{estado?: Torre|Resultado|null, ranking?: Array|null|{error:string}, cuenta?: string|null,
 *          record?: number, ultimo?: {superado:number, xp:number, botin:object|null, curacion:number}|null,
 *          onEmpezar?: () => void, onSiguientePiso?: () => void}} opciones
 *   `estado`: null (sin subida), la torre en curso (entre pisos) o el resultado de `trasDerrota`.
 *   `ranking`: lista de `pedirRankingTorre`, null mientras carga o `{error}`.
 *   `record`: récord personal (por defecto el del resultado o 0). `ultimo`: lo devuelto por `trasVictoria`.
 */
export function renderTorre(contenedor, { estado = null, ranking = null, cuenta = null, record = null, ultimo = null, onEmpezar = null, onSiguientePiso = null } = {}) {
  if (!contenedor) return;
  const rec = record ?? estado?.record ?? 0;
  let cuerpo;
  if (estado?.estado === "en_curso") {
    const jefe = esPisoJefe(estado.piso);
    const proximoJefe = TORRE.cadaJefe - ((estado.piso - 1) % TORRE.cadaJefe) - 1;
    const pociones = estado.pociones + estado.pocionesExtra;
    const aviso = ultimo ? `<p class="torre-aviso">✅ Piso ${ultimo.superado} superado · +${ultimo.xp} XP${ultimo.curacion ? ` · +${ultimo.curacion} ❤️` : ""}${ultimo.botin ? ` · 🎁 ¡Botín de jefe (nivel ${ultimo.botin.nivel})!` : ""}</p>` : "";
    cuerpo = `${aviso}
      <div class="torre-piso${jefe ? " torre-piso-jefe" : ""}">
        <span class="torre-piso-num">Piso ${estado.piso}</span>
        <span class="torre-piso-info">${jefe ? "👑 ¡Piso de jefe! Botín asegurado si ganas" : proximoJefe === 0 ? "👑 Jefe en este piso" : `Jefe en ${proximoJefe} ${proximoJefe === 1 ? "piso" : "pisos"}`}</span>
      </div>
      ${htmlVida(estado.vida, estado.vidaMax)}
      <ul class="torre-datos">
        <li>🧪 ${pociones} ${pociones === 1 ? "poción" : "pociones"}</li>
        <li>⭐ ${estado.xp} XP</li>
        <li>🎁 ${estado.botines.length} ${estado.botines.length === 1 ? "botín" : "botines"}</li>
        <li>🏆 Récord: ${rec}</li>
      </ul>
      <button type="button" class="btn btn-gold torre-btn" data-accion="siguiente">${jefe ? "👑 Luchar contra el jefe" : `⚔️ Luchar en el piso ${estado.piso}`}</button>
      <p class="torre-tenue">Entre pisos recuperas un ${Math.round(TORRE.curaEntrePisos * 100)} % de vida. Si caes, se acaba la subida.</p>`;
  } else if (estado?.estado === "terminada") {
    cuerpo = `<div class="torre-final${estado.nuevoRecord ? " torre-final-record" : ""}">
        <p class="torre-final-titulo">${estado.nuevoRecord ? "🏆 ¡Nuevo récord!" : "☠️ Has caído"}</p>
        <p>Caíste en el piso <strong>${estado.piso}</strong>: <strong>${estado.pisosSuperados}</strong> ${estado.pisosSuperados === 1 ? "piso superado" : "pisos superados"}.</p>
        <ul class="torre-datos">
          <li>⭐ ${estado.xp} XP</li>
          <li>🎁 ${estado.botines.length} ${estado.botines.length === 1 ? "botín" : "botines"}</li>
          <li>⏱️ ${estado.turnos} turnos</li>
          <li>🏆 Récord: ${rec}</li>
        </ul>
      </div>
      <button type="button" class="btn btn-gold torre-btn" data-accion="empezar">🗼 Volver a subir</button>`;
  } else {
    cuerpo = `<p>Sube piso a piso sin recuperar la vida del todo: cada piso es más duro, cada ${TORRE.cadaJefe} hay un jefe con botín.</p>
      <ul class="torre-datos"><li>🏆 Tu récord: ${rec} ${rec === 1 ? "piso" : "pisos"}</li><li>🧪 ${TORRE.pociones} pociones para toda la subida</li></ul>
      <button type="button" class="btn btn-gold torre-btn" data-accion="empezar">🗼 Empezar la subida</button>`;
  }
  contenedor.classList.add("torre");
  contenedor.innerHTML = `<div class="torre-grid">
      <section class="torre-estado" aria-label="Tu subida"><h2 class="torre-titulo">🗼 Torre infinita</h2>${cuerpo}</section>
      <section class="torre-top" aria-label="Ranking de la torre"><h3 class="torre-subtitulo">🏆 Top 20</h3>${htmlRanking(ranking, cuenta, rec)}</section>
    </div>`;
  contenedor.querySelector('[data-accion="empezar"]')?.addEventListener("click", () => onEmpezar?.());
  contenedor.querySelector('[data-accion="siguiente"]')?.addEventListener("click", () => onSiguientePiso?.());
}
