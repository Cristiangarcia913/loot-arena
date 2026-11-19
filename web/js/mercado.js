// Sección Mercado de Loot Arena: tres pestañas, «Comprar» (Herrero), «Vender» (tu equipo) y
// «Mercado P2P» (otros jugadores). Solo maquetado y eventos para Comprar/Vender; la lógica de
// contratos (venta, compra de cosméticos, cofre) vive en tienda.js y se engancha por callbacks.
// La pestaña P2P la monta y pinta mercado-p2p.js por su cuenta (es su propia mini-economía
// on-chain): aquí solo se cablea el cambio de pestaña.
//
// Marcado estático en index.html: #merc-tab-comprar, #merc-tab-vender, #merc-tab-p2p,
// #merc-comprar, #merc-vender, #merc-p2p, #merc-bolsa.
//
// Uso desde main.js:
//   import * as MERC from "./mercado.js";
//   MERC.renderMercado($("#seccion-mercado"), {
//     catalogo:  CATALOGO,                       // cosméticos (economy.CATALOGO por defecto)
//     inventario: S.inventario,                  // objetos normalizados
//     saldos:    { oro: 1250, cajaEth, restanteHoyEth },  // oro en ORO enteros; cajaEth/restanteHoyEth en wei (bigint) opcionales
//     onVender:  (items) => …,                   // items: objetos seleccionados (array)
//     onComprar: (cosmetico) => …,               // entrada de CATALOGO
//     onAbrirCofre: () => …,
//   });
//
// Todo el texto entra con textContent.
import {
  CATALOGO, PRECIO_COFRE, RECOMPENSA_ETH, RAREZAS_COSMETICO, NOMBRE_RANURA,
  precioVentaLocal, estimarEthVenta, formatearEth, semillaDelDia, ofertaDelDiaCosmetico,
} from "./economy.js";
import { rareza, emojiTipo } from "./equipment.js";
import { spriteCosmetico } from "./sprites.js";
import { h } from "./dom-secciones.js";

// Selección de objetos a vender, conservada entre re-renders (solo por tokenId).
const seleccion = new Set();
// Filtro de categoría activo en «Vender» (se conserva entre re-renders, como la selección).
let filtroVender = "todo";

const fmtOro = (n) => new Intl.NumberFormat("es-ES").format(Math.max(0, Math.floor(Number(n) || 0)));

/** Categorías de objeto (NFT): Espada = arma, el resto = armadura. No hay pociones NFT. */
const CATEGORIAS = Object.freeze([
  { id: "todo", nombre: "Todo", icono: "" },
  { id: "armas", nombre: "Armas", icono: "⚔️" },
  { id: "armaduras", nombre: "Armaduras", icono: "🛡️" },
  { id: "pociones", nombre: "Pociones", icono: "🧪" },
]);
const categoriaDe = (tipo) => (tipo === "Espada" ? "armas" : "armaduras");

/** Pastillas de filtro rápido [Todo] [⚔️ Armas] [🛡️ Armaduras] [🧪 Pociones]. */
function filtros(activo, onCambio) {
  return h("div", { class: "merc-filtros", role: "group", "aria-label": "Filtrar por categoría" },
    CATEGORIAS.map((c) => h("button", {
      type: "button", class: `merc-filtro${activo === c.id ? " on" : ""}`, "aria-pressed": String(activo === c.id),
      onclick: () => onCambio(c.id),
    }, c.icono ? `${c.icono} ${c.nombre}` : c.nombre)));
}

function dentro(raiz, id) {
  return raiz?.querySelector?.(`#${id}`) ?? document.getElementById(id);
}

/** Icono de un cosmético: arte del juego si lo hay, si no el emoji del catálogo. */
function iconoCosmetico(c) {
  const span = h("span", { class: "merc-icono", "aria-hidden": "true" });
  let arte = "";
  try { arte = spriteCosmetico(c.id) || ""; } catch { arte = ""; }
  if (arte) span.innerHTML = arte; else span.textContent = c.icono ?? "🎁";
  return span;
}

const ORDEN_PESTANAS = Object.freeze(["comprar", "vender", "p2p"]);

/** Pestañas accesibles: clic y flechas. Muestra un panel y oculta los demás. */
function cablearPestanas(raiz, activa = "comprar", onCambio = null) {
  const tabs = Object.fromEntries(ORDEN_PESTANAS.map((k) => [k, dentro(raiz, `merc-tab-${k}`)]));
  const paneles = Object.fromEntries(ORDEN_PESTANAS.map((k) => [k, dentro(raiz, `merc-${k}`)]));
  const mostrar = (clave, enfocar = false) => {
    for (const k of ORDEN_PESTANAS) {
      const on = k === clave;
      if (tabs[k]) {
        tabs[k].setAttribute("aria-selected", on ? "true" : "false");
        tabs[k].tabIndex = on ? 0 : -1;
        tabs[k].classList.toggle("on", on);
        if (on && enfocar) tabs[k].focus();
      }
      if (paneles[k]) paneles[k].hidden = !on;
    }
    onCambio?.(clave);
  };
  for (const [i, k] of ORDEN_PESTANAS.entries()) {
    if (!tabs[k]) continue;
    tabs[k].onclick = () => mostrar(k);
    tabs[k].onkeydown = (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      const siguiente = ORDEN_PESTANAS[(i + (e.key === "ArrowRight" ? 1 : ORDEN_PESTANAS.length - 1)) % ORDEN_PESTANAS.length];
      mostrar(siguiente, true);
    };
  }
  mostrar(activa);
}

/** Flecha de comparación: el stat principal del objeto contra el del mismo tipo que llevas puesto. */
function comparadorEquipo(it, equipadoDelTipo) {
  if (!equipadoDelTipo || equipadoDelTipo.tokenId === it.tokenId) return null;
  const clave = it.tipo === "Espada" ? "ataque" : "defensa";
  const dif = it[clave] - equipadoDelTipo[clave];
  if (dif === 0) return h("span", { class: "merc-cmp cmp-igual" }, "= equipado");
  return h("span", { class: `merc-cmp ${dif > 0 ? "cmp-mejor" : "cmp-peor"}` }, `${dif > 0 ? "▲" : "▼"} ${dif > 0 ? "+" : ""}${dif} vs. equipado`);
}

/** Panel «Vender»: filtro por categoría, lista con casillas, resumen de ORO + ETH y botón. */
function pintarVender(panel, inventario, saldos, onVender, equipados = []) {
  const todaLaLista = Array.isArray(inventario) ? inventario : [];
  // Descarta selecciones de objetos que ya no están.
  const presentes = new Set(todaLaLista.map((it) => String(it.tokenId)));
  for (const id of [...seleccion]) if (!presentes.has(id)) seleccion.delete(id);

  if (!todaLaLista.length) {
    panel.replaceChildren(h("p", { class: "merc-vacio" },
      "No tienes objetos que vender. Consigue botín en la arena; los objetos NFT aparecen aquí."));
    return;
  }

  const porTipo = new Map((equipados ?? []).map((it) => [it.tipo, it]));
  const lista = filtroVender === "todo" ? todaLaLista
    : filtroVender === "pociones" ? []
    : todaLaLista.filter((it) => categoriaDe(it.tipo) === filtroVender);

  const resumen = h("div", { class: "merc-resumen", "aria-live": "polite" });
  const boton = h("button", { type: "button", class: "btn btn-gold", id: "merc-btn-vender" });

  const actualizarResumen = () => {
    const sel = todaLaLista.filter((it) => seleccion.has(String(it.tokenId)));
    let oro = 0;
    for (const it of sel) {
      try { oro += precioVentaLocal(it); } catch { /* stats no válidas: no suma */ }
    }
    const estim = estimarEthVenta(sel.map((it) => RECOMPENSA_ETH[Number(it.rareza)] ?? 0n), {
      caja: saldos?.cajaEth ?? null,
      restanteHoy: saldos?.restanteHoyEth ?? null,
    });
    const parcial = estim.soloOro.some(Boolean);
    resumen.replaceChildren(
      h("div", { class: "merc-tot" }, h("span", { class: "merc-lbl" }, "Seleccionados"), h("b", {}, String(sel.length))),
      h("div", { class: "merc-tot" }, h("span", { class: "merc-lbl" }, "Total ORO"), h("b", { class: "oro-val" }, `${fmtOro(oro)} ORO`)),
      h("div", { class: "merc-tot" }, h("span", { class: "merc-lbl" }, "ETH estimado"),
        h("b", {}, `${formatearEth(estim.total)} ETH`),
        parcial ? h("small", { class: "merc-nota" }, "Algún objeto solo paga ORO por límite de caja o cupo diario.") : null),
    );
    boton.textContent = sel.length ? `Vender ${sel.length} por ${fmtOro(oro)} ORO` : "Selecciona objetos para vender";
    boton.disabled = sel.length === 0;
    boton.onclick = () => { if (sel.length) onVender?.(sel); };
  };

  const filas = lista.map((it) => {
    const id = String(it.tokenId);
    const r = rareza(it.rareza);
    let precio = "—";
    try { precio = `${fmtOro(precioVentaLocal(it))} ORO`; } catch { /* stats inválidas */ }
    const casilla = h("input", {
      type: "checkbox",
      "data-token": id,
      "aria-label": `Vender ${it.nombre || "#" + id}`,
      checked: seleccion.has(id),
      onchange: (e) => {
        if (e.target.checked) seleccion.add(id); else seleccion.delete(id);
        actualizarResumen();
      },
    });
    return h("li", { class: `merc-fila rar-${Number(it.rareza) || 0}`, style: { "--rar": r.color } },
      h("label", { class: "merc-check" }, casilla,
        h("span", { "aria-hidden": "true" }, emojiTipo(it.tipo)),
        h("span", { class: "merc-nombre" }, it.nombre || `${it.tipo} #${id}`),
        h("span", { class: "merc-meta" }, `${it.tipo} · ${r.nombre} · ⚔️${it.ataque} 🛡️${it.defensa}`),
        comparadorEquipo(it, porTipo.get(it.tipo))),
      h("span", { class: "merc-precio" }, precio));
  });

  panel.replaceChildren(
    filtros(filtroVender, (id) => { filtroVender = id; pintarVender(panel, todaLaLista, saldos, onVender, equipados); }),
    h("p", { class: "merc-ayuda" }, "Marca los objetos que quieras vender. Cada uno paga ORO según rareza y stats, y puede pagar ETH."),
    filas.length ? h("ul", { class: "merc-lista", role: "list" }, ...filas)
      : h("p", { class: "merc-vacio" }, filtroVender === "pociones" ? "No hay pociones entre tus objetos: son un cosmético, se compran en «Comprar»." : "No tienes objetos de esta categoría."),
    h("div", { class: "merc-pie" }, resumen, boton),
  );
  actualizarResumen();
}

/** Panel «Comprar»: saldo, oferta del día, cofre y catálogo de cosméticos. */
function pintarComprar(panel, catalogo, saldos, { onComprar, onAbrirCofre, onRenovarCatalogo }) {
  const oro = saldos?.oro == null ? null : Number(saldos.oro);
  const sinOro = (precio) => oro != null && oro < precio;
  // Destacado del día: se elige sobre TODO el catálogo (no el subconjunto rotativo recibido),
  // así cambia una vez al día y nunca se pinta dos veces: se descarta del catálogo normal abajo
  // aunque coincida con él por casualidad.
  const destacado = ofertaDelDiaCosmetico(semillaDelDia());
  const cosmeticos = (catalogo ?? CATALOGO).filter((c) => c.ranura !== "consumible" && c.id !== destacado?.id);

  const ofertaDia = destacado ? (() => {
    const r = RAREZAS_COSMETICO[destacado.rareza] ?? RAREZAS_COSMETICO[0];
    return h("article", { class: "merc-oferta-dia", style: { "--rar": r.color } },
      h("span", { class: "merc-oferta-dia-badge" }, "🔥 Oferta del día de la Arena"),
      iconoCosmetico(destacado),
      h("div", { class: "merc-oferta-dia-txt" },
        h("h4", { class: "merc-carta-nombre" }, destacado.nombre),
        h("p", { class: "merc-meta" }, `${NOMBRE_RANURA[destacado.ranura] ?? destacado.ranura} · ${r.nombre}`)),
      h("div", { class: "merc-precio" }, `${fmtOro(destacado.precio)} ORO`),
      h("button", {
        type: "button", class: "btn btn-gold",
        disabled: sinOro(destacado.precio),
        "aria-label": `Comprar ${destacado.nombre} por ${fmtOro(destacado.precio)} ORO`,
        onclick: () => onComprar?.(destacado),
      }, "Comprar"));
  })() : null;

  const cofre = h("article", { class: "merc-cofre" },
    h("div", { class: "merc-cofre-ico", "aria-hidden": "true" }, "🎁"),
    h("div", { class: "merc-cofre-txt" },
      h("h4", {}, "Cofre cosmético"),
      h("p", { class: "merc-meta" }, "Un cosmético al azar: 60 % común, 32 % raro y 8 % legendario.")),
    h("button", {
      type: "button", class: "btn btn-gold", id: "merc-btn-cofre",
      disabled: sinOro(PRECIO_COFRE),
      onclick: () => onAbrirCofre?.(),
    }, `Abrir · ${fmtOro(PRECIO_COFRE)} ORO`));

  const tarjetas = cosmeticos.map((c) => {
    const r = RAREZAS_COSMETICO[c.rareza] ?? RAREZAS_COSMETICO[0];
    return h("article", {
      class: `merc-carta rar-${c.rareza}`,
      style: { "--rar": r.color },
      "data-cosmetico": String(c.id),
    },
      iconoCosmetico(c),
      h("h4", { class: "merc-carta-nombre" }, c.nombre),
      h("p", { class: "merc-meta" }, `${NOMBRE_RANURA[c.ranura] ?? c.ranura} · ${r.nombre}`),
      h("div", { class: "merc-precio" }, `${fmtOro(c.precio)} ORO`),
      h("button", {
        type: "button", class: "btn btn-small btn-gold",
        disabled: sinOro(c.precio),
        "aria-label": `Comprar ${c.nombre} por ${fmtOro(c.precio)} ORO`,
        onclick: () => onComprar?.(c),
      }, "Comprar"));
  });

  panel.replaceChildren(
    h("p", { class: "merc-ayuda" },
      oro == null ? "Compra cosméticos para tu héroe con ORO." : `Tienes ${fmtOro(oro)} ORO para gastar.`),
    ofertaDia,
    h("div", { class: "merc-bloque" }, cofre),
    h("div", { class: "merc-cat-cabecera" },
      h("h3", { class: "sub merc-sub" }, "Catálogo"),
      onRenovarCatalogo ? h("button", {
        type: "button", class: "btn btn-small merc-renovar", id: "merc-btn-renovar",
        onclick: (ev) => { ev.currentTarget.disabled = true; onRenovarCatalogo(); },
      }, "📺 Cambiar catálogo de objetos") : null),
    h("div", { class: "merc-catalogo" }, ...tarjetas),
    cosmeticos.length ? null : h("p", { class: "merc-vacio" }, "No hay cosméticos a la venta."),
  );
}

/**
 * Pinta el Mercado (Comprar / Vender) dentro de `contenedor` (normalmente #seccion-mercado) y
 * cablea la pestaña «Mercado P2P» (su contenido lo pinta mercado-p2p.js por su cuenta).
 * Si el contenedor no contiene los paneles, se buscan por id en el documento.
 * @param {HTMLElement} contenedor
 * @param {{catalogo?:Array<object>, inventario?:Array<object>, saldos?:{oro?:number, cajaEth?:bigint, restanteHoyEth?:bigint},
 *          equipados?:Array<object>, onVender?:(items:object[])=>void, onComprar?:(cosmetico:object)=>void,
 *          onAbrirCofre?:()=>void, onCambioPestana?:(clave:string)=>void, pestana?:"comprar"|"vender"|"p2p"}} [o]
 */
export function renderMercado(contenedor, o = {}) {
  const panelVender = dentro(contenedor, "merc-vender");
  const panelComprar = dentro(contenedor, "merc-comprar");
  if (!panelVender || !panelComprar) return;

  const bolsa = dentro(contenedor, "merc-bolsa");
  if (bolsa) {
    const oro = o.saldos?.oro;
    bolsa.replaceChildren(h("p", { class: "merc-bolsa-txt" },
      "Tu bolsa: ", h("b", { class: "oro-val" }, oro == null ? "—" : `${fmtOro(oro)} 🪙 ORO`)));
  }

  pintarVender(panelVender, o.inventario ?? [], o.saldos ?? {}, o.onVender, o.equipados ?? []);
  pintarComprar(panelComprar, o.catalogo ?? CATALOGO, o.saldos ?? {}, {
    onComprar: o.onComprar,
    onAbrirCofre: o.onAbrirCofre,
    onRenovarCatalogo: o.onRenovarCatalogo,
  });
  // Conserva la pestaña activa al re-renderizar (p. ej. tras comprar), salvo que se pida otra.
  const activa = ORDEN_PESTANAS.find((k) => dentro(contenedor, `merc-tab-${k}`)?.getAttribute("aria-selected") === "true");
  cablearPestanas(contenedor, o.pestana ?? activa ?? "comprar", o.onCambioPestana);
}

/** Vacía la selección de venta (p. ej. tras vender con éxito). */
export function limpiarSeleccionVenta() {
  seleccion.clear();
}
