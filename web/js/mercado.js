// Sección Mercado de Loot Arena: dos pestañas, «Vender» y «Comprar». Solo maquetado y eventos.
// La lógica de contratos (venta, compra de cosméticos, cofre) vive en tienda.js y se engancha por callbacks.
//
// Marcado estático en index.html: #merc-tab-vender, #merc-tab-comprar, #merc-vender, #merc-comprar.
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
  precioVentaLocal, estimarEthVenta, formatearEth,
} from "./economy.js";
import { rareza } from "./equipment.js";
import { spriteCosmetico } from "./sprites.js";
import { h } from "./dom-secciones.js";

// Selección de objetos a vender, conservada entre re-renders (solo por tokenId).
const seleccion = new Set();

const fmtOro = (n) => new Intl.NumberFormat("es-ES").format(Math.max(0, Math.floor(Number(n) || 0)));

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

/** Pestañas accesibles: clic y flechas. Muestra un panel y oculta el otro. */
function cablearPestanas(raiz, activa = "vender") {
  const tabs = {
    vender: dentro(raiz, "merc-tab-vender"),
    comprar: dentro(raiz, "merc-tab-comprar"),
  };
  const paneles = { vender: dentro(raiz, "merc-vender"), comprar: dentro(raiz, "merc-comprar") };
  const mostrar = (clave, enfocar = false) => {
    for (const k of Object.keys(tabs)) {
      const on = k === clave;
      if (tabs[k]) {
        tabs[k].setAttribute("aria-selected", on ? "true" : "false");
        tabs[k].tabIndex = on ? 0 : -1;
        tabs[k].classList.toggle("on", on);
        if (on && enfocar) tabs[k].focus();
      }
      if (paneles[k]) paneles[k].hidden = !on;
    }
  };
  for (const k of Object.keys(tabs)) {
    if (!tabs[k]) continue;
    tabs[k].onclick = () => mostrar(k);
    tabs[k].onkeydown = (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      const siguiente = k === "vender" ? "comprar" : "vender";
      mostrar(siguiente, true);
    };
  }
  mostrar(activa);
}

/** Panel «Vender»: lista con casillas, resumen de ORO + ETH y botón. */
function pintarVender(panel, inventario, saldos, onVender) {
  const lista = Array.isArray(inventario) ? inventario : [];
  // Descarta selecciones de objetos que ya no están.
  const presentes = new Set(lista.map((it) => String(it.tokenId)));
  for (const id of [...seleccion]) if (!presentes.has(id)) seleccion.delete(id);

  if (!lista.length) {
    panel.replaceChildren(h("p", { class: "merc-vacio" },
      "No tienes objetos que vender. Consigue botín en la arena; los objetos NFT aparecen aquí."));
    return;
  }

  const resumen = h("div", { class: "merc-resumen", "aria-live": "polite" });
  const boton = h("button", { type: "button", class: "btn btn-gold", id: "merc-btn-vender" });

  const actualizarResumen = () => {
    const sel = lista.filter((it) => seleccion.has(String(it.tokenId)));
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
        h("span", { class: "merc-nombre" }, it.nombre || `${it.tipo} #${id}`),
        h("span", { class: "merc-meta" }, `${it.tipo} · ${r.nombre} · ⚔️${it.ataque} 🛡️${it.defensa}`)),
      h("span", { class: "merc-precio" }, precio));
  });

  panel.replaceChildren(
    h("p", { class: "merc-ayuda" }, "Marca los objetos que quieras vender. Cada uno paga ORO según rareza y stats, y puede pagar ETH."),
    h("ul", { class: "merc-lista", role: "list" }, ...filas),
    h("div", { class: "merc-pie" }, resumen, boton),
  );
  actualizarResumen();
}

/** Panel «Comprar»: saldo, cofre y catálogo de cosméticos. */
function pintarComprar(panel, catalogo, saldos, { onComprar, onAbrirCofre }) {
  const oro = saldos?.oro == null ? null : Number(saldos.oro);
  const sinOro = (precio) => oro != null && oro < precio;
  const cosmeticos = (catalogo ?? CATALOGO).filter((c) => c.ranura !== "consumible");

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
    h("div", { class: "merc-bloque" }, cofre),
    h("h3", { class: "sub merc-sub" }, "Catálogo"),
    h("div", { class: "merc-catalogo" }, ...tarjetas),
    cosmeticos.length ? null : h("p", { class: "merc-vacio" }, "No hay cosméticos a la venta."),
  );
}

/**
 * Pinta el Mercado (Vender / Comprar) dentro de `contenedor` (normalmente #seccion-mercado).
 * Si el contenedor no contiene los paneles, se buscan por id en el documento.
 * @param {HTMLElement} contenedor
 * @param {{catalogo?:Array<object>, inventario?:Array<object>, saldos?:{oro?:number, cajaEth?:bigint, restanteHoyEth?:bigint},
 *          onVender?:(items:object[])=>void, onComprar?:(cosmetico:object)=>void, onAbrirCofre?:()=>void,
 *          pestana?:"vender"|"comprar"}} [o]
 */
export function renderMercado(contenedor, o = {}) {
  const panelVender = dentro(contenedor, "merc-vender");
  const panelComprar = dentro(contenedor, "merc-comprar");
  if (!panelVender || !panelComprar) return;

  pintarVender(panelVender, o.inventario ?? [], o.saldos ?? {}, o.onVender);
  pintarComprar(panelComprar, o.catalogo ?? CATALOGO, o.saldos ?? {}, {
    onComprar: o.onComprar,
    onAbrirCofre: o.onAbrirCofre,
  });
  // Conserva la pestaña activa al re-renderizar (p. ej. tras comprar), salvo que se pida otra.
  const comprarActiva = dentro(contenedor, "merc-tab-comprar")?.getAttribute("aria-selected") === "true";
  cablearPestanas(contenedor, o.pestana ?? (comprarActiva ? "comprar" : "vender"));
}

/** Vacía la selección de venta (p. ej. tras vender con éxito). */
export function limpiarSeleccionVenta() {
  seleccion.clear();
}
