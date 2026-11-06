// Sección Héroe de Loot Arena: retrato grande, estadísticas, nivel/XP y vestuario (apariencia cosmética).
// Solo presentación y eventos. Cambiar el vestuario se delega en onVestir (main/tienda guardan la apariencia).
//
// Marcado estático en index.html: #heroe-retrato, #heroe-stats, #heroe-vestuario (dentro de #seccion-heroe).
//
// Uso desde main.js:
//   import * as HEROE from "./heroe.js";
//   HEROE.renderHeroe($("#seccion-heroe"), {
//     stats:    { vida, ataque, defensa, critico, esquiva },  // critico/esquiva como fracción 0–1 (combat.probCritico/probEsquiva)
//     nivel:    S.progreso.nivel,
//     xp:       S.progreso.xp,                  // XP dentro del nivel actual
//     xpSiguiente: P.xpParaSubir(S.progreso.nivel),
//     equipo:   S.equipo,                       // tipo → tokenId
//     inventario: S.inventario,                 // objetos normalizados (para la rareza de lo equipado)
//     apariencia: S.apariencia,                 // {color, sombrero, capa, aura, mascota} → id o null
//     cosmeticosPosee: [1, 4, 12],              // ids del catálogo que posee la cuenta
//     onVestir: (idONull, ranura) => …,         // id = ponerse; null = quitar la pieza de esa ranura
//   });
//
// Todo el texto entra con textContent.
import * as FX from "./fx.js";
import { RANURAS, NOMBRE_RANURA, RAREZAS_COSMETICO, cosmetico } from "./economy.js";
import { itemsEquipados } from "./equipment.js";
import { spriteHeroe, spriteCosmetico } from "./sprites.js";
import { h } from "./dom-secciones.js";

const pct = (x) => (x == null || Number.isNaN(Number(x)) ? "—" : `${Math.round(Number(x) * 100)} %`);
const num = (x) => (x == null || Number.isNaN(Number(x)) ? "—" : String(x));

function dentro(raiz, id) {
  return raiz?.querySelector?.(`#${id}`) ?? document.getElementById(id);
}

/** Retrato: el sprite actual del héroe (equipo + apariencia). */
function pintarRetrato(el, equipados, apariencia) {
  // fx.actualizarHeroe repinta todos los `.heroe-mini` y deja el estado listo para previsualizar.
  try { FX.actualizarHeroe?.(equipados, apariencia); } catch { /* sin escena: seguimos con el sprite directo */ }
  el.innerHTML = spriteHeroe(equipados, apariencia);
}

function pintarStats(el, stats = {}, nivel, xp, xpSiguiente) {
  const filas = [
    ["❤️", "Vida", num(stats.vida)],
    ["⚔️", "Ataque", num(stats.ataque)],
    ["🛡️", "Defensa", num(stats.defensa)],
    ["💥", "Crítico", pct(stats.critico)],
    ["💨", "Esquiva", pct(stats.esquiva)],
  ];
  const meta = Math.max(1, Number(xpSiguiente) || 100);
  const actual = Math.max(0, Math.min(meta, Number(xp) || 0));
  el.replaceChildren(
    h("div", { class: "hr-nivel" },
      h("span", { class: "chip chip-nivel" }, `Nv. ${num(nivel)}`),
      h("div", {
        class: "hr-xp", role: "progressbar", "aria-label": "Experiencia",
        "aria-valuemin": "0", "aria-valuemax": String(meta), "aria-valuenow": String(actual),
      },
        h("div", { class: "hr-xp-fill", style: { width: `${(actual / meta) * 100}%` } }),
        h("span", { class: "hr-xp-txt" }, `${actual} / ${meta} XP`))),
    h("div", { class: "stats hr-stats" },
      ...filas.map(([ico, lbl, val]) =>
        h("div", { class: "stat" },
          h("span", { class: "stat-ico", "aria-hidden": "true" }, ico),
          h("span", { class: "stat-lbl" }, lbl),
          h("b", {}, val)))),
  );
}

/** Vestuario: una sección por ranura con miniaturas de lo que posee. */
function pintarVestuario(el, posee, apariencia, { onVestir, probar, quitarPrueba }) {
  const unicos = [...new Set((posee ?? []).map((x) => Number(x)))];
  const cosas = unicos.map((id) => cosmetico(id)).filter((c) => c && RANURAS.includes(c.ranura));

  el.replaceChildren(...RANURAS.map((ranura) => {
    const puesto = apariencia?.[ranura] != null ? Number(apariencia[ranura]) : null;
    const puestoNombre = puesto != null ? (cosmetico(puesto)?.nombre ?? `#${puesto}`) : "Sin pieza";
    const lista = cosas.filter((c) => c.ranura === ranura);
    const id = `hr-r-${ranura}`;

    return h("section", { class: "hr-ranura", "aria-labelledby": id },
      h("div", { class: "hr-ranura-head" },
        h("h4", { id, class: "hr-ranura-tit" }, NOMBRE_RANURA[ranura] ?? ranura),
        h("span", { class: "hr-puesto" }, puestoNombre)),
      lista.length
        ? h("ul", { class: "hr-minis", role: "list" }, ...lista.map((c) => {
          const esPuesto = puesto === c.id;
          const r = RAREZAS_COSMETICO[c.rareza] ?? RAREZAS_COSMETICO[0];
          const ico = h("span", { class: "hr-mini-ico", "aria-hidden": "true" });
          let arte = "";
          try { arte = spriteCosmetico(c.id) || ""; } catch { arte = ""; }
          if (arte) ico.innerHTML = arte; else ico.textContent = c.icono ?? "🎁";
          return h("li", {
            class: `hr-mini rar-${c.rareza}${esPuesto ? " puesto" : ""}`,
            style: { "--rar": r.color },
            onmouseenter: () => probar(c.id),
            onmouseleave: quitarPrueba,
          },
            ico,
            h("span", { class: "hr-mini-nom" }, c.nombre),
            h("span", { class: "hr-mini-rar" }, r.nombre),
            esPuesto
              ? h("button", { type: "button", class: "btn btn-small btn-ghost", "aria-label": `Quitar ${c.nombre}`,
                onclick: () => onVestir?.(null, ranura) }, "Quitar")
              : h("button", { type: "button", class: "btn btn-small btn-gold", "aria-label": `Usar ${c.nombre}`,
                onclick: () => onVestir?.(c.id, ranura) }, "Usar"));
        }))
        : h("p", { class: "hr-vacio" }, "Aún no tienes piezas de esta ranura. Compra cofres en el Mercado."),
    );
  }));
}

/**
 * Pinta la sección Héroe dentro de `contenedor` (normalmente #seccion-heroe).
 * @param {HTMLElement} contenedor
 * @param {{stats?:object, nivel?:number, xp?:number, xpSiguiente?:number, equipo?:Record<string,string>,
 *          inventario?:object[], apariencia?:object, cosmeticosPosee?:number[], onVestir?:(id:number|null, ranura:string)=>void}} [o]
 */
export function renderHeroe(contenedor, o = {}) {
  const retrato = dentro(contenedor, "heroe-retrato");
  const stats = dentro(contenedor, "heroe-stats");
  const vest = dentro(contenedor, "heroe-vestuario");
  if (!retrato || !stats || !vest) return;

  const equipados = itemsEquipados(o.equipo ?? {}, o.inventario ?? [])
    .map((x) => ({ tipo: x.tipo, rareza: Number(x.rareza) || 0 }));
  const apariencia = { ...(o.apariencia ?? {}) };

  // Vista previa al pasar el ratón por un cosmético: sustituye el retrato y restaura el original al salir.
  let base = null;
  const probar = (id) => {
    if (base == null) base = retrato.innerHTML;
    try { FX.previsualizarCosmetico?.(retrato, id); } catch { /* sin previsualización */ }
  };
  const quitarPrueba = () => {
    if (base != null) { retrato.innerHTML = base; base = null; }
  };

  pintarRetrato(retrato, equipados, apariencia);
  pintarStats(stats, o.stats, o.nivel ?? 1, o.xp ?? 0, o.xpSiguiente ?? 100);
  pintarVestuario(vest, o.cosmeticosPosee ?? [], apariencia, { onVestir: o.onVestir, probar, quitarPrueba });
}
