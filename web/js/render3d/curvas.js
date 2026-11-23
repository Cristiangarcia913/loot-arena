// Curvas de animación: las que separan un movimiento «de programador» de uno de animador.
//
// Todo puro (sin three.js ni DOM), así que se prueba en Node. Cada curva recibe `p` en 0..1 y
// devuelve el avance (normalmente 0..1, pero las que tienen sobreimpulso se salen a propósito).
//
// Principios que cubren (los clásicos de animación):
//  · Anticipación: antes de un golpe se carga hacia atrás (`anticipar`).
//  · Sobreimpulso y asentamiento: lo que llega se pasa un poco y vuelve (`atrasSalida`, `muelle`).
//  · Gravedad: lo que cae ACELERA, no frena (`caida`), y rebota al tocar suelo (`rebote`).
//  · Squash & stretch: se aplasta al cargar/aterrizar y se estira al lanzarse (`aplastar`).
//  · Movimiento orgánico: ruido suave en vez de aleatorio por fotograma (`ruido1d`).

const limitar01 = (p) => (p <= 0 ? 0 : p >= 1 ? 1 : p);

/** Aceleración suave al principio y al final (ease-in-out cúbica). */
export function suaveCubica(p) {
  const t = limitar01(p);
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** Entra rápido y frena (ease-out cúbica): lo que se lanza. */
export function salidaCubica(p) {
  return 1 - (1 - limitar01(p)) ** 3;
}

/** Empieza lento y acelera (ease-in cuadrática): lo que cae por su peso. */
export function caida(p) {
  const t = limitar01(p);
  return t * t;
}

/**
 * Ease-out con sobreimpulso: se pasa del destino y vuelve (llegar con inercia).
 * @param {number} p @param {number} [fuerza=1.70158] cuánto se pasa (1,7 ≈ 10 %)
 */
export function atrasSalida(p, fuerza = 1.70158) {
  const t = limitar01(p) - 1;
  return 1 + (fuerza + 1) * t * t * t + fuerza * t * t;
}

/**
 * Anticipación: retrocede un poco (valor negativo) antes de avanzar hasta 1.
 * @param {number} p @param {number} [carga=0.3] fracción del tiempo que dura la carga
 * @param {number} [retroceso=0.25] cuánto se echa atrás (en unidades del recorrido)
 */
export function anticipar(p, carga = 0.3, retroceso = 0.25) {
  const t = limitar01(p);
  if (t < carga) return -retroceso * Math.sin((t / carga) * Math.PI * 0.5);
  const q = (t - carga) / (1 - carga);
  return -retroceso + (1 + retroceso) * salidaCubica(q);
}

/**
 * Muelle amortiguado que parte de 1 y se asienta en 0 oscilando: el «temblor» de un golpe que
 * recibe un cuerpo, un péndulo que se para, un objeto que vibra tras chocar.
 * @param {number} p @param {number} [oscilaciones=2.5] medias vueltas visibles
 * @param {number} [amortiguacion=5] lo rápido que se apaga
 */
export function muelle(p, oscilaciones = 2.5, amortiguacion = 5) {
  const t = limitar01(p);
  return Math.exp(-amortiguacion * t) * Math.cos(t * Math.PI * oscilaciones);
}

/**
 * Caída con rebotes al llegar al suelo (ease-out bounce): 0 arriba, 1 en el suelo.
 * Tres botes decrecientes, como un cuerpo pesado que se desploma.
 */
export function rebote(p) {
  const t = limitar01(p);
  const n = 7.5625, d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) { const u = t - 1.5 / d; return n * u * u + 0.75; }
  if (t < 2.5 / d) { const u = t - 2.25 / d; return n * u * u + 0.9375; }
  const u = t - 2.625 / d;
  return n * u * u + 0.984375;
}

/**
 * Squash & stretch que conserva el volumen: con `k` > 0 se estira en vertical y adelgaza; con
 * `k` < 0 se aplasta y ensancha. Devuelve [escalaXZ, escalaY].
 * @param {number} k deformación (-0,3..0,3 es el rango razonable)
 */
export function aplastar(k) {
  const y = 1 + k;
  const xz = 1 / Math.sqrt(Math.max(0.2, y));
  return [xz, y];
}

/**
 * Campana 0 → 1 → 0 suave (seno), para pulsos y saltos.
 */
export function campana(p) {
  return Math.sin(limitar01(p) * Math.PI);
}

/**
 * Ruido 1D suave y determinista en [-1, 1]: suma de senos de frecuencias no armónicas. Sirve para
 * sacudidas de cámara y movimientos «vivos» que no se repiten a ojo. A diferencia de
 * `Math.random()` por fotograma, es continuo: no tiembla, se mece.
 * @param {number} t tiempo (s) @param {number} [semilla=0]
 */
export function ruido1d(t, semilla = 0) {
  const s = semilla * 12.9898;
  return (
    Math.sin(t * 1.0 + s) * 0.5 +
    Math.sin(t * 2.2361 + s * 1.7) * 0.3 +
    Math.sin(t * 4.1231 + s * 2.3) * 0.2
  );
}

/**
 * Interpola por tramos: `tramos` es una lista de [finDelTramo, curva] con `finDelTramo` creciente
 * hasta 1. Devuelve el índice del tramo y el avance local 0..1 ya pasado por su curva.
 * Útil para coreografías (carga → golpe → recuperación) sin un bosque de `if`.
 * @param {number} p @param {Array<[number, (q:number)=>number]>} tramos
 * @returns {{i:number, q:number}}
 */
export function tramo(p, tramos) {
  const t = limitar01(p);
  let ini = 0;
  for (let i = 0; i < tramos.length; i++) {
    const [fin, curva] = tramos[i];
    if (t <= fin || i === tramos.length - 1) {
      const q = fin > ini ? limitar01((t - ini) / (fin - ini)) : 1;
      return { i, q: curva ? curva(q) : q };
    }
    ini = fin;
  }
  return { i: tramos.length - 1, q: 1 };
}
