// Auditoría de accesibilidad sobre la página viva: contraste, teclado, foco visible,
// nombres accesibles y zonas vivas (aria-live). Se ejecuta como casos del arnés y además
// expone `auditar(app)` para el informe detallado.

import { caso, afirmar, igual, esperarA, dormir } from "./arnes.js";
import { irASeccion, SECCIONES, seccionesDe, enfocables, nombreAccesible, explorar, resultadoVisible, vida, combatirHastaElFinal } from "./ayudas.js";

// ───────────────────────── Contraste (WCAG 2.1) ─────────────────────────

function aRgb(css) {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.%]+))?\s*\)/i.exec(css ?? "");
  if (!m) return null;
  let a = m[4] == null ? 1 : (m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
  return { r: +m[1], g: +m[2], b: +m[3], a };
}

const canal = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
export const luminancia = ({ r, g, b }) => 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);

/** Mezcla un color con alfa sobre un fondo opaco. */
const sobre = (frente, fondo) => ({
  r: frente.r * frente.a + fondo.r * (1 - frente.a),
  g: frente.g * frente.a + fondo.g * (1 - frente.a),
  b: frente.b * frente.a + fondo.b * (1 - frente.a),
  a: 1,
});

/** Razón de contraste entre dos colores opacos, 1..21. */
export function contraste(c1, c2) {
  const [a, b] = [luminancia(c1), luminancia(c2)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

/** Colores que declara un degradado (linear-gradient, radial-gradient…). */
function paradasDeDegradado(backgroundImage) {
  if (!backgroundImage || backgroundImage === "none" || !/gradient\(/i.test(backgroundImage)) return [];
  return [...backgroundImage.matchAll(/rgba?\([^)]*\)/gi)].map((m) => aRgb(m[0])).filter((c) => c && c.a > 0.5);
}

/**
 * Fondos posibles detrás de un elemento. Sube por los ancestros hasta dar con un color opaco y,
 * si por el camino hay degradados, añade sus paradas de color como candidatos: así el veredicto
 * es el del PEOR caso real y no «no se sabe».
 *
 * @returns {{colores:{r,g,b,a}[], incierto:boolean}} incierto = hay una imagen de verdad (no un
 *          degradado) por medio y el fondo no se puede saber solo con el CSSOM.
 */
export function fondoEfectivo(el, win) {
  let incierto = false;
  const candidatos = [];
  let acumulado = null;
  for (let n = el; n; n = n.parentElement) {
    const cs = win.getComputedStyle(n);
    const img = cs.backgroundImage;
    if (img && img !== "none") {
      const paradas = paradasDeDegradado(img);
      if (!paradas.length) incierto = true; // url(...) u otra imagen: no se puede calcular
      else if (paradas.every((p) => p.a >= 0.999)) {
        // Degradado opaco: tapa todo lo que haya detrás, así que aquí se acaba la búsqueda.
        return { colores: paradas, incierto };
      } else candidatos.push(...paradas);
    }
    const c = aRgb(cs.backgroundColor);
    if (!c || c.a === 0) continue;
    acumulado = acumulado ? sobre(acumulado, c) : c;
    if (acumulado.a >= 0.999) { candidatos.push(acumulado); return { colores: candidatos, incierto }; }
  }
  const cuerpo = aRgb(win.getComputedStyle(el.ownerDocument.body).backgroundColor) ?? { r: 255, g: 255, b: 255, a: 1 };
  candidatos.push(acumulado ? sobre(acumulado, cuerpo) : cuerpo);
  return { colores: candidatos, incierto };
}

/** Umbral AA según el tamaño de letra (texto grande = ≥24px, o ≥18.66px en negrita). */
export function umbralAA(cs) {
  const px = parseFloat(cs.fontSize) || 16;
  const negrita = (parseInt(cs.fontWeight, 10) || 400) >= 700;
  return (px >= 24 || (negrita && px >= 18.66)) ? 3 : 4.5;
}

const VISIBLE = (el) => el.getClientRects().length > 0 && !el.closest("[hidden]");

/**
 * Congela transiciones y animaciones en la página bajo prueba.
 *
 * Hace falta de verdad: el iframe del arnés vive fuera de la pantalla, y Chrome no produce
 * fotogramas para lo que no se ve, así que una `transition: color .15s` se queda a medias para
 * siempre y `getComputedStyle` devuelve el color de PARTIDA. Sin esto, la entrada activa del menú
 * se medía a 1,42:1 cuando en la página real es 5,11:1. Un falso positivo así quema el informe.
 */
export function congelarTransiciones(app) {
  if (app.doc.getElementById("arnes-sin-transiciones")) return;
  const s = app.doc.createElement("style");
  s.id = "arnes-sin-transiciones";
  s.textContent = "*, *::before, *::after { transition: none !important; animation: none !important; }";
  app.doc.head.append(s);
}
const TEXTO_PROPIO = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);

/** Revisa el contraste de todo el texto visible de la página. */
export function revisarContraste(app) {
  congelarTransiciones(app);
  const win = app.win;
  const fallos = [];
  for (const el of app.$$("body *")) {
    if (!VISIBLE(el) || !TEXTO_PROPIO(el)) continue;
    if (el.closest('[aria-hidden="true"]')) continue;
    const cs = win.getComputedStyle(el);
    if (cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.1) continue;
    const frente = aRgb(cs.color);
    if (!frente) continue;
    // El texto recortado contra el fondo (background-clip: text) no se puede medir así.
    if (/text/.test(cs.webkitBackgroundClip ?? "") || /text/.test(cs.backgroundClip ?? "")) continue;
    if (frente.a === 0) continue;
    const { colores, incierto } = fondoEfectivo(el, win);
    const min = umbralAA(cs);
    // Peor caso entre todos los fondos posibles (incluidas las paradas de los degradados).
    let peor = null;
    for (const fondo of colores) {
      const c = contraste(frente.a < 1 ? sobre(frente, fondo) : frente, fondo);
      if (!peor || c < peor.c) peor = { c, fondo };
    }
    if (peor && peor.c + 0.01 < min) {
      fallos.push({
        selector: ruta(el),
        texto: el.textContent.replace(/\s+/g, " ").trim().slice(0, 60),
        contraste: Math.round(peor.c * 100) / 100,
        minimo: min,
        color: cs.color, fondo: `rgb(${Math.round(peor.fondo.r)}, ${Math.round(peor.fondo.g)}, ${Math.round(peor.fondo.b)})`,
        tamano: cs.fontSize,
        incierto,
      });
    }
  }
  return fallos;
}

function ruta(el) {
  const trozos = [];
  for (let n = el; n && n.tagName !== "BODY" && trozos.length < 4; n = n.parentElement) {
    let s = n.tagName.toLowerCase();
    if (n.id) { trozos.unshift(`#${n.id}`); break; }
    if (n.className && typeof n.className === "string") s += `.${n.className.trim().split(/\s+/).slice(0, 2).join(".")}`;
    trozos.unshift(s);
  }
  return trozos.join(" > ");
}

// ───────────────────────── Auditoría completa (para el informe) ─────────────────────────

export async function auditar(app) {
  congelarTransiciones(app);
  const informe = { contraste: [], sinNombre: [], sinFocoVisible: [], imagenesSinTexto: [], vivas: [], secciones: {} };
  for (const s of seccionesDe(app)) {
    await irASeccion(app, s);
    await dormir(150);
    informe.secciones[s] = { contraste: revisarContraste(app).length, enfocables: enfocables(app).length };
    informe.contraste.push(...revisarContraste(app).map((f) => ({ ...f, seccion: s })));
    for (const el of enfocables(app)) {
      if (!nombreAccesible(el)) informe.sinNombre.push({ seccion: s, selector: ruta(el), html: el.outerHTML.slice(0, 120) });
    }
    for (const img of app.$$("img, svg[role='img'], [role='img']")) {
      if (img.closest('[aria-hidden="true"]') || img.getAttribute("aria-hidden") === "true") continue;
      const alt = img.getAttribute("alt") ?? img.getAttribute("aria-label") ?? img.querySelector("title")?.textContent;
      if (!alt?.trim()) informe.imagenesSinTexto.push({ seccion: s, selector: ruta(img) });
    }
  }
  // Duplicados fuera (el mismo elemento aparece en varias secciones si está en la cabecera)
  const visto = new Set();
  informe.contraste = informe.contraste.filter((f) => { const k = `${f.selector}|${f.texto}`; if (visto.has(k)) return false; visto.add(k); return true; });
  const visto2 = new Set();
  informe.sinNombre = informe.sinNombre.filter((f) => { if (visto2.has(f.selector)) return false; visto2.add(f.selector); return true; });
  informe.vivas = app.$$("[aria-live], [role=status], [role=alert]").map((e) => ruta(e));
  return informe;
}

// ───────────────────────── Casos ─────────────────────────

caso("Accesibilidad", "Se puede jugar un combate entero solo con el teclado", async ({ abrirApp }) => {
  const app = await abrirApp();
  const doc = app.doc;
  const pulsarConTeclado = (sel) => {
    const el = app.$(sel);
    afirmar(el, `No existe ${sel}.`);
    afirmar(el.tabIndex >= 0 && !el.disabled, `${sel} no es alcanzable con el teclado (tabIndex=${el.tabIndex}, disabled=${el.disabled}).`);
    el.focus();
    afirmar(doc.activeElement === el, `No se pudo poner el foco en ${sel}.`);
    // Un <button> nativo se activa con Enter y Espacio; disparamos el click que el navegador generaría.
    el.click();
  };
  pulsarConTeclado("#btn-explorar");
  await esperarA(() => !app.$("#btn-atacar").disabled, "empiece el combate tras Explorar con el teclado");
  let turnos = 0;
  while (!resultadoVisible(app) && turnos < 80) {
    if (!app.$("#btn-atacar").disabled) { pulsarConTeclado("#btn-atacar"); turnos++; }
    await dormir(40);
  }
  afirmar(resultadoVisible(app), "No se logró terminar el combate usando solo el teclado.");
  const caja = app.$("#pantalla-resultado");
  afirmar(caja.contains(doc.activeElement), `Al abrirse la pantalla de resultado el foco se queda fuera de ella (está en «${doc.activeElement?.tagName}»): con teclado hay que tabular a ciegas.`);
  app.tecla("Escape", { destino: doc.body });
  await esperarA(() => !app.visible("#pantalla-resultado"), "Escape cierre la pantalla de resultado");
  app.sinErrores("jugando con el teclado");
});

caso("Accesibilidad", "La pantalla de resultado, que dice ser modal, no deja el foco escaparse detrás", async ({ abrirApp }) => {
  const app = await abrirApp();
  await explorar(app);
  await combatirHastaElFinal(app);
  afirmar(resultadoVisible(app), "No se llegó a la pantalla de resultado.");
  const caja = app.$("#pantalla-resultado");
  igual(caja.getAttribute("aria-modal"), "true", "La pantalla de resultado debería declararse modal.");
  const fueraAlcanzables = enfocables(app).filter((e) => !caja.contains(e));
  igual(fueraAlcanzables.length, 0,
    `La pantalla de resultado es aria-modal="true" pero deja ${fueraAlcanzables.length} elementos de detrás alcanzables con Tab (p. ej. «${nombreAccesible(fueraAlcanzables[0] ?? {getAttribute:()=>null, cloneNode:()=>({querySelectorAll:()=>[],textContent:""})}) || fueraAlcanzables[0]?.id}»). Falta atrapar el foco o marcar el resto como inerte.`);
});

caso("Accesibilidad", "Todo lo que recibe foco tiene nombre accesible", async ({ abrirApp }) => {
  const app = await abrirApp();
  const sin = [];
  for (const s of seccionesDe(app)) {
    await irASeccion(app, s);
    await dormir(120);
    for (const el of enfocables(app)) if (!nombreAccesible(el)) sin.push(`${s}: <${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""} class="${el.className}">`);
  }
  igual([...new Set(sin)].join("\n  "), "", "Elementos enfocables sin nombre accesible (un lector de pantalla diría solo «botón»):");
});

/**
 * Reglas de foco declaradas en las hojas de estilo. No vale con hacer `el.focus()` desde un script:
 * Chrome no aplica `:focus-visible` si la última interacción no vino del teclado, así que se
 * comprueba contra el CSSOM que exista una regla de foco que case con el elemento.
 */
function reglasDeFoco(win) {
  const reglas = [];
  for (const hoja of win.document.styleSheets) {
    let lista;
    try { lista = hoja.cssRules; } catch { continue; } // hoja de otro origen
    // Ojo: en Chrome moderno una CSSStyleRule normal TAMBIÉN tiene `cssRules` (vacía) por el CSS
    // anidado, así que no vale usarla para distinguir @media de una regla corriente.
    const recorrer = (rs) => {
      for (const r of rs) {
        if (r.selectorText && /:focus(-visible)?\b/.test(r.selectorText)
          && /outline|box-shadow|border|background|color|transform/i.test(r.style?.cssText ?? "")) {
          for (const sel of r.selectorText.split(",")) {
            // `:focus-visible` a secas es `*:focus-visible`: cubre toda la página.
            reglas.push(sel.replace(/:focus(-visible|-within)?/g, "").trim() || "*");
          }
        }
        if (r.cssRules?.length) recorrer(r.cssRules);
      }
    };
    recorrer(lista);
  }
  return reglas;
}

caso("Accesibilidad", "El foco se ve en los botones principales", async ({ abrirApp }) => {
  const app = await abrirApp();
  const reglas = reglasDeFoco(app.win);
  afirmar(reglas.length > 0, "No hay ni una sola regla :focus-visible en las hojas de estilo.");
  const sin = [];
  for (const sel of ["#btn-explorar", "#btn-atacar", "#btn-connect", "#btn-sonido", ".menu-item[data-ir='arena']", "#merc-tab-vender", "a.saltar"]) {
    const el = app.$(sel);
    if (!el) continue;
    const cubierto = reglas.some((base) => { try { return el.matches(base); } catch { return false; } });
    if (!cubierto) sin.push(sel);
  }
  igual(sin.join(", "), "", "Elementos sin ninguna regla de foco visible en el CSS (quien navega con teclado no sabe dónde está):");
});

caso("Accesibilidad", "Las zonas que cambian solas están anunciadas (aria-live)", async ({ abrirApp }) => {
  const app = await abrirApp();
  const faltan = [];
  for (const [sel, porque] of [["#log", "la crónica del combate"], ["#resultado", "el resultado del combate"], ["#banner", "los avisos de la cabecera"], ["#inv-estado", "el estado del inventario"]]) {
    const el = app.$(sel);
    if (!el) { faltan.push(`${sel} (no existe)`); continue; }
    const vivo = el.getAttribute("aria-live") || el.getAttribute("role") === "status" || el.getAttribute("role") === "alert" || el.closest("[aria-live]");
    if (!vivo) faltan.push(`${sel} → ${porque}`);
  }
  igual(faltan.join("; "), "", "Zonas que cambian solas sin aria-live:");
});

caso("Accesibilidad", "Los toasts se anuncian y no tapan contenido para siempre", async ({ abrirApp }) => {
  const app = await abrirApp();
  app.pulsar("#btn-atacar", { permitirDesactivado: true });
  await dormir(200);
  const t = app.$("#toasts .toast");
  if (t) afirmar(t.getAttribute("role") === "status" || t.getAttribute("aria-live"), "Los toasts no tienen role=status: no se anuncian.");
  app.sinErrores("con los toasts");
});

caso("Accesibilidad", "Contraste AA en todo el texto visible de cada sección", async ({ abrirApp }) => {
  const app = await abrirApp();
  congelarTransiciones(app);
  const todos = [];
  for (const s of seccionesDe(app)) {
    await irASeccion(app, s);
    await dormir(150);
    todos.push(...revisarContraste(app).map((f) => ({ ...f, seccion: s })));
  }
  const unicos = [...new Map(todos.map((f) => [`${f.selector}|${f.texto}`, f])).values()];
  const seguros = unicos.filter((f) => !f.incierto);
  const texto = unicos.map((f) => `  · [${f.seccion}] ${f.selector} «${f.texto}» → ${f.contraste}:1 (mínimo ${f.minimo}:1, ${f.color} sobre ${f.fondo}, ${f.tamano})${f.incierto ? " [fondo con imagen/degradado: comprobar a ojo]" : ""}`).join("\n");
  afirmar(seguros.length === 0, `${unicos.length} textos no llegan al contraste AA (${seguros.length} sin duda):\n${texto}`);
});

caso("Accesibilidad", "La barra de vida y la de XP comunican su valor sin depender del color", async ({ abrirApp }) => {
  const app = await abrirApp();
  await explorar(app);
  const v = vida(app, "heroe");
  afirmar(v, "La barra de vida del héroe no muestra el número: quien no distingue el color no sabe cuánta vida le queda.");
  const xp = app.$("#hero-xp");
  afirmar(xp?.getAttribute("role") === "progressbar" && xp.hasAttribute("aria-valuenow"), "La barra de XP no expone su valor (role=progressbar + aria-valuenow).");
  const hp = app.$("#f-jugador .hp");
  afirmar(hp?.getAttribute("role") === "progressbar" || hp?.getAttribute("aria-label"),
    "La barra de vida no es un progressbar ni tiene aria-valuenow: un lector de pantalla no puede leer la vida restante durante el combate.");
});

caso("Accesibilidad", "El documento declara idioma y tiene un solo h1", async ({ abrirApp }) => {
  const app = await abrirApp();
  igual(app.doc.documentElement.lang, "es", "El <html> no declara lang=\"es\".");
  const h1 = app.$$("h1");
  afirmar(h1.length >= 1, "La página no tiene ningún <h1>.");
  igual(h1.length, 1, `La página tiene ${h1.length} elementos <h1>.`);
});
