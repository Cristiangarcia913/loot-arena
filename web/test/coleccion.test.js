import { test } from "node:test";
import assert from "node:assert/strict";
import * as K from "../js/coleccion.js";
import { CATALOGO } from "../js/economy.js";
import { BESTIARIO } from "../js/combat.js";

const memoria = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };

test("colección vacía: 0 %", () => {
  const r = K.resumenColeccion(null, CATALOGO);
  assert.equal(r.bestiario.entradas.length, BESTIARIO.length);
  assert.equal(r.bestiario.total, BESTIARIO.length * 2);
  assert.equal(r.objetos.total, 15);
  assert.equal(r.cosmeticos.total, 13);
  assert.equal(r.total.pct, 0);
  assert.equal(r.cosmeticos.entradas[0].nombre, "Armadura carmesí");
});

test("bestiario: vencidos, jefes y entradas nuevas", () => {
  let r = K.registrar(null, { tipo: "victoria", clave: "rata" });
  assert.deepEqual(r.nuevos, [{ tipo: "bestiario", clave: "rata" }]);
  r = K.registrar(r.progreso, { tipo: "victoria", clave: "rata", jefe: true });
  assert.deepEqual(r.nuevos, [{ tipo: "jefe", clave: "rata" }]);
  r = K.registrar(r.progreso, { tipo: "victoria", clave: "rata" });
  assert.deepEqual(r.nuevos, []);
  assert.deepEqual(r.progreso.bestiario.rata, { vencidos: 3, jefes: 1 });
  assert.deepEqual(K.registrar(r.progreso, { tipo: "victoria", clave: "unicornio" }).nuevos, []);
  const res = K.resumenColeccion(r.progreso);
  assert.equal(res.bestiario.hechas, 2);
  assert.equal(res.bestiario.entradas[0].jefeDerrotado, true);
});

test("álbum de objetos (tipo × rareza) y cosméticos (sin el consumible)", () => {
  let r = K.registrar(null, { tipo: "botin", item: { tipo: "Espada", rareza: 2 } });
  assert.deepEqual(r.nuevos, [{ tipo: "objeto", celda: "Espada:2" }]);
  r = K.registrar(r.progreso, { tipo: "inventario", items: [{ tipo: "Espada", rareza: 2 }, { tipo: "Botas", rareza: 0 }, { tipo: "Otro", rareza: 0 }] });
  assert.deepEqual(r.nuevos, [{ tipo: "objeto", celda: "Botas:0" }]);
  r = K.registrar(r.progreso, { tipo: "cosmeticos", ids: [1, 6, 14] });
  assert.equal(r.nuevos.length, 2);
  r = K.registrar(r.progreso, { tipo: "compra", id: 9 });
  assert.deepEqual(r.nuevos, [{ tipo: "cosmetico", id: 9 }]);
  const res = K.resumenColeccion(r.progreso, CATALOGO);
  assert.equal(res.objetos.hechas, 2);
  assert.equal(res.cosmeticos.hechas, 3);
  assert.equal(res.total.hechas, 5);
  assert.ok(Math.abs(res.total.pct - 5 / (BESTIARIO.length * 2 + 15 + 13)) < 1e-9);
});

test("persistencia y saneo", () => {
  const st = memoria();
  const k = K.claveColeccion("0xCC");
  const { progreso } = K.registrar(null, { tipo: "victoria", clave: "lobo" });
  assert.equal(K.guardarColeccion(k, progreso, st), true);
  assert.deepEqual(K.cargarColeccion(k, st), progreso);
  st.setItem(k, JSON.stringify({ bestiario: { lobo: { vencidos: "2" }, falso: { vencidos: 3 } }, objetos: ["Espada:1", "X:9"], cosmeticos: [3, 14, 99] }));
  assert.deepEqual(K.cargarColeccion(k, st), { version: 1, bestiario: { lobo: { vencidos: 2, jefes: 0 } }, objetos: ["Espada:1"], cosmeticos: [3] });
  st.setItem(k, "no json");
  assert.deepEqual(K.cargarColeccion(k, st), K.coleccionNueva());
});
