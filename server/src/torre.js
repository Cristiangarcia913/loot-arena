// Torre infinita (1.3): mejor piso por dirección y ranking top 20, en memoria.
//
// Confianza en el cliente (red de pruebas): el servidor no rejuega los combates.
// La única defensa es que el récord sube como mucho de uno en uno: se acepta
// `piso <= récord + 1`. Por eso la web debe enviar POST /torre al superar CADA
// piso (no solo al caer). Se pierde al reiniciar el servidor.
import express from 'express';
import { RateLimiter } from './rateLimit.js';

export const PISO_MAX = 100_000;
export const TURNOS_MAX = 10_000_000;
export const TOP_TORRE = 20;

export const LIMITE_TORRE_IP = { windowMs: 60 * 60 * 1000, max: 300 }; // POST /torre: 300 por hora por IP
export const LIMITE_TORRE_DIRECCION = { windowMs: 2_000, max: 1 };      // POST /torre: 1 cada 2 s por dirección
export const LIMITE_TORRE_RANKING_IP = { windowMs: 60_000, max: 60 };   // GET /torre/ranking: 60 por minuto por IP

const enteroEntre = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

export class RegistroTorre {
  constructor({ maxDirecciones = 50_000, now = Date.now } = {}) {
    this.maxDirecciones = maxDirecciones;
    this.now = now;
    this.records = new Map(); // address -> { piso, turnos, t }
  }

  record(address) { return this.records.get(address)?.piso ?? 0; }

  /**
   * @returns {{ ok: true, record: number, nuevoRecord: boolean } | { ok: false, maximo: number }}
   */
  registrar(address, piso, turnos) {
    const prev = this.records.get(address);
    const actual = prev?.piso ?? 0;
    if (piso > actual + 1) return { ok: false, maximo: actual + 1 };
    const mejora = piso > actual || (piso === actual && prev && turnos < prev.turnos);
    if (!mejora) return { ok: true, record: actual, nuevoRecord: false };
    if (!prev && this.records.size >= this.maxDirecciones) {
      // Lleno: se olvida el peor récord (el más bajo).
      let peor = null;
      for (const [k, v] of this.records) if (!peor || v.piso < peor[1].piso) peor = [k, v];
      if (peor[1].piso >= piso) return { ok: true, record: actual, nuevoRecord: false };
      this.records.delete(peor[0]);
    }
    this.records.set(address, { piso, turnos, t: this.now() });
    return { ok: true, record: piso, nuevoRecord: piso > actual };
  }

  /** Top N: más piso primero; a igual piso, menos turnos; luego quien llegó antes. */
  ranking(n = TOP_TORRE) {
    return [...this.records]
      .sort(([, a], [, b]) => b.piso - a.piso || a.turnos - b.turnos || a.t - b.t)
      .slice(0, n)
      .map(([address, { piso }]) => ({ address, piso }));
  }
}

/**
 * Rutas `POST /torre` y `GET /torre/ranking`.
 * @param {{ validarDireccion: (v: unknown) => string | null, registro?: RegistroTorre, now?: () => number }} deps
 */
export function crearRouterTorre({ validarDireccion, now = Date.now, registro = new RegistroTorre({ now }) }) {
  const router = express.Router();
  const limIp = new RateLimiter({ ...LIMITE_TORRE_IP, now });
  const limDir = new RateLimiter({ ...LIMITE_TORRE_DIRECCION, now });
  const limRanking = new RateLimiter({ ...LIMITE_TORRE_RANKING_IP, now });
  const demasiadas = (res, s) =>
    res.set('Retry-After', String(s)).status(429).json({ error: `Demasiadas peticiones, espera ${s} s` });

  router.get('/torre/ranking', (req, res) => {
    const porIp = limRanking.hit(req.ip ?? 'desconocida');
    if (!porIp.ok) return demasiadas(res, porIp.retryAfterS);
    res.json(registro.ranking());
  });

  router.post('/torre', (req, res) => {
    const porIp = limIp.hit(req.ip ?? 'desconocida');
    if (!porIp.ok) return demasiadas(res, porIp.retryAfterS);
    const body = req.body ?? {};
    const address = validarDireccion(body.address);
    if (!address) return res.status(400).json({ error: 'Dirección inválida' });
    // piso 0 (cayó en el primer piso) se acepta y no cambia nada.
    if (!enteroEntre(body.piso, 0, PISO_MAX)) {
      return res.status(400).json({ error: `piso debe ser un entero entre 0 y ${PISO_MAX}` });
    }
    if (!enteroEntre(body.turnos, 0, TURNOS_MAX)) {
      return res.status(400).json({ error: `turnos debe ser un entero entre 0 y ${TURNOS_MAX}` });
    }
    const porDir = limDir.hit(address);
    if (!porDir.ok) return demasiadas(res, porDir.retryAfterS);

    const r = registro.registrar(address, body.piso, body.turnos);
    if (!r.ok) {
      return res.status(409).json({
        error: `Piso no válido: tu récord es ${r.maximo - 1}, solo puedes registrar hasta el piso ${r.maximo}`,
        maximo: r.maximo,
      });
    }
    return res.json({ ok: true, record: r.record, nuevoRecord: r.nuevoRecord });
  });

  return router;
}
