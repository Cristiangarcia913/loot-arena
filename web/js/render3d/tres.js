// Carga de three.js desde CDN, sin build y sin importmap.
//
// ¿Por qué un import dinámico con la URL completa y no un `<script type="importmap">`?
// El importmap tendría que ir en el `<head>` de `index.html`, que no es un archivo de este equipo
// (y además obliga a que TODAS las páginas que usen el motor 3D lo repitan). Importando la URL
// completa, el módulo es autosuficiente: `escena3d.js` funciona desde cualquier HTML sin tocarlo.
//
// El build `build/three.module.js` es un módulo ES real del paquete y su única dependencia es
// `./three.core.js`, un import RELATIVO que el navegador resuelve contra la propia URL del CDN.
// Por eso no hace falta mapear el especificador desnudo "three": solo lo necesitaríamos para los
// complementos de `examples/jsm/` (addons), que en la fase A no usamos.
//
// La versión va FIJADA a propósito: la documentación de three.js advierte de que mezclar versiones
// o CDN distintos duplica código y rompe la aplicación, y un `@latest` convertiría cualquier
// publicación de three.js en una avería sorpresa de Loot Arena.

/** Versión de three.js fijada (r187, publicada el 31-oct-2026; `npm view three version` → 0.187.0). */
export const TRES_VERSION = "0.187.0";

/** Revisión equivalente, para mensajes y diagnóstico. */
export const TRES_REVISION = "r187";

/**
 * URLs candidatas, en orden. La primera es la buena; la segunda es el plan B si jsDelivr falla.
 * Ambas sirven el MISMO archivo del MISMO paquete, así que no hay riesgo de mezclar versiones.
 */
export const TRES_URLS = Object.freeze([
  `https://cdn.jsdelivr.net/npm/three@${TRES_VERSION}/build/three.module.js`,
  `https://unpkg.com/three@${TRES_VERSION}/build/three.module.js`,
]);

/** Mensajes al jugador (en español, sin jerga). */
export const MSG_3D = Object.freeze({
  sinWebgl: "Tu navegador no puede dibujar en 3D. Seguimos en 2D, que se ve igual de bien.",
  sinRed: "No se ha podido descargar el motor 3D. Seguimos en 2D.",
  equipoFlojo: "Tu equipo va justo con el 3D: he bajado la calidad para que no se note el tirón.",
  muyFlojo: "El 3D va a tirones en este equipo. Puedes volver al 2D cuando quieras.",
});

let promesa = null;
let cargado = null;

/**
 * ¿Puede este navegador dibujar en 3D? Comprueba WebGL de verdad (crea un contexto y lo suelta),
 * porque `"WebGL2RenderingContext" in window` da falsos positivos en equipos con la GPU en lista negra.
 * @param {Document} [doc]
 * @returns {boolean}
 */
export function soporta3d(doc = globalThis.document) {
  try {
    if (!doc?.createElement) return false;
    const c = doc.createElement("canvas");
    const gl = c.getContext("webgl2") ?? c.getContext("webgl");
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/**
 * Datos de la GPU para decidir la calidad. Devuelve `null` si no hay WebGL.
 * @param {Document} [doc]
 * @returns {{renderer:string, version:string, webgl2:boolean, maxTextura:number}|null}
 */
export function infoGpu(doc = globalThis.document) {
  try {
    const c = doc.createElement("canvas");
    const gl = c.getContext("webgl2") ?? c.getContext("webgl");
    if (!gl) return null;
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    const info = {
      renderer: String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) ?? ""),
      version: String(gl.getParameter(gl.VERSION) ?? ""),
      webgl2: typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext,
      maxTextura: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 0,
    };
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return info;
  } catch {
    return null;
  }
}

/**
 * Carga three.js una sola vez (se reutiliza la misma promesa en llamadas posteriores).
 * Prueba las URLs en orden y se queda con la primera que responda.
 * @param {string[]} [urls] para pruebas: lista alternativa de URLs
 * @returns {Promise<object>} el espacio de nombres de three.js (THREE)
 * @throws si ninguna URL responde (mensaje `MSG_3D.sinRed`)
 */
export function cargarTres(urls = TRES_URLS) {
  if (cargado) return Promise.resolve(cargado);
  if (promesa) return promesa;
  promesa = (async () => {
    const fallos = [];
    for (const url of urls) {
      try {
        const m = await import(/* @vite-ignore */ url);
        const T = m?.Scene ? m : m?.default;
        if (!T?.Scene) throw new Error("el módulo no parece three.js");
        cargado = T;
        return T;
      } catch (e) {
        fallos.push(`${url}: ${e?.message ?? e}`);
      }
    }
    promesa = null;
    const err = new Error(MSG_3D.sinRed);
    err.detalle = fallos.join(" · ");
    throw err;
  })();
  return promesa;
}

/** three.js ya cargado, o `null`. Útil para no esperar si ya está en memoria. */
export const tresYaCargado = () => cargado;

/** Solo para pruebas: olvida la carga anterior. */
export function _olvidar() {
  promesa = null;
  cargado = null;
}
