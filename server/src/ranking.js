// Ranking on-chain ("salón de la fama"): indexa los eventos de GameItem, Mercado y
// Recompensas desde el bloque de despliegue, con refresco incremental y `getLogs`
// por tramos.
//
// 1.4: el índice se persiste con la capa `almacen.js`. Antes, cada reinicio de Render
// obligaba a reindexar desde DEPLOY_BLOCK (~25 s de 503 en GET /ranking); ahora se
// restaura el índice guardado y solo se leen los bloques nuevos.
//
// Tolerancia a RPC públicos (que a veces van desfasados o limitan rangos):
//  - solo se indexa hasta `cabeza - margen` (bloques recientes pueden faltar o reorganizarse);
//  - si el nodo dice que la cabeza está por detrás de lo ya indexado, no se toca nada;
//  - cada refresco vuelve a leer los últimos `solape` bloques: los logs que un nodo
//    desfasado no devolvió la vez anterior aparecen ahora, y los repetidos se descartan
//    por (txHash, índice);
//  - si `getLogs` falla (rango demasiado grande, límite de resultados, timeout), el tramo
//    se parte por la mitad y se reintenta; el progreso ya hecho no se pierde;
//  - se ignoran logs `removed`, de otras direcciones o que no se pueden decodificar.
import { Interface, getAddress, formatUnits } from 'ethers';
import { ABI_GAMEITEM_EVENTOS, ABI_MERCADO_EVENTOS, ABI_RECOMPENSAS, DECIMALES_ORO } from './abis.js';

export const CATEGORIAS = Object.freeze(['objetos', 'legendarios', 'oroVentas', 'rachaDiaria']);
export const TOP = 20;

/**
 * Versión del formato de la instantánea. Al subirla, las guardadas se descartan
 * (el servidor reindexa desde DEPLOY_BLOCK, como antes de la 1.4).
 */
export const VERSION_INSTANTANEA = 1;
/**
 * Si la instantánea pasa de este tamaño no se guarda: el plan gratuito de Upstash
 * limita la petición a 10 MB. Con 4 MB caben decenas de miles de jugadores.
 */
export const MAX_BYTES_INSTANTANEA = 4 * 1024 * 1024;
/** Máximo de jugadores que se aceptan al restaurar (cota de memoria). */
export const MAX_JUGADORES_INSTANTANEA = 50_000;
/**
 * Cada cuántos bloques se vuelve a guardar aunque no haya habido eventos nuevos.
 * Guardar en cada refresco sería un comando por minuto para nada; con 500 bloques
 * (~100 min en Sepolia) un reinicio solo tiene que releer un tramo, que es una
 * sola llamada a `getLogs`.
 */
export const BLOQUES_POR_GUARDADO = 500;

const ifaceGameItem = new Interface(ABI_GAMEITEM_EVENTOS);
const ifaceMercado = new Interface(ABI_MERCADO_EVENTOS);
const ifaceRecompensas = new Interface(ABI_RECOMPENSAS);

export const TOPICS = Object.freeze({
  ItemMinted: ifaceGameItem.getEvent('ItemMinted').topicHash,
  ItemVendido: ifaceMercado.getEvent('ItemVendido').topicHash,
  DiarioReclamado: ifaceRecompensas.getEvent('DiarioReclamado').topicHash,
  Recompensado: ifaceRecompensas.getEvent('Recompensado').topicHash,
});

const nuevoJugador = () => ({ objetos: 0, legendarios: 0, oroVentas: 0n, rachaDiaria: 0 });

export class IndexadorRanking {
  /**
   * @param {{
   *   provider: { getBlockNumber(): Promise<number>, getLogs(filtro: object): Promise<any[]> },
   *   gameItem: string, mercado: string, recompensas: string, deployBlock: number,
   *   tramo?: number, tramoMin?: number, margen?: number, solape?: number,
   *   maxTramosPorRefresco?: number, maxFallos?: number, pausaMs?: number,
   *   now?: () => number, logger?: Pick<Console, 'log' | 'error' | 'warn'>,
   *   alCambiar?: (() => void) | null, bloquesPorGuardado?: number,
   *   maxBytes?: number, maxJugadores?: number
   * }} opts
   */
  constructor({
    provider, gameItem, mercado, recompensas, deployBlock,
    tramo = 50_000, tramoMin = 50, margen = 3, solape = 50,
    maxTramosPorRefresco = 100, maxFallos = 8, pausaMs = 1_000,
    now = Date.now, logger = console,
    alCambiar = null, bloquesPorGuardado = BLOQUES_POR_GUARDADO,
    maxBytes = MAX_BYTES_INSTANTANEA, maxJugadores = MAX_JUGADORES_INSTANTANEA,
  }) {
    this.provider = provider;
    this.dir = {
      gameItem: getAddress(gameItem),
      mercado: getAddress(mercado),
      recompensas: getAddress(recompensas),
    };
    this.deployBlock = deployBlock;
    this.tramo = tramo;               // tamaño actual del tramo (baja tras un fallo, vuelve a subir)
    this.tramoMax = tramo;            // tope: 50 000 bloques es el máximo que admite el RPC público de Sepolia
    this.tramoMin = tramoMin;
    this.margen = margen;
    this.solape = solape;
    this.maxTramosPorRefresco = maxTramosPorRefresco;
    this.maxFallos = maxFallos;
    this.pausaMs = pausaMs;           // espera antes de reintentar un getLogs fallido (×nº de fallos)
    this.now = now;
    this.logger = logger;

    this.siguiente = deployBlock;        // primer bloque aún no indexado
    this.jugadores = new Map();          // address → { objetos, legendarios, oroVentas, rachaDiaria }
    this.recompensados = new Map();      // address → Set(motivo on-chain)
    this.vistos = new Map();             // "txHash:índice" → bloque (para descartar repetidos)
    this.actualizado = null;             // ms del último refresco correcto
    this.sincronizado = false;           // true si se llegó a la cabeza (menos el margen)
    this.descartados = 0;                // logs que no se pudieron decodificar
    this.ultimoError = null;
    this.ordenados = Object.fromEntries(CATEGORIAS.map((c) => [c, []]));
    this._enCurso = null;
    this._timer = null;

    // ── 1.4: persistencia ──
    /** Lo pone `persistencia.conectar`; se llama cuando merece la pena guardar. */
    this.alCambiar = alCambiar;
    this.bloquesPorGuardado = bloquesPorGuardado;
    this.maxBytes = maxBytes;
    this.maxJugadores = maxJugadores;
    this.ultimoGuardado = deployBlock;   // `siguiente` de la última vez que se marcó
    this.restaurado = false;             // true si el índice viene de una instantánea
  }

  /**
   * Estado completo del índice, serializable a JSON.
   *
   * Se guarda también `vistos` (los ids de log ya contados): sin él, el solape de
   * `solape` bloques del primer refresco tras un reinicio **contaría dos veces** los
   * mismos eventos. Y se guardan `deployBlock` y las tres direcciones para no aplicar
   * una instantánea de otro despliegue.
   *
   * Siempre es coherente: `siguiente` solo avanza después de procesar los logs de su
   * tramo, así que da igual en qué momento se tome.
   */
  instantanea() {
    const datos = {
      v: VERSION_INSTANTANEA,
      deployBlock: this.deployBlock,
      dir: { ...this.dir },
      siguiente: this.siguiente,
      actualizado: this.actualizado,
      descartados: this.descartados,
      jugadores: [...this.jugadores].map(([a, j]) => [a, j.objetos, j.legendarios, j.oroVentas.toString(), j.rachaDiaria]),
      recompensados: [...this.recompensados].map(([a, motivos]) => [a, [...motivos]]),
      vistos: [...this.vistos],
    };
    const bytes = Buffer.byteLength(JSON.stringify(datos), 'utf8');
    if (bytes > this.maxBytes) {
      throw new Error(`la instantánea del ranking ocupa ${bytes} bytes (máximo ${this.maxBytes})`);
    }
    return datos;
  }

  /**
   * Vuelca una instantánea. Lanza si no es aplicable (otra versión, otro despliegue):
   * `persistencia.js` lo registra y arranca reindexando desde `deployBlock`, que es
   * el comportamiento anterior a la 1.4. Las filas sueltas con forma rara se ignoran.
   */
  restaurar(datos) {
    if (!datos || typeof datos !== 'object') throw new Error('instantánea vacía');
    if (datos.v !== VERSION_INSTANTANEA) {
      throw new Error(`instantánea de otra versión (${datos.v}, se esperaba ${VERSION_INSTANTANEA})`);
    }
    if (datos.deployBlock !== this.deployBlock) {
      throw new Error(`instantánea de otro DEPLOY_BLOCK (${datos.deployBlock}, ahora ${this.deployBlock})`);
    }
    for (const nombre of ['gameItem', 'mercado', 'recompensas']) {
      if (datos.dir?.[nombre] !== this.dir[nombre]) {
        throw new Error(`instantánea de otro contrato ${nombre} (${datos.dir?.[nombre]}, ahora ${this.dir[nombre]})`);
      }
    }
    if (!Number.isInteger(datos.siguiente) || datos.siguiente < this.deployBlock) {
      throw new Error(`instantánea con un bloque inválido (${datos.siguiente})`);
    }

    this.jugadores.clear();
    for (const fila of Array.isArray(datos.jugadores) ? datos.jugadores : []) {
      if (!Array.isArray(fila) || fila.length < 5) continue;
      const [address, objetos, legendarios, oroVentas, rachaDiaria] = fila;
      if (typeof address !== 'string') continue;
      if (![objetos, legendarios, rachaDiaria].every((n) => Number.isInteger(n) && n >= 0)) continue;
      let oro;
      try { oro = BigInt(oroVentas); } catch { continue; }
      if (oro < 0n) continue;
      if (this.jugadores.size >= this.maxJugadores) break;
      try {
        this.jugadores.set(getAddress(address), { objetos, legendarios, oroVentas: oro, rachaDiaria });
      } catch { /* dirección inválida: se ignora la fila */ }
    }

    this.recompensados.clear();
    for (const fila of Array.isArray(datos.recompensados) ? datos.recompensados : []) {
      if (!Array.isArray(fila) || fila.length < 2 || typeof fila[0] !== 'string' || !Array.isArray(fila[1])) continue;
      try {
        this.recompensados.set(getAddress(fila[0]), new Set(fila[1].filter((m) => typeof m === 'string')));
      } catch { /* dirección inválida: se ignora la fila */ }
    }

    this.vistos.clear();
    for (const fila of Array.isArray(datos.vistos) ? datos.vistos : []) {
      if (!Array.isArray(fila) || fila.length < 2) continue;
      const [clave, bloque] = fila;
      if (typeof clave !== 'string' || !Number.isInteger(bloque)) continue;
      this.vistos.set(clave, bloque);
    }

    this.siguiente = datos.siguiente;
    this.ultimoGuardado = datos.siguiente;
    this.descartados = Number.isInteger(datos.descartados) ? datos.descartados : 0;
    // `actualizado` es la verdad: cuándo se refrescó por última vez. Al restaurarlo,
    // `listo()` ya es true y GET /ranking sirve el índice guardado en vez de dar 503.
    this.actualizado = typeof datos.actualizado === 'number' ? datos.actualizado : null;
    // En cambio no se sabe si seguimos a la altura de la cabeza: lo dirá el primer refresco.
    this.sincronizado = false;
    this.restaurado = true;
    this._ordenar();
  }

  /** Avisa al persistidor si hay algo que merezca la pena guardar. */
  _marcar(nuevos) {
    if (nuevos > 0 || this.siguiente - this.ultimoGuardado >= this.bloquesPorGuardado) {
      this.ultimoGuardado = this.siguiente;
      this.alCambiar?.();
    }
  }

  /** Refresca (si ya hay un refresco en marcha, devuelve ese mismo). */
  refrescar() {
    this._enCurso ??= this._refrescar().finally(() => { this._enCurso = null; });
    return this._enCurso;
  }

  /** Refresca ya y luego cada `intervaloMs`. Los errores se registran, no se lanzan. */
  iniciar(intervaloMs = 60_000) {
    const tick = () => this.refrescar().catch((e) => {
      this.ultimoError = e?.shortMessage ?? e?.message ?? String(e);
      this.logger.error('[ranking] error al refrescar:', this.ultimoError);
    });
    tick();
    this._timer = setInterval(tick, intervaloMs);
    this._timer.unref?.();
    return this;
  }

  detener() {
    clearInterval(this._timer);
    this._timer = null;
  }

  async _refrescar() {
    const cabeza = Number(await this.provider.getBlockNumber());
    const hasta = cabeza - this.margen;
    if (!Number.isFinite(hasta)) throw new Error(`getBlockNumber devolvió un valor inválido (${cabeza})`);
    if (hasta < this.siguiente - 1) {
      // Nodo desfasado: dice que la cabeza está por detrás de lo que ya indexamos. No tocamos nada.
      this.logger.warn?.(`[ranking] cabeza ${cabeza} por detrás de lo indexado (${this.siguiente - 1}); se ignora`);
      return { nuevos: 0, hasta: this.siguiente - 1, desfasado: true };
    }

    let desde = Math.max(this.deployBlock, this.siguiente - this.solape);
    let tramos = 0;
    let fallos = 0;
    let nuevos = 0;
    while (desde <= hasta && tramos < this.maxTramosPorRefresco) {
      const fin = Math.min(hasta, desde + this.tramo - 1);
      let logs;
      try {
        logs = await this.provider.getLogs({
          address: [this.dir.gameItem, this.dir.mercado, this.dir.recompensas],
          topics: [[TOPICS.ItemMinted, TOPICS.ItemVendido, TOPICS.DiarioReclamado, TOPICS.Recompensado]],
          fromBlock: desde,
          toBlock: fin,
        });
      } catch (err) {
        fallos++;
        const msg = err?.shortMessage ?? err?.message ?? String(err);
        if (fallos >= this.maxFallos) {
          this.ultimoError = msg;
          this._ordenar();
          // El progreso de los tramos ya completados no se tira: se guarda igual.
          this._marcar(nuevos);
          throw new Error(`getLogs falló ${fallos} veces (bloques ${desde}-${fin}): ${msg}`);
        }
        this.tramo = Math.max(this.tramoMin, Math.floor((fin - desde + 1) / 2));
        if (this.pausaMs > 0) await new Promise((ok) => setTimeout(ok, this.pausaMs * fallos));
        continue;
      }
      if (!Array.isArray(logs)) logs = [];
      for (const log of logs) if (this._procesar(log, desde, fin)) nuevos++;
      this.siguiente = Math.max(this.siguiente, fin + 1);
      desde = fin + 1;
      tramos++;
      fallos = 0;
      this.tramo = Math.min(this.tramoMax, this.tramo * 2); // tras un fallo, vuelve a crecer hacia el tope
    }

    this.sincronizado = this.siguiente > hasta;
    this._podarVistos();
    this._ordenar();
    this.actualizado = this.now();
    this.ultimoError = null;
    this._marcar(nuevos);
    return { nuevos, hasta: this.siguiente - 1, desfasado: false };
  }

  /** Aplica un log. Devuelve true si era nuevo y válido. */
  _procesar(log, desde, fin) {
    if (!log || log.removed) return false;
    const bloque = Number(log.blockNumber);
    if (!Number.isFinite(bloque) || bloque < desde || bloque > fin) return false;
    const indice = log.index ?? log.logIndex;
    const clave = `${String(log.transactionHash).toLowerCase()}:${Number(indice)}`;
    if (this.vistos.has(clave)) return false;

    let direccion;
    try { direccion = getAddress(log.address); } catch { return false; }
    const topics = [...(log.topics ?? [])];
    const t0 = topics[0];
    const datos = { topics, data: log.data };

    try {
      if (direccion === this.dir.gameItem && t0 === TOPICS.ItemMinted) {
        const { args } = ifaceGameItem.parseLog(datos);
        const j = this._jugador(args.to);
        j.objetos++;
        if (Number(args.rareza) === 2) j.legendarios++;
      } else if (direccion === this.dir.mercado && t0 === TOPICS.ItemVendido) {
        const { args } = ifaceMercado.parseLog(datos);
        this._jugador(args.jugador).oroVentas += BigInt(args.oro);
      } else if (direccion === this.dir.recompensas && t0 === TOPICS.DiarioReclamado) {
        const { args } = ifaceRecompensas.parseLog(datos);
        const j = this._jugador(args.jugador);
        j.rachaDiaria = Math.max(j.rachaDiaria, Number(args.racha));
      } else if (direccion === this.dir.recompensas && t0 === TOPICS.Recompensado) {
        const { args } = ifaceRecompensas.parseLog(datos);
        const a = getAddress(args.jugador);
        if (!this.recompensados.has(a)) this.recompensados.set(a, new Set());
        this.recompensados.get(a).add(String(args.motivo));
      } else {
        return false;
      }
    } catch {
      this.descartados++;
      return false;
    }
    this.vistos.set(clave, bloque);
    return true;
  }

  _jugador(addr) {
    const a = getAddress(addr);
    let j = this.jugadores.get(a);
    if (!j) { j = nuevoJugador(); this.jugadores.set(a, j); }
    return j;
  }

  /** Olvida los ids de logs que ya nunca se volverán a leer (fuera de la ventana de solape). */
  _podarVistos() {
    const limite = this.siguiente - this.solape;
    for (const [clave, bloque] of this.vistos) if (bloque < limite) this.vistos.delete(clave);
  }

  _valor(j, categoria) {
    return categoria === 'oroVentas' ? Number(formatUnits(j.oroVentas, DECIMALES_ORO)) : j[categoria];
  }

  _ordenar() {
    for (const c of CATEGORIAS) {
      const lista = [];
      for (const [address, j] of this.jugadores) {
        const crudo = c === 'oroVentas' ? j.oroVentas : j[c];
        if (crudo > 0) lista.push({ address, valor: this._valor(j, c), crudo });
      }
      lista.sort((a, b) => (b.crudo > a.crudo ? 1 : b.crudo < a.crudo ? -1 : a.address.localeCompare(b.address)));
      this.ordenados[c] = lista;
    }
  }

  /** ¿Ya se pagó on-chain esta recompensa (motivo on-chain, p. ej. "pase10@T1")? */
  yaRecompensado(address, motivoOnchain) {
    return this.recompensados.get(getAddress(address))?.has(motivoOnchain) ?? false;
  }

  /** ¿Hay índice servible? (false mientras no ha terminado ningún refresco correcto). */
  listo() {
    return this.actualizado !== null;
  }

  /** Cuerpo de la respuesta 503 mientras se genera el primer índice. */
  estadoSincronizando() {
    return { estado: 'sincronizando', bloqueActual: this.siguiente - 1 };
  }

  /** Top `TOP` por categoría. */
  ranking(top = TOP) {
    return {
      actualizado: this.actualizado === null ? null : new Date(this.actualizado).toISOString(),
      bloque: this.siguiente - 1,
      sincronizado: this.sincronizado,
      categorias: Object.fromEntries(CATEGORIAS.map((c) => [
        c, this.ordenados[c].slice(0, top).map(({ address, valor }) => ({ address, valor })),
      ])),
    };
  }

  /** Posición (1 = primero; null si no puntúa) y valor de `address` en cada categoría. */
  posicion(address) {
    const a = getAddress(address);
    const j = this.jugadores.get(a) ?? nuevoJugador();
    return {
      address: a,
      actualizado: this.actualizado === null ? null : new Date(this.actualizado).toISOString(),
      bloque: this.siguiente - 1,
      sincronizado: this.sincronizado,
      posiciones: Object.fromEntries(CATEGORIAS.map((c) => {
        const i = this.ordenados[c].findIndex((x) => x.address === a);
        return [c, { posicion: i === -1 ? null : i + 1, valor: this._valor(j, c), participantes: this.ordenados[c].length }];
      })),
    };
  }
}

/**
 * Middleware que responde 503 `{"estado":"sincronizando","bloqueActual":N}` con `Retry-After: 5`
 * a GET /ranking y GET /ranking/:address mientras el indexador no tiene ningún índice todavía.
 * Con índice (aunque esté desactualizado) deja pasar la petición. `obtener()` devuelve el
 * indexador actual o null si el ranking no está configurado (entonces también pasa).
 */
export function guardaSincronizando(obtener) {
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path !== '/ranking' && !req.path.startsWith('/ranking/')) return next();
    const ranking = obtener();
    if (!ranking || ranking.listo()) return next();
    res.set('Retry-After', '5').status(503).json(ranking.estadoSincronizando());
  };
}
