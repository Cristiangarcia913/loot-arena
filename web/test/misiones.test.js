import { test } from "node:test";
import assert from "node:assert/strict";
import * as M from "../js/misiones.js";
import * as C from "../js/combat.js";

const memoria = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
const HOY = Date.UTC(2026, 10, 5, 15, 0); // jueves
const MANANA = HOY + M.MS_DIA;

test("día y semana UTC; cuentas atrás", () => {
  assert.equal(M.diaUTC(Date.UTC(1970, 0, 2)), 1);
  assert.equal(M.diaUTC(HOY), Math.floor(HOY / 86_400_000));
  const lunes = Date.UTC(2026, 10, 2);
  assert.equal(M.semanaUTC(lunes), M.semanaUTC(Date.UTC(2026, 10, 8, 23, 59)));
  assert.equal(M.semanaUTC(lunes) - 1, M.semanaUTC(lunes - 1));
  assert.equal(M.msHastaManana(HOY), 9 * 3_600_000);
  assert.equal(M.msHastaProximaSemana(lunes), 7 * M.MS_DIA);
});

test("misiones del día: 3 distintas, iguales para todos ese día y cambian otro día", () => {
  const a = M.misionesDelDia(20000);
  assert.equal(a.length, 3);
  assert.equal(new Set(a.map((m) => m.plantilla)).size, 3);
  assert.deepEqual(M.misionesDelDia(20000), a);
  const distintos = new Set();
  for (let d = 20000; d < 20030; d++) distintos.add(M.misionesDelDia(d).map((m) => m.plantilla).join());
  assert.ok(distintos.size > 20);
  for (const m of a) assert.ok(m.texto && m.objetivo > 0 && m.progreso === 0);
  assert.ok(M.misionSemanal(3000).texto);
  assert.ok(M.PLANTILLAS_DIARIAS.length >= 7);
});

test("registrar avanza el progreso, completa y reclama; el bonus pide las 3", () => {
  let p = M.estadoMisiones(null, HOY);
  // forzamos misiones conocidas para el test
  const mk = (plantilla, objetivo, dificultad = 0) => ({ id: `t:${plantilla}`, plantilla, icono: "", texto: "", objetivo, progreso: 0, completada: false, reclamada: false, dificultad });
  p = { ...p, diarias: [mk("ganar", 2), mk("criticos", 3, 1), mk("racha", 3)], semanal: { ...mk("jefes_semana", 3), id: "s:jefes" } };
  let r = M.registrar(p, { tipo: "victoria", nivel: 1 }, HOY);
  assert.equal(r.progreso.diarias[0].progreso, 1);
  assert.equal(r.completadas.length, 0);
  r = M.registrar(r.progreso, { tipo: "victoria", nivel: 1 }, HOY);
  assert.equal(r.completadas[0].id, "t:ganar");
  r = M.registrar(r.progreso, { tipo: "critico", cantidad: 5 }, HOY);
  assert.equal(r.progreso.diarias[1].progreso, 3); // se topa en el objetivo
  r = M.registrar(r.progreso, { tipo: "racha", valor: 2 }, HOY);
  r = M.registrar(r.progreso, { tipo: "racha", valor: 1 }, HOY);
  assert.equal(r.progreso.diarias[2].progreso, 2); // modo máximo
  r = M.registrar(r.progreso, { tipo: "racha", valor: 3 }, HOY);
  p = r.progreso;
  assert.equal(M.pendientesMisiones(p), 3);
  assert.equal(M.reclamar(p, "bonus", HOY).ok, false);
  let q = M.reclamar(p, "t:ganar", HOY);
  assert.deepEqual(q.recompensa, M.RECOMPENSA_DIARIA[0]);
  assert.equal(M.reclamar(q.progreso, "t:ganar", HOY).ok, false);
  q = M.reclamar(q.progreso, "t:criticos", HOY);
  assert.deepEqual(q.recompensa, M.RECOMPENSA_DIARIA[1]);
  q = M.reclamar(q.progreso, "t:racha", HOY);
  assert.equal(M.bonusDisponible(q.progreso), true);
  q = M.reclamar(q.progreso, "bonus", HOY);
  assert.equal(q.ok, true);
  assert.equal(q.recompensa.motivo, "misiones_diarias");
  assert.equal(M.reclamar(q.progreso, "bonus", HOY).ok, false);
  assert.equal(M.pendientesMisiones(q.progreso), 0);
  // semanal
  let s = q.progreso;
  for (let i = 0; i < 3; i++) s = M.registrar(s, { tipo: "jefe" }, HOY).progreso;
  const rs = M.reclamar(s, "s:jefes", HOY);
  assert.deepEqual(rs.recompensa, M.RECOMPENSA_SEMANAL);
  assert.equal(M.reclamar(s, "nada", HOY).ok, false);
  assert.equal(M.reclamar(M.estadoMisiones(null, HOY), M.estadoMisiones(null, HOY).diarias[0].id, HOY).ok, false);
});

test("filtro: 'intocable' solo cuenta victorias con poco daño recibido", () => {
  const p0 = M.estadoMisiones(null, HOY);
  const p = { ...p0, diarias: [{ id: "x", plantilla: "intocable", objetivo: 1, progreso: 0, completada: false, reclamada: false, dificultad: 0 }] };
  assert.equal(M.registrar(p, { tipo: "victoria", danoRecibido: 50 }, HOY).completadas.length, 0);
  assert.equal(M.registrar(p, { tipo: "victoria", danoRecibido: 5 }, HOY).completadas.length, 1);
});

test("al cambiar de día rotan las diarias y se conserva la semanal de la semana", () => {
  let p = M.estadoMisiones(null, HOY);
  p = M.registrar(p, { tipo: "victoria" }, HOY).progreso;
  const sem = p.semanal;
  const q = M.estadoMisiones(p, MANANA);
  assert.equal(q.dia, p.dia + 1);
  assert.deepEqual(q.diarias, M.misionesDelDia(q.dia));
  assert.deepEqual(q.semanal, sem); // jueves → viernes, misma semana
  const otraSemana = M.estadoMisiones(p, HOY + 7 * M.MS_DIA);
  assert.notEqual(otraSemana.semana, p.semana);
});

test("eventos ignorados y persistencia con storage inyectable", () => {
  const p = M.estadoMisiones(null, HOY);
  assert.deepEqual(M.registrar(p, null, HOY).progreso, p);
  assert.deepEqual(M.registrar(p, { nada: 1 }, HOY).completadas, []);
  const st = memoria();
  const k = M.claveMisiones("0xAA");
  assert.equal(k, "lootarena:misiones:0xaa");
  assert.deepEqual(M.cargarMisiones(k, st, HOY), M.estadoMisiones(null, HOY));
  const p2 = M.registrar(p, { tipo: "victoria" }, HOY).progreso;
  assert.equal(M.guardarMisiones(k, p2, st), true);
  assert.deepEqual(M.cargarMisiones(k, st, HOY), p2);
  st.setItem(k, "basura{");
  assert.deepEqual(M.cargarMisiones(k, st, HOY), M.estadoMisiones(null, HOY));
  assert.equal(M.guardarMisiones(k, p2, { setItem() { throw new Error("x"); } }), false);
});

test("eventosDeCombate traduce un combate terminado", () => {
  const rng = C.mulberry32(3);
  const jefe = C.generarEnemigo(2, rng, { jefe: true });
  let c = C.crearCombate({ ...C.STATS_BASE, ataque: 200 }, jefe, rng);
  assert.deepEqual(M.eventosDeCombate(c), []);
  while (c.fase === "en_curso") c = C.turnoJugador(c, "atacar", rng).combate;
  const ev = M.eventosDeCombate(c);
  assert.equal(ev[0].tipo, "victoria");
  assert.equal(ev[0].jefe, true);
  assert.equal(ev[0].clave, jefe.clave);
  assert.ok(ev.some((e) => e.tipo === "jefe"));
  assert.ok(ev.some((e) => e.tipo === "dano" && e.cantidad > 0));
  assert.deepEqual(M.eventosDeCombate(C.huir(C.crearCombate(C.STATS_BASE, jefe, rng))).map((e) => e.tipo), ["huida"]);
});
