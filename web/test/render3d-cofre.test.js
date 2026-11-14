// Pruebas del cofre del botín. Lo que se comprueba aquí no es que «se vea bonito», que eso hay
// que mirarlo: es que **la rareza se lea sin leer el texto**. Para eso el cofre usa tres señales
// a la vez (color, luz y tiempo) y las tres tienen que crecer con la rareza. Si una dejara de
// hacerlo, el jugador perdería una pista y nadie se daría cuenta hasta que alguien se quejara.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  construirCofre, pasoCofre, rarezaValida, rarezasDistinguibles,
  DURACION, ALTURA_HAZ, CHISPAS,
} from "../js/render3d/cofre.js";
import { rareza3d } from "../js/render3d/paleta.js";
import { Taller } from "../js/render3d/piezas.js";

// Doble de three.js: el mismo enfoque que en las otras pruebas del motor.
class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  setScalar(n) { return this.set(n, n, n); }
  copy(o) { return this.set(o.x, o.y, o.z); }
  clone() { return new V3(this.x, this.y, this.z); }
  lerp() { return this; }
}
class Col { constructor(v = 0) { this.v = v; } set(v) { this.v = v; return this; } copy(o) { this.v = o.v; return this; } clone() { return new Col(this.v); } lerp() { return this; } getHex() { return this.v; } }
class Rec { constructor(t) { this.tipo = t; } dispose() { this.liberado = true; } }
class Geo extends Rec { constructor(t) { super(t); this.attributes = {}; } setAttribute(n, a) { this.attributes[n] = a; return this; } }
class Mat extends Rec {
  constructor(o = {}) { super("mat"); Object.assign(this, o); this.userData = {}; if (o.emissive != null) { this.emissive = new Col(o.emissive); this.emissiveIntensity = o.emissiveIntensity ?? 1; } this.opacity = o.opacity ?? 1; }
}
class Obj {
  constructor(t = "o") { this.tipo = t; this.name = ""; this.children = []; this.parent = null; this.position = new V3(); this.rotation = new V3(); this.scale = new V3(1, 1, 1); this.userData = {}; this.visible = true; }
  add(...o) { for (const x of o) { x.parent = this; this.children.push(x); } return this; }
  remove(o) { const i = this.children.indexOf(o); if (i >= 0) this.children.splice(i, 1); return this; }
  clear() { this.children.length = 0; return this; }
  traverse(f) { f(this); for (const c of [...this.children]) c.traverse?.(f); }
}
class Malla extends Obj { constructor(g, m) { super("Mesh"); this.geometry = g; this.material = m; } }
const g = (n) => class extends Geo { constructor() { super(n); } };
const T = {
  Group: class extends Obj {}, Object3D: Obj, Mesh: Malla,
  BoxGeometry: g("box"), SphereGeometry: g("sphere"), CylinderGeometry: g("cyl"), ConeGeometry: g("cone"),
  CapsuleGeometry: g("cap"), TorusGeometry: g("torus"), PlaneGeometry: g("plane"),
  IcosahedronGeometry: g("ico"), CircleGeometry: g("circle"),
  MeshStandardMaterial: Mat, MeshBasicMaterial: Mat,
  Color: Col, Vector3: V3, DoubleSide: "d", AdditiveBlending: "a",
};
const OPC = { segmentos: 16, sombras: false };

const RAREZAS = [0, 1, 2];
const NOMBRE = ["común", "raro", "legendario"];

// ───────────────────────── Leer la rareza sin leer el texto ─────────────────────────

test("las tres rarezas se distinguen por tiempo, luz y chispas a la vez", () => {
  assert.equal(rarezasDistinguibles(), true);
});

test("un legendario se hace esperar más que un común", () => {
  // El tiempo es media señal: si todos se abrieran igual de rápido, solo quedaría el color.
  assert.ok(DURACION[2] > DURACION[1] && DURACION[1] > DURACION[0]);
  assert.ok(DURACION[2] / DURACION[0] >= 1.8, "la diferencia tiene que notarse, no ser sutil");
});

test("pero ni el legendario se hace largo: esto se ve cientos de veces", () => {
  // La regla del encargo: corto antes que largo.
  for (const r of RAREZAS) {
    assert.ok(DURACION[r] <= 1300, `un ${NOMBRE[r]} tarda ${DURACION[r]} ms, demasiado para repetirlo tanto`);
  }
});

test("el haz de luz crece con la rareza y se ve desde lejos", () => {
  assert.ok(ALTURA_HAZ[2] > ALTURA_HAZ[1] && ALTURA_HAZ[1] > ALTURA_HAZ[0]);
  assert.ok(ALTURA_HAZ[2] >= 3, "el haz de un legendario tiene que salirse por arriba del cofre");
  assert.ok(ALTURA_HAZ[0] < ALTURA_HAZ[2] / 2, "el de un común tiene que quedarse corto en comparación");
});

test("cada rareza usa el color de la rareza, el mismo que el 2D", () => {
  for (const r of RAREZAS) {
    const c = construirCofre(T, r, OPC);
    const colores = new Set(c.materiales.map((m) => m.color));
    const pal = rareza3d(r);
    assert.ok(colores.has(pal.base) || colores.has(pal.luz),
      `el cofre ${NOMBRE[r]} no usa su color de rareza`);
    assert.equal(c.rareza, r);
    c.taller.liberar();
  }
});

test("el cofre legendario brilla y el común no", () => {
  const brillo = (r) => { const c = construirCofre(T, r, OPC); const b = c.materiales.reduce((a, m) => a + (m.emissiveIntensity ?? 0), 0); c.taller.liberar(); return b; };
  assert.ok(brillo(2) > brillo(0), "un legendario tiene que brillar más que un común");
});

// ───────────────────────── La animación ─────────────────────────

test("el cofre empieza enterrado y cerrado, y acaba fuera y abierto", () => {
  for (const r of RAREZAS) {
    const ini = pasoCofre(0, r), fin = pasoCofre(1, r);
    assert.equal(ini.subir, 0, "al principio está bajo tierra");
    assert.equal(ini.tapa, 0, "y cerrado");
    assert.equal(ini.haz, 0, "sin luz todavía");
    assert.equal(fin.subir, 1, "al final ha salido del todo");
    assert.ok(fin.tapa > 1, "y la tapa está bien abierta");
    assert.ok(fin.haz > 0, "con su haz encendido");
  }
});

test("la tapa no se abre hasta que el cofre ha salido del suelo", () => {
  for (const r of RAREZAS) {
    for (let p = 0; p <= 0.5; p += 0.05) {
      assert.equal(pasoCofre(p, r).tapa, 0, `en p=${p.toFixed(2)} la tapa ya se estaba abriendo`);
    }
    assert.equal(pasoCofre(0.3, r).subir, 1, "a mitad de camino ya tiene que estar fuera");
  }
});

test("la luz aparece con la apertura, no antes", () => {
  for (const r of RAREZAS) {
    assert.equal(pasoCofre(0.49, r).interior, 0, "no puede haber luz con la tapa cerrada");
    assert.ok(pasoCofre(0.7, r).interior > 0, "abierto tiene que haber luz dentro");
  }
});

test("el cofre tiembla antes de abrirse, y más cuanto mejor es el botín", () => {
  const maxTemblor = (r) => {
    let m = 0;
    for (let p = 0; p <= 1; p += 0.005) m = Math.max(m, Math.abs(pasoCofre(p, r).sacudir));
    return m;
  };
  assert.ok(maxTemblor(0) > 0, "hasta el común tiene que dar algo de suspense");
  assert.ok(maxTemblor(2) > maxTemblor(0), "un legendario tiene que temblar más");
  assert.equal(pasoCofre(0.95, 2).sacudir, 0, "una vez abierto deja de temblar");
});

test("la animación es monótona: nada va hacia atrás a mitad", () => {
  for (const r of RAREZAS) {
    let subirPrevio = -1, tapaPrevia = -1;
    for (let p = 0; p <= 1; p += 0.01) {
      const e = pasoCofre(p, r);
      assert.ok(e.subir >= subirPrevio - 1e-9, `el cofre volvió a hundirse en p=${p.toFixed(2)}`);
      assert.ok(e.tapa >= tapaPrevia - 1e-9, `la tapa volvió a cerrarse en p=${p.toFixed(2)}`);
      subirPrevio = e.subir;
      tapaPrevia = e.tapa;
    }
  }
});

test("pasoCofre aguanta cualquier basura que le llegue", () => {
  for (const p of [-5, 0, 1, 99, NaN, undefined, null, "x"]) {
    for (const r of [-1, 0, 2, 7, NaN, undefined, "a"]) {
      const e = pasoCofre(p, r);
      for (const [k, v] of Object.entries(e)) {
        assert.ok(Number.isFinite(v), `pasoCofre(${p}, ${r}).${k} no es un número: ${v}`);
      }
    }
  }
});

test("rarezaValida recorta en vez de fallar", () => {
  assert.equal(rarezaValida(2), 2);
  assert.equal(rarezaValida(9), 2);
  assert.equal(rarezaValida(-3), 0);
  assert.equal(rarezaValida("no"), 0);
  assert.equal(rarezaValida(undefined), 0);
  assert.equal(rarezaValida(1.7), 1);
});

// ───────────────────────── Estructura y memoria ─────────────────────────

test("el cofre tiene las piezas que la escena necesita animar", () => {
  const c = construirCofre(T, 2, OPC);
  for (const k of ["cuerpo", "tapa", "haz", "interior", "anillo"]) {
    assert.ok(c.partes[k], `al cofre le falta la pieza «${k}»`);
  }
  assert.ok(c.partes.haz.children.length >= 1, "el haz tiene que tener algo que pintar");
  assert.ok(c.alto > 0);
  c.taller.liberar();
});

test("el cofre empieza con el haz y el interior apagados", () => {
  // Si empezaran encendidos, se vería el fogonazo antes de que el cofre salga del suelo.
  const c = construirCofre(T, 2, OPC);
  assert.equal(c.partes.interior.material.opacity, 0);
  for (const h of c.partes.haz.children) assert.equal(h.material.opacity, 0);
  c.taller.liberar();
});

test("liberar el cofre devuelve todo a la GPU", () => {
  const c = construirCofre(T, 1, OPC);
  const n = c.taller.recursos.size;
  assert.ok(n > 8, "debería haber apuntado unas cuantas geometrías y materiales");
  c.taller.liberar();
  assert.equal(c.taller.recursos.size, 0);
  assert.doesNotThrow(() => c.taller.liberar(), "liberar dos veces no puede fallar");
});

test("el cofre no es más caro que una criatura", () => {
  // Va a la misma caché que las criaturas, así que conviene que no se dispare.
  const c = construirCofre(T, 2, OPC);
  let mallas = 0;
  c.raiz.traverse((n) => { if (n.geometry) mallas++; });
  assert.ok(mallas <= 25, `el cofre tiene ${mallas} mallas; se está yendo de las manos`);
  c.taller.liberar();
});

test("el taller del cofre es suyo: dos cofres no comparten materiales", () => {
  const a = construirCofre(T, 0, OPC);
  const b = construirCofre(T, 2, OPC);
  assert.equal(a.materiales.some((m) => b.materiales.includes(m)), false);
  a.taller.liberar();
  b.taller.liberar();
});

test("construirCofre no revienta con una rareza inventada", () => {
  assert.doesNotThrow(() => construirCofre(T, 99, OPC).taller.liberar());
  assert.doesNotThrow(() => construirCofre(T, undefined, OPC).taller.liberar());
  assert.equal(construirCofre(T, -1, OPC).rareza, 0);
});

test("usa el Taller del motor, así que lo libera quien libera todo lo demás", () => {
  const c = construirCofre(T, 1, OPC);
  assert.ok(c.taller instanceof Taller);
  c.taller.liberar();
});
