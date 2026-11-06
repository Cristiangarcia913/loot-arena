import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { parseUnits, parseEther } from 'ethers';
import {
  MOTIVOS, LISTA_MOTIVOS, INICIO_TEMPORADAS, DURACION_TEMPORADA_MS, diaUtc, numeroTemporada, periodoDe,
  motivoOnchain, cantidadWei, validarMotivo, RegistroRecompensas,
  TABLA_DIARIA, BONUS_DIA7, MOTIVO_DIARIA, MOTIVO_BONUS_DIA7, diaCiclo, rachaVigente, segundosHastaManana,
} from '../src/recompensa.js';
import { crearApp } from '../src/app.js';
import { levantar, loggerMudo } from './helpers.js';

const A = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const B = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
const HOY = Date.UTC(2026, 10, 5, 12);
const DIA = 24 * 60 * 60 * 1000;

test('motivos y cantidades fijas: 100/200/400 y 25 ORO (18 decimales)', () => {
  assert.deepEqual(LISTA_MOTIVOS, ['pase10', 'pase20', 'pase30', 'misiones_diarias']);
  assert.deepEqual(LISTA_MOTIVOS.map((m) => MOTIVOS[m].oro), [100, 200, 400, 25]);
  assert.equal(cantidadWei('pase30'), parseUnits('400', 18));
  assert.equal(cantidadWei('misiones_diarias'), 25n * 10n ** 18n);
});

test('validarMotivo', () => {
  for (const m of LISTA_MOTIVOS) assert.equal(validarMotivo(m), m);
  for (const v of [undefined, null, '', 'pase40', 'PASE10', 1, {}, 'toString', '__proto__']) assert.equal(validarMotivo(v), null, String(v));
});

test('periodos: día UTC y temporadas de 4 semanas desde el inicio', () => {
  assert.equal(diaUtc(HOY), '2026-11-05');
  assert.equal(diaUtc(Date.UTC(2026, 10, 5, 23, 59, 59)), '2026-11-05');
  assert.equal(numeroTemporada(INICIO_TEMPORADAS), 1);
  assert.equal(numeroTemporada(INICIO_TEMPORADAS - 1), 0);
  assert.equal(numeroTemporada(INICIO_TEMPORADAS + DURACION_TEMPORADA_MS - 1), 1);
  assert.equal(numeroTemporada(INICIO_TEMPORADAS + DURACION_TEMPORADA_MS), 2);
  assert.equal(periodoDe('pase10', HOY), 'T1');
  assert.equal(periodoDe('misiones_diarias', HOY), '2026-11-05');
  assert.equal(periodoDe('pase10', HOY, Date.UTC(2026, 0, 1)), 'T12');
  assert.equal(motivoOnchain('pase20', 'T1'), 'pase20@T1');
  assert.throws(() => periodoDe('x', HOY), /Motivo desconocido/);
});

test('reclamo único por motivo y periodo; por dirección', () => {
  const r = new RegistroRecompensas();
  const res = r.reservar(A, 'pase10', HOY);
  assert.equal(res.ok, true);
  assert.equal(res.motivoOnchain, 'pase10@T1');
  r.confirmar(res);
  assert.deepEqual(r.reservar(A, 'pase10', HOY + DIA), { ok: false, motivo: 'duplicado' }); // misma temporada
  assert.equal(r.reservar(B, 'pase10', HOY).ok, true);
  assert.equal(r.reservar(A, 'pase10', HOY + DURACION_TEMPORADA_MS).ok, true); // temporada siguiente

  const m = r.reservar(A, 'misiones_diarias', HOY);
  r.confirmar(m);
  assert.deepEqual(r.reservar(A, 'misiones_diarias', HOY + 1000), { ok: false, motivo: 'duplicado' });
  assert.equal(r.reservar(A, 'misiones_diarias', HOY + DIA).ok, true); // otro día
});

test('una reserva pendiente bloquea un segundo reclamo simultáneo; liberar la deshace', () => {
  const r = new RegistroRecompensas();
  const res = r.reservar(A, 'pase20', HOY);
  assert.equal(r.reservar(A, 'pase20', HOY).motivo, 'duplicado');
  r.liberar(res);
  assert.equal(r.reservar(A, 'pase20', HOY).ok, true);
});

test('límite de reclamos por dirección y día', () => {
  const r = new RegistroRecompensas({ maxPorDia: 2 });
  assert.equal(r.reservar(A, 'pase10', HOY).ok, true);
  assert.equal(r.reservar(A, 'pase20', HOY).ok, true);
  assert.deepEqual(r.reservar(A, 'pase30', HOY), { ok: false, motivo: 'limite_diario' });
  assert.equal(r.reservar(B, 'pase30', HOY).ok, true);
  assert.equal(r.reservar(A, 'pase30', HOY + DIA).ok, true); // al día siguiente
});

test('al cambiar de día se olvidan los contadores y los reclamos diarios viejos', () => {
  const r = new RegistroRecompensas();
  r.confirmar(r.reservar(A, 'misiones_diarias', HOY));
  r.confirmar(r.reservar(A, 'pase10', HOY));
  r.reservar(B, 'pase20', HOY + DIA);
  assert.ok(![...r.reclamos.keys()].some((k) => k.includes('2026-11-05')));
  assert.ok(r.reclamos.has(`${A}|pase10@T1`)); // las de temporada se mantienen
  assert.ok(![...r.porDia.keys()].some((k) => k.endsWith('2026-11-05')));
});

// ── Racha diaria (motivo "diaria") ────────────────────────────────────────────

const DIA_MS = 24 * 60 * 60 * 1000;
const ORO = (n) => BigInt(n) * 10n ** 18n;

test('tabla diaria y ciclo de 7 días, igual que el contrato', () => {
  assert.deepEqual([...TABLA_DIARIA], [10, 15, 20, 25, 30, 35, 40]);
  assert.equal(BONUS_DIA7, 25);
  assert.deepEqual([1, 7, 8, 14, 15].map(diaCiclo), [1, 7, 1, 7, 1]);
});

test('rachaVigente: sigue si fue ayer o hoy; se rompe si pasó más de un día', () => {
  assert.equal(rachaVigente(undefined, '2026-11-05'), 0);
  assert.equal(rachaVigente({ racha: 4, ultimoDia: '2026-11-05' }, '2026-11-05'), 4);
  assert.equal(rachaVigente({ racha: 4, ultimoDia: '2026-11-04' }, '2026-11-05'), 4);
  assert.equal(rachaVigente({ racha: 4, ultimoDia: '2026-11-03' }, '2026-11-05'), 0);
});

test('segundosHastaManana: hasta las 00:00 UTC, redondeado hacia arriba', () => {
  assert.equal(segundosHastaManana(Date.UTC(2026, 10, 5, 12)), 43200);
  assert.equal(segundosHastaManana(Date.UTC(2026, 10, 5, 23, 59, 59, 500)), 1);
});

describe('racha diaria: POST y GET /recompensa', () => {
  const A = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
  const HOY0 = Date.UTC(2026, 10, 5, 12);
  const TX = '0x' + 'ef'.repeat(32);
  let srv, reloj, pagos, fallaBonus, fallaPago;

  const arrancar = async (extra = {}) => {
    srv = await levantar(crearApp({
      mint: async () => { throw new Error('no se usa'); },
      contractAddress: '0x' + '11'.repeat(20), chainId: 11155111, now: () => reloj, logger: loggerMudo,
      pagarRecompensa: async (to, cantidad, motivo) => {
        if (fallaPago) throw fallaPago;
        if (fallaBonus && motivo === MOTIVO_BONUS_DIA7) throw new Error('RPC caído');
        pagos.push({ to, cantidad, motivo });
        return { txHash: TX };
      },
      ...extra,
    }));
  };

  beforeEach(() => {
    reloj = HOY0;
    pagos = [];
    fallaBonus = false;
    fallaPago = null;
  });
  afterEach(() => srv?.cerrar());

  const postDiaria = (address = A) => fetch(`${srv.url}/recompensa`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address, motivo: MOTIVO_DIARIA }),
  }).then(async (r) => ({ status: r.status, json: await r.json() }));
  const getDiaria = (address = A) => fetch(`${srv.url}/recompensa/diaria/${address}`)
    .then(async (r) => ({ status: r.status, json: await r.json() }));

  test('semana completa: 10→40 ORO y bonus de 25 en el día 7; día 8 vuelve al día 1', async () => {
    await arrancar();
    for (let i = 0; i < 7; i++) {
      reloj = HOY0 + i * DIA_MS;
      const r = await postDiaria();
      assert.equal(r.status, 200, `día ${i + 1}`);
      assert.equal(r.json.ok, true);
      assert.equal(r.json.motivo, 'diaria');
      assert.equal(r.json.dia, i + 1);
      assert.equal(r.json.racha, i + 1);
      assert.equal(r.json.oro, TABLA_DIARIA[i]);
      assert.equal(r.json.bonusDia7, i === 6 ? 25 : 0);
      assert.equal(r.json.txHash, TX);
      assert.equal('txHashBonus' in r.json, i === 6);
    }
    // 7 pagos principales (10..40) + 1 bonus, en este orden
    assert.equal(pagos.length, 8);
    assert.deepEqual(pagos.slice(0, 7).map((p) => p.cantidad), TABLA_DIARIA.map(ORO));
    assert.ok(pagos.slice(0, 7).every((p) => p.motivo === 'diaria' && p.to === A));
    assert.deepEqual(pagos[7], { to: A, cantidad: ORO(25), motivo: 'diaria-bonus' });

    reloj = HOY0 + 7 * DIA_MS;
    const r8 = await postDiaria();
    assert.equal(r8.status, 200);
    assert.deepEqual([r8.json.racha, r8.json.dia, r8.json.oro, r8.json.bonusDia7], [8, 1, 10, 0]);
    assert.equal(pagos.length, 9);
  });

  test('si pasa más de un día sin reclamar, la racha vuelve al día 1', async () => {
    await arrancar();
    assert.equal((await postDiaria()).json.racha, 1);
    reloj = HOY0 + DIA_MS;
    assert.equal((await postDiaria()).json.racha, 2);
    reloj = HOY0 + 4 * DIA_MS; // se saltó 2 días
    const r = await postDiaria();
    assert.equal(r.status, 200);
    assert.deepEqual([r.json.racha, r.json.dia, r.json.oro], [1, 1, 10]);
  });

  test('mismo día UTC: 409 con proximoEn; antes de 10 s, 429 por el limitador', async () => {
    await arrancar();
    assert.equal((await postDiaria()).status, 200);
    const pronto = await postDiaria();
    assert.equal(pronto.status, 429);
    reloj = HOY0 + 11_000;
    const r = await postDiaria();
    assert.equal(r.status, 409);
    assert.deepEqual(r.json, { error: 'Ya has reclamado hoy', proximoEn: 43189 });
    assert.equal(pagos.length, 1);
  });

  test('GET /recompensa/diaria/:address devuelve el estado sin escribir', async () => {
    await arrancar();
    let g = await getDiaria();
    assert.equal(g.status, 200);
    assert.deepEqual(g.json, { racha: 0, dia: 1, puedeReclamar: true, proximoEn: 0, proximaOro: 10 });

    await postDiaria();
    g = await getDiaria(A.toLowerCase());
    assert.deepEqual(g.json, { racha: 1, dia: 2, puedeReclamar: false, proximoEn: 43200, proximaOro: 15 });

    reloj = HOY0 + DIA_MS; // al día siguiente ya puede reclamar, y la racha sigue
    g = await getDiaria();
    assert.deepEqual(g.json, { racha: 1, dia: 2, puedeReclamar: true, proximoEn: 0, proximaOro: 15 });
    assert.equal(pagos.length, 1); // el GET no paga ni registra nada
  });

  test('GET tras un día saltado: racha 0 y la próxima oro es la del día 1', async () => {
    await arrancar();
    await postDiaria();
    reloj = HOY0 + 3 * DIA_MS;
    const g = await getDiaria();
    assert.deepEqual(g.json, { racha: 0, dia: 1, puedeReclamar: true, proximoEn: 0, proximaOro: 10 });
  });

  test('bonus del día 7 fallido: el ORO principal queda pagado, se marca bonusPendiente y no se cobra dos veces', async () => {
    await arrancar();
    fallaBonus = true;
    for (let i = 0; i < 6; i++) { reloj = HOY0 + i * DIA_MS; await postDiaria(); }
    reloj = HOY0 + 6 * DIA_MS;
    const r = await postDiaria();
    assert.equal(r.status, 200);
    assert.equal(r.json.racha, 7);
    assert.equal(r.json.oro, 40);
    assert.equal(r.json.bonusPendiente, true);
    assert.equal('txHashBonus' in r.json, false);
    assert.equal(pagos.filter((p) => p.motivo === 'diaria').length, 7);
    reloj += 11_000;
    assert.equal((await postDiaria()).status, 409);
  });

  test('si el pago principal falla no se registra el reclamo: se puede reintentar', async () => {
    await arrancar();
    fallaPago = Object.assign(new Error('x'), { code: 'NETWORK_ERROR' });
    assert.equal((await postDiaria()).status, 500);
    fallaPago = null;
    reloj += 11_000;
    const r = await postDiaria();
    assert.equal(r.status, 200);
    assert.equal(r.json.racha, 1);
  });

  test('tope on-chain en el pago diario → 409 con el mensaje del contrato', async () => {
    await arrancar();
    fallaPago = Object.assign(new Error('tope'), { code: 'CALL_EXCEPTION', revert: { name: 'TopeGlobalSuperado' } });
    const r = await postDiaria();
    assert.equal(r.status, 409);
    assert.match(r.json.error, /para todos/);
  });

  test('400 por dirección inválida en POST y GET', async () => {
    await arrancar();
    const p = await postDiaria('nope');
    assert.equal(p.status, 400);
    assert.deepEqual(p.json, { error: 'Dirección inválida' });
    const g = await getDiaria('0x123');
    assert.equal(g.status, 400);
    assert.deepEqual(g.json, { error: 'Dirección inválida' });
    assert.equal(pagos.length, 0);
  });

  test('sin RECOMPENSAS_ADDRESS: 503 en GET y POST', async () => {
    await arrancar({ pagarRecompensa: null, recompensaNoDisponible: 'Recompensas no disponibles: falta RECOMPENSAS_ADDRESS' });
    const p = await postDiaria();
    assert.equal(p.status, 503);
    const g = await getDiaria();
    assert.equal(g.status, 503);
    assert.match(g.json.error, /RECOMPENSAS_ADDRESS/);
  });
});

describe('GET /health con saldo del operador', () => {
  const base = { ok: true, contract: '0x' + '11'.repeat(20), chainId: 11155111 };
  let srv;
  afterEach(() => srv?.cerrar());

  const arrancarCon = async (obtenerSaldo) => {
    srv = await levantar(crearApp({
      mint: async () => { throw new Error('no se usa'); },
      contractAddress: base.contract, chainId: base.chainId, logger: loggerMudo, obtenerSaldo,
    }));
    return (await fetch(`${srv.url}/health`)).json();
  };

  test('saldo en ETH y alerta si es menor de 0,002', async () => {
    assert.deepEqual(await arrancarCon(async () => parseEther('0.0015')),
      { ...base, saldoOperador: '0.0015', alertaSaldoBajo: true });
    await srv.cerrar();
    assert.deepEqual(await arrancarCon(async () => parseEther('0.002')),
      { ...base, saldoOperador: '0.002', alertaSaldoBajo: false });
  });

  test('si el RPC falla al leer el saldo, /health sigue respondiendo 200', async () => {
    const r = await arrancarCon(async () => { throw new Error('RPC caído'); });
    assert.deepEqual(r, { ...base, saldoOperador: null, alertaSaldoBajo: null });
  });

  test('sin obtenerSaldo, /health devuelve exactamente lo de antes', async () => {
    srv = await levantar(crearApp({
      mint: async () => { throw new Error('no se usa'); },
      contractAddress: base.contract, chainId: base.chainId, logger: loggerMudo,
    }));
    assert.deepEqual(await (await fetch(`${srv.url}/health`)).json(), base);
  });
});
