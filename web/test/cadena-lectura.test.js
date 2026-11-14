import { test } from "node:test";
import assert from "node:assert/strict";
import * as L from "../js/cadena/lectura.js";

// ───────── dobles ─────────
// Un "contrato" falso: solo necesita interface.getEvent(...).topicHash, interface.parseLog
// y address, que es exactamente lo que usa lectura.js.
function contratoFalso(address, eventos) {
  return {
    address,
    interface: {
      getEvent(nombre) {
        if (!eventos[nombre]) throw new Error(`sin evento ${nombre}`);
        return { topicHash: eventos[nombre].topic };
      },
      parseLog({ topics }) {
        const def = Object.entries(eventos).find(([, e]) => e.topic === topics[0]);
        if (!def) throw new Error("log desconocido");
        const [nombre, e] = def;
        return { name: nombre, fragment: { inputs: e.inputs.map((n) => ({ name: n })) }, args: e.decodificar(topics) };
      },
    },
  };
}

/**
 * Proveedor falso. Guarda TODAS las llamadas a getLogs, pero `tramos` solo devuelve las que
 * llevan tópicos: las que no, son la sonda con la que el lector mide el horizonte del nodo.
 * `podarAntesDe` imita al RPC público de Sepolia, que responde «pruned history unavailable»
 * a cualquier rango que empiece demasiado atrás.
 */
function proveedorFalso({
  logsPorTramo = {}, altura = 1000, bloques = {}, saldos = {},
  fallar = new Set(), podarAntesDe = null, errorDe = null,
} = {}) {
  const llamadas = [];
  return {
    llamadas,
    /** Solo los barridos de verdad (con tópicos), como "desde-hasta". */
    get tramos() { return llamadas.filter((c) => c.topics).map((c) => `${c.fromBlock}-${c.toBlock}`); },
    /** Las sondas del horizonte (sin tópicos). */
    get sondas() { return llamadas.filter((c) => !c.topics); },
    async getBlockNumber() { return altura; },
    async getBlock(n) { return bloques[n] ? { timestamp: bloques[n] } : null; },
    async getBalance(d) { if (saldos[d] == null) throw new Error("sin saldo"); return saldos[d]; },
    async getLogs(f) {
      llamadas.push(f);
      const clave = `${f.fromBlock}-${f.toBlock}`;
      if (podarAntesDe != null && f.fromBlock < podarAntesDe) throw new Error("pruned history unavailable");
      if (errorDe && errorDe[clave]) throw new Error(errorDe[clave]);
      if (fallar.has(clave)) throw new Error("RPC caído");
      return logsPorTramo[clave] ?? [];
    },
  };
}

const TOPIC_VENDIDO = "0x" + "a".repeat(64);
const EVENTOS_MERCADO = {
  ItemVendido: {
    topic: TOPIC_VENDIDO,
    inputs: ["jugador", "tokenId", "oro", "eth"],
    decodificar: () => ["0xJUGADOR", 7n, 300n, 2n],
  },
};

// ───────── topicoDireccion ─────────

test("topicoDireccion rellena a 32 bytes y normaliza a minúsculas", () => {
  assert.equal(
    L.topicoDireccion("0xAbCdEf0123456789aBcDeF0123456789AbCdEf01"),
    "0x000000000000000000000000abcdef0123456789abcdef0123456789abcdef01"
  );
  assert.equal(L.topicoDireccion("0x" + "0".repeat(40)).length, 66);
});

test("topicoDireccion rechaza lo que no es una dirección", () => {
  for (const malo of ["", "0x123", "abc", null, 42, "0x" + "z".repeat(40)]) {
    assert.throws(() => L.topicoDireccion(malo), TypeError, `debería rechazar ${malo}`);
  }
});

test("mismaDir compara sin distinguir mayúsculas y aguanta nulos", () => {
  assert.ok(L.mismaDir("0xAB", "0xab"));
  assert.ok(!L.mismaDir("0xAB", "0xcd"));
  assert.ok(!L.mismaDir(null, "0xab"));
  assert.ok(!L.mismaDir("0xab", undefined));
});

// ───────── tramos ─────────

test("tramos parte el rango en trozos cerrados del tamaño pedido", () => {
  assert.deepEqual(L.tramos(0, 9, 5), [
    { desde: 0, hasta: 4, recortado: false },
    { desde: 5, hasta: 9, recortado: false },
  ]);
  // El último tramo se recorta al final real, no se pasa.
  assert.deepEqual(L.tramos(10, 12, 5), [{ desde: 10, hasta: 12, recortado: false }]);
});

test("tramos devuelve vacío con rangos imposibles", () => {
  assert.deepEqual(L.tramos(10, 9, 5), []);
  assert.deepEqual(L.tramos(5, NaN, 5), []);
});

test("tramos recorta por el principio y lo marca: lo reciente importa más", () => {
  const t = L.tramos(0, 99, 10, 3);
  assert.equal(t.length, 3);
  assert.equal(t[0].desde, 70); // se quedan los 3 últimos tramos
  assert.equal(t.at(-1).hasta, 99);
  assert.equal(t[0].recortado, true);
  assert.equal(t[1].recortado, false);
});

test("tramos no recorta si cabe justo", () => {
  const t = L.tramos(0, 29, 10, 3);
  assert.equal(t.length, 3);
  assert.ok(t.every((x) => !x.recortado));
});

// ───────── barrer ─────────

test("barrer trocea las llamadas, decodifica y devuelve los sucesos", async () => {
  const mercado = contratoFalso("0xMERCADO", EVENTOS_MERCADO);
  // La altura es 20 y el lector deja MARGEN_CABEZA (2) sin pedir: llega hasta el bloque 18.
  const provider = proveedorFalso({
    altura: 20,
    logsPorTramo: {
      "0-9": [{ topics: [TOPIC_VENDIDO], data: "0x", blockNumber: 3, logIndex: 1, transactionHash: "0xtx1" }],
      "10-18": [{ topics: [TOPIC_VENDIDO], data: "0x", blockNumber: 15, logIndex: 0, transactionHash: "0xtx2" }],
    },
  });
  const lector = L.crearLector({ provider, contratos: { mercado }, bloqueDespliegue: 0, tamanoTramo: 10 });

  const r = await lector.barrer("mercado", "ItemVendido");
  assert.equal(r.sucesos.length, 2);
  assert.equal(r.fallos, 0);
  assert.equal(r.recortado, false);
  assert.equal(r.completo, true, "el nodo tenía toda la historia, así que el barrido es completo");
  assert.equal(r.limitadoPorRpc, false);
  assert.deepEqual(provider.tramos, ["10-18", "0-9"], "se pide primero lo reciente");

  // Vienen ordenados de más reciente a más antiguo, da igual en qué orden se pidieran.
  assert.deepEqual(r.sucesos.map((s) => s.bloque), [15, 3]);
  const s = r.sucesos[1];
  assert.equal(s.contrato, "mercado");
  assert.equal(s.nombre, "ItemVendido");
  assert.equal(s.args.tokenId, 7n);
  assert.equal(s.args.oro, 300n);
  assert.equal(s.hash, "0xtx1");
  assert.equal(s.bloque, 3);
});

test("barrer deja un margen por debajo de la cabeza (los nodos no van todos a la misma altura)", async () => {
  const mercado = contratoFalso("0xM", EVENTOS_MERCADO);
  const provider = proveedorFalso({ altura: 1000 });
  const lector = L.crearLector({ provider, contratos: { mercado }, bloqueDespliegue: 0 });
  await lector.barrer("mercado", "ItemVendido");
  assert.equal(provider.tramos.at(-1).split("-")[1], String(1000 - L.MARGEN_CABEZA));
});

test("barrer pone los filtros de tópico que se le pasan", async () => {
  const mercado = contratoFalso("0xMERCADO", EVENTOS_MERCADO);
  let visto = null;
  const provider = proveedorFalso({ altura: 5 });
  provider.getLogs = async (f) => { visto = f; return []; };
  const lector = L.crearLector({ provider, contratos: { mercado }, tamanoTramo: 10 });
  const t = L.topicoDireccion("0x1111111111111111111111111111111111111111");

  await lector.barrer("mercado", "ItemVendido", [t, null]);
  assert.deepEqual(visto.topics, [TOPIC_VENDIDO, t, null]);
  assert.equal(visto.address, "0xMERCADO");
});

test("barrer sobre un contrato que no existe devuelve vacío sin llamar al RPC", async () => {
  const provider = proveedorFalso();
  const lector = L.crearLector({ provider, contratos: { mercado: null } });
  const r = await lector.barrer("mercado", "ItemVendido");
  assert.deepEqual(r.sucesos, []);
  assert.equal(provider.llamadas.length, 0);
});

test("barrer sobre un evento que el ABI no tiene devuelve vacío sin llamar al RPC", async () => {
  const provider = proveedorFalso();
  const lector = L.crearLector({ provider, contratos: { mercado: contratoFalso("0xM", EVENTOS_MERCADO) } });
  const r = await lector.barrer("mercado", "EventoQueNoExiste");
  assert.deepEqual(r.sucesos, []);
  assert.equal(provider.llamadas.length, 0);
});

test("un tramo caído no tira el barrido entero: se cuenta como fallo", async () => {
  const mercado = contratoFalso("0xM", EVENTOS_MERCADO);
  const provider = proveedorFalso({
    altura: 20,
    errorDe: { "10-18": "fetch failed" }, // pasajero: se reintenta y se acaba contando como fallo
    logsPorTramo: { "0-9": [{ topics: [TOPIC_VENDIDO], data: "0x", blockNumber: 1, logIndex: 0, transactionHash: "0xa" }] },
  });
  const lector = L.crearLector({ provider, contratos: { mercado }, tamanoTramo: 10 });
  const r = await lector.barrer("mercado", "ItemVendido");
  assert.equal(r.fallos, 1);
  assert.equal(r.sucesos.length, 1); // lo que sí se pudo leer, se devuelve
});

test("los errores pasajeros se reintentan; los de podado no (insistir no sirve de nada)", async () => {
  const mercado = contratoFalso("0xM", EVENTOS_MERCADO);

  const pasajero = proveedorFalso({ altura: 20, errorDe: { "0-18": "fetch failed" } });
  const l1 = L.crearLector({ provider: pasajero, contratos: { mercado } });
  await l1.barrer("mercado", "ItemVendido");
  const intentosPasajero = pasajero.tramos.filter((t) => t === "0-18").length;
  assert.equal(intentosPasajero, 1 + L.REINTENTOS, "un fallo de red merece reintentos");

  const podado = proveedorFalso({ altura: 20, errorDe: { "0-18": "pruned history unavailable" } });
  const l2 = L.crearLector({ provider: podado, contratos: { mercado } });
  await l2.barrer("mercado", "ItemVendido");
  assert.equal(podado.tramos.filter((t) => t === "0-18").length, 1, "el podado se pide una sola vez");
});

test("los logs que el ABI no sabe decodificar se ignoran en silencio", async () => {
  const mercado = contratoFalso("0xM", EVENTOS_MERCADO);
  const provider = proveedorFalso({
    altura: 5,
    logsPorTramo: { "0-5": [{ topics: ["0x" + "f".repeat(64)], data: "0x", blockNumber: 1, logIndex: 0, transactionHash: "0xa" }] },
  });
  const lector = L.crearLector({ provider, contratos: { mercado }, tamanoTramo: 10 });
  const r = await lector.barrer("mercado", "ItemVendido");
  assert.deepEqual(r.sucesos, []);
});

test("los tramos ya cerrados se cachean: el segundo barrido no los vuelve a pedir", async () => {
  const mercado = contratoFalso("0xM", EVENTOS_MERCADO);
  const provider = proveedorFalso({ altura: 25 });
  const lector = L.crearLector({ provider, contratos: { mercado }, tamanoTramo: 10 });

  await lector.barrer("mercado", "ItemVendido", [], { desde: 0, hasta: 25 });
  const primeras = [...provider.tramos];
  await lector.barrer("mercado", "ItemVendido", [], { desde: 0, hasta: 25 });

  // Se piden de lo nuevo a lo viejo. Los dos tramos cerrados vienen luego de caché; el que
  // llega al final del rango se vuelve a pedir porque todavía puede cambiar.
  assert.deepEqual(primeras, ["20-25", "10-19", "0-9"]);
  assert.deepEqual(provider.tramos.slice(3), ["20-25"]);

  lector.olvidar();
  await lector.barrer("mercado", "ItemVendido", [], { desde: 0, hasta: 25 });
  assert.equal(provider.tramos.length, 4 + 3); // tras olvidar, se pide todo otra vez
});

test("barrerVarios junta y ordena de más reciente a más antiguo", async () => {
  const mercado = contratoFalso("0xM", EVENTOS_MERCADO);
  const provider = proveedorFalso({
    altura: 11, // con MARGEN_CABEZA el rango llega al bloque 9
    logsPorTramo: {
      "0-9": [
        { topics: [TOPIC_VENDIDO], data: "0x", blockNumber: 2, logIndex: 0, transactionHash: "0xa" },
        { topics: [TOPIC_VENDIDO], data: "0x", blockNumber: 8, logIndex: 3, transactionHash: "0xb" },
        { topics: [TOPIC_VENDIDO], data: "0x", blockNumber: 8, logIndex: 1, transactionHash: "0xc" },
      ],
    },
  });
  const lector = L.crearLector({ provider, contratos: { mercado }, tamanoTramo: 10 });
  const r = await lector.barrerVarios([{ contrato: "mercado", evento: "ItemVendido" }]);
  assert.deepEqual(r.sucesos.map((s) => [s.bloque, s.indice]), [[8, 3], [8, 1], [2, 0]]);
  assert.equal(r.completo, true);
});

test("un contrato sin desplegar no falsea hasta dónde se ha podido leer", async () => {
  // Fallo real visto en el navegador: los barridos del MercadoP2P (sin desplegar) devolvían
  // el bloque de despliegue como "leído desde", y el aviso salía diciendo a la vez que se
  // había leído todo y que faltaba historial.
  const provider = proveedorFalso({ altura: 100_000, podarAntesDe: 89_000 });
  const lector = L.crearLector({
    provider,
    contratos: { mercado: contratoFalso("0xM", EVENTOS_MERCADO), mercadoP2P: null },
    bloqueDespliegue: 1_000,
  });

  const r = await lector.barrerVarios([
    { contrato: "mercado", evento: "ItemVendido" },
    { contrato: "mercadoP2P", evento: "Vendido" }, // no desplegado: se salta
  ]);

  assert.equal(r.desdeDisponible, 89_999, "manda el barrido que sí se hizo, no el que se saltó");
  assert.equal(r.limitadoPorRpc, true);
  assert.equal(r.completo, false, "no puede decirse completo si al que se leyó le falta historia");
});

test("barrerVarios sin ningún barrido posible no inventa un alcance", async () => {
  const lector = L.crearLector({ provider: proveedorFalso({ altura: 100 }), contratos: { mercadoP2P: null } });
  const r = await lector.barrerVarios([{ contrato: "mercadoP2P", evento: "Vendido" }]);
  assert.equal(r.desdeDisponible, null);
  assert.equal(r.completo, false);
  assert.equal(r.limitadoPorRpc, false);
});

test("barrerVarios no abre más de `concurrencia` peticiones a la vez", async () => {
  const mercado = contratoFalso("0xM", EVENTOS_MERCADO);
  let vivas = 0, maximo = 0;
  const provider = proveedorFalso({ altura: 50 });
  provider.getLogs = async () => {
    vivas++; maximo = Math.max(maximo, vivas);
    await new Promise((r) => setTimeout(r, 5));
    vivas--;
    return [];
  };
  const lector = L.crearLector({ provider, contratos: { mercado } });
  const peticiones = Array.from({ length: 18 }, () => ({ contrato: "mercado", evento: "ItemVendido" }));
  await lector.barrerVarios(peticiones, {}, { concurrencia: 4 });
  assert.ok(maximo <= 4, `se abrieron ${maximo} peticiones a la vez, el tope era 4`);
});

// ───────── horizonte del nodo (lo que el RPC público conserva de verdad) ─────────

test("clasificar errores: podado, rango excesivo y pasajero son tres cosas distintas", () => {
  const podado = ["pruned history unavailable", "history unavailable", new Error("missing trie node")];
  for (const e of podado) {
    assert.ok(L.esErrorDePodado(e), `${L.textoError(e)} debería ser podado`);
    assert.ok(!L.esErrorTransitorio(e), "el podado NO se reintenta: es un límite duro");
  }

  const rango = ["exceed maximum block range: 50000", "query returned more than 10000 results"];
  for (const e of rango) {
    assert.ok(L.esErrorDeRango(e), `${e} debería ser de rango`);
    assert.ok(!L.esErrorTransitorio(e));
  }

  const pasajero = ["fetch failed", "timeout", "429 too many requests", "block range extends beyond current head block"];
  for (const e of pasajero) {
    assert.ok(L.esErrorTransitorio(e), `${e} debería ser pasajero`);
    assert.ok(!L.esErrorDePodado(e));
  }

  assert.equal(L.esErrorDePodado(null), false);
  assert.equal(L.esErrorTransitorio(undefined), false);
});

test("textoError saca el mensaje venga como venga", () => {
  assert.equal(L.textoError("plano"), "plano");
  assert.match(L.textoError(new Error("de Error")), /de Error/);
  assert.match(L.textoError({ error: { message: "de JSON-RPC" } }), /de JSON-RPC/);
  assert.match(L.textoError({ shortMessage: "de ethers" }), /de ethers/);
  assert.equal(L.textoError(null), "");
});

test("el error de podado se reconoce aunque ethers lo envuelva (caso real de ethers v6)", () => {
  // Forma exacta que devuelve ethers 6.13.4 al pedir logs de bloques podados: por fuera
  // dice «could not coalesce error» y el motivo real va dentro, en error.message.
  const envuelto = {
    code: "UNKNOWN_ERROR",
    shortMessage: "could not coalesce error",
    message: 'could not coalesce error (error={ "code": 4444, "message": "pruned history unavailable" }, payload={…})',
    error: { code: 4444, message: "pruned history unavailable" },
  };
  assert.ok(L.esErrorDePodado(envuelto), "si no se reconoce, el tramo podado se cuenta como fallo pasajero");
  assert.ok(!L.esErrorTransitorio(envuelto), "y se reintentaría 3 veces para nada");
});

test("el error de rango excesivo también se reconoce envuelto", () => {
  const envuelto = {
    shortMessage: "could not coalesce error",
    error: { message: "exceed maximum block range: 50000" },
  };
  assert.ok(L.esErrorDeRango(envuelto));
  assert.ok(!L.esErrorTransitorio(envuelto));
});

test("horizonte mide hasta dónde atrás sirve logs el nodo y se queda con el tramo más ancho que va", async () => {
  // Nodo tipo publicnode: conserva algo más de 10 000 bloques, así que el peldaño más
  // ancho de la escalera entra a la primera.
  const provider = proveedorFalso({ altura: 100_000, podarAntesDe: 89_000 });
  const lector = L.crearLector({
    provider, contratos: { mercado: contratoFalso("0xM", EVENTOS_MERCADO) }, bloqueDespliegue: 1000,
  });

  const h = await lector.horizonte();
  assert.equal(h.ancho, 10_000, "el primer ancho de la escalera ya funciona");
  assert.equal(h.desde, 100_000 - L.MARGEN_CABEZA - 10_000 + 1); // 89 999
  assert.equal(h.completo, false, "no llega al bloque de despliegue");
  assert.equal(provider.sondas.length, 1, "si el primer peldaño va, no se prueban los demás");
});

test("horizonte baja por la escalera de anchos hasta dar con uno que el nodo acepte", async () => {
  // Nodo más tacaño: solo los últimos 1 500 bloques.
  const provider = proveedorFalso({ altura: 100_000, podarAntesDe: 98_500 });
  const lector = L.crearLector({
    provider, contratos: { mercado: contratoFalso("0xM", EVENTOS_MERCADO) }, bloqueDespliegue: 1000,
  });
  const h = await lector.horizonte();
  assert.equal(h.ancho, 1_000, "10 000, 5 000 y 2 000 fallan; 1 000 entra");
  assert.equal(provider.sondas.length, 4, "una sonda por peldaño probado");
});

test("horizonte se mide una sola vez por sesión", async () => {
  const provider = proveedorFalso({ altura: 50_000, podarAntesDe: 40_000 });
  const lector = L.crearLector({ provider, contratos: { mercado: contratoFalso("0xM", EVENTOS_MERCADO) } });
  await lector.horizonte();
  const sondasPrimera = provider.sondas.length;
  assert.ok(sondasPrimera >= 1);

  await lector.horizonte();
  await lector.barrer("mercado", "ItemVendido");
  assert.equal(provider.sondas.length, sondasPrimera, "ni la segunda llamada ni el barrido vuelven a medir");

  lector.olvidar();
  await lector.horizonte();
  assert.equal(provider.sondas.length, sondasPrimera * 2, "tras olvidar se vuelve a medir");
});

test("horizonte dice 'completo' cuando el nodo sí tiene toda la historia", async () => {
  const provider = proveedorFalso({ altura: 5_000 }); // sin podar nada
  const lector = L.crearLector({ provider, contratos: { mercado: contratoFalso("0xM", EVENTOS_MERCADO) }, bloqueDespliegue: 100 });
  const h = await lector.horizonte();
  assert.equal(h.completo, true);
  assert.equal(h.desde, 100, "no se va más atrás del despliegue");
});

test("barrer no pide por detrás del horizonte y lo dice en vez de fingir un historial entero", async () => {
  const provider = proveedorFalso({ altura: 100_000, podarAntesDe: 89_000 });
  const lector = L.crearLector({
    provider, contratos: { mercado: contratoFalso("0xM", EVENTOS_MERCADO) }, bloqueDespliegue: 1000,
  });

  const r = await lector.barrer("mercado", "ItemVendido");
  assert.equal(r.limitadoPorRpc, true, "hay que avisar de que falta historia");
  assert.equal(r.completo, false);
  assert.equal(r.desdeDisponible, 89_999);
  assert.equal(r.fallos, 0, "lo que el nodo no guarda no se cuenta como fallo: no se pide");
  // Ningún tramo empieza por detrás de lo que el nodo conserva.
  for (const t of provider.tramos) {
    assert.ok(Number(t.split("-")[0]) >= 89_000, `el tramo ${t} se pidió en zona podada`);
  }
});

test("el barrido antiguo pedía decenas de tramos imposibles; ahora pide los justos", async () => {
  // 55 000 bloques de historia y un nodo que solo guarda 10 000: antes eran 28 tramos de
  // 2 000 (20 de ellos condenados a fallar); ahora es 1 tramo de 10 000.
  const provider = proveedorFalso({ altura: 12_127_320, podarAntesDe: 12_117_000 });
  const lector = L.crearLector({
    provider, contratos: { mercado: contratoFalso("0xM", EVENTOS_MERCADO) }, bloqueDespliegue: 12_072_405,
  });
  const r = await lector.barrer("mercado", "ItemVendido");
  assert.equal(provider.tramos.length, 1, `se pidieron ${provider.tramos.length} tramos`);
  assert.equal(r.fallos, 0);
  assert.equal(r.limitadoPorRpc, true);
});

test("con `todo: true` se intenta igualmente toda la historia (botón «cargar todo»)", async () => {
  const provider = proveedorFalso({ altura: 100_000, podarAntesDe: 90_000 });
  const lector = L.crearLector({
    provider, contratos: { mercado: contratoFalso("0xM", EVENTOS_MERCADO) },
    bloqueDespliegue: 85_000, tamanoTramo: 5_000,
  });
  const r = await lector.barrer("mercado", "ItemVendido", [], { todo: true });
  // Se piden también los tramos de la zona podada: al llegar a uno, se para.
  assert.ok(provider.tramos.some((t) => Number(t.split("-")[0]) < 90_000));
  assert.equal(r.limitadoPorRpc, true, "al toparse con el podado se marca igual");
});

test("al toparse con la zona podada NO se tira lo reciente que ya se había leído", async () => {
  // Fallo real: como los tramos se recorrían del más viejo al más nuevo, el primero (el más
  // viejo, el que siempre falla) cortaba el barrido y «cargar todo» no devolvía nada.
  const log = (b) => ({ topics: [TOPIC_VENDIDO], data: "0x", blockNumber: b, logIndex: 0, transactionHash: `0x${b}` });
  const provider = proveedorFalso({
    altura: 100_000,
    podarAntesDe: 90_000,
    logsPorTramo: {
      "95000-99998": [log(96_000)],
      "90000-94999": [log(91_000)],
    },
  });
  const lector = L.crearLector({
    provider, contratos: { mercado: contratoFalso("0xM", EVENTOS_MERCADO) },
    bloqueDespliegue: 85_000, tamanoTramo: 5_000,
  });

  const r = await lector.barrer("mercado", "ItemVendido", [], { todo: true });
  assert.deepEqual(r.sucesos.map((s) => s.bloque).sort(), [91_000, 96_000], "lo legible se conserva");
  assert.equal(r.limitadoPorRpc, true);
  assert.equal(r.completo, false);
  assert.equal(r.desdeDisponible, 90_000, "informa del bloque más antiguo que se LEYÓ de verdad");
});

test("los tramos se piden de lo más reciente a lo más antiguo", async () => {
  const provider = proveedorFalso({ altura: 30_000 });
  const lector = L.crearLector({
    provider, contratos: { mercado: contratoFalso("0xM", EVENTOS_MERCADO) },
    bloqueDespliegue: 0, tamanoTramo: 10_000,
  });
  await lector.barrer("mercado", "ItemVendido");
  const inicios = provider.tramos.map((t) => Number(t.split("-")[0]));
  assert.deepEqual(inicios, [...inicios].sort((a, b) => b - a), `se pidieron así: ${provider.tramos}`);
});

test("si el nodo falla por algo que no es podado ni rango, el horizonte no se inventa nada", async () => {
  const provider = proveedorFalso({ altura: 10_000, errorDe: {} });
  provider.getLogs = async (f) => { if (!f.topics) throw new Error("unauthorized: api key required"); return []; };
  const lector = L.crearLector({ provider, contratos: { mercado: contratoFalso("0xM", EVENTOS_MERCADO) }, bloqueDespliegue: 0 });
  const h = await lector.horizonte();
  assert.equal(h.completo, false);
  assert.equal(h.ancho, L.TAMANOS_TRAMO.at(-1), "se queda con el tramo más estrecho y deja que barrer informe");
});

// ───────── fechas y saldos ─────────

test("conFechas pide cada bloque una sola vez, aunque haya varios sucesos en él", async () => {
  let pedidos = 0;
  const provider = proveedorFalso({ bloques: { 5: 1700000000, 9: 1700000600 } });
  const original = provider.getBlock;
  provider.getBlock = async (n) => { pedidos++; return original(n); };
  const lector = L.crearLector({ provider, contratos: {} });

  const con = await lector.conFechas([
    { bloque: 5, indice: 0 }, { bloque: 5, indice: 1 }, { bloque: 9, indice: 0 },
  ]);
  assert.equal(pedidos, 2);
  assert.deepEqual(con.map((s) => s.fecha), [1700000000, 1700000000, 1700000600]);
});

test("si el RPC no da el bloque, la fecha queda a null y no revienta", async () => {
  const provider = proveedorFalso({ bloques: {} });
  provider.getBlock = async () => { throw new Error("no disponible"); };
  const lector = L.crearLector({ provider, contratos: {} });
  const con = await lector.conFechas([{ bloque: 3, indice: 0 }]);
  assert.equal(con[0].fecha, null);
});

test("saldoEth devuelve bigint, y null si el RPC falla", async () => {
  const lector = L.crearLector({
    provider: proveedorFalso({ saldos: { "0xA": 1234n } }),
    contratos: {},
  });
  assert.equal(await lector.saldoEth("0xA"), 1234n);
  assert.equal(await lector.saldoEth("0xB"), null);
});

test("bloqueActual se cachea unos segundos en vez de preguntar en cada lectura", async () => {
  let veces = 0;
  const provider = proveedorFalso();
  provider.getBlockNumber = async () => { veces++; return 77; };
  const lector = L.crearLector({ provider, contratos: {} });
  assert.equal(await lector.bloqueActual(), 77);
  assert.equal(await lector.bloqueActual(), 77);
  assert.equal(veces, 1);
});

// ───────── ordenar / sinRepetidos ─────────

test("sinRepetidos quita el mismo log traído por dos barridos solapados", () => {
  const s = (hash, indice) => ({ hash, indice, bloque: 1 });
  const lista = [s("0xa", 0), s("0xa", 1), s("0xa", 0), s("0xb", 0)];
  assert.equal(L.sinRepetidos(lista).length, 3);
});

test("crearContratos deja a null lo que no tenga dirección válida o ABI", () => {
  const ethers = { Contract: class { constructor(dir, abi) { this.address = dir; this.abi = abi; } } };
  const c = L.crearContratos({
    ethers,
    direcciones: {
      gameItem: "0x1111111111111111111111111111111111111111",
      oro: "0x0000000000000000000000000000000000000000", // cero: no vale
      mercado: "no es una dirección",
    },
    abis: { gameItem: [{}], oro: [{}], mercado: [{}], cosmeticos: [{}] },
  });
  assert.ok(c.gameItem);
  assert.equal(c.oro, null);
  assert.equal(c.mercado, null);
  assert.equal(c.cosmeticos, null); // sin dirección
  assert.equal(c.mercadoP2P, null); // todavía no desplegado: no debe romper nada
});
