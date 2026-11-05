import { test } from "node:test";
import assert from "node:assert/strict";
import { interpretarRespuesta, reclamarBotin } from "../js/api.js";

const HASH = "0x" + "ab".repeat(32);

test("200 con drop", () => {
  const r = interpretarRespuesta(200, {
    drop: true, tokenId: "5", txHash: HASH,
    item: { nombre: "Espada Rúnica", tipo: "Espada", rareza: 1, ataque: 12, defensa: 2 },
  });
  assert.equal(r.tipo, "drop");
  assert.equal(r.tokenId, "5");
  assert.equal(r.txHash, HASH);
  assert.equal(r.item.tokenId, "5");
  assert.equal(r.item.rareza, 1);
});

test("txHash malformado se descarta", () => {
  const r = interpretarRespuesta(200, { drop: true, tokenId: "1", txHash: "javascript:alert(1)", item: { nombre: "x", tipo: "Botas", rareza: 0, ataque: 0, defensa: 1 } });
  assert.equal(r.txHash, null);
});

test("200 sin drop", () => {
  assert.deepEqual(interpretarRespuesta(200, { drop: false }), { tipo: "sin_drop" });
});

test("429, 400, 500 y cuerpo vacío", () => {
  assert.deepEqual(interpretarRespuesta(429, { error: "Demasiadas peticiones, espera 7 s" }), { tipo: "limite", mensaje: "Demasiadas peticiones, espera 7 s" });
  assert.equal(interpretarRespuesta(400, { error: "Dirección inválida" }).mensaje, "Dirección inválida");
  assert.equal(interpretarRespuesta(500, { error: "boom" }).tipo, "error");
  assert.match(interpretarRespuesta(502, null).mensaje, /502/);
});

test("reclamarBotin envía {address, enemyLevel} por POST", async () => {
  let llamada;
  const fetchImpl = async (url, opts) => {
    llamada = { url, opts };
    return { status: 200, json: async () => ({ drop: false }) };
  };
  const r = await reclamarBotin("http://srv", "0x1234", 3, { fetchImpl });
  assert.equal(r.tipo, "sin_drop");
  assert.equal(llamada.url, "http://srv/ganar");
  assert.equal(llamada.opts.method, "POST");
  assert.deepEqual(JSON.parse(llamada.opts.body), { address: "0x1234", enemyLevel: 3 });
});

test("reclamarBotin convierte un fallo de red en error", async () => {
  const r = await reclamarBotin("http://srv", "0x1", 1, { fetchImpl: async () => { throw new TypeError("Failed to fetch"); } });
  assert.equal(r.tipo, "error");
  assert.match(r.mensaje, /No se pudo contactar/);
});
