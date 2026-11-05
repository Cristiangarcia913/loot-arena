import { test } from "node:test";
import assert from "node:assert/strict";
import * as P from "../js/progression.js";

/** storage en memoria con la interfaz de localStorage. */
const memoria = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};

test("progreso nuevo y clave por dirección / invitado", () => {
  const p = P.progresoNuevo();
  assert.equal(p.nivel, 1);
  assert.equal(p.xp, 0);
  assert.equal(p.racha, 0);
  assert.equal(P.claveProgreso("0xABC"), "lootarena:progreso:0xabc");
  assert.equal(P.claveProgreso(null), "lootarena:progreso:invitado");
});

test("XP por victoria según nivel del enemigo, jefe y racha", () => {
  assert.equal(P.xpPorVictoria({ nivel: 1 }), 16);
  assert.ok(P.xpPorVictoria({ nivel: 10 }) > P.xpPorVictoria({ nivel: 1 }));
  assert.equal(P.xpPorVictoria({ nivel: 1, jefe: true }), 40);
  assert.equal(P.xpPorVictoria({ nivel: 1 }, 5), 24); // ×1,5
  assert.equal(P.multRacha(100), 1 + P.BONUS_RACHA_MAX);
});

test("aplicarVictoria: suma XP, sube de nivel, racha y récords", () => {
  const p = P.progresoNuevo();
  const r1 = P.aplicarVictoria(p, { nivel: 5 }); // 40 XP = justo un nivel
  assert.equal(r1.xp, 40);
  assert.deepEqual(r1.niveles, [2]);
  assert.equal(r1.subioNivel, true);
  assert.equal(r1.progreso.nivel, 2);
  assert.equal(r1.progreso.xp, 0);
  assert.equal(r1.progreso.racha, 1);
  assert.equal(r1.nuevaMejorRacha, true);
  assert.equal(r1.nuevoRecordNivel, true);
  assert.equal(p.xp, 0); // no muta
  const r2 = P.aplicarVictoria(r1.progreso, { nivel: 3, jefe: true });
  assert.equal(r2.progreso.jefes, 1);
  assert.equal(r2.progreso.racha, 2);
  assert.equal(r2.nuevoRecordNivel, false);
  assert.equal(r2.xp, Math.round(28 * 2.5 * 1.1));
  // derrota/huida rompen la racha pero conservan la mejor
  const d = P.aplicarDerrota(r2.progreso);
  assert.equal(d.racha, 0);
  assert.equal(d.mejorRacha, 2);
  assert.equal(d.derrotas, 1);
  assert.equal(P.aplicarHuida(d).huidas, 1);
});

test("varias subidas de golpe y tope en nivel 30", () => {
  const { progreso, niveles } = P.sumarXp(P.progresoNuevo(), 40 + 62 + 5);
  assert.deepEqual(niveles, [2, 3]);
  assert.equal(progreso.xp, 5);
  const max = P.sumarXp(P.progresoNuevo(), 10_000_000).progreso;
  assert.equal(max.nivel, P.NIVEL_HEROE_MAX);
  assert.equal(max.xp, 0);
  assert.equal(P.infoXp(max).max, true);
  assert.equal(P.infoXp(progreso).necesaria, P.xpParaSubir(3));
});

test("aplicarVictoria avisa al subir de nivel de arena; combates hasta el jefe", () => {
  const p = { ...P.progresoNuevo(), victorias: 4 };
  assert.equal(P.aplicarVictoria(p, { nivel: 1, jefe: true }).nivelArenaSubido, true);
  assert.equal(P.aplicarVictoria({ ...p, victorias: 2 }, { nivel: 1 }).nivelArenaSubido, false);
  assert.equal(P.combatesHastaJefe(4), 0);
  assert.equal(P.combatesHastaJefe(0), 4);
});

test("statsHeroe: base + nivel (poco) + equipo (mucho), críticos y habilidades", () => {
  const s1 = P.statsHeroe(P.progresoNuevo(), []);
  assert.deepEqual([s1.vidaMax, s1.ataque, s1.defensa, s1.nivel], [100, 10, 5, 1]);
  assert.equal(s1.critico, 0.1);
  assert.equal(s1.habilidades.length, 3);
  const s30 = P.statsHeroe({ ...P.progresoNuevo(), nivel: 30 }, []);
  assert.ok(s30.vidaMax > 100 && s30.ataque > 10 && s30.defensa > 5);
  assert.ok(s30.ataque - 10 < 30, "el nivel no debe pesar más que un Legendario");
  const eq = [{ tipo: "Espada", rareza: 2, ataque: 24, defensa: 3 }, { tipo: "Escudo", rareza: 0, ataque: 1, defensa: 5 }];
  const sE = P.statsHeroe(P.progresoNuevo(), eq);
  assert.equal(sE.ataque, 35);
  assert.equal(sE.defensa, 13);
  assert.equal(sE.bonusAtaque, 25);
  assert.ok(Math.abs(sE.critico - 0.18) < 1e-9);
  assert.ok(sE.esquiva > s1.esquiva);
  assert.deepEqual(sE.habilidades, ["golpe_poderoso", "desangrar", "grito_guerra", "tajo_celestial"]);
});

test("persistencia con storage inyectable y datos corruptos", () => {
  const st = memoria();
  const clave = P.claveProgreso("0xAbC");
  assert.deepEqual(P.cargarProgreso(clave, st), P.progresoNuevo());
  const p = P.aplicarVictoria(P.progresoNuevo(), { nivel: 4 }).progreso;
  assert.equal(P.guardarProgreso(clave, p, st), true);
  assert.deepEqual(P.cargarProgreso(clave, st), p);
  st.setItem(clave, "{no es json");
  assert.deepEqual(P.cargarProgreso(clave, st), P.progresoNuevo());
  st.setItem(clave, JSON.stringify({ nivel: 99, xp: -5, racha: "x", victorias: 3.7 }));
  const s = P.cargarProgreso(clave, st);
  assert.equal(s.nivel, 30);
  assert.equal(s.xp, 0);
  assert.equal(s.racha, 0);
  assert.equal(s.victorias, 3);
  // storage que lanza (modo privado) o ausente
  const roto = { getItem() { throw new Error("x"); }, setItem() { throw new Error("x"); } };
  assert.deepEqual(P.cargarProgreso(clave, roto), P.progresoNuevo());
  assert.equal(P.guardarProgreso(clave, p, roto), false);
  assert.deepEqual(P.cargarProgreso(clave, undefined), P.progresoNuevo());
});
