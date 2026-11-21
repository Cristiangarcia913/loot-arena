import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as SAT from "../js/satisfaccion.js";

const pico = (evento, deltaPositivo, deltaNegativo, reaccion) =>
  ({ evento, reaccion, deltaPositivo, deltaNegativo, timestamp: 1 });

describe("datosBiometricos", () => {
  test("sin historial (medidor nunca activo) → null en ambos campos", () => {
    assert.deepEqual(SAT.datosBiometricos([]), { emocionDominante: null, tensionMedia: null });
    assert.deepEqual(SAT.datosBiometricos(undefined), { emocionDominante: null, tensionMedia: null });
  });

  test("con picos, usa el de mayor intensidad como dominante y la media/100 como tensión", () => {
    const historial = [
      pico("botin_raro", 0.2, 0, "contento_sorprendido"),
      pico("jefe_vencido", 0.8, 0, "contento_sorprendido"),
      pico("racha_perdida", 0, 0.1, "sin_reaccion"),
    ];
    const r = SAT.datosBiometricos(historial);
    assert.equal(r.emocionDominante, "Contento / Sorprendido");
    assert.ok(r.tensionMedia > 0 && r.tensionMedia <= 1);
  });
});

describe("construirPayload", () => {
  const ahora = () => Date.parse("2024-06-01T12:00:00.000Z");

  test("sin datos biométricos (sin cámara): emocionDominante y tensionMedia quedan null", () => {
    const p = SAT.construirPayload({ estrellas: 4, stats: { nivel: 7, rachaMax: 3, tiempoMinutos: 12 }, ahora });
    assert.deepEqual(p, {
      fecha: new Date(ahora()).toISOString(),
      jugador: null,
      nivel: 7,
      rachaMax: 3,
      estrellas: 4,
      emocionDominante: null,
      tensionMedia: null,
      tiempoMinutos: 12,
      tags: [],
      comentario: null,
    });
  });

  test("recorta espacios del comentario y lo deja en null si queda vacío", () => {
    assert.equal(SAT.construirPayload({ estrellas: 3, comentario: "   ", ahora }).comentario, null);
    assert.equal(SAT.construirPayload({ estrellas: 3, comentario: "  genial  ", ahora }).comentario, "genial");
  });

  test("incluye las etiquetas elegidas y los datos biométricos si hubo picos", () => {
    const historialEmocion = [pico("jefe_vencido", 0.9, 0, "contento_sorprendido")];
    const p = SAT.construirPayload({ estrellas: 5, tags: ["🔥 Muy Adictivo"], historialEmocion, ahora });
    assert.deepEqual(p.tags, ["🔥 Muy Adictivo"]);
    assert.equal(p.emocionDominante, "Contento / Sorprendido");
    assert.equal(typeof p.tensionMedia, "number");
  });
});

describe("parsearLocal / anadirLocal", () => {
  test("parsearLocal: JSON roto o que no es array → []", () => {
    assert.deepEqual(SAT.parsearLocal(null), []);
    assert.deepEqual(SAT.parsearLocal("{roto"), []);
    assert.deepEqual(SAT.parsearLocal('{"a":1}'), []);
    assert.deepEqual(SAT.parsearLocal("[1,2]"), [1, 2]);
  });

  test("anadirLocal: añade al principio y recorta a MAX_LOCAL", () => {
    const lista = Array.from({ length: SAT.MAX_LOCAL }, (_, i) => ({ n: i }));
    const r = SAT.anadirLocal(lista, { n: "nuevo" });
    assert.equal(r.length, SAT.MAX_LOCAL);
    assert.deepEqual(r[0], { n: "nuevo" });
  });

  test("guardarLocal no lanza aunque no haya localStorage (entorno sin DOM)", () => {
    assert.doesNotThrow(() => SAT.guardarLocal({ estrellas: 5 }));
  });
});

describe("enviarSatisfaccion", () => {
  test("ok si el servidor responde 200", async () => {
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
    const r = await SAT.enviarSatisfaccion("http://x", { estrellas: 5 }, { fetchImpl });
    assert.deepEqual(r, { ok: true });
  });

  test("usa el error del cuerpo JSON si el servidor responde con error", async () => {
    const fetchImpl = async () => ({ ok: false, status: 400, json: async () => ({ error: "estrellas debe ser un entero entre 1 y 5" }) });
    const r = await SAT.enviarSatisfaccion("http://x", { estrellas: 9 }, { fetchImpl });
    assert.equal(r.ok, false);
    assert.equal(r.mensaje, "estrellas debe ser un entero entre 1 y 5");
  });

  test("un fallo de red no lanza: se devuelve como error", async () => {
    const fetchImpl = async () => { throw new Error("network down"); };
    const r = await SAT.enviarSatisfaccion("http://x", { estrellas: 5 }, { fetchImpl });
    assert.equal(r.ok, false);
    assert.match(r.mensaje, /No se pudo contactar/);
  });

  test("sin serverUrl, falla sin intentar la red", async () => {
    let llamado = false;
    const fetchImpl = async () => { llamado = true; return { ok: true, json: async () => ({}) }; };
    const r = await SAT.enviarSatisfaccion(null, { estrellas: 5 }, { fetchImpl });
    assert.equal(r.ok, false);
    assert.equal(llamado, false);
  });
});

describe("urlDescarga", () => {
  test("construye la URL de descarga con el serverUrl dado", () => {
    assert.equal(SAT.urlDescarga("http://localhost:4000"), "http://localhost:4000/api/satisfaccion/descargar");
  });
  test("null sin serverUrl", () => {
    assert.equal(SAT.urlDescarga(null), null);
    assert.equal(SAT.urlDescarga(""), null);
  });
});

describe("chips y csvLocal (descarga sin servidor)", () => {
  test("los cuatro chips rápidos de la encuesta", () => {
    assert.deepEqual(SAT.CHIPS.map((c) => c.texto),
      ["🔥 Muy Adictivo", "⚔️ Combate Táctico", "🐉 Jefes Épicos", "📈 Justo y Desafiante"]);
  });

  test("lista vacía → solo BOM + cabecera (misma que el servidor)", () => {
    assert.equal(SAT.csvLocal([]),
      "﻿Fecha;Jugador;Nivel;RachaMax;Estrellas;EmocionDominante;TensionMedia;TiempoJuegoMin;Comentario;Tags\r\n");
  });

  test("ordena de la más antigua a la más reciente, escapa ';' y une las etiquetas", () => {
    const lista = [
      { fecha: "2026-01-02", jugador: null, estrellas: 3, tags: [], comentario: null },
      { fecha: "2026-01-01", jugador: "Ana", nivel: 5, rachaMax: 2, estrellas: 5, emocionDominante: "Alegría",
        tensionMedia: 0.4, tiempoMinutos: 12.5, comentario: "top; de verdad", tags: ["🔥 Muy Adictivo", "🐉 Jefes Épicos"] },
    ];
    const filas = SAT.csvLocal(lista).split("\r\n");
    assert.equal(filas[1], '2026-01-01;Ana;5;2;5;Alegría;0.4;12.5;"top; de verdad";🔥 Muy Adictivo, 🐉 Jefes Épicos');
    assert.equal(filas[2], "2026-01-02;Anónimo;;;3;;;;;");
    assert.equal(filas.at(-1), "");
  });
});
