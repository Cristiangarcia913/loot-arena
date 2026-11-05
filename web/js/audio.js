// Sonido 100 % sintetizado con WebAudio (sin archivos de audio).
// El AudioContext se crea de forma perezosa en el primer sonido o gesto del usuario
// (los navegadores bloquean el audio antes de una interacción).
// Preferencias persistidas en localStorage: "lootarena:silencio" y "lootarena:musica".

const K_SILENCIO = "lootarena:silencio";
const K_MUSICA = "lootarena:musica";

/** Nombres válidos para sonar(). */
export const SONIDOS = Object.freeze([
  "golpe", "critico", "bloqueo", "curacion", "nivel", "victoria", "derrota", "cofre", "legendario",
  "raro", "ataque", "muerte", "esquiva", "estado", "click", "aparicion",
  "logro", "monedas", "pase", "racha", "menu",
]);

const leer = (k, def) => { try { const v = localStorage.getItem(k); return v == null ? def : v === "1"; } catch { return def; } };
const guardar = (k, v) => { try { localStorage.setItem(k, v ? "1" : "0"); } catch { /* modo privado */ } };

let ctx = null;
let master = null;
let mudo = leer(K_SILENCIO, false);
let musicaOn = leer(K_MUSICA, false);
let musica = null; // { nodos, timer }
const botones = new Set();

function asegurarCtx() {
  if (ctx) return ctx;
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 4;
  master = ctx.createGain();
  master.gain.value = mudo ? 0 : 0.55;
  master.connect(comp).connect(ctx.destination);
  return ctx;
}

/** Crea/reanuda el contexto; llamar desde un gesto del usuario (lo hace solo en el primer clic). */
export function desbloquear() {
  const c = asegurarCtx();
  if (c && c.state === "suspended") c.resume().catch(() => {});
  if (musicaOn && !mudo) iniciarMusica();
}

if (typeof document !== "undefined") {
  const una = () => { desbloquear(); document.removeEventListener("pointerdown", una); document.removeEventListener("keydown", una); };
  document.addEventListener("pointerdown", una);
  document.addEventListener("keydown", una);
}

// ── Primitivas ──

/** Oscilador con envolvente. */
function tono({ tipo = "sine", f0 = 440, f1 = null, t = 0, dur = 0.2, vol = 0.3, ataque = 0.005, filtro = null, destino = master }) {
  const t0 = ctx.currentTime + t;
  const o = ctx.createOscillator();
  const gn = ctx.createGain();
  o.type = tipo;
  o.frequency.setValueAtTime(f0, t0);
  if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
  gn.gain.setValueAtTime(0.0001, t0);
  gn.gain.exponentialRampToValueAtTime(vol, t0 + ataque);
  gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  let nodo = o;
  if (filtro) {
    const bq = ctx.createBiquadFilter();
    bq.type = filtro.tipo ?? "lowpass"; bq.frequency.value = filtro.f ?? 1200; bq.Q.value = filtro.q ?? 1;
    nodo.connect(bq); nodo = bq;
  }
  nodo.connect(gn).connect(destino);
  o.start(t0); o.stop(t0 + dur + 0.05);
}

let bufRuido = null;
/** Ráfaga de ruido filtrado (con barrido opcional f → f1). */
function ruido({ t = 0, dur = 0.2, vol = 0.3, tipo = "lowpass", f = 1500, f1 = null, q = 1 }) {
  if (!bufRuido) {
    bufRuido = ctx.createBuffer(1, ctx.sampleRate * 1, ctx.sampleRate);
    const d = bufRuido.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t0 = ctx.currentTime + t;
  const s = ctx.createBufferSource();
  s.buffer = bufRuido;
  const bq = ctx.createBiquadFilter();
  bq.type = tipo; bq.Q.value = q;
  bq.frequency.setValueAtTime(f, t0);
  if (f1) bq.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  const gn = ctx.createGain();
  gn.gain.setValueAtTime(vol, t0);
  gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  s.connect(bq).connect(gn).connect(master);
  s.start(t0, Math.random() * 0.5); s.stop(t0 + dur + 0.05);
}

const nota = (n) => 440 * 2 ** ((n - 69) / 12); // MIDI → Hz

const RECETAS = {
  golpe() {
    ruido({ dur: 0.14, vol: 0.55, f: 1800, f1: 250 });
    tono({ tipo: "sine", f0: 140, f1: 45, dur: 0.16, vol: 0.6 });
  },
  critico() {
    ruido({ dur: 0.22, vol: 0.7, f: 3000, f1: 200 });
    tono({ tipo: "sine", f0: 110, f1: 35, dur: 0.3, vol: 0.8 });
    tono({ tipo: "square", f0: 1400, f1: 700, dur: 0.12, vol: 0.12, filtro: { f: 3000 } });
    tono({ tipo: "triangle", f0: 2100, dur: 0.35, vol: 0.08, t: 0.03 });
  },
  bloqueo() {
    tono({ tipo: "triangle", f0: 1250, dur: 0.25, vol: 0.22 });
    tono({ tipo: "square", f0: 1690, dur: 0.18, vol: 0.06, filtro: { f: 2500 } });
    ruido({ dur: 0.08, vol: 0.3, tipo: "bandpass", f: 3000, q: 3 });
  },
  curacion() {
    [72, 76, 79, 84].forEach((n, i) => tono({ tipo: "sine", f0: nota(n), t: i * 0.07, dur: 0.45, vol: 0.18 }));
    tono({ tipo: "triangle", f0: nota(96), t: 0.28, dur: 0.5, vol: 0.05 });
  },
  nivel() {
    [67, 72, 76, 79, 84].forEach((n, i) => tono({ tipo: "square", f0: nota(n), t: i * 0.08, dur: 0.22, vol: 0.09, filtro: { f: 2600 } }));
    [84, 88, 91].forEach((n) => tono({ tipo: "triangle", f0: nota(n), t: 0.42, dur: 0.8, vol: 0.12 }));
  },
  victoria() {
    [[67, 0], [72, 0.12], [76, 0.24], [79, 0.36]].forEach(([n, t]) => tono({ tipo: "triangle", f0: nota(n), t, dur: 0.3, vol: 0.22 }));
    [72, 76, 79, 84].forEach((n) => tono({ tipo: "sawtooth", f0: nota(n), t: 0.5, dur: 1.1, vol: 0.05, filtro: { f: 1800 } }));
  },
  derrota() {
    [[64, 0], [60, 0.3], [57, 0.6], [52, 0.9]].forEach(([n, t]) => tono({ tipo: "sawtooth", f0: nota(n), t, dur: 0.5, vol: 0.12, filtro: { f: 900 } }));
    tono({ tipo: "sine", f0: nota(40), t: 0.9, dur: 1.4, vol: 0.25 });
  },
  cofre() {
    tono({ tipo: "sawtooth", f0: 90, f1: 160, dur: 0.5, vol: 0.12, filtro: { f: 700, q: 6 } });
    for (let i = 0; i < 5; i++) ruido({ t: i * 0.09, dur: 0.05, vol: 0.25, tipo: "bandpass", f: 900 + i * 120, q: 4 });
    tono({ tipo: "sine", f0: 60, t: 0.5, dur: 0.25, vol: 0.5 });
  },
  raro() {
    [79, 83, 86, 91].forEach((n, i) => tono({ tipo: "sine", f0: nota(n), t: i * 0.06, dur: 0.6, vol: 0.12 }));
    ruido({ dur: 0.6, vol: 0.06, tipo: "highpass", f: 6000 });
  },
  legendario() {
    ruido({ dur: 1.6, vol: 0.18, tipo: "highpass", f: 5000 });
    tono({ tipo: "sine", f0: 55, f1: 40, dur: 1.2, vol: 0.6 });
    const acordes = [[60, 64, 67], [65, 69, 72], [67, 71, 74], [72, 76, 79, 84]];
    acordes.forEach((ac, i) => ac.forEach((n) =>
      tono({ tipo: "sawtooth", f0: nota(n), t: 0.15 + i * 0.28, dur: i === 3 ? 1.8 : 0.32, vol: 0.07, ataque: 0.03, filtro: { f: 2400 } })));
    [96, 100, 103, 108].forEach((n, i) => tono({ tipo: "triangle", f0: nota(n), t: 1.0 + i * 0.07, dur: 0.9, vol: 0.05 }));
  },
  ataque() { ruido({ dur: 0.18, vol: 0.3, tipo: "bandpass", f: 500, f1: 2600, q: 2 }); },
  esquiva() { ruido({ dur: 0.14, vol: 0.2, tipo: "bandpass", f: 2500, f1: 900, q: 3 }); },
  muerte() {
    ruido({ dur: 0.8, vol: 0.35, f: 2200, f1: 120 });
    tono({ tipo: "sawtooth", f0: 220, f1: 40, dur: 0.8, vol: 0.12, filtro: { f: 800 } });
  },
  estado() { [0, 0.07, 0.14].forEach((t, i) => tono({ tipo: "sine", f0: 300 + i * 140, f1: 200, t, dur: 0.12, vol: 0.12 })); },
  click() { tono({ tipo: "triangle", f0: 900, dur: 0.05, vol: 0.08 }); },
  menu() { tono({ tipo: "sine", f0: 660, f1: 880, dur: 0.07, vol: 0.06 }); },
  logro() {
    [76, 79, 84, 88].forEach((n, i) => tono({ tipo: "triangle", f0: nota(n), t: i * 0.09, dur: 0.5, vol: 0.14 }));
    [84, 88, 91].forEach((n) => tono({ tipo: "sine", f0: nota(n), t: 0.4, dur: 1, vol: 0.08 }));
    ruido({ t: 0.36, dur: 0.7, vol: 0.06, tipo: "highpass", f: 6000 });
  },
  monedas() {
    for (let i = 0; i < 9; i++) {
      const f = 1800 + Math.random() * 1400;
      tono({ tipo: "square", f0: f, t: i * 0.07 + Math.random() * 0.03, dur: 0.09, vol: 0.05, filtro: { tipo: "bandpass", f, q: 4 } });
      tono({ tipo: "sine", f0: f * 1.5, t: i * 0.07 + 0.02, dur: 0.12, vol: 0.04 });
    }
  },
  pase() {
    [67, 71, 74, 79, 83].forEach((n, i) => tono({ tipo: "sine", f0: nota(n), t: i * 0.06, dur: 0.35, vol: 0.12 }));
    [79, 83, 86].forEach((n) => tono({ tipo: "triangle", f0: nota(n), t: 0.32, dur: 0.9, vol: 0.09 }));
  },
  racha() {
    ruido({ dur: 0.5, vol: 0.25, tipo: "bandpass", f: 300, f1: 2400, q: 1.5 });
    tono({ tipo: "sawtooth", f0: 110, f1: 220, dur: 0.5, vol: 0.08, filtro: { f: 900 } });
    tono({ tipo: "triangle", f0: nota(84), t: 0.35, dur: 0.6, vol: 0.1 });
  },
  aparicion() {
    tono({ tipo: "sine", f0: 70, f1: 50, dur: 0.6, vol: 0.4 });
    ruido({ dur: 0.5, vol: 0.12, f: 400, f1: 1600 });
  },
};

/**
 * Reproduce un efecto sintetizado. No hace nada si está silenciado o no hay WebAudio.
 * @param {string} nombre uno de SONIDOS
 */
export function sonar(nombre) {
  if (mudo) return;
  const receta = RECETAS[nombre];
  if (!receta || !asegurarCtx()) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  try { receta(); } catch { /* nunca romper el juego por el audio */ }
}

/** Activa (true) o desactiva (false) el silencio global; se guarda en localStorage. */
export function setSilencio(valor) {
  mudo = !!valor;
  guardar(K_SILENCIO, mudo);
  if (ctx && master) master.gain.setTargetAtTime(mudo ? 0 : 0.55, ctx.currentTime, 0.05);
  if (mudo) pararMusica(); else if (musicaOn && ctx) iniciarMusica();
  for (const b of botones) pintarBoton(b);
}

/** @returns {boolean} si el juego está silenciado */
export function silenciado() { return mudo; }

// ── Música ambiental (dron + notas sueltas en pentatónica menor), muy ligera ──

function iniciarMusica() {
  if (musica || !asegurarCtx() || mudo) return;
  const bus = ctx.createGain();
  bus.gain.value = 0.0001;
  bus.gain.exponentialRampToValueAtTime(0.09, ctx.currentTime + 3);
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 500;
  bus.connect(lp).connect(master);
  const oscs = [nota(45), nota(45) * 1.004, nota(52)].map((f) => {
    const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = f;
    const gn = ctx.createGain(); gn.gain.value = 0.25; o.connect(gn).connect(bus); o.start(); return o;
  });
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
  const lfoG = ctx.createGain(); lfoG.gain.value = 220; lfo.connect(lfoG).connect(lp.frequency); lfo.start();
  const escala = [57, 60, 62, 64, 67, 69, 72];
  const pulsar = () => {
    if (!musica) return;
    const n = escala[Math.floor(Math.random() * escala.length)];
    tono({ tipo: "triangle", f0: nota(n), dur: 1.6, vol: 0.05, ataque: 0.02 });
    musica.timer = setTimeout(pulsar, 1800 + Math.random() * 2600);
  };
  musica = { bus, oscs: [...oscs, lfo], timer: setTimeout(pulsar, 1500) };
}

function pararMusica() {
  if (!musica) return;
  const m = musica; musica = null;
  clearTimeout(m.timer);
  m.bus.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.3);
  setTimeout(() => m.oscs.forEach((o) => { try { o.stop(); } catch { /* ya parado */ } }), 1500);
}

/** Enciende/apaga la música ambiental (desactivada por defecto). Se guarda en localStorage. */
export function setMusica(valor) {
  musicaOn = !!valor;
  guardar(K_MUSICA, musicaOn);
  if (musicaOn) iniciarMusica(); else pararMusica();
}

/** @returns {boolean} si la música ambiental está activada */
export function musicaActiva() { return musicaOn; }

// ── Botón 🔊/🔇 ──

function pintarBoton(b) {
  b.textContent = mudo ? "🔇" : "🔊";
  b.setAttribute("aria-pressed", String(mudo));
  b.setAttribute("aria-label", mudo ? "Activar sonido" : "Silenciar");
  b.title = mudo ? "Activar sonido" : "Silenciar";
}

/**
 * Conecta un botón como interruptor de silencio (idempotente).
 * @param {HTMLButtonElement} boton p. ej. #btn-sonido
 */
export function conectarBotonSonido(boton) {
  if (!boton || botones.has(boton)) return;
  botones.add(boton);
  pintarBoton(boton);
  boton.addEventListener("click", () => { setSilencio(!mudo); if (!mudo) { desbloquear(); sonar("click"); } });
}
