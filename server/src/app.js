// App Express sin efectos secundarios: todas las dependencias se inyectan,
// así los tests pueden usar un minter falso y un RNG/reloj controlados.
import express from 'express';
import cors from 'cors';
import { isAddress, getAddress, ZeroAddress } from 'ethers';
import { tirarLoot, EstadoBotin } from './loot.js';
import { RateLimiter } from './rateLimit.js';
import { mensajeError } from './chain.js';
import { origenCors } from './config.js';

export const LIMITE_DIRECCION = { windowMs: 10_000, max: 1 };       // 1 cada 10 s por dirección
export const LIMITE_IP = { windowMs: 60 * 60 * 1000, max: 30 };      // 30 por hora por IP

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
 *   estadoBotin?: EstadoBotin
 * }} deps
 */
export function crearApp({
  mint, contractAddress, chainId,
  dropChance = 0.6, rng = Math.random, now = Date.now,
  allowedOrigin = '*', trustProxy = false, logger = console,
  estadoBotin = new EstadoBotin(),
}) {
  const app = express();
  app.set('trust proxy', trustProxy);
  app.disable('x-powered-by');
  app.use(cors({ origin: origenCors(allowedOrigin), methods: ['GET', 'POST'] }));
  app.use(express.json({ limit: '2kb' }));

  const limIp = new RateLimiter({ ...LIMITE_IP, now });
  const limDir = new RateLimiter({ ...LIMITE_DIRECCION, now });

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
