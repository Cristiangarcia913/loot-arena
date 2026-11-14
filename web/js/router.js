// Router por hash de Loot Arena: una sección visible a la vez, con transición, foco accesible,
// recuerdo de la última sección (localStorage "lootarena:seccion") e insignias de aviso en el menú.
//
// Marcado que espera (index.html):
//   <nav id="menu"> <a class="menu-item" href="#/arena" data-ir="arena">…<span class="insignia" hidden></span></a> … </nav>
//   <section id="seccion-arena" class="seccion" data-seccion="arena" tabindex="-1"> … </section>
//
// Uso:
//   import { iniciarRouter, irA, marcarAviso, alCambiar } from "./router.js";
//   iniciarRouter();                 // index.html ya lo llama
//   marcarAviso("misiones", true);   // punto rojo en el menú
//   alCambiar((nueva, anterior) => …);

/** Secciones válidas, en el orden del menú. */
export const SECCIONES = Object.freeze(["arena", "heroe", "inventario", "mercado", "misiones", "logros", "expediciones", "torre", "ranking", "cadena"]);

const K_ULTIMA = "lootarena:seccion";
const oyentes = new Set();
const avisos = new Map();
let actual = null;
let iniciado = false;
let porDefectoSeccion = "arena";

const reducido = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const elSeccion = (s) => document.getElementById(`seccion-${s}`);
const deHash = (hash) => {
  const s = String(hash ?? "").replace(/^#\/?/, "").split(/[/?]/)[0].toLowerCase();
  return SECCIONES.includes(s) ? s : null;
};

/** @returns {string|null} sección visible ahora */
export function seccionActual() { return actual; }

/**
 * Suscribe una función a los cambios de sección.
 * @param {(nueva:string, anterior:string|null) => void} fn
 * @returns {() => void} función para darse de baja
 */
export function alCambiar(fn) { oyentes.add(fn); return () => oyentes.delete(fn); }

/**
 * Navega a una sección (cambia el hash; atrás/adelante funcionan).
 * @param {string} seccion una de SECCIONES
 */
export function irA(seccion) {
  if (!SECCIONES.includes(seccion)) return;
  if (location.hash === `#/${seccion}`) mostrar(seccion, true);
  else location.hash = `#/${seccion}`;
}

/**
 * Enciende o apaga la insignia (punto rojo) de una sección en el menú.
 * Se puede llamar antes de iniciarRouter(). El router NO la apaga solo al visitar la sección: lo decide quien la marcó.
 * @param {string} seccion una de SECCIONES
 * @param {boolean} hay true = hay algo que reclamar/ver
 * @param {number|string} [cuenta] opcional: número a mostrar dentro de la insignia
 */
export function marcarAviso(seccion, hay, cuenta) {
  if (!SECCIONES.includes(seccion)) return;
  avisos.set(seccion, { hay: !!hay, cuenta });
  pintarAviso(seccion);
}

/** @returns {boolean} si la sección tiene aviso encendido */
export function tieneAviso(seccion) { return !!avisos.get(seccion)?.hay; }

function pintarAviso(seccion) {
  const a = avisos.get(seccion) ?? { hay: false };
  document.querySelectorAll(`[data-ir="${seccion}"]`).forEach((link) => {
    let b = link.querySelector(".insignia");
    if (!b) { b = document.createElement("span"); b.className = "insignia"; link.append(b); }
    const nuevo = a.hay && b.hidden;
    b.hidden = !a.hay;
    b.textContent = a.hay && a.cuenta != null && a.cuenta !== "" ? String(a.cuenta) : "";
    b.classList.toggle("con-numero", !!b.textContent);
    const etiqueta = link.dataset.etiqueta ?? link.textContent.trim();
    link.dataset.etiqueta = etiqueta;
    link.setAttribute("aria-label", a.hay ? `${etiqueta} (hay novedades)` : etiqueta);
    if (nuevo && !reducido()) b.animate([{ transform: "scale(0)" }, { transform: "scale(1.5)" }, { transform: "scale(1)" }], { duration: 400 });
  });
}

function mostrar(seccion, enfocar) {
  const nueva = elSeccion(seccion);
  if (!nueva) return;
  const anterior = actual;
  if (anterior === seccion) { if (enfocar) enfocarSeccion(nueva); return; }
  actual = seccion;
  try { localStorage.setItem(K_ULTIMA, seccion); } catch { /* sin storage */ }
  for (const s of SECCIONES) {
    const el = elSeccion(s);
    if (el && s !== seccion && s !== anterior) el.hidden = true;
  }
  const vieja = anterior ? elSeccion(anterior) : null;
  if (vieja && !reducido()) {
    vieja.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: "ease-in" }).finished
      .catch(() => {}).finally(() => { if (actual !== anterior) vieja.hidden = true; });
  } else if (vieja) vieja.hidden = true;
  const entrar = () => {
    if (actual !== seccion) return;
    nueva.hidden = false;
    if (!reducido()) nueva.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], { duration: 220, easing: "cubic-bezier(.2,.8,.3,1)" });
    if (enfocar) enfocarSeccion(nueva);
  };
  if (vieja && !reducido()) setTimeout(entrar, 110); else entrar();

  document.querySelectorAll("[data-ir]").forEach((a) => {
    const on = a.dataset.ir === seccion;
    a.classList.toggle("activo", on);
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  document.body.dataset.seccion = seccion;
  const titulo = nueva.dataset.titulo ?? nueva.querySelector("h2")?.textContent?.trim();
  document.title = titulo ? `${titulo} · Loot Arena` : "Loot Arena";
  for (const fn of oyentes) { try { fn(seccion, anterior); } catch (e) { console.warn("[router]", e); } }
  window.dispatchEvent(new CustomEvent("lootarena:seccion", { detail: { seccion, anterior } }));
}

/**
 * Enfoca el `<h2>` de una sección (o la sección si no tiene). Exportada para que quien
 * repinta una sección después de que el router ya enfocó (torre, expediciones, cadena: su
 * contenido llega por red y se pinta con `replaceChildren`, que borra el nodo enfocado y el
 * foco cae a `<body>`) pueda devolver el foco a donde el router lo habría dejado.
 */
export function enfocarSeccion(el) {
  const destino = el.querySelector("h2") ?? el;
  if (!destino.hasAttribute("tabindex")) destino.setAttribute("tabindex", "-1");
  destino.focus({ preventScroll: true });
  el.scrollTop = 0;
}

/**
 * Arranca el router (idempotente). Muestra la sección del hash, o la última visitada, o `porDefecto`.
 * @param {{porDefecto?:string}} [opciones]
 * @returns {string} sección mostrada
 */
export function iniciarRouter({ porDefecto = "arena" } = {}) {
  porDefectoSeccion = SECCIONES.includes(porDefecto) ? porDefecto : "arena";
  if (iniciado) return actual;
  iniciado = true;
  for (const s of avisos.keys()) pintarAviso(s);
  window.addEventListener("hashchange", () => {
    const s = deHash(location.hash);
    if (s) mostrar(s, true);
  });
  // Atajos: Alt+1..9 y Alt+0 para la 10.ª (no hay tecla de "10": es la convención de las
  // pestañas del navegador). Hallazgo de Calidad (#14): con 10 secciones, Alt+1..9 por sí solo
  // deja "cadena" sin atajo.
  document.addEventListener("keydown", (ev) => {
    if (!ev.altKey || ev.ctrlKey || ev.metaKey) return;
    const d = Number(ev.key);
    if (!Number.isInteger(d) || d < 0 || d > 9) return;
    const n = d === 0 ? 10 : d;
    if (n >= 1 && n <= SECCIONES.length) { ev.preventDefault(); irA(SECCIONES[n - 1]); }
  });
  let inicial = deHash(location.hash);
  if (!inicial) {
    let ultima = null;
    try { ultima = localStorage.getItem(K_ULTIMA); } catch { /* sin storage */ }
    inicial = SECCIONES.includes(ultima) ? ultima : porDefectoSeccion;
    history.replaceState(null, "", `#/${inicial}`);
  }
  mostrar(inicial, false);
  return inicial;
}
