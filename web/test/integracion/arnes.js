// Arnés de pruebas de interfaz de Loot Arena.
//
// Carga la página real (web/index.html, sin tocar ni una línea de producción) dentro de un iframe
// del mismo origen, le instala una sonda que recoge los errores de JavaScript, y deja que cada caso
// la maneje como lo haría un jugador: pulsar botones, cambiar de sección, esperar a que algo aparezca.
//
// Cómo funciona la carga (y por qué así):
//   1. Se crea un <iframe> vacío (about:blank). Hereda el origen y la URL del runner, así que
//      `location.hash` funciona de verdad y el router de la app se comporta como en producción.
//   2. ANTES de escribir el HTML se instalan en esa ventana los oyentes de `error` y
//      `unhandledrejection`, y los dobles (fetch, matchMedia, Storage). Como no hay navegación,
//      esos oyentes sobreviven: se cazan también los errores de evaluación de los módulos.
//   3. Se descarga `index.html` tal cual del servidor y se escribe en el iframe con un `<base>`
//      para que todas las rutas relativas resuelvan contra la raíz de `web/`.
//
// Uso: ver README.md. El runner es `ejecutar.html`.

export const BASE = new URL("../../", import.meta.url).href;

// ───────────────────────── Utilidades de espera ─────────────────────────

export const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** Error de aserción del arnés: lo distingue de un fallo inesperado del propio arnés. */
export class FalloPrueba extends Error {
  constructor(mensaje) { super(mensaje); this.name = "FalloPrueba"; }
}

export function afirmar(condicion, mensaje) {
  if (!condicion) throw new FalloPrueba(mensaje);
}

export function igual(obtenido, esperado, mensaje) {
  if (obtenido !== esperado) throw new FalloPrueba(`${mensaje}\n  esperado: ${JSON.stringify(esperado)}\n  obtenido: ${JSON.stringify(obtenido)}`);
}

/**
 * Espera a que `fn()` devuelva algo con valor de verdad. Falla con un mensaje claro si se agota el tiempo.
 * @param {() => any} fn
 * @param {string} queEspero descripción en primera persona: «el botón Atacar se habilite»
 * @param {{ms?:number, paso?:number}} [o]
 */
export async function esperarA(fn, queEspero, { ms = 8000, paso = 50 } = {}) {
  const t0 = Date.now();
  let ultimoError = null;
  for (;;) {
    try {
      const v = fn();
      if (v) return v;
      ultimoError = null;
    } catch (e) { ultimoError = e; }
    if (Date.now() - t0 > ms) {
      throw new FalloPrueba(`Se agotaron ${ms} ms esperando a que ${queEspero}.${ultimoError ? `\n  última excepción al comprobarlo: ${ultimoError.message}` : ""}`);
    }
    await dormir(paso);
  }
}

/** Espera a que `fn()` deje de ser cierto (p. ej. a que una animación termine). */
export async function esperarAQueNo(fn, queEspero, o) {
  return esperarA(() => !fn(), `deje de cumplirse: ${queEspero}`, o);
}

// ───────────────────────── Dobles de red ─────────────────────────

/**
 * Respuestas simuladas del servidor de botín. Evita depender de Render (que duerme, tarda y no
 * permite CORS desde localhost) y hace los casos deterministas.
 */
function respuestaSimulada(url, init) {
  const ruta = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
  const json = (cuerpo, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });
  if (ruta === "/health") return json({ ok: true, simulado: true });
  if (ruta === "/ganar") return json({ drop: false });
  if (ruta === "/ranking") return json({ actualizado: Date.now(), categorias: { objetos: [], oro: [], victorias: [] } });
  if (ruta.startsWith("/ranking/")) return json({ categorias: {} });
  if (ruta.startsWith("/recompensa/diaria/")) return json({ racha: 0, disponible: false, siguiente: Date.now() + 3600_000 });
  if (ruta === "/torre/rank" || ruta.startsWith("/torre")) return json({ top: [], actualizado: Date.now() });
  if (ruta === "/recompensa") return json({ ok: false, error: "simulado por el arnés" }, 400);
  if (ruta === "/gas" || ruta.startsWith("/gas/")) return json({ ok: false, error: "simulado por el arnés" }, 400);
  return json({ error: `ruta no simulada por el arnés: ${ruta} (${init?.method ?? "GET"})` }, 404);
}

const mismoOrigen = (url) => { try { return new URL(url, BASE).origin === location.origin; } catch { return false; } };

// ───────────────────────── Apertura de la aplicación ─────────────────────────

const CLAVES_APP = ["lootarena:", "loot-arena", "arena:"];

/** Borra todas las claves que la aplicación guarda, dejando intactas las del runner. */
export function limpiarAlmacenamiento() {
  for (const almacen of [localStorage, sessionStorage]) {
    const fuera = [];
    for (let i = 0; i < almacen.length; i++) {
      const k = almacen.key(i);
      if (CLAVES_APP.some((p) => k?.startsWith(p))) fuera.push(k);
    }
    for (const k of fuera) almacen.removeItem(k);
  }
}

function contenedorMarcos() {
  let c = document.getElementById("marcos");
  if (!c) { c = document.createElement("div"); c.id = "marcos"; document.body.append(c); }
  return c;
}

/**
 * Carga la aplicación y devuelve un mando a distancia.
 *
 * @param {object} [opc]
 * @param {string} [opc.ruta="#/arena"]            hash inicial
 * @param {"saltada"|"mostrada"} [opc.portada="saltada"]
 * @param {"visto"|"nuevo"} [opc.tutorial="visto"] «nuevo» hace que el tutorial arranque
 * @param {"normal"|"bloqueado"|"lleno"} [opc.almacen="normal"]
 * @param {"simulado"|"caido"|"lento"|"real"} [opc.servidor="simulado"]
 * @param {number} [opc.retardoRed=0]              ms de retardo añadido a cada fetch
 * @param {"reducido"|"normal"} [opc.movimiento="reducido"] reducido = animaciones instantáneas (rápido y estable)
 * @param {"sonda"|"real"} [opc.modo="sonda"] «sonda» = document.write con los oyentes puestos antes
 *        (caza los errores de arranque). «real» = navegación de verdad con `src`: hace falta para
 *        probar el botón Atrás y las marcas de `performance`, pero los oyentes llegan después de cargar.
 * @param {boolean} [opc.visible=false]            muestra el iframe (útil para depurar a ojo)
 * @param {{ancho:number, alto:number}} [opc.vista] tamaño del iframe
 */
export async function abrirApp(opc = {}) {
  const o = {
    ruta: "#/arena", portada: "saltada", tutorial: "visto", almacen: "normal",
    servidor: "simulado", retardoRed: 0, movimiento: "reducido", visible: false,
    vista: { ancho: 1280, alto: 860 }, limpiar: true, modo: "sonda", ...opc,
  };

  if (o.limpiar) limpiarAlmacenamiento();
  // Estas dos claves se escriben desde el runner (mismo origen, mismo almacenamiento) ANTES de
  // bloquear el almacenamiento dentro del iframe, para poder probar «sin storage» con la portada ya vista.
  if (o.portada === "saltada") { try { sessionStorage.setItem("lootarena:portada", "1"); } catch { /* da igual */ } }
  if (o.tutorial === "visto") { try { localStorage.setItem("lootarena:tutorial", JSON.stringify({ v: 1, terminado: true, saltado: true, fecha: Date.now() })); } catch { /* da igual */ } }
  if (o.semilla) for (const [k, v] of Object.entries(o.semilla)) { try { localStorage.setItem(k, v); } catch { /* da igual */ } }

  const marco = document.createElement("iframe");
  marco.title = "Loot Arena bajo prueba";
  marco.width = o.vista.ancho; marco.height = o.vista.alto;
  marco.className = o.visible ? "marco visible" : "marco";
  contenedorMarcos().append(marco);

  const errores = [];
  const peticiones = [];

  // En modo «real» hay una navegación de verdad: la ventana de ahora se tira, así que las sondas
  // se instalan sobre la nueva en cuanto aparece (bucle apretado) y, sí o sí, al terminar la carga.
  if (o.modo === "real") {
    marco.src = new URL(`index.html${o.ruta || ""}`, BASE).href;
    let puesto = false;
    const intentar = () => {
      const v = marco.contentWindow;
      if (!v || puesto || v.location.href === "about:blank") return false;
      puesto = true;
      instalarSondas(v, o, errores, peticiones);
      return true;
    };
    const t0 = Date.now();
    while (!intentar() && Date.now() - t0 < 15000) await dormir(2);
    await new Promise((fin) => { if (marco.contentDocument?.readyState === "complete") fin(); else marco.addEventListener("load", fin, { once: true }); });
    if (!puesto) instalarSondas(marco.contentWindow, o, errores, peticiones);
    return montarMando(marco, marco.contentWindow, errores, peticiones, o);
  }

  const w = marco.contentWindow;
  instalarSondas(w, o, errores, peticiones);

  // El hash debe estar puesto antes de que el router se evalúe.
  if (o.ruta) w.location.hash = o.ruta;

  const html = await (await fetch(new URL("index.html", BASE), { cache: "no-store" })).text();
  const conBase = html.replace(/<head([^>]*)>/i, `<head$1>
<base href="${BASE}">`);
  if (!conBase.includes("<base")) throw new Error("No se pudo inyectar <base> en index.html: ¿ha cambiado el <head>?");

  const d = w.document;
  d.open();
  d.write(conBase);
  d.close();

  return montarMando(marco, w, errores, peticiones, o);
}

/** Instala en la ventana del iframe los oyentes de error y los dobles de red, movimiento y almacenamiento. */
function instalarSondas(w, o, errores, peticiones) {
  w.addEventListener("error", (ev) => {
    errores.push({
      tipo: ev.error ? "excepción" : "recurso",
      mensaje: ev.message || `no se pudo cargar ${ev.target?.src ?? ev.target?.href ?? "un recurso"}`,
      donde: ev.filename ? `${ev.filename.replace(BASE, "")}:${ev.lineno}:${ev.colno}` : "",
      pila: ev.error?.stack ?? "",
    });
  }, true);
  w.addEventListener("unhandledrejection", (ev) => {
    const r = ev.reason;
    errores.push({ tipo: "promesa sin capturar", mensaje: r?.message ?? String(r), donde: "", pila: r?.stack ?? "" });
  });

  if (o.movimiento === "reducido") {
    w.matchMedia = (consulta) => ({
      media: consulta, matches: /prefers-reduced-motion:\s*reduce/.test(consulta),
      onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
    });
  }

  if (o.almacen !== "normal") rompeAlmacen(w, o.almacen);

  const fetchReal = w.fetch.bind(w);
  w.fetch = async (entrada, init) => {
    const url = String(entrada?.url ?? entrada);
    const t0 = performance.now();
    const apunte = { url, metodo: init?.method ?? entrada?.method ?? "GET", estado: null, ms: 0 };
    peticiones.push(apunte);
    if (o.retardoRed > 0) await dormir(o.retardoRed);
    try {
      let res;
      if (mismoOrigen(url) || o.servidor === "real") res = await fetchReal(entrada, init);
      else if (o.servidor === "caido") throw new TypeError("Failed to fetch (servidor caído, simulado por el arnés)");
      else res = respuestaSimulada(url, init);
      apunte.estado = res.status;
      return res;
    } catch (e) {
      apunte.estado = "fallo";
      throw e;
    } finally {
      apunte.ms = Math.round(performance.now() - t0);
    }
  };
}

/** Construye el mando a distancia de la app ya cargada. */
async function montarMando(marco, w, errores, peticiones, o) {
  const d = w.document;
  const app = {
    marco, win: w, doc: d, errores, peticiones, opciones: o,
    $: (sel) => d.querySelector(sel),
    $$: (sel) => [...d.querySelectorAll(sel)],
    // ¡Ojo! `offsetParent` es null en los elementos `position:fixed` (portada, pantalla de
    // resultado…), así que se comprueba con getClientRects + visibility.
    visible: (sel) => {
      const e = typeof sel === "string" ? d.querySelector(sel) : sel;
      if (!e || e.hidden || e.closest("[hidden]")) return false;
      if (!e.getClientRects().length) return false;
      const cs = w.getComputedStyle(e);
      return cs.visibility !== "hidden" && cs.display !== "none";
    },
    texto: (sel) => (typeof sel === "string" ? d.querySelector(sel) : sel)?.textContent?.trim() ?? "",
    hash: () => w.location.hash,
    /** Pulsa un elemento (por selector o nodo). Falla con mensaje claro si no está o está desactivado. */
    pulsar(sel, { permitirDesactivado = false } = {}) {
      const el = typeof sel === "string" ? d.querySelector(sel) : sel;
      if (!el) throw new FalloPrueba(`No existe el elemento «${sel}» que había que pulsar.`);
      if (!permitirDesactivado && el.disabled) throw new FalloPrueba(`El elemento «${sel}» está desactivado y no se puede pulsar.`);
      el.click();
      return el;
    },
    /** Pulsa una tecla sobre el elemento con el foco (o el que se indique). */
    tecla(key, { destino = null, ...resto } = {}) {
      const el = destino ? (typeof destino === "string" ? d.querySelector(destino) : destino) : (d.activeElement ?? d.body);
      el.dispatchEvent(new w.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...resto }));
      el.dispatchEvent(new w.KeyboardEvent("keyup", { key, bubbles: true, cancelable: true, ...resto }));
      return el;
    },
    /** Lanza si la app ha registrado errores de JavaScript. */
    sinErrores(contexto = "") {
      if (!errores.length) return;
      const lista = errores.map((e) => `  · [${e.tipo}] ${e.mensaje}${e.donde ? ` (${e.donde})` : ""}`).join("\n");
      throw new FalloPrueba(`La página lanzó ${errores.length} error(es) de JavaScript${contexto ? ` ${contexto}` : ""}:\n${lista}`);
    },
    cerrar() { try { marco.remove(); } catch { /* ya no está */ } },
  };

  await esperarA(() => d.readyState === "complete", "la página termine de cargarse", { ms: 15000 });
  // main.js arranca con `iniciar()` asíncrono: la cabecera es lo primero que pinta.
  await esperarA(() => app.$("#net-badge") && app.texto("#net-badge") !== "Cargando…", "la cabecera deje de decir «Cargando…» (señal de que main.js arrancó)", { ms: 15000 });
  return app;
}

/** Sustituye el almacenamiento del iframe por uno que falla, como en modo privado o con la cuota llena. */
function rompeAlmacen(w, modo) {
  const proto = w.Storage.prototype;
  if (modo === "bloqueado") {
    const no = () => { const e = new w.DOMException("The operation is insecure.", "SecurityError"); throw e; };
    proto.getItem = no; proto.setItem = no; proto.removeItem = no; proto.key = no; proto.clear = no;
    Object.defineProperty(proto, "length", { get: no, configurable: true });
  } else if (modo === "lleno") {
    proto.setItem = function () { throw new w.DOMException("Quota exceeded.", "QuotaExceededError"); };
  }
}

// ───────────────────────── Registro y ejecución de casos ─────────────────────────

/** @type {{grupo:string, nombre:string, fn:Function, saltar?:string}[]} */
export const CASOS = [];

/**
 * Registra un caso.
 * @param {string} grupo p. ej. "Navegación"
 * @param {string} nombre lo que se comprueba, en una frase
 * @param {(ctx:{abrirApp:typeof abrirApp}) => Promise<void>} fn
 */
export function caso(grupo, nombre, fn, opciones = {}) {
  CASOS.push({ grupo, nombre, fn, ...opciones });
}

/**
 * Ejecuta los casos registrados.
 * @param {{filtro?:string, alEmpezar?:Function, alTerminar?:Function, tiempoMax?:number}} [o]
 * @returns {Promise<{total:number, ok:number, fallos:number, saltados:number, resultados:object[], ms:number}>}
 */
export async function ejecutarCasos({ filtro = "", alEmpezar = () => {}, alTerminar = () => {}, tiempoMax = 90_000 } = {}) {
  const sel = filtro.trim().toLowerCase();
  const lista = CASOS.filter((c) => !sel || `${c.grupo} ${c.nombre}`.toLowerCase().includes(sel));
  const resultados = [];
  const t00 = performance.now();
  for (const c of lista) {
    alEmpezar(c);
    const t0 = performance.now();
    const abiertas = [];
    const abrir = async (opc) => { const a = await abrirApp(opc); abiertas.push(a); return a; };
    let r;
    if (c.saltar) {
      r = { ...c, estado: "saltado", motivo: c.saltar, ms: 0 };
    } else {
      try {
        await Promise.race([
          c.fn({ abrirApp: abrir }),
          dormir(tiempoMax).then(() => { throw new FalloPrueba(`El caso no terminó en ${tiempoMax} ms.`); }),
        ]);
        r = { ...c, estado: "ok", ms: Math.round(performance.now() - t0) };
      } catch (e) {
        r = {
          ...c,
          estado: e instanceof FalloPrueba ? "fallo" : "error",
          mensaje: e?.message ?? String(e),
          pila: e instanceof FalloPrueba ? "" : (e?.stack ?? ""),
          ms: Math.round(performance.now() - t0),
        };
      }
    }
    for (const a of abiertas) a.cerrar();
    resultados.push(r);
    alTerminar(r);
    await dormir(10);
  }
  return {
    total: lista.length,
    ok: resultados.filter((r) => r.estado === "ok").length,
    fallos: resultados.filter((r) => r.estado !== "ok" && r.estado !== "saltado").length,
    saltados: resultados.filter((r) => r.estado === "saltado").length,
    ms: Math.round(performance.now() - t00),
    resultados,
  };
}
