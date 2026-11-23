import { test } from "node:test";
import assert from "node:assert/strict";
import {
  suaveCubica, salidaCubica, caida, atrasSalida, anticipar, muelle, rebote, aplastar, campana, ruido1d, tramo,
} from "../js/render3d/curvas.js";

const cerca = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

test("todas las curvas de avance empiezan en 0 y acaban en 1 (y se limitan fuera de 0..1)", () => {
  for (const f of [suaveCubica, salidaCubica, caida, atrasSalida, anticipar, rebote]) {
    assert.ok(cerca(f(0), 0), `${f.name}(0)`);
    assert.ok(cerca(f(1), 1, 1e-6), `${f.name}(1)`);
    assert.ok(cerca(f(-3), f(0)) && cerca(f(7), f(1)), `${f.name} no se limita`);
  }
});

test("la caída acelera (gravedad) y la salida frena", () => {
  assert.ok(caida(0.75) - caida(0.5) > caida(0.25) - caida(0));
  assert.ok(salidaCubica(0.25) - salidaCubica(0) > salidaCubica(1) - salidaCubica(0.75));
});

test("atrasSalida se pasa del destino antes de asentarse", () => {
  const max = Math.max(...Array.from({ length: 101 }, (_, i) => atrasSalida(i / 100)));
  assert.ok(max > 1.05 && max < 1.15, `sobreimpulso ${max}`);
});

test("anticipar retrocede (valor negativo) antes de avanzar", () => {
  assert.ok(anticipar(0.3) < -0.2);
  assert.ok(anticipar(0.15) < 0);
  assert.ok(anticipar(0.9) > 0.9);
});

test("muelle parte de 1, oscila (cruza el 0) y se apaga", () => {
  assert.equal(muelle(0), 1);
  const vals = Array.from({ length: 200 }, (_, i) => muelle(i / 199));
  assert.ok(vals.some((v) => v < 0), "no oscila");
  assert.ok(Math.abs(vals.at(-1)) < 0.01, "no se apaga");
});

test("rebote toca el suelo y vuelve a subir antes de quedarse en 1", () => {
  const vals = Array.from({ length: 400 }, (_, i) => rebote(i / 399));
  const primerToque = vals.findIndex((v) => v > 0.99);
  assert.ok(primerToque > 0 && vals.slice(primerToque).some((v) => v < 0.95), "sin bote");
});

test("aplastar conserva (aprox.) el volumen", () => {
  for (const k of [-0.2, -0.05, 0, 0.1, 0.25]) {
    const [xz, y] = aplastar(k);
    assert.ok(cerca(xz * xz * y, 1, 1e-9), `volumen con k=${k}`);
  }
  assert.ok(aplastar(-0.1)[0] > 1, "aplastado debe ensanchar");
});

test("campana y ruido1d: acotados, continuos y deterministas", () => {
  assert.ok(cerca(campana(0.5), 1) && cerca(campana(0), 0));
  let previo = ruido1d(0, 3);
  for (let t = 0.01; t < 20; t += 0.01) {
    const v = ruido1d(t, 3);
    assert.ok(v >= -1 && v <= 1);
    assert.ok(Math.abs(v - previo) < 0.1, "el ruido debe ser continuo, no saltar");
    previo = v;
  }
  assert.equal(ruido1d(4.2, 1), ruido1d(4.2, 1));
  assert.notEqual(ruido1d(4.2, 1), ruido1d(4.2, 2));
});

test("tramo reparte el avance entre fases y aplica la curva de cada una", () => {
  const fases = [[0.2, null], [0.7, caida], [1, salidaCubica]];
  assert.deepEqual(tramo(0.1, fases), { i: 0, q: 0.5 });
  assert.equal(tramo(0.45, fases).i, 1);
  assert.ok(cerca(tramo(0.45, fases).q, 0.25));
  assert.deepEqual(tramo(1, fases), { i: 2, q: 1 });
});
