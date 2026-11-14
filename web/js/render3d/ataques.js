// Cómo ataca cada criatura.
//
// Hasta ahora todas embestían igual, dijera lo que dijera su ficha: un dragón que escupe fuego
// daba un empujón, y un hechicero que lanza un conjuro también. El bestiario de `combat.js` ya
// declara `ataque3d` por criatura y `animacion3d(id)` por movimiento (contrato VALORES_3D.ataque),
// así que aquí está lo que significa cada uno de esos nueve valores en pantalla.
//
// La distinción que más se nota no es el gesto, es **si la criatura se mueve de su sitio o no**:
// un mordisco y una embestida van hacia el rival; un aliento, un proyectil o un conjuro se lanzan
// desde donde está. Que un dragón deje de darse un paseo para escupir fuego cambia el combate
// entero más que cualquier detalle de la animación.
//
// Módulo puro: solo describe números. Quien los convierte en movimiento es `escena3d.js`.

/** Los nueve valores del contrato. Si `combat.js` añade uno, `sinDescriptor()` lo denuncia. */
export const ANIMACIONES = Object.freeze({
  /** Golpe con arma: el que había, y el de más de la mitad de los movimientos. */
  arma: Object.freeze({
    avance: 0.42, impulso: 0.22, alzar: 0.12, inclinar: 0, giro: 0,
    arma: 1.6, cabeza: 0, ms: 440, impacto: 0.5, sacude: 0,
    proyectil: null, chorro: null, anillo: null, defensivo: false,
  }),

  /** Mordisco: se lanza y adelanta la cabeza. Lo típico de las bestias. */
  mordisco: Object.freeze({
    avance: 0.5, impulso: 0.26, alzar: 0.08, inclinar: 0.22, giro: 0,
    arma: 0, cabeza: 0.75, ms: 420, impacto: 0.52, sacude: 0,
    proyectil: null, chorro: null, anillo: null, defensivo: false,
  }),

  /** Zarpazo: casi no avanza, gira el cuerpo y barre de lado. */
  garra: Object.freeze({
    avance: 0.26, impulso: 0.18, alzar: 0.14, inclinar: 0.1, giro: 0.85,
    arma: 0.9, cabeza: 0.2, ms: 400, impacto: 0.48, sacude: 0,
    proyectil: null, chorro: null, anillo: null, defensivo: false,
  }),

  /** Embestida: el cuerpo entero por delante, agachado y sin arma. La más larga. */
  embestida: Object.freeze({
    avance: 0.68, impulso: 0.3, alzar: 0.03, inclinar: 0.3, giro: 0,
    arma: 0, cabeza: 0.15, ms: 620, impacto: 0.58, sacude: 10,
    proyectil: null, chorro: null, anillo: null, defensivo: false,
  }),

  /** Aliento: NO se mueve. Se yergue, echa la cabeza atrás y suelta un cono. */
  aliento: Object.freeze({
    avance: 0, impulso: -0.1, alzar: 0.1, inclinar: -0.26, giro: 0,
    arma: 0, cabeza: -0.6, ms: 760, impacto: 0.62, sacude: 6,
    proyectil: null, chorro: Object.freeze({ n: 54, vel: 5.5, ancho: 0.5 }), anillo: null, defensivo: false,
  }),

  /** Proyectil: NO se mueve. Carga, lanza y lo que viaja es la bola, no la criatura. */
  proyectil: Object.freeze({
    avance: 0, impulso: -0.14, alzar: 0.06, inclinar: -0.12, giro: 0,
    arma: 0.7, cabeza: 0, ms: 680, impacto: 0.74, sacude: 0,
    proyectil: Object.freeze({ tam: 0.18, ms: 260 }), chorro: null, anillo: null, defensivo: false,
  }),

  /** Conjuro: NO se mueve. Se eleva, se enciende y el anillo se le escapa hacia el rival. */
  conjuro: Object.freeze({
    avance: 0, impulso: -0.06, alzar: 0.28, inclinar: -0.1, giro: 0,
    arma: 0.5, cabeza: -0.2, ms: 820, impacto: 0.7, sacude: 0,
    proyectil: null, chorro: null, anillo: Object.freeze({ ms: 420 }), defensivo: false,
  }),

  /** Guardia: no es un ataque. Se encoge y se cubre. */
  guardia: Object.freeze({
    avance: -0.08, impulso: 0, alzar: -0.08, inclinar: 0.18, giro: 0,
    arma: -0.5, cabeza: 0.15, ms: 480, impacto: 0.5, sacude: 0,
    proyectil: null, chorro: null, anillo: null, defensivo: true,
  }),

  /** Apoyo: tampoco es un ataque. Se crece, brazos arriba. */
  apoyo: Object.freeze({
    avance: 0, impulso: 0, alzar: 0.2, inclinar: -0.18, giro: 0,
    arma: -0.9, cabeza: -0.25, ms: 620, impacto: 0.5, sacude: 0,
    proyectil: null, chorro: null, anillo: Object.freeze({ ms: 520 }), defensivo: true,
  }),
});

/** La de reserva: si llega un valor que no conocemos, un golpe con arma siempre vale. */
export const POR_DEFECTO = "arma";

/** Nombres que este motor sabe animar. */
export const NOMBRES = Object.freeze(Object.keys(ANIMACIONES));

/** ¿Se anima este valor del contrato? */
export const sabeAnimar = (n) => Object.hasOwn(ANIMACIONES, String(n ?? ""));

/**
 * Valores del contrato de `combat.js` que este motor NO sabe animar. Vacío a propósito: si el
 * equipo de contenido añade un valor nuevo a `VALORES_3D.ataque`, sale aquí y hay que decidir qué
 * hace en pantalla, en vez de que se quede mudo con el gesto de reserva.
 * @param {string[]} valores `VALORES_3D.ataque`
 */
export const sinDescriptor = (valores = []) => valores.filter((v) => !sabeAnimar(v));

/** Las que mueven a la criatura de su sitio. El resto se lanzan desde donde están. */
export const viaja = (n) => (ANIMACIONES[n] ?? ANIMACIONES[POR_DEFECTO]).avance > 0.1;

/**
 * Descriptor listo para usar, con el ajuste por crítico o golpe brutal ya aplicado.
 *
 * Un crítico no cambia el GESTO, lo exagera: se avanza un poco más, el arco es más amplio y dura
 * un pelín más. Así un mordisco crítico sigue siendo un mordisco, no se convierte en otra cosa.
 *
 * @param {string} nombre valor de `VALORES_3D.ataque`
 * @param {{critico?:boolean, brutal?:boolean}} [o]
 * @returns {object} copia con `nombre` incluido
 */
export function descriptor(nombre, { critico = false, brutal = false } = {}) {
  const base = ANIMACIONES[String(nombre ?? "")] ?? ANIMACIONES[POR_DEFECTO];
  const k = brutal ? 1.3 : critico ? 1.15 : 1;
  const lento = brutal ? 1.45 : critico ? 1.2 : 1;
  return {
    ...base,
    nombre: sabeAnimar(nombre) ? String(nombre) : POR_DEFECTO,
    avance: base.avance * (base.avance > 0 ? k : 1),
    alzar: base.alzar * k,
    arma: base.arma * k,
    cabeza: base.cabeza * k,
    ms: Math.round(base.ms * lento),
    sacude: base.sacude + (brutal ? 14 : critico ? 9 : 0),
  };
}

/**
 * Qué animación toca, dadas la del movimiento concreto y la de la ficha de la criatura.
 *
 * La regla no es «manda el evento» a secas, y tiene su motivo. El movimiento genérico `ataque`
 * declara `arma`, que es el valor de reserva del contrato: el que se usa cuando un movimiento no
 * tiene nada particular que decir. Si eso pisara a la ficha, **un dragón daría un espadazo en su
 * ataque normal** aunque su ficha diga `aliento`, y se perdería justo lo que hace distinta a cada
 * criatura. Así que:
 *
 *  1. Un movimiento que declara algo DISTINTO de `arma` manda siempre (un `bola_fuego` es un
 *     proyectil lo lance quien lo lance).
 *  2. Si el movimiento dice `arma` (o no dice nada), manda la ficha de la criatura.
 *  3. Y si la criatura tampoco dice nada, golpe con arma.
 *
 * En la práctica los movimientos que declaran `arma` son de criaturas cuya ficha ya es `arma`
 * (goblin, esqueleto, bandido, orco, caballero), así que la regla no le quita el gesto a nadie.
 *
 * @param {string|null} delEvento lo que devuelve `animacion3d(ev.id)`
 * @param {string|null} deLaCriatura el `ataque3d` de su ficha
 */
export function elegir(delEvento, deLaCriatura) {
  if (sabeAnimar(delEvento) && delEvento !== POR_DEFECTO) return String(delEvento);
  if (sabeAnimar(deLaCriatura)) return String(deLaCriatura);
  if (sabeAnimar(delEvento)) return String(delEvento);
  return POR_DEFECTO;
}
