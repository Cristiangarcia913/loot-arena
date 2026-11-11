// Rendimiento: adivinar de qué es capaz el equipo, medir los fps de verdad y bajar la calidad
// sola cuando hace falta. Módulo casi puro (todo lo del navegador entra por parámetro), así que
// se prueba en Node.

/**
 * Perfiles de calidad.
 *
 * `dpr` es el tope de píxeles por píxel CSS y `maxPixeles` el tope ABSOLUTO de píxeles del lienzo.
 * Hacen falta los dos. Con solo `dpr` pasaba esto: en una pantalla de `devicePixelRatio` 1,25,
 * bajar de «alto» (tope 2) a «medio» (tope 1,5) no quitaba ni un píxel, porque 1,25 ya estaba por
 * debajo de los dos topes. O sea que bajar la calidad no servía de nada justo en el caso que la
 * necesitaba: una arena grande (1296×620 = 1,26 millones de píxeles) en una tarjeta integrada.
 * El presupuesto de píxeles sí se adapta al tamaño real de la arena, que es lo que varía entre la
 * demo (pequeña) y el juego a pantalla completa.
 */
export const CALIDADES = Object.freeze({
  alto:  Object.freeze({ dpr: 2,    maxPixeles: 1300000, sombras: true,  muestras: true,  polvo: 220, antorchas: 4, segmentos: 24, luzPorAntorcha: true }),
  medio: Object.freeze({ dpr: 1.5,  maxPixeles:  850000, sombras: false, muestras: true,  polvo: 120, antorchas: 4, segmentos: 16, luzPorAntorcha: true }),
  bajo:  Object.freeze({ dpr: 1,    maxPixeles:  480000, sombras: false, muestras: false, polvo: 0,   antorchas: 2, segmentos: 10, luzPorAntorcha: false }),
});

/** Nunca se baja de aquí: por debajo se ve a cuadros y ya no compensa. */
export const DPR_MINIMO = 0.6;

/**
 * Píxeles por píxel CSS que toca usar para un lienzo de `w`×`h` con la calidad `cal`.
 * Respeta el tope de `dpr` y además el presupuesto de píxeles del perfil.
 * @param {number} w @param {number} h ancho y alto en píxeles CSS
 * @param {{dpr:number, maxPixeles?:number}} cal perfil de CALIDADES
 * @param {number} [dprPantalla] `devicePixelRatio`
 * @param {number} [tope] tope extra que pida quien monta la escena
 * @returns {number}
 */
export function pixelesPorCss(w, h, cal, dprPantalla = 1, tope = 0) {
  const area = Math.max(1, w) * Math.max(1, h);
  let dpr = Math.min(Number(dprPantalla) || 1, tope || cal.dpr);
  const presupuesto = cal.maxPixeles;
  if (presupuesto && area * dpr * dpr > presupuesto) dpr = Math.sqrt(presupuesto / area);
  return Math.max(DPR_MINIMO, Math.round(dpr * 1000) / 1000);
}

/**
 * Hueco entre fotogramas a partir del cual se entiende que la página va ESTRANGULADA (pestaña de
 * fondo, ventana tapada) y no simplemente lenta. El navegador estrangula a ~1 fotograma por
 * segundo, así que los huecos de verdad son de ~1000 ms; un equipo lento de verdad da 30-200 ms.
 * Antes estaba en 100 ms, y eso descartaba como «estrangulado» a un equipo que iba a 30 fps con
 * algún tirón de 187 ms: justo al que había que bajarle la calidad.
 */
export const HUECO_ESTRANGULADO = 250;

/** Hueco a partir del cual el fotograma ni se cuenta: seguro que es un parón del navegador. */
export const HUECO_DESCARTADO = 350;

/** Orden de peor a mejor, para subir y bajar un escalón. */
export const ESCALERA = Object.freeze(["bajo", "medio", "alto"]);

// GPU que no dan para el perfil alto. Dos listas separadas a propósito:
//  · renderizadores por software (no hay una GPU de verdad detrás);
//  · integradas antiguas. OJO con el borde de palabra: `\bhd graphics\b` NO casa con «UHD
//    Graphics» ni con «Iris Xe», que son modernas y mueven esta escena de sobra. Una versión
//    anterior de esta expresión sí las casaba y mandaba un portátil normal al perfil «bajo».
const GPU_SOFTWARE = /swiftshader|software|basic render|llvmpipe|mesa offscreen|microsoft basic|paravirtual/i;
const GPU_VIEJA = /intel.*\bhd graphics\b|intel.*\bgma\b|\bmali-4\d\d\b|\badreno \d{2}\b/i;
const GPU_FLOJA = (renderer) => GPU_SOFTWARE.test(renderer) || GPU_VIEJA.test(renderer);

/**
 * Decide el perfil de calidad con lo que se sabe del equipo. Conservador a propósito: es mejor
 * empezar en «medio» y subir que empezar en «alto» y que el primer combate vaya a tirones.
 * @param {{nucleos?:number, memoria?:number, movil?:boolean, dpr?:number, renderer?:string, webgl2?:boolean}} [info]
 * @returns {"alto"|"medio"|"bajo"}
 */
export function nivelEquipo(info = {}) {
  const nucleos = Number(info.nucleos) || 0;
  const memoria = Number(info.memoria) || 0; // GiB, solo Chromium
  const dpr = Number(info.dpr) || 1;
  const movil = !!info.movil;
  const renderer = String(info.renderer ?? "");

  if (GPU_FLOJA(renderer)) return "bajo";
  if (info.webgl2 === false) return "bajo";
  if (nucleos && nucleos <= 2) return "bajo";
  if (memoria && memoria <= 2) return "bajo";

  if (movil) {
    // En el móvil manda el número de píxeles: una pantalla 3x con 4 núcleos se ahoga.
    if (nucleos >= 8 && dpr <= 3) return "medio";
    return nucleos >= 6 ? "medio" : "bajo";
  }
  if (nucleos >= 8 && (!memoria || memoria >= 8)) return "alto";
  if (nucleos >= 4) return "medio";
  return nucleos ? "medio" : "medio"; // sin datos: término medio
}

/**
 * Lee del navegador lo que hace falta para `nivelEquipo`.
 * @param {{navigator?:object, devicePixelRatio?:number}} [ventana]
 * @param {{renderer?:string, webgl2?:boolean}|null} [gpu] lo que devuelve `tres.infoGpu()`
 */
export function detectarEquipo(ventana = globalThis, gpu = null) {
  const nav = ventana?.navigator ?? {};
  const uaMovil = /Android|iPhone|iPad|iPod|Mobile|Silk|Opera Mini/i.test(String(nav.userAgent ?? ""));
  return {
    nucleos: Number(nav.hardwareConcurrency) || 0,
    memoria: Number(nav.deviceMemory ?? nav.deviceMemoryGB) || 0,
    movil: nav.userAgentData?.mobile ?? uaMovil,
    dpr: Number(ventana?.devicePixelRatio) || 1,
    renderer: gpu?.renderer ?? "",
    webgl2: gpu?.webgl2,
  };
}

/** Un escalón arriba / abajo en la escalera de calidad (se queda en los extremos). */
export const bajarCalidad = (c) => ESCALERA[Math.max(0, ESCALERA.indexOf(c) - 1)] ?? "bajo";
export const subirCalidad = (c) => ESCALERA[Math.min(ESCALERA.length - 1, ESCALERA.indexOf(c) + 1)] ?? "alto";

/**
 * Medidor de fotogramas por segundo con ventana deslizante de 1 segundo.
 * No usa `performance` por su cuenta: el bucle de render le pasa el instante de cada fotograma.
 */
export class Medidor {
  /** @param {{ventanaMs?:number}} [o] */
  constructor({ ventanaMs = 1000 } = {}) {
    this.ventanaMs = ventanaMs;
    this.marcas = [];
    /** fps de la última ventana completa (0 hasta que hay datos). */
    this.fps = 0;
    /** peor fps visto desde el último `reiniciar()`. */
    this.peor = Infinity;
    /** mejor fps visto. */
    this.mejor = 0;
    /** milisegundos del fotograma más lento de la ventana (el «tirón»). */
    this.peorFotograma = 0;
    /** el hueco más grande DENTRO de la ventana actual. */
    this.huecoMax = 0;
    this.total = 0;
  }

  /**
   * ¿La medida es de marcha normal? Falsa mientras la página va estrangulada (pestaña de fondo,
   * ventana tapada) o acaba de arrancar: en esos huecos los fps no dicen nada del equipo y, si se
   * les hace caso, se baja la calidad sin motivo.
   */
  estable() {
    return this.total > 20 && this.marcas.length >= 6 && this.huecoMax > 0 && this.huecoMax < HUECO_ESTRANGULADO;
  }

  /**
   * Un fotograma más.
   * @param {number} t instante en ms (`performance.now()`)
   * @returns {number} fps actuales
   */
  fotograma(t) {
    const ult = this.marcas.at(-1);
    if (ult != null) this.peorFotograma = Math.max(this.peorFotograma, t - ult);
    this.marcas.push(t);
    this.total++;
    const corte = t - this.ventanaMs;
    while (this.marcas.length && this.marcas[0] < corte) this.marcas.shift();
    if (this.marcas.length >= 2) {
      const lapso = this.marcas.at(-1) - this.marcas[0];
      this.fps = lapso > 0 ? ((this.marcas.length - 1) * 1000) / lapso : 0;
      // El «peor» solo cuenta si la ventana es de marcha normal. Una ventana que todavía arrastra
      // el parón del arranque (compilar shaders) o un cambio de pestaña no dice nada de lo que
      // da el equipo, y antes ensuciaba el peor dato de toda la sesión.
      this.huecoMax = this.marcas.reduce((m, x, i) => (i ? Math.max(m, x - this.marcas[i - 1]) : m), 0);
      if (this.total > 20 && this.huecoMax < HUECO_ESTRANGULADO) {
        this.peor = Math.min(this.peor, this.fps);
        this.mejor = Math.max(this.mejor, this.fps);
      }
    }
    return this.fps;
  }

  reiniciar() {
    this.marcas.length = 0;
    this.fps = 0;
    this.peor = Infinity;
    this.mejor = 0;
    this.peorFotograma = 0;
    this.huecoMax = 0;
    this.total = 0;
  }

  /** Resumen legible para la demo y para el informe. */
  resumen() {
    return {
      fps: Math.round(this.fps),
      peor: Number.isFinite(this.peor) ? Math.round(this.peor) : 0,
      mejor: Math.round(this.mejor),
      peorFotogramaMs: Math.round(this.peorFotograma),
      fotogramas: this.total,
    };
  }
}

/**
 * Vigilante de calidad: si los fps se quedan bajos un rato seguido, pide bajar un escalón.
 * Nunca sube la calidad sola (subir y bajar en bucle se ve peor que ir un poco justo).
 */
export class Vigilante {
  /**
   * @param {{objetivo?:number, pacienciaMs?:number, maxBajadas?:number}} [o]
   *        objetivo: fps por debajo de los cuales se considera que va mal (55, para 60 Hz)
   *        pacienciaMs: cuánto tiene que ir mal antes de actuar
   */
  constructor({ objetivo = 55, pacienciaMs = 1800, maxBajadas = 2 } = {}) {
    this.objetivo = objetivo;
    this.pacienciaMs = pacienciaMs;
    this.maxBajadas = maxBajadas;
    this.bajadas = 0;
    /** Instante en que empezó a ir mal, o null. (null y no 0: `performance.now()` puede dar 0.) */
    this.desde = null;
  }

  /**
   * @param {number} fps medidos
   * @param {number} t instante en ms
   * @returns {"nada"|"bajar"|"rendirse"} `bajar`: baja un escalón. `rendirse`: ni con el mínimo va.
   */
  revisar(fps, t) {
    if (!fps) return "nada";
    if (fps >= this.objetivo) { this.desde = null; return "nada"; }
    if (this.desde == null) { this.desde = t; return "nada"; }
    if (t - this.desde < this.pacienciaMs) return "nada";
    this.desde = null;
    if (this.bajadas >= this.maxBajadas) return "rendirse";
    this.bajadas++;
    return "bajar";
  }
}

/**
 * ¿El usuario pidió movimiento reducido? Igual que en fx.js, con `matchMedia` inyectable.
 * @param {{matches:boolean}|null} [mq]
 */
export const movimientoReducido = (mq) => !!(mq ?? consultaReducido())?.matches;

/** `matchMedia("(prefers-reduced-motion: reduce)")` o un sustituto inerte fuera del navegador. */
export function consultaReducido(ventana = globalThis) {
  return typeof ventana?.matchMedia === "function"
    ? ventana.matchMedia("(prefers-reduced-motion: reduce)")
    : { matches: false, addEventListener() {}, removeEventListener() {} };
}

/**
 * Duración de una animación teniendo en cuenta el movimiento reducido: se recorta mucho, pero no
 * a cero, porque `main.js` encadena `await` y a 0 ms el combate pasaría en un fogonazo.
 * @param {number} ms @param {boolean} reducido
 */
export const duracion = (ms, reducido) => (reducido ? Math.max(60, Math.round(ms * 0.25)) : ms);
