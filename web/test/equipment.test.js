import { test } from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/equipment.js";

const item = (tokenId, tipo, ataque = 0, defensa = 0, rareza = 0) =>
  ({ tokenId: String(tokenId), nombre: `${tipo} ${tokenId}`, tipo, rareza, ataque, defensa });

test("colores de rareza según SPEC", () => {
  assert.equal(E.rareza(0).color, "#9ca3af");
  assert.equal(E.rareza(1).color, "#3b82f6");
  assert.equal(E.rareza(2).color, "#f59e0b");
  assert.equal(E.rareza(2).nombre, "Legendario");
  assert.equal(E.rareza(7).nombre, "Desconocida");
});

test("stats base sin equipo: 100 / 10 / 5", () => {
  const s = E.statsJugador([]);
  assert.deepEqual([s.vida, s.ataque, s.defensa], [100, 10, 5]);
});

test("el equipo suma ataque y defensa", () => {
  const s = E.statsJugador([item(1, "Espada", 12, 3), item(2, "Escudo", 1, 8)]);
  assert.equal(s.ataque, 23);
  assert.equal(s.defensa, 16);
  assert.equal(s.bonusAtaque, 13);
});

test("máximo un objeto por tipo: equipar sustituye", () => {
  let eq = E.equipar({}, item(1, "Espada"));
  eq = E.equipar(eq, item(2, "Escudo"));
  eq = E.equipar(eq, item(3, "Espada"));
  assert.deepEqual(eq, { Espada: "3", Escudo: "2" });
  assert.ok(!E.estaEquipado(eq, "1"));
  assert.ok(E.estaEquipado(eq, 3));
});

test("desequipar no muta el original", () => {
  const eq = { Espada: "3", Escudo: "2" };
  const nuevo = E.desequipar(eq, "3");
  assert.deepEqual(nuevo, { Escudo: "2" });
  assert.deepEqual(eq, { Espada: "3", Escudo: "2" });
});

test("sanearEquipo descarta tokens que ya no se poseen o con tipo distinto", () => {
  const inv = [item(1, "Espada"), item(2, "Casco")];
  const eq = { Espada: "1", Escudo: "9", Botas: "2" };
  assert.deepEqual(E.sanearEquipo(eq, inv), { Espada: "1" });
  assert.deepEqual(E.sanearEquipo(null, inv), {});
});

test("itemsEquipados devuelve los objetos del inventario", () => {
  const inv = [item(1, "Espada", 5), item(2, "Casco", 0, 4), item(3, "Botas", 0, 2)];
  assert.deepEqual(E.itemsEquipados({ Espada: "1", Botas: "3" }, inv).map((i) => i.tokenId), ["1", "3"]);
});

test("persistencia: clave por dirección/cadena y parseo robusto", () => {
  assert.equal(E.claveEquipo("0xABC", 11155111), "lootarena:equipo:11155111:0xabc");
  assert.deepEqual(E.parsearEquipo('{"Espada":"4","Casco":7,"x":"abc"}'), { Espada: "4" });
  assert.deepEqual(E.parsearEquipo("no-json"), {});
  assert.deepEqual(E.parsearEquipo("[1,2]"), {});
  assert.deepEqual(E.parsearEquipo(null), {});
});

test("normalizarItem convierte BigInt y strings", () => {
  const it = E.normalizarItem({ nombre: "Espada Rúnica", tipo: "Espada", rareza: 1n, ataque: 12n, defensa: 2n }, 5n);
  assert.deepEqual(it, { tokenId: "5", nombre: "Espada Rúnica", tipo: "Espada", rareza: 1, ataque: 12, defensa: 2 });
});

test("ordenarInventario: equipados primero, luego rareza", () => {
  const inv = [item(1, "Espada", 1, 0, 0), item(2, "Casco", 0, 1, 2), item(3, "Botas", 0, 1, 1)];
  assert.deepEqual(E.ordenarInventario(inv, { Espada: "1" }).map((i) => i.tokenId), ["1", "2", "3"]);
});
