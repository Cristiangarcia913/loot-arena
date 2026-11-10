// Expediciones, torre y el resto de secciones de contenido, sin wallet.

import { caso, afirmar, igual, esperarA, dormir } from "./arnes.js";
import { irASeccion, explorar, combatirHastaElFinal, cerrarResultado, resultadoVisible } from "./ayudas.js";

caso("Expediciones", "La sección se pinta y se puede enviar al héroe", async ({ abrirApp }) => {
  const app = await abrirApp();
  await irASeccion(app, "expediciones");
  const cont = app.$("#expediciones");
  await esperarA(() => cont.querySelector("button"), "aparezcan las expediciones disponibles");
  const opciones = [...cont.querySelectorAll("button")].filter((b) => !b.disabled);
  afirmar(opciones.length >= 1, "No hay ninguna expedición que se pueda enviar.");
  opciones[0].click();
  await esperarA(() => cont.querySelector(".exp-activa"), "la expedición aparezca en curso tras enviarla");
  afirmar(cont.querySelector('[role="progressbar"]'), "La expedición en curso no tiene barra de progreso accesible (role=progressbar).");
  app.sinErrores("al enviar una expedición");
});

caso("Expediciones", "La cuenta atrás avanza y no se dispara cuando la sección se oculta", async ({ abrirApp }) => {
  const app = await abrirApp();
  await irASeccion(app, "expediciones");
  const cont = app.$("#expediciones");
  await esperarA(() => cont.querySelector("button:not([disabled])"), "aparezcan las expediciones");
  cont.querySelector("button:not([disabled])").click();
  await esperarA(() => cont.querySelector(".exp-cuenta"), "aparezca la cuenta atrás");
  const t1 = cont.querySelector(".exp-cuenta").textContent;
  await dormir(1500);
  const t2 = cont.querySelector(".exp-cuenta").textContent;
  afirmar(t1 !== t2, `La cuenta atrás de la expedición no avanza (sigue en «${t1}» tras 1,5 s).`);
  await irASeccion(app, "arena");
  await dormir(600);
  app.sinErrores("con la expedición en curso y la sección oculta");
});

caso("Torre", "La sección se pinta y se puede empezar una subida", async ({ abrirApp }) => {
  const app = await abrirApp();
  await irASeccion(app, "torre");
  const cont = app.$("#torre");
  await esperarA(() => cont.textContent.trim().length > 20, "la Torre se pinte");
  const empezar = [...cont.querySelectorAll("button")].find((b) => !b.disabled);
  afirmar(empezar, "La Torre no ofrece ningún botón activo para empezar a subir.");
  empezar.click();
  await esperarA(() => app.visible("#seccion-arena") || !app.$("#btn-atacar").disabled, "la subida a la Torre lleve a un combate");
  app.sinErrores("al empezar la Torre");
});

// Ojo: al GANAR un piso la Torre no abre la pantalla de resultado a pantalla completa como el
// resto del juego, sino el panel #resultado con un botón «Subir al piso N». Solo al perder sale
// la pantalla grande. El caso acepta los dos finales.
caso("Torre", "Un piso de la torre se juega hasta el final y ofrece seguir subiendo", async ({ abrirApp }) => {
  const app = await abrirApp();
  await irASeccion(app, "torre");
  const cont = app.$("#torre");
  await esperarA(() => [...cont.querySelectorAll("button")].some((b) => !b.disabled), "la Torre ofrezca empezar");
  [...cont.querySelectorAll("button")].find((b) => !b.disabled).click();
  await esperarA(() => !app.$("#btn-atacar").disabled, "empiece el combate del primer piso");

  const pisoTerminado = () => resultadoVisible(app) || /Piso \d+ superado|Fin de la subida/i.test(app.texto("#resultado"));
  let turnos = 0;
  while (turnos < 140 && !pisoTerminado()) {
    const hab = app.$$("#skills button").find((b) => !b.disabled);
    const pocion = app.$("#btn-pocion");
    if (hab) hab.click();
    else if (pocion && !pocion.disabled) pocion.click();
    else if (!app.$("#btn-atacar").disabled) app.$("#btn-atacar").click();
    turnos++;
    await dormir(45);
  }
  await esperarA(pisoTerminado, "el piso termine con un resultado visible", { ms: 8000 });

  if (resultadoVisible(app)) {
    igual(app.texto("#pantalla-resultado .resultado-titulo"), "DERROTA", "Al caer en la Torre debería salir la pantalla de DERROTA.");
    await cerrarResultado(app);
  } else {
    afirmar(/Subir al piso/i.test(app.texto("#resultado")), `Tras superar un piso no se ofrece subir al siguiente: «${app.texto("#resultado").slice(0, 120)}».`);
    await irASeccion(app, "torre");
    afirmar(/Piso 2|Luchar en el piso/i.test(app.texto("#torre")), "La sección Torre no refleja que se ha superado el piso 1.");
  }
  app.sinErrores("al jugar un piso de la Torre");
});

caso("Misiones", "La sección muestra diario, misiones, desafío y pase", async ({ abrirApp }) => {
  const app = await abrirApp();
  await irASeccion(app, "misiones");
  for (const id of ["diario", "misiones-diarias", "mision-semanal", "desafio", "pase"]) {
    await esperarA(() => app.$(`#${id}`)?.textContent.trim().length > 5, `el bloque «${id}» tenga contenido`);
  }
  app.sinErrores("en Misiones");
});

caso("Logros", "La sección muestra logros y colección con su progreso", async ({ abrirApp }) => {
  const app = await abrirApp();
  await irASeccion(app, "logros");
  await esperarA(() => app.$("#logros").textContent.trim().length > 20, "los logros se pinten");
  await esperarA(() => app.$("#coleccion").textContent.trim().length > 20, "la colección se pinte");
  app.sinErrores("en Logros");
});

caso("Inventario", "Sin wallet el inventario explica que hay que conectarse, no se queda en blanco", async ({ abrirApp }) => {
  const app = await abrirApp();
  await irASeccion(app, "inventario");
  await esperarA(() => app.texto("#inv-estado").length > 0 || app.$("#inv-grid").children.length > 0,
    "el inventario diga algo al jugador sin wallet (ahora mismo se queda mudo)");
  app.sinErrores("en Inventario sin wallet");
});

caso("Ranking", "Sin servidor el ranking muestra un mensaje de error legible, no un hueco vacío", async ({ abrirApp }) => {
  const app = await abrirApp({ servidor: "caido" });
  await irASeccion(app, "ranking");
  await esperarA(() => app.$("#ranking").textContent.trim().length > 10, "el ranking diga algo cuando el servidor no responde", { ms: 15000 });
  app.sinErrores("con el ranking sin servidor");
});

caso("Héroe", "La sección Héroe muestra retrato, estadísticas y vestuario", async ({ abrirApp }) => {
  const app = await abrirApp();
  await irASeccion(app, "heroe");
  await esperarA(() => app.$("#heroe-stats").textContent.trim().length > 10, "las estadísticas del héroe se pinten");
  afirmar(app.$("#heroe-retrato")?.children.length, "El retrato del héroe está vacío.");
  app.sinErrores("en Héroe");
});

caso("Mercado", "Sin wallet el Mercado explica qué hace falta en vez de quedarse vacío", async ({ abrirApp }) => {
  const app = await abrirApp();
  await irASeccion(app, "mercado");
  await esperarA(() => app.$("#merc-vender").textContent.trim().length > 10, "el panel Vender diga algo sin wallet");
  app.pulsar("#merc-tab-comprar");
  await esperarA(() => app.$("#merc-comprar").textContent.trim().length > 10, "el panel Comprar diga algo sin wallet");
  igual(resultadoVisible(app), false, "No debería haber pantalla de resultado abierta en el Mercado.");
  app.sinErrores("en el Mercado sin wallet");
});

caso("Arena", "La crónica del combate se puede abrir y cerrar", async ({ abrirApp }) => {
  const app = await abrirApp();
  await explorar(app);
  const det = app.$("#cronica");
  afirmar(det, "No existe la crónica del combate.");
  det.open = true;
  await dormir(100);
  afirmar(app.$$("#log li").length > 0, "La crónica abierta no muestra ninguna línea.");
  det.open = false;
  app.sinErrores("al abrir la crónica");
});
