import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUnits } from 'ethers';
import {
  MOTIVOS, LISTA_MOTIVOS, INICIO_TEMPORADAS, DURACION_TEMPORADA_MS, diaUtc, numeroTemporada, periodoDe,
  motivoOnchain, cantidadWei, validarMotivo, RegistroRecompensas,
} from '../src/recompensa.js';

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
