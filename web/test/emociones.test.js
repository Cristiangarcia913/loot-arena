import { test } from "node:test";
import assert from "node:assert/strict";
import * as EMO from "../js/emociones.js";

test("interpretarExpresiones elige la emoción con mayor probabilidad", () => {
  assert.deepEqual(EMO.interpretarExpresiones({ neutral: 0.1, happy: 0.05, surprised: 0.85 }), { emocion: "surprised", porcentaje: 85 });
  assert.deepEqual(EMO.interpretarExpresiones({ neutral: 0.9, sad: 0.1 }), { emocion: "neutral", porcentaje: 90 });
});

test("interpretarExpresiones es tolerante a entradas inválidas", () => {
  assert.deepEqual(EMO.interpretarExpresiones(null), { emocion: "neutral", porcentaje: 0 });
  assert.deepEqual(EMO.interpretarExpresiones({}), { emocion: "neutral", porcentaje: 0 });
  assert.deepEqual(EMO.interpretarExpresiones({ happy: "no-numero", sad: 0.4 }), { emocion: "sad", porcentaje: 40 });
});

test("crearPico combina evento, emoción dominante y timestamp", () => {
  const pico = EMO.crearPico("botin_raro", { happy: 0.2, surprised: 0.7 }, 1000);
  assert.deepEqual(pico, { evento: "botin_raro", emocionDominante: "surprised", porcentaje: 70, timestamp: 1000 });
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

test("resumenSesion se queda con el pico (máximo porcentaje) de cada tipo de evento", () => {
  const historial = [
    { evento: "botin_raro", emocionDominante: "surprised", porcentaje: 60, timestamp: 1 },
    { evento: "botin_raro", emocionDominante: "surprised", porcentaje: 85, timestamp: 2 },
    { evento: "jefe_vencido", emocionDominante: "happy", porcentaje: 70, timestamp: 3 },
  ];
  const r = EMO.resumenSesion(historial);
  assert.equal(r.picos.length, 2);
  const botin = r.picos.find((p) => p.evento === "botin_raro");
  assert.equal(botin.porcentaje, 85);
  assert.equal(botin.etiqueta, "Sorpresa al obtener botín");
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
  assert.equal(await EMO.capturarPico("botin_raro"), null);
  assert.equal(await EMO.capturarPico("evento_inventado"), null);
});
