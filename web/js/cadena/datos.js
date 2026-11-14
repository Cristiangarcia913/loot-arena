// Lecturas de alto nivel de la sección «Cadena»: cartera, otros jugadores y tesorería
// (PLAN-MAESTRO.md §7, fases E1 y E3).
//
// Todo lo de aquí se lee **de la cadena** por el RPC, con o sin cartera conectada. No hay DOM.
// Los contratos entran ya construidos (`lector.contratos`), así que los tests pasan dobles con
// los métodos de vista que haga falta.

import { IDS_CATALOGO, aBigInt, cosmetico, direccionValida, parsearSaldos } from "../economy.js";
import { CERO, DEAD, mismaDir } from "./lectura.js";
import { rarezaTexto } from "./eventos.js";

/** Máximo de objetos que se leen de una dirección: cada uno cuesta 2 llamadas al RPC. */
export const MAX_OBJETOS = 40;
/** Ventana de bloques del barrido de respaldo cuando el servidor no da el total quemado. */
export const VENTANA_QUEMADO = 50_000;

const nada = async (p, porDefecto = null) => { try { return await p; } catch { return porDefecto; } };

/**
 * Normaliza las direcciones de `config/deployments.json` a las claves que usa `CONTRATOS`
 * (en el JSON, GameItem se llama `address` por motivos históricos).
 * @param {object} dep  la entrada de la red
 * @returns {Record<string,string>}
 */
export function direccionesDeRed(dep) {
  const d = dep ?? {};
  const out = {
    gameItem: d.address, oro: d.oro, cosmeticos: d.cosmeticos,
    mercado: d.mercado, recompensas: d.recompensas, mercadoP2P: d.mercadoP2P,
  };
  for (const k of Object.keys(out)) if (!direccionValida(out[k])) delete out[k];
  return out;
}

/**
 * Carga `config/deployments.json` y saca las direcciones y el bloque de despliegue de una red.
 * `cargarConfig()` solo devuelve el GameItem (`address`), así que el resto lo leemos aquí.
 * @param {string} red
 * @param {{fetchImpl?:typeof fetch, base?:string|URL}} [o]
 * @returns {Promise<{direcciones:Record<string,string>, bloqueDespliegue:number}>}
 */
export async function cargarDespliegues(red, { fetchImpl = globalThis.fetch, base = import.meta.url } = {}) {
  let dep = null;
  if (typeof fetchImpl === "function") {
    for (const ruta of ["../../config/deployments.json", "../../../shared/deployments.json"]) {
      try {
        const res = await fetchImpl(new URL(ruta, base), { cache: "no-cache" });
        if (res?.ok) { const j = await res.json(); if (j?.[red]) { dep = j[red]; break; } }
      } catch { /* siguiente ruta */ }
    }
  }
  return {
    direcciones: direccionesDeRed(dep),
    bloqueDespliegue: Number(dep?.bloqueDespliegue ?? 0) || 0,
  };
}

/**
 * @typedef {object} Cartera
 * @property {string} direccion
 * @property {bigint|null} eth
 * @property {bigint|null} oro        unidades base
 * @property {{tokenId:number, nombre:string, tipo:string, rareza:number, rarezaTexto:string, ataque:number, defensa:number}[]} objetos
 * @property {{id:number, nombre:string, cantidad:number}[]} cosmeticos
 * @property {number|null} totalObjetos  cuántos tiene en total (puede ser > objetos.length)
 * @property {string[]} avisos
 */

/**
 * Lee todo lo que una dirección tiene en la cadena.
 * @param {ReturnType<import("./lectura.js").crearLector>} lector
 * @param {string} cuenta
 * @param {{max?:number}} [o]
 * @returns {Promise<Cartera>}
 */
export async function leerCartera(lector, cuenta, { max = MAX_OBJETOS } = {}) {
  const { gameItem, oro, cosmeticos } = lector.contratos ?? {};
  const avisos = [];
  const [eth, saldoOro] = await Promise.all([
    lector.saldoEth(cuenta),
    oro ? nada(oro.balanceOf(cuenta).then(aBigInt)) : null,
  ]);
  if (!oro) avisos.push("No hay contrato de ORO configurado en esta red.");

  let objetos = [];
  let totalObjetos = null;
  if (gameItem) {
    const n = Number(await nada(gameItem.balanceOf(cuenta), 0n));
    totalObjetos = Number.isFinite(n) ? n : null;
    const cuantos = Math.min(n || 0, max);
    if (n > cuantos) avisos.push(`Tiene ${n} objetos; se muestran los ${cuantos} primeros para no castigar el RPC.`);
    const ids = await Promise.all(
      Array.from({ length: cuantos }, (_, i) => nada(gameItem.tokenOfOwnerByIndex(cuenta, i)))
    );
    objetos = (await Promise.all(ids.filter((x) => x != null).map(async (id) => {
      const it = await nada(gameItem.getItem(id));
      if (!it) return null;
      return {
        tokenId: Number(id),
        nombre: String(it.nombre ?? it[0] ?? ""),
        tipo: String(it.tipo ?? it[1] ?? ""),
        rareza: Number(it.rareza ?? it[2] ?? 0),
        rarezaTexto: rarezaTexto(it.rareza ?? it[2] ?? 0),
        ataque: Number(it.ataque ?? it[3] ?? 0),
        defensa: Number(it.defensa ?? it[4] ?? 0),
      };
    }))).filter(Boolean);
  } else {
    avisos.push("No hay contrato de objetos configurado en esta red.");
  }

  let lista = [];
  if (cosmeticos) {
    const ids = [...IDS_CATALOGO];
    const saldos = await nada(cosmeticos.balanceOfBatch(ids.map(() => cuenta), ids));
    if (saldos) {
      const mapa = parsearSaldos(ids, saldos);
      lista = Object.entries(mapa).map(([id, cantidad]) => ({
        id: Number(id), nombre: cosmetico(id)?.nombre ?? `#${id}`, cantidad,
      }));
    }
  }

  return { direccion: cuenta, eth, oro: saldoOro, objetos, cosmeticos: lista, totalObjetos, avisos };
}

/**
 * Compara lo que dice la cadena con lo que el juego tiene guardado en local.
 * La fase E pide explícitamente que, si no cuadran, se diga en vez de disimularlo.
 * @param {Cartera} cadena
 * @param {{oro?:number|bigint|null, objetos?:number|null}} local
 * @returns {{coincide:boolean, diferencias:string[]}}
 */
export function compararConLocal(cadena, local) {
  const diferencias = [];
  if (local?.oro != null && cadena?.oro != null) {
    const enCadena = cadena.oro / 10n ** 18n;
    const enLocal = BigInt(Math.trunc(Number(local.oro)));
    if (enCadena !== enLocal) {
      diferencias.push(`El juego muestra ${enLocal} ORO y la cadena dice ${enCadena}. Manda la cadena; lo local puede estar sin refrescar.`);
    }
  }
  if (local?.objetos != null && cadena?.totalObjetos != null && Number(local.objetos) !== cadena.totalObjetos) {
    diferencias.push(`El juego muestra ${Number(local.objetos)} objetos y la cadena dice ${cadena.totalObjetos}.`);
  }
  return { coincide: diferencias.length === 0, diferencias };
}

/**
 * @typedef {object} Tesoreria
 * @property {bigint|null} cajaEth        ETH en la caja del Mercado
 * @property {string|null} owner          dueño de los contratos (quien puede retirar)
 * @property {string|null} operador       cartera del servidor (paga el gas de recompensas y grifo)
 * @property {bigint|null} ethOperador
 * @property {bigint|null} oroCirculacion totalSupply de ORO
 * @property {{valor:bigint, alcance:"completo"|"parcial"|null, desdeBloque:number|null}} oroQuemado
 * @property {bigint|null} oroQuemadoP2P  exacto, del acumulador del MercadoP2P (si está desplegado)
 * @property {number|null} objetosDestruidos  NFT que están en 0x…dEaD
 * @property {number|null} objetosAcunados
 * @property {"servidor"|"rpc"} fuente
 * @property {string[]} avisos
 */

/**
 * Estado del dinero del juego. Intenta primero el resumen cacheado del servidor
 * (`GET {serverUrl}/tesoreria`, que el equipo de servidor sirve por red) y, si no responde,
 * lee del RPC lo que se puede leer con una llamada por dato.
 * @param {ReturnType<import("./lectura.js").crearLector>} lector
 * @param {{serverUrl?:string, red?:string, fetchImpl?:typeof fetch, timeoutMs?:number, conQuemado?:boolean}} [o]
 * @returns {Promise<Tesoreria>}
 */
export async function leerTesoreria(lector, { serverUrl = null, red = null, fetchImpl = globalThis.fetch, timeoutMs = 8000, conQuemado = true } = {}) {
  const delServidor = await resumenDelServidor({ serverUrl, red, fetchImpl, timeoutMs });
  const { mercado, oro, gameItem, recompensas, mercadoP2P } = lector.contratos ?? {};
  const avisos = [];

  const [cajaEth, owner, operador, oroCirculacion, destruidos, acunados, quemadoP2P] = await Promise.all([
    mercado ? nada(mercado.cajaEth().then(aBigInt)) : null,
    mercado ? nada(mercado.owner()) : null,
    recompensas ? nada(recompensas.operador()) : null,
    oro ? nada(oro.totalSupply().then(aBigInt)) : null,
    gameItem ? nada(gameItem.balanceOf(DEAD).then((v) => Number(aBigInt(v)))) : null,
    gameItem ? nada(gameItem.totalMinted().then((v) => Number(aBigInt(v)))) : null,
    mercadoP2P ? nada(mercadoP2P.oroQuemado().then(aBigInt)) : null,
  ]);

  const ethOperador = direccionValida(operador) ? await lector.saldoEth(operador) : null;
  if (!mercado) avisos.push("No hay contrato Mercado en esta red: no se puede leer la caja.");
  if (!recompensas) avisos.push("No hay contrato Recompensas en esta red: no se sabe cuál es la cartera del servidor.");

  // ORO quemado: el total exacto exige recorrer todos los Transfer hacia 0x0 desde el
  // despliegue, que son demasiados tramos para un RPC público. Si el servidor lo sirve, se usa
  // su cifra; si no, se barre una ventana reciente y se dice que es parcial.
  let oroQuemado = { valor: 0n, alcance: null, desdeBloque: null };
  if (delServidor?.oroQuemado != null) {
    oroQuemado = { valor: aBigInt(delServidor.oroQuemado), alcance: "completo", desdeBloque: lector.bloqueDespliegue ?? null };
  } else if (conQuemado && oro) {
    const r = await quemadoReciente(lector);
    oroQuemado = r;
    if (r.alcance === "parcial") {
      avisos.push("El ORO quemado es solo el de los últimos bloques: el total exacto lo tiene que servir el servidor (indexar toda la historia no cabe en un RPC público).");
    }
  }

  return {
    cajaEth: delServidor?.cajaEth != null ? aBigInt(delServidor.cajaEth) : cajaEth,
    owner,
    operador,
    ethOperador: delServidor?.ethOperador != null ? aBigInt(delServidor.ethOperador) : ethOperador,
    oroCirculacion: delServidor?.oroCirculacion != null ? aBigInt(delServidor.oroCirculacion) : oroCirculacion,
    oroQuemado,
    oroQuemadoP2P: quemadoP2P,
    objetosDestruidos: destruidos,
    objetosAcunados: acunados,
    fuente: delServidor ? "servidor" : "rpc",
    avisos,
  };
}

/** `GET {serverUrl}/tesoreria?red=…`. Devuelve null si no existe o no responde. */
async function resumenDelServidor({ serverUrl, red, fetchImpl, timeoutMs }) {
  if (!serverUrl || typeof fetchImpl !== "function") return null;
  const url = `${String(serverUrl).replace(/\/+$/, "")}/tesoreria${red ? `?red=${encodeURIComponent(red)}` : ""}`;
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  const t = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(url, { signal: ctrl?.signal });
    if (!res?.ok) return null;
    const body = await res.json();
    return body && typeof body === "object" ? body : null;
  } catch {
    return null; // el endpoint es un extra: su ausencia no puede romper el panel
  } finally {
    if (t) clearTimeout(t);
  }
}

/**
 * Suma los `Transfer` de ORO hacia 0x0 de la ventana que el RPC conserva.
 * El alcance real lo decide `barrer` (el nodo público solo guarda los logs recientes), así que
 * se informa del bloque desde el que de verdad se ha podido leer, no del que se pidió.
 */
async function quemadoReciente(lector) {
  const alto = await lector.bloqueActual();
  const pedido = Math.max(lector.bloqueDespliegue ?? 0, alto - VENTANA_QUEMADO);
  const r = await lector.barrer("oro", "Transfer", [null, "0x" + "0".repeat(64)], { desde: pedido });
  const valor = r.sucesos.reduce((acc, s) => acc + BigInt(s.args?.value ?? 0n), 0n);
  const desdeBloque = r.desdeDisponible ?? pedido;
  const completo = r.completo && desdeBloque <= (lector.bloqueDespliegue ?? 0);
  return { valor, alcance: completo ? "completo" : "parcial", desdeBloque };
}

/**
 * ¿La cuenta conectada puede retirar el ETH de la caja? Es `onlyOwner` en el contrato.
 * @param {Tesoreria} t
 * @param {string|null} cuenta
 * @returns {{puede:boolean, motivo:string}}
 */
export function puedeRetirar(t, cuenta) {
  if (!t?.owner) return { puede: false, motivo: "No se pudo leer quién es el dueño del contrato." };
  if (!cuenta) return { puede: false, motivo: "Con la cartera sin conectar solo se puede mirar. Retirar lo firma el dueño." };
  if (!mismaDir(cuenta, t.owner)) {
    return { puede: false, motivo: "Tu cartera no es la dueña del contrato, así que no puedes tocar la caja: `retirarEth` es `onlyOwner` y el contrato rechazaría la transacción." };
  }
  return { puede: true, motivo: "Tu cartera es la dueña del contrato: puedes retirar." };
}

/**
 * @typedef {object} Rival
 * @property {string} direccion
 * @property {bigint|null} oro
 * @property {bigint|null} eth
 * @property {number|null} objetos
 * @property {{nombre:string, rarezaTexto:string}[]} muestra  unos pocos objetos, para enseñar algo
 * @property {number|null} victorias  del ranking del servidor; null si no se sabe
 * @property {string|null} alias
 */

/**
 * Lee el estado público de los rivales. Solo lecturas: es información pública de la cadena.
 * `victorias` NO está en la cadena (la lleva el servidor), así que se marca como tal.
 * @param {ReturnType<import("./lectura.js").crearLector>} lector
 * @param {{direccion:string, victorias?:number|null, alias?:string|null}[]} rivales
 * @param {{maxObjetos?:number}} [o]
 * @returns {Promise<Rival[]>}
 */
export async function leerRivales(lector, rivales, { maxObjetos = 3 } = {}) {
  const { gameItem, oro } = lector.contratos ?? {};
  const unicos = [];
  const vistos = new Set();
  for (const r of rivales ?? []) {
    const d = r?.direccion;
    if (!direccionValida(d) || mismaDir(d, CERO)) continue;
    const k = d.toLowerCase();
    if (vistos.has(k)) continue;
    vistos.add(k);
    unicos.push(r);
  }
  return Promise.all(unicos.map(async (r) => {
    const [saldoOro, eth, n] = await Promise.all([
      oro ? nada(oro.balanceOf(r.direccion).then(aBigInt)) : null,
      lector.saldoEth(r.direccion),
      gameItem ? nada(gameItem.balanceOf(r.direccion).then((v) => Number(aBigInt(v)))) : null,
    ]);
    let muestra = [];
    if (gameItem && n > 0) {
      const cuantos = Math.min(n, maxObjetos);
      const ids = await Promise.all(Array.from({ length: cuantos }, (_, i) => nada(gameItem.tokenOfOwnerByIndex(r.direccion, i))));
      muestra = (await Promise.all(ids.filter((x) => x != null).map(async (id) => {
        const it = await nada(gameItem.getItem(id));
        return it ? { nombre: String(it.nombre ?? it[0] ?? `#${id}`), rarezaTexto: rarezaTexto(it.rareza ?? it[2] ?? 0) } : null;
      }))).filter(Boolean);
    }
    return {
      direccion: r.direccion, oro: saldoOro, eth, objetos: n, muestra,
      victorias: r.victorias ?? null, alias: r.alias ?? null,
    };
  }));
}

/**
 * Saca las direcciones de los rivales de las fuentes que ya tiene el juego.
 * @param {{ranking?:any[], listadosP2P?:any[], extra?:string[]}} fuentes
 * @returns {{direccion:string, victorias:number|null, alias:string|null, de:string}[]}
 */
export function rivalesDe({ ranking = [], listadosP2P = [], extra = [] } = {}) {
  const out = [];
  const añadir = (direccion, de, victorias = null, alias = null) => {
    if (direccionValida(direccion)) out.push({ direccion, victorias, alias, de });
  };
  for (const f of ranking ?? []) {
    añadir(f?.address ?? f?.direccion, "ranking", numeroONull(f?.victorias ?? f?.wins ?? f?.puntos), f?.alias ?? f?.nombre ?? null);
  }
  for (const l of listadosP2P ?? []) añadir(l?.vendedor, "mercado");
  for (const d of extra ?? []) añadir(d, "partida");
  return out;
}

const numeroONull = (v) => (v == null || Number.isNaN(Number(v)) ? null : Number(v));
