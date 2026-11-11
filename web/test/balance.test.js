// Comprobación rápida del balance (la simulación completa está en tools/balance.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as C from "../js/combat.js";
import * as P from "../js/progression.js";
import { simular, EQUIPO_MEDIO, nivelHeroeEsperado, heroeNovato, iaSoloAtacar } from "../tools/balance.mjs";

test("balance: la arena 1 se gana jugando bien y el nivel 10 ronda el 20 %", () => {
  const r = C.mulberry32(99);
  const nh10 = { ...P.progresoNuevo(), nivel: nivelHeroeEsperado(10) };
  // Muestras grandes: con 1500 combates la varianza entre semillas movía el nivel 10 varios puntos.
  // Objetivo 2 de tools/balance.mjs. El «~70 % en la arena 1» que decía antes este test se
  // reasignó a la columna «solo atacar» (el test de abajo), porque el juego competente nunca
  // puede quedar por debajo del suelo: jugar bien incluye la opción de solo atacar.
  const n1 = simular(P.statsHeroe(P.progresoNuevo(), []), 1, { n: 4000, r }).pct;
  const n10 = simular(P.statsHeroe(nh10, []), 10, { n: 4000, r }).pct;
  const e10 = simular(P.statsHeroe(nh10, EQUIPO_MEDIO), 10, { n: 500, r }).pct;
  assert.ok(n1 > 90, `nivel 1 jugando bien: ${n1}`);
  assert.ok(n10 > 12 && n10 < 28, `nivel 10: ${n10}`);
  assert.ok(e10 > n10 + 30, `equipo medio nivel 10: ${e10}`);
});

test("balance: con equipo medio los jefes siguen siendo un reto", () => {
  const r = C.mulberry32(2026);
  const nh = (arena) => ({ ...P.progresoNuevo(), nivel: nivelHeroeEsperado(arena) });
  const jefe = (arena) => simular(P.statsHeroe(nh(arena), EQUIPO_MEDIO), arena, { jefe: true, pociones: 3, n: 500, r }).pct;
  // El jefe del 10 es el reto de verdad (~25 %). Los de la mitad de la tabla quedaron más
  // asequibles al suavizar la curva de los niveles bajos: es el precio del recibimiento.
  const j7 = jefe(7);
  const j10 = jefe(10);
  assert.ok(j7 > 45, `jefe nivel 7: ${j7}`);
  assert.ok(j10 > 15 && j10 < 55, `jefe nivel 10: ${j10}`);
  assert.ok(j7 > j10, `el jefe del 10 tiene que ser más duro que el del 7: ${j7} vs ${j10}`);
});

test("recibimiento: atacando sin más se ganan los primeros combates", () => {
  // Objetivo 1 de tools/balance.mjs: 70-80 % en la arena 1 y 40-50 % en la arena 3.
  // Regresión del hallazgo «atacando sin más se pierde el primer combate 10 de cada 10 veces»
  // (medido: 0,9 % de victorias en la arena 1). El suelo del juego tiene que perdonar.
  const r = C.mulberry32(2026);
  const novato = (arena) => heroeNovato({ ...P.progresoNuevo(), nivel: nivelHeroeEsperado(arena) });
  const solo = (arena) => simular(novato(arena), arena, { pociones: 0, ia: iaSoloAtacar, n: 2000, r }).pct;
  const a1 = solo(1);
  const a3 = solo(3);
  assert.ok(a1 > 68 && a1 < 85, `arena 1 solo atacando: ${a1}`);
  assert.ok(a3 > 38 && a3 < 58, `arena 3 solo atacando: ${a3}`);
  assert.ok(a1 > a3, `la dificultad tiene que notarse: ${a1} vs ${a3}`);
});
