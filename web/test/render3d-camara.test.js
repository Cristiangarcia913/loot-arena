// Pruebas de la cámara con intención. `camara.js` son solo matemáticas, así que aquí se puede
// comprobar de verdad lo único que no se puede romper: que la cámara nunca deja fuera de plano a
// quien está luchando, que no pega saltos aunque la interrumpan, y que se queda quieta cuando el
// usuario ha pedido movimiento reducido.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  Director, PLANOS, NOMBRES_PLANO, ACERCAMIENTO_MAXIMO, JUNTARSE_EMBISTIENDO, acercamientoSeguro,
} from "../js/render3d/camara.js";
import { encuadre, CAMARA, ANCHO_LUCHADOR } from "../js/render3d/escenario.js";

/** Encuadre realista, el que sale en una ventana de portátil. */
const ENC = encuadre(16 / 9, 2);

/** Hace avanzar al director `ms` milisegundos a `fps`, devolviendo todas las posiciones. */
function correr(d, ms, { fps = 60, desde = 0, s0 = 0 } = {}) {
  const dt = 1 / fps;
  const pasos = Math.round((ms / 1000) * fps);
  const salida = [];
  for (let i = 0; i < pasos; i++) {
    salida.push(d.paso(dt, desde + (i * 1000) / fps, s0 + i * dt));
  }
  return salida;
}

const nuevo = (o = {}) => {
  const d = new Director(o);
  d.encuadrar(ENC, CAMARA.alto, o.radio ?? 0.7);
  return d;
};

// ───────────────────────── La regla que no se puede romper ─────────────────────────

test("por muy cerrado que sea el plano, nunca se pierde de vista a los dos luchadores", () => {
  // Es LA regla: un plano bonito que te hace perder el combate de vista es un plano malo.
  for (const radio of [0.45, 0.72, 1.0, 1.3]) {        // rata, orco, jefe, dragón
    for (const nombre of NOMBRES_PLANO) {
      const d = nuevo({ radio });
      d.pedir(nombre, { lado: 1 });
      correr(d, 3000);                                  // tiempo de sobra para llegar al plano
      assert.ok(d.cabenLosDos(),
        `plano "${nombre}" con radio ${radio}: cobertura ${d.coberturaActual().toFixed(2)} insuficiente`);
    }
  }
});

test("el límite de acercamiento se adapta a quién está luchando", () => {
  // Con una constante fija, o se quedaba corta para la rata o recortaba al dragón.
  const rata = acercamientoSeguro(ENC, 0.45, 0);
  const dragon = acercamientoSeguro(ENC, 1.3, 0);
  assert.ok(rata < dragon, "a una rata se le puede acercar más que a un dragón");
  assert.ok(rata < 0.85, `con una rata debería poder cerrarse bastante, y da ${rata}`);
  assert.ok(dragon <= 1, "nunca pide alejarse");
});

test("embistiendo se puede cerrar más, porque están más juntos", () => {
  for (const radio of [0.45, 0.72, 1.3]) {
    const quietos = acercamientoSeguro(ENC, radio, 0);
    const embistiendo = acercamientoSeguro(ENC, radio, 1);
    assert.ok(embistiendo < quietos, `radio ${radio}: embistiendo debería permitir más plano`);
  }
});

test("el acercamiento nunca pasa del tope absoluto", () => {
  const absurdo = acercamientoSeguro({ cobertura: 50, puesto: 0 }, 0.1, 1);
  assert.ok(absurdo >= ACERCAMIENTO_MAXIMO, `${absurdo} se pasa del tope ${ACERCAMIENTO_MAXIMO}`);
});

test("acercamientoSeguro aguanta datos imposibles", () => {
  for (const enc of [null, undefined, {}, { cobertura: 0, puesto: -5 }]) {
    const v = acercamientoSeguro(enc, 0.7, 0.5);
    assert.ok(Number.isFinite(v) && v > 0 && v <= 1, `${JSON.stringify(enc)} da ${v}`);
  }
});

test("durante una embestida de verdad, los dos siguen en plano en TODO momento", () => {
  // Se simula la embestida como la hace `animarAtaque`: el que ataca avanza y vuelve, y va
  // avisando al director de lo juntos que están.
  const d = nuevo({ radio: 1.3 });                     // el peor caso: el dragón
  d.pedir("critico", { lado: 1 });
  const pasos = 60;
  for (let i = 0; i < pasos; i++) {
    const p = i / pasos;
    const k = p < 0.5 ? p * 2 : 2 - p * 2;             // va y vuelve
    d.juntando(k);
    d.paso(1 / 60, i * 16.7, i / 60);
    assert.ok(d.cabenLosDos(), `en el paso ${i} (juntos ${k.toFixed(2)}) se sale alguien del plano`);
  }
});

// ───────────────────────── Interrumpible, sin saltos ─────────────────────────

test("cambiar de plano a media transición no da ningún salto", () => {
  const d = nuevo();
  d.pedir("embestida", { lado: -1 });
  correr(d, 150);                                      // a mitad de camino
  const antes = d.paso(1 / 60, 160, 0.16);
  d.pedir("telegrafiado", { lado: 1 });                // interrupción: plano opuesto
  const despues = d.paso(1 / 60, 177, 0.18);
  const salto = Math.hypot(despues.x - antes.x, despues.y - antes.y, despues.z - antes.z);
  assert.ok(salto < 0.2, `la cámara saltó ${salto.toFixed(2)} metros en un fotograma`);
});

test("ninguna secuencia de planos, por loca que sea, produce un salto", () => {
  const d = nuevo();
  let previo = d.paso(1 / 60, 0, 0);
  let peor = 0;
  for (let i = 1; i < 600; i++) {
    if (i % 7 === 0) d.pedir(NOMBRES_PLANO[i % NOMBRES_PLANO.length], { lado: (i % 3) - 1, ahora: i * 16.7 });
    const p = d.paso(1 / 60, i * 16.7, i / 60);
    peor = Math.max(peor, Math.hypot(p.x - previo.x, p.y - previo.y, p.z - previo.z));
    previo = p;
  }
  assert.ok(peor < 0.25, `el peor salto entre fotogramas fue de ${peor.toFixed(3)} metros`);
});

test("el movimiento es el mismo a 30 que a 144 fps", () => {
  const a = nuevo(), b = nuevo();
  a.pedir("critico", { lado: 1 });
  b.pedir("critico", { lado: 1 });
  const fa = correr(a, 500, { fps: 30 }).at(-1);
  const fb = correr(b, 500, { fps: 144 }).at(-1);
  // Se comparan sin la deriva lenta, que sí depende del reloj.
  assert.ok(Math.abs(fa.z - fb.z) < 0.12, `a 30 fps z=${fa.z.toFixed(2)} y a 144 z=${fb.z.toFixed(2)}`);
  assert.ok(Math.abs(fa.x - fb.x) < 0.12, "el desplazamiento lateral tampoco puede depender de los fps");
});

// ───────────────────────── Vuelve sola al reposo ─────────────────────────

test("un plano caduca y la cámara vuelve sola a reposo", () => {
  const d = nuevo();
  d.pedir("critico", { lado: 1, ahora: 0 });
  assert.equal(d.plano, "critico");
  correr(d, PLANOS.critico.ms + 200, { desde: 0 });
  assert.equal(d.plano, "reposo", "el plano no caducó");
  correr(d, 2000, { desde: 2000 });
  const fin = d.paso(1 / 60, 4000, 4);
  assert.ok(Math.abs(fin.z - ENC.distancia) < 0.25, `no volvió a la distancia de reposo: ${fin.z.toFixed(2)}`);
  assert.ok(Math.abs(fin.x) < 0.4, "no volvió al centro");
});

test("el reposo no caduca nunca", () => {
  const d = nuevo();
  correr(d, 10000);
  assert.equal(d.plano, "reposo");
});

test("un plano que no existe se ignora en vez de romper la cámara", () => {
  const d = nuevo();
  d.pedir("plano-inventado", { lado: 1 });
  assert.equal(d.plano, "reposo");
  assert.doesNotThrow(() => d.paso(1 / 60, 0, 0));
});

// ───────────────────────── Se puede apagar ─────────────────────────

test("con movimiento reducido la cámara se queda completamente quieta", () => {
  // No es un detalle: a bastante gente el movimiento de cámara le marea de verdad.
  const d = nuevo({ reducido: () => true });
  d.pedir("critico", { lado: 1 });
  const pasos = correr(d, 1000);
  const primero = pasos[0];
  for (const p of pasos) {
    assert.deepEqual(
      [p.x, p.y, p.z, p.miraX],
      [primero.x, primero.y, primero.z, primero.miraX],
      "la cámara se movió con el movimiento reducido puesto",
    );
  }
  assert.equal(primero.x, 0, "y además mira de frente, sin desplazamiento lateral");
  assert.equal(d.quieta, true);
});

test("tampoco hay deriva lenta con movimiento reducido", () => {
  const d = nuevo({ reducido: () => true });
  const a = d.paso(1 / 60, 0, 0);
  const b = d.paso(1 / 60, 5000, 5);          // cinco segundos después
  assert.deepEqual([a.x, a.z], [b.x, b.z], "la deriva se movió igualmente");
});

test("se puede apagar la cámara viva sin apagar el resto de efectos", () => {
  const d = nuevo({ viva: false });
  d.pedir("critico", { lado: 1 });
  assert.equal(d.plano, "reposo");
  assert.equal(d.quieta, true);
  const viva = nuevo({ viva: true });
  viva.pedir("critico", { lado: 1 });
  assert.equal(viva.plano, "critico");
});

// ───────────────────────── Que los planos tengan sentido ─────────────────────────

test("el plano de golpe telegrafiado se APARTA, no se acerca", () => {
  // Un golpe que se ve venir hay que verlo entero; acercarse ahí es lo contrario de ayudar.
  assert.ok(PLANOS.telegrafiado.acercar > 1, "telegrafiado debería alejar la cámara");
  for (const n of ["embestida", "critico", "muerte", "botin"]) {
    assert.ok(PLANOS[n].acercar < 1, `${n} debería acercar`);
  }
});

test("el crítico se cierra más que una embestida normal, y dura menos que la muerte", () => {
  assert.ok(PLANOS.critico.acercar < PLANOS.embestida.acercar);
  assert.ok(PLANOS.critico.ms < PLANOS.muerte.ms);
  assert.ok(PLANOS.critico.prisa > PLANOS.embestida.prisa, "un crítico tiene que entrar más seco");
});

test("todos los planos tienen los campos que usa el director", () => {
  for (const [n, p] of Object.entries(PLANOS)) {
    for (const campo of ["acercar", "ladear", "bajar", "ms", "prisa"]) {
      assert.equal(typeof p[campo], "number", `al plano ${n} le falta ${campo}`);
    }
    // `prisa` es la rigidez del muelle en radianes/segundo (ver el comentario de camara.js),
    // no una fracción 0-1: el crítico pide 13 y el reposo 4 a propósito, para que entre más
    // seco. El tope de abajo solo descarta un valor negativo o puesto a cero por error.
    assert.ok(p.prisa > 0, `${n}: prisa tiene que ser positiva`);
    assert.ok(p.acercar >= ACERCAMIENTO_MAXIMO, `${n} pide más plano del que se permite nunca`);
  }
});

test("la cámara se inclina hacia el lado de quien actúa", () => {
  const izq = nuevo(), der = nuevo();
  izq.pedir("embestida", { lado: -1 });
  der.pedir("embestida", { lado: 1 });
  const a = correr(izq, 800).at(-1);
  const b = correr(der, 800).at(-1);
  assert.ok(a.x < 0, "si ataca el héroe (izquierda), la cámara va hacia la izquierda");
  assert.ok(b.x > 0, "si ataca el enemigo (derecha), hacia la derecha");
});

test("la constante de juntarse coincide con lo que avanza la embestida", () => {
  // `animarAtaque` mueve al atacante un 42 % del camino; si eso cambia, hay que cambiar esto.
  assert.equal(JUNTARSE_EMBISTIENDO, 0.42);
});

test("el encuadre base y el ancho del luchador siguen siendo los que la cámara espera", () => {
  assert.ok(ENC.cobertura >= ENC.puesto + ANCHO_LUCHADOR - 0.02);
});
