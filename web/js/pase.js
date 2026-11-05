// Pase de temporada: temporadas de 4 semanas desde una fecha fija, 30 niveles, puntos por fuente
// y recompensas por nivel (las de los niveles 10/20/30 son ORO on-chain vía POST /recompensa).
// Lógica pura; `ahora` y `storage` inyectables.

import { MS_DIA, leerJSON, escribirJSON, claveJugador, normalizarEvento } from "./misiones.js";

/** Inicio de la temporada 1: lunes 05-01-2026 00:00 UTC. */
export const INICIO_TEMPORADAS = Date.UTC(2026, 0, 5);
export const DIAS_TEMPORADA = 28;
export const NIVELES_PASE = 30;
/** Puntos para subir cada nivel (fijo). 30 × 150 = 4500 por temporada (~18 días de juego activo). */
export const PUNTOS_POR_NIVEL = 150;

/** Puntos de pase por evento de juego (lo que no aparece no da puntos). */
export const PUNTOS_EVENTO = Object.freeze({
  victoria: 5,   // + extra si es jefe (ver JEFE)
  jefe: 25,
  diario: 20,    // recompensa diaria reclamada
  desafio: 40,   // + 20 si se gana
});
export const PUNTOS_DESAFIO_VICTORIA = 20;

const r = (nivel, tipo, extra) => Object.freeze({ nivel, tipo, ...extra });
/**
 * Recompensa de cada nivel (1..30). `tipo`: "xp" | "pociones" | "titulo" | "marco" | "oro".
 * `onchain: true` → hay que pedirla al servidor con `motivo` (POST /recompensa {address, motivo}).
 * "pociones" son pociones gratis locales (no ERC-1155): súmalas a `pocionesExtra` de la expedición.
 */
export const RECOMPENSAS_PASE = Object.freeze([
  r(1, "xp", { cantidad: 50, nombre: "50 XP", icono: "⭐" }),
  r(2, "pociones", { cantidad: 1, nombre: "1 poción gratis", icono: "🧪" }),
  r(3, "xp", { cantidad: 75, nombre: "75 XP", icono: "⭐" }),
  r(4, "marco", { id: "marco_bronce", nombre: "Marco de bronce", icono: "🟫" }),
  r(5, "titulo", { id: "aspirante", nombre: "Título «Aspirante»", icono: "🏷️" }),
  r(6, "xp", { cantidad: 100, nombre: "100 XP", icono: "⭐" }),
  r(7, "pociones", { cantidad: 2, nombre: "2 pociones gratis", icono: "🧪" }),
  r(8, "xp", { cantidad: 125, nombre: "125 XP", icono: "⭐" }),
  r(9, "marco", { id: "marco_plata", nombre: "Marco de plata", icono: "⬜" }),
  r(10, "oro", { cantidad: 100, motivo: "pase10", onchain: true, nombre: "100 ORO", icono: "🪙" }),
  r(11, "xp", { cantidad: 150, nombre: "150 XP", icono: "⭐" }),
  r(12, "pociones", { cantidad: 2, nombre: "2 pociones gratis", icono: "🧪" }),
  r(13, "xp", { cantidad: 175, nombre: "175 XP", icono: "⭐" }),
  r(14, "titulo", { id: "gladiador", nombre: "Título «Gladiador»", icono: "🏷️" }),
  r(15, "marco", { id: "marco_oro", nombre: "Marco de oro", icono: "🟨" }),
  r(16, "xp", { cantidad: 200, nombre: "200 XP", icono: "⭐" }),
  r(17, "pociones", { cantidad: 3, nombre: "3 pociones gratis", icono: "🧪" }),
  r(18, "xp", { cantidad: 225, nombre: "225 XP", icono: "⭐" }),
  r(19, "marco", { id: "marco_rubi", nombre: "Marco de rubí", icono: "🟥" }),
  r(20, "oro", { cantidad: 200, motivo: "pase20", onchain: true, nombre: "200 ORO", icono: "🪙" }),
  r(21, "xp", { cantidad: 250, nombre: "250 XP", icono: "⭐" }),
  r(22, "pociones", { cantidad: 3, nombre: "3 pociones gratis", icono: "🧪" }),
  r(23, "titulo", { id: "veterano", nombre: "Título «Veterano de temporada»", icono: "🏷️" }),
  r(24, "xp", { cantidad: 300, nombre: "300 XP", icono: "⭐" }),
  r(25, "marco", { id: "marco_esmeralda", nombre: "Marco de esmeralda", icono: "🟩" }),
  r(26, "xp", { cantidad: 350, nombre: "350 XP", icono: "⭐" }),
  r(27, "pociones", { cantidad: 4, nombre: "4 pociones gratis", icono: "🧪" }),
  r(28, "xp", { cantidad: 400, nombre: "400 XP", icono: "⭐" }),
  r(29, "marco", { id: "marco_legendario", nombre: "Marco legendario animado", icono: "🌟" }),
  r(30, "oro", { cantidad: 400, motivo: "pase30", onchain: true, titulo: "campeon_temporada", nombre: "400 ORO + título «Campeón de temporada»", icono: "🏆" }),
]);

/** Títulos que puede dar el pase (id → texto). */
export const TITULOS_PASE = Object.freeze({
  aspirante: "Aspirante", gladiador: "Gladiador", veterano: "Veterano de temporada", campeon_temporada: "Campeón de temporada",
});

/**
 * Temporada vigente en `ahora`. Antes de INICIO_TEMPORADAS se considera la 1.
 * @returns {{numero:number, inicio:number, fin:number, msRestantes:number, diasRestantes:number}}
 */
export function temporada(ahora = Date.now()) {
  const dur = DIAS_TEMPORADA * MS_DIA;
  const k = Math.max(0, Math.floor((Number(ahora) - INICIO_TEMPORADAS) / dur));
  const inicio = INICIO_TEMPORADAS + k * dur;
  const fin = inicio + dur;
  const msRestantes = Math.max(0, fin - Number(ahora));
  return { numero: k + 1, inicio, fin, msRestantes, diasRestantes: Math.ceil(msRestantes / MS_DIA) };
}

/** Nivel alcanzado con `puntos`. @returns {{nivel:number, puntosEnNivel:number, necesarios:number, pct:number, max:boolean}} */
export function nivelPase(puntos) {
  const p = Math.max(0, Math.floor(Number(puntos) || 0));
  const nivel = Math.min(NIVELES_PASE, Math.floor(p / PUNTOS_POR_NIVEL));
  const max = nivel === NIVELES_PASE;
  const puntosEnNivel = max ? PUNTOS_POR_NIVEL : p - nivel * PUNTOS_POR_NIVEL;
  return { nivel, puntosEnNivel, necesarios: PUNTOS_POR_NIVEL, pct: puntosEnNivel / PUNTOS_POR_NIVEL, max };
}

/** Pase nuevo para la temporada vigente. */
export function paseNuevo(ahora = Date.now()) {
  return { version: 1, temporada: temporada(ahora).numero, puntos: 0, reclamados: [] };
}

/**
 * Estado del pase en `ahora`: si cambió la temporada empieza de cero (pura).
 * @returns {{version:number, temporada:number, puntos:number, reclamados:number[]}}
 */
export function estadoPase(p, ahora = Date.now()) {
  const t = temporada(ahora).numero;
  if (!p || typeof p !== "object" || p.temporada !== t) return paseNuevo(ahora);
  const reclamados = Array.isArray(p.reclamados)
    ? [...new Set(p.reclamados.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= NIVELES_PASE))].sort((a, b) => a - b)
    : [];
  return { version: 1, temporada: t, puntos: Math.max(0, Math.floor(Number(p.puntos) || 0)), reclamados };
}

/**
 * Suma puntos de pase.
 * @returns {{progreso:object, puntos:number, niveles:number[]}} niveles recién alcanzados (para fx.subirNivelPase)
 */
export function sumarPuntos(p, puntos, ahora = Date.now()) {
  const q = estadoPase(p, ahora);
  const antes = nivelPase(q.puntos).nivel;
  const n = Math.max(0, Math.floor(Number(puntos) || 0));
  q.puntos += n;
  const despues = nivelPase(q.puntos).nivel;
  const niveles = [];
  for (let k = antes + 1; k <= despues; k++) niveles.push(k);
  return { progreso: q, puntos: n, niveles };
}

/** Puntos que da un evento de juego (ver misiones.normalizarEvento). */
export function puntosPorEvento(evento) {
  const ev = normalizarEvento(evento);
  if (!ev) return 0;
  if (ev.tipo === "desafio") return PUNTOS_EVENTO.desafio + (ev.victoria ? PUNTOS_DESAFIO_VICTORIA : 0);
  if (ev.tipo === "victoria" || ev.tipo === "jefe" || ev.tipo === "diario") return PUNTOS_EVENTO[ev.tipo];
  return 0;
}

/** Registra un evento de juego: suma sus puntos. Mismo resultado que `sumarPuntos`. */
export function registrar(p, evento, ahora = Date.now()) {
  return sumarPuntos(p, puntosPorEvento(evento), ahora);
}

/** Recompensa de un nivel (1..30) o undefined. */
export function recompensaNivel(nivel) {
  return RECOMPENSAS_PASE.find((x) => x.nivel === Number(nivel));
}

/** Niveles alcanzados y sin reclamar. */
export function pendientesPase(p, ahora = Date.now()) {
  const q = estadoPase(p, ahora);
  const nv = nivelPase(q.puntos).nivel;
  const out = [];
  for (let k = 1; k <= nv; k++) if (!q.reclamados.includes(k)) out.push(k);
  return out;
}

/**
 * Reclama la recompensa de un nivel alcanzado.
 * Para las `onchain` (10/20/30) llama primero a POST /recompensa y guarda el progreso devuelto
 * solo si el servidor responde bien (si no, no lo guardes y el jugador podrá reintentar).
 * @returns {{ok:boolean, progreso:object, recompensa?:object, motivo?:string}}
 */
export function reclamarNivel(p, nivel, ahora = Date.now()) {
  const q = estadoPase(p, ahora);
  const n = Number(nivel);
  const rec = recompensaNivel(n);
  if (!rec) return { ok: false, progreso: q, motivo: "Nivel de pase inexistente" };
  if (nivelPase(q.puntos).nivel < n) return { ok: false, progreso: q, motivo: `Aún no has llegado al nivel ${n}` };
  if (q.reclamados.includes(n)) return { ok: false, progreso: q, motivo: "Ya reclamado" };
  q.reclamados = [...q.reclamados, n].sort((a, b) => a - b);
  return { ok: true, progreso: q, recompensa: { ...rec } };
}

/** Títulos y marcos ya reclamados en esta temporada. */
export function desbloqueosPase(p, ahora = Date.now()) {
  const q = estadoPase(p, ahora);
  const recs = q.reclamados.map(recompensaNivel).filter(Boolean);
  return {
    titulos: recs.flatMap((x) => (x.tipo === "titulo" ? [x.id] : x.titulo ? [x.titulo] : [])),
    marcos: recs.filter((x) => x.tipo === "marco").map((x) => x.id),
  };
}

export const clavePase = (address) => claveJugador("pase", address);

/** Carga (y reinicia si cambió la temporada). Nunca lanza. */
export function cargarPase(clave, storage = globalThis.localStorage, ahora = Date.now()) {
  return estadoPase(leerJSON(clave, storage), ahora);
}

export function guardarPase(clave, p, storage = globalThis.localStorage) {
  return escribirJSON(clave, p, storage);
}
