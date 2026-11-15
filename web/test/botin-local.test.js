import { test } from "node:test";
import assert from "node:assert/strict";
import * as BL from "../js/botin-local.js";
import * as E from "../js/equipment.js";

/** RNG determinista (mulberry32). */
function rngSemilla(semilla) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("la primera victoria en demo siempre suelta un objeto Raro", () => {
  for (let s = 1; s <= 30; s++) {
    const { item, estado } = BL.tirarBotinLocal(BL.estadoVacio(), { nivel: 1 }, rngSemilla(s));
    assert.ok(item);
    assert.equal(item.rareza, 1);
    assert.equal(item.local, true);
    assert.equal(item.tokenId, "1");
    assert.equal(estado.primeroEntregado, true);
    assert.equal(estado.items.length, 1);
  }
});

test("tras el primero, cae con probabilidad DROP_CHANCE; los jefes siempre sueltan", () => {
  const inicial = { ...BL.estadoVacio(), primeroEntregado: true };
  assert.equal(BL.tirarBotinLocal(inicial, { nivel: 3 }, () => 0.99).item, null);
  assert.ok(BL.tirarBotinLocal(inicial, { nivel: 3, jefe: true }, () => 0.99).item);
  let caidos = 0;
  const rng = rngSemilla(7);
  for (let i = 0; i < 2000; i++) if (BL.tirarBotinLocal(inicial, { nivel: 3 }, rng).item) caidos++;
  assert.ok(Math.abs(caidos / 2000 - BL.DROP_CHANCE) < 0.05, `tasa ${caidos / 2000}`);
});

test("los objetos tienen tipo válido, ids crecientes y stats dentro de su rango", () => {
  let estado = BL.estadoVacio();
  const rng = rngSemilla(42);
  for (let i = 0; i < 200; i++) estado = BL.tirarBotinLocal(estado, { nivel: 1 + (i % 10), jefe: i % 7 === 0 }, rng).estado;
  const ids = estado.items.map((it) => Number(it.tokenId));
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
  assert.equal(new Set(ids).size, ids.length);
  for (const it of estado.items) {
    assert.ok(E.TIPOS.includes(it.tipo), it.tipo);
    assert.ok(it.nombre.length > 0);
    const principal = it.tipo === "Espada" ? it.ataque : it.defensa;
    const [min, max] = [[1, 6], [6, 14], [14, 30]][it.rareza];
    assert.ok(principal >= min && principal <= max, `${it.nombre}: ${principal}`);
  }
});

test("el pity reinicia al salir un Legendario y sube la probabilidad", () => {
  assert.equal(BL.probabilidadesRareza(1, { sinLegendario: 15 })[2], 0.5);
  assert.ok(BL.probabilidadesRareza(10, { jefe: true })[2] > BL.probabilidadesRareza(1)[2]);
  const estado = { ...BL.estadoVacio(), primeroEntregado: true, sinLegendario: 20 };
  const r = BL.tirarBotinLocal(estado, { nivel: 1, jefe: true }, () => 0.1);
  assert.equal(r.item.rareza, 2);
  assert.equal(r.estado.sinLegendario, 0);
});

test("se guarda y se recupera de JSON; los datos corruptos no rompen nada", () => {
  const { estado } = BL.tirarBotinLocal(BL.estadoVacio(), { nivel: 2 }, rngSemilla(3));
  assert.deepEqual(BL.parsearEstado(BL.serializarEstado(estado)), estado);
  assert.deepEqual(BL.parsearEstado("no json"), BL.estadoVacio());
  assert.deepEqual(BL.parsearEstado(null), BL.estadoVacio());
  const sucio = BL.parsearEstado(JSON.stringify({ siguienteId: 1, items: [
    { tokenId: 5, nombre: "Ok", tipo: "Casco", rareza: 0, ataque: 0, defensa: 3 },
    { tokenId: "x", nombre: "Mal id", tipo: "Casco", rareza: 0, ataque: 0, defensa: 3 },
    { tokenId: "6", nombre: "Mal tipo", tipo: "Lanza", rareza: 0, ataque: 0, defensa: 3 },
  ] }));
  assert.equal(sucio.items.length, 1);
  assert.equal(sucio.items[0].tokenId, "5");
  assert.equal(sucio.siguienteId, 6, "no reutiliza ids ya usados");
});

test("el botín local se puede equipar y suma sus stats al héroe", () => {
  let estado = BL.estadoVacio();
  const rng = rngSemilla(11);
  while (estado.items.length < 10) estado = BL.tirarBotinLocal(estado, { nivel: 5, jefe: true }, rng).estado;
  const espada = estado.items.find((it) => it.tipo === "Espada") ?? estado.items[0];
  const equipo = E.equipar({}, espada);
  assert.deepEqual(E.parsearEquipo(JSON.stringify(equipo)), equipo, "el equipo local pasa la validación");
  const s = E.statsJugador(E.itemsEquipados(equipo, estado.items));
  assert.equal(s.ataque, E.statsJugador([]).ataque + espada.ataque);
  assert.equal(s.defensa, E.statsJugador([]).defensa + espada.defensa);
});

test("al llenarse la mochila se descarta el más débil, nunca uno equipado", () => {
  const items = Array.from({ length: BL.MAX_OBJETOS }, (_, i) =>
    ({ tokenId: String(i + 1), nombre: `C${i}`, tipo: "Casco", rareza: 0, ataque: 0, defensa: i === 0 ? 0 : 5, local: true }));
  const estado = { ...BL.estadoVacio(), primeroEntregado: true, siguienteId: items.length + 1, items };
  const equipadoDebil = BL.tirarBotinLocal(estado, { jefe: true }, () => 0.5, { equipados: ["1"] }).estado;
  assert.equal(equipadoDebil.items.length, BL.MAX_OBJETOS);
  assert.ok(equipadoDebil.items.some((it) => it.tokenId === "1"), "el equipado se conserva");
  const libre = BL.tirarBotinLocal(estado, { jefe: true }, () => 0.5).estado;
  assert.ok(!libre.items.some((it) => it.tokenId === "1"), "sin equipar, cae el más débil");
});
