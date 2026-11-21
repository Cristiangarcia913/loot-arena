// Pruebas de `modelos.js` SIN red, SIN CDN y SIN GPU.
//
// La parte que habla con la red (`cargarModeloExterno`, `cargarGLTFLoader`) no se prueba aquí
// aposta: depende del CDN y del navegador, igual que `cargarTres()` en `tres.js`. Lo que SÍ se
// prueba es lo que no depende de nada de eso: la transformación `criaturaDesdeModelo` (con un
// doble de three.js, igual que en `render3d-criaturas.test.js`) y que `construirHeroe`/
// `construirEnemigo` usan de verdad un modelo externo cuando ya está en memoria, y que sin él
// (el caso normal hoy, sin ningún `.glb` en `web/assets/models/`) todo sigue exactamente igual
// que antes de este módulo.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  modeloEnMemoria, criaturaDesdeModelo, _forzarModeloParaPruebas, _olvidarModelos,
} from "../js/render3d/modelos.js";
import { construirHeroe, construirEnemigo } from "../js/render3d/criaturas.js";

// ───────────────────────── Doble mínimo de three.js ─────────────────────────
//
// `criaturaDesdeModelo` solo necesita Object3D/Mesh con `clone()`, geometría con
// `computeBoundingBox()`/`boundingBox` y materiales con `clone()`: no hace falta el doble entero
// de `render3d-criaturas.test.js` (ese es para las RECETAS procedurales, que este camino no toca).

class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  setScalar(n) { this.x = this.y = this.z = n; return this; }
}

/**
 * Matriz 4×4 mínima (columna-mayor, como `THREE.Matrix4`), solo lo que necesita
 * `criaturaDesdeModelo`: componer de posición+cuaternión+escala (misma fórmula que
 * `Matrix4.prototype.compose`), multiplicar (para encadenar padre×hijo en `updateMatrixWorld`)
 * y transformar un punto. Sin esto, un doble que solo sumara posiciones no podría reproducir el
 * bug real que motivó el recentrado por matriz: un `.glb` con una rotación de conversión de ejes
 * (Z-up → Y-up) en un antepasado de las mallas.
 */
class Mat4 {
  constructor(e) { this.e = e ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
  clone() { return new Mat4([...this.e]); }
  static compose(pos, quat, scale) {
    const { x: qx, y: qy, z: qz, w: qw } = quat;
    const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
    const xx = qx * x2, xy = qx * y2, xz = qx * z2;
    const yy = qy * y2, yz = qy * z2, zz = qz * z2;
    const wx = qw * x2, wy = qw * y2, wz = qw * z2;
    const sx = scale.x, sy = scale.y, sz = scale.z;
    const e = new Array(16);
    e[0] = (1 - (yy + zz)) * sx; e[1] = (xy + wz) * sx; e[2] = (xz - wy) * sx; e[3] = 0;
    e[4] = (xy - wz) * sy; e[5] = (1 - (xx + zz)) * sy; e[6] = (yz + wx) * sy; e[7] = 0;
    e[8] = (xz + wy) * sz; e[9] = (yz - wx) * sz; e[10] = (1 - (xx + yy)) * sz; e[11] = 0;
    e[12] = pos.x; e[13] = pos.y; e[14] = pos.z; e[15] = 1;
    return new Mat4(e);
  }
  static multiplyMatrices(a, b) {
    const ae = a.e, be = b.e, te = new Array(16);
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 4; row++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) sum += ae[k * 4 + row] * be[col * 4 + k];
        te[col * 4 + row] = sum;
      }
    }
    return new Mat4(te);
  }
  applyToPoint(x, y, z) {
    const e = this.e;
    return [
      e[0] * x + e[4] * y + e[8] * z + e[12],
      e[1] * x + e[5] * y + e[9] * z + e[13],
      e[2] * x + e[6] * y + e[10] * z + e[14],
    ];
  }
  /** Cuaternión de una rotación de `deg` grados sobre un eje unitario (para las pruebas). */
  static quatEjeAngulo([ax, ay, az], deg) {
    const rad = (deg * Math.PI) / 180 / 2;
    const s = Math.sin(rad);
    return { x: ax * s, y: ay * s, z: az * s, w: Math.cos(rad) };
  }
}

/** Caja mínima (como `THREE.Box3`): clonar, transformar por una `Mat4` y unir con otra caja. */
class Box3 {
  constructor(min, max) { this.min = { ...min }; this.max = { ...max }; }
  clone() { return new Box3(this.min, this.max); }
  applyMatrix4(m) {
    const min = { x: Infinity, y: Infinity, z: Infinity };
    const max = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (const x of [this.min.x, this.max.x]) {
      for (const y of [this.min.y, this.max.y]) {
        for (const z of [this.min.z, this.max.z]) {
          const [px, py, pz] = m.applyToPoint(x, y, z);
          min.x = Math.min(min.x, px); min.y = Math.min(min.y, py); min.z = Math.min(min.z, pz);
          max.x = Math.max(max.x, px); max.y = Math.max(max.y, py); max.z = Math.max(max.z, pz);
        }
      }
    }
    this.min = min; this.max = max;
    return this;
  }
  union(b) {
    this.min = { x: Math.min(this.min.x, b.min.x), y: Math.min(this.min.y, b.min.y), z: Math.min(this.min.z, b.min.z) };
    this.max = { x: Math.max(this.max.x, b.max.x), y: Math.max(this.max.y, b.max.y), z: Math.max(this.max.z, b.max.z) };
    return this;
  }
}

class Geo {
  constructor(min, max) { this.min = min; this.max = max; this.boundingBox = null; this.disposed = false; }
  computeBoundingBox() { this.boundingBox = new Box3(this.min, this.max); }
  clone() { const g = new Geo(this.min, this.max); g.boundingBox = this.boundingBox; return g; }
  dispose() { this.disposed = true; }
}

let idMat = 0;
class Mat {
  constructor(color = 0xffffff) { this.color = color; this.id = ++idMat; this.disposed = false; }
  clone() { return new Mat(this.color); }
  dispose() { this.disposed = true; }
}

class Obj3D {
  constructor(tipo = "Object3D") {
    this.tipo = tipo;
    this.name = "";
    this.children = [];
    this.parent = null;
    this.position = new V3();
    this.scale = new V3(1, 1, 1);
    this.quaternion = { x: 0, y: 0, z: 0, w: 1 };
    this.matrix = new Mat4();
    this.matrixWorld = new Mat4();
    this.isMesh = false;
  }
  add(...hijos) { for (const h of hijos) { h.parent = this; this.children.push(h); } return this; }
  traverse(f) { f(this); for (const c of [...this.children]) c.traverse(f); }
  /** Como `Object3D.prototype.updateMatrixWorld`: compone cada nodo y lo encadena con su padre.
   * `raiz` nunca tiene padre tras `clone()` (igual que en three.js), así que su `matrixWorld` es
   * su propia matriz: todo lo medido queda ya en el espacio de `raiz`, sin más que invertir. */
  updateMatrixWorld() {
    this.matrix = Mat4.compose(this.position, this.quaternion, this.scale);
    this.matrixWorld = this.parent ? Mat4.multiplyMatrices(this.parent.matrixWorld, this.matrix) : this.matrix.clone();
    for (const c of this.children) c.updateMatrixWorld();
  }
  clone(recursivo = true) {
    const c = new this.constructor();
    c.tipo = this.tipo;
    c.name = this.name;
    c.position = new V3(this.position.x, this.position.y, this.position.z);
    c.scale = new V3(this.scale.x, this.scale.y, this.scale.z);
    c.quaternion = { ...this.quaternion };
    if (this.isMesh) { c.isMesh = true; c.geometry = this.geometry; c.material = this.material; }
    if (recursivo) for (const h of this.children) c.add(h.clone(true));
    return c;
  }
}
class Grupo extends Obj3D { constructor() { super("Group"); } }
class Malla extends Obj3D {
  constructor(geo, mat) { super("Mesh"); this.isMesh = true; this.geometry = geo; this.material = mat; }
}

afterEach(() => _olvidarModelos());

// ───────────────────────── criaturaDesdeModelo ─────────────────────────

/** Una "criatura" de juguete: un torso a 1 m del suelo, 2 m de alto bruto, 1,2 m de ancho bruto. */
function plantillaDeJuguete() {
  const geo = new Geo({ x: -0.6, y: -1, z: -0.2 }, { x: 0.6, y: 1, z: 0.2 });
  const mat = new Mat(0x336699);
  const malla = new Malla(geo, mat);
  malla.position = new V3(0, 1, 0);
  const raiz = new Grupo();
  raiz.name = "plantilla";
  raiz.add(malla);
  return { raiz, geo, mat, malla };
}

test("criaturaDesdeModelo escala el modelo para medir la altura pedida", () => {
  const { raiz } = plantillaDeJuguete();
  const c = criaturaDesdeModelo(raiz, 1.8);
  // Altura bruta medida: de y=0 a y=2 (mundo), así que escala = 1.8 / 2 = 0.9.
  assert.ok(Math.abs(c.raiz.scale.x - 0.9) < 1e-9, `escala ${c.raiz.scale.x}, se esperaba 0.9`);
  assert.equal(c.alto, 1.8);
});

test("criaturaDesdeModelo pone el pivote en los pies aunque el modelo flote", () => {
  // Geometría que mide de y=0,2 a y=2,2 en vez de empezar en 0: el modelo "flota" medio metro.
  const geo = new Geo({ x: -0.5, y: 0.2, z: -0.2 }, { x: 0.5, y: 2.2, z: 0.2 });
  const malla = new Malla(geo, new Mat());
  const raiz = new Grupo();
  raiz.add(malla);

  const c = criaturaDesdeModelo(raiz, 2);
  // altoBruto = 2.2 - 0.2 = 2; escala = 2/2 = 1; hay que bajar el modelo 0,2 m para que el punto
  // más bajo (0,2) quede en y=0.
  assert.ok(Math.abs(c.raiz.position.y - -0.2) < 1e-9, `position.y ${c.raiz.position.y}, se esperaba -0.2`);
});

test("criaturaDesdeModelo centra el modelo en x/z aunque el archivo tenga el pivote descentrado", () => {
  // El torso mide lo mismo que en plantillaDeJuguete() pero desplazado 3 m en X y 1 m en Z: el
  // pivote del `.glb` (su nodo raíz) no tiene por qué coincidir con el centro del bulto, y sin
  // recentrar el modelo aparecería desplazado del puesto del héroe/enemigo en la arena.
  const geo = new Geo({ x: -0.6, y: -1, z: -0.2 }, { x: 0.6, y: 1, z: 0.2 });
  const malla = new Malla(geo, new Mat());
  malla.position = new V3(3, 1, 1);
  const raiz = new Grupo();
  raiz.add(malla);

  const c = criaturaDesdeModelo(raiz, 1.8);
  assert.ok(Math.abs(c.raiz.position.x - -3 * 0.9) < 1e-9, `position.x ${c.raiz.position.x}, se esperaba recentrar los 3 m de desplazamiento`);
  assert.ok(Math.abs(c.raiz.position.z - -1 * 0.9) < 1e-9, `position.z ${c.raiz.position.z}, se esperaba recentrar el 1 m de desplazamiento`);
});

test("criaturaDesdeModelo mide con la rotación de un antepasado (bug real: ejes Z-up → Y-up)", () => {
  // Muchos `.glb` exportados de Blender traen un nodo que rota -90° sobre X para convertir el eje
  // "arriba" del archivo (Z) al de three.js (Y). Un hueso bajo ese nodo con un desplazamiento local
  // en Z (su "altura" en el archivo original) tiene que medirse como ALTURA (Y) en la criatura, no
  // como profundidad (Z): sumar posiciones sin mirar la rotación (como hacía la versión anterior de
  // `criaturaDesdeModelo`) mediría justo el eje equivocado.
  const rotador = new Grupo();
  rotador.quaternion = Mat4.quatEjeAngulo([1, 0, 0], -90);
  const geo = new Geo({ x: -0.3, y: -0.3, z: -0.1 }, { x: 0.3, y: 0.3, z: 0.1 });
  const malla = new Malla(geo, new Mat());
  malla.position = new V3(0, 0, 2); // "2 m hacia arriba" en el eje Z del archivo original
  rotador.add(malla);
  const raiz = new Grupo();
  raiz.add(rotador);

  const c = criaturaDesdeModelo(raiz, 1.8);
  // Caja esperada en espacio de `raiz`: X e Z pasan tal cual (±0.3), pero la Z local del hueso
  // (2 ± 0.1) termina en Y, e Y local (±0.3) termina en −Z (rotación −90° sobre X).
  const escalaEsperada = 1.8 / 0.2; // altoBruto = 2.1 − 1.9 = 0.2
  assert.ok(Math.abs(c.raiz.scale.x - escalaEsperada) < 1e-6, `escala ${c.raiz.scale.x}, se esperaba ${escalaEsperada}`);
  assert.ok(Math.abs(c.raiz.position.y - -1.9 * escalaEsperada) < 1e-6, `position.y ${c.raiz.position.y}`);
  assert.ok(Math.abs(c.raiz.position.x) < 1e-6, "centrado en X: el bulto ya está centrado en x=0");
  assert.ok(Math.abs(c.raiz.position.z) < 1e-6, "centrado en Z: el bulto ya está centrado en z=0");
});

test("criaturaDesdeModelo clona geometría y materiales: no comparte memoria con la plantilla", () => {
  const { raiz, geo, mat } = plantillaDeJuguete();
  const c = criaturaDesdeModelo(raiz, 1.8);

  assert.notEqual(c.raiz, raiz, "la raíz tiene que ser una copia, no la plantilla");
  const mallaClon = c.raiz.children[0];
  assert.notEqual(mallaClon.geometry, geo, "la geometría no se clonó");
  assert.notEqual(mallaClon.material, mat, "el material no se clonó");
  assert.equal(mallaClon.material.color, mat.color, "el clon debería tener el mismo color");

  assert.equal(c.materiales.length, 1);
  assert.equal(c.materiales[0], mallaClon.material);

  // Dos criaturas del mismo modelo no pueden compartir nada: si una se libera, la otra no se
  // puede quedar con un dispose() de más.
  const c2 = criaturaDesdeModelo(raiz, 1.8);
  assert.notEqual(c.raiz.children[0].geometry, c2.raiz.children[0].geometry);
  assert.notEqual(c.materiales[0], c2.materiales[0]);
});

test("criaturaDesdeModelo nunca revienta con un modelo vacío", () => {
  const vacio = new Grupo();
  assert.doesNotThrow(() => {
    const c = criaturaDesdeModelo(vacio, 1.8);
    assert.ok(c.alto > 0);
    assert.ok(c.radio > 0);
    assert.deepEqual(c.materiales, []);
  });
});

test("el contrato de la criatura es el mismo que el de las recetas procedurales", () => {
  const { raiz } = plantillaDeJuguete();
  const c = criaturaDesdeModelo(raiz, 1.8);
  for (const campo of ["raiz", "taller", "alto", "radio", "partes", "materiales", "flota"]) {
    assert.ok(campo in c, `falta "${campo}" en la criatura externa`);
  }
  assert.equal(typeof c.taller.liberar, "function");
  assert.doesNotThrow(() => c.taller.liberar());
  assert.equal(c.externo, true);
});

// ───────────────────────── modeloEnMemoria / caché de pruebas ─────────────────────────

test("modeloEnMemoria no sabe nada hasta que se le fuerza o se pide de verdad", () => {
  assert.equal(modeloEnMemoria("heroe"), undefined);
  _forzarModeloParaPruebas("heroe", { marca: "plantilla de prueba" });
  assert.deepEqual(modeloEnMemoria("heroe"), { marca: "plantilla de prueba" });
  _olvidarModelos();
  assert.equal(modeloEnMemoria("heroe"), undefined);
});

// ───────────────────────── Integración con criaturas.js ─────────────────────────

test("construirHeroe usa el modelo externo si ya está en memoria", () => {
  const { raiz } = plantillaDeJuguete();
  _forzarModeloParaPruebas("heroe", raiz);
  const h = construirHeroe({}, [{ tipo: "Espada", rareza: 2 }], {}, {});
  assert.equal(h.externo, true, "construirHeroe debería haber usado el modelo externo");
  assert.notEqual(h.raiz, raiz, "tiene que devolver una copia, no la plantilla");
});

// La vía SIN modelo externo (el caso de hoy, sin ningún `.glb` en `web/assets/models/`) no se
// repite aquí: `render3d-criaturas.test.js` nunca fuerza nada en `modelos.js` y construye decenas
// de criaturas distintas con el doble completo de three.js, así que esa suite entera es ya la
// prueba de que el camino procedural sigue intacto.

test("construirEnemigo usa el modelo externo si ya está en memoria, y respeta la altura del bestiario", () => {
  const { raiz } = plantillaDeJuguete();
  _forzarModeloParaPruebas("dragon", raiz);
  const d = construirEnemigo({}, "dragon", {});
  assert.equal(d.externo, true);
  assert.equal(d.clave, "dragon");
  assert.ok(d.colores, "un enemigo externo también necesita paleta de color para las partículas");
  assert.ok(d.alto > 0 && d.radio > 0);
});

test("un jefe con modelo externo sale más grande, aunque sin corona", () => {
  const { raiz } = plantillaDeJuguete();
  _forzarModeloParaPruebas("orco", raiz);
  const normal = construirEnemigo({}, "orco", {});
  const jefe = construirEnemigo({}, "orco", { jefe: true });
  assert.ok(jefe.raiz.scale.x > normal.raiz.scale.x, "el jefe externo no es más grande");
  assert.equal(jefe.partes.corona, undefined, "un modelo externo no tiene corona procedural");
  assert.equal(jefe.jefe, true);
});

test("cada .glb de assets/models tiene ojos que brillan configurados (OJOS_MODELOS)", async () => {
  const { readdirSync } = await import("node:fs");
  const { OJOS_MODELOS, esMaterialDeOjos, ROTACION_Y_MODELOS } = await import("../js/render3d/modelos.js");
  const glb = readdirSync(new URL("../assets/models/", import.meta.url)).filter((f) => f.endsWith(".glb")).map((f) => f.replace(".glb", ""));
  for (const nombre of glb) {
    const cfg = OJOS_MODELOS[nombre];
    assert.ok(cfg?.color != null, `${nombre}.glb sin ojos configurados`);
    if (cfg.pos) assert.ok(cfg.r > 0 && cfg.sep > 0 && [0, 1, 2].includes(cfg.eje), `${nombre}: ojos mal definidos`);
  }
  assert.ok(esMaterialDeOjos({ name: "Eyes" }) && esMaterialDeOjos({ name: "ojo_izq" }));
  assert.ok(!esMaterialDeOjos({ name: "Body" }) && !esMaterialDeOjos(null));
  // lobo.glb tiene el hocico en +X: −π/2 lo pone de cara al rival (+Z), +π/2 le daba la espalda.
  assert.equal(ROTACION_Y_MODELOS.lobo, -Math.PI / 2);
});
