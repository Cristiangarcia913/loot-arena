// Pruebas de la parte del motor 3D que es lógica pura: carga de three.js, paleta, detección de
// equipo, medidor de fps, encuadre de cámara y textos de los golpes.
// No hace falta navegador ni GPU: estos módulos no tocan el DOM al importarse.

import { test } from "node:test";
import assert from "node:assert/strict";

import { TRES_VERSION, TRES_REVISION, TRES_URLS, MSG_3D, soporta3d, cargarTres, _olvidar } from "../js/render3d/tres.js";
import { hex, rareza3d, colorEnemigo, ENEMIGO_GENERICO, claveDeNombre, TEXTO, claseTexto } from "../js/render3d/paleta.js";
import {
  CALIDADES, DPR_MINIMO, ESCALERA, HUECO_DESCARTADO, HUECO_ESTRANGULADO, Medidor, Vigilante,
  bajarCalidad, subirCalidad, detectarEquipo, duracion, movimientoReducido, nivelEquipo, pixelesPorCss,
} from "../js/render3d/rendimiento.js";
import { textoDeGolpe, altoTexto } from "../js/render3d/numeros.js";
import { encuadre, distanciaCamara, CAMARA, MEDIO_PLANO, ANCHO_LUCHADOR, PUESTO_X, RADIO_ARENA } from "../js/render3d/escenario.js";
import { BESTIARIO } from "../js/combat.js";

// ───────────────────────── Carga de three.js ─────────────────────────

test("la versión de three.js está fijada, no es «latest»", () => {
  assert.match(TRES_VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(TRES_REVISION, "r" + TRES_VERSION.split(".")[1]);
});

test("las URLs del CDN apuntan todas a la MISMA versión", () => {
  assert.ok(TRES_URLS.length >= 2, "hace falta un CDN de reserva");
  for (const u of TRES_URLS) {
    assert.ok(u.startsWith("https://"), `${u} debe ir por HTTPS (WebXR y Pages lo exigen)`);
    assert.ok(u.includes(`three@${TRES_VERSION}`), `${u} no lleva la versión fijada`);
    assert.ok(u.endsWith("/build/three.module.js"), `${u} debe ser el módulo ES del paquete`);
  }
  assert.equal(new Set(TRES_URLS).size, TRES_URLS.length, "URLs repetidas");
});

test("sin navegador, soporta3d() dice que no en vez de reventar", () => {
  assert.equal(soporta3d(undefined), false);
  assert.equal(soporta3d({}), false);
});

test("si ninguna URL responde, cargarTres falla con un mensaje para el jugador", async () => {
  _olvidar();
  await assert.rejects(
    () => cargarTres(["data:text/javascript,throw new Error('no')"]),
    (e) => { assert.equal(e.message, MSG_3D.sinRed); assert.ok(e.detalle); return true; },
  );
  _olvidar();
});

test("cargarTres prueba las URLs en orden y se queda con la primera que vale", async () => {
  _olvidar();
  const T = await cargarTres([
    "data:text/javascript,throw new Error('cdn caído')",
    "data:text/javascript,export class Scene {}; export const marca = 'reserva';",
  ]);
  assert.equal(T.marca, "reserva");
  // La segunda llamada no vuelve a descargar nada.
  assert.equal(await cargarTres(["data:text/javascript,throw new Error('no debería pedirse')"]), T);
  _olvidar();
});

test("los mensajes de aviso están en español y sin jerga", () => {
  for (const [clave, texto] of Object.entries(MSG_3D)) {
    assert.ok(texto.length > 10, `${clave} es demasiado corto`);
    assert.doesNotMatch(texto, /WebGL|GPU|shader|framerate/i, `${clave} tiene jerga: "${texto}"`);
  }
});

// ───────────────────────── Paleta ─────────────────────────

test("hex() convierte colores y no falla con basura", () => {
  assert.equal(hex("#3b82f6"), 0x3b82f6);
  assert.equal(hex("3b82f6"), 0x3b82f6);
  assert.equal(hex("#abc"), 0xaabbcc);
  assert.equal(hex(null), 0xffffff);
  assert.equal(hex("no es un color"), 0xffffff);
});

test("rareza3d recorta fuera de rango y solo lo legendario brilla de verdad", () => {
  assert.equal(rareza3d(0).fuerza, 0, "lo común no brilla");
  assert.ok(rareza3d(2).fuerza > rareza3d(1).fuerza, "lo legendario brilla más que lo raro");
  assert.deepEqual(rareza3d(-5), rareza3d(0));
  assert.deepEqual(rareza3d(99), rareza3d(2));
  assert.deepEqual(rareza3d("no es un número"), rareza3d(0));
  for (const n of [0, 1, 2]) {
    const p = rareza3d(n);
    for (const k of ["base", "luz", "osc"]) {
      assert.equal(typeof p[k], "number");
      assert.ok(p[k] >= 0 && p[k] <= 0xffffff, `${k} fuera de rango en rareza ${n}`);
    }
  }
});

test("hay color para las 10 criaturas del bestiario y para el jefe", () => {
  for (const b of BESTIARIO) {
    const c = colorEnemigo(b.clave);
    assert.notDeepEqual(c, ENEMIGO_GENERICO, `${b.clave} se queda con el color genérico`);
  }
  assert.notDeepEqual(colorEnemigo("jefe"), ENEMIGO_GENERICO);
});

test("una criatura desconocida cae en el color genérico sin fallar", () => {
  assert.deepEqual(colorEnemigo("minotauro-que-no-existe"), ENEMIGO_GENERICO);
  assert.deepEqual(colorEnemigo(undefined), ENEMIGO_GENERICO);
  assert.deepEqual(colorEnemigo(42), ENEMIGO_GENERICO);
});

test("del nombre de cualquier criatura se saca su clave", () => {
  // Regresión: la regla del 2D (primera palabra) falla con «Enjambre de avispas», cuya clave es
  // `avispa`. Por eso `claveDeNombre` mira primero el bestiario.
  assert.equal(claveDeNombre("Rata gigante"), "rata");
  assert.equal(claveDeNombre("Araña venenosa"), "arana");
  assert.equal(claveDeNombre("Enjambre de avispas"), "avispa");
  for (const b of BESTIARIO) assert.equal(claveDeNombre(b.nombre), b.clave, `${b.nombre} no da ${b.clave}`);
  assert.equal(claveDeNombre("Bicho inventado"), "bicho", "fuera del bestiario, la regla de siempre");
  assert.equal(claveDeNombre(null), "");
});

test("las clases de texto son las mismas que en fx.js", () => {
  for (const c of ["dano", "critico", "cura", "bloqueo", "esquiva", "info", "estado"]) {
    assert.ok(TEXTO[c], `falta la clase ${c}`);
    assert.equal(claseTexto(c), c);
  }
  assert.equal(claseTexto("inventada"), "dano");
  assert.ok(TEXTO.critico.tam > TEXTO.dano.tam, "el crítico tiene que verse más grande");
});

// ───────────────────────── Detección de equipo ─────────────────────────

test("nivelEquipo no confunde una Intel UHD moderna con una tarjeta vieja", () => {
  // Regresión: una expresión regular con `(hd|gma)` casaba la «HD» de «UHD» y mandaba un
  // portátil normal al perfil más bajo. Medido en esta misma GPU: 1,9 ms por fotograma.
  const uhd = "ANGLE (Intel, Intel(R) UHD Graphics (0x0000A7A8) Direct3D11 vs_5_0 ps_5_0, D3D11)";
  assert.equal(nivelEquipo({ renderer: uhd, nucleos: 16, memoria: 32, dpr: 1.25 }), "alto");
  assert.equal(nivelEquipo({ renderer: "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics, D3D11)", nucleos: 8, memoria: 16 }), "alto");
});

test("nivelEquipo manda al perfil bajo lo que de verdad no puede", () => {
  assert.equal(nivelEquipo({ renderer: "Google SwiftShader", nucleos: 16, memoria: 32 }), "bajo");
  assert.equal(nivelEquipo({ renderer: "Intel(R) HD Graphics 4000", nucleos: 4, memoria: 8 }), "bajo");
  assert.equal(nivelEquipo({ renderer: "Mesa OffScreen", nucleos: 8 }), "bajo");
  assert.equal(nivelEquipo({ nucleos: 2 }), "bajo", "dos núcleos no dan");
  assert.equal(nivelEquipo({ nucleos: 8, memoria: 2 }), "bajo", "2 GiB no dan");
  assert.equal(nivelEquipo({ nucleos: 8, webgl2: false }), "bajo");
});

test("en el móvil nunca se arranca en el perfil alto", () => {
  for (const n of [4, 6, 8, 12]) {
    const nivel = nivelEquipo({ nucleos: n, memoria: 8, movil: true, dpr: 3 });
    assert.notEqual(nivel, "alto", `${n} núcleos en móvil no deberían dar perfil alto`);
  }
});

test("sin ningún dato, nivelEquipo elige el término medio", () => {
  assert.equal(nivelEquipo(), "medio");
  assert.equal(nivelEquipo({}), "medio");
});

test("detectarEquipo lee el navegador sin romperse si faltan datos", () => {
  const e = detectarEquipo({ navigator: { hardwareConcurrency: 8, userAgent: "Mozilla/5.0 (iPhone)" }, devicePixelRatio: 3 });
  assert.equal(e.nucleos, 8);
  assert.equal(e.movil, true);
  assert.equal(e.dpr, 3);
  assert.doesNotThrow(() => detectarEquipo({}));
  assert.doesNotThrow(() => detectarEquipo(undefined, null));
});

test("los perfiles de calidad van de menos a más en todo lo que cuesta", () => {
  assert.deepEqual(ESCALERA, ["bajo", "medio", "alto"]);
  for (let i = 1; i < ESCALERA.length; i++) {
    const peor = CALIDADES[ESCALERA[i - 1]], mejor = CALIDADES[ESCALERA[i]];
    assert.ok(mejor.dpr >= peor.dpr, "el perfil mejor no puede tener menos píxeles");
    assert.ok(mejor.polvo >= peor.polvo);
    assert.ok(mejor.segmentos >= peor.segmentos);
  }
  assert.equal(CALIDADES.bajo.sombras, false, "el perfil bajo no puede gastar en sombras");
  assert.equal(CALIDADES.bajo.polvo, 0);
});

test("subir y bajar calidad se queda en los extremos", () => {
  assert.equal(bajarCalidad("alto"), "medio");
  assert.equal(bajarCalidad("medio"), "bajo");
  assert.equal(bajarCalidad("bajo"), "bajo");
  assert.equal(subirCalidad("bajo"), "medio");
  assert.equal(subirCalidad("alto"), "alto");
});

// ───────────────────────── Medidor y vigilante ─────────────────────────

test("el Medidor calcula los fps de la última ventana", () => {
  const m = new Medidor();
  for (let i = 0; i <= 60; i++) m.fotograma(i * (1000 / 60));
  assert.ok(Math.abs(m.fps - 60) < 2, `esperaba ~60 fps, salió ${m.fps}`);
  const r = m.resumen();
  assert.equal(r.fps, 60);
  assert.equal(r.fotogramas, 61);
});

test("el Medidor no cuenta los primeros fotogramas en el «peor»", () => {
  const m = new Medidor();
  m.fotograma(0);
  m.fotograma(500);                 // arranque lento: compilar shaders
  for (let i = 2; i < 80; i++) m.fotograma(500 + (i - 1) * (1000 / 60));
  assert.ok(m.peor > 40, `el arranque no debería contar como «peor» (salió ${m.peor})`);
});

test("el Medidor apunta el fotograma más lento", () => {
  const m = new Medidor();
  m.fotograma(0);
  m.fotograma(16);
  m.fotograma(216);                  // un tirón de 200 ms
  assert.equal(m.peorFotograma, 200);
  m.reiniciar();
  assert.equal(m.peorFotograma, 0);
  assert.equal(m.fps, 0);
});

test("el Vigilante solo baja la calidad si va mal un rato seguido", () => {
  const v = new Vigilante({ objetivo: 55, pacienciaMs: 2000 });
  assert.equal(v.revisar(60, 0), "nada");
  assert.equal(v.revisar(30, 1000), "nada", "aún no ha pasado la paciencia");
  assert.equal(v.revisar(30, 2000), "nada");
  assert.equal(v.revisar(30, 3100), "bajar");
});

test("el Vigilante olvida un bajón pasajero", () => {
  const v = new Vigilante({ objetivo: 55, pacienciaMs: 2000 });
  v.revisar(30, 0);
  v.revisar(60, 500);                           // se recupera
  assert.equal(v.revisar(30, 3000), "nada", "el reloj tiene que empezar de cero");
});

test("el Vigilante se rinde en vez de bajar la calidad sin fin", () => {
  const v = new Vigilante({ objetivo: 55, pacienciaMs: 100, maxBajadas: 2 });
  let t = 0;
  const paso = () => { v.revisar(20, t); t += 200; return v.revisar(20, t); };
  assert.equal(paso(), "bajar");
  assert.equal(paso(), "bajar");
  assert.equal(paso(), "rendirse");
});

// ───────────────────────── Bajar la calidad cuando toca ─────────────────────────

/** Reproduce una tanda de fotogramas y devuelve qué hizo el vigilante. */
function simular({ fps, p95 = 0, peor = 0, segundos = 8, objetivo = 55 }) {
  const m = new Medidor();
  const v = new Vigilante({ objetivo });
  const paso = 1000 / fps;
  const acciones = [];
  let t = 0, i = 0;
  while (t < segundos * 1000) {
    let dt = paso;
    if (p95 && i % 20 === 7) dt = p95;
    if (peor && i % 97 === 5) dt = peor;
    t += dt;
    i++;
    if (dt > HUECO_DESCARTADO) { m.reiniciar(); v.desde = null; continue; }
    const f = m.fotograma(t);
    if (m.estable()) {
      const r = v.revisar(f, t);
      if (r !== "nada") acciones.push([r, Math.round(t)]);
    }
  }
  return { acciones, medidor: m };
}

test("a 30 fps en el juego real, la calidad BAJA (y no una vez, sino hasta rendirse)", () => {
  // Números medidos en el juego, no inventados: lienzo de 1296×620 en una Intel UHD daba
  // 29,8 fps, p95 52,7 ms y un peor fotograma de 187 ms.
  // Comprobado: con los umbrales anteriores la calidad TAMBIÉN bajaba, pero a los 4,7 s; ahora
  // reacciona a los 2,7 s. Lo que fallaba de verdad no era esto (ver el informe): era que el aviso
  // vivía en un `::after` y que bajar de «alto» a «medio» no quitaba ni un píxel.
  const { acciones } = simular({ fps: 29.8, p95: 52.7, peor: 187 });
  assert.ok(acciones.length >= 1, "no se bajó la calidad ni una vez");
  assert.equal(acciones[0][0], "bajar");
  assert.ok(acciones[0][1] < 4000, `tardó ${acciones[0][1]} ms en reaccionar; debería ser en 2-3 s`);
  assert.ok(acciones.some(([a]) => a === "rendirse"), "si sigue mal, hay que avisar y dejar de bajar");
});

test("a 60 fps no se toca nada, aunque haya algún tirón suelto", () => {
  const { acciones } = simular({ fps: 60, peor: 180 });
  assert.deepEqual(acciones, [], "no se puede bajar la calidad a quien va bien");
});

test("una página estrangulada (1 fotograma por segundo) no cuenta como equipo lento", () => {
  // Pestaña de fondo o panel oculto: el navegador da ~1 fps. Eso NO es un equipo lento.
  const { acciones, medidor } = simular({ fps: 1 });
  assert.deepEqual(acciones, [], "se bajó la calidad por estar en segundo plano");
  assert.equal(medidor.estable(), false);
});

test("los dos umbrales de hueco son coherentes entre sí", () => {
  assert.ok(HUECO_ESTRANGULADO < HUECO_DESCARTADO, "primero se deja de juzgar, luego se descarta");
  assert.ok(HUECO_ESTRANGULADO > 200, "un tirón de 187 ms es un equipo lento, no un parón");
  assert.ok(HUECO_DESCARTADO < 1000, "un hueco de 1 s sí es el navegador estrangulando");
});

// ───────────────────────── Resolución del lienzo ─────────────────────────

test("bajar la calidad quita píxeles de verdad en una arena grande", () => {
  // Regresión: con solo el tope de `dpr`, en una pantalla de 1,25 bajar de «alto» (tope 2) a
  // «medio» (tope 1,5) no quitaba NI UN PÍXEL, porque 1,25 ya estaba por debajo de los dos.
  const w = 1296, h = 620, pantalla = 1.25;
  const px = (cal) => { const d = pixelesPorCss(w, h, CALIDADES[cal], pantalla); return w * h * d * d; };
  assert.ok(px("medio") < px("alto") * 0.8, `«medio» apenas ahorra: ${Math.round(px("medio"))} frente a ${Math.round(px("alto"))}`);
  assert.ok(px("bajo") < px("medio") * 0.7, "«bajo» tiene que ahorrar mucho más");
  assert.ok(px("bajo") < 600000, "en el perfil mínimo no se pueden pintar más de 0,6 Mpx");
});

test("en una arena pequeña el presupuesto no estropea la nitidez", () => {
  // La demo (514×430) cabe de sobra en el presupuesto: ahí no hay que recortar nada.
  assert.equal(pixelesPorCss(514, 430, CALIDADES.alto, 1.25), 1.25);
  assert.equal(pixelesPorCss(514, 430, CALIDADES.alto, 2), 2);
});

test("la resolución nunca baja tanto que se vea a cuadros", () => {
  for (const cal of ESCALERA) {
    const d = pixelesPorCss(4000, 2500, CALIDADES[cal], 3);
    assert.ok(d >= DPR_MINIMO, `${cal} baja a ${d}, por debajo del mínimo`);
  }
});

test("pixelesPorCss aguanta tamaños imposibles", () => {
  for (const [w, h] of [[0, 0], [-5, 10], [NaN, 100]]) {
    const d = pixelesPorCss(w, h, CALIDADES.alto, 1);
    assert.ok(Number.isFinite(d) && d > 0, `${w}x${h} da ${d}`);
  }
});

test("quien monta la escena puede pedir su propio tope de resolución", () => {
  assert.ok(pixelesPorCss(800, 600, CALIDADES.alto, 3, 1) <= 1);
});

// ───────────────────────── Movimiento reducido ─────────────────────────

test("con movimiento reducido las animaciones se recortan, pero no a cero", () => {
  assert.equal(duracion(400, false), 400);
  const corta = duracion(400, true);
  assert.ok(corta < 400 && corta >= 60, `esperaba algo corto pero visible, salió ${corta}`);
  assert.ok(duracion(10, true) >= 60, "nunca cero: main.js encadena awaits");
  assert.equal(movimientoReducido({ matches: true }), true);
  assert.equal(movimientoReducido({ matches: false }), false);
});

// ───────────────────────── Textos de los golpes ─────────────────────────

test("textoDeGolpe dice lo mismo que fx.js en cada caso", () => {
  assert.deepEqual(textoDeGolpe(12), { texto: "−12", clase: "dano" });
  assert.deepEqual(textoDeGolpe(42, { critico: true }), { texto: "¡42!", clase: "critico" });
  assert.deepEqual(textoDeGolpe(4, { bloqueado: true }), { texto: "🛡 4", clase: "bloqueo" });
  assert.deepEqual(textoDeGolpe(0, { bloqueado: true }), { texto: "¡Bloqueado!", clase: "bloqueo" });
  assert.deepEqual(textoDeGolpe(0, { esquivado: true }), { texto: "¡Esquiva!", clase: "esquiva" });
  assert.deepEqual(textoDeGolpe("esquiva"), { texto: "¡Esquiva!", clase: "esquiva" });
  // La esquiva manda sobre todo lo demás, igual que en fx.animarGolpe.
  assert.equal(textoDeGolpe(99, { critico: true, esquivado: true }).clase, "esquiva");
});

test("el rótulo de un crítico es más grande que el de un golpe normal", () => {
  assert.ok(altoTexto("critico") > altoTexto("dano"));
  assert.equal(altoTexto("loquesea"), altoTexto("dano"));
});

// ───────────────────────── Encuadre de la cámara ─────────────────────────

test("la cámara NUNCA se sale de la arena, sea cual sea la pantalla", () => {
  // Regresión: con la cámara más lejos que el radio del muro, el muro y los estandartes se
  // metían por delante y tapaban a los luchadores con una franja negra (visto en móvil vertical).
  const formas = [0.4, 0.55, 0.75, 0.87, 1, 1.2, 1.33, 1.6, 1.78, 2.1, 2.4, 3.5];
  for (const a of formas) {
    const { distancia } = encuadre(a);
    assert.ok(distancia < RADIO_ARENA - 1, `con aspecto ${a} la cámara (${distancia}) toca el muro (${RADIO_ARENA})`);
    assert.ok(distancia >= CAMARA.min, `con aspecto ${a} la cámara se acerca demasiado`);
  }
});

test("el encuadre siempre abarca a los dos luchadores, juntándolos si hace falta", () => {
  for (const a of [0.4, 0.87, 1, 1.33, 1.78, 2.4]) {
    for (const alto of [1.1, 2.0, 4.7]) {
      const e = encuadre(a, alto);
      const mediaAnchura = Math.tan((e.fov * Math.PI) / 360) * e.distancia * a;
      assert.ok(Math.abs(mediaAnchura - e.cobertura) < 0.01, "cobertura mal calculada");
      assert.ok(e.cobertura >= e.puesto + ANCHO_LUCHADOR - 0.02 || e.puesto <= 0.91,
        `aspecto ${a}, alto ${alto}: cubre ${e.cobertura.toFixed(2)} y el puesto está en ${e.puesto}`);
      assert.ok(e.puesto <= PUESTO_X, "el puesto nunca se separa más de lo previsto");
    }
  }
});

test("una criatura más alta hace que la cámara se eche atrás y mire más arriba", () => {
  const rata = encuadre(16 / 9, 1.1);
  const dragon = encuadre(16 / 9, 4.7);
  assert.ok(dragon.distancia > rata.distancia, "un dragón necesita más plano");
  assert.ok(dragon.miraY > rata.miraY, "hay que mirar al centro del bicho, no a sus patas");
  const medioAlto = Math.tan((dragon.fov * Math.PI) / 360) * dragon.distancia;
  assert.ok(dragon.miraY + medioAlto >= 4.7, "el dragón se sale por arriba del plano");
});

test("en pantalla estrecha se abre el ángulo; en ancha se acerca la cámara", () => {
  const movil = encuadre(375 / 700);
  const ancha = encuadre(16 / 9);
  assert.ok(movil.fov > ancha.fov, "en vertical hace falta más ángulo");
  assert.ok(movil.fov <= CAMARA.fovMax && movil.fov >= CAMARA.fovMin);
  assert.ok(ancha.distancia <= movil.distancia);
});

test("el encuadre aguanta valores imposibles", () => {
  for (const malo of [0, -1, NaN, undefined, null, Infinity]) {
    const e = encuadre(malo);
    assert.ok(Number.isFinite(e.distancia) && e.distancia > 0, `aspecto ${malo} da ${e.distancia}`);
    assert.ok(Number.isFinite(e.fov) && e.fov > 0);
  }
  assert.equal(distanciaCamara(16 / 9), encuadre(16 / 9).distancia);
});

test("los luchadores caben dentro de la arena", () => {
  assert.ok(PUESTO_X + ANCHO_LUCHADOR < RADIO_ARENA, "un jefe en su puesto no puede salirse del muro");
  assert.ok(MEDIO_PLANO > PUESTO_X, "hay que abarcar al luchador entero, no solo su puesto");
});
