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
import { conjunto, conjuntoDe, contarConjuntos, textoProgreso, PIEZAS_BONO, PIEZAS_EFECTO } from "./conjuntos.js";
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

/**
 * Texto del tooltip de un conjunto: progreso y bonos (marcando los activos). Función pura.
 * @param {string} id id del conjunto
 * @param {number} piezas piezas equipadas de ese conjunto
 */
export function tooltipConjunto(id, piezas) {
  const c = conjunto(id);
  if (!c) return "";
  const marca = (n) => (piezas >= n ? "✔" : "✖");
  return [
    `${c.nombre} (${Math.min(piezas, PIEZAS_EFECTO)}/${PIEZAS_EFECTO})`,
    `${marca(PIEZAS_BONO)} ${PIEZAS_BONO} piezas: ${c.textoBono}`,
    `${marca(PIEZAS_EFECTO)} ${PIEZAS_EFECTO} piezas: ${c.textoEfecto}`,
  ].join("\n");
}

/** Etiqueta "🩸 Set del Gladiador 2/4" con el detalle de bonos en el tooltip. */
function etiquetaConjunto(id, piezas) {
  const c = conjunto(id);
  if (!c) return null;
  const tip = tooltipConjunto(id, piezas);
  return h("p", {
    class: `item-set${piezas >= PIEZAS_BONO ? " activo" : ""}`,
    style: { "--set": c.color },
    title: tip,
    "aria-label": tip.replaceAll("\n", ". "),
  }, `${c.icono} ${textoProgreso(id, piezas)}`);
}

function campo(etiqueta, control) {
  return h("label", { class: "inv-campo" }, h("span", {}, etiqueta), control);
}

function selectOpciones(id, opciones, valor, aria) {
  return h("select", { id, "aria-label": aria },
    ...opciones.map(([v, t]) => h("option", { value: v, selected: v === valor }, t)));
}

/**
 * Flecha de comparación de una stat frente a lo ya equipado de ese tipo: ▲ verde si mejora,
 * ▼ roja si empeora, nada si es igual o no hay nada equipado con qué comparar.
 */
function comparacion(valor, actual) {
  if (actual == null) return null;
  const d = Number(valor) - Number(actual);
  if (!d) return null;
  return h("span", { class: `st-cmp ${d > 0 ? "st-mejor" : "st-peor"}`, title: `${d > 0 ? "+" : ""}${d} que el equipado` },
    d > 0 ? `▲${d}` : `▼${-d}`);
}

/** Tarjeta de un objeto. `actualDelTipo`: lo ya equipado de su tipo (null si no hay o si es esta misma pieza). */
function tarjeta(it, equipado, { onEquipar, onTransferir }, piezasSet = {}, actualDelTipo = null) {
  const set = conjuntoDe(it);
  const r = rareza(it.rareza);
  const nombre = it.nombre || `${it.tipo} #${it.tokenId}`;
  const ico = h("span", { class: "ico-obj" });
  ico.innerHTML = iconoObjeto(it.tipo, it.rareza) || "";
  if (!ico.firstChild) ico.textContent = emojiTipo(it.tipo);
  const arte = h("div", { class: "item-arte", "aria-hidden": "true" }, ico);
  const comp = !equipado && actualDelTipo
    ? { atk: comparacion(it.ataque, actualDelTipo.ataque), def: comparacion(it.defensa, actualDelTipo.defensa) }
    : { atk: null, def: null };

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
    set ? etiquetaConjunto(set, piezasSet[set] ?? 0) : null,
    h("div", { class: "item-stats" },
      h("span", { class: "st st-atk", title: "Ataque" }, `⚔️ ${it.ataque}`, comp.atk),
      h("span", { class: "st st-def", title: "Defensa" }, `🛡️ ${it.defensa}`, comp.def)),
    h("div", { class: "item-acciones" },
      h("button", {
        type: "button",
        class: equipado ? "btn btn-small btn-ghost" : "btn btn-small btn-gold",
        "aria-pressed": equipado ? "true" : "false",
        onclick: () => onEquipar?.(it, !equipado),
      }, equipado ? "Desequipar" : "Equipar"),
      // Los objetos del modo demo (botin-local.js) no son NFT: no se pueden transferir.
      it.local
        ? h("span", { class: "tenue", title: "Guardado solo en este navegador" }, "💾 Local")
        : h("button", {
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
  const piezasSet = Object.fromEntries(contarConjuntos(lista.filter((it) => ids.has(String(it.tokenId)))).map((x) => [x.id, x.piezas]));
  const porId = new Map(lista.map((it) => [String(it.tokenId), it]));
  // Lo ya equipado de cada tipo, para la comparación de stats de las tarjetas que no lo son.
  const actualPorTipo = Object.fromEntries(
    Object.entries(equipo ?? {}).map(([tipo, id]) => [tipo, id != null ? porId.get(String(id)) ?? null : null]).filter(([, it]) => it),
  );
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
      const card = tarjeta(it, ids.has(String(it.tokenId)), { onEquipar, onTransferir }, piezasSet, actualPorTipo[it.tipo] ?? null);
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
  const equipados = TIPOS.map((t) => (equipo?.[t] != null ? porId.get(String(equipo[t])) : null)).filter(Boolean);
  const sets = contarConjuntos(equipados);
  const piezasSet = Object.fromEntries(sets.map((x) => [x.id, x.piezas]));

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
        it ? h("span", { class: "ranura-stats" }, `⚔️ ${it.ataque} · 🛡️ ${it.defensa} · ${r.nombre}`) : null,
        it && conjuntoDe(it) ? etiquetaConjunto(conjuntoDe(it), piezasSet[conjuntoDe(it)] ?? 0) : null),
      it ? h("button", {
        type: "button",
        class: "btn btn-small btn-ghost",
        "aria-label": `Desequipar ${tipo}: ${it.nombre || "#" + it.tokenId}`,
        onclick: () => onDesequipar?.(String(it.tokenId), tipo),
      }, "Quitar") : null);
  }), panelConjuntos(sets));
}

/** Resumen de conjuntos equipados bajo las ranuras: progreso y bonos activos. */
function panelConjuntos(sets) {
  if (!sets.length) return h("p", { class: "inv-sets-vacio tenue" }, "Equipa 2 o 4 piezas del mismo conjunto para activar sus bonos.");
  return h("section", { class: "inv-sets", "aria-label": "Bonificaciones de conjunto" },
    h("h4", { class: "inv-sets-tit" }, "Conjuntos"),
    ...sets.map((s) => h("div", { class: `inv-set${s.bonoActivo ? " activo" : ""}`, style: { "--set": s.color }, title: tooltipConjunto(s.id, s.piezas) },
      h("div", { class: "inv-set-cab" },
        h("span", {}, `${s.icono} ${s.nombre}`),
        h("b", {}, `${s.piezas}/${s.total}`)),
      h("ul", { class: "inv-set-bonos" },
        h("li", { class: s.bonoActivo ? "on" : "" }, `${PIEZAS_BONO}: ${s.textoBono}`),
        h("li", { class: s.efectoActivo ? "on" : "" }, `${PIEZAS_EFECTO}: ${s.textoEfecto}`)))));
}
