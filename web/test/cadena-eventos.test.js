import { test } from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/cadena/eventos.js";
import { CERO, DEAD, topicoDireccion } from "../js/cadena/lectura.js";

const UNO = 10n ** 18n;
const YO = "0x1111111111111111111111111111111111111111";
const OTRO = "0x2222222222222222222222222222222222222222";
const MERCADO = "0x3333333333333333333333333333333333333333";
const OPERADOR = "0x4444444444444444444444444444444444444444";
const CTX = { yo: YO, direcciones: { mercado: MERCADO, oro: "0x5555555555555555555555555555555555555555" }, operador: OPERADOR };

const suceso = (contrato, nombre, args, extra = {}) => ({
  contrato, nombre, args, bloque: extra.bloque ?? 10, indice: extra.indice ?? 0,
  hash: extra.hash ?? "0xtx", fecha: extra.fecha ?? 1700000000,
});

// ───────── etiquetarDireccion ─────────

test("etiquetarDireccion pone nombre a las direcciones conocidas", () => {
  assert.equal(E.etiquetarDireccion(YO, CTX), "tú");
  assert.equal(E.etiquetarDireccion(MERCADO, CTX), "el contrato Mercado (la caja del juego)");
  assert.equal(E.etiquetarDireccion(OPERADOR, CTX), "la cartera del servidor del juego");
  assert.equal(E.etiquetarDireccion(DEAD, CTX), "la dirección de quemado (0x…dEaD)");
  assert.equal(E.etiquetarDireccion(CERO, CTX), "la nada (acuñado/quemado)");
});

test("etiquetarDireccion no distingue mayúsculas y acorta lo desconocido", () => {
  assert.equal(E.etiquetarDireccion(YO.toUpperCase().replace("0X", "0x"), CTX), "tú");
  assert.equal(E.etiquetarDireccion(OTRO, CTX), "0x2222…2222");
  assert.equal(E.etiquetarDireccion(null, CTX), "—");
});

// ───────── interpretar: eventos de juego ─────────

test("ItemVendido se explica entero: qué se destruye, qué se acuña y qué paga la caja", () => {
  const m = E.interpretar(suceso("mercado", "ItemVendido", { jugador: YO, tokenId: 7n, oro: 300n * UNO, eth: 2n * 10n ** 15n }), CTX);
  assert.equal(m.titulo, "Vendiste el objeto #7 a la tienda");
  assert.equal(m.oro, 300n * UNO);
  assert.equal(m.eth, 2n * 10n ** 15n);
  assert.match(m.detalle[0], /se destruye/);
  assert.match(m.detalle[1], /acuña/);
  assert.match(m.detalle[2], /caja del Mercado te paga/);
});

test("ItemVendido sin ETH lo dice en vez de callárselo", () => {
  const m = E.interpretar(suceso("mercado", "ItemVendido", { jugador: YO, tokenId: 1n, oro: 20n * UNO, eth: 0n }), CTX);
  assert.equal(m.eth, 0n);
  assert.match(m.detalle.at(-1), /no te pagó ETH/i);
});

test("CosmeticoComprado deja claro que el ORO se quema y no lo cobra nadie", () => {
  const m = E.interpretar(suceso("mercado", "CosmeticoComprado", { jugador: YO, id: 6n, cantidad: 1n, oro: 600n * UNO }), CTX);
  assert.match(m.titulo, /Corona del campeón/);
  assert.equal(m.oro, -600n * UNO);
  assert.match(m.detalle[0], /queman/);
  assert.match(m.detalle[0], /no van a ninguna cartera/);
});

test("CosmeticoComprado con cantidad > 1 lo dice en el título", () => {
  const m = E.interpretar(suceso("mercado", "CosmeticoComprado", { jugador: YO, id: 14n, cantidad: 3n, oro: 75n * UNO }), CTX);
  assert.match(m.titulo, /^Compraste 3 × Poción extra$/);
});

test("DiarioReclamado cuenta la racha, y el cosmético solo si lo hubo", () => {
  const sin = E.interpretar(suceso("recompensas", "DiarioReclamado", { jugador: YO, dia: 20000n, racha: 3n, oro: 20n * UNO, cosmeticoId: 0n }), CTX);
  assert.equal(sin.detalle.length, 1);
  assert.equal(sin.oro, 20n * UNO);
  const con = E.interpretar(suceso("recompensas", "DiarioReclamado", { jugador: YO, dia: 20000n, racha: 7n, oro: 40n * UNO, cosmeticoId: 9n }), CTX);
  assert.equal(con.detalle.length, 2);
  assert.match(con.detalle[1], /Alas de fénix/);
});

test("Recompensado enseña el motivo que quedó escrito en la cadena", () => {
  const m = E.interpretar(suceso("recompensas", "Recompensado", { jugador: YO, cantidad: 50n * UNO, motivo: "torre piso 10" }), CTX);
  assert.match(m.titulo, /El servidor te pagó/);
  assert.match(m.detalle[0], /«torre piso 10»/);
  assert.equal(m.oro, 50n * UNO);
});

test("Vendido del MercadoP2P se cuenta distinto según seas vendedor o comprador", () => {
  const args = { tokenId: 4n, vendedor: YO, comprador: OTRO, precio: 100n * UNO, comision: 5n * UNO, rareza: 1 };
  const comoVendedor = E.interpretar(suceso("mercadoP2P", "Vendido", args), CTX);
  assert.match(comoVendedor.titulo, /Vendiste el objeto #4 a otro jugador/);
  assert.equal(comoVendedor.oro, 95n * UNO); // cobra el precio menos la comisión

  const comoComprador = E.interpretar(suceso("mercadoP2P", "Vendido", { ...args, vendedor: OTRO, comprador: YO }), { ...CTX });
  assert.match(comoComprador.titulo, /Compraste el objeto #4 a otro jugador/);
  assert.equal(comoComprador.oro, -100n * UNO); // paga el precio entero
});

// ───────── interpretar: tokens ─────────

test("gameItem.Transfer distingue acuñar, enviar, recibir y destruir", () => {
  const t = (from, to) => E.interpretar(suceso("gameItem", "Transfer", { from, to, tokenId: 3n }), CTX);
  assert.match(t(CERO, YO).titulo, /recién acuñado/);
  assert.match(t(YO, DEAD).titulo, /se destruyó/);
  assert.match(t(YO, OTRO).titulo, /Enviaste/);
  assert.match(t(OTRO, YO).titulo, /Recibiste/);
});

test("oro.Transfer entre terceros no es tu movimiento y se descarta", () => {
  const ajeno = E.interpretar(suceso("oro", "Transfer", { from: OTRO, to: MERCADO, value: UNO }), CTX);
  assert.equal(ajeno, null);
});

test("oro.Transfer con signo correcto según entre o salga", () => {
  const entra = E.interpretar(suceso("oro", "Transfer", { from: CERO, to: YO, value: 10n * UNO }), CTX);
  assert.equal(entra.oro, 10n * UNO);
  assert.match(entra.titulo, /acuñados/);
  const sale = E.interpretar(suceso("oro", "Transfer", { from: YO, to: CERO, value: 4n * UNO }), CTX);
  assert.equal(sale.oro, -4n * UNO);
  assert.match(sale.titulo, /quemaron/);
});

test("los eventos de configuración no generan movimiento", () => {
  assert.equal(E.interpretar(suceso("oro", "Approval", { owner: YO, spender: MERCADO, value: UNO }), CTX), null);
  assert.equal(E.interpretar(suceso("mercado", "PrecioCofreCambiado", { precio: UNO }), CTX), null);
  assert.equal(E.interpretar(suceso("gameItem", "ApprovalForAll", { owner: YO, operator: MERCADO, approved: true }), CTX), null);
});

test("interpretarTodos descarta los nulos", () => {
  const lista = [
    suceso("mercado", "ItemVendido", { jugador: YO, tokenId: 1n, oro: UNO, eth: 0n }),
    suceso("oro", "Approval", { owner: YO, spender: MERCADO, value: UNO }),
  ];
  assert.equal(E.interpretarTodos(lista, CTX).length, 1);
  assert.equal(E.interpretarTodos(null, CTX).length, 0);
});

// ───────── agruparPorTx ─────────

test("una venta son cuatro eventos pero una sola fila, con el título que mejor la explica", () => {
  const movs = E.interpretarTodos([
    suceso("gameItem", "Transfer", { from: YO, to: DEAD, tokenId: 7n }, { hash: "0xA", indice: 0 }),
    suceso("oro", "Transfer", { from: CERO, to: YO, value: 300n * UNO }, { hash: "0xA", indice: 1 }),
    suceso("mercado", "ItemVendido", { jugador: YO, tokenId: 7n, oro: 300n * UNO, eth: 0n }, { hash: "0xA", indice: 2 }),
  ], CTX);
  const txs = E.agruparPorTx(movs);

  assert.equal(txs.length, 1);
  assert.equal(txs[0].titulo, "Vendiste el objeto #7 a la tienda");
  // El neto NO se dobla aunque el ORO aparezca en dos eventos distintos.
  assert.equal(txs[0].oro, 300n * UNO);
  assert.ok(txs[0].detalle.length >= 3);
  assert.equal(txs[0].movimientos.length, 3);
});

test("sin evento de juego, el neto sí sale de los Transfer de token", () => {
  const movs = E.interpretarTodos([
    suceso("oro", "Transfer", { from: OTRO, to: YO, value: 25n * UNO }, { hash: "0xB" }),
  ], CTX);
  const txs = E.agruparPorTx(movs);
  assert.equal(txs[0].oro, 25n * UNO);
});

test("agruparPorTx ordena de más reciente a más antiguo y no repite líneas de detalle", () => {
  const movs = E.interpretarTodos([
    suceso("mercado", "CofreAbierto", { jugador: YO, id: 1n }, { hash: "0xVIEJO", bloque: 5 }),
    suceso("mercado", "CofreAbierto", { jugador: YO, id: 2n }, { hash: "0xNUEVO", bloque: 50 }),
  ], CTX);
  const txs = E.agruparPorTx(movs);
  assert.deepEqual(txs.map((t) => t.hash), ["0xNUEVO", "0xVIEJO"]);
  assert.equal(new Set(txs[0].detalle).size, txs[0].detalle.length);
});

test("agruparPorTx aguanta una lista vacía", () => {
  assert.deepEqual(E.agruparPorTx([]), []);
  assert.deepEqual(E.agruparPorTx(null), []);
});

// ───────── peticionesHistorial ─────────

test("el historial pregunta por los dos lados de cada Transfer", () => {
  const p = E.peticionesHistorial(YO, topicoDireccion);
  const t = topicoDireccion(YO);
  const oro = p.filter((x) => x.contrato === "oro" && x.evento === "Transfer");
  assert.equal(oro.length, 2, "hace falta una petición por 'de mí' y otra por 'hacia mí'");
  assert.deepEqual(oro[0].filtros, [t, null]);
  assert.deepEqual(oro[1].filtros, [null, t]);
});

test("el historial cubre los contratos del juego y el P2P", () => {
  const contratos = new Set(E.peticionesHistorial(YO, topicoDireccion).map((p) => p.contrato));
  for (const c of ["mercado", "recompensas", "gameItem", "oro", "cosmeticos", "mercadoP2P"]) {
    assert.ok(contratos.has(c), `falta ${c}`);
  }
});

test("en TransferSingle el jugador va en el tópico 2 y 3, no en el 1 (el 1 es el operador)", () => {
  const p = E.peticionesHistorial(YO, topicoDireccion).filter((x) => x.evento === "TransferSingle");
  const t = topicoDireccion(YO);
  assert.deepEqual(p[0].filtros, [null, t, null]);
  assert.deepEqual(p[1].filtros, [null, null, t]);
});

// ───────── formato ─────────

test("fechaTexto aguanta null y timestamps raros", () => {
  assert.equal(E.fechaTexto(null), "—");
  assert.equal(E.fechaTexto(undefined), "—");
  assert.notEqual(E.fechaTexto(1700000000), "—");
});

test("rarezaTexto y corta", () => {
  assert.equal(E.rarezaTexto(0), "Común");
  assert.equal(E.rarezaTexto(2), "Legendario");
  assert.equal(E.rarezaTexto(9), "rareza 9");
  assert.equal(E.corta(YO), "0x1111…1111");
  assert.equal(E.corta(null), "");
});
