import { test } from "node:test";
import assert from "node:assert/strict";
import * as L from "../js/logros.js";
import { BESTIARIO } from "../js/combat.js";

const memoria = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
const T = 1_800_000_000_000;

test("al menos 30 logros bien formados, ids únicos y títulos con texto", () => {
  assert.ok(L.LOGROS.length >= 30, `${L.LOGROS.length}`);
  assert.equal(new Set(L.LOGROS.map((l) => l.id)).size, L.LOGROS.length);
  for (const l of L.LOGROS) {
    assert.ok(l.id && l.nombre && l.descripcion && l.icono && l.categoria && l.objetivo > 0, l.id);
    if (l.titulo) assert.ok(L.TITULOS[l.titulo], l.titulo);
  }
  assert.ok(L.LOGROS.filter((l) => l.titulo).length >= 8);
});

test("evaluación incremental: se desbloquea una sola vez", () => {
  let r = L.registrar(null, { tipo: "victoria", nivel: 1, clave: "rata", danoRecibido: 12, turnos: 6 }, T);
  assert.deepEqual(r.nuevos.map((l) => l.id), ["primera_victoria"]);
  r = L.registrar(r.progreso, { tipo: "victoria", nivel: 10, clave: "dragon", danoRecibido: 0, turnos: 2 }, T + 1);
  assert.deepEqual(r.nuevos.map((l) => l.id).sort(), ["intocable", "nivel_10", "relampago"]);
  assert.equal(r.progreso.desbloqueados.primera_victoria, T);
  r = L.registrar(r.progreso, { tipo: "victoria", nivel: 1, clave: "rata" }, T + 2);
  assert.deepEqual(r.nuevos, []);
  assert.equal(r.progreso.c.victorias, 3);
  assert.deepEqual(r.progreso.c.bestiario, ["rata", "dragon"]);
});

test("contadores con cantidad, rachas, botín, inventario y cosméticos", () => {
  const { progreso, nuevos } = L.registrarVarios(null, [
    { tipo: "critico", cantidad: 25 },
    { tipo: "racha", valor: 10 },
    { tipo: "racha", valor: 3 },
    { tipo: "botin", item: { tipo: "Espada", rareza: 2 } },
    { tipo: "inventario", items: ["Escudo", "Casco", "Armadura", "Botas"].map((tipo) => ({ tipo, rareza: 0 })) },
    { tipo: "cosmeticos", ids: [1, 2, 3, 4, 14, 14] },
    { tipo: "venta", cantidad: 2, oro: 1200 },
  ], T);
  const ids = nuevos.map((l) => l.id);
  for (const id of ["criticos_25", "racha_5", "racha_10", "primer_botin", "primer_legendario", "uno_de_cada", "primera_venta", "oro_1000"]) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes("cosmeticos_5")); // el 14 (poción) no cuenta
  assert.equal(progreso.c.rachaMax, 10);
  assert.equal(progreso.c.cosmeticos, 4);
});

test("bestiario completo y jefes de todas las criaturas", () => {
  const evs = BESTIARIO.flatMap((b) => [{ tipo: "victoria", clave: b.clave, jefe: true }, { tipo: "jefe", clave: b.clave }]);
  const { nuevos } = L.registrarVarios(null, evs, T);
  const ids = nuevos.map((l) => l.id);
  assert.ok(ids.includes("bestiario_completo"));
  assert.ok(ids.includes("jefes_todos"));
  assert.ok(ids.includes("jefes_10"));
});

test("lista para la UI, resumen y títulos", () => {
  const { progreso } = L.registrarVarios(null, [{ tipo: "racha", valor: 10 }, { tipo: "titulo", id: "campeon_temporada" }], T);
  const lista = L.listaLogros(progreso);
  assert.equal(lista.length, L.LOGROS.length);
  const imp = lista.find((l) => l.id === "racha_10");
  assert.equal(imp.desbloqueado, true);
  assert.equal(imp.tituloTexto, "Imparable");
  const v10 = lista.find((l) => l.id === "victorias_10");
  assert.deepEqual([v10.actual, v10.objetivo, v10.pct, v10.desbloqueado], [0, 10, 0, false]);
  assert.equal(L.resumenLogros(progreso).desbloqueados, 2); // racha_5 y racha_10
  assert.deepEqual(L.titulosDisponibles(progreso).sort(), ["campeon_temporada", "imparable"]);
  assert.equal(L.elegirTitulo(progreso, "matajefes").ok, false);
  const e = L.elegirTitulo(progreso, "imparable");
  assert.equal(e.progreso.titulo, "imparable");
  assert.equal(L.elegirTitulo(e.progreso, null).progreso.titulo, null);
  assert.equal(L.textoTitulo("imparable"), "Imparable");
  assert.equal(L.textoTitulo("campeon_temporada", { campeon_temporada: "Campeón de temporada" }), "Campeón de temporada");
});

test("persistencia y datos corruptos", () => {
  const st = memoria();
  const k = L.claveLogros("0xBB");
  const { progreso } = L.registrarVarios(null, [{ tipo: "victoria", clave: "lobo" }], T);
  assert.equal(L.guardarLogros(k, progreso, st), true);
  assert.deepEqual(L.cargarLogros(k, st), progreso);
  st.setItem(k, JSON.stringify({ c: { victorias: "x", bestiario: "no" }, desbloqueados: { falso: 1, primera_victoria: 5 }, titulo: "invicto" }));
  const s = L.cargarLogros(k, st);
  assert.equal(s.c.victorias, 0);
  assert.deepEqual(s.c.bestiario, []);
  assert.deepEqual(Object.keys(s.desbloqueados), ["primera_victoria"]);
  assert.equal(s.titulo, null); // no desbloqueado
  st.setItem(k, "{{");
  assert.deepEqual(L.cargarLogros(k, st), L.logrosNuevos());
});
