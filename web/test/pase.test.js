import { test } from "node:test";
import assert from "node:assert/strict";
import * as P from "../js/pase.js";
import { MS_DIA } from "../js/misiones.js";

const memoria = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
const T1 = P.INICIO_TEMPORADAS + 3 * MS_DIA;

test("temporadas de 4 semanas desde la fecha fija", () => {
  assert.equal(P.temporada(P.INICIO_TEMPORADAS).numero, 1);
  assert.equal(P.temporada(P.INICIO_TEMPORADAS - 1).numero, 1);
  const t = P.temporada(T1);
  assert.equal(t.fin - t.inicio, 28 * MS_DIA);
  assert.equal(t.diasRestantes, 25);
  assert.equal(P.temporada(P.INICIO_TEMPORADAS + 28 * MS_DIA).numero, 2);
  assert.equal(P.temporada(Date.UTC(2026, 10, 5)).numero, 11);
});

test("30 niveles con recompensa; 10/20/30 son ORO on-chain con motivo", () => {
  assert.equal(P.RECOMPENSAS_PASE.length, 30);
  P.RECOMPENSAS_PASE.forEach((r, i) => assert.equal(r.nivel, i + 1));
  const onchain = P.RECOMPENSAS_PASE.filter((r) => r.onchain).map((r) => [r.nivel, r.motivo, r.cantidad]);
  assert.deepEqual(onchain, [[10, "pase10", 100], [20, "pase20", 200], [30, "pase30", 400]]);
  assert.deepEqual(P.nivelPase(0), { nivel: 0, puntosEnNivel: 0, necesarios: 150, pct: 0, max: false });
  assert.equal(P.nivelPase(449).nivel, 2);
  assert.equal(P.nivelPase(1e9).nivel, 30);
  assert.equal(P.nivelPase(1e9).max, true);
});

test("puntos por evento y subidas de nivel", () => {
  assert.equal(P.puntosPorEvento({ tipo: "victoria" }), 5);
  assert.equal(P.puntosPorEvento({ tipo: "jefe" }), 25);
  assert.equal(P.puntosPorEvento({ tipo: "desafio", victoria: true }), 60);
  assert.equal(P.puntosPorEvento({ tipo: "desafio", victoria: false }), 40);
  assert.equal(P.puntosPorEvento({ tipo: "critico" }), 0);
  assert.equal(P.puntosPorEvento(null), 0);
  let r = P.sumarPuntos(null, 140, T1);
  assert.deepEqual(r.niveles, []);
  r = P.registrar(r.progreso, { tipo: "jefe" }, T1);
  assert.deepEqual(r.niveles, [1]);
  r = P.sumarPuntos(r.progreso, 300, T1);
  assert.deepEqual(r.niveles, [2, 3]);
});

test("reclamar niveles alcanzados una sola vez; títulos y marcos", () => {
  let p = P.sumarPuntos(null, 150 * 10, T1).progreso;
  assert.deepEqual(P.pendientesPase(p, T1), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(P.reclamarNivel(p, 11, T1).ok, false);
  assert.equal(P.reclamarNivel(p, 99, T1).ok, false);
  const r10 = P.reclamarNivel(p, 10, T1);
  assert.equal(r10.ok, true);
  assert.equal(r10.recompensa.motivo, "pase10");
  assert.equal(P.reclamarNivel(r10.progreso, 10, T1).ok, false);
  p = r10.progreso;
  for (const n of [4, 5]) p = P.reclamarNivel(p, n, T1).progreso;
  assert.deepEqual(P.desbloqueosPase(p, T1), { titulos: ["aspirante"], marcos: ["marco_bronce"] });
  assert.equal(P.pendientesPase(p, T1).length, 7);
});

test("la temporada nueva reinicia el pase; persistencia", () => {
  const p = P.sumarPuntos(null, 900, T1).progreso;
  const sig = P.estadoPase(p, T1 + 28 * MS_DIA);
  assert.equal(sig.temporada, 2);
  assert.equal(sig.puntos, 0);
  const st = memoria();
  const k = P.clavePase(null);
  assert.equal(k, "lootarena:pase:invitado");
  assert.equal(P.guardarPase(k, p, st), true);
  assert.deepEqual(P.cargarPase(k, st, T1), p);
  assert.equal(P.cargarPase(k, st, T1 + 40 * MS_DIA).puntos, 0);
  st.setItem(k, JSON.stringify({ temporada: 1, puntos: "x", reclamados: [3, 3, 99, "a"] }));
  assert.deepEqual(P.cargarPase(k, st, T1), { version: 1, temporada: 1, puntos: 0, reclamados: [3] });
});
