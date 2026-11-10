// Desafío diario: un combate especial sembrado por la fecha UTC (misma criatura, nivel,
// modificadores y aleatoriedad para todos) con un único intento al día.
// Lógica pura; `ahora` y `storage` inyectables. Usa combat.js.

import { BESTIARIO, crearCombate, generarEnemigoDe, mulberry32 } from "./combat.js";
import { diaUTC, msHastaManana, rngSembrado, hash32, leerJSON, escribirJSON, claveJugador } from "./misiones.js";

const M = (id, icono, nombre, descripcion, efecto, extra = {}) => Object.freeze({ id, icono, nombre, descripcion, ...efecto, ...extra });
const CON_ESTADOS = ["rata", "limo", "esqueleto", "arana", "arpia", "basilisco", "hechicero", "dragon"];

/**
 * Modificadores posibles. `heroe(h)`/`enemigo(e)` devuelven copias modificadas.
 * `claves`: criaturas compatibles (si falta, todas). `grupo`: no se combinan dos del mismo grupo.
 */
export const MODIFICADORES = Object.freeze([
  M("toxinas", "☠️", "Toxinas", "Los estados que aplica el enemigo (veneno, sangrado) son el doble de fuertes.",
    { enemigo: (e) => ({ ...e, multEstados: 2 }) }, { claves: CON_ESTADOS }),
  M("sin_pociones", "🚫", "Sin pociones", "No puedes usar pociones.",
    { heroe: (h) => ({ ...h, pociones: 0, pocionesExtra: 0 }) }, { grupo: "pociones" }),
  M("escasez", "🧪", "Escasez", "Solo tienes 1 poción.",
    { heroe: (h) => ({ ...h, pociones: 1, pocionesExtra: 0 }) }, { grupo: "pociones" }),
  M("furioso", "😡", "Furia ciega", "El enemigo pega un 25 % más fuerte.",
    { enemigo: (e) => ({ ...e, ataque: Math.round(e.ataque * 1.25) }) }, { grupo: "ataque" }),
  M("coloso", "🗿", "Coloso", "El enemigo tiene un 50 % más de vida.",
    { enemigo: (e) => ({ ...e, vidaMax: Math.round(e.vidaMax * 1.5) }) }, { grupo: "vida" }),
  M("escurridizo", "💨", "Escurridizo", "El enemigo esquiva mucho más (+15 %).",
    { enemigo: (e) => ({ ...e, esquiva: Math.min(0.6, (e.esquiva ?? 0) + 0.15) }) }),
  M("cristal", "💎", "Cañón de cristal", "Tienes un 40 % menos de vida pero un 35 % más de ataque.",
    { heroe: (h) => ({ ...h, vidaMax: Math.round((h.vidaMax ?? h.vida) * 0.6), vida: undefined, ataque: Math.round(h.ataque * 1.35) }) }, { grupo: "heroe" }),
  M("sin_trucos", "🤐", "Sin trucos", "No puedes usar habilidades.",
    { heroe: (h) => ({ ...h, habilidades: [] }) }),
  M("coraza", "🛡️", "Coraza", "El enemigo tiene un 60 % más de defensa.",
    { enemigo: (e) => ({ ...e, defensa: Math.round(e.defensa * 1.6) }) }),
  M("filo", "🗡️", "Filo afilado", "Todos hacen más críticos: tú +20 % y el enemigo un 20 %.",
    { heroe: (h) => ({ ...h, critico: Math.min(0.9, (h.critico ?? 0.1) + 0.2) }), enemigo: (e) => ({ ...e, critico: 0.2 }) }),
  M("bendicion", "😇", "Bendición de la arena", "Empiezas con un 30 % más de vida.",
    { heroe: (h) => ({ ...h, vidaMax: Math.round((h.vidaMax ?? h.vida) * 1.3), vida: undefined }) }, { grupo: "heroe" }),
]);

export const MODIFICADORES_POR_DIA = 2;
export const NIVEL_MIN_DESAFIO = 2;
export const NIVEL_MAX_DESAFIO = 7;
/** Probabilidad de que el desafío del día sea contra un jefe. */
export const PROB_JEFE_DESAFIO = 1 / 7;

const modificador = (id) => MODIFICADORES.find((m) => m.id === id);

/**
 * Desafío del día UTC `dia` (igual para todos). Pura.
 * @returns {{dia:number, clave:string, nombre:string, emoji:string, nivel:number, jefe:boolean,
 *           modificadores:Array<{id, icono, nombre, descripcion}>, semilla:number, titulo:string}}
 */
export function desafioDelDia(dia) {
  const rng = rngSembrado(`desafio:${dia}`);
  const cr = BESTIARIO[Math.floor(rng() * BESTIARIO.length)];
  const nivel = NIVEL_MIN_DESAFIO + Math.floor(rng() * (NIVEL_MAX_DESAFIO - NIVEL_MIN_DESAFIO + 1));
  const jefe = rng() < PROB_JEFE_DESAFIO;
  const pool = MODIFICADORES.filter((m) => !m.claves || m.claves.includes(cr.clave));
  const elegidos = [];
  while (elegidos.length < MODIFICADORES_POR_DIA && pool.length) {
    const m = pool.splice(Math.floor(rng() * pool.length), 1)[0];
    if (m.grupo && elegidos.some((x) => x.grupo === m.grupo)) continue;
    elegidos.push(m);
  }
  return {
    dia, clave: cr.clave, nombre: jefe ? `${cr.nombre}, ${cr.titulo}` : cr.nombre, emoji: cr.emoji, nivel, jefe,
    modificadores: elegidos.map(({ id, icono, nombre, descripcion }) => ({ id, icono, nombre, descripcion })),
    semilla: hash32(`desafio-combate:${dia}`),
    titulo: `${jefe ? "👑 " : ""}${cr.nombre} nv. ${nivel} · ${elegidos.map((m) => m.nombre).join(" + ")}`,
  };
}

/** Desafío vigente en `ahora`, con `msRestantes` hasta el siguiente. */
export function desafioDeHoy(ahora = Date.now()) {
  return { ...desafioDelDia(diaUTC(ahora)), msRestantes: msHastaManana(ahora) };
}

/**
 * Crea el combate del desafío. Usa SIEMPRE el `rng` devuelto en todos los `turnoJugador`
 * de este combate: así la aleatoriedad es la misma para todos los jugadores.
 * @param {ReturnType<typeof desafioDelDia>} desafio
 * @param {object} heroe stats del héroe (progression.statsHeroe + pociones de la expedición si quieres)
 * @returns {{combate:object, rng:() => number}}
 */
export function crearCombateDesafio(desafio, heroe) {
  let e = { ...generarEnemigoDe(desafio.clave, desafio.nivel, { jefe: desafio.jefe }), desafio: true };
  let h = { pociones: 3, pocionesExtra: 0, ...heroe };
  for (const { id } of desafio.modificadores) {
    const m = modificador(id);
    if (m?.heroe) h = m.heroe(h);
    if (m?.enemigo) e = m.enemigo(e);
  }
  const rng = mulberry32(desafio.semilla);
  return { combate: crearCombate(h, e, rng), rng };
}

/**
 * Puntuación de un intento: victoria → 1000 + hasta 500 por vida restante + hasta 300 por rapidez;
 * derrota/huida → hasta 900 según el daño hecho al enemigo.
 */
export function puntuacion(combate) {
  const j = combate.jugador;
  const e = combate.enemigo;
  const r = combate.resumen ?? {};
  if (combate.fase === "victoria") {
    return 1000 + Math.round((500 * j.vida) / j.vidaMax) + Math.max(0, 300 - 15 * (r.turnos ?? 0));
  }
  const hecho = Math.min(e.vidaMax, e.vidaMax - e.vida);
  return Math.round((900 * hecho) / e.vidaMax);
}

/** Estado nuevo (por jugador). */
export function estadoDesafioNuevo() {
  return { version: 1, dia: null, intentado: false, terminado: false, victoria: false, puntuacion: 0, jugados: 0, ganados: 0, mejor: 0 };
}

/** Estado en `ahora`: si cambió el día, se libera el intento (pura). */
export function estadoDesafio(d, ahora = Date.now()) {
  const base = estadoDesafioNuevo();
  const e = d && typeof d === "object" ? d : {};
  const ent = (v) => Math.max(0, Math.floor(Number(v) || 0));
  const q = { ...base, jugados: ent(e.jugados), ganados: ent(e.ganados), mejor: ent(e.mejor) };
  const hoy = diaUTC(ahora);
  if (e.dia === hoy) Object.assign(q, { dia: hoy, intentado: !!e.intentado, terminado: !!e.terminado, victoria: !!e.victoria, puntuacion: ent(e.puntuacion) });
  else q.dia = hoy;
  return q;
}

/** ¿Puede jugar el desafío de hoy? */
export function puedeIntentar(d, ahora = Date.now()) {
  return !estadoDesafio(d, ahora).intentado;
}

/**
 * Gasta el intento de hoy (llámalo al EMPEZAR el combate y guarda: recargar no da otro intento).
 * @returns {{ok:boolean, progreso:object, desafio?:object, motivo?:string}}
 */
export function iniciarIntento(d, ahora = Date.now()) {
  const q = estadoDesafio(d, ahora);
  if (q.intentado) return { ok: false, progreso: q, motivo: "Ya has jugado el desafío de hoy. Vuelve mañana." };
  return { ok: true, progreso: { ...q, intentado: true, jugados: q.jugados + 1 }, desafio: desafioDelDia(q.dia) };
}

/**
 * Registra el resultado del intento de hoy (una sola vez). El combate debe haber terminado
 * (una huida cuenta como derrota). Si se inició el intento y nunca se terminó, sigue gastado.
 * @returns {{ok:boolean, progreso:object, resultado?:{victoria:boolean, puntuacion:number, mejorPersonal:boolean},
 *           evento?:{tipo:"desafio", victoria:boolean, puntuacion:number}, motivo?:string}}
 *   `evento` hay que pasarlo a misiones/pase/logros.registrar.
 */
export function finalizarIntento(d, combate, ahora = Date.now()) {
  const q = estadoDesafio(d, ahora);
  if (!q.intentado) return { ok: false, progreso: q, motivo: "No hay un intento en curso" };
  if (q.terminado) return { ok: false, progreso: q, motivo: "El desafío de hoy ya está registrado" };
  if (!combate || combate.fase === "en_curso") return { ok: false, progreso: q, motivo: "El combate aún no ha terminado" };
  const victoria = combate.fase === "victoria";
  const pts = puntuacion(combate);
  const mejorPersonal = pts > q.mejor;
  const progreso = { ...q, terminado: true, victoria, puntuacion: pts, ganados: q.ganados + (victoria ? 1 : 0), mejor: Math.max(q.mejor, pts) };
  return { ok: true, progreso, resultado: { victoria, puntuacion: pts, mejorPersonal }, evento: { tipo: "desafio", victoria, puntuacion: pts } };
}

export const claveDesafio = (address) => claveJugador("desafio", address);

export function cargarDesafio(clave, storage = globalThis.localStorage, ahora = Date.now()) {
  return estadoDesafio(leerJSON(clave, storage), ahora);
}

export function guardarDesafio(clave, d, storage = globalThis.localStorage) {
  return escribirJSON(clave, d, storage);
}
