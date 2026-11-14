// Capa de lectura de la cadena para la sección «Cadena» (PLAN-MAESTRO.md §7, fase E).
//
// Este módulo NO toca el DOM y NO importa ethers: recibe los contratos ya construidos
// (`crearContratos` lo hace con ethers) y de ellos solo usa `interface.getEvent(...).topicHash`,
// `interface.parseLog(...)` y `address`. Del proveedor solo usa `getLogs`, `getBlock`,
// `getBlockNumber` y `getBalance`. Así los tests pueden pasar dobles de objeto plano.
//
// Lo que resuelve:
//   · Lee **sin cartera**: con `JsonRpcProvider` sobre el RPC público de la red (requisito
//     de la fase E: un profesor sin MetaMask tiene que poder verlo todo).
//   · Respeta lo que el RPC público **de verdad** puede servir (ver abajo), en vez de pedirle
//     lo que no tiene y acumular tramos fallidos.
//   · Cachea los tramos ya cerrados y las fechas de los bloques (si no, es una llamada por
//     evento sólo para saber la hora).
//
// ─────────────── Lo que aguanta el RPC público de Sepolia (medido el 13-nov-2026)
//
// Contra `ethereum-sepolia-rpc.publicnode.com`, que es el que usa el proyecto:
//
//   · `eth_getLogs` acepta como mucho **50 000 bloques** de rango ("exceed maximum block
//     range: 50000" si te pasas). Ese no es el límite que duele.
//   · El que duele: el nodo **solo conserva los logs de las últimas ~10 000 bloques**
//     (≈ 33 horas). Cualquier rango que empiece más atrás responde «pruned history
//     unavailable», **da igual lo estrecho que sea el tramo**: con el final a 5 000 bloques
//     de la cabeza va siempre; a 10 000, nunca. Leer bloque a bloque sí funciona, pero eso
//     son 55 000 llamadas y no es una opción.
//   · Ese error es **determinista**, no un fallo pasajero: reintentarlo es tirar el tiempo
//     (30 intentos, 30 fallos). Lo comprobé antes de escribir esto precisamente porque la
//     solución "evidente" era reintentar, y habría sido tiempo perdido.
//
// Consecuencia de diseño: el historial **no se puede reconstruir entero desde el navegador**
// con un RPC público y sin clave de API. Aquí se hace lo honesto: se lee todo lo que el nodo
// conserva, se dice desde qué bloque se está mirando y se marca que más atrás no se puede.
// El historial completo lo tiene que indexar el servidor, que sí puede guardar estado.
//
// Por eso `barrer` averigua primero el horizonte real del nodo (unas pocas llamadas, cacheado
// para toda la sesión) y nunca pide nada por detrás de él.

import { direccionValida } from "../economy.js";

/**
 * Anchos de tramo a probar, de mayor a menor. Se usa el mayor que el nodo acepte: cuanto más
 * ancho, menos viajes de ida y vuelta. El tope duro del RPC es 50 000, pero pedir más de lo
 * que conserva no sirve de nada, así que la escalera empieza en lo que de verdad suele ir.
 */
export const TAMANOS_TRAMO = Object.freeze([10_000, 5_000, 2_000, 1_000, 500]);
/** Tamaño de tramo por defecto mientras no se haya medido el nodo. */
export const BLOQUES_POR_TRAMO = TAMANOS_TRAMO[0];
/** Tope de tramos por barrido: red de seguridad si el horizonte se midiera mal. */
export const MAX_TRAMOS = 24;
/**
 * Margen de bloques que se deja sin pedir por debajo de la cabeza. El RPC está balanceado
 * entre nodos que no van todos a la misma altura, y pedir justo la cabeza devuelve a veces
 * «block range extends beyond current head block».
 */
export const MARGEN_CABEZA = 2;
/** Reintentos para los errores que SÍ son pasajeros (red, límite de tasa, timeout). */
export const REINTENTOS = 2;
export const ESPERA_REINTENTO_MS = 400;
/** El número de bloque se cachea este tiempo (ms). */
export const TTL_BLOQUE_MS = 12_000;
/** Dirección de quemado de objetos que usa Mercado.sol. */
export const DEAD = "0x000000000000000000000000000000000000dEaD";
export const CERO = "0x0000000000000000000000000000000000000000";

/**
 * Nombres de los contratos que leemos, en el orden en que se muestran.
 * `mercadoP2P` todavía no está desplegado en Sepolia: si falta su dirección, su contrato
 * queda a null y todos los barridos sobre él devuelven vacío sin romper nada.
 */
export const CONTRATOS = Object.freeze(["gameItem", "oro", "cosmeticos", "mercado", "recompensas", "mercadoP2P"]);

/**
 * Una dirección como tópico de 32 bytes (lo que `getLogs` espera en `topics`).
 * Sin ethers: es un relleno de ceros por la izquierda, en minúsculas.
 * @param {string} dir
 * @returns {string}
 */
export function topicoDireccion(dir) {
  if (typeof dir !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(dir)) {
    throw new TypeError(`No es una dirección: ${dir}`);
  }
  return `0x${dir.slice(2).toLowerCase().padStart(64, "0")}`;
}

/** ¿Las dos direcciones son la misma? (tolera mayúsculas y nulos) */
export const mismaDir = (a, b) =>
  typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();

/**
 * Texto de un error venga como venga (Error, objeto JSON-RPC, string).
 *
 * Junta **todos** los niveles en vez de quedarse con el primero que exista, porque ethers
 * envuelve los errores del RPC y el de fuera no dice nada: en un `getLogs` sobre bloques
 * podados, `shortMessage` es «could not coalesce error» y el motivo de verdad («pruned
 * history unavailable») está en `error.message`. Quedarse con el primero hacía que el tramo
 * podado se contara como fallo pasajero y que el panel llegara a decir «historial completo».
 */
export function textoError(e) {
  if (!e) return "";
  if (typeof e === "string") return e;
  const partes = [
    e.shortMessage, e.message, e.reason, e.code,
    e.error?.message, e.info?.error?.message, e.data?.message, e.cause?.message,
  ];
  return partes.filter((x) => typeof x === "string" || typeof x === "number").join(" · ") || String(e);
}

/**
 * El nodo no guarda los logs de ese rango. Es un **límite duro**: reintentar no sirve, hay
 * que dejar de pedir hacia atrás. Medido: 30 de 30 intentos fallan igual.
 */
export function esErrorDePodado(e) {
  return /pruned|history unavailable|missing trie|not available on this node|state is not available/i.test(textoError(e));
}

/** El rango pedido es más ancho de lo que el nodo acepta: hay que trocear más fino. */
export function esErrorDeRango(e) {
  return /exceed maximum block range|query returned more than|range is too large|limit exceeded|too many results|response size/i.test(textoError(e));
}

/** Fallo pasajero (red, límite de tasa, timeout, cabeza desincronizada): merece reintento. */
export function esErrorTransitorio(e) {
  const t = textoError(e);
  if (esErrorDePodado(e) || esErrorDeRango(e)) return false;
  return /beyond current head|timeout|timed out|rate limit|too many requests|429|503|502|504|network|fetch failed|ECONN|socket/i.test(t);
}

/**
 * Parte [desde, hasta] en tramos cerrados de `tamano` bloques.
 * Devuelve `[]` si el rango está vacío, y como mucho `MAX_TRAMOS` tramos **desde el final**
 * (lo reciente importa más que lo antiguo si hay que recortar).
 * @returns {{desde:number, hasta:number, recortado:boolean}[]}
 */
export function tramos(desde, hasta, tamano = BLOQUES_POR_TRAMO, maxTramos = MAX_TRAMOS) {
  const d = Math.max(0, Math.floor(Number(desde)));
  const h = Math.floor(Number(hasta));
  if (!Number.isFinite(d) || !Number.isFinite(h) || h < d) return [];
  const total = Math.ceil((h - d + 1) / tamano);
  const recortado = total > maxTramos;
  // Si hay que recortar, nos quedamos con los tramos más recientes.
  const primerTramo = recortado ? total - maxTramos : 0;
  const lista = [];
  for (let i = primerTramo; i < total; i++) {
    const ini = d + i * tamano;
    lista.push({ desde: ini, hasta: Math.min(h, ini + tamano - 1), recortado: recortado && i === primerTramo });
  }
  return lista;
}

/**
 * Construye los contratos con ethers. Es la única parte que depende de ethers.
 * `direcciones` puede traer solo algunas claves: las que falten quedan a null.
 * @param {{ethers:any, provider:any, direcciones:Record<string,string>, abis:Record<string,any[]>}} o
 * @returns {Record<string, any|null>}
 */
export function crearContratos({ ethers, provider, direcciones, abis }) {
  const out = {};
  for (const nombre of CONTRATOS) {
    const dir = direcciones?.[nombre];
    const abi = abis?.[nombre];
    out[nombre] = direccionValida(dir) && Array.isArray(abi) && abi.length
      ? new ethers.Contract(dir, abi, provider)
      : null;
  }
  return out;
}

/**
 * Proveedor de solo lectura por el RPC público: lo que permite que la sección funcione
 * sin MetaMask. `net.rpcUrls[0]` sale de config.js.
 */
export function crearProveedorPublico(ethers, net) {
  const url = net?.rpcUrls?.[0];
  if (!url) throw new Error(`La red ${net?.chainName ?? "?"} no tiene RPC configurado.`);
  // staticNetwork: evita que ethers pregunte la red en cada llamada.
  return new ethers.JsonRpcProvider(url, net.chainId ? { chainId: net.chainId, name: net.chainName ?? "red" } : undefined, {
    staticNetwork: true,
  });
}

/**
 * @typedef {object} Suceso  un log ya decodificado, sin nada de ethers
 * @property {string} contrato   clave de CONTRATOS ("mercado", "oro"…)
 * @property {string} nombre     nombre del evento ("ItemVendido")
 * @property {Record<string, any>} args  argumentos por nombre (bigint donde toca)
 * @property {number} bloque
 * @property {number} indice     logIndex, para ordenar dentro del bloque
 * @property {string} hash       hash de la transacción
 */

/**
 * Crea el lector. Guarda cachés en memoria que viven lo que viva la sección.
 * @param {{provider:any, contratos:Record<string,any>, bloqueDespliegue?:number,
 *          tamanoTramo?:number, maxTramos?:number}} o
 */
export function crearLector({ provider, contratos, bloqueDespliegue = 0, tamanoTramo = BLOQUES_POR_TRAMO, maxTramos = MAX_TRAMOS }) {
  const cacheTramos = new Map(); // clave de tramo → Suceso[]
  const cacheFechas = new Map(); // nº de bloque → timestamp (s)
  let cacheAltura = { t: 0, n: null };
  let cacheHorizonte = null;     // hasta dónde atrás sirve logs este nodo (se mide una vez)

  async function bloqueActual() {
    if (cacheAltura.n !== null && Date.now() - cacheAltura.t < TTL_BLOQUE_MS) return cacheAltura.n;
    const n = Number(await provider.getBlockNumber());
    cacheAltura = { t: Date.now(), n };
    return n;
  }

  /** Timestamp (segundos) de un bloque, cacheado. null si el RPC no lo da. */
  async function fechaBloque(n) {
    const k = Number(n);
    if (cacheFechas.has(k)) return cacheFechas.get(k);
    let ts = null;
    try {
      const b = await provider.getBlock(k);
      ts = b?.timestamp != null ? Number(b.timestamp) : null;
    } catch { ts = null; }
    cacheFechas.set(k, ts);
    return ts;
  }

  /** Rellena la fecha de cada suceso (una llamada por bloque distinto, no por suceso). */
  async function conFechas(sucesos) {
    const bloques = [...new Set(sucesos.map((s) => s.bloque))];
    const fechas = new Map();
    for (const b of bloques) fechas.set(b, await fechaBloque(b));
    return sucesos.map((s) => ({ ...s, fecha: fechas.get(s.bloque) ?? null }));
  }

  function decodificar(clave, contrato, logs) {
    const out = [];
    for (const log of logs) {
      let p = null;
      try {
        p = contrato.interface.parseLog({ topics: [...(log.topics ?? [])], data: log.data ?? "0x" });
      } catch { p = null; }
      if (!p) continue; // evento que no está en nuestro ABI: se ignora en silencio
      const args = {};
      for (const [i, input] of (p.fragment?.inputs ?? []).entries()) {
        if (input?.name) args[input.name] = p.args?.[i];
      }
      out.push({
        contrato: clave,
        nombre: p.name,
        args,
        bloque: Number(log.blockNumber),
        indice: Number(log.logIndex ?? log.index ?? 0),
        hash: log.transactionHash ?? log.hash ?? "",
      });
    }
    return out;
  }

  /** `getLogs` con reintentos solo para lo que de verdad es pasajero. */
  async function pedirLogs(params) {
    let ultimo = null;
    for (let intento = 0; intento <= REINTENTOS; intento++) {
      try {
        return { logs: (await provider.getLogs(params)) ?? [] };
      } catch (e) {
        ultimo = e;
        // Podado o rango excesivo: insistir es tirar el tiempo, quien llama decide.
        if (!esErrorTransitorio(e)) return { error: e };
        if (intento < REINTENTOS) await dormir(ESPERA_REINTENTO_MS * (intento + 1));
      }
    }
    return { error: ultimo };
  }

  /**
   * Averigua desde qué bloque sirve logs este nodo. El RPC público de Sepolia solo conserva
   * una ventana reciente (~10 000 bloques); preguntar por detrás de ahí falla siempre, así
   * que conviene saberlo una vez y no volver a pedirlo.
   *
   * Prueba anchos de mayor a menor anclados en la cabeza y se queda con el primero que va.
   * Son 1-5 llamadas baratas (un filtro de dirección que casi no devuelve nada) y el
   * resultado vale para toda la sesión.
   * @returns {Promise<{desde:number, ancho:number, completo:boolean}>}
   */
  async function horizonte() {
    if (cacheHorizonte) return cacheHorizonte;
    const alto = (await bloqueActual()) - MARGEN_CABEZA;
    const sonda = Object.values(contratos ?? {}).find(Boolean);
    // Sin contratos no hay nada que medir: se asume que todo está disponible.
    if (!sonda) return (cacheHorizonte = { desde: bloqueDespliegue, ancho: tamanoTramo, completo: true });
    const dir = sonda.address ?? sonda.target;

    for (const ancho of TAMANOS_TRAMO) {
      const desde = Math.max(bloqueDespliegue, alto - ancho + 1);
      const r = await pedirLogs({ address: dir, fromBlock: desde, toBlock: alto });
      if (!r.error) {
        const completo = desde <= bloqueDespliegue;
        return (cacheHorizonte = { desde, ancho, completo });
      }
      if (!esErrorDePodado(r.error) && !esErrorDeRango(r.error)) break; // el nodo falla por otra cosa
    }
    // Ni el tramo más estrecho fue: se deja el más pequeño y que `barrer` informe de los fallos.
    const ancho = TAMANOS_TRAMO.at(-1);
    return (cacheHorizonte = { desde: Math.max(bloqueDespliegue, alto - ancho + 1), ancho, completo: false });
  }

  /**
   * Barre un evento de un contrato y devuelve los sucesos decodificados.
   *
   * Nunca pide por detrás del horizonte del nodo: lo que no se puede leer se informa en
   * `desdeDisponible` / `limitadoPorRpc`, en vez de generar decenas de tramos fallidos.
   *
   * @param {string} clave      clave de CONTRATOS
   * @param {string} evento     nombre del evento
   * @param {(string|string[]|null)[]} [filtros]  tópicos extra (direcciones ya pasadas por topicoDireccion)
   * @param {{desde?:number, hasta?:number, todo?:boolean}} [rango]
   *        `todo: true` ignora el horizonte y lo intenta igualmente (botón «cargar todo»).
   * @returns {Promise<{sucesos:Suceso[], recortado:boolean, fallos:number,
   *                    desdeDisponible:number, limitadoPorRpc:boolean, completo:boolean}>}
   */
  async function barrer(clave, evento, filtros = [], { desde, hasta, todo = false } = {}) {
    // Un barrido que no llega a hacerse (contrato sin desplegar, evento que no está en el
    // ABI) no ha leído nada, así que `desdeDisponible` es null: si dijera el bloque de
    // despliegue, `barrerVarios` creería que se leyó desde el principio y el aviso de
    // «falta historial» saldría contradiciéndose.
    const vacio = (extra = {}) => ({
      sucesos: [], recortado: false, fallos: 0,
      desdeDisponible: null, limitadoPorRpc: false, completo: true, ...extra,
    });
    const contrato = contratos?.[clave];
    if (!contrato) return vacio();
    let topic0;
    try {
      topic0 = contrato.interface.getEvent(evento)?.topicHash;
    } catch { topic0 = null; }
    if (!topic0) return vacio(); // el ABI no tiene ese evento

    const h = await horizonte();
    const fin = hasta ?? ((await bloqueActual()) - MARGEN_CABEZA);
    const pedido = desde ?? bloqueDespliegue;
    // El horizonte manda, salvo que se pida expresamente intentarlo todo.
    const ini = todo ? pedido : Math.max(pedido, h.desde);
    const limitadoPorRpc = !todo && ini > pedido;

    const topics = [topic0, ...filtros];
    // El ancho medido manda, pero `tamanoTramo` sigue siendo un tope: quien crea el lector
    // puede pedir tramos más estrechos (los tests lo usan para forzar el troceado).
    const partes = tramos(ini, fin, todo ? tamanoTramo : Math.min(tamanoTramo, h.ancho), maxTramos);
    const sucesos = [];
    let recortado = partes.some((t) => t.recortado);
    let fallos = 0;
    let podado = false;
    let minLeido = null;

    // Del tramo más reciente al más antiguo: así, al toparse con la zona que el nodo no
    // conserva, ya se tiene todo lo reciente. Al revés se perdería el barrido entero por
    // culpa del primer tramo (que es justo el más viejo y el más probable que falle).
    for (const t of [...partes].reverse()) {
      const clave2 = `${contrato.address ?? contrato.target}|${topics.join(",")}|${t.desde}-${t.hasta}`;
      if (cacheTramos.has(clave2)) {
        sucesos.push(...cacheTramos.get(clave2));
        minLeido = minLeido == null ? t.desde : Math.min(minLeido, t.desde);
        continue;
      }
      const r = await pedirLogs({
        address: contrato.address ?? contrato.target,
        topics, fromBlock: t.desde, toBlock: t.hasta,
      });
      if (r.error) {
        if (esErrorDePodado(r.error)) {
          // Hemos llegado a donde el nodo ya no guarda logs. Como vamos de lo nuevo a lo
          // viejo, lo de aquí hacia atrás tampoco estará: se para y se informa.
          podado = true;
          break;
        }
        fallos++;
        continue; // un tramo caído no debe tirar el historial entero
      }
      const decod = decodificar(clave, contrato, r.logs);
      // Solo se cachea un tramo ya cerrado (su último bloque no puede cambiar).
      if (t.hasta < fin) cacheTramos.set(clave2, decod);
      sucesos.push(...decod);
      minLeido = minLeido == null ? t.desde : Math.min(minLeido, t.desde);
    }
    return {
      // Siempre ordenados de más reciente a más antiguo, pase lo que pase con los tramos.
      sucesos: ordenar(sucesos),
      recortado, fallos,
      // El bloque más antiguo que de verdad se ha leído, no el que se pidió.
      desdeDisponible: minLeido ?? ini,
      limitadoPorRpc: limitadoPorRpc || podado,
      completo: !limitadoPorRpc && !podado && (minLeido ?? ini) <= pedido,
    };
  }

  /**
   * Varios barridos; devuelve todos los sucesos juntos y ordenados.
   * Se lanzan en grupos para no abrir 18 conexiones de golpe contra el RPC público.
   */
  async function barrerVarios(peticiones, rango, { concurrencia = 6 } = {}) {
    const res = [];
    for (let i = 0; i < peticiones.length; i += concurrencia) {
      const grupo = peticiones.slice(i, i + concurrencia);
      res.push(...await Promise.all(grupo.map((p) => barrer(p.contrato, p.evento, p.filtros ?? [], rango))));
    }
    // Solo cuentan los barridos que de verdad leyeron algo del RPC: los que se saltaron
    // (contrato sin desplegar) no dicen nada sobre hasta dónde se ha podido mirar.
    const leidos = res.filter((r) => r.desdeDisponible != null);
    return {
      sucesos: ordenar(res.flatMap((r) => r.sucesos)),
      recortado: res.some((r) => r.recortado),
      fallos: res.reduce((a, r) => a + r.fallos, 0),
      limitadoPorRpc: res.some((r) => r.limitadoPorRpc),
      completo: leidos.length > 0 && leidos.every((r) => r.completo),
      desdeDisponible: leidos.length ? Math.min(...leidos.map((r) => r.desdeDisponible)) : null,
    };
  }

  const saldoEth = async (dir) => {
    try { return BigInt(await provider.getBalance(dir)); } catch { return null; }
  };

  return {
    contratos,
    provider,
    bloqueDespliegue,
    bloqueActual,
    fechaBloque,
    conFechas,
    horizonte,
    barrer,
    barrerVarios,
    saldoEth,
    /** Vacía las cachés (al cambiar de red o de cuenta). */
    olvidar() {
      cacheTramos.clear(); cacheFechas.clear();
      cacheAltura = { t: 0, n: null };
      cacheHorizonte = null;
    },
  };
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** Ordena sucesos de más reciente a más antiguo (bloque, y dentro del bloque por logIndex). */
export function ordenar(sucesos) {
  return [...sucesos].sort((a, b) => (b.bloque - a.bloque) || (b.indice - a.indice));
}

/** Quita sucesos repetidos (el mismo log puede venir de dos barridos solapados). */
export function sinRepetidos(sucesos) {
  const vistos = new Set();
  const out = [];
  for (const s of sucesos) {
    const k = `${s.hash}|${s.indice}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    out.push(s);
  }
  return out;
}
