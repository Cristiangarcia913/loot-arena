import { test } from "node:test";
import assert from "node:assert/strict";
import * as W from "../js/wallet-errores.js";

const GWEI = 10n ** 9n;
const ETH = 10n ** 18n;

test("rechazo en MetaMask (4001 / ACTION_REJECTED) → código rechazado, sin texto técnico", () => {
  for (const e of [{ code: 4001 }, { code: "ACTION_REJECTED" }, { info: { error: { code: 4001 } } }, new Error("User rejected the request.")]) {
    const m = W.mensajeErrorTransaccion(e);
    assert.equal(m.codigo, "rechazado");
    assert.match(m.texto, /cancelado/);
    assert.equal(m.accion, "reintentar");
  }
});

test("solicitud pendiente en MetaMask (-32002) → abrir MetaMask", () => {
  const m = W.mensajeErrorTransaccion({ code: -32002 });
  assert.deepEqual([m.codigo, m.accion], ["pendiente-wallet", "abrir-metamask"]);
});

test("red incorrecta (RED_INCORRECTA) → cambiar a Sepolia", () => {
  const m = W.mensajeErrorTransaccion(Object.assign(new Error("Red incorrecta"), { code: "RED_INCORRECTA" }));
  assert.deepEqual([m.codigo, m.accion], ["red", "cambiar-red"]);
  assert.match(m.texto, /Sepolia/);
});

test("sin ETH para gas (INSUFFICIENT_FUNDS) → faucet", () => {
  assert.deepEqual(
    [W.mensajeErrorTransaccion({ code: "INSUFFICIENT_FUNDS" }).codigo, W.mensajeErrorTransaccion({ code: "INSUFFICIENT_FUNDS" }).accion],
    ["sin-gas", "faucet"],
  );
  const m = W.mensajeErrorTransaccion(new Error("insufficient funds for gas * price + value"));
  assert.equal(m.codigo, "sin-gas");
  assert.match(m.texto, /ETH de Sepolia/);
});

test("revert decodificado por nombre → mensaje en español y acción", () => {
  const casos = [
    ["SaldoInsuficiente", "sin-oro", /ORO suficiente/, "refrescar"],
    ["ERC721InsufficientApproval", "sin-permiso", /permiso/, "reintentar"],
    ["NoEresDueno", "no-dueno", /ya no es tuyo/, "refrescar"],
    ["ERC721IncorrectOwner", "no-dueno", /ya no es tuyo/, "refrescar"],
    ["NoALaVenta", "no-a-la-venta", /a la venta/, null],
    ["CofreVacio", "cofre-vacio", /cofres/, null],
    ["YaReclamada", "ya-reclamada", /bienvenida/, "refrescar"],
    ["SaldoEthInsuficiente", "caja-vacia", /caja de ETH/, null],
  ];
  for (const [nombre, codigo, texto, accion] of casos) {
    const m = W.mensajeErrorTransaccion({ code: "CALL_EXCEPTION", revert: { name: nombre, args: [] } });
    assert.equal(m.codigo, codigo, nombre);
    assert.match(m.texto, texto, nombre);
    assert.equal(m.accion, accion, nombre);
  }
});

test("revert sin objeto revert: se busca el nombre en el mensaje", () => {
  const m = W.mensajeErrorTransaccion({ code: "CALL_EXCEPTION", message: `execution reverted: custom error 'NoEresDueno("7", "0xabc")'` });
  assert.equal(m.codigo, "no-dueno");
  const otro = W.mensajeErrorTransaccion(new Error("reverted with custom error SaldoInsuficiente(10, 20)"));
  assert.equal(otro.codigo, "sin-oro");
});

test("revert sin nombre reconocible → mensaje genérico con acción refrescar", () => {
  const m = W.mensajeErrorTransaccion({ code: "CALL_EXCEPTION", message: "missing revert data" });
  assert.equal(m.codigo, "revert");
  assert.match(m.texto, /rechazó/);
  assert.equal(m.accion, "refrescar");
});

test("revert con nombre desconocido se muestra con su nombre", () => {
  const m = W.mensajeErrorTransaccion({ code: "CALL_EXCEPTION", revert: { name: "OtraCosa" } });
  assert.equal(m.codigo, "revert");
  assert.match(m.texto, /OtraCosa/);
});

test("transacción reemplazada: cancelada desde MetaMask vs. sustituida", () => {
  const c = W.mensajeErrorTransaccion({ code: "TRANSACTION_REPLACED", reason: "cancelled" });
  assert.deepEqual([c.codigo, c.accion], ["cancelada", "reintentar"]);
  const s = W.mensajeErrorTransaccion({ code: "TRANSACTION_REPLACED", reason: "repriced" });
  assert.deepEqual([s.codigo, s.accion], ["sustituida", "refrescar"]);
});

test("nonce desfasado y reemplazo con tarifa baja", () => {
  const n = W.mensajeErrorTransaccion({ code: "NONCE_EXPIRED", message: "nonce has already been used" });
  assert.equal(n.codigo, "nonce");
  assert.match(n.texto, /nonce/);
  assert.equal(n.accion, "reintentar");
  const r = W.mensajeErrorTransaccion({ code: "REPLACEMENT_UNDERPRICED" });
  assert.deepEqual([r.codigo, r.accion], ["pendiente-red", "abrir-metamask"]);
});

test("espera agotada (TIMEOUT) → revisar en Etherscan, sin reenviar a ciegas", () => {
  const m = W.mensajeErrorTransaccion({ code: "TIMEOUT" });
  assert.equal(m.codigo, "timeout");
  assert.match(m.texto, /Etherscan/);
  assert.equal(m.accion, "refrescar");
});

test("fallos del RPC y cambio de red a mitad → reintentar", () => {
  const rpc = W.mensajeErrorTransaccion({ code: "NETWORK_ERROR", message: "failed to fetch" });
  assert.deepEqual([rpc.codigo, rpc.accion], ["rpc", "reintentar"]);
  const cambio = W.mensajeErrorTransaccion({ code: "NETWORK_ERROR", message: "network changed: 1 => 11155111" });
  assert.deepEqual([cambio.codigo, cambio.accion], ["red-cambiada", "reintentar"]);
});

test("error desconocido: muestra el mensaje original recortado", () => {
  assert.match(W.mensajeErrorTransaccion(new Error("algo raro")).texto, /algo raro/);
  const m = W.mensajeErrorTransaccion(null);
  assert.equal(m.codigo, "desconocido");
  assert.equal(m.accion, "reintentar");
  assert.equal(W.mensajeErrorTransaccion(new Error("x".repeat(500))).texto.length <= "Algo salió mal: ".length + 160, true);
});

test("esFalloDeRed: solo cuenta como fallo de RPC lo que no es revert, rechazo ni falta de ETH", () => {
  assert.equal(W.esFalloDeRed({ code: "NETWORK_ERROR" }), true);
  assert.equal(W.esFalloDeRed(new Error("could not coalesce error")), true);
  assert.equal(W.esFalloDeRed({ code: "CALL_EXCEPTION", revert: { name: "NoEresDueno" } }), false);
  assert.equal(W.esFalloDeRed({ code: 4001 }), false);
  assert.equal(W.esFalloDeRed({ code: "INSUFFICIENT_FUNDS" }), false);
});

test("nombreRevert busca errores conocidos aunque no vengan decodificados", () => {
  assert.equal(W.nombreRevert({ revert: { name: "CofreVacio" } }), "CofreVacio");
  assert.equal(W.nombreRevert(new Error("el contrato dijo ERC721InsufficientApproval")), "ERC721InsufficientApproval");
  assert.equal(W.nombreRevert(new Error("nada")), null);
});

test("gas de respaldo: 350 000 para un objeto, +120 000 por objeto extra, tope 3 000 000", () => {
  assert.equal(W.gasRespaldo(), 350000n);
  assert.equal(W.gasRespaldo(1), 350000n);
  assert.equal(W.gasRespaldo(3), 590000n);
  assert.equal(W.gasRespaldo(0), 350000n);
  assert.equal(W.gasRespaldo(100), 3000000n);
  assert.equal(W.conMargenGas(100000n), 120000n);
});

test("tarifas acotadas a 40 gwei y prioridad a 2 gwei; sin datos → vacío", () => {
  assert.deepEqual(W.tarifasAcotadas({ maxFeePerGas: 500n * GWEI, maxPriorityFeePerGas: 3n * GWEI }),
    { maxFeePerGas: 40n * GWEI, maxPriorityFeePerGas: 2n * GWEI });
  assert.deepEqual(W.tarifasAcotadas({ maxFeePerGas: 5n * GWEI, maxPriorityFeePerGas: 1n * GWEI }),
    { maxFeePerGas: 5n * GWEI, maxPriorityFeePerGas: 1n * GWEI });
  assert.deepEqual(W.tarifasAcotadas({ maxFeePerGas: 1n * GWEI, maxPriorityFeePerGas: 2n * GWEI }),
    { maxFeePerGas: 1n * GWEI, maxPriorityFeePerGas: 1n * GWEI });
  assert.deepEqual(W.tarifasAcotadas({ maxFeePerGas: 10n * GWEI, maxPriorityFeePerGas: null }),
    { maxFeePerGas: 10n * GWEI, maxPriorityFeePerGas: 2n * GWEI });
  assert.deepEqual(W.tarifasAcotadas(null), {});
  assert.deepEqual(W.tarifasAcotadas({}), {});
});

test("con tarifa base: sugiere 2 × base + propina de 0,01 gwei (venta de ~420k gas cuesta céntimos de ETH de prueba)", () => {
  const prio = W.PROPINA_SEPOLIA_WEI;
  assert.equal(prio, 10_000_000n);
  // Sepolia real: base ≈ 20 wei
  assert.deepEqual(W.tarifasAcotadas({ baseFeePerGas: 20n }), { maxFeePerGas: 40n + prio, maxPriorityFeePerGas: prio });
  const coste = 420000n * (40n + prio);
  assert.ok(coste < 10n ** 13n, "una venta debe costar menos de 0,00001 ETH"); // jugador con 0,00037 ETH puede vender
  // Base disparada: se respeta el tope de 40 gwei
  assert.deepEqual(W.tarifasAcotadas({ baseFeePerGas: 100n * GWEI }), { maxFeePerGas: 40n * GWEI, maxPriorityFeePerGas: prio });
});

test("evaluarGas: bloquea por debajo de 0,0001 ETH, avisa por debajo de 0,001", () => {
  assert.equal(W.evaluarGas(0n).nivel, "bloqueo");
  assert.equal(W.evaluarGas(10n ** 14n - 1n).nivel, "bloqueo");
  assert.equal(W.evaluarGas(10n ** 14n).nivel, "aviso");
  assert.equal(W.evaluarGas(10n ** 15n - 1n).nivel, "aviso");
  assert.equal(W.evaluarGas(ETH).nivel, "ok");
  assert.equal(W.evaluarGas(null).nivel, "desconocido");
  assert.equal(W.evaluarGas("no es un número").nivel, "desconocido");
});

test("hastaQue reintenta lecturas desfasadas y lanzamientos fallidos con esperas crecientes", async () => {
  const valores = [1, 1, 2, 3];
  const esperas = [];
  const r = await W.hastaQue(async () => {
    const v = valores.shift();
    if (v === undefined) throw new Error("no debería llegar");
    return v;
  }, (v) => v === 2, { intentos: 5, esperaMs: 100, dormir: async (ms) => { esperas.push(ms); } });
  assert.deepEqual([r.ok, r.valor, r.intentos], [true, 2, 3]);
  assert.deepEqual(esperas, [100, 200]);

  let fallos = 0;
  const e = await W.hastaQue(async () => { fallos++; if (fallos < 2) throw new Error("rpc"); return "ok"; },
    (v) => v === "ok", { dormir: async () => {} });
  assert.deepEqual([e.ok, e.valor], [true, "ok"]);

  const nunca = await W.hastaQue(async () => 5, (v) => v === 9, { intentos: 3, dormir: async () => {} });
  assert.deepEqual([nunca.ok, nunca.valor, nunca.intentos], [false, 5, 3]);
});
