// GET /tesoreria (fase E3): resumen de lo que tiene el juego en la cadena.
//
// POR QUÉ LO SIRVE EL SERVIDOR Y NO CADA NAVEGADOR: son cuatro llamadas al RPC por visita.
// Con el plan gratuito y un RPC público compartido, que cada pestaña las repita agota la
// cuota enseguida. Aquí se leen una vez y se reparten cacheadas.
//
// TOLERANCIA A FALLOS: si el RPC falla, se devuelve lo último que se leyó diciendo de cuándo
// es (`obsoleto: true`), en vez de romper la sección «Cadena» de la web. Solo se responde con
// error cuando no hay absolutamente nada que servir.
import express from 'express';
import { formatEther, formatUnits } from 'ethers';
import { RateLimiter } from './rateLimit.js';
import { DECIMALES_ORO } from './abis.js';

/** Vistas del Mercado que necesita el panel de tesorería. */
export const ABI_MERCADO_TESORERIA = Object.freeze([
  'function cajaEth() view returns (uint256)',
  'function owner() view returns (address)',
]);

/** Vistas del ORO (ERC-20). */
export const ABI_ORO_TESORERIA = Object.freeze([
  'function totalSupply() view returns (uint256)',
  'function decimals() view returns (uint8)',
]);

/** Cuánto vale la caché antes de volver a preguntar al RPC. */
export const CACHE_TESORERIA_MS = 45_000;
/** Hasta cuándo se sigue sirviendo un dato viejo si el RPC falla. */
export const MAX_OBSOLETO_MS = 30 * 60 * 1000;

export const LIMITE_TESORERIA_IP = { windowMs: 60_000, max: 60 };

/**
 * El ORO quemado NO se puede leer de ninguna vista: `LootGold` es un `ERC20Burnable`
 * normal y `quemarDe` solo hace `_burn`, que baja `totalSupply` y emite
 * `Transfer(de, 0x0, cantidad)`. No hay contador acumulado en el contrato.
 * Sumarlo exigiría recorrer TODA la historia de eventos, que es justo lo que el RPC
 * público ya no sirve (ver README §El RPC y la historia podada). Se dice en vez de
 * inventar un número.
 */
export const MOTIVO_SIN_QUEMADO = 'El contrato LootGold no lleva contador de quemado: '
  + 'solo se podría calcular sumando todos los eventos Transfer al 0x0 desde el despliegue, '
  + 'y el RPC público ya no guarda esa historia. Haría falta un contador en el contrato.';

/**
 * Lee y cachea el estado del dinero del juego.
 *
 * @param {{
 *   leer: () => Promise<{ cajaEth: bigint, operadorEth: bigint, oroCirculacion: bigint, owner: string }>,
 *   red?: object, contratos?: object,
 *   cacheMs?: number, maxObsoletoMs?: number,
 *   now?: () => number, logger?: Pick<Console, 'log' | 'error' | 'warn'>,
 * }} deps
 */
export class Tesoreria {
  constructor({
    leer, red = null, contratos = {},
    cacheMs = CACHE_TESORERIA_MS, maxObsoletoMs = MAX_OBSOLETO_MS,
    now = Date.now, logger = console,
  }) {
    this.leer = leer;
    this.red = red;
    this.contratos = contratos;
    this.cacheMs = cacheMs;
    this.maxObsoletoMs = maxObsoletoMs;
    this.now = now;
    this.logger = logger;

    this.cache = null;      // { t, datos }
    this.enCurso = null;    // lecturas simultáneas comparten una sola llamada al RPC
    this.ultimoError = null;
    this.lecturas = 0;
  }

  /** Da formato al JSON público a partir de los valores crudos. */
  _formatear(crudo, t) {
    return {
      red: this.red?.clave ?? null,
      redNombre: this.red?.nombre ?? null,
      chainId: this.red?.chainId ?? null,
      moneda: this.red?.moneda ?? 'ETH',
      explorador: this.red?.explorador ?? null,
      actualizado: new Date(t).toISOString(),
      // ETH que el Mercado tiene guardado de las compras de los jugadores.
      cajaEth: formatEther(crudo.cajaEth),
      // ETH de la cartera con la que el servidor paga el gas (recompensas y grifo).
      operadorEth: formatEther(crudo.operadorEth),
      // ORO existente ahora mismo (lo acuñado menos lo quemado).
      oroCirculacion: formatUnits(crudo.oroCirculacion, DECIMALES_ORO),
      oroQuemado: null,
      motivoOroQuemado: MOTIVO_SIN_QUEMADO,
      // Quién puede sacar el ETH de la caja, y cómo.
      owner: crudo.owner,
      retirada: {
        funcion: 'Mercado.retirarEth(uint256 cantidad)',
        quienPuede: crudo.owner,
        nota: 'Solo el owner del Mercado puede retirar. Cualquier otra cuenta recibe un revert.',
      },
      contratos: this.contratos,
    };
  }

  /**
   * Resumen, de la caché si está fresca. Nunca lanza por culpa del RPC.
   * @returns {Promise<{ ok: true, datos: object, obsoleto: boolean } | { ok: false, error: string }>}
   */
  async resumen() {
    const ahora = this.now();
    if (this.cache && ahora - this.cache.t < this.cacheMs) {
      return { ok: true, datos: this.cache.datos, obsoleto: false };
    }

    // Si ya hay una lectura en vuelo, se espera a esa (no se multiplican las llamadas al RPC).
    this.enCurso ??= (async () => {
      try {
        const crudo = await this.leer();
        const t = this.now();
        this.cache = { t, datos: this._formatear(crudo, t) };
        this.lecturas += 1;
        this.ultimoError = null;
      } catch (err) {
        this.ultimoError = err?.shortMessage ?? err?.message ?? String(err);
        this.logger.error('[tesoreria] no se pudo leer la cadena:', this.ultimoError);
      } finally {
        this.enCurso = null;
      }
    })();
    await this.enCurso;

    if (!this.cache) {
      return { ok: false, error: this.ultimoError ?? 'No se pudo leer la cadena' };
    }
    const edad = this.now() - this.cache.t;
    // Dato viejo: se sirve igual, diciendo de cuándo es. Mejor eso que romper la sección.
    if (edad >= this.cacheMs && edad > this.maxObsoletoMs) {
      return { ok: false, error: this.ultimoError ?? 'Los datos de tesorería están demasiado viejos' };
    }
    return { ok: true, datos: this.cache.datos, obsoleto: edad >= this.cacheMs };
  }
}

/**
 * Ruta `GET /tesoreria`.
 * @param {{ tesoreria?: Tesoreria | null, now?: () => number, noDisponible?: string }} deps
 */
export function crearRouterTesoreria({
  tesoreria = null, now = Date.now,
  noDisponible = 'Tesorería no disponible: el servidor no tiene configurado MERCADO_ADDRESS y ORO_ADDRESS',
}) {
  const router = express.Router();
  const limIp = new RateLimiter({ ...LIMITE_TESORERIA_IP, now });

  router.get('/tesoreria', async (req, res) => {
    const porIp = limIp.hit(req.ip ?? 'desconocida');
    if (!porIp.ok) {
      return res.set('Retry-After', String(porIp.retryAfterS)).status(429)
        .json({ error: `Demasiadas peticiones, espera ${porIp.retryAfterS} s` });
    }
    if (!tesoreria) return res.status(503).json({ error: noDisponible });

    const r = await tesoreria.resumen();
    if (!r.ok) {
      return res.set('Retry-After', '30').status(503)
        .json({ error: 'No se pudo leer la tesorería de la cadena; inténtalo en unos segundos', detalle: r.error });
    }
    // Caché corta en el navegador: el dato cambia poco y así se alivia aún más el RPC.
    res.set('Cache-Control', 'public, max-age=30');
    return res.json(r.obsoleto ? { ...r.datos, obsoleto: true } : r.datos);
  });

  return router;
}
