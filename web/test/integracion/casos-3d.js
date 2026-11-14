// Modo 3D (botón 🧊 de la cabecera, clave "lootarena:3d" en localStorage).
//
// El motor se elige AL ARRANCAR (`elegirMotor()` en main.js), así que cada caso abre la app con la
// clave ya puesta. El 3D importa three.js de un CDN: estos casos necesitan red de verdad, porque
// un `import()` no pasa por el `fetch` que el arnés dobla.

import { caso, afirmar, igual, esperarA, dormir } from "./arnes.js";
import { explorar, combatirHastaElFinal, cerrarResultado, vida, irASeccion, SECCIONES, seccionesDe, resultadoVisible } from "./ayudas.js";

export const SEMILLA_3D = { "lootarena:3d": "1" };

/** Espera a que la escena 3D esté dibujando de verdad (no solo montada). */
async function esperar3D(app, { ms = 25000 } = {}) {
  await esperarA(() => app.$("#escena canvas.r3d-lienzo"), "se monte el lienzo del motor 3D", { ms });
  // El motor descarga three.js del CDN: puede tardar. Si cae a 2D, el caso lo dirá con claridad.
  await esperarA(() => {
    const l = app.$("#escena canvas.r3d-lienzo");
    return l && l.width > 1 && l.height > 1;
  }, "el lienzo 3D tenga tamaño (señal de que three.js cargó y la escena arrancó)", { ms });
}

const lienzos = (app) => app.$$("#escena canvas").map((c) => c.className || "(sin clase)");

caso("3D", "Con el 3D activo queda un solo lienzo en la arena, y es el del motor 3D", async ({ abrirApp }) => {
  const app = await abrirApp({ semilla: SEMILLA_3D });
  await esperar3D(app);
  const clases = lienzos(app);
  igual(clases.join(", "), "r3d-lienzo",
    `En la arena deberían convivir cero lienzos 2D con el del 3D. Hay ${clases.length}: ${clases.join(", ")}. Recuerda que index.html llama a iniciarInterfaz() de fx.js (2D) antes de que main.js elija motor.`);
  app.sinErrores("con el motor 3D montado");
});

caso("3D", "Con el 3D desactivado no queda ningún lienzo del motor 3D", async ({ abrirApp }) => {
  const app = await abrirApp({ semilla: { "lootarena:3d": "0" } });
  await dormir(600);
  igual(app.$$("#escena canvas.r3d-lienzo").length, 0, "En modo 2D no debería haber lienzo del motor 3D.");
  afirmar(app.$$("#escena canvas").length > 0, "En modo 2D la arena se ha quedado sin ningún lienzo.");
  app.sinErrores("en modo 2D");
});

caso("3D", "Volver del 3D al 2D no deja restos del motor 3D", async ({ abrirApp }) => {
  const app1 = await abrirApp({ semilla: SEMILLA_3D });
  await esperar3D(app1);
  app1.cerrar();
  // El botón escribe la clave y recarga; aquí se simula el resultado: misma sesión, 3D apagado.
  const app2 = await abrirApp({ limpiar: false, semilla: { "lootarena:3d": "0" } });
  await dormir(800);
  igual(app2.$$("#escena canvas.r3d-lienzo").length, 0, "Tras volver al 2D sigue habiendo lienzo del motor 3D.");
  await explorar(app2);
  await combatirHastaElFinal(app2);
  await cerrarResultado(app2);
  app2.sinErrores("tras volver del 3D al 2D");
});

caso("3D", "Un combate entero en 3D termina bien y sin errores", async ({ abrirApp }) => {
  const app = await abrirApp({ semilla: SEMILLA_3D });
  await esperar3D(app);
  const nombre = await explorar(app);
  afirmar(nombre && nombre !== "Arena vacía", "En 3D la arena sigue vacía tras pulsar Explorar.");
  const v0 = vida(app, "enemigo");
  afirmar(v0 && v0.actual === v0.max, `El HUD de vida del enemigo no se pinta en 3D (${JSON.stringify(v0)}).`);
  const fin = await combatirHastaElFinal(app);
  afirmar(["¡VICTORIA!", "DERROTA"].includes(fin.titulo), `Final inesperado en 3D: «${fin.titulo}».`);
  await cerrarResultado(app);
  await esperarA(() => !app.$("#btn-explorar").disabled, "se pueda volver a explorar tras el combate en 3D");
  app.sinErrores("durante un combate en 3D");
});

caso("3D", "En 3D el HUD sigue contando vida, estados e intención (el lienzo no es accesible)", async ({ abrirApp }) => {
  const app = await abrirApp({ semilla: SEMILLA_3D });
  await esperar3D(app);
  const lienzo = app.$("#escena canvas.r3d-lienzo");
  igual(lienzo.getAttribute("aria-hidden"), "true", "El lienzo 3D no está marcado como decorativo: un lector de pantalla intentará anunciarlo.");
  await explorar(app);
  const antes = vida(app, "enemigo");
  app.pulsar("#btn-atacar");
  await esperarA(() => (vida(app, "enemigo")?.actual ?? Infinity) < antes.actual || resultadoVisible(app),
    "la barra de vida del HUD baje tras atacar en 3D (si no, quien no ve el lienzo se queda sin información)");
  afirmar(app.texto("#f-enemigo .f-name").length > 0, "El nombre del enemigo no aparece en el HUD en modo 3D.");
  app.sinErrores("leyendo el HUD en 3D");
});

caso("3D", "Cambiar de sección y volver con el 3D puesto no duplica lienzos", async ({ abrirApp }) => {
  const app = await abrirApp({ semilla: SEMILLA_3D });
  await esperar3D(app);
  for (const s of ["inventario", "torre", "expediciones", "arena"]) { await irASeccion(app, s); await dormir(150); }
  await dormir(500);
  const clases = lienzos(app);
  igual(clases.length, 1, `Tras pasear por las secciones hay ${clases.length} lienzos en la arena: ${clases.join(", ")}.`);
  app.sinErrores("paseando por las secciones con el 3D puesto");
});

caso("3D", "El botón 🧊 de la cabecera dice en qué modo estás y se puede pulsar con el teclado", async ({ abrirApp }) => {
  const app = await abrirApp();
  const b = app.$("#btn-3d");
  afirmar(b, "No existe el botón #btn-3d de la cabecera.");
  igual(b.getAttribute("aria-pressed"), "false", "En 2D el botón 3D debería tener aria-pressed=\"false\".");
  afirmar((b.getAttribute("aria-label") ?? "").trim().length > 0, "El botón 3D no tiene nombre accesible.");
  afirmar(b.tabIndex >= 0 && !b.disabled, "El botón 3D no se alcanza con el teclado.");
  app.cerrar();

  const app3d = await abrirApp({ semilla: SEMILLA_3D });
  igual(app3d.$("#btn-3d").getAttribute("aria-pressed"), "true", "Con el 3D activo el botón debería tener aria-pressed=\"true\".");
  app3d.sinErrores("mirando el botón 3D");
});

caso("3D", "Si el equipo no puede con el 3D, el juego cae al 2D y lo dice", async ({ abrirApp }) => {
  // Se simula un navegador sin WebGL: `soporta3d()` pide un contexto webgl2/webgl al canvas.
  const app = await abrirApp({
    semilla: SEMILLA_3D,
    antesDeCargar: (w) => {
      const real = w.HTMLCanvasElement.prototype.getContext;
      w.HTMLCanvasElement.prototype.getContext = function (tipo, ...resto) {
        if (tipo === "webgl" || tipo === "webgl2" || tipo === "experimental-webgl") return null;
        return real.call(this, tipo, ...resto);
      };
    },
  });
  await dormir(1500);
  igual(app.$$("#escena canvas.r3d-lienzo").length, 0, "Sin WebGL no debería montarse el lienzo 3D.");
  afirmar(app.$$("#escena canvas").length > 0, "Sin WebGL la arena se queda sin ningún lienzo: no hay caída al 2D.");
  await esperarA(() => /3D/i.test(app.texto("#toasts")), "se avise al jugador de que se sigue en 2D", { ms: 6000 });
  await explorar(app);
  app.sinErrores("cayendo del 3D al 2D");
});

caso("3D", "El 3D no rompe las secciones ni el teclado", async ({ abrirApp }) => {
  const app = await abrirApp({ semilla: SEMILLA_3D });
  await esperar3D(app);
  for (const s of seccionesDe(app)) {
    await irASeccion(app, s);
    await esperarA(() => app.$(`#seccion-${s}`).textContent.trim().length > 40, `la sección «${s}» tenga contenido con el 3D puesto`, { ms: 3000 });
  }
  await irASeccion(app, "arena");
  app.$("#btn-explorar").focus();
  igual(app.doc.activeElement?.id, "btn-explorar", "Con el 3D puesto no se puede poner el foco en Explorar.");
  app.sinErrores("recorriendo las secciones con el 3D");
});
