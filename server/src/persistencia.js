// Pegamento entre los registros en memoria y la capa `almacen.js` (1.4).
//
// DISEÑO: *caché con escritura retrasada* (write-behind).
//   - Al arrancar se lee UNA vez cada clave y se vuelca en el registro (`restaurar`).
//   - Durante la partida, leer y escribir sigue siendo SÍNCRONO y en memoria: las rutas
//     de Express no esperan al almacén, así que una caída de Upstash no añade latencia
//     ni rompe `/ganar`, `/gas` o `/torre`.
//   - Cada cambio marca el registro como "sucio" y, pasados `RETARDO_GUARDADO_MS`, se
//     guarda la instantánea completa. Varios cambios seguidos = una sola escritura.
//
// POR QUÉ ASÍ: el plan gratuito de Upstash da 500 000 comandos al mes (~16 600 al día).
// Agrupando las escrituras, un servidor con tráfico real gasta unos pocos cientos al día.
//
// LO QUE SE PIERDE: los cambios de los últimos ~1,5 s antes de un reinicio brusco. A
// cambio, ninguna petición del juego depende de la red del almacén.

/** Retardo de agrupación de escrituras (ms). */
export const RETARDO_GUARDADO_MS = 1500;

/** Claves que usa el servidor dentro del almacén. */
export const CLAVES = Object.freeze({
  diario: 'diario',
  primerBotin: 'primer-botin',
  gas: 'gas',
  torre: 'torre',
  botin: 'botin',
  ranking: 'ranking',
});

/**
 * Mantiene sincronizado un registro con una clave del almacén.
 * Los errores del almacén se registran y se reintentan, nunca se propagan a las rutas.
 */
export class Persistidor {
  /**
   * @param {{
   *   almacen: { leer: Function, escribir: Function },
   *   clave: string,
   *   instantanea: () => unknown,
   *   restaurar: (datos: unknown) => void,
   *   estado?: import('./almacen.js').EstadoAlmacen | null,
   *   logger?: Pick<Console, 'log' | 'error' | 'warn'>,
   *   retardoMs?: number,
   * }} opts
   */
  constructor({ almacen, clave, instantanea, restaurar, estado = null, logger = console, retardoMs = RETARDO_GUARDADO_MS }) {
    this.almacen = almacen;
    this.clave = clave;
    this.instantanea = instantanea;
    this.restaurar = restaurar;
    this.estado = estado;
    this.logger = logger;
    this.retardoMs = retardoMs;
    this.sucio = false;
    this.timer = null;
    this.enVuelo = null;
    this.repetir = false;
    this.guardados = 0;
    this.fallos = 0;
    this.cargado = false;
  }

  /**
   * Lee la clave y restaura el registro. Nunca lanza: si el almacén falla o los datos
   * están corruptos, se avisa y se arranca con el registro vacío.
   * @returns {Promise<boolean>} true si se restauró algo.
   */
  async cargar() {
    let datos;
    try {
      datos = await this.almacen.leer(this.clave);
    } catch (err) {
      this.logger.warn?.(`⚠ [almacen] no se pudo leer "${this.clave}": ${err?.message ?? err}`);
      this.estado?.anotarError(err);
      return false;
    }
    if (datos === null || datos === undefined) return false;
    try {
      this.restaurar(datos);
      this.cargado = true;
      return true;
    } catch (err) {
      this.logger.warn?.(`⚠ [almacen] datos inservibles en "${this.clave}" (se ignoran): ${err?.message ?? err}`);
      return false;
    }
  }

  /** Marca que hay cambios pendientes y programa el guardado agrupado. */
  marcar() {
    this.sucio = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.guardarAhora();
    }, this.retardoMs);
    // Un guardado pendiente no debe impedir que el proceso termine.
    this.timer.unref?.();
  }

  /** Escribe la instantánea actual. Agrupa llamadas simultáneas en una sola escritura. */
  async guardarAhora() {
    if (this.enVuelo) { this.repetir = true; return this.enVuelo; }
    if (!this.sucio) return;

    this.sucio = false;
    let datos;
    try {
      datos = this.instantanea();
    } catch (err) {
      this.logger.error(`[almacen] no se pudo preparar "${this.clave}":`, err?.message ?? err);
      return;
    }

    this.enVuelo = (async () => {
      try {
        await this.almacen.escribir(this.clave, datos);
        this.guardados += 1;
        this.estado?.anotarOk();
      } catch (err) {
        this.sucio = true; // se reintentará con el próximo cambio o en `vaciar()`
        this.fallos += 1;
        this.estado?.anotarError(err);
        this.logger.error(`[almacen] no se pudo guardar "${this.clave}":`, err?.message ?? err);
      }
    })();

    try {
      await this.enVuelo;
    } finally {
      this.enVuelo = null;
    }

    if (this.repetir) {
      this.repetir = false;
      if (this.sucio) await this.guardarAhora();
    }
  }

  /** Cancela el retardo y guarda ya lo pendiente (cierre del servidor y tests). */
  async vaciar() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.enVuelo) await this.enVuelo;
    if (this.sucio) await this.guardarAhora();
  }
}

/**
 * Engancha un registro al almacén: carga su estado y le pone el callback `alCambiar`.
 * @returns {Promise<Persistidor>}
 */
export async function conectar({ almacen, registro, clave, estado = null, logger = console, retardoMs = RETARDO_GUARDADO_MS }) {
  if (typeof registro?.instantanea !== 'function' || typeof registro?.restaurar !== 'function') {
    throw new Error(`El registro de "${clave}" no implementa instantanea()/restaurar()`);
  }
  const p = new Persistidor({
    almacen,
    clave,
    instantanea: () => registro.instantanea(),
    restaurar: (datos) => registro.restaurar(datos),
    estado,
    logger,
    retardoMs,
  });
  await p.cargar();
  registro.alCambiar = () => p.marcar();
  return p;
}

/**
 * Conecta de golpe todos los registros que deben sobrevivir a un reinicio.
 *
 * @param {{
 *   almacen: object,
 *   registros: { diario?: object, primerBotin?: object, gas?: object, torre?: object, botin?: object },
 *   estado?: object | null, logger?: object, retardoMs?: number,
 * }} opts
 * @returns {Promise<{ persistidores: Record<string, Persistidor>, restaurados: string[], vaciarTodo: () => Promise<void> }>}
 */
export async function conectarRegistros({ almacen, registros, estado = null, logger = console, retardoMs = RETARDO_GUARDADO_MS }) {
  const persistidores = {};
  const restaurados = [];
  for (const [nombre, registro] of Object.entries(registros)) {
    if (!registro) continue;
    const clave = CLAVES[nombre] ?? nombre;
    const p = await conectar({ almacen, registro, clave, estado, logger, retardoMs });
    persistidores[nombre] = p;
    if (p.cargado) restaurados.push(nombre);
  }
  return {
    persistidores,
    restaurados,
    vaciarTodo: () => Promise.all(Object.values(persistidores).map((p) => p.vaciar())).then(() => undefined),
  };
}
