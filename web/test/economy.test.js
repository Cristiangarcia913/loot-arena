import { test } from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/economy.js";

const UNO = 10n ** 18n;

test("precioVentaLocal: base[rareza] + 2·(ataque+defensa) con base [10,40,200]", () => {
  assert.equal(E.precioVentaLocal({ rareza: 0, ataque: 0, defensa: 0 }), 10);
  assert.equal(E.precioVentaLocal({ rareza: 0, ataque: 3, defensa: 2 }), 20);
  assert.equal(E.precioVentaLocal({ rareza: 1, ataque: 8, defensa: 5 }), 66);
  assert.equal(E.precioVentaLocal({ rareza: 2, ataque: 30, defensa: 14 }), 288);
  assert.equal(E.precioVentaLocal({ rareza: "1", ataque: "4", defensa: "0" }), 48);
  assert.equal(E.precioVentaTotal([{ rareza: 0, ataque: 1, defensa: 1 }, { rareza: 2, ataque: 0, defensa: 0 }]), 14 + 200);
});

test("precioVentaLocal rechaza rarezas y stats inválidas", () => {
  assert.throws(() => E.precioVentaLocal({ rareza: 3, ataque: 1, defensa: 1 }), RangeError);
  assert.throws(() => E.precioVentaLocal({ rareza: -1, ataque: 1, defensa: 1 }), RangeError);
  assert.throws(() => E.precioVentaLocal({ rareza: 0, ataque: -1, defensa: 1 }), RangeError);
  assert.throws(() => E.precioVentaLocal({ rareza: 0, ataque: 1.5, defensa: 1 }), RangeError);
});

test("CATALOGO coincide con MEJORAS.md §5", () => {
  const esperado = [
    [1, "color", 0, 60], [2, "color", 0, 60], [3, "color", 1, 150], [4, "sombrero", 0, 80], [5, "sombrero", 1, 180],
    [6, "sombrero", 2, 600], [7, "capa", 0, 90], [8, "capa", 1, 220], [9, "capa", 2, 800], [10, "aura", 1, 250],
    [11, "aura", 2, 700], [12, "mascota", 1, 300], [13, "mascota", 2, 900], [14, "consumible", 0, 25],
  ];
  assert.deepEqual(E.CATALOGO.map((x) => [x.id, x.ranura, x.rareza, x.precio]), esperado);
  assert.equal(E.cosmetico(6).nombre, "Corona del campeón");
  assert.equal(E.cosmetico("13").nombre, "Mini dragón");
  assert.equal(E.cosmetico(99), null);
  assert.equal(E.ID_POCION, 14);
  assert.equal(E.PRECIO_COFRE, 120);
  assert.ok(Object.isFrozen(E.CATALOGO) && Object.isFrozen(E.CATALOGO[0]));
  for (const x of E.CATALOGO) assert.ok([...E.RANURAS, "consumible"].includes(x.ranura));
});

test("cofre: pool sin consumibles y distribución ~60/32/8", () => {
  const pool = E.poolCofre();
  assert.deepEqual(pool, [[1, 2, 4, 7], [3, 5, 8, 10, 12], [6, 9, 11, 13]]);
  let s = 12345;
  const rng = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const cuenta = [0, 0, 0];
  const N = 30000;
  for (let i = 0; i < N; i++) {
    const id = E.tirarCofre(rng);
    assert.notEqual(id, E.ID_POCION);
    cuenta[E.cosmetico(id).rareza]++;
  }
  assert.ok(Math.abs(cuenta[0] / N - 0.60) < 0.015, `común ${cuenta[0] / N}`);
  assert.ok(Math.abs(cuenta[1] / N - 0.32) < 0.015, `rara ${cuenta[1] / N}`);
  assert.ok(Math.abs(cuenta[2] / N - 0.08) < 0.01, `legendaria ${cuenta[2] / N}`);
  assert.equal(E.tirarCofre(() => 0.999999), 13);
  assert.equal(E.tirarCofre(() => 0), 1);
});

test("recompensa ETH por rareza y estimación con caja y límite diario", () => {
  assert.equal(E.recompensaEthLocal({ rareza: 0 }), 10n ** 14n);      // 0.0001
  assert.equal(E.recompensaEthLocal({ rareza: 1 }), 5n * 10n ** 14n); // 0.0005
  assert.equal(E.recompensaEthLocal({ rareza: 2 }), 2n * 10n ** 15n); // 0.002
  assert.equal(E.MAX_ETH_DIARIO, 5n * 10n ** 15n);
  assert.throws(() => E.recompensaEthLocal({ rareza: 5 }), RangeError);

  const r = [2n * 10n ** 15n, 2n * 10n ** 15n, 2n * 10n ** 15n];
  // Sin límites conocidos: paga todo.
  assert.equal(E.estimarEthVenta(r).total, 6n * 10n ** 15n);
  // Límite diario 0.005: los dos primeros sí, el tercero solo ORO.
  const lim = E.estimarEthVenta(r, { restanteHoy: E.MAX_ETH_DIARIO });
  assert.equal(lim.total, 4n * 10n ** 15n);
  assert.deepEqual(lim.soloOro, [false, false, true]);
  // Caja casi vacía: solo cabe la común barata.
  const caja = E.estimarEthVenta([2n * 10n ** 15n, 10n ** 14n], { caja: 3n * 10n ** 14n });
  assert.deepEqual(caja.porObjeto, [0n, 10n ** 14n]);
  assert.deepEqual(caja.soloOro, [true, false]);
  assert.equal(E.estimarEthVenta([10n ** 14n], { caja: 0n }).total, 0n);
});

test("sumarVentas suma los eventos ItemVendido(jugador, tokenId, oro, eth)", () => {
  const s = E.sumarVentas([
    { tokenId: 7n, oro: 54n * UNO, eth: 5n * 10n ** 14n },
    { tokenId: "8", oro: 10n * UNO },
  ]);
  assert.equal(s.oro, 64n * UNO);
  assert.equal(s.eth, 5n * 10n ** 14n);
  assert.deepEqual(s.tokenIds, ["7", "8"]);
});

test("parseo y formato de saldos ORO/ETH", () => {
  assert.equal(E.aUnidades(50), 50n * UNO);
  assert.equal(E.oroEntero(1234n * UNO + 999n), 1234);
  assert.equal(E.formatearOro(1234n * UNO), "1.234");
  assert.equal(E.formatearOro(0n), "0");
  assert.equal(E.formatearOro(12n * UNO + UNO / 2n, { decimales: 2 }), "12,5");
  assert.equal(E.formatearEth(5n * 10n ** 14n), "0,0005");
  assert.equal(E.formatearEth(2n * 10n ** 15n), "0,002");
  assert.equal(E.formatearEth(UNO + 25n * 10n ** 16n), "1,25");
  assert.equal(E.formatearEth(0n), "0");
  // precioVenta puede venir en ORO entero o en unidades base
  assert.equal(E.normalizarPrecio(54n), 54);
  assert.equal(E.normalizarPrecio(54n * UNO), 54);
  assert.equal(E.normalizarPrecio("0x" + (54n * UNO).toString(16)), 54);
  assert.equal(E.aBigInt({ toString: () => "42" }), 42n);
  assert.throws(() => E.aBigInt("hola"));
  // balanceOfBatch → mapa id→cantidad (sin ceros)
  assert.deepEqual(E.parsearSaldos([1, 2, 14], [0n, 1n, 3n]), { 2: 1, 14: 3 });
  assert.deepEqual(E.parsearSaldos([], []), {});
  assert.throws(() => E.parsearSaldos([1, 2], [1n]), TypeError);
});

test("apariencia: una pieza por ranura", () => {
  let ap = E.aparienciaVacia();
  assert.deepEqual(ap, { color: null, sombrero: null, capa: null, aura: null, mascota: null });
  ap = E.equiparCosmetico(ap, 4);
  ap = E.equiparCosmetico(ap, 6); // sustituye la capucha por la corona
  ap = E.equiparCosmetico(ap, 9);
  assert.deepEqual(ap, { color: null, sombrero: 6, capa: 9, aura: null, mascota: null });
  assert.throws(() => E.equiparCosmetico(ap, 14), RangeError); // consumible
  assert.throws(() => E.equiparCosmetico(ap, 99), RangeError);
  ap = E.quitarRanura(ap, "capa");
  assert.equal(ap.capa, null);
  assert.throws(() => E.quitarRanura(ap, "botas"), RangeError);
});

test("sanearApariencia descarta ids de otra ranura, desconocidos o no poseídos", () => {
  const sucia = { color: 4, sombrero: 6, capa: 9, aura: "x", mascota: 13, extra: 1 };
  assert.deepEqual(E.sanearApariencia(sucia), { color: null, sombrero: 6, capa: 9, aura: null, mascota: 13 });
  assert.deepEqual(E.sanearApariencia(sucia, { 6: 1, 13: 0 }), { color: null, sombrero: 6, capa: null, aura: null, mascota: null });
  assert.deepEqual(E.sanearApariencia(null), E.aparienciaVacia());
  assert.deepEqual(E.parsearApariencia("{roto"), E.aparienciaVacia());
});

test("persistencia de la apariencia por dirección con storage inyectable", () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)) };
  const A = "0xAbC0000000000000000000000000000000000001", B = "0x00000000000000000000000000000000000000b2";
  assert.equal(E.claveApariencia(A), "lootarena:apariencia:0xabc0000000000000000000000000000000000001");
  assert.equal(E.claveApariencia(null), "lootarena:apariencia:invitado");
  E.guardarApariencia(A, { ...E.aparienciaVacia(), sombrero: 5 }, storage);
  E.guardarApariencia(B, { ...E.aparienciaVacia(), mascota: 12 }, storage);
  assert.equal(E.cargarApariencia(A.toLowerCase(), storage).sombrero, 5);
  assert.equal(E.cargarApariencia(B, storage).mascota, 12);
  assert.equal(E.cargarApariencia(B, storage).sombrero, null);
  assert.deepEqual(E.cargarApariencia("0xnadie", storage), E.aparienciaVacia());
  // storage roto o ausente: no lanza
  const roto = { getItem() { throw new Error("bloqueado"); }, setItem() { throw new Error("bloqueado"); } };
  assert.deepEqual(E.cargarApariencia(A, roto), E.aparienciaVacia());
  assert.doesNotThrow(() => E.guardarApariencia(A, E.aparienciaVacia(), roto));
  assert.deepEqual(E.cargarApariencia(A, null), E.aparienciaVacia());
});

test("direcciones: deployments.json con oro/cosmeticos/mercado de la red activa", async () => {
  const dir = (n) => `0x${String(n).repeat(40)}`;
  const dep = { sepolia: { address: dir(1), chainId: 11155111, oro: dir(2), cosmeticos: dir(3), mercado: dir(4) }, localhost: { address: dir(1) } };
  assert.deepEqual(E.direccionesDe(dep, "sepolia"), { oro: dir(2), cosmeticos: dir(3), mercado: dir(4) });
  assert.equal(E.direccionesDe(dep, "localhost"), null);
  assert.equal(E.direccionesDe({ sepolia: { oro: dir(2), cosmeticos: dir(3), mercado: `0x${"0".repeat(40)}` } }, "sepolia"), null);
  assert.equal(E.direccionValida("0x123"), false);
  const f = async () => ({ ok: true, json: async () => dep });
  assert.deepEqual(await E.resolverDirecciones({ red: "sepolia" }, { fetch: f, base: "http://x/js/economy.js" }), E.direccionesDe(dep, "sepolia"));
  assert.equal(await E.resolverDirecciones({ red: "localhost" }, { fetch: f, base: "http://x/js/economy.js" }), null);
  assert.equal(await E.resolverDirecciones({ red: "sepolia" }, { fetch: async () => { throw new Error("red"); }, base: "http://x/" }), null);
  // cfg.economia tiene prioridad y no hace fetch
  const cfg = { red: "sepolia", economia: { oro: dir(5), cosmeticos: dir(6), mercado: dir(7) } };
  assert.equal((await E.resolverDirecciones(cfg, { fetch: () => assert.fail("no debe pedir") })).mercado, dir(7));
});

test("ABI: une el completo con el mínimo sin duplicar nombres", async () => {
  const completo = [{ type: "function", name: "precioVenta", inputs: [], outputs: [] }];
  const u = E.unirAbi(completo, E.ABI_MERCADO);
  assert.equal(u.filter((f) => (typeof f === "string" ? /precioVenta\(/.test(f) : f.name === "precioVenta")).length, 1);
  assert.ok(u.some((f) => typeof f === "string" && f.includes("event ItemVendido(address indexed jugador, uint256 indexed tokenId, uint256 oro, uint256 eth)")));
  for (const fn of ["recompensaEth", "cajaEth", "maxEthDiario", "venderVarios", "abrirCofre", "reclamarBienvenida"]) {
    assert.ok(E.ABI_MERCADO.some((f) => f.includes(`function ${fn}(`)), fn);
  }
  const abis = await E.cargarAbis({ fetch: async () => ({ ok: false }), base: "http://x/js/economy.js" });
  assert.deepEqual(abis.completos, { oro: false, cosmeticos: false, mercado: false });
  assert.deepEqual(abis.mercado, [...E.ABI_MERCADO]);
  assert.deepEqual(E.abiDe({ abi: completo }), completo);
});

test("mensajes de error en español (gas, rechazo, ORO, permiso)", () => {
  assert.equal(E.mensajeErrorEconomia({ code: "ACTION_REJECTED" }).rechazado, true);
  assert.equal(E.mensajeErrorEconomia({ code: "INSUFFICIENT_FUNDS" }).gas, true);
  assert.equal(E.mensajeErrorEconomia(new Error("insufficient funds for gas * price + value")).gas, true);
  assert.match(E.mensajeErrorEconomia({ code: "CALL_EXCEPTION", revert: { name: "SaldoInsuficiente" } }).texto, /ORO suficiente/);
  assert.match(E.mensajeErrorEconomia({ code: "CALL_EXCEPTION", revert: { name: "ERC721InsufficientApproval" } }).texto, /permiso/);
  assert.match(E.mensajeErrorEconomia({ code: "CALL_EXCEPTION", revert: { name: "YaReclamada" } }).texto, /bienvenida/);
});

test("economía simulada: bienvenida, venta ORO+ETH con límite diario, compra y cofre", async () => {
  const inv = [
    { tokenId: "1", rareza: 2, ataque: 20, defensa: 10 },
    { tokenId: "2", rareza: 2, ataque: 1, defensa: 1 },
    { tokenId: "3", rareza: 2, ataque: 1, defensa: 1 },
    { tokenId: "4", rareza: 0, ataque: 1, defensa: 0 },
  ];
  const eco = E.crearEconomiaSimulada({ oro: 0, inventario: inv, latencia: 0, rng: () => 0, pagadoHoy: 2n * 10n ** 15n });
  assert.equal(await eco.bienvenidaReclamada(), false);
  await (await eco.reclamarBienvenida()).esperar();
  assert.equal(await eco.saldoOro(), 50n * UNO);
  await assert.rejects(eco.reclamarBienvenida());

  assert.throws(() => eco.vender(["1"]), /approved/); // sin aprobación
  await (await eco.aprobar()).esperar();
  const eth0 = await eco.saldoEth();
  // cupo restante hoy 0.003: el 1.º legendario cobra 0.002; el 2.º ya no cabe (solo ORO); la común (0.0001) sí.
  const pago = await (await eco.vender(["1", "2", "4"])).esperar();
  assert.equal(pago.oro, BigInt(260 + 204 + 12) * UNO);
  assert.equal(pago.eth, 2n * 10n ** 15n + 10n ** 14n);
  assert.equal((await eco.saldoEth()) - eth0, pago.eth);
  assert.equal(await eco.saldoOro(), BigInt(50 + 476) * UNO);
  await assert.rejects((await eco.vender(["1"])).esperar(), /dueño/);

  await assert.rejects(eco.comprar(6, 1), /ORO/); // 600 > 526
  await (await eco.comprar(5, 1)).esperar();
  assert.equal((await eco.cosmeticos())[5], 1);
  assert.equal(await eco.saldoOro(), 346n * UNO);
  const antes = await eco.saldoOro();
  const id = await (await eco.abrirCofre()).esperar();
  assert.equal(id, 1); // rng() = 0 → común, primero del pool
  assert.equal(antes - (await eco.saldoOro()), 120n * UNO);
  await assert.rejects(eco.comprar(13, 10)); // 9000 ORO: no alcanza
});
