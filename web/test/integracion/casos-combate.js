// Combate completo, derrota, huida y tutorial de 5 pasos.

import { caso, afirmar, igual, esperarA, dormir } from "./arnes.js";
import { explorar, combatirHastaElFinal, cerrarResultado, vida, resultadoVisible, semillaDerrotaSegura, irASeccion } from "./ayudas.js";

caso("Combate", "Un combate entero hasta la victoria: vida, crónica y pantalla de resultado", async ({ abrirApp }) => {
  const app = await abrirApp();
  const nombre = await explorar(app);
  const v0 = vida(app, "enemigo");
  afirmar(v0 && v0.actual === v0.max, `El enemigo «${nombre}» no empieza con la vida llena (${JSON.stringify(v0)}).`);

  app.pulsar("#btn-atacar");
  // Un ataque puede fallar por esquiva, así que se insiste unos turnos antes de darlo por roto.
  await esperarA(() => {
    const b = app.$("#btn-atacar");
    if (b && !b.disabled && (vida(app, "enemigo")?.actual ?? 0) === v0.actual) b.click();
    return (vida(app, "enemigo")?.actual ?? Infinity) < v0.actual || resultadoVisible(app);
  }, "los ataques bajen la vida del enemigo");

  const fin = await combatirHastaElFinal(app);
  igual(fin.titulo, "¡VICTORIA!", `Con el héroe de nivel 1 contra el primer enemigo se esperaba victoria; salió «${fin.titulo}».`);
  afirmar(app.$$("#log li").length >= 3, `La crónica del combate solo tiene ${app.$$("#log li").length} líneas.`);
  await cerrarResultado(app);
  await esperarA(() => !app.$("#btn-explorar").disabled, "se pueda volver a explorar tras cerrar el resultado");
  app.sinErrores("durante un combate completo");
});

caso("Combate", "Tras la victoria se suman XP y victorias en la cabecera", async ({ abrirApp }) => {
  const app = await abrirApp();
  const xpAntes = app.$("#hero-xp")?.getAttribute("aria-valuenow");
  await explorar(app);
  await combatirHastaElFinal(app);
  await cerrarResultado(app);
  await esperarA(() => app.$("#hero-xp")?.getAttribute("aria-valuenow") !== xpAntes, "la barra de XP de la cabecera se actualice tras ganar");
  app.sinErrores("al cobrar la XP");
});

caso("Combate", "Derrota: aparece la pantalla DERROTA y la arena vuelve a estar jugable", async ({ abrirApp }) => {
  const app = await abrirApp({ semilla: semillaDerrotaSegura() });
  await explorar(app);
  const fin = await combatirHastaElFinal(app, { maxTurnos: 120 });
  igual(fin.titulo, "DERROTA", `Contra un jefe de nivel 10 con el héroe a nivel 1 se esperaba derrota; salió «${fin.titulo}».`);
  await cerrarResultado(app);
  afirmar(app.visible("#resultado") && /Derrota/i.test(app.texto("#resultado")), "Tras la derrota no se explica al jugador qué ha pasado en #resultado.");
  await esperarA(() => !app.$("#btn-explorar").disabled, "se pueda volver a explorar tras una derrota");
  app.sinErrores("durante una derrota");
});

caso("Combate", "Huir termina el combate y devuelve el control", async ({ abrirApp }) => {
  const app = await abrirApp();
  await explorar(app);
  app.pulsar("#btn-huir");
  await esperarA(() => resultadoVisible(app), "aparezca la pantalla de resultado al huir");
  igual(app.texto("#pantalla-resultado .resultado-titulo"), "HUIDA", "Al huir no sale la pantalla de HUIDA.");
  await cerrarResultado(app);
  await esperarA(() => !app.$("#btn-explorar").disabled, "se pueda explorar de nuevo tras huir");
  app.sinErrores("al huir");
});

caso("Combate", "Las habilidades se usan y se quedan recargando", async ({ abrirApp }) => {
  const app = await abrirApp();
  await explorar(app);
  const disponibles = app.$$("#skills button").filter((b) => !b.disabled);
  afirmar(disponibles.length > 0, "No hay ninguna habilidad disponible al empezar el combate.");
  const nombre = disponibles[0].textContent.trim();
  const i = app.$$("#skills button").indexOf(disponibles[0]);
  disponibles[0].click();
  // #skills se repinta entero en cada turno: hay que volver a buscar el botón, no guardar el nodo.
  await esperarA(() => app.$$("#skills button")[i]?.disabled || resultadoVisible(app), `la habilidad «${nombre}» entre en recarga tras usarla`);
  app.sinErrores("al usar una habilidad");
});

caso("Combate", "Atacando sin más, un héroe nuevo pierde su primer combate (balance de entrada)", async ({ abrirApp }) => {
  const intentos = 5;
  const resultados = [];
  for (let i = 0; i < intentos; i++) {
    const app = await abrirApp();
    await explorar(app);
    resultados.push((await combatirHastaElFinal(app, { estrategia: "solo-atacar" })).titulo);
    app.cerrar();
  }
  const derrotas = resultados.filter((r) => r === "DERROTA").length;
  afirmar(derrotas < intentos,
    `Un jugador nuevo que solo pulsa Atacar —que es justo lo que le pide el paso 2 del tutorial— pierde el primer combate ${derrotas} de ${intentos} veces. Con habilidades y poción se gana siempre, así que el problema es el balance de entrada, no el combate.`);
});

caso("Combate", "Un turno con las animaciones puestas no hace esperar más de 2,5 s", async ({ abrirApp }) => {
  const app = await abrirApp({ movimiento: "normal" });
  await explorar(app);
  const tiempos = [];
  for (let i = 0; i < 4 && !resultadoVisible(app); i++) {
    await esperarA(() => !app.$("#btn-atacar").disabled || resultadoVisible(app), "el botón Atacar esté listo", { ms: 12000 });
    if (resultadoVisible(app)) break;
    const t0 = performance.now();
    app.$("#btn-atacar").click();
    await esperarA(() => !app.$("#btn-atacar").disabled || resultadoVisible(app), "el turno termine", { ms: 12000 });
    tiempos.push(Math.round(performance.now() - t0));
  }
  const peor = Math.max(...tiempos);
  afirmar(peor <= 2500, `Un turno tarda hasta ${peor} ms en devolver el control (turnos medidos: ${tiempos.join(", ")} ms). Con combates de 10-15 turnos eso es más de medio minuto mirando animaciones.`);
});

caso("Combate", "Durante el combate no se puede explorar otra vez", async ({ abrirApp }) => {
  const app = await abrirApp();
  await explorar(app);
  afirmar(app.$("#btn-explorar").disabled, "Con un combate en curso el botón Explorar sigue activo: se puede abandonar al enemigo sin consecuencias.");
});

caso("Tutorial", "El tutorial guía los primeros pasos y avanza al jugar", async ({ abrirApp }) => {
  const app = await abrirApp({ tutorial: "nuevo" });
  const paso = () => {
    const m = /Paso\s+(\d+)\s+de\s+(\d+)/i.exec(app.$(".tut-cuenta")?.textContent ?? "");
    return m ? { n: Number(m[1]), total: Number(m[2]) } : null;
  };
  await esperarA(() => app.visible(".tut-capa") && paso(), "aparezca la guía del tutorial");
  igual(paso().total, 5, "El tutorial debería tener 5 pasos.");
  igual(paso().n, 1, "El tutorial no empieza en el paso 1.");
  afirmar(app.$(".tut-bocadillo")?.textContent.trim().length > 10, "El bocadillo del tutorial está vacío.");
  afirmar(app.$(".tut-saltar"), "El tutorial no ofrece ningún botón para saltarlo.");

  await explorar(app);
  await esperarA(() => paso()?.n === 2, "el tutorial pase al paso 2 tras explorar");
  app.pulsar("#btn-atacar");
  await esperarA(() => paso()?.n === 3, "el tutorial pase al paso 3 tras atacar");

  // Tras el ataque la interfaz se queda animando: hay que esperar a que las habilidades vuelvan.
  await esperarA(() => app.$$("#skills button").some((b) => !b.disabled) || resultadoVisible(app),
    "alguna habilidad vuelva a estar disponible para el paso 3 del tutorial");
  if (!resultadoVisible(app)) {
    app.$$("#skills button").find((b) => !b.disabled).click();
    await esperarA(() => (paso()?.n ?? 0) >= 4 || resultadoVisible(app), "el tutorial pase al paso 4 tras usar una habilidad");
  }
  app.sinErrores("durante el tutorial");
});

caso("Tutorial", "Escape salta el tutorial y no vuelve a aparecer", async ({ abrirApp }) => {
  const app = await abrirApp({ tutorial: "nuevo" });
  await esperarA(() => app.visible(".tut-capa"), "aparezca el tutorial");
  app.tecla("Escape", { destino: app.doc.body });
  await esperarA(() => !app.visible(".tut-capa"), "el tutorial desaparezca al pulsar Escape");
  app.cerrar();

  const app2 = await abrirApp({ limpiar: false, tutorial: "nuevo" });
  await dormir(600);
  afirmar(!app2.visible(".tut-capa"), "El tutorial vuelve a salir después de haberlo saltado.");
  app2.sinErrores("tras saltar el tutorial");
});

caso("Tutorial", "El botón «Saltar tutorial» lo cierra", async ({ abrirApp }) => {
  const app = await abrirApp({ tutorial: "nuevo" });
  await esperarA(() => app.$(".tut-saltar"), "aparezca el botón de saltar el tutorial");
  app.pulsar(".tut-saltar");
  await esperarA(() => !app.visible(".tut-capa"), "el tutorial se cierre al pulsar Saltar");
  app.sinErrores("al saltar el tutorial con el botón");
});
