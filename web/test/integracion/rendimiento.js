// Medidas de rendimiento sobre la página real: tiempo hasta que es jugable, peso descargado
// y fps durante un combate. Se mide en una carga de verdad (iframe con `src`, no document.write)
// para que las marcas de `performance` sean las auténticas.

import { BASE, esperarA, dormir } from "./arnes.js";

/** Lo que consideramos aceptable. Fuentes: Core Web Vitals (LCP<2,5 s) y 60 fps de referencia. */
export const OBJETIVOS = Object.freeze({
  jugableMs: 2500,        // desde la navegación hasta poder pulsar Explorar
  domContentLoadedMs: 1500,
  pesoTotalKb: 1024,      // 1 MB de descarga inicial
  pesoJsKb: 400,
  fpsMedio: 50,
  fpsMinimo: 30,
  tareaLargaMs: 50,
});

const PERFILES = Object.freeze({
  escritorio: { ancho: 1440, alto: 900, nombre: "Escritorio 1440×900" },
  movil: { ancho: 375, alto: 812, nombre: "Móvil 375×812" },
});

/**
 * Carga la página de verdad y mide. No usa dobles de red: deja que la app hable con quien hable,
 * salvo que se pase `bloquearExternos` (por defecto sí, para no depender de Render).
 */
export async function medirCarga(perfil = "escritorio", { bloquearExternos = true, ruta = "#/arena", saltarPortada = true, tresD = false } = {}) {
  const p = PERFILES[perfil] ?? PERFILES.escritorio;
  if (saltarPortada) { try { sessionStorage.setItem("lootarena:portada", "1"); } catch { /* da igual */ } }
  try { localStorage.setItem("lootarena:tutorial", JSON.stringify({ v: 1, terminado: true, saltado: true, fecha: Date.now() })); } catch { /* da igual */ }
  // El motor se elige al arrancar, así que la clave tiene que estar puesta ANTES de navegar.
  try { localStorage.setItem("lootarena:3d", tresD ? "1" : "0"); } catch { /* da igual */ }

  const marco = document.createElement("iframe");
  marco.title = `Medición de rendimiento · ${p.nombre}`;
  marco.width = p.ancho; marco.height = p.alto;
  marco.className = "marco medir";
  // A LA VISTA, y no en el escondite de #marcos: Chrome no compone un lienzo WebGL que está fuera
  // de la pantalla, así que midiendo a escondidas el 3D daba 1 fps y fotogramas de un segundo.
  // Con el iframe encima de la página los fotogramas son los de verdad.
  marco.style.cssText = `position:fixed; left:0; top:0; z-index:9999; border:0; background:#000; width:${p.ancho}px; height:${p.alto}px;`;
  document.body.append(marco);

  const t0 = performance.now();
  marco.src = new URL(`index.html${ruta}`, BASE).href;

  let jugable = null, primerPintado = null, lienzo3dMs = null;
  const observar = async () => {
    for (;;) {
      const w = marco.contentWindow, d = w?.document;
      if (d && primerPintado == null && d.querySelector(".topbar")) primerPintado = performance.now() - t0;
      const l3d = d?.querySelector("#escena canvas.r3d-lienzo");
      if (lienzo3dMs == null && l3d && l3d.width > 1) lienzo3dMs = performance.now() - t0;
      const btn = d?.getElementById("btn-explorar");
      const arena = d?.getElementById("seccion-arena");
      const listo = btn && !btn.disabled && arena && !arena.hidden && d.getElementById("net-badge")?.textContent !== "Cargando…";
      // Con el 3D, «jugable» incluye tener la escena dibujando: antes de eso la arena está vacía.
      if (listo && (!tresD || lienzo3dMs != null)) {
        jugable = performance.now() - t0;
        return;
      }
      if (performance.now() - t0 > 30000) return;
      await dormir(16);
    }
  };
  if (bloquearExternos) {
    // El parche se instala en cuanto exista la ventana; puede llegar tarde a la primera petición,
    // por eso la medida de peso se queda solo con los recursos del propio origen.
    (async () => {
      for (let i = 0; i < 400; i++) {
        const w = marco.contentWindow;
        if (w?.fetch && !w.__parcheado) {
          w.__parcheado = true;
          const real = w.fetch.bind(w);
          w.fetch = (e, i2) => {
            const url = String(e?.url ?? e);
            if (!url.startsWith(location.origin) && !url.startsWith("/")) return Promise.reject(new TypeError("externo bloqueado por la medición"));
            return real(e, i2);
          };
          return;
        }
        await dormir(2);
      }
    })();
  }
  await observar();

  const w = marco.contentWindow;
  const nav = w.performance.getEntriesByType("navigation")[0] ?? {};
  const pintados = Object.fromEntries(w.performance.getEntriesByType("paint").map((e) => [e.name, Math.round(e.startTime)]));
  const recursos = w.performance.getEntriesByType("resource").map((r) => ({
    url: r.name.replace(BASE, ""),
    tipo: r.initiatorType,
    bytes: r.encodedBodySize || r.transferSize || 0,
    descomprimido: r.decodedBodySize || 0,
    ms: Math.round(r.duration),
    externo: !r.name.startsWith(location.origin),
  }));
  const propios = recursos.filter((r) => !r.externo);
  const suma = (lista) => lista.reduce((a, r) => a + r.bytes, 0);
  const docBytes = nav.encodedBodySize || 0;

  const externos = recursos.filter((r) => r.externo);
  const medida = {
    perfil: p.nombre,
    motor: tresD ? "3D" : "2D",
    jugableMs: jugable == null ? null : Math.round(jugable),
    lienzo3dMs: lienzo3dMs == null ? null : Math.round(lienzo3dMs),
    // three.js llega por `import()` desde un CDN: no pasa por fetch, pero sí por `performance`.
    externosKb: Math.round(externos.reduce((a, r) => a + r.bytes, 0) / 102.4) / 10,
    externosDetalle: externos.filter((r) => r.bytes > 0).map((r) => `${r.url.replace(/^https?:\/\//, "").slice(0, 60)} ${Math.round(r.bytes / 1024 * 10) / 10} kB en ${r.ms} ms`),
    domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd || 0),
    loadMs: Math.round(nav.loadEventEnd || 0),
    primerPintadoMs: pintados["first-contentful-paint"] ?? (primerPintado && Math.round(primerPintado)) ?? null,
    peso: {
      totalKb: Math.round((docBytes + suma(propios)) / 102.4) / 10,
      htmlKb: Math.round(docBytes / 102.4) / 10,
      jsKb: Math.round(suma(propios.filter((r) => /\.m?js(\?|$)/.test(r.url) || r.tipo === "script")) / 102.4) / 10,
      cssKb: Math.round(suma(propios.filter((r) => /\.css(\?|$)/.test(r.url) || r.tipo === "link")) / 102.4) / 10,
      jsonKb: Math.round(suma(propios.filter((r) => /\.json(\?|$)/.test(r.url))) / 102.4) / 10,
      peticiones: propios.length + 1,
    },
    recursosLentos: propios.filter((r) => r.ms > 100).sort((a, b) => b.ms - a.ms).slice(0, 8),
    masPesados: [...propios].sort((a, b) => b.bytes - a.bytes).slice(0, 10).map((r) => `${r.url} ${Math.round(r.bytes / 1024 * 10) / 10} kB`),
    externos: [...new Set(recursos.filter((r) => r.externo).map((r) => new URL(r.url, BASE).host))],
    marco,
  };
  return medida;
}

/**
 * ¿Está el navegador produciendo fotogramas de verdad?
 *
 * Si el panel del navegador no está a la vista, Chrome deja de componer y `requestAnimationFrame`
 * cae a 1-2 Hz. Entonces CUALQUIER medida de fps es basura: midiendo así, el 2D daba 27 fps y el
 * 3D 9 fps, cuando el problema era el panel, no el juego. Esto se comprueba ANTES de medir nada.
 *
 * @returns {Promise<{fiable:boolean, fps:number}>}
 */
export async function compositorVivo(win = window, ms = 700) {
  let n = 0;
  const t0 = win.performance.now();
  await new Promise((fin) => {
    const corte = setTimeout(() => fin(), ms + 2000);
    const paso = () => { n++; if (win.performance.now() - t0 < ms) win.requestAnimationFrame(paso); else { clearTimeout(corte); fin(); } };
    win.requestAnimationFrame(paso);
  });
  const fps = Math.round(n / ((win.performance.now() - t0) / 1000));
  return { fiable: fps >= 45, fps };
}

/** Cuenta fps dentro del iframe durante `ms`, además de las tareas largas que vea el navegador. */
export async function medirFps(win, ms = 4000) {
  const marcas = [];
  let largas = 0;
  let obs = null;
  try {
    obs = new win.PerformanceObserver((lista) => { for (const e of lista.getEntries()) if (e.duration > OBJETIVOS.tareaLargaMs) largas++; });
    obs.observe({ entryTypes: ["longtask"] });
  } catch { /* el navegador no lo soporta */ }

  // Si la pestaña está en segundo plano el navegador no dispara requestAnimationFrame y esto no
  // terminaría nunca: hay un plazo de gracia y se avisa en vez de colgarse.
  const aTiempo = await new Promise((fin) => {
    const t0 = win.performance.now();
    const corte = setTimeout(() => fin(false), ms + 4000);
    const paso = (t) => {
      marcas.push(t);
      if (t - t0 < ms) win.requestAnimationFrame(paso);
      else { clearTimeout(corte); fin(true); }
    };
    win.requestAnimationFrame(paso);
  });
  obs?.disconnect();

  const deltas = marcas.slice(1).map((t, i) => t - marcas[i]).filter((d) => d > 0);
  if (!aTiempo && marcas.length < 5) {
    return { error: "No se pudieron contar fotogramas: la pestaña estaba en segundo plano (el navegador para requestAnimationFrame). Deja visible el panel del navegador y vuelve a medir.", muestras: marcas.length };
  }
  if (!deltas.length) return { medio: 0, minimo: 0, p95Ms: 0, saltos: 0, tareasLargas: largas, muestras: 0 };
  const orden = [...deltas].sort((a, b) => a - b);
  const p95 = orden[Math.min(orden.length - 1, Math.floor(orden.length * 0.95))];
  return {
    medio: Math.round(1000 / (deltas.reduce((a, d) => a + d, 0) / deltas.length)),
    minimo: Math.round(1000 / orden[orden.length - 1]),
    p95Ms: Math.round(p95 * 10) / 10,
    peorMs: Math.round(orden[orden.length - 1] * 10) / 10,
    saltos: deltas.filter((d) => d > 50).length,
    tareasLargas: largas,
    muestras: deltas.length,
  };
}

/** Medida completa de un perfil: carga + fps durante un combate real. */
export async function medirPerfil(perfil = "escritorio", opciones = {}) {
  const m = await medirCarga(perfil, opciones);
  const w = m.marco.contentWindow, d = w.document;
  let fps = null, fpsReposo = null;

  // Antes de medir nada: ¿el navegador está dibujando? Si no, se dice y no se inventa una cifra.
  const compositor = await compositorVivo(window);
  if (!compositor.fiable) {
    const aviso = { error: `No se pueden medir los fps: el navegador solo produce ${compositor.fps} fotogramas por segundo porque su panel no está a la vista. Deja visible el panel del navegador y vuelve a medir.`, compositorFps: compositor.fps };
    const parcial = { ...m, fps: aviso, fpsReposo: aviso, compositor, veredictos: veredicto({ ...m, fps: null }) };
    delete parcial.marco;
    m.marco.remove();
    return parcial;
  }

  try {
    fpsReposo = await medirFps(w, 1500);
    d.getElementById("btn-explorar")?.click();
    await esperarA(() => !d.getElementById("btn-atacar")?.disabled, "empiece el combate para medir los fps", { ms: 8000 });
    const atacar = () => { const b = d.getElementById("btn-atacar"); if (b && !b.disabled) b.click(); };
    const golpes = setInterval(atacar, 600);
    atacar();
    fps = await medirFps(w, 4000);
    clearInterval(golpes);
  } catch (e) {
    fps = { error: String(e?.message ?? e) };
  }
  const resultado = { ...m, fps, fpsReposo, compositor, veredictos: veredicto({ ...m, fps }) };
  delete resultado.marco;
  m.marco.remove();
  return resultado;
}

/** Compara una medida con OBJETIVOS y devuelve la lista de lo que está mal. */
export function veredicto(m) {
  const v = [];
  const mal = (clave, valor, limite, texto) => v.push({ clave, valor, limite, texto, ok: false });
  const bien = (clave, valor, limite, texto) => v.push({ clave, valor, limite, texto, ok: true });
  const cmp = (clave, valor, limite, mayorEsMejor, texto) => {
    if (valor == null) return v.push({ clave, valor: null, limite, texto: `${texto}: no se pudo medir`, ok: null });
    const ok = mayorEsMejor ? valor >= limite : valor <= limite;
    (ok ? bien : mal)(clave, valor, limite, texto);
  };
  cmp("jugable", m.jugableMs, OBJETIVOS.jugableMs, false, "Tiempo hasta poder jugar");
  cmp("dcl", m.domContentLoadedMs, OBJETIVOS.domContentLoadedMs, false, "DOMContentLoaded");
  cmp("peso", m.peso?.totalKb, OBJETIVOS.pesoTotalKb, false, "Peso descargado");
  cmp("js", m.peso?.jsKb, OBJETIVOS.pesoJsKb, false, "Peso de JavaScript");
  if (m.fps && !m.fps.error) {
    cmp("fpsMedio", m.fps.medio, OBJETIVOS.fpsMedio, true, "fps medios en combate");
    cmp("fpsMin", m.fps.minimo, OBJETIVOS.fpsMinimo, true, "fps mínimos en combate");
  }
  return v;
}
