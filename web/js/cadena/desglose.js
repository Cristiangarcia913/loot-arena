// «Quién se está llevando el dinero» (PLAN-MAESTRO.md §7, fase E2).
//
// Dos momentos, y los dos hacen falta:
//   1. ANTES de firmar: `preverVenta`, `preverCompraCosmetico`, `preverCompraP2P` arman el
//      desglose con las cifras que vienen de las **vistas del contrato** (precioVenta,
//      ethPorVenta, comisionBps). Quien llama las lee; aquí solo se ordenan y se explican.
//   2. DESPUÉS: `leerRecibo` decodifica los eventos del recibo real y dice lo que de verdad
//      pasó, dirección por dirección. `comparar` pone los dos lados en la mesa.
//
// Ese segundo paso es el que convierte la promesa en verificación: si el contrato moviera el
// dinero a otro sitio del anunciado, `comparar` lo marcaría como diferencia.
//
// Módulo **puro**: ni DOM ni ethers. Las cantidades son bigint (unidades base / wei).

import { formatearEth, formatearOro } from "../economy.js";
import { CERO, DEAD, mismaDir } from "./lectura.js";
import { etiquetarDireccion } from "./eventos.js";

const ORO = (u) => `${formatearOro(u, { decimales: 2 })} ORO`;
const ETH = (w) => `${formatearEth(w, { decimales: 6 })} ETH`;

/** Etiqueta fija para el destinatario del gas: no es nuestro y conviene que se vea. */
export const VALIDADOR = "el validador que mina el bloque (no el juego)";
/** Etiqueta del dinero que se crea o se destruye. */
export const ACUNADO = "ninguna cartera: el contrato lo acuña";
export const QUEMADO = "ninguna cartera: se quema y sale de circulación";

/**
 * @typedef {object} Flujo  un movimiento de valor, previsto o real
 * @property {"oro"|"eth"|"objeto"|"cosmetico"} activo
 * @property {bigint} cantidad      unidades base (oro), wei (eth), o 1n para objetos
 * @property {string} de            de dónde sale, ya etiquetado
 * @property {string} a             a dónde va, ya etiquetado
 * @property {"transferido"|"acunado"|"quemado"|"gas"|"destruido"} clase
 * @property {string} texto         línea lista para mostrar
 * @property {number} [id]          tokenId o id de cosmético
 */

const flujo = (f) => Object.freeze({ ...f, texto: f.texto ?? textoFlujo(f) });

function textoFlujo(f) {
  const cant = f.activo === "oro" ? ORO(f.cantidad)
    : f.activo === "eth" ? ETH(f.cantidad)
    : f.activo === "objeto" ? `el objeto #${f.id}`
    : `el cosmético #${f.id}`;
  if (f.clase === "acunado") return `${cant}: se acuñan de la nada y van a ${f.a}.`;
  if (f.clase === "quemado") return `${cant}: salen de ${f.de} y se queman (nadie los cobra).`;
  if (f.clase === "destruido") return `${cant} sale de ${f.de} y se destruye.`;
  if (f.clase === "gas") return `${cant} de gas: lo paga ${f.de} y lo cobra ${f.a}.`;
  return `${cant}: de ${f.de} a ${f.a}.`;
}

/**
 * @typedef {object} Desglose
 * @property {string} titulo
 * @property {Flujo[]} flujos
 * @property {{quien:string, oro:bigint, eth:bigint}[]} reparto  quién acaba con cuánto
 * @property {string[]} avisos
 * @property {bigint|null} gas   wei de gas (estimado o real); null si no se sabe
 */

/**
 * Suma los flujos por destinatario: la respuesta directa a «¿quién se lleva el dinero?».
 * Lo que sale de alguien cuenta en negativo y lo que entra en positivo; lo acuñado y lo
 * quemado aparecen con su etiqueta, para que se vea que no hay un beneficiario oculto.
 * @param {Flujo[]} flujos
 * @returns {{quien:string, oro:bigint, eth:bigint}[]}
 */
export function repartir(flujos) {
  const mapa = new Map();
  const toca = (quien, activo, cantidad) => {
    if (activo !== "oro" && activo !== "eth") return;
    const e = mapa.get(quien) ?? { quien, oro: 0n, eth: 0n };
    e[activo] += cantidad;
    mapa.set(quien, e);
  };
  for (const f of flujos ?? []) {
    if (f.clase === "acunado") toca(f.a, f.activo, f.cantidad);
    else if (f.clase === "quemado") { toca(f.de, f.activo, -f.cantidad); toca(QUEMADO, f.activo, f.cantidad); }
    else if (f.clase === "gas") { toca(f.de, f.activo, -f.cantidad); toca(VALIDADOR, f.activo, f.cantidad); }
    else if (f.clase === "transferido") { toca(f.de, f.activo, -f.cantidad); toca(f.a, f.activo, f.cantidad); }
  }
  return [...mapa.values()]
    .filter((e) => e.oro !== 0n || e.eth !== 0n)
    .sort((a, b) => Number(b.oro - a.oro) || Number(b.eth - a.eth));
}

const terminar = (titulo, flujos, avisos, gas) => Object.freeze({
  titulo, flujos: Object.freeze(flujos), reparto: repartir(flujos), avisos: Object.freeze(avisos ?? []), gas: gas ?? null,
});

/**
 * Antes de firmar una venta a la tienda (`Mercado.venderItem`).
 * @param {{tokenId:number|string, precioOro:bigint, ethPrevisto:bigint, gas?:bigint|null,
 *          ctx:object, cajaEth?:bigint|null, restanteHoy?:bigint|null}} o
 *        `precioOro` viene de `Mercado.precioVenta(tokenId)` y `ethPrevisto` de
 *        `Mercado.ethPorVenta(jugador, rareza)`: **del contrato, no de constantes de la web**.
 * @returns {Desglose}
 */
export function preverVenta({ tokenId, precioOro, ethPrevisto = 0n, gas = null, ctx = {}, cajaEth = null, restanteHoy = null }) {
  const yo = etiquetarDireccion(ctx.yo, ctx);
  const flujos = [
    flujo({ activo: "objeto", cantidad: 1n, id: Number(tokenId), de: yo, a: etiquetarDireccion(DEAD, ctx), clase: "destruido" }),
    flujo({ activo: "oro", cantidad: BigInt(precioOro), de: ACUNADO, a: yo, clase: "acunado" }),
  ];
  const avisos = [];
  if (BigInt(ethPrevisto) > 0n) {
    flujos.push(flujo({ activo: "eth", cantidad: BigInt(ethPrevisto), de: etiquetarDireccion(ctx.direcciones?.mercado, ctx), a: yo, clase: "transferido" }));
  } else {
    avisos.push("La caja no te va a pagar ETH en esta venta: o no le queda saldo, o ya agotaste tu cupo diario.");
  }
  if (cajaEth != null && BigInt(ethPrevisto) > BigInt(cajaEth)) {
    avisos.push("La caja tiene menos ETH del previsto: el contrato pagará 0 y la venta seguirá con solo ORO.");
  }
  if (restanteHoy != null && BigInt(restanteHoy) <= 0n) {
    avisos.push("Hoy ya has cobrado el máximo de ETH por dirección; mañana se renueva.");
  }
  if (gas != null) flujos.push(flujo({ activo: "eth", cantidad: BigInt(gas), de: yo, a: VALIDADOR, clase: "gas" }));
  avisos.push("El juego no se queda ninguna comisión al venderle a la tienda: el ORO se acuña nuevo.");
  return terminar(`Vas a vender el objeto #${Number(tokenId)}`, flujos, avisos, gas);
}

/**
 * Antes de firmar una compra en la tienda (`Mercado.comprarCosmetico`) o un cofre.
 * @param {{precioOro:bigint, id?:number, cantidad?:number, gas?:bigint|null, ctx:object, cofre?:boolean}} o
 * @returns {Desglose}
 */
export function preverCompraCosmetico({ precioOro, id = null, cantidad = 1, gas = null, ctx = {}, cofre = false }) {
  const yo = etiquetarDireccion(ctx.yo, ctx);
  const flujos = [flujo({ activo: "oro", cantidad: BigInt(precioOro), de: yo, a: QUEMADO, clase: "quemado" })];
  if (!cofre && id != null) {
    flujos.push(flujo({ activo: "cosmetico", cantidad: BigInt(cantidad), id: Number(id), de: ACUNADO, a: yo, clase: "transferido", texto: `El cosmético #${Number(id)} (×${cantidad}) se acuña para ti.` }));
  }
  if (gas != null) flujos.push(flujo({ activo: "eth", cantidad: BigInt(gas), de: yo, a: VALIDADOR, clase: "gas" }));
  return terminar(
    cofre ? "Vas a abrir un cofre" : `Vas a comprar el cosmético #${Number(id)}`,
    flujos,
    [
      "Tu ORO no va a ninguna cartera del juego: el contrato lo quema, así que la oferta total de ORO baja.",
      cofre ? "El cosmético lo elige el contrato; el azar usa `block.prevrandao` y es predecible por un validador (aceptable en testnet)." : null,
    ].filter(Boolean),
    gas
  );
}

/**
 * Antes de firmar una compra en el mercado entre jugadores (`MercadoP2P.comprarHasta`).
 * @param {{tokenId:number|string, precio:bigint, comisionBps:number|bigint, vendedor:string,
 *          gas?:bigint|null, ctx:object}} o
 * @returns {Desglose}
 */
export function preverCompraP2P({ tokenId, precio, comisionBps = 500n, vendedor, gas = null, ctx = {} }) {
  const p = BigInt(precio);
  const comision = (p * BigInt(comisionBps)) / 10_000n;
  const neto = p - comision;
  const yo = etiquetarDireccion(ctx.yo, ctx);
  const vend = etiquetarDireccion(vendedor, ctx);
  const flujos = [
    flujo({ activo: "oro", cantidad: neto, de: yo, a: vend, clase: "transferido" }),
    flujo({ activo: "oro", cantidad: comision, de: yo, a: QUEMADO, clase: "quemado" }),
    flujo({ activo: "objeto", cantidad: 1n, id: Number(tokenId), de: "la custodia del MercadoP2P", a: yo, clase: "transferido", texto: `El objeto #${Number(tokenId)} pasa de la custodia del contrato a ti.` }),
  ];
  if (gas != null) flujos.push(flujo({ activo: "eth", cantidad: BigInt(gas), de: yo, a: VALIDADOR, clase: "gas" }));
  return terminar(
    `Vas a comprar el objeto #${Number(tokenId)} por ${ORO(p)}`,
    flujos,
    [`La comisión del juego es del ${(Number(comisionBps) / 100).toFixed(2).replace(".", ",")} %, y no se la queda nadie: se quema.`],
    gas
  );
}

/**
 * Después de firmar: qué movió de verdad la transacción, leído de **sus** eventos.
 * @param {{sucesos:import("./lectura.js").Suceso[], gasUsado?:bigint|null, precioGas?:bigint|null,
 *          pagador?:string, ctx?:object, titulo?:string}} o
 *        `sucesos` son los logs del recibo ya decodificados (ver `decodificarRecibo`).
 * @returns {Desglose}
 */
export function leerRecibo({ sucesos = [], gasUsado = null, precioGas = null, pagador = null, ctx = {}, titulo = "Lo que pasó de verdad" }) {
  const flujos = [];
  for (const s of sucesos) {
    const a = s?.args ?? {};
    const clave = `${s.contrato}.${s.nombre}`;
    if (clave === "oro.Transfer") {
      const v = BigInt(a.value ?? 0n);
      if (v === 0n) continue;
      if (mismaDir(a.from, CERO)) flujos.push(flujo({ activo: "oro", cantidad: v, de: ACUNADO, a: etiquetarDireccion(a.to, ctx), clase: "acunado" }));
      else if (mismaDir(a.to, CERO)) flujos.push(flujo({ activo: "oro", cantidad: v, de: etiquetarDireccion(a.from, ctx), a: QUEMADO, clase: "quemado" }));
      else flujos.push(flujo({ activo: "oro", cantidad: v, de: etiquetarDireccion(a.from, ctx), a: etiquetarDireccion(a.to, ctx), clase: "transferido" }));
    } else if (clave === "gameItem.Transfer") {
      const destruido = mismaDir(a.to, DEAD) || mismaDir(a.to, CERO);
      flujos.push(flujo({
        activo: "objeto", cantidad: 1n, id: Number(a.tokenId),
        de: etiquetarDireccion(a.from, ctx), a: etiquetarDireccion(a.to, ctx),
        clase: destruido ? "destruido" : "transferido",
      }));
    } else if (clave === "cosmeticos.TransferSingle") {
      flujos.push(flujo({
        activo: "cosmetico", cantidad: BigInt(a.value ?? 1n), id: Number(a.id),
        de: etiquetarDireccion(a.from, ctx), a: etiquetarDireccion(a.to, ctx), clase: "transferido",
        texto: `El cosmético #${Number(a.id)} (×${Number(a.value ?? 1)}) pasa de ${etiquetarDireccion(a.from, ctx)} a ${etiquetarDireccion(a.to, ctx)}.`,
      }));
    } else if (clave === "mercado.ItemVendido" && BigInt(a.eth ?? 0n) > 0n) {
      // El ETH de la caja no emite ningún Transfer (es ETH nativo): se lee del evento.
      flujos.push(flujo({
        activo: "eth", cantidad: BigInt(a.eth), de: etiquetarDireccion(ctx.direcciones?.mercado, ctx),
        a: etiquetarDireccion(a.jugador, ctx), clase: "transferido",
      }));
    } else if (clave === "mercado.EthRetirado") {
      flujos.push(flujo({
        activo: "eth", cantidad: BigInt(a.cantidad ?? 0n),
        de: etiquetarDireccion(ctx.direcciones?.mercado, ctx), a: etiquetarDireccion(a.a, ctx), clase: "transferido",
      }));
    }
  }
  const gas = gasUsado != null && precioGas != null ? BigInt(gasUsado) * BigInt(precioGas) : null;
  if (gas != null) {
    flujos.push(flujo({ activo: "eth", cantidad: gas, de: etiquetarDireccion(pagador ?? ctx.yo, ctx), a: VALIDADOR, clase: "gas" }));
  }
  const avisos = sucesos.length === 0
    ? ["La transacción no emitió ningún evento de nuestros contratos: no movió ORO ni objetos."]
    : [];
  return terminar(titulo, flujos, avisos, gas);
}

/**
 * Decodifica los logs de un recibo con los contratos que tengamos. Necesita las interfaces
 * de ethers, así que recibe los contratos ya construidos (igual que `lectura.js`).
 * @param {{logs:any[]}} recibo
 * @param {Record<string, any|null>} contratos
 * @returns {import("./lectura.js").Suceso[]}
 */
export function decodificarRecibo(recibo, contratos) {
  const porDir = new Map();
  for (const [clave, c] of Object.entries(contratos ?? {})) {
    const dir = c?.address ?? c?.target;
    if (c && dir) porDir.set(String(dir).toLowerCase(), { clave, c });
  }
  const out = [];
  for (const log of recibo?.logs ?? []) {
    const e = porDir.get(String(log.address ?? "").toLowerCase());
    if (!e) continue; // log de un contrato que no es nuestro
    let p = null;
    try {
      p = e.c.interface.parseLog({ topics: [...(log.topics ?? [])], data: log.data ?? "0x" });
    } catch { p = null; }
    if (!p) continue;
    const args = {};
    for (const [i, input] of (p.fragment?.inputs ?? []).entries()) if (input?.name) args[input.name] = p.args?.[i];
    out.push({
      contrato: e.clave, nombre: p.name, args,
      bloque: Number(recibo.blockNumber ?? 0),
      indice: Number(log.logIndex ?? log.index ?? 0),
      hash: recibo.hash ?? recibo.transactionHash ?? "",
    });
  }
  return out;
}

/**
 * Pone frente a frente lo prometido y lo ocurrido.
 * El gas se compara aparte y con tolerancia: la estimación nunca acierta al wei, y eso no es
 * un engaño del contrato. El ORO y el ETH que cambian de manos sí se comparan exactos.
 * @param {Desglose} previsto
 * @param {Desglose} real
 * @returns {{coincide:boolean, lineas:{quien:string, previsto:string, real:string, igual:boolean}[], diferencias:string[]}}
 */
export function comparar(previsto, real) {
  const sinGas = (d) => new Map(
    repartir((d?.flujos ?? []).filter((f) => f.clase !== "gas")).map((e) => [e.quien, e])
  );
  const a = sinGas(previsto), b = sinGas(real);
  const quienes = [...new Set([...a.keys(), ...b.keys()])];
  const lineas = [];
  const diferencias = [];
  for (const quien of quienes) {
    const p = a.get(quien) ?? { oro: 0n, eth: 0n };
    const r = b.get(quien) ?? { oro: 0n, eth: 0n };
    const igual = p.oro === r.oro && p.eth === r.eth;
    lineas.push({ quien, previsto: cantidades(p), real: cantidades(r), igual });
    if (!igual) diferencias.push(`${quien}: se anunció ${cantidades(p)} y ocurrió ${cantidades(r)}.`);
  }
  if (previsto?.gas != null && real?.gas != null) {
    const dif = real.gas > previsto.gas ? real.gas - previsto.gas : previsto.gas - real.gas;
    // Avisamos solo si el gas real se pasa del doble de lo estimado.
    if (previsto.gas > 0n && dif > previsto.gas) {
      diferencias.push(`El gas real (${ETH(real.gas)}) se alejó mucho de la estimación (${ETH(previsto.gas)}).`);
    }
  }
  return { coincide: diferencias.length === 0, lineas, diferencias };
}

function cantidades({ oro = 0n, eth = 0n }) {
  const partes = [];
  if (oro !== 0n) partes.push(`${oro > 0n ? "+" : "−"}${ORO(oro < 0n ? -oro : oro)}`);
  if (eth !== 0n) partes.push(`${eth > 0n ? "+" : "−"}${ETH(eth < 0n ? -eth : eth)}`);
  return partes.length ? partes.join(" y ") : "nada";
}
