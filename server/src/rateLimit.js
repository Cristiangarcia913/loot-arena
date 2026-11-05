// Limitador de ventana deslizante en memoria, con reloj inyectable para tests.
// Suficiente para una sola instancia del servidor (Render/Railway free).

export class RateLimiter {
  /**
   * @param {{ windowMs: number, max: number, now?: () => number }} opts
   */
  constructor({ windowMs, max, now = Date.now }) {
    this.windowMs = windowMs;
    this.max = max;
    this.now = now;
    this.hits = new Map(); // clave -> array de timestamps (orden ascendente)
    this.llamadas = 0;
  }

  /**
   * Registra un intento para `key`.
   * @returns {{ ok: true } | { ok: false, retryAfterS: number }}
   */
  hit(key) {
    const t = this.now();
    if (++this.llamadas % 1000 === 0) this.limpiar(t);

    const desde = t - this.windowMs;
    const lista = (this.hits.get(key) ?? []).filter((x) => x > desde);

    if (lista.length >= this.max) {
      this.hits.set(key, lista);
      const retryAfterMs = lista[0] + this.windowMs - t;
      return { ok: false, retryAfterS: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
    }
    lista.push(t);
    this.hits.set(key, lista);
    return { ok: true };
  }

  /** Elimina claves cuya ventana ya expiró (evita crecer sin límite). */
  limpiar(t = this.now()) {
    const desde = t - this.windowMs;
    for (const [k, lista] of this.hits) {
      if (!lista.length || lista[lista.length - 1] <= desde) this.hits.delete(k);
    }
  }
}
