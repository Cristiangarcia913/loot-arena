import { test } from "node:test";
import assert from "node:assert/strict";
import * as DT from "../js/cadena/datos.js";

const UNO = 10n ** 18n;
const YO = "0x1111111111111111111111111111111111111111";
const OTRO = "0x2222222222222222222222222222222222222222";
const OWNER = "0x3333333333333333333333333333333333333333";
const OPERADOR = "0x4444444444444444444444444444444444444444";
const DEAD = "0x000000000000000000000000000000000000dEaD";

// ───────── dobles ─────────

/**
 * Lector falso: solo lo que usa datos.js (contratos, saldoEth, barrer, bloques).
 * `barrer` devuelve la misma forma que el de verdad, incluido lo que dice hasta dónde atrás
 * ha podido leer: `desdeDisponible` y `completo` (ver la cabecera de lectura.js).
 */
function lectorFalso({
  contratos = {}, saldos = {}, sucesos = [], altura = 1000, bloqueDespliegue = 0,
  desdeDisponible = null, completo = true,
} = {}) {
  return {
    contratos,
    bloqueDespliegue,
    async bloqueActual() { return altura; },
    async saldoEth(d) { return saldos[d] ?? null; },
    async barrer(c, e, f, { desde } = {}) {
      return {
        sucesos, recortado: false, fallos: 0,
        desdeDisponible: desdeDisponible ?? desde ?? bloqueDespliegue,
        limitadoPorRpc: !completo,
        completo,
      };
    },
  };
}

function gameItemFalso({ porDueno = {}, items = {}, minted = 0 } = {}) {
  return {
    async balanceOf(d) { return BigInt((porDueno[d] ?? []).length); },
    async tokenOfOwnerByIndex(d, i) {
      const l = porDueno[d] ?? [];
      if (i >= l.length) throw new Error("fuera de rango");
      return BigInt(l[i]);
    },
    async getItem(id) {
      const it = items[Number(id)];
      if (!it) throw new Error("no existe");
      return it;
    },
    async totalMinted() { return BigInt(minted); },
  };
}

const item = (nombre, tipo, rareza, ataque, defensa) => ({ nombre, tipo, rareza, ataque, defensa });

// ───────── direccionesDeRed ─────────

test("direccionesDeRed traduce 'address' a gameItem y descarta lo inválido", () => {
  const d = DT.direccionesDeRed({
    address: YO, oro: OTRO, cosmeticos: "0x0000000000000000000000000000000000000000",
    mercado: "nope", recompensas: OPERADOR,
  });
  assert.equal(d.gameItem, YO);
  assert.equal(d.oro, OTRO);
  assert.ok(!("cosmeticos" in d), "la dirección cero no vale");
  assert.ok(!("mercado" in d), "lo que no es dirección se tira");
  assert.equal(d.recompensas, OPERADOR);
  assert.ok(!("mercadoP2P" in d), "si no está desplegado, no aparece");
});

test("direccionesDeRed con una red que no existe devuelve un objeto vacío", () => {
  assert.deepEqual(DT.direccionesDeRed(null), {});
  assert.deepEqual(DT.direccionesDeRed(undefined), {});
});

// ───────── leerCartera ─────────

test("leerCartera junta ETH, ORO, objetos y cosméticos de la cadena", async () => {
  const lector = lectorFalso({
    saldos: { [YO]: 5n * UNO },
    contratos: {
      gameItem: gameItemFalso({
        porDueno: { [YO]: [3, 9] },
        items: { 3: item("Espada Oxidada", "Espada", 0, 5, 3), 9: item("Corona Eterna", "Casco", 2, 30, 20) },
      }),
      oro: { async balanceOf() { return 350n * UNO; } },
      cosmeticos: { async balanceOfBatch(cuentas, ids) { return ids.map((id) => (Number(id) === 6 ? 2n : 0n)); } },
    },
  });

  const c = await DT.leerCartera(lector, YO);
  assert.equal(c.eth, 5n * UNO);
  assert.equal(c.oro, 350n * UNO);
  assert.equal(c.totalObjetos, 2);
  assert.deepEqual(c.objetos.map((o) => o.tokenId), [3, 9]);
  assert.equal(c.objetos[1].nombre, "Corona Eterna");
  assert.equal(c.objetos[1].rarezaTexto, "Legendario");
  assert.equal(c.objetos[1].ataque, 30);
  assert.deepEqual(c.cosmeticos, [{ id: 6, nombre: "Corona del campeón", cantidad: 2 }]);
  assert.deepEqual(c.avisos, []);
});

test("leerCartera no se cuelga si un contrato falta: lo dice y sigue", async () => {
  const lector = lectorFalso({ saldos: { [YO]: 1n }, contratos: { gameItem: null, oro: null, cosmeticos: null } });
  const c = await DT.leerCartera(lector, YO);
  assert.equal(c.oro, null);
  assert.deepEqual(c.objetos, []);
  assert.equal(c.avisos.length, 2);
  assert.ok(c.avisos.some((a) => /ORO/.test(a)));
  assert.ok(c.avisos.some((a) => /objetos/.test(a)));
});

test("leerCartera recorta la lista larga y avisa de que la recortó", async () => {
  const ids = Array.from({ length: 10 }, (_, i) => i + 1);
  const items = Object.fromEntries(ids.map((i) => [i, item(`Objeto ${i}`, "Espada", 0, 1, 1)]));
  const lector = lectorFalso({ contratos: { gameItem: gameItemFalso({ porDueno: { [YO]: ids }, items }) } });

  const c = await DT.leerCartera(lector, YO, { max: 4 });
  assert.equal(c.totalObjetos, 10, "el total real se sigue diciendo");
  assert.equal(c.objetos.length, 4);
  assert.ok(c.avisos.some((a) => /Tiene 10 objetos/.test(a)));
});

test("leerCartera sobrevive a un getItem que falla", async () => {
  const lector = lectorFalso({
    contratos: {
      gameItem: gameItemFalso({ porDueno: { [YO]: [1, 2] }, items: { 1: item("Bueno", "Espada", 0, 1, 1) } }),
    },
  });
  const c = await DT.leerCartera(lector, YO);
  assert.equal(c.objetos.length, 1, "el objeto ilegible se cae, el otro se queda");
  assert.equal(c.objetos[0].nombre, "Bueno");
});

// ───────── compararConLocal ─────────

test("compararConLocal avisa cuando el juego y la cadena no dicen lo mismo", () => {
  const r = DT.compararConLocal({ oro: 350n * UNO, totalObjetos: 2 }, { oro: 300, objetos: 5 });
  assert.equal(r.coincide, false);
  assert.equal(r.diferencias.length, 2);
  assert.ok(r.diferencias[0].includes("350"));
  assert.ok(r.diferencias[0].includes("300"));
  assert.ok(/Manda la cadena/.test(r.diferencias[0]));
});

test("compararConLocal calla cuando cuadra", () => {
  const r = DT.compararConLocal({ oro: 350n * UNO, totalObjetos: 2 }, { oro: 350, objetos: 2 });
  assert.equal(r.coincide, true);
  assert.deepEqual(r.diferencias, []);
});

test("compararConLocal no compara lo que no sabe", () => {
  assert.equal(DT.compararConLocal({ oro: null, totalObjetos: null }, { oro: 10, objetos: 1 }).coincide, true);
  assert.equal(DT.compararConLocal({ oro: UNO, totalObjetos: 1 }, {}).coincide, true);
});

// ───────── leerTesoreria ─────────

function contratosTesoreria() {
  return {
    mercado: { async cajaEth() { return 3n * UNO; }, async owner() { return OWNER; } },
    oro: { async totalSupply() { return 1000n * UNO; } },
    recompensas: { async operador() { return OPERADOR; } },
    gameItem: { async balanceOf(d) { return d === DEAD ? 12n : 0n; }, async totalMinted() { return 40n; } },
    mercadoP2P: { async oroQuemado() { return 85n * UNO; } },
  };
}

test("leerTesoreria lee la caja, el dueño, el operador y los totales del RPC", async () => {
  const lector = lectorFalso({ contratos: contratosTesoreria(), saldos: { [OPERADOR]: 2n * UNO }, bloqueDespliegue: 0 });
  const t = await DT.leerTesoreria(lector, { serverUrl: null, conQuemado: false });

  assert.equal(t.fuente, "rpc");
  assert.equal(t.cajaEth, 3n * UNO);
  assert.equal(t.owner, OWNER);
  assert.equal(t.operador, OPERADOR);
  assert.equal(t.ethOperador, 2n * UNO);
  assert.equal(t.oroCirculacion, 1000n * UNO);
  assert.equal(t.objetosDestruidos, 12);
  assert.equal(t.objetosAcunados, 40);
  assert.equal(t.oroQuemadoP2P, 85n * UNO, "el acumulador del P2P es exacto y vale tal cual");
});

test("leerTesoreria prefiere el resumen del servidor cuando responde", async () => {
  const lector = lectorFalso({ contratos: contratosTesoreria(), saldos: { [OPERADOR]: 2n * UNO } });
  const fetchImpl = async (url) => {
    assert.match(String(url), /\/tesoreria\?red=sepolia$/);
    return { ok: true, json: async () => ({ cajaEth: "7000000000000000000", oroQuemado: "500000000000000000000" }) };
  };
  const t = await DT.leerTesoreria(lector, { serverUrl: "https://s.example/", red: "sepolia", fetchImpl });
  assert.equal(t.fuente, "servidor");
  assert.equal(t.cajaEth, 7n * UNO, "manda la cifra del servidor");
  assert.equal(t.oroQuemado.valor, 500n * UNO);
  assert.equal(t.oroQuemado.alcance, "completo");
});

test("si el servidor falla, la tesorería sigue saliendo por RPC", async () => {
  const lector = lectorFalso({ contratos: contratosTesoreria(), saldos: { [OPERADOR]: UNO } });
  const fetchImpl = async () => { throw new Error("Render dormido"); };
  const t = await DT.leerTesoreria(lector, { serverUrl: "https://s.example", fetchImpl, conQuemado: false });
  assert.equal(t.fuente, "rpc");
  assert.equal(t.cajaEth, 3n * UNO);
});

test("el ORO quemado por RPC se marca como parcial si no llega al despliegue", async () => {
  const lector = lectorFalso({
    contratos: contratosTesoreria(),
    saldos: { [OPERADOR]: UNO },
    altura: 1_000_000,
    bloqueDespliegue: 1,
    sucesos: [{ args: { value: 5n * UNO } }, { args: { value: 3n * UNO } }],
    completo: false,
  });
  const t = await DT.leerTesoreria(lector, { serverUrl: null });
  assert.equal(t.oroQuemado.valor, 8n * UNO);
  assert.equal(t.oroQuemado.alcance, "parcial");
  assert.ok(t.avisos.some((a) => /solo el de los últimos bloques/i.test(a)));
});

test("el alcance del ORO quemado lo marca lo que el RPC pudo leer, no lo que se pidió", async () => {
  // Se pide desde el despliegue, pero el nodo solo conserva desde el bloque 990 000.
  const lector = lectorFalso({
    contratos: contratosTesoreria(), saldos: { [OPERADOR]: UNO },
    altura: 1_000_000, bloqueDespliegue: 1,
    desdeDisponible: 990_000, completo: false,
    sucesos: [{ args: { value: 2n * UNO } }],
  });
  const t = await DT.leerTesoreria(lector, { serverUrl: null });
  assert.equal(t.oroQuemado.alcance, "parcial");
  assert.equal(t.oroQuemado.desdeBloque, 990_000, "se informa del bloque real, no del pedido");
});

test("el ORO quemado es completo si la ventana cubre desde el despliegue", async () => {
  const lector = lectorFalso({
    contratos: contratosTesoreria(), saldos: { [OPERADOR]: UNO },
    altura: 100, bloqueDespliegue: 10, sucesos: [{ args: { value: UNO } }],
  });
  const t = await DT.leerTesoreria(lector, { serverUrl: null });
  assert.equal(t.oroQuemado.alcance, "completo");
  assert.ok(!t.avisos.some((a) => /últimos bloques/.test(a)));
});

test("leerTesoreria avisa si faltan contratos en vez de enseñar ceros", async () => {
  const lector = lectorFalso({ contratos: { mercado: null, recompensas: null, oro: null, gameItem: null } });
  const t = await DT.leerTesoreria(lector, { serverUrl: null, conQuemado: false });
  assert.equal(t.cajaEth, null);
  assert.equal(t.owner, null);
  assert.equal(t.avisos.length, 2);
});

// ───────── puedeRetirar ─────────

test("puedeRetirar solo deja al dueño, y explica por qué a los demás", () => {
  const t = { owner: OWNER };
  assert.equal(DT.puedeRetirar(t, OWNER).puede, true);
  assert.equal(DT.puedeRetirar(t, OWNER.toUpperCase().replace("0X", "0x")).puede, true);

  const ajeno = DT.puedeRetirar(t, YO);
  assert.equal(ajeno.puede, false);
  assert.match(ajeno.motivo, /onlyOwner/);

  const sinCartera = DT.puedeRetirar(t, null);
  assert.equal(sinCartera.puede, false);
  assert.match(sinCartera.motivo, /sin conectar/);
});

test("puedeRetirar no deja pasar a nadie si no se pudo leer el dueño", () => {
  const r = DT.puedeRetirar({ owner: null }, OWNER);
  assert.equal(r.puede, false);
  assert.match(r.motivo, /no se pudo leer/i);
});

// ───────── rivales ─────────

test("rivalesDe saca direcciones del ranking y del mercado, y marca de dónde vienen", () => {
  const r = DT.rivalesDe({
    ranking: [{ address: YO, victorias: 12, alias: "Ana" }, { direccion: OTRO, wins: 3 }],
    listadosP2P: [{ vendedor: OWNER }],
    extra: [OPERADOR, "basura"],
  });
  assert.equal(r.length, 4, "la dirección inválida se cae");
  assert.deepEqual(r[0], { direccion: YO, victorias: 12, alias: "Ana", de: "ranking" });
  assert.equal(r[1].victorias, 3);
  assert.equal(r[2].de, "mercado");
  assert.equal(r[3].de, "partida");
});

test("leerRivales quita repetidos y lee el estado público de cada uno", async () => {
  const lector = lectorFalso({
    saldos: { [YO]: UNO, [OTRO]: 2n * UNO },
    contratos: {
      oro: { async balanceOf(d) { return d === YO ? 100n * UNO : 0n; } },
      gameItem: gameItemFalso({
        porDueno: { [YO]: [1, 2, 3, 4], [OTRO]: [] },
        items: Object.fromEntries([1, 2, 3, 4].map((i) => [i, item(`Obj ${i}`, "Espada", 1, 2, 2)])),
      }),
    },
  });

  const r = await DT.leerRivales(lector, [
    { direccion: YO, victorias: 7 },
    { direccion: YO.toUpperCase().replace("0X", "0x") }, // el mismo en mayúsculas
    { direccion: OTRO },
  ]);

  assert.equal(r.length, 2, "el repetido no se lee dos veces");
  assert.equal(r[0].oro, 100n * UNO);
  assert.equal(r[0].objetos, 4);
  assert.equal(r[0].muestra.length, 3, "solo una muestra, para no castigar el RPC");
  assert.equal(r[0].muestra[0].rarezaTexto, "Raro");
  assert.equal(r[0].victorias, 7);
  assert.equal(r[1].objetos, 0);
  assert.deepEqual(r[1].muestra, []);
  assert.equal(r[1].victorias, null, "lo que no se sabe queda en null, no en 0");
});

test("leerRivales ignora direcciones inválidas o la dirección cero", async () => {
  const lector = lectorFalso({ contratos: {} });
  const r = await DT.leerRivales(lector, [
    { direccion: "0x0000000000000000000000000000000000000000" },
    { direccion: "no" },
    { direccion: null },
  ]);
  assert.deepEqual(r, []);
});

// ───────── cargarDespliegues ─────────

test("cargarDespliegues saca direcciones y bloque de la red pedida", async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ sepolia: { address: YO, oro: OTRO, mercado: OWNER, bloqueDespliegue: 12072405 } }),
  });
  const d = await DT.cargarDespliegues("sepolia", { fetchImpl });
  assert.equal(d.direcciones.gameItem, YO);
  assert.equal(d.direcciones.mercado, OWNER);
  assert.equal(d.bloqueDespliegue, 12072405);
});

test("cargarDespliegues sin red ni fetch devuelve vacío en vez de lanzar", async () => {
  const d = await DT.cargarDespliegues("marte", { fetchImpl: async () => ({ ok: false }) });
  assert.deepEqual(d.direcciones, {});
  assert.equal(d.bloqueDespliegue, 0);
  const sinFetch = await DT.cargarDespliegues("sepolia", { fetchImpl: null });
  assert.deepEqual(sinFetch.direcciones, {});
});
