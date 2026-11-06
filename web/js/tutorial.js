// Tutorial del primer minuto de Loot Arena (MEJORAS-1.3 §3).
// Guía de 5 pasos: Explorar → Atacar → usar una habilidad → ver el botín → equiparlo.
// Resalta el elemento objetivo con un agujero en un velo oscuro, una flecha y un bocadillo corto.
// Se puede saltar (botón «Saltar» o Escape) y repetir desde el botón de ayuda «?».
//
// Uso (main.js):
//   import * as TUT from "./tutorial.js";
//   TUT.iniciarTutorial({ fx: FX, alPaso: (p) => … });   // solo se activa la primera vez
//   if (TUT.tutorialActivo()) enemigo = TUT.combateTutorial();
//   TUT.avanzarTutorial("explorar" | "ataque" | "habilidad" | "botin" | "equipar");
//
// La máquina de estados es pura (transicion) y funciona sin DOM: los tests la usan con node --test.

import { generarEnemigoDe } from "./combat.js";

export const CLAVE_TUTORIAL = "lootarena:tutorial";

/** Eventos que acepta avanzarTutorial, en el orden de los pasos. */
export const EVENTOS = Object.freeze(["explorar", "ataque", "habilidad", "botin", "equipar"]);

const SEL_EXPLORAR = { sel: "#btn-explorar", texto: "No hay combate ahora mismo: pulsa Explorar para encontrar un enemigo." };
// Si el jugador está en otra sección, le llevamos de vuelta a la Arena.
const SEL_ARENA = { sel: '.menu-item[href="#/arena"]', texto: "Vuelve a la Arena para seguir con la guía." };

/**
 * Pasos del tutorial. `objetivos` es una lista de candidatos: se resalta el primero visible y activo,
 * y si tiene `texto` propio sustituye al del paso (p. ej. si el combate terminó y hay que volver a explorar).
 */
export const PASOS = Object.freeze([
  {
    id: "explorar", titulo: "Explora la arena",
    texto: "Pulsa Explorar para buscar tu primer enemigo.",
    objetivos: [{ sel: "#btn-explorar" }, SEL_ARENA],
  },
  {
    id: "ataque", titulo: "¡Ataca!",
    texto: "Un enemigo salta a la arena. Pulsa Atacar para golpearle.",
    objetivos: [{ sel: "#btn-atacar" }, SEL_EXPLORAR, SEL_ARENA],
  },
  {
    id: "habilidad", titulo: "Usa una habilidad",
    texto: "Las habilidades pegan más fuerte o te protegen, pero luego se recargan. ¡Prueba una!",
    objetivos: [
      { sel: "#skills" },
      { sel: "#btn-atacar", texto: "Tu habilidad se está recargando: ataca mientras tanto." },
      SEL_EXPLORAR,
      SEL_ARENA,
    ],
  },
  {
    id: "botin", titulo: "Gana su botín",
    texto: "¡Remátalo! Al vencer, el enemigo puede soltar un objeto.",
    objetivos: [
      { sel: "#btn-atacar" },
      { sel: "#skills" },
      { sel: "#btn-explorar", texto: "Esta vez no cayó nada. Explora otra vez: el siguiente enemigo puede llevar botín." },
      SEL_ARENA,
    ],
  },
  {
    id: "equipar", titulo: "Equípate",
    texto: "Pulsa Equipar: tu héroe llevará el objeto en combate y será más fuerte.",
    objetivos: [
      { sel: '.item:not(.equipado) .item-acciones button[aria-pressed="false"]' },
      { sel: '.menu-item[href="#/inventario"], a[href="#/inventario"]', texto: "¡Botín conseguido! Abre el Inventario para verlo." },
    ],
  },
]);

export const TOTAL_PASOS = PASOS.length;

// ───────────────────────── Máquina de estados (pura) ─────────────────────────

/** @returns {{paso:number, terminado:boolean, saltado:boolean}} */
export function estadoInicial() {
  return { paso: 0, terminado: false, saltado: false };
}

/**
 * Aplica un evento. Un evento cuenta si corresponde al paso actual o a uno posterior
 * (p. ej. «botin» durante el paso «ataque» salta directamente a «equipar»); los anteriores o desconocidos se ignoran.
 * @param {{paso:number, terminado:boolean, saltado:boolean}} estado
 * @param {string} evento uno de EVENTOS
 * @returns {{paso:number, terminado:boolean, saltado:boolean}} nuevo estado (el mismo objeto si no cambia)
 */
export function transicion(estado, evento) {
  if (!estado || estado.terminado) return estado;
  const i = EVENTOS.indexOf(evento);
  if (i < 0 || i < estado.paso) return estado;
  const paso = i + 1;
  if (paso >= TOTAL_PASOS) return { paso: TOTAL_PASOS, terminado: true, saltado: false };
  return { ...estado, paso };
}

/** Estado tras pulsar «Saltar». */
export function saltar(estado) {
  if (!estado || estado.terminado) return estado;
  return { paso: estado.paso, terminado: true, saltado: true };
}

// ───────────────────────── Persistencia (storage inyectable) ─────────────────────────

function storagePorDefecto() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

/** true si el tutorial ya se completó o se saltó alguna vez. */
export function tutorialVisto(storage = storagePorDefecto()) {
  try {
    const v = storage?.getItem(CLAVE_TUTORIAL);
    if (!v) return false;
    const d = JSON.parse(v);
    return !!d?.terminado;
  } catch { return false; }
}

function guardarFin(storage, estado) {
  try { storage?.setItem(CLAVE_TUTORIAL, JSON.stringify({ v: 1, terminado: true, saltado: !!estado.saltado, fecha: Date.now() })); } catch { /* modo privado */ }
}
function borrar(storage) {
  try { storage?.removeItem(CLAVE_TUTORIAL); } catch { /* modo privado */ }
}

// ───────────────────────── Primer combate ─────────────────────────

/**
 * Enemigo fijo y fácil para el primer combate guiado: una rata de nivel 1 con poca vida y poco ataque.
 * Misma forma que combat.generarEnemigo (se pasa tal cual a crearCombate) y con `tutorial: true`.
 */
export function combateTutorial() {
  const base = generarEnemigoDe("rata", 1);
  return { ...base, nombre: "Rata de entrenamiento", vidaMax: 34, ataque: 6, defensa: 2, esquiva: 0, tutorial: true };
}

// ───────────────────────── Estado del módulo ─────────────────────────

const T = {
  estado: null,          // null = tutorial inactivo
  storage: undefined,
  fx: null,
  alPaso: null,
  raiz: null,
  ayuda: true,
  ui: null,
};

const hayDOM = () => typeof document !== "undefined" && typeof window !== "undefined";
const st = () => (T.storage === undefined ? storagePorDefecto() : T.storage);

/** Información pública del paso actual (la que recibe alPaso). */
export function pasoActual() {
  const e = T.estado;
  if (!e) return null;
  const p = PASOS[Math.min(e.paso, TOTAL_PASOS - 1)];
  return { indice: e.paso, id: e.terminado ? null : p.id, titulo: p.titulo, texto: p.texto, total: TOTAL_PASOS, terminado: e.terminado, saltado: e.saltado };
}

/** true mientras la guía está en marcha (ni terminada ni saltada). */
export function tutorialActivo() {
  return !!T.estado && !T.estado.terminado;
}

function notificar() {
  try { T.alPaso?.(pasoActual()); } catch (err) { console.error("[tutorial] alPaso falló", err); }
}

function cambiar(nuevo) {
  if (nuevo === T.estado) return false;
  T.estado = nuevo;
  if (nuevo.terminado) {
    guardarFin(st(), nuevo);
    if (!nuevo.saltado) {
      try { T.fx?.anunciar?.("¡LISTO!", "Ya sabes lo básico. ¡A por más botín!", "anuncio-nivel"); } catch { /* opcional */ }
    }
  }
  notificar();
  pintar(true);
  // main.js suele repintar los botones justo después (p. ej. #skills): recolocamos en el siguiente frame.
  if (hayDOM()) requestAnimationFrame(() => posicionar(false));
  return true;
}

/**
 * Arranca el tutorial si es la primera vez (o siempre con `forzar`). Monta también el botón de ayuda «?».
 * @param {{fx?:object, alPaso?:(paso:object)=>void, raiz?:HTMLElement|null, storage?:Storage|null, forzar?:boolean, ayuda?:boolean}} [opciones]
 *   fx: módulo fx.js (opcional, para anunciar el final) · alPaso: se llama en cada cambio de paso ·
 *   raiz: dónde montar la capa (por defecto document.body) · storage: sustituye a localStorage (tests) ·
 *   forzar: empezar aunque ya se viera · ayuda: false para no crear el botón «?».
 * @returns {boolean} true si la guía quedó activa
 */
export function iniciarTutorial({ fx = null, alPaso = null, raiz, storage, forzar = false, ayuda = true } = {}) {
  T.fx = fx;
  T.alPaso = alPaso;
  T.ayuda = ayuda;
  if (storage !== undefined) T.storage = storage;
  if (raiz !== undefined) T.raiz = raiz;
  montarUI();
  if (!forzar && tutorialVisto(st())) {
    T.estado = null;
    pintar(false);
    return false;
  }
  T.estado = estadoInicial();
  notificar();
  pintar(true);
  return true;
}

/**
 * Notifica una acción del jugador.
 * @param {"explorar"|"ataque"|"habilidad"|"botin"|"equipar"} evento
 * @returns {boolean} true si el tutorial avanzó
 */
export function avanzarTutorial(evento) {
  if (!tutorialActivo()) return false;
  return cambiar(transicion(T.estado, evento));
}

/** Salta la guía (como el botón «Saltar» o Escape) y la marca como vista. */
export function saltarTutorial() {
  if (!tutorialActivo()) return false;
  return cambiar(saltar(T.estado));
}

/** Borra la marca de «visto» y vuelve a empezar desde el paso 1 (lo usa el botón de ayuda). */
export function reiniciarTutorial() {
  borrar(st());
  return iniciarTutorial({ fx: T.fx, alPaso: T.alPaso, ayuda: T.ayuda, forzar: true });
}

/** Desmonta la capa y el botón de ayuda y olvida el estado en memoria (no toca el storage). */
export function detenerTutorial() {
  T.estado = null;
  desmontarUI();
}

// ───────────────────────── Interfaz ─────────────────────────

function crear(tag, clase, attrs = {}) {
  const n = document.createElement(tag);
  if (clase) n.className = clase;
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

function montarUI() {
  if (!hayDOM()) return;
  const raiz = T.raiz || document.body;
  if (T.ui && T.ui.raiz === raiz) { T.ui.ayuda.hidden = !T.ayuda; return; }
  desmontarUI();

  const capa = crear("div", "tut-capa", { "data-tutorial": "" });
  capa.hidden = true;
  const agujero = crear("div", "tut-agujero", { "aria-hidden": "true" });
  const flecha = crear("div", "tut-flecha", { "aria-hidden": "true" });
  flecha.innerHTML = '<svg viewBox="0 0 24 24" width="30" height="30"><path d="M12 3v15m0 0-6-6m6 6 6-6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const bocadillo = crear("div", "tut-bocadillo", { role: "dialog", "aria-modal": "false", "aria-labelledby": "tut-titulo", "aria-describedby": "tut-texto" });
  const cuenta = crear("div", "tut-cuenta");
  const puntos = crear("div", "tut-puntos", { "aria-hidden": "true" });
  for (let i = 0; i < TOTAL_PASOS; i++) puntos.append(crear("span", "tut-punto"));
  const titulo = crear("h2", "tut-titulo", { id: "tut-titulo" });
  const texto = crear("p", "tut-texto", { id: "tut-texto", "aria-live": "polite" });
  const acciones = crear("div", "tut-acciones");
  const btnSaltar = crear("button", "tut-saltar", { type: "button" });
  btnSaltar.textContent = "Saltar tutorial";
  btnSaltar.addEventListener("click", () => saltarTutorial());
  const pista = crear("span", "tut-pista");
  pista.textContent = "Esc para saltar";
  acciones.append(pista, btnSaltar);
  const cab = crear("div", "tut-cab");
  cab.append(cuenta, puntos);
  bocadillo.append(cab, titulo, texto, acciones);
  capa.append(agujero, flecha, bocadillo);

  const ayuda = crear("button", "tut-ayuda", { type: "button", "aria-label": "Repetir el tutorial", title: "Repetir el tutorial" });
  ayuda.textContent = "?";
  ayuda.hidden = !T.ayuda;
  ayuda.addEventListener("click", () => reiniciarTutorial());

  raiz.append(capa, ayuda);

  const reprogramar = () => {
    if (!T.ui || T.ui.raf) return;
    T.ui.raf = requestAnimationFrame(() => { if (T.ui) { T.ui.raf = 0; posicionar(false); } });
  };
  const tecla = (ev) => {
    if (ev.key !== "Escape" || !tutorialActivo() || modalAjeno()) return;
    ev.preventDefault();
    saltarTutorial();
  };
  window.addEventListener("resize", reprogramar);
  window.addEventListener("scroll", reprogramar, true);
  document.addEventListener("keydown", tecla);
  const intervalo = setInterval(() => posicionar(false), 250);

  T.ui = {
    raiz, capa, agujero, flecha, bocadillo, cuenta, puntos, titulo, texto, ayuda, btnSaltar,
    raf: 0, intervalo, objetivoEnfocado: null, focoPuesto: null, pasoPintado: -1,
    quitar: () => {
      window.removeEventListener("resize", reprogramar);
      window.removeEventListener("scroll", reprogramar, true);
      document.removeEventListener("keydown", tecla);
      clearInterval(intervalo);
      if (T.ui?.raf) cancelAnimationFrame(T.ui.raf);
    },
  };
}

function desmontarUI() {
  if (!T.ui) return;
  T.ui.quitar();
  T.ui.capa.remove();
  T.ui.ayuda.remove();
  T.ui = null;
}

/**
 * Rectángulo de un elemento. Los contenedores sin caja propia (p. ej. `#skills`, que es `display: contents`)
 * usan la unión de sus hijos visibles.
 */
function rectDe(el) {
  const r = el.getBoundingClientRect();
  if (r.width >= 2 && r.height >= 2) return r;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const h of el.children) {
    const rh = h.getBoundingClientRect();
    if (rh.width < 2 || rh.height < 2) continue;
    x1 = Math.min(x1, rh.left); y1 = Math.min(y1, rh.top); x2 = Math.max(x2, rh.right); y2 = Math.max(y2, rh.bottom);
  }
  if (x1 === Infinity) return r;
  return { left: x1, top: y1, right: x2, bottom: y2, width: x2 - x1, height: y2 - y1 };
}

function visible(el) {
  if (!el || !el.isConnected) return false;
  if (el.closest("[hidden], [inert]")) return false;
  const cs = getComputedStyle(el);
  if (cs.visibility === "hidden" || cs.display === "none") return false;
  const r = rectDe(el);
  return r.width >= 2 && r.height >= 2;
}

function activo(el) {
  if (el.matches("button, input, select, textarea")) return !el.disabled;
  // Contenedores como #skills: activos si tienen algún botón usable.
  if (el.querySelector("button")) return !!el.querySelector("button:not([disabled])");
  return true;
}

function enfocable(el) {
  if (el.matches("button, a[href], input, select, textarea, [tabindex]")) return el;
  return el.querySelector("button:not([disabled]), a[href]");
}

/** Busca el objetivo del paso actual: el primer candidato visible y activo. */
function buscarObjetivo(paso) {
  for (const o of paso.objetivos) {
    for (const el of document.querySelectorAll(o.sel)) {
      if (visible(el) && activo(el)) return { el, texto: o.texto || paso.texto };
    }
  }
  return { el: null, texto: paso.texto };
}

function modalAjeno() {
  for (const m of document.querySelectorAll('[aria-modal="true"]')) {
    if (!m.closest(".tut-capa") && visible(m)) return true;
  }
  return false;
}

function pintar(cambioDePaso) {
  if (!T.ui) return;
  T.ui.ayuda.hidden = !T.ayuda || tutorialActivo();
  if (!tutorialActivo()) {
    T.ui.capa.hidden = true;
    T.ui.pasoPintado = -1;
    T.ui.objetivoEnfocado = null;
    // Si el foco estaba en el bocadillo, devuélvelo a algo útil.
    if (T.ui.capa.contains(document.activeElement)) (T.ui.ayuda.hidden ? document.body : T.ui.ayuda).focus?.();
    return;
  }
  posicionar(cambioDePaso);
}

const MARGEN = 10;
const HOLGURA = 6;

function posicionar(cambioDePaso) {
  const ui = T.ui;
  if (!ui || !tutorialActivo()) return;
  const e = T.estado;
  const paso = PASOS[e.paso];

  // Otro diálogo modal encima (revelado de botín, resultado…): la guía espera escondida.
  if (modalAjeno()) { ui.capa.hidden = true; return; }
  if (ui.capa.hidden) {
    // Al reaparecer, colocamos sin transición (si no, el bocadillo «vuela» desde la esquina).
    ui.capa.classList.add("tut-sin-trans");
    ui.objetivoEnfocado = undefined; // tras un modal ajeno el foco quedó fuera: lo devolvemos al objetivo
    requestAnimationFrame(() => requestAnimationFrame(() => ui.capa.classList.remove("tut-sin-trans")));
  }
  ui.capa.hidden = false;

  const { el, texto } = buscarObjetivo(paso);
  const nuevoPaso = ui.pasoPintado !== e.paso;
  if (nuevoPaso) {
    ui.pasoPintado = e.paso;
    ui.cuenta.textContent = `Paso ${e.paso + 1} de ${TOTAL_PASOS}`;
    ui.titulo.textContent = paso.titulo;
    [...ui.puntos.children].forEach((p, i) => { p.classList.toggle("hecho", i < e.paso); p.classList.toggle("actual", i === e.paso); });
    ui.objetivoEnfocado = undefined; // fuerza a recolocar el foco en este paso
  }
  if (ui.texto.textContent !== texto) ui.texto.textContent = texto;

  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = window.innerHeight;
  ui.capa.classList.toggle("sin-objetivo", !el);

  // Foco: al llegar a un objetivo nuevo, lo llevamos ahí (Enter/Espacio lo pulsa). Sin objetivo, al bocadillo.
  const act = document.activeElement;
  const focoPerdido = !act || act === document.body || act.disabled || ui.capa.contains(act);
  // Si el botón que enfocamos se repintó (main.js reconstruye #skills), recuperamos el foco.
  const repintado = ui.focoPuesto && !ui.focoPuesto.isConnected && focoPerdido;
  if (el !== ui.objetivoEnfocado || repintado) {
    ui.objetivoEnfocado = el;
    const previo = ui.focoPuesto; // si el foco sigue en el objetivo anterior, lo movemos al nuevo
    ui.focoPuesto = null;
    const reducido = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (el) {
      const r0 = rectDe(el);
      if (r0.top < 0 || r0.bottom > vh) el.scrollIntoView({ block: "center", behavior: reducido ? "auto" : "smooth" });
      const f = enfocable(el);
      if (f && (nuevoPaso || cambioDePaso || focoPerdido || act === previo)) { f.focus({ preventScroll: true }); ui.focoPuesto = f; }
    } else if (nuevoPaso) {
      ui.btnSaltar.focus({ preventScroll: true });
    }
  }

  const bw = Math.min(330, vw - 2 * MARGEN);
  ui.bocadillo.style.width = `${bw}px`;
  const bh = ui.bocadillo.offsetHeight;

  if (!el) {
    ui.agujero.hidden = true;
    ui.flecha.hidden = true;
    ui.bocadillo.style.left = `${Math.round((vw - bw) / 2)}px`;
    ui.bocadillo.style.top = `${Math.round(Math.max(MARGEN, (vh - bh) / 2))}px`;
    return;
  }

  const r = rectDe(el);
  const h = { x: r.left - HOLGURA, y: r.top - HOLGURA, w: r.width + 2 * HOLGURA, h: r.height + 2 * HOLGURA };
  ui.agujero.hidden = false;
  Object.assign(ui.agujero.style, { left: `${h.x}px`, top: `${h.y}px`, width: `${h.w}px`, height: `${h.h}px` });

  // Bocadillo debajo si cabe; si no, encima; si tampoco, sobre el objetivo pegado al borde con más sitio.
  const FL = 38; // hueco para la flecha
  const abajo = vh - (h.y + h.h), arriba = h.y;
  let top, flechaArriba;
  if (abajo >= bh + FL + MARGEN || abajo >= arriba) {
    top = Math.min(h.y + h.h + FL, vh - bh - MARGEN);
    flechaArriba = true;
  } else {
    top = Math.max(MARGEN, h.y - FL - bh);
    flechaArriba = false;
  }
  const cx = h.x + h.w / 2;
  const left = Math.max(MARGEN, Math.min(cx - bw / 2, vw - bw - MARGEN));
  ui.bocadillo.style.left = `${Math.round(left)}px`;
  ui.bocadillo.style.top = `${Math.round(top)}px`;

  // Flecha entre el bocadillo y el agujero, apuntando al objetivo.
  const fx = Math.max(MARGEN, Math.min(cx - 15, vw - 30 - MARGEN));
  const fy = flechaArriba ? h.y + h.h + 4 : h.y - 34;
  const solapa = flechaArriba ? fy + 30 > top + 2 : fy < top + bh - 2;
  ui.flecha.hidden = solapa;
  ui.flecha.classList.toggle("arriba", flechaArriba);
  Object.assign(ui.flecha.style, { left: `${Math.round(fx)}px`, top: `${Math.round(fy)}px` });
}
