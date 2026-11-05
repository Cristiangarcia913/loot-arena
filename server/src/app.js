// App Express sin efectos secundarios: todas las dependencias se inyectan,
// así los tests pueden usar un minter falso y un RNG/reloj controlados.
import express from 'express';
import cors from 'cors';
import { isAddress, getAddress, ZeroAddress } from 'ethers';
import { tirarLoot, EstadoBotin } from './loot.js';
import { RateLimiter } from './rateLimit.js';
import { mensajeError } from './chain.js';
import { origenCors } from './config.js';
import {
  RegistroRecompensas, validarMotivo, cantidadWei, MOTIVOS, LISTA_MOTIVOS, INICIO_TEMPORADAS,
} from './recompensa.js';

export const LIMITE_DIRECCION = { windowMs: 10_000, max: 1 };       // 1 cada 10 s por dirección
export const LIMITE_IP = { windowMs: 60 * 60 * 1000, max: 30 };      // 30 por hora por IP
export const LIMITE_RANKING_IP = { windowMs: 60_000, max: 60 };       // GET /ranking: 60 por minuto por IP
export const LIMITE_RECOMPENSA_IP = { windowMs: 60 * 60 * 1000, max: 20 }; // POST /recompensa: 20 por hora por IP

/** Valida y normaliza una dirección. Devuelve la dirección checksum o null. */
export function validarDireccion(valor) {
  if (typeof valor !== 'string' || !isAddress(valor.trim())) return null;
  const dir = getAddress(valor.trim());
  return dir === ZeroAddress ? null : dir;
}

/** Valida enemyLevel (entero 1..10, opcional → 1). Devuelve el número o null. */
export function validarNivel(valor) {
  if (valor === undefined || valor === null) return 1;
  return Number.isInteger(valor) && valor >= 1 && valor <= 10 ? valor : null;
}

/** Valida `jefe` (booleano opcional → false). Devuelve el booleano o null si no es válido. */
export function validarJefe(valor) {
  if (valor === undefined) return false;
  return typeof valor === 'boolean' ? valor : null;
}

/**
 * @param {{
 *   mint: (to: string, item: object) => Promise<{ tokenId: string, txHash: string }>,
 *   contractAddress: string, chainId: number,
 *   dropChance?: number, rng?: () => number, now?: () => number,
 *   allowedOrigin?: string, trustProxy?: number | boolean,
 *   logger?: Pick<Console, 'log' | 'error'>,
 *   estadoBotin?: EstadoBotin,
 *   ranking?: import('./ranking.js').IndexadorRanking | null,
 *   rankingNoDisponible?: string,
 *   pagarRecompensa?: ((to: string, cantidad: bigint, motivo: string) => Promise<{ txHash: string }>) | null,
 *   recompensaNoDisponible?: string,
 *   registroRecompensas?: RegistroRecompensas,
 *   inicioTemporadas?: number
 * }} deps
 */
export function crearApp({
  mint, contractAddress, chainId,
  dropChance = 0.6, rng = Math.random, now = Date.now,
  allowedOrigin = '*', trustProxy = false, logger = console,
  estadoBotin = new EstadoBotin(),
  ranking = null, rankingNoDisponible = 'Ranking no disponible en este servidor',
  pagarRecompensa = null, recompensaNoDisponible = 'Recompensas no disponibles en este servidor',
  inicioTemporadas = INICIO_TEMPORADAS,
  registroRecompensas = new RegistroRecompensas({ inicio: inicioTemporadas }),
}) {
  const app = express();
  app.set('trust proxy', trustProxy);
  app.disable('x-powered-by');
  app.use(cors({ origin: origenCors(allowedOrigin), methods: ['GET', 'POST'] }));
  app.use(express.json({ limit: '2kb' }));

  const limIp = new RateLimiter({ ...LIMITE_IP, now });
  const limDir = new RateLimiter({ ...LIMITE_DIRECCION, now });
  const limRankingIp = new RateLimiter({ ...LIMITE_RANKING_IP, now });
  const limRecIp = new RateLimiter({ ...LIMITE_RECOMPENSA_IP, now });
  const limRecDir = new RateLimiter({ ...LIMITE_DIRECCION, now });

  const demasiadas = (res, s) =>
    res.set('Retry-After', String(s)).status(429).json({ error: `Demasiadas peticiones, espera ${s} s` });

  app.get('/health', (_req, res) => {
    res.json({ ok: true, contract: contractAddress, chainId: Number(chainId) });
  });

  app.post('/ganar', async (req, res) => {
    const porIp = limIp.hit(req.ip ?? 'desconocida');
    if (!porIp.ok) return demasiadas(res, porIp.retryAfterS);

    const body = req.body ?? {};
    const address = validarDireccion(body.address);
    if (!address) return res.status(400).json({ error: 'Dirección inválida' });

    const enemyLevel = validarNivel(body.enemyLevel);
    if (enemyLevel === null) return res.status(400).json({ error: 'enemyLevel debe ser un entero entre 1 y 10' });

    const jefe = validarJefe(body.jefe);
    if (jefe === null) return res.status(400).json({ error: 'jefe debe ser un booleano' });

    const porDir = limDir.hit(address);
    if (!porDir.ok) return demasiadas(res, porDir.retryAfterS);

    const item = tirarLoot(rng, {
      dropChance, nivel: enemyLevel, jefe, ...estadoBotin.opciones(address),
    });
    if (!item) return res.json({ drop: false });

    try {
      const { tokenId, txHash } = await mint(address, item);
      estadoBotin.registrar(address, item);
      logger.log(`[mint] #${tokenId} "${item.nombre}" → ${address} (nivel ${enemyLevel}${jefe ? ', jefe' : ''}) tx ${txHash}`);
      return res.json({ drop: true, tokenId: String(tokenId), txHash, item });
    } catch (err) {
      logger.error('[mint] error:', err?.shortMessage ?? err?.message ?? err);
      return res.status(500).json({ error: mensajeError(err) });
    }
  });

  // ── Ranking on-chain ──────────────────────────────────────────────────────
  const rankingListo = (req, res) => {
    const porIp = limRankingIp.hit(req.ip ?? 'desconocida');
    if (!porIp.ok) { demasiadas(res, porIp.retryAfterS); return false; }
    if (!ranking) { res.status(503).json({ error: rankingNoDisponible }); return false; }
    if (ranking.actualizado === null) {
      res.set('Retry-After', '30').status(503).json({ error: 'El ranking se está generando, vuelve en unos segundos' });
      return false;
    }
    res.set('Cache-Control', 'public, max-age=30');
    return true;
  };

  app.get('/ranking', (req, res) => {
    if (!rankingListo(req, res)) return;
    res.json(ranking.ranking());
  });

  app.get('/ranking/:address', (req, res) => {
    const address = validarDireccion(req.params.address);
    if (!address) return res.status(400).json({ error: 'Dirección inválida' });
    if (!rankingListo(req, res)) return;
    res.json(ranking.posicion(address));
  });

  // ── Recompensas de ORO (pase y misiones) ──────────────────────────────────
  app.post('/recompensa', async (req, res) => {
    const porIp = limRecIp.hit(req.ip ?? 'desconocida');
    if (!porIp.ok) return demasiadas(res, porIp.retryAfterS);
    if (!pagarRecompensa) return res.status(503).json({ error: recompensaNoDisponible });

    const body = req.body ?? {};
    const address = validarDireccion(body.address);
    if (!address) return res.status(400).json({ error: 'Dirección inválida' });
    const motivo = validarMotivo(body.motivo);
    if (!motivo) return res.status(400).json({ error: `motivo debe ser uno de: ${LISTA_MOTIVOS.join(', ')}` });

    const porDir = limRecDir.hit(address);
    if (!porDir.ok) return demasiadas(res, porDir.retryAfterS);

    const ahora = now();
    const { periodo, motivoOnchain } = registroRecompensas.datos(address, motivo, ahora);
    const yaReclamada = () => res.status(409).json({ error: 'Ya has reclamado esta recompensa', motivo, periodo });
    // Lo ya pagado on-chain (sobrevive a reinicios del servidor), si el ranking está activo.
    if (ranking?.yaRecompensado(address, motivoOnchain)) return yaReclamada();

    const reserva = registroRecompensas.reservar(address, motivo, ahora);
    if (!reserva.ok) {
      if (reserva.motivo === 'duplicado') return yaReclamada();
      return res.status(429).json({ error: 'Has alcanzado el límite de recompensas de hoy' });
    }

    const oro = MOTIVOS[motivo].oro;
    try {
      const { txHash } = await pagarRecompensa(address, cantidadWei(motivo), motivoOnchain);
      registroRecompensas.confirmar(reserva);
      logger.log(`[recompensa] ${oro} ORO "${motivoOnchain}" → ${address} tx ${txHash}`);
      return res.json({ ok: true, motivo, periodo, oro, txHash });
    } catch (err) {
      registroRecompensas.liberar(reserva);
      logger.error('[recompensa] error:', err?.shortMessage ?? err?.message ?? err);
      if (err?.code === 'CALL_EXCEPTION') {
        const motivoRevert = err?.revert?.name;
        if (motivoRevert === 'TopeJugadorSuperado') {
          return res.status(409).json({ error: 'Has alcanzado el tope diario de ORO de recompensas; vuelve mañana' });
        }
        if (motivoRevert === 'TopeGlobalSuperado') {
          return res.status(409).json({ error: 'Se ha agotado el ORO de recompensas de hoy para todos; vuelve mañana' });
        }
        if (motivoRevert === 'SoloOperador') {
          return res.status(500).json({ error: 'El servidor no está autorizado como operador de Recompensas' });
        }
        return res.status(409).json({ error: 'El contrato rechazó la recompensa (tope diario alcanzado)' });
      }
      return res.status(500).json({ error: mensajeError(err, { accion: 'pagar la recompensa' }) });
    }
  });

  app.use((_req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

  // Errores de parseo del JSON y cualquier otro error no controlado.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Petición demasiado grande' });
    logger.error('[app] error no controlado:', err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  });

  return app;
}
