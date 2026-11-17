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

class Geo {
  constructor(min, max) { this.min = min; this.max = max; this.boundingBox = null; this.disposed = false; }
  computeBoundingBox() { this.boundingBox = { min: { ...this.min }, max: { ...this.max } }; }
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
    this.position = new V3();
    this.scale = new V3(1, 1, 1);
    this.isMesh = false;
  }
  add(...hijos) { for (const h of hijos) this.children.push(h); return this; }
  traverse(f) { f(this); for (const c of [...this.children]) c.traverse(f); }
  clone(recursivo = true) {
    const c = new this.constructor();
    c.tipo = this.tipo;
    c.name = this.name;
    c.position = new V3(this.position.x, this.position.y, this.position.z);
    c.scale = new V3(this.scale.x, this.scale.y, this.scale.z);
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
