// La cámara con intención: deja de ser un plano fijo y acompaña a lo que pasa en el combate.
//
// Este módulo es SOLO matemáticas: no importa three.js ni toca el DOM. Recibe el encuadre base
// (lo que calcula `escenario.encuadre`) y devuelve, fotograma a fotograma, dónde va la cámara y
// a dónde mira. Así se puede comprobar en Node lo único que de verdad importa aquí: que por
// mucho que se acerque, **nunca deja fuera de plano a quien está luchando**.
//
// Tres reglas, en este orden:
//  1. No estorbar. Un plano bonito que te hace perder de vista el combate es un plano malo.
//  2. Interrumpible. Si llega otra acción a mitad de movimiento, la cámara va hacia la nueva
//     desde donde esté. Nunca un salto.
//  3. Se puede apagar. A mucha gente el movimiento de cámara le marea de verdad; con
//     `prefers-reduced-motion` la cámara se queda quieta en el plano de reposo.

/**
 * Planos disponibles. Cada uno se expresa en RELATIVO al encuadre base, no en metros, para que
 * valga igual en un móvil en vertical que en un monitor ancho.
 *
 * - `acercar`: 1 = igual; 0,8 = un 20 % más cerca.
 * - `ladear`: cuánto se desplaza la cámara hacia el lado de quien actúa (0..1 del medio plano).
 * - `bajar`: cuánto baja la cámara respecto a su altura normal, en metros.
 * - `ms`: cuánto dura antes de volver solo al reposo.
 * - `prisa`: lo vivo que es el muelle que lleva la cámara a ese plano, en radianes por segundo.
 *   Más alto = entra más seco. No es una velocidad: el muelle arranca parado y frena solo.
 */
export const PLANOS = Object.freeze({
  /** El de siempre: los dos luchadores encuadrados y una deriva lenta. */
  reposo:       Object.freeze({ acercar: 1,    ladear: 0,    bajar: 0,    ms: 0,    prisa: 4 }),
  /** Alguien embiste: nos metemos un poco y hacia su lado. */
  embestida:    Object.freeze({ acercar: 0.88, ladear: 0.30, bajar: 0.12, ms: 420,  prisa: 9 }),
  /** Golpe que importa: más cerca y más bajo, pero poco tiempo. */
  critico:      Object.freeze({ acercar: 0.78, ladear: 0.42, bajar: 0.28, ms: 520,  prisa: 13 }),
  /** El enemigo prepara algo gordo: nos APARTAMOS para que se vea venir. */
  telegrafiado: Object.freeze({ acercar: 1.16, ladear: -0.12, bajar: -0.1, ms: 1100, prisa: 5 }),
  /** Aparece una criatura: se la encuadra a ella un momento. */
  aparicion:    Object.freeze({ acercar: 0.9,  ladear: 0.38, bajar: -0.05, ms: 900,  prisa: 7 }),
  /** Alguien cae: nos acercamos despacio y aguantamos. */
  muerte:       Object.freeze({ acercar: 0.82, ladear: 0.34, bajar: 0.1,  ms: 1300, prisa: 5 }),
  /** Se abre el cofre: al centro de la arena, un poco más bajo. */
  botin:        Object.freeze({ acercar: 0.72, ladear: 0,    bajar: 0.25, ms: 2600, prisa: 7 }),
});

/** Nombres válidos de plano. */
export const NOMBRES_PLANO = Object.freeze(Object.keys(PLANOS));

/** Por debajo de esto no se cierra el plano jamás, diga lo que diga el cálculo. */
export const ACERCAMIENTO_MAXIMO = 0.6;

/** Cuánto se juntan los luchadores durante una embestida (el que ataca avanza un 42 %). */
export const JUNTARSE_EMBISTIENDO = 0.42;

const limitar = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * Lo más que se puede cerrar el plano SIN dejar fuera a quien lucha.
 *
 * `encuadre` calcula la distancia justa para que los dos quepan, así que cualquier acercamiento
 * recorta algo. Cuánto se puede recortar depende de dos cosas que cambian en cada combate:
 * lo ancho que sea el bicho (una rata deja mucho margen, un dragón casi ninguno) y lo juntos que
 * estén en ese instante (embistiendo están mucho más cerca que en reposo). Por eso esto se
 * calcula, no es una constante: con una constante, o se quedaba corto para la rata o recortaba
 * al dragón.
 *
 * @param {{cobertura:number, puesto:number}} enc encuadre base
 * @param {number} radio medio ancho del más ancho de los dos, en metros
 * @param {number} [juntos] 0 = en sus puestos, 1 = encima el uno del otro
 * @returns {number} factor mínimo de acercamiento (1 = no acercarse nada)
 */
export function acercamientoSeguro(enc, radio = 0.7, juntos = 0) {
  const cobertura = Math.max(0.1, enc?.cobertura ?? 3.3);
  const separacion = Math.max(0, enc?.puesto ?? 1.9) * (1 - limitar(juntos, 0, 1) * JUNTARSE_EMBISTIENDO);
  const necesario = (separacion + Math.max(0.2, radio)) / cobertura;
  return limitar(necesario, ACERCAMIENTO_MAXIMO, 1);
}

/**
 * Director de cámara. Guarda dónde está la cámara ahora y hacia qué plano va, y en cada fotograma
 * se acerca un poco al objetivo. Nunca teletransporta: por eso es interrumpible gratis.
 */
export class Director {
  /**
   * @param {{reducido?:() => boolean, viva?:boolean}} [o]
   *        reducido: función que dice si el usuario pidió movimiento reducido.
   *        viva: false deja la cámara fija en reposo aunque no haya movimiento reducido.
   */
  constructor({ reducido = () => false, viva = true } = {}) {
    this.leerReducido = reducido;
    this.viva = viva;
    /** Encuadre base, el que calcula `escenario.encuadre`. */
    this.enc = { distancia: 6, fov: 42, miraY: 1, puesto: 1.9, cobertura: 3.3 };
    this.alto = 1.95;
    /** Estado actual y su velocidad: la cámara va con un muelle, no con una interpolación. */
    this.act = { acercar: 1, ladear: 0, bajar: 0 };
    this.vel = { acercar: 0, ladear: 0, bajar: 0 };
    /** A dónde vamos. `ladear` ya lleva el signo del lado. */
    this.obj = { acercar: 1, ladear: 0, bajar: 0 };
    this.plano = "reposo";
    this.lado = 0;          // -1 héroe, +1 enemigo, 0 centro
    this.hasta = 0;         // instante en que este plano caduca
    /** Medio ancho del luchador más ancho que hay en la arena, y cuánto se están juntando. */
    this.radio = 0.7;
    this.juntos = 0;
    this.prisa = PLANOS.reposo.prisa;
    this.t = 0;
  }

  /** ¿Está la cámara quieta a propósito? */
  get quieta() { return !this.viva || !!this.leerReducido(); }

  /**
   * Nuevo encuadre base (al cambiar el tamaño de la ventana o la criatura que hay en la arena).
   * @param {object} enc lo que devuelve `escenario.encuadre`
   * @param {number} [alto] altura de la cámara
   * @param {number} [radio] medio ancho del luchador más ancho, para el límite de acercamiento
   */
  encuadrar(enc, alto, radio) {
    if (enc) this.enc = enc;
    if (Number.isFinite(alto)) this.alto = alto;
    if (Number.isFinite(radio)) this.radio = radio;
  }

  /** Cuánto se están juntando los luchadores ahora mismo (0..1). Lo pone la embestida. */
  juntando(v) { this.juntos = limitar(Number(v) || 0, 0, 1); }

  /**
   * Pide un plano. No salta: a partir de aquí la cámara se mueve hacia él desde donde esté, así
   * que llamar a esto en mitad de otro movimiento es correcto y no se nota ningún corte.
   * @param {keyof PLANOS} nombre
   * @param {{lado?:number, ahora?:number, ms?:number}} [o] lado: -1 héroe, +1 enemigo, 0 centro
   */
  pedir(nombre, { lado = 0, ahora = 0, ms } = {}) {
    const p = PLANOS[nombre];
    if (!p) return;
    if (this.quieta) { this.plano = "reposo"; this.obj = { ...PLANOS.reposo }; this.lado = 0; return; }
    this.plano = nombre;
    this.lado = limitar(Number(lado) || 0, -1, 1);
    // El lado se mete YA en el objetivo, con su signo. Si se guardara aparte y se multiplicara al
    // dibujar, cambiar de lado a mitad de movimiento daría la vuelta a la cámara de golpe; así
    // el muelle pasa suavemente por el centro.
    this.obj = { acercar: p.acercar, ladear: p.ladear * this.lado, bajar: p.bajar };
    this.prisa = p.prisa;
    this.hasta = p.ms ? ahora + (Number(ms) || p.ms) : 0;
  }

  /** Vuelve al reposo (lo hace solo cuando caduca el plano, pero se puede forzar). */
  reposar() {
    this.plano = "reposo";
    this.obj = { acercar: 1, ladear: 0, bajar: 0 };
    this.lado = 0;
    this.prisa = PLANOS.reposo.prisa;
    this.hasta = 0;
  }

  /**
   * Un fotograma. Devuelve dónde poner la cámara y a dónde mirar, ya en metros.
   *
   * @param {number} dt segundos desde el fotograma anterior
   * @param {number} ahora instante en ms (`performance.now()`)
   * @param {number} [s] segundos desde que arrancó la escena, para la deriva lenta
   * @returns {{x:number, y:number, z:number, miraX:number, miraY:number, fov:number}}
   */
  paso(dt, ahora, s = 0) {
    const enc = this.enc;
    if (this.hasta && ahora >= this.hasta) this.reposar();

    if (this.quieta) {
      this.act = { acercar: 1, ladear: 0, bajar: 0 };
      this.vel = { acercar: 0, ladear: 0, bajar: 0 };
      return { x: 0, y: this.alto, z: enc.distancia, miraX: 0, miraY: enc.miraY, fov: enc.fov };
    }

    // Muelle críticamente amortiguado: arranca PARADO (por eso no hay tirón en el primer
    // fotograma de un plano nuevo), frena solo al llegar y no se pasa. Y como lo que se conserva
    // es la velocidad, cambiar de plano a mitad de camino sale continuo sin hacer nada especial:
    // ahí está lo de «interrumpible sin saltos».
    // Se parte en trozos pequeños para que el resultado no dependa de los fps.
    const w = this.prisa;
    const paso = Math.min(Math.max(dt, 0.0005), 1 / 30);
    let resto = Math.min(dt, 0.25);
    while (resto > 0) {
      const h = Math.min(paso, resto);
      resto -= h;
      for (const campo of ["acercar", "ladear", "bajar"]) {
        const a = (this.obj[campo] - this.act[campo]) * w * w - this.vel[campo] * 2 * w;
        this.vel[campo] += a * h;
        this.act[campo] += this.vel[campo] * h;
      }
    }

    // REGLA DE SEGURIDAD: por muy cerrado que lo pida el plano, nunca tanto como para perder de
    // vista a uno de los dos. El mínimo se calcula con quién hay en la arena y lo juntos que están.
    const minimo = acercamientoSeguro(enc, this.radio, this.juntos);
    const acercar = limitar(this.act.acercar, minimo, 1.3);
    const dist = enc.distancia * acercar;

    // Deriva lenta de siempre, más suave cuanto más cerrado está el plano (si no, marea).
    const calma = acercar;
    const derivaX = Math.sin(s * 0.16) * 0.34 * calma;
    const derivaY = Math.sin(s * 0.23 + 1.2) * 0.07 * calma;
    const derivaZ = Math.cos(s * 0.13) * 0.2 * calma;

    const desplazar = this.act.ladear * enc.puesto;   // `ladear` ya viene con signo
    return {
      x: desplazar + derivaX,
      y: this.alto - this.act.bajar + derivaY,
      z: dist + derivaZ,
      miraX: desplazar * 0.55,
      miraY: enc.miraY,
      fov: enc.fov,
    };
  }

  /**
   * Medio ancho que se ve con el estado actual. Sirve para comprobar que no se pierde a nadie.
   * @param {number} aspecto ancho/alto del lienzo
   */
  coberturaActual() {
    const minimo = acercamientoSeguro(this.enc, this.radio, this.juntos);
    return this.enc.cobertura * limitar(this.act.acercar, minimo, 1.3);
  }

  /** ¿Se ve ahora mismo a los dos luchadores? Es la regla que no se puede romper nunca. */
  cabenLosDos() {
    const separacion = this.enc.puesto * (1 - this.juntos * JUNTARSE_EMBISTIENDO);
    return this.coberturaActual() >= separacion + this.radio - 0.02;
  }
}
