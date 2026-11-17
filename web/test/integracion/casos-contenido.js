// Expediciones y el resto de secciones de contenido, sin wallet.

import { caso, afirmar, igual, esperarA, dormir } from "./arnes.js";
import { irASeccion, explorar, resultadoVisible } from "./ayudas.js";

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
