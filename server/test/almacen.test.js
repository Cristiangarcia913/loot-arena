// Tests de la capa de almacenamiento (1.4). SIN RED: `AlmacenUpstash` recibe un
// `fetch` falso que imita las respuestas documentadas del API REST de Upstash.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  AlmacenMemoria, AlmacenUpstash, EstadoAlmacen, crearAlmacen, PREFIJO_POR_DEFECTO,
} from '../src/almacen.js';

/** Respuesta JSON falsa con el formato de Upstash. */
const respuesta = (cuerpo, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => cuerpo,
});

/**
 * `fetch` falso que habla como el API REST de Upstash sobre un Map local.
 * Guarda todas las llamadas en `fake.llamadas` para poder comprobarlas.
 */
function fetchUpstashFalso({ token = 'tok', datos = new Map() } = {}) {
  const llamadas = [];
  const impl = async (url, opciones = {}) => {
    llamadas.push({ url, metodo: opciones.method ?? 'GET', cuerpo: opciones.body, headers: opciones.headers });
    const auth = opciones.headers?.authorization ?? '';
    if (auth !== `Bearer ${token}`) return respuesta({ error: 'WRONGPASS invalid password' }, 401);

    const ruta = new URL(url).pathname;
    const [, comando, claveCodificada] = ruta.split('/');
    const clave = claveCodificada ? decodeURIComponent(claveCodificada) : null;
    if (comando === 'ping') return respuesta({ result: 'PONG' });
    if (comando === 'get') return respuesta({ result: datos.has(clave) ? datos.get(clave) : null });
    if (comando === 'set') { datos.set(clave, opciones.body); return respuesta({ result: 'OK' }); }
    if (comando === 'del') { const habia = datos.delete(clave); return respuesta({ result: habia ? 1 : 0 }); }
    return respuesta({ error: `ERR unknown command '${comando}'` }, 400);
  };
  impl.llamadas = llamadas;
  impl.datos = datos;
  return impl;
}

// ─── Contrato común: las dos implementaciones se comportan igual ──────────────

const implementaciones = [
  ['AlmacenMemoria', () => new AlmacenMemoria()],
  ['AlmacenUpstash', () => new AlmacenUpstash({
    url: 'https://ejemplo.upstash.io', token: 'tok', fetchImpl: fetchUpstashFalso(),
  })],
];

for (const [nombre, crear] of implementaciones) {
  describe(`${nombre}: interfaz leer/escribir/borrar`, () => {
    test('una clave que no existe devuelve null', async () => {
      const a = crear();
      assert.equal(await a.leer('no-existe'), null);
    });

    test('escribir y leer devuelve el mismo valor', async () => {
      const a = crear();
      const valor = { v: 1, lista: [1, 2, 3], texto: 'héroe', nulo: null, anidado: { ok: true } };
      await a.escribir('k', valor);
      assert.deepEqual(await a.leer('k'), valor);
    });

    test('escribir dos veces se queda con el último valor', async () => {
      const a = crear();
      await a.escribir('k', { n: 1 });
      await a.escribir('k', { n: 2 });
      assert.deepEqual(await a.leer('k'), { n: 2 });
    });

    test('borrar deja la clave a null (y borrar lo que no hay no falla)', async () => {
      const a = crear();
      await a.escribir('k', { n: 1 });
      await a.borrar('k');
      assert.equal(await a.leer('k'), null);
      await a.borrar('k'); // idempotente
    });

    test('lo leído es una copia: tocarlo no cambia lo guardado', async () => {
      const a = crear();
      await a.escribir('k', { lista: [1] });
      const leido = await a.leer('k');
      leido.lista.push(99);
      assert.deepEqual(await a.leer('k'), { lista: [1] });
    });

    test('claves distintas no se pisan', async () => {
      const a = crear();
      await a.escribir('uno', 1);
      await a.escribir('dos', 2);
      assert.equal(await a.leer('uno'), 1);
      assert.equal(await a.leer('dos'), 2);
    });
  });
}

// ─── AlmacenUpstash: detalles del API REST ────────────────────────────────────

describe('AlmacenUpstash: forma de las peticiones', () => {
  test('usa el prefijo en las claves y manda el token como Bearer', async () => {
    const fetchFalso = fetchUpstashFalso();
    const a = new AlmacenUpstash({ url: 'https://ejemplo.upstash.io', token: 'tok', fetchImpl: fetchFalso });
    await a.escribir('torre', { v: 1 });

    const [llamada] = fetchFalso.llamadas;
    assert.equal(llamada.metodo, 'POST');
    assert.equal(llamada.url, `https://ejemplo.upstash.io/set/${encodeURIComponent(`${PREFIJO_POR_DEFECTO}torre`)}`);
    assert.equal(llamada.headers.authorization, 'Bearer tok');
    assert.equal(llamada.cuerpo, JSON.stringify({ v: 1 }));
    assert.ok(fetchFalso.datos.has(`${PREFIJO_POR_DEFECTO}torre`));
  });

  test('un prefijo propio separa entornos en la misma base gratuita', async () => {
    const datos = new Map();
    const a = new AlmacenUpstash({ url: 'https://ejemplo.upstash.io', token: 'tok', prefijo: 'pruebas:', fetchImpl: fetchUpstashFalso({ datos }) });
    const b = new AlmacenUpstash({ url: 'https://ejemplo.upstash.io', token: 'tok', prefijo: 'produccion:', fetchImpl: fetchUpstashFalso({ datos }) });
    await a.escribir('gas', 'A');
    await b.escribir('gas', 'B');
    assert.equal(await a.leer('gas'), 'A');
    assert.equal(await b.leer('gas'), 'B');
  });

  test('la URL con barra final no genera dobles barras', async () => {
    const fetchFalso = fetchUpstashFalso();
    const a = new AlmacenUpstash({ url: 'https://ejemplo.upstash.io//', token: 'tok', fetchImpl: fetchFalso });
    await a.leer('k');
    assert.ok(!fetchFalso.llamadas[0].url.includes('.io//'), fetchFalso.llamadas[0].url);
  });

  test('token inválido: error claro que menciona el token', async () => {
    const a = new AlmacenUpstash({ url: 'https://ejemplo.upstash.io', token: 'malo', fetchImpl: fetchUpstashFalso({ token: 'bueno' }) });
    await assert.rejects(() => a.leer('k'), /rechazó el token/);
  });

  test('error de red: mensaje legible, no excepción cruda', async () => {
    const a = new AlmacenUpstash({
      url: 'https://ejemplo.upstash.io', token: 'tok',
      fetchImpl: async () => { throw new Error('getaddrinfo ENOTFOUND'); },
    });
    await assert.rejects(() => a.leer('k'), /no está accesible/);
  });

  test('timeout: se nombra el tiempo de espera', async () => {
    const a = new AlmacenUpstash({
      url: 'https://ejemplo.upstash.io', token: 'tok', timeoutMs: 20,
      // Simula lo que hace fetch al abortar por timeout.
      fetchImpl: async (_url, opciones) => new Promise((_ok, falla) => {
        opciones.signal.addEventListener('abort', () => {
          const e = new Error('abortado'); e.name = 'TimeoutError'; falla(e);
        });
      }),
    });
    await assert.rejects(() => a.leer('k'), /no respondió en 20 ms/);
  });

  test('un error en el cuerpo con HTTP 200 también se trata como error', async () => {
    const a = new AlmacenUpstash({
      url: 'https://ejemplo.upstash.io', token: 'tok',
      fetchImpl: async () => respuesta({ error: "ERR wrong number of arguments for 'get' command" }),
    });
    await assert.rejects(() => a.leer('k'), /devolvió un error/);
  });

  test('un valor guardado que no es JSON da un error con el nombre de la clave', async () => {
    const a = new AlmacenUpstash({
      url: 'https://ejemplo.upstash.io', token: 'tok',
      fetchImpl: async () => respuesta({ result: 'esto-no-es-json' }),
    });
    await assert.rejects(() => a.leer('torre'), /"torre" no es JSON válido/);
  });

  test('comprobar() pasa con PONG y falla con otra cosa', async () => {
    const ok = new AlmacenUpstash({ url: 'https://ejemplo.upstash.io', token: 'tok', fetchImpl: fetchUpstashFalso() });
    await ok.comprobar();
    const raro = new AlmacenUpstash({
      url: 'https://ejemplo.upstash.io', token: 'tok',
      fetchImpl: async () => respuesta({ result: 'vaya' }),
    });
    await assert.rejects(() => raro.comprobar(), /PING/);
  });

  test('el constructor exige url, token y fetch', () => {
    assert.throws(() => new AlmacenUpstash({ token: 'tok' }), /url/);
    assert.throws(() => new AlmacenUpstash({ url: 'https://x.upstash.io' }), /token/);
    assert.throws(
      () => new AlmacenUpstash({ url: 'https://x.upstash.io', token: 'tok', fetchImpl: null }),
      /fetch/,
    );
  });

  test('cuenta las peticiones (para vigilar el plan gratuito)', async () => {
    const a = new AlmacenUpstash({ url: 'https://ejemplo.upstash.io', token: 'tok', fetchImpl: fetchUpstashFalso() });
    await a.escribir('k', 1);
    await a.leer('k');
    await a.borrar('k');
    assert.equal(a.peticiones, 3);
  });
});

// ─── EstadoAlmacen ────────────────────────────────────────────────────────────

describe('EstadoAlmacen', () => {
  test('sin degradar: persistente y sin aviso', () => {
    const e = new EstadoAlmacen({ tipo: 'upstash' });
    assert.deepEqual(e.resumen(), { tipo: 'upstash', persistente: true, degradado: false });
  });

  test('memoria normal: no es persistente pero tampoco está degradado', () => {
    const e = new EstadoAlmacen({ tipo: 'memoria' });
    assert.deepEqual(e.resumen(), { tipo: 'memoria', persistente: false, degradado: false });
  });

  test('degradado: tipo memoria, deseado upstash y aviso visible', () => {
    const e = new EstadoAlmacen({ tipo: 'memoria', deseado: 'upstash', aviso: 'no responde' });
    const r = e.resumen();
    assert.equal(r.degradado, true);
    assert.equal(r.aviso, 'no responde');
  });

  test('cuenta escrituras fallidas y recuerda el último error hasta que va bien', () => {
    const e = new EstadoAlmacen({ tipo: 'upstash' });
    e.anotarError(new Error('se cayó'));
    assert.equal(e.resumen().escriturasFallidas, 1);
    assert.equal(e.resumen().ultimoError, 'se cayó');
    e.anotarOk();
    assert.equal(e.resumen().ultimoError, undefined);
    assert.equal(e.escriturasOk, 1);
  });
});

// ─── crearAlmacen: qué elige según el entorno ─────────────────────────────────

describe('crearAlmacen', () => {
  test('entorno vacío → memoria, sin aviso y sin degradar', async () => {
    const { almacen, estado } = await crearAlmacen({});
    assert.ok(almacen instanceof AlmacenMemoria);
    assert.equal(estado.tipo, 'memoria');
    assert.equal(estado.degradado, false);
    assert.equal(estado.aviso, null);
  });

  test('con URL y token pero sin ALMACEN, elige upstash solo', async () => {
    const { almacen, estado } = await crearAlmacen(
      { UPSTASH_REDIS_REST_URL: 'https://ejemplo.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'tok' },
      { fetchImpl: fetchUpstashFalso() },
    );
    assert.ok(almacen instanceof AlmacenUpstash);
    assert.equal(estado.tipo, 'upstash');
    assert.equal(estado.degradado, false);
  });

  test('ALMACEN=memoria manda: aunque haya URL y token, usa memoria', async () => {
    const { almacen, estado } = await crearAlmacen({
      ALMACEN: 'memoria',
      UPSTASH_REDIS_REST_URL: 'https://ejemplo.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'tok',
    });
    assert.ok(almacen instanceof AlmacenMemoria);
    assert.equal(estado.degradado, false);
  });

  test('ALMACEN respeta mayúsculas y espacios ("  Upstash  ")', async () => {
    const { estado } = await crearAlmacen(
      {
        ALMACEN: '  Upstash  ',
        UPSTASH_REDIS_REST_URL: 'https://ejemplo.upstash.io',
        UPSTASH_REDIS_REST_TOKEN: 'tok',
      },
      { fetchImpl: fetchUpstashFalso() },
    );
    assert.equal(estado.tipo, 'upstash');
  });

  test('ALMACEN_PREFIJO se aplica a las claves', async () => {
    const fetchFalso = fetchUpstashFalso();
    const { almacen } = await crearAlmacen(
      {
        UPSTASH_REDIS_REST_URL: 'https://ejemplo.upstash.io',
        UPSTASH_REDIS_REST_TOKEN: 'tok',
        ALMACEN_PREFIJO: 'mio:',
      },
      { fetchImpl: fetchFalso },
    );
    assert.equal(almacen.claveReal('gas'), 'mio:gas');
  });

  // ── Arranque degradado: el servidor nunca se cae por el almacén ──
  test('ALMACEN=upstash sin variables → memoria degradada, con aviso que las nombra', async () => {
    const { almacen, estado } = await crearAlmacen({ ALMACEN: 'upstash' });
    assert.ok(almacen instanceof AlmacenMemoria);
    assert.equal(estado.tipo, 'memoria');
    assert.equal(estado.degradado, true);
    assert.match(estado.aviso, /UPSTASH_REDIS_REST_URL y UPSTASH_REDIS_REST_TOKEN/);
    assert.match(estado.aviso, /se perderá al reiniciar/);
  });

  test('ALMACEN=upstash sin token → nombra solo el que falta', async () => {
    const { estado } = await crearAlmacen({ ALMACEN: 'upstash', UPSTASH_REDIS_REST_URL: 'https://ejemplo.upstash.io' });
    assert.match(estado.aviso, /UPSTASH_REDIS_REST_TOKEN/);
    assert.ok(!estado.aviso.includes('UPSTASH_REDIS_REST_URL y'), estado.aviso);
  });

  test('Upstash no responde al arrancar → memoria degradada, sin lanzar', async () => {
    const { almacen, estado } = await crearAlmacen(
      { ALMACEN: 'upstash', UPSTASH_REDIS_REST_URL: 'https://ejemplo.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'tok' },
      { fetchImpl: async () => { throw new Error('ECONNREFUSED'); } },
    );
    assert.ok(almacen instanceof AlmacenMemoria);
    assert.equal(estado.degradado, true);
    assert.match(estado.aviso, /no está accesible/);
    // Y el almacén de respaldo funciona igual.
    await almacen.escribir('k', 1);
    assert.equal(await almacen.leer('k'), 1);
  });

  test('token mal copiado → memoria degradada con aviso sobre el token', async () => {
    const { estado } = await crearAlmacen(
      { ALMACEN: 'upstash', UPSTASH_REDIS_REST_URL: 'https://ejemplo.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'malo' },
      { fetchImpl: fetchUpstashFalso({ token: 'bueno' }) },
    );
    assert.equal(estado.tipo, 'memoria');
    assert.match(estado.aviso, /rechazó el token/);
  });

  test('ALMACEN con un valor inventado → memoria degradada y lista de tipos válidos', async () => {
    const { estado } = await crearAlmacen({ ALMACEN: 'postgres' });
    assert.equal(estado.tipo, 'memoria');
    assert.equal(estado.degradado, true);
    assert.match(estado.aviso, /memoria, upstash/);
  });

  test('comprobar:false salta el PING (no toca la red al crear)', async () => {
    let llamadas = 0;
    const { estado } = await crearAlmacen(
      { ALMACEN: 'upstash', UPSTASH_REDIS_REST_URL: 'https://ejemplo.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'tok' },
      { comprobar: false, fetchImpl: async () => { llamadas += 1; return respuesta({ result: 'PONG' }); } },
    );
    assert.equal(estado.tipo, 'upstash');
    assert.equal(llamadas, 0);
  });
});
