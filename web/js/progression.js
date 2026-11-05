// Progresión del héroe: XP, niveles 1–30, racha de victorias y récords.
// Lógica pura salvo cargar/guardar, que reciben un `storage` inyectable
// (cualquier objeto con getItem/setItem; por defecto `globalThis.localStorage`).

import { STATS_BASE, probCritico, probEsquiva, VICTORIAS_POR_NIVEL, nivelArena } from "./combat.js";
import { idsHabilidades } from "./skills.js";

export const NIVEL_HEROE_MAX = 30;
/** Mejora por nivel de héroe por encima del 1 (pequeña: el equipo NFT es lo que más pesa). */
export const MEJORA_POR_NIVEL = Object.freeze({ vida: 3, ataque: 0.4, defensa: 0.25 });
/** Bonus de XP por racha: +10 % por victoria seguida, hasta +100 %. */
export const BONUS_RACHA = 0.1;
export const BONUS_RACHA_MAX = 1;
/** Multiplicador de XP por vencer a un jefe. */
export const MULT_XP_JEFE = 2.5;
const VERSION = 1;

/** Progreso inicial. */
export function progresoNuevo() {
  return { version: VERSION, nivel: 1, xp: 0, xpTotal: 0, racha: 0, mejorRacha: 0, victorias: 0, derrotas: 0, huidas: 0, jefes: 0, nivelMaxEnemigo: 0 };
}

/** XP necesaria para pasar del nivel `n` al `n+1`. */
export function xpParaSubir(n) {
  const k = Math.max(1, Math.floor(n)) - 1;
  return 40 + 20 * k + 2 * k * k;
}

/** Multiplicador de XP según la racha actual (antes de sumar la victoria). */
export function multRacha(racha) {
  return 1 + Math.min(BONUS_RACHA_MAX, BONUS_RACHA * Math.max(0, racha));
}

/** XP que da vencer a `enemigo` con la racha dada. */
export function xpPorVictoria(enemigo, racha = 0) {
  const base = 10 + 6 * Math.max(1, Number(enemigo?.nivel) || 1);
  return Math.round(base * (enemigo?.jefe ? MULT_XP_JEFE : 1) * multRacha(racha));
}

/** Clave de localStorage: por dirección (en minúsculas) o "invitado" en modo demo. */
export function claveProgreso(address) {
  return `lootarena:progreso:${address ? String(address).toLowerCase() : "invitado"}`;
}

/** Normaliza datos desconocidos/corruptos a un progreso válido. */
export function sanearProgreso(d) {
  const p = progresoNuevo();
  if (!d || typeof d !== "object" || Array.isArray(d)) return p;
  const ent = (v, min = 0, max = Number.MAX_SAFE_INTEGER) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
  };
  for (const k of ["xp", "xpTotal", "racha", "mejorRacha", "victorias", "derrotas", "huidas", "jefes"]) p[k] = ent(d[k]);
  p.nivel = ent(d.nivel, 1, NIVEL_HEROE_MAX);
  p.nivelMaxEnemigo = ent(d.nivelMaxEnemigo, 0, 10);
  p.mejorRacha = Math.max(p.mejorRacha, p.racha);
  if (p.nivel === NIVEL_HEROE_MAX) p.xp = 0;
  else p.xp = Math.min(p.xp, xpParaSubir(p.nivel) - 1);
  return p;
}

/**
 * Carga el progreso guardado. Nunca lanza: ante cualquier problema devuelve uno nuevo.
 * @param {string} clave usa `claveProgreso(address)`
 * @param {{getItem:(k:string)=>string|null}} [storage]
 */
export function cargarProgreso(clave, storage = globalThis.localStorage) {
  try {
    const txt = storage?.getItem(clave);
    return txt ? sanearProgreso(JSON.parse(txt)) : progresoNuevo();
  } catch {
    return progresoNuevo();
  }
}

/**
 * Guarda el progreso. Devuelve true si se pudo guardar.
 * @param {string} clave
 * @param {object} p
 * @param {{setItem:(k:string,v:string)=>void}} [storage]
 */
export function guardarProgreso(clave, p, storage = globalThis.localStorage) {
  try {
    storage.setItem(clave, JSON.stringify(sanearProgreso(p)));
    return true;
  } catch {
    return false;
  }
}

/** Suma XP y sube los niveles que toquen. Pura. @returns {{progreso, niveles:number[]}} */
export function sumarXp(p, xp) {
  const q = { ...p, xpTotal: p.xpTotal + xp };
  const niveles = [];
  let resto = q.xp + xp;
  while (q.nivel < NIVEL_HEROE_MAX && resto >= xpParaSubir(q.nivel)) {
    resto -= xpParaSubir(q.nivel);
    q.nivel += 1;
    niveles.push(q.nivel);
  }
  q.xp = q.nivel === NIVEL_HEROE_MAX ? 0 : resto;
  return { progreso: q, niveles };
}

/**
 * Registra una victoria.
 * @param {object} p progreso actual (no se muta)
 * @param {{nivel:number, jefe?:boolean}} enemigo el enemigo vencido (`combate.enemigo`)
 * @returns {{progreso:object, xp:number, niveles:number[], subioNivel:boolean, racha:number,
 *            nuevaMejorRacha:boolean, nuevoRecordNivel:boolean, nivelArenaSubido:boolean}}
 */
export function aplicarVictoria(p, enemigo) {
  const base = sanearProgreso(p);
  const xp = xpPorVictoria(enemigo, base.racha);
  const { progreso, niveles } = sumarXp(base, xp);
  progreso.victorias += 1;
  progreso.racha += 1;
  if (enemigo?.jefe) progreso.jefes += 1;
  const nuevaMejorRacha = progreso.racha > base.mejorRacha;
  progreso.mejorRacha = Math.max(base.mejorRacha, progreso.racha);
  const nv = Math.max(1, Number(enemigo?.nivel) || 1);
  const nuevoRecordNivel = nv > base.nivelMaxEnemigo;
  progreso.nivelMaxEnemigo = Math.max(base.nivelMaxEnemigo, nv);
  return {
    progreso, xp, niveles, subioNivel: niveles.length > 0, racha: progreso.racha,
    nuevaMejorRacha, nuevoRecordNivel,
    nivelArenaSubido: nivelArena(progreso.victorias) > nivelArena(base.victorias),
  };
}

/** Registra una derrota: rompe la racha. */
export function aplicarDerrota(p) {
  const q = sanearProgreso(p);
  return { ...q, derrotas: q.derrotas + 1, racha: 0 };
}

/** Registra una huida: también rompe la racha. */
export function aplicarHuida(p) {
  const q = sanearProgreso(p);
  return { ...q, huidas: q.huidas + 1, racha: 0 };
}

/**
 * Stats del héroe para `crearCombate`: base + nivel de héroe + equipo NFT.
 * @param {object} p progreso
 * @param {Array<{tipo:string, rareza:number, ataque:number, defensa:number}>} equipados
 * @returns {{vidaMax:number, vida:number, ataque:number, defensa:number, nivel:number, critico:number,
 *            esquiva:number, bonusAtaque:number, bonusDefensa:number, habilidades:string[]}}
 */
export function statsHeroe(p, equipados = []) {
  const nivel = sanearProgreso(p).nivel;
  const k = nivel - 1;
  const bonusAtaque = equipados.reduce((s, it) => s + (Number(it.ataque) || 0), 0);
  const bonusDefensa = equipados.reduce((s, it) => s + (Number(it.defensa) || 0), 0);
  const vidaMax = STATS_BASE.vida + Math.round(MEJORA_POR_NIVEL.vida * k);
  const ataque = STATS_BASE.ataque + Math.round(MEJORA_POR_NIVEL.ataque * k) + bonusAtaque;
  const defensa = STATS_BASE.defensa + Math.round(MEJORA_POR_NIVEL.defensa * k) + bonusDefensa;
  return {
    vidaMax, vida: vidaMax, ataque, defensa, nivel,
    critico: probCritico(bonusAtaque), esquiva: probEsquiva(defensa),
    bonusAtaque, bonusDefensa, habilidades: idsHabilidades(equipados),
  };
}

/** Datos para la barra de XP. */
export function infoXp(p) {
  const q = sanearProgreso(p);
  const necesaria = q.nivel === NIVEL_HEROE_MAX ? 0 : xpParaSubir(q.nivel);
  return { nivel: q.nivel, xp: q.xp, necesaria, pct: necesaria ? q.xp / necesaria : 1, max: q.nivel === NIVEL_HEROE_MAX };
}

/** Victorias que faltan para el jefe del nivel actual (0 = el próximo es el jefe). */
export function combatesHastaJefe(victorias) {
  const v = Math.max(0, Math.floor(Number(victorias) || 0));
  return VICTORIAS_POR_NIVEL - 1 - (v % VICTORIAS_POR_NIVEL);
}
