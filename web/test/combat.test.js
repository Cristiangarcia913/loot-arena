import { test } from "node:test";
import assert from "node:assert/strict";
import * as C from "../js/combat.js";

/** rng que devuelve una secuencia fija (cíclica). */
const seq = (...vals) => { let i = 0; return () => vals[i++ % vals.length]; };
/** rng "neutro": sin esquiva ni crítico, variación 0 y el enemigo ataca normal. */
const neutro = () => 0.5;
const dummy = (extra = {}) => ({ nombre: "Dummy", emoji: "🎯", nivel: 1, vidaMax: 50, ataque: 12, defensa: 3, ...extra });
const HEROE = { ...C.STATS_BASE, critico: 0.1, esquiva: 0 };

test("calcularDano: atk²/(atk+def) ± variación, nunca < 1", () => {
  assert.equal(C.calcularDano(10, 3, neutro), 8);          // 100/13 = 7,69
  assert.equal(C.calcularDano(10, 0, neutro), 10);
  assert.equal(C.calcularDano(10, 3, () => 0), 7);         // ×0,85
  assert.equal(C.calcularDano(10, 3, () => 0.999), 9);     // ×1,15
  assert.equal(C.calcularDano(1, 500, () => 0), 1);        // mínimo 1
  assert.ok(C.calcularDano(30, 10, neutro) > C.calcularDano(30, 40, neutro));
  const rng = C.mulberry32(42);
  for (let i = 0; i < 500; i++) assert.ok(C.calcularDano(C.randInt(1, 30, rng), C.randInt(0, 60, rng), rng) >= 1);
});

test("randInt respeta los límites", () => {
  const rng = C.mulberry32(1);
  for (let i = 0; i < 1000; i++) {
    const v = C.randInt(-1, 1, rng);
    assert.ok(v >= -1 && v <= 1 && Number.isInteger(v));
  }
});

test("nivelArena (5 victorias por nivel) y nivelEnemigo se acotan a 1..10", () => {
  assert.equal(C.nivelArena(0), 1);
  assert.equal(C.nivelArena(4), 1);
  assert.equal(C.nivelArena(5), 2);
  assert.equal(C.nivelArena(1000), 10);
  assert.equal(C.nivelArena(-5), 1);
  assert.equal(C.nivelEnemigo(1, () => 0), 1);
  assert.equal(C.nivelEnemigo(10, () => 0.999), 10);
  assert.equal(C.nivelEnemigo(5, neutro), 5);
});

test("esCombateDeJefe: el 5.º combate de cada nivel", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 8, 9, 14].map(C.esCombateDeJefe), [false, false, false, false, true, false, false, true, true]);
});

test("probCritico: 10 % + 1 % por cada 3 de ataque del equipo; esquiva según defensa", () => {
  assert.equal(C.probCritico(0), 0.10);
  assert.equal(C.probCritico(2), 0.10);
  assert.ok(Math.abs(C.probCritico(9) - 0.13) < 1e-9);
  assert.equal(C.probCritico(10000), C.CRITICO_MAX);
  assert.ok(C.probEsquiva(50) > C.probEsquiva(5));
  assert.equal(C.probEsquiva(10000), C.ESQUIVA_MAX);
});

test("generarEnemigo escala con el nivel, trae clave y elige criatura del bestiario", () => {
  const e1 = C.generarEnemigo(1, neutro);
  const e10 = C.generarEnemigo(10, neutro);
  for (const e of [e1, e10]) {
    assert.ok(e.nombre && e.emoji && e.clave);
    assert.ok(C.BESTIARIO.some((b) => b.nombre === e.nombre));
    assert.equal(e.jefe, false);
  }
  assert.equal(e1.nivel, 1);
  assert.ok(e10.vidaMax > e1.vidaMax && e10.ataque > e1.ataque && e10.defensa > e1.defensa);
  assert.equal(C.generarEnemigo(99, neutro).nivel, 10);
  assert.equal(C.generarEnemigo(10, () => 0.999).nombre, "Dragón ancestral");
  assert.equal(C.generarEnemigo(1, () => 0).nombre, "Rata gigante");
});

test("todas las criaturas tienen patrón, rasgo y definitiva; sus movimientos existen", () => {
  assert.equal(C.BESTIARIO.length, 10);
  for (const b of C.BESTIARIO) {
    assert.ok(b.clave && b.rasgo && b.definitiva && b.titulo && b.patron.length);
    for (const p of b.patron) assert.ok(C.MOVIMIENTOS[p.mov], p.mov);
  }
  for (const m of Object.values(C.MOVIMIENTOS)) if (m.libera) assert.ok(C.MOVIMIENTOS[m.libera]);
});

test("jefe: más vida, flag jefe, nombre con título y definitiva", () => {
  const n = C.generarEnemigo(5, neutro);
  const j = C.generarEnemigo(5, neutro, { jefe: true });
  assert.equal(j.jefe, true);
  assert.ok(j.vidaMax > n.vidaMax * 1.4);
  assert.match(j.nombre, /, /);
  assert.ok(j.definitiva);
  const c = C.crearCombate(HEROE, j, neutro);
  assert.equal(c.jefe, true);
  assert.equal(c.enemigo.fase, 1);
  assert.match(c.log[0].texto, /JEFE/);
});

test("crearCombate empieza con vida completa, 3 pociones e intención calculada", () => {
  const c = C.crearCombate(C.STATS_BASE, C.generarEnemigo(1, neutro), neutro);
  assert.equal(c.fase, "en_curso");
  assert.equal(c.jugador.vida, 100);
  assert.equal(c.jugador.vidaMax, 100);
  assert.equal(c.jugador.pociones, C.POCIONES_POR_EXPEDICION);
  assert.equal(c.enemigo.vida, c.enemigo.vidaMax);
  assert.equal(c.log.length, 1);
  assert.equal(c.jugador.habilidades.length, 3);
  const it = C.intencionEnemigo(c);
  assert.ok(it && ["atacar", "cargar", "defender", "habilidad"].includes(it.tipo) && it.texto);
});

test("atacar: el jugador daña, el enemigo responde; no muta y los eventos traen vidas/estados", () => {
  const c0 = C.crearCombate(HEROE, dummy(), neutro);
  const { combate: c1, eventos, fin } = C.turnoJugador(c0, "atacar", neutro);
  assert.equal(fin, null);
  assert.equal(c1.enemigo.vida, 50 - 8);
  assert.equal(c1.jugador.vida, 100 - 8);           // 144/17 = 8,47
  assert.equal(c1.turno, 2);
  assert.deepEqual(eventos.map((e) => [e.actor, e.tipo]), [["jugador", "ataque"], ["enemigo", "ataque"]]);
  assert.deepEqual(eventos[0].vidas, { jugador: 100, enemigo: 42 });
  assert.deepEqual(eventos[1].vidas, { jugador: 92, enemigo: 42 });
  assert.equal(eventos[0].critico, false);
  assert.equal(eventos[0].objetivo, "enemigo");
  assert.ok(Array.isArray(eventos[0].estados.jugador));
  assert.equal(c0.enemigo.vida, 50);
  assert.equal(c0.jugador.vida, 100);
  assert.equal(c1.resumen.danoHecho, 8);
  assert.equal(c1.resumen.danoRecibido, 8);
});

test("críticos: ×1,6 y se cuentan en el resumen", () => {
  const c0 = C.crearCombate(HEROE, dummy({ vidaMax: 500 }), neutro);
  // jugador: esquiva enemigo 0.5 (no), crítico 0.05 (<0.1 sí), variación 0.5; enemigo: 0.5…
  const { combate, eventos } = C.turnoJugador(c0, "atacar", seq(0.5, 0.05, 0.5, 0.5, 0.5, 0.5, 0.5));
  assert.equal(eventos[0].critico, true);
  assert.equal(eventos[0].dano, Math.round(8 * C.MULT_CRITICO));
  assert.match(eventos[0].texto, /CRÍTICO/);
  assert.equal(combate.resumen.criticos, 1);
});

test("esquiva: el golpe no hace daño", () => {
  const c0 = C.crearCombate({ ...HEROE, esquiva: 0.3 }, dummy({ esquiva: 0.3 }), neutro);
  // jugador ataca: esquiva enemigo (0.1 < 0.3) → esquivado. Enemigo ataca: esquiva jugador (0.1) → esquivado.
  const { combate, eventos } = C.turnoJugador(c0, "atacar", () => 0.1);
  assert.equal(eventos[0].esquivado, true);
  assert.equal(eventos[0].dano, 0);
  assert.equal(combate.enemigo.vida, 50);
  assert.equal(combate.jugador.vida, 100);
  assert.equal(combate.resumen.esquivas, 1);
});

test("defender reduce a la mitad y bloquea hechizos (×0,2)", () => {
  const c0 = C.crearCombate(HEROE, dummy(), neutro);
  const { combate: c1, eventos } = C.turnoJugador(c0, "defender", neutro);
  assert.equal(c1.enemigo.vida, 50);
  assert.equal(c1.jugador.vida, 100 - 4);
  assert.equal(eventos[1].bloqueado, true);
  assert.equal(c1.jugador.defendiendo, false);

  // Hechicero: carga la bola de fuego y luego la lanza
  const hech = { ...C.generarEnemigo(9, neutro), clave: "hechicero", nombre: "Hechicero oscuro", vidaMax: 999 };
  let c = C.crearCombate(HEROE, hech, () => 0.1);      // 0.1 < 0.35 → concentrar
  assert.equal(C.intencionEnemigo(c).tipo, "cargar");
  c = C.turnoJugador(c, "atacar", neutro).combate;
  assert.equal(c.enemigo.cargando, "bola_fuego");
  const it = C.intencionEnemigo(c);
  assert.equal(it.id, "bola_fuego");
  assert.equal(it.telegrafiado, true);
  assert.equal(it.bloqueable, true);
  const sinDefensa = C.turnoJugador(c, "atacar", neutro).eventos.find((e) => e.id === "bola_fuego");
  const conDefensa = C.turnoJugador(c, "defender", neutro).eventos.find((e) => e.id === "bola_fuego");
  assert.equal(conDefensa.bloqueado, true);
  assert.ok(conDefensa.dano * 4 < sinDefensa.dano, `${conDefensa.dano} vs ${sinDefensa.dano}`);
});

test("enemigo genérico carga y luego da un golpe brutal", () => {
  const c0 = C.crearCombate(HEROE, dummy({ vidaMax: 200, ataque: 20, defensa: 0 }), () => 0.0); // 0 < 0.2 → carga
  assert.equal(C.intencionEnemigo(c0).tipo, "cargar");
  const { combate: c1, eventos: e1 } = C.turnoJugador(c0, "atacar", neutro);
  assert.equal(e1[1].tipo, "carga");
  assert.ok(c1.enemigo.cargando);
  assert.equal(c1.jugador.vida, 100);
  const { eventos: e2 } = C.turnoJugador(c1, "defender", neutro);
  assert.equal(e2[1].id, "golpe_brutal");
  assert.equal(e2[1].brutal, true);
});

test("pociones: curan 35 %, se agotan y lanzan error sin pociones", () => {
  let c = C.crearCombate({ ...HEROE, pociones: 1 }, dummy({ ataque: 60, vidaMax: 999 }), neutro);
  c = C.turnoJugador(c, "atacar", neutro).combate;
  const vidaAntes = c.jugador.vida;
  const { combate, eventos } = C.turnoJugador(c, "pocion", neutro);
  assert.equal(eventos[0].tipo, "pocion");
  assert.equal(eventos[0].curacion, 35);
  assert.equal(eventos[1].vidas.jugador, eventos[0].vidas.jugador - eventos[1].dano);
  assert.equal(eventos[0].vidas.jugador, vidaAntes + 35);
  assert.equal(combate.jugador.pociones, 0);
  assert.throws(() => C.turnoJugador(combate, "pocion", neutro), /pociones/);
  // nunca cura por encima del máximo
  const lleno = C.turnoJugador(C.crearCombate(HEROE, dummy(), neutro), "pocion", neutro);
  assert.equal(lleno.eventos[0].curacion, 0);
});

test("pociones extra (tienda): se suman y se gastan las últimas", () => {
  let c = C.crearCombate({ ...HEROE, pociones: 1, pocionesExtra: 2 }, dummy({ ataque: 1, vidaMax: 999 }), neutro);
  assert.equal(c.jugador.pociones, 3);
  c = C.turnoJugador(c, "pocion", neutro).combate;
  assert.deepEqual(C.pocionesRestantes(c), { pociones: 0, pocionesExtra: 2, total: 2, extraGastadas: 0 });
  c = C.turnoJugador(c, "pocion", neutro).combate;
  assert.deepEqual(C.pocionesRestantes(c), { pociones: 0, pocionesExtra: 1, total: 1, extraGastadas: 1 });
  assert.equal(c.resumen.pocionesExtraGastadas, 1);
  // por defecto 0 extra
  assert.equal(C.crearCombate(HEROE, dummy(), neutro).jugador.pocionesExtra, 0);
});

test("goblin roba pociones (cuenta como gastada si era extra)", () => {
  const gob = { ...dummy({ vidaMax: 999 }), clave: "goblin", nombre: "Goblin saqueador" };
  const c0 = C.crearCombate({ ...HEROE, pociones: 0, pocionesExtra: 1 }, gob, () => 0.1); // 0.1 < 0.25 → robar
  assert.equal(C.intencionEnemigo(c0).id, "robar");
  const { combate, eventos } = C.turnoJugador(c0, "atacar", neutro);
  assert.ok(eventos.some((e) => e.tipo === "robo"));
  assert.equal(combate.jugador.pociones, 0);
  assert.equal(combate.resumen.pocionesExtraGastadas, 1);
  // sin pociones no intenta robar
  const c1 = C.crearCombate({ ...HEROE, pociones: 0 }, gob, () => 0.1);
  assert.notEqual(C.intencionEnemigo(c1).id, "robar");
});

test("habilidades: Golpe Poderoso ×1,8 y enfriamiento", () => {
  let c = C.crearCombate(HEROE, dummy({ vidaMax: 999, ataque: 1 }), neutro);
  const r = C.turnoJugador(c, { habilidad: "golpe_poderoso" }, neutro);
  assert.equal(r.eventos[0].tipo, "habilidad");
  assert.equal(r.eventos[0].id, "golpe_poderoso");
  assert.equal(r.eventos[0].dano, Math.round(8 * 1.8));
  c = r.combate;
  const h = () => c.jugador.habilidades.find((x) => x.id === "golpe_poderoso").restante;
  assert.equal(h(), 2);
  assert.throws(() => C.turnoJugador(c, { habilidad: "golpe_poderoso" }, neutro), /enfriamiento/);
  c = C.turnoJugador(c, "atacar", neutro).combate;
  assert.equal(h(), 1);
  c = C.turnoJugador(c, "atacar", neutro).combate;
  assert.equal(h(), 0);
  assert.doesNotThrow(() => C.turnoJugador(c, { habilidad: "golpe_poderoso" }, neutro));
  assert.throws(() => C.turnoJugador(c, { habilidad: "tajo_celestial" }, neutro), /no disponible/);
  assert.throws(() => C.turnoJugador(c, "bailar", neutro), /desconocida/);
});

test("estados: sangrado hace daño por turno y expira", () => {
  let c = C.crearCombate(HEROE, dummy({ vidaMax: 999, ataque: 1 }), neutro);
  const r = C.turnoJugador(c, { habilidad: "desangrar" }, neutro);
  const ev = r.eventos[0];
  assert.equal(ev.estado.tipo, "sangrado");
  assert.equal(ev.estado.turnos, 3);
  const valor = ev.estado.valor;
  assert.equal(valor, 3); // 30 % de 10
  // el sangrado hace efecto al inicio del turno del enemigo, ya en esta ronda
  const ticks1 = r.eventos.filter((e) => e.tipo === "dano_estado");
  assert.equal(ticks1.length, 1);
  assert.equal(ticks1[0].objetivo, "enemigo");
  assert.equal(ticks1[0].dano, valor);
  c = r.combate;
  let total = 1;
  for (let i = 0; i < 4; i++) {
    const t = C.turnoJugador(c, "defender", neutro);
    total += t.eventos.filter((e) => e.tipo === "dano_estado").length;
    c = t.combate;
  }
  assert.equal(total, 3);
  assert.equal(c.enemigo.estados.length, 0);
});

test("estados: veneno de la araña, aturdido pierde turno, escudo absorbe", () => {
  const ara = { ...dummy({ vidaMax: 999 }), clave: "arana", nombre: "Araña venenosa" };
  // 0.1 < 0.4 → picadura
  let c = C.crearCombate(HEROE, ara, () => 0.1);
  assert.equal(C.intencionEnemigo(c).id, "picadura");
  const r = C.turnoJugador(c, "atacar", neutro);
  const pic = r.eventos.find((e) => e.id === "picadura");
  assert.equal(pic.estado.tipo, "veneno");
  c = r.combate;
  assert.ok(c.jugador.estados.some((e) => e.tipo === "veneno"));
  const r2 = C.turnoJugador(c, "defender", neutro);
  assert.equal(r2.eventos[0].tipo, "dano_estado");
  assert.equal(r2.eventos[0].objetivo, "jugador");

  // aturdido: el héroe pierde la acción
  c = C.crearCombate(HEROE, dummy({ vidaMax: 999 }), neutro);
  c = { ...c, jugador: { ...c.jugador, estados: [{ tipo: "aturdido", turnos: 1 }] } };
  assert.equal(C.jugadorAturdido(c), true);
  const r3 = C.turnoJugador(c, "atacar", neutro);
  assert.equal(r3.eventos[0].tipo, "aturdido");
  assert.equal(r3.combate.enemigo.vida, 999);
  assert.equal(C.jugadorAturdido(r3.combate), false);

  // escudo: absorbe antes que la vida
  c = C.crearCombate(HEROE, dummy(), neutro);
  c = { ...c, jugador: { ...c.jugador, estados: [{ tipo: "escudo", turnos: 2, valor: 5 }] } };
  const r4 = C.turnoJugador(c, "atacar", neutro);
  const golpe = r4.eventos.find((e) => e.actor === "enemigo");
  assert.equal(golpe.absorbido, 5);
  assert.equal(golpe.dano, 3);
  assert.equal(r4.combate.jugador.vida, 97);
});

test("Grito de guerra sube el ataque 2 turnos", () => {
  let c = C.crearCombate(HEROE, dummy({ vidaMax: 999, ataque: 1, defensa: 0 }), neutro);
  c = C.turnoJugador(c, { habilidad: "grito_guerra" }, neutro).combate;
  const a1 = C.turnoJugador(c, "atacar", neutro);
  assert.equal(a1.eventos[0].dano, 14);   // 10×1,4
  const a2 = C.turnoJugador(a1.combate, "atacar", neutro);
  assert.equal(a2.eventos[0].dano, 14);
  const a3 = C.turnoJugador(a2.combate, "atacar", neutro);
  assert.equal(a3.eventos[0].dano, 10);
});

test("especiales: Tajo Celestial no se esquiva; Muro de Fe refleja", () => {
  const habs = ["golpe_poderoso", "desangrar", "grito_guerra", "tajo_celestial"];
  let c = C.crearCombate({ ...HEROE, habilidades: habs }, dummy({ vidaMax: 999, esquiva: 1 }), neutro);
  const r = C.turnoJugador(c, { habilidad: "tajo_celestial" }, neutro);
  assert.equal(r.eventos[0].esquivado, false);
  assert.ok(r.eventos[0].dano >= 19);

  c = C.crearCombate({ ...HEROE, habilidades: ["muro_de_fe"] }, dummy({ vidaMax: 999, ataque: 30 }), neutro);
  const m = C.turnoJugador(c, { habilidad: "muro_de_fe" }, neutro);
  assert.ok(m.eventos.some((e) => e.estado?.tipo === "escudo"));
  assert.ok(m.eventos.some((e) => e.tipo === "reflejo" && e.dano > 0));
  assert.ok(m.combate.enemigo.vida < 999);
});

test("gólem: se defiende y contraataca", () => {
  const gol = { ...dummy({ vidaMax: 999 }), clave: "golem", nombre: "Gólem de piedra" };
  let c = C.crearCombate(HEROE, gol, () => 0.1); // 0.1 < 0.35 → guardia
  assert.equal(C.intencionEnemigo(c).tipo, "defender");
  c = C.turnoJugador(c, "atacar", neutro).combate;
  assert.equal(c.enemigo.defendiendo, true);
  const r = C.turnoJugador(c, "atacar", neutro);
  assert.equal(r.eventos[0].bloqueado, true);
  assert.equal(r.eventos[0].dano, 4);
  assert.equal(r.eventos[1].tipo, "contraataque");
  // no se defiende dos turnos seguidos
  assert.notEqual(C.intencionEnemigo(c).tipo, "defender");
});

test("espectro roba vida con Toque helado", () => {
  const esp = { ...dummy({ vidaMax: 100 }), clave: "espectro", nombre: "Espectro" };
  let c = C.crearCombate(HEROE, esp, () => 0.1);
  assert.equal(C.intencionEnemigo(c).id, "toque_helado");
  const r = C.turnoJugador(c, "atacar", neutro);
  const t = r.eventos.find((e) => e.id === "toque_helado");
  assert.ok(t.curacion > 0);
  assert.equal(r.combate.enemigo.vida, 100 - 8 + t.curacion);
});

test("jefe: fase 2 al bajar del 50 % y definitiva telegrafiada", () => {
  const jefe = { ...dummy({ vidaMax: 100, ataque: 10, defensa: 0 }), jefe: true, clave: "rata", definitiva: "Plaga" };
  let c = C.crearCombate({ ...HEROE, ataque: 60 }, jefe, neutro); // 60 de daño → pasa a fase 2
  const r = C.turnoJugador(c, "atacar", neutro);
  assert.ok(r.eventos.some((e) => e.tipo === "fase"));
  assert.equal(r.combate.enemigo.fase, 2);
  assert.ok(r.combate.enemigo.ataque > 10);

  // definitiva: tras JEFE.cadaFase1 acciones en fase 1 la anuncia, luego la lanza
  c = C.crearCombate({ ...HEROE, ataque: 1, vidaMax: 9999 }, { ...jefe, vidaMax: 9999 }, neutro);
  const vistas = [];
  for (let i = 0; i < 10; i++) {
    const it = C.intencionEnemigo(c);
    vistas.push(it.id);
    c = C.turnoJugador(c, it.telegrafiado ? "defender" : "atacar", neutro).combate;
  }
  const iCarga = vistas.indexOf("definitiva_carga");
  assert.equal(iCarga, C.JEFE.cadaFase1);
  assert.equal(vistas[iCarga + 1], "definitiva");
  const def = C.crearCombate({ ...HEROE, ataque: 1, vidaMax: 9999 }, { ...jefe, vidaMax: 9999 }, neutro);
  // reproducir hasta la definitiva y comprobar el bloqueo
  let d = def;
  for (let i = 0; i <= iCarga; i++) d = C.turnoJugador(d, "atacar", neutro).combate;
  assert.equal(C.intencionEnemigo(d).definitiva, true);
  const golpeDef = C.turnoJugador(d, "defender", neutro).eventos.find((e) => e.id === "definitiva");
  assert.equal(golpeDef.definitiva, true);
  assert.equal(golpeDef.bloqueado, true);
  assert.equal(golpeDef.nombre, "Plaga");
});

test("victoria cuando el enemigo llega a 0 (el enemigo ya no responde)", () => {
  const { combate, eventos, fin } = C.turnoJugador(C.crearCombate(HEROE, dummy({ vidaMax: 5, ataque: 50 }), neutro), "atacar", neutro);
  assert.equal(fin, "victoria");
  assert.equal(combate.fase, "victoria");
  assert.equal(combate.enemigo.vida, 0);
  assert.equal(combate.jugador.vida, 100);
  assert.equal(eventos.at(-1).tipo, "victoria");
  assert.equal(C.intencionEnemigo(combate), null);
  assert.throws(() => C.turnoJugador(combate, "atacar", neutro), /terminado/);
});

test("derrota cuando el jugador llega a 0", () => {
  const { combate, fin } = C.turnoJugador(C.crearCombate(HEROE, dummy({ vidaMax: 999, ataque: 500, defensa: 99 }), neutro), "atacar", neutro);
  assert.equal(fin, "derrota");
  assert.equal(combate.jugador.vida, 0);
});

test("determinismo: misma semilla, mismo combate", () => {
  const jugar = (seed) => {
    const rng = C.mulberry32(seed);
    let c = C.crearCombate(HEROE, C.generarEnemigo(5, rng), rng);
    while (c.fase === "en_curso") c = C.turnoJugador(c, rng() < 0.7 ? "atacar" : "defender", rng).combate;
    return c.log.map((e) => e.texto).join("\n");
  };
  assert.equal(jugar(11), jugar(11));
});

test("un combate simulado siempre termina (normales y jefes)", () => {
  const rng = C.mulberry32(7);
  for (let k = 0; k < 80; k++) {
    let c = C.crearCombate(HEROE, C.generarEnemigo(C.randInt(1, 10, rng), rng, { jefe: k % 4 === 0 }), rng);
    let n = 0;
    while (c.fase === "en_curso" && n++ < 1000) {
      const listas = c.jugador.habilidades.filter((h) => h.restante === 0);
      const a = listas.length && rng() < 0.3 ? { habilidad: listas[0].id } : rng() < 0.8 ? "atacar" : "defender";
      c = C.turnoJugador(c, a, rng).combate;
    }
    assert.ok(c.fase === "victoria" || c.fase === "derrota");
  }
});

test("huir termina el combate", () => {
  const c = C.huir(C.crearCombate(C.STATS_BASE, C.generarEnemigo(1, neutro), neutro));
  assert.equal(c.fase, "huida");
  assert.equal(c.log.at(-1).tipo, "huida");
});
