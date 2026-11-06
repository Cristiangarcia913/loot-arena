// Grifo de gas (1.3): envía un poco de ETH de Sepolia a los jugadores que no tienen,
// para que puedan vender, comprar o abrir cofres sin buscar un faucet.
//
// Las reglas viven en `RegistroGas` (pura, reloj inyectable) y las rutas en
// `crearRouterGas`. El envío real (`enviarGas`) lo inyecta index.js usando el
// MISMO emisor que los mints y las recompensas: una sola cola y un solo nonce.
import express from 'express';
import { formatEther, parseEther } from 'ethers';
import { RateLimiter } from './rateLimit.js';
import { mensajeError } from './chain.js';
import { diaUtc, segundosHastaManana } from './recompensa.js';

/** Por debajo de este saldo el jugador puede pedir gas. */
export const UMBRAL_JUGADOR = parseEther('0.0003');
/** Lo que se envía en cada petición. */
export const CANTIDAD_GAS = parseEther('0.0005');
/** Tope global diario por defecto (`GAS_TOPE_DIARIO`). */
export const TOPE_DIARIO_POR_DEFECTO = parseEther('0.01');
/** El servidor nunca baja de este saldo por culpa del grifo (lo necesita para los mints). */
export const RESERVA_SERVIDOR = parseEther('0.002');

export const LIMITE_GAS_IP = { windowMs: 60 * 60 * 1000, max: 10 };   // POST /gas: 10 por hora por IP
export const LIMITE_GAS_DIRECCION = { windowMs: 10_000, max: 1 };       // POST /gas: 1 cada 10 s por dirección
export const LIMITE_GAS_CONSULTA_IP = { windowMs: 60_000, max: 60 };    // GET /gas/:address: 60 por minuto por IP

/** ETH (bigint wei) → número para el JSON (0.0005). */
const eth = (wei) => Number(formatEther(wei));

/**
 * Registro en memoria de quién ha pedido gas hoy y cuánto se ha repartido.
 * Solo guarda el día UTC en curso: al cambiar de día se vacía solo.
 */
export class RegistroGas {
  constructor({ topeDiario = TOPE_DIARIO_POR_DEFECTO, cantidad = CANTIDAD_GAS } = {}) {
    this.topeDiario = topeDiario;
    this.cantidad = cantidad;
    this.dia = null;
    this.direcciones = new Set(); // enviadas o en vuelo hoy
    this.totalHoy = 0n;           // incluye las reservas en vuelo
  }

  #alDia(ahora) {
    const hoy = diaUtc(ahora);
    if (this.dia !== hoy) { this.dia = hoy; this.direcciones.clear(); this.totalHoy = 0n; }
  }

  yaPedido(address, ahora) { this.#alDia(ahora); return this.direcciones.has(address); }

  /** ¿Queda hueco en el tope global de hoy para un envío más? */
  hayCupo(ahora) { this.#alDia(ahora); return this.totalHoy + this.cantidad <= this.topeDiario; }

  /**
   * Aparta el envío antes de mandar la transacción (evita duplicados si llegan dos a la vez).
   * @returns {{ ok: true, reserva: object } | { ok: false, motivo: 'duplicado' | 'tope' }}
   */
  reservar(address, ahora) {
    this.#alDia(ahora);
    if (this.direcciones.has(address)) return { ok: false, motivo: 'duplicado' };
    if (this.totalHoy + this.cantidad > this.topeDiario) return { ok: false, motivo: 'tope' };
    this.direcciones.add(address);
    this.totalHoy += this.cantidad;
    return { ok: true, reserva: { address, dia: this.dia } };
  }

  /** Deshace una reserva si el envío falló (solo si seguimos en el mismo día). */
  liberar({ address, dia }) {
    if (this.dia !== dia || !this.direcciones.delete(address)) return;
    this.totalHoy -= this.cantidad;
  }
}

/**
 * Rutas `POST /gas` y `GET /gas/:address`.
 * @param {{
 *   saldoDe: (address: string) => Promise<bigint>,
 *   enviarGas: ((to: string, wei: bigint) => Promise<{ txHash: string }>) | null,
 *   saldoServidor: () => Promise<bigint>,
 *   validarDireccion: (v: unknown) => string | null,
 *   registro?: RegistroGas, now?: () => number,
 *   logger?: Pick<Console, 'log' | 'error'>,
 *   noDisponible?: string,
 * }} deps
 */
export function crearRouterGas({
  saldoDe, enviarGas, saldoServidor, validarDireccion,
  registro = new RegistroGas(), now = Date.now, logger = console,
  noDisponible = 'El grifo de gas no está disponible en este servidor',
}) {
  const router = express.Router();
  const activo = Boolean(enviarGas && saldoDe && saldoServidor);
  const limIp = new RateLimiter({ ...LIMITE_GAS_IP, now });
  const limDir = new RateLimiter({ ...LIMITE_GAS_DIRECCION, now });
  const limConsulta = new RateLimiter({ ...LIMITE_GAS_CONSULTA_IP, now });
  const demasiadas = (res, s) =>
    res.set('Retry-After', String(s)).status(429).json({ error: `Demasiadas peticiones, espera ${s} s` });
  const errorRed = (res, err, que) => {
    logger.error(`[gas] no se pudo leer ${que}:`, err?.shortMessage ?? err?.message ?? err);
    return res.status(502).json({ error: 'No se pudo conectar con la red Ethereum; inténtalo de nuevo' });
  };

  router.get('/gas/:address', async (req, res) => {
    const porIp = limConsulta.hit(req.ip ?? 'desconocida');
    if (!porIp.ok) return demasiadas(res, porIp.retryAfterS);
    const address = validarDireccion(req.params.address);
    if (!address) return res.status(400).json({ error: 'Dirección inválida' });
    if (!activo) return res.status(503).json({ error: noDisponible });

    let saldo;
    try { saldo = await saldoDe(address); } catch (err) { return errorRed(res, err, 'el saldo del jugador'); }
    const ahora = now();
    const yaPedido = registro.yaPedido(address, ahora);
    let motivo = null;
    if (yaPedido) motivo = 'Ya has pedido gas hoy';
    else if (saldo >= UMBRAL_JUGADOR) motivo = 'ya tienes gas';
    else if (!registro.hayCupo(ahora)) motivo = 'Se ha agotado el gas de hoy para todos';
    return res.json({
      saldo: formatEther(saldo),
      puedePedir: motivo === null,
      proximoEn: yaPedido ? segundosHastaManana(ahora) : 0,
      ...(motivo ? { motivo } : {}),
    });
  });

  router.post('/gas', async (req, res) => {
    const porIp = limIp.hit(req.ip ?? 'desconocida');
    if (!porIp.ok) return demasiadas(res, porIp.retryAfterS);
    const address = validarDireccion(req.body?.address);
    if (!address) return res.status(400).json({ error: 'Dirección inválida' });
    if (!activo) return res.status(503).json({ error: noDisponible });
    const porDir = limDir.hit(address);
    if (!porDir.ok) return demasiadas(res, porDir.retryAfterS);

    const ahora = now();
    const yaPedidoHoy = () =>
      res.status(409).json({ error: 'Ya has pedido gas hoy; vuelve mañana', proximoEn: segundosHastaManana(ahora) });
    if (registro.yaPedido(address, ahora)) return yaPedidoHoy();

    let saldo;
    try { saldo = await saldoDe(address); } catch (err) { return errorRed(res, err, 'el saldo del jugador'); }
    if (saldo >= UMBRAL_JUGADOR) {
      return res.json({ ok: true, enviado: 0, motivo: 'ya tienes gas', saldo: formatEther(saldo) });
    }

    let saldoSrv;
    try { saldoSrv = await saldoServidor(); } catch (err) { return errorRed(res, err, 'el saldo del servidor'); }
    if (saldoSrv - registro.cantidad < RESERVA_SERVIDOR) {
      logger.error(`[gas] saldo del servidor bajo (${formatEther(saldoSrv)} ETH): no se envía gas`);
      return res.status(503).json({ error: 'El servidor se ha quedado sin ETH para regalar; inténtalo más tarde' });
    }

    const r = registro.reservar(address, ahora);
    if (!r.ok) {
      if (r.motivo === 'duplicado') return yaPedidoHoy();
      return res.status(503).json({
        error: 'Se ha agotado el gas de hoy para todos; vuelve mañana', proximoEn: segundosHastaManana(ahora),
      });
    }
    try {
      const { txHash } = await enviarGas(address, registro.cantidad);
      logger.log(`[gas] ${formatEther(registro.cantidad)} ETH → ${address} tx ${txHash}`);
      return res.json({ ok: true, enviado: eth(registro.cantidad), txHash });
    } catch (err) {
      registro.liberar(r.reserva);
      logger.error('[gas] error al enviar:', err?.shortMessage ?? err?.message ?? err);
      const status = err?.code === 'INSUFFICIENT_FUNDS' ? 503 : 500;
      return res.status(status).json({ error: mensajeError(err, { accion: 'enviar el gas' }) });
    }
  });

  return router;
}
