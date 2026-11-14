// El cofre del botín, en la arena.
//
// El momento del botín es el mejor del juego y se ve cientos de veces, así que manda una regla
// por encima de las demás: **la rareza se tiene que leer antes que el texto**. A un metro de la
// pantalla, sin fijarte, tienes que saber si eso es un legendario. Se consigue con tres cosas a
// la vez, no con una:
//
//   · el COLOR (el mismo gris/azul/dorado del 2D),
//   · la LUZ (un haz que sale del cofre, más alto y más vivo cuanto mejor es),
//   · el TIEMPO (un legendario tarda más en abrirse; esa espera es la que te hace mirar).
//
// Y una segunda regla, porque esto se repite muchísimo: corto antes que largo. La secuencia
// entera dura entre medio segundo y poco más de uno, y se puede saltar.

import { Taller } from "./piezas.js";
import { rareza3d } from "./paleta.js";

/**
 * Cuánto dura la apertura según la rareza, en milisegundos.
 * Un común se abre casi de golpe; un legendario se hace esperar. La diferencia de tiempo es la
 * mitad del efecto: si todos tardasen lo mismo, el color sería el único aviso.
 */
export const DURACION = Object.freeze([520, 760, 1150]);

/** Altura del haz de luz por rareza, en metros. */
export const ALTURA_HAZ = Object.freeze([1.1, 1.9, 3.2]);

/** Cuántas chispas salen al abrirse. */
export const CHISPAS = Object.freeze([18, 40, 90]);

/** Rareza válida (0, 1 o 2); cualquier otra cosa cuenta como común. */
export const rarezaValida = (r) => Math.max(0, Math.min(2, Math.floor(Number(r)) || 0));

/**
 * Construye el cofre. El modelo es el mismo para las tres rarezas: lo que cambia es el metal,
 * la luz de dentro y el haz, que es justo lo que hay que leer de un vistazo.
 *
 * @param {object} T three.js
 * @param {number} rareza 0 común, 1 raro, 2 legendario
 * @param {{segmentos?:number, sombras?:boolean}} [o]
 * @returns {{raiz:object, taller:Taller, partes:object, materiales:object[], alto:number, rareza:number}}
 */
export function construirCofre(T, rareza = 0, o = {}) {
  const r = rarezaValida(rareza);
  const pal = rareza3d(r);
  const t = new Taller(T, o);

  const madera = t.mat(0x5a3a22, { rugosidad: 0.95 });
  const maderaOsc = t.mat(0x3a2414, { rugosidad: 1 });
  const metal = t.mat(pal.base, { metal: 0.9, rugosidad: 0.25, emision: pal.emision, fuerza: pal.fuerza * 0.6 });

  const raiz = t.grupo("cofre");
  const cuerpo = t.grupo("cuerpo");

  // Caja
  cuerpo.add(t.en(t.caja(0.76, 0.42, 0.52, madera), 0, 0.21, 0));
  for (const x of [-0.3, 0.3]) cuerpo.add(t.en(t.caja(0.07, 0.44, 0.54, metal), x, 0.21, 0));
  cuerpo.add(t.en(t.caja(0.78, 0.07, 0.54, maderaOsc), 0, 0.03, 0));

  // Tapa: gira sobre su bisagra, por eso va en su propio grupo con el pivote detrás.
  const tapa = t.grupo("tapa");
  tapa.add(t.en(t.caja(0.78, 0.1, 0.54, madera), 0, 0.05, 0.26));
  tapa.add(t.en(t.cilindro(0.27, 0.27, 0.78, madera), 0, 0.05, 0.26, { rz: Math.PI / 2, esc: [1, 1, 0.52] }));
  for (const x of [-0.3, 0.3]) tapa.add(t.en(t.toro(0.2, 0.035, metal), x, 0.06, 0.26, { ry: Math.PI / 2, esc: [1, 0.55, 1] }));
  t.en(tapa, 0, 0.44, -0.26);
  cuerpo.add(tapa);

  // Cerradura: el detalle que dice «esto se abre».
  cuerpo.add(t.en(t.caja(0.16, 0.18, 0.06, metal), 0, 0.34, 0.27));
  cuerpo.add(t.en(t.esfera(0.035, t.matLuz(pal.luz, { aditivo: true })), 0, 0.34, 0.31));

  // Lo que se ve DENTRO cuando se abre: un bloque de luz del color de la rareza.
  const interior = t.en(t.caja(0.6, 0.3, 0.38, t.matLuz(pal.luz, { aditivo: true, opacidad: 0 })), 0, 0.3, 0);
  cuerpo.add(interior);

  // El haz: un cono invertido, muy transparente, que sale hacia arriba. Es lo que se ve de lejos.
  const haz = t.grupo("haz");
  const matHaz = t.matLuz(pal.luz, { aditivo: true, opacidad: 0, doble: true });
  haz.add(t.en(t.cono(0.42, ALTURA_HAZ[r], matHaz), 0, ALTURA_HAZ[r] / 2, 0));
  haz.add(t.en(t.cono(0.18, ALTURA_HAZ[r] * 0.8, t.matLuz(0xffffff, { aditivo: true, opacidad: 0 })), 0, ALTURA_HAZ[r] * 0.4, 0));
  t.en(haz, 0, 0.3, 0);
  cuerpo.add(haz);

  // Anillo en el suelo: ancla el cofre a la arena y repite el color de la rareza.
  const anillo = t.en(t.toro(0.62, 0.035, t.matLuz(pal.base, { aditivo: true, opacidad: 0.7 })), 0, 0.03, 0, { rx: Math.PI / 2 });
  raiz.add(anillo);
  raiz.add(cuerpo);
  raiz.add(t.en(t.disco(0.6, t.matLuz(0x000000, { opacidad: 0.35 })), 0, 0.012, 0));

  return {
    raiz, taller: t, rareza: r, alto: 0.95,
    partes: { cuerpo, tapa, haz, interior, anillo },
    materiales: t.materiales,
    colores: pal,
  };
}

/**
 * Estado de la animación del cofre en un instante dado. Función PURA: se prueba en Node sin
 * navegador, que es lo que permite asegurar que un legendario tarda más y brilla más que un común
 * sin tener que mirarlo.
 *
 * @param {number} p avance de 0 a 1
 * @param {number} rareza
 * @returns {{subir:number, tapa:number, haz:number, interior:number, anillo:number, sacudir:number}}
 *   subir: cuánto ha salido del suelo (0..1) · tapa: radianes que ha girado ·
 *   haz/interior/anillo: opacidad 0..1 · sacudir: cuánto tiembla antes de abrirse
 */
export function pasoCofre(p, rareza = 0) {
  const r = rarezaValida(rareza);
  const x = Math.max(0, Math.min(1, Number(p) || 0));

  // 0 → 0,25: sale del suelo. 0,25 → 0,5: tiembla (cuanto mejor, más tiembla).
  // 0,5 → 0,75: se abre de golpe. 0,75 → 1: se queda abierto con la luz arriba.
  const subir = x < 0.25 ? suave(x / 0.25) : 1;
  const temblor = x > 0.22 && x < 0.52 ? Math.sin((x - 0.22) * 60) * (0.02 + r * 0.02) * (1 - (x - 0.22) / 0.3) : 0;
  const abrir = x <= 0.5 ? 0 : suave(Math.min(1, (x - 0.5) / 0.22));
  const tapa = abrir * (1.5 + r * 0.25);
  const luz = x <= 0.5 ? 0 : Math.min(1, (x - 0.5) / 0.15);

  return {
    subir,
    tapa,
    sacudir: temblor,
    interior: luz * (0.55 + r * 0.22),
    haz: luz * (0.18 + r * 0.26),
    anillo: 0.35 + luz * (0.25 + r * 0.2),
  };
}

const suave = (v) => 1 - (1 - v) ** 3;

/**
 * ¿Se distingue una rareza de la siguiente? Tres señales a la vez: tiempo, altura del haz y
 * número de chispas. Si alguna dejara de crecer con la rareza, el jugador perdería una pista.
 * @returns {boolean}
 */
export function rarezasDistinguibles() {
  for (let r = 1; r <= 2; r++) {
    if (!(DURACION[r] > DURACION[r - 1])) return false;
    if (!(ALTURA_HAZ[r] > ALTURA_HAZ[r - 1])) return false;
    if (!(CHISPAS[r] > CHISPAS[r - 1])) return false;
    if (!(pasoCofre(1, r).haz > pasoCofre(1, r - 1).haz)) return false;
  }
  return true;
}
