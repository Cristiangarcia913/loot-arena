import { test } from "node:test";
import assert from "node:assert/strict";
import * as A from "../js/anuncios.js";
import * as T from "../js/torre.js";
import * as X from "../js/expediciones.js";
import * as E from "../js/economy.js";

// ───────── Gestor de anuncios ─────────

function sdkFalso(comportamiento) {
  const llamadas = [];
  return {
    llamadas,
    entorno: { CrazyGames: { SDK: {
      environment: "uninitialized",
      init: async () => { llamadas.push("init"); },
      ad: { requestAd: (tipo, cb) => { llamadas.push(tipo); comportamiento(cb); } },
    } } },
  };
}

test("con SDK de CrazyGames pide un anuncio 'rewarded' y premia al terminar", async () => {
  const f = sdkFalso((cb) => { cb.adStarted(); cb.adFinished(); });
  const g = A.crearGestorAnuncios({ entorno: f.entorno, simular: () => assert.fail("no debe simular") });
  let premio = 0, fallo = null;
  const ok = await g.mostrarAnuncioRecompensado("revivir_torre", () => premio++, (m) => (fallo = m));
  assert.equal(ok, true);
  assert.equal(premio, 1);
  assert.equal(fallo, null);
  assert.deepEqual(f.llamadas, ["init", "rewarded"]);
});

test("si el SDK da error no hay recompensa", async () => {
  const f = sdkFalso((cb) => cb.adError({ code: "unfilled" }));
  const g = A.crearGestorAnuncios({ entorno: f.entorno });
  let premio = 0, fallo = null;
  assert.equal(await g.mostrarAnuncioRecompensado("renovar_tienda", () => premio++, (m) => (fallo = m)), false);
  assert.equal(premio, 0);
  assert.equal(fallo, "error");
});

test("sin SDK usa el simulador; cancelarlo no premia", async () => {
  const vistos = [];
  const g = A.crearGestorAnuncios({ entorno: {}, simular: async (tipo, s) => { vistos.push([tipo, s]); return vistos.length === 1; } });
  assert.equal(await g.mostrarAnuncioRecompensado("botin_expedicion"), true);
  let fallo = null;
  assert.equal(await g.mostrarAnuncioRecompensado("botin_expedicion", null, (m) => (fallo = m)), false);
  assert.equal(fallo, "cancelado");
  assert.deepEqual(vistos[0], ["botin_expedicion", A.SEGUNDOS_SIMULADO]);
});

test("no abre dos anuncios a la vez", async () => {
  let soltar;
  const g = A.crearGestorAnuncios({ entorno: {}, simular: () => new Promise((r) => { soltar = r; }) });
  const primero = g.mostrarAnuncioRecompensado("x");
  let fallo = null;
  assert.equal(await g.mostrarAnuncioRecompensado("x", null, (m) => (fallo = m)), false);
  assert.equal(fallo, "ocupado");
  soltar(true);
  assert.equal(await primero, true);
  assert.equal(g.ocupado(), false);
});

test("sdkCrazyGames ignora objetos sin API de anuncios", () => {
  assert.equal(A.sdkCrazyGames({}), null);
  assert.equal(A.sdkCrazyGames({ CrazyGames: { SDK: {} } }), null);
});

// ───────── Revivir en la torre ─────────

test("revivirTorre: mismo piso, 50 % de vida y solo una vez", () => {
  const t0 = { ...T.nuevaTorre({ vidaMax: 100, ataque: 10, defensa: 5 }), piso: 4, vida: 30 };
  assert.ok(T.puedeRevivir(t0));
  const t = T.revivirTorre(t0);
  assert.equal(t.piso, 4);
  assert.equal(t.vida, 50);
  assert.equal(t.estado, "en_curso");
  assert.equal(t.revivido, true);
  assert.equal(T.puedeRevivir(t), false);
  assert.throws(() => T.revivirTorre(t));
  assert.equal(t0.revivido, undefined, "no muta");
});

// ───────── Duplicar botín de expedición ─────────

test("bonoDuplicado repite XP y pociones y añade un objeto garantizado", () => {
  const dur = X.duracionPorId("4h");
  const b = X.bonoDuplicado({ ok: true, duracion: dur, xp: dur.xp, pociones: 2, botin: null });
  assert.deepEqual(b, { xp: dur.xp, pociones: 2, botin: { nivel: dur.nivelBotin, jefe: true } });
  assert.throws(() => X.bonoDuplicado({ ok: false }));
});

// ───────── Catálogo rotativo ─────────

test("catalogoRotativo es determinista, sin consumibles y con algún raro", () => {
  for (let s = 0; s < 200; s++) {
    const a = E.catalogoRotativo(s);
    assert.equal(a.length, E.TAM_CATALOGO_ROTATIVO);
    assert.deepEqual(a, E.catalogoRotativo(s));
    assert.ok(a.every((c) => c.ranura !== "consumible"));
    assert.ok(a.some((c) => c.rareza > 0));
    assert.equal(new Set(a.map((c) => c.id)).size, a.length);
  }
  const distintos = new Set(Array.from({ length: 50 }, (_, s) => E.catalogoRotativo(s).map((c) => c.id).join()));
  assert.ok(distintos.size > 10, "semillas distintas dan catálogos distintos");
});
