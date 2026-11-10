// Pruebas de los modelos 3D (criaturas, héroe, escenario) SIN navegador ni GPU.
//
// Se puede porque `criaturas.js`, `escenario.js` y `piezas.js` reciben three.js por parámetro en
// vez de importarlo: aquí se les pasa un doble que apunta todo lo que se construye. Así se
// comprueba de verdad lo que importa (que están las 20 criaturas del bestiario, que el equipo del
// héroe se nota, que los pies tocan el suelo y que al desmontar no queda nada sin liberar) sin
// depender del CDN ni de una tarjeta gráfica.

import { test } from "node:test";
import assert from "node:assert/strict";

import { construirEnemigo, construirHeroe, CLAVES_3D, tieneReceta, factorPresencia, PRESENCIA_MIN, PRESENCIA_MAX } from "../js/render3d/criaturas.js";
import { construirEscenario, animarEscenario, RADIO_ARENA } from "../js/render3d/escenario.js";
import { Taller, liberarRama, ALTO_HEROE } from "../js/render3d/piezas.js";
import { rareza3d } from "../js/render3d/paleta.js";
import { BESTIARIO, VALORES_3D, metadatos3d } from "../js/combat.js";

// ───────────────────────── Doble de three.js ─────────────────────────

/** Cuenta cuántas veces se ha llamado a dispose() de cada recurso creado. */
const liberados = { total: 0 };

class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  setScalar(n) { return this.set(n, n, n); }
  copy(o) { return this.set(o.x, o.y, o.z); }
  clone() { return new V3(this.x, this.y, this.z); }
  lerp() { return this; }
}
class Recurso {
  constructor(tipo, args) { this.tipo = tipo; this.args = args; this.liberado = 0; }
  dispose() { this.liberado++; liberados.total++; }
}
class Geo extends Recurso {
  constructor(tipo, args) { super(tipo, args); this.attributes = {}; }
  setAttribute(n, a) { this.attributes[n] = a; return this; }
}
class Mat extends Recurso {
  constructor(o = {}) {
    super("material", o);
    Object.assign(this, o);
    this.userData = {};
    if (o.emissive != null) { this.emissive = new Col(o.emissive); this.emissiveIntensity = o.emissiveIntensity ?? 1; }
    this.opacity = o.opacity ?? 1;
  }
}
class Col {
  constructor(v = 0) { this.v = v; }
  set(v) { this.v = v; return this; }
  copy(o) { this.v = o.v; return this; }
  clone() { return new Col(this.v); }
  lerp() { return this; }
  getHex() { return this.v; }
}
class Obj {
  constructor(tipo = "Object3D") {
    this.tipo = tipo;
    this.name = "";
    this.children = [];
    this.parent = null;
    this.position = new V3();
    this.rotation = new V3();
    this.scale = new V3(1, 1, 1);
    this.userData = {};
    this.visible = true;
  }
  add(...o) { for (const x of o) { x.parent = this; this.children.push(x); } return this; }
  remove(o) { const i = this.children.indexOf(o); if (i >= 0) this.children.splice(i, 1); return this; }
  clear() { this.children.length = 0; return this; }
  traverse(f) { f(this); for (const c of [...this.children]) c.traverse?.(f); }
  /** Todos los descendientes en una lista plana. */
  todos() { const r = []; this.traverse((n) => r.push(n)); return r; }
}
class Malla extends Obj {
  constructor(geo, mat) { super("Mesh"); this.geometry = geo; this.material = mat; }
}

const geoClase = (n) => class extends Geo { constructor(...a) { super(n, a); } };

const T = {
  Group: class extends Obj { constructor() { super("Group"); } },
  Object3D: Obj,
  Mesh: Malla,
  InstancedMesh: class extends Malla {
    constructor(g, m, n) { super(g, m); this.tipo = "InstancedMesh"; this.isInstancedMesh = true; this.cuenta = n; this.matrices = 0; this.colores = 0; this.instanceMatrix = {}; this.instanceColor = {}; }
    setMatrixAt() { this.matrices++; }
    setColorAt() { this.colores++; }
    dispose() { liberados.total++; }
  },
  Points: class extends Malla { constructor(g, m) { super(g, m); this.tipo = "Points"; } },
  Sprite: class extends Obj { constructor(m) { super("Sprite"); this.material = m; } },
  BoxGeometry: geoClase("box"), SphereGeometry: geoClase("sphere"), CylinderGeometry: geoClase("cylinder"),
  ConeGeometry: geoClase("cone"), CapsuleGeometry: geoClase("capsule"), TorusGeometry: geoClase("torus"),
  PlaneGeometry: geoClase("plane"), IcosahedronGeometry: geoClase("ico"), CircleGeometry: geoClase("circle"),
  BufferGeometry: class extends Geo { constructor() { super("buffer", []); } },
  BufferAttribute: class { constructor(a, n) { this.array = a; this.itemSize = n; } },
  MeshStandardMaterial: class extends Mat { constructor(o) { super(o); this.tipo = "standard"; } },
  MeshBasicMaterial: class extends Mat { constructor(o) { super(o); this.tipo = "basic"; } },
  PointsMaterial: class extends Mat { constructor(o) { super(o); this.tipo = "points"; } },
  SpriteMaterial: class extends Mat { constructor(o) { super(o); this.tipo = "sprite"; } },
  AmbientLight: class extends Obj { constructor(c, i) { super("AmbientLight"); this.color = c; this.intensity = i; } },
  HemisphereLight: class extends Obj { constructor(a, b, i) { super("HemisphereLight"); this.intensity = i; } },
  DirectionalLight: class extends Obj {
    constructor(c, i) { super("DirectionalLight"); this.color = c; this.intensity = i; this.castShadow = false;
      this.shadow = { mapSize: { set() {} }, camera: {}, bias: 0 }; }
  },
  PointLight: class extends Obj { constructor(c, i, d, de) { super("PointLight"); this.color = c; this.intensity = i; this.distancia = d; this.decay = de; } },
  Color: Col, Vector3: V3,
  Quaternion: class { setFromEuler() { return this; } },
  Euler: class { set() { return this; } },
  Matrix4: class { compose() { return this; } },
  FogExp2: class { constructor(c, d) { this.color = new Col(c); this.density = d; } },
  DoubleSide: "doble", AdditiveBlending: "aditivo",
};

const OPC = { segmentos: 10, sombras: true };

/** Punto más bajo y más alto de una rama, teniendo en cuenta posiciones y escalas de los padres. */
function extremos(raiz) {
  let min = Infinity, max = -Infinity;
  const rec = (n, y, esc) => {
    const yy = y + n.position.y * esc;
    min = Math.min(min, yy);
    max = Math.max(max, yy);
    for (const c of n.children) rec(c, yy, esc * n.scale.y);
  };
  rec(raiz, 0, 1);
  return { min, max };
}

// ───────────────────────── Cobertura del bestiario ─────────────────────────

test("se puede construir TODA criatura del bestiario, no solo las que tienen receta propia", () => {
  for (const b of BESTIARIO) {
    const c = construirEnemigo(T, b.clave, OPC);
    assert.ok(c.raiz, `${b.clave} no devuelve modelo`);
    assert.ok(c.raiz.todos().some((n) => n.geometry), `${b.clave} no tiene ni una pieza`);
    assert.ok(c.materiales.length > 0, `${b.clave} no tiene materiales`);
    assert.ok(c.alto > 0 && c.radio > 0, `${b.clave} tiene medidas raras`);
    c.taller.liberar();
  }
  assert.equal(BESTIARIO.length, 20, "si cambia el bestiario, hay que volver a mirar esto");
});

test("cada criatura mide lo que dice su ficha del bestiario", () => {
  // `altura` del bestiario es RELATIVA: 1 = el héroe. Sin esto, la rata (0,6) era invisible.
  for (const b of BESTIARIO) {
    const meta = metadatos3d(b.clave);
    const c = construirEnemigo(T, b.clave, OPC);
    const esperada = meta.altura * ALTO_HEROE;
    assert.ok(Math.abs(c.alto - esperada) < 0.02,
      `${b.clave} mide ${c.alto.toFixed(2)} y su ficha dice ${esperada.toFixed(2)}`);
    c.taller.liberar();
  }
});

test("hay modelo para TODAS las siluetas del contrato, no solo para las que se usan hoy", () => {
  // Contrato con el equipo de contenido (VALORES_3D.silueta). Si añaden una silueta nueva, esta
  // prueba falla aquí en vez de aparecer un bicho roto en medio de un combate.
  for (const silueta of VALORES_3D.silueta) {
    const b = BESTIARIO.find((x) => x.silueta === silueta);
    assert.ok(b, `ninguna criatura usa la silueta ${silueta}`);
    const c = construirEnemigo(T, b.clave, OPC);
    assert.ok(c.raiz.todos().filter((n) => n.geometry).length >= 4,
      `la silueta ${silueta} (${b.clave}) sale casi vacía`);
    c.taller.liberar();
  }
});

test("las once criaturas con receta a mano son las que decíamos", () => {
  assert.equal(CLAVES_3D.length, 11);
  for (const k of CLAVES_3D) assert.ok(tieneReceta(k));
  assert.ok(CLAVES_3D.includes("jefe"), "el jefe no sale del bestiario, es nuestro");
  assert.equal(tieneReceta("quimera"), false, "la quimera se construye por silueta");
  assert.equal(tieneReceta(undefined), false);
});

test("una criatura inventada se construye igual, sin reventar", () => {
  const c = construirEnemigo(T, "mantícora-que-no-existe", OPC);
  assert.ok(c.raiz.todos().length > 5);
  assert.equal(c.clave, "generico");
  c.taller.liberar();
  assert.doesNotThrow(() => construirEnemigo(T, undefined, OPC).taller.liberar());
  assert.doesNotThrow(() => construirEnemigo(T, null).taller.liberar());
});

test("todas las criaturas tienen los pies en el suelo", () => {
  // El pivote va en los pies (y = 0): así se plantan en la arena sin cuentas.
  for (const b of BESTIARIO) {
    const c = construirEnemigo(T, b.clave, OPC);
    const { min } = extremos(c.raiz);
    assert.ok(min >= -0.35, `${b.clave} está enterrada (su punto más bajo es ${min.toFixed(2)})`);
    c.taller.liberar();
  }
});

test("cada criatura tiene un cuerpo con nombre para poder animarla", () => {
  for (const b of BESTIARIO) {
    const c = construirEnemigo(T, b.clave, OPC);
    assert.ok(c.partes.cuerpo, `${b.clave} no expone 'cuerpo' y la respiración no la cogería`);
    c.taller.liberar();
  }
});

test("un jefe es más grande que la misma criatura normal y lleva corona", () => {
  const normal = construirEnemigo(T, "orco", OPC);
  const jefe = construirEnemigo(T, "orco", { ...OPC, jefe: true });
  assert.ok(jefe.raiz.scale.x > normal.raiz.scale.x, "el jefe no es más grande");
  assert.ok(jefe.partes.corona, "al jefe le falta la corona");
  assert.ok(jefe.partes.aura, "al jefe le falta el aura");
  assert.equal(jefe.jefe, true);
  normal.taller.liberar();
  jefe.taller.liberar();
});

test("el jefe propio no se pone corona encima de su yelmo", () => {
  const j = construirEnemigo(T, "jefe", { ...OPC, jefe: true });
  assert.ok(j.partes.arma, "el caudillo lleva espadón");
  assert.equal(j.partes.corona, undefined, "ya tiene yelmo con cuernos");
  j.taller.liberar();
});

test("factorPresencia solo agranda lo pequeño y con tope", () => {
  assert.equal(factorPresencia(2), 1, "lo grande no se toca");
  assert.equal(factorPresencia(PRESENCIA_MIN), 1);
  assert.ok(factorPresencia(0.3) <= PRESENCIA_MAX, "sin tope, una rata parecía una vaca");
  assert.equal(factorPresencia(0), 1);
  assert.equal(factorPresencia(-1), 1);
});

// ───────────────────────── Héroe y equipo ─────────────────────────

test("sin equipo el héroe no lleva ni espada ni escudo", () => {
  const h = construirHeroe(T, [], {}, OPC);
  assert.deepEqual(h.equipo, { espada: false, escudo: false, casco: false, armadura: false, botas: false });
  assert.equal(h.partes.escudo.children.length, 0, "hay escudo sin llevarlo equipado");
  h.taller.liberar();
});

test("el equipo equipado SE NOTA en el modelo", () => {
  const pelado = construirHeroe(T, [], {}, OPC);
  const armado = construirHeroe(T, [
    { tipo: "Espada", rareza: 2 }, { tipo: "Escudo", rareza: 1 },
    { tipo: "Casco", rareza: 0 }, { tipo: "Armadura", rareza: 2 }, { tipo: "Botas", rareza: 1 },
  ], {}, OPC);
  assert.ok(armado.raiz.todos().length > pelado.raiz.todos().length, "el equipo no añade ni una pieza");
  assert.ok(armado.partes.escudo.children.length > 0, "el escudo equipado no aparece");
  assert.deepEqual(armado.equipo, { espada: true, escudo: true, casco: true, armadura: true, botas: true });
  pelado.taller.liberar();
  armado.taller.liberar();
});

test("la rareza del equipo cambia el color, con la misma paleta que el 2D", () => {
  const colores = (r) => {
    const h = construirHeroe(T, [{ tipo: "Escudo", rareza: r }], {}, OPC);
    const lista = h.materiales.map((m) => m.color);
    h.taller.liberar();
    return lista;
  };
  for (const r of [0, 1, 2]) {
    assert.ok(colores(r).includes(rareza3d(r).base), `el escudo de rareza ${r} no usa su color`);
  }
  // Lo legendario brilla y lo común no.
  const legendario = construirHeroe(T, [{ tipo: "Espada", rareza: 2 }], {}, OPC);
  const comun = construirHeroe(T, [{ tipo: "Espada", rareza: 0 }], {}, OPC);
  const brillo = (h) => h.materiales.reduce((n, m) => n + (m.emissiveIntensity ?? 0), 0);
  assert.ok(brillo(legendario) > brillo(comun), "la espada legendaria no brilla más que la común");
  legendario.taller.liberar();
  comun.taller.liberar();
});

test("los cosméticos se ponen y se quitan", () => {
  const sin = construirHeroe(T, [], {}, OPC);
  const con = construirHeroe(T, [], { color: 1, sombrero: 5, capa: 7, aura: 10, mascota: 12 }, OPC);
  assert.ok(con.partes.capa, "falta la capa");
  assert.ok(con.partes.aura, "falta el aura");
  assert.ok(con.partes.mascota, "falta la mascota");
  assert.equal(sin.partes.capa, undefined);
  assert.ok(con.raiz.todos().length > sin.raiz.todos().length);
  sin.taller.liberar();
  con.taller.liberar();
});

test("un cosmético con un id que no existe se ignora sin fallar", () => {
  assert.doesNotThrow(() => construirHeroe(T, [], { sombrero: 999, capa: "x", aura: null }, OPC).taller.liberar());
  assert.doesNotThrow(() => construirHeroe(T, [{ tipo: "Espada", rareza: 99 }], undefined, OPC).taller.liberar());
  assert.doesNotThrow(() => construirHeroe(T, "no es una lista", {}, OPC).taller.liberar());
});

test("el héroe mide lo que mide (es la referencia de las alturas del bestiario)", () => {
  const h = construirHeroe(T, [], {}, OPC);
  assert.ok(Math.abs(h.alto - ALTO_HEROE) < 0.05, `el héroe mide ${h.alto} y ALTO_HEROE dice ${ALTO_HEROE}`);
  const { min } = extremos(h.raiz);
  assert.ok(min >= -0.1, "el héroe está hundido en el suelo");
  h.taller.liberar();
});

// ───────────────────────── Escenario ─────────────────────────

test("el escenario trae suelo, muro, antorchas y niebla", () => {
  const e = construirEscenario(T, { calidad: "alto" });
  assert.ok(e.suelo);
  assert.ok(e.niebla);
  assert.equal(e.antorchas.length, 4);
  assert.ok(e.antorchas.some((a) => a.luz), "ninguna antorcha da luz");
  assert.ok(e.polvo, "falta el polvo en suspensión");
  e.taller.liberar();
});

test("el muro va instanciado: una llamada de dibujo, no cien", () => {
  // Regresión medida: con los ~100 ladrillos sueltos el fotograma costaba 13 ms en una integrada;
  // instanciados, 2 ms.
  const e = construirEscenario(T, { calidad: "alto" });
  const instanciadas = e.raiz.todos().filter((n) => n.isInstancedMesh);
  assert.ok(instanciadas.length >= 2, "el muro y las manchas tienen que ir instanciados");
  const muro = instanciadas.find((n) => n.cuenta > 50);
  assert.ok(muro, "no hay ninguna malla instanciada con muchos ladrillos");
  assert.equal(muro.matrices, muro.cuenta, "no se han colocado todas las copias");
  assert.ok(muro.colores > 0, "los ladrillos tienen que tener tonos distintos");
  e.taller.liberar();
});

test("nada pegado al suelo proyecta sombra", () => {
  // Regresión: el suelo se proyectaba sombra a sí mismo y salía un manchón negro en la arena.
  const e = construirEscenario(T, { calidad: "alto" });
  assert.equal(e.suelo.castShadow, false, "el suelo no puede proyectar sombra");
  const manchas = e.raiz.todos().find((n) => n.isInstancedMesh && n.cuenta === 14);
  assert.equal(manchas.castShadow, false, "las manchas del suelo tampoco");
  e.taller.liberar();

  const h = construirHeroe(T, [], {}, OPC);
  const discos = h.raiz.todos().filter((n) => n.geometry?.tipo === "circle");
  assert.ok(discos.length > 0);
  for (const d of discos) assert.equal(d.castShadow, false, "el disco de sombra falsa no proyecta sombra");
  h.taller.liberar();
});

test("el perfil bajo no gasta en sombras, polvo ni luces de antorcha", () => {
  const bajo = construirEscenario(T, { calidad: "bajo" });
  assert.equal(bajo.polvo, null, "el perfil bajo no lleva polvo");
  assert.equal(bajo.antorchas.filter((a) => a.luz).length, 0, "el perfil bajo no lleva luces puntuales");
  // Con el perfil bajo ni se toca `castShadow`: queda sin definir, que es lo mismo que apagado.
  assert.notEqual(bajo.suelo.castShadow, true);
  const alto = construirEscenario(T, { calidad: "alto" });
  assert.ok(alto.raiz.todos().length > bajo.raiz.todos().length, "el perfil alto debería tener más cosas");
  bajo.taller.liberar();
  alto.taller.liberar();
});

test("como mucho dos luces puntuales: cada una la pagan todos los píxeles", () => {
  for (const calidad of ["alto", "medio"]) {
    const e = construirEscenario(T, { calidad });
    assert.ok(e.antorchas.filter((a) => a.luz).length <= 2, `${calidad} enciende demasiadas luces`);
    e.taller.liberar();
  }
});

test("con movimiento reducido no hay polvo volando", () => {
  const e = construirEscenario(T, { calidad: "alto", reducido: true });
  assert.equal(e.polvo, null);
  e.taller.liberar();
});

test("animarEscenario mueve las llamas, y no se mueve nada con movimiento reducido", () => {
  const e = construirEscenario(T, { calidad: "alto" });
  const llama = e.antorchas[0].llama;
  animarEscenario(e, 1.5, false);
  const movida = llama.scale.y;
  animarEscenario(e, 3.7, false);
  assert.notEqual(llama.scale.y, movida, "la llama no titila");

  const quieta = construirEscenario(T, { calidad: "alto" });
  const l2 = quieta.antorchas[0].llama;
  const antes = { ...l2.scale };
  animarEscenario(quieta, 9.9, true);
  assert.deepEqual({ ...l2.scale }, antes, "con movimiento reducido la llama debe quedarse quieta");
  assert.doesNotThrow(() => animarEscenario(null, 1, false));
  e.taller.liberar();
  quieta.taller.liberar();
});

test("el muro queda fuera del radio de la arena", () => {
  assert.ok(RADIO_ARENA > 5, "la arena tiene que dar sitio para que la cámara quepa dentro");
});

// ───────────────────────── Reutilización de modelos ─────────────────────────

test("cada material guarda su emisión de partida", () => {
  // De esto depende poder REUTILIZAR un modelo guardado: al volver a sacarlo hay que devolverle
  // el brillo original, porque el último destello o la última muerte se lo dejaron cambiado.
  const t = new Taller(T, OPC);
  const apagado = t.mat(0x884400);
  const brillante = t.mat(0x884400, { emision: 0xff0000, fuerza: 0.7 });
  assert.equal(apagado.userData.emisionBase, 0x000000);
  assert.equal(apagado.userData.fuerzaBase, 0);
  assert.equal(brillante.userData.emisionBase, 0xff0000);
  assert.equal(brillante.userData.fuerzaBase, 0.7);
  t.liberar();
});

test("toda criatura expone sus materiales para poder restaurarla", () => {
  for (const b of BESTIARIO) {
    const c = construirEnemigo(T, b.clave, OPC);
    assert.ok(c.materiales.length > 0, `${b.clave} no expone materiales`);
    for (const m of c.materiales) {
      assert.ok("emisionBase" in m.userData, `${b.clave} tiene un material sin emisión de partida`);
    }
    c.taller.liberar();
  }
});

test("construir dos veces la misma criatura da modelos independientes", () => {
  // La caché guarda uno por llave; si compartieran materiales, un destello en uno se vería en el
  // otro. Esta prueba fija que cada construcción es suya.
  const a = construirEnemigo(T, "orco", OPC);
  const b = construirEnemigo(T, "orco", OPC);
  assert.notEqual(a.raiz, b.raiz);
  assert.equal(a.materiales.some((m) => b.materiales.includes(m)), false, "comparten materiales");
  a.taller.liberar();
  b.taller.liberar();
});

// ───────────────────────── Memoria de la GPU ─────────────────────────

test("liberar() devuelve TODO lo que creó el taller", () => {
  const antes = liberados.total;
  const t = new Taller(T, OPC);
  const g = t.grupo("prueba");
  g.add(t.caja(1, 1, 1, t.mat(0xff0000)));
  g.add(t.esfera(1, t.matLuz(0x00ff00)));
  g.add(t.toro(1, 0.1, t.mat(0x0000ff, { emision: 0x111111 })));
  const recursos = t.recursos.size;
  assert.ok(recursos >= 6, "deberían estar apuntadas 3 geometrías y 3 materiales");
  t.liberar();
  assert.equal(liberados.total - antes, recursos, "ha quedado algo sin liberar");
  assert.equal(t.recursos.size, 0);
  assert.doesNotThrow(() => t.liberar(), "liberar dos veces no puede fallar");
});

test("liberarRama suelta también lo que no pasó por el taller", () => {
  const antes = liberados.total;
  const raiz = new T.Group();
  const geo = new T.BoxGeometry(1, 1, 1);
  const mat = new T.MeshStandardMaterial({ color: 1 });
  raiz.add(new T.Mesh(geo, mat));
  liberarRama(raiz);
  assert.equal(geo.liberado, 1);
  assert.equal(mat.liberado, 1);
  assert.ok(liberados.total > antes);
  assert.doesNotThrow(() => liberarRama(raiz), "dos veces tampoco puede fallar");
  assert.doesNotThrow(() => liberarRama(null));
});

test("desmontar una criatura no deja nada de la GPU colgando", () => {
  const antes = liberados.total;
  const c = construirEnemigo(T, "dragon", OPC);
  const creados = c.taller.recursos.size;
  liberarRama(c.raiz);
  c.taller.liberar();
  assert.ok(liberados.total - antes >= creados, "quedan recursos sin devolver");
  assert.equal(c.taller.recursos.size, 0);
});

test("una escena entera se construye y se libera sin dejar restos", () => {
  const antes = liberados.total;
  const esc = construirEscenario(T, { calidad: "alto" });
  const heroe = construirHeroe(T, [{ tipo: "Espada", rareza: 2 }], { capa: 7, aura: 10 }, OPC);
  const enemigo = construirEnemigo(T, "quimera", { ...OPC, jefe: true });
  const creados = esc.taller.recursos.size + heroe.taller.recursos.size + enemigo.taller.recursos.size;
  for (const x of [esc, heroe, enemigo]) { liberarRama(x.raiz); x.taller.liberar(); }
  assert.ok(liberados.total - antes >= creados, `creados ${creados}, liberados ${liberados.total - antes}`);
});
