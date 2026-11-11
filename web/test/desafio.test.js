import { test } from "node:test";
import assert from "node:assert/strict";
import * as D from "../js/desafio.js";
import * as C from "../js/combat.js";
import { MS_DIA, diaUTC } from "../js/misiones.js";
import { statsHeroe, progresoNuevo } from "../js/progression.js";

const memoria = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
const HOY = Date.UTC(2026, 10, 5, 10);
const heroe = statsHeroe(progresoNuevo(), []);

test("desafío del día: igual para todos, varía entre días, modificadores compatibles", () => {
  const d = D.desafioDelDia(20400);
  assert.deepEqual(D.desafioDelDia(20400), d);
  assert.ok(C.BESTIARIO.some((b) => b.clave === d.clave));
  assert.ok(d.nivel >= D.NIVEL_MIN_DESAFIO && d.nivel <= D.NIVEL_MAX_DESAFIO);
  assert.equal(d.modificadores.length, 2);
  assert.ok(d.titulo);
  const claves = new Set();
  let jefes = 0;
  for (let k = 0; k < 200; k++) {
    const x = D.desafioDelDia(20000 + k);
    claves.add(x.clave);
    if (x.jefe) jefes++;
    const mods = x.modificadores.map((m) => D.MODIFICADORES.find((y) => y.id === m.id));
    assert.equal(new Set(mods.map((m) => m.id)).size, mods.length);
    const grupos = mods.filter((m) => m.grupo).map((m) => m.grupo);
    assert.equal(new Set(grupos).size, grupos.length);
    for (const m of mods) if (m.claves) assert.ok(m.claves.includes(x.clave), `${m.id} con ${x.clave}`);
  }
  assert.equal(claves.size, C.BESTIARIO.length);
  assert.ok(jefes > 10 && jefes < 60, `${jefes}`);
  assert.equal(D.desafioDeHoy(HOY).dia, diaUTC(HOY));
});

test("el combate del desafío aplica modificadores y es reproducible con su rng", () => {
  const des = { ...D.desafioDelDia(1), clave: "arana", nivel: 4, jefe: false,
    modificadores: [{ id: "sin_pociones" }, { id: "coloso" }, { id: "toxinas" }, { id: "sin_trucos" }, { id: "filo" }] };
  const { combate } = D.crearCombateDesafio(des, heroe);
  const base = C.generarEnemigoDe("arana", 4);
  assert.equal(combate.jugador.pociones, 0);
  assert.equal(combate.jugador.habilidades.length, 0);
  assert.equal(combate.enemigo.vidaMax, Math.round(base.vidaMax * 1.5));
  assert.equal(combate.enemigo.multEstados, 2);
  assert.equal(combate.enemigo.critico, 0.2);
  assert.equal(combate.enemigo.desafio, true);
  assert.ok(Math.abs(combate.jugador.critico - 0.3) < 1e-9);
  const jugar = () => {
    let { combate: c, rng } = D.crearCombateDesafio(D.desafioDelDia(20400), heroe);
    while (c.fase === "en_curso") c = C.turnoJugador(c, C.intencionEnemigo(c).telegrafiado ? "defender" : "atacar", rng).combate;
    return c.log.map((e) => e.texto).join("|");
  };
  assert.equal(jugar(), jugar());
});

test("toxinas duplica el veneno de la araña", () => {
  const des = (mods) => ({ ...D.desafioDelDia(1), clave: "arana", nivel: 3, jefe: false, modificadores: mods.map((id) => ({ id })), semilla: 1 });
  const veneno = (mods) => {
    const { combate } = D.crearCombateDesafio(des(mods), heroe);
    const c = { ...combate, enemigo: { ...combate.enemigo, intencion: { id: "picadura" } } };
    return C.turnoJugador(c, "defender", () => 0.5).eventos.find((e) => e.id === "picadura").estado.valor;
  };
  // El valor es round(ataque × pct × mult), así que el redondeo puede desviar 1 punto
  // respecto al doble exacto; lo que fija el test es que «toxinas» dobla el multiplicador.
  const base = veneno([]);
  const doble = veneno(["toxinas"]);
  assert.ok(Math.abs(doble - base * 2) <= 1, `${doble} frente a ${base} × 2`);
});

test("cañón de cristal y bendición cambian la vida del héroe", () => {
  const d = (id) => D.crearCombateDesafio({ ...D.desafioDelDia(1), modificadores: [{ id }] }, heroe).combate.jugador;
  assert.equal(d("cristal").vidaMax, 60);
  assert.equal(d("cristal").ataque, 14);
  assert.equal(d("bendicion").vidaMax, 130);
});

test("un intento al día; puntuación y evento", () => {
  let e = D.estadoDesafio(null, HOY);
  assert.equal(D.puedeIntentar(e, HOY), true);
  assert.equal(D.finalizarIntento(e, null, HOY).ok, false);
  const ini = D.iniciarIntento(e, HOY);
  assert.equal(ini.ok, true);
  assert.equal(ini.desafio.dia, diaUTC(HOY));
  e = ini.progreso;
  assert.equal(D.puedeIntentar(e, HOY), false);
  assert.equal(D.iniciarIntento(e, HOY).ok, false);
  let { combate: c, rng } = D.crearCombateDesafio({ ...ini.desafio, modificadores: [] }, { ...heroe, ataque: 300 });
  assert.equal(D.finalizarIntento(e, c, HOY).ok, false); // aún en curso
  while (c.fase === "en_curso") c = C.turnoJugador(c, "atacar", rng).combate;
  const fin = D.finalizarIntento(e, c, HOY);
  assert.equal(fin.ok, true);
  assert.equal(fin.resultado.victoria, true);
  assert.ok(fin.resultado.puntuacion > 1000);
  assert.equal(fin.resultado.mejorPersonal, true);
  assert.deepEqual(fin.evento, { tipo: "desafio", victoria: true, puntuacion: fin.resultado.puntuacion });
  assert.equal(D.finalizarIntento(fin.progreso, c, HOY).ok, false);
  // mañana se libera, se conservan los históricos
  const man = D.estadoDesafio(fin.progreso, HOY + MS_DIA);
  assert.equal(D.puedeIntentar(man, HOY + MS_DIA), true);
  assert.deepEqual([man.jugados, man.ganados, man.mejor], [1, 1, fin.resultado.puntuacion]);
});

test("puntuación de derrota según el daño hecho; persistencia", () => {
  const { combate } = D.crearCombateDesafio(D.desafioDelDia(5), heroe);
  const perdido = { ...combate, fase: "derrota", enemigo: { ...combate.enemigo, vida: Math.round(combate.enemigo.vidaMax / 2) } };
  const p = D.puntuacion(perdido);
  assert.ok(p >= 440 && p <= 460, `${p}`);
  const st = memoria();
  const k = D.claveDesafio(null);
  const e = D.iniciarIntento(null, HOY).progreso;
  assert.equal(D.guardarDesafio(k, e, st), true);
  assert.equal(D.puedeIntentar(D.cargarDesafio(k, st, HOY), HOY), false);
  st.setItem(k, "x{");
  assert.equal(D.puedeIntentar(D.cargarDesafio(k, st, HOY), HOY), true);
});
