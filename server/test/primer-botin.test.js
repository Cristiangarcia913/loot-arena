import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { crearApp } from '../src/app.js';
import { tirarPrimerBotin, RegistroPrimerBotin, RAREZA } from '../src/loot.js';
import { levantar, post, rngSemilla, loggerMudo } from './helpers.js';

const CONTRATO = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const JUGADOR = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const OTRO = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';

describe('tirarPrimerBotin', () => {
  test('siempre Raro, con cualquier RNG, nivel o jefe', () => {
    const rng = rngSemilla(7);
    for (let i = 0; i < 300; i++) {
      const item = tirarPrimerBotin(rng, { nivel: (i % 10) + 1, jefe: i % 3 === 0, dropChance: 0 });
      assert.equal(item.rareza, RAREZA.RARO);
      assert.ok(item.nombre.length > 0 && item.nombre.length <= 60);
    }
  });
  test('RegistroPrimerBotin: reservar/confirmar/liberar', () => {
    const r = new RegistroPrimerBotin();
    assert.equal(r.reservar(JUGADOR), true);
    assert.equal(r.reservar(JUGADOR), false); // en vuelo
    r.liberar(JUGADOR);
    assert.equal(r.reservar(JUGADOR), true);
    r.confirmar(JUGADOR);
    assert.equal(r.reservar(JUGADOR), false);
    assert.equal(r.yaEntregado(JUGADOR), true);
  });
});

describe('POST /ganar: la primera victoria suelta un Raro', () => {
  let srv, reloj, rngValor, mints, mintFalla;
  beforeEach(async () => {
    reloj = 1_000_000; rngValor = 0.99; mints = []; mintFalla = null;
    srv = await levantar(crearApp({
      mint: async (to, item) => {
        if (mintFalla) throw mintFalla;
        mints.push({ to, item });
        return { tokenId: BigInt(mints.length), txHash: `0x${'ab'.repeat(32)}` };
      },
      contractAddress: CONTRATO, chainId: 11155111,
      rng: () => rngValor, now: () => reloj, logger: loggerMudo,
    }));
  });
  afterEach(() => srv.cerrar());

  test('primera victoria: drop Raro aunque el RNG diga "sin drop"; luego, tirada normal', async () => {
    const r = await post(srv.url, { address: JUGADOR });
    assert.equal(r.status, 200);
    assert.equal(r.json.drop, true);
    assert.equal(r.json.primerBotin, true);
    assert.equal(r.json.item.rareza, RAREZA.RARO);
    reloj += 10_000;
    assert.deepEqual((await post(srv.url, { address: JUGADOR })).json, { drop: false });
    // Otra dirección también tiene su primer botín
    assert.equal((await post(srv.url, { address: OTRO })).json.primerBotin, true);
  });

  test('si el mint falla, la siguiente victoria sigue siendo el primer botín', async () => {
    mintFalla = Object.assign(new Error('x'), { code: 'NETWORK_ERROR' });
    assert.equal((await post(srv.url, { address: JUGADOR })).status, 500);
    mintFalla = null;
    reloj += 10_000;
    const r = await post(srv.url, { address: JUGADOR });
    assert.equal(r.json.primerBotin, true);
    assert.equal(r.json.item.rareza, RAREZA.RARO);
  });
});
