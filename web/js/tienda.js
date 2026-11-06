// Tienda, venta y vestuario de Loot Arena (MEJORAS.md §6). UI sobre economy.js.
//
// Uso desde main.js (ver JSDoc de montarTienda):
//   import * as T from "./tienda.js";
//   await T.montarTienda({ provider, signer, cuenta, cfg, fx, onCambioApariencia, onCambioSaldo,
//                          inventario, getEquipados, onVendido });
//   T.actualizarInventario(items);          // cada vez que se relee el inventario
//   carta.append(T.botonVender(item) ?? ""); // botón "Vender por X ORO + Y ETH" en cada carta
//   T.desmontarTienda();                    // al cambiar de cuenta o de red
//
// Todo el texto entra con textContent (nombres de objetos vienen de la cadena).
import {
  CATALOGO, RANURAS, NOMBRE_RANURA, RAREZAS_COSMETICO, ID_POCION, PRECIO_COFRE, ORO_BIENVENIDA,
  FAUCET_SEPOLIA, ETH_MINIMO_GAS, MAX_ETH_DIARIO, cosmetico, precioVentaLocal, recompensaEthLocal,
  estimarEthVenta, formatearOro, formatearEth, oroEntero, aUnidades, aparienciaVacia, equiparCosmetico,
  quitarRanura, sanearApariencia, cargarApariencia, guardarApariencia, resolverDirecciones, cargarAbis,
  crearEconomiaChain,
} from "./economy.js";
import { mensajeErrorTransaccion, evaluarGas, hastaQue } from "./wallet-errores.js";
import { asegurarGas, GAS_ESPERA_MAX_MS } from "./gas.js";

export { CATALOGO } from "./economy.js";

// ───────────────────────── Utilidades DOM ─────────────────────────

function h(tag, props = {}, ...hijos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") {
      for (const [p, val] of Object.entries(v)) p.startsWith("--") ? el.style.setProperty(p, val) : (el.style[p] = val);
    }
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of hijos.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
/** replaceChildren que ignora null/false (replaceChildren los convertiría en texto "null"). */
const poner = (el, ...hijos) => el?.replaceChildren(...hijos.flat(Infinity).filter((x) => x != null && x !== false));
const enlace = (href, texto) => (href ? h("a", { href, target: "_blank", rel: "noopener noreferrer" }, texto) : null);
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const movimientoReducido = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
const rarezaCos = (r) => RAREZAS_COSMETICO[r] ?? RAREZAS_COSMETICO[0];
const NOMBRE_RAREZA_ITEM = ["Común", "Raro", "Legendario"];

// ───────────────────────── Estado ─────────────────────────

let generacion = 0;
/** @type {any} */
let S = null;

const MODOS_ACTIVOS = new Set(["chain", "simulada"]);
/** La tienda opera solo con economía montada y MetaMask en la red correcta (redOk !== false). */
const activo = () => !!S && MODOS_ACTIVOS.has(S.modo) && S.redOk !== false;

function estadoInicial(o) {
  return {
    gen: generacion,
    modo: "cargando",
    o,
    eco: null,
    cuenta: o.cuenta ?? null,
    els: { saldo: null, tienda: null, vestuario: null },
    creados: [],
    oro: null, eth: null,
    cosmeticos: {},
    apariencia: cargarApariencia(o.cuenta ?? null, o.storage),
    inventario: [...(o.inventario ?? [])],
    seleccion: new Set(),
    precios: new Map(),      // tokenId → ORO (del contrato)
    recompensas: new Map(),  // tokenId → wei
    infoEth: null,           // {caja, max, restanteHoy, pagadoHoy}
    redOk: null,             // true = MetaMask en la red de la config; false = otra red; null = no se sabe
    precioCofre: PRECIO_COFRE,
    preciosCos: new Map(CATALOGO.map((x) => [x.id, x.precio])),
    bienvenida: null,        // true = ya reclamada, false = pendiente, null = desconocido
    ocupado: false,
    probando: null,
    botones: new Set(),      // {btn, item} creados con botonVender
    timers: new Set(),
  };
}

function contenedor(id, crear) {
  let el = document.getElementById(id);
  if (!el && crear) {
    el = h(crear.tag ?? "section", { id, class: crear.clase ?? "" });
    (crear.padre ?? document.querySelector("main") ?? document.body).append(el);
    S.creados.push(el);
  }
  return el;
}

// ───────────────────────── API pública ─────────────────────────

/**
 * Monta la tienda, el vestuario y el saldo de ORO/ETH. Llamar tras conectar la wallet y cargar la
 * config (y también sin wallet: entonces queda en modo demo, visible pero deshabilitada).
 * Es idempotente: desmonta lo anterior antes de montar.
 *
 * @param {object} o
 * @param {any}    [o.provider]  ethers.BrowserProvider (null/undefined → modo demo)
 * @param {any}    [o.signer]    ethers.Signer de la cuenta
 * @param {string|null} [o.cuenta]  dirección conectada
 * @param {object} o.cfg         resultado de cargarConfig(): {red, net, abi, address, chainId}; puede traer
 *                               `economia: {oro, cosmeticos, mercado}`; si no, se lee config/deployments.json
 * @param {(ap:import("./economy.js").Apariencia) => void} [o.onCambioApariencia]  cada vez que cambia la apariencia
 * @param {(s:{oro:number, oroUnidades:bigint, eth:bigint|null}) => void} [o.onCambioSaldo]
 * @param {{actualizarHeroe?:Function, previsualizarCosmetico?:Function}} [o.fx]  módulo fx.js (opcional)
 * @param {Array<{tokenId:string,nombre:string,tipo:string,rareza:number,ataque:number,defensa:number,equipado?:boolean}>} [o.inventario]
 * @param {() => Array<object>} [o.getEquipados]  si se da junto a fx.actualizarHeroe, la tienda repinta el héroe
 * @param {(tokenIds:string[], pago:{oro:bigint, eth:bigint}|null) => void} [o.onVendido]  tras una venta minada
 * @param {any}    [o.ethers]    módulo ethers (si no, se carga con wallet.cargarEthers)
 * @param {import("./economy.js").Economia} [o.economia]  economía inyectada (p. ej. crearEconomiaSimulada())
 * @param {{saldo?:HTMLElement, tienda?:HTMLElement, vestuario?:HTMLElement}} [o.raiz]  contenedores (por defecto #saldo-oro, #tienda, #vestuario)
 * @param {Storage} [o.storage]  almacenamiento de la apariencia (por defecto localStorage)
 * @param {{request:Function}} [o.eip1193]  para wallet_watchAsset (por defecto window.ethereum)
 * @returns {Promise<{modo:"chain"|"simulada"|"demo"|"no-desplegada"|"error"}>}
 */
export async function montarTienda(o = {}) {
  desmontarTienda();
  const gen = ++generacion;
  S = estadoInicial(o);
  S.gen = gen;
  S.els.saldo = o.raiz?.saldo ?? contenedor("saldo-oro", null);
  S.els.tienda = o.raiz?.tienda ?? contenedor("tienda", { clase: "panel" });
  S.els.vestuario = o.raiz?.vestuario ?? contenedor("vestuario", { clase: "panel" });
  for (const el of Object.values(S.els)) el?.classList.add("tn-montado");
  renderCargando();

  let modo;
  try {
    if (o.economia) {
      S.eco = o.economia;
      modo = o.economia.modo === "chain" ? "chain" : "simulada";
    } else {
      const dirs = await resolverDirecciones(o.cfg);
      if (!dirs) modo = "no-desplegada";
      else if (!o.provider || !o.cuenta) modo = "demo";
      else {
        const ethers = o.ethers ?? (await import("./wallet.js")).cargarEthers().then((x) => x);
        const [eth, abis] = await Promise.all([ethers, cargarAbis()]);
        S.eco = crearEconomiaChain({
          ethers: eth, provider: o.provider, signer: o.signer ?? (await o.provider.getSigner()),
          cuenta: o.cuenta, cfg: o.cfg, direcciones: dirs, abis, eip1193: o.eip1193 ?? globalThis.ethereum,
        });
        S.redOk = await S.eco.redCorrecta();
        modo = "chain";
        // Con MetaMask en otra red no se mira el código del contrato (daría "0x" y un mensaje engañoso):
        // la tienda se muestra bloqueada con el aviso «cambia a Sepolia».
        if (S.redOk !== false) {
          const code = await o.provider.getCode(dirs.mercado);
          if (!code || code === "0x") modo = "no-desplegada";
        }
      }
    }
  } catch (e) {
    console.warn("[tienda] no se pudo preparar la economía:", e);
    modo = "error";
    S.error = mensajeErrorTransaccion(e).texto;
  }
  if (gen !== generacion) return { modo: "desmontada" };
  S.modo = modo;
  document.documentElement.dataset.economia = modo;
  renderTodo();
  if (activo()) await refrescarTodo();
  aplicarApariencia(false);
  return { modo };
}

/** Desmonta la tienda: vacía los contenedores, cierra diálogos y olvida el estado. */
export function desmontarTienda() {
  generacion++;
  if (!S) return;
  for (const t of S.timers) clearTimeout(t);
  for (const el of Object.values(S.els)) { if (el) { el.replaceChildren(); el.classList.remove("tn-montado", "tn-oculta"); el.hidden = false; } }
  for (const el of S.creados) el.remove();
  document.querySelector(".tn-overlay")?.remove();
  dlg?.close?.();
  delete document.documentElement.dataset.economia;
  S = null;
}

/**
 * Vuelve a leer el saldo de ORO y ETH, actualiza la cabecera (con animación) y avisa con onCambioSaldo.
 * @returns {Promise<{oro:number, oroUnidades:bigint, eth:bigint|null}|null>}
 */
export async function refrescarSaldo() {
  if (!activo()) return null;
  const gen = S.gen;
  const [oro, eth] = await Promise.all([S.eco.saldoOro(), S.eco.saldoEth()]);
  if (!S || gen !== S.gen) return null;
  const antes = { oro: S.oro, eth: S.eth };
  S.oro = oro; S.eth = eth;
  renderSaldo(antes);
  renderAvisos();
  renderCatalogo();
  renderCofre();
  actualizarBotonesVenta();
  const info = { oro: oroEntero(oro), oroUnidades: oro, eth };
  S.o.onCambioSaldo?.(info);
  return info;
}

/** Apariencia guardada para `cuenta` (localStorage por dirección; null → "invitado"). */
export function aparienciaGuardada(cuenta) {
  return cargarApariencia(cuenta ?? null);
}

/** Informa a la tienda del inventario actual (tras leerlo de la cadena). */
export function actualizarInventario(items) {
  if (!S) return;
  S.inventario = [...(items ?? [])];
  const ids = new Set(S.inventario.map((it) => String(it.tokenId)));
  for (const id of [...S.seleccion]) if (!ids.has(id)) S.seleccion.delete(id);
  renderVenta();
  if (activo()) cargarPrecios();
}

/**
 * Botón "Vender por X ORO + Y ETH" para la carta de un objeto. null si la economía no está disponible.
 * @param {{tokenId:string, rareza:number, ataque:number, defensa:number, nombre?:string, equipado?:boolean}} item
 * @returns {HTMLButtonElement|null}
 */
export function botonVender(item) {
  if (!S || !["chain", "simulada", "demo"].includes(S.modo)) return null;
  const btn = h("button", { type: "button", class: "btn btn-small tn-btn-vender", "data-token": item.tokenId });
  btn.addEventListener("click", (ev) => { ev.stopPropagation(); venderObjetos([item], btn); });
  S.botones.add({ btn, item });
  pintarBotonVenta(btn, item);
  return btn;
}

/** Pociones extra (consumible id 14) que tiene la cuenta. */
export function pocionesExtra() {
  return S?.cosmeticos?.[ID_POCION] ?? 0;
}

/**
 * Quema `n` pociones extra gastadas en una expedición (transacción del jugador).
 * @returns {Promise<boolean>} true si se quemaron
 */
export async function gastarPociones(n) {
  if (!activo() || !(n > 0)) return false;
  const ok = await ejecutar(`Gastar ${n} poción(es) extra`, () => S.eco.gastarPociones(Math.min(n, pocionesExtra())),
    { reintentar: () => gastarPociones(n) });
  if (ok) await refrescarCosmeticos();
  return !!ok;
}

/** Apariencia actual (copia). */
/** Compra un cosmético (lo usa el Mercado de la interfaz nueva). */
export const comprarCosmetico = (id, btn = null) => comprar(id, btn);

/** Abre un cofre cosmético (lo usa el Mercado de la interfaz nueva). */
export const abrirCofreCosmetico = () => abrirCofre();

/** Cambia la apariencia guardada (ranuras color, sombrero, capa, aura, mascota). */
export const cambiarAparienciaExterna = (ap) => cambiarApariencia(ap);

/** Ids de cosméticos que posee la cuenta conectada (balance > 0). */
export const cosmeticosPosee = () => Object.entries(S?.cosmeticos ?? {}).filter(([, n]) => Number(n) > 0).map(([id]) => Number(id));

export const aparienciaActual = () => ({ ...(S?.apariencia ?? aparienciaVacia()) });

/** Modo actual de la tienda o null si no está montada. */
export const modoTienda = () => S?.modo ?? null;

// ───────────────────────── Lecturas ─────────────────────────

async function refrescarTodo() {
  const gen = S.gen;
  const tareas = [
    refrescarSaldo(),
    refrescarCosmeticos(),
    S.eco.bienvenidaReclamada().then((b) => { if (gen === generacion) { S.bienvenida = b; renderBienvenida(); } }),
    S.eco.precioCofre().then((p) => { if (gen === generacion) { S.precioCofre = p; renderCofre(); } }),
    Promise.all(CATALOGO.map(async (x) => [x.id, await S.eco.precioCosmetico(x.id)])).then((pares) => {
      if (gen !== generacion) return;
      S.preciosCos = new Map(pares);
      renderCatalogo();
    }),
    cargarPrecios(),
  ];
  const r = await Promise.allSettled(tareas);
  for (const x of r) if (x.status === "rejected") console.warn("[tienda] lectura fallida:", x.reason);
}

async function refrescarCosmeticos() {
  if (!activo()) return;
  const gen = S.gen;
  const cos = await S.eco.cosmeticos();
  if (gen !== generacion) return;
  S.cosmeticos = cos;
  renderVestuario();
  renderCatalogo();
  aplicarApariencia(false);
}

async function cargarPrecios() {
  if (!activo()) return;
  const gen = S.gen;
  const [info] = await Promise.all([
    S.eco.infoEth().catch(() => null),
    ...S.inventario.map(async (it) => {
      const id = String(it.tokenId);
      try {
        const [p, r] = await Promise.all([
          S.precios.has(id) ? S.precios.get(id) : S.eco.precioVenta(it),
          S.recompensas.has(id) ? S.recompensas.get(id) : S.eco.recompensaEth(it),
        ]);
        S.precios.set(id, p); S.recompensas.set(id, r);
      } catch { /* se queda con el precio local */ }
    }),
  ]);
  if (gen !== generacion) return;
  S.infoEth = info;
  renderAvisos();
  renderVenta();
  actualizarBotonesVenta();
}

const precioOro = (it) => S.precios.get(String(it.tokenId)) ?? precioVentaLocal(it);
const recompensa = (it) => S.recompensas.get(String(it.tokenId)) ?? recompensaEthLocal(it);
const restanteHoy = () => {
  const i = S.infoEth;
  if (!i) return null;
  if (i.restanteHoy != null) return i.restanteHoy > 0n ? i.restanteHoy : 0n;   // ethRestanteHoy(address) del contrato
  if (i.pagadoHoy == null) return null;
  const r = (i.max ?? MAX_ETH_DIARIO) - i.pagadoHoy;
  return r > 0n ? r : 0n;
};
/** Estimación de ORO + ETH para vender `items` juntos. */
function estimar(items) {
  const oro = items.reduce((s, it) => s + precioOro(it), 0);
  const eth = estimarEthVenta(items.map(recompensa), { caja: S.infoEth?.caja ?? null, restanteHoy: restanteHoy() });
  return { oro, eth: eth.total, soloOro: eth.soloOro.every(Boolean), algunoSoloOro: eth.soloOro.some(Boolean) };
}

function textoPago({ oro, eth, soloOro }) {
  return soloOro ? `${formatearOro(aUnidades(oro))} ORO (solo ORO)` : `${formatearOro(aUnidades(oro))} ORO + ${formatearEth(eth)} ETH`;
}

function pintarBotonVenta(btn, item) {
  let est;
  try { est = estimar([item]); } catch { btn.hidden = true; return; }
  btn.replaceChildren(h("span", { "aria-hidden": "true" }, "🪙 "), `Vender por ${textoPago(est)}`);
  btn.title = est.soloOro
    ? "La caja de ETH del Mercado está vacía o has llegado al límite diario: esta venta paga solo ORO."
    : `Recibes ORO y ETH de Sepolia de la caja del Mercado (máximo ${formatearEth(S.infoEth?.max ?? MAX_ETH_DIARIO)} ETH al día).`;
  btn.disabled = !activo() || S.ocupado;
  if (!activo()) btn.title = S.modo === "demo" ? "Conecta MetaMask para vender" : btn.title;
}

function actualizarBotonesVenta() {
  if (!S) return;
  for (const reg of [...S.botones]) {
    if (!reg.btn.isConnected && reg.btn.dataset.pintado) { S.botones.delete(reg); continue; }
    reg.btn.dataset.pintado = "1";
    pintarBotonVenta(reg.btn, reg.item);
  }
}

// ───────────────────────── Render ─────────────────────────

function renderCargando() {
  S.els.saldo?.replaceChildren(h("span", { class: "tn-saldo-cargando" }, "🪙 …"));
  S.els.tienda?.replaceChildren(h("p", { class: "tn-tenue" }, "Abriendo el mercado…"));
  S.els.vestuario?.replaceChildren();
}

function renderTodo() {
  renderSaldo();
  const t = S.els.tienda, v = S.els.vestuario;
  if (S.modo === "no-desplegada" || S.modo === "error") {
    S.els.saldo?.replaceChildren();
    if (S.els.saldo) S.els.saldo.hidden = true;
    const texto = S.modo === "error"
      ? `La tienda no está disponible ahora mismo (${S.error}). El juego funciona igual.`
      : "La tienda de ORO todavía no está desplegada en esta red. ¡Pronto podrás vender tu botín y vestir a tu héroe! El resto del juego funciona igual.";
    t?.replaceChildren(h("div", { class: "tn-aviso tn-aviso-info", role: "status" }, h("strong", {}, "🏪 Mercado cerrado. "), texto));
    t?.classList.add("tn-oculta");
    v?.replaceChildren();
    if (v) v.hidden = true;
    return;
  }
  if (t) {
    poner(t, 
      h("div", { class: "tn-cabeza" },
        h("h2", {}, "🏪 Mercado"),
        S.modo === "simulada" ? h("span", { class: "tn-chip" }, "Simulación") : null,
        S.modo === "demo" ? h("span", { class: "tn-chip" }, "Modo demo") : null),
      h("div", { class: "tn-avisos", "aria-live": "polite" }),
      h("div", { class: "tn-bienvenida-slot" }),
      h("section", { class: "tn-seccion tn-venta", "aria-labelledby": "tn-t-venta" }),
      h("section", { class: "tn-seccion tn-catalogo-wrap", "aria-labelledby": "tn-t-cat" },
        h("h3", { id: "tn-t-cat" }, "Cosméticos"),
        h("div", { class: "tn-catalogo-layout" },
          h("div", { class: "tn-probador", "aria-label": "Vista previa del cosmético" }),
          h("div", { class: "tn-catalogo" }))),
      h("section", { class: "tn-seccion tn-cofre", "aria-labelledby": "tn-t-cofre" }));
  }
  renderAvisos(); renderBienvenida(); renderVenta(); renderCatalogo(); renderCofre(); renderVestuario();
  probar(null);
}

// ── Cabecera: saldo ORO + ETH ──
function renderSaldo(antes) {
  const el = S?.els.saldo;
  if (!el || S.modo === "no-desplegada" || S.modo === "error") return;
  el.hidden = false;
  if (!el.querySelector(".tn-valor-oro")) {
    poner(el, 
      h("span", { class: "tn-saldo", title: "Tu ORO (moneda del juego, ERC-20)" },
        h("span", { class: "tn-moneda", "aria-hidden": "true" }, "🪙"),
        h("span", { class: "tn-valor tn-valor-oro", "aria-live": "polite" }, "—"), h("span", { class: "tn-ud" }, " ORO")),
      h("span", { class: "tn-saldo tn-saldo-eth", title: "Tu ETH de Sepolia (paga el gas)" },
        h("span", { class: "tn-moneda", "aria-hidden": "true" }, "◆"),
        h("span", { class: "tn-valor tn-valor-eth" }, "—"), h("span", { class: "tn-ud" }, " ETH")),
      S.modo === "chain" ? h("button", {
        type: "button", class: "btn btn-small btn-ghost tn-btn-watch", title: "Añadir ORO a MetaMask",
        onclick: anadirAMetaMask,
      }, "🦊＋") : null);
  }
  const vOro = el.querySelector(".tn-valor-oro"), vEth = el.querySelector(".tn-valor-eth");
  if (S.oro == null) { vOro.textContent = S.modo === "demo" ? "—" : "…"; }
  else animarNumero(vOro, antes?.oro ?? null, S.oro, (x) => formatearOro(x));
  if (S.eth == null) vEth.textContent = "—";
  else animarNumero(vEth, antes?.eth ?? null, S.eth, (x) => formatearEth(x));
  for (const [v, a, b] of [[vOro, antes?.oro, S.oro], [vEth, antes?.eth, S.eth]]) {
    if (a == null || b == null || a === b) continue;
    const caja = v.closest(".tn-saldo");
    caja.classList.remove("tn-sube", "tn-baja"); void caja.offsetWidth;
    caja.classList.add(b > a ? "tn-sube" : "tn-baja");
  }
}

/** Anima un contador bigint de `desde` a `hasta`. */
function animarNumero(el, desde, hasta, fmt) {
  if (desde == null || desde === hasta || movimientoReducido()) { el.textContent = fmt(hasta); return; }
  const t0 = performance.now(), dur = 900, d = Number(hasta - desde);
  const paso = (t) => {
    const k = Math.min(1, (t - t0) / dur), e = 1 - (1 - k) ** 3;
    el.textContent = fmt(k >= 1 ? hasta : desde + BigInt(Math.round(d * e)));
    if (k < 1 && el.isConnected) requestAnimationFrame(paso);
  };
  requestAnimationFrame(paso);
}

// ── Avisos: gas, faucet, límite diario ──
function esSepolia() { return S.o.cfg?.red === "sepolia" || Number(S.o.cfg?.chainId) === 11155111; }
function enlaceFaucet() { return esSepolia() ? enlace(FAUCET_SEPOLIA, "faucet de Sepolia de Google") : null; }

function renderAvisos() {
  const c = S?.els.tienda?.querySelector(".tn-avisos");
  if (!c) return;
  const avisos = [];
  if (S.modo === "demo") {
    avisos.push(h("div", { class: "tn-aviso tn-aviso-info" }, "🦊 Conecta MetaMask para vender objetos, comprar cosméticos y abrir cofres. Mientras, puedes mirar el catálogo y probar los cosméticos."));
  }
  if (S.modo === "chain" && S.redOk === false) {
    avisos.push(h("div", { class: "tn-aviso tn-aviso-gas", role: "alert" },
      h("strong", {}, "🦊 MetaMask está en otra red. "),
      "La tienda funciona en Sepolia y está bloqueada hasta que cambies. ",
      h("button", { type: "button", class: "btn btn-small btn-gold", onclick: cambiarASepolia }, "Cambiar a Sepolia")));
  }
  if (activo() && S.eth != null && S.eth < ETH_MINIMO_GAS) {
    avisos.push(h("div", { class: "tn-aviso tn-aviso-gas", role: "alert" },
      h("strong", {}, "⛽ Te falta ETH para el gas. "),
      `Vender, comprar y abrir cofres son transacciones tuyas y cuestan un poco de ETH de Sepolia (tienes ${formatearEth(S.eth ?? 0n, { decimales: 5 })}). `,
      hayGrifo() ? "Al vender, comprar o abrir un cofre te enviaremos gas gratis automáticamente (una vez al día). " : null,
      esSepolia() ? [hayGrifo() ? "También puedes conseguirlo en el " : "Consigue ETH gratis en el ", enlaceFaucet(), "."] : null));
  }
  const r = restanteHoy();
  if (activo() && S.infoEth?.caja != null && S.infoEth.caja < recompensaEthLocal({ rareza: 0 })) {
    avisos.push(h("div", { class: "tn-aviso tn-aviso-info" }, "◆ La caja de ETH del Mercado está vacía: de momento las ventas pagan solo ORO."));
  } else if (activo() && r === 0n) {
    avisos.push(h("div", { class: "tn-aviso tn-aviso-info" }, `◆ Has cobrado hoy el máximo de ${formatearEth(S.infoEth?.max ?? MAX_ETH_DIARIO)} ETH: las ventas pagan solo ORO hasta mañana.`));
  }
  c.replaceChildren(...avisos);
}

// ── Bienvenida ──
function renderBienvenida() {
  const slot = S?.els.tienda?.querySelector(".tn-bienvenida-slot");
  if (!slot) return;
  slot.replaceChildren();
  if (!activo() || S.bienvenida !== false) return;
  slot.append(h("div", { class: "tn-bienvenida", role: "status" },
    h("span", { class: "tn-bienvenida-ico", "aria-hidden": "true" }, "🎁"),
    h("div", {}, h("strong", {}, `Reclama ${ORO_BIENVENIDA} ORO gratis`), h("p", {}, "Un regalo de bienvenida del Mercado, una vez por héroe. Solo pagas el gas.")),
    h("button", { type: "button", class: "btn btn-gold", onclick: (ev) => reclamarBienvenida(ev.currentTarget) }, "Reclamar")));
}

// ── Venta ──
function renderVenta() {
  const sec = S?.els.tienda?.querySelector(".tn-venta");
  if (!sec) return;
  const items = S.inventario;
  const sel = items.filter((it) => S.seleccion.has(String(it.tokenId)));
  sec.replaceChildren(h("h3", { id: "tn-t-venta" }, "Vender botín"),
    h("p", { class: "tn-tenue" }, `Cada objeto se vende por ORO según sus stats (base por rareza + 2 × (ataque + defensa)) y además la caja del Mercado paga un poco de ETH de Sepolia: 0,0001 / 0,0005 / 0,002 ETH según rareza, con un máximo de ${formatearEth(S.infoEth?.max ?? MAX_ETH_DIARIO)} ETH al día por jugador.`));
  if (!items.length) {
    sec.append(h("p", { class: "tn-vacio" }, S.modo === "demo" ? "Conecta tu wallet para ver tu inventario." : "No tienes objetos que vender. ¡Gana combates para conseguir botín!"));
    return;
  }
  const lista = h("ul", { class: "tn-lista-venta" });
  for (const it of items) {
    const id = String(it.tokenId);
    let est; try { est = estimar([it]); } catch { continue; }
    const marcado = S.seleccion.has(id);
    lista.append(h("li", { class: `tn-fila-venta rz-${it.rareza}${marcado ? " sel" : ""}` },
      h("label", {},
        h("input", {
          type: "checkbox", checked: marcado, disabled: !activo() || S.ocupado,
          onchange: (ev) => { ev.target.checked ? S.seleccion.add(id) : S.seleccion.delete(id); renderVenta(); },
        }),
        h("span", { class: "tn-nombre" }, it.nombre || `Objeto #${id}`),
        h("span", { class: "tn-meta" }, `${NOMBRE_RAREZA_ITEM[it.rareza] ?? ""} · ⚔ ${it.ataque} 🛡 ${it.defensa}`),
        it.equipado ? h("span", { class: "tn-chip tn-chip-eq" }, "Equipado") : null),
      h("span", { class: "tn-precio" }, textoPago(est)),
      h("button", { type: "button", class: "btn btn-small", disabled: !activo() || S.ocupado, onclick: (ev) => venderObjetos([it], ev.currentTarget) }, "Vender")));
  }
  sec.append(lista);
  const tot = sel.length ? estimar(sel) : null;
  sec.append(h("div", { class: "tn-venta-pie" },
    h("button", { type: "button", class: "btn btn-small btn-ghost", disabled: !activo() || S.ocupado, onclick: () => {
      S.seleccion = sel.length === items.length ? new Set() : new Set(items.map((x) => String(x.tokenId))); renderVenta();
    } }, sel.length === items.length ? "Quitar selección" : "Seleccionar todo"),
    h("button", {
      type: "button", class: "btn btn-gold", disabled: !activo() || S.ocupado || !sel.length,
      onclick: (ev) => venderObjetos(sel, ev.currentTarget),
    }, sel.length ? `Vender ${sel.length} por ${textoPago(tot)}` : "Vender seleccionados")));
}

// ── Catálogo + probador ──
function renderCatalogo() {
  const cont = S?.els.tienda?.querySelector(".tn-catalogo");
  if (!cont) return;
  cont.replaceChildren(...CATALOGO.map((x) => {
    const r = rarezaCos(x.rareza);
    const precio = S.preciosCos.get(x.id) ?? x.precio;
    const tengo = S.cosmeticos[x.id] ?? 0;
    const sinOro = S.oro != null && S.oro < aUnidades(precio);
    const carta = h("article", { class: `tn-cos rz-${r.clase}`, tabindex: "0", "data-id": x.id,
      onmouseenter: () => probar(x.id), onfocus: () => probar(x.id) },
      h("div", { class: "tn-cos-ico", "aria-hidden": "true", style: { "--tono": x.tono } }, x.icono),
      h("div", { class: "tn-cos-info" },
        h("strong", {}, x.nombre),
        h("span", { class: "tn-meta" }, `${NOMBRE_RANURA[x.ranura]} · ${r.nombre}`),
        x.ranura === "consumible" ? h("span", { class: "tn-meta" }, "+1 poción por expedición (se gasta)") : null,
        tengo ? h("span", { class: "tn-chip tn-chip-tengo" }, x.ranura === "consumible" ? `Tienes ${tengo}` : "En tu vestuario") : null),
      h("div", { class: "tn-cos-acc" },
        h("span", { class: "tn-precio" }, `🪙 ${formatearOro(aUnidades(precio))}`),
        x.ranura !== "consumible" ? h("button", { type: "button", class: "btn btn-small btn-ghost", onclick: () => probar(x.id, true) }, "Probar") : null,
        h("button", {
          type: "button", class: "btn btn-small btn-gold", disabled: !activo() || S.ocupado || sinOro || (tengo > 0 && x.ranura !== "consumible"),
          title: !activo() ? "Conecta MetaMask para comprar" : sinOro ? "No tienes ORO suficiente" : tengo && x.ranura !== "consumible" ? "Ya lo tienes" : null,
          onclick: (ev) => comprar(x.id, ev.currentTarget),
        }, tengo > 0 && x.ranura !== "consumible" ? "Comprado" : "Comprar")));
    return carta;
  }));
}

/** Pinta la vista previa: apariencia actual + el cosmético `id` (o solo la actual con id null). */
function probar(id, fijar = false) {
  if (!S) return;
  if (fijar) S.probando = id;
  const el = S.els.tienda?.querySelector(".tn-probador");
  if (!el) return;
  const mostrar = id ?? S.probando;
  const cos = mostrar != null ? cosmetico(mostrar) : null;
  const lienzo = h("div", { class: "tn-probador-lienzo" });
  el.replaceChildren(lienzo, h("p", { class: "tn-probador-pie" }, cos ? `Probando: ${cos.nombre}` : "Pasa el ratón por un cosmético para probarlo"));
  const fx = S.o.fx;
  if (cos && typeof fx?.previsualizarCosmetico === "function") {
    try { fx.previsualizarCosmetico(lienzo, cos.id); return; } catch (e) { console.warn("[tienda] previsualizarCosmetico falló:", e); }
  }
  lienzo.append(heroeReserva(cos && cos.ranura !== "consumible" ? equiparCosmetico(S.apariencia, cos.id) : S.apariencia, cos));
}

/** Héroe simple dibujado con CSS si fx.js no ofrece previsualización. */
function heroeReserva(ap, cos) {
  const tono = (id) => (id != null ? cosmetico(id)?.tono : null);
  const fig = h("div", { class: "tn-heroe", style: {
    "--armadura": tono(ap.color) ?? "#6b5a45", "--capa": tono(ap.capa) ?? "transparent", "--aura": tono(ap.aura) ?? "transparent",
  } },
  ap.aura != null ? h("div", { class: "tn-heroe-aura" }) : null,
  ap.capa != null ? h("div", { class: `tn-heroe-capa${ap.capa === 9 ? " alas" : ""}` }) : null,
  h("div", { class: "tn-heroe-cuerpo" }), h("div", { class: "tn-heroe-cabeza" }),
  ap.sombrero != null ? h("div", { class: "tn-heroe-sombrero", "aria-hidden": "true" }, cosmetico(ap.sombrero).icono) : null,
  ap.mascota != null ? h("div", { class: "tn-heroe-mascota", "aria-hidden": "true" }, cosmetico(ap.mascota).icono) : null,
  cos?.ranura === "consumible" ? h("div", { class: "tn-heroe-mascota", "aria-hidden": "true" }, cos.icono) : null);
  return fig;
}

// ── Cofre ──
function renderCofre() {
  const sec = S?.els.tienda?.querySelector(".tn-cofre");
  if (!sec) return;
  const sinOro = S.oro != null && S.oro < aUnidades(S.precioCofre);
  poner(sec, 
    h("h3", { id: "tn-t-cofre" }, "Cofre cosmético"),
    h("div", { class: "tn-cofre-fila" },
      h("div", { class: "tn-cofre-mini", "aria-hidden": "true" }, h("div", { class: "tn-cofre-tapa" }), h("div", { class: "tn-cofre-caja" })),
      h("div", {},
        h("p", {}, "Un cosmético al azar: ", h("span", { class: "rz-txt-comun" }, "común 60 %"), ", ", h("span", { class: "rz-txt-rara" }, "rara 32 %"), ", ",
          h("span", { class: "rz-txt-legendaria" }, "legendaria 8 %"), ". Nunca da consumibles; puede repetir uno que ya tengas."),
        h("button", {
          type: "button", class: "btn btn-gold", disabled: !activo() || S.ocupado || sinOro,
          title: !activo() ? "Conecta MetaMask para abrir cofres" : sinOro ? "No tienes ORO suficiente" : null,
          onclick: () => abrirCofre(),
        }, `Abrir cofre · 🪙 ${formatearOro(aUnidades(S.precioCofre))}`))));
}

// ── Vestuario ──
function renderVestuario() {
  const v = S?.els.vestuario;
  if (!v || S.modo === "no-desplegada" || S.modo === "error") return;
  v.hidden = false;
  const filas = RANURAS.map((ranura) => {
    const mios = CATALOGO.filter((x) => x.ranura === ranura && (S.cosmeticos[x.id] ?? 0) > 0);
    const puesto = S.apariencia[ranura];
    return h("div", { class: "tn-ranura", role: "group", "aria-label": NOMBRE_RANURA[ranura] },
      h("span", { class: "tn-ranura-nombre" }, NOMBRE_RANURA[ranura]),
      h("div", { class: "tn-ranura-opciones" },
        h("button", { type: "button", class: `tn-opcion${puesto == null ? " on" : ""}`, "aria-pressed": String(puesto == null),
          onclick: () => cambiarApariencia(quitarRanura(S.apariencia, ranura)) }, "Ninguno"),
        ...mios.map((x) => h("button", {
          type: "button", class: `tn-opcion rz-${rarezaCos(x.rareza).clase}${puesto === x.id ? " on" : ""}`, "aria-pressed": String(puesto === x.id),
          title: x.nombre, onclick: () => cambiarApariencia(puesto === x.id ? quitarRanura(S.apariencia, ranura) : equiparCosmetico(S.apariencia, x.id)),
        }, h("span", { "aria-hidden": "true" }, x.icono), " ", x.nombre)),
        !mios.length ? h("span", { class: "tn-tenue" }, "— cómpralos en el Mercado") : null));
  });
  poner(v, 
    h("div", { class: "tn-cabeza" }, h("h2", {}, "👘 Vestuario")),
    S.modo === "demo" ? h("p", { class: "tn-tenue" }, "Conecta tu wallet para ver y equipar tus cosméticos.") : null,
    h("div", { class: "tn-ranuras" }, filas),
    h("p", { class: "tn-pociones" }, `🧪 Pociones extra: ${pocionesExtra()}`, h("span", { class: "tn-tenue" }, " (se suman a las 3 de cada expedición y se gastan al usarlas)")));
}

function cambiarApariencia(ap) {
  S.apariencia = sanearApariencia(ap);
  guardarApariencia(S.cuenta, S.apariencia, S.o.storage);
  renderVestuario();
  probar(null);
  aplicarApariencia(true);
}

/** Avisa a main/fx de la apariencia actual (saneada con lo que posee la cuenta, si se conoce). */
function aplicarApariencia(porUsuario) {
  if (!S) return;
  if (activo()) {
    const limpia = sanearApariencia(S.apariencia, S.cosmeticos);
    if (JSON.stringify(limpia) !== JSON.stringify(S.apariencia) && !porUsuario) {
      S.apariencia = limpia; guardarApariencia(S.cuenta, limpia, S.o.storage); renderVestuario(); probar(null);
    }
  }
  const ap = { ...S.apariencia };
  try { S.o.onCambioApariencia?.(ap); } catch (e) { console.warn(e); }
  const fx = S.o.fx;
  if (typeof fx?.actualizarHeroe === "function" && typeof S.o.getEquipados === "function") {
    try { fx.actualizarHeroe(S.o.getEquipados() ?? [], ap); } catch (e) { console.warn("[tienda] fx.actualizarHeroe falló:", e); }
  }
}

// ───────────────────────── Acciones ─────────────────────────

function enlaceTx(hash) {
  const base = S.o.cfg?.net?.blockExplorerUrls?.[0];
  return base && S.modo === "chain" ? enlace(`${base}/tx/${hash}`, "ver transacción") : null;
}

function aviso(contenido, tipo = "info", ms = 5000) {
  let cont = document.getElementById("toasts");
  if (!cont) {
    cont = document.querySelector(".tn-toasts") ?? h("div", { class: "tn-toasts toasts", "aria-live": "polite" });
    if (!cont.isConnected) document.body.append(cont);
  }
  const t = h("div", { class: `toast toast-${tipo}`, role: "status" }, contenido);
  cont.append(t);
  setTimeout(() => { t.classList.add("salida"); setTimeout(() => t.remove(), 400); }, ms);
  return t;
}

function marcarOcupado(v) {
  if (!S) return;
  S.ocupado = v;
  S.els.tienda?.classList.toggle("tn-ocupada", v);
  renderVenta(); renderCatalogo(); renderCofre(); actualizarBotonesVenta();
}

/** Cambia MetaMask a Sepolia (si hace falta) y vuelve a leer la tienda. */
async function cambiarASepolia() {
  if (!S?.eco) return;
  try {
    await S.eco.asegurarRed();
    S.redOk = true;
    renderTodo();
    await refrescarTodo();
  } catch (e) {
    const m = mensajeErrorTransaccion(e);
    aviso(m.texto, m.codigo === "rechazado" ? "info" : "error", 7000);
  }
}

/** Botones de acción de un aviso de error (faucet, reintentar, cambiar de red, actualizar saldos). */
function accionesError(m, reintentar) {
  const out = [];
  if (m.accion === "faucet" && esSepolia()) out.push(" Consigue ETH en el ", enlaceFaucet(), ".");
  const boton = (texto, fn) => h("button", { type: "button", class: "btn btn-small btn-gold tn-toast-accion", onclick: fn }, texto);
  if (m.accion === "reintentar" && reintentar) out.push(boton("Reintentar", () => reintentar()));
  if (m.accion === "cambiar-red") out.push(boton("Cambiar a Sepolia", cambiarASepolia));
  if (m.accion === "refrescar") out.push(boton("Actualizar saldos", () => refrescarTodo()));
  return out;
}

/**
 * Relee de la cadena hasta que `listo(valor)`: los RPC públicos a veces devuelven datos desfasados
 * justo después de minar, así que no se confía en el evento ni en una sola lectura.
 */
async function releerHasta(leer, listo) {
  const r = await hastaQue(leer, listo, { intentos: 4, esperaMs: 1200 });
  if (!r.ok && S) aviso("Tu saldo aún no aparece actualizado en la red. Puede tardar unos segundos; pulsa «Actualizar saldos» si no cambia.", "info", 7000);
  return r.valor;
}
/** Relee el ORO hasta que cambie respecto a `antes` (bigint o null si no se sabía). */
const releerOroHasta = (antes) => releerHasta(() => refrescarSaldo(), (v) => v != null && (antes == null || v.oroUnidades !== antes));
/** Lectura de ORO antes de enviar (null si el RPC falla) para comparar después. */
const oroAhora = () => S.eco.saldoOro().then((x) => x, () => null);

/** ¿Se puede pedir gas gratis al servidor? (solo con la economía real y servidor configurado) */
function hayGrifo() { return S?.modo === "chain" && !!S.o.cfg?.serverUrl; }

/**
 * Pide gas gratis al servidor (gas.js) con un aviso intermedio «Consiguiendo gas gratis…» y la tienda
 * bloqueada mientras llega. @returns {Promise<Awaited<ReturnType<typeof asegurarGas>>|null>} null si se desmontó
 */
async function pedirGasGratis() {
  const gen = S.gen;
  let toast = null;
  const estado = (texto) => { toast?.remove(); toast = aviso(h("span", {}, h("span", { class: "spinner" }), " ", texto), "info", GAS_ESPERA_MAX_MS + 15_000); };
  marcarOcupado(true);
  try {
    const r = await asegurarGas({
      cuenta: S.o.cuenta, serverUrl: S.o.cfg.serverUrl, leerSaldo: () => S.eco.saldoEth(), onEstado: estado,
    });
    return gen === generacion ? r : null;
  } finally {
    toast?.remove();
    if (gen === generacion) marcarOcupado(false);
  }
}

/**
 * Comprueba el ETH para gas, leyendo el saldo de la cadena. Si falta, primero pide gas gratis al
 * servidor (POST /gas) y espera a que llegue; solo si eso falla bloquea con la explicación y el enlace
 * al faucet. Avisa si queda poco. Si el saldo no se sabe, deja pasar.
 */
async function hayGas() {
  if (!activo()) return false;
  let eth = (await S.eco.saldoEth()) ?? S.eth;
  let { nivel } = evaluarGas(eth);
  let fallo = null;
  if (nivel !== "ok" && nivel !== "desconocido" && hayGrifo()) {
    const r = await pedirGasGratis();
    if (!r || !S) return false;
    if (r.pedido) await refrescarSaldo();
    if (r.ok) {
      if (r.mensaje) aviso([r.mensaje, " ", r.txHash ? enlaceTx(r.txHash) : null], "ok", 6000);
      if (r.codigo === "recibido" || r.codigo === "en-camino") return true;
    } else {
      fallo = r.mensaje;
    }
    eth = r.saldo ?? eth;
    ({ nivel } = evaluarGas(eth));
    if (r.ok && nivel === "bloqueo") nivel = "aviso"; // gas.js ya ha comprobado que llega para firmar
  }
  if (nivel === "aviso") aviso(["⛽ Te queda poco ETH para el gas. ", esSepolia() ? ["Recarga en el ", enlaceFaucet(), "."] : null], "info", 7000);
  if (nivel !== "bloqueo") return true;
  await confirmar({
    titulo: "⛽ Necesitas ETH de Sepolia",
    cuerpo: [h("p", {}, "Vender, comprar y abrir cofres son transacciones que firmas tú, y la red cobra un poco de gas en ETH de Sepolia (gratis, es una red de pruebas)."),
      fallo ? h("p", { class: "tn-dlg-alerta" }, fallo) : null,
      esSepolia() ? h("p", {}, "Consigue unos céntimos de prueba en el ", enlaceFaucet(), " y vuelve a intentarlo.") : null],
    aceptar: "Entendido", soloAceptar: true,
  });
  return false;
}

/**
 * Ejecuta una operación con mensajes: "confirma en MetaMask" → "enviada" → resultado.
 * @returns {Promise<any|false>} resultado de esperar() o false si falló/se canceló
 */
async function ejecutar(descripcion, enviar, { alEnviar, reintentar } = {}) {
  const gen = S.gen;
  try {
    if (S.modo === "chain") aviso(`🦊 ${descripcion}: confirma en MetaMask…`, "info", 4000);
    const op = await enviar();
    alEnviar?.(op);
    aviso([`⏳ ${descripcion}: transacción enviada. `, enlaceTx(op.hash)], "info", 6000);
    const r = await op.esperar();
    return gen === generacion ? (r ?? true) : false;
  } catch (e) {
    if (gen !== generacion) return false;
    const m = mensajeErrorTransaccion(e);
    if (m.codigo !== "rechazado") console.warn(`[tienda] ${descripcion} (${m.codigo}):`, e);
    aviso([m.texto, ...accionesError(m, reintentar)], m.codigo === "rechazado" ? "info" : "error", 9000);
    return false;
  }
}

/**
 * Vende uno o varios objetos (confirmación → permiso la primera vez → venta → animación).
 * @param {Array<object>} items @param {HTMLElement} [origen] elemento desde el que salen las monedas
 */
export async function venderObjetos(items, origen) {
  if (!S) return false;
  if (!activo()) { aviso(S.modo === "demo" ? "🦊 Conecta MetaMask para vender tus objetos." : "La tienda no está disponible.", "info"); return false; }
  if (S.ocupado || !items.length) return false;
  const est = estimar(items);
  const equipados = items.filter((it) => it.equipado);
  const ok = await confirmar({
    titulo: items.length === 1 ? `¿Vender «${items[0].nombre || `#${items[0].tokenId}`}»?` : `¿Vender ${items.length} objetos?`,
    cuerpo: [
      h("p", { class: "tn-dlg-pago" }, "Recibirás ", h("strong", {}, textoPago(est)), "."),
      est.algunoSoloOro && !est.soloOro ? h("p", { class: "tn-tenue" }, "Algún objeto pagará solo ORO: la caja de ETH o tu cupo diario no alcanzan para todos.") : null,
      h("p", { class: "tn-tenue" }, `La caja del Mercado paga como máximo ${formatearEth(S.infoEth?.max ?? MAX_ETH_DIARIO)} ETH al día por jugador; si se agota, recibes solo ORO. La cantidad exacta la decide el contrato.`),
      h("p", {}, "⚠️ Los objetos vendidos se envían a la dirección 0x…dEaD y desaparecen para siempre."),
      equipados.length ? h("p", { class: "tn-dlg-alerta" }, `Ojo: ${equipados.length === 1 ? "este objeto está equipado" : `${equipados.length} de estos objetos están equipados`}.`) : null,
      h("p", { class: "tn-tenue" }, "Es una transacción tuya: pagarás un poco de gas en ETH de Sepolia."),
    ],
    aceptar: "Vender",
  });
  if (!ok || !S) return false;
  if (!(await hayGas())) return false;
  marcarOcupado(true);
  try {
    let aprobado;
    try { aprobado = await S.eco.aprobado(); }
    catch (e) { const m = mensajeErrorTransaccion(e); aviso(m.texto, "error", 7000); return false; }
    if (!aprobado) {
      const si = await confirmar({
        titulo: "Permiso para el Mercado (solo la primera vez)",
        cuerpo: [
          h("p", {}, "Para vender, el contrato Mercado necesita permiso para recoger tus objetos de Loot Arena. MetaMask te pedirá firmar ", h("code", {}, "setApprovalForAll"), "."),
          h("p", {}, "El Mercado solo mueve un objeto cuando tú pulsas «Vender» y te paga en la misma transacción; nadie más puede usar este permiso. Puedes revocarlo cuando quieras desde Etherscan o revoke.cash."),
          h("p", { class: "tn-tenue" }, "Son dos transacciones esta vez (permiso + venta); las siguientes ventas, solo una."),
        ],
        aceptar: "Dar permiso",
      });
      if (!si || !S) return false;
      if (!(await ejecutar("Permiso al Mercado", () => S.eco.aprobar(), { reintentar: () => venderObjetos(items, origen) }))) return false;
    }
    const ids = items.map((it) => String(it.tokenId));
    const oroAntes = await oroAhora();
    const res = await ejecutar(items.length === 1 ? "Venta" : `Venta de ${items.length} objetos`, () => S.eco.vender(ids),
      { reintentar: () => venderObjetos(items, origen) });
    if (!res || !S) return false;
    const pago = res === true ? null : res;
    const oro = pago?.oro ?? aUnidades(est.oro), eth = pago?.eth ?? null;
    const ganado = { oro, eth };
    volarMonedas(origen, { oro: oroEntero(oro), eth: eth ?? 0n });
    aviso(`💰 ¡Vendido! +${formatearOro(oro)} ORO${eth ? ` y +${formatearEth(eth)} ETH` : eth === 0n ? " (solo ORO esta vez)" : ""}`, "ok", 6000);
    S.inventario = S.inventario.filter((it) => !ids.includes(String(it.tokenId)));
    for (const id of ids) { S.seleccion.delete(id); S.precios.delete(id); S.recompensas.delete(id); }
    for (const reg of [...S.botones]) if (ids.includes(String(reg.item.tokenId))) { reg.btn.remove(); S.botones.delete(reg); }
    S.o.onVendido?.(ids, ganado);
    await esperar(movimientoReducido() ? 0 : 650);
    await releerOroHasta(oroAntes);
    await cargarPrecios();
    return ganado;
  } finally {
    marcarOcupado(false);
  }
}

async function comprar(id, btn) {
  if (!activo() || S.ocupado) return;
  const cos = cosmetico(id), precio = S.preciosCos.get(id) ?? cos.precio;
  if (S.oro != null && S.oro < aUnidades(precio)) { aviso("No tienes ORO suficiente. Vende algún objeto primero.", "info"); return; }
  if (!(await hayGas())) return;
  marcarOcupado(true);
  try {
    const oroAntes = await oroAhora();
    const ok = await ejecutar(`Compra de ${cos.nombre}`, () => S.eco.comprar(id, 1), { reintentar: () => comprar(id, btn) });
    if (!ok || !S) return;
    volarMonedas(null, { oro: -precio, hacia: btn });
    aviso(`✨ ¡${cos.nombre} es tuyo!`, "ok");
    await Promise.allSettled([releerOroHasta(oroAntes), refrescarCosmeticos()]);
    if (cos.ranura !== "consumible" && S.apariencia[cos.ranura] == null) cambiarApariencia(equiparCosmetico(S.apariencia, id));
  } finally {
    marcarOcupado(false);
  }
}

async function reclamarBienvenida(btn) {
  if (!activo() || S.ocupado) return;
  if (!(await hayGas())) return;
  marcarOcupado(true);
  try {
    const oroAntes = await oroAhora();
    const ok = await ejecutar("Bono de bienvenida", () => S.eco.reclamarBienvenida(), { reintentar: () => reclamarBienvenida(btn) });
    if (!S) return;
    if (ok) {
      S.bienvenida = true;
      volarMonedas(btn, { oro: ORO_BIENVENIDA });
      aviso(`🎁 ¡+${ORO_BIENVENIDA} ORO de bienvenida!`, "ok");
      await releerOroHasta(oroAntes);
    } else {
      S.bienvenida = await S.eco.bienvenidaReclamada();
    }
    renderBienvenida();
  } finally {
    marcarOcupado(false);
  }
}

async function anadirAMetaMask() {
  try {
    const ok = await S.eco.anadirAMetaMask();
    aviso(ok ? "🦊 ORO añadido a MetaMask." : "MetaMask no añadió el token.", ok ? "ok" : "info");
  } catch (e) {
    aviso(mensajeErrorTransaccion(e).texto, "error");
  }
}

// ───────────────────────── Cofre: animación de revelado ─────────────────────────

async function abrirCofre() {
  if (!activo() || S.ocupado) return;
  if (S.oro != null && S.oro < aUnidades(S.precioCofre)) { aviso("No tienes ORO suficiente para el cofre.", "info"); return; }
  if (!(await hayGas())) return;
  marcarOcupado(true);
  const ov = crearOverlayCofre();
  try {
    const oroAntes = await oroAhora();
    ov.estado(S.modo === "chain" ? "Confirma en MetaMask…" : "Abriendo…");
    const id = await ejecutar("Cofre cosmético", () => S.eco.abrirCofre(), {
      alEnviar: () => { ov.estado("El cofre tiembla…"); ov.temblar(); },
      reintentar: () => { ov.cerrar(); setTimeout(abrirCofre, 320); },
    });
    if (!S) { ov.cerrar(); return; }
    if (id === false) { ov.cerrar(); return; }
    await releerOroHasta(oroAntes);
    if (typeof id !== "number") {
      ov.cerrar();
      aviso("Cofre abierto. Revisa tu vestuario.", "ok");
      await refrescarCosmeticos();
      return;
    }
    await ov.revelar(id);
    await refrescarCosmeticos();
  } finally {
    marcarOcupado(false);
  }
}

function crearOverlayCofre() {
  document.querySelector(".tn-overlay")?.remove();
  const reducido = movimientoReducido();
  const txt = h("p", { class: "tn-ov-estado", "aria-live": "polite" });
  const cofre = h("div", { class: "tn-cofre-grande" }, h("div", { class: "tn-cofre-luz" }), h("div", { class: "tn-cofre-tapa" }), h("div", { class: "tn-cofre-caja" }));
  const escena = h("div", { class: "tn-ov-escena" }, cofre);
  const acciones = h("div", { class: "tn-ov-acciones" });
  const ov = h("div", { class: `tn-overlay${reducido ? " reducido" : ""}`, role: "dialog", "aria-modal": "true", "aria-label": "Cofre cosmético" }, escena, txt, acciones);
  document.body.append(ov);
  const cerrar = () => { ov.classList.add("salida"); setTimeout(() => ov.remove(), 300); };
  ov.addEventListener("keydown", (e) => { if (e.key === "Escape" && ov.classList.contains("revelado")) cerrar(); });
  return {
    estado: (t) => { txt.textContent = t; },
    temblar: () => cofre.classList.add("tiembla"),
    cerrar,
    revelar: async (id) => {
      const cos = cosmetico(id), r = rarezaCos(cos?.rareza ?? 0);
      txt.textContent = "";
      cofre.classList.add("tiembla", "fuerte");
      await esperar(reducido ? 0 : 1200);
      cofre.classList.add("abierto", `rz-${r.clase}`);
      ov.classList.add(`rz-${r.clase}`);
      if (!reducido && cos?.rareza === 2) escena.append(h("div", { class: "tn-rayos" }), ...confeti(28));
      await esperar(reducido ? 0 : 500);
      const lienzo = h("div", { class: "tn-carta-lienzo" });
      const carta = h("div", { class: `tn-carta rz-${r.clase}` },
        lienzo, h("strong", {}, cos?.nombre ?? `Cosmético #${id}`), h("span", { class: "tn-meta" }, `${NOMBRE_RANURA[cos?.ranura] ?? ""} · ${r.nombre}`));
      if (cos && typeof S?.o.fx?.previsualizarCosmetico === "function") {
        try { S.o.fx.previsualizarCosmetico(lienzo, id); } catch { lienzo.append(h("span", { class: "tn-carta-ico" }, cos.icono)); }
      } else lienzo.append(h("span", { class: "tn-carta-ico" }, cos?.icono ?? "❔"));
      escena.append(carta);
      if (cos?.rareza === 2) txt.append(h("span", { class: "tn-legendaria-txt" }, "¡LEGENDARIA!"));
      try { S?.o.fx?.sonar?.(cos?.rareza === 2 ? "legendario" : "cofre"); } catch { /* sin sonido */ }
      ov.classList.add("revelado");
      const puedeOtra = activo() && S.oro != null && S.oro >= aUnidades(S.precioCofre);
      const yaPuesto = cos && S && S.apariencia[cos.ranura] === id;
      poner(acciones, 
        cos && RANURAS.includes(cos.ranura) && !yaPuesto ? h("button", { type: "button", class: "btn btn-gold", onclick: () => { cambiarApariencia(equiparCosmetico(S.apariencia, id)); cerrar(); } }, "Equipar") : null,
        h("button", { type: "button", class: "btn", disabled: !puedeOtra, onclick: () => { cerrar(); setTimeout(abrirCofre, 320); } }, "¡Otra vez!"),
        h("button", { type: "button", class: "btn btn-ghost", onclick: cerrar }, "Cerrar"));
      acciones.querySelector("button")?.focus();
    },
  };
}

function confeti(n) {
  const colores = ["#f5c542", "#fde68a", "#f97316", "#fff7d6", "#e8b75a"];
  return Array.from({ length: n }, (_, i) => h("i", { class: "tn-confeti", style: {
    "--x": `${Math.round((Math.random() * 2 - 1) * 260)}px`, "--y": `${Math.round(-120 - Math.random() * 220)}px`,
    "--r": `${Math.round(Math.random() * 720)}deg`, "--d": `${(Math.random() * 0.3).toFixed(2)}s`, background: colores[i % colores.length],
  } }));
}

// ───────────────────────── Monedas volando ─────────────────────────

/**
 * Lanza monedas de ORO (y rombos de ETH) desde `origen` hasta la cabecera (o al revés si oro < 0).
 * @param {HTMLElement|null} origen @param {{oro?:number, eth?:bigint, hacia?:HTMLElement}} o
 */
function volarMonedas(origen, { oro = 0, eth = 0n, hacia } = {}) {
  const destOro = S?.els.saldo?.querySelector(".tn-saldo:not(.tn-saldo-eth)") ?? S?.els.saldo;
  const destEth = S?.els.saldo?.querySelector(".tn-saldo-eth") ?? destOro;
  if (movimientoReducido() || !destOro || typeof Element.prototype.animate !== "function") return;
  const centro = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  const desde = origen?.isConnected ? centro(origen) : { x: innerWidth / 2, y: innerHeight / 2 };
  const lanzar = (simbolo, clase, n, destino, invertir) => {
    const a = invertir ? centro(destino) : desde, b = invertir ? (hacia?.isConnected ? centro(hacia) : desde) : centro(destino);
    for (let i = 0; i < n; i++) {
      const m = h("span", { class: `tn-vuela ${clase}`, "aria-hidden": "true" }, simbolo);
      Object.assign(m.style, { left: `${a.x}px`, top: `${a.y}px` });
      document.body.append(m);
      const dx = b.x - a.x, dy = b.y - a.y, sx = (Math.random() - 0.5) * 120, sy = -40 - Math.random() * 80;
      m.animate([
        { transform: "translate(-50%,-50%) scale(.6)", opacity: 0 },
        { transform: `translate(calc(-50% + ${sx}px), calc(-50% + ${sy}px)) scale(1.1)`, opacity: 1, offset: 0.3 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.7)`, opacity: 0.9 },
      ], { duration: 750 + i * 45, delay: i * 55, easing: "cubic-bezier(.5,0,.3,1)", fill: "forwards" }).onfinish = () => m.remove();
    }
  };
  if (oro) lanzar("🪙", "oro", Math.min(14, Math.max(4, Math.round(Math.abs(oro) / 15))), destOro, oro < 0);
  if (eth > 0n) lanzar("◆", "eth", Math.min(8, 3 + Number(eth / 10n ** 14n) / 4 | 0), destEth, false);
}

// ───────────────────────── Diálogo de confirmación ─────────────────────────

let dlg = null;
/**
 * Diálogo modal propio. @returns {Promise<boolean>}
 * @param {{titulo:string, cuerpo:Node[], aceptar?:string, cancelar?:string, soloAceptar?:boolean}} o
 */
function confirmar({ titulo, cuerpo, aceptar = "Aceptar", cancelar = "Cancelar", soloAceptar = false }) {
  if (typeof HTMLDialogElement !== "function") return Promise.resolve(soloAceptar || window.confirm(titulo));
  if (!dlg?.isConnected) {
    dlg = h("dialog", { class: "dialog tn-dlg", "aria-labelledby": "tn-dlg-t" });
    document.body.append(dlg);
  }
  return new Promise((res) => {
    // Escape dispara "cancel" (síncrono). No se escucha "close": llega asíncrono y lo recibiría el siguiente diálogo.
    const fin = (v) => { dlg.removeEventListener("cancel", alCancelar); if (dlg.open) dlg.close(); res(v); };
    const alCancelar = (ev) => { ev.preventDefault(); fin(false); };
    dlg.replaceChildren(h("h3", { id: "tn-dlg-t" }, titulo), h("div", { class: "tn-dlg-cuerpo" }, cuerpo),
      h("div", { class: "tn-dlg-acc" },
        soloAceptar ? null : h("button", { type: "button", class: "btn btn-ghost", onclick: () => fin(false) }, cancelar),
        h("button", { type: "button", class: "btn btn-gold", onclick: () => fin(true) }, aceptar)));
    dlg.addEventListener("cancel", alCancelar);
    dlg.showModal();
    dlg.querySelector(".btn-gold")?.focus();
  });
}
