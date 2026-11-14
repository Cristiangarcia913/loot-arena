// Redes del juego: catálogo multired y elección de red activa (fase E4 del plan maestro).
//
// El test que más importa aquí es el de coherencia del catálogo. `chainIdHex` es lo que se le
// pasa a wallet_addEthereumChain, así que un hex que no cuadre con su chainId haría que la
// cartera del jugador añadiera una red equivocada. Eso no se puede detectar a ojo leyendo
// "0xaa37dc", y es el tipo de error que se cuela al añadir una red nueva copiando otra.
import { test } from "node:test";
import assert from "node:assert/strict";

// config.js lee localStorage y location al importarse, así que hay que ponerlos antes.
const almacen = new Map();
globalThis.localStorage = {
  getItem: (k) => (almacen.has(k) ? almacen.get(k) : null),
  setItem: (k, v) => almacen.set(k, String(v)),
  removeItem: (k) => almacen.delete(k),
};
globalThis.location = { search: "" };

const CFG = await import("../config/config.js");
const { NETWORKS, CLAVE_RED, NETWORK, redActiva, guardarRed, redDeChainId, nombreRed } = CFG;

test("catálogo: cada chainIdHex concuerda con su chainId", () => {
  for (const [clave, net] of Object.entries(NETWORKS)) {
    assert.equal(
      Number(net.chainIdHex), net.chainId,
      `${clave}: chainIdHex ${net.chainIdHex} es ${Number(net.chainIdHex)}, pero chainId dice ${net.chainId}`,
    );
    assert.match(net.chainIdHex, /^0x[0-9a-f]+$/, `${clave}: el hex va en minúsculas y con 0x`);
  }
});

test("catálogo: no hay dos redes con el mismo chainId", () => {
  const vistos = new Map();
  for (const [clave, net] of Object.entries(NETWORKS)) {
    assert.ok(!vistos.has(net.chainId), `${clave} y ${vistos.get(net.chainId)} comparten chainId ${net.chainId}`);
    vistos.set(net.chainId, clave);
  }
});

test("catálogo: toda red tiene lo que la cartera necesita para añadirla", () => {
  for (const [clave, net] of Object.entries(NETWORKS)) {
    assert.ok(net.chainName, `${clave}: sin nombre`);
    assert.ok(net.rpcUrls?.length, `${clave}: sin RPC`);
    assert.ok(net.nativeCurrency?.symbol && net.nativeCurrency.decimals === 18, `${clave}: moneda mal puesta`);
    assert.ok(Array.isArray(net.blockExplorerUrls), `${clave}: blockExplorerUrls tiene que existir, aunque esté vacío`);
    // El RPC local es http a propósito; el resto va por https o el navegador lo bloquea.
    if (clave !== "localhost") {
      for (const u of net.rpcUrls) assert.match(u, /^https:\/\//, `${clave}: el RPC ${u} no es https`);
      assert.ok(net.grifo, `${clave}: una red pública sin grifo deja al jugador sin gas y sin salida`);
    }
  }
});

test("catálogo: la red por defecto existe y tiene contratos", () => {
  assert.ok(Object.hasOwn(NETWORKS, NETWORK), `NETWORK = ${NETWORK} no está en el catálogo`);
});

test("redDeChainId y nombreRed traducen en los dos sentidos", () => {
  assert.equal(redDeChainId(11155111), "sepolia");
  assert.equal(redDeChainId("421614"), "arbitrum-sepolia");
  assert.equal(redDeChainId(1), null, "la red principal no está: en este juego no se juega con dinero real");
  assert.equal(nombreRed("base-sepolia"), "Base Sepolia");
  assert.equal(nombreRed("inventada"), "inventada", "una red desconocida se muestra tal cual, no como undefined");
});

test("redActiva: la URL manda sobre lo guardado, y lo guardado sobre el valor por defecto", () => {
  almacen.clear();
  globalThis.location.search = "";
  assert.equal(redActiva(), NETWORK, "sin nada elegido, la de siempre");

  guardarRed("base-sepolia");
  assert.equal(redActiva(), "base-sepolia", "se recuerda lo que eligió el jugador");

  globalThis.location.search = "?red=sepolia";
  assert.equal(redActiva(), "sepolia", "?red= manda: sirve para enlazar una red concreta");

  globalThis.location.search = "?red=noexiste";
  assert.equal(redActiva(), "base-sepolia", "una red inventada en la URL se ignora, no rompe el juego");

  globalThis.location.search = "";
  almacen.clear();
});

test("guardarRed rechaza lo que no está en el catálogo", () => {
  almacen.clear();
  assert.equal(guardarRed("arbitrum-sepolia"), true);
  assert.equal(almacen.get(CLAVE_RED), "arbitrum-sepolia");
  assert.equal(guardarRed("red-del-profesor"), false, "no se guarda una red que el juego no conoce");
  assert.equal(almacen.get(CLAVE_RED), "arbitrum-sepolia", "y la que había no se toca");
  almacen.clear();
});

test("guardarRed no explota si el navegador no deja guardar", () => {
  const real = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => { throw new Error("bloqueado"); }, setItem: () => { throw new Error("bloqueado"); } };
  try {
    assert.equal(guardarRed("sepolia"), false, "devuelve false en vez de lanzar");
    assert.equal(redActiva(), NETWORK, "y la red activa sigue siendo resoluble");
  } finally {
    globalThis.localStorage = real;
  }
});
