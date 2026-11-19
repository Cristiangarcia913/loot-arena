import { test } from "node:test";
import assert from "node:assert/strict";
import * as HL from "../js/historial-local.js";

test("anadirEntrada añade al principio y descarta lo inválido", () => {
  let lista = HL.anadirEntrada([], { tipo: "compra", titulo: "Compraste algo" });
  assert.equal(lista.length, 1);
  assert.equal(lista[0].titulo, "Compraste algo");
  assert.deepEqual(lista[0].detalle, []);
  assert.equal(lista[0].oro, null);

  lista = HL.anadirEntrada(lista, { tipo: "venta", titulo: "Vendiste algo", oro: 5n, eth: 1n, hash: "0xabc" });
  assert.equal(lista.length, 2);
  assert.equal(lista[0].titulo, "Vendiste algo", "la más reciente va primero");
  assert.equal(lista[1].titulo, "Compraste algo");

  assert.equal(HL.anadirEntrada(lista, { tipo: "", titulo: "sin tipo" }).length, 2, "sin tipo se ignora");
  assert.equal(HL.anadirEntrada(lista, { tipo: "x", titulo: "" }).length, 2, "sin título se ignora");
  assert.equal(HL.anadirEntrada(lista, null).length, 2, "null no rompe nada");
});

test("anadirEntrada recorta a MAX_ENTRADAS", () => {
  let lista = [];
  for (let i = 0; i < HL.MAX_ENTRADAS + 10; i++) {
    lista = HL.anadirEntrada(lista, { tipo: "compra", titulo: `#${i}` });
  }
  assert.equal(lista.length, HL.MAX_ENTRADAS);
  assert.equal(lista[0].titulo, `#${HL.MAX_ENTRADAS + 9}`, "se queda con las más recientes");
});

test("serializarHistorial + parsearHistorial dan la vuelta completa, con bigint incluido", () => {
  const lista = HL.anadirEntrada([], {
    tipo: "venta", titulo: "Vendiste un objeto", detalle: ["al Mercado"], oro: 12n * 10n ** 18n, eth: 5n * 10n ** 14n, hash: "0xdead",
  });
  const texto = HL.serializarHistorial(lista);
  assert.doesNotThrow(() => JSON.parse(texto), "nada de bigint sin convertir: JSON.stringify no lanza");
  const vuelta = HL.parsearHistorial(texto);
  assert.equal(vuelta.length, 1);
  assert.equal(vuelta[0].oro, 12n * 10n ** 18n);
  assert.equal(vuelta[0].eth, 5n * 10n ** 14n);
  assert.equal(vuelta[0].hash, "0xdead");
  assert.deepEqual(vuelta[0].detalle, ["al Mercado"]);
});

test("parsearHistorial no se rompe con JSON roto, algo que no es lista, o entradas corruptas", () => {
  assert.deepEqual(HL.parsearHistorial(null), []);
  assert.deepEqual(HL.parsearHistorial(""), []);
  assert.deepEqual(HL.parsearHistorial("{no es json"), []);
  assert.deepEqual(HL.parsearHistorial(JSON.stringify({ no: "es una lista" })), []);
  const conBasura = JSON.stringify([
    { tipo: "compra", titulo: "válida" },
    { tipo: "compra", titulo: "oro ilegible", oro: "no-es-un-numero" },
    { titulo: "sin tipo" },
    { tipo: "venta" }, // sin título
    null,
  ]);
  const r = HL.parsearHistorial(conBasura);
  assert.equal(r.length, 1);
  assert.equal(r[0].titulo, "válida");
});

test("parsearHistorial respeta MAX_ENTRADAS aunque el JSON guardado tenga más", () => {
  const crudo = Array.from({ length: HL.MAX_ENTRADAS + 5 }, (_, i) => ({ tipo: "compra", titulo: `#${i}` }));
  const r = HL.parsearHistorial(JSON.stringify(crudo));
  assert.equal(r.length, HL.MAX_ENTRADAS);
});
