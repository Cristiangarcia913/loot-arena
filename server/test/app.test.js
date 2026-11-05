import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { crearApp, validarDireccion, validarNivel } from '../src/app.js';
import { levantar, post, rngFijo, loggerMudo } from './helpers.js';

const CONTRATO = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const JUGADOR = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const otraDir = (i) => `0x${(i + 1).toString(16).padStart(40, '0')}`;

describe('validarDireccion / validarNivel', () => {
  test('acepta checksum y minúsculas, normaliza a checksum', () => {
    assert.equal(validarDireccion(JUGADOR), JUGADOR);
    assert.equal(validarDireccion(JUGADOR.toLowerCase()), JUGADOR);
    assert.equal(validarDireccion(`  ${JUGADOR}  `), JUGADOR);
  });
  test('rechaza basura, checksum incorrecto, dirección cero y no-strings', () => {
    for (const v of [undefined, null, '', 'hola', '0x123', 123, {}, [],
      '0x70997970c51812dc3a010c7d01b50e0d17dc79C8', // mayúscula suelta = checksum inválido
      '0x0000000000000000000000000000000000000000',
      `${JUGADOR}00`]) {
      assert.equal(validarDireccion(v), null, String(v));
    }
  });
  test('enemyLevel: 1..10 entero, por defecto 1', () => {
    assert.equal(validarNivel(undefined), 1);
    assert.equal(validarNivel(null), 1);
    assert.equal(validarNivel(1), 1);
    assert.equal(validarNivel(10), 10);
    for (const v of [0, 11, 2.5, '3', -1, NaN, true]) assert.equal(validarNivel(v), null, String(v));
  });
});

describe('API HTTP (contrato simulado, sin red)', () => {
  let srv, reloj, rngValor, mints, mintFalla;

  beforeEach(async () => {
    reloj = 1_000_000;
    rngValor = 0;            // 0 → siempre hay drop (Común, Espada)
    mints = [];
    mintFalla = null;
    const app = crearApp({
      mint: async (to, item) => {
        if (mintFalla) throw mintFalla;
        mints.push({ to, item });
        return { tokenId: BigInt(mints.length), txHash: `0x${'ab'.repeat(32)}` };
      },
      contractAddress: CONTRATO,
      chainId: 11155111,
      rng: () => rngValor,
      now: () => reloj,
      logger: loggerMudo,
    });
    srv = await levantar(app);
  });
  afterEach(() => srv.cerrar());

  test('GET /health', async () => {
    const r = await fetch(`${srv.url}/health`);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, contract: CONTRATO, chainId: 11155111 });
  });

  test('200 con drop: formato exacto de SPEC.md y mint a la dirección normalizada', async () => {
    const r = await post(srv.url, { address: JUGADOR.toLowerCase(), enemyLevel: 3 });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, {
      drop: true,
      tokenId: '1',
      txHash: `0x${'ab'.repeat(32)}`,
      item: { nombre: 'Espada Oxidada', tipo: 'Espada', rareza: 0, ataque: 1, defensa: 0 },
    });
    assert.equal(typeof r.json.tokenId, 'string');
    assert.equal(mints.length, 1);
    assert.equal(mints[0].to, JUGADOR);
  });

  test('200 sin drop: { drop: false } y no se acuña nada', async () => {
    rngValor = 0.99;
    const r = await post(srv.url, { address: JUGADOR });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { drop: false });
    assert.equal(mints.length, 0);
  });

  test('400 dirección inválida / cero / ausente', async () => {
    for (const body of [{}, { address: 'nope' }, { address: '0x0000000000000000000000000000000000000000' }, { address: 42 }]) {
      const r = await post(srv.url, body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.deepEqual(r.json, { error: 'Dirección inválida' });
    }
    assert.equal(mints.length, 0);
  });

  test('400 enemyLevel fuera de rango', async () => {
    const r = await post(srv.url, { address: JUGADOR, enemyLevel: 11 });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /enemyLevel/);
  });

  test('400 JSON mal formado', async () => {
    const r = await post(srv.url, '{no es json');
    assert.equal(r.status, 400);
    assert.deepEqual(r.json, { error: 'JSON inválido' });
  });

  test('429: 1 petición cada 10 s por dirección', async () => {
    assert.equal((await post(srv.url, { address: JUGADOR })).status, 200);
    reloj += 4_000;
    const r = await post(srv.url, { address: JUGADOR.toLowerCase() }); // misma dirección normalizada
    assert.equal(r.status, 429);
    assert.deepEqual(r.json, { error: 'Demasiadas peticiones, espera 6 s' });
    assert.equal(r.headers.get('retry-after'), '6');
    reloj += 6_001;
    assert.equal((await post(srv.url, { address: JUGADOR })).status, 200);
    assert.equal(mints.length, 2);
  });

  test('429: 30 peticiones por hora por IP', async () => {
    rngValor = 0.99; // sin drops para ir rápido
    for (let i = 0; i < 30; i++) {
      const r = await post(srv.url, { address: otraDir(i) });
      assert.equal(r.status, 200, `petición ${i + 1}`);
      reloj += 1_000;
    }
    const r = await post(srv.url, { address: otraDir(99) });
    assert.equal(r.status, 429);
    assert.match(r.json.error, /^Demasiadas peticiones, espera \d+ s$/);
    const espera = Number(r.json.error.match(/\d+/)[0]);
    assert.ok(espera > 3500 && espera <= 3600, `espera ${espera}`);
    reloj += 3600 * 1000;
    assert.equal((await post(srv.url, { address: otraDir(100) })).status, 200);
  });

  test('500 si el mint falla, con mensaje legible', async () => {
    mintFalla = Object.assign(new Error('insufficient funds'), { code: 'INSUFFICIENT_FUNDS' });
    const r = await post(srv.url, { address: JUGADOR });
    assert.equal(r.status, 500);
    assert.deepEqual(r.json, { error: 'El servidor no tiene ETH suficiente para pagar el gas' });
  });

  test('CORS: responde con Access-Control-Allow-Origin', async () => {
    const r = await fetch(`${srv.url}/health`, { headers: { origin: 'https://ejemplo.com' } });
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
  });

  test('404 en rutas desconocidas', async () => {
    const r = await fetch(`${srv.url}/nada`);
    assert.equal(r.status, 404);
  });
});
