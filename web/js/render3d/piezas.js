// Taller de piezas: envoltorio fino sobre las geometrías de three.js para que el código de las
// criaturas se lea como una lista de piezas y no como un muro de constructores.
//
// Dos cosas importantes:
//  1. `T` (el espacio de nombres de three.js) entra SIEMPRE por parámetro. Así este módulo no
//     importa nada del CDN y las pruebas pueden pasarle un doble de three.js en Node.
//  2. El taller apunta cada geometría, material y textura que crea. Al desmontar la escena se
//     llama a `liberar()` y se devuelve toda la memoria de la GPU de una vez, sin olvidos.

/** Unidades: 1 ≈ 1 metro. El héroe mide 1,8 y la arena tiene 9 de radio. */
export const ALTO_HEROE = 1.8;

export class Taller {
  /**
   * @param {object} T espacio de nombres de three.js
   * @param {{segmentos?:number, sombras?:boolean}} [o] segmentos: detalle de las piezas redondas
   */
  constructor(T, { segmentos = 16, sombras = false } = {}) {
    this.T = T;
    this.seg = Math.max(6, segmentos | 0);
    this.sombras = !!sombras;
    this.recursos = new Set();
    this.materiales = [];
  }

  /** Apunta un recurso para liberarlo después. */
  reg(x) {
    if (x && typeof x.dispose === "function") this.recursos.add(x);
    return x;
  }

  /**
   * Material opaco normal (el de casi todo).
   * @param {number} color
   * @param {{emision?:number, fuerza?:number, metal?:number, rugosidad?:number,
   *          opacidad?:number, plano?:boolean, doble?:boolean}} [o]
   *        plano: facetas marcadas (piedra, hueso) · doble: visible por las dos caras (telas, alas)
   */
  mat(color, o = {}) {
    const { T } = this;
    const m = new T.MeshStandardMaterial({
      color,
      roughness: o.rugosidad ?? 0.72,
      metalness: o.metal ?? 0.1,
      flatShading: !!o.plano,
      ...(o.emision ? { emissive: o.emision, emissiveIntensity: o.fuerza ?? 0.6 } : {}),
      ...(o.opacidad != null && o.opacidad < 1 ? { transparent: true, opacity: o.opacidad } : {}),
      ...(o.doble ? { side: T.DoubleSide } : {}),
    });
    // Guardamos el brillo original: el destello al recibir un golpe lo sube y luego lo devuelve.
    m.userData.emisionBase = o.emision ?? 0x000000;
    m.userData.fuerzaBase = o.emision ? (o.fuerza ?? 0.6) : 0;
    this.materiales.push(m);
    return this.reg(m);
  }

  /** Material que se ve a sí mismo (llamas, runas, ojos): no le afecta la luz. */
  matLuz(color, { opacidad = 1, aditivo = false, doble = false } = {}) {
    const { T } = this;
    const m = new T.MeshBasicMaterial({
      color,
      ...(opacidad < 1 ? { transparent: true, opacity: opacidad } : {}),
      ...(aditivo ? { blending: T.AdditiveBlending, transparent: true, depthWrite: false } : {}),
      ...(doble ? { side: T.DoubleSide } : {}),
    });
    return this.reg(m);
  }

  /**
   * Malla con sombras ya configuradas.
   * @param {boolean} [casta=true] false para lo que está pegado al suelo (el propio suelo, las
   *        manchas, los discos de sombra falsa). Si el suelo proyecta sombra, se la proyecta a sí
   *        mismo: sale un manchón negro enorme en medio de la arena.
   */
  malla(geo, mat, casta = true) {
    const m = new this.T.Mesh(this.reg(geo), mat);
    if (this.sombras) { m.castShadow = casta; m.receiveShadow = true; }
    return m;
  }

  /**
   * Disco tumbado en el suelo: nunca proyecta sombra. Se marca como «sombra falsa» para que
   * `construirEnemigo` pueda corregirlo cuando la criatura se agranda mucho (ver abajo).
   */
  disco(r, mat, segmentos = Math.max(8, this.seg)) {
    const d = this.malla(new this.T.CircleGeometry(r, segmentos), mat, false);
    d.rotation.x = -Math.PI / 2;
    d.userData.sombraFalsa = true;
    d.name = "sombra";
    return d;
  }

  caja(w, h, d, mat) { return this.malla(new this.T.BoxGeometry(w, h, d), mat); }
  esfera(r, mat, achatado = 1) {
    const m = this.malla(new this.T.SphereGeometry(r, this.seg, Math.max(4, this.seg >> 1)), mat);
    if (achatado !== 1) m.scale.set(1, achatado, 1);
    return m;
  }
  cilindro(rArriba, rAbajo, h, mat) { return this.malla(new this.T.CylinderGeometry(rArriba, rAbajo, h, this.seg), mat); }
  cono(r, h, mat) { return this.malla(new this.T.ConeGeometry(r, h, this.seg), mat); }
  capsula(r, largo, mat) { return this.malla(new this.T.CapsuleGeometry(r, largo, Math.max(2, this.seg >> 2), this.seg), mat); }
  toro(r, grosor, mat) { return this.malla(new this.T.TorusGeometry(r, grosor, Math.max(6, this.seg >> 1), this.seg), mat); }
  /** Piedra irregular (icosaedro con facetas): rocas, huesos, trozos del gólem. */
  roca(r, mat, detalle = 0) { return this.malla(new this.T.IcosahedronGeometry(r, detalle), mat); }
  plano(w, h, mat) { return this.malla(new this.T.PlaneGeometry(w, h), mat); }

  /** Grupo con nombre (los nombres salen en el inspector de three.js y en las pruebas). */
  grupo(nombre = "") {
    const g = new this.T.Group();
    g.name = nombre;
    return g;
  }

  /**
   * Coloca una pieza y la devuelve, para escribir `g.add(t.en(t.caja(...), 0, 1, 0))`.
   * @param {object} obj @param {number} x @param {number} y @param {number} z
   * @param {{rx?:number, ry?:number, rz?:number, esc?:number|number[]}} [r]
   */
  en(obj, x = 0, y = 0, z = 0, r = {}) {
    obj.position.set(x, y, z);
    if (r.rx || r.ry || r.rz) obj.rotation.set(r.rx ?? 0, r.ry ?? 0, r.rz ?? 0);
    if (r.esc != null) Array.isArray(r.esc) ? obj.scale.set(...r.esc) : obj.scale.setScalar(r.esc);
    return obj;
  }

  /** Dos piezas simétricas en X (brazos, piernas, alas, ojos). */
  par(hacer, x, ...resto) {
    const a = hacer(-1, ...resto); a.position.x -= x;
    const b = hacer(1, ...resto); b.position.x += x;
    return [a, b];
  }

  /** Devuelve a la GPU todo lo que ha creado este taller. */
  liberar() {
    for (const r of this.recursos) { try { r.dispose(); } catch { /* ya liberado */ } }
    this.recursos.clear();
    this.materiales.length = 0;
  }
}

/**
 * Libera geometrías, materiales y texturas de una rama de la escena, por si algo se creó fuera
 * del taller. Seguro de llamar dos veces.
 * @param {object} raiz nodo de three.js
 */
export function liberarRama(raiz) {
  if (!raiz?.traverse) return;
  const vistos = new Set();
  raiz.traverse((n) => {
    // InstancedMesh guarda además sus buffers de matrices y colores: `dispose()` los suelta.
    if (n.isInstancedMesh && typeof n.dispose === "function") { try { n.dispose(); } catch { /* nada */ } }
    if (n.geometry && !vistos.has(n.geometry)) { vistos.add(n.geometry); try { n.geometry.dispose(); } catch { /* nada */ } }
    const mats = Array.isArray(n.material) ? n.material : n.material ? [n.material] : [];
    for (const m of mats) {
      if (vistos.has(m)) continue;
      vistos.add(m);
      for (const k of ["map", "alphaMap", "emissiveMap", "normalMap"]) {
        if (m[k] && !vistos.has(m[k])) { vistos.add(m[k]); try { m[k].dispose(); } catch { /* nada */ } }
      }
      try { m.dispose(); } catch { /* nada */ }
    }
  });
  raiz.parent?.remove(raiz);
  raiz.clear?.();
}
