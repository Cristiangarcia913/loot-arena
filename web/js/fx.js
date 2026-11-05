// Efectos visuales de Loot Arena: escenario vivo, sprites, feedback de combate, revelado de botín y pantallas.
// Todo con DOM + SVG + Canvas 2D + Web Animations API. Sin dependencias.
//
// Uso típico (main.js):
//   import * as FX from "./fx.js";
//   FX.iniciarInterfaz();                       // (index.html ya lo llama; es idempotente)
//   FX.mostrarEnemigo(enemigo);                 // al explorar
//   await FX.animarAtaque("heroe");             // resuelve en el instante del impacto
//   FX.animarGolpe("enemigo", 12, { critico }); // número flotante, partículas, hit-stop, sonido…
//   const r = await FX.revelarBotin(item);      // "otra" si pulsó «¡Otra vez!», "cerrar" si no
//
// `quien` acepta "heroe" | "jugador" (sinónimos) | "enemigo".
// Los efectos ya hacen sonar los sonidos correspondientes (audio.js): no llames a sonar() para lo mismo.

import { sonar, desbloquear, conectarBotonSonido } from "./audio.js";
import {
  spriteHeroe, spriteEnemigo, spriteCofre, spriteCosmetico, spriteMedalla, spriteLlama, claveEnemigo, iconoEstado, iconoIntencion,
  iconoObjeto, PALETA_RAREZA, RANURA_COSMETICO, APARIENCIA_VACIA,
} from "./sprites.js";

export { sonar, setSilencio, silenciado, setMusica, musicaActiva } from "./audio.js";

// ───────────────────────── Estado y utilidades ─────────────────────────

const E = {
  raiz: null,
  fondo: null,
  part: null,
  capaTextos: null,
  lados: { heroe: null, enemigo: null },
  equipados: [],
  apariencia: { ...APARIENCIA_VACIA },
  enemigo: null,
  ultimoMostrar: 0,
  estados: { heroe: [], enemigo: [] },
  auto: true,
  iniciada: false,
};

const mqReducido = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
/** @returns {boolean} true si el usuario pidió movimiento reducido (efectos recortados). */
export const reducido = () => !!mqReducido.matches;

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const lado = (quien) => (quien === "enemigo" ? "enemigo" : "heroe");
const azar = (a, b) => a + Math.random() * (b - a);
const el = (tag, clase, html) => { const n = document.createElement(tag); if (clase) n.className = clase; if (html != null) n.innerHTML = html; return n; };
const txt = (tag, clase, texto) => { const n = document.createElement(tag); if (clase) n.className = clase; n.textContent = texto; return n; };

const NOMBRE_RAREZA = ["Común", "Raro", "Legendario"];
const COLORES_RAREZA = [
  ["#e5e7eb", "#9ca3af", "#6b7280"],
  ["#bfdbfe", "#60a5fa", "#3b82f6", "#1d4ed8"],
  ["#fff7cc", "#fde047", "#f59e0b", "#fb923c", "#ffffff"],
];
const COLOR_ENEMIGO = {
  rata: ["#8d7a68", "#463a30"], lobo: ["#6b7280", "#1f2937"], goblin: ["#84cc16", "#3f6212"], esqueleto: ["#ece8e1", "#a8a29e"],
  arana: ["#6b21a8", "#dc2626"], orco: ["#6b8e23", "#2f4a0e"], espectro: ["#a5f3fc", "#22d3ee"], golem: ["#a8a29e", "#fb923c"],
  hechicero: ["#7e22ce", "#f0abfc"], dragon: ["#dc2626", "#fde047"], jefe: ["#ef4444", "#111827", "#fbbf24"],
};

function luchador(quien) { return E.lados[lado(quien)]; }
function spriteDe(quien) { return luchador(quien)?.querySelector(".sprite") ?? null; }

/** Centro de un elemento relativo a otro (px). */
function centro(elem, respecto) {
  const r = elem.getBoundingClientRect();
  const b = respecto.getBoundingClientRect();
  return { x: r.left - b.left + r.width / 2, y: r.top - b.top + r.height / 2, w: r.width, h: r.height };
}

// ───────────────────────── Sistema de partículas (canvas) ─────────────────────────

class Particulas {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext("2d");
    this.p = [];
    this.activo = false;
    this.congelado = 0;
    this.ult = 0;
    this.ajustar();
  }
  ajustar() {
    const r = this.c.getBoundingClientRect();
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 1.5);
    this.w = r.width; this.h = r.height;
    this.c.width = Math.max(1, Math.round(r.width * dpr));
    this.c.height = Math.max(1, Math.round(r.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  /**
   * @param {number} x @param {number} y
   * @param {object} o n, colores, vel:[min,max], ang:[min,max] (rad), vida:[min,max] s, tam:[min,max], g (px/s²),
   *                   arrastre, forma: "circulo"|"chispa"|"rect"|"estrella", aditivo, area:[w,h]
   */
  emitir(x, y, o = {}) {
    const n = Math.round((o.n ?? 20) * (reducido() ? 0.25 : 1));
    const col = o.colores ?? ["#fff"];
    for (let i = 0; i < n && this.p.length < 700; i++) {
      const a = azar(...(o.ang ?? [0, Math.PI * 2]));
      const v = azar(...(o.vel ?? [60, 220]));
      const vida = azar(...(o.vida ?? [0.5, 1]));
      this.p.push({
        x: x + (o.area ? azar(-o.area[0] / 2, o.area[0] / 2) : 0),
        y: y + (o.area ? azar(-o.area[1] / 2, o.area[1] / 2) : 0),
        vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        vida, max: vida, tam: azar(...(o.tam ?? [2, 4])),
        c: col[(Math.random() * col.length) | 0], g: o.g ?? 300, arr: o.arrastre ?? 0.97,
        forma: o.forma ?? "circulo", ad: o.aditivo ?? true, rot: Math.random() * 6.28, vr: azar(-8, 8),
      });
    }
    if (!this.activo) { this.activo = true; this.ult = performance.now(); requestAnimationFrame((t) => this.paso(t)); }
  }
  paso(t) {
    const dt = Math.min(0.05, (t - this.ult) / 1000);
    this.ult = t;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    const quieto = this.congelado > t;
    for (let i = this.p.length - 1; i >= 0; i--) {
      const p = this.p[i];
      if (!quieto) {
        p.vx *= p.arr; p.vy = p.vy * p.arr + p.g * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.vida -= dt; p.rot += p.vr * dt;
      }
      if (p.vida <= 0) { this.p.splice(i, 1); continue; }
      const k = p.vida / p.max;
      ctx.globalAlpha = Math.min(1, k * 1.4);
      ctx.globalCompositeOperation = p.ad ? "lighter" : "source-over";
      ctx.fillStyle = p.c;
      if (p.forma === "chispa") {
        ctx.strokeStyle = p.c; ctx.lineWidth = p.tam * 0.6; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04); ctx.stroke();
      } else if (p.forma === "rect") {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillRect(-p.tam, -p.tam * 0.5, p.tam * 2, p.tam); ctx.restore();
      } else if (p.forma === "moneda") {
        const ancho = Math.abs(Math.cos(p.rot)) * p.tam + 0.6;
        ctx.fillStyle = "#b45309";
        ctx.beginPath(); ctx.ellipse(p.x, p.y + 1, ancho, p.tam, 0, 0, 6.283); ctx.fill();
        ctx.fillStyle = Math.cos(p.rot) > 0 ? "#fcd34d" : "#f59e0b";
        ctx.beginPath(); ctx.ellipse(p.x, p.y, ancho, p.tam, 0, 0, 6.283); ctx.fill();
        if (ancho > p.tam * 0.5) { ctx.fillStyle = "#fff7cc"; ctx.beginPath(); ctx.ellipse(p.x - ancho * 0.3, p.y - p.tam * 0.35, ancho * 0.25, p.tam * 0.2, 0, 0, 6.283); ctx.fill(); }
      } else if (p.forma === "estrella") {
        const s = p.tam * (0.6 + 0.4 * k);
        ctx.beginPath(); ctx.moveTo(p.x, p.y - s * 2); ctx.lineTo(p.x + s * 0.5, p.y - s * 0.5); ctx.lineTo(p.x + s * 2, p.y);
        ctx.lineTo(p.x + s * 0.5, p.y + s * 0.5); ctx.lineTo(p.x, p.y + s * 2); ctx.lineTo(p.x - s * 0.5, p.y + s * 0.5);
        ctx.lineTo(p.x - s * 2, p.y); ctx.lineTo(p.x - s * 0.5, p.y - s * 0.5); ctx.fill();
      } else {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.tam * (0.5 + 0.5 * k), 0, 6.283); ctx.fill();
      }
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    if (this.p.length) requestAnimationFrame((tt) => this.paso(tt));
    else { this.activo = false; ctx.clearRect(0, 0, this.w, this.h); }
  }
}

// ───────────────────────── Fondo animado de la arena ─────────────────────────

function crearFondo(canvas, raiz) {
  const ctx = canvas.getContext("2d");
  const st = { w: 0, h: 0, base: null, motas: [], visible: true, raf: 0, ult: 0 };
  let semilla = 7;
  const rnd = () => ((semilla = (semilla * 16807) % 2147483647) / 2147483647);

  function construir() {
    const r = raiz.getBoundingClientRect();
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 1.5);
    st.w = Math.max(1, r.width); st.h = Math.max(1, r.height);
    canvas.width = Math.round(st.w * dpr); canvas.height = Math.round(st.h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Capa estática pre-renderizada.
    const off = document.createElement("canvas");
    off.width = canvas.width; off.height = canvas.height;
    const o = off.getContext("2d");
    o.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { w, h } = st;
    const muro = h * 0.6;
    semilla = 7;
    let gr = o.createLinearGradient(0, 0, 0, muro);
    gr.addColorStop(0, "#0c0806"); gr.addColorStop(1, "#2a1e15");
    o.fillStyle = gr; o.fillRect(0, 0, w, muro);
    // Ladrillos
    const bh = 13, bw = 32;
    for (let y = 0, fila = 0; y < muro; y += bh, fila++) {
      for (let x = -((fila % 2) * bw) / 2; x < w; x += bw) {
        const l = 14 + rnd() * 10 + (y / muro) * 10;
        o.fillStyle = `hsl(25 22% ${l}%)`;
        o.globalAlpha = 0.55;
        o.fillRect(x + 1, y + 1, bw - 2, bh - 2);
      }
    }
    o.globalAlpha = 1;
    // Arcos
    const nArcos = Math.max(3, Math.round(w / 190));
    for (let i = 0; i < nArcos; i++) {
      const cx = ((i + 0.5) / nArcos) * w, aw = Math.min(70, w / nArcos * 0.45), top = muro * 0.3;
      gr = o.createLinearGradient(0, top, 0, muro);
      gr.addColorStop(0, "#050302"); gr.addColorStop(1, "#140d08");
      o.fillStyle = gr;
      o.beginPath(); o.moveTo(cx - aw / 2, muro); o.lineTo(cx - aw / 2, top + aw / 2);
      o.arc(cx, top + aw / 2, aw / 2, Math.PI, 0); o.lineTo(cx + aw / 2, muro); o.fill();
      o.strokeStyle = "rgba(232,183,90,.12)"; o.lineWidth = 3; o.stroke();
    }
    // Estandartes
    for (const fx of [0.3, 0.7]) {
      const x = fx * w, y0 = muro * 0.06, bw2 = Math.min(34, w * 0.05), bl = muro * 0.42;
      o.fillStyle = "#6b1414";
      o.beginPath(); o.moveTo(x - bw2 / 2, y0); o.lineTo(x + bw2 / 2, y0); o.lineTo(x + bw2 / 2, y0 + bl); o.lineTo(x, y0 + bl - 10); o.lineTo(x - bw2 / 2, y0 + bl); o.fill();
      o.strokeStyle = "#c9a14a"; o.lineWidth = 2; o.stroke();
      o.fillStyle = "#e8b75a"; o.font = `${Math.round(bw2 * 0.6)}px serif`; o.textAlign = "center"; o.fillText("⚔", x, y0 + bl * 0.45);
    }
    // Suelo
    gr = o.createLinearGradient(0, muro, 0, h);
    gr.addColorStop(0, "#4a3522"); gr.addColorStop(1, "#1e140c");
    o.fillStyle = gr; o.fillRect(0, muro, w, h - muro);
    gr = o.createLinearGradient(0, muro - 10, 0, muro + 16);
    gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(0.5, "rgba(0,0,0,.55)"); gr.addColorStop(1, "rgba(0,0,0,0)");
    o.fillStyle = gr; o.fillRect(0, muro - 10, w, 26);
    gr = o.createRadialGradient(w / 2, h * 0.86, 10, w / 2, h * 0.86, w * 0.55);
    gr.addColorStop(0, "rgba(232,183,90,.28)"); gr.addColorStop(1, "rgba(232,183,90,0)");
    o.fillStyle = gr; o.fillRect(0, muro, w, h - muro);
    for (let i = 0; i < 70; i++) {
      o.fillStyle = `rgba(${rnd() < 0.5 ? "0,0,0" : "255,220,170"},${0.08 + rnd() * 0.12})`;
      o.beginPath(); o.ellipse(rnd() * w, muro + 8 + rnd() * (h - muro), 1 + rnd() * 2.5, 0.8 + rnd(), 0, 0, 6.28); o.fill();
    }
    // Soportes de antorcha
    for (const x of antorchas()) {
      o.fillStyle = "#1a1410"; o.fillRect(x - 3, muro * 0.42, 6, 22);
      o.fillStyle = "#3b2a1c"; o.fillRect(x - 7, muro * 0.42 - 4, 14, 6);
    }
    st.base = off;
    st.motas = Array.from({ length: Math.round(Math.min(60, w / 12)) }, () => ({
      x: Math.random() * w, y: Math.random() * h, z: Math.random(), f: Math.random() * 6.28,
    }));
  }
  const antorchas = () => [st.w * 0.08, st.w * 0.92];

  function pintar(t) {
    const { w, h } = st;
    const muro = h * 0.6;
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.drawImage(st.base, 0, 0, w, h);
    const s = t / 1000;
    // Niebla
    for (let i = 0; i < 2; i++) {
      const fx = ((s * (8 + i * 5) + i * 300) % (w + 400)) - 200;
      const gr = ctx.createRadialGradient(fx, h * (0.72 + i * 0.12), 10, fx, h * (0.72 + i * 0.12), 260);
      gr.addColorStop(0, "rgba(200,170,140,.07)"); gr.addColorStop(1, "rgba(200,170,140,0)");
      ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
    }
    // Antorchas
    ctx.globalCompositeOperation = "lighter";
    antorchas().forEach((x, i) => {
      const fl = 0.82 + 0.1 * Math.sin(s * 9 + i * 2) + 0.08 * Math.sin(s * 23 + i * 5) + (reducido() ? 0 : 0.04 * Math.random());
      const y = muro * 0.42 - 6;
      let gr = ctx.createRadialGradient(x, y, 4, x, y, 150 * fl);
      gr.addColorStop(0, "rgba(255,170,70,.42)"); gr.addColorStop(1, "rgba(255,120,30,0)");
      ctx.fillStyle = gr; ctx.fillRect(x - 160, y - 160, 320, 320);
      const llama = (r, alto, c) => {
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.moveTo(x - r, y);
        ctx.quadraticCurveTo(x - r, y - alto * 0.6, x + Math.sin(s * 7 + i) * 2, y - alto * fl);
        ctx.quadraticCurveTo(x + r, y - alto * 0.6, x + r, y);
        ctx.arc(x, y, r, 0, Math.PI); ctx.fill();
      };
      llama(8, 26, "rgba(255,90,20,.75)");
      llama(5.5, 18, "rgba(255,180,60,.85)");
      llama(3, 10, "rgba(255,245,200,.9)");
    });
    // Polvo / brasas en parallax
    for (const m of st.motas) {
      if (!reducido()) {
        m.x += (6 + m.z * 18) / 30; m.y += Math.sin(s + m.f) * 0.15 - m.z * 0.08;
        if (m.x > w + 5) m.x = -5; if (m.y < -5) m.y = h + 5;
      }
      const a = (0.15 + 0.35 * m.z) * (0.6 + 0.4 * Math.sin(s * 2 + m.f));
      ctx.fillStyle = m.z > 0.85 ? `rgba(255,150,60,${a})` : `rgba(255,230,190,${a * 0.6})`;
      ctx.beginPath(); ctx.arc(m.x, m.y, 0.6 + m.z * 1.6, 0, 6.28); ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  function bucle(t) {
    st.raf = 0;
    if (!st.visible || document.hidden) return;
    if (t - st.ult >= 33) { st.ult = t; pintar(t); } // ~30 fps es suficiente para el fondo
    if (!reducido()) st.raf = requestAnimationFrame(bucle);
  }
  const arrancar = () => { if (!st.raf && st.base) st.raf = requestAnimationFrame(bucle); };

  construir();
  pintar(performance.now());
  new ResizeObserver(() => { construir(); pintar(performance.now()); }).observe(raiz);
  new IntersectionObserver(([e]) => { st.visible = e.isIntersecting; if (st.visible) arrancar(); }).observe(raiz);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) arrancar(); });
  mqReducido.addEventListener?.("change", () => { pintar(performance.now()); arrancar(); });
  arrancar();
  return st;
}

// ───────────────────────── Montaje de la escena ─────────────────────────

function asegurarLuchador(raiz, quien) {
  let f = raiz.querySelector(`.fighter[data-lado="${quien}"]`) ?? raiz.querySelector(quien === "heroe" ? "#f-jugador" : "#f-enemigo");
  if (!f) {
    f = el("div", `fighter${quien === "enemigo" ? " enemy vacio" : ""}`);
    f.innerHTML = `<div class="f-hud"><div class="f-name"></div><div class="hp"><div class="hp-fill"></div><span class="hp-text"></span></div><div class="f-stats"></div></div><div class="retrato"><div class="avatar" aria-hidden="true"></div></div>`;
    raiz.append(f);
  }
  f.dataset.lado = quien;
  let ret = f.querySelector(".retrato");
  if (!ret) { ret = el("div", "retrato"); const av = f.querySelector(".avatar"); if (av) av.before(ret); else f.append(ret); if (av) ret.append(av); }
  if (!ret.querySelector(".sprite")) ret.prepend(el("div", "sprite"));
  if (!f.querySelector(".estados")) (f.querySelector(".f-hud") ?? f).append(Object.assign(el("div", "estados"), { role: "list" }));
  if (quien === "enemigo" && !f.querySelector(".intencion")) {
    const it = el("div", "intencion");
    it.hidden = true; it.setAttribute("aria-live", "polite");
    ret.prepend(it);
  }
  // Barra de vida con daño retardado
  const hp = f.querySelector(".hp");
  const fill = hp?.querySelector(".hp-fill");
  if (fill && !hp.querySelector(".hp-lag")) {
    const lag = el("div", "hp-lag");
    fill.before(lag);
    lag.style.width = fill.style.width || "100%";
    let previo = parseFloat(fill.style.width) || 100;
    let timer = 0;
    new MutationObserver(() => {
      const ahora = parseFloat(fill.style.width);
      if (Number.isNaN(ahora)) return;
      clearTimeout(timer);
      if (ahora < previo) {
        hp.classList.remove("hp-dano"); void hp.offsetWidth; hp.classList.add("hp-dano");
        timer = setTimeout(() => { lag.style.transition = "width .55s cubic-bezier(.3,.7,.4,1)"; lag.style.width = `${ahora}%`; }, reducido() ? 0 : 420);
      } else {
        lag.style.transition = "none"; lag.style.width = `${ahora}%`;
      }
      previo = ahora;
    }).observe(fill, { attributes: true, attributeFilter: ["style"] });
  }
  return f;
}

/**
 * Prepara la escena dentro de `raizEl` (normalmente `#escena`): fondo animado en canvas, capa de partículas,
 * sprites en `.fighter[data-lado]` (o `#f-jugador`/`#f-enemigo`; si no existen se crean), iconos de estado,
 * burbuja de intención y barras de vida con daño retardado. Idempotente.
 * @param {HTMLElement} raizEl
 * @param {{auto?:boolean}} [opciones] auto (true por defecto): sincroniza el sprite del enemigo y las muertes con el
 *        nombre/emoji que pinte main.js en `.f-name`/`.avatar` (útil antes de integrar; pon false si llamas a todo a mano)
 * @returns {HTMLElement} la raíz
 */
export function montarEscena(raizEl, opciones = {}) {
  if (!raizEl) throw new Error("montarEscena: falta el elemento raíz");
  // Una segunda llamada sin `auto` explícito no cambia lo que eligió la primera (main.js pasa {auto:false}).
  if (E.raiz === raizEl) { if ("auto" in opciones) E.auto = !!opciones.auto; return raizEl; }
  const auto = opciones.auto ?? true;
  E.auto = auto;
  E.raiz = raizEl;
  raizEl.classList.add("escena", "escena-montada");
  const cFondo = raizEl.querySelector("canvas.escena-fondo") ?? el("canvas", "escena-fondo");
  cFondo.setAttribute("aria-hidden", "true");
  raizEl.prepend(cFondo);
  E.lados.heroe = asegurarLuchador(raizEl, "heroe");
  E.lados.enemigo = asegurarLuchador(raizEl, "enemigo");
  const cFx = raizEl.querySelector("canvas.escena-fx") ?? el("canvas", "escena-fx");
  cFx.setAttribute("aria-hidden", "true");
  raizEl.append(cFx);
  E.capaTextos = raizEl.querySelector(".escena-textos") ?? el("div", "escena-textos");
  E.capaTextos.setAttribute("aria-hidden", "true");
  raizEl.append(E.capaTextos);
  if (!raizEl.querySelector(".escena-destello")) raizEl.append(el("div", "escena-destello"));

  E.fondo = crearFondo(cFondo, raizEl);
  E.part = new Particulas(cFx);
  new ResizeObserver(() => E.part.ajustar()).observe(raizEl);
  pintarHeroe();
  if (auto) sincronizarConMain();
  return raizEl;
}

function pintarHeroe() {
  const s = spriteDe("heroe");
  if (s) { s.innerHTML = spriteHeroe(E.equipados, E.apariencia); s.classList.remove("muerto"); s.style.opacity = ""; }
}

/** Observa lo que pinta main.js (nombre y emoji) para mantener los sprites en sintonía sin integración explícita. */
function sincronizarConMain() {
  const fe = E.lados.enemigo, fh = E.lados.heroe;
  const nombreEl = fe.querySelector(".f-name");
  const leerNombre = () => (nombreEl?.firstChild?.nodeType === 3 ? nombreEl.firstChild.textContent : nombreEl?.textContent ?? "").trim();
  new MutationObserver(() => {
    if (!E.auto) return;
    const nombre = leerNombre();
    if (fe.classList.contains("vacio") || !nombre || nombre === "Arena vacía") { if (E.enemigo) { E.enemigo = null; mostrarIntencion(null); mostrarEstado("enemigo", []); } return; }
    if (performance.now() - E.ultimoMostrar < 600) return;
    if (E.enemigo?.nombre === nombre && !spriteDe("enemigo")?.classList.contains("muerto")) return;
    const nv = Number((nombreEl.textContent.match(/Nv\.\s*(\d+)/) ?? [])[1]) || 1;
    mostrarEnemigo({ nombre, nivel: nv, emoji: fe.querySelector(".avatar")?.textContent ?? "❔" }, { interno: true });
  }).observe(fe, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class"] });
  const avatarObs = (f, quien, muerte, vivo) => {
    const av = f.querySelector(".avatar");
    if (!av) return;
    new MutationObserver(() => {
      if (!E.auto) return;
      const t = av.textContent.trim();
      if (t === muerte) animarMuerte(quien);
      else if (vivo && t === vivo && spriteDe(quien)?.classList.contains("muerto")) revivir(quien);
    }).observe(av, { childList: true, characterData: true, subtree: true });
  };
  avatarObs(fe, "enemigo", "🪦");
  avatarObs(fh, "heroe", "😵", "🤺");
}

// ───────────────────────── Efectos básicos ─────────────────────────

/**
 * Sacude la escena (o todo el panel si `objetivo` es otro elemento).
 * @param {number} [fuerza=8] píxeles máximos de desplazamiento
 * @param {number} [ms=380]
 */
export function sacudir(fuerza = 8, ms = 380, objetivo = E.raiz) {
  if (!objetivo || reducido()) return;
  const kf = [];
  for (let i = 0; i <= 8; i++) {
    const k = 1 - i / 8;
    kf.push({ transform: i === 8 ? "none" : `translate(${azar(-1, 1) * fuerza * k}px, ${azar(-1, 1) * fuerza * k * 0.6}px) rotate(${azar(-1, 1) * fuerza * 0.06 * k}deg)` });
  }
  objetivo.animate(kf, { duration: ms, easing: "linear" });
}

/** Destello de color sobre la escena. @param {string} [color="#fff"] @param {number} [opacidad=.6] */
export function destello(color = "#fff", opacidad = 0.6, ms = 260) {
  const d = E.raiz?.querySelector(".escena-destello");
  if (!d) return;
  d.style.background = color;
  d.animate([{ opacity: reducido() ? opacidad * 0.4 : opacidad }, { opacity: 0 }], { duration: ms, easing: "ease-out" });
}

/**
 * Hit-stop: congela un instante todas las animaciones de la escena y las partículas.
 * @param {number} [ms=80] @returns {Promise<void>}
 */
export async function hitStop(ms = 80) {
  if (!E.raiz || reducido()) return;
  const anims = E.raiz.getAnimations({ subtree: true }).filter((a) => a.playState === "running");
  anims.forEach((a) => a.pause());
  if (E.part) E.part.congelado = performance.now() + ms;
  await esperar(ms);
  anims.forEach((a) => { try { a.play(); } catch { /* terminada */ } });
}

/**
 * Texto flotante sobre un luchador.
 * @param {"heroe"|"enemigo"} quien @param {string} texto
 * @param {string} [clase] "dano" | "critico" | "cura" | "bloqueo" | "esquiva" | "info" | "estado"
 */
export function numeroFlotante(quien, texto, clase = "dano") {
  const s = spriteDe(quien);
  if (!s || !E.capaTextos) return;
  const c = centro(s, E.raiz);
  const n = txt("span", `flot flot-${clase}`, texto);
  n.style.left = `${c.x + azar(-14, 14)}px`;
  n.style.top = `${c.y - c.h * 0.25}px`;
  E.capaTextos.append(n);
  const sube = clase === "critico" ? 90 : 64;
  const a = n.animate([
    { transform: "translate(-50%, 0) scale(.4)", opacity: 0 },
    { transform: `translate(-50%, -${sube * 0.3}px) scale(${clase === "critico" ? 1.6 : 1.15})`, opacity: 1, offset: 0.15 },
    { transform: `translate(-50%, -${sube * 0.55}px) scale(1)`, opacity: 1, offset: 0.55 },
    { transform: `translate(-50%, -${sube}px) scale(.9)`, opacity: 0 },
  ], { duration: clase === "critico" ? 1300 : 1050, easing: "cubic-bezier(.2,.7,.3,1)" });
  a.onfinish = () => n.remove();
}

function chispas(quien, opciones) {
  const s = spriteDe(quien);
  if (!s || !E.part) return;
  const c = centro(s, E.raiz);
  E.part.emitir(c.x, c.y, opciones);
}

/**
 * Ataque: el sprite toma impulso y embiste hacia el rival.
 * @param {"heroe"|"enemigo"} quien
 * @param {{critico?:boolean, brutal?:boolean}} [o] brutal: carga más larga, resplandor rojo y sacudida
 * @returns {Promise<void>} se resuelve en el instante del impacto (la vuelta sigue animándose)
 */
export function animarAtaque(quien, { critico = false, brutal = false } = {}) {
  const s = spriteDe(quien), otro = spriteDe(lado(quien) === "heroe" ? "enemigo" : "heroe");
  sonar("ataque");
  if (!s || !otro || reducido()) return esperar(reducido() ? 60 : 0);
  const dx = (centro(otro, E.raiz).x - centro(s, E.raiz).x) * 0.42;
  const dur = brutal ? 760 : critico ? 560 : 440;
  const imp = brutal ? 0.62 : 0.5;
  const dir = Math.sign(dx) || 1;
  s.animate([
    { transform: "none" },
    { transform: `translateX(${-dir * 14}px) rotate(${-dir * 4}deg) scale(1.02)`, offset: imp * 0.55, ...(brutal ? { filter: "drop-shadow(0 0 14px #ef4444) brightness(1.3)" } : {}) },
    { transform: `translateX(${dx}px) rotate(${dir * 6}deg) scale(1.06)`, offset: imp },
    { transform: `translateX(${dx * 0.9}px)`, offset: imp + 0.08 },
    { transform: "none" },
  ], { duration: dur, easing: "cubic-bezier(.5,0,.3,1)" });
  if (brutal) setTimeout(() => { sacudir(14, 480); destello("#ef4444", 0.35); }, dur * imp);
  else if (critico) setTimeout(() => sacudir(9, 360), dur * imp);
  return esperar(dur * imp);
}

/**
 * Recibir un golpe: hit-stop, parpadeo blanco, retroceso, chispas, número flotante y sonido.
 * @param {"heroe"|"enemigo"} quien el que RECIBE el golpe
 * @param {number|string} dano cantidad (0 o "esquiva" muestra «¡Esquiva!»)
 * @param {{critico?:boolean, bloqueado?:boolean, esquivado?:boolean}} [o]
 * @returns {Promise<void>} cuando termina el retroceso
 */
export async function animarGolpe(quien, dano, { critico = false, bloqueado = false, esquivado = false } = {}) {
  const s = spriteDe(quien);
  const esq = esquivado || dano === "esquiva";
  if (esq) {
    sonar("esquiva");
    numeroFlotante(quien, "¡Esquiva!", "esquiva");
    s?.animate([{ transform: "none" }, { transform: `translateX(${lado(quien) === "heroe" ? -26 : 26}px) skewX(-8deg)`, opacity: 0.5 }, { transform: "none" }], { duration: 380, easing: "ease-out" });
    return esperar(380);
  }
  sonar(bloqueado ? "bloqueo" : critico ? "critico" : "golpe");
  const parada = hitStop(critico ? 120 : 75);
  const dir = lado(quien) === "heroe" ? -1 : 1;
  if (s && !reducido()) {
    s.animate([
      { filter: "brightness(4) saturate(0)", transform: `translateX(${dir * (critico ? 18 : 10)}px) scale(.95)` },
      { filter: "brightness(1)", transform: `translateX(${dir * 5}px)`, offset: 0.35 },
      { filter: "brightness(2.5) saturate(0)", offset: 0.5 },
      { filter: "none", transform: "none" },
    ], { duration: 420, easing: "ease-out" });
  }
  const f = luchador(quien);
  f?.classList.remove("golpeado"); void f?.offsetWidth; f?.classList.add("golpeado");
  if (bloqueado) {
    chispas(quien, { n: 22, colores: ["#bfdbfe", "#60a5fa", "#fff"], vel: [120, 320], forma: "chispa", g: 200, vida: [0.25, 0.5], tam: [2, 3] });
    numeroFlotante(quien, dano ? `🛡 ${dano}` : "¡Bloqueado!", "bloqueo");
  } else {
    chispas(quien, critico
      ? { n: 46, colores: ["#fff7cc", "#fde047", "#f59e0b", "#ef4444"], vel: [160, 460], forma: "chispa", g: 260, vida: [0.35, 0.8], tam: [2.5, 4] }
      : { n: 20, colores: ["#fecaca", "#ef4444", "#fb923c"], vel: [90, 280], forma: "chispa", g: 300, vida: [0.25, 0.55], tam: [2, 3] });
    if (critico) { numeroFlotante(quien, `¡${dano}!`, "critico"); destello("#fff2c4", 0.45); sacudir(12, 420); }
    else numeroFlotante(quien, `−${dano}`, "dano");
  }
  await parada;
  return esperar(260);
}

/**
 * Curación: resplandor verde, chispas que suben y «+N».
 * @param {"heroe"|"enemigo"} quien @param {number} cantidad
 */
export function animarCuracion(quien, cantidad) {
  sonar("curacion");
  numeroFlotante(quien, `+${cantidad}`, "cura");
  const s = spriteDe(quien);
  s?.animate([{ filter: "none" }, { filter: "drop-shadow(0 0 16px #4ade80) brightness(1.3)" }, { filter: "none" }], { duration: 900 });
  const c = s && centro(s, E.raiz);
  if (c) E.part?.emitir(c.x, c.y + c.h * 0.3, { n: 28, colores: ["#bbf7d0", "#4ade80", "#fff"], vel: [20, 70], ang: [-Math.PI * 0.75, -Math.PI * 0.25], g: -90, vida: [0.7, 1.3], tam: [1.5, 3], forma: "estrella", area: [c.w * 0.6, 10] });
  return esperar(600);
}

const INFO_ESTADO = {
  veneno: ["Veneno", "Pierde vida cada turno"],
  sangrado: ["Sangrado", "Pierde vida cada turno"],
  aturdido: ["Aturdido", "Pierde el próximo turno"],
  escudo: ["Escudo", "Absorbe daño"],
  furia: ["Furia", "Ataque aumentado"],
  reflejo: ["Reflejo", "Devuelve parte del daño"],
  evasion: ["Evasión", "Esquiva el próximo golpe"],
};

/**
 * Pinta los iconos de estado de un luchador (y un tinte en el sprite).
 * @param {"heroe"|"enemigo"} quien
 * @param {Array<{tipo:string, turnos?:number, valor?:number}>} estados veneno, aturdido, sangrado, escudo, furia, reflejo, evasion
 */
export function mostrarEstado(quien, estados) {
  const f = luchador(quien);
  const cont = f?.querySelector(".estados");
  if (!cont) return;
  const l = lado(quien);
  const lista = (estados ?? []).filter((e) => e?.tipo);
  const antes = new Set(E.estados[l].map((e) => e.tipo));
  const nuevos = lista.filter((e) => !antes.has(e.tipo));
  E.estados[l] = lista.map((e) => ({ ...e }));
  cont.replaceChildren(...lista.map((e) => {
    const [nombre, desc] = INFO_ESTADO[e.tipo] ?? [e.tipo, ""];
    const chip = el("span", `estado est-${e.tipo}`, iconoEstado(e.tipo));
    chip.setAttribute("role", "listitem");
    const t = e.turnos != null ? ` (${e.turnos} turno${e.turnos === 1 ? "" : "s"})` : "";
    chip.title = `${nombre}${t}: ${desc}`;
    chip.setAttribute("aria-label", `${nombre}${t}`);
    if (e.turnos != null) chip.append(txt("b", "", String(e.turnos)));
    if (nuevos.includes(e) && !reducido()) chip.animate([{ transform: "scale(2)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], { duration: 320, easing: "cubic-bezier(.3,1.6,.5,1)" });
    return chip;
  }));
  for (const t of Object.keys(INFO_ESTADO)) f.classList.toggle(`con-${t}`, lista.some((e) => e.tipo === t));
  if (nuevos.length) {
    sonar("estado");
    for (const e of nuevos) numeroFlotante(quien, INFO_ESTADO[e.tipo]?.[0] ?? e.tipo, "estado");
  }
}

/**
 * Burbuja sobre la cabeza del enemigo con lo que hará el próximo turno.
 * @param {{tipo:"atacar"|"cargar"|"defender"|"habilidad", texto:string, icono?:string, definitiva?:boolean}|null} intencion
 */
export function mostrarIntencion(intencion) {
  const b = E.lados.enemigo?.querySelector(".intencion");
  if (!b) return;
  if (!intencion) { b.hidden = true; b.replaceChildren(); return; }
  const tipo = intencion.tipo ?? "atacar";
  b.className = `intencion int-${tipo}${intencion.definitiva ? " int-definitiva" : ""}`;
  b.innerHTML = iconoIntencion(tipo);
  if (intencion.icono) b.append(txt("span", "int-emoji", intencion.icono));
  b.append(txt("span", "int-texto", intencion.texto ?? ""));
  b.title = `Próximo turno: ${intencion.texto ?? tipo}`;
  b.hidden = false;
  if (!reducido()) b.animate([{ transform: "translate(-50%, 8px) scale(.6)", opacity: 0 }, { transform: "translate(-50%, 0) scale(1)", opacity: 1 }], { duration: 260, easing: "cubic-bezier(.3,1.5,.5,1)" });
}

/**
 * Muerte: el sprite se disuelve en partículas. Idempotente.
 * @param {"heroe"|"enemigo"} quien @returns {Promise<void>}
 */
export function animarMuerte(quien) {
  const s = spriteDe(quien);
  if (!s || s.classList.contains("muerto")) return Promise.resolve();
  s.classList.add("muerto");
  sonar("muerte");
  if (lado(quien) === "enemigo") mostrarIntencion(null);
  const c = centro(s, E.raiz);
  const cols = lado(quien) === "heroe" ? ["#e8b88f", "#a0703f", "#9b2c2c"] : (COLOR_ENEMIGO[E.enemigo?.clave] ?? ["#9ca3af", "#4b5563"]);
  E.part?.emitir(c.x, c.y, { n: 90, colores: [...cols, "#fff"], vel: [10, 70], ang: [-Math.PI, 0], g: -60, vida: [0.6, 1.6], tam: [1.5, 3.5], forma: "rect", area: [c.w * 0.55, c.h * 0.7], aditivo: false, arrastre: 0.985 });
  const a = s.animate([
    { opacity: 1, filter: "none", transform: "none" },
    { opacity: 0.9, filter: "brightness(2.5) saturate(.3)", transform: "translateY(-4px)", offset: 0.25 },
    { opacity: 0, filter: "brightness(3) blur(6px)", transform: "translateY(-14px) scale(.92)" },
  ], { duration: reducido() ? 200 : 900, easing: "ease-in", fill: "forwards" });
  return a.finished.then(() => { s.style.opacity = "0"; a.cancel(); }).catch(() => {});
}

/** Vuelve a mostrar un sprite tras animarMuerte (el héroe al empezar otra expedición). */
export function revivir(quien) {
  if (lado(quien) === "heroe") { pintarHeroe(); return; }
  const s = spriteDe(quien);
  if (s) { s.classList.remove("muerto"); s.style.opacity = ""; }
}

/**
 * Muestra (con entrada) el sprite del enemigo; `null` deja la arena vacía.
 * Los jefes son más grandes, con aura y anuncio a pantalla completa.
 * @param {{nombre:string, emoji?:string, nivel?:number, jefe?:boolean, clave?:string, titulo?:string}|null} enemigo
 */
export function mostrarEnemigo(enemigo, { interno = false } = {}) {
  const f = E.lados.enemigo, s = spriteDe("enemigo");
  if (!f || !s) return;
  if (!interno) E.ultimoMostrar = performance.now();
  mostrarIntencion(null);
  mostrarEstado("enemigo", []);
  if (!enemigo) { E.enemigo = null; s.innerHTML = ""; f.classList.remove("jefe"); return; }
  const clave = enemigo.clave ?? claveEnemigo(enemigo.nombre);
  const jefe = !!enemigo.jefe;
  E.enemigo = { ...enemigo, clave };
  f.classList.toggle("jefe", jefe);
  f.dataset.clave = clave;
  s.classList.remove("muerto");
  s.style.opacity = "";
  s.innerHTML = spriteEnemigo(clave, { jefe, emoji: enemigo.emoji });
  sonar("aparicion");
  if (!reducido()) {
    s.animate([
      { transform: "translateX(60px) scale(.7)", opacity: 0, filter: "brightness(0)" },
      { transform: "translateX(-6px) scale(1.04)", opacity: 1, filter: "brightness(.4)", offset: 0.6 },
      { transform: "none", opacity: 1, filter: "none" },
    ], { duration: jefe ? 900 : 520, easing: "cubic-bezier(.2,.8,.3,1)" });
    setTimeout(() => {
      const c = centro(s, E.raiz);
      E.part?.emitir(c.x, c.y + c.h * 0.42, { n: 26, colores: ["#a08060", "#6b5440", "#d6c2a0"], vel: [30, 120], ang: [-Math.PI, 0], g: 120, vida: [0.4, 0.9], tam: [2, 4], aditivo: false, area: [c.w * 0.7, 4] });
    }, jefe ? 540 : 320);
  }
  if (jefe) {
    sacudir(16, 700);
    destello("#b91c1c", 0.45, 500);
    anunciar("¡JEFE!", enemigo.titulo ?? enemigo.nombre, "anuncio-jefe");
  }
}

/**
 * Pinta al héroe con su equipo y (opcional) cosméticos.
 * @param {Array<{tipo:string, rareza:number}>} equipados
 * @param {{color?:number|null, sombrero?:number|null, capa?:number|null, aura?:number|null, mascota?:number|null}} [apariencia]
 *        si se omite se conserva la última apariencia
 */
export function actualizarHeroe(equipados, apariencia) {
  E.equipados = Array.isArray(equipados) ? equipados.map((x) => ({ tipo: x?.tipo, rareza: Number(x?.rareza) || 0 })) : [];
  if (apariencia !== undefined) E.apariencia = { ...APARIENCIA_VACIA, ...(apariencia ?? {}) };
  const s = spriteDe("heroe");
  const vivo = s && !s.classList.contains("muerto");
  if (vivo || !s) pintarHeroe();
  document.querySelectorAll(".heroe-mini").forEach((m) => { m.innerHTML = spriteHeroe(E.equipados, E.apariencia); });
}

/**
 * Vista previa para la tienda: el héroe actual (equipo + apariencia) probándose el cosmético `id`.
 * Funciona aunque no se haya montado la escena.
 * @param {HTMLElement} contenedorEl se vacía y se rellena
 * @param {number|null} id id del catálogo (1-14); null = apariencia actual
 */
export function previsualizarCosmetico(contenedorEl, id) {
  if (!contenedorEl) return;
  const n = id == null ? null : Number(id);
  const ranura = RANURA_COSMETICO[n];
  const html = ranura === "consumible"
    ? spriteCosmetico(n)
    : spriteHeroe(E.equipados, ranura ? { ...E.apariencia, [ranura]: n } : E.apariencia);
  const w = el("div", "preview-cosmetico", html);
  contenedorEl.replaceChildren(w);
}

// ───────────────────────── Anuncios, nivel ─────────────────────────

/**
 * Rótulo grande y breve a pantalla completa (jefe, nivel…).
 * @param {string} titulo @param {string} [sub] @param {string} [clase] clase CSS extra
 * @returns {Promise<void>}
 */
export function anunciar(titulo, sub = "", clase = "") {
  const a = el("div", `anuncio ${clase}`);
  a.setAttribute("role", "status");
  a.append(el("div", "anuncio-rayos"), txt("div", "anuncio-titulo", titulo));
  if (sub) a.append(txt("div", "anuncio-sub", sub));
  document.body.append(a);
  const dur = reducido() ? 1200 : 2100;
  const an = a.animate([
    { opacity: 0, transform: "scale(1.6)" },
    { opacity: 1, transform: "scale(1)", offset: 0.12 },
    { opacity: 1, transform: "scale(1.03)", offset: 0.8 },
    { opacity: 0, transform: "scale(.96)" },
  ], { duration: dur, easing: "ease-out" });
  return an.finished.then(() => a.remove()).catch(() => a.remove());
}

/** Subida de nivel del héroe: rótulo dorado, chispas y fanfarria. @param {number} nivel @returns {Promise<void>} */
export function subidaDeNivel(nivel) {
  sonar("nivel");
  const s = spriteDe("heroe");
  if (s && E.part) {
    const c = centro(s, E.raiz);
    E.part.emitir(c.x, c.y + c.h * 0.4, { n: 60, colores: ["#fff7cc", "#fde047", "#f59e0b"], vel: [40, 160], ang: [-Math.PI * 0.85, -Math.PI * 0.15], g: -40, vida: [0.8, 1.6], tam: [1.5, 3.5], forma: "estrella", area: [c.w * 0.6, 6] });
    s.animate([{ filter: "none" }, { filter: "drop-shadow(0 0 20px #fde047) brightness(1.5)" }, { filter: "none" }], { duration: 1400 });
  }
  const xp = document.getElementById("hero-xp");
  xp?.classList.remove("xp-sube"); void xp?.offsetWidth; xp?.classList.add("xp-sube");
  return anunciar(`¡Nivel ${nivel}!`, "Tu héroe se hace más fuerte", "anuncio-nivel");
}

// ───────────────────────── HUD auxiliar ─────────────────────────

/**
 * Ajusta la barra de vida de un luchador (la parte perdida se vacía con retraso).
 * @param {"heroe"|"enemigo"} quien @param {number} vida @param {number} vidaMax
 */
export function actualizarVida(quien, vida, vidaMax) {
  const f = luchador(quien) ?? document.querySelector(lado(quien) === "heroe" ? "#f-jugador" : "#f-enemigo");
  if (!f) return;
  const pct = vidaMax ? Math.max(0, Math.min(100, (vida / vidaMax) * 100)) : 0;
  const fill = f.querySelector(".hp-fill");
  if (fill) { fill.style.width = `${pct}%`; fill.classList.toggle("baja", pct <= 30); }
  const t = f.querySelector(".hp-text");
  if (t) t.textContent = `${Math.max(0, vida)} / ${vidaMax}`;
}

/**
 * Barra de experiencia (#hero-xp) y nivel (#hero-nivel).
 * @param {{xp:number, xpSiguiente:number, nivel:number}} p xp = experiencia dentro del nivel actual
 */
export function actualizarXP({ xp = 0, xpSiguiente = 100, nivel = 1 } = {}) {
  const bar = document.getElementById("hero-xp");
  if (bar) {
    const pct = xpSiguiente ? Math.max(0, Math.min(100, (xp / xpSiguiente) * 100)) : 100;
    bar.querySelector(".xp-fill")?.style.setProperty("width", `${pct}%`);
    const t = bar.querySelector(".xp-text");
    if (t) t.textContent = `${xp} / ${xpSiguiente} XP`;
    bar.setAttribute("aria-valuenow", String(Math.round(pct)));
  }
  const nv = document.getElementById("hero-nivel");
  if (nv) nv.textContent = `Nv. ${nivel}`;
}

/** Chip de racha (#racha): oculto con 0, en llamas a partir de 3. @param {number} n */
export function actualizarRacha(n) {
  const r = document.getElementById("racha");
  if (!r) return;
  r.hidden = !n;
  r.textContent = `🔥 Racha ${n}`;
  r.classList.toggle("racha-viva", n >= 3);
  if (n && !reducido()) r.animate([{ transform: "scale(1.4)" }, { transform: "scale(1)" }], { duration: 300, easing: "cubic-bezier(.3,1.6,.5,1)" });
}

// ───────────────────────── Cartas del inventario ─────────────────────────

/**
 * Convierte una carta `.item` (la que genera main.js) en carta de colección: ilustración SVG por tipo/rareza
 * y contador de poder (ataque + defensa). Idempotente. Si no se pasa `item`, lo deduce del contenido.
 * @param {HTMLElement} cartaEl @param {{tipo:string, rareza:number, ataque:number, defensa:number}} [item]
 */
export function decorarCarta(cartaEl, item) {
  if (!cartaEl || cartaEl.dataset.deco === "1") return;
  cartaEl.dataset.deco = "1";
  const num = (sel) => Number((cartaEl.querySelector(sel)?.textContent.match(/\d+/) ?? [0])[0]);
  const rareza = item ? Number(item.rareza) : Number((cartaEl.className.match(/rar-(\d)/) ?? [0, 0])[1]);
  const tipo = item?.tipo ?? (cartaEl.querySelector(".item-meta")?.textContent.split("·")[1] ?? "").trim();
  const poder = item ? Number(item.ataque) + Number(item.defensa) : num(".st-atk") + num(".st-def");
  const emo = cartaEl.querySelector(".item-emoji");
  const arte = el("div", "item-arte", iconoObjeto(tipo, rareza));
  if (emo) emo.replaceWith(arte); else cartaEl.prepend(arte);
  const top = cartaEl.querySelector(".item-top");
  if (top && arte.parentElement === top) top.after(arte);
  cartaEl.append(Object.assign(txt("span", "item-poder", `⚡ ${poder}`), { title: `Poder: ${poder} (ataque + defensa)` }));
  if (rareza >= 2) cartaEl.classList.add("holo");
  // Datos para filtrar/ordenar (#inv-filtros)
  cartaEl.dataset.rareza = String(rareza);
  cartaEl.dataset.tipo = tipo;
  cartaEl.dataset.poder = String(poder);
  cartaEl.dataset.nombre = item?.nombre ?? cartaEl.querySelector(".item-nombre")?.textContent ?? "";
  cartaEl.dataset.token = String(item?.tokenId ?? (cartaEl.querySelector(".item-id")?.textContent.match(/\d+/) ?? [""])[0]);
}

/**
 * Aplica los filtros/orden de #inv-filtros (#inv-filtro-rareza, #inv-filtro-tipo, #inv-orden) a las cartas de #inventario.
 * Se reaplica solo cuando main.js repinta el inventario. Muestra «N de M» en #inv-cuenta.
 */
export function aplicarFiltrosInventario() {
  const inv = document.getElementById("inventario");
  if (!inv) return;
  const fr = document.getElementById("inv-filtro-rareza")?.value ?? "";
  const ft = document.getElementById("inv-filtro-tipo")?.value ?? "";
  const orden = document.getElementById("inv-orden")?.value ?? "reciente";
  const cartas = [...inv.querySelectorAll(":scope > .item")];
  cartas.forEach((c) => decorarCarta(c));
  let visibles = 0;
  for (const c of cartas) {
    const ok = (!fr || c.dataset.rareza === fr) && (!ft || c.dataset.tipo === ft);
    c.hidden = !ok;
    if (ok) visibles++;
  }
  const n = (c, k) => Number(c.dataset[k]) || 0;
  const cmp = {
    reciente: (a, b) => n(b, "token") - n(a, "token"),
    poder: (a, b) => n(b, "poder") - n(a, "poder") || n(b, "rareza") - n(a, "rareza"),
    rareza: (a, b) => n(b, "rareza") - n(a, "rareza") || n(b, "poder") - n(a, "poder"),
    nombre: (a, b) => (a.dataset.nombre ?? "").localeCompare(b.dataset.nombre ?? "", "es"),
  }[orden] ?? (() => 0);
  const ordenadas = [...cartas].sort(cmp);
  if (ordenadas.some((c, i) => c !== cartas[i])) {
    E.reordenando = true;
    const resto = [...inv.children].filter((x) => !x.matches(".item"));
    inv.append(...ordenadas, ...resto);
    queueMicrotask(() => { E.reordenando = false; });
  }
  const cuenta = document.getElementById("inv-cuenta");
  if (cuenta) cuenta.textContent = cartas.length ? (visibles === cartas.length ? `${cartas.length} objetos` : `${visibles} de ${cartas.length}`) : "";
}

function conectarFiltrosInventario() {
  const inv = document.getElementById("inventario");
  if (!inv) return;
  for (const id of ["inv-filtro-rareza", "inv-filtro-tipo", "inv-orden"]) {
    const s = document.getElementById(id);
    if (!s) continue;
    try { const v = localStorage.getItem(`lootarena:${id}`); if (v != null && [...s.options].some((o) => o.value === v)) s.value = v; } catch { /* sin storage */ }
    s.addEventListener("change", () => { try { localStorage.setItem(`lootarena:${id}`, s.value); } catch { /* */ } aplicarFiltrosInventario(); });
  }
  new MutationObserver(() => { if (!E.reordenando) aplicarFiltrosInventario(); }).observe(inv, { childList: true });
  aplicarFiltrosInventario();
}

/** Muestra la última línea de la crónica (#log) en el resumen plegado (.cronica-ultima). */
function conectarCronica() {
  const log = document.getElementById("log");
  const ult = document.querySelector(".cronica-ultima");
  if (!log || !ult) return;
  const pintar = () => { ult.textContent = log.lastElementChild?.textContent ?? ""; };
  new MutationObserver(pintar).observe(log, { childList: true });
  pintar();
}

function vigilarCartas() {
  const decorarEn = (raiz) => {
    if (raiz.matches?.(".item")) decorarCarta(raiz);
    raiz.querySelectorAll?.(".item:not([data-deco])").forEach((c) => decorarCarta(c));
  };
  decorarEn(document.body);
  new MutationObserver((ms) => { for (const m of ms) m.addedNodes.forEach((n) => n.nodeType === 1 && decorarEn(n)); })
    .observe(document.body, { childList: true, subtree: true });
  // Efecto holográfico que sigue al puntero en Legendarios
  document.addEventListener("pointermove", (ev) => {
    const c = ev.target.closest?.(".item.holo");
    if (!c) return;
    const r = c.getBoundingClientRect();
    const x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
    c.style.setProperty("--mx", `${x * 100}%`); c.style.setProperty("--my", `${y * 100}%`);
    c.style.setProperty("--rx", `${(0.5 - y) * 12}deg`); c.style.setProperty("--ry", `${(x - 0.5) * 14}deg`);
  }, { passive: true });
  document.addEventListener("pointerout", (ev) => {
    const c = ev.target.closest?.(".item.holo");
    if (c && !c.contains(ev.relatedTarget)) { c.style.removeProperty("--rx"); c.style.removeProperty("--ry"); }
  });
}

// ───────────────────────── Revelado del botín ─────────────────────────

function cartaBotin(item) {
  const r = Math.max(0, Math.min(2, Number(item.rareza) || 0));
  const c = el("div", `carta-botin rar-${r}`);
  c.style.setProperty("--rar", PALETA_RAREZA[r].color);
  const frente = el("div", "cb-cara cb-frente");
  frente.append(
    txt("div", "cb-rareza", NOMBRE_RAREZA[r]),
    el("div", "cb-arte", iconoObjeto(item.tipo, r)),
    txt("div", "cb-nombre", item.nombre || "(sin nombre)"),
    txt("div", "cb-tipo", item.tipo ?? ""),
  );
  const st = el("div", "cb-stats");
  if (Number(item.ataque)) st.append(txt("span", "st st-atk", `+${item.ataque} ATQ`));
  if (Number(item.defensa)) st.append(txt("span", "st st-def", `+${item.defensa} DEF`));
  st.append(txt("span", "cb-poder", `⚡ ${Number(item.ataque || 0) + Number(item.defensa || 0)}`));
  frente.append(st);
  const dorso = el("div", "cb-cara cb-dorso", `<span>⚔</span>`);
  c.append(dorso, frente);
  return c;
}

/**
 * Revelado del botín con hype: el cofre cae, tiembla cada vez más mientras se escapa luz por las rendijas
 * (1,5–2,2 s de suspense), explota, la carta gira y, si es Legendario, pantalla completa con rayos, confeti y
 * fanfarria. Botón «¡Otra vez!» (y «Recoger»). Al cerrar, la carta vuela al inventario.
 * @param {{nombre:string, tipo:string, rareza:number, ataque:number, defensa:number}|null} item null = cofre vacío
 * @returns {Promise<"otra"|"cerrar">} "otra" si el jugador pulsó «¡Otra vez!» (main.js puede llamar a explorar())
 */
export function revelarBotin(item) {
  return new Promise((resolver) => {
    const r = item ? Math.max(0, Math.min(2, Number(item.rareza) || 0)) : -1;
    const red = reducido();
    const ov = el("div", `botin-overlay${r >= 0 ? ` rar-${r}` : " vacio"}`);
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-modal", "true");
    ov.setAttribute("aria-label", "Botín");
    const lienzo = el("canvas", "botin-canvas");
    const rayos = el("div", "botin-rayos");
    const haz = el("div", "botin-haz");
    const cofre = el("div", "botin-cofre", spriteCofre());
    const texto = el("div", "botin-texto");
    texto.setAttribute("aria-live", "polite");
    const acciones = el("div", "botin-acciones");
    ov.append(rayos, haz, lienzo, cofre, texto, acciones);
    if (r >= 0) ov.style.setProperty("--rar", PALETA_RAREZA[r].color);
    document.body.append(ov);
    const part = new Particulas(lienzo);
    const W = () => lienzo.getBoundingClientRect();
    const tapa = cofre.querySelector(".cofre-tapa");
    const luz = cofre.querySelector(".cofre-luz");
    let cerrado = false;
    let carta = null;

    const cerrar = async (valor) => {
      if (cerrado) return;
      cerrado = true;
      document.removeEventListener("keydown", tecla);
      sonar("click");
      const inv = document.getElementById("inventario");
      if (carta && inv && inv.offsetParent && !red) {
        const a = carta.getBoundingClientRect(), b = inv.getBoundingClientRect();
        const dx = b.left + Math.min(b.width, 200) / 2 - (a.left + a.width / 2);
        const dy = b.top + 60 - (a.top + a.height / 2);
        await carta.animate([{ transform: "none" }, { transform: `translate(${dx}px, ${dy}px) scale(.25) rotate(12deg)`, opacity: 0.2 }],
          { duration: 650, easing: "cubic-bezier(.5,0,.7,.4)", fill: "forwards" }).finished.catch(() => {});
        inv.animate([{ boxShadow: `0 0 0 0 ${PALETA_RAREZA[r]?.color ?? "#fff"}` }, { boxShadow: `0 0 30px 6px ${PALETA_RAREZA[r]?.color ?? "#fff"}` }, { boxShadow: "none" }], { duration: 800 });
      }
      await ov.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, fill: "forwards" }).finished.catch(() => {});
      ov.remove();
      resolver(valor);
    };
    const tecla = (ev) => { if (ev.key === "Escape") cerrar("cerrar"); };
    document.addEventListener("keydown", tecla);

    (async () => {
      ov.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250 });
      cofre.animate([{ transform: "translateY(-120vh) rotate(-8deg)" }, { transform: "translateY(0) scale(1.08, .9)", offset: 0.75 }, { transform: "none" }],
        { duration: red ? 1 : 650, easing: "cubic-bezier(.5,0,.6,1.2)" });
      await esperar(red ? 50 : 650);
      sonar("golpe");
      const cr = cofre.getBoundingClientRect(), base = W();
      const cx = cr.left - base.left + cr.width / 2, cy = cr.top - base.top + cr.height * 0.55;
      part.emitir(cx, cr.top - base.top + cr.height * 0.92, { n: 30, colores: ["#a08060", "#6b5440"], vel: [40, 160], ang: [-Math.PI, 0], g: 200, vida: [0.4, 0.8], tam: [2, 4], aditivo: false, area: [cr.width * 0.8, 4] });

      // Suspense: temblor creciente + luz por las rendijas + tic-tac acelerando
      const suspense = red ? 300 : r === 2 ? 2300 : r === 1 ? 1800 : 1400;
      sonar("cofre");
      if (!red) {
        const kf = [];
        for (let i = 0; i <= 24; i++) {
          const k = (i / 24) ** 2;
          kf.push({ transform: i === 24 ? "none" : `translate(${azar(-1, 1) * 12 * k}px, ${azar(-1, 1) * 5 * k}px) rotate(${azar(-1, 1) * 7 * k}deg)` });
        }
        cofre.animate(kf, { duration: suspense, easing: "linear" });
        tapa.animate([{ transform: "none" }, { transform: "translateY(-3px)", offset: 0.6 }, { transform: "translateY(-7px)" }], { duration: suspense, fill: "forwards" });
        luz.animate([{ opacity: 0 }, { opacity: 0.4, offset: 0.5 }, { opacity: 1 }], { duration: suspense, fill: "forwards" });
        cofre.classList.add("brillando");
        let t = 0, paso = 330;
        while (t < suspense - 120) { setTimeout(() => sonar("click"), t); t += paso; paso = Math.max(70, paso * 0.8); }
        const goteo = setInterval(() => part.emitir(cx, cy - cr.height * 0.12, { n: 3, colores: COLORES_RAREZA[Math.max(0, r)], vel: [30, 90], ang: [-Math.PI * 0.8, -Math.PI * 0.2], g: -30, vida: [0.4, 0.8], tam: [1.5, 2.5], forma: "estrella", area: [cr.width * 0.6, 2] }), 90);
        await esperar(suspense);
        clearInterval(goteo);
      } else await esperar(suspense);

      // ¡Explosión!
      ov.classList.add("abierto");
      tapa.animate([{ transform: "translateY(-7px)" }, { transform: "translate(0, -70px) rotate(-24deg)", opacity: 1, offset: 0.5 }, { transform: "translate(-20px, -40px) rotate(-38deg)", opacity: 0 }],
        { duration: red ? 1 : 700, easing: "cubic-bezier(.2,.9,.3,1)", fill: "forwards" });
      if (r < 0) {
        sonar("esquiva");
        part.emitir(cx, cy - 20, { n: 40, colores: ["#9ca3af", "#6b7280", "#d6c2a0"], vel: [20, 90], ang: [-Math.PI, 0], g: 40, vida: [0.8, 1.5], tam: [2, 5], aditivo: false });
        texto.append(txt("div", "botin-titulo", "Nada esta vez…"), txt("div", "botin-sub", "El cofre solo tenía polvo y telarañas."));
      } else {
        sonar(r === 2 ? "legendario" : r === 1 ? "raro" : "victoria");
        const fl = el("div", "botin-flash");
        ov.append(fl);
        fl.animate([{ opacity: r === 2 ? 1 : 0.7 }, { opacity: 0 }], { duration: r === 2 ? 900 : 450, easing: "ease-out", fill: "forwards" });
        if (!red) sacudir(r === 2 ? 22 : r === 1 ? 10 : 5, r === 2 ? 900 : 400, ov);
        part.emitir(cx, cy - 10, { n: r === 2 ? 160 : r === 1 ? 80 : 40, colores: COLORES_RAREZA[r], vel: [140, r === 2 ? 620 : 420], g: 260, vida: [0.6, 1.4], tam: [2, 4.5], forma: "chispa" });
        part.emitir(cx, cy - 10, { n: r === 2 ? 60 : 24, colores: COLORES_RAREZA[r], vel: [30, 120], g: -40, vida: [1, 2], tam: [2, 4], forma: "estrella" });
        if (r === 2) {
          ov.classList.add("legendario");
          const confeti = () => { const b = W(); part.emitir(b.width / 2, -10, { n: 120, colores: ["#fde047", "#f59e0b", "#ef4444", "#3b82f6", "#22c55e", "#ffffff", "#a855f7"], vel: [40, 200], ang: [Math.PI * 0.15, Math.PI * 0.85], g: 160, vida: [2, 3.6], tam: [3, 6], forma: "rect", aditivo: false, area: [b.width, 10], arrastre: 0.99 }); };
          confeti(); setTimeout(confeti, 700); setTimeout(confeti, 1500);
          const gran = txt("div", "botin-legendario", "¡LEGENDARIO!");
          ov.append(gran);
          gran.animate([{ transform: "translate(-50%, -50%) scale(1.8)", opacity: 0, letterSpacing: ".3em" }, { transform: "translate(-50%, -50%) scale(1)", opacity: 1, letterSpacing: ".08em", offset: 0.5 }, { transform: "translate(-50%, -50%) scale(1.05)", opacity: 1 }],
            { duration: red ? 1 : 900, easing: "cubic-bezier(.2,.9,.3,1)", fill: "forwards" });
          await esperar(red ? 200 : 1300);
          gran.animate([{ opacity: 1 }, { opacity: 0, transform: "translate(-50%, -160%) scale(.7)" }], { duration: 400, fill: "forwards" });
        }
        // La carta sale del cofre y gira
        carta = cartaBotin(item);
        ov.append(carta);
        await carta.animate([
          { transform: "translate(-50%, 10%) scale(.2) rotateY(540deg)", opacity: 0 },
          { transform: "translate(-50%, -62%) scale(1.15) rotateY(120deg)", opacity: 1, offset: 0.6 },
          { transform: "translate(-50%, -58%) scale(1) rotateY(0deg)", opacity: 1 },
        ], { duration: red ? 1 : 1100, easing: "cubic-bezier(.2,.8,.3,1)", fill: "forwards" }).finished.catch(() => {});
        carta.classList.add("asentada");
        texto.append(txt("div", "botin-titulo", r === 2 ? "¡Objeto legendario!" : r === 1 ? "¡Objeto raro!" : "¡Botín!"),
          txt("div", "botin-sub", `${item.nombre} · ${item.tipo}`));
      }
      const otra = txt("button", "btn btn-gold btn-grande", "⚔️ ¡Otra vez!");
      otra.type = "button";
      otra.addEventListener("click", () => cerrar("otra"));
      const recoger = txt("button", "btn btn-ghost", r >= 0 ? "Recoger" : "Cerrar");
      recoger.type = "button";
      recoger.addEventListener("click", () => cerrar("cerrar"));
      acciones.append(otra, recoger);
      acciones.animate([{ opacity: 0, transform: "translateY(20px)" }, { opacity: 1, transform: "none" }], { duration: 300 });
      otra.focus();
    })();
  });
}

// ───────────────────────── Pantallas (portada y resultado) ─────────────────────────

/** Muestra la portada (#pantalla-portada). */
export function mostrarPortada() {
  const p = document.getElementById("pantalla-portada");
  if (!p) return;
  p.hidden = false;
  p.classList.remove("saliendo");
  p.querySelector("#btn-entrar")?.focus();
}

/** Oculta la portada con animación. @returns {Promise<void>} */
export async function ocultarPortada() {
  const p = document.getElementById("pantalla-portada");
  if (!p || p.hidden) return;
  try { sessionStorage.setItem("lootarena:portada", "1"); } catch { /* sin storage */ }
  p.classList.add("saliendo");
  await esperar(reducido() ? 0 : 650);
  p.hidden = true;
  E.part?.ajustar();
}

/**
 * Pantalla de victoria/derrota a pantalla completa (#pantalla-resultado) con resumen y contadores animados.
 * @param {{tipo:"victoria"|"derrota"|"huida", enemigo?:string, danoHecho?:number, danoRecibido?:number,
 *          criticos?:number, turnos?:number, xp?:number, racha?:number, oro?:number}} resumen
 * @returns {Promise<"otra"|"continuar">} "otra" = «¡Otra vez!» (explorar de nuevo)
 */
export function mostrarResultado(resumen = {}) {
  const p = document.getElementById("pantalla-resultado");
  if (!p) return Promise.resolve("continuar");
  const tipo = resumen.tipo ?? "victoria";
  const titulos = { victoria: ["¡VICTORIA!", "El público ruge tu nombre"], derrota: ["DERROTA", "Levántate, guerrero. La arena te espera."], huida: ["HUIDA", "Vivirás para luchar otro día"] };
  const [titulo, sub] = titulos[tipo] ?? titulos.victoria;
  p.className = `pantalla pantalla-resultado res-${tipo}`;
  const caja = el("div", "resultado-caja");
  caja.append(el("div", "resultado-rayos"), txt("h2", "resultado-titulo", titulo), txt("p", "resultado-sub", resumen.enemigo ? `${sub} · ${resumen.enemigo}` : sub));
  const filas = [
    ["⚔️", "Daño hecho", resumen.danoHecho], ["💥", "Críticos", resumen.criticos], ["🩸", "Daño recibido", resumen.danoRecibido],
    ["⏱️", "Turnos", resumen.turnos], ["✨", "XP ganada", resumen.xp], ["🔥", "Racha", resumen.racha], ["🪙", "ORO", resumen.oro],
  ].filter(([, , v]) => v != null);
  const grid = el("dl", "resultado-stats");
  const contadores = [];
  for (const [ico, nombre, v] of filas) {
    const d = el("div", "resultado-stat");
    const dd = txt("dd", "", reducido() ? String(v) : "0");
    d.append(txt("dt", "", `${ico} ${nombre}`), dd);
    grid.append(d);
    contadores.push([dd, Number(v) || 0]);
  }
  const acc = el("div", "resultado-acciones");
  const otra = txt("button", "btn btn-gold btn-grande", tipo === "derrota" ? "⚔️ Volver a intentarlo" : "⚔️ ¡Otra vez!");
  const seguir = txt("button", "btn btn-ghost", "Continuar");
  otra.type = seguir.type = "button";
  acc.append(otra, seguir);
  caja.append(grid, acc);
  p.replaceChildren(caja);
  p.hidden = false;
  sonar(tipo === "victoria" ? "victoria" : "derrota");
  if (!reducido()) {
    caja.animate([{ transform: "scale(.7)", opacity: 0 }, { transform: "scale(1.04)", opacity: 1, offset: 0.7 }, { transform: "none" }], { duration: 500, easing: "ease-out" });
    const t0 = performance.now();
    const contar = (t) => {
      const k = Math.min(1, (t - t0 - 350) / 900);
      for (const [dd, v] of contadores) dd.textContent = String(Math.max(0, Math.round(v * (1 - (1 - Math.max(0, k)) ** 3))));
      if (k < 1) requestAnimationFrame(contar);
    };
    requestAnimationFrame(contar);
  }
  otra.focus();
  return new Promise((res) => {
    const fin = (v) => { p.hidden = true; document.removeEventListener("keydown", esc); res(v); };
    const esc = (ev) => { if (ev.key === "Escape") fin("continuar"); };
    otra.addEventListener("click", () => fin("otra"), { once: true });
    seguir.addEventListener("click", () => fin("continuar"), { once: true });
    document.addEventListener("keydown", esc);
  });
}

// ───────────────────────── Arranque ─────────────────────────

/** Pestañas accesibles: cualquier [role=tablist] con botones [role=tab][aria-controls]. Flechas para moverse. */
function conectarPestanas() {
  document.querySelectorAll('[role="tablist"]').forEach((lista) => {
    const tabs = [...lista.querySelectorAll('[role="tab"]')];
    const activar = (t, foco = false) => {
      for (const x of tabs) {
        const on = x === t;
        x.setAttribute("aria-selected", String(on));
        x.tabIndex = on ? 0 : -1;
        const panel = document.getElementById(x.getAttribute("aria-controls"));
        if (panel) panel.hidden = !on;
      }
      if (foco) t.focus();
    };
    tabs.forEach((t, i) => {
      t.addEventListener("click", () => activar(t));
      t.addEventListener("keydown", (ev) => {
        const d = ev.key === "ArrowRight" ? 1 : ev.key === "ArrowLeft" ? -1 : 0;
        if (d) { ev.preventDefault(); activar(tabs[(i + d + tabs.length) % tabs.length], true); }
      });
    });
    activar(tabs.find((t) => t.getAttribute("aria-selected") === "true") ?? tabs[0]);
  });
}

/**
 * Inicializa toda la capa visual de index.html (idempotente; index.html ya la llama):
 * escena en #escena, botón #btn-sonido, portada (#pantalla-portada / #btn-entrar), cartas de inventario
 * y animación de la cabecera. Seguro de llamar aunque falten elementos.
 * @param {{auto?:boolean}} [opciones] se pasa a montarEscena
 */
export function iniciarInterfaz(opciones = {}) {
  const escena = document.getElementById("escena");
  if (escena) montarEscena(escena, opciones);
  if (E.iniciada) return;
  E.iniciada = true;
  conectarBotonSonido(document.getElementById("btn-sonido"));
  vigilarCartas();
  conectarPestanas();
  conectarFiltrosInventario();
  conectarCronica();
  document.querySelectorAll(".heroe-mini").forEach((m) => { m.innerHTML = spriteHeroe(E.equipados, E.apariencia); });
  const portada = document.getElementById("pantalla-portada");
  if (portada) {
    const decorado = portada.querySelector(".portada-duelo");
    if (decorado && !decorado.childElementCount) {
      decorado.append(el("div", "portada-sprite p-heroe", spriteHeroe([{ tipo: "Espada", rareza: 2 }, { tipo: "Escudo", rareza: 1 }, { tipo: "Casco", rareza: 0 }], { capa: 8 })),
        el("div", "portada-sprite p-dragon", spriteEnemigo("dragon")));
    }
    let vista = false;
    try { vista = sessionStorage.getItem("lootarena:portada") === "1"; } catch { /* sin storage */ }
    if (vista) portada.hidden = true;
    portada.querySelector("#btn-entrar")?.addEventListener("click", () => { desbloquear(); sonar("aparicion"); ocultarPortada(); });
  }
}

// ───────────────────────── Enganche (1.2): logros, recompensas, pase, racha de días ─────────────────────────

let capa = null;
/** Capa de partículas a pantalla completa (por encima de todo, sin capturar clics). */
function capaGlobal() {
  if (capa?.c.isConnected) return capa;
  const c = el("canvas", "fx-global");
  c.setAttribute("aria-hidden", "true");
  document.body.append(c);
  capa = new Particulas(c);
  addEventListener("resize", () => capa?.ajustar());
  return capa;
}

let colaLogros = Promise.resolve();

/**
 * Toast grande de logro desbloqueado con medalla, brillo, estrellas y sonido. Se encolan si llegan varios.
 * Clic para cerrarlo antes.
 * @param {{nombre:string, descripcion?:string, icono?:string, titulo?:string, rareza?:number}} logro
 *        titulo = título que desbloquea (se muestra «Nuevo título»); rareza 0..2 colorea la medalla (por defecto 2, oro)
 * @returns {Promise<void>} cuando desaparece
 */
export function celebrarLogro(logro = {}) {
  colaLogros = colaLogros.then(() => new Promise((fin) => {
    const r = Math.max(0, Math.min(2, Number(logro.rareza ?? 2) || 0));
    const t = el("div", `logro-toast logro-r${r}`);
    t.setAttribute("role", "status");
    t.setAttribute("aria-live", "assertive");
    const med = el("div", "logro-medalla", spriteMedalla(logro.icono ?? "🏅", r));
    const cuerpo = el("div", "logro-cuerpo");
    cuerpo.append(txt("div", "logro-pre", "¡Logro desbloqueado!"), txt("div", "logro-nombre", logro.nombre ?? "Logro"));
    if (logro.descripcion) cuerpo.append(txt("div", "logro-desc", logro.descripcion));
    if (logro.titulo) cuerpo.append(txt("div", "logro-titulo", `Nuevo título: «${logro.titulo}»`));
    t.append(med, cuerpo);
    document.body.append(t);
    sonar("logro");
    const red = reducido();
    t.animate([{ transform: "translate(-50%, -140%)", opacity: 0 }, { transform: "translate(-50%, 8px)", opacity: 1, offset: 0.7 }, { transform: "translate(-50%, 0)", opacity: 1 }],
      { duration: red ? 1 : 520, easing: "cubic-bezier(.2,.9,.3,1.2)", fill: "forwards" });
    setTimeout(() => {
      const m = med.getBoundingClientRect();
      capaGlobal().emitir(m.left + m.width / 2, m.top + m.height / 2, { n: 40, colores: COLORES_RAREZA[r], vel: [80, 260], g: 220, vida: [0.5, 1.1], tam: [2, 3.5], forma: "estrella" });
      med.animate([{ transform: "scale(.3) rotate(-40deg)" }, { transform: "scale(1.25) rotate(8deg)", offset: 0.6 }, { transform: "none" }], { duration: red ? 1 : 600, easing: "ease-out" });
    }, red ? 0 : 280);
    let cerrado = false;
    const cerrar = () => {
      if (cerrado) return;
      cerrado = true;
      t.animate([{ opacity: 1, transform: "translate(-50%, 0)" }, { opacity: 0, transform: "translate(-50%, -40px)" }], { duration: 300, fill: "forwards" })
        .finished.catch(() => {}).finally(() => { t.remove(); fin(); });
    };
    t.addEventListener("click", cerrar);
    setTimeout(cerrar, 4200);
  }));
  return colaLogros;
}

/**
 * Recompensa: lluvia de monedas, «+N ORO» con contador y (opcional) el cosmético ganado; al final unas monedas
 * vuelan al saldo de la cabecera (#saldo-oro), que late.
 * @param {{oro?:number, cosmetico?:number|{id:number, nombre?:string}|null, texto?:string}} r texto = subtítulo opcional
 * @returns {Promise<void>}
 */
export function celebrarRecompensa({ oro = 0, cosmetico = null, texto = "" } = {}) {
  const red = reducido();
  const p = capaGlobal();
  const cos = cosmetico == null ? null : typeof cosmetico === "object" ? cosmetico : { id: Number(cosmetico) };
  sonar("monedas");
  if (cos) setTimeout(() => sonar("raro"), 500);
  const w = innerWidth;
  if (oro > 0) {
    const n = Math.min(90, 20 + Math.round(oro / 2));
    p.emitir(w / 2, -20, { n, colores: ["#f59e0b"], vel: [20, 120], ang: [Math.PI * 0.2, Math.PI * 0.8], g: 620, vida: [1.4, 2.2], tam: [5, 8], forma: "moneda", aditivo: false, area: [w * 0.9, 20], arrastre: 0.995 });
  }
  const pop = el("div", "recompensa-pop");
  pop.setAttribute("role", "status");
  if (oro > 0) {
    const cifra = el("div", "recompensa-oro");
    const num = txt("span", "", red ? `+${oro}` : "+0");
    cifra.append(el("span", "moneda-ico"), num);
    pop.append(cifra, txt("div", "recompensa-sub", texto || "ORO"));
    if (!red) {
      const t0 = performance.now();
      const contar = (t) => { const k = Math.min(1, (t - t0) / 900); num.textContent = `+${Math.round(oro * (1 - (1 - k) ** 3))}`; if (k < 1) requestAnimationFrame(contar); };
      requestAnimationFrame(contar);
    }
  } else if (texto) pop.append(txt("div", "recompensa-sub", texto));
  if (cos) {
    const carta = el("div", "recompensa-cos", spriteCosmetico(cos.id) || spriteMedalla("🎁", 2));
    carta.append(txt("div", "recompensa-cos-nombre", cos.nombre ?? `Cosmético #${cos.id}`));
    pop.append(carta);
  }
  document.body.append(pop);
  pop.animate([{ transform: "translate(-50%, -50%) scale(.4)", opacity: 0 }, { transform: "translate(-50%, -50%) scale(1.1)", opacity: 1, offset: 0.6 }, { transform: "translate(-50%, -50%) scale(1)", opacity: 1 }],
    { duration: red ? 1 : 450, easing: "cubic-bezier(.2,.9,.3,1.3)", fill: "forwards" });
  return esperar(red ? 1200 : 1900).then(async () => {
    const saldo = document.getElementById("saldo-oro");
    const destino = saldo?.offsetParent && saldo.childElementCount ? saldo.getBoundingClientRect() : null;
    if (destino && oro > 0 && !red) {
      const a = pop.getBoundingClientRect();
      const vuelos = [];
      for (let i = 0; i < 8; i++) {
        const m = el("span", "moneda-vuela");
        m.style.left = `${a.left + a.width / 2}px`; m.style.top = `${a.top + a.height / 2}px`;
        document.body.append(m);
        const dx = destino.left + destino.width / 2 - (a.left + a.width / 2), dy = destino.top + destino.height / 2 - (a.top + a.height / 2);
        vuelos.push(m.animate([{ transform: "translate(0,0) scale(1)" }, { transform: `translate(${dx * 0.5 + azar(-60, 60)}px, ${dy * 0.5 - 60}px) scale(1.2)`, offset: 0.5 }, { transform: `translate(${dx}px, ${dy}px) scale(.5)`, opacity: 0.6 }],
          { duration: 700, delay: i * 60, easing: "cubic-bezier(.5,0,.6,1)", fill: "forwards" }).finished.catch(() => {}).finally(() => m.remove()));
      }
      pop.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: "forwards" });
      await Promise.all(vuelos);
      saldo.animate([{ transform: "scale(1)" }, { transform: "scale(1.25)", filter: "drop-shadow(0 0 10px #fbbf24)" }, { transform: "scale(1)" }], { duration: 400 });
    } else {
      await pop.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: "forwards" }).finished.catch(() => {});
    }
    pop.remove();
  });
}

/**
 * Subida de nivel del pase de temporada: rótulo morado, estrellas y sonido; hace latir #pase si existe.
 * @param {number} nivel 1..30 @param {{recompensa?:string}} [o] texto de lo que da ese nivel
 * @returns {Promise<void>}
 */
export function subirNivelPase(nivel, { recompensa = "" } = {}) {
  sonar("pase");
  capaGlobal().emitir(innerWidth / 2, innerHeight / 2, { n: 70, colores: ["#e9d5ff", "#c084fc", "#a855f7", "#fde047"], vel: [120, 420], g: 160, vida: [0.6, 1.4], tam: [2, 4], forma: "estrella" });
  const pase = document.getElementById("pase");
  pase?.animate([{ boxShadow: "0 0 0 0 rgba(192,132,252,.9)" }, { boxShadow: "0 0 0 14px rgba(192,132,252,0)" }], { duration: 900, iterations: 2 });
  return anunciar(`Pase · Nivel ${nivel}`, recompensa || "¡Sigue así, campeón!", "anuncio-pase");
}

/**
 * Racha de días (recompensa diaria): una llama por día, encendidas hasta `dias`; la de hoy prende con animación.
 * Con `contenedorEl` la pinta dentro (p. ej. en #diario); con null la muestra como celebración breve a pantalla completa.
 * @param {HTMLElement|null} contenedorEl
 * @param {number} dias racha actual (0..max)
 * @param {{max?:number, animar?:boolean, premios?:Record<number,string>}} [o] premios: texto bajo cada día (p. ej. {7:"🎁"})
 * @returns {Promise<HTMLElement>} el widget creado
 */
export function mostrarRachaDias(contenedorEl, dias, { max = 7, animar = true, premios = { 7: "🎁" } } = {}) {
  const d = Math.max(0, Math.min(max, Number(dias) || 0));
  const w = el("div", "racha-dias");
  w.setAttribute("role", "img");
  w.setAttribute("aria-label", `Racha de ${d} día${d === 1 ? "" : "s"} de ${max}`);
  for (let i = 1; i <= max; i++) {
    const dia = el("div", `rd-dia${i <= d ? " encendido" : ""}${i === d ? " rd-hoy" : ""}${i === max ? " rd-final" : ""}`, spriteLlama(i <= d));
    dia.append(txt("span", "rd-num", premios[i] ?? `D${i}`));
    w.append(dia);
  }
  const red = reducido();
  const hoy = w.querySelector(".rd-hoy");
  const prender = () => {
    if (!hoy || !animar || red) return;
    hoy.animate([{ transform: "scale(.2)", filter: "brightness(3)" }, { transform: "scale(1.35)", filter: "brightness(1.6)", offset: 0.6 }, { transform: "none", filter: "none" }], { duration: 700, easing: "cubic-bezier(.2,.9,.3,1.3)" });
    const r = hoy.getBoundingClientRect();
    capaGlobal().emitir(r.left + r.width / 2, r.top + r.height / 2, { n: 26, colores: ["#fde047", "#fb923c", "#ef4444"], vel: [30, 140], ang: [-Math.PI, 0], g: -60, vida: [0.4, 0.9], tam: [1.5, 3] });
  };
  if (contenedorEl) {
    contenedorEl.replaceChildren(w);
    requestAnimationFrame(prender);
    return esperar(red ? 0 : 700).then(() => w);
  }
  sonar("racha");
  const ov = el("div", "racha-overlay");
  ov.setAttribute("role", "status");
  ov.append(txt("div", "racha-titulo", `🔥 ¡Racha de ${d} día${d === 1 ? "" : "s"}!`), w);
  document.body.append(ov);
  ov.animate([{ opacity: 0, transform: "translate(-50%, -50%) scale(.7)" }, { opacity: 1, transform: "translate(-50%, -50%) scale(1)" }], { duration: red ? 1 : 350, easing: "cubic-bezier(.2,.9,.3,1.2)", fill: "forwards" });
  setTimeout(prender, red ? 0 : 300);
  return esperar(red ? 1500 : 2800).then(async () => {
    await ov.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: "forwards" }).finished.catch(() => {});
    ov.remove();
    return w;
  });
}

/**
 * Indicador «jefe en N» de la arena (#jefe-en). null/undefined lo oculta; 0 = «¡Jefe ahora!».
 * @param {number|null} n combates que faltan para el jefe
 */
export function actualizarJefeEn(n) {
  const c = document.getElementById("jefe-en");
  if (!c) return;
  c.hidden = n == null;
  if (n == null) return;
  c.textContent = n <= 0 ? "👑 ¡Jefe ahora!" : `👑 Jefe en ${n}`;
  c.classList.toggle("jefe-ya", n <= 0);
}
