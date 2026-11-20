// Orquestación de Loot Arena 1.1: wallet, combate (combat/skills/progression), efectos (fx),
// botín del servidor, inventario NFT y economía (tienda/venta/vestuario).
import { cargarConfig, ZERO_ADDRESS, NETWORKS, redActiva, guardarRed } from "../config/config.js";
import * as C from "./combat.js";
import * as E from "./equipment.js";
import * as P from "./progression.js";
import * as Sk from "./skills.js";
import * as W from "./wallet.js";
import * as FX2D from "./fx.js";
// El motor de dibujo se elige al arrancar: 2D siempre disponible, 3D si el equipo lo soporta
// y el jugador lo prefiere. `escena3d.js` reexporta todo lo de fx.js, así que es intercambiable.
let FX = FX2D;
import * as T from "./tienda.js";
import * as R from "./router.js";
import * as ENG from "./enganche.js";
import * as INV from "./inventario.js";
import * as MERC from "./mercado.js";
import * as CJ from "./conjuntos.js";
import * as P2P from "./mercado-p2p.js";
import * as HEROE from "./heroe.js";
import * as GAS from "./gas.js";
import * as TUT from "./tutorial.js";
import * as EXP from "./expediciones.js";
import * as EMO from "./emociones.js";
import { reclamarBotin } from "./api.js";
import { mostrarAnuncioRecompensado } from "./anuncios.js";
import { catalogoRotativo, semillaDelDia, ofertaDelDiaCosmetico } from "./economy.js";
import * as BL from "./botin-local.js";
import { CLAVE_HISTORIAL_LOCAL, anadirEntrada, parsearHistorial, serializarHistorial } from "./historial-local.js";
import { crearContrato, hayCodigo, leerInventario, transferir, enlacesExplorador } from "./chain.js";
import { $, h, enlace, acortar, toast, esperar } from "./ui.js";
import { leer, guardar } from "./storage.js";

const S = {
  cfg: null,
  ethers: null,
  provider: null,
  contrato: null,
  contratoOk: false,
  cuenta: null,
  chainId: null,
  inventario: [],
  equipo: {},
  progreso: P.progresoNuevo(),
  combate: null,
  animando: false,
  // Expedición: serie de combates hasta caer o huir. Las pociones normales no se recargan entre combates.
  expedicion: null, // { pociones, pocionesExtra, extraGastadas }
  reclamando: false,
  desafio: null, // { rng } mientras se juega el desafío diario
  ultimoEnemigoClave: null, // clave del último rival (anti-repetición: ver explorar())
  // Modificadores de Arena activos (ids de combat.MODIFICADORES_ARENA): se eligen cada
  // MODIFICADOR_ARENA_CADA victorias consecutivas y duran hasta vencer al siguiente Jefe de Arena.
  // No se guardan en el progreso persistente: una racha rota o un Jefe vencido los vacía.
  modificadoresArena: [],
  pocionesRegalo: 0,
  expResultado: null, // último resultado de recoger una expedición (para «Duplicar botín»)
  transfiriendo: new Set(),
  links: { tx: () => null, token: () => null },
};

const CLAVE_3D = "lootarena:3d";
const prefiere3D = () => { try { return localStorage.getItem(CLAVE_3D) === "1"; } catch { return false; } };

/** Carga el motor 3D si el jugador lo pide y el equipo puede con él. Devuelve true si quedó activo. */
async function elegirMotor() {
  if (!prefiere3D()) return false;
  try {
    const R3D = await import("./render3d/escena3d.js");
    if (!R3D.soporta3d?.()) { toast("Tu navegador no puede con el 3D: sigues en 2D.", "info", 6000); return false; }
    FX = R3D;
    return true;
  } catch (e) {
    console.warn("[3d] no se pudo cargar:", e);
    toast("No se pudo cargar la arena en 3D: sigues en 2D.", "info", 6000);
    return false;
  }
}

/** Botón de la cabecera: alterna 2D/3D y recarga, porque el motor se elige al arrancar. */
function conectarBoton3D() {
  const b = $("#btn-3d");
  if (!b) return;
  const pintar = () => {
    const on = prefiere3D();
    b.setAttribute("aria-pressed", String(on));
    b.textContent = on ? "🧊" : "🖼️";
    b.title = on ? "Arena en 3D (pulsa para volver al 2D)" : "Arena en 2D (pulsa para probar el 3D)";
  };
  pintar();
  b.addEventListener("click", () => {
    try { localStorage.setItem(CLAVE_3D, prefiere3D() ? "0" : "1"); } catch { /* sin storage */ }
    pintar();
    location.reload();
  });
}

/**
 * Selector de red de la cabecera. Igual que el botón 2D/3D, recarga al cambiar: la red se
 * resuelve al arrancar (config, direcciones, servidor, contratos), y recargar es mucho más
 * honesto que rehacer a mano medio estado del juego y dejarse la mitad.
 *
 * Si hay cartera, primero se le pide el cambio: así el jugador no aterriza en «red incorrecta».
 * Si la rechaza, se deja el selector como estaba y no se recarga nada.
 */
function conectarSelectorRed() {
  const sel = $("#sel-red");
  if (!sel) return;
  const actual = redActiva();
  const desplegadas = new Set(S.cfg?.redesDesplegadas ?? []);
  sel.replaceChildren(...Object.entries(NETWORKS).map(([clave, net]) =>
    h("option", { value: clave, selected: clave === actual ? "" : null },
      desplegadas.size && !desplegadas.has(clave) ? `${net.chainName} (sin desplegar)` : net.chainName)));
  sel.value = actual;
  sel.classList.toggle("sin-desplegar", desplegadas.size > 0 && !desplegadas.has(actual));

  sel.addEventListener("change", async () => {
    const red = sel.value;
    if (red === actual) return;
    if (!guardarRed(red)) { toast("Este navegador no deja recordar la red.", "error"); sel.value = actual; return; }
    if (W.tieneMetaMask()) {
      try {
        await W.cambiarRed(NETWORKS[red]);
      } catch (e) {
        // La cartera manda: si no cambia, no cambiamos nosotros tampoco.
        guardarRed(actual);
        sel.value = actual;
        toast(`No se cambió de red: ${W.mensajeError(e)}`, "error", 7000);
        return;
      }
    }
    location.reload();
  });
}

const redCorrecta = () => S.chainId != null && S.chainId === S.cfg?.chainId;
const contratoDesplegado = () => S.cfg && S.cfg.address.toLowerCase() !== ZERO_ADDRESS;
const quienFx = (actor) => (actor === "jugador" ? "heroe" : "enemigo");
const enCurso = () => S.combate?.fase === "en_curso";

// ───────────────────────── Banner y cabecera ─────────────────────────

function banner(contenido, tipo = "aviso") {
  const b = $("#banner");
  b.replaceChildren();
  if (!contenido) { b.hidden = true; return; }
  b.className = `banner banner-${tipo}`;
  b.append(h("span", {}, ...[contenido].flat()));
  b.hidden = false;
}

function renderCabecera() {
  const badge = $("#net-badge");
  const btn = $("#btn-connect");
  const addr = $("#addr");
  addr.hidden = !S.cuenta;
  addr.textContent = acortar(S.cuenta);
  addr.title = S.cuenta ?? "";
  btn.disabled = false;

  if (!W.tieneMetaMask()) {
    badge.textContent = "Modo demo";
    badge.className = "badge badge-off";
    btn.textContent = "🦊 Instalar MetaMask";
  } else if (!S.cuenta) {
    badge.textContent = "Desconectado";
    badge.className = "badge badge-off";
    btn.textContent = "🦊 Conectar MetaMask";
  } else if (!redCorrecta()) {
    badge.textContent = "Red incorrecta";
    badge.className = "badge badge-bad";
    btn.textContent = `Cambiar a ${S.cfg.net.chainName}`;
  } else {
    badge.textContent = S.cfg.net.chainName;
    badge.className = "badge badge-ok";
    btn.textContent = "✔ Conectado";
    btn.disabled = true;
  }

  // Orden a propósito: si la red elegida no tiene contratos, nada de la cadena funciona por
  // mucho MetaMask que haya, así que ese aviso va primero y dice cómo salir del atasco.
  if (S.cfg && !S.cfg.desplegada) {
    // Sin "localhost": es la red de desarrollo y mandar ahí a un jugador no le sirve de nada.
    const otras = (S.cfg.redesDesplegadas ?? []).filter((r) => r !== S.cfg.red && r !== "localhost");
    banner([
      `Loot Arena no está desplegado en ${S.cfg.net.chainName}. Puedes jugar en `,
      h("strong", {}, "modo demo"),
      ", pero aquí el botín no se acuña. ",
      ...(otras.length
        ? ["Vuelve a ", h("strong", {}, otras.map((r) => NETWORKS[r]?.chainName ?? r).join(" o ")), " con el selector de red de arriba."]
        : []),
    ], "aviso");
  } else if (!W.tieneMetaMask()) {
    banner([
      "No se ha detectado MetaMask. Puedes jugar en ",
      h("strong", {}, "modo demo"),
      ", pero para recibir objetos NFT, venderlos por ORO y personalizar a tu héroe necesitas ",
      enlace("https://metamask.io/download/", "instalar MetaMask"),
      ".",
    ], "info");
  } else if (S.cuenta && !redCorrecta()) {
    banner([
      `Tu wallet está en otra red. Loot Arena usa ${S.cfg.net.chainName} (chainId ${S.cfg.chainId}). `,
      h("button", { class: "btn btn-small btn-gold", type: "button", onclick: () => asegurarRed() }, `Cambiar a ${S.cfg.net.chainName}`),
    ], "aviso");
  } else {
    banner(null);
  }

  const info = $("#contrato-info");
  info.replaceChildren(
    "Loot Arena · contrato ",
    contratoDesplegado()
      ? (enlace(S.cfg.net.blockExplorerUrls?.[0] && `${S.cfg.net.blockExplorerUrls[0]}/address/${S.cfg.address}`, acortar(S.cfg.address)) ?? acortar(S.cfg.address))
      : "sin desplegar",
    ` · red ${S.cfg.net.chainName}`,
  );
}

// ───────────────────────── Wallet ─────────────────────────

async function conectar() {
  if (!W.tieneMetaMask()) {
    window.open("https://metamask.io/download/", "_blank", "noopener");
    return false;
  }
  try {
    const cuentas = await W.pedirCuentas();
    await alCambiarCuentas(cuentas);
    if (S.cuenta && !redCorrecta()) await asegurarRed();
    return !!S.cuenta;
  } catch (e) {
    toast(W.mensajeError(e), "error");
    return false;
  }
}

async function asegurarRed() {
  try {
    await W.cambiarRed(S.cfg.net);
    await alCambiarRed(await W.chainIdActual());
  } catch (e) {
    toast(`No se pudo cambiar de red: ${W.mensajeError(e)}`, "error");
  }
}

async function alCambiarCuentas(cuentas) {
  const nueva = cuentas?.[0] ?? null;
  const cambio = nueva?.toLowerCase() !== S.cuenta?.toLowerCase();
  S.cuenta = nueva;
  S.chainId = nueva ? await W.chainIdActual() : null;
  if (cambio) {
    cargarProgreso();
    if (!enCurso()) S.expedicion = null;
  }
  await prepararContrato();
  cargarEquipo();
  renderCabecera();
  renderHeroe();
  await cargarInventario();
  await montarEconomia();
  if (!nueva) toast("Wallet desconectada.", "info");
}

async function alCambiarRed(chainIdHexONum) {
  S.chainId = Number(chainIdHexONum);
  await prepararContrato();
  cargarEquipo();
  renderCabecera();
  await cargarInventario();
  await montarEconomia();
}

/** (Re)crea provider y contrato. ethers v6 exige un BrowserProvider nuevo tras cambiar de red. */
async function prepararContrato() {
  S.provider = S.contrato = null;
  S.contratoOk = false;
  if (!S.cuenta || !redCorrecta() || !contratoDesplegado()) return;
  try {
    S.ethers ??= await W.cargarEthers();
    ({ provider: S.provider, contrato: S.contrato } = crearContrato(S.ethers, S.cfg));
    S.contratoOk = await hayCodigo(S.provider, S.cfg.address);
  } catch (e) {
    toast(W.mensajeError(e), "error");
  }
}

// ───────────────────────── Progreso del héroe ─────────────────────────

function cargarProgreso() {
  S.progreso = P.cargarProgreso(P.claveProgreso(S.cuenta));
}

function guardarProgreso() {
  P.guardarProgreso(P.claveProgreso(S.cuenta), S.progreso);
}

function renderProgreso() {
  const i = P.infoXp(S.progreso);
  FX.actualizarXP({ xp: i.xp, xpSiguiente: i.max ? i.xp || 1 : i.necesaria, nivel: i.nivel });
  FX.actualizarRacha(S.progreso.racha);
  FX.actualizarJefeEn(C.combatesHastaJefeDeRacha(S.progreso.racha));
  const v = S.progreso.victorias;
  $("#arena-level").textContent = `Nivel de arena ${C.nivelArena(v)}`;
  const faltan = P.combatesHastaJefe(v);
  $("#victorias").textContent = `${v} victoria${v === 1 ? "" : "s"} · ${faltan === 0 ? "👑 ¡jefe!" : `jefe en ${faltan + 1}`}`;
  FX.actualizarModificadoresArena(S.modificadoresArena.map(C.modificadorArena).filter(Boolean));
}

// ───────────────────────── Economía (tienda, venta, vestuario) ─────────────────────────

let montajeEco = 0;
async function montarEconomia() {
  const id = ++montajeEco;
  let signer = null;
  if (S.provider && S.cuenta && redCorrecta()) {
    try { signer = await S.provider.getSigner(); } catch { /* sin signer: modo demo */ }
  }
  if (id !== montajeEco) return;
  try {
    await T.montarTienda({
      provider: signer ? S.provider : null,
      signer,
      cuenta: signer ? S.cuenta : null,
      cfg: S.cfg,
      ethers: S.ethers ?? undefined,
      fx: FX,
      inventario: inventarioConEquipo(),
      getEquipados: equipados,
      raiz: contenedoresTienda(),
      onCambioSaldo: (sal) => { S.saldoOro = sal?.oro ?? 0; S.saldoEth = sal?.eth ?? null; renderMercadoSec(); },
      onVendido: async (ids, pago) => {
        ENG.registrarEvento({ tipo: "venta", cantidad: ids?.length ?? 1, oro: pago ? Number(pago.oro / 10n ** 18n) : 0 });
        await cargarInventario();
      },
      onCambioApariencia: (ap) => FX.actualizarHeroe(equipados(), ap),
    });
  } catch (e) {
    console.warn("[economía]", e);
  }
  if (id !== montajeEco) return;
  try {
    await P2P.montarMercadoP2P({
      provider: signer ? S.provider : null,
      signer,
      cuenta: signer ? S.cuenta : null,
      cfg: S.cfg,
      ethers: S.ethers ?? undefined,
      inventario: inventarioConEquipo().filter((it) => !it.local),
      getEquipados: equipados,
      raiz: { panel: $("#merc-p2p") },
      onComprado: () => cargarInventario(),
    });
  } catch (e) {
    console.warn("[mercado-p2p]", e);
  }
  if (id !== montajeEco) return;
  FX.actualizarHeroe(equipados(), T.aparienciaGuardada(S.cuenta));
  renderInventario();
  renderMercadoSec();
  try {
    await ENG.montarEnganche({
      provider: signer ? S.provider : null,
      signer,
      cuenta: signer ? S.cuenta : null,
      cfg: S.cfg,
      ethers: S.ethers ?? undefined,
      fx: FX,
      serverUrl: S.cfg.serverUrl,
      onAviso: (seccion, hay, n) => R.marcarAviso(seccion, hay, n),
      onRecompensa: aplicarRecompensa,
      onJugarDesafio: jugarDesafio,
      onCambioTitulo: pintarTitulo,
    });
  } catch (e) {
    console.warn("[enganche]", e);
  }
  if (id !== montajeEco) return;
  pintarTitulo(ENG.tituloActivo());
  renderExp();
  R.marcarAviso("expediciones", EXP.hayExpedicionLista(claveExp()));
  ENG.registrarEvento({ tipo: "inventario", items: S.inventario });
  ENG.registrarEvento({ tipo: "nivel", valor: P.infoXp(S.progreso).nivel });
}

/** Premios locales que da el enganche (misiones, pase, recompensa diaria). */
function aplicarRecompensa(r) {
  if (r.tipo === "xp" && r.xp > 0) {
    const antes = P.infoXp(S.progreso).nivel;
    S.progreso = P.sumarXp(P.sanearProgreso(S.progreso), r.xp).progreso;
    guardarProgreso();
    renderHeroe();
    const nv = P.infoXp(S.progreso).nivel;
    if (nv > antes) { FX.subidaDeNivel(nv); ENG.registrarEvento({ tipo: "nivel", valor: nv }); }
    toast(`✨ +${r.xp} XP${({ pase: " del pase", expedicion: " de la expedición" })[r.fuente] ?? " por la misión"}`, "ok", 3500);
  } else if (r.tipo === "pociones" && r.cantidad > 0) {
    if (S.expedicion) S.expedicion.pociones += r.cantidad;
    else S.pocionesRegalo += r.cantidad;
    toast(`🧪 +${r.cantidad} poción(es) para tu expedición`, "ok", 3500);
    renderBotones();
  } else if (r.tipo === "diario") {
    T.refrescarSaldo?.();
  }
}

function pintarTitulo(titulo) {
  const el = $("#heroe-titulo");
  if (el) el.textContent = titulo?.texto ? `«${titulo.texto}»` : "";
}

/** El jugador acepta el desafío diario desde la sección Misiones. */
function jugarDesafio(desafio, ayuda) {
  if (enCurso() || S.animando) return toast("Termina primero el combate actual.", "info");
  const r = ayuda.crearCombate({ ...statsHeroe(), pociones: C.POCIONES_POR_EXPEDICION });
  if (!r?.combate) return toast("No se pudo preparar el desafío.", "error");
  S.desafio = { rng: r.rng ?? Math.random, desafio };
  S.combate = r.combate;
  R.irA("arena");
  $("#resultado").hidden = true;
  $("#log").replaceChildren();
  añadirLog(S.combate.log);
  FX.revivir("heroe");
  FX.actualizarHeroe(equipados());
  FX.mostrarEstado("heroe", []);
  FX.mostrarEnemigo(S.combate.enemigo);
  FX.mostrarIntencion(C.intencionEnemigo(S.combate));
  FX.anunciar("DESAFÍO DIARIO", desafio?.nombre ?? desafio?.titulo ?? "Un intento al día");
  renderLuchadores();
  renderBotones();
}

// ───────────────────────── Equipo e inventario ─────────────────────────

// Modo demo = sin wallet conectada. El botín y el equipo viven entonces en localStorage
// (botin-local.js); al conectar la wallet se vuelve al inventario NFT de la cadena.
const enModoDemo = () => !S.cuenta;
const claveEquipoActual = () => (enModoDemo() ? BL.CLAVE_EQUIPO_LOCAL : E.claveEquipo(S.cuenta, S.chainId));
const leerBotinLocal = () => BL.parsearEstado(leer(BL.CLAVE_BOTIN_LOCAL));

// ───────────────────────── Historial local de actividad ─────────────────────────
// Para «Tus transacciones» (cadena/vista.js) cuando el RPC público no tiene eventos recientes.
// Las compras/ventas de la tienda se registran en tienda.js; aquí solo lo que decide main.js:
// el botín de jefe (sobre todo en modo demo, donde nunca llega a la cadena).
const leerHistorialLocal = () => parsearHistorial(leer(CLAVE_HISTORIAL_LOCAL));
function registrarHistorialLocal(entrada) {
  try { guardar(CLAVE_HISTORIAL_LOCAL, serializarHistorial(anadirEntrada(leerHistorialLocal(), entrada))); }
  catch { /* el historial local es un extra */ }
}

function cargarEquipo() {
  S.equipo = E.parsearEquipo(leer(claveEquipoActual()));
}

function guardarEquipo() {
  guardar(claveEquipoActual(), JSON.stringify(S.equipo));
}

/** Tira el botín local del modo demo, lo guarda y devuelve el objeto (o null si no cae nada). */
function tirarBotinDemo(enemigo) {
  const { estado, item } = BL.tirarBotinLocal(leerBotinLocal(), { ...enemigo, excluirComun: !!enemigo?.jefeDeRacha, bonoLegendario: C.multiplicadorLegendarioPorRacha(S.progreso.racha) }, Math.random, { equipados: Object.values(S.equipo) });
  if (item) guardar(BL.CLAVE_BOTIN_LOCAL, BL.serializarEstado(estado));
  return item;
}

const equipados = () => E.itemsEquipados(S.equipo, S.inventario);
const inventarioConEquipo = () => S.inventario.map((it) => ({ ...it, equipado: E.estaEquipado(S.equipo, it.tokenId) }));
const statsHeroe = () => P.statsHeroe(S.progreso, equipados());

let cargaInvId = 0;
async function cargarInventario() {
  const id = ++cargaInvId;
  const estado = $("#inv-estado");
  $("#btn-refrescar").disabled = !S.contratoOk;

  if (enModoDemo()) {
    S.inventario = leerBotinLocal().items;
    const saneado = E.sanearEquipo(S.equipo, S.inventario);
    if (JSON.stringify(saneado) !== JSON.stringify(S.equipo)) { S.equipo = saneado; guardarEquipo(); }
    const n = S.inventario.length;
    estado.textContent = (n
      ? `Modo demo: ${n} objeto${n === 1 ? "" : "s"} guardado${n === 1 ? "" : "s"} en este navegador. Equípalos para mejorar a tu héroe.`
      : "Modo demo: gana combates y el botín se guardará en este navegador.") +
      (W.tieneMetaMask() ? " Conecta tu wallet para conseguir objetos NFT." : " Instala MetaMask para conseguir objetos NFT.");
    alCambiarInventario();
    return;
  }

  let motivo = null;
  if (!W.tieneMetaMask()) motivo = "Instala MetaMask para ver tus objetos NFT.";
  else if (!S.cuenta) motivo = "Conecta tu wallet para ver tus objetos.";
  else if (!redCorrecta()) motivo = `Cambia a ${S.cfg.net.chainName} para ver tus objetos.`;
  else if (!contratoDesplegado()) motivo = "El contrato aún no está desplegado (dirección 0x0 en config/deployments.json).";
  else if (!S.contratoOk) motivo = `No hay contrato en ${acortar(S.cfg.address)} en esta red.`;

  if (motivo) {
    S.inventario = [];
    estado.textContent = motivo;
    alCambiarInventario();
    return;
  }

  estado.textContent = "Leyendo objetos de la cadena…";
  try {
    const inv = await leerInventario(S.contrato, S.cuenta);
    if (id !== cargaInvId) return;
    S.inventario = inv;
    const saneado = E.sanearEquipo(S.equipo, inv);
    if (JSON.stringify(saneado) !== JSON.stringify(S.equipo)) { S.equipo = saneado; guardarEquipo(); }
    estado.textContent = inv.length
      ? `${inv.length} objeto${inv.length === 1 ? "" : "s"} en tu wallet. Véndelos por ORO + ETH o equípalos.`
      : "Aún no tienes objetos. ¡Gana combates para conseguir botín!";
  } catch (e) {
    if (id !== cargaInvId) return;
    estado.textContent = `Error leyendo el inventario: ${W.mensajeError(e)}`;
  }
  alCambiarInventario();
}

/** Contenedores ocultos de la tienda antigua: su interfaz vive ahora en Mercado y Héroe. */
let ocultosTienda = null;
function contenedoresTienda() {
  if (!ocultosTienda) {
    // Fuera del documento: la tienda antigua no debe verse en ninguna sección.
    const crear = () => document.createElement("div");
    ocultosTienda = { tienda: crear(), vestuario: crear() };
  }
  return ocultosTienda;
}

/** Pinta la sección Mercado (vender y comprar) con el estado actual. */
function renderMercadoSec() {
  const sec = $("#seccion-mercado");
  if (!sec) return;
  MERC.renderMercado(sec, {
    inventario: inventarioConEquipo().filter((it) => !it.equipado && !it.local),
    equipados: equipados(),
    saldos: { oro: S.saldoOro ?? 0, cajaEth: undefined, restanteHoyEth: undefined },
    onVender: (items) => T.venderObjetos(items, "mercado"),
    onComprar: (c) => T.comprarCosmetico(c.id),
    onAbrirCofre: () => T.abrirCofreCosmetico(),
    catalogo: catalogoRotativo(semillaMercado(), {
      excluir: [ofertaDelDiaCosmetico(semillaDelDia())?.id].filter((id) => id != null),
    }),
    onRenovarCatalogo: renovarCatalogoConAnuncio,
    onCambioPestana: (clave) => { if (clave === "p2p") P2P.refrescarMercadoP2P?.(); },
  });
}

// Catálogo rotativo: cambia solo cada día, o al ver un anuncio (semilla nueva guardada hasta mañana).
const CLAVE_CATALOGO = "lootarena:mercado:catalogo";
function semillaMercado() {
  const hoy = semillaDelDia();
  try {
    const g = JSON.parse(leer(CLAVE_CATALOGO) ?? "null");
    if (g && g.dia === hoy && Number.isFinite(g.semilla)) return g.semilla;
  } catch { /* dato corrupto: catálogo del día */ }
  return hoy;
}

function renovarCatalogoConAnuncio() {
  mostrarAnuncioRecompensado("renovar_tienda", () => {
    const actual = new Set(catalogoRotativo(semillaMercado()).map((c) => c.id));
    // Busca una semilla que cambie al menos la mitad del catálogo.
    let semilla = 0;
    for (let i = 0; i < 20; i++) {
      semilla = Math.floor(Math.random() * 2 ** 31);
      const nuevos = catalogoRotativo(semilla).filter((c) => !actual.has(c.id)).length;
      if (nuevos * 2 >= actual.size) break;
    }
    guardar(CLAVE_CATALOGO, JSON.stringify({ dia: semillaDelDia(), semilla }));
    toast("🛒 ¡Catálogo renovado!", "ok", 3000);
    renderMercadoSec();
  }, (motivo) => {
    if (motivo !== "ocupado") toast("Anuncio no completado: el catálogo sigue igual.", "info");
    renderMercadoSec();
  });
}

function alCambiarInventario() {
  T.actualizarInventario(inventarioConEquipo().filter((it) => !it.local));
  P2P.actualizarInventarioP2P(inventarioConEquipo().filter((it) => !it.local));
  renderMercadoSec();
  ENG.registrarEvento({ tipo: "inventario", items: S.inventario });
  FX.actualizarHeroe(equipados());
  renderInventario();
  renderHeroe();
}

function alternarEquipo(item) {
  S.equipo = E.estaEquipado(S.equipo, item.tokenId) ? E.desequipar(S.equipo, item.tokenId) : E.equipar(S.equipo, item);
  guardarEquipo();
  if (E.estaEquipado(S.equipo, item.tokenId)) TUT.avanzarTutorial("equipar");
  alCambiarInventario();
  const conjuntosActivos = CJ.contarConjuntos(equipados()).filter((s) => s.efectoActivo).map((s) => s.id);
  if (conjuntosActivos.length) ENG.registrarEvento({ tipo: "equipo", conjuntosActivos });
  if (enCurso()) toast("El nuevo equipo se aplicará en el próximo combate.", "info", 3000);
}

function tarjetaItem(item, { acciones = true } = {}) {
  const r = E.rareza(item.rareza);
  const equipado = E.estaEquipado(S.equipo, item.tokenId);
  const enviando = S.transfiriendo.has(item.tokenId);
  const stats = [];
  if (item.ataque) stats.push(h("span", { class: "st st-atk" }, `+${item.ataque} ATQ`));
  if (item.defensa) stats.push(h("span", { class: "st st-def" }, `+${item.defensa} DEF`));

  return h("article", { class: `item rar-${r.id}${equipado ? " equipado" : ""}`, style: `--rar:${r.color}`, "data-token": item.tokenId },
    h("div", { class: "item-top" },
      h("span", { class: "item-emoji", "aria-hidden": "true" }, E.emojiTipo(item.tipo)),
      h("span", { class: "item-id" }, `#${item.tokenId}`),
    ),
    h("div", { class: "item-nombre" }, item.nombre || "(sin nombre)"),
    h("div", { class: "item-meta" }, h("span", { class: "rar-tag" }, r.nombre), ` · ${item.tipo}`),
    h("div", { class: "item-stats" }, stats),
    equipado && h("div", { class: "item-flag" }, "Equipado"),
    acciones && h("div", { class: "item-acciones" },
      h("button", { class: `btn btn-small ${equipado ? "btn-ghost" : "btn-gold"}`, type: "button", disabled: enviando, onclick: () => alternarEquipo(item) },
        equipado ? "Desequipar" : "Equipar"),
      h("button", { class: "btn btn-small btn-ghost", type: "button", disabled: enviando, onclick: () => abrirTransferencia(item) },
        enviando ? "Enviando…" : "Transferir"),
      enlace(S.links.token(item.tokenId), "Etherscan ↗"),
    ),
  );
}

function renderInventario() {
  INV.renderInventario($("#inv-grid"), inventarioConEquipo(), S.equipo, {
    onEquipar: (it, quiere) => { if (quiere !== E.estaEquipado(S.equipo, it.tokenId)) alternarEquipo(it); },
    onTransferir: (it) => abrirTransferencia(it),
  });
  INV.renderRanuras($("#inv-ranuras"), S.equipo, S.inventario, {
    onDesequipar: (id) => { const it = S.inventario.find((x) => x.tokenId === id); if (it) alternarEquipo(it); },
  });
}

function renderHeroe() {
  const s = statsHeroe();
  const tope = P.statsHeroeTope(S.progreso, equipados());
  const xp = P.infoXp(S.progreso);
  HEROE.renderHeroe($("#seccion-heroe"), {
    stats: { vida: s.vidaMax, ataque: s.ataque, defensa: s.defensa, critico: s.critico, esquiva: s.esquiva },
    statsMax: { vida: tope.vidaMax, ataque: tope.ataque, defensa: tope.defensa },
    nivel: xp.nivel, xp: xp.xp, xpSiguiente: xp.necesaria || 1,
    equipo: S.equipo, inventario: S.inventario,
    apariencia: T.aparienciaActual(),
    cosmeticosPosee: T.cosmeticosPosee(),
    onVestir: (id, ranura) => {
      const ap = { ...T.aparienciaActual(), [ranura]: id ?? null };
      T.cambiarAparienciaExterna(ap);
      FX.actualizarHeroe(equipados(), ap);
      renderHeroe();
    },
  });

  renderProgreso();
  if (!enCurso()) renderLuchadores();
  renderBotones();
}

// ───────────────────────── Transferencia ─────────────────────────

let itemATransferir = null;

function abrirTransferencia(item) {
  if (item.local) return toast("Los objetos del modo demo solo existen en este navegador: no se pueden transferir.", "info");
  if (!S.contratoOk) return toast("Conecta la wallet a la red correcta para transferir.", "error");
  itemATransferir = item;
  $("#tr-item").replaceChildren(tarjetaItem(item, { acciones: false }));
  $("#tr-to").value = "";
  $("#tr-error").textContent = "";
  $("#dlg-transfer").showModal();
  $("#tr-to").focus();
}

async function confirmarTransferencia(ev) {
  ev.preventDefault();
  const item = itemATransferir;
  const to = $("#tr-to").value.trim();
  const err = $("#tr-error");
  if (!S.ethers.isAddress(to)) { err.textContent = "Dirección no válida (0x + 40 caracteres hexadecimales, checksum correcto)."; return; }
  if (to.toLowerCase() === ZERO_ADDRESS) { err.textContent = "No puedes enviar a la dirección cero."; return; }
  if (to.toLowerCase() === S.cuenta.toLowerCase()) { err.textContent = "Esa es tu propia dirección."; return; }
  $("#dlg-transfer").close();

  const from = S.cuenta;
  S.transfiriendo.add(item.tokenId);
  renderInventario();
  try {
    toast("Confirma la transferencia en MetaMask…", "info");
    const gas = await GAS.asegurarGas({ provider: S.provider, cuenta: from, serverUrl: S.cfg.serverUrl, onEstado: (m) => m && toast(m, "info", 4000) });
    if (!gas.ok) { toast(gas.mensaje || "No tienes ETH de Sepolia para el gas.", "error", 8000); return; }
    const tx = await transferir(S.provider, S.contrato, from, S.ethers.getAddress(to), item.tokenId);
    toast(h("span", {}, "Transferencia enviada. Esperando confirmación… ", enlace(S.links.tx(tx.hash), "ver tx ↗")), "info", 8000);
    await tx.wait();
    S.equipo = E.desequipar(S.equipo, item.tokenId);
    guardarEquipo();
    toast(h("span", {}, `✔ «${item.nombre}» enviado a ${acortar(to)}. `, enlace(S.links.tx(tx.hash), "Etherscan ↗")), "ok", 9000);
  } catch (e) {
    toast(`Transferencia fallida: ${W.mensajeError(e)}`, "error", 8000);
  } finally {
    S.transfiriendo.delete(item.tokenId);
    await cargarInventario();
  }
}

// ───────────────────────── Combate: pintado ─────────────────────────

function pintarHud(el, { nombre, extra, vida, vidaMax, stats, vacio }) {
  el.classList.toggle("vacio", !!vacio);
  el.querySelector(".f-name").replaceChildren(nombre, extra ?? "");
  el.querySelector(".hp").hidden = !!vacio;
  el.querySelector(".f-stats").textContent = stats;
  if (!vacio) FX.actualizarVida(el.dataset.lado, vida, vidaMax);
}

function renderLuchadores() {
  const c = S.combate;
  const s = statsHeroe();
  const j = c && c.fase !== "huida" ? c.jugador : { vida: s.vidaMax, vidaMax: s.vidaMax, ataque: s.ataque, defensa: s.defensa, furia: 0 };
  pintarHud($("#f-jugador"), {
    nombre: "Tu héroe", extra: h("span", { class: "nv" }, ` Nv. ${P.infoXp(S.progreso).nivel}`),
    vida: j.vida, vidaMax: j.vidaMax, stats: `⚔️ ${j.ataque} · 🛡️ ${j.defensa}`,
  });
  FX.actualizarFuria(j.furia ?? 0);
  const en = c?.enemigo;
  const fEn = $("#f-enemigo");
  if (!en || c.fase === "huida") {
    pintarHud(fEn, { nombre: "Arena vacía", vacio: true, stats: "Pulsa Explorar para encontrar un rival" });
  } else {
    pintarHud(fEn, {
      nombre: en.nombre,
      extra: h("span", { class: "nv" }, ` ${en.jefe ? "👑 JEFE · " : ""}Nv. ${en.nivel}`),
      vida: Math.max(0, en.vida), vidaMax: en.vidaMax, stats: `⚔️ ${en.ataque} · 🛡️ ${en.defensa}${en.rasgo ? ` · ${en.rasgo}` : ""}`,
    });
  }
}

function renderBotones() {
  const lucha = enCurso();
  const libre = lucha && !S.animando;
  $("#btn-explorar").disabled = lucha || S.animando;
  $("#btn-atacar").disabled = !libre;
  $("#btn-defender").disabled = !libre;
  $("#btn-huir").disabled = !libre;

  const pBtn = $("#btn-pocion");
  const pociones = lucha ? S.combate.jugador.pociones : (S.expedicion ? S.expedicion.pociones + S.expedicion.pocionesExtra : C.POCIONES_POR_EXPEDICION + T.pocionesExtra());
  // `replaceChildren` y no `textContent`: este botón lleva también la etiqueta de atajo de
  // teclado (`.tecla`), que `textContent =` borraría en cada repintado.
  pBtn.replaceChildren(`🧪 Poción ×${pociones}`, tecla("0"));
  pBtn.disabled = !libre || !(lucha && S.combate.jugador.pociones > 0) || S.combate.jugador.vida >= S.combate.jugador.vidaMax;

  const habs = lucha
    ? Sk.habilidadesDisponibles({ habilidades: S.combate.jugador.habilidades })
    : Sk.habilidadesDisponibles({ habilidades: statsHeroe().habilidades });
  // Atajos de teclado 3-9 para las habilidades, en el mismo orden en que se pintan (ver `alTecla`).
  $("#skills").replaceChildren(...habs.map((hb, i) => {
    const b = h("button", {
      class: `btn btn-skill${hb.especial ? " legendaria" : ""}`, type: "button",
      title: `${hb.nombre}: ${hb.descripcion}${hb.restante ? ` (listo en ${hb.restante})` : ""}`,
      "data-restante": hb.restante || null,
      style: hb.restante ? `--cd:${(hb.restante / hb.enfriamiento).toFixed(2)}` : null,
      disabled: !libre || hb.restante > 0,
      onclick: () => accion({ habilidad: hb.id }),
    }, `${hb.icono} ${hb.nombre}`, i < 7 ? tecla(String(i + 3)) : null);
    return b;
  }));

  const remBtn = $("#btn-rematar");
  if (remBtn) {
    const lista = lucha && S.combate.jugador.furia >= C.FURIA_MAX;
    remBtn.hidden = !lucha;
    remBtn.disabled = !libre || !lista;
    remBtn.classList.toggle("lista", lista);
  }
}

/** Etiqueta `[N]` en la esquina de un botón, para que se vea qué tecla lo activa. */
function tecla(n) {
  return h("span", { class: "tecla", "aria-hidden": "true" }, n);
}

function añadirLog(eventos) {
  const log = $("#log");
  for (const ev of eventos) log.append(h("li", { class: `log-${ev.actor} log-${ev.tipo}` }, ev.texto));
  while (log.children.length > 80) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
}

function aplicarSnapshot(ev, c) {
  if (ev.vidas) {
    FX.actualizarVida("heroe", Math.max(0, ev.vidas.jugador), c.jugador.vidaMax);
    FX.actualizarVida("enemigo", Math.max(0, ev.vidas.enemigo), c.enemigo.vidaMax);
  }
  if (ev.estados) {
    FX.mostrarEstado("heroe", ev.estados.jugador ?? []);
    FX.mostrarEstado("enemigo", ev.estados.enemigo ?? []);
  }
  if (ev.furia != null) FX.actualizarFuria(ev.furia);
}

/** Color del pulso de `FX.animarApoyo` según el estado que se aplica (mismo código que `.est-*`
 * en style.css, para que combine con el icono de estado que aparece justo después). */
const COLOR_ESTADO_FX = {
  veneno: "#65d837", sangrado: "#dc2626", aturdido: "#fde047",
  escudo: "#3b82f6", furia: "#f97316", reflejo: "#a78bfa", evasion: "#5eead4",
};

/** Anima un evento del motor de combate con la capa de efectos. */
async function animarEvento(ev, c) {
  const golpe = ev.dano != null && ev.objetivo && ["ataque", "habilidad", "contraataque", "reflejo", "robo", "remate"].includes(ev.tipo);
  if (golpe && ev.actor !== "sistema" && ev.actor !== ev.objetivo) {
    // `animacion` le dice a cada motor qué gesto toca (morder, embestir, escupir fuego, conjurar,
    // saltar y machacar, el doble tajo en cruz…); si no lo reconoce, usa el embate genérico.
    await FX.animarAtaque(quienFx(ev.actor), {
      critico: !!ev.critico,
      brutal: !!(ev.brutal || ev.definitiva),
      animacion: C.animacion3d(ev.id),
    });
    await FX.animarGolpe(quienFx(ev.objetivo), ev.dano, { critico: !!ev.critico, bloqueado: !!ev.bloqueado, esquivado: !!ev.esquivado, fallo: !!ev.fallo });
  } else if (ev.dano != null && ev.objetivo) {
    await FX.animarGolpe(quienFx(ev.objetivo), ev.dano, { critico: !!ev.critico, bloqueado: !!ev.bloqueado, esquivado: !!ev.esquivado, fallo: !!ev.fallo });
  }
  if (ev.curacion) FX.animarCuracion(quienFx(ev.objetivo ?? ev.actor), ev.curacion);
  const defensa = ev.tipo === "defensa" && typeof FX.animarDefensa === "function";
  if (defensa) await FX.animarDefensa(quienFx(ev.actor));
  // Habilidad que el actor se aplica a sí mismo (Grito de guerra y cualquier otro buff puro): no
  // trae `dano` ni `curacion`, así que sin esto caía en la espera genérica de abajo sin animarse.
  const apoyo = !golpe && ev.dano == null && !ev.curacion && !defensa
    && ev.actor === ev.objetivo && !!ev.estado && typeof FX.animarApoyo === "function";
  if (apoyo) {
    await FX.animarApoyo(quienFx(ev.actor), {
      animacion: C.animacion3d(ev.id),
      color: ev.id === "grito_guerra" ? "#f6d27c" : (COLOR_ESTADO_FX[ev.estado.tipo] ?? "#f6d27c"),
    });
  }
  aplicarSnapshot(ev, c);
  añadirLog([ev]);
  if (ev.remate) { FX.sonar("remate"); FX.sacudir(18, 500); }
  if (ev.tipo === "fase") {
    FX.anunciar("¡FASE 2!", c.enemigo.nombre, "anuncio-jefe");
    FX.sonar("rugido");
    $("#f-enemigo .retrato")?.classList.add("jefe-furioso");
  }
  // `animarVictoriaHeroe` solo existe en el motor 3D (escena3d.js): el héroe alza espada y
  // escudo, llueve confeti dorado y suena la fanfarria. En 2D (fx.js) no hace nada especial, así
  // que se llama con encadenado opcional y sin esperar: es puro espectáculo.
  if (ev.tipo === "victoria") { FX.animarMuerte("enemigo"); FX.animarVictoriaHeroe?.(); }
  if (ev.tipo === "derrota") FX.animarMuerte("heroe");
  if (!golpe && ev.dano == null && !ev.curacion && !defensa && !apoyo) await esperar(FX.reducido() ? 80 : 260);
}

// ───────────────────────── Combate: flujo ─────────────────────────

function nuevaExpedicion() {
  S.expedicion = { pociones: C.POCIONES_POR_EXPEDICION + S.pocionesRegalo, pocionesExtra: T.pocionesExtra(), extraGastadas: 0 };
  S.pocionesRegalo = 0;
}

async function terminarExpedicion() {
  const n = S.expedicion?.extraGastadas ?? 0;
  S.expedicion = null;
  if (n > 0) {
    toast(`Usaste ${n} poción(es) extra de la tienda: confirma en MetaMask para gastarlas.`, "info", 7000);
    await T.gastarPociones(n);
  }
}

function explorar() {
  if (enCurso() || S.animando) return;
  if (!S.expedicion) nuevaExpedicion();
  const v = S.progreso.victorias;
  const racha = S.progreso.racha;
  // Jefe de nivel (de siempre, por victorias totales) o Jefe de Arena (nuevo, por racha: cada
  // 5 victorias CONSECUTIVAS). Los dos dan jefe con 2 fases y ataques telegrafiados (combat.js);
  // el de racha además garantiza botín Raro/Legendario (ver pedirBotin).
  const jefeNivel = C.esCombateDeJefe(v);
  const jefeDeRacha = C.esJefeDeRacha(racha);
  const jefe = jefeNivel || jefeDeRacha;
  const nivelA = C.nivelArena(v);
  // Los dos primeros combates son de nivel 1 para que el jugador nuevo aprenda sin frustrarse.
  const nivel = jefe || v < 2 ? nivelA : C.nivelEnemigo(nivelA);
  const base = TUT.tutorialActivo() ? TUT.combateTutorial()
    : C.generarEnemigo(nivel, Math.random, { jefe, evitarClave: S.ultimoEnemigoClave });
  S.ultimoEnemigoClave = base.clave;
  // A mayor racha, más duro el rival (vida, ataque y potencia de sus estados), sin techo.
  const enemigo = C.escalarPorRacha(base, racha, { jefeDeRacha });
  const heroeBase = { ...statsHeroe(), pociones: S.expedicion.pociones, pocionesExtra: S.expedicion.pocionesExtra };
  const heroe = C.aplicarModificadoresArena(heroeBase, S.modificadoresArena);
  S.combate = C.crearCombate(heroe, enemigo);
  $("#resultado").hidden = true;
  $("#log").replaceChildren();
  añadirLog(S.combate.log);
  FX.revivir("heroe");
  FX.actualizarHeroe(equipados());
  FX.mostrarEstado("heroe", []);
  FX.mostrarEnemigo(enemigo);
  $("#f-enemigo .retrato")?.classList.remove("jefe-furioso");
  FX.mostrarIntencion(C.intencionEnemigo(S.combate));
  renderLuchadores();
  renderBotones();
  TUT.avanzarTutorial("explorar");
}

async function accion(tipo) {
  if (S.animando || !enCurso()) return;
  const v = C.validarAccion(S.combate, tipo);
  if (!v.ok) return toast(v.motivo, "info", 2500);
  S.animando = true;
  FX.mostrarIntencion(null);
  renderBotones();
  let res;
  try {
    res = C.turnoJugador(S.combate, tipo, S.desafio?.rng ?? Math.random);
  } catch (e) {
    S.animando = false;
    renderBotones();
    return toast(e.message, "error");
  }
  const { combate, eventos, fin } = res;
  if (tipo === "atacar") TUT.avanzarTutorial("ataque");
  else if (tipo && typeof tipo === "object" && tipo.habilidad) TUT.avanzarTutorial("habilidad");
  try {
    for (const ev of eventos) await animarEvento(ev, combate);
  } catch (e) {
    console.warn("[fx]", e);
  }
  S.combate = combate;
  S.animando = false;
  renderLuchadores();
  FX.mostrarIntencion(C.intencionEnemigo(combate));
  renderBotones();
  if (fin) await alTerminar(fin);
}

function huir() {
  if (!enCurso() || S.animando) return;
  S.combate = C.huir(S.combate);
  añadirLog([S.combate.log.at(-1)]);
  alTerminar("huida");
}

/**
 * Atajos de teclado de la arena: 1 Atacar, 2 Defender, 3-9 las habilidades en el orden en que se
 * pintan (coincide con la etiqueta `[N]` que lleva cada botón) y 0 la Poción.
 * Se ignoran si se está escribiendo en un campo, con alguna tecla modificadora, fuera de la
 * sección de la arena o con un diálogo abierto, para no robarle teclas a nada más de la página.
 */
function alTecla(ev) {
  if (ev.defaultPrevented || ev.repeat || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  const t = ev.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
  if ($("#dlg-transfer")?.open) return;
  if ($("#seccion-arena")?.hidden) return;
  const k = ev.key;
  let btn = null;
  if (k === "1") btn = $("#btn-atacar");
  else if (k === "2") btn = $("#btn-defender");
  else if (k === "0") btn = $("#btn-pocion");
  else if (/^[3-9]$/.test(k)) btn = $("#skills")?.querySelectorAll(".btn-skill")[Number(k) - 3] ?? null;
  if (!btn || btn.disabled) return;
  ev.preventDefault();
  btn.click();
}

function resultado(...contenido) {
  const r = $("#resultado");
  r.replaceChildren(...contenido.flat().filter(Boolean));
  r.hidden = false;
}

async function alTerminar(fin) {
  const c = S.combate;
  if (S.desafio) return terminarDesafioActual(fin);
  if (fin === "derrota" && S.progreso.racha > 0 && puedeSalvarRachaConAnuncio() && await ofrecerSalvarRacha(c, S.progreso.racha)) return;
  ENG.registrarCombate(c);
  const restantes = C.pocionesRestantes(c);
  if (S.expedicion) {
    S.expedicion.pociones = restantes.pociones;
    S.expedicion.pocionesExtra = restantes.pocionesExtra;
    S.expedicion.extraGastadas += restantes.extraGastadas;
  }
  FX.mostrarIntencion(null);
  renderLuchadores();
  renderBotones();
  const resumen = { ...c.resumen, enemigo: c.enemigo.nombre };

  if (fin === "victoria") {
    const nivelAntes = P.infoXp(S.progreso).nivel;
    const r = P.aplicarVictoria(S.progreso, c.enemigo);
    S.progreso = r.progreso;
    // Jefe vencido (de nivel o de racha): los Modificadores de Arena en juego se vacían.
    if (c.enemigo.jefe) { S.modificadoresArena = []; EMO.capturarPico("jefe_vencido"); }
    guardarProgreso();
    renderHeroe();
    const nivelAhora = P.infoXp(S.progreso).nivel;
    if (r.subioNivel || nivelAhora !== nivelAntes) { FX.subidaDeNivel(nivelAhora); ENG.registrarEvento({ tipo: "nivel", valor: nivelAhora }); }
    ENG.registrarEvento({ tipo: "racha", valor: r.racha });
    // El botín se pide ya (el servidor tarda unos segundos en mintear) mientras se ve el resumen.
    const botin = pedirBotin(c.enemigo);
    const eleccion = await FX.mostrarResultado({ tipo: "victoria", ...resumen, xp: r.xp, racha: r.racha, jefe: !!c.enemigo.jefe });
    // El modificador se ofrece ANTES de `mostrarBotin`: si `eleccion` es "otra", ese paso ya
    // encadena el siguiente combate (ver más abajo), así que hay que elegir ahora para que el
    // modificador llegue a tiempo y se aplique en `explorar()` a la próxima pelea.
    if (r.racha > 0 && r.racha % C.MODIFICADOR_ARENA_CADA === 0) await ofrecerModificadorArena(r.racha);
    await mostrarBotin(await botin, eleccion);
    return;
  }

  if (fin === "derrota") {
    const perdiaRacha = S.progreso.racha > 0;
    S.progreso = P.aplicarDerrota(S.progreso);
    if (perdiaRacha) EMO.capturarPico("racha_perdida");
  } else S.progreso = P.aplicarHuida(S.progreso);
  // La racha se rompe: con ella se acaban los Modificadores de Arena en juego.
  S.modificadoresArena = [];
  guardarProgreso();
  renderHeroe();
  await terminarExpedicion();
  renderBotones();
  const eleccion = await FX.mostrarResultado({ tipo: fin, ...resumen, racha: 0 });
  if (fin === "derrota") resultado(h("div", { class: "res res-derrota" }, h("strong", {}, "☠️ Derrota. "), "Tu racha se rompe y la expedición termina. Mejora tu equipo, compra pociones en la tienda y vuelve a Explorar."));
  if (eleccion === "otra") explorar();
  else await EMO.mostrarResumenSesion();
}

// ───────────────────────── Modificadores de Arena (bendiciones/maldiciones) ─────────────────────────
// Cada C.MODIFICADOR_ARENA_CADA victorias consecutivas se ofrece elegir uno de dos Modificadores
// de Arena (combat.js: MODIFICADORES_ARENA); el elegido se suma a `S.modificadoresArena` y se
// aplica a las stats del héroe en `explorar()` (combat.aplicarModificadoresArena) hasta vencer al
// siguiente Jefe de Arena, momento en el que `alTerminar` los vacía.

/**
 * Pantalla de elección rápida entre 2 Modificadores de Arena. No bloquea si no hay nada que
 * ofrecer (no debería pasar: `elegirModificadoresArena` siempre devuelve 2 salvo catálogo vacío).
 * @param {number} racha racha actual, solo para el texto
 */
async function ofrecerModificadorArena(racha) {
  const opciones = C.elegirModificadoresArena(Math.random, S.modificadoresArena);
  if (opciones.length < 2) return;
  const elegido = await new Promise((resolver) => {
    resultado(h("div", { class: "res res-modificador" },
      h("strong", {}, `🌀 ¡Racha de ${racha}! Elige un Modificador de Arena`),
      h("p", { class: "res-modificador-sub" }, "Se queda activo hasta que venzas al próximo Jefe de Arena."),
      h("div", { class: "res-modificador-opciones" }, ...opciones.map((m) => h("button", {
        class: "btn btn-small mod-card", type: "button", title: m.descripcion,
        onclick: (ev) => { ev.currentTarget.disabled = true; resolver(m); },
      },
        h("span", { class: "mod-card-icono", "aria-hidden": "true" }, m.icono),
        h("span", { class: "mod-card-nombre" }, m.nombre),
        h("span", { class: "mod-card-desc" }, m.descripcion))))));
  });
  if (!S.modificadoresArena.includes(elegido.id)) S.modificadoresArena = [...S.modificadoresArena, elegido.id];
  toast(`${elegido.icono} ${elegido.nombre} activo hasta el próximo Jefe de Arena.`, "info", 4500);
  renderProgreso();
  $("#resultado").hidden = true;
}

// ───────────────────────── Racha: salvar con anuncio ─────────────────────────
// Al perder en la Arena con una racha en juego, se ofrece ver un anuncio recompensado para
// revivir en el MISMO combate con el 50 % de vida (combat.js: revivirEnArena) y no perder la
// racha. Solo una vez por sesión de navegador (antes era "revivir en la Torre"; la Torre ya no existe).

const CLAVE_ANUNCIO_RACHA = "lootarena:anuncio-racha-usado";

function puedeSalvarRachaConAnuncio() {
  try { return sessionStorage.getItem(CLAVE_ANUNCIO_RACHA) !== "1"; } catch { return true; }
}

function marcarAnuncioRachaUsado() {
  try { sessionStorage.setItem(CLAVE_ANUNCIO_RACHA, "1"); } catch { /* sin storage */ }
}

/**
 * Ofrece salvar la racha viendo un anuncio tras una derrota. Si el jugador acepta y el
 * anuncio se completa, revive en el mismo combate y la función devuelve true (el llamador
 * no debe seguir con el flujo normal de derrota). Si rechaza o el anuncio falla, devuelve
 * false y el combate original sigue en fase "derrota" para que el flujo normal continúe.
 * @param {object} c combate en fase "derrota"
 * @param {number} racha racha que se perdería
 * @returns {Promise<boolean>}
 */
async function ofrecerSalvarRacha(c, racha) {
  const quiere = await new Promise((resolver) => {
    resultado(h("div", { class: "res res-derrota" },
      h("strong", {}, "☠️ Derrota. "), `Vas a perder tu racha de ${racha} victoria${racha === 1 ? "" : "s"}.`,
      h("div", { class: "res-acciones" },
        h("button", { class: "btn btn-small btn-gold", type: "button", onclick: (ev) => { ev.currentTarget.disabled = true; resolver(true); } },
          "📺 Ver anuncio para salvar tu racha"),
        h("button", { class: "btn btn-small btn-ghost", type: "button", onclick: () => resolver(false) }, "No, continuar"))));
  });
  if (!quiere) return false;
  marcarAnuncioRachaUsado();
  const ok = await mostrarAnuncioRecompensado("revivir_racha");
  if (!ok) { toast("Anuncio no completado: la racha se rompe.", "info"); return false; }
  S.combate = C.revivirEnArena(c);
  toast(`💖 ¡Sigues en pie! Tu racha de ${racha} se mantiene.`, "ok", 3500);
  $("#resultado").hidden = true;
  añadirLog([S.combate.log.at(-1)]);
  FX.revivir("heroe");
  FX.mostrarIntencion(C.intencionEnemigo(S.combate));
  renderLuchadores();
  renderBotones();
  return true;
}

/** Fin del desafío diario: no da botín del servidor; puntúa en el enganche y da XP si se gana. */
async function terminarDesafioActual(fin) {
  const c = S.combate;
  S.desafio = null;
  const r = ENG.terminarDesafio(c);
  let xp = null;
  if (fin === "victoria") {
    const v = P.aplicarVictoria(S.progreso, c.enemigo);
    S.progreso = v.progreso;
    xp = v.xp;
    guardarProgreso();
  }
  renderHeroe();
  const res = r.ok ? r.resultado : null;
  resultado(h("div", { class: `res ${fin === "victoria" ? "res-drop" : "res-derrota"}` },
    h("strong", {}, fin === "victoria" ? "🏅 ¡Desafío superado! " : "⚔️ Desafío terminado. "),
    res ? `Puntuación: ${res.puntuacion}${res.mejorPersonal ? " (¡récord personal!)" : ""}. Vuelve mañana para un desafío nuevo.` : (r.motivo ?? "")));
  const eleccion = await FX.mostrarResultado({ tipo: fin === "victoria" ? "victoria" : fin, ...c.resumen, enemigo: `Desafío · ${c.enemigo.nombre}`, xp: xp ?? undefined });
  if (eleccion === "otra") explorar();
}

// ───────────────────────── Expediciones ─────────────────────────

const claveExp = () => EXP.claveExpedicion(S.cuenta);

function renderExp(resultadoExp = null) {
  const c = $("#expediciones");
  if (!c) return;
  EXP.renderExpediciones(c, {
    estado: EXP.estadoExpedicion(claveExp()),
    resultado: resultadoExp,
    onEnviar: (id) => {
      const r = EXP.enviar(claveExp(), id);
      if (!r.ok) toast(r.mensaje, "info");
      R.marcarAviso("expediciones", false);
      renderExp();
    },
    onRecoger: recogerExp,
    onLista: () => { R.marcarAviso("expediciones", true); renderExp(); },
    onDuplicar: resultadoExp?.ok && !resultadoExp.duplicado ? () => duplicarBotinExp(resultadoExp) : null,
  });
}

async function recogerExp() {
  const r = EXP.recoger(claveExp());
  if (!r.ok) return toast(r.mensaje, "info");
  R.marcarAviso("expediciones", false);
  aplicarRecompensa({ tipo: "xp", xp: r.xp, fuente: "expedicion" });
  if (r.pociones) aplicarRecompensa({ tipo: "pociones", cantidad: r.pociones });
  S.expResultado = r;
  renderExp(r);
  if (r.botin) await reclamarBotinExp(r.botin, { pendiente: true });
}

/**
 * Reclama un botín de expedición (local en demo, POST /ganar con wallet).
 * `pendiente`: es el botín guardado como pendiente en storage (se resuelve al reclamarlo).
 */
async function reclamarBotinExp(botin, { pendiente = false } = {}) {
  const resolver = () => { if (pendiente) EXP.resolverBotin(claveExp()); };
  if (enModoDemo()) {
    resolver();
    const item = tirarBotinDemo(botin);
    if (!item) return;
    ENG.registrarEvento({ tipo: "botin", item });
    await FX.revelarBotin(item);
    await cargarInventario();
    return;
  }
  if (!S.cuenta || !redCorrecta()) return toast("Conecta tu wallet para recibir el botín de la expedición.", "info", 6000);
  const b = await reclamarBotin(S.cfg.serverUrl, S.cuenta, botin.nivel, { jefe: !!botin.jefe });
  if (b.tipo === "drop") {
    resolver();
    ENG.registrarEvento({ tipo: "botin", item: b.item });
    await FX.revelarBotin(b.item);
    await cargarInventario();
  } else if (b.tipo === "sin_drop") {
    resolver();
  } else {
    toast(`${pendiente ? "El botín de la expedición queda pendiente" : "No se pudo entregar el objeto extra"}: ${b.mensaje}`, "info", 6000);
  }
}

/** Anuncio recompensado → otra vez la XP y pociones de la expedición (×2) y un objeto extra. */
function duplicarBotinExp(r) {
  if (!r?.ok || r.duplicado || S.expResultado !== r) return;
  mostrarAnuncioRecompensado("botin_expedicion", async () => {
    if (r.duplicado) return;
    const bono = EXP.bonoDuplicado(r);
    r.duplicado = bono;
    if (bono.xp) aplicarRecompensa({ tipo: "xp", xp: bono.xp, fuente: "expedicion" });
    if (bono.pociones) aplicarRecompensa({ tipo: "pociones", cantidad: bono.pociones });
    renderExp(r);
    await reclamarBotinExp(bono.botin);
  }, (motivo) => {
    if (motivo !== "ocupado") toast("Anuncio no completado: el botín no se duplica.", "info");
    renderExp(r);
  });
}

/**
 * Pide el botín al servidor. Devuelve {tipo, ...} de api.js; sin wallet tira el botín local
 * ({tipo:"demo_drop", item} o {tipo:"demo"} si no cae nada).
 */
async function pedirBotin(enemigo) {
  if (enModoDemo()) {
    const item = tirarBotinDemo(enemigo);
    return item ? { tipo: "demo_drop", item } : { tipo: "demo" };
  }
  if (!redCorrecta()) return { tipo: "demo" };
  S.reclamando = true;
  resultado(h("div", { class: "res res-espera" }, h("span", { class: "spinner" }), enemigo.jefe ? "👑 ¡Jefe derrotado! Forjando su botín en la blockchain…" : "🏆 ¡Victoria! Consultando al servidor si cae botín…"));
  try {
    return await reclamarBotin(S.cfg.serverUrl, S.cuenta, enemigo.nivel, { jefe: !!enemigo.jefe, excluirComun: !!enemigo.jefeDeRacha });
  } finally {
    S.reclamando = false;
  }
}

async function mostrarBotin(r, eleccionPrevia) {
  if (r.tipo !== "drop" && r.tipo !== "demo_drop") TUT.avanzarTutorial("botin");
  const enemigo = S.combate?.enemigo;
  const reintentar = h("button", { class: "btn btn-small btn-gold", type: "button", onclick: async () => mostrarBotin(await pedirBotin(enemigo), "continuar") }, "Reintentar");
  let eleccion = eleccionPrevia;
  switch (r.tipo) {
    case "drop": {
      const urlTx = r.txHash && S.links.tx(r.txHash);
      resultado(h("div", { class: "res res-drop" },
        h("div", {}, h("strong", {}, "🎁 ¡Botín! "), `«${r.item.nombre}», ${E.rareza(r.item.rareza).nombre.toLowerCase()}. Ya es tuyo en la blockchain.`),
        urlTx ? h("div", { class: "res-links" }, enlace(urlTx, "Ver transacción de minteo ↗")) : null));
      ENG.registrarEvento({ tipo: "botin", item: r.item });
      if (enemigo?.jefe) {
        registrarHistorialLocal({
          tipo: "botin", titulo: `Botín de jefe: «${r.item.nombre}»`,
          detalle: [E.rareza(r.item.rareza).nombre], hash: r.txHash ?? null,
        });
      }
      if (r.item.rareza >= 1) EMO.capturarPico("botin_raro");
      eleccion = await FX.revelarBotin(r.item);
      TUT.avanzarTutorial("botin");
      await cargarInventario();
      if (r.txHash && S.provider && !S.inventario.some((it) => it.tokenId === r.tokenId)) {
        try { await S.provider.waitForTransaction(r.txHash, 1, 120_000); } catch { /* seguimos */ }
        await cargarInventario();
      }
      break;
    }
    case "demo_drop":
      resultado(h("div", { class: "res res-drop" },
        h("div", {}, h("strong", {}, "🎁 ¡Botín! "), `«${r.item.nombre}», ${E.rareza(r.item.rareza).nombre.toLowerCase()}. Guardado en este navegador (modo demo): equípalo en tu inventario.`),
        h("div", { class: "tenue" }, W.tieneMetaMask()
          ? ["Conecta tu wallet en Sepolia para que el botín sea un NFT de verdad. ", h("button", { class: "btn btn-small btn-gold", type: "button", onclick: () => conectar() }, "🦊 Conectar")]
          : ["Instala ", enlace("https://metamask.io/download/", "MetaMask"), " para que el botín sea un NFT que puedas vender por ORO."])));
      ENG.registrarEvento({ tipo: "botin", item: r.item });
      if (enemigo?.jefe) {
        registrarHistorialLocal({ tipo: "botin", titulo: `Botín de jefe: «${r.item.nombre}»`, detalle: [E.rareza(r.item.rareza).nombre, "modo demo: guardado en este navegador"] });
      }
      if (r.item.rareza >= 1) EMO.capturarPico("botin_raro");
      eleccion = await FX.revelarBotin(r.item);
      TUT.avanzarTutorial("botin");
      await cargarInventario();
      break;
    case "sin_drop":
      resultado(h("div", { class: "res res-nada" }, h("strong", {}, "🏆 ¡Victoria! "), "Esta vez el enemigo no llevaba nada de valor. ¡Sigue explorando!"));
      break;
    case "demo":
      resultado(h("div", { class: "res res-victoria" },
        h("strong", {}, "🏆 ¡Victoria! "),
        W.tieneMetaMask()
          ? ["Conecta tu wallet en Sepolia para que los enemigos suelten objetos NFT. ",
            h("button", { class: "btn btn-small btn-gold", type: "button", onclick: () => conectar() }, "🦊 Conectar")]
          : ["Modo demo: instala ", enlace("https://metamask.io/download/", "MetaMask"), " para conseguir objetos NFT, venderlos por ORO y personalizar a tu héroe."]));
      break;
    case "limite":
      resultado(h("div", { class: "res res-limite" }, h("strong", {}, "⏳ Calma, guerrero. "), r.mensaje, " ", reintentar));
      break;
    default:
      resultado(h("div", { class: "res res-error" }, h("strong", {}, "❌ No se pudo reclamar el botín. "), r.mensaje, " ", reintentar));
  }
  if (eleccion === "otra") explorar();
  else await EMO.mostrarResumenSesion();
}

// ───────────────────────── Sección Cadena ─────────────────────────

// El contenido lo pone el equipo de blockchain en web/js/cadena/. Aquí solo se carga cuando
// hace falta: son lecturas de la red, y no tienen por qué pasar al arrancar el juego.
let cadenaMod = null;
let cadenaMontada = false;

/** Contexto que recibe la sección. Las funciones leen el estado vivo, no una copia de ahora. */
const ctxCadena = () => ({
  cfg: S.cfg,
  ethers: () => S.ethers,
  provider: () => S.provider,
  cuenta: () => S.cuenta,
  contrato: () => (S.contratoOk ? S.contrato : null),
  redCorrecta,
  toast,
  // Para que «Tu cartera» pueda decir si la cadena y el juego cuadran (fase E1 del plan).
  local: () => ({ oro: S.saldoOro ?? null, objetos: S.inventario?.length ?? null }),
  // Para «Tus transacciones» cuando el RPC no tiene eventos recientes que mostrar.
  historialLocal: () => leerHistorialLocal(),
});

async function montarSeccionCadena() {
  const caja = $("#cadena");
  if (!caja) return;
  if (cadenaMontada) { try { cadenaMod?.refrescarCadena?.(); } catch (e) { console.warn("[cadena]", e); } return; }
  cadenaMontada = true;
  caja.replaceChildren(h("p", { class: "tenue" }, "Leyendo la red…"));
  try {
    cadenaMod = await import("./cadena/index.js");
    await cadenaMod.montarCadena(caja, ctxCadena());
  } catch (e) {
    console.warn("[cadena] no se pudo montar:", e);
    cadenaMontada = false;
    caja.replaceChildren(
      h("p", {}, "No se pudo abrir el explorador de la cadena."),
      h("p", { class: "tenue" }, e?.message ?? String(e)),
      ...(S.links?.contrato ? [h("p", {}, enlace(S.links.contrato, "Ver el contrato en el explorador público") ?? "")] : []),
    );
  }
}

// ───────────────────────── Arranque ─────────────────────────

async function iniciar() {
  EMO.iniciar();
  conectarBoton3D();
  await elegirMotor();
  // Los dos motores exportan `iniciarInterfaz`: el 3D monta su escena y limpia la 2D,
  // así que queda un solo lienzo con cualquiera de los dos.
  FX.iniciarInterfaz({ auto: false });
  cargarProgreso();
  const empezarGuia = () => { if (TUT.iniciarTutorial({ fx: FX })) R.irA("arena"); };
  if ($("#pantalla-portada")?.hidden) empezarGuia();
  else $("#btn-entrar")?.addEventListener("click", () => setTimeout(empezarGuia, 450));
  R.alCambiar(async (sec) => {
    // Hallazgo de Calidad (#11, ALTO): expediciones y cadena pintan su contenido con
    // `replaceChildren` después de que el router ya enfocó el <h2> de la sección; si ese nodo
    // estaba dentro de lo que se repinta, el foco cae a <body> sin que nadie lo note. Solo se
    // devuelve si de verdad se perdió (activeElement === body): si el jugador ya puso el foco
    // en otro sitio (un botón del HUD, p. ej.) no se lo robamos.
    const recuperarFoco = () => {
      if (document.activeElement === document.body) {
        const el = document.getElementById(`seccion-${sec}`);
        if (el) R.enfocarSeccion(el);
      }
    };
    if (sec === "expediciones") { renderExp(); recuperarFoco(); }
    else if (sec === "cadena") { await montarSeccionCadena(); recuperarFoco(); }
  });
  setInterval(() => R.marcarAviso("expediciones", EXP.hayExpedicionLista(claveExp())), 30_000);
  $("#btn-explorar").addEventListener("click", explorar);
  $("#btn-atacar").addEventListener("click", () => accion("atacar"));
  $("#btn-defender").addEventListener("click", () => accion("defender"));
  $("#btn-pocion").addEventListener("click", () => accion("pocion"));
  $("#btn-rematar")?.addEventListener("click", () => accion("rematar"));
  $("#btn-huir").addEventListener("click", huir);
  // Micro-animación de pulsación en cualquier botón de la arena (atacar, defender, poción,
  // habilidades…), venga de un clic o de un atajo de teclado: un solo oyente delegado en vez de
  // uno por botón, porque las habilidades se repintan en cada turno.
  $(".actions")?.addEventListener("click", (ev) => {
    const b = ev.target.closest(".btn");
    if (!b) return;
    b.classList.remove("pulso-activar");
    void b.offsetWidth; // reinicia la animación si se pulsa dos veces seguidas
    b.classList.add("pulso-activar");
  });
  document.addEventListener("keydown", alTecla);
  $("#btn-refrescar").addEventListener("click", cargarInventario);
  $("#btn-connect").addEventListener("click", () => (S.cuenta && !redCorrecta() ? asegurarRed() : conectar()));
  $("#form-transfer").addEventListener("submit", confirmarTransferencia);
  $("#tr-cancel").addEventListener("click", () => $("#dlg-transfer").close());
  $("#tr-to").addEventListener("input", () => { $("#tr-error").textContent = ""; });

  try {
    S.cfg = await cargarConfig();
  } catch (e) {
    banner(`Error cargando la configuración: ${e.message}`, "error");
    $("#net-badge").textContent = "Sin configuración";
    renderHeroe();
    return;
  }
  conectarSelectorRed();
  S.links = enlacesExplorador(S.cfg.net, S.cfg.address);
  // Despierta el servidor de botín (Render free se duerme) mientras el jugador combate.
  // De paso se mira si el indexador del ranking está atascado (1.4.1 de equipo-servidor):
  // así se nota desde el juego, sin entrar en los logs de Render. Solo avisa si hay algo mal;
  // con todo sano no aparece nada.
  fetch(`${S.cfg.serverUrl}/health`, { cache: "no-store" })
    .then((r) => r.json())
    .then((j) => {
      if (j?.indexador?.atascado) {
        toast("El ranking de jugadores tarda en ponerse al día (problema del servidor, no tuyo). El resto del juego funciona bien.", "info", 8000);
      }
    })
    .catch(() => {});

  renderCabecera();
  renderHeroe();
  // El router ya arrancó, así que si la sección recordada es Cadena su aviso de cambio ya pasó.
  if (R.seccionActual() === "cadena") montarSeccionCadena();
  añadirLog([{ actor: "sistema", tipo: "inicio", texto: "Bienvenido a Loot Arena. Pulsa Explorar para buscar un rival. Cada 5.º combate de un nivel aparece un jefe 👑." }]);

  if (W.tieneMetaMask()) {
    W.escuchar({ onCuentas: alCambiarCuentas, onRed: alCambiarRed });
    try {
      const cuentas = await W.cuentasAutorizadas();
      if (cuentas.length) { await alCambiarCuentas(cuentas); return; }
    } catch (e) {
      toast(W.mensajeError(e), "error");
    }
  }
  await cargarInventario();
  await montarEconomia();
}

iniciar();
