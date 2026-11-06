// Sección Inventario de Loot Arena: ver, filtrar, ordenar y equipar objetos NFT.
// Solo presentación y eventos: no llama a contratos. Sin compra ni venta aquí (eso es el Mercado).
//
// Uso desde main.js:
//   import * as INV from "./inventario.js";
//   INV.renderInventario($("#inv-grid"), S.inventario, S.equipo, {
//     onEquipar:    (item, equipar) => …,  // equipar === true → Equipar; false → Desequipar
//     onTransferir: (item) => …,           // abrir el diálogo de transferencia
//   });
//   INV.renderRanuras($("#inv-ranuras"), S.equipo, S.inventario, {
//     onDesequipar: (tokenId, tipo) => …,
//   });
//
// Todo el texto entra con textContent (los nombres vienen de la cadena).
import { TIPOS, RAREZAS, rareza, emojiTipo } from "./equipment.js";
import { iconoObjeto } from "./sprites.js";
import { h } from "./dom-secciones.js";

const ORDENES = Object.freeze({
  reciente: "Más recientes",
  poder: "Más poder",
  rareza: "Rareza",
  nombre: "Nombre",
});

// Filtros recordados por contenedor, para que sobrevivan a un re-render (cambio de equipo, de lista…).
const filtrosPorContenedor = new WeakMap();

const poder = (it) => (Number(it.ataque) || 0) + (Number(it.defensa) || 0);
const numId = (it) => Number(it.tokenId);

const COMPARADORES = Object.freeze({
  reciente: (a, b) => numId(b) - numId(a),
  poder: (a, b) => poder(b) - poder(a) || numId(b) - numId(a),
  rareza: (a, b) => (Number(b.rareza) - Number(a.rareza)) || poder(b) - poder(a) || numId(b) - numId(a),
  nombre: (a, b) => String(a.nombre).localeCompare(String(b.nombre), "es") || numId(a) - numId(b),
});

/** Aplica filtros y orden a una lista de objetos. Función pura. */
export function filtrarOrdenar(items, { tipo = "", rareza: rar = "", orden = "reciente" } = {}) {
  const cmp = COMPARADORES[orden] ?? COMPARADORES.reciente;
  return items
    .filter((it) => !tipo || it.tipo === tipo)
    .filter((it) => rar === "" || rar == null || Number(it.rareza) === Number(rar))
    .slice()
    .sort(cmp);
}

function campo(etiqueta, control) {
  return h("label", { class: "inv-campo" }, h("span", {}, etiqueta), control);
}

function selectOpciones(id, opciones, valor, aria) {
  return h("select", { id, "aria-label": aria },
    ...opciones.map(([v, t]) => h("option", { value: v, selected: v === valor }, t)));
}

/** Tarjeta de un objeto. */
function tarjeta(it, equipado, { onEquipar, onTransferir }) {
  const r = rareza(it.rareza);
  const nombre = it.nombre || `${it.tipo} #${it.tokenId}`;
  const ico = h("span", { class: "ico-obj" });
  ico.innerHTML = iconoObjeto(it.tipo, it.rareza) || "";
  if (!ico.firstChild) ico.textContent = emojiTipo(it.tipo);
  const arte = h("div", { class: "item-arte", "aria-hidden": "true" }, ico);

  return h("article", {
    class: `item rar-${Number(it.rareza) || 0}${equipado ? " equipado" : ""}`,
    style: { "--rar": r.color },
    "data-token": it.tokenId,
    "aria-label": `${nombre}, ${r.nombre}${equipado ? ", equipado" : ""}`,
  },
    h("span", { class: "item-poder", title: "Poder (ataque + defensa)" }, `⚡ ${poder(it)}`),
    arte,
    h("div", { class: "item-top" },
      h("span", { class: "item-id" }, `#${it.tokenId}`),
      equipado ? h("span", { class: "item-flag" }, "Equipado") : null),
    h("h4", { class: "item-nombre" }, nombre),
    h("p", { class: "item-meta" }, `${it.tipo} · `, h("span", { class: "rar-tag" }, r.nombre)),
    h("div", { class: "item-stats" },
      h("span", { class: "st st-atk", title: "Ataque" }, `⚔️ ${it.ataque}`),
      h("span", { class: "st st-def", title: "Defensa" }, `🛡️ ${it.defensa}`)),
    h("div", { class: "item-acciones" },
      h("button", {
        type: "button",
        class: equipado ? "btn btn-small btn-ghost" : "btn btn-small btn-gold",
        "aria-pressed": equipado ? "true" : "false",
        onclick: () => onEquipar?.(it, !equipado),
      }, equipado ? "Desequipar" : "Equipar"),
      h("button", {
        type: "button",
        class: "btn btn-small btn-ghost",
        onclick: () => onTransferir?.(it),
      }, "Transferir")));
}

/**
 * Pinta la mochila: barra de filtros (tipo, rareza, orden) y cuadrícula de tarjetas.
 * @param {HTMLElement} contenedor normalmente #inv-grid; se vacía y se rellena
 * @param {Array<object>} items objetos normalizados (equipment.normalizarItem)
 * @param {Record<string,string>} equipo mapa tipo → tokenId equipado
 * @param {{onEquipar?:(item:object, equipar:boolean)=>void, onTransferir?:(item:object)=>void}} [eventos]
 */
export function renderInventario(contenedor, items = [], equipo = {}, { onEquipar, onTransferir } = {}) {
  if (!contenedor) return;
  const lista = Array.isArray(items) ? items : [];
  const ids = new Set(Object.values(equipo ?? {}).map(String));
  const filtros = filtrosPorContenedor.get(contenedor) ?? { tipo: "", rareza: "", orden: "reciente" };
  filtrosPorContenedor.set(contenedor, filtros);

  const cuenta = h("span", { class: "inv-cuenta", "aria-live": "polite" });
  const cuadricula = h("div", { class: "inv-cuadricula", id: "inv-cuadricula", role: "list" });

  const pintarCuadricula = () => {
    const vista = filtrarOrdenar(lista, filtros);
    cuenta.textContent = `${vista.length} de ${lista.length} objeto${lista.length === 1 ? "" : "s"}`;
    if (!vista.length) {
      cuadricula.replaceChildren(h("p", { class: "inv-vacio" },
        lista.length
          ? "Ningún objeto coincide con los filtros."
          : "Aún no tienes objetos. Explora la arena para conseguir botín o compra cofres en el Mercado. ",
        lista.length ? null : h("a", { href: "#/arena" }, "Ir a la arena")));
      return;
    }
    cuadricula.replaceChildren(...vista.map((it) => {
      const card = tarjeta(it, ids.has(String(it.tokenId)), { onEquipar, onTransferir });
      card.setAttribute("role", "listitem");
      return card;
    }));
  };

  const selTipo = selectOpciones("inv-filtro-tipo",
    [["", "Todos"], ...TIPOS.map((t) => [t, t])], filtros.tipo, "Filtrar por tipo");
  selTipo.addEventListener("change", () => { filtros.tipo = selTipo.value; pintarCuadricula(); });

  const selRareza = selectOpciones("inv-filtro-rareza",
    [["", "Todas"], ...RAREZAS.map((r) => [String(r.id), r.nombre])], filtros.rareza, "Filtrar por rareza");
  selRareza.addEventListener("change", () => { filtros.rareza = selRareza.value; pintarCuadricula(); });

  const selOrden = selectOpciones("inv-orden",
    Object.entries(ORDENES), filtros.orden, "Ordenar");
  selOrden.addEventListener("change", () => { filtros.orden = selOrden.value; pintarCuadricula(); });

  const barra = h("div", { class: "inv-filtros", role: "group", "aria-label": "Filtrar y ordenar" },
    campo("Tipo", selTipo), campo("Rareza", selRareza), campo("Orden", selOrden), cuenta);

  contenedor.replaceChildren(barra, cuadricula);
  pintarCuadricula();
}

/**
 * Pinta las cinco ranuras de equipo (Espada, Escudo, Casco, Armadura, Botas).
 * @param {HTMLElement} contenedor normalmente #inv-ranuras
 * @param {Record<string,string>} equipo mapa tipo → tokenId
 * @param {Array<object>} items inventario completo (para mostrar nombre y stats del equipado)
 * @param {{onDesequipar?:(tokenId:string, tipo:string)=>void}} [eventos]
 */
export function renderRanuras(contenedor, equipo = {}, items = [], { onDesequipar } = {}) {
  if (!contenedor) return;
  const porId = new Map((Array.isArray(items) ? items : []).map((it) => [String(it.tokenId), it]));

  contenedor.replaceChildren(...TIPOS.map((tipo) => {
    const id = equipo?.[tipo] != null ? String(equipo[tipo]) : null;
    const it = id ? porId.get(id) ?? null : null;
    const r = it ? rareza(it.rareza) : null;
    const ico = h("span", { class: "ranura-ico", "aria-hidden": "true" }, emojiTipo(tipo));
    return h("div", {
      class: `ranura${it ? " lleno" : ""}`,
      style: it ? { "--rar": r.color } : null,
      "data-tipo": tipo,
    },
      ico,
      h("div", { class: "ranura-cuerpo" },
        h("span", { class: "ranura-tipo" }, tipo),
        h("span", { class: "ranura-nombre" }, it ? (it.nombre || `${tipo} #${it.tokenId}`) : "Vacía"),
        it ? h("span", { class: "ranura-stats" }, `⚔️ ${it.ataque} · 🛡️ ${it.defensa} · ${r.nombre}`) : null),
      it ? h("button", {
        type: "button",
        class: "btn btn-small btn-ghost",
        "aria-label": `Desequipar ${tipo}: ${it.nombre || "#" + it.tokenId}`,
        onclick: () => onDesequipar?.(String(it.tokenId), tipo),
      }, "Quitar") : null);
  }));
}
