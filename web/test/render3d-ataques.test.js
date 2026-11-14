// Pruebas de las animaciones de ataque. Lo que se fija aquí es el contrato con `combat.js`
// (los nueve valores de `VALORES_3D.ataque`) y la distinción que de verdad se nota en pantalla:
// **quién se mueve de su sitio y quién no**. Que un dragón deje de darse un paseo para escupir
// fuego cambia más el combate que cualquier detalle del gesto.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ANIMACIONES, NOMBRES, POR_DEFECTO, descriptor, elegir, sabeAnimar, sinDescriptor, viaja,
} from "../js/render3d/ataques.js";
import { VALORES_3D, BESTIARIO, MOVIMIENTOS, animacion3d, metadatos3d } from "../js/combat.js";

// ───────────────────────── El contrato con combat.js ─────────────────────────

test("este motor sabe animar los NUEVE valores del contrato", () => {
  // Si contenido añade un valor a `VALORES_3D.ataque`, esta prueba falla aquí en vez de que la
  // criatura nueva se quede con el gesto de reserva sin que nadie se entere.
  assert.deepEqual(sinDescriptor(VALORES_3D.ataque), []);
  assert.equal(NOMBRES.length, VALORES_3D.ataque.length);
});

test("cada criatura del bestiario tiene gesto propio según su ficha", () => {
  for (const b of BESTIARIO) {
    const meta = metadatos3d(b.clave);
    assert.ok(sabeAnimar(meta.ataque3d), `${b.clave} declara «${meta.ataque3d}» y no sé animarlo`);
  }
});

test("cada movimiento del combate tiene gesto", () => {
  for (const id of Object.keys(MOVIMIENTOS)) {
    assert.ok(sabeAnimar(animacion3d(id)), `el movimiento «${id}» pide «${animacion3d(id)}»`);
  }
});

test("un valor desconocido cae en el golpe con arma, no se rompe", () => {
  assert.equal(descriptor("voladura-cuantica").nombre, POR_DEFECTO);
  assert.equal(descriptor(undefined).nombre, POR_DEFECTO);
  assert.equal(descriptor(null).nombre, POR_DEFECTO);
  assert.equal(descriptor(42).nombre, POR_DEFECTO);
  assert.equal(sabeAnimar(undefined), false);
});

// ───────────────────────── Quién se mueve y quién no ─────────────────────────

test("mordisco, garra, arma y embestida van hacia el rival", () => {
  for (const n of ["mordisco", "garra", "arma", "embestida"]) {
    assert.ok(viaja(n), `${n} debería avanzar`);
    assert.ok(ANIMACIONES[n].avance > 0.2);
  }
});

test("aliento, proyectil y conjuro se lanzan SIN moverse del sitio", () => {
  // Es la diferencia que más se nota: un dragón no se da un paseo para escupir fuego.
  for (const n of ["aliento", "proyectil", "conjuro"]) {
    assert.equal(viaja(n), false, `${n} no debería desplazar a la criatura`);
    assert.equal(ANIMACIONES[n].avance, 0);
    assert.ok(ANIMACIONES[n].chorro || ANIMACIONES[n].proyectil || ANIMACIONES[n].anillo,
      `${n} no se mueve, así que algo tiene que salir despedido`);
  }
});

test("una embestida llega más lejos que un golpe con arma, y un zarpazo menos", () => {
  assert.ok(ANIMACIONES.embestida.avance > ANIMACIONES.arma.avance);
  assert.ok(ANIMACIONES.garra.avance < ANIMACIONES.arma.avance);
  assert.ok(ANIMACIONES.garra.giro > ANIMACIONES.arma.giro, "un zarpazo barre de lado");
  assert.ok(ANIMACIONES.mordisco.cabeza > ANIMACIONES.arma.cabeza, "un mordisco adelanta la cabeza");
  assert.ok(ANIMACIONES.arma.arma > ANIMACIONES.mordisco.arma, "el arma la mueve quien la lleva");
});

test("guardia y apoyo no son ataques", () => {
  for (const n of ["guardia", "apoyo"]) {
    assert.equal(ANIMACIONES[n].defensivo, true);
    assert.ok(ANIMACIONES[n].avance <= 0, `${n} no puede lanzarse hacia el rival`);
  }
  for (const n of ["arma", "mordisco", "garra", "embestida", "aliento", "proyectil", "conjuro"]) {
    assert.equal(ANIMACIONES[n].defensivo, false, `${n} sí es un ataque`);
  }
});

// ───────────────────────── Crítico y brutal ─────────────────────────

test("un crítico exagera el gesto, no lo cambia por otro", () => {
  for (const n of NOMBRES) {
    const normal = descriptor(n);
    const critico = descriptor(n, { critico: true });
    assert.equal(critico.nombre, normal.nombre, `${n} cambió de gesto al ser crítico`);
    assert.ok(critico.ms > normal.ms, `${n}: un crítico debería durar algo más`);
    if (normal.avance > 0) assert.ok(critico.avance > normal.avance, `${n}: debería llegar más lejos`);
  }
});

test("un golpe brutal se nota más que un crítico", () => {
  const c = descriptor("embestida", { critico: true });
  const b = descriptor("embestida", { brutal: true });
  assert.ok(b.avance > c.avance);
  assert.ok(b.ms > c.ms);
  assert.ok(b.sacude > c.sacude, "un golpe brutal sacude más la cámara");
});

test("un gesto que no avanza sigue sin avanzar aunque sea crítico", () => {
  // Si un crítico pusiera a andar a un conjurador, se perdería justo la diferencia que importa.
  for (const n of ["aliento", "proyectil", "conjuro", "apoyo"]) {
    assert.equal(descriptor(n, { critico: true }).avance, 0, `${n} se movió al ser crítico`);
    assert.equal(descriptor(n, { brutal: true }).avance, 0);
  }
});

// ───────────────────────── Elegir qué animar ─────────────────────────

test("un movimiento con gesto propio manda; «arma» genérico no pisa a la ficha", () => {
  assert.equal(elegir("conjuro", "mordisco"), "conjuro", "un movimiento con gesto propio manda");
  assert.equal(elegir(null, "mordisco"), "mordisco", "sin evento, lo que diga la criatura");
  assert.equal(elegir(null, null), POR_DEFECTO);
  assert.equal(elegir("inventado", "aliento"), "aliento", "un valor raro no tapa a la ficha");
  assert.equal(elegir("inventado", "tampoco"), POR_DEFECTO);
  assert.equal(elegir("arma", "mordisco"), "mordisco", "«arma» es el valor de reserva, no una orden");
  assert.equal(elegir("arma", null), "arma", "pero si la criatura no dice nada, vale");
});

test("EL CASO REAL: el ataque normal de un dragón es su aliento, no un espadazo", () => {
  // El evento del ataque básico llega con id «ataque», que declara «arma». Si eso mandara, el
  // dragón daría un espadazo con un arma que no tiene. Comprobado contra el combate de verdad.
  const dragon = metadatos3d("dragon");
  assert.equal(dragon.ataque3d, "aliento");
  assert.equal(animacion3d("ataque"), "arma", "si esto cambia, revisar la regla de `elegir`");
  assert.equal(elegir(animacion3d("ataque"), dragon.ataque3d), "aliento");
  assert.equal(viaja(elegir(animacion3d("ataque"), dragon.ataque3d)), false,
    "y por tanto no se mueve de su sitio para atacar");
  // Un movimiento con gesto propio sí manda, lo use quien lo use.
  assert.equal(elegir(animacion3d("bola_fuego"), dragon.ataque3d), "proyectil");
});

test("a las criaturas de arma no les quita nada la regla", () => {
  // Los movimientos que declaran «arma» son justo de criaturas cuya ficha ya es «arma».
  for (const clave of ["goblin", "esqueleto", "bandido", "orco", "caballero"]) {
    const ficha = metadatos3d(clave).ataque3d;
    assert.equal(ficha, "arma");
    assert.equal(elegir(animacion3d("ataque"), ficha), "arma");
  }
});

test("todos los descriptores tienen los campos que usa la escena", () => {
  for (const [n, a] of Object.entries(ANIMACIONES)) {
    for (const campo of ["avance", "impulso", "alzar", "inclinar", "giro", "arma", "cabeza", "ms", "impacto", "sacude"]) {
      assert.equal(typeof a[campo], "number", `a «${n}» le falta ${campo}`);
    }
    assert.ok(a.ms >= 300 && a.ms <= 1000, `${n} dura ${a.ms} ms: se sale de lo razonable`);
    assert.ok(a.impacto > 0.3 && a.impacto < 0.9, `${n}: el impacto cae en un momento raro`);
    assert.equal(typeof a.defensivo, "boolean");
  }
});

test("el impacto de un lanzamiento cae más tarde que el de un golpe cuerpo a cuerpo", () => {
  // Tiene que dar tiempo a cargar antes de soltar la bola o el aliento.
  assert.ok(ANIMACIONES.proyectil.impacto > ANIMACIONES.arma.impacto);
  assert.ok(ANIMACIONES.conjuro.impacto > ANIMACIONES.arma.impacto);
});

test("descriptor devuelve una copia: no se puede estropear la tabla", () => {
  const d = descriptor("mordisco");
  d.avance = 99;
  assert.notEqual(ANIMACIONES.mordisco.avance, 99);
  assert.equal(descriptor("mordisco").avance, ANIMACIONES.mordisco.avance);
});
