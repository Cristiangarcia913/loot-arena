import { test } from "node:test";
import assert from "node:assert/strict";
import * as C from "../js/combat.js";
import * as P from "../js/progression.js";
import * as T from "../js/torre.js";
import { iaJugador, EQUIPO_MEDIO } from "../tools/balance.mjs";

const heroe = () => P.statsHeroe(P.progresoNuevo(), []);
const memoria = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m };
};

/** Juega un combate con la IA de tools/balance.mjs. */
function jugar(c, r) {
  let k = 0;
  while (c.fase === "en_curso" && k++ < 300) c = C.turnoJugador(c, iaJugador(c), r).combate;
  return c;
}

/** Una subida completa; devuelve el resultado de trasDerrota. */
function subida(h, r, opciones) {
  let t = T.nuevaTorre(h);
  for (;;) {
    const c = jugar(T.combateDePiso(t, r), r);
    if (c.fase !== "victoria") return T.trasDerrota(t, c, opciones);
    t = T.trasVictoria(t, c).torre;
    if (t.piso > 300) return T.trasDerrota(t);
  }
}

// ───────── Escalado ─────────

test("jefe cada 5 pisos y nivel que sube despacio", () => {
  assert.deepEqual([1, 4, 5, 6, 10, 15].map(T.esPisoJefe), [false, false, true, false, true, true]);
  assert.equal(T.nivelDePiso(1), 1);
  assert.equal(T.nivelDePiso(3), 1);
  assert.equal(T.nivelDePiso(4), 2);
  assert.equal(T.nivelDePiso(500), C.NIVEL_MAX);
});

test("enemigoDePiso: escala suave y nunca baja; jefe en el 5", () => {
  const r = C.mulberry32(1);
  const e1 = T.enemigoDePiso(1, r);
  assert.equal(e1.piso, 1);
  assert.equal(e1.jefe, false);
  const e5 = T.enemigoDePiso(5, r);
  assert.equal(e5.jefe, true);
  assert.ok(e5.definitiva);
  // Misma criatura (jefes no consumen rng al elegir): vida/ataque crecen con el piso, también por encima del nivel 10.
  const jefes = [5, 10, 30, 60, 100].map((p) => T.enemigoDePiso(p, r));
  for (let i = 1; i < jefes.length; i++) {
    assert.ok(jefes[i].vidaMax >= jefes[i - 1].vidaMax, `vida piso ${jefes[i].piso}`);
    assert.ok(jefes[i].ataque >= jefes[i - 1].ataque, `ataque piso ${jefes[i].piso}`);
  }
  // Suave: el piso 1 es más fácil que un enemigo normal de arena nivel 1.
  const arena = C.generarEnemigoDe(e1.clave, 1);
  assert.ok(e1.vidaMax < arena.vidaMax && e1.ataque < arena.ataque);
});

test("enemigoDePiso es determinista con el mismo rng", () => {
  assert.deepEqual(T.enemigoDePiso(7, C.mulberry32(3)), T.enemigoDePiso(7, C.mulberry32(3)));
});

// ───────── Estado ─────────

test("nuevaTorre: piso 1, vida llena, 3 pociones", () => {
  const t = T.nuevaTorre(heroe(), { pocionesExtra: 2 });
  assert.equal(t.estado, "en_curso");
  assert.equal(t.piso, 1);
  assert.equal(t.vida, 100);
  assert.equal(t.vidaMax, 100);
  assert.equal(t.pociones, 3);
  assert.equal(t.pocionesExtra, 2);
  assert.deepEqual(t.botines, []);
  assert.throws(() => T.nuevaTorre(null));
});

test("combateDePiso conserva la vida acumulada sin mutar la torre", () => {
  const t = { ...T.nuevaTorre(heroe()), vida: 37, pociones: 1 };
  const copia = structuredClone(t);
  const c = T.combateDePiso(t, C.mulberry32(2));
  assert.equal(c.jugador.vida, 37);
  assert.equal(c.jugador.vidaMax, 100);
  assert.equal(c.jugador.pociones, 1);
  assert.equal(c.piso, 1);
  assert.equal(c.log[0].vidas.jugador, 37);
  assert.deepEqual(t, copia);
  // El combate sigue funcionando con el motor normal.
  const r = C.turnoJugador(c, "atacar", C.mulberry32(4));
  assert.ok(r.combate.turno === 2);
});

test("trasVictoria: cura 20 %, sube piso, da XP y no muta", () => {
  const r = C.mulberry32(5);
  const t = T.nuevaTorre(heroe());
  let c = T.combateDePiso(t, r);
  c = { ...c, fase: "victoria", jugador: { ...c.jugador, vida: 50, pocionesBase: 2, pociones: 2 }, resumen: { ...c.resumen, turnos: 6 } };
  const copia = structuredClone(t);
  const v = T.trasVictoria(t, c);
  assert.deepEqual(t, copia);
  assert.equal(v.superado, 1);
  assert.equal(v.torre.piso, 2);
  assert.equal(v.torre.vida, 70);
  assert.equal(v.curacion, 20);
  assert.equal(v.torre.pociones, 2);
  assert.equal(v.torre.turnos, 6);
  assert.equal(v.xp, T.xpDePiso(1));
  assert.equal(v.torre.xp, v.xp);
  assert.equal(v.botin, null);
  // La cura no pasa de la vida máxima.
  assert.equal(T.trasVictoria({ ...t, vida: 95 }).torre.vida, 100);
  assert.throws(() => T.trasVictoria(t, { ...c, fase: "derrota" }));
});

test("botín de jefe cada 5 pisos y XP creciente", () => {
  let t = T.nuevaTorre(heroe());
  const botines = [];
  for (let i = 0; i < 10; i++) {
    const v = T.trasVictoria(t);
    if (v.botin) botines.push(v.botin);
    t = v.torre;
  }
  assert.equal(t.piso, 11);
  assert.deepEqual(botines, [{ nivel: T.nivelDePiso(5), jefe: true, piso: 5 }, { nivel: T.nivelDePiso(10), jefe: true, piso: 10 }]);
  assert.deepEqual(t.botines, botines);
  assert.ok(T.xpDePiso(2) > T.xpDePiso(1));
  assert.ok(T.xpDePiso(5) > T.xpDePiso(6), "los jefes dan más XP");
  assert.equal(t.xp, Array.from({ length: 10 }, (_, i) => T.xpDePiso(i + 1)).reduce((a, b) => a + b));
});

test("trasDerrota: pisos superados = piso − 1 y récord en storage", () => {
  const st = memoria();
  let t = T.nuevaTorre(heroe());
  for (let i = 0; i < 6; i++) t = T.trasVictoria(t).torre;
  const r1 = T.trasDerrota(t, null, { storage: st, address: "0xABC" });
  assert.equal(r1.estado, "terminada");
  assert.equal(r1.piso, 7);
  assert.equal(r1.pisosSuperados, 6);
  assert.equal(r1.nuevoRecord, true);
  assert.equal(r1.record, 6);
  assert.equal(T.cargarRecord(st, "0xabc"), 6, "la clave ignora mayúsculas");
  // Una subida peor no baja el récord.
  const r2 = T.trasDerrota(T.trasVictoria(T.nuevaTorre(heroe())).torre, null, { storage: st, address: "0xabc" });
  assert.equal(r2.pisosSuperados, 1);
  assert.equal(r2.nuevoRecord, false);
  assert.equal(r2.record, 6);
  assert.equal(T.cargarRecord(st, "0xabc"), 6);
  // Sin storage es pura.
  assert.equal(T.trasDerrota(t).recordAnterior, 0);
});

test("récord: storage roto o corrupto no rompe", () => {
  const roto = { getItem() { throw new Error("x"); }, setItem() { throw new Error("x"); } };
  assert.equal(T.cargarRecord(roto, "0x1"), 0);
  assert.equal(T.guardarRecord(roto, "0x1", 4), 4);
  const st = memoria();
  st.setItem(T.claveRecord(null), "basura");
  assert.equal(T.cargarRecord(st, null), 0);
  assert.equal(T.guardarRecord(st, null, 3), 3);
  assert.equal(T.guardarRecord(st, null, 1), 3);
});

test("una subida real con combates termina y suma turnos", () => {
  const r = C.mulberry32(11);
  const res = subida(heroe(), r);
  assert.equal(res.estado, "terminada");
  assert.ok(res.pisosSuperados >= 1);
  assert.ok(res.turnos > res.pisosSuperados);
});

// ───────── Cliente ─────────

const respuesta = (status, body) => ({ status, json: async () => body });

test("enviarPiso: POST /torre con el cuerpo correcto", async () => {
  let llamada;
  const r = await T.enviarPiso("http://s", "0xA", 6, 41.7, {
    fetchImpl: async (url, init) => { llamada = { url, init }; return respuesta(200, { ok: true, record: 6 }); },
  });
  assert.deepEqual(r, { ok: true, body: { ok: true, record: 6 } });
  assert.equal(llamada.url, "http://s/torre");
  assert.equal(llamada.init.method, "POST");
  assert.deepEqual(JSON.parse(llamada.init.body), { address: "0xA", piso: 6, turnos: 41 });
});

test("enviarPiso reintenta ante 503 y luego acierta", async () => {
  let n = 0; const esperas = [];
  const r = await T.enviarPiso("http://s", "0xA", 1, 5, {
    fetchImpl: async () => (++n < 3 ? respuesta(503, null) : respuesta(200, {})),
    dormir: async (ms) => { esperas.push(ms); }, esperaMs: 10,
  });
  assert.equal(r.ok, true);
  assert.equal(n, 3);
  assert.deepEqual(esperas, [10, 20]);
});

test("enviarPiso: 503 persistente, 400 y sin cuenta devuelven error sin lanzar", async () => {
  const s503 = await T.enviarPiso("http://s", "0xA", 1, 5, { fetchImpl: async () => respuesta(503, null), dormir: async () => {}, reintentos: 1 });
  assert.equal(s503.ok, false);
  assert.equal(s503.status, 503);
  assert.match(s503.mensaje, /arrancando/);
  const s400 = await T.enviarPiso("http://s", "0xA", 9, 5, { fetchImpl: async () => respuesta(400, { error: "Piso imposible" }) });
  assert.deepEqual(s400, { ok: false, mensaje: "Piso imposible", status: 400 });
  assert.equal((await T.enviarPiso("http://s", null, 1, 1)).ok, false);
});

test("enviarPiso: timeout devuelve error", async () => {
  const r = await T.enviarPiso("http://s", "0xA", 1, 1, {
    timeoutMs: 5,
    fetchImpl: (_u, { signal }) => new Promise((_ok, ko) => signal.addEventListener("abort", () => ko(Object.assign(new Error("a"), { name: "AbortError" })))),
  });
  assert.equal(r.ok, false);
  assert.match(r.mensaje, /tardó/);
});

test("pedirRankingTorre normaliza, ordena y corta a 20", async () => {
  const lista = Array.from({ length: 25 }, (_, i) => ({ address: `0x${i}`, piso: i }));
  const r = await T.pedirRankingTorre("http://s", { fetchImpl: async (url) => { assert.equal(url, "http://s/torre/ranking"); return respuesta(200, { ranking: lista }); } });
  assert.equal(r.ok, true);
  assert.equal(r.ranking.length, 20);
  assert.deepEqual(r.ranking[0], { address: "0x24", piso: 24 });
  assert.deepEqual(T.normalizarRanking([{ address: "0x1", piso: "3" }, { piso: 2 }, null]), [{ address: "0x1", piso: 3 }]);
  const caido = await T.pedirRankingTorre("http://s", { fetchImpl: async () => { throw new TypeError("fetch failed"); }, dormir: async () => {} });
  assert.equal(caido.ok, false);
});

test("posicionEnRanking ignora mayúsculas", () => {
  const rk = [{ address: "0xAA", piso: 9 }, { address: "0xBb", piso: 4 }];
  assert.equal(T.posicionEnRanking(rk, "0xbb"), 2);
  assert.equal(T.posicionEnRanking(rk, "0xcc"), 0);
  assert.equal(T.posicionEnRanking(rk, null), 0);
});

// ───────── Balance ─────────

function distribucion(h, n, seed) {
  const r = C.mulberry32(seed);
  const xs = Array.from({ length: n }, () => subida(h, r).pisosSuperados).sort((a, b) => a - b);
  return { mediana: xs[Math.floor(xs.length / 2)], xs };
}

test("balance: mediana 5–8 pisos sin equipo; el equipo medio llega bastante más lejos", () => {
  const sin = distribucion(heroe(), 400, 7);
  const med = distribucion(P.statsHeroe(P.progresoNuevo(), EQUIPO_MEDIO), 150, 8);
  assert.ok(sin.mediana >= 5 && sin.mediana <= 8, `sin equipo: ${sin.mediana}`);
  assert.ok(med.mediana >= sin.mediana + 5, `equipo medio: ${med.mediana}`);
});
