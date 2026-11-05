import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { crearApp, validarDireccion, validarNivel, validarJefe } from '../src/app.js';
import { EstadoBotin, PITY_UMBRAL } from '../src/loot.js';
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
  test('jefe: booleano opcional, por defecto false', () => {
    assert.equal(validarJefe(undefined), false);
    assert.equal(validarJefe(false), false);
    assert.equal(validarJefe(true), true);
    for (const v of [null, 'true', 1, 0, {}, [], 'si']) assert.equal(validarJefe(v), null, String(v));
  });
});

describe('API HTTP (contrato simulado, sin red)', () => {
  let srv, reloj, rngValor, mints, mintFalla, estadoBotin;

  beforeEach(async () => {
    reloj = 1_000_000;
    rngValor = 0;            // 0 → siempre hay drop (Común, Espada)
    mints = [];
    mintFalla = null;
    estadoBotin = new EstadoBotin();
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
      estadoBotin,
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

  test('jefe: true → siempre hay drop (aunque el RNG diga que no) con la misma forma de respuesta', async () => {
    rngValor = 0.99;
    const r = await post(srv.url, { address: JUGADOR, enemyLevel: 10, jefe: true });
    assert.equal(r.status, 200);
    assert.equal(r.json.drop, true);
    assert.deepEqual(Object.keys(r.json).sort(), ['drop', 'item', 'tokenId', 'txHash']);
    assert.deepEqual(Object.keys(r.json.item).sort(), ['ataque', 'defensa', 'nombre', 'rareza', 'tipo']);
    assert.equal(r.json.item.rareza, 2); // rng 0.99 con jefe nivel 10 → Legendario (20 %)
    assert.ok(r.json.item.nombre.length <= 60);
    assert.equal(mints.length, 1);
  });

  test('jefe: false explícito se comporta como sin jefe', async () => {
    rngValor = 0.99;
    const r = await post(srv.url, { address: JUGADOR, jefe: false });
    assert.deepEqual(r.json, { drop: false });
  });

  test('400 si jefe no es booleano (y no se acuña ni consume el límite por dirección)', async () => {
    for (const jefe of ['true', 1, null, {}, []]) {
      const r = await post(srv.url, { address: JUGADOR, jefe });
      assert.equal(r.status, 400, JSON.stringify(jefe));
      assert.deepEqual(r.json, { error: 'jefe debe ser un booleano' });
    }
    assert.equal(mints.length, 0);
    assert.equal((await post(srv.url, { address: JUGADOR, jefe: true })).status, 200);
  });

  test('pity: el contador por dirección sube con cada drop entregado y no si el mint falla', async () => {
    rngValor = 0; // siempre drop Común
    assert.equal((await post(srv.url, { address: JUGADOR })).status, 200);
    assert.equal(estadoBotin.sinLegendario(JUGADOR), 1);
    reloj += 10_001;
    mintFalla = new Error('boom');
    assert.equal((await post(srv.url, { address: JUGADOR })).status, 500);
    assert.equal(estadoBotin.sinLegendario(JUGADOR), 1);
    // Con el pity al máximo, el servidor entrega un Legendario y reinicia el contador
    mintFalla = null;
    estadoBotin.contadores.set(JUGADOR, PITY_UMBRAL + 5);
    reloj += 10_001;
    const r = await post(srv.url, { address: JUGADOR });
    assert.equal(r.json.item.rareza, 2);
    assert.equal(estadoBotin.sinLegendario(JUGADOR), 0);
    assert.equal(estadoBotin.ultimoLegendario, r.json.item.nombre);
    // El siguiente legendario (mismo RNG) no repite nombre
    estadoBotin.contadores.set(JUGADOR, PITY_UMBRAL + 5);
    reloj += 10_001;
    const r2 = await post(srv.url, { address: JUGADOR });
    assert.equal(r2.json.item.rareza, 2);
    assert.notEqual(r2.json.item.nombre, r.json.item.nombre);
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

describe('1.2: GET /ranking y POST /recompensa', () => {
  const B = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
  let srv, reloj, pagos, pagoFalla, rankingFalso, opciones;
  const HOY = Date.UTC(2026, 10, 5, 12);

  const arrancar = async (extra = {}) => {
    srv = await levantar(crearApp({
      mint: async () => ({ tokenId: 1n, txHash: '0x' + 'cd'.repeat(32) }),
      contractAddress: CONTRATO, chainId: 11155111, rng: () => 0.99, now: () => reloj, logger: loggerMudo,
      ...opciones, ...extra,
    }));
  };

  beforeEach(() => {
    reloj = HOY;
    pagos = [];
    pagoFalla = null;
    rankingFalso = {
      actualizado: HOY,
      pagados: new Set(),
      ranking: () => ({
        actualizado: new Date(HOY).toISOString(), bloque: 7000000, sincronizado: true,
        categorias: { objetos: [{ address: JUGADOR, valor: 12 }], legendarios: [], oroVentas: [], rachaDiaria: [] },
      }),
      posicion: (a) => ({ address: a, posiciones: { objetos: { posicion: 1, valor: 12, participantes: 1 } } }),
      yaRecompensado(a, m) { return this.pagados.has(`${a}|${m}`); },
    };
    opciones = {
      ranking: rankingFalso,
      pagarRecompensa: async (to, cantidad, motivo) => {
        if (pagoFalla) throw pagoFalla;
        pagos.push({ to, cantidad, motivo });
        return { txHash: '0x' + 'ef'.repeat(32) };
      },
    };
  });
  afterEach(() => srv?.cerrar());

  const postRec = (body) => fetch(`${srv.url}/recompensa`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, json: await r.json() }));

  test('503 en /ranking y /recompensa si faltan variables, y /ganar sigue funcionando', async () => {
    await arrancar({ ranking: null, pagarRecompensa: null, rankingNoDisponible: 'Ranking no disponible: el servidor no tiene configurado DEPLOY_BLOCK' });
    let r = await fetch(`${srv.url}/ranking`);
    assert.equal(r.status, 503);
    assert.deepEqual(await r.json(), { error: 'Ranking no disponible: el servidor no tiene configurado DEPLOY_BLOCK' });
    r = await fetch(`${srv.url}/ranking/${JUGADOR}`);
    assert.equal(r.status, 503);
    const rr = await fetch(`${srv.url}/recompensa`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: JUGADOR, motivo: 'pase10' }) });
    assert.equal(rr.status, 503);
    assert.match((await rr.json()).error, /Recompensas no disponibles/);
    const g = await post(srv.url, { address: JUGADOR });
    assert.equal(g.status, 200);
    assert.deepEqual(g.json, { drop: false });
  });

  test('GET /ranking: 503 mientras se genera, luego 200 con la forma documentada', async () => {
    await arrancar();
    rankingFalso.actualizado = null;
    let r = await fetch(`${srv.url}/ranking`);
    assert.equal(r.status, 503);
    assert.equal(r.headers.get('retry-after'), '30');
    rankingFalso.actualizado = HOY;
    r = await fetch(`${srv.url}/ranking`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'public, max-age=30');
    const j = await r.json();
    assert.deepEqual(Object.keys(j.categorias), ['objetos', 'legendarios', 'oroVentas', 'rachaDiaria']);
    assert.equal(j.actualizado, '2026-11-05T12:00:00.000Z');
  });

  test('GET /ranking/:address normaliza y valida la dirección', async () => {
    await arrancar();
    let r = await fetch(`${srv.url}/ranking/${JUGADOR.toLowerCase()}`);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).address, JUGADOR);
    r = await fetch(`${srv.url}/ranking/nope`);
    assert.equal(r.status, 400);
    assert.deepEqual(await r.json(), { error: 'Dirección inválida' });
  });

  test('POST /recompensa paga la cantidad fija con el motivo on-chain y la forma documentada', async () => {
    await arrancar();
    const r = await postRec({ address: JUGADOR.toLowerCase(), motivo: 'pase20' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { ok: true, motivo: 'pase20', periodo: 'T1', oro: 200, txHash: '0x' + 'ef'.repeat(32) });
    assert.deepEqual(pagos, [{ to: JUGADOR, cantidad: 200n * 10n ** 18n, motivo: 'pase20@T1' }]);
  });

  test('POST /recompensa: 400 por dirección o motivo inválidos', async () => {
    await arrancar();
    let r = await postRec({ address: 'x', motivo: 'pase10' });
    assert.equal(r.status, 400);
    r = await postRec({ address: JUGADOR, motivo: 'pase99' });
    assert.equal(r.status, 400);
    assert.deepEqual(r.json, { error: 'motivo debe ser uno de: pase10, pase20, pase30, misiones_diarias' });
    assert.equal(pagos.length, 0);
  });

  test('POST /recompensa: reclamo único (409), también si ya está pagado on-chain', async () => {
    await arrancar();
    assert.equal((await postRec({ address: JUGADOR, motivo: 'misiones_diarias' })).status, 200);
    reloj += 11_000;
    const r = await postRec({ address: JUGADOR, motivo: 'misiones_diarias' });
    assert.equal(r.status, 409);
    assert.deepEqual(r.json, { error: 'Ya has reclamado esta recompensa', motivo: 'misiones_diarias', periodo: '2026-11-05' });
    reloj += 24 * 3600 * 1000; // mañana sí
    assert.equal((await postRec({ address: JUGADOR, motivo: 'misiones_diarias' })).status, 200);
    // Pagado on-chain antes de un reinicio (lo sabe el indexador): 409 sin pagar
    rankingFalso.pagados.add(`${B}|pase10@T1`);
    const r2 = await postRec({ address: B, motivo: 'pase10' });
    assert.equal(r2.status, 409);
    assert.equal(pagos.length, 2);
  });

  test('POST /recompensa: 1 cada 10 s por dirección (429)', async () => {
    await arrancar();
    assert.equal((await postRec({ address: JUGADOR, motivo: 'pase10' })).status, 200);
    const r = await postRec({ address: JUGADOR, motivo: 'pase20' });
    assert.equal(r.status, 429);
  });

  test('POST /recompensa: si el pago falla se puede reintentar; tope on-chain → 409', async () => {
    await arrancar();
    pagoFalla = Object.assign(new Error('x'), { code: 'NETWORK_ERROR' });
    let r = await postRec({ address: JUGADOR, motivo: 'pase30' });
    assert.equal(r.status, 500);
    assert.deepEqual(r.json, { error: 'No se pudo conectar con la red Ethereum' });
    reloj += 11_000;
    pagoFalla = Object.assign(new Error('tope'), { code: 'CALL_EXCEPTION', revert: { name: 'TopeJugadorSuperado' } });
    r = await postRec({ address: JUGADOR, motivo: 'pase30' });
    assert.equal(r.status, 409);
    assert.match(r.json.error, /tope diario/);
    reloj += 11_000;
    pagoFalla = Object.assign(new Error('global'), { code: 'CALL_EXCEPTION', revert: { name: 'TopeGlobalSuperado' } });
    r = await postRec({ address: JUGADOR, motivo: 'pase30' });
    assert.equal(r.status, 409);
    assert.match(r.json.error, /para todos/);
    reloj += 11_000;
    pagoFalla = null;
    assert.equal((await postRec({ address: JUGADOR, motivo: 'pase30' })).status, 200);
  });
});
