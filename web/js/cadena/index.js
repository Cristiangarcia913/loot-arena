// Sección «Cadena» de Loot Arena (PLAN-MAESTRO.md §7, fases E1, E2 y E3).
//
// Contrato con main.js (una sola puerta de entrada):
//   import { montarCadena, refrescarCadena } from "./cadena/index.js";
//   await montarCadena(document.querySelector("#cadena"), ctx);
//
// `ctx` trae funciones, no valores, porque el estado del juego cambia mientras la sección
// está montada: { cfg, ethers(), provider(), cuenta(), contrato(), redCorrecta, toast, local() }.
//
// Dos decisiones que conviene conocer:
//  1. **Las lecturas van siempre por el RPC público**, aunque haya MetaMask. Así la sección
//     funciona igual con cartera y sin ella (requisito de la fase E), no depende de que la
//     cartera esté en la red correcta y no gasta el cupo del proveedor de MetaMask.
//     La cartera solo se usa para *firmar* la retirada de la caja.
//  2. Si la red elegida no tiene contratos (`cfg.desplegada === false`), no se finge nada:
//     se dice qué falta y se ofrece el grifo de esa red y la vuelta a una red con contratos.

import { cargarEthers } from "../wallet.js";
import { h } from "../dom-secciones.js";
import { aBigInt, direccionValida, formatearEth, mensajeErrorEconomia } from "../economy.js";
import {
  CONTRATOS, crearContratos, crearLector, crearProveedorPublico, ordenar, sinRepetidos, topicoDireccion,
} from "./lectura.js";
import { agruparPorTx, interpretarTodos, peticionesHistorial } from "./eventos.js";
import {
  cargarDespliegues, compararConLocal, leerCartera, leerRivales, leerTesoreria, puedeRetirar, rivalesDe,
} from "./datos.js";
import { comparar, decodificarRecibo, leerRecibo, preverVenta } from "./desglose.js";
import * as V from "./vista.js";

/** Gas típico de `venderItem`, medido en local (contracts/README.md). Solo para estimar sin cartera. */
const GAS_TIPICO_VENTA = 170_000n;
const GAS_TIPICO_COMPRA = 81_000n;

/** Estado del módulo. Vive mientras viva la página; se vacía al cambiar de red o de cuenta. */
const S = {
  contenedor: null,
  ctx: null,
  lector: null,
  direcciones: {},
  abis: {},
  pestanas: null,
  actual: "cartera",
  objetivo: null,      // dirección que se está explorando
  cache: new Map(),    // id de pestaña → nodo ya pintado
  clave: "",           // red|cuenta: si cambia, se tira todo
  historialCompleto: false, // el jugador pidió intentar todo el historial pese al límite del RPC
  owner: null,         // Mercado.owner(), para poner nombre a las direcciones
  operador: null,      // Recompensas.operador(), ídem
  // tokenId → desglose anunciado antes de firmar. Si luego se comprueba el recibo de esa
  // venta, se puede enseñar lo prometido al lado de lo ocurrido (fase E2).
  previsiones: new Map(),
};

/** Punto de entrada. Lanza con un mensaje legible si no se puede ni empezar. */
export async function montarCadena(contenedor, ctx) {
  if (!contenedor) throw new Error("No hay contenedor donde montar la sección Cadena.");
  S.contenedor = contenedor;
  S.ctx = ctx;
  contenedor.replaceChildren(V.cargando("Preparando la lectura de la cadena…"));

  const cfg = ctx?.cfg;
  if (!cfg?.net) throw new Error("No hay configuración de red cargada.");

  // Red sin contratos: se explica, no se finge.
  if (!cfg.desplegada) {
    contenedor.replaceChildren(panelSinDespliegue(cfg));
    return;
  }

  const ethers = ctx.ethers?.() ?? (await cargarEthers());
  if (!ethers) throw new Error("No se pudo cargar ethers.js desde el CDN.");

  const { direcciones, bloqueDespliegue } = await cargarDespliegues(cfg.red);
  if (!direcciones.gameItem) direcciones.gameItem = cfg.address;
  S.direcciones = direcciones;
  S.abis = await cargarAbisCadena(cfg);

  const provider = crearProveedorPublico(ethers, cfg.net);
  const contratos = crearContratos({ ethers, provider, direcciones, abis: S.abis });
  S.lector = crearLector({ provider, contratos, bloqueDespliegue });

  // Dos lecturas baratas que sirven para toda la sección: con ellas los textos pueden decir
  // «el dueño de los contratos» o «la cartera del servidor» en vez de un hexadecimal suelto.
  await cachearMandos();

  S.objetivo = ctx.cuenta?.() ?? null;
  S.clave = `${cfg.red}|${S.objetivo ?? ""}`;
  pintarArmazon();
  await mostrar(S.actual, { forzar: true });
}

async function cachearMandos() {
  const { mercado, recompensas } = S.lector.contratos ?? {};
  const [owner, operador] = await Promise.all([
    mercado ? mercado.owner().catch(() => null) : null,
    recompensas ? recompensas.operador().catch(() => null) : null,
  ]);
  S.owner = owner;
  S.operador = operador;
}

/** Vuelve a leer la pestaña abierta. main.js la llama al reentrar en la sección. */
export async function refrescarCadena() {
  if (!S.contenedor || !S.lector) return;
  const cuenta = S.ctx?.cuenta?.() ?? null;
  const clave = `${S.ctx?.cfg?.red}|${cuenta ?? ""}`;
  if (clave !== S.clave) {
    // Cambió la cuenta o la red: lo anterior ya no vale.
    S.clave = clave;
    S.objetivo = cuenta;
    S.cache.clear();
    S.lector.olvidar();
    pintarArmazon();
  }
  await mostrar(S.actual, { forzar: true });
}

// ───────────────────────── armazón ─────────────────────────

const DEFS = Object.freeze([
  { id: "cartera", titulo: "Tu cartera" },
  { id: "transacciones", titulo: "Tus transacciones" },
  { id: "jugadores", titulo: "Los demás jugadores" },
  { id: "dinero", titulo: "Quién se lleva el dinero" },
  { id: "tesoreria", titulo: "Tesorería" },
]);

function pintarArmazon() {
  const cfg = S.ctx.cfg;
  S.pestanas = V.pestanas(DEFS, { onCambio: (id) => { S.actual = id; mostrar(id); } });

  const boton = h("button", { class: "btn btn-small btn-ghost", type: "button", onclick: () => refrescarCadena() }, "↻ Volver a leer");
  const cabecera = h("div", { class: "cad-barra" },
    h("div", { class: "cad-barra-info" },
      h("span", { class: "cad-chip" }, cfg.net.chainName),
      h("span", { class: "cad-chip cad-chip-tenue" }, `chainId ${cfg.chainId}`),
      h("span", { class: "cad-chip cad-chip-tenue" }, "lectura por RPC público")),
    h("div", { class: "cad-barra-acciones" }, buscadorDireccion(), boton));

  S.contenedor.replaceChildren(cabecera, S.pestanas.nodo);
  S.pestanas.mostrar(S.actual);
}

/** Permite explorar cualquier dirección: es lo que hace útil la sección sin MetaMask. */
function buscadorDireccion() {
  const campo = h("input", {
    class: "cad-input cad-input-dir", type: "text", spellcheck: "false",
    placeholder: S.objetivo ?? "0x… explorar una dirección",
    "aria-label": "Dirección a explorar",
    value: S.objetivo ?? "",
  });
  return h("form", {
    class: "cad-buscador",
    onsubmit: (ev) => {
      ev.preventDefault();
      const d = campo.value.trim();
      if (!direccionValida(d)) {
        S.ctx.toast?.("Eso no parece una dirección (0x y 40 caracteres).", "error");
        return;
      }
      S.objetivo = d;
      S.cache.delete("cartera");
      S.cache.delete("transacciones");
      S.cache.delete("dinero");
      mostrar(S.actual === "tesoreria" ? S.actual : S.actual, { forzar: true });
      S.ctx.toast?.(`Explorando ${d.slice(0, 10)}…`, "info");
    },
  }, campo, h("button", { class: "btn btn-small", type: "submit" }, "Explorar"));
}

async function mostrar(id, { forzar = false } = {}) {
  const panel = S.pestanas?.paneles.get(id);
  if (!panel) return;
  if (!forzar && S.cache.has(id)) { panel.replaceChildren(S.cache.get(id)); return; }
  panel.replaceChildren(V.cargando());
  try {
    const nodo = await construir(id);
    S.cache.set(id, nodo);
    if (S.actual === id) panel.replaceChildren(nodo);
  } catch (e) {
    console.warn("[cadena]", id, e);
    panel.replaceChildren(
      V.aviso(`No se pudo leer esta pestaña: ${mensajeErrorEconomia(e).texto}`, "aviso"),
      h("button", { class: "btn btn-small", type: "button", onclick: () => mostrar(id, { forzar: true }) }, "Reintentar"));
  }
}

function construir(id) {
  switch (id) {
    case "cartera": return panelCartera();
    case "transacciones": return panelTransacciones();
    case "jugadores": return panelJugadores();
    case "dinero": return panelDinero();
    case "tesoreria": return panelTesoreria();
    default: return Promise.resolve(h("div"));
  }
}

// ───────────────────────── E1.1 ─────────────────────────

async function panelCartera() {
  const cfg = S.ctx.cfg;
  const cuenta = S.ctx.cuenta?.() ?? null;
  const objetivo = S.objetivo ?? cuenta;
  if (!objetivo) {
    return h("div", { class: "cad-bloque" },
      V.titulo("Tu cartera en la cadena"),
      V.aviso("No hay cartera conectada. Conecta MetaMask, o escribe arriba cualquier dirección para explorarla: todo lo que se muestra es público.", "info"));
  }
  const cartera = await leerCartera(S.lector, objetivo);
  cartera.contratoObjetos = S.direcciones.gameItem;
  // La comparación con el estado local solo tiene sentido sobre la cuenta propia.
  const local = cuenta && objetivo.toLowerCase() === cuenta.toLowerCase() ? S.ctx.local?.() : null;
  const comparacion = local ? compararConLocal(cartera, local) : null;
  return V.pintarCartera(cartera, {
    net: cfg.net, red: cfg.red, chainId: cfg.chainId, comparacion,
    conectada: !!cuenta && objetivo.toLowerCase() === cuenta.toLowerCase(),
  });
}

// ───────────────────────── E1.2 ─────────────────────────

async function panelTransacciones() {
  const cfg = S.ctx.cfg;
  const objetivo = S.objetivo ?? S.ctx.cuenta?.() ?? null;
  if (!objetivo) {
    return h("div", { class: "cad-bloque" },
      V.titulo("Tus transacciones en el juego"),
      V.aviso("Conecta la cartera o escribe una dirección arriba para ver su historial en nuestros contratos.", "info"));
  }
  const alto = await S.lector.bloqueActual();
  // `todo` solo se pone a true si el jugador pulsa «intentarlo igualmente»: por defecto no se
  // le pide al RPC público lo que ya sabemos que no guarda (ver la cabecera de lectura.js).
  const { sucesos, recortado, fallos, limitadoPorRpc, desdeDisponible, completo } =
    await S.lector.barrerVarios(peticionesHistorial(objetivo, topicoDireccion), { todo: S.historialCompleto });
  const conFecha = await S.lector.conFechas(sinRepetidos(ordenar(sucesos)));
  const ctxTexto = contextoTexto(objetivo);
  const txs = agruparPorTx(interpretarTodos(conFecha, ctxTexto));

  const nodo = V.pintarTransacciones(txs, {
    net: cfg.net, recortado, fallos, limitadoPorRpc, desdeDisponible, completo,
    bloqueDespliegue: S.lector.bloqueDespliegue, bloqueActual: alto,
    onCargarTodo: S.historialCompleto ? null : () => {
      S.historialCompleto = true;
      S.ctx.toast?.("Pidiendo todo el historial al RPC público; puede tardar o quedarse corto.", "info");
      mostrar("transacciones", { forzar: true });
    },
  });
  // Cada fila puede comprobarse contra su recibo real: es la verificación de la fase E2.
  for (const [i, li] of [...nodo.querySelectorAll(".cad-tx")].entries()) {
    const tx = txs[i];
    if (!tx) continue;
    const salida = h("div", { class: "cad-verificacion" });
    li.append(h("button", {
      class: "btn btn-small btn-ghost", type: "button",
      onclick: async (ev) => {
        ev.currentTarget.disabled = true;
        salida.replaceChildren(V.cargando("Leyendo el recibo real…"));
        try {
          salida.replaceChildren(await verificarTx(tx.hash, objetivo));
        } catch (e) {
          salida.replaceChildren(V.aviso(`No se pudo leer el recibo: ${e?.message ?? e}`, "aviso"));
        } finally {
          ev.currentTarget.disabled = false;
        }
      },
    }, "Comprobar el recibo"), salida);
  }
  return nodo;
}

/**
 * Lee el recibo de una transacción y pinta lo que movió de verdad. Si esa transacción resulta
 * ser la venta de un objeto que se simuló antes en la pestaña «Quién se lleva el dinero», se
 * enseña lo anunciado al lado de lo ocurrido: eso es la verificación de la fase E2.
 */
async function verificarTx(hash, yo) {
  const recibo = await S.lector.provider.getTransactionReceipt(hash);
  if (!recibo) throw new Error("El RPC no encontró esa transacción (¿red equivocada, o aún sin minar?).");
  const sucesos = decodificarRecibo(recibo, S.lector.contratos);
  const real = leerRecibo({
    sucesos,
    gasUsado: recibo.gasUsed ?? null,
    precioGas: recibo.gasPrice ?? recibo.effectiveGasPrice ?? null,
    pagador: recibo.from ?? yo,
    ctx: contextoTexto(yo),
    titulo: "Lo que movió de verdad esta transacción",
  });
  const venta = sucesos.find((s) => s.contrato === "mercado" && s.nombre === "ItemVendido");
  const previsto = venta ? S.previsiones.get(Number(venta.args?.tokenId)) : null;
  const comparacion = previsto ? comparar(previsto, real) : null;
  const nodo = V.pintarDesglose(real, { net: S.ctx.cfg.net, comparacion, compacto: true });
  if (venta && !previsto) {
    nodo.append(V.aviso("Para ver lo anunciado al lado de lo ocurrido, simula primero esa venta en «Quién se lleva el dinero» y vuelve aquí después de firmarla.", "info"));
  }
  return nodo;
}

// ───────────────────────── E1.3 ─────────────────────────

async function panelJugadores() {
  const cfg = S.ctx.cfg;
  const [ranking, listadosP2P] = await Promise.all([rankingDelServidor(cfg), listadosDelP2P()]);
  const yo = (S.ctx.cuenta?.() ?? "").toLowerCase();
  const fuentes = rivalesDe({ ranking, listadosP2P }).filter((r) => r.direccion.toLowerCase() !== yo);
  if (!fuentes.length) return V.pintarRivales([], { net: cfg.net, sinFuentes: true });
  const rivales = await leerRivales(S.lector, fuentes.slice(0, 12));
  return V.pintarRivales(rivales, { net: cfg.net, sinFuentes: false });
}

async function rankingDelServidor(cfg) {
  if (!cfg.serverUrl) return [];
  try {
    const res = await fetch(`${cfg.serverUrl}/ranking`, { cache: "no-cache" });
    if (!res.ok) return [];
    const b = await res.json();
    return Array.isArray(b) ? b : (b?.ranking ?? b?.jugadores ?? []);
  } catch { return []; }
}

async function listadosDelP2P() {
  const p2p = S.lector.contratos?.mercadoP2P;
  if (!p2p) return [];
  try {
    const lista = await p2p.listados(0, 20);
    return [...lista].map((o) => ({ vendedor: o.vendedor ?? o[1] }));
  } catch { return []; }
}

// ───────────────────────── E2 ─────────────────────────

async function panelDinero() {
  const cfg = S.ctx.cfg;
  const caja = h("div", { class: "cad-bloque" });
  caja.append(V.titulo("Quién se lleva el dinero",
    "Antes de firmar, el desglose con las cifras que da el contrato. Después, el recibo real decodificado. Si no coincidieran, aquí se vería."));

  const objetivo = S.objetivo ?? S.ctx.cuenta?.() ?? null;
  const salidaPrevia = h("div", { class: "cad-salida" });
  const salidaRecibo = h("div", { class: "cad-salida" });

  // --- 1. Simulador: qué movería vender uno de tus objetos
  caja.append(h("h4", { class: "cad-subtitulo" }, "Antes de firmar"));
  if (!objetivo) {
    caja.append(V.aviso("Conecta la cartera o escribe una dirección arriba para simular sus ventas.", "info"));
  } else {
    const cartera = await leerCartera(S.lector, objetivo, { max: 12 });
    if (!cartera.objetos.length) {
      caja.append(V.aviso("Esta dirección no tiene objetos que vender. Igualmente puedes comprobar cualquier transacción más abajo.", "info"));
    } else {
      const select = h("select", { class: "cad-input" },
        cartera.objetos.map((o) => h("option", { value: String(o.tokenId) }, `#${o.tokenId} · ${o.nombre} (${o.rarezaTexto})`)));
      const calcular = async () => {
        salidaPrevia.replaceChildren(V.cargando("Preguntando al contrato…"));
        try {
          const id = Number(select.value);
          const obj = cartera.objetos.find((o) => o.tokenId === id);
          const d = await preverVentaReal(objetivo, obj);
          S.previsiones.set(id, d); // para poder compararlo luego con el recibo real
          salidaPrevia.replaceChildren(V.pintarDesglose(d, { net: cfg.net }));
        } catch (e) {
          salidaPrevia.replaceChildren(V.aviso(`No se pudo calcular: ${mensajeErrorEconomia(e).texto}`, "aviso"));
        }
      };
      caja.append(h("div", { class: "cad-fila-controles" },
        h("label", { class: "cad-label" }, "Simular la venta de", select),
        h("button", { class: "btn btn-small", type: "button", onclick: calcular }, "Ver el desglose")),
        salidaPrevia);
      await calcular();
    }
  }

  // --- 2. Comprobar cualquier transacción
  caja.append(h("h4", { class: "cad-subtitulo" }, "Después de firmar: el recibo real"));
  caja.append(h("p", { class: "cad-parrafo" },
    "Pega el hash de cualquier transacción (tuya o no) y se leen sus eventos de la cadena para enseñar el movimiento que de verdad ocurrió, dirección por dirección."));
  const campo = h("input", { class: "cad-input cad-input-dir", type: "text", spellcheck: "false", placeholder: "0x… hash de la transacción", "aria-label": "Hash de la transacción" });
  caja.append(h("form", {
    class: "cad-fila-controles",
    onsubmit: async (ev) => {
      ev.preventDefault();
      const hash = campo.value.trim();
      if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
        salidaRecibo.replaceChildren(V.aviso("Un hash de transacción son 0x y 64 caracteres.", "aviso"));
        return;
      }
      salidaRecibo.replaceChildren(V.cargando("Leyendo el recibo…"));
      try {
        salidaRecibo.replaceChildren(await verificarTx(hash, objetivo));
      } catch (e) {
        salidaRecibo.replaceChildren(V.aviso(`No se pudo leer: ${e?.message ?? e}`, "aviso"));
      }
    },
  }, h("label", { class: "cad-label" }, "Hash", campo), h("button", { class: "btn btn-small", type: "submit" }, "Comprobar")),
    salidaRecibo);

  caja.append(h("p", { class: "cad-parrafo cad-mini" },
    "Las cantidades salen de las vistas del contrato (precioVenta, ethPorVenta, la comisión) y de los eventos del recibo, nunca de números copiados en la web. El gas se calcula con el precio de gas que diga la red en ese momento."));
  return caja;
}

/** Desglose previo de una venta, con las cifras pedidas al contrato. */
async function preverVentaReal(cuenta, obj) {
  const { mercado } = S.lector.contratos;
  if (!mercado) throw new Error("No hay contrato Mercado en esta red.");
  const [precioOro, ethPrevisto, cajaEth, restanteHoy, gas] = await Promise.all([
    mercado.precioVenta(obj.tokenId).then(aBigInt),
    mercado.ethPorVenta(cuenta, obj.rareza).then(aBigInt).catch(() => 0n),
    mercado.cajaEth().then(aBigInt).catch(() => null),
    mercado.ethRestanteHoy(cuenta).then(aBigInt).catch(() => null),
    estimarGas(GAS_TIPICO_VENTA),
  ]);
  return preverVenta({
    tokenId: obj.tokenId, precioOro, ethPrevisto, gas, cajaEth, restanteHoy,
    ctx: contextoTexto(cuenta),
  });
}

/** Gas en wei: precio de gas real de la red × el gas típico medido de esa operación. */
async function estimarGas(unidades) {
  try {
    const f = await S.lector.provider.getFeeData();
    const precio = f?.maxFeePerGas ?? f?.gasPrice ?? null;
    return precio ? BigInt(precio) * BigInt(unidades) : null;
  } catch { return null; }
}

// ───────────────────────── E3 ─────────────────────────

async function panelTesoreria() {
  const cfg = S.ctx.cfg;
  const t = await leerTesoreria(S.lector, { serverUrl: cfg.serverUrl, red: cfg.red });
  const cuenta = S.ctx.cuenta?.() ?? null;
  const permiso = puedeRetirar(t, cuenta);
  return V.pintarTesoreria(t, {
    net: cfg.net, cuenta, permiso,
    onRetirar: (eth) => retirar(eth, t),
  });
}

/** Firma `Mercado.retirarEth(cantidad)` con la cartera. Solo llega aquí el dueño. */
async function retirar(ethTexto, t) {
  const ethers = S.ctx.ethers?.() ?? (await cargarEthers());
  const provider = S.ctx.provider?.();
  if (!provider) throw new Error("Necesitas MetaMask conectado para firmar la retirada.");
  if (S.ctx.redCorrecta && !S.ctx.redCorrecta()) {
    throw new Error(`Tu cartera no está en ${S.ctx.cfg.net.chainName}. Cámbiala y vuelve a intentarlo.`);
  }
  const wei = ethers.parseEther(ethTexto);
  if (t.cajaEth != null && wei > t.cajaEth) {
    throw new Error(`En la caja solo hay ${formatearEth(t.cajaEth, { decimales: 6 })} ETH.`);
  }
  const signer = await provider.getSigner();
  const mercado = new ethers.Contract(S.direcciones.mercado, S.abis.mercado, signer);
  try {
    const tx = await mercado.retirarEth(wei);
    S.ctx.toast?.("Retirada enviada, esperando al bloque…", "info");
    await tx.wait();
    S.cache.delete("tesoreria");
    await mostrar("tesoreria", { forzar: true });
    S.ctx.toast?.("Retirada confirmada.", "ok");
    return { mensaje: `Hecho. Transacción ${tx.hash.slice(0, 10)}…` };
  } catch (e) {
    const m = mensajeErrorEconomia(e);
    throw new Error(m.texto);
  }
}

// ───────────────────────── red sin contratos ─────────────────────────

function panelSinDespliegue(cfg) {
  const caja = h("div", { class: "cad-bloque" });
  caja.append(V.titulo(`En ${cfg.net.chainName} no hay contratos de Loot Arena`,
    "El juego conoce más redes de las que tienen los contratos puestos. Esto no es un fallo: es que ahí todavía no se ha desplegado nada."));
  caja.append(h("p", { class: "cad-parrafo" },
    "No se puede mostrar ni tu cartera del juego, ni el historial, ni la tesorería, porque en esta red esos contratos no existen. ",
    "Para verlo todo, vuelve a una red donde sí estén desplegados."));
  if (cfg.redesDesplegadas?.length) {
    caja.append(h("p", { class: "cad-parrafo" }, "Redes con contratos: ",
      h("strong", {}, cfg.redesDesplegadas.join(", ")),
      ". Cámbiala en el selector de red de la cabecera."));
  }
  if (cfg.net.grifo) {
    caja.append(h("p", { class: "cad-parrafo" },
      "Si vas a usar esta red igualmente, su gas de prueba gratis está en ",
      h("a", { class: "cad-enlace", href: cfg.net.grifo, target: "_blank", rel: "noopener noreferrer" }, "el grifo de " + cfg.net.chainName), "."));
  }
  caja.append(V.aviso("Lo único que se puede leer aquí sin contratos es el saldo de ETH de una dirección, y para eso ya está el explorador público de la red.", "info"));
  return caja;
}

// ───────────────────────── API para el resto del juego ─────────────────────────
//
// La fase E2 pide el desglose «antes de firmar», y el sitio natural para enseñarlo es la
// tienda, que no es nuestra. Estas dos funciones están aquí para que `tienda.js` las use sin
// duplicar nada: la sección Cadena tiene que estar montada antes (es la que crea el lector).

/**
 * Desglose de una venta antes de firmarla, con las cifras pedidas al contrato.
 * @param {string} cuenta @param {{tokenId:number, rareza:number}} obj
 * @returns {Promise<import("./desglose.js").Desglose>}
 */
export async function desgloseDeVenta(cuenta, obj) {
  if (!S.lector) throw new Error("La sección Cadena no está montada todavía.");
  const d = await preverVentaReal(cuenta, obj);
  S.previsiones.set(Number(obj.tokenId), d);
  return d;
}

/**
 * Lee el recibo real de una transacción ya firmada y, si se había anunciado un desglose para
 * ese objeto, devuelve también la comparación.
 * @param {string} hash @param {string} cuenta
 * @returns {Promise<{real:import("./desglose.js").Desglose, comparacion:object|null}>}
 */
export async function verificarRecibo(hash, cuenta) {
  if (!S.lector) throw new Error("La sección Cadena no está montada todavía.");
  const recibo = await S.lector.provider.getTransactionReceipt(hash);
  if (!recibo) throw new Error("El RPC no encontró esa transacción.");
  const sucesos = decodificarRecibo(recibo, S.lector.contratos);
  const real = leerRecibo({
    sucesos, gasUsado: recibo.gasUsed ?? null,
    precioGas: recibo.gasPrice ?? recibo.effectiveGasPrice ?? null,
    pagador: recibo.from ?? cuenta, ctx: contextoTexto(cuenta),
  });
  const venta = sucesos.find((s) => s.contrato === "mercado" && s.nombre === "ItemVendido");
  const previsto = venta ? S.previsiones.get(Number(venta.args?.tokenId)) : null;
  return { real, comparacion: previsto ? comparar(previsto, real) : null };
}

/** Pinta un desglose (para que la tienda pueda enseñarlo sin saber de nuestro DOM). */
export const pintarDesgloseEn = (d, opciones = {}) => V.pintarDesglose(d, { net: S.ctx?.cfg?.net, ...opciones });

// ───────────────────────── apoyo ─────────────────────────

/** Contexto que usan los textos para poner nombre a las direcciones conocidas. */
function contextoTexto(yo) {
  return { yo, direcciones: S.direcciones, owner: S.owner, operador: S.operador };
}

/**
 * ABI de los cinco contratos. Se leen de `config/*.abi.json` (copiados de /shared con
 * sync-config.mjs). El que falte deja su contrato a null y su parte se degrada sola.
 */
async function cargarAbisCadena(cfg) {
  const archivos = {
    gameItem: "GameItem.abi.json", oro: "LootGold.abi.json", cosmeticos: "LootCosmetics.abi.json",
    mercado: "Mercado.abi.json", recompensas: "Recompensas.abi.json", mercadoP2P: "MercadoP2P.abi.json",
  };
  const leer = async (nombre) => {
    for (const ruta of [`../../config/${nombre}`, `../../../shared/${nombre}`]) {
      try {
        const res = await fetch(new URL(ruta, import.meta.url), { cache: "no-cache" });
        if (res.ok) { const j = await res.json(); const abi = Array.isArray(j) ? j : j?.abi; if (Array.isArray(abi)) return abi; }
      } catch { /* siguiente */ }
    }
    return null;
  };
  const pares = await Promise.all(CONTRATOS.map(async (k) => [k, await leer(archivos[k])]));
  const out = Object.fromEntries(pares);
  // El ABI de GameItem ya viene cargado en cfg: si el fetch falló, se usa ese.
  if (!out.gameItem && Array.isArray(cfg.abi)) out.gameItem = cfg.abi;
  return out;
}
