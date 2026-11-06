import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { crearApp } from '../src/app.js';
import { RegistroTorre, TOP_TORRE } from '../src/torre.js';
import { levantar, loggerMudo } from './helpers.js';

const CONTRATO = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const JUGADOR = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const dir = (i) => `0x${(i + 1).toString(16).padStart(40, '0')}`;

describe('RegistroTorre', () => {
  test('el récord sube de uno en uno: piso ≤ récord + 1', () => {
    const r = new RegistroTorre();
    assert.deepEqual(r.registrar(JUGADOR, 2, 5), { ok: false, maximo: 1 });
    assert.deepEqual(r.registrar(JUGADOR, 1, 3), { ok: true, record: 1, nuevoRecord: true });
    assert.deepEqual(r.registrar(JUGADOR, 2, 7), { ok: true, record: 2, nuevoRecord: true });
    assert.deepEqual(r.registrar(JUGADOR, 4, 9), { ok: false, maximo: 3 });
    assert.deepEqual(r.registrar(JUGADOR, 1, 2), { ok: true, record: 2, nuevoRecord: false });
    assert.equal(r.record(JUGADOR), 2);
  });
  test('ranking: más piso primero; a igual piso, menos turnos; top 20', () => {
    let t = 0;
    const r = new RegistroTorre({ now: () => t++ });
    for (let i = 0; i < 25; i++) {
      for (let p = 1; p <= (i % 5) + 1; p++) r.registrar(dir(i), p, p * 10 + i);
    }
    const top = r.ranking();
    assert.equal(top.length, TOP_TORRE);
    assert.deepEqual(Object.keys(top[0]).sort(), ['address', 'piso']);
    assert.equal(top[0].piso, 5);
    assert.equal(top[0].address, dir(4)); // piso 5 con menos turnos (54)
    for (let i = 1; i < top.length; i++) assert.ok(top[i - 1].piso >= top[i].piso);
  });
  test('acotado: si se llena, se olvida el peor récord', () => {
    const r = new RegistroTorre({ maxDirecciones: 2 });
    r.registrar(dir(1), 1, 1); r.registrar(dir(1), 2, 2);
    r.registrar(dir(2), 1, 1);
    r.registrar(dir(3), 1, 1); // empata con el peor: no entra
    assert.equal(r.records.size, 2);
    assert.equal(r.record(dir(3)), 0);
  });
});

describe('POST /torre y GET /torre/ranking', () => {
  let srv, reloj;
  const enviar = async (body) => {
    const r = await fetch(`${srv.url}/torre`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: r.status, json: await r.json() };
  };

  beforeEach(async () => {
    reloj = 1_000_000;
    srv = await levantar(crearApp({
      mint: async () => ({ tokenId: 1n, txHash: '0x01' }),
      contractAddress: CONTRATO, chainId: 11155111, now: () => reloj, logger: loggerMudo,
    }));
  });
  afterEach(() => srv.cerrar());

  test('sube piso a piso y aparece en el ranking', async () => {
    for (let p = 1; p <= 3; p++) {
      const r = await enviar({ address: JUGADOR.toLowerCase(), piso: p, turnos: p * 4 });
      assert.equal(r.status, 200);
      assert.deepEqual(r.json, { ok: true, record: p, nuevoRecord: true });
      reloj += 2_000;
    }
    const g = await fetch(`${srv.url}/torre/ranking`);
    assert.equal(g.status, 200);
    assert.deepEqual(await g.json(), [{ address: JUGADOR, piso: 3 }]);
  });

  test('409 si salta más de un piso sobre el récord', async () => {
    const r = await enviar({ address: JUGADOR, piso: 5, turnos: 20 });
    assert.equal(r.status, 409);
    assert.equal(r.json.maximo, 1);
    assert.match(r.json.error, /hasta el piso 1/);
  });

  test('400 con datos inválidos', async () => {
    for (const body of [
      { address: 'x', piso: 1, turnos: 1 },
      { address: JUGADOR, piso: -1, turnos: 1 },
      { address: JUGADOR, piso: 1.5, turnos: 1 },
      { address: JUGADOR, piso: '1', turnos: 1 },
      { address: JUGADOR, piso: 1 },
      { address: JUGADOR, piso: 1, turnos: -3 },
    ]) {
      assert.equal((await enviar(body)).status, 400, JSON.stringify(body));
    }
  });

  test('429: 1 petición cada 2 s por dirección', async () => {
    assert.equal((await enviar({ address: JUGADOR, piso: 1, turnos: 3 })).status, 200);
    const r = await enviar({ address: JUGADOR, piso: 2, turnos: 6 });
    assert.equal(r.status, 429);
    reloj += 2_000;
    assert.equal((await enviar({ address: JUGADOR, piso: 2, turnos: 6 })).status, 200);
  });

  test('piso 0 (cayó en el primer piso) es válido y no entra en el ranking', async () => {
    const r = await enviar({ address: JUGADOR, piso: 0, turnos: 0 });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { ok: true, record: 0, nuevoRecord: false });
    assert.deepEqual(await (await fetch(`${srv.url}/torre/ranking`)).json(), []);
  });

  test('ranking vacío al arrancar', async () => {
    assert.deepEqual(await (await fetch(`${srv.url}/torre/ranking`)).json(), []);
  });
});
