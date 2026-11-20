import { test } from "node:test";
import assert from "node:assert/strict";
import * as EMO from "../js/emociones.js";

test("puntuarEmocion suma las expresiones positivas y negativas por separado", () => {
  assert.deepEqual(EMO.puntuarEmocion({ neutral: 0.1, happy: 0.3, surprised: 0.5, sad: 0.1 }), { positivo: 0.8, negativo: 0.1 });
  assert.deepEqual(EMO.puntuarEmocion(null), { positivo: 0, negativo: 0 });
  assert.deepEqual(EMO.puntuarEmocion({ angry: "no-numero", fearful: 0.2 }), { positivo: 0, negativo: 0.2 });
});

test("clasificarReaccion detecta alegría/sorpresa cuando lo positivo sube frente al 'antes'", () => {
  const r = EMO.clasificarReaccion({
    antes: { neutral: 0.9, happy: 0.05, sad: 0.05 },
    durante: { neutral: 0.3, happy: 0.1, surprised: 0.6 },
    despues: { neutral: 0.5, happy: 0.5 },
  });
  assert.equal(r.reaccion, "contento_sorprendido");
  assert.ok(r.deltaPositivo > EMO.UMBRAL_REACCION);
});

test("clasificarReaccion detecta tristeza/decepción cuando lo negativo sube frente al 'antes'", () => {
  const r = EMO.clasificarReaccion({
    antes: { neutral: 0.9, happy: 0.1 },
    durante: { neutral: 0.4, sad: 0.5, angry: 0.1 },
    despues: null, // sin rostro en ese fotograma: no debe romper nada
  });
  assert.equal(r.reaccion, "triste_decepcion");
  assert.ok(r.deltaNegativo > EMO.UMBRAL_REACCION);
});

test("clasificarReaccion no marca reacción si el cambio no supera el umbral (cara de reposo normal)", () => {
  const r = EMO.clasificarReaccion({
    antes: { neutral: 0.85, happy: 0.1, sad: 0.05 },
    durante: { neutral: 0.8, happy: 0.15, sad: 0.05 },
    despues: { neutral: 0.82, happy: 0.12, sad: 0.06 },
  });
  assert.equal(r.reaccion, "sin_reaccion");
});

test("clasificarReaccion sin ningún rostro detectado en los 3 fotogramas no lanza y da sin_reaccion", () => {
  assert.deepEqual(EMO.clasificarReaccion({ antes: null, durante: null, despues: null }), { reaccion: "sin_reaccion", deltaPositivo: 0, deltaNegativo: 0 });
  assert.deepEqual(EMO.clasificarReaccion(), { reaccion: "sin_reaccion", deltaPositivo: 0, deltaNegativo: 0 });
});

test("crearPico combina evento, reacción clasificada y timestamp", () => {
  const pico = EMO.crearPico("botin_raro", {
    antes: { neutral: 0.9 },
    durante: { surprised: 0.8 },
    despues: { happy: 0.6 },
  }, 1000);
  assert.equal(pico.evento, "botin_raro");
  assert.equal(pico.reaccion, "contento_sorprendido");
  assert.equal(pico.timestamp, 1000);
});

test("registrarPico añade sin mutar y recorta al máximo indicado", () => {
  const historial = [{ evento: "a" }];
  const resultado = EMO.registrarPico(historial, { evento: "b" }, 2);
  assert.equal(historial.length, 1); // no se mutó el original
  assert.deepEqual(resultado, [{ evento: "a" }, { evento: "b" }]);
  const recortado = EMO.registrarPico(resultado, { evento: "c" }, 2);
  assert.deepEqual(recortado, [{ evento: "b" }, { evento: "c" }]);
});

test("conclusionUX clasifica por intensidad media", () => {
  assert.equal(EMO.conclusionUX(0, 0), "Sin datos suficientes para una conclusión de UX.");
  assert.equal(EMO.conclusionUX(70, 2), "¡Partida con alta implicación emocional!");
  assert.equal(EMO.conclusionUX(50, 2), "Partida con implicación emocional moderada.");
  assert.equal(EMO.conclusionUX(10, 2), "Partida con baja intensidad emocional detectada.");
});

test("resumenSesion se queda con el pico más intenso de cada tipo de evento", () => {
  const historial = [
    { evento: "botin_raro", reaccion: "contento_sorprendido", deltaPositivo: 0.6, deltaNegativo: 0, timestamp: 1 },
    { evento: "botin_raro", reaccion: "contento_sorprendido", deltaPositivo: 0.85, deltaNegativo: 0, timestamp: 2 },
    { evento: "jefe_vencido", reaccion: "contento_sorprendido", deltaPositivo: 0.7, deltaNegativo: 0, timestamp: 3 },
  ];
  const r = EMO.resumenSesion(historial);
  assert.equal(r.picos.length, 2);
  const botin = r.picos.find((p) => p.evento === "botin_raro");
  assert.equal(botin.porcentaje, 85);
  assert.equal(botin.etiqueta, "Sorpresa al obtener botín");
  assert.equal(botin.reaccionTexto, "Contento / Sorprendido");
  const jefe = r.picos.find((p) => p.evento === "jefe_vencido");
  assert.equal(jefe.porcentaje, 70);
  assert.equal(r.media, Math.round((85 + 70) / 2));
  assert.equal(r.conclusion, "¡Partida con alta implicación emocional!");
});

test("resumenSesion sin historial no da picos ni conclusión positiva", () => {
  const r = EMO.resumenSesion([]);
  assert.deepEqual(r.picos, []);
  assert.equal(r.media, 0);
  assert.equal(r.conclusion, "Sin datos suficientes para una conclusión de UX.");
});

test("soportaCamara, medidorActivo y hayDatosSesion no tocan el DOM ni lanzan sin navigator/document", () => {
  assert.equal(EMO.soportaCamara(), false); // en node:test no hay navigator.mediaDevices
  assert.equal(EMO.medidorActivo(), false);
  assert.equal(EMO.hayDatosSesion(), false);
});

test("capturarPico no hace nada (ni lanza) si el medidor no está activo", async () => {
  assert.equal(await EMO.capturarPico("botin_raro"), undefined);
  assert.equal(await EMO.capturarPico("evento_inventado"), undefined);
});
