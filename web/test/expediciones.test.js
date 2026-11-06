import { test } from "node:test";
import assert from "node:assert/strict";
import * as X from "../js/expediciones.js";

const T = Date.UTC(2026, 10, 6, 12, 0, 0);
const MIN = 60_000;
const memoria = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), _m: m }; };
const nuevo = () => { const storage = memoria(); return { storage, E: X.crearExpediciones({ storage, reloj: () => T }) }; };
const CLAVE = X.claveExpedicion("0xABCdef0000000000000000000000000000000001");
const rngFijo = (...vals) => { let i = 0; return () => vals[i++ % vals.length]; };

test("duraciones: 15 min, 1 h, 4 h, 8 h", () => {
  assert.deepEqual(X.DURACIONES.map((d) => d.id), ["15m", "1h", "4h", "8h"]);
  assert.deepEqual(X.DURACIONES.map((d) => d.ms / MIN), [15, 60, 240, 480]);
  assert.equal(X.duracionPorId("4h").ms, 240 * MIN);
  assert.equal(X.duracionPorId("2h"), null);
  assert.equal(CLAVE, "lootarena:expedicion:0xabcdef0000000000000000000000000000000001");
  assert.equal(X.claveExpedicion(null), "lootarena:expedicion:invitado");
});

test("estado libre → en curso → lista con cuenta atrás", () => {
  const { E } = nuevo();
  assert.equal(E.estadoExpedicion(CLAVE, T).estado, "libre");
  const r = E.enviar(CLAVE, "1h", T);
  assert.equal(r.ok, true);
  const e = E.estadoExpedicion(CLAVE, T + 15 * MIN);
  assert.equal(e.estado, "en_curso");
  assert.equal(e.restanteMs, 45 * MIN);
  assert.equal(e.progreso, 0.25);
  assert.equal(e.fin, T + 60 * MIN);
  assert.equal(E.tiempoRestante(CLAVE, T + 59 * MIN), MIN);
  assert.equal(E.hayExpedicionLista(CLAVE, T + 59 * MIN), false);
  assert.equal(E.estadoExpedicion(CLAVE, T + 60 * MIN).estado, "lista");
  assert.equal(E.hayExpedicionLista(CLAVE, T + 90 * MIN), true);
  assert.equal(E.tiempoRestante(CLAVE, T + 90 * MIN), 0);
  // Reloj hacia atrás: nunca más que la duración.
  assert.equal(E.tiempoRestante(CLAVE, T - 10 * HORA()), 60 * MIN);
});
function HORA() { return 60 * MIN; }

test("una expedición a la vez (también si ha vuelto sin recoger)", () => {
  const { E } = nuevo();
  assert.equal(E.enviar(CLAVE, "15m", T).ok, true);
  const otra = E.enviar(CLAVE, "8h", T + MIN);
  assert.equal(otra.ok, false);
  assert.equal(otra.motivo, "en_curso");
  const sinRecoger = E.enviar(CLAVE, "8h", T + 20 * MIN);
  assert.equal(sinRecoger.motivo, "sin_recoger");
  assert.equal(E.recoger(CLAVE, T + 20 * MIN, () => 0.99).ok, true);
  assert.equal(E.enviar(CLAVE, "8h", T + 21 * MIN).ok, true);
  assert.equal(E.enviar(CLAVE, "nope", T).motivo, "duracion");
  // Otra dirección es independiente.
  assert.equal(E.enviar(X.claveExpedicion("0x2"), "1h", T).ok, true);
});

test("recoger antes de tiempo falla y no consume la expedición", () => {
  const { E } = nuevo();
  assert.equal(E.recoger(CLAVE, T).motivo, "sin_expedicion");
  E.enviar(CLAVE, "4h", T);
  const r = E.recoger(CLAVE, T + 239 * MIN);
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "aun_no");
  assert.equal(r.restanteMs, MIN);
  assert.match(r.mensaje, /01:00/);
  assert.equal(E.estadoExpedicion(CLAVE, T + 239 * MIN).estado, "en_curso");
  assert.equal(E.recoger(CLAVE, T + 240 * MIN, () => 0.99).ok, true);
  assert.equal(E.estadoExpedicion(CLAVE, T + 240 * MIN).estado, "libre");
  assert.equal(E.recoger(CLAVE, T + 241 * MIN).motivo, "sin_expedicion"); // no se recoge dos veces
});

test("recompensas escaladas por duración: largas menos XP/hora pero más botín", () => {
  const xpHora = X.DURACIONES.map((d) => d.xp / (d.ms / HORA()));
  for (let i = 1; i < xpHora.length; i++) {
    assert.ok(xpHora[i] < xpHora[i - 1], "XP/hora decrece");
    const [a, b] = [X.DURACIONES[i - 1], X.DURACIONES[i]];
    assert.ok(b.xp > a.xp && b.pociones >= a.pociones && b.probBotin > a.probBotin && b.nivelBotin > a.nivelBotin);
  }
  const { E } = nuevo();
  // rng: poción extra sí (0), botín sí (0), jefe no (0.99)
  E.enviar(CLAVE, "8h", T);
  const r8 = E.recoger(CLAVE, T + 480 * MIN, rngFijo(0, 0, 0.99));
  assert.deepEqual({ xp: r8.xp, pociones: r8.pociones, botin: r8.botin }, { xp: 480, pociones: 4, botin: { nivel: 8, jefe: false } });
  // jefe: nivel +2 (máx 10)
  E.enviar(CLAVE, "8h", T);
  assert.deepEqual(E.recoger(CLAVE, T + 480 * MIN, () => 0).botin, { nivel: 10, jefe: true });
  // 15 min sin suerte: 30 XP, 0 pociones, sin botín
  E.enviar(CLAVE, "15m", T);
  const r15 = E.recoger(CLAVE, T + 15 * MIN, () => 0.99);
  assert.deepEqual({ xp: r15.xp, pociones: r15.pociones, botin: r15.botin }, { xp: 30, pociones: 0, botin: null });
  // 15 min nunca da jefe
  E.enviar(CLAVE, "15m", T);
  assert.deepEqual(E.recoger(CLAVE, T + 15 * MIN, () => 0).botin, { nivel: 2, jefe: false });
});

test("botín pendiente hasta que main.js lo reclama", () => {
  const { E } = nuevo();
  E.enviar(CLAVE, "1h", T);
  const r = E.recoger(CLAVE, T + HORA(), () => 0);
  assert.deepEqual(E.botinPendiente(CLAVE), r.botin);
  assert.deepEqual(E.estadoExpedicion(CLAVE, T).botinPendiente, r.botin);
  E.resolverBotin(CLAVE);
  assert.equal(E.botinPendiente(CLAVE), null);
});

test("persistencia: otra instancia con el mismo storage ve la expedición; datos corruptos → libre", () => {
  const { storage, E } = nuevo();
  E.enviar(CLAVE, "4h", T);
  const E2 = X.crearExpediciones({ storage, reloj: () => T + 240 * MIN });
  assert.equal(E2.estadoExpedicion(CLAVE).estado, "lista"); // usa el reloj inyectado
  assert.equal(E2.recoger(CLAVE, undefined, () => 0.99).ok, true);
  assert.equal(E2.estadoExpedicion(CLAVE).completadas, 1);
  storage.setItem(CLAVE, "{no es json");
  assert.equal(E.estadoExpedicion(CLAVE).estado, "libre");
  storage.setItem(CLAVE, JSON.stringify({ actual: { duracion: "99h", inicio: T } }));
  assert.equal(E.estadoExpedicion(CLAVE).estado, "libre");
  // cancelar
  E.enviar(CLAVE, "1h", T);
  assert.equal(E.cancelar(CLAVE), true);
  assert.equal(E.estadoExpedicion(CLAVE).estado, "libre");
  assert.equal(E.cancelar(CLAVE), false);
});

test("formatearRestante", () => {
  assert.equal(X.formatearRestante(0), "00:00");
  assert.equal(X.formatearRestante(-1), "00:00");
  assert.equal(X.formatearRestante(14 * MIN + 59_500), "15:00");
  assert.equal(X.formatearRestante(8 * HORA()), "8:00:00");
  assert.equal(X.formatearRestante(HORA() + 2 * MIN + 5000), "1:02:05");
});

test("las funciones por defecto no fallan sin localStorage (node)", () => {
  assert.equal(X.estadoExpedicion(CLAVE, T).estado, "libre");
  assert.equal(X.hayExpedicionLista(CLAVE, T), false);
});
