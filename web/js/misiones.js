// Misiones diarias (3, iguales para todos ese día UTC) y misión semanal.
// Lógica pura: el tiempo (`ahora`, ms desde epoch) y el `storage` se inyectan.
// También exporta utilidades compartidas por pase.js, logros.js, coleccion.js y desafio.js.

import { mulberry32 } from "./combat.js";

// ───────────────────────── Utilidades compartidas ─────────────────────────

export const MS_DIA = 86_400_000;

/** Día UTC (entero) — igual que `diaOnChain` de economy.js y que `block.timestamp / 1 days`. */
export function diaUTC(ahora = Date.now()) {
  return Math.floor(Number(ahora) / MS_DIA);
}

/** Semana UTC (entero), empezando en lunes. El día 4 desde epoch (05-01-1970) fue lunes. */
export function semanaUTC(ahora = Date.now()) {
  return Math.floor((diaUTC(ahora) - 4) / 7);
}

/** ms que faltan para el siguiente cambio de día UTC. */
export function msHastaManana(ahora = Date.now()) {
  return (diaUTC(ahora) + 1) * MS_DIA - Number(ahora);
}

/** ms que faltan para el lunes 00:00 UTC siguiente. */
export function msHastaProximaSemana(ahora = Date.now()) {
  return ((semanaUTC(ahora) + 1) * 7 + 4) * MS_DIA - Number(ahora);
}

/** Hash entero estable de un texto (FNV-1a de 32 bits). */
export function hash32(texto) {
  let h = 0x811c9dc5;
  for (const ch of String(texto)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** rng determinista para una etiqueta ("misiones:20400", "desafio:20400"…). */
export function rngSembrado(etiqueta) {
  return mulberry32(hash32(etiqueta));
}

/** Lee JSON de un storage tolerante a fallos. Devuelve null si no hay o está corrupto. */
export function leerJSON(clave, storage = globalThis.localStorage) {
  try {
    const t = storage?.getItem(clave);
    return t ? JSON.parse(t) : null;
  } catch {
    return null;
  }
}

/** Escribe JSON; devuelve true si se pudo. */
export function escribirJSON(clave, valor, storage = globalThis.localStorage) {
  try {
    storage.setItem(clave, JSON.stringify(valor));
    return true;
  } catch {
    return false;
  }
}

/** Clave de almacenamiento por dirección (o "invitado"). */
export function claveJugador(modulo, address) {
  return `lootarena:${modulo}:${address ? String(address).toLowerCase() : "invitado"}`;
}

const entero = (v, min = 0) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.max(min, n) : min;
};

/**
 * Normaliza un evento de juego. Formas aceptadas (todas con `tipo`):
 *   victoria {nivel, jefe?, clave?, danoRecibido?, turnos?} · derrota · huida
 *   jefe {nivel?, clave?} (implícito en victoria con jefe:true)
 *   critico {cantidad=1} · habilidad {id, cantidad=1} · pocion {cantidad=1} · dano {cantidad}
 *   venta {cantidad=1, oro?} · cofre {cantidad=1} · compra {id?, cantidad=1}
 *   botin {item:{tipo, rareza}} · racha {valor} (racha de victorias actual)
 *   nivel {valor} (nivel de héroe) · diario {racha} (recompensa diaria reclamada)
 *   desafio {victoria:bool, puntuacion?} · mision {id} · pase {nivel}
 *   inventario {items:[{tipo,rareza}]} · cosmeticos {ids:[number]} (instantáneas)
 * @returns {{tipo:string, cantidad:number, [k:string]:any}|null}
 */
export function normalizarEvento(evento) {
  if (!evento || typeof evento !== "object" || typeof evento.tipo !== "string") return null;
  return { ...evento, cantidad: evento.cantidad == null ? 1 : entero(evento.cantidad) };
}

/**
 * Traduce un combate terminado a la lista de eventos que hay que registrar
 * (victoria/derrota/huida, jefe, críticos, habilidades, pociones y daño).
 * La racha y el botín los registra main.js aparte (dependen de progression y del servidor).
 * @param {object} combate el `combate` final devuelto por combat.turnoJugador / huir
 * @returns {Array<object>}
 */
export function eventosDeCombate(combate) {
  if (!combate || combate.fase === "en_curso") return [];
  const r = combate.resumen ?? {};
  const e = combate.enemigo ?? {};
  const ev = [];
  if (combate.fase === "victoria") {
    ev.push({ tipo: "victoria", nivel: e.nivel, jefe: !!e.jefe, clave: e.clave, danoRecibido: r.danoRecibido ?? 0, turnos: r.turnos ?? 0 });
    if (e.jefe) ev.push({ tipo: "jefe", nivel: e.nivel, clave: e.clave });
  } else if (combate.fase === "derrota") ev.push({ tipo: "derrota", nivel: e.nivel, clave: e.clave });
  else if (combate.fase === "huida") ev.push({ tipo: "huida", nivel: e.nivel, clave: e.clave });
  if (r.criticos) ev.push({ tipo: "critico", cantidad: r.criticos });
  if (r.habilidadesUsadas) ev.push({ tipo: "habilidad", cantidad: r.habilidadesUsadas });
  if (r.pocionesUsadas) ev.push({ tipo: "pocion", cantidad: r.pocionesUsadas });
  if (r.danoHecho) ev.push({ tipo: "dano", cantidad: r.danoHecho });
  return ev;
}

// ───────────────────────── Definiciones ─────────────────────────

/**
 * Plantillas de misión. `evento`: tipo de evento que cuenta. `modo`: "suma" (acumula `cantidad`)
 * o "maximo" (progreso = mayor `valor` visto, p. ej. racha). `filtro(ev)` opcional.
 * `cantidades`: objetivos posibles; `xp`/`puntos` por unidad de dificultad (índice en cantidades).
 */
export const PLANTILLAS_DIARIAS = Object.freeze([
  { id: "ganar", icono: "⚔️", texto: (n) => `Gana ${n} combates`, evento: "victoria", cantidades: [2, 3, 5] },
  { id: "habilidades", icono: "✨", texto: (n) => `Usa ${n} habilidades`, evento: "habilidad", cantidades: [3, 4, 6] },
  { id: "criticos", icono: "💥", texto: (n) => `Haz ${n} críticos`, evento: "critico", cantidades: [2, 3, 5] },
  { id: "jefe", icono: "👑", texto: () => "Vence a un jefe", evento: "jefe", cantidades: [1] },
  { id: "vender", icono: "💰", texto: (n) => (n === 1 ? "Vende 1 objeto" : `Vende ${n} objetos`), evento: "venta", cantidades: [1, 2] },
  { id: "cofre", icono: "🎁", texto: () => "Abre un cofre", evento: "cofre", cantidades: [1] },
  { id: "racha", icono: "🔥", texto: (n) => `Consigue una racha de ${n} victorias`, evento: "racha", modo: "maximo", cantidades: [3, 4] },
  { id: "pociones", icono: "🧪", texto: (n) => `Bebe ${n} pociones`, evento: "pocion", cantidades: [2, 3] },
  { id: "dano", icono: "🗡️", texto: (n) => `Inflige ${n} de daño`, evento: "dano", cantidades: [300, 600, 1000] },
  { id: "botin", icono: "💎", texto: (n) => (n === 1 ? "Consigue 1 objeto de botín" : `Consigue ${n} objetos de botín`), evento: "botin", cantidades: [1, 2] },
  { id: "intocable", icono: "🛡️", texto: () => "Gana un combate recibiendo menos de 20 de daño", evento: "victoria",
    filtro: (ev) => (ev.danoRecibido ?? Infinity) < 20, cantidades: [1] },
  { id: "desafio", icono: "🎯", texto: () => "Juega el desafío diario", evento: "desafio", cantidades: [1] },
].map((p) => Object.freeze(p)));

export const PLANTILLAS_SEMANALES = Object.freeze([
  { id: "jefes_semana", icono: "👑", texto: (n) => `Vence ${n} jefes`, evento: "jefe", cantidades: [3] },
  { id: "ganar_semana", icono: "⚔️", texto: (n) => `Gana ${n} combates`, evento: "victoria", cantidades: [25] },
  { id: "criticos_semana", icono: "💥", texto: (n) => `Haz ${n} críticos`, evento: "critico", cantidades: [30] },
  { id: "cofres_semana", icono: "🎁", texto: (n) => `Abre ${n} cofres`, evento: "cofre", cantidades: [3] },
  { id: "desafios_semana", icono: "🎯", texto: (n) => `Juega ${n} desafíos diarios`, evento: "desafio", cantidades: [5] },
  { id: "racha_semana", icono: "🔥", texto: (n) => `Consigue una racha de ${n} victorias`, evento: "racha", modo: "maximo", cantidades: [8] },
].map((p) => Object.freeze(p)));

/** Recompensas. Las diarias escalan con la dificultad (0, 1, 2). */
export const RECOMPENSA_DIARIA = Object.freeze([{ xp: 30, puntos: 30 }, { xp: 45, puntos: 40 }, { xp: 60, puntos: 50 }]);
export const RECOMPENSA_BONUS = Object.freeze({ xp: 75, puntos: 60, motivo: "misiones_diarias" });
export const RECOMPENSA_SEMANAL = Object.freeze({ xp: 250, puntos: 200 });
export const MISIONES_POR_DIA = 3;

const plantilla = (id) => PLANTILLAS_DIARIAS.find((p) => p.id === id) ?? PLANTILLAS_SEMANALES.find((p) => p.id === id);

function crearMision(p, dificultad, prefijo) {
  const d = Math.min(dificultad, p.cantidades.length - 1);
  const objetivo = p.cantidades[d];
  return { id: `${prefijo}:${p.id}`, plantilla: p.id, icono: p.icono, texto: p.texto(objetivo), objetivo, progreso: 0, completada: false, reclamada: false, dificultad: d };
}

/** Las 3 misiones diarias del día UTC `dia` (iguales para todos). Pura. */
export function misionesDelDia(dia) {
  const rng = rngSembrado(`misiones:${dia}`);
  const pool = [...PLANTILLAS_DIARIAS];
  const out = [];
  while (out.length < MISIONES_POR_DIA) {
    const p = pool.splice(Math.floor(rng() * pool.length), 1)[0];
    const dif = Math.floor(rng() * p.cantidades.length);
    out.push(crearMision(p, dif, `d${dia}`));
  }
  return out;
}

/** La misión semanal de la semana `semana`. Pura. */
export function misionSemanal(semana) {
  const rng = rngSembrado(`semanal:${semana}`);
  const p = PLANTILLAS_SEMANALES[Math.floor(rng() * PLANTILLAS_SEMANALES.length)];
  return crearMision(p, 0, `s${semana}`);
}

// ───────────────────────── Estado ─────────────────────────

/**
 * Estado de misiones al día `ahora`: si cambió el día o la semana, rota (pura).
 * @param {object|null} p estado guardado (o null)
 * @returns {{version:number, dia:number, diarias:Array<Mision>, bonusReclamado:boolean, semana:number, semanal:Mision}}
 *
 * @typedef {{id:string, plantilla:string, icono:string, texto:string, objetivo:number, progreso:number,
 *            completada:boolean, reclamada:boolean, dificultad:number}} Mision
 */
export function estadoMisiones(p, ahora = Date.now()) {
  const dia = diaUTC(ahora);
  const semana = semanaUTC(ahora);
  const valido = p && typeof p === "object" && Array.isArray(p.diarias);
  let q = valido ? { ...p } : {};
  if (!valido || q.dia !== dia) q = { ...q, dia, diarias: misionesDelDia(dia), bonusReclamado: false };
  if (!valido || q.semana !== semana || !q.semanal) q = { ...q, semana, semanal: misionSemanal(semana) };
  return { version: 1, dia: q.dia, diarias: q.diarias.map((m) => ({ ...m })), bonusReclamado: !!q.bonusReclamado, semana: q.semana, semanal: { ...q.semanal } };
}

function avanzar(m, ev) {
  if (m.completada) return { m, completo: false };
  const p = plantilla(m.plantilla);
  if (!p || p.evento !== ev.tipo || (p.filtro && !p.filtro(ev))) return { m, completo: false };
  const progreso = p.modo === "maximo"
    ? Math.max(m.progreso, entero(ev.valor ?? ev.cantidad))
    : m.progreso + ev.cantidad;
  const n = { ...m, progreso: Math.min(m.objetivo, progreso) };
  n.completada = n.progreso >= n.objetivo;
  return { m: n, completo: n.completada };
}

/**
 * Registra un evento de juego (ver `normalizarEvento`).
 * Un evento `victoria` con `jefe:true` NO cuenta como `jefe`: registra también `{tipo:"jefe"}`
 * (lo hace `eventosDeCombate`).
 * @returns {{progreso:object, completadas:Mision[]}} misiones que se acaban de completar
 */
export function registrar(p, evento, ahora = Date.now()) {
  const q = estadoMisiones(p, ahora);
  const ev = normalizarEvento(evento);
  if (!ev) return { progreso: q, completadas: [] };
  const completadas = [];
  q.diarias = q.diarias.map((m) => { const r = avanzar(m, ev); if (r.completo) completadas.push(r.m); return r.m; });
  const s = avanzar(q.semanal, ev);
  if (s.completo) completadas.push(s.m);
  q.semanal = s.m;
  return { progreso: q, completadas };
}

/** ¿Se pueden reclamar las 3 diarias juntas (bonus)? */
export function bonusDisponible(p) {
  return p.diarias.every((m) => m.completada && m.reclamada) && !p.bonusReclamado;
}

/**
 * Reclama una misión completada (id de la misión), el bonus ("bonus") o la semanal (su id).
 * @returns {{ok:boolean, progreso:object, recompensa?:{xp:number, puntos:number, motivo?:string}, motivo?:string}}
 *   `recompensa.puntos` → pase.sumarPuntos; `recompensa.xp` → progression.sumarXp;
 *   `recompensa.motivo` ("misiones_diarias") → POST /recompensa del servidor (ORO on-chain).
 *   Si `ok` es false, `motivo` explica por qué (texto en español).
 */
export function reclamar(p, id, ahora = Date.now()) {
  const q = estadoMisiones(p, ahora);
  if (id === "bonus") {
    if (q.bonusReclamado) return { ok: false, progreso: q, motivo: "El bonus de hoy ya está reclamado" };
    if (!bonusDisponible(q)) return { ok: false, progreso: q, motivo: "Completa y reclama las 3 misiones de hoy" };
    q.bonusReclamado = true;
    return { ok: true, progreso: q, recompensa: { ...RECOMPENSA_BONUS } };
  }
  const i = q.diarias.findIndex((m) => m.id === id);
  const m = i >= 0 ? q.diarias[i] : q.semanal.id === id ? q.semanal : null;
  if (!m) return { ok: false, progreso: q, motivo: "Esa misión ya no está activa" };
  if (!m.completada) return { ok: false, progreso: q, motivo: "La misión aún no está completada" };
  if (m.reclamada) return { ok: false, progreso: q, motivo: "Ya la has reclamado" };
  const recompensa = i >= 0 ? { ...RECOMPENSA_DIARIA[m.dificultad] } : { ...RECOMPENSA_SEMANAL };
  if (i >= 0) q.diarias[i] = { ...m, reclamada: true };
  else q.semanal = { ...m, reclamada: true };
  return { ok: true, progreso: q, recompensa };
}

/** Número de cosas reclamables ahora (para la insignia del menú). */
export function pendientesMisiones(p) {
  const n = p.diarias.filter((m) => m.completada && !m.reclamada).length + (p.semanal.completada && !p.semanal.reclamada ? 1 : 0);
  return n + (bonusDisponible(p) ? 1 : 0);
}

/** Clave de storage por dirección. */
export const claveMisiones = (address) => claveJugador("misiones", address);

/** Carga (y rota si hace falta). Nunca lanza. */
export function cargarMisiones(clave, storage = globalThis.localStorage, ahora = Date.now()) {
  return estadoMisiones(leerJSON(clave, storage), ahora);
}

/** Guarda. Devuelve true si se pudo. */
export function guardarMisiones(clave, p, storage = globalThis.localStorage) {
  return escribirJSON(clave, p, storage);
}
