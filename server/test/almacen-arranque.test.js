// Arranque con y sin almacén externo, visto desde fuera (1.4). SIN RED.
//
// Lo que se comprueba:
//   1. `GET /health` cuenta qué almacén hay y si está degradado;
//   2. un servidor "reiniciado" (proceso nuevo, mismo almacén) conserva el estado
//      a través de las rutas HTTP de verdad, no solo de los registros;
//   3. si el almacén externo se cae en caliente, el juego sigue respondiendo 200.
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { parseEther } from 'ethers';
import { crearApp } from '../src/app.js';
import { AlmacenMemoria, crearAlmacen } from '../src/almacen.js';
import { conectarRegistros } from '../src/persistencia.js';
import { RegistroDiario } from '../src/recompensa.js';
import { RegistroGas } from '../src/gas.js';
import { RegistroTorre } from '../src/torre.js';
import { EstadoBotin, RegistroPrimerBotin } from '../src/loot.js';
import { levantar, loggerMudo } from './helpers.js';

const CONTRATO = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const JUGADOR = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const OTRO = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';

/**
 * Levanta un servidor completo (como hace `index.js`) sobre el almacén dado.
 * Devuelve también `vaciarTodo` para simular un cierre limpio.
 */
async function arrancar({ env = {}, almacen: almacenDado = null, fetchImpl, now = () => Date.parse('2026-11-06T12:00:00Z') } = {}) {
  let almacen = almacenDado;
  let estadoAlmacen;
  if (almacen) {
    ({ estado: estadoAlmacen } = await crearAlmacen({ ALMACEN: 'memoria' }));
  } else {
    ({ almacen, estado: estadoAlmacen } = await crearAlmacen(env, { fetchImpl }));
  }

  const registros = {
    diario: new RegistroDiario(),
    primerBotin: new RegistroPrimerBotin(),
    gas: new RegistroGas({ topeDiario: parseEther('0.01') }),
    torre: new RegistroTorre({ now }),
    botin: new EstadoBotin(),
  };
  const { vaciarTodo, restaurados } = await conectarRegistros({
    almacen, registros, estado: estadoAlmacen, logger: loggerMudo, retardoMs: 10_000,
  });

  const app = crearApp({
    mint: async () => ({ tokenId: 1n, txHash: `0x${'ab'.repeat(32)}` }),
    contractAddress: CONTRATO,
    chainId: 11155111,
    now,
    logger: loggerMudo,
    estadoAlmacen,
    registroDiario: registros.diario,
    registroPrimerBotin: registros.primerBotin,
    registroGas: registros.gas,
    registroTorre: registros.torre,
    estadoBotin: registros.botin,
  });

  const srv = await levantar(app);
  return { ...srv, almacen, estadoAlmacen, registros, vaciarTodo, restaurados };
}

const pedir = async (url, ruta, body) => {
  const r = await fetch(`${url}${ruta}`, body === undefined ? undefined : {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json() };
};

/** `fetch` falso de Upstash sobre un Map, para los tests de arranque correcto. */
function upstashFalso(datos = new Map()) {
  const impl = async (url, opciones = {}) => {
    const ruta = new URL(url).pathname;
    const [, comando, clave] = ruta.split('/');
    const json = (result) => ({ ok: true, status: 200, json: async () => ({ result }) });
    if (comando === 'ping') return json('PONG');
    if (comando === 'get') return json(datos.get(decodeURIComponent(clave)) ?? null);
    if (comando === 'set') { datos.set(decodeURIComponent(clave), opciones.body); return json('OK'); }
    if (comando === 'del') { datos.delete(decodeURIComponent(clave)); return json(1); }
    return { ok: false, status: 400, json: async () => ({ error: 'ERR' }) };
  };
  impl.datos = datos;
  return impl;
}

describe('GET /health informa del almacén', () => {
  let srv;
  afterEach(async () => { await srv?.cerrar(); srv = null; });

  test('sin variables: memoria, no persistente, no degradado', async () => {
    srv = await arrancar();
    const { status, json } = await pedir(srv.url, '/health');
    assert.equal(status, 200);
    assert.deepEqual(json.almacen, { tipo: 'memoria', persistente: false, degradado: false });
  });

  test('con Upstash accesible: persistente y sin degradar', async () => {
    srv = await arrancar({
      env: { ALMACEN: 'upstash', UPSTASH_REDIS_REST_URL: 'https://x.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'tok' },
      fetchImpl: upstashFalso(),
    });
    assert.deepEqual((await pedir(srv.url, '/health')).json.almacen,
      { tipo: 'upstash', persistente: true, degradado: false });
  });

  test('ARRANQUE DEGRADADO: Upstash caído → el servidor arranca y /health lo dice', async () => {
    srv = await arrancar({
      env: { ALMACEN: 'upstash', UPSTASH_REDIS_REST_URL: 'https://x.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'tok' },
      fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
    });
    const { status, json } = await pedir(srv.url, '/health');
    assert.equal(status, 200, 'el servidor NO se cae por el almacén');
    assert.equal(json.ok, true);
    assert.equal(json.almacen.tipo, 'memoria');
    assert.equal(json.almacen.degradado, true);
    assert.match(json.almacen.aviso, /no está accesible/);
    assert.match(json.almacen.aviso, /se perderá al reiniciar/);
  });

  test('ARRANQUE DEGRADADO: faltan las variables → el servidor arranca y lo dice', async () => {
    srv = await arrancar({ env: { ALMACEN: 'upstash' } });
    const { json } = await pedir(srv.url, '/health');
    assert.equal(json.almacen.degradado, true);
    assert.match(json.almacen.aviso, /UPSTASH_REDIS_REST_URL/);
  });

  test('degradado o no, el juego responde igual', async () => {
    srv = await arrancar({
      env: { ALMACEN: 'upstash', UPSTASH_REDIS_REST_URL: 'https://x.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'tok' },
      fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
    });
    const r = await pedir(srv.url, '/torre', { address: JUGADOR, piso: 1, turnos: 4 });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { ok: true, record: 1, nuevoRecord: true });
  });

  test('el almacén no filtra el token en /health', async () => {
    srv = await arrancar({
      env: { ALMACEN: 'upstash', UPSTASH_REDIS_REST_URL: 'https://x.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'secreto-no-publicar' },
      fetchImpl: upstashFalso(),
    });
    const texto = JSON.stringify((await pedir(srv.url, '/health')).json);
    assert.ok(!texto.includes('secreto-no-publicar'), texto);
  });
});

describe('Reinicio del servidor a través de las rutas HTTP', () => {
  let srv;
  afterEach(async () => { await srv?.cerrar(); srv = null; });

  test('el récord de la torre sobrevive al reinicio (y el ranking con él)', async () => {
    const almacen = new AlmacenMemoria();
    // Reloj que avanza: `POST /torre` admite 1 petición cada 2 s por dirección.
    let reloj = Date.parse('2026-11-06T12:00:00Z');
    const now = () => reloj;

    // ── Primera vida: el jugador sube tres pisos ──
    srv = await arrancar({ almacen, now });
    for (const piso of [1, 2, 3]) {
      const r = await pedir(srv.url, '/torre', { address: JUGADOR, piso, turnos: piso * 2 });
      assert.equal(r.status, 200);
      reloj += 3000;
    }
    await srv.vaciarTodo();
    await srv.cerrar();

    // ── Render reinicia: proceso nuevo, mismo almacén ──
    srv = await arrancar({ almacen, now });
    assert.ok(srv.restaurados.includes('torre'));
    assert.deepEqual((await pedir(srv.url, '/torre/ranking')).json, [{ address: JUGADOR, piso: 3 }]);
    // Y la defensa antitrampas usa el récord recuperado, no empieza de cero.
    const salto = await pedir(srv.url, '/torre', { address: JUGADOR, piso: 9, turnos: 1 });
    assert.equal(salto.status, 409);
    assert.equal(salto.json.maximo, 4);
  });

  test('sin almacén persistente, el reinicio vacía el ranking (comportamiento anterior)', async () => {
    srv = await arrancar();
    await pedir(srv.url, '/torre', { address: JUGADOR, piso: 1, turnos: 2 });
    await srv.cerrar();

    srv = await arrancar(); // almacén nuevo, como un proceso nuevo sin persistencia
    assert.deepEqual((await pedir(srv.url, '/torre/ranking')).json, []);
  });

  test('el estado de la racha diaria sobrevive al reinicio', async () => {
    const almacen = new AlmacenMemoria();
    const ahora = Date.parse('2026-11-06T12:00:00Z');

    // ── Primera vida: se escribe en el registro como lo hace `POST /recompensa`
    // tras pagar el ORO (no hace falta levantar el servidor para esto). ──
    const diarioAntes = new RegistroDiario();
    const { vaciarTodo } = await conectarRegistros({
      almacen, registros: { diario: diarioAntes }, logger: loggerMudo, retardoMs: 10_000,
    });
    diarioAntes.registrar(JUGADOR, 2, '2026-11-06');
    await vaciarTodo();

    // ── Render reinicia: registro nuevo, mismo almacén, y se consulta por HTTP ──
    const diarioDespues = new RegistroDiario();
    await conectarRegistros({
      almacen, registros: { diario: diarioDespues }, logger: loggerMudo, retardoMs: 0,
    });
    srv = await levantar(crearApp({
      mint: async () => ({ tokenId: 1n, txHash: '0x' }),
      contractAddress: CONTRATO, chainId: 11155111, now: () => ahora, logger: loggerMudo,
      pagarRecompensa: async () => ({ txHash: '0x' }),
      registroDiario: diarioDespues,
    }));

    const { json } = await pedir(srv.url, `/recompensa/diaria/${JUGADOR}`);
    assert.equal(json.racha, 2, 'la racha no se reinicia');
    assert.equal(json.puedeReclamar, false, 'no cobra dos veces el mismo día');
    assert.equal(json.dia, 3);
    assert.ok(json.proximoEn > 0, 'y sigue habiendo cuenta atrás hasta mañana');
  });

  test('dos servidores con prefijos distintos no se pisan en la misma base', async () => {
    const datos = new Map();
    const comun = {
      env: { ALMACEN: 'upstash', UPSTASH_REDIS_REST_URL: 'https://x.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'tok' },
      fetchImpl: upstashFalso(datos),
    };
    const a = await arrancar({ ...comun, env: { ...comun.env, ALMACEN_PREFIJO: 'pruebas:' } });
    const b = await arrancar({ ...comun, env: { ...comun.env, ALMACEN_PREFIJO: 'produccion:' } });
    try {
      await pedir(a.url, '/torre', { address: JUGADOR, piso: 1, turnos: 2 });
      await pedir(b.url, '/torre', { address: OTRO, piso: 1, turnos: 2 });
      await a.vaciarTodo();
      await b.vaciarTodo();
      assert.ok(datos.has('pruebas:torre'));
      assert.ok(datos.has('produccion:torre'));
      assert.deepEqual((await pedir(a.url, '/torre/ranking')).json, [{ address: JUGADOR, piso: 1 }]);
      assert.deepEqual((await pedir(b.url, '/torre/ranking')).json, [{ address: OTRO, piso: 1 }]);
    } finally {
      await a.cerrar();
      await b.cerrar();
    }
  });
});

describe('El almacén se cae estando el servidor en marcha', () => {
  let srv;
  afterEach(async () => { await srv?.cerrar(); srv = null; });

  test('las rutas siguen dando 200 y /health acaba contando el fallo', async () => {
    let enPie = true;
    const datos = new Map();
    const base = upstashFalso(datos);
    srv = await arrancar({
      env: { ALMACEN: 'upstash', UPSTASH_REDIS_REST_URL: 'https://x.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'tok' },
      fetchImpl: async (url, opciones) => {
        if (!enPie) throw new Error('ECONNRESET');
        return base(url, opciones);
      },
    });
    assert.equal((await pedir(srv.url, '/health')).json.almacen.degradado, false);

    enPie = false; // Upstash se cae a mitad de partida
    const r = await pedir(srv.url, '/torre', { address: JUGADOR, piso: 1, turnos: 2 });
    assert.equal(r.status, 200, 'el jugador no nota nada');
    await srv.vaciarTodo(); // fuerza el guardado pendiente, que fallará

    const { json } = await pedir(srv.url, '/health');
    assert.equal(json.ok, true);
    assert.equal(json.almacen.escriturasFallidas, 1);
    assert.match(json.almacen.ultimoError, /ECONNRESET|no está accesible/);

    enPie = true; // vuelve: el cambio pendiente se escribe y el error se limpia
    srv.registros.torre.registrar(JUGADOR, 2, 3);
    await srv.vaciarTodo();
    assert.equal((await pedir(srv.url, '/health')).json.almacen.ultimoError, undefined);
    assert.ok(datos.has('loot-arena:torre'));
  });
});
