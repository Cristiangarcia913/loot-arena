// Comprobación rápida del balance (la simulación completa está en tools/balance.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as C from "../js/combat.js";
import * as P from "../js/progression.js";
import { simular, EQUIPO_MEDIO, nivelHeroeEsperado } from "../tools/balance.mjs";

test("balance: sin equipo ~70 % en nivel 1 y ~20 % en nivel 10; el equipo ayuda", () => {
  const r = C.mulberry32(99);
  const nh10 = { ...P.progresoNuevo(), nivel: nivelHeroeEsperado(10) };
  // Muestras grandes: con 1500 combates la varianza entre semillas movía el nivel 10 varios puntos.
  // Con 4000 el nivel 10 queda en 21,3-21,4 % con las semillas 99, 7 y 2026 (medido).
  const n1 = simular(P.statsHeroe(P.progresoNuevo(), []), 1, { n: 4000, r }).pct;
  const n10 = simular(P.statsHeroe(nh10, []), 10, { n: 4000, r }).pct;
  const e10 = simular(P.statsHeroe(nh10, EQUIPO_MEDIO), 10, { n: 500, r }).pct;
  assert.ok(n1 > 60 && n1 < 80, `nivel 1: ${n1}`);
  assert.ok(n10 > 15 && n10 < 28, `nivel 10: ${n10}`);
  assert.ok(e10 > n10 + 30, `equipo medio nivel 10: ${e10}`);
});

test("balance: con equipo medio los jefes siguen siendo un reto", () => {
  const r = C.mulberry32(2026);
  const nh = (arena) => ({ ...P.progresoNuevo(), nivel: nivelHeroeEsperado(arena) });
  const jefe = (arena) => simular(P.statsHeroe(nh(arena), EQUIPO_MEDIO), arena, { jefe: true, pociones: 3, n: 500, r }).pct;
  // Ni regalados ni imposibles: el jefe del nivel 10 ronda el 40 % y el del 7 el 70 %.
  const j7 = jefe(7);
  const j10 = jefe(10);
  assert.ok(j7 > 45 && j7 < 90, `jefe nivel 7: ${j7}`);
  assert.ok(j10 > 25 && j10 < 60, `jefe nivel 10: ${j10}`);
  assert.ok(j7 > j10, `el jefe del 10 tiene que ser más duro que el del 7: ${j7} vs ${j10}`);
});
