import { test } from "node:test";
import assert from "node:assert/strict";
import * as D from "../js/cadena/desglose.js";
import { CERO, DEAD } from "../js/cadena/lectura.js";

const UNO = 10n ** 18n;
const YO = "0x1111111111111111111111111111111111111111";
const OTRO = "0x2222222222222222222222222222222222222222";
const MERCADO = "0x3333333333333333333333333333333333333333";
const CTX = { yo: YO, direcciones: { mercado: MERCADO } };

const suceso = (contrato, nombre, args) => ({ contrato, nombre, args, bloque: 1, indice: 0, hash: "0xtx" });
const de = (d, quien) => d.reparto.find((r) => r.quien === quien);

// ───────── antes de firmar: venta ─────────

test("preverVenta: el objeto se destruye, el ORO se acuña y el ETH sale de la caja", () => {
  const d = D.preverVenta({
    tokenId: 7, precioOro: 300n * UNO, ethPrevisto: 2n * 10n ** 15n,
    gas: 10n ** 14n, ctx: CTX,
  });

  assert.match(d.titulo, /objeto #7/);
  const objeto = d.flujos.find((f) => f.activo === "objeto");
  assert.equal(objeto.clase, "destruido");
  assert.match(objeto.texto, /se destruye/);

  // El jugador gana el ORO acuñado y el ETH de la caja, y paga el gas.
  const yo = de(d, "tú");
  assert.equal(yo.oro, 300n * UNO);
  assert.equal(yo.eth, 2n * 10n ** 15n - 10n ** 14n);

  // La caja del Mercado pierde exactamente ese ETH: nadie más lo toca.
  assert.equal(de(d, "el contrato Mercado (la caja del juego)").eth, -2n * 10n ** 15n);
  // El gas se lo lleva el validador, no el juego. Esto es lo que pidió el profesor.
  assert.equal(de(d, D.VALIDADOR).eth, 10n ** 14n);
  // El ORO no sale de ninguna cartera: aparece.
  assert.equal(de(d, D.ACUNADO), undefined, "lo acuñado no es un pagador, es un origen");
});

test("preverVenta avisa cuando la caja no va a pagar ETH", () => {
  const d = D.preverVenta({ tokenId: 1, precioOro: 20n * UNO, ethPrevisto: 0n, ctx: CTX });
  assert.ok(d.avisos.some((a) => /no te va a pagar ETH/i.test(a)));
  assert.equal(d.flujos.filter((f) => f.activo === "eth").length, 0);
});

test("preverVenta avisa si la caja tiene menos de lo previsto o se agotó el cupo diario", () => {
  const sinCaja = D.preverVenta({ tokenId: 1, precioOro: UNO, ethPrevisto: 5n, cajaEth: 1n, ctx: CTX });
  assert.ok(sinCaja.avisos.some((a) => /menos ETH del previsto/i.test(a)));
  const sinCupo = D.preverVenta({ tokenId: 1, precioOro: UNO, ethPrevisto: 0n, restanteHoy: 0n, ctx: CTX });
  assert.ok(sinCupo.avisos.some((a) => /máximo de ETH por dirección/i.test(a)));
});

test("preverVenta deja dicho que el juego no cobra comisión por la venta a la tienda", () => {
  const d = D.preverVenta({ tokenId: 1, precioOro: UNO, ethPrevisto: 0n, ctx: CTX });
  assert.ok(d.avisos.some((a) => /no se queda ninguna comisión/i.test(a)));
});

// ───────── antes de firmar: compra ─────────

test("preverCompraCosmetico: el ORO se quema y no hay beneficiario", () => {
  const d = D.preverCompraCosmetico({ precioOro: 600n * UNO, id: 6, gas: 10n ** 14n, ctx: CTX });
  assert.equal(de(d, "tú").oro, -600n * UNO);
  assert.equal(de(d, D.QUEMADO).oro, 600n * UNO);
  // Nadie más recibe ORO: ni el Mercado, ni el dueño.
  const conOro = d.reparto.filter((r) => r.oro > 0n);
  assert.deepEqual(conOro.map((r) => r.quien), [D.QUEMADO]);
});

test("preverCompraCosmetico de un cofre explica el azar del contrato", () => {
  const d = D.preverCompraCosmetico({ precioOro: 120n * UNO, gas: null, ctx: CTX, cofre: true });
  assert.match(d.titulo, /cofre/);
  assert.ok(d.avisos.some((a) => /prevrandao/.test(a)));
  assert.equal(d.gas, null);
});

// ───────── antes de firmar: P2P ─────────

test("preverCompraP2P reparte precio − comisión al vendedor y quema la comisión", () => {
  const d = D.preverCompraP2P({ tokenId: 4, precio: 100n * UNO, comisionBps: 500, vendedor: OTRO, ctx: CTX });
  assert.equal(de(d, "tú").oro, -100n * UNO);
  assert.equal(de(d, "0x2222…2222").oro, 95n * UNO);
  assert.equal(de(d, D.QUEMADO).oro, 5n * UNO);
  assert.ok(d.avisos.some((a) => /5,00 %/.test(a)));
});

test("preverCompraP2P con comisión 0 no quema nada", () => {
  const d = D.preverCompraP2P({ tokenId: 4, precio: 100n * UNO, comisionBps: 0, vendedor: OTRO, ctx: CTX });
  assert.equal(de(d, "0x2222…2222").oro, 100n * UNO);
  assert.equal(de(d, D.QUEMADO), undefined);
});

// ───────── después: el recibo real ─────────

test("leerRecibo reconstruye el movimiento de una venta desde sus eventos", () => {
  const real = D.leerRecibo({
    sucesos: [
      suceso("gameItem", "Transfer", { from: YO, to: DEAD, tokenId: 7n }),
      suceso("oro", "Transfer", { from: CERO, to: YO, value: 300n * UNO }),
      suceso("mercado", "ItemVendido", { jugador: YO, tokenId: 7n, oro: 300n * UNO, eth: 2n * 10n ** 15n }),
    ],
    gasUsado: 150_000n, precioGas: 10n ** 9n, pagador: YO, ctx: CTX,
  });
  assert.equal(real.gas, 150_000n * 10n ** 9n);
  assert.equal(de(real, "tú").oro, 300n * UNO);
  assert.equal(de(real, "el contrato Mercado (la caja del juego)").eth, -2n * 10n ** 15n);
  assert.equal(de(real, D.VALIDADOR).eth, 150_000n * 10n ** 9n);
});

test("leerRecibo dice la verdad cuando la transacción no movió nada nuestro", () => {
  const real = D.leerRecibo({ sucesos: [], gasUsado: 21_000n, precioGas: 10n ** 9n, pagador: YO, ctx: CTX });
  assert.ok(real.avisos.some((a) => /no emitió ningún evento/i.test(a)));
  assert.equal(de(real, "tú").eth, -21_000n * 10n ** 9n); // solo pagó gas
});

test("leerRecibo sin datos de gas no inventa un gas", () => {
  const real = D.leerRecibo({ sucesos: [], ctx: CTX });
  assert.equal(real.gas, null);
  assert.equal(real.flujos.filter((f) => f.clase === "gas").length, 0);
});

// ───────── decodificarRecibo ─────────

test("decodificarRecibo solo mira los logs de nuestros contratos", () => {
  const contratos = {
    mercado: {
      address: MERCADO,
      interface: {
        parseLog: () => ({
          name: "ItemVendido",
          fragment: { inputs: [{ name: "jugador" }, { name: "tokenId" }, { name: "oro" }, { name: "eth" }] },
          args: [YO, 7n, 300n * UNO, 0n],
        }),
      },
    },
    oro: null,
  };
  const recibo = {
    hash: "0xabc", blockNumber: 42,
    logs: [
      { address: MERCADO, topics: ["0x1"], data: "0x", logIndex: 0 },
      { address: "0x9999999999999999999999999999999999999999", topics: ["0x1"], data: "0x", logIndex: 1 },
    ],
  };
  const s = D.decodificarRecibo(recibo, contratos);
  assert.equal(s.length, 1, "el log de un contrato ajeno se ignora");
  assert.equal(s[0].contrato, "mercado");
  assert.equal(s[0].args.tokenId, 7n);
  assert.equal(s[0].bloque, 42);
  assert.equal(s[0].hash, "0xabc");
});

test("decodificarRecibo aguanta un log que su propio ABI no sabe leer", () => {
  const contratos = {
    mercado: { address: MERCADO, interface: { parseLog: () => { throw new Error("no es mío"); } } },
  };
  const s = D.decodificarRecibo({ logs: [{ address: MERCADO, topics: [], data: "0x" }] }, contratos);
  assert.deepEqual(s, []);
});

// ───────── comparar: la verificación ─────────

test("comparar dice que cuadra cuando el contrato hizo lo anunciado", () => {
  const previsto = D.preverVenta({ tokenId: 7, precioOro: 300n * UNO, ethPrevisto: 2n * 10n ** 15n, gas: 10n ** 14n, ctx: CTX });
  const real = D.leerRecibo({
    sucesos: [
      suceso("gameItem", "Transfer", { from: YO, to: DEAD, tokenId: 7n }),
      suceso("oro", "Transfer", { from: CERO, to: YO, value: 300n * UNO }),
      suceso("mercado", "ItemVendido", { jugador: YO, tokenId: 7n, oro: 300n * UNO, eth: 2n * 10n ** 15n }),
    ],
    gasUsado: 150_000n, precioGas: 10n ** 9n, pagador: YO, ctx: CTX,
  });
  const c = D.comparar(previsto, real);
  assert.equal(c.coincide, true, c.diferencias.join(" | "));
  assert.ok(c.lineas.every((l) => l.igual));
});

test("comparar CAZA al contrato que paga menos de lo anunciado", () => {
  const previsto = D.preverVenta({ tokenId: 7, precioOro: 300n * UNO, ethPrevisto: 0n, ctx: CTX });
  const real = D.leerRecibo({
    sucesos: [
      suceso("gameItem", "Transfer", { from: YO, to: DEAD, tokenId: 7n }),
      suceso("oro", "Transfer", { from: CERO, to: YO, value: 100n * UNO }), // ¡solo 100!
      suceso("mercado", "ItemVendido", { jugador: YO, tokenId: 7n, oro: 100n * UNO, eth: 0n }),
    ],
    ctx: CTX,
  });
  const c = D.comparar(previsto, real);
  assert.equal(c.coincide, false);
  assert.ok(c.diferencias.some((d) => /tú/.test(d)));
  assert.ok(c.lineas.some((l) => l.quien === "tú" && !l.igual));
});

test("comparar CAZA el ORO que se desvía a una cartera que no se había anunciado", () => {
  const previsto = D.preverCompraCosmetico({ precioOro: 600n * UNO, id: 6, ctx: CTX });
  // Lo anunciado: quemar 600. Lo ocurrido: 600 a una cartera cualquiera.
  const real = D.leerRecibo({
    sucesos: [suceso("oro", "Transfer", { from: YO, to: OTRO, value: 600n * UNO })],
    ctx: CTX,
  });
  const c = D.comparar(previsto, real);
  assert.equal(c.coincide, false);
  assert.ok(c.diferencias.some((d) => d.includes(D.QUEMADO)), "debe notar que no se quemó");
  assert.ok(c.diferencias.some((d) => /0x2222/.test(d)), "debe señalar al que cobró de más");
});

test("comparar no se queja por una diferencia normal de gas", () => {
  const previsto = D.preverVenta({ tokenId: 1, precioOro: UNO, ethPrevisto: 0n, gas: 10n ** 14n, ctx: CTX });
  const real = D.leerRecibo({
    sucesos: [
      suceso("gameItem", "Transfer", { from: YO, to: DEAD, tokenId: 1n }),
      suceso("oro", "Transfer", { from: CERO, to: YO, value: UNO }),
      suceso("mercado", "ItemVendido", { jugador: YO, tokenId: 1n, oro: UNO, eth: 0n }),
    ],
    gasUsado: 130_000n, precioGas: 10n ** 9n, pagador: YO, ctx: CTX, // 1,3e14: algo más de lo estimado
  });
  const c = D.comparar(previsto, real);
  assert.equal(c.coincide, true, c.diferencias.join(" | "));
});

test("comparar sí avisa si el gas real se dispara al doble de lo estimado", () => {
  const previsto = D.preverVenta({ tokenId: 1, precioOro: UNO, ethPrevisto: 0n, gas: 10n ** 14n, ctx: CTX });
  const real = D.leerRecibo({
    sucesos: [
      suceso("gameItem", "Transfer", { from: YO, to: DEAD, tokenId: 1n }),
      suceso("oro", "Transfer", { from: CERO, to: YO, value: UNO }),
      suceso("mercado", "ItemVendido", { jugador: YO, tokenId: 1n, oro: UNO, eth: 0n }),
    ],
    gasUsado: 500_000n, precioGas: 10n ** 9n, pagador: YO, ctx: CTX,
  });
  const c = D.comparar(previsto, real);
  assert.equal(c.coincide, false);
  assert.ok(c.diferencias.some((d) => /gas real/i.test(d)));
});

// ───────── repartir ─────────

test("repartir no se inventa beneficiarios y descarta los netos a cero", () => {
  const r = D.repartir([
    { activo: "oro", cantidad: 10n, de: "A", a: "B", clase: "transferido" },
    { activo: "oro", cantidad: 10n, de: "B", a: "A", clase: "transferido" },
  ]);
  assert.deepEqual(r, [], "si todo vuelve a su sitio, nadie se lleva nada");
});

test("repartir ignora los activos que no son dinero", () => {
  const r = D.repartir([{ activo: "objeto", cantidad: 1n, id: 3, de: "A", a: "B", clase: "transferido" }]);
  assert.deepEqual(r, []);
});
