// Colores del motor 3D. Módulo puro: no toca el DOM ni three.js, así que se prueba en Node.
//
// Las rarezas y la derivación de `clave` se toman de sprites.js (solo lectura) para que el 3D y el
// 2D pinten exactamente el mismo gris/azul/dorado y usen la misma clave de criatura. Lo que añade
// este archivo es lo que el 2D no necesita: color de emisión (lo que «brilla» en three.js),
// acentos y un color de polvo por criatura.

import { PALETA_RAREZA, CLAVES_ENEMIGO, claveEnemigo } from "../sprites.js";
import { metadatos3d, BESTIARIO } from "../combat.js";

export { CLAVES_ENEMIGO, claveEnemigo };

/** `#rrggbb` → entero 0xrrggbb (lo que esperan los constructores de three.js). */
export const hex = (s) => {
  const t = String(s ?? "").trim().replace(/^#/, "");
  const v = t.length === 3 ? t.replace(/./g, (c) => c + c) : t;
  const n = Number.parseInt(v, 16);
  return Number.isFinite(n) && v.length === 6 ? n : 0xffffff;
};

/**
 * Paleta de una rareza (0 común, 1 raro, 2 legendario) con los colores ya en número.
 * Fuera de rango se recorta, nunca falla.
 * @param {number} rareza
 * @returns {{base:number, luz:number, osc:number, emision:number, fuerza:number}}
 */
export function rareza3d(rareza) {
  const n = Math.max(0, Math.min(PALETA_RAREZA.length - 1, Number(rareza) || 0));
  const p = PALETA_RAREZA[n];
  return {
    base: hex(p.base),
    luz: hex(p.luz),
    osc: hex(p.osc),
    emision: n === 0 ? 0x000000 : hex(p.base),
    // Solo lo legendario brilla de verdad; lo raro apenas, y lo común no brilla.
    fuerza: n === 2 ? 0.85 : n === 1 ? 0.3 : 0,
  };
}

/** Piel y tela del héroe cuando no lleva nada equipado. */
export const HEROE = Object.freeze({
  piel: 0xe8b88f,
  pelo: 0x4a3526,
  tunica: 0xa0703f,
  cinturon: 0x5b3a22,
  bota: 0x5b3a22,
  metal: 0xb8c0cc,
  metalOsc: 0x5b626c,
});

/**
 * Colores por criatura. `base` es el cuerpo, `osc` las sombras y partes duras, `acento` los
 * detalles (ojos, garras, runas) y `emision` lo que brilla en la oscuridad de la arena.
 * Las claves son las del BESTIARIO de combat.js más `jefe`.
 */
export const ENEMIGOS = Object.freeze({
  rata:      { base: 0x8d7a68, osc: 0x463a30, acento: 0xe9a8a8, emision: 0x000000, fuerza: 0 },
  lobo:      { base: 0x6b7280, osc: 0x1f2937, acento: 0xfbbf24, emision: 0xfbbf24, fuerza: 0.5 },
  goblin:    { base: 0x84cc16, osc: 0x3f6212, acento: 0xd97706, emision: 0x000000, fuerza: 0 },
  esqueleto: { base: 0xece8e1, osc: 0xa8a29e, acento: 0x7dd3fc, emision: 0x60a5fa, fuerza: 0.7 },
  arana:     { base: 0x6b21a8, osc: 0x3b0764, acento: 0xdc2626, emision: 0xdc2626, fuerza: 0.6 },
  orco:      { base: 0x6b8e23, osc: 0x2f4a0e, acento: 0xd6d3d1, emision: 0x000000, fuerza: 0 },
  espectro:  { base: 0xa5f3fc, osc: 0x0e7490, acento: 0xffffff, emision: 0x22d3ee, fuerza: 1.1 },
  golem:     { base: 0xa8a29e, osc: 0x57534e, acento: 0xfb923c, emision: 0xfb923c, fuerza: 0.9 },
  hechicero: { base: 0x7e22ce, osc: 0x3b0764, acento: 0xf0abfc, emision: 0xf0abfc, fuerza: 0.8 },
  dragon:    { base: 0xdc2626, osc: 0x7f1d1d, acento: 0xfde047, emision: 0xfde047, fuerza: 0.7 },
  jefe:      { base: 0x374151, osc: 0x111827, acento: 0xfbbf24, emision: 0xef4444, fuerza: 1 },
});

/** Color de reserva para enemigos sin clave conocida. */
export const ENEMIGO_GENERICO = Object.freeze({ base: 0x9ca3af, osc: 0x4b5563, acento: 0xe5e7eb, emision: 0x000000, fuerza: 0 });

/**
 * Clave de criatura a partir de su nombre. Primero se busca el nombre EXACTO en el bestiario,
 * porque la regla del 2D (primera palabra en minúsculas y sin tildes) ya no siempre acierta:
 * «Enjambre de avispas» daría `enjambre` y la clave real es `avispa`. Si no está en el bestiario
 * se usa la regla de siempre, que es lo que entiende sprites.js.
 * @param {string} nombre
 * @returns {string}
 */
export function claveDeNombre(nombre) {
  const n = String(nombre ?? "").trim();
  const b = BESTIARIO.find((x) => x.nombre === n);
  return b ? b.clave : claveEnemigo(n);
}

/** Mezcla un color con negro: `f` 0 = igual, 1 = negro. */
export function oscurecer(color, f = 0.5) {
  const k = Math.max(0, Math.min(1, f));
  const r = (color >> 16) & 255, g = (color >> 8) & 255, b = color & 255;
  return (Math.round(r * (1 - k)) << 16) | (Math.round(g * (1 - k)) << 8) | Math.round(b * (1 - k));
}

/**
 * Colores de una criatura. Manda el BESTIARIO de `combat.js`, que es de quien son las criaturas:
 * trae `color`, `colorSecundario` y `emision` por entrada. Esta tabla local solo completa la
 * emisión cuando el bestiario la deja en nulo pero sabemos que esa criatura debería brillar
 * (el esqueleto, el espectro…). Si la clave no existe en ninguna parte, color genérico: un
 * enemigo nuevo del equipo de contenido se verá gris, pero se verá y no romperá nada.
 * @param {string} clave
 * @returns {{base:number, osc:number, acento:number, emision:number, fuerza:number}}
 */
export function colorEnemigo(clave) {
  const k = String(clave ?? "").toLowerCase();
  const propio = ENEMIGOS[k];
  let meta = null;
  try { meta = metadatos3d(k); } catch { meta = null; }
  if (!meta?.color) return propio ?? ENEMIGO_GENERICO;
  const base = hex(meta.color);
  const acento = meta.colorSecundario ? hex(meta.colorSecundario) : base;
  const emision = meta.emision ? hex(meta.emision) : (propio?.emision ?? 0x000000);
  return {
    base,
    osc: oscurecer(base, 0.45),
    acento,
    emision,
    fuerza: emision ? (meta.emision ? 0.8 : propio?.fuerza ?? 0.5) : 0,
  };
}

/** Decoración de la arena. */
export const ARENA = Object.freeze({
  // La arena va deliberadamente apagada: el héroe sin equipo es marrón y sobre una arena clara
  // se confundía con el suelo.
  arena: 0x7a5f3e,
  arenaOsc: 0x4a3522,
  muro: 0x2a1e15,
  muroLuz: 0x3b2a1c,
  oro: 0xe8b75a,
  estandarte: 0x6b1414,
  niebla: 0x140d08,
  madera: 0x1a1410,
  llama: 0xffb13c,
  llamaNucleo: 0xfff5c8,
});

/** Colores de los números flotantes, por clase (las mismas clases que `fx.numeroFlotante`). */
export const TEXTO = Object.freeze({
  dano:     { relleno: "#fecaca", borde: "#7f1d1d", tam: 1 },
  critico:  { relleno: "#fff7cc", borde: "#b45309", tam: 1.45 },
  cura:     { relleno: "#bbf7d0", borde: "#14532d", tam: 1 },
  bloqueo:  { relleno: "#bfdbfe", borde: "#1e3a8a", tam: 0.95 },
  esquiva:  { relleno: "#e5e7eb", borde: "#334155", tam: 0.95 },
  info:     { relleno: "#fde68a", borde: "#78350f", tam: 0.95 },
  estado:   { relleno: "#ddd6fe", borde: "#4c1d95", tam: 0.9 },
});

/** Clase de texto válida (o "dano"). */
export const claseTexto = (c) => (Object.hasOwn(TEXTO, String(c)) ? String(c) : "dano");
