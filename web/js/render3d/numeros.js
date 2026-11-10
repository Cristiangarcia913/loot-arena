// Números y rótulos que flotan DENTRO de la escena 3D (no son HTML encima del lienzo): se dibujan
// en un canvas pequeño, se suben a la GPU como textura y se pegan a un `Sprite`, que en three.js
// siempre mira a la cámara. Así el «−12» se aleja cuando la cámara retrocede y se tapa con el
// muro, que es lo que hace que parezca parte del mundo.
//
// Las texturas se guardan en caché por texto+clase: en un combate el mismo «−12» sale muchas
// veces y subir la misma imagen a la GPU cada vez sería tirar memoria.

import { TEXTO, claseTexto } from "./paleta.js";

/** Tope de texturas en caché. Pasado ese número se tiran las más antiguas. */
export const MAX_CACHE = 48;

/**
 * Texto que toca mostrar, con los mismos criterios que `fx.animarGolpe`:
 * esquiva → «¡Esquiva!», bloqueo → «🛡 N» o «¡Bloqueado!», crítico → «¡N!», normal → «−N».
 * Función pura: se prueba en Node.
 *
 * @param {number|string} dano
 * @param {{critico?:boolean, bloqueado?:boolean, esquivado?:boolean}} [o]
 * @returns {{texto:string, clase:"dano"|"critico"|"bloqueo"|"esquiva"}}
 */
export function textoDeGolpe(dano, { critico = false, bloqueado = false, esquivado = false } = {}) {
  if (esquivado || dano === "esquiva") return { texto: "¡Esquiva!", clase: "esquiva" };
  if (bloqueado) return { texto: dano ? `🛡 ${dano}` : "¡Bloqueado!", clase: "bloqueo" };
  if (critico) return { texto: `¡${dano}!`, clase: "critico" };
  return { texto: `−${dano}`, clase: "dano" };
}

/** Altura del número en unidades del mundo, por clase. */
export const altoTexto = (clase) => 0.42 * (TEXTO[claseTexto(clase)]?.tam ?? 1);

/**
 * Fábrica de números flotantes. Una por escena; `liberar()` devuelve todas las texturas.
 */
export class Rotulos {
  /**
   * @param {object} T three.js
   * @param {{doc?:Document, escala?:number}} [o] escala: píxeles de textura por unidad de mundo
   */
  constructor(T, { doc = globalThis.document, escala = 220 } = {}) {
    this.T = T;
    this.doc = doc;
    this.escala = escala;
    this.cache = new Map();
  }

  /**
   * Dibuja el texto en un canvas y lo convierte en textura (o la reutiliza).
   * @param {string} texto @param {string} clase
   * @returns {{textura:object, w:number, h:number}}
   */
  textura(texto, clase) {
    const cl = claseTexto(clase);
    const llave = `${cl}\u0000${texto}`;
    const guardada = this.cache.get(llave);
    if (guardada) {
      this.cache.delete(llave);      // reinsertar = marcarla como reciente
      this.cache.set(llave, guardada);
      return guardada;
    }
    const { T, doc } = this;
    const est = TEXTO[cl];
    const px = Math.round(64 * est.tam);
    const fuente = `900 ${px}px ui-rounded, "Segoe UI", system-ui, sans-serif`;
    const medidor = doc.createElement("canvas").getContext("2d");
    medidor.font = fuente;
    const anchoTexto = Math.max(16, medidor.measureText(texto).width);
    const margen = px * 0.42;
    const w = Math.ceil(anchoTexto + margen * 2);
    const h = Math.ceil(px * 1.6);

    const c = doc.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d");
    g.font = fuente;
    g.textAlign = "center";
    g.textBaseline = "middle";
    // Resplandor, contorno grueso y relleno: así se lee sobre la arena clara y sobre el muro negro.
    g.shadowColor = est.borde;
    g.shadowBlur = px * 0.35;
    g.lineWidth = px * 0.17;
    g.strokeStyle = est.borde;
    g.strokeText(texto, w / 2, h / 2);
    g.shadowBlur = 0;
    g.lineWidth = px * 0.08;
    g.strokeStyle = "rgba(0,0,0,.55)";
    g.strokeText(texto, w / 2, h / 2);
    g.fillStyle = est.relleno;
    g.fillText(texto, w / 2, h / 2);

    const tex = new T.CanvasTexture(c);
    tex.colorSpace = T.SRGBColorSpace ?? tex.colorSpace;
    tex.anisotropy = 1;
    const dato = { textura: tex, w, h };
    this.cache.set(llave, dato);
    while (this.cache.size > MAX_CACHE) {
      const [k, v] = this.cache.entries().next().value;
      this.cache.delete(k);
      try { v.textura.dispose(); } catch { /* ya liberada */ }
    }
    return dato;
  }

  /**
   * Un rótulo listo para añadir a la escena, con su material propio (la opacidad se anima por
   * rótulo, así que el material no se puede compartir; la textura sí).
   * @param {string} texto @param {string} [clase]
   * @returns {object} Sprite de three.js; su `userData.liberar()` suelta el material
   */
  crear(texto, clase = "dano") {
    const { T } = this;
    const { textura, w, h } = this.textura(texto, clase);
    const mat = new T.SpriteMaterial({ map: textura, transparent: true, depthWrite: false, depthTest: true });
    const s = new T.Sprite(mat);
    const alto = altoTexto(clase);
    s.scale.set((alto * w) / h, alto, 1);
    s.name = `rotulo-${texto}`;
    s.userData.liberar = () => { try { mat.dispose(); } catch { /* nada */ } };
    return s;
  }

  /** Suelta todas las texturas en caché. */
  liberar() {
    for (const v of this.cache.values()) { try { v.textura.dispose(); } catch { /* nada */ } }
    this.cache.clear();
  }
}
