// Comprobación rápida del balance (la simulación completa está en tools/balance.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as C from "../js/combat.js";
import * as P from "../js/progression.js";
import { simular, EQUIPO_MEDIO, nivelHeroeEsperado } from "../tools/balance.mjs";

test("balance: sin equipo ~70 % en nivel 1 y ~20 % en nivel 10; el equipo ayuda", () => {
  const r = C.mulberry32(99);
  const nh10 = { ...P.progresoNuevo(), nivel: nivelHeroeEsperado(10) };
  const n1 = simular(P.statsHeroe(P.progresoNuevo(), []), 1, { n: 1500, r }).pct;
  const n10 = simular(P.statsHeroe(nh10, []), 10, { n: 1500, r }).pct;
  const e10 = simular(P.statsHeroe(nh10, EQUIPO_MEDIO), 10, { n: 500, r }).pct;
  assert.ok(n1 > 60 && n1 < 80, `nivel 1: ${n1}`);
  assert.ok(n10 > 8 && n10 < 30, `nivel 10: ${n10}`);
  assert.ok(e10 > n10 + 30, `equipo medio nivel 10: ${e10}`);
});
