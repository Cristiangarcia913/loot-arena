// Capa de almacenamiento intercambiable (1.4).
//
// PROBLEMA QUE RESUELVE: el plan gratuito de Render no permite discos persistentes y
// duerme el servicio, así que todo lo que vivía en `Map`/`Set` (racha diaria, primer
// botín, grifo de gas, récords de la torre, pity del botín) se perdía en cada reinicio.
//
// INTERFAZ MÍNIMA (las tres operaciones que pide el encargo):
//   await almacen.leer(clave)            → valor (JSON) o null si no existe
//   await almacen.escribir(clave, valor) → void
//   await almacen.borrar(clave)          → void
//
// IMPLEMENTACIONES:
//   - `AlmacenMemoria`: la de siempre. Sirve para tests y para desarrollo local.
//   - `AlmacenUpstash`: Upstash Redis por su API REST (HTTPS). Se eligió porque su plan
//     gratuito es permanente, no pide tarjeta y se habla por `fetch`, así que NO añade
//     ninguna dependencia nueva al `package.json`. Ver README §Persistencia.
//
// DEGRADACIÓN: si el almacén externo no responde al arrancar, el servidor NO se cae:
// sigue con `AlmacenMemoria` y lo cuenta en `GET /health` (`almacen.degradado: true`).
//
// Nadie en este archivo guarda secretos en los logs: el token solo viaja en la cabecera.

/** Prefijo por defecto de las claves (permite compartir una base gratuita entre entornos). */
export const PREFIJO_POR_DEFECTO = 'loot-arena:';
/** Timeout de cada petición al almacén externo (ms). */
export const TIMEOUT_MS = 5000;

/** Tipos admitidos en la variable `ALMACEN`. */
export const TIPOS = Object.freeze(['memoria', 'upstash']);

const texto = (v) => (typeof v === 'string' ? v.trim() : '');
const mensaje = (err) => err?.shortMessage ?? err?.message ?? String(err);

// ─── Memoria ──────────────────────────────────────────────────────────────────

/**
 * Almacén en memoria del propio proceso. Es el comportamiento anterior a la 1.4:
 * funciona perfectamente mientras el proceso vive y se pierde al reiniciar.
 */
export class AlmacenMemoria {
  constructor({ datos = new Map() } = {}) {
    this.tipo = 'memoria';
    this.datos = datos;
  }

  async leer(clave) {
    if (!this.datos.has(clave)) return null;
    // Se clona para que quien lea no pueda modificar lo guardado por accidente
    // (el almacén externo tampoco devolvería la misma referencia).
    return JSON.parse(this.datos.get(clave));
  }

  async escribir(clave, valor) {
    this.datos.set(clave, JSON.stringify(valor));
  }

  async borrar(clave) {
    this.datos.delete(clave);
  }
}

// ─── Upstash Redis (API REST) ─────────────────────────────────────────────────

/**
 * Almacén sobre Upstash Redis usando su API REST.
 *
 * Forma de las peticiones (documentación oficial de Upstash):
 *   GET  <url>/get/<clave>            → { "result": "<string>" | null }
 *   POST <url>/set/<clave>  body=val  → { "result": "OK" }
 *   POST <url>/del/<clave>            → { "result": 0 | 1 }
 *   GET  <url>/ping                   → { "result": "PONG" }
 * Autenticación: cabecera `Authorization: Bearer <token>`.
 * Los errores llegan como 4xx con cuerpo `{ "error": "..." }`.
 */
export class AlmacenUpstash {
  /**
   * @param {{
   *   url: string, token: string, prefijo?: string,
   *   fetchImpl?: typeof fetch, timeoutMs?: number,
   * }} opts
   */
  constructor({ url, token, prefijo = PREFIJO_POR_DEFECTO, fetchImpl = globalThis.fetch, timeoutMs = TIMEOUT_MS }) {
    if (!texto(url)) throw new Error('AlmacenUpstash necesita una url');
    if (!texto(token)) throw new Error('AlmacenUpstash necesita un token');
    if (typeof fetchImpl !== 'function') throw new Error('AlmacenUpstash necesita fetch (Node 18+)');
    this.tipo = 'upstash';
    this.url = texto(url).replace(/\/+$/, '');
    this.token = texto(token);
    this.prefijo = prefijo;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.peticiones = 0; // para vigilar el consumo del plan gratuito
  }

  /** Clave completa tal y como se guarda en Redis. */
  claveReal(clave) {
    return `${this.prefijo}${clave}`;
  }

  /** Lanza una petición al API REST y devuelve el campo `result`. */
  async #pedir(ruta, { metodo = 'GET', cuerpo } = {}) {
    this.peticiones += 1;
    const opciones = {
      method: metodo,
      headers: { authorization: `Bearer ${this.token}` },
      signal: AbortSignal.timeout(this.timeoutMs),
    };
    if (cuerpo !== undefined) {
      opciones.body = cuerpo;
      opciones.headers['content-type'] = 'text/plain; charset=utf-8';
    }

    let resp;
    try {
      resp = await this.fetchImpl(`${this.url}${ruta}`, opciones);
    } catch (err) {
      const causa = err?.name === 'TimeoutError' || err?.name === 'AbortError'
        ? `no respondió en ${this.timeoutMs} ms`
        : mensaje(err);
      throw new Error(`Upstash no está accesible (${causa})`);
    }

    let json = null;
    try { json = await resp.json(); } catch { json = null; }

    if (!resp.ok) {
      const detalle = json?.error ?? `HTTP ${resp.status}`;
      // 401 es el fallo típico: token mal copiado. Se nombra para que se arregle rápido.
      if (resp.status === 401) throw new Error(`Upstash rechazó el token (${detalle})`);
      throw new Error(`Upstash devolvió un error (${detalle})`);
    }
    if (json?.error) throw new Error(`Upstash devolvió un error (${json.error})`);
    return json?.result ?? null;
  }

  async leer(clave) {
    const crudo = await this.#pedir(`/get/${encodeURIComponent(this.claveReal(clave))}`);
    if (crudo === null || crudo === undefined) return null;
    if (typeof crudo !== 'string') return crudo;
    try {
      return JSON.parse(crudo);
    } catch {
      // Un valor que no es JSON no debe tumbar el arranque: se trata como "no hay nada".
      throw new Error(`El valor guardado en "${clave}" no es JSON válido`);
    }
  }

  async escribir(clave, valor) {
    await this.#pedir(`/set/${encodeURIComponent(this.claveReal(clave))}`, {
      metodo: 'POST',
      cuerpo: JSON.stringify(valor),
    });
  }

  async borrar(clave) {
    await this.#pedir(`/del/${encodeURIComponent(this.claveReal(clave))}`, { metodo: 'POST' });
  }

  /** Comprobación de arranque: ¿contesta y acepta el token? */
  async comprobar() {
    const r = await this.#pedir('/ping');
    if (r !== 'PONG') throw new Error(`Upstash respondió algo inesperado a PING (${JSON.stringify(r)})`);
  }
}

// ─── Estado del almacén (lo que enseña /health) ───────────────────────────────

/**
 * Qué almacén se está usando de verdad y si hubo que degradar. `/health` lo publica
 * para que se vea desde fuera, sin entrar en los logs de Render.
 */
export class EstadoAlmacen {
  /**
   * @param {{ tipo: string, deseado?: string, aviso?: string | null }} opts
   */
  constructor({ tipo, deseado = tipo, aviso = null }) {
    this.tipo = tipo;
    this.deseado = deseado;
    this.aviso = aviso;
    this.degradado = tipo !== deseado;
    this.ultimoError = null;
    this.escriturasOk = 0;
    this.escriturasFallidas = 0;
  }

  anotarOk() {
    this.escriturasOk += 1;
    this.ultimoError = null;
  }

  anotarError(err) {
    this.escriturasFallidas += 1;
    this.ultimoError = mensaje(err);
  }

  /** Resumen para el JSON de `/health`. */
  resumen() {
    const r = { tipo: this.tipo, persistente: this.tipo !== 'memoria', degradado: this.degradado };
    if (this.aviso) r.aviso = this.aviso;
    if (this.escriturasFallidas) r.escriturasFallidas = this.escriturasFallidas;
    if (this.ultimoError) r.ultimoError = this.ultimoError;
    return r;
  }
}

// ─── Fábrica: elige implementación según el entorno ───────────────────────────

/**
 * Crea el almacén que pide el entorno, con vuelta a memoria si el externo falla.
 *
 * Variables:
 *   ALMACEN                   "memoria" | "upstash". Si falta, se deduce: hay URL+token → upstash.
 *   UPSTASH_REDIS_REST_URL    URL REST de la base de Upstash (https://...upstash.io)
 *   UPSTASH_REDIS_REST_TOKEN  token REST (el "Standard", no el de solo lectura)
 *   ALMACEN_PREFIJO           prefijo de las claves (por defecto "loot-arena:")
 *
 * @param {Record<string, string | undefined>} env
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number, comprobar?: boolean }} [opts]
 * @returns {Promise<{ almacen: AlmacenMemoria | AlmacenUpstash, estado: EstadoAlmacen }>}
 */
export async function crearAlmacen(env = process.env, opts = {}) {
  const { fetchImpl = globalThis.fetch, timeoutMs = TIMEOUT_MS, comprobar = true } = opts;
  const url = texto(env.UPSTASH_REDIS_REST_URL);
  const token = texto(env.UPSTASH_REDIS_REST_TOKEN);
  const prefijo = texto(env.ALMACEN_PREFIJO) || PREFIJO_POR_DEFECTO;

  const pedido = texto(env.ALMACEN).toLowerCase();
  const deseado = pedido || (url && token ? 'upstash' : 'memoria');

  const aMemoria = (aviso) => ({
    almacen: new AlmacenMemoria(),
    estado: new EstadoAlmacen({ tipo: 'memoria', deseado, aviso }),
  });

  if (deseado === 'memoria') {
    return { almacen: new AlmacenMemoria(), estado: new EstadoAlmacen({ tipo: 'memoria' }) };
  }

  if (!TIPOS.includes(deseado)) {
    return aMemoria(`ALMACEN="${pedido}" no es un tipo conocido (${TIPOS.join(', ')}); se usa memoria y el estado se perderá al reiniciar.`);
  }

  // deseado === 'upstash'
  const faltan = [!url && 'UPSTASH_REDIS_REST_URL', !token && 'UPSTASH_REDIS_REST_TOKEN'].filter(Boolean);
  if (faltan.length) {
    return aMemoria(`ALMACEN=upstash pero falta ${faltan.join(' y ')}; se usa memoria y el estado se perderá al reiniciar.`);
  }

  let almacen;
  try {
    almacen = new AlmacenUpstash({ url, token, prefijo, fetchImpl, timeoutMs });
  } catch (err) {
    return aMemoria(`No se pudo configurar Upstash (${mensaje(err)}); se usa memoria y el estado se perderá al reiniciar.`);
  }

  if (comprobar) {
    try {
      await almacen.comprobar();
    } catch (err) {
      return aMemoria(`${mensaje(err)}; se usa memoria y el estado se perderá al reiniciar.`);
    }
  }

  return { almacen, estado: new EstadoAlmacen({ tipo: 'upstash' }) };
}
