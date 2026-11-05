// Utilidades de test (este archivo no contiene tests).

/** RNG determinista con semilla (mulberry32). */
export function rngSemilla(seed = 12345) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** RNG que devuelve siempre el mismo valor. */
export const rngFijo = (v) => () => v;

/** Arranca la app en un puerto libre y devuelve { url, cerrar }. */
export async function levantar(app) {
  const server = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, cerrar: () => new Promise((ok) => server.close(ok)) };
}

export async function post(url, body, headers = {}) {
  const r = await fetch(`${url}/ganar`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: r.status, headers: r.headers, json: await r.json() };
}

export const loggerMudo = { log() {}, error() {}, warn() {} };
