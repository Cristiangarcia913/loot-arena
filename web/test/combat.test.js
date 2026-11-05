import { test } from "node:test";
import assert from "node:assert/strict";
import * as C from "../js/combat.js";

/** rng que devuelve una secuencia fija (cíclica). */
const seq = (...vals) => { let i = 0; return () => vals[i++ % vals.length]; };
/** rng "neutro": randInt(-2,2) → 0 y no dispara la carga (0.5 ≥ PROB_CARGA). */
const neutro = () => 0.5;

test("calcularDano: max(1, atk-def) ± variación, nunca < 1", () => {
  assert.equal(C.calcularDano(10, 3, neutro), 7);
  assert.equal(C.calcularDano(10, 3, () => 0), 5);       // -2
  assert.equal(C.calcularDano(10, 3, () => 0.999), 9);   // +2
  assert.equal(C.calcularDano(3, 50, () => 0), 1);       // mínimo 1
  assert.equal(C.calcularDano(3, 50, () => 0.999), 3);   // max(1,…)=1, +2
  const rng = C.mulberry32(42);
  for (let i = 0; i < 500; i++) assert.ok(C.calcularDano(C.randInt(1, 30, rng), C.randInt(0, 60, rng), rng) >= 1);
});

test("defensaEfectiva dobla al defender", () => {
  assert.equal(C.defensaEfectiva(5, false), 5);
  assert.equal(C.defensaEfectiva(5, true), 10);
});

test("randInt respeta los límites", () => {
  const rng = C.mulberry32(1);
  for (let i = 0; i < 1000; i++) {
    const v = C.randInt(-1, 1, rng);
    assert.ok(v >= -1 && v <= 1 && Number.isInteger(v));
  }
});

test("nivelArena y nivelEnemigo se acotan a 1..10", () => {
  assert.equal(C.nivelArena(0), 1);
  assert.equal(C.nivelArena(2), 1);
  assert.equal(C.nivelArena(3), 2);
  assert.equal(C.nivelArena(1000), 10);
  assert.equal(C.nivelArena(-5), 1);
  assert.equal(C.nivelEnemigo(1, () => 0), 1);
  assert.equal(C.nivelEnemigo(10, () => 0.999), 10);
  assert.equal(C.nivelEnemigo(5, neutro), 5);
});

test("generarEnemigo escala con el nivel y elige criatura del bestiario", () => {
  const e1 = C.generarEnemigo(1, neutro);
  const e10 = C.generarEnemigo(10, neutro);
  for (const e of [e1, e10]) {
    assert.ok(e.nombre && e.emoji);
    assert.ok(C.BESTIARIO.some((b) => b.nombre === e.nombre));
  }
  assert.equal(e1.nivel, 1);
  assert.ok(e10.vidaMax > e1.vidaMax && e10.ataque > e1.ataque && e10.defensa > e1.defensa);
  assert.equal(C.generarEnemigo(99, neutro).nivel, 10);
  assert.equal(C.generarEnemigo(10, () => 0.999).nombre, "Dragón ancestral");
  assert.equal(C.generarEnemigo(1, () => 0).nombre, "Rata gigante");
});

test("crearCombate empieza con vida completa", () => {
  const c = C.crearCombate(C.STATS_BASE, C.generarEnemigo(1, neutro));
  assert.equal(c.fase, "en_curso");
  assert.equal(c.jugador.vida, 100);
  assert.equal(c.enemigo.vida, c.enemigo.vidaMax);
  assert.equal(c.log.length, 1);
});

test("atacar: el jugador daña y luego el enemigo responde", () => {
  const enemigo = { nombre: "Dummy", emoji: "🎯", nivel: 1, vidaMax: 50, ataque: 12, defensa: 3 };
  const c0 = C.crearCombate(C.STATS_BASE, enemigo);
  const { combate: c1, eventos } = C.turnoJugador(c0, "atacar", neutro);
  assert.equal(c1.enemigo.vida, 50 - 7);           // 10-3
  assert.equal(c1.jugador.vida, 100 - 7);          // 12-5
  assert.equal(c1.turno, 2);
  assert.deepEqual(eventos.map((e) => e.tipo), ["ataque", "ataque"]);
  // inmutabilidad
  assert.equal(c0.enemigo.vida, 50);
  assert.equal(c0.jugador.vida, 100);
});

test("defender dobla la defensa ese turno y no ataca", () => {
  const enemigo = { nombre: "Dummy", emoji: "🎯", nivel: 1, vidaMax: 50, ataque: 12, defensa: 3 };
  const c0 = C.crearCombate(C.STATS_BASE, enemigo);
  const { combate: c1 } = C.turnoJugador(c0, "defender", neutro);
  assert.equal(c1.enemigo.vida, 50);
  assert.equal(c1.jugador.vida, 100 - 2);          // 12 - 5*2
});

test("el enemigo puede cargar y luego dar un golpe brutal", () => {
  const enemigo = { nombre: "Ogro", emoji: "👹", nivel: 3, vidaMax: 200, ataque: 20, defensa: 0 };
  const c0 = C.crearCombate(C.STATS_BASE, enemigo);
  // turno 1: daño jugador (0.5 → +0), carga (0.0 < PROB_CARGA)
  const { combate: c1, eventos: e1 } = C.turnoJugador(c0, "atacar", seq(0.5, 0.0));
  assert.equal(e1[1].tipo, "carga");
  assert.equal(c1.enemigo.cargando, true);
  assert.equal(c1.jugador.vida, 100);
  // turno 2 defendiendo: golpe brutal = round(20*1.75)=35 − 10 = 25
  const { combate: c2, eventos: e2 } = C.turnoJugador(c1, "defender", neutro);
  assert.equal(e2[1].tipo, "golpe_brutal");
  assert.equal(c2.jugador.vida, 75);
  assert.equal(c2.enemigo.cargando, false);
});

test("victoria cuando el enemigo llega a 0 (el enemigo ya no responde)", () => {
  const enemigo = { nombre: "Rata", emoji: "🐀", nivel: 1, vidaMax: 5, ataque: 50, defensa: 0 };
  const { combate, eventos } = C.turnoJugador(C.crearCombate(C.STATS_BASE, enemigo), "atacar", neutro);
  assert.equal(combate.fase, "victoria");
  assert.equal(combate.enemigo.vida, 0);
  assert.equal(combate.jugador.vida, 100);
  assert.equal(eventos.at(-1).tipo, "victoria");
  assert.throws(() => C.turnoJugador(combate, "atacar", neutro), /terminado/);
});

test("derrota cuando el jugador llega a 0", () => {
  const enemigo = { nombre: "Dragón", emoji: "🐉", nivel: 10, vidaMax: 999, ataque: 500, defensa: 99 };
  const { combate } = C.turnoJugador(C.crearCombate(C.STATS_BASE, enemigo), "atacar", neutro);
  assert.equal(combate.fase, "derrota");
  assert.equal(combate.jugador.vida, 0);
});

test("acción desconocida lanza error", () => {
  const c = C.crearCombate(C.STATS_BASE, C.generarEnemigo(1, neutro));
  assert.throws(() => C.turnoJugador(c, "bailar", neutro), /desconocida/);
});

test("un combate simulado siempre termina", () => {
  const rng = C.mulberry32(7);
  for (let k = 0; k < 50; k++) {
    let c = C.crearCombate(C.STATS_BASE, C.generarEnemigo(C.randInt(1, 10, rng), rng));
    let n = 0;
    while (c.fase === "en_curso" && n++ < 1000) c = C.turnoJugador(c, rng() < 0.8 ? "atacar" : "defender", rng).combate;
    assert.ok(c.fase === "victoria" || c.fase === "derrota");
  }
});

test("huir termina el combate", () => {
  const c = C.huir(C.crearCombate(C.STATS_BASE, C.generarEnemigo(1, neutro)));
  assert.equal(c.fase, "huida");
});
