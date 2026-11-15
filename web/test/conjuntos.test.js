import { test } from "node:test";
import assert from "node:assert/strict";
import * as S from "../js/conjuntos.js";
import * as BL from "../js/botin-local.js";
import * as C from "../js/combat.js";
import { statsHeroe, progresoNuevo } from "../js/progression.js";
import { statsJugador } from "../js/equipment.js";
import { tooltipConjunto } from "../js/inventario.js";

const pieza = (tokenId, tipo, conjunto, ataque = 2, defensa = 4) =>
  ({ tokenId: String(tokenId), nombre: `${tipo} ${tokenId}`, tipo, rareza: 1, ataque, defensa, ...(conjunto ? { conjunto } : {}) });
const TIPOS = ["Espada", "Escudo", "Casco", "Armadura", "Botas"];
const setDe = (id, n) => TIPOS.slice(0, n).map((t, i) => pieza(i + 1, t, id));

test("hay 3 conjuntos temáticos con bono de 2 y efecto de 4 piezas", () => {
  assert.deepEqual(S.IDS_CONJUNTO, ["gladiador", "coloso", "sombras"]);
  assert.equal(S.CONJUNTOS.gladiador.nombre, "Set del Gladiador Sangriento");
  assert.equal(S.CONJUNTOS.coloso.nombre, "Set del Coloso de Hierro");
  assert.equal(S.CONJUNTOS.sombras.nombre, "Set de las Sombras");
});

test("conjuntoDe: por campo explícito o por el sufijo del nombre (NFT)", () => {
  assert.equal(S.conjuntoDe({ conjunto: "coloso", nombre: "x" }), "coloso");
  assert.equal(S.conjuntoDe({ nombre: "Sable Rúnico del Gladiador Sangriento" }), "gladiador");
  assert.equal(S.conjuntoDe({ nombre: "Yelmo Arcano de las Sombras" }), "sombras");
  assert.equal(S.conjuntoDe({ nombre: "Espada Oxidada" }), null);
  assert.equal(S.conjuntoDe({ conjunto: "inventado", nombre: "Botas" }), null);
  assert.equal(S.conjuntoDe(null), null);
});

test("contarConjuntos cuenta piezas por tipo y marca bono (2) y efecto (4)", () => {
  const eq = [...setDe("gladiador", 2), pieza(9, "Armadura", "coloso")];
  const r = S.contarConjuntos(eq);
  assert.deepEqual(r.map((x) => [x.id, x.piezas, x.bonoActivo, x.efectoActivo]), [["gladiador", 2, true, false], ["coloso", 1, false, false]]);
  assert.equal(S.textoProgreso("gladiador", 2), "Set del Gladiador 2/4");
  assert.equal(S.textoProgreso("sombras", 5), "Set de las Sombras 4/4");
  const cuatro = S.bonosConjunto(setDe("gladiador", 4));
  assert.equal(cuatro.critico, 0.15);
  assert.deepEqual(cuatro.efectos, ["sangradoCritico"]);
  assert.deepEqual(S.bonosConjunto(setDe("coloso", 1)), { critico: 0, esquiva: 0, multDefensa: 0, efectos: [] });
});

test("2 piezas: +15 % crítico (Gladiador), +20 % defensa (Coloso), +10 % esquiva (Sombras)", () => {
  const p = progresoNuevo();
  const sinSet = (n) => statsHeroe(p, TIPOS.slice(0, n).map((t, i) => pieza(i + 1, t, null)));
  const glad = statsHeroe(p, setDe("gladiador", 2));
  assert.ok(Math.abs(glad.critico - (sinSet(2).critico + 0.15)) < 1e-9);
  const col = statsHeroe(p, setDe("coloso", 2));
  assert.equal(col.defensa, Math.round(sinSet(2).defensa * 1.2));
  const som = statsHeroe(p, setDe("sombras", 2));
  assert.ok(som.esquiva > sinSet(2).esquiva + 0.09);
  assert.deepEqual(glad.efectosConjunto, []);
  assert.deepEqual(statsHeroe(p, setDe("coloso", 4)).efectosConjunto, ["escudoVidaBaja"]);
  assert.equal(statsJugador(setDe("coloso", 2)).defensa, Math.round((5 + 8) * 1.2));
});

const enemigoDummy = (o = {}) => ({ clave: "x", nombre: "Muñeco", emoji: "🎯", nivel: 1, jefe: false, vidaMax: 500, ataque: 1, defensa: 0, esquiva: 0, ...o });

test("4 piezas Gladiador: los críticos aplican sangrado", () => {
  const heroe = { ...statsHeroe(progresoNuevo(), setDe("gladiador", 4)), critico: 1 };
  const c = C.crearCombate(heroe, enemigoDummy(), () => 0.99);
  const { combate, eventos } = C.turnoJugador(c, "atacar", () => 0.5);
  assert.ok(eventos.some((e) => e.id === "set_gladiador"));
  assert.ok(combate.enemigo.estados.some((e) => e.tipo === "sangrado" && e.valor > 0));
  // Sin el set, el crítico no hace sangrar.
  const sin = C.crearCombate({ ...statsHeroe(progresoNuevo(), []), critico: 1 }, enemigoDummy(), () => 0.99);
  assert.ok(!C.turnoJugador(sin, "atacar", () => 0.5).combate.enemigo.estados.some((e) => e.tipo === "sangrado"));
});

test("4 piezas Coloso: escudo al bajar del 20 % de vida, una sola vez", () => {
  const heroe = statsHeroe(progresoNuevo(), setDe("coloso", 4));
  let c = C.crearCombate({ ...heroe, esquiva: 0 }, enemigoDummy({ ataque: 60 }), () => 0.99);
  c = { ...c, jugador: { ...c.jugador, vida: Math.round(c.jugador.vidaMax * 0.3) } };
  const { combate, eventos } = C.turnoJugador(c, "defender", () => 0.5);
  assert.ok(combate.jugador.vida > 0 && combate.jugador.vida <= combate.jugador.vidaMax * 0.2);
  assert.ok(eventos.some((e) => e.id === "set_coloso"), "se activa el escudo");
  assert.ok(combate.jugador.estados.some((e) => e.tipo === "escudo" && e.valor > 0));
  assert.equal(combate.jugador.escudoSetUsado, true);
  const r2 = C.turnoJugador({ ...combate, jugador: { ...combate.jugador, estados: [], vida: 5 } }, "defender", () => 0.5);
  assert.ok(!r2.eventos.some((e) => e.id === "set_coloso"), "no se repite");
});

test("4 piezas Sombras: tras esquivar, el siguiente golpe es crítico seguro", () => {
  const heroe = { ...statsHeroe(progresoNuevo(), setDe("sombras", 4)), esquiva: 1, critico: 0 };
  const c = C.crearCombate(heroe, enemigoDummy(), () => 0.99);
  const r1 = C.turnoJugador(c, "defender", () => 0.5);
  assert.ok(r1.eventos.some((e) => e.id === "set_sombras"));
  assert.equal(r1.combate.jugador.criticoSombra, true);
  const r2 = C.turnoJugador(r1.combate, "atacar", () => 0.5);
  const golpe = r2.eventos.find((e) => e.actor === "jugador" && e.tipo === "ataque");
  assert.equal(golpe.critico, true);
});

test("el botín local genera piezas de conjunto con su sufijo y sobreviven al guardado", () => {
  let estado = BL.estadoVacio();
  let rng = C.mulberry32(5);
  for (let i = 0; i < 300; i++) estado = BL.tirarBotinLocal(estado, { nivel: 5, jefe: true }, rng).estado;
  const conSet = estado.items.filter((it) => it.conjunto);
  assert.ok(conSet.length / estado.items.length > 0.2 && conSet.length / estado.items.length < 0.5);
  for (const it of conSet) assert.ok(it.nombre.includes(S.CONJUNTOS[it.conjunto].sufijo), it.nombre);
  assert.deepEqual(new Set(conSet.map((it) => it.conjunto)), new Set(S.IDS_CONJUNTO));
  assert.deepEqual(BL.parsearEstado(BL.serializarEstado(estado)), estado);
  const fijo = BL.generarObjeto(C.mulberry32(1), { conjunto: "coloso", rareza: 2 });
  assert.equal(fijo.conjunto, "coloso");
  assert.ok(fijo.nombre.endsWith("del Coloso de Hierro"));
  const sucio = BL.parsearEstado(JSON.stringify({ items: [{ tokenId: "1", nombre: "Ok", tipo: "Casco", rareza: 0, ataque: 0, defensa: 1, conjunto: "falso" }] }));
  assert.ok(!Object.hasOwn(sucio.items[0], "conjunto"));
});

test("tooltip del inventario muestra el progreso y qué bonos están activos", () => {
  const t = tooltipConjunto("gladiador", 2);
  assert.match(t, /Set del Gladiador Sangriento \(2\/4\)/);
  assert.match(t, /✔ 2 piezas: \+15 %/);
  assert.match(t, /✖ 4 piezas/);
  assert.equal(tooltipConjunto("nada", 1), "");
});
