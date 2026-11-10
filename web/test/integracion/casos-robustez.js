// Caza de errores: romper cosas a propósito. Doble pulsación, cambios de sección a mitad de
// animación, recarga en combate, almacenamiento bloqueado o lleno, servidor caído y red lenta.

import { caso, afirmar, igual, esperarA, dormir } from "./arnes.js";
import { explorar, combatirHastaElFinal, cerrarResultado, vida, resultadoVisible, irASeccion, SECCIONES, semillaDerrotaSegura } from "./ayudas.js";

caso("Robustez", "Pulsar Atacar dos veces muy rápido no gasta dos turnos", async ({ abrirApp }) => {
  const app = await abrirApp({ movimiento: "normal" }); // con animaciones reales, que es cuando se nota
  await explorar(app);
  const antes = vida(app, "enemigo");
  const btn = app.$("#btn-atacar");
  btn.click();
  btn.click(); // segunda pulsación inmediata, antes de que termine la animación
  await esperarA(() => (vida(app, "enemigo")?.actual ?? antes.actual) < antes.actual, "el ataque surta efecto");
  await dormir(1200);
  const danos = app.$$("#log li").filter((li) => /golpea|ataca|daño|crítico/i.test(li.textContent)).length;
  afirmar(danos <= 2, `Dos pulsaciones seguidas en Atacar produjeron ${danos} golpes en la crónica: el botón no bloquea el doble clic.`);
  app.sinErrores("tras un doble clic en Atacar");
});

caso("Robustez", "Pulsar Explorar dos veces seguidas no abre dos combates", async ({ abrirApp }) => {
  const app = await abrirApp({ movimiento: "normal" });
  const btn = app.$("#btn-explorar");
  btn.click(); btn.click();
  await esperarA(() => !app.$("#btn-atacar").disabled, "empiece el combate");
  const v = vida(app, "enemigo");
  afirmar(v && v.actual === v.max, `Tras un doble clic en Explorar el enemigo no está entero: ${JSON.stringify(v)}.`);
  app.sinErrores("tras un doble clic en Explorar");
});

caso("Robustez", "Cambiar de sección mientras se anima el combate no rompe nada", async ({ abrirApp }) => {
  const app = await abrirApp({ movimiento: "normal" });
  await explorar(app);
  app.pulsar("#btn-atacar");
  await dormir(60); // justo en mitad de la animación del golpe
  for (const s of ["inventario", "misiones", "torre", "arena"]) {
    app.$(`.menu-item[data-ir="${s}"]`).click();
    await dormir(80);
  }
  await esperarA(() => app.visible("#seccion-arena"), "volvamos a la Arena");
  await esperarA(() => !app.$("#btn-atacar").disabled || resultadoVisible(app),
    "el combate vuelva a aceptar órdenes tras cambiar de sección en mitad de la animación (si no, el jugador se queda encallado)", { ms: 10000 });
  app.sinErrores("al cambiar de sección durante una animación");
});

caso("Robustez", "Recargar a mitad de combate deja la arena utilizable", async ({ abrirApp }) => {
  const app = await abrirApp();
  await explorar(app);
  app.pulsar("#btn-atacar");
  await dormir(150);
  app.cerrar();

  const app2 = await abrirApp({ limpiar: false });
  afirmar(app2.visible("#seccion-arena"), "Tras recargar no se ve la Arena.");
  afirmar(!app2.$("#btn-explorar").disabled, "Tras recargar a mitad de combate el botón Explorar está desactivado: el jugador se queda encallado.");
  await explorar(app2);
  app2.sinErrores("tras recargar en mitad de combate");
});

caso("Robustez", "Recargar justo después de ganar no duplica ni pierde el progreso", async ({ abrirApp }) => {
  const app = await abrirApp();
  await explorar(app);
  await combatirHastaElFinal(app);
  await cerrarResultado(app);
  const xp = app.$("#hero-xp")?.getAttribute("aria-valuenow");
  app.cerrar();
  const app2 = await abrirApp({ limpiar: false });
  igual(app2.$("#hero-xp")?.getAttribute("aria-valuenow"), xp, "La XP cambia al recargar: el progreso no se guarda bien.");
  app2.sinErrores("al recargar tras ganar");
});

caso("Robustez", "Con el almacenamiento bloqueado (modo privado) la página arranca y se puede combatir", async ({ abrirApp }) => {
  const app = await abrirApp({ almacen: "bloqueado" });
  afirmar(app.visible("#seccion-arena") || app.visible("#pantalla-portada"), "Con localStorage bloqueado la página no llega a mostrarse.");
  await explorar(app);
  await combatirHastaElFinal(app);
  await cerrarResultado(app);
  app.sinErrores("con el almacenamiento bloqueado");
});

caso("Robustez", "Con la cuota de almacenamiento llena el juego sigue funcionando", async ({ abrirApp }) => {
  const app = await abrirApp({ almacen: "lleno" });
  await explorar(app);
  await combatirHastaElFinal(app);
  await cerrarResultado(app);
  app.sinErrores("con la cuota de localStorage llena");
});

caso("Robustez", "Un progreso corrupto en localStorage no impide jugar", async ({ abrirApp }) => {
  const app = await abrirApp({ semilla: { "lootarena:progreso:invitado": "{esto no es json" } });
  await explorar(app);
  app.sinErrores("con el progreso guardado corrupto");
});

caso("Robustez", "Un progreso con valores absurdos se sanea en vez de romper la interfaz", async ({ abrirApp }) => {
  const app = await abrirApp({ semilla: { "lootarena:progreso:invitado": JSON.stringify({ nivel: 9999, xp: -5, victorias: "muchas", racha: null }) } });
  await explorar(app);
  const nivel = app.texto("#hero-nivel");
  afirmar(/Nv\.\s*\d+/.test(nivel) && !/9999/.test(nivel), `La cabecera muestra un nivel absurdo: «${nivel}».`);
  app.sinErrores("con un progreso con valores absurdos");
});

caso("Robustez", "Con el servidor caído la página arranca, combate y no deja errores sin capturar", async ({ abrirApp }) => {
  const app = await abrirApp({ servidor: "caido" });
  await explorar(app);
  await combatirHastaElFinal(app);
  await cerrarResultado(app);
  for (const s of SECCIONES) await irASeccion(app, s);
  app.sinErrores("con el servidor caído");
});

caso("Robustez", "Con la red muy lenta (3 s por petición) la interfaz responde desde el principio", async ({ abrirApp }) => {
  const t0 = performance.now();
  const app = await abrirApp({ retardoRed: 3000 });
  const listo = performance.now() - t0;
  afirmar(listo < 8000, `Con la red lenta la página tarda ${Math.round(listo)} ms en ser utilizable: las peticiones al servidor bloquean el arranque.`);
  await explorar(app);
  await combatirHastaElFinal(app);
  app.sinErrores("con la red lenta");
});

caso("Robustez", "Pulsar todos los botones de la arena sin combate no lanza errores", async ({ abrirApp }) => {
  const app = await abrirApp();
  for (const sel of ["#btn-atacar", "#btn-defender", "#btn-pocion", "#btn-huir"]) {
    app.pulsar(sel, { permitirDesactivado: true });
    await dormir(40);
  }
  app.sinErrores("al pulsar los botones de combate sin combate");
});

caso("Robustez", "Recorrer todas las secciones a toda velocidad no deja dos visibles ni errores", async ({ abrirApp }) => {
  const app = await abrirApp({ movimiento: "normal" });
  for (let v = 0; v < 3; v++) for (const s of SECCIONES) { app.$(`.menu-item[data-ir="${s}"]`).click(); await dormir(25); }
  await dormir(600);
  const visibles = SECCIONES.filter((s) => app.visible(`#seccion-${s}`));
  igual(visibles.length, 1, `Tras cambiar de sección muy rápido quedan ${visibles.length} secciones visibles a la vez (${visibles.join(", ")}).`);
  app.sinErrores("al cambiar de sección muy rápido");
});

caso("Robustez", "Pulsar dos veces el botón de resultado no deja la pantalla colgada", async ({ abrirApp }) => {
  const app = await abrirApp();
  await explorar(app);
  await combatirHastaElFinal(app);
  const botones = app.$$("#pantalla-resultado .resultado-acciones button");
  botones[1].click(); botones[1].click();
  await esperarA(() => !app.visible("#pantalla-resultado"), "la pantalla de resultado se cierre");
  await dormir(300);
  app.sinErrores("tras pulsar dos veces Continuar");
});

caso("Robustez", "La derrota con el servidor caído sigue mostrando la pantalla de resultado", async ({ abrirApp }) => {
  const app = await abrirApp({ servidor: "caido", semilla: semillaDerrotaSegura() });
  await explorar(app);
  const fin = await combatirHastaElFinal(app, { maxTurnos: 120 });
  igual(fin.titulo, "DERROTA", `Se esperaba DERROTA; salió «${fin.titulo}».`);
  app.sinErrores("en la derrota sin servidor");
});
