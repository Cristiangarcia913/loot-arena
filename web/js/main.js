// Orquestación de Loot Arena 1.1: wallet, combate (combat/skills/progression), efectos (fx),
// botín del servidor, inventario NFT y economía (tienda/venta/vestuario).
import { cargarConfig, ZERO_ADDRESS } from "../config/config.js";
import * as C from "./combat.js";
import * as E from "./equipment.js";
import * as P from "./progression.js";
import * as Sk from "./skills.js";
import * as W from "./wallet.js";
import * as FX from "./fx.js";
import * as T from "./tienda.js";
import { reclamarBotin } from "./api.js";
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
  transfiriendo: new Set(),
  links: { tx: () => null, token: () => null },
};

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

  if (!W.tieneMetaMask()) {
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
  const v = S.progreso.victorias;
  $("#arena-level").textContent = `Nivel de arena ${C.nivelArena(v)}`;
  const faltan = P.combatesHastaJefe(v);
  $("#victorias").textContent = `${v} victoria${v === 1 ? "" : "s"} · ${faltan === 0 ? "👑 ¡jefe!" : `jefe en ${faltan + 1}`}`;
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
      onVendido: async () => { await cargarInventario(); },
      onCambioApariencia: (ap) => FX.actualizarHeroe(equipados(), ap),
    });
  } catch (e) {
    console.warn("[economía]", e);
  }
  if (id !== montajeEco) return;
  FX.actualizarHeroe(equipados(), T.aparienciaGuardada(S.cuenta));
  renderInventario();
}

// ───────────────────────── Equipo e inventario ─────────────────────────

function cargarEquipo() {
  S.equipo = S.cuenta ? E.parsearEquipo(leer(E.claveEquipo(S.cuenta, S.chainId))) : {};
}

function guardarEquipo() {
  if (S.cuenta) guardar(E.claveEquipo(S.cuenta, S.chainId), JSON.stringify(S.equipo));
}

const equipados = () => E.itemsEquipados(S.equipo, S.inventario);
const inventarioConEquipo = () => S.inventario.map((it) => ({ ...it, equipado: E.estaEquipado(S.equipo, it.tokenId) }));
const statsHeroe = () => P.statsHeroe(S.progreso, equipados());

let cargaInvId = 0;
async function cargarInventario() {
  const id = ++cargaInvId;
  const estado = $("#inv-estado");
  $("#btn-refrescar").disabled = !S.contratoOk;

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

function alCambiarInventario() {
  T.actualizarInventario(inventarioConEquipo());
  FX.actualizarHeroe(equipados());
  renderInventario();
  renderHeroe();
}

function alternarEquipo(item) {
  S.equipo = E.estaEquipado(S.equipo, item.tokenId) ? E.desequipar(S.equipo, item.tokenId) : E.equipar(S.equipo, item);
  guardarEquipo();
  alCambiarInventario();
  if (enCurso()) toast("El nuevo equipo se aplicará en el próximo combate.", "info", 3000);
}

function tarjetaItem(item, { acciones = true } = {}) {
  const r = E.rareza(item.rareza);
  const equipado = E.estaEquipado(S.equipo, item.tokenId);
  const enviando = S.transfiriendo.has(item.tokenId);
  const stats = [];
  if (item.ataque) stats.push(h("span", { class: "st st-atk" }, `+${item.ataque} ATQ`));
  if (item.defensa) stats.push(h("span", { class: "st st-def" }, `+${item.defensa} DEF`));
  const vender = acciones && !equipado && !enviando ? T.botonVender(item) : null;

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
      vender,
      h("button", { class: "btn btn-small btn-ghost", type: "button", disabled: enviando, onclick: () => abrirTransferencia(item) },
        enviando ? "Enviando…" : "Transferir"),
      enlace(S.links.token(item.tokenId), "Etherscan ↗"),
    ),
  );
}

function renderInventario() {
  $("#inventario").replaceChildren(...E.ordenarInventario(S.inventario, S.equipo).map((it) => tarjetaItem(it)));
}

function renderHeroe() {
  const s = statsHeroe();
  const bonus = (n) => (n ? h("small", { class: "bonus" }, ` (+${n})`) : null);
  const pct = (x) => `${Math.round(x * 100)} %`;
  $("#stats").replaceChildren(
    h("div", { class: "stat" }, h("span", { class: "stat-ico" }, "❤️"), h("span", { class: "stat-lbl" }, "Vida"), h("b", {}, String(s.vidaMax))),
    h("div", { class: "stat" }, h("span", { class: "stat-ico" }, "⚔️"), h("span", { class: "stat-lbl" }, "Ataque"), h("b", {}, String(s.ataque), bonus(s.bonusAtaque))),
    h("div", { class: "stat" }, h("span", { class: "stat-ico" }, "🛡️"), h("span", { class: "stat-lbl" }, "Defensa"), h("b", {}, String(s.defensa), bonus(s.bonusDefensa))),
    h("div", { class: "stat" }, h("span", { class: "stat-ico" }, "💥"), h("span", { class: "stat-lbl" }, "Crítico"), h("b", {}, pct(s.critico))),
    h("div", { class: "stat" }, h("span", { class: "stat-ico" }, "💨"), h("span", { class: "stat-lbl" }, "Esquiva"), h("b", {}, pct(s.esquiva))),
  );

  const porId = new Map(S.inventario.map((it) => [it.tokenId, it]));
  $("#slots").replaceChildren(...E.TIPOS.map((tipo) => {
    const it = porId.get(S.equipo[tipo]);
    const r = it && E.rareza(it.rareza);
    return h("li", { class: `slot${it ? " lleno" : ""}`, style: it ? `--rar:${r.color}` : null },
      h("span", { class: "slot-ico", "aria-hidden": "true" }, E.emojiTipo(tipo)),
      h("span", { class: "slot-tipo" }, tipo),
      h("span", { class: "slot-item" }, it ? it.nombre : "— vacío —"),
    );
  }));

  renderProgreso();
  if (!enCurso()) renderLuchadores();
  renderBotones();
}

// ───────────────────────── Transferencia ─────────────────────────

let itemATransferir = null;

function abrirTransferencia(item) {
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
  const j = c && c.fase !== "huida" ? c.jugador : { vida: s.vidaMax, vidaMax: s.vidaMax, ataque: s.ataque, defensa: s.defensa };
  pintarHud($("#f-jugador"), {
    nombre: "Tu héroe", extra: h("span", { class: "nv" }, ` Nv. ${P.infoXp(S.progreso).nivel}`),
    vida: j.vida, vidaMax: j.vidaMax, stats: `⚔️ ${j.ataque} · 🛡️ ${j.defensa}`,
  });
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
  pBtn.textContent = `🧪 Poción ×${pociones}`;
  pBtn.disabled = !libre || !(lucha && S.combate.jugador.pociones > 0) || S.combate.jugador.vida >= S.combate.jugador.vidaMax;

  const habs = lucha
    ? Sk.habilidadesDisponibles({ habilidades: S.combate.jugador.habilidades })
    : Sk.habilidadesDisponibles({ habilidades: statsHeroe().habilidades });
  $("#skills").replaceChildren(...habs.map((hb) => {
    const b = h("button", {
      class: `btn btn-skill${hb.especial ? " legendaria" : ""}`, type: "button",
      title: `${hb.nombre}: ${hb.descripcion}${hb.restante ? ` (listo en ${hb.restante})` : ""}`,
      "data-restante": hb.restante || null,
      style: hb.restante ? `--cd:${(hb.restante / hb.enfriamiento).toFixed(2)}` : null,
      disabled: !libre || hb.restante > 0,
      onclick: () => accion({ habilidad: hb.id }),
    }, `${hb.icono} ${hb.nombre}`);
    return b;
  }));
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
}

/** Anima un evento del motor de combate con la capa de efectos. */
async function animarEvento(ev, c) {
  const golpe = ev.dano != null && ev.objetivo && ["ataque", "habilidad", "contraataque", "reflejo", "robo"].includes(ev.tipo);
  if (golpe && ev.actor !== "sistema" && ev.actor !== ev.objetivo) {
    await FX.animarAtaque(quienFx(ev.actor), { critico: !!ev.critico, brutal: !!(ev.brutal || ev.definitiva) });
    await FX.animarGolpe(quienFx(ev.objetivo), ev.dano, { critico: !!ev.critico, bloqueado: !!ev.bloqueado, esquivado: !!ev.esquivado });
  } else if (ev.dano != null && ev.objetivo) {
    await FX.animarGolpe(quienFx(ev.objetivo), ev.dano, { critico: !!ev.critico, bloqueado: !!ev.bloqueado, esquivado: !!ev.esquivado });
  }
  if (ev.curacion) FX.animarCuracion(quienFx(ev.objetivo ?? ev.actor), ev.curacion);
  aplicarSnapshot(ev, c);
  añadirLog([ev]);
  if (ev.tipo === "fase") FX.anunciar("¡FASE 2!", c.enemigo.nombre, "anuncio-jefe");
  if (ev.tipo === "victoria") FX.animarMuerte("enemigo");
  if (ev.tipo === "derrota") FX.animarMuerte("heroe");
  if (!golpe && ev.dano == null && !ev.curacion) await esperar(FX.reducido() ? 80 : 260);
}

// ───────────────────────── Combate: flujo ─────────────────────────

function nuevaExpedicion() {
  S.expedicion = { pociones: C.POCIONES_POR_EXPEDICION, pocionesExtra: T.pocionesExtra(), extraGastadas: 0 };
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
  const jefe = C.esCombateDeJefe(v);
  const nivelA = C.nivelArena(v);
  // Los dos primeros combates son de nivel 1 para que el jugador nuevo aprenda sin frustrarse.
  const nivel = jefe || v < 2 ? nivelA : C.nivelEnemigo(nivelA);
  const enemigo = C.generarEnemigo(nivel, Math.random, { jefe });
  const heroe = { ...statsHeroe(), pociones: S.expedicion.pociones, pocionesExtra: S.expedicion.pocionesExtra };
  S.combate = C.crearCombate(heroe, enemigo);
  $("#resultado").hidden = true;
  $("#log").replaceChildren();
  añadirLog(S.combate.log);
  FX.revivir("heroe");
  FX.actualizarHeroe(equipados());
  FX.mostrarEstado("heroe", []);
  FX.mostrarEnemigo(enemigo);
  FX.mostrarIntencion(C.intencionEnemigo(S.combate));
  renderLuchadores();
  renderBotones();
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
    res = C.turnoJugador(S.combate, tipo);
  } catch (e) {
    S.animando = false;
    renderBotones();
    return toast(e.message, "error");
  }
  const { combate, eventos, fin } = res;
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

function resultado(...contenido) {
  const r = $("#resultado");
  r.replaceChildren(...contenido.flat().filter(Boolean));
  r.hidden = false;
}

async function alTerminar(fin) {
  const c = S.combate;
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
    guardarProgreso();
    renderHeroe();
    if (r.subioNivel) FX.subidaDeNivel(P.infoXp(S.progreso).nivel);
    else if (P.infoXp(S.progreso).nivel !== nivelAntes) FX.subidaDeNivel(P.infoXp(S.progreso).nivel);
    // El botín se pide ya (el servidor tarda unos segundos en mintear) mientras se ve el resumen.
    const botin = pedirBotin(c.enemigo);
    const eleccion = await FX.mostrarResultado({ tipo: "victoria", ...resumen, xp: r.xp, racha: r.racha });
    await mostrarBotin(await botin, eleccion);
    return;
  }

  if (fin === "derrota") S.progreso = P.aplicarDerrota(S.progreso);
  else S.progreso = P.aplicarHuida(S.progreso);
  guardarProgreso();
  renderHeroe();
  await terminarExpedicion();
  renderBotones();
  const eleccion = await FX.mostrarResultado({ tipo: fin, ...resumen, racha: 0 });
  if (fin === "derrota") resultado(h("div", { class: "res res-derrota" }, h("strong", {}, "☠️ Derrota. "), "Tu racha se rompe y la expedición termina. Mejora tu equipo, compra pociones en la tienda y vuelve a Explorar."));
  if (eleccion === "otra") explorar();
}

/** Pide el botín al servidor. Devuelve {tipo, ...} de api.js o {tipo:"demo"} sin wallet. */
async function pedirBotin(enemigo) {
  if (!S.cuenta || !redCorrecta()) return { tipo: "demo" };
  S.reclamando = true;
  resultado(h("div", { class: "res res-espera" }, h("span", { class: "spinner" }), enemigo.jefe ? "👑 ¡Jefe derrotado! Forjando su botín en la blockchain…" : "🏆 ¡Victoria! Consultando al servidor si cae botín…"));
  try {
    return await reclamarBotin(S.cfg.serverUrl, S.cuenta, enemigo.nivel, { jefe: !!enemigo.jefe });
  } finally {
    S.reclamando = false;
  }
}

async function mostrarBotin(r, eleccionPrevia) {
  const enemigo = S.combate?.enemigo;
  const reintentar = h("button", { class: "btn btn-small btn-gold", type: "button", onclick: async () => mostrarBotin(await pedirBotin(enemigo), "continuar") }, "Reintentar");
  let eleccion = eleccionPrevia;
  switch (r.tipo) {
    case "drop": {
      const urlTx = r.txHash && S.links.tx(r.txHash);
      resultado(h("div", { class: "res res-drop" },
        h("div", {}, h("strong", {}, "🎁 ¡Botín! "), `«${r.item.nombre}», ${E.rareza(r.item.rareza).nombre.toLowerCase()}. Ya es tuyo en la blockchain.`),
        urlTx ? h("div", { class: "res-links" }, enlace(urlTx, "Ver transacción de minteo ↗")) : null));
      eleccion = await FX.revelarBotin(r.item);
      await cargarInventario();
      if (r.txHash && S.provider && !S.inventario.some((it) => it.tokenId === r.tokenId)) {
        try { await S.provider.waitForTransaction(r.txHash, 1, 120_000); } catch { /* seguimos */ }
        await cargarInventario();
      }
      break;
    }
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
}

// ───────────────────────── Arranque ─────────────────────────

async function iniciar() {
  FX.iniciarInterfaz({ auto: false });
  cargarProgreso();
  $("#btn-explorar").addEventListener("click", explorar);
  $("#btn-atacar").addEventListener("click", () => accion("atacar"));
  $("#btn-defender").addEventListener("click", () => accion("defender"));
  $("#btn-pocion").addEventListener("click", () => accion("pocion"));
  $("#btn-huir").addEventListener("click", huir);
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
  S.links = enlacesExplorador(S.cfg.net, S.cfg.address);
  // Despierta el servidor de botín (Render free se duerme) mientras el jugador combate.
  fetch(`${S.cfg.serverUrl}/health`, { cache: "no-store" }).catch(() => {});

  renderCabecera();
  renderHeroe();
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
