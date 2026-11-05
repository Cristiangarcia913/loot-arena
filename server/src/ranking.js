// Ranking on-chain ("salón de la fama"): indexa en memoria los eventos de
// GameItem, Mercado y Recompensas desde el bloque de despliegue, con refresco
// incremental y `getLogs` por tramos. Sin estado en disco: tras un reinicio se
// reconstruye desde DEPLOY_BLOCK.
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
   *   maxTramosPorRefresco?: number, maxFallos?: number,
   *   now?: () => number, logger?: Pick<Console, 'log' | 'error' | 'warn'>
   * }} opts
   */
  constructor({
    provider, gameItem, mercado, recompensas, deployBlock,
    tramo = 10_000, tramoMin = 50, margen = 3, solape = 50,
    maxTramosPorRefresco = 100, maxFallos = 8,
    now = Date.now, logger = console,
  }) {
    this.provider = provider;
    this.dir = {
      gameItem: getAddress(gameItem),
      mercado: getAddress(mercado),
      recompensas: getAddress(recompensas),
    };
    this.deployBlock = deployBlock;
    this.tramo = tramo;
    this.tramoMin = tramoMin;
    this.margen = margen;
    this.solape = solape;
    this.maxTramosPorRefresco = maxTramosPorRefresco;
    this.maxFallos = maxFallos;
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
          throw new Error(`getLogs falló ${fallos} veces (bloques ${desde}-${fin}): ${msg}`);
        }
        this.tramo = Math.max(this.tramoMin, Math.floor((fin - desde + 1) / 2));
        continue;
      }
      if (!Array.isArray(logs)) logs = [];
      for (const log of logs) if (this._procesar(log, desde, fin)) nuevos++;
      this.siguiente = Math.max(this.siguiente, fin + 1);
      desde = fin + 1;
      tramos++;
      fallos = 0;
    }

    this.sincronizado = this.siguiente > hasta;
    this._podarVistos();
    this._ordenar();
    this.actualizado = this.now();
    this.ultimoError = null;
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
