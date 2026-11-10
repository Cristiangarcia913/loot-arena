// Arena en 3D de Loot Arena. Mismo contrato que la escena de combate de `fx.js`, para que
// `main.js` no tenga que cambiar ni una línea (decisión 2 del plan maestro: el 3D no sustituye al
// 2D, lo envuelve).
//
// Uso:
//   import * as R3D from "./render3d/escena3d.js";
//   R3D.montarEscena(document.getElementById("escena"));   // devuelve ya, carga three.js detrás
//   R3D.mostrarEnemigo(enemigo);
//   await R3D.animarAtaque("heroe", { critico: true });
//   await R3D.animarGolpe("enemigo", 12, { critico: true });
//
// Lo que NO es la escena de combate (revelar botín, pantalla de resultado, portada, anuncios,
// toasts de logros, inventario, sonido) se delega tal cual en `fx.js`: está reexportado al final
// del archivo, así que este módulo se puede usar como sustituto completo de `fx.js`.
//
// `quien` acepta "heroe" | "jugador" (sinónimos) | "enemigo", igual que en fx.js.

import { cargarTres, soporta3d, infoGpu, MSG_3D, TRES_VERSION, TRES_REVISION } from "./tres.js";
import { construirEscenario, animarEscenario, PUESTO_X, CAMARA, encuadre } from "./escenario.js";
import { construirEnemigo, construirHeroe } from "./criaturas.js";
import { Rotulos, textoDeGolpe } from "./numeros.js";
import { liberarRama } from "./piezas.js";
import {
  CALIDADES, Medidor, Vigilante, bajarCalidad, consultaReducido, detectarEquipo, duracion, nivelEquipo,
} from "./rendimiento.js";
import { claveDeNombre } from "./paleta.js";
import { BESTIARIO } from "../combat.js";
import { iconoEstado, iconoIntencion } from "../sprites.js";
import { sonar } from "../audio.js";
import { iniciarInterfaz as fxIniciarInterfaz, montarEscena as fxMontarEscena } from "../fx.js";

export { TRES_VERSION, TRES_REVISION, MSG_3D, soporta3d };

// ───────────────────────── Estado ─────────────────────────

const E = {
  raiz: null, lienzo: null, T: null,
  render: null, escena: null, camara: null,
  esc: null, rotulos: null,
  lados: { heroe: null, enemigo: null },
  equipados: [], apariencia: {},
  enemigo: null,
  estados: { heroe: [], enemigo: [] },
  intencion: null,
  vida: { heroe: null, enemigo: null },
  calidad: "medio", medidor: null, vigilante: null,
  tweens: [], efimeros: [],
  raf: 0, visible: true, montado: false, listo: false,
  t0: 0, tiempo: 0, ultimo: 0, congelado: 0,
  sacudida: { amp: 0, hasta: 0, dur: 1 },
  auto: true, alAviso: null, aviso: "",
  precalentar: true, colaPrecalentado: [], idle: 0,
  observadores: [],
  promesaListo: null,
};

const mqReducido = consultaReducido();
/** @returns {boolean} true si el usuario pidió movimiento reducido. */
export const reducido = () => !!mqReducido.matches;

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const azar = (a, b) => a + Math.random() * (b - a);
const lado = (quien) => (quien === "enemigo" ? "enemigo" : "heroe");
const otroLado = (q) => (lado(q) === "heroe" ? "enemigo" : "heroe");
const dur = (ms) => duracion(ms, reducido());
const el = (tag, clase, html) => { const n = document.createElement(tag); if (clase) n.className = clase; if (html != null) n.innerHTML = html; return n; };
const txt = (tag, clase, texto) => { const n = document.createElement(tag); if (clase) n.className = clase; n.textContent = texto; return n; };
const suave = (p) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);
const salida = (p) => 1 - (1 - p) ** 3;

/** Igual que en fx.js: nombre y descripción de cada estado, para los chips del HUD. */
const INFO_ESTADO = {
  veneno: ["Veneno", "Pierde vida cada turno"],
  sangrado: ["Sangrado", "Pierde vida cada turno"],
  aturdido: ["Aturdido", "Pierde el próximo turno"],
  escudo: ["Escudo", "Absorbe daño"],
  furia: ["Furia", "Ataque aumentado"],
  reflejo: ["Reflejo", "Devuelve parte del daño"],
  evasion: ["Evasión", "Esquiva el próximo golpe"],
};
/** Color del aura 3D de cada estado. */
const COLOR_ESTADO = {
  veneno: 0x84cc16, sangrado: 0xdc2626, aturdido: 0xfbbf24, escudo: 0x60a5fa,
  furia: 0xef4444, reflejo: 0xa78bfa, evasion: 0xe5e7eb,
};

// ───────────────────────── Montaje ─────────────────────────

/**
 * Prepara la arena 3D dentro de `raizEl` (normalmente `#escena`). **Devuelve enseguida**: three.js
 * se descarga del CDN en segundo plano y, mientras llega, las llamadas a la API se guardan y se
 * aplican en cuanto está listo (las animaciones simplemente esperan su duración, así que
 * `main.js` puede encadenar `await` desde el primer instante sin bloquearse).
 *
 * Mantiene el HUD en HTML que ya hay en `index.html` (nombre, barra de vida, estados, intención) y
 * añade `escena-3d` a la raíz, que es la clase con la que `render3d.css` esconde las capas 2D.
 *
 * @param {HTMLElement} raizEl
 * @param {{auto?:boolean, calidad?:"alto"|"medio"|"bajo", maxDpr?:number,
 *          alAviso?:(msg:string, clave:string)=>void}} [opciones]
 *        auto: se acepta por compatibilidad con fx.js (aquí no hace falta espiar el DOM, porque
 *              `main.js` llama a `mostrarEnemigo`; se guarda y no se usa).
 *        calidad: fuerza un perfil en vez de detectarlo. alAviso: te avisa si el equipo va justo.
 * @returns {HTMLElement} la raíz (igual que `fx.montarEscena`)
 */
export function montarEscena(raizEl, opciones = {}) {
  if (!raizEl) throw new Error("montarEscena: falta el elemento raíz");
  if (E.raiz === raizEl) { if ("auto" in opciones) E.auto = !!opciones.auto; return raizEl; }
  if (E.raiz) desmontar();

  E.raiz = raizEl;
  E.auto = opciones.auto ?? true;
  E.alAviso = typeof opciones.alAviso === "function" ? opciones.alAviso : null;
  E.maxDpr = Number(opciones.maxDpr) || 0;
  E.calidadPedida = opciones.calidad ?? null;
  E.precalentar = opciones.precalentar ?? true;

  raizEl.classList.add("escena", "escena-montada", "escena-3d");
  limpiar2D(raizEl);                 // un solo lienzo en la arena: el nuestro
  asegurarLuchador(raizEl, "heroe");
  asegurarLuchador(raizEl, "enemigo");

  const lienzo = raizEl.querySelector("canvas.r3d-lienzo") ?? el("canvas", "r3d-lienzo");
  lienzo.setAttribute("aria-hidden", "true");
  raizEl.prepend(lienzo);
  E.lienzo = lienzo;
  E.montado = true;

  if (!soporta3d()) {
    avisar(MSG_3D.sinWebgl, "sin-webgl");
    E.promesaListo = Promise.reject(new Error(MSG_3D.sinWebgl));
    E.promesaListo.catch(() => {}); // que no salga «unhandled rejection»
    return raizEl;
  }

  E.promesaListo = arrancar().catch((e) => {
    avisar(e?.message ?? MSG_3D.sinRed, "sin-motor");
    throw e;
  });
  return raizEl;
}

/**
 * Arranca TODA la capa visual de `index.html` con la arena en 3D: lo mismo que
 * `fx.iniciarInterfaz` (portada, botón de sonido, cartas del inventario, pestañas, crónica) pero
 * montando esta escena en vez de la 2D. Es la función que debe llamar `main.js` cuando el jugador
 * elige 3D, en lugar de llamar a la de `fx.js`.
 *
 * El detalle que importa: `fx.iniciarInterfaz` monta su escena 2D sobre `#escena` y no hay forma
 * de pedirle que se salte esa parte. Si se llama a las dos, `#escena` acaba con TRES lienzos (los
 * dos de fx y el nuestro) y dos bucles de dibujo a la vez: el doble de CPU y de batería para nada.
 * Como `fx` busca la arena con `getElementById("escena")`, aquí se le esconde el id un instante:
 * entonces hace todo su montaje menos la escena, que es justo lo que queremos. No se toca `fx.js`.
 *
 * @param {{auto?:boolean, calidad?:"alto"|"medio"|"bajo", maxDpr?:number, precalentar?:boolean,
 *          alAviso?:(msg:string, clave:string)=>void}} [opciones] se pasan a `montarEscena`
 * @returns {HTMLElement|null} la arena, o null si esta página no tiene `#escena`
 */
export function iniciarInterfaz(opciones = {}) {
  const arena = document.getElementById("escena");
  const idOriginal = arena?.id;
  if (arena) arena.id = "";
  try {
    fxIniciarInterfaz({ ...opciones, auto: false });
  } finally {
    if (arena && idOriginal != null) arena.id = idOriginal;
  }
  limpiar2D(arena);
  return arena ? montarEscena(arena, opciones) : null;
}

/**
 * Quita de la arena lo que haya dejado la escena 2D, por si `fx.iniciarInterfaz` ya se llamó antes
 * (por ejemplo desde el propio `index.html` al cargar la página). Deja un solo lienzo: el nuestro.
 */
function limpiar2D(arena) {
  if (!arena) return;
  // Esto no crea nada: `fx.montarEscena` sale enseguida si ya estaba montado sobre este elemento,
  // pero sí apaga su modo automático, que espía el DOM para adivinar qué enemigo pintar.
  try { fxMontarEscena(arena, { auto: false }); } catch { /* fx no montado: mejor todavía */ }
  for (const c of arena.querySelectorAll("canvas.escena-fondo, canvas.escena-fx")) {
    // Encogerlo antes de sacarlo: si el bucle de fx sigue vivo, pintará sobre 1×1 píxel.
    c.width = 1;
    c.height = 1;
    c.remove();
  }
}

/** Promesa que se cumple cuando la escena 3D ya está dibujando (o falla si no se pudo). */
export const listo = () => E.promesaListo ?? Promise.reject(new Error("la escena no está montada"));

/** ¿Está la escena 3D dibujando de verdad? */
export const activo = () => !!E.listo;

/** Perfil de calidad en uso. */
export const calidad = () => E.calidad;

/**
 * Coste real de un fotograma, en milisegundos: dibuja `n` seguidos y espera a que la GPU termine
 * de verdad (`gl.finish()`). Es la forma de medir cuando `requestAnimationFrame` va estrangulado
 * (pestaña en segundo plano, panel del navegador oculto), donde los fps no significan nada.
 * @param {number} [n=120] @returns {{msPorFotograma:number, fpsPosibles:number, n:number}|null}
 */
export function medirCoste(n = 120) {
  if (!E.listo) return null;
  const gl = E.render.getContext();
  E.render.render(E.escena, E.camara);   // uno de calentamiento, que no cuenta
  gl.finish();
  const t0 = performance.now();
  for (let i = 0; i < n; i++) E.render.render(E.escena, E.camara);
  gl.finish();
  const ms = (performance.now() - t0) / n;
  const r = E.render.info.render;
  return {
    msPorFotograma: Math.round(ms * 100) / 100,
    fpsPosibles: Math.round(1000 / ms),
    llamadas: r.calls, triangulos: r.triangles, n,
  };
}

/** Medidas de rendimiento (fps actuales, peor, mejor, fotograma más lento). */
export const rendimiento = () => (E.medidor ? { ...E.medidor.resumen(), calidad: E.calidad, aviso: E.aviso } : null);

function avisar(msg, clave) {
  E.aviso = msg;
  E.raiz?.classList.add("r3d-con-aviso");
  E.raiz?.setAttribute("data-r3d-aviso", msg);
  try { E.alAviso?.(msg, clave); } catch { /* el aviso no puede romper nada */ }
  E.raiz?.dispatchEvent(new CustomEvent("r3d:aviso", { detail: { mensaje: msg, clave }, bubbles: true }));
}

/** Crea (o normaliza) el HUD en HTML de un luchador. Mismas clases que `fx.js` para reusar su CSS. */
function asegurarLuchador(raiz, quien) {
  let f = raiz.querySelector(`.fighter[data-lado="${quien}"]`) ?? raiz.querySelector(quien === "heroe" ? "#f-jugador" : "#f-enemigo");
  if (!f) {
    f = el("div", `fighter${quien === "enemigo" ? " enemy vacio" : ""}`);
    f.innerHTML = '<div class="f-hud"><div class="f-name"></div><div class="hp"><div class="hp-fill"></div><span class="hp-text"></span></div><div class="f-stats"></div></div><div class="retrato"></div>';
    raiz.append(f);
  }
  f.dataset.lado = quien;
  const ret = f.querySelector(".retrato") ?? f.appendChild(el("div", "retrato"));
  if (!f.querySelector(".estados")) (f.querySelector(".f-hud") ?? f).append(Object.assign(el("div", "estados"), { role: "list" }));
  if (quien === "enemigo" && !f.querySelector(".intencion")) {
    const it = el("div", "intencion");
    it.hidden = true;
    it.setAttribute("aria-live", "polite");
    ret.prepend(it);
  }
  return f;
}

const luchadorEl = (quien) => E.raiz?.querySelector(`.fighter[data-lado="${lado(quien)}"]`) ?? null;

async function arrancar() {
  const T = await cargarTres();
  if (!E.montado) return; // se desmontó mientras se descargaba
  E.T = T;

  const gpu = infoGpu();
  E.calidad = E.calidadPedida ?? nivelEquipo(detectarEquipo(globalThis, gpu));
  const cal = CALIDADES[E.calidad];

  const render = new T.WebGLRenderer({
    canvas: E.lienzo,
    antialias: cal.muestras,
    alpha: false,
    powerPreference: "high-performance",
    stencil: false,
  });
  render.setClearColor(0x0c0806, 1);
  render.shadowMap.enabled = cal.sombras;
  if (cal.sombras) render.shadowMap.type = T.PCFSoftShadowMap;
  if (T.ACESFilmicToneMapping != null) { render.toneMapping = T.ACESFilmicToneMapping; render.toneMappingExposure = 1.08; }
  if (T.SRGBColorSpace != null) render.outputColorSpace = T.SRGBColorSpace;
  E.render = render;

  const escena = new T.Scene();
  E.escena = escena;
  const camara = new T.PerspectiveCamera(42, 16 / 9, 0.1, 60);
  E.camara = camara;

  E.esc = construirEscenario(T, { calidad: E.calidad, reducido: reducido() });
  escena.add(E.esc.raiz);
  escena.fog = E.esc.niebla;

  E.rotulos = new Rotulos(T);
  E.medidor = new Medidor();
  E.vigilante = new Vigilante({ objetivo: 55 });

  // Anclas de cada luchador: `ancla` es el puesto fijo (no se toca) y `mov` es lo que animamos.
  for (const q of ["heroe", "enemigo"]) {
    const ancla = new T.Group();
    ancla.name = `puesto-${q}`;
    const signo = q === "heroe" ? -1 : 1;
    ancla.position.set(signo * PUESTO_X, 0, q === "heroe" ? 0.75 : -0.45);
    // `baseX` es el sitio del puesto. Las animaciones mueven `ancla.position.x` y vuelven SIEMPRE
    // aquí, para que un cambio de tamaño en mitad de un ataque no deje al luchador descolocado.
    ancla.rotation.y = -signo * 1.02; // tres cuartos: se miran entre ellos y un poco a la cámara
    const mov = new T.Group();
    mov.name = `mov-${q}`;
    ancla.add(mov);
    escena.add(ancla);
    E.lados[q] = { ancla, mov, criatura: null, vivo: true, aura: null, baseX: signo * PUESTO_X };
  }

  // Sitio donde se dibujan los modelos al precalentarlos: dentro del plano de la cámara (si
  // estuviera fuera, three.js lo descartaría y no subiría nada a la GPU).
  E.horno = new T.Group();
  E.horno.name = "horno";
  E.horno.position.set(0, 0, 0);
  escena.add(E.horno);

  colocarCamara(0);
  ajustarTamano();
  reconstruirHeroe();
  if (E.enemigo) aplicarEnemigo();

  // Pausa cuando la arena no se ve o la pestaña está en segundo plano: ni un fotograma de más.
  const io = new IntersectionObserver(([x]) => { E.visible = x.isIntersecting; if (E.visible) bucleArranca(); });
  io.observe(E.raiz);
  const ro = new ResizeObserver(() => ajustarTamano());
  ro.observe(E.raiz);
  const alVisibilidad = () => { if (!document.hidden) bucleArranca(); };
  document.addEventListener("visibilitychange", alVisibilidad);
  const alPerder = (ev) => { ev.preventDefault(); avisar(MSG_3D.muyFlojo, "contexto-perdido"); };
  E.lienzo.addEventListener("webglcontextlost", alPerder);
  E.observadores = [
    () => io.disconnect(), () => ro.disconnect(),
    () => document.removeEventListener("visibilitychange", alVisibilidad),
    () => E.lienzo?.removeEventListener("webglcontextlost", alPerder),
  ];

  E.listo = true;
  E.t0 = performance.now();
  E.ultimo = E.t0;
  // Compila los sombreadores del decorado antes del primer combate.
  precompilar();
  bucleArranca();
  aplicarEstadosPendientes();
  prepararCola();
  precalentar();
  return true;
}

function ajustarTamano() {
  if (!E.render || !E.raiz) return;
  const r = E.raiz.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width));
  const h = Math.max(1, Math.round(r.height));
  const tope = E.maxDpr || CALIDADES[E.calidad].dpr;
  E.render.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, tope));
  E.render.setSize(w, h, false);
  E.camara.aspect = w / h;
  // En una ventana estrecha (móvil en vertical) la cámara se echa atrás y abre ángulo hasta que
  // caben los dos, pero sin salirse nunca de la arena.
  E.aspecto = w / h;
  aplicarEncuadre();
}

// ───────────────────────── Bucle ─────────────────────────

/**
 * Recalcula el encuadre con la forma de la ventana y la criatura más alta que hay en la arena, y
 * coloca los puestos. Se llama al cambiar el tamaño y al cambiar de enemigo: un dragón necesita
 * más plano que una rata.
 */
function aplicarEncuadre() {
  if (!E.camara) return;
  const altoMax = Math.max(1.9, E.lados.heroe?.criatura?.alto ?? 0, E.lados.enemigo?.criatura?.alto ?? 0);
  const enc = encuadre(E.aspecto || E.camara.aspect, altoMax);
  E.encuadre = enc;
  E.distancia = enc.distancia;
  E.camara.fov = enc.fov;
  E.camara.updateProjectionMatrix();
  for (const q of ["heroe", "enemigo"]) {
    const L = E.lados[q];
    if (!L) continue;
    L.baseX = (q === "heroe" ? -1 : 1) * enc.puesto;
    L.ancla.position.x = L.baseX;
  }
}

function bucleArranca() {
  if (E.raf || !E.listo || !E.visible || document.hidden) return;
  E.ultimo = performance.now();
  E.raf = requestAnimationFrame(bucle);
}

function bucle(t) {
  E.raf = 0;
  if (!E.listo || !E.visible || document.hidden) return;

  const brutoDt = Math.min(0.1, (t - E.ultimo) / 1000);
  E.ultimo = t;
  if (t < E.congelado) {
    // Hit-stop: el bucle sigue dibujando, pero ni el tiempo del mundo ni las animaciones avanzan.
    for (const tw of E.tweens) tw.t0 += brutoDt * 1000;   // (la red ya lleva 400 ms de margen)
  } else {
    E.tiempo += brutoDt;
  }
  const s = E.tiempo;

  animarEscenario(E.esc, s, reducido());
  reposo("heroe", s);
  reposo("enemigo", s);
  pasarTweens(t);
  colocarCamara(s);

  E.render.render(E.escena, E.camara);

  // Un hueco enorme entre fotogramas no es que el equipo vaya lento: es que el navegador ha
  // estrangulado la página (pestaña de fondo, ventana tapada, el sistema ocupado). Si se cuenta
  // como «va mal», el vigilante baja la calidad sin motivo en cuanto el jugador cambia de pestaña.
  if (brutoDt > 0.2) {
    E.medidor.reiniciar();
    E.vigilante.desde = null;
    E.raf = requestAnimationFrame(bucle);
    return;
  }
  const fps = E.medidor.fotograma(t);
  // Solo se juzga al equipo con medidas de marcha normal (ver `Medidor.estable`).
  switch (E.medidor.estable() ? E.vigilante.revisar(fps, t) : "nada") {
    case "bajar": bajarUnEscalon(); break;
    case "rendirse": avisar(MSG_3D.muyFlojo, "muy-flojo"); break;
    default: break;
  }
  E.raf = requestAnimationFrame(bucle);
}

/** Baja la calidad en caliente: lo más barato y lo que más se nota es recortar píxeles. */
function bajarUnEscalon() {
  const antes = E.calidad;
  E.calidad = bajarCalidad(E.calidad);
  if (E.calidad === antes) return;
  const cal = CALIDADES[E.calidad];
  E.render.shadowMap.enabled = cal.sombras;
  if (E.esc?.polvo) E.esc.polvo.visible = cal.polvo > 0;
  for (const a of E.esc?.antorchas ?? []) if (a.luz) a.luz.visible = cal.luzPorAntorcha;
  ajustarTamano();
  E.medidor.reiniciar();
  // Los modelos guardados se hicieron con el detalle de antes: ya no sirven.
  pararPrecalentado();
  vaciarAlmacen();
  if (E.calidad !== "bajo") { prepararCola(); precalentar(); }
  avisar(MSG_3D.equipoFlojo, "calidad-" + E.calidad);
}

/** Cámara: plano fijo con una deriva lenta, más la sacudida de los golpes gordos. */
function colocarCamara(s) {
  const c = E.camara;
  if (!c) return;
  const quieto = reducido();
  const vaiven = quieto ? 0 : 1;
  const bz = E.distancia || encuadre(c.aspect).distancia;
  let x = Math.sin(s * 0.16) * 0.34 * vaiven;
  let y = CAMARA.alto + Math.sin(s * 0.23 + 1.2) * 0.07 * vaiven;
  let z = bz + Math.cos(s * 0.13) * 0.2 * vaiven;

  const sk = E.sacudida;
  if (sk.amp > 0) {
    const k = Math.max(0, (sk.hasta - performance.now()) / sk.dur);
    if (k <= 0) { sk.amp = 0; }
    else {
      const f = sk.amp * k * k;
      x += azar(-1, 1) * f;
      y += azar(-1, 1) * f * 0.7;
      z += azar(-1, 1) * f * 0.35;
    }
  }
  c.position.set(x, y, z);
  c.lookAt(CAMARA.mira[0] + x * 0.3, E.encuadre?.miraY ?? CAMARA.mira[1], CAMARA.mira[2]);
}

/** Respiración y vida propia de cada criatura (lo que distingue un muñeco de un bicho). */
function reposo(q, s) {
  const L = E.lados[q];
  const cr = L?.criatura;
  if (!cr || !L.vivo) return;
  const p = cr.partes;
  const cuerpo = p?.cuerpo;
  const quieto = reducido();
  const f = quieto ? 0 : 1;
  const fase = q === "heroe" ? 0 : 2.1;

  if (cuerpo) {
    const baseY = cuerpo.userData.baseY ?? (cuerpo.userData.baseY = cuerpo.position.y);
    if (cr.flota) {
      cuerpo.position.y = baseY + Math.sin(s * 1.1 + fase) * 0.16 * f;
      cuerpo.rotation.y = Math.sin(s * 0.5 + fase) * 0.16 * f;
      cuerpo.rotation.z = Math.sin(s * 0.7 + fase) * 0.05 * f;
    } else {
      cuerpo.position.y = baseY + Math.sin(s * 1.7 + fase) * 0.022 * f;
      cuerpo.rotation.z = Math.sin(s * 0.85 + fase) * 0.018 * f;
    }
  }
  if (quieto) return;
  if (p?.cabeza) p.cabeza.rotation.y = Math.sin(s * 0.45 + fase) * 0.17;
  if (p?.alas) for (const [i, a] of p.alas.entries()) a.rotation.z = (i ? 1 : -1) * (0.1 + Math.sin(s * 1.9 + fase) * 0.26);
  if (p?.cola) {
    let n = p.cola, i = 0;
    while (n && i < 6) { n.rotation.y = Math.sin(s * 2.1 - i * 0.6 + fase) * 0.17; n = n.children.find((c) => c.name?.startsWith("cola")); i++; }
  }
  if (p?.jirones) for (const [i, j] of p.jirones.entries()) j.scale.y = 1 + Math.sin(s * 2.4 + i) * 0.17;
  if (p?.orbe) { const k = 1 + Math.sin(s * 3.1) * 0.12; p.orbe.scale.setScalar(k); }
  if (p?.mascota) { p.mascota.position.x = -0.65 + Math.sin(s * 1.3) * 0.22; p.mascota.position.y = 1.45 + Math.cos(s * 1.9) * 0.1; }
  if (p?.aura) p.aura.rotation.z = s * 0.7;
  if (p?.corona) p.corona.rotation.y = s * 0.5;
  if (L.aura) { L.aura.rotation.z = -s * 0.9; L.aura.scale.setScalar(1 + Math.sin(s * 2.2) * 0.05); }
}

// ───────────────────────── Motor de animaciones ─────────────────────────

/**
 * Programa una animación. Devuelve una promesa que se cumple al terminar (o enseguida si la
 * escena todavía no está dibujando, para no bloquear a `main.js`).
 * @param {{ms:number, al:(p:number)=>void, fin?:()=>void, cumplirEn?:number, lado?:string}} o
 *        cumplirEn: fracción 0..1 en la que se cumple la promesa (el impacto del ataque)
 *        lado: "heroe"/"enemigo" si anima a una criatura (para poder cortarla cuando muere)
 */
function animar({ ms, al, fin, cumplirEn = 1, lado: cual = null }) {
  if (!E.listo) return esperar(Math.round(ms * cumplirEn));
  const total = Math.max(1, ms);
  return new Promise((cumplir) => {
    const tw = { t0: performance.now(), ms: total, al, fin, cumplirEn, lado: cual, cumplido: false, cumplir, red: 0 };
    // RED DE SEGURIDAD. El bucle se para cuando la pestaña pasa a segundo plano o la arena deja
    // de verse (y el navegador estrangula `requestAnimationFrame` hasta casi cero). Si la promesa
    // dependiera solo del bucle, `main.js` se quedaría colgado en medio de un `await` del combate
    // y el juego no volvería nunca. El temporizador sí corre en segundo plano: si la animación no
    // ha terminado cuando tocaba, se da por terminada a mano.
    // El margen de 400 ms absorbe los hit-stop, que congelan el mundo hasta 120 ms.
    tw.red = setTimeout(() => rematar(tw), total + 400);
    // Cuando la promesa se cumple antes del final (el instante del impacto), hace falta un
    // segundo temporizador: si no, en segundo plano el ataque tardaría todo el tween en avanzar.
    if (cumplirEn < 1) {
      tw.redImpacto = setTimeout(() => { if (!tw.cumplido) { tw.cumplido = true; tw.cumplir(); } },
        Math.round(total * cumplirEn) + 120);
    }
    E.tweens.push(tw);
  });
}

/** Quita los temporizadores de red de un tween. */
function limpiarRed(tw) {
  clearTimeout(tw.red);
  clearTimeout(tw.redImpacto);
}

/** Termina un tween a la fuerza: lo deja en su estado final, lo saca de la lista y cumple. */
function rematar(tw) {
  const i = E.tweens.indexOf(tw);
  if (i >= 0) E.tweens.splice(i, 1);
  limpiarRed(tw);
  try { tw.al(1); } catch { /* una animación rota no puede parar nada */ }
  try { tw.fin?.(); } catch { /* idem */ }
  if (!tw.cumplido) { tw.cumplido = true; tw.cumplir(); }
}

function pasarTweens(t) {
  for (let i = E.tweens.length - 1; i >= 0; i--) {
    const tw = E.tweens[i];
    const p = Math.min(1, (t - tw.t0) / tw.ms);
    try { tw.al(p); } catch { /* una animación rota no puede parar el bucle */ }
    if (!tw.cumplido && p >= tw.cumplirEn) { tw.cumplido = true; tw.cumplir(); }
    if (p >= 1) {
      E.tweens.splice(i, 1);
      limpiarRed(tw);
      try { tw.fin?.(); } catch { /* idem */ }
      if (!tw.cumplido) { tw.cumplido = true; tw.cumplir(); }
    }
  }
}

/** Para todas las animaciones de un lado (al morir o al cambiar de enemigo). */
function cortarTweens(q) {
  for (let i = E.tweens.length - 1; i >= 0; i--) {
    const tw = E.tweens[i];
    if (tw.lado !== q) continue;
    E.tweens.splice(i, 1);
    limpiarRed(tw);
    if (!tw.cumplido) { tw.cumplido = true; tw.cumplir(); }
  }
}

// ───────────────────────── Criaturas en la arena ─────────────────────────

function opcionesTaller() {
  const cal = CALIDADES[E.calidad];
  return { segmentos: cal.segmentos, sombras: cal.sombras };
}

// ───────────────────────── Almacén de modelos ─────────────────────────
//
// Construir una criatura cuesta decenas de geometrías y materiales, y la PRIMERA vez que se
// dibuja hay que compilar sus sombreadores. Hacerlo en caliente, justo cuando el enemigo entra en
// la arena, daba tirones de medio segundo (medido en Chrome: peor fotograma 629 ms en combate y
// 1029 ms durante el desfile del bestiario).
//
// La solución es no construir dos veces lo mismo: cada modelo se guarda por su llave y, cuando esa
// criatura vuelve a salir, se engancha tal cual. Y para que ni la primera vez se note, los modelos
// se construyen por adelantado en los huecos libres del navegador (ver `precalentar`).

/** Modelos ya construidos, por llave. Se vacía en `desmontar()`. */
const almacen = new Map();

/** Cuántos modelos de héroe se guardan: el jugador cambia de equipo a menudo, pero no tanto. */
const MAX_HEROES = 4;

const llaveEnemigo = (clave, jefe) => `e|${E.calidad}|${String(clave ?? "").toLowerCase()}|${jefe ? 1 : 0}`;
const llaveHeroe = (equipados, apariencia) =>
  `h|${E.calidad}|${(equipados ?? []).map((x) => `${x.tipo}:${x.rareza}`).sort().join(",")}|${JSON.stringify(apariencia ?? {})}`;

/** Saca del almacén (o construye y guarda) el modelo de una llave. */
function delAlmacen(llave, construir) {
  const guardado = almacen.get(llave);
  if (guardado) {
    almacen.delete(llave);          // reinsertar = marcarlo como el más reciente
    almacen.set(llave, guardado);
    restaurar(guardado);
    return guardado;
  }
  const cr = construir();
  cr.llave = llave;
  almacen.set(llave, cr);
  podarHeroes();
  return cr;
}

/** Los modelos de héroe sí se tiran: las combinaciones de equipo y cosméticos son demasiadas. */
function podarHeroes() {
  const heroes = [...almacen.keys()].filter((k) => k.startsWith("h|"));
  while (heroes.length > MAX_HEROES) {
    const vieja = heroes.shift();
    const cr = almacen.get(vieja);
    almacen.delete(vieja);
    if (cr && cr !== E.lados.heroe?.criatura) tirar(cr);
  }
}

/** Devuelve a la GPU todo lo de un modelo. */
function tirar(cr) {
  if (!cr) return;
  liberarRama(cr.raiz);
  cr.taller.liberar();
}

/**
 * Deja un modelo reutilizado como recién hecho: visible, opaco y sin el brillo que le dejó el
 * último destello o la última muerte. Sin esto, un enemigo que murió volvería invisible.
 */
function restaurar(cr) {
  cr.raiz.visible = true;
  cr.raiz.position.set(0, 0, 0);
  cr.raiz.rotation.set(0, 0, 0);
  for (const m of cr.materiales) {
    if (m.userData.opBase != null) m.opacity = m.userData.opBase;
    if (m.emissive && m.userData.emisionBase != null) {
      m.emissive.set(m.userData.emisionBase);
      m.emissiveIntensity = m.userData.fuerzaBase ?? 0;
    }
  }
}

/** Vacía el almacén (al bajar la calidad los modelos ya no sirven: cambia el detalle). */
function vaciarAlmacen() {
  const enUso = new Set([E.lados.heroe?.criatura, E.lados.enemigo?.criatura]);
  for (const cr of almacen.values()) if (!enUso.has(cr)) tirar(cr);
  almacen.clear();
}

/** Quita de la arena la criatura de un lado. NO la destruye: queda en el almacén para la próxima. */
function soltarCriatura(q) {
  const L = E.lados[q];
  if (!L?.criatura) return;
  cortarTweens(q);
  L.mov.remove(L.criatura.raiz);
  // Si no está en el almacén (quedó suelta al vaciarlo), esa sí se tira.
  if (!L.criatura.llave || almacen.get(L.criatura.llave) !== L.criatura) tirar(L.criatura);
  L.criatura = null;
  if (L.aura) { liberarRama(L.aura); L.aura = null; }
  L.mov.position.set(0, 0, 0);
  L.mov.rotation.set(0, 0, 0);
  L.mov.scale.setScalar(1);
}

function reconstruirHeroe() {
  if (!E.listo && !E.T) return;
  const L = E.lados.heroe;
  if (!L) return;
  soltarCriatura("heroe");
  const cr = delAlmacen(llaveHeroe(E.equipados, E.apariencia),
    () => construirHeroe(E.T, E.equipados, E.apariencia, opcionesTaller()));
  L.mov.add(cr.raiz);
  L.criatura = cr;
  L.vivo = true;
  pintarAuraEstados("heroe");
  aplicarEncuadre();
  precompilar(cr.raiz);
}

function aplicarEnemigo() {
  const L = E.lados.enemigo;
  if (!L || !E.T) return;
  soltarCriatura("enemigo");
  const e = E.enemigo;
  const f = luchadorEl("enemigo");
  if (!e) { f?.classList.remove("jefe"); return; }
  const cr = delAlmacen(llaveEnemigo(e.clave, e.jefe),
    () => construirEnemigo(E.T, e.clave, { ...opcionesTaller(), jefe: !!e.jefe }));
  L.mov.add(cr.raiz);
  L.criatura = cr;
  L.vivo = true;
  if (f) { f.classList.toggle("jefe", !!e.jefe); f.dataset.clave = e.clave; }
  precompilar(cr.raiz);

  // Entrada: llega desde el fondo, se planta y levanta polvo.
  if (!reducido()) {
    L.mov.position.set(0, 0, -3.4);
    L.mov.scale.setScalar(0.75);
    const ms = e.jefe ? 900 : 520;
    animar({
      ms, lado: "enemigo",
      al: (p) => {
        const k = salida(p);
        L.mov.position.z = -3.4 * (1 - k);
        L.mov.scale.setScalar(0.75 + 0.25 * k + Math.sin(p * Math.PI) * 0.06);
      },
      fin: () => { L.mov.position.set(0, 0, 0); L.mov.scale.setScalar(1); },
    });
    setTimeout(() => polvoDePisada("enemigo"), ms * 0.62);
  }
  if (e.jefe) { sacudir(16, 700); destello(0xb91c1c, 0.45, 500); }
  pintarAuraEstados("enemigo");
  aplicarEncuadre();   // un dragón necesita más plano que una rata
}

/**
 * Compila los sombreadores de UNA rama, no de la escena entera.
 *
 * `compile(escena, camara)` prepara TODOS los materiales que hay puestos y además es síncrono:
 * llamarlo en cada aparición de enemigo era, él solo, buena parte de los tirones.
 * `compileAsync(rama, camara, escena)` hace solo esa rama y aprovecha
 * `KHR_parallel_shader_compile` para no bloquear el hilo.
 * @param {object} [rama] nodo de three.js; sin él, la escena entera (solo al arrancar)
 */
function precompilar(rama) {
  const r = E.render;
  if (!r || !E.escena || !E.camara) return;
  const objetivo = rama ?? E.escena;
  try { objetivo.updateMatrixWorld?.(true); } catch { /* da igual */ }
  try {
    if (typeof r.compileAsync === "function") {
      r.compileAsync(objetivo, E.camara, rama ? E.escena : undefined)?.catch?.(() => {});
    } else {
      r.compile(objetivo, E.camara, rama ? E.escena : undefined);
    }
  } catch { /* no en todas las versiones */ }
}

/**
 * Dibuja un modelo UNA vez en un recorte de 1×1 píxel.
 *
 * Compilar los sombreadores (`precompilar`) no basta: la primera vez que un modelo se dibuja de
 * verdad hay que subir sus geometrías a la GPU y terminar de enlazar el programa, y ese coste
 * caía entero en el fotograma en que aparecía el enemigo. Dibujándolo aquí, con el recorte
 * reducido a un píxel, se paga lo mismo sin pintar nada ni costar relleno.
 */
function calentarEnGpu(cr) {
  const r = E.render;
  if (!r || !cr?.raiz) return;
  const horno = E.horno;
  if (!horno) return;
  const tam = new E.T.Vector2();
  r.getSize(tam);
  horno.add(cr.raiz);
  try {
    r.setScissorTest(true);
    r.setScissor(0, 0, 1, 1);
    r.setViewport(0, 0, 1, 1);
    r.render(E.escena, E.camara);
  } catch { /* si falla, se pagará al aparecer: no es grave */ } finally {
    try {
      r.setScissorTest(false);
      r.setViewport(0, 0, tam.x, tam.y);
      r.setScissor(0, 0, tam.x, tam.y);
    } catch { /* nada */ }
    horno.remove(cr.raiz);
  }
}

// ───────────────────────── Precalentado ─────────────────────────

/**
 * Construye modelos por adelantado en los huecos libres del navegador, uno por hueco, para que
 * cuando el enemigo salga ya esté hecho y compilado. Solo se trabaja mientras el navegador dice
 * que queda tiempo, así que esto no le roba fotogramas al combate.
 *
 * En el perfil «bajo» no se hace: en un equipo justo no compensa gastar memoria y batería
 * adelantando trabajo que quizá no haga falta.
 */
function precalentar() {
  if (!E.listo || !E.precalentar || E.calidad === "bajo") return;
  if (typeof requestIdleCallback !== "function") return;   // sin huecos: se construye al vuelo
  if (E.idle || !E.colaPrecalentado.length) return;
  E.idle = requestIdleCallback((plazo) => {
    E.idle = 0;
    if (!E.listo) return;
    // Una criatura por hueco: así nunca se come un fotograma entero.
    while (E.colaPrecalentado.length && (plazo.timeRemaining() > 8 || plazo.didTimeout)) {
      const { clave, jefe } = E.colaPrecalentado.shift();
      const llave = llaveEnemigo(clave, jefe);
      if (almacen.has(llave)) continue;
      try {
        const cr = construirEnemigo(E.T, clave, { ...opcionesTaller(), jefe });
        cr.llave = llave;
        almacen.set(llave, cr);
        precompilar(cr.raiz);
        calentarEnGpu(cr);
      } catch { /* una criatura rara no puede tumbar el precalentado */ }
      break;
    }
    if (E.colaPrecalentado.length) precalentar();
  }, { timeout: 2000 });
}

/** Prepara la lista de lo que se va a precalentar: todo el bestiario y el jefe propio. */
function prepararCola() {
  E.colaPrecalentado = [...BESTIARIO.map((b) => ({ clave: b.clave, jefe: false })), { clave: "jefe", jefe: true }];
}

/** Detiene el precalentado (al desmontar o al bajar la calidad). */
function pararPrecalentado() {
  if (E.idle && typeof cancelIdleCallback === "function") cancelIdleCallback(E.idle);
  E.idle = 0;
  E.colaPrecalentado = [];
}

/** Cuántos modelos hay guardados en memoria (para la demo y las pruebas). */
export const modelosEnMemoria = () => almacen.size;

/** Cuántas criaturas quedan por precalentar. */
export const pendientesDePrecalentar = () => E.colaPrecalentado.length;

/** Anillo de luz a los pies con el color del estado más llamativo. */
function pintarAuraEstados(q) {
  const L = E.lados[q];
  if (!L || !E.T) return;
  if (L.aura) { liberarRama(L.aura); L.aura = null; }
  const est = (E.estados[q] ?? []).find((e) => COLOR_ESTADO[e.tipo]);
  if (!est || !L.criatura) return;
  const T = E.T;
  const geo = new T.TorusGeometry((L.criatura.radio ?? 0.5) * 1.2, 0.045, 8, 28);
  const mat = new T.MeshBasicMaterial({ color: COLOR_ESTADO[est.tipo], transparent: true, opacity: 0.6, blending: T.AdditiveBlending, depthWrite: false });
  const aro = new T.Mesh(geo, mat);
  aro.rotation.x = Math.PI / 2;
  aro.position.y = 0.06;
  L.mov.add(aro);
  L.aura = aro;
}

function aplicarEstadosPendientes() {
  for (const q of ["heroe", "enemigo"]) {
    if (E.estados[q]?.length) pintarAuraEstados(q);
    if (E.vida[q]) actualizarVida(q, E.vida[q].vida, E.vida[q].vidaMax);
  }
  if (E.intencion) mostrarIntencion(E.intencion);
}

/** Altura a la que salen los rótulos de una criatura. */
const altoDe = (q) => (E.lados[q]?.criatura?.alto ?? 1.6) * 0.95 + 0.25;

/** Punto en el mundo del pecho de una criatura (donde chocan los golpes). */
function puntoImpacto(q) {
  const L = E.lados[q];
  const T = E.T;
  const v = new T.Vector3(0, (L?.criatura?.alto ?? 1.6) * 0.55, 0);
  return L ? L.mov.localToWorld(v) : v;
}

// ───────────────────────── Efectos básicos (equivalentes a los de fx.js) ─────────────────────────

/**
 * Sacude la escena. En 3D sacude la CÁMARA, que se nota mucho más que mover el `<div>`.
 * @param {number} [fuerza=8] misma escala que en fx.js (píxeles 2D); se traduce a unidades 3D
 * @param {number} [ms=380]
 * @param {HTMLElement} [objetivo] si se pasa un elemento que no es la arena, se sacude ese
 *        elemento en el DOM (así `main.js` puede sacudir un panel como hasta ahora)
 */
export function sacudir(fuerza = 8, ms = 380, objetivo = undefined) {
  if (reducido()) return;
  if (objetivo && objetivo !== E.raiz) {
    const kf = [];
    for (let i = 0; i <= 8; i++) {
      const k = 1 - i / 8;
      kf.push({ transform: i === 8 ? "none" : `translate(${azar(-1, 1) * fuerza * k}px, ${azar(-1, 1) * fuerza * k * 0.6}px)` });
    }
    objetivo.animate?.(kf, { duration: ms, easing: "linear" });
    return;
  }
  const amp = Math.min(0.55, fuerza * 0.016);
  if (amp <= E.sacudida.amp && performance.now() < E.sacudida.hasta) return;
  E.sacudida = { amp, hasta: performance.now() + ms, dur: ms };
}

/**
 * Destello de color sobre toda la arena (en 3D: se sube el color del fondo y la niebla un instante).
 * @param {number|string} [color] 0xrrggbb o "#rrggbb"
 */
export function destello(color = 0xffffff, opacidad = 0.6, ms = 260) {
  if (!E.listo) return;
  const T = E.T;
  const c = new T.Color(color);
  const fondo = new T.Color(0x0c0806);
  const nieblaBase = new T.Color(0x140d08);
  const aux = new T.Color();
  const op = reducido() ? opacidad * 0.4 : opacidad;
  animar({
    ms,
    al: (p) => {
      const k = (1 - p) * op;
      E.render.setClearColor(aux.copy(fondo).lerp(c, k), 1);
      if (E.esc?.niebla?.color) E.esc.niebla.color.copy(nieblaBase).lerp(c, k * 0.8);
    },
    fin: () => {
      E.render.setClearColor(0x0c0806, 1);
      E.esc?.niebla?.color?.set(0x140d08);
    },
  });
}

/**
 * Hit-stop: congela el mundo un instante (el bucle sigue dibujando, pero el tiempo no avanza).
 * @param {number} [ms=80]
 */
export async function hitStop(ms = 80) {
  if (!E.listo || reducido()) return;
  E.congelado = performance.now() + ms;
  await esperar(ms);
}

/**
 * Rótulo que flota sobre un luchador, dentro de la escena 3D.
 * @param {"heroe"|"enemigo"} quien @param {string} texto
 * @param {string} [clase] "dano" | "critico" | "cura" | "bloqueo" | "esquiva" | "info" | "estado"
 */
export function numeroFlotante(quien, texto, clase = "dano") {
  if (!E.listo) return;
  const q = lado(quien);
  const L = E.lados[q];
  if (!L) return;
  const s = E.rotulos.crear(String(texto), clase);
  const escX = s.scale.x, escY = s.scale.y;      // proporción que ya calculó Rotulos.crear
  const x0 = azar(-0.3, 0.3), z0 = azar(-0.15, 0.25);
  const y0 = altoDe(q);
  s.position.set(x0, y0, z0);
  s.material.opacity = 0;
  L.mov.add(s);
  const sube = clase === "critico" ? 1.5 : 1.05;
  const pico = clase === "critico" ? 1.6 : 1.15;
  E.efimeros.push(s);
  animar({
    ms: dur(clase === "critico" ? 1300 : 1050),
    al: (p) => {
      const k = salida(p);
      s.position.y = y0 + sube * k;
      s.position.x = x0 + Math.sin(p * 3) * 0.12;
      // Aparece de golpe, se pasa de tamaño y se asienta: así se lee el número aunque dure poco.
      const f = p < 0.15 ? 0.4 + (p / 0.15) * (pico - 0.4) : pico - ((p - 0.15) / 0.85) * (pico - 1);
      s.scale.set(escX * f, escY * f, 1);
      s.material.opacity = p < 0.12 ? p / 0.12 : p > 0.68 ? Math.max(0, 1 - (p - 0.68) / 0.32) : 1;
    },
    fin: () => {
      L.mov.remove(s);
      s.userData.liberar?.();
      const i = E.efimeros.indexOf(s);
      if (i >= 0) E.efimeros.splice(i, 1);
    },
  });
}

/** Chorro de partículas corto y barato (chispas, polvo, disolución). */
function particulas(pos, { n = 24, color = 0xffffff, vel = 2.4, g = -5, ms = 700, tam = 0.07 } = {}) {
  if (!E.listo || reducido() || CALIDADES[E.calidad].polvo === 0) return;
  const T = E.T;
  const cant = Math.max(4, Math.round(n * (E.calidad === "bajo" ? 0.3 : E.calidad === "medio" ? 0.65 : 1)));
  const posiciones = new Float32Array(cant * 3);
  const vels = new Float32Array(cant * 3);
  for (let i = 0; i < cant; i++) {
    posiciones[i * 3] = pos.x; posiciones[i * 3 + 1] = pos.y; posiciones[i * 3 + 2] = pos.z;
    const a = Math.random() * Math.PI * 2, b = Math.random() * Math.PI - Math.PI / 2;
    const v = vel * (0.45 + Math.random() * 0.75);
    vels[i * 3] = Math.cos(a) * Math.cos(b) * v;
    vels[i * 3 + 1] = Math.abs(Math.sin(b)) * v + vel * 0.3;
    vels[i * 3 + 2] = Math.sin(a) * Math.cos(b) * v;
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute("position", new T.BufferAttribute(posiciones, 3));
  const mat = new T.PointsMaterial({ color, size: tam, transparent: true, opacity: 1, depthWrite: false, blending: T.AdditiveBlending, sizeAttenuation: true });
  const pts = new T.Points(geo, mat);
  E.escena.add(pts);
  const attr = geo.attributes.position;
  animar({
    ms: dur(ms),
    al: (p) => {
      const dt = 1 / 60;
      const arr = attr.array;
      for (let i = 0; i < cant; i++) {
        vels[i * 3 + 1] += g * dt;
        arr[i * 3] += vels[i * 3] * dt;
        arr[i * 3 + 1] = Math.max(0.02, arr[i * 3 + 1] + vels[i * 3 + 1] * dt);
        arr[i * 3 + 2] += vels[i * 3 + 2] * dt;
      }
      attr.needsUpdate = true;
      mat.opacity = Math.max(0, 1 - p * p);
    },
    fin: () => { E.escena.remove(pts); geo.dispose(); mat.dispose(); },
  });
}

function polvoDePisada(q) {
  const L = E.lados[q];
  if (!L?.criatura) return;
  const p = L.mov.localToWorld(new E.T.Vector3(0, 0.08, 0));
  particulas(p, { n: 26, color: 0xa08060, vel: 1.6, g: -3, ms: 800, tam: 0.1 });
}

/** Destello blanco en los materiales de una criatura (el «flash» de recibir daño). */
function destellarCriatura(q, fuerza = 1, ms = 320) {
  const cr = E.lados[q]?.criatura;
  if (!cr) return;
  const mats = cr.materiales.filter((m) => m.emissive);
  const blanco = new E.T.Color(0xffffff);
  const bases = mats.map((m) => ({ m, col: m.emissive.clone(), int: m.emissiveIntensity ?? 0 }));
  animar({
    ms: dur(ms),
    al: (p) => {
      const k = p < 0.25 ? 1 - p / 0.25 * 0.2 : Math.max(0, 1 - (p - 0.25) / 0.75);
      for (const b of bases) {
        b.m.emissive.copy(b.col).lerp(blanco, k * 0.95);
        b.m.emissiveIntensity = b.int + k * 2.6 * fuerza;
      }
    },
    fin: () => { for (const b of bases) { b.m.emissive.copy(b.col); b.m.emissiveIntensity = b.int; } },
  });
}

// ───────────────────────── API de combate ─────────────────────────

/**
 * Ataque: la criatura toma impulso y embiste hacia el rival.
 * @param {"heroe"|"enemigo"} quien
 * @param {{critico?:boolean, brutal?:boolean}} [o] brutal: carga más larga, sacudida y destello rojo
 * @returns {Promise<void>} **se cumple en el instante del impacto** (la vuelta sigue animándose),
 *          igual que `fx.animarAtaque`, que es de lo que depende el ritmo del combate en main.js
 */
export function animarAtaque(quien, { critico = false, brutal = false } = {}) {
  sonar("ataque");
  const q = lado(quien);
  const L = E.lados[q];
  if (!E.listo || !L?.criatura || !L.vivo) return esperar(dur(brutal ? 760 : critico ? 560 : 440) * 0.5);

  const otro = E.lados[otroLado(q)];
  const miX = L.baseX ?? L.ancla.position.x, suX = otro?.baseX ?? -miX;
  const avance = (suX - miX) * 0.42;
  const ms = dur(brutal ? 760 : critico ? 560 : 440);
  const imp = brutal ? 0.62 : 0.5;
  const arma = L.criatura.partes?.arma ?? null;
  const armaBase = arma?.rotation.x ?? 0;

  if (brutal) setTimeout(() => { sacudir(14, 480); destello(0xef4444, 0.35); }, ms * imp);
  else if (critico) setTimeout(() => sacudir(9, 360), ms * imp);
  setTimeout(() => polvoDePisada(q), ms * imp * 0.9);

  return animar({
    ms, lado: q, cumplirEn: imp,
    al: (p) => {
      // 0 → imp: retrocede un poco y se lanza. imp → 1: vuelve a su sitio.
      let k;
      if (p < imp * 0.55) k = -0.22 * (p / (imp * 0.55));
      else if (p < imp) k = -0.22 + 1.22 * salida((p - imp * 0.55) / (imp * 0.45));
      else k = 1 - suave((p - imp) / (1 - imp));
      // El avance es en X del mundo, así que lo que se mueve es el puesto entero.
      L.ancla.position.x = miX + avance * k;
      L.mov.rotation.y = -0.18 * k;
      L.mov.position.y = Math.sin(Math.max(0, Math.min(1, k)) * Math.PI) * (brutal ? 0.22 : 0.12);
      // El arma traza el tajo: se levanta en la carga y cae con el impacto.
      if (arma) arma.rotation.x = armaBase - 1.6 * k;
    },
    fin: () => {
      L.ancla.position.x = miX;
      L.mov.position.set(0, 0, 0);
      L.mov.rotation.y = 0;
      if (arma) arma.rotation.x = armaBase;
    },
  });
}

/**
 * Recibir un golpe: hit-stop, destello blanco, retroceso, chispas y número flotante en 3D.
 * @param {"heroe"|"enemigo"} quien el que RECIBE el golpe
 * @param {number|string} dano cantidad (0 o "esquiva" muestra «¡Esquiva!»)
 * @param {{critico?:boolean, bloqueado?:boolean, esquivado?:boolean}} [o]
 * @returns {Promise<void>} cuando termina el retroceso
 */
export async function animarGolpe(quien, dano, { critico = false, bloqueado = false, esquivado = false } = {}) {
  const q = lado(quien);
  const L = E.lados[q];
  const { texto, clase } = textoDeGolpe(dano, { critico, bloqueado, esquivado });
  const esq = clase === "esquiva";

  if (esq) {
    sonar("esquiva");
    numeroFlotante(q, texto, clase);
    if (!E.listo || !L?.criatura) return esperar(dur(380));
    const base = L.baseX ?? L.ancla.position.x;
    const fuera = Math.sign(base) || 1;
    return animar({
      ms: dur(380), lado: q,
      al: (p) => {
        const k = Math.sin(p * Math.PI);
        L.ancla.position.x = base + fuera * 0.45 * k;
        L.mov.rotation.y = fuera * 0.4 * k;
      },
      fin: () => { L.ancla.position.x = base; L.mov.rotation.y = 0; },
    });
  }

  sonar(bloqueado ? "bloqueo" : critico ? "critico" : "golpe");
  const parada = hitStop(critico ? 120 : 75);
  numeroFlotante(q, texto, clase);

  const f = luchadorEl(q);
  f?.classList.remove("golpeado"); void f?.offsetWidth; f?.classList.add("golpeado");

  if (E.listo && L?.criatura) {
    destellarCriatura(q, critico ? 1.6 : bloqueado ? 0.7 : 1);
    const centro = puntoImpacto(q);
    if (bloqueado) particulas(centro, { n: 22, color: 0x93c5fd, vel: 2.8, g: -6, ms: 520, tam: 0.06 });
    else particulas(centro, critico
      ? { n: 46, color: 0xfde047, vel: 4.2, g: -7, ms: 820, tam: 0.085 }
      : { n: 20, color: 0xef4444, vel: 2.6, g: -7, ms: 560, tam: 0.06 });
    if (critico) { destello(0xfff2c4, 0.45); sacudir(12, 420); }

    const base = L.baseX ?? L.ancla.position.x;
    const fuera = Math.sign(base) || 1;
    const empuje = (critico ? 0.5 : bloqueado ? 0.14 : 0.3);
    animar({
      ms: dur(420), lado: q,
      al: (p) => {
        const k = p < 0.3 ? p / 0.3 : 1 - salida((p - 0.3) / 0.7);
        L.ancla.position.x = base + fuera * empuje * k;
        L.mov.rotation.z = -fuera * 0.14 * k;
        L.mov.rotation.x = 0.1 * k;
      },
      fin: () => { L.ancla.position.x = base; L.mov.rotation.set(0, 0, 0); },
    });
  }
  await parada;
  return esperar(dur(260));
}

/**
 * Curación: resplandor verde, chispas que suben y «+N».
 * @param {"heroe"|"enemigo"} quien @param {number} cantidad
 */
export function animarCuracion(quien, cantidad) {
  sonar("curacion");
  const q = lado(quien);
  numeroFlotante(q, `+${cantidad}`, "cura");
  const L = E.lados[q];
  if (!E.listo || !L?.criatura) return esperar(dur(600));
  const cr = L.criatura;
  const mats = cr.materiales.filter((m) => m.emissive);
  const verde = new E.T.Color(0x4ade80);
  const bases = mats.map((m) => ({ m, col: m.emissive.clone(), int: m.emissiveIntensity ?? 0 }));
  const centro = L.mov.localToWorld(new E.T.Vector3(0, 0.15, 0));
  particulas(centro, { n: 28, color: 0x86efac, vel: 1.1, g: 2.2, ms: 1100, tam: 0.08 });
  animar({
    ms: dur(900),
    al: (p) => {
      const k = Math.sin(p * Math.PI);
      for (const b of bases) { b.m.emissive.copy(b.col).lerp(verde, k * 0.8); b.m.emissiveIntensity = b.int + k * 1.4; }
    },
    fin: () => { for (const b of bases) { b.m.emissive.copy(b.col); b.m.emissiveIntensity = b.int; } },
  });
  return esperar(dur(600));
}

/**
 * Estados de un luchador: chips en el HUD (mismas clases que el 2D) y un anillo de luz a los pies
 * con el color del estado.
 * @param {"heroe"|"enemigo"} quien
 * @param {Array<{tipo:string, turnos?:number, valor?:number}>} estados
 */
export function mostrarEstado(quien, estados) {
  const q = lado(quien);
  const f = luchadorEl(q);
  const cont = f?.querySelector(".estados");
  const lista = (estados ?? []).filter((e) => e?.tipo);
  const antes = new Set((E.estados[q] ?? []).map((e) => e.tipo));
  const nuevos = lista.filter((e) => !antes.has(e.tipo));
  E.estados[q] = lista.map((e) => ({ ...e }));

  if (cont) {
    cont.replaceChildren(...lista.map((e) => {
      const [nombre, desc] = INFO_ESTADO[e.tipo] ?? [e.tipo, ""];
      const chip = el("span", `estado est-${e.tipo}`, iconoEstado(e.tipo));
      chip.setAttribute("role", "listitem");
      const t = e.turnos != null ? ` (${e.turnos} turno${e.turnos === 1 ? "" : "s"})` : "";
      chip.title = `${nombre}${t}: ${desc}`;
      chip.setAttribute("aria-label", `${nombre}${t}`);
      if (e.turnos != null) chip.append(txt("b", "", String(e.turnos)));
      if (nuevos.includes(e) && !reducido()) chip.animate?.([{ transform: "scale(2)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], { duration: 320, easing: "cubic-bezier(.3,1.6,.5,1)" });
      return chip;
    }));
  }
  if (f) for (const t of Object.keys(INFO_ESTADO)) f.classList.toggle(`con-${t}`, lista.some((e) => e.tipo === t));
  pintarAuraEstados(q);
  if (nuevos.length) {
    sonar("estado");
    for (const e of nuevos) numeroFlotante(q, INFO_ESTADO[e.tipo]?.[0] ?? e.tipo, "estado");
  }
}

/**
 * Burbuja sobre el enemigo con lo que hará el próximo turno (HTML, como en el 2D: así se lee bien
 * y los lectores de pantalla la anuncian).
 * @param {{tipo:"atacar"|"cargar"|"defender"|"habilidad", texto:string, icono?:string, definitiva?:boolean}|null} intencion
 */
export function mostrarIntencion(intencion) {
  E.intencion = intencion ?? null;
  const b = luchadorEl("enemigo")?.querySelector(".intencion");
  if (!b) return;
  if (!intencion) { b.hidden = true; b.replaceChildren(); return; }
  const tipo = intencion.tipo ?? "atacar";
  b.className = `intencion int-${tipo}${intencion.definitiva ? " int-definitiva" : ""}`;
  b.innerHTML = iconoIntencion(tipo);
  if (intencion.icono) b.append(txt("span", "int-emoji", intencion.icono));
  b.append(txt("span", "int-texto", intencion.texto ?? ""));
  b.title = `Próximo turno: ${intencion.texto ?? tipo}`;
  b.hidden = false;
  if (!reducido()) b.animate?.([{ transform: "translate(-50%, 8px) scale(.6)", opacity: 0 }, { transform: "translate(-50%, 0) scale(1)", opacity: 1 }], { duration: 260, easing: "cubic-bezier(.3,1.5,.5,1)" });
  // Si va a cargar un golpe gordo, el aura roja avisa también en 3D.
  const L = E.lados.enemigo;
  if (L?.criatura && (tipo === "cargar" || intencion.definitiva)) destellarCriatura("enemigo", 0.5, 600);
}

/**
 * Muerte: la criatura se cae, se disuelve en partículas y desaparece. Idempotente.
 * @param {"heroe"|"enemigo"} quien @returns {Promise<void>}
 */
export function animarMuerte(quien) {
  const q = lado(quien);
  const L = E.lados[q];
  if (!L || !L.vivo) return Promise.resolve();
  L.vivo = false;
  sonar("muerte");
  if (q === "enemigo") mostrarIntencion(null);
  if (!E.listo || !L.criatura) return esperar(dur(500));

  cortarTweens(q);
  const cr = L.criatura;
  const centro = puntoImpacto(q);
  particulas(centro, { n: 90, color: cr.colores?.base ?? 0x9ca3af, vel: 1.9, g: -1.2, ms: 1500, tam: 0.085 });
  const mats = cr.materiales;
  for (const m of mats) { m.userData.opBase = m.opacity ?? 1; m.transparent = true; }
  const fuera = Math.sign(L.baseX ?? L.ancla.position.x) || 1;

  return animar({
    ms: dur(900), lado: q,
    al: (p) => {
      const k = salida(p);
      L.mov.rotation.z = fuera * 0.9 * k;          // se derrumba hacia fuera
      L.mov.position.y = -0.1 * k;
      L.mov.scale.setScalar(1 - 0.12 * k);
      for (const m of mats) m.opacity = (m.userData.opBase ?? 1) * Math.max(0, 1 - Math.max(0, (p - 0.25) / 0.75));
    },
    fin: () => {
      cr.raiz.visible = false;
      for (const m of mats) m.opacity = 0;
      if (L.aura) { liberarRama(L.aura); L.aura = null; }
    },
  });
}

/** Vuelve a mostrar una criatura tras `animarMuerte` (el héroe al empezar otra expedición). */
export function revivir(quien) {
  const q = lado(quien);
  const L = E.lados[q];
  if (!L) return;
  L.vivo = true;
  if (q === "heroe") { reconstruirHeroe(); return; }
  const cr = L.criatura;
  if (!cr) return;
  cortarTweens(q);
  cr.raiz.visible = true;
  for (const m of cr.materiales) m.opacity = m.userData.opBase ?? 1;
  L.mov.rotation.set(0, 0, 0);
  L.mov.position.set(0, 0, 0);
  L.mov.scale.setScalar(1);
  pintarAuraEstados(q);
}

/**
 * Muestra el enemigo (con entrada); `null` deja la arena vacía. Los jefes salen más grandes, con
 * corona y aura, y sacuden la cámara al aparecer.
 * @param {{nombre:string, emoji?:string, nivel?:number, jefe?:boolean, clave?:string, titulo?:string}|null} enemigo
 */
export function mostrarEnemigo(enemigo) {
  E.estados.enemigo = [];
  mostrarIntencion(null);
  mostrarEstado("enemigo", []);
  if (!enemigo) {
    E.enemigo = null;
    E.vida.enemigo = null;
    if (E.T) aplicarEnemigo();
    return;
  }
  E.enemigo = { ...enemigo, clave: enemigo.clave ?? claveDeNombre(enemigo.nombre) };
  sonar("aparicion");
  if (E.T) aplicarEnemigo();
}

/**
 * Pinta al héroe con su equipo y sus cosméticos. Se reconstruye el modelo: la espada y el escudo
 * aparecen o desaparecen y toman el color de su rareza.
 * @param {Array<{tipo:string, rareza:number}>} equipados
 * @param {{color?:number|null, sombrero?:number|null, capa?:number|null, aura?:number|null, mascota?:number|null}} [apariencia]
 *        si se omite, se conserva la última
 */
export function actualizarHeroe(equipados, apariencia) {
  E.equipados = Array.isArray(equipados) ? equipados.map((x) => ({ tipo: x?.tipo, rareza: Number(x?.rareza) || 0 })) : [];
  if (apariencia !== undefined) E.apariencia = { ...(apariencia ?? {}) };
  if (E.T) reconstruirHeroe();
}

/**
 * Barra de vida del HUD (la parte perdida se vacía con retraso, igual que en el 2D).
 * @param {"heroe"|"enemigo"} quien @param {number} vida @param {number} vidaMax
 */
export function actualizarVida(quien, vida, vidaMax) {
  const q = lado(quien);
  E.vida[q] = { vida, vidaMax };
  const f = luchadorEl(q) ?? document.querySelector(q === "heroe" ? "#f-jugador" : "#f-enemigo");
  if (!f) return;
  const pct = vidaMax ? Math.max(0, Math.min(100, (vida / vidaMax) * 100)) : 0;
  const fill = f.querySelector(".hp-fill");
  if (fill) { fill.style.width = `${pct}%`; fill.classList.toggle("baja", pct <= 30); }
  const t = f.querySelector(".hp-text");
  if (t) t.textContent = `${Math.max(0, vida)} / ${vidaMax}`;
}

// ───────────────────────── Desmontaje ─────────────────────────

/**
 * Suelta TODO: bucle, observadores, criaturas, escenario, texturas y el propio contexto WebGL.
 * Después de esto la memoria de la GPU vuelve a estar libre y se puede volver a montar.
 */
export function desmontar() {
  if (E.raf) cancelAnimationFrame(E.raf);
  E.raf = 0;
  E.listo = false;
  for (const quitar of E.observadores) { try { quitar(); } catch { /* nada */ } }
  E.observadores = [];
  for (const tw of E.tweens) { limpiarRed(tw); if (!tw.cumplido) { tw.cumplido = true; tw.cumplir(); } }
  E.tweens = [];
  for (const s of E.efimeros) s.userData?.liberar?.();
  E.efimeros = [];
  pararPrecalentado();
  for (const q of ["heroe", "enemigo"]) {
    const cr = E.lados[q]?.criatura;
    if (cr) { E.lados[q].mov.remove(cr.raiz); E.lados[q].criatura = null; }
  }
  for (const cr of almacen.values()) tirar(cr);
  almacen.clear();
  if (E.esc) { liberarRama(E.esc.raiz); E.esc.taller.liberar(); E.esc = null; }
  E.rotulos?.liberar();
  E.rotulos = null;
  if (E.escena) { E.escena.clear?.(); E.escena = null; }
  if (E.render) {
    E.render.setAnimationLoop?.(null);
    E.render.dispose();
    E.render.forceContextLoss?.();   // devuelve el contexto WebGL de verdad, no solo las texturas
    E.render = null;
  }
  E.camara = null;
  E.horno = null;
  E.lados = { heroe: null, enemigo: null };
  E.lienzo?.remove();
  E.lienzo = null;
  E.raiz?.classList.remove("escena-3d", "r3d-con-aviso");
  E.raiz?.removeAttribute("data-r3d-aviso");
  E.raiz = null;
  E.montado = false;
  E.promesaListo = null;
  E.aviso = "";
  E.T = null;
}

// ───────────────────────── Lo que no es la escena: se delega en fx.js ─────────────────────────
//
// Todas estas capas viven fuera de la arena (pantalla completa, inventario, tienda, sonido) y no
// cambian con el 3D: se reexportan tal cual, así que `escena3d.js` sirve de sustituto completo de
// `fx.js` para `main.js`. OJO: `iniciarInterfaz` NO se reexporta a propósito, porque monta la
// escena 2D; el enganche está explicado en el informe.

export {
  // Sonido (fx.js ya lo reexporta de audio.js)
  sonar, setSilencio, silenciado, setMusica, musicaActiva,
  // Capas a pantalla completa
  anunciar, subidaDeNivel, revelarBotin, mostrarResultado, mostrarPortada, ocultarPortada,
  // Enganche: logros, recompensas, pase, racha
  celebrarLogro, celebrarRecompensa, subirNivelPase, mostrarRachaDias,
  // HUD fuera de la arena e inventario
  actualizarXP, actualizarRacha, actualizarJefeEn, decorarCarta, aplicarFiltrosInventario,
  previsualizarCosmetico,
} from "../fx.js";
