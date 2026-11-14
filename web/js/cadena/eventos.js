// Interpretación de los eventos de nuestros contratos (fase E1.2 y E2).
//
// Módulo **puro**: entra un `Suceso` ya decodificado (ver lectura.js) y sale un `Movimiento`
// con texto en español y las cantidades con signo desde el punto de vista del jugador.
// No importa ethers ni toca el DOM, así que los tests le dan objetos planos.
//
// Por qué agrupamos por transacción: una sola venta emite cuatro eventos (GameItem.Transfer,
// LootGold.Transfer, Mercado.ItemVendido y, si hay ETH, nada más) y mostrar cuatro filas para
// un clic del jugador sería ruido. Se muestra **una fila por transacción**, titulada por el
// evento que mejor la explica, y dentro el detalle de todo lo que se movió.

import { cosmetico, formatearEth, formatearOro } from "../economy.js";
import { CERO, DEAD, mismaDir } from "./lectura.js";

const ORO = (u) => `${formatearOro(u, { decimales: 2 })} ORO`;
const ETH = (w) => `${formatearEth(w, { decimales: 6 })} ETH`;
const nombreCosmetico = (id) => cosmetico(id)?.nombre ?? `cosmético #${Number(id)}`;
const RAREZAS = Object.freeze(["Común", "Raro", "Legendario"]);

/** Dirección corta para texto ("0x1234…abcd"). */
export const corta = (d) => (typeof d === "string" && d.length > 12 ? `${d.slice(0, 6)}…${d.slice(-4)}` : String(d ?? ""));

/**
 * Nombre legible de una dirección conocida. Lo que permite decir «la caja del Mercado»
 * en vez de un hexadecimal, que es justo lo que el profesor quiere ver explicado.
 * @param {string} dir
 * @param {{yo?:string, direcciones?:Record<string,string>, owner?:string, operador?:string}} ctx
 * @returns {string}
 */
export function etiquetarDireccion(dir, ctx = {}) {
  if (!dir) return "—";
  if (mismaDir(dir, CERO)) return "la nada (acuñado/quemado)";
  if (mismaDir(dir, DEAD)) return "la dirección de quemado (0x…dEaD)";
  if (mismaDir(dir, ctx.yo)) return "tú";
  const d = ctx.direcciones ?? {};
  if (mismaDir(dir, d.mercado)) return "el contrato Mercado (la caja del juego)";
  if (mismaDir(dir, d.mercadoP2P)) return "el contrato MercadoP2P (custodia)";
  if (mismaDir(dir, d.recompensas)) return "el contrato Recompensas";
  if (mismaDir(dir, d.oro)) return "el contrato ORO";
  if (mismaDir(dir, d.gameItem)) return "el contrato de objetos";
  if (mismaDir(dir, ctx.operador)) return "la cartera del servidor del juego";
  if (mismaDir(dir, ctx.owner)) return "el dueño de los contratos";
  return corta(dir);
}

/**
 * @typedef {object} Movimiento
 * @property {string} clave     "mercado.ItemVendido"
 * @property {number} prioridad cuanto más alta, mejor explica la transacción
 * @property {string} titulo
 * @property {string[]} detalle líneas de explicación
 * @property {bigint} oro       ORO que gana (+) o pierde (−) el jugador, en unidades base
 * @property {bigint} eth       ETH que gana (+) o pierde (−) el jugador, en wei (sin contar el gas)
 * @property {number} bloque
 * @property {number} indice
 * @property {string} hash
 * @property {number|null} fecha  timestamp en segundos
 */

// Prioridad: los eventos "de juego" explican la transacción mejor que los Transfer de token,
// que son su consecuencia mecánica.
const P = Object.freeze({
  venta: 100, compraCosmetico: 95, cofre: 90, diario: 85, recompensado: 80,
  bienvenida: 75, premio: 70, p2pVendido: 68, p2pListado: 66, p2pCancelado: 64,
  nftMint: 50, nftTransfer: 40, oroTransfer: 30, cosmeticoTransfer: 25, otro: 10,
});

/**
 * Traduce un suceso a un movimiento. Devuelve null si el evento no nos interesa
 * (aprobaciones, cambios de configuración…) o si no afecta a `ctx.yo`.
 * @param {import("./lectura.js").Suceso & {fecha?:number|null}} s
 * @param {{yo?:string, direcciones?:Record<string,string>, owner?:string, operador?:string}} ctx
 * @returns {Movimiento|null}
 */
export function interpretar(s, ctx = {}) {
  const a = s?.args ?? {};
  const base = {
    clave: `${s.contrato}.${s.nombre}`,
    bloque: s.bloque, indice: s.indice, hash: s.hash, fecha: s.fecha ?? null,
    oro: 0n, eth: 0n,
  };
  const et = (d) => etiquetarDireccion(d, ctx);
  const yo = ctx.yo;

  switch (base.clave) {
    // ───────── Mercado (la tienda)
    case "mercado.ItemVendido": {
      const detalle = [
        `Entregas el objeto #${Number(a.tokenId)}, que se destruye (va a ${et(DEAD)}).`,
        `El contrato **acuña** ${ORO(a.oro)} y te los da: nadie los pierde, aparecen.`,
      ];
      if (a.eth > 0n) detalle.push(`La caja del Mercado te paga ${ETH(a.eth)} de su propio saldo.`);
      else detalle.push("La caja no te pagó ETH esta vez (sin saldo o cupo diario agotado).");
      return { ...base, prioridad: P.venta, titulo: `Vendiste el objeto #${Number(a.tokenId)} a la tienda`, detalle, oro: BigInt(a.oro ?? 0n), eth: BigInt(a.eth ?? 0n) };
    }
    case "mercado.CosmeticoComprado": {
      const n = Number(a.cantidad ?? 1);
      return {
        ...base, prioridad: P.compraCosmetico,
        titulo: `Compraste ${n > 1 ? `${n} × ` : ""}${nombreCosmetico(a.id)}`,
        detalle: [
          `Pagas ${ORO(a.oro)}, que se **queman**: no van a ninguna cartera, salen de circulación.`,
          "Recibes el cosmético como token ERC-1155.",
        ],
        oro: -BigInt(a.oro ?? 0n),
      };
    }
    case "mercado.CofreAbierto":
      return {
        ...base, prioridad: P.cofre,
        titulo: `Abriste un cofre y salió ${nombreCosmetico(a.id)}`,
        detalle: ["El ORO del cofre se quema. El cosmético lo elige el contrato con `block.prevrandao`."],
      };
    case "mercado.BienvenidaReclamada":
      return {
        ...base, prioridad: P.bienvenida, titulo: "Cobraste el bono de bienvenida",
        detalle: [`El contrato acuña ${ORO(a.oro)} para ti, una sola vez por dirección.`],
        oro: BigInt(a.oro ?? 0n),
      };
    case "mercado.PremioAcunado":
      return {
        ...base, prioridad: P.premio,
        titulo: a.cofre ? `Premio: cofre gratis (salió ${nombreCosmetico(a.id)})` : `Premio: ${nombreCosmetico(a.id)}`,
        detalle: ["Lo pidió el contrato Recompensas al Mercado; no pagaste nada."],
      };
    case "mercado.EthRetirado":
      return {
        ...base, prioridad: P.otro, titulo: `El dueño retiró ${ETH(a.cantidad)} de la caja`,
        detalle: [`Salió de la caja del Mercado hacia ${et(a.a)}.`],
        eth: mismaDir(a.a, yo) ? BigInt(a.cantidad ?? 0n) : 0n,
      };
    case "mercado.CajaRecargada":
      return {
        ...base, prioridad: P.otro, titulo: `Se recargó la caja con ${ETH(a.cantidad)}`,
        detalle: [`Enviado por ${et(a.de)}.`],
        eth: mismaDir(a.de, yo) ? -BigInt(a.cantidad ?? 0n) : 0n,
      };

    // ───────── Recompensas
    case "recompensas.DiarioReclamado": {
      const detalle = [`Racha de ${Number(a.racha)} día(s). El contrato acuña ${ORO(a.oro)}.`];
      if (Number(a.cosmeticoId) > 0) detalle.push(`Además te dio ${nombreCosmetico(a.cosmeticoId)} (premio del día 7).`);
      return { ...base, prioridad: P.diario, titulo: "Cobraste la recompensa diaria", detalle, oro: BigInt(a.oro ?? 0n) };
    }
    case "recompensas.Recompensado":
      return {
        ...base, prioridad: P.recompensado,
        titulo: `El servidor te pagó ${ORO(a.cantidad)}`,
        detalle: [`Motivo declarado en la cadena: «${String(a.motivo ?? "")}».`, "Lo firmó la cartera del servidor, con sus topes diarios."],
        oro: BigInt(a.cantidad ?? 0n),
      };

    // ───────── MercadoP2P (mercado entre jugadores)
    case "mercadoP2P.Vendido": {
      const soyVendedor = mismaDir(a.vendedor, yo);
      const comision = BigInt(a.comision ?? 0n);
      const precio = BigInt(a.precio ?? 0n);
      return {
        ...base, prioridad: P.p2pVendido,
        titulo: soyVendedor
          ? `Vendiste el objeto #${Number(a.tokenId)} a otro jugador`
          : `Compraste el objeto #${Number(a.tokenId)} a otro jugador`,
        detalle: [
          `Precio: ${ORO(precio)}. Comisión del juego: ${ORO(comision)} (se queman).`,
          `El vendedor (${et(a.vendedor)}) cobra ${ORO(precio - comision)}; el comprador es ${et(a.comprador)}.`,
        ],
        oro: soyVendedor ? precio - comision : -precio,
      };
    }
    case "mercadoP2P.Listado":
      return {
        ...base, prioridad: P.p2pListado,
        titulo: `Pusiste a la venta el objeto #${Number(a.tokenId)} por ${ORO(a.precio)}`,
        detalle: ["El objeto queda en custodia del contrato hasta que se venda o lo retires."],
      };
    case "mercadoP2P.Cancelado":
    case "mercadoP2P.Rescatado":
      return {
        ...base, prioridad: P.p2pCancelado,
        titulo: `Retiraste de la venta el objeto #${Number(a.tokenId)}`,
        detalle: ["El contrato te devolvió el objeto."],
      };

    // ───────── Tokens (la mecánica por debajo)
    case "gameItem.Transfer": {
      const mint = mismaDir(a.from, CERO);
      const quema = mismaDir(a.to, DEAD) || mismaDir(a.to, CERO);
      const salgo = mismaDir(a.from, yo);
      return {
        ...base, prioridad: mint ? P.nftMint : P.nftTransfer,
        titulo: mint
          ? `Recibiste el objeto #${Number(a.tokenId)} (recién acuñado)`
          : quema ? `El objeto #${Number(a.tokenId)} se destruyó`
          : salgo ? `Enviaste el objeto #${Number(a.tokenId)}`
          : `Recibiste el objeto #${Number(a.tokenId)}`,
        detalle: [`Objeto ERC-721 #${Number(a.tokenId)}: de ${et(a.from)} a ${et(a.to)}.`],
      };
    }
    case "oro.Transfer": {
      const valor = BigInt(a.value ?? 0n);
      const acunado = mismaDir(a.from, CERO);
      const quemado = mismaDir(a.to, CERO);
      const entra = mismaDir(a.to, yo);
      const sale = mismaDir(a.from, yo);
      if (!entra && !sale) return null; // ORO de otros: no es tu movimiento
      return {
        ...base, prioridad: P.oroTransfer,
        titulo: acunado ? `Recibiste ${ORO(valor)} (acuñados)`
          : quemado ? `Se quemaron ${ORO(valor)} de tu saldo`
          : entra ? `Recibiste ${ORO(valor)}` : `Pagaste ${ORO(valor)}`,
        detalle: [`ORO (ERC-20): de ${et(a.from)} a ${et(a.to)}.`],
        oro: entra ? valor : -valor,
      };
    }
    case "cosmeticos.TransferSingle": {
      const entra = mismaDir(a.to, yo);
      if (!entra && !mismaDir(a.from, yo)) return null;
      return {
        ...base, prioridad: P.cosmeticoTransfer,
        titulo: entra ? `Recibiste ${nombreCosmetico(a.id)}` : `Entregaste ${nombreCosmetico(a.id)}`,
        detalle: [`Cosmético ERC-1155 #${Number(a.id)} ×${Number(a.value)}: de ${et(a.from)} a ${et(a.to)}.`],
      };
    }
    default:
      return null; // aprobaciones, cambios de configuración, etc.
  }
}

/** Interpreta una lista de sucesos y descarta los que no dicen nada. */
export function interpretarTodos(sucesos, ctx = {}) {
  return (sucesos ?? []).map((s) => interpretar(s, ctx)).filter(Boolean);
}

/**
 * @typedef {object} Transaccion
 * @property {string} hash
 * @property {number} bloque
 * @property {number|null} fecha
 * @property {string} titulo        el del movimiento que mejor la explica
 * @property {string[]} detalle     el detalle de todos sus movimientos, sin repetir
 * @property {bigint} oro           saldo neto de ORO del jugador en esta transacción
 * @property {bigint} eth           saldo neto de ETH (sin el gas, que se lee del recibo)
 * @property {Movimiento[]} movimientos
 */

/**
 * Agrupa movimientos por transacción: una fila por clic del jugador, no una por evento.
 * El resultado va de más reciente a más antiguo.
 * @param {Movimiento[]} movimientos
 * @returns {Transaccion[]}
 */
export function agruparPorTx(movimientos) {
  const porHash = new Map();
  for (const m of movimientos ?? []) {
    const g = porHash.get(m.hash) ?? { hash: m.hash, bloque: m.bloque, fecha: m.fecha, movimientos: [] };
    g.movimientos.push(m);
    if (m.bloque > g.bloque) g.bloque = m.bloque;
    if (g.fecha == null && m.fecha != null) g.fecha = m.fecha;
    porHash.set(m.hash, g);
  }
  const out = [];
  for (const g of porHash.values()) {
    const ordenados = [...g.movimientos].sort((x, y) => (y.prioridad - x.prioridad) || (x.indice - y.indice));
    const principal = ordenados[0];
    const detalle = [];
    for (const m of ordenados) for (const d of m.detalle) if (!detalle.includes(d)) detalle.push(d);
    out.push({
      hash: g.hash,
      bloque: g.bloque,
      fecha: g.fecha ?? null,
      titulo: principal.titulo,
      detalle,
      oro: ordenados.reduce((acc, m) => acc + sumarSiNoDuplica(m, ordenados, "oro"), 0n),
      eth: ordenados.reduce((acc, m) => acc + sumarSiNoDuplica(m, ordenados, "eth"), 0n),
      movimientos: ordenados,
    });
  }
  return out.sort((a, b) => (b.bloque - a.bloque) || (b.fecha ?? 0) - (a.fecha ?? 0));
}

/**
 * El mismo dinero aparece dos veces en una transacción: `Mercado.ItemVendido` dice «+300 ORO»
 * y el `oro.Transfer` que lo acuñó dice lo mismo. Para que el neto no salga doblado, cuando hay
 * un evento de juego en la transacción se ignoran los Transfer de token al sumar.
 */
function sumarSiNoDuplica(m, todos, campo) {
  const esMecanico = m.prioridad <= P.nftMint;
  const hayEventoDeJuego = todos.some((x) => x.prioridad > P.nftMint);
  if (esMecanico && hayEventoDeJuego) return 0n;
  return m[campo] ?? 0n;
}

/** Fecha legible en español, o "—" si el RPC no dio el bloque. */
export function fechaTexto(ts) {
  if (ts == null) return "—";
  const d = new Date(Number(ts) * 1000);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
}

/** Nombre de la rareza de un objeto (0..2). */
export const rarezaTexto = (r) => RAREZAS[Number(r)] ?? `rareza ${Number(r)}`;

/**
 * Qué eventos hay que barrer para el historial de `cuenta`, con sus tópicos ya puestos.
 * Se devuelve como datos (no se llama al RPC aquí) para poder probarlo.
 * @param {string} cuenta
 * @param {(d:string)=>string} topico  normalmente `topicoDireccion`
 * @returns {{contrato:string, evento:string, filtros:(string|null)[]}[]}
 */
export function peticionesHistorial(cuenta, topico) {
  const t = topico(cuenta);
  return [
    // Eventos de juego: el jugador va en el primer tópico indexado.
    { contrato: "mercado", evento: "ItemVendido", filtros: [t] },
    { contrato: "mercado", evento: "CosmeticoComprado", filtros: [t] },
    { contrato: "mercado", evento: "CofreAbierto", filtros: [t] },
    { contrato: "mercado", evento: "BienvenidaReclamada", filtros: [t] },
    { contrato: "mercado", evento: "PremioAcunado", filtros: [t] },
    { contrato: "recompensas", evento: "DiarioReclamado", filtros: [t] },
    { contrato: "recompensas", evento: "Recompensado", filtros: [t] },
    // Tokens: hay que preguntar dos veces, una por «de mí» y otra por «hacia mí»,
    // porque `getLogs` no sabe hacer un OR entre posiciones distintas de tópico.
    { contrato: "gameItem", evento: "Transfer", filtros: [t, null] },
    { contrato: "gameItem", evento: "Transfer", filtros: [null, t] },
    { contrato: "oro", evento: "Transfer", filtros: [t, null] },
    { contrato: "oro", evento: "Transfer", filtros: [null, t] },
    { contrato: "cosmeticos", evento: "TransferSingle", filtros: [null, t, null] },
    { contrato: "cosmeticos", evento: "TransferSingle", filtros: [null, null, t] },
    // MercadoP2P: existe solo si está desplegado; `barrer` devuelve vacío si no.
    { contrato: "mercadoP2P", evento: "Vendido", filtros: [null, t] },
    { contrato: "mercadoP2P", evento: "Vendido", filtros: [null, null, t] },
    { contrato: "mercadoP2P", evento: "Listado", filtros: [null, t] },
    { contrato: "mercadoP2P", evento: "Cancelado", filtros: [null, t] },
  ];
}
