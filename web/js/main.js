// Orquestación de la UI de Loot Arena.
import { cargarConfig, ZERO_ADDRESS } from "../config/config.js";
import * as C from "./combat.js";
import * as E from "./equipment.js";
import * as W from "./wallet.js";
import { reclamarBotin } from "./api.js";
import { crearContrato, hayCodigo, leerInventario, transferir, enlacesExplorador } from "./chain.js";
import { $, h, enlace, acortar, toast, flotar, esperar } from "./ui.js";
import { leer, guardar } from "./storage.js";

const CLAVE_VICTORIAS = "lootarena:victorias";

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
  combate: null,
  animando: false,
  victorias: Number(leer(CLAVE_VICTORIAS)) || 0,
  botinPendiente: null, // nivel del enemigo vencido aún sin reclamar
  reclamando: false,
  transfiriendo: new Set(),
  links: { tx: () => null, token: () => null },
};

const redCorrecta = () => S.chainId != null && S.chainId === S.cfg?.chainId;
const contratoDesplegado = () => S.cfg && S.cfg.address.toLowerCase() !== ZERO_ADDRESS;

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
      ", pero para recibir y gestionar objetos NFT necesitas ",
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
    // chainChanged actualizará el estado; por si el evento no llega:
    await alCambiarRed(await W.chainIdActual());
  } catch (e) {
    toast(`No se pudo cambiar de red: ${W.mensajeError(e)}`, "error");
  }
}

async function alCambiarCuentas(cuentas) {
  const nueva = cuentas?.[0] ?? null;
  S.cuenta = nueva;
  S.chainId = nueva ? await W.chainIdActual() : null;
  await prepararContrato();
  cargarEquipo();
  renderCabecera();
  renderHeroe();
  await cargarInventario();
  if (!nueva) toast("Wallet desconectada.", "info");
}

async function alCambiarRed(chainIdHexONum) {
  S.chainId = Number(chainIdHexONum);
  await prepararContrato();
  cargarEquipo();
  renderCabecera();
  await cargarInventario();
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

// ───────────────────────── Equipo e inventario ─────────────────────────

function cargarEquipo() {
  S.equipo = S.cuenta ? E.parsearEquipo(leer(E.claveEquipo(S.cuenta, S.chainId))) : {};
}

function guardarEquipo() {
  if (S.cuenta) guardar(E.claveEquipo(S.cuenta, S.chainId), JSON.stringify(S.equipo));
}

function statsActuales() {
  return E.statsJugador(E.itemsEquipados(S.equipo, S.inventario));
}

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
    renderInventario();
    renderHeroe();
    return;
  }

  estado.textContent = "Leyendo objetos de la cadena…";
  try {
    const inv = await leerInventario(S.contrato, S.cuenta);
    if (id !== cargaInvId) return; // llegó una carga más reciente
    S.inventario = inv;
    const saneado = E.sanearEquipo(S.equipo, inv);
    if (JSON.stringify(saneado) !== JSON.stringify(S.equipo)) { S.equipo = saneado; guardarEquipo(); }
    estado.textContent = inv.length
      ? `${inv.length} objeto${inv.length === 1 ? "" : "s"} en tu wallet.`
      : "Aún no tienes objetos. ¡Gana combates para conseguir botín!";
  } catch (e) {
    if (id !== cargaInvId) return;
    estado.textContent = `Error leyendo el inventario: ${W.mensajeError(e)}`;
  }
  renderInventario();
  renderHeroe();
}

function alternarEquipo(item) {
  S.equipo = E.estaEquipado(S.equipo, item.tokenId) ? E.desequipar(S.equipo, item.tokenId) : E.equipar(S.equipo, item);
  guardarEquipo();
  renderInventario();
  renderHeroe();
  if (S.combate?.fase === "en_curso") toast("El nuevo equipo se aplicará en el próximo combate.", "info", 3000);
}

function tarjetaItem(item, { acciones = true } = {}) {
  const r = E.rareza(item.rareza);
  const equipado = E.estaEquipado(S.equipo, item.tokenId);
  const enviando = S.transfiriendo.has(item.tokenId);
  const stats = [];
  if (item.ataque) stats.push(h("span", { class: "st st-atk" }, `+${item.ataque} ATQ`));
  if (item.defensa) stats.push(h("span", { class: "st st-def" }, `+${item.defensa} DEF`));

  return h("article", { class: `item rar-${r.id}${equipado ? " equipado" : ""}`, style: `--rar:${r.color}` },
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
  const cont = $("#inventario");
  cont.replaceChildren(...E.ordenarInventario(S.inventario, S.equipo).map((it) => tarjetaItem(it)));
}

function renderHeroe() {
  const s = statsActuales();
  const bonus = (n) => (n ? h("small", { class: "bonus" }, ` (+${n})`) : null);
  $("#stats").replaceChildren(
    h("div", { class: "stat" }, h("span", { class: "stat-ico" }, "❤️"), h("span", { class: "stat-lbl" }, "Vida"), h("b", {}, String(s.vida))),
    h("div", { class: "stat" }, h("span", { class: "stat-ico" }, "⚔️"), h("span", { class: "stat-lbl" }, "Ataque"), h("b", {}, String(s.ataque), bonus(s.bonusAtaque))),
    h("div", { class: "stat" }, h("span", { class: "stat-ico" }, "🛡️"), h("span", { class: "stat-lbl" }, "Defensa"), h("b", {}, String(s.defensa), bonus(s.bonusDefensa))),
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

  const nv = C.nivelArena(S.victorias);
  $("#arena-level").textContent = `Nivel de arena ${nv}`;
  $("#victorias").textContent = `${S.victorias} victoria${S.victorias === 1 ? "" : "s"}`;
  if (!S.combate || S.combate.fase !== "en_curso") renderLuchadores();
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

// ───────────────────────── Combate ─────────────────────────

function pintarLuchador(el, { emoji, nombre, vida, vidaMax, ataque, defensa, extra, vacio }) {
  el.classList.toggle("vacio", !!vacio);
  el.querySelector(".avatar").textContent = emoji;
  el.querySelector(".f-name").replaceChildren(nombre, extra ?? "");
  const pct = vidaMax ? Math.max(0, (vida / vidaMax) * 100) : 0;
  const fill = el.querySelector(".hp-fill");
  fill.style.width = `${pct}%`;
  fill.classList.toggle("baja", pct <= 30);
  el.querySelector(".hp").hidden = !!vacio;
  el.querySelector(".hp-text").textContent = vacio ? "" : `${vida} / ${vidaMax}`;
  el.querySelector(".f-stats").textContent = vacio ? "Pulsa Explorar para encontrar un rival" : `⚔️ ${ataque} · 🛡️ ${defensa}`;
}

function renderLuchadores() {
  const c = S.combate;
  const j = c?.fase === "en_curso" ? c.jugador : { ...statsActuales(), vidaMax: statsActuales().vida };
  const jVida = c && c.fase !== "huida" ? c.jugador.vida : j.vida;
  pintarLuchador($("#f-jugador"), {
    emoji: c?.fase === "derrota" ? "😵" : "🤺", nombre: "Tu héroe",
    vida: jVida, vidaMax: c?.jugador.vidaMax ?? j.vidaMax, ataque: j.ataque, defensa: j.defensa,
  });
  const en = c?.enemigo;
  const fEn = $("#f-enemigo");
  if (!en || c.fase === "huida") {
    pintarLuchador(fEn, { emoji: "❔", nombre: "Arena vacía", vacio: true });
  } else {
    pintarLuchador(fEn, {
      emoji: c.fase === "victoria" ? "🪦" : en.emoji, nombre: en.nombre,
      extra: h("span", { class: "nv" }, ` Nv. ${en.nivel}`),
      vida: en.vida, vidaMax: en.vidaMax, ataque: en.ataque, defensa: en.defensa,
    });
  }
  fEn.classList.toggle("cargando", !!en?.cargando && c.fase === "en_curso");
}

function renderBotones() {
  const enCurso = S.combate?.fase === "en_curso";
  $("#btn-explorar").disabled = enCurso || S.animando;
  $("#btn-atacar").disabled = !enCurso || S.animando;
  $("#btn-defender").disabled = !enCurso || S.animando;
  $("#btn-huir").disabled = !enCurso || S.animando;
}

function añadirLog(eventos) {
  const log = $("#log");
  for (const ev of eventos) log.append(h("li", { class: `log-${ev.actor} log-${ev.tipo}` }, ev.texto));
  while (log.children.length > 60) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
}

function explorar() {
  const nivel = C.nivelEnemigo(C.nivelArena(S.victorias));
  const enemigo = C.generarEnemigo(nivel);
  S.combate = C.crearCombate(statsActuales(), enemigo);
  S.botinPendiente = null;
  $("#resultado").hidden = true;
  $("#log").replaceChildren();
  añadirLog(S.combate.log);
  renderLuchadores();
  renderBotones();
}

async function accion(tipo) {
  if (S.animando || S.combate?.fase !== "en_curso") return;
  S.animando = true;
  renderBotones();
  const { combate, eventos } = C.turnoJugador(S.combate, tipo);
  const fJ = $("#f-jugador");
  const fE = $("#f-enemigo");

  // Animación: primero el jugador, después la respuesta del enemigo.
  const prev = S.combate;
  for (const ev of eventos) {
    if (ev.actor === "jugador") {
      S.combate = { ...prev, enemigo: combate.enemigo };
      if (ev.tipo === "ataque") flotar(fE, `−${ev.dano}`, "dano");
      else flotar(fJ, "🛡️ ×2", "escudo");
      renderLuchadores();
      añadirLog([ev]);
      await esperar(450);
    } else if (ev.actor === "enemigo") {
      S.combate = combate;
      if (ev.dano) flotar(fJ, `−${ev.dano}`, "dano");
      else flotar(fE, "⚡", "carga");
      renderLuchadores();
      añadirLog([ev]);
      await esperar(250);
    } else {
      añadirLog([ev]);
    }
  }
  S.combate = combate;
  S.animando = false;
  renderLuchadores();
  renderBotones();

  if (combate.fase === "victoria") alGanar(combate.enemigo.nivel);
  else if (combate.fase === "derrota") alPerder();
}

function huir() {
  if (S.combate?.fase !== "en_curso") return;
  S.combate = C.huir(S.combate);
  añadirLog([S.combate.log.at(-1)]);
  renderLuchadores();
  renderBotones();
}

function resultado(...contenido) {
  const r = $("#resultado");
  r.replaceChildren(...contenido.flat().filter(Boolean));
  r.hidden = false;
}

function alPerder() {
  resultado(h("div", { class: "res res-derrota" },
    h("strong", {}, "☠️ Derrota. "),
    "Recupérate, mejora tu equipo y vuelve a Explorar."));
}

function alGanar(nivel) {
  S.victorias++;
  guardar(CLAVE_VICTORIAS, String(S.victorias));
  renderHeroe();
  S.botinPendiente = nivel;
  reclamar();
}

async function reclamar() {
  const nivel = S.botinPendiente;
  if (nivel == null || S.reclamando) return;

  if (!S.cuenta) {
    resultado(h("div", { class: "res res-victoria" },
      h("strong", {}, "🏆 ¡Victoria! "),
      W.tieneMetaMask()
        ? ["Conecta tu wallet para reclamar el botín de este combate. ",
          h("button", { class: "btn btn-small btn-gold", type: "button", onclick: async () => { if (await conectar()) reclamar(); } }, "🦊 Conectar y reclamar")]
        : "Modo demo: instala MetaMask para recibir objetos NFT como botín."));
    return;
  }

  S.reclamando = true;
  resultado(h("div", { class: "res res-espera" }, h("span", { class: "spinner" }), "🏆 ¡Victoria! Consultando al servidor si cae botín…"));
  const r = await reclamarBotin(S.cfg.serverUrl, S.cuenta, nivel);
  S.reclamando = false;

  const reintentar = h("button", { class: "btn btn-small btn-gold", type: "button", onclick: reclamar }, "Reintentar");
  switch (r.tipo) {
    case "drop": {
      S.botinPendiente = null;
      const urlTx = r.txHash && S.links.tx(r.txHash);
      resultado(h("div", { class: "res res-drop" },
        h("div", {}, h("strong", {}, "🎁 ¡Botín! "), `Has conseguido un objeto ${E.rareza(r.item.rareza).nombre.toLowerCase()}.`),
        tarjetaItem(r.item, { acciones: false }),
        urlTx ? h("div", { class: "res-links" }, enlace(urlTx, "Ver transacción de minteo ↗")) : null));
      toast(`🎁 Nuevo objeto: ${r.item.nombre}`, "ok");
      await cargarInventario();
      if (r.txHash && S.provider && !S.inventario.some((it) => it.tokenId === r.tokenId)) {
        try { await S.provider.waitForTransaction(r.txHash, 1, 120_000); } catch { /* seguimos */ }
        await cargarInventario();
      }
      break;
    }
    case "sin_drop":
      S.botinPendiente = null;
      resultado(h("div", { class: "res res-nada" }, h("strong", {}, "🏆 ¡Victoria! "), "Esta vez el enemigo no llevaba nada de valor. ¡Sigue explorando!"));
      break;
    case "limite":
      resultado(h("div", { class: "res res-limite" }, h("strong", {}, "⏳ Calma, guerrero. "), r.mensaje, " ", reintentar));
      break;
    default:
      resultado(h("div", { class: "res res-error" }, h("strong", {}, "❌ No se pudo reclamar el botín. "), r.mensaje, " ", reintentar));
  }
}

// ───────────────────────── Arranque ─────────────────────────

async function iniciar() {
  $("#btn-explorar").addEventListener("click", explorar);
  $("#btn-atacar").addEventListener("click", () => accion("atacar"));
  $("#btn-defender").addEventListener("click", () => accion("defender"));
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
    renderBotones();
    return;
  }
  S.links = enlacesExplorador(S.cfg.net, S.cfg.address);
  // Despierta el servidor de botín (Render free se duerme) mientras el jugador combate.
  fetch(`${S.cfg.serverUrl}/health`, { cache: "no-store" }).catch(() => {});

  renderCabecera();
  renderHeroe();
  renderBotones();
  añadirLog([{ actor: "sistema", tipo: "inicio", texto: "Bienvenido a Loot Arena. Pulsa Explorar para buscar un rival." }]);

  if (W.tieneMetaMask()) {
    W.escuchar({ onCuentas: alCambiarCuentas, onRed: alCambiarRed });
    try {
      const cuentas = await W.cuentasAutorizadas();
      if (cuentas.length) await alCambiarCuentas(cuentas);
      else await cargarInventario();
    } catch (e) {
      toast(W.mensajeError(e), "error");
    }
  } else {
    await cargarInventario();
  }
}

iniciar();
