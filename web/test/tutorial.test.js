import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EVENTOS, PASOS, TOTAL_PASOS, CLAVE_TUTORIAL, estadoInicial, transicion, saltar, tutorialVisto,
  iniciarTutorial, avanzarTutorial, saltarTutorial, tutorialActivo, reiniciarTutorial, pasoActual, detenerTutorial, combateTutorial,
} from "../js/tutorial.js";
import { crearCombate, turnoJugador, mulberry32, STATS_BASE } from "../js/combat.js";

function memoria(inicial = {}) {
  const d = new Map(Object.entries(inicial));
  return {
    getItem: (k) => (d.has(k) ? d.get(k) : null),
    setItem: (k, v) => d.set(k, String(v)),
    removeItem: (k) => d.delete(k),
    datos: d,
  };
}

test("hay 5 pasos en el orden del plan y un evento por paso", () => {
  assert.equal(TOTAL_PASOS, 5);
  assert.deepEqual(PASOS.map((p) => p.id), ["explorar", "ataque", "habilidad", "botin", "equipar"]);
  assert.deepEqual([...EVENTOS], PASOS.map((p) => p.id));
  for (const p of PASOS) {
    assert.ok(p.texto.length > 0 && p.texto.length <= 110, `texto corto en ${p.id}`);
    assert.ok(p.objetivos.length >= 1);
  }
});

test("transicion: recorrido completo en orden", () => {
  let e = estadoInicial();
  assert.deepEqual(e, { paso: 0, terminado: false, saltado: false });
  for (const [i, ev] of EVENTOS.entries()) {
    e = transicion(e, ev);
    if (i < 4) assert.deepEqual(e, { paso: i + 1, terminado: false, saltado: false });
  }
  assert.deepEqual(e, { paso: 5, terminado: true, saltado: false });
});

test("transicion: ignora eventos anteriores, desconocidos o repetidos", () => {
  const e2 = { paso: 2, terminado: false, saltado: false };
  assert.equal(transicion(e2, "explorar"), e2);
  assert.equal(transicion(e2, "ataque"), e2);
  assert.equal(transicion(e2, "bailar"), e2);
  assert.equal(transicion(e2, undefined), e2);
  const fin = { paso: 5, terminado: true, saltado: false };
  assert.equal(transicion(fin, "equipar"), fin);
});

test("transicion: un evento posterior salta pasos (botín sin haber usado habilidad)", () => {
  const e = transicion({ paso: 1, terminado: false, saltado: false }, "botin");
  assert.deepEqual(e, { paso: 4, terminado: false, saltado: false });
  assert.deepEqual(transicion(estadoInicial(), "equipar"), { paso: 5, terminado: true, saltado: false });
});

test("saltar marca terminado y saltado; no afecta a uno ya terminado", () => {
  assert.deepEqual(saltar({ paso: 2, terminado: false, saltado: false }), { paso: 2, terminado: true, saltado: true });
  const fin = { paso: 5, terminado: true, saltado: false };
  assert.equal(saltar(fin), fin);
});

test("API: primera vez se activa, avanza, avisa con alPaso y guarda al terminar", () => {
  const s = memoria();
  const vistos = [];
  assert.equal(iniciarTutorial({ storage: s, alPaso: (p) => vistos.push(p) }), true);
  assert.equal(tutorialActivo(), true);
  assert.equal(pasoActual().id, "explorar");
  assert.equal(avanzarTutorial("ataque"), true, "ataque antes de explorar salta a habilidad");
  assert.equal(pasoActual().id, "habilidad");
  assert.equal(avanzarTutorial("ataque"), false, "repetido no avanza");
  assert.equal(avanzarTutorial("habilidad"), true);
  assert.equal(avanzarTutorial("botin"), true);
  assert.equal(pasoActual().id, "equipar");
  assert.equal(s.getItem(CLAVE_TUTORIAL), null, "no se guarda hasta terminar");
  assert.equal(avanzarTutorial("equipar"), true);
  assert.equal(tutorialActivo(), false);
  assert.equal(pasoActual().terminado, true);
  assert.equal(tutorialVisto(s), true);
  assert.equal(JSON.parse(s.getItem(CLAVE_TUTORIAL)).saltado, false);
  assert.deepEqual(vistos.map((p) => p.indice), [0, 2, 3, 4, 5]);
  assert.equal(vistos.at(-1).id, null);
  assert.equal(avanzarTutorial("explorar"), false, "inactivo: no hace nada");
  detenerTutorial();
});

test("API: si ya se vio no arranca; forzar y reiniciar lo repiten", () => {
  const s = memoria({ [CLAVE_TUTORIAL]: JSON.stringify({ v: 1, terminado: true }) });
  assert.equal(iniciarTutorial({ storage: s }), false);
  assert.equal(tutorialActivo(), false);
  assert.equal(pasoActual(), null);
  assert.equal(avanzarTutorial("explorar"), false);
  assert.equal(reiniciarTutorial(), true);
  assert.equal(tutorialActivo(), true);
  assert.equal(pasoActual().indice, 0);
  assert.equal(tutorialVisto(s), false, "reiniciar borra la marca");
  assert.equal(iniciarTutorial({ storage: s, forzar: true }), true);
  detenerTutorial();
});

test("API: saltar guarda como visto y con saltado=true", () => {
  const s = memoria();
  const vistos = [];
  iniciarTutorial({ storage: s, alPaso: (p) => vistos.push(p) });
  avanzarTutorial("explorar");
  assert.equal(saltarTutorial(), true);
  assert.equal(saltarTutorial(), false);
  assert.equal(tutorialActivo(), false);
  assert.equal(JSON.parse(s.getItem(CLAVE_TUTORIAL)).saltado, true);
  assert.equal(vistos.at(-1).saltado, true);
  assert.equal(iniciarTutorial({ storage: s }), false);
  detenerTutorial();
});

test("API: storage roto o ausente no rompe nada", () => {
  const roto = { getItem() { throw new Error("x"); }, setItem() { throw new Error("x"); }, removeItem() { throw new Error("x"); } };
  assert.equal(iniciarTutorial({ storage: roto }), true);
  assert.equal(saltarTutorial(), true);
  assert.equal(iniciarTutorial({ storage: null }), true);
  assert.equal(tutorialVisto(memoria({ [CLAVE_TUTORIAL]: "{no json" })), false);
  detenerTutorial();
});

test("API: un alPaso que lanza no corta el tutorial", () => {
  const err = console.error; console.error = () => {};
  try {
    assert.equal(iniciarTutorial({ storage: memoria(), alPaso: () => { throw new Error("boom"); } }), true);
    assert.equal(avanzarTutorial("explorar"), true);
  } finally { console.error = err; }
  detenerTutorial();
});

test("combateTutorial: enemigo de nivel 1 con poca vida, marcado como tutorial", () => {
  const e = combateTutorial();
  assert.equal(e.nivel, 1);
  assert.equal(e.jefe, false);
  assert.equal(e.tutorial, true);
  assert.ok(e.vidaMax <= 40);
  for (const k of ["clave", "nombre", "emoji", "vidaMax", "ataque", "defensa", "esquiva", "rasgo"]) assert.ok(k in e, k);
  assert.notEqual(combateTutorial(), e, "devuelve un objeto nuevo cada vez");
});

test("combateTutorial: el héroe base gana siempre solo atacando", () => {
  const heroe = { vida: STATS_BASE.vida, ataque: STATS_BASE.ataque, defensa: STATS_BASE.defensa };
  for (let semilla = 1; semilla <= 300; semilla++) {
    const rng = mulberry32(semilla);
    let c = crearCombate(heroe, combateTutorial(), rng);
    let turnos = 0;
    while (c.fase === "en_curso" && turnos < 30) { c = turnoJugador(c, "atacar", rng).combate; turnos++; }
    assert.equal(c.fase, "victoria", `semilla ${semilla}`);
    assert.ok(turnos <= 8, `semilla ${semilla}: ${turnos} turnos`);
    assert.ok(c.jugador.vida > c.jugador.vidaMax / 2, `semilla ${semilla}: vida ${c.jugador.vida}`);
  }
});
