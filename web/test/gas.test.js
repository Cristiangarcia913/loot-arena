import { test } from "node:test";
import assert from "node:assert/strict";
import { asegurarGas, estadoGas, MSG_GAS, GAS_ESPERA_MAX_MS } from "../js/gas.js";

const CUENTA = "0x1234567890abcdef1234567890abcdef12345678";
const URL_SRV = "https://srv.test/";
const E = (x) => BigInt(Math.round(x * 1e6)) * 10n ** 12n; // ETH → wei

/** Provider simulado: devuelve los saldos de la lista (el último se repite); "error" lanza. */
function proveedor(saldos) {
  let i = 0;
  const p = {
    lecturas: 0,
    async getBalance(a) {
      assert.equal(a, CUENTA);
      p.lecturas++;
      const v = saldos[Math.min(i++, saldos.length - 1)];
      if (v === "error") throw new Error("RPC caído");
      return v;
    },
  };
  return p;
}

/** fetch simulado que responde `status`/`body` y guarda las llamadas. */
function falsoFetch(status, body) {
  const f = async (url, init) => {
    f.llamadas.push({ url, init });
    if (status === "red") throw new TypeError("Failed to fetch");
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  f.llamadas = [];
  return f;
}

function reloj() {
  const esperar = async (ms) => { esperar.total += ms; esperar.veces++; };
  esperar.total = 0; esperar.veces = 0;
  return esperar;
}

test("saldo suficiente: no llama al servidor", async () => {
  const f = falsoFetch(200, {});
  const r = await asegurarGas({ provider: proveedor([E(0.01)]), cuenta: CUENTA, serverUrl: URL_SRV, fetch: f, esperar: reloj() });
  assert.equal(r.ok, true);
  assert.equal(r.codigo, "suficiente");
  assert.equal(r.pedido, false);
  assert.equal(f.llamadas.length, 0);
});

test("saldo desconocido (RPC caído): deja pasar sin pedir", async () => {
  const f = falsoFetch(200, {});
  const r = await asegurarGas({ provider: proveedor(["error"]), cuenta: CUENTA, serverUrl: URL_SRV, fetch: f, esperar: reloj() });
  assert.equal(r.ok, true);
  assert.equal(r.codigo, "desconocido");
  assert.equal(f.llamadas.length, 0);
});

test("sin gas: pide POST /gas, espera y el saldo llega (tolera lecturas desfasadas y fallos de RPC)", async () => {
  const f = falsoFetch(200, { ok: true, enviado: "500000000000000", txHash: "0xabc" });
  const p = proveedor([0n, 0n, "error", 0n, E(0.0005)]);
  const esperar = reloj();
  const estados = [];
  const r = await asegurarGas({ provider: p, cuenta: CUENTA, serverUrl: URL_SRV, fetch: f, esperar, onEstado: (t, fase) => estados.push(fase) });
  assert.equal(r.ok, true);
  assert.equal(r.codigo, "recibido");
  assert.equal(r.txHash, "0xabc");
  assert.equal(r.mensaje, MSG_GAS.llegado);
  assert.equal(r.saldo, E(0.0005));
  assert.deepEqual(estados, ["pidiendo", "esperando"]);
  assert.equal(f.llamadas.length, 1);
  assert.equal(f.llamadas[0].url, "https://srv.test/gas");
  assert.equal(f.llamadas[0].init.method, "POST");
  assert.deepEqual(JSON.parse(f.llamadas[0].init.body), { address: CUENTA });
  assert.equal(esperar.veces, 4);
  assert.ok(esperar.total < GAS_ESPERA_MAX_MS);
});

test("poco gas pero suficiente para firmar: pide y no espera", async () => {
  const f = falsoFetch(200, { ok: true, enviado: 0.0005, txHash: "0xdef" });
  const esperar = reloj();
  const r = await asegurarGas({ provider: proveedor([E(0.0002)]), cuenta: CUENTA, serverUrl: URL_SRV, fetch: f, esperar });
  assert.equal(r.ok, true);
  assert.equal(r.codigo, "en-camino");
  assert.equal(r.mensaje, MSG_GAS.enviado);
  assert.equal(esperar.veces, 0);
});

test("409: ya pedido hoy", async () => {
  const f = falsoFetch(409, { error: "ya pedido" });
  const r = await asegurarGas({ provider: proveedor([0n]), cuenta: CUENTA, serverUrl: URL_SRV, fetch: f, esperar: reloj() });
  assert.equal(r.ok, false);
  assert.equal(r.codigo, "ya-pedido");
  assert.equal(r.mensaje, MSG_GAS.yaPedido);
  assert.match(r.mensaje, /Ya pediste gas hoy/);
});

test("409 con saldo bajo pero firmable: deja pasar sin mensaje de error", async () => {
  const r = await asegurarGas({ provider: proveedor([E(0.0002)]), cuenta: CUENTA, serverUrl: URL_SRV, fetch: falsoFetch(409, {}), esperar: reloj() });
  assert.equal(r.ok, true);
  assert.equal(r.codigo, "ya-pedido");
  assert.equal(r.mensaje, "");
});

test("503: el servidor no tiene fondos", async () => {
  const r = await asegurarGas({ provider: proveedor([0n]), cuenta: CUENTA, serverUrl: URL_SRV, fetch: falsoFetch(503, {}), esperar: reloj() });
  assert.equal(r.ok, false);
  assert.equal(r.codigo, "sin-fondos");
  assert.match(r.mensaje, /El servidor no tiene fondos ahora/);
  const tope = await asegurarGas({ provider: proveedor([0n]), cuenta: CUENTA, serverUrl: URL_SRV, fetch: falsoFetch(503, { error: "Se ha agotado el gas de hoy para todos; vuelve mañana" }), esperar: reloj() });
  assert.equal(tope.codigo, "sin-fondos");
  assert.match(tope.mensaje, /agotado el gas de hoy/);
});

test("fallo de red y otros errores HTTP", async () => {
  const red = await asegurarGas({ provider: proveedor([0n]), cuenta: CUENTA, serverUrl: URL_SRV, fetch: falsoFetch("red"), esperar: reloj() });
  assert.equal(red.ok, false);
  assert.equal(red.codigo, "sin-red");
  const e429 = await asegurarGas({ provider: proveedor([0n]), cuenta: CUENTA, serverUrl: URL_SRV, fetch: falsoFetch(429, {}), esperar: reloj() });
  assert.equal(e429.codigo, "demasiadas");
  const e400 = await asegurarGas({ provider: proveedor([0n]), cuenta: CUENTA, serverUrl: URL_SRV, fetch: falsoFetch(400, { error: "address inválida" }), esperar: reloj() });
  assert.equal(e400.ok, false);
  assert.match(e400.mensaje, /address inválida/);
  const sin = await asegurarGas({ provider: proveedor([0n]), cuenta: CUENTA, serverUrl: "", fetch: falsoFetch(200, {}), esperar: reloj() });
  assert.equal(sin.codigo, "sin-servidor");
  assert.equal(sin.ok, false);
});

test("tiempo agotado: el gas se envió pero el saldo no sube en ~60 s", async () => {
  const esperar = reloj();
  const p = proveedor([0n]);
  const r = await asegurarGas({ provider: p, cuenta: CUENTA, serverUrl: URL_SRV, fetch: falsoFetch(200, { ok: true, enviado: "1", txHash: "0x1" }), esperar });
  assert.equal(r.ok, false);
  assert.equal(r.codigo, "tarda");
  assert.equal(r.txHash, "0x1");
  assert.equal(r.mensaje, MSG_GAS.tarda);
  assert.equal(esperar.total, GAS_ESPERA_MAX_MS);
  assert.ok(p.lecturas > 3);
});

test("enviado:0 con motivo: relee por si el RPC iba atrasado", async () => {
  const ok = await asegurarGas({ provider: proveedor([0n, E(0.001)]), cuenta: CUENTA, serverUrl: URL_SRV, fetch: falsoFetch(200, { ok: true, enviado: 0, motivo: "saldo suficiente" }), esperar: reloj() });
  assert.equal(ok.ok, true);
  assert.equal(ok.codigo, "no-hace-falta");
  const no = await asegurarGas({ provider: proveedor([0n]), cuenta: CUENTA, serverUrl: URL_SRV, fetch: falsoFetch(200, { ok: true, enviado: 0, motivo: "saldo suficiente" }), esperar: reloj() });
  assert.equal(no.ok, false);
  assert.match(no.mensaje, /saldo suficiente/);
});

test("leerSaldo sustituye al provider", async () => {
  const r = await asegurarGas({ leerSaldo: async () => E(1), cuenta: CUENTA, serverUrl: URL_SRV, fetch: falsoFetch(200, {}) });
  assert.equal(r.codigo, "suficiente");
});

test("estadoGas: GET /gas/:address", async () => {
  const f = falsoFetch(200, { saldo: "0.0005", puedePedir: true, proximoEn: 0 });
  const r = await estadoGas("https://srv.test/", CUENTA, { fetch: f, ahora: 1000 });
  assert.equal(f.llamadas[0].url, `https://srv.test/gas/${CUENTA}`);
  assert.deepEqual(r, { ok: true, saldo: 5n * 10n ** 14n, motivo: null, puedePedir: true, proximoEn: 0, proximoMs: 1000 });
  const no = await estadoGas("https://srv.test", CUENTA, { fetch: falsoFetch(200, { saldo: "0.0", puedePedir: false, proximoEn: 3600, motivo: "Ya has pedido gas hoy" }), ahora: 0 });
  assert.equal(no.puedePedir, false);
  assert.equal(no.saldo, 0n);
  assert.equal(no.motivo, "Ya has pedido gas hoy");
  assert.equal(no.proximoMs, 3_600_000);
  const err = await estadoGas("https://srv.test", CUENTA, { fetch: falsoFetch(503, { error: "despertando" }) });
  assert.deepEqual(err, { ok: false, status: 503, mensaje: "despertando" });
  const red = await estadoGas("https://srv.test", CUENTA, { fetch: falsoFetch("red") });
  assert.equal(red.ok, false);
});
