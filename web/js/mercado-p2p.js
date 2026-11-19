// Mercado P2P de Loot Arena: la tercera pestaña del Mercado, «Otros jugadores». Aquí el precio
// lo pone cada vendedor (contracts/contracts/MercadoP2P.sol), a diferencia de la tienda del
// Herrero (Mercado.sol), que es precio fijo por stats. Solo tiene sentido con wallet conectada:
// sin cuenta no hay con quién comerciar, así que en modo demo se explica y no se monta.
//
// Uso desde main.js:
//   import * as P2P from "./mercado-p2p.js";
//   await P2P.montarMercadoP2P({ provider, signer, cuenta, cfg, ethers, inventario, getEquipados, raiz: {panel} });
//   P2P.actualizarInventarioP2P(items);  // cada vez que se relee el inventario
//   P2P.desmontarMercadoP2P();
//
// Todo el texto entra con textContent (los nombres de objetos vienen de la cadena).
import { h } from "./dom-secciones.js";
import {
  aUnidades, abiDe, cargarAbiMercadoP2P, formatearOro, mensajeErrorTransaccion, resolverDirecciones,
  unirAbi, ABI_GAMEITEM_APROBACION,
} from "./economy.js";
import { conMargenGas, esFalloDeRed, gasRespaldo, tarifasAcotadas, TIMEOUT_TX_MS } from "./wallet-errores.js";
import { rareza, emojiTipo, normalizarItem } from "./equipment.js";

/** Dirección corta para mostrar a un vendedor (igual criterio que ui.js `acortar`, sin importar DOM). */
const acortarDir = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
/** Espada → ataque; Escudo/Casco/Armadura/Botas → defensa (igual que botin-local.js `TIPOS`). */
const statPrincipal = (tipo) => (tipo === "Espada" ? "ataque" : "defensa");
/** Por si `cfg.abi` no trajera `getItem` (no debería faltar: lo usa chain.js para el inventario). */
const ABI_GAMEITEM_LECTURA = Object.freeze([
  "function getItem(uint256 tokenId) view returns (tuple(string nombre, string tipo, uint8 rareza, uint16 ataque, uint16 defensa))",
]);

// ───────────────────────── Estado ─────────────────────────

let generacion = 0;
/** @type {any} */
let S = null;
const activo = () => !!S && S.modo === "chain";

function contenedor(id, crear, raiz) {
  let el = raiz?.panel ?? document.getElementById(id);
  if (!el && crear) {
    el = h(crear.tag ?? "div", { id, class: crear.clase ?? "" });
    (document.querySelector("main") ?? document.body).append(el);
    S.creado = el;
  }
  return el;
}

/**
 * Monta el Mercado P2P. Es idempotente (desmonta lo anterior antes de montar).
 * @param {object} o
 * @param {any} [o.provider] ethers.BrowserProvider (null/undefined → sin wallet: solo se explica)
 * @param {any} [o.signer]
 * @param {string|null} [o.cuenta]
 * @param {object} o.cfg  resultado de cargarConfig()
 * @param {any} [o.ethers]
 * @param {Array<object>} [o.inventario] inventario normalizado del jugador (tokenId, nombre, tipo, rareza, ataque, defensa)
 * @param {() => Array<object>} [o.getEquipados] objetos equipados ahora mismo, para comparar stats
 * @param {{panel?:HTMLElement}} [o.raiz]
 * @returns {Promise<{modo:string}>}
 */
export async function montarMercadoP2P(o = {}) {
  desmontarMercadoP2P();
  const gen = ++generacion;
  S = {
    gen, o, modo: "cargando", eco: null, cuenta: o.cuenta ?? null,
    panel: o.raiz?.panel ?? contenedor("merc-p2p", null, o.raiz),
    inventario: [...(o.inventario ?? [])],
    ofertas: [], misOfertas: [], totales: null,
    ocupado: false, pagina: 0, PAGINA: 24,
  };
  renderCargando();

  let modo;
  try {
    const dirs = await resolverDirecciones(o.cfg);
    if (!dirs?.mercadoP2P) modo = "no-desplegada";
    else if (!o.provider || !o.cuenta) modo = "demo";
    else {
      const ethers = o.ethers ?? (await import("./wallet.js")).cargarEthers().then((x) => x);
      const [eth, abiP2P] = await Promise.all([ethers, cargarAbiMercadoP2P()]);
      const signer = o.signer ?? (await o.provider.getSigner());
      S.eco = crearEconomiaP2P({
        ethers: eth, provider: o.provider, signer, cuenta: o.cuenta,
        direccionMercadoP2P: dirs.mercadoP2P, direccionGameItem: o.cfg?.address, direccionOro: dirs.oro,
        abiMercadoP2P: abiP2P.abi, abiGameItem: unirAbi(abiDe(o.cfg?.abi), [...ABI_GAMEITEM_APROBACION, ...ABI_GAMEITEM_LECTURA]),
      });
      modo = "chain";
    }
  } catch (e) {
    console.warn("[mercado-p2p] no se pudo preparar la economía:", e);
    modo = "error";
    S.error = mensajeErrorTransaccion(e).texto;
  }
  if (gen !== generacion) return { modo: "desmontada" };
  S.modo = modo;
  if (modo === "chain") await refrescarMercadoP2P();
  else renderTodo();
  return { modo };
}

export function desmontarMercadoP2P() {
  generacion++;
  if (!S) return;
  S.panel?.replaceChildren();
  S.creado?.remove();
  S = null;
}

/** Informa al Mercado P2P del inventario actual (tras leerlo de la cadena). */
export function actualizarInventarioP2P(items) {
  if (!S) return;
  S.inventario = [...(items ?? [])];
  if (activo()) renderTodo();
}

export const modoMercadoP2P = () => S?.modo ?? null;

/** Vuelve a leer ofertas y anuncios propios (p. ej. al entrar en la pestaña tras un rato fuera). */
export async function refrescarMercadoP2P() {
  if (!activo()) { renderTodo(); return; }
  const gen = S.gen;
  try {
    const [total, misOfertas, totales] = await Promise.all([
      S.eco.totalListados(),
      S.eco.listadosDe(S.cuenta),
      S.eco.mercadoTotal().catch(() => null),
    ]);
    const cuantos = Math.min(total, S.PAGINA);
    const crudas = cuantos ? await S.eco.listados(0, cuantos) : [];
    const ajenas = crudas.filter((of) => of.vendedor.toLowerCase() !== S.cuenta.toLowerCase());
    // El detalle (nombre/tipo/ataque/defensa) no viene en la oferta: una llamada más por objeto.
    const ofertas = await Promise.all(ajenas.map(async (of) => ({ ...of, detalle: await S.eco.detalleItem(of.tokenId) })));
    if (gen !== generacion) return;
    S.ofertas = ofertas;
    S.misOfertas = misOfertas;
    S.totalListados = total;
    S.totales = totales;
  } catch (e) {
    console.warn("[mercado-p2p] no se pudo leer el mercado:", e);
  }
  if (gen === generacion) renderTodo();
}

// ───────────────────────── Economía (lectura y envío) ─────────────────────────

/** @returns {import("./economy.js").Economia & object} economía del Mercado P2P (ethers v6 + MetaMask). */
export function crearEconomiaP2P({ ethers, provider, signer, cuenta, direccionMercadoP2P, direccionGameItem, direccionOro, abiMercadoP2P, abiGameItem }) {
  const C = ethers.Contract;
  const mer = new C(direccionMercadoP2P, abiMercadoP2P, provider);
  const item = new C(direccionGameItem, abiGameItem, provider);
  const oroAbi = [
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 cantidad) returns (bool)",
  ];
  const oro = new C(direccionOro, oroAbi, provider);
  const conFirma = (k) => k.connect(signer);

  const enviar = async (contrato, fn, args, { objetos = 1 } = {}) => {
    const k = conFirma(contrato);
    let gasLimit;
    try { gasLimit = conMargenGas(await k[fn].estimateGas(...args)); }
    catch (e) { if (!esFalloDeRed(e)) throw e; gasLimit = gasRespaldo(objetos); }
    const bloque = await provider.getBlock("latest").catch(() => null);
    const fee = bloque?.baseFeePerGas != null
      ? tarifasAcotadas({ baseFeePerGas: bloque.baseFeePerGas })
      : tarifasAcotadas(await provider.getFeeData().catch(() => null));
    const tx = await k[fn](...args, { ...fee, gasLimit });
    return {
      hash: tx.hash,
      esperar: async () => {
        const r = await tx.wait(1, TIMEOUT_TX_MS);
        if (r && r.status === 0) throw Object.assign(new Error("La transacción falló"), { code: "CALL_EXCEPTION" });
        return r;
      },
    };
  };

  const normalizar = (o) => ({
    tokenId: Number(o.tokenId), vendedor: o.vendedor, rareza: Number(o.rareza),
    creado: Number(o.creado), precio: BigInt(o.precio),
  });

  return {
    modo: "chain",
    direcciones: { mercadoP2P: direccionMercadoP2P, gameItem: direccionGameItem, oro: direccionOro },
    comisionBps: async () => Number(await mer.comisionBps().catch(() => 500n)),
    totalListados: async () => Number(await mer.totalListados()),
    listados: async (desde, cuantos) => (await mer.listados(desde, cuantos)).map(normalizar),
    listadosDe: async (direccion) => (await mer.listadosDe(direccion)).map(normalizar),
    /** Nombre/tipo/ataque/defensa del NFT (la oferta solo trae rareza y precio). */
    detalleItem: async (tokenId) => { try { return normalizarItem(await item.getItem(tokenId), tokenId); } catch { return null; } },
    estaListado: async (tokenId) => !!(await mer.estaListado(tokenId)),
    mercadoTotal: async () => {
      const r = await mer.mercadoTotal();
      return { volumen: BigInt(r[0]), ventas: Number(r[1]), medio: BigInt(r[2]), quemado: BigInt(r[3]) };
    },
    aprobadoNFT: async () => !!(await item.isApprovedForAll(cuenta, direccionMercadoP2P)),
    aprobarNFT: () => enviar(item, "setApprovalForAll", [direccionMercadoP2P, true]),
    aprobacionOro: async () => BigInt(await oro.allowance(cuenta, direccionMercadoP2P)),
    aprobarOro: (precioMaximo) => enviar(oro, "approve", [direccionMercadoP2P, precioMaximo]),
    listar: (tokenId, precioOro) => enviar(mer, "listar", [tokenId, precioOro]),
    cambiarPrecio: (tokenId, nuevo) => enviar(mer, "cambiarPrecio", [tokenId, nuevo]),
    cancelar: (tokenId) => enviar(mer, "cancelar", [tokenId]),
    comprarHasta: (tokenId, precioMaximo) => enviar(mer, "comprarHasta", [tokenId, precioMaximo]),
  };
}

// ───────────────────────── Render ─────────────────────────

function renderCargando() {
  S.panel?.replaceChildren(h("p", { class: "merc-ayuda" }, "Abriendo el Mercado P2P…"));
}

function aviso(texto, tipo = "info") {
  const cont = document.querySelector(".toasts") ?? document.getElementById("toasts");
  if (!cont) return;
  const t = h("div", { class: `toast toast-${tipo}`, role: "status" }, texto);
  cont.append(t);
  setTimeout(() => { t.classList.add("salida"); setTimeout(() => t.remove(), 400); }, 6000);
}

function renderTodo() {
  const p = S?.panel;
  if (!p) return;
  if (S.modo === "no-desplegada") {
    p.replaceChildren(h("p", { class: "merc-vacio" },
      "El Mercado P2P todavía no está desplegado en esta red. Mientras tanto, usa «Vender» (al Herrero) y «Comprar» para cosméticos."));
    return;
  }
  if (S.modo === "demo") {
    p.replaceChildren(h("p", { class: "merc-vacio" }, "🦊 Conecta tu wallet para comerciar con otros jugadores: comprar y vender aquí es entre cuentas reales de la cadena."));
    return;
  }
  if (S.modo === "error") {
    p.replaceChildren(h("p", { class: "merc-vacio" }, `El Mercado P2P no está disponible ahora mismo (${S.error}).`));
    return;
  }
  p.replaceChildren(
    S.totales ? barraTotales(S.totales) : null,
    seccionListarAqui(),
    seccionMisAnuncios(),
    seccionOfertas(),
  );
}

function barraTotales(t) {
  return h("p", { class: "merc-ayuda" },
    t.ventas > 0
      ? `${t.ventas} venta(s) cerrada(s) entre jugadores · precio medio ${formatearOro(t.medio)} ORO · ${formatearOro(t.quemado)} ORO quemados en comisión.`
      : "Todavía no se ha cerrado ninguna venta entre jugadores en esta red.");
}

/** Objetos del inventario que se pueden listar: ni ya listados aquí ni equipados. */
function vendiblesAqui() {
  const listados = new Set(S.misOfertas.map((o) => String(o.tokenId)));
  return S.inventario.filter((it) => !it.local && !listados.has(String(it.tokenId)));
}

function seccionListarAqui() {
  const lista = vendiblesAqui();
  const cuerpo = !lista.length
    ? h("p", { class: "merc-vacio" }, "No tienes objetos libres para poner a la venta aquí (o ya los has listado todos).")
    : h("ul", { class: "merc-lista", role: "list" }, lista.map((it) => filaListar(it)));
  return h("section", { class: "merc-p2p-seccion" },
    h("h3", { class: "sub merc-sub" }, "Vende tu equipo aquí"),
    h("p", { class: "merc-ayuda" }, "Pones el precio tú. El Mercado P2P cobra una pequeña comisión en ORO (se quema) cuando se vende; mientras tanto el objeto queda en custodia del contrato."),
    cuerpo);
}

function filaListar(it) {
  const r = rareza(it.rareza);
  const campo = h("input", {
    type: "number", min: "1", step: "1", inputmode: "numeric", placeholder: "Precio en ORO",
    class: "merc-p2p-precio-campo", "aria-label": `Precio en ORO para ${it.nombre || it.tipo}`,
  });
  const boton = h("button", { type: "button", class: "btn btn-small btn-gold" }, "Poner a la venta");
  boton.addEventListener("click", () => {
    const precio = Math.floor(Number(campo.value));
    if (!(precio > 0)) { aviso("Pon un precio en ORO mayor que 0.", "info"); campo.focus(); return; }
    listarObjeto(it, precio);
  });
  return h("li", { class: "merc-fila", style: { "--rar": r.color } },
    h("span", { class: "merc-check" },
      h("span", { "aria-hidden": "true" }, emojiTipo(it.tipo)),
      h("span", { class: "merc-nombre" }, it.nombre || `${it.tipo} #${it.tokenId}`),
      h("span", { class: "merc-meta" }, `${it.tipo} · ${r.nombre} · ⚔️${it.ataque} 🛡️${it.defensa}`)),
    h("span", { class: "merc-p2p-listar" }, campo, boton));
}

function seccionMisAnuncios() {
  if (!S.misOfertas.length) return null;
  return h("section", { class: "merc-p2p-seccion" },
    h("h3", { class: "sub merc-sub" }, "Tus anuncios"),
    h("ul", { class: "merc-lista", role: "list" }, S.misOfertas.map((of) => filaPropia(of))));
}

function filaPropia(of) {
  const it = S.inventario.find((x) => String(x.tokenId) === String(of.tokenId));
  const r = rareza(of.rareza);
  const nombre = it?.nombre || `Objeto #${of.tokenId}`;
  const cancelar = h("button", { type: "button", class: "btn btn-small btn-ghost" }, "Cancelar");
  cancelar.addEventListener("click", () => cancelarOferta(of));
  return h("li", { class: "merc-fila", style: { "--rar": r.color } },
    h("span", { class: "merc-check" },
      it ? h("span", { "aria-hidden": "true" }, emojiTipo(it.tipo)) : null,
      h("span", { class: "merc-nombre" }, nombre),
      h("span", { class: "merc-meta" }, it ? `${it.tipo} · ⚔️${it.ataque} 🛡️${it.defensa}` : "A la venta")),
    h("span", { class: "merc-precio" }, `${formatearOro(of.precio)} ORO`),
    cancelar);
}

function seccionOfertas() {
  const equipados = typeof S.o.getEquipados === "function" ? (S.o.getEquipados() ?? []) : [];
  const porTipo = new Map(equipados.map((it) => [it.tipo, it]));
  if (!S.ofertas.length) {
    return h("section", { class: "merc-p2p-seccion" },
      h("h3", { class: "sub merc-sub" }, "Ofertas de otros jugadores"),
      h("p", { class: "merc-vacio" }, "Nadie tiene objetos a la venta ahora mismo. ¡Sé el primero!"));
  }
  return h("section", { class: "merc-p2p-seccion" },
    h("h3", { class: "sub merc-sub" }, `Ofertas de otros jugadores (${S.ofertas.length}${S.totalListados > S.ofertas.length ? ` de ${S.totalListados}` : ""})`),
    h("div", { class: "merc-catalogo merc-p2p-grid" }, S.ofertas.map((of) => cartaOferta(of, porTipo))));
}

/** Flecha verde/roja comparando el objeto listado con el que el jugador tiene equipado del mismo tipo. */
function comparador(detalle, equipado) {
  if (!detalle || !equipado) return null;
  const clave = statPrincipal(detalle.tipo);
  const dif = detalle[clave] - equipado[clave];
  if (dif === 0) return h("span", { class: "merc-p2p-cmp cmp-igual" }, `= ${clave === "ataque" ? "Ataque" : "Defensa"}`);
  const mejora = dif > 0;
  return h("span", { class: `merc-p2p-cmp ${mejora ? "cmp-mejor" : "cmp-peor"}` },
    `${mejora ? "▲" : "▼"} ${dif > 0 ? "+" : ""}${dif} ${clave === "ataque" ? "Ataque" : "Defensa"} vs. equipado`);
}

function cartaOferta(of, porTipo) {
  const r = rareza(of.rareza);
  const d = of.detalle;
  const equipado = d ? porTipo.get(d.tipo) : null;
  const comprar = h("button", { type: "button", class: "btn btn-small btn-gold" }, "Comprar");
  comprar.addEventListener("click", () => comprarOferta(of, comprar));
  return h("article", { class: "merc-carta merc-p2p-carta", style: { "--rar": r.color } },
    h("div", { class: "merc-icono", "aria-hidden": "true" }, d ? emojiTipo(d.tipo) : "🎒"),
    h("h4", { class: "merc-carta-nombre" }, d?.nombre || `Objeto #${of.tokenId}`),
    h("p", { class: "merc-meta" }, `${d?.tipo ?? ""}${d?.tipo ? " · " : ""}${r.nombre}`),
    d ? h("p", { class: "merc-meta" }, `⚔️ ${d.ataque}  🛡️ ${d.defensa}`) : null,
    comparador(d, equipado),
    h("p", { class: "merc-meta merc-p2p-vendedor" }, `Vendedor: ${acortarDir(of.vendedor)}`),
    h("div", { class: "merc-precio" }, `${formatearOro(of.precio)} ORO`),
    comprar);
}

// ───────────────────────── Acciones ─────────────────────────

async function listarObjeto(it, precioOroEntero) {
  if (!activo() || S.ocupado) return;
  S.ocupado = true;
  try {
    const aprobado = await S.eco.aprobadoNFT().catch(() => false);
    if (!aprobado) {
      const ok = window.confirm("Para vender en el Mercado P2P hace falta dar permiso una vez (setApprovalForAll al contrato MercadoP2P). ¿Continuar?");
      if (!ok) return;
      const op = await S.eco.aprobarNFT();
      await op.esperar();
    }
    const precioUnidades = aUnidades(precioOroEntero);
    const op = await S.eco.listar(it.tokenId, precioUnidades);
    await op.esperar();
    aviso(`📣 «${it.nombre || it.tipo}» puesto a la venta por ${precioOroEntero} ORO.`, "ok");
    await refrescarMercadoP2P();
  } catch (e) {
    aviso(mensajeErrorTransaccion(e).texto, "error");
  } finally {
    S.ocupado = false;
  }
}

async function cancelarOferta(of) {
  if (!activo() || S.ocupado) return;
  if (!window.confirm("¿Retirar esta oferta y recuperar el objeto?")) return;
  S.ocupado = true;
  try {
    const op = await S.eco.cancelar(of.tokenId);
    await op.esperar();
    aviso("Oferta retirada: el objeto vuelve a tu inventario.", "ok");
    await refrescarMercadoP2P();
  } catch (e) {
    aviso(mensajeErrorTransaccion(e).texto, "error");
  } finally {
    S.ocupado = false;
  }
}

async function comprarOferta(of, btn) {
  if (!activo() || S.ocupado) return;
  if (!window.confirm(`¿Comprar este objeto por ${formatearOro(of.precio)} ORO?`)) return;
  S.ocupado = true;
  btn.disabled = true;
  try {
    const aprobado = await S.eco.aprobacionOro().catch(() => 0n);
    if (aprobado < of.precio) {
      const op = await S.eco.aprobarOro(of.precio);
      await op.esperar();
    }
    const op = await S.eco.comprarHasta(of.tokenId, of.precio);
    await op.esperar();
    aviso(`✅ Objeto comprado por ${formatearOro(of.precio)} ORO.`, "ok");
    S.o.onComprado?.();
    await refrescarMercadoP2P();
  } catch (e) {
    aviso(mensajeErrorTransaccion(e).texto, "error");
  } finally {
    S.ocupado = false;
    if (btn) btn.disabled = false;
  }
}
