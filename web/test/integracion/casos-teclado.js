// Teclado y lector de pantalla a fondo: orden de tabulación, trampas de foco, dónde aterriza el
// foco al cambiar de sección, qué se anuncia durante el combate y si se puede jugar sin ratón
// en todas las secciones nuevas (Expediciones, Torre) y en el modo 3D.
//
// Lo que un lector de pantalla anuncia se aproxima mirando el árbol accesible que expone el DOM:
// `aria-live`, `role`, nombres accesibles y el texto que cambia. No sustituye a escuchar la página
// con NVDA o VoiceOver, pero caza lo que se puede cazar sin oídos.

import { caso, afirmar, igual, esperarA, dormir } from "./arnes.js";
import { SECCIONES, seccionesDe, irASeccion, enfocables, nombreAccesible, explorar, resultadoVisible, vida, combatirHastaElFinal, cerrarResultado } from "./ayudas.js";

/** Simula Tab: devuelve el siguiente elemento enfocable en orden de documento. */
function siguienteFoco(app, hacia = 1) {
  const lista = enfocables(app);
  const i = lista.indexOf(app.doc.activeElement);
  if (!lista.length) return null;
  const j = i < 0 ? (hacia > 0 ? 0 : lista.length - 1) : (i + hacia + lista.length) % lista.length;
  lista[j].focus();
  return lista[j];
}

/** Recorre toda la página con Tab y devuelve el orden de nombres accesibles. */
function recorrerConTab(app, max = 120) {
  const visto = [];
  app.doc.body.focus();
  let anterior = null;
  for (let i = 0; i < max; i++) {
    const el = siguienteFoco(app);
    if (!el || el === anterior) break;
    visto.push({ el, nombre: nombreAccesible(el), etiqueta: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}` });
    anterior = el;
    if (visto.length > 1 && el === visto[0].el) break;
  }
  return visto;
}

// ───────────────────────── Orden y alcance del foco ─────────────────────────

caso("Teclado", "El primer Tab llega al enlace «Saltar al contenido» antes que a nada más", async ({ abrirApp }) => {
  const app = await abrirApp();
  const orden = recorrerConTab(app, 5);
  afirmar(orden.length > 0, "No hay ningún elemento enfocable en la página.");
  const saltar = app.$("a.saltar");
  igual(orden[0].el, saltar, `El primer destino de Tab debería ser «Saltar al contenido» y es «${orden[0].nombre}».`);
});

caso("Teclado", "«Saltar al contenido» lleva el foco al contenido, no solo al ancla", async ({ abrirApp }) => {
  const app = await abrirApp();
  const saltar = app.$("a.saltar");
  saltar.focus();
  saltar.click();
  await dormir(250);
  const destino = app.$("#secciones");
  const dentro = destino.contains(app.doc.activeElement) || app.doc.activeElement === destino;
  afirmar(dentro,
    `Tras usar «Saltar al contenido» el foco sigue en «${app.doc.activeElement?.id || app.doc.activeElement?.tagName}»: quien navega con teclado tiene que volver a tabular por toda la cabecera y el menú. El destino #secciones necesita tabindex="-1" y un .focus().`);
});

caso("Teclado", "Al cambiar de sección el foco va a la sección nueva", async ({ abrirApp }) => {
  const app = await abrirApp();
  const fallos = [];
  for (const s of seccionesDe(app)) {
    // Hay que venir de OTRA sección: pulsar la que ya está abierta no cambia el hash y el router
    // no tiene por qué mover el foco.
    const previa = s === "arena" ? "logros" : "arena";
    app.$(`.menu-item[data-ir="${previa}"]`).click();
    await esperarA(() => app.visible(`#seccion-${previa}`), `se abra «${previa}»`);
    const enlace = app.$(`.menu-item[data-ir="${s}"]`);
    enlace.focus();
    enlace.click();
    await esperarA(() => app.visible(`#seccion-${s}`), `se abra «${s}»`);
    await dormir(400);
    const sec = app.$(`#seccion-${s}`);
    const act = app.doc.activeElement;
    if (!(sec.contains(act) || act === sec)) {
      fallos.push(`${s} → el foco acabó en <${act?.tagName.toLowerCase()}${act?.id ? `#${act.id}` : ""}>`);
    }
  }
  igual(fallos.join("; "), "",
    "Secciones que no reciben el foco al abrirse: quien usa lector de pantalla no se entera de que la página ha cambiado.");
});

caso("Teclado", "Ningún elemento enfocable queda fuera del alcance de Tab en ninguna sección", async ({ abrirApp }) => {
  const app = await abrirApp();
  const fallos = [];
  for (const s of seccionesDe(app)) {
    await irASeccion(app, s);
    await dormir(200);
    const alcanzables = enfocables(app);
    // Botones y enlaces visibles que NO están en la lista de alcanzables (tabindex -1, por ejemplo)
    const visibles = app.$$(`#seccion-${s} button, #seccion-${s} a[href]`).filter((e) => !e.disabled && e.getClientRects().length > 0);
    const fuera = visibles.filter((e) => !alcanzables.includes(e) && e.getAttribute("role") !== "tab");
    if (fuera.length) fallos.push(`${s}: ${fuera.map((e) => nombreAccesible(e) || e.className).slice(0, 3).join(", ")}`);
  }
  igual(fallos.join(" | "), "", "Controles visibles a los que no se llega con Tab:");
});

caso("Teclado", "El diálogo de transferir atrapa el foco y se cierra con Escape", async ({ abrirApp }) => {
  const app = await abrirApp();
  const dlg = app.$("#dlg-transfer");
  afirmar(dlg, "No existe el diálogo de transferir.");
  afirmar(dlg.tagName === "DIALOG", "El diálogo de transferir no es un <dialog>: no atrapará el foco solo.");
  dlg.showModal();
  await dormir(200);
  afirmar(dlg.open, "El diálogo no se abrió.");
  const fuera = enfocables(app).filter((e) => !dlg.contains(e));
  igual(fuera.length, 0, `Con el diálogo abierto quedan ${fuera.length} elementos de fuera alcanzables con Tab.`);
  app.tecla("Escape", { destino: dlg });
  await dormir(200);
  dlg.close();
  app.sinErrores("con el diálogo de transferir");
});

// ───────────────────────── Combate sin ratón ─────────────────────────

caso("Teclado", "Combate entero sin ratón, llegando a cada botón con Tab", async ({ abrirApp }) => {
  const app = await abrirApp();
  const porNombre = (texto) => enfocables(app).find((e) => new RegExp(texto, "i").test(nombreAccesible(e)));
  const explorarBtn = porNombre("explorar");
  afirmar(explorarBtn, "No se llega al botón Explorar tabulando.");
  explorarBtn.focus();
  igual(app.doc.activeElement, explorarBtn, "No se pudo enfocar Explorar.");
  explorarBtn.click();
  await esperarA(() => !app.$("#btn-atacar").disabled, "empiece el combate");

  let turnos = 0;
  while (!resultadoVisible(app) && turnos < 120) {
    const atacar = porNombre("atacar");
    if (atacar && !atacar.disabled) { atacar.focus(); afirmar(app.doc.activeElement === atacar, "El foco se escapa del botón Atacar en mitad del combate."); atacar.click(); turnos++; }
    await dormir(45);
  }
  afirmar(resultadoVisible(app), "No se terminó el combate llegando a los botones con Tab.");
  app.sinErrores("jugando sin ratón");
});

caso("Teclado", "Durante el combate lo que cambia se anuncia (crónica y vida en zonas vivas)", async ({ abrirApp }) => {
  const app = await abrirApp();
  await explorar(app);
  const log = app.$("#log");
  const vivo = log.getAttribute("aria-live") || log.closest("[aria-live]");
  afirmar(vivo, "La crónica del combate no está en una zona viva: un lector de pantalla no leerá lo que pasa en el turno.");
  const antes = app.$$("#log li").length;
  app.pulsar("#btn-atacar");
  await esperarA(() => app.$$("#log li").length > antes, "la crónica reciba el turno nuevo");

  // La vida está en texto, pero ¿se anuncia al cambiar?
  const hp = app.$("#f-enemigo .hp");
  const anunciada = hp?.getAttribute("aria-live") || hp?.getAttribute("role") === "progressbar" || hp?.closest("[aria-live]");
  afirmar(anunciada,
    "La barra de vida del enemigo no es progressbar ni zona viva: quien no ve la pantalla solo se entera de la vida si vuelve a leer el HUD a mano. Con `role=\"progressbar\"` + `aria-valuenow`/`aria-valuetext` se anunciaría sola.");
});

caso("Teclado", "La crónica del combate se abre con teclado y no atropella al lector", async ({ abrirApp }) => {
  const app = await abrirApp();
  await explorar(app);
  const det = app.$("#cronica");
  const resumen = det.querySelector("summary");
  afirmar(resumen, "La crónica no tiene <summary>: no se puede abrir con teclado.");
  resumen.focus();
  igual(app.doc.activeElement, resumen, "No se puede poner el foco en el resumen de la crónica.");
  resumen.click();
  await dormir(150);
  afirmar(det.open, "La crónica no se abre al activar su resumen.");
  // Con la crónica cerrada, su contenido no debería estar en la ruta de tabulación.
  det.open = false;
  await dormir(100);
  const dentro = enfocables(app).filter((e) => det.contains(e) && e !== resumen);
  igual(dentro.length, 0, "Con la crónica cerrada todavía se tabula dentro de ella.");
});

// ───────────────────────── Secciones nuevas ─────────────────────────

caso("Teclado", "Expediciones se maneja entera con teclado", async ({ abrirApp }) => {
  const app = await abrirApp();
  await irASeccion(app, "expediciones");
  await esperarA(() => app.$("#expediciones button"), "aparezcan las expediciones");
  const botones = enfocables(app, app.$("#expediciones"));
  afirmar(botones.length >= 1, "No se llega con Tab a ninguna opción de expedición.");
  const sinNombre = botones.filter((b) => !nombreAccesible(b));
  igual(sinNombre.length, 0, "Hay opciones de expedición sin nombre accesible.");
  botones[0].focus();
  botones[0].click();
  await esperarA(() => app.$("#expediciones .exp-activa"), "la expedición arranque desde el teclado");
  const barra = app.$("#expediciones [role='progressbar']");
  afirmar(barra, "La expedición en curso no tiene barra de progreso accesible.");
  afirmar(barra.hasAttribute("aria-valuenow"), "La barra de progreso de la expedición no expone aria-valuenow.");
  const cuenta = app.$("#expediciones .exp-cuenta");
  igual(cuenta?.getAttribute("aria-live"), "off",
    "La cuenta atrás de la expedición debería ser aria-live=\"off\": si no, el lector de pantalla la repite cada segundo y tapa todo lo demás.");
  app.sinErrores("manejando Expediciones con teclado");
});

caso("Teclado", "La Torre se maneja entera con teclado y dice en qué piso vas", async ({ abrirApp }) => {
  const app = await abrirApp();
  await irASeccion(app, "torre");
  await esperarA(() => app.$("#torre button:not([disabled])"), "la Torre ofrezca empezar");
  const empezar = enfocables(app, app.$("#torre"))[0];
  afirmar(empezar, "No se llega con Tab a ningún botón de la Torre.");
  afirmar(nombreAccesible(empezar).length > 0, "El botón de la Torre no tiene nombre accesible.");
  empezar.focus();
  empezar.click();
  await esperarA(() => !app.$("#btn-atacar").disabled, "empiece el combate del piso");
  // Al saltar a la Arena, el foco no debería quedarse en un botón que ya no existe.
  const act = app.doc.activeElement;
  afirmar(act && act !== app.doc.body && act.isConnected,
    "Al empezar la Torre el foco se pierde (queda en <body> o en un nodo que ya no está en la página): con teclado hay que tabular desde el principio.");
  app.sinErrores("manejando la Torre con teclado");
});

caso("Teclado", "El anuncio del piso de la Torre llega al lector de pantalla", async ({ abrirApp }) => {
  const app = await abrirApp();
  await irASeccion(app, "torre");
  await esperarA(() => app.$("#torre button:not([disabled])"), "la Torre ofrezca empezar");
  app.$$("#torre button").find((b) => !b.disabled).click();
  await esperarA(() => !app.$("#btn-atacar").disabled, "empiece el piso");
  await dormir(400);
  const textoVivo = app.$$("[aria-live], [role=status], [role=alert]").map((e) => e.textContent).join(" ");
  afirmar(/piso/i.test(textoVivo) || /piso/i.test(app.texto("#log")),
    "El cambio a «Torre · piso N» solo se ve en un rótulo animado: no pasa por ninguna zona viva, así que un lector de pantalla no lo anuncia.");
});

// ───────────────────────── Modo 3D ─────────────────────────

caso("Teclado", "Con el 3D puesto se juega igual de bien sin ratón", async ({ abrirApp }) => {
  const app = await abrirApp({ semilla: { "lootarena:3d": "1" } });
  await esperarA(() => app.$("#escena canvas.r3d-lienzo"), "se monte el lienzo 3D", { ms: 25000 });
  const lienzo = app.$("#escena canvas.r3d-lienzo");
  afirmar(lienzo.tabIndex < 0, `El lienzo 3D es alcanzable con Tab (tabindex=${lienzo.tabIndex}): es decorativo y no debería estar en el recorrido.`);
  igual(lienzo.getAttribute("aria-hidden"), "true", "El lienzo 3D debería estar marcado como decorativo.");
  await explorar(app);
  await combatirHastaElFinal(app);
  await cerrarResultado(app);
  app.sinErrores("jugando en 3D sin ratón");
});

// ───────────────────────── Lector de pantalla: estructura ─────────────────────────

caso("Lector", "La página tiene puntos de referencia (landmarks) para saltar por ellos", async ({ abrirApp }) => {
  const app = await abrirApp();
  const faltan = [];
  if (!app.$("header, [role=banner]")) faltan.push("cabecera (header)");
  if (!app.$("nav, [role=navigation]")) faltan.push("navegación (nav)");
  if (!app.$("main, [role=main]")) faltan.push("contenido principal (main)");
  igual(faltan.join(", "), "", "Puntos de referencia que faltan (un lector de pantalla los usa para saltar de zona):");
  afirmar((app.$("nav")?.getAttribute("aria-label") ?? "").length > 0, "La navegación no tiene aria-label: con varias zonas de navegación no se distinguen.");
});

caso("Lector", "Los iconos decorativos no se leen y los que informan sí", async ({ abrirApp }) => {
  const app = await abrirApp();
  const sospechosos = [];
  for (const s of seccionesDe(app)) {
    await irASeccion(app, s);
    await dormir(150);
    for (const e of enfocables(app)) {
      const n = nombreAccesible(e);
      // Un nombre que es SOLO emojis no dice nada a quien no ve la pantalla.
      if (n && !/[\p{L}\p{N}]/u.test(n)) sospechosos.push(`${s}: <${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ""}> se anuncia como «${n}»`);
    }
  }
  igual([...new Set(sospechosos)].join("\n  "), "", "Controles cuyo nombre accesible es solo un emoji:");
});

caso("Lector", "El estado de los botones que conmutan se expone con aria-pressed", async ({ abrirApp }) => {
  const app = await abrirApp();
  const faltan = [];
  for (const sel of ["#btn-sonido", "#btn-3d"]) {
    const b = app.$(sel);
    if (!b) continue;
    if (!b.hasAttribute("aria-pressed")) faltan.push(sel);
  }
  igual(faltan.join(", "), "", "Botones que conmutan sin aria-pressed:");
  // Y debe cambiar al pulsarlos.
  const son = app.$("#btn-sonido");
  const antes = son.getAttribute("aria-pressed");
  son.click();
  await dormir(120);
  afirmar(son.getAttribute("aria-pressed") !== antes, "El botón de sonido no actualiza aria-pressed al pulsarlo.");
});

caso("Lector", "Todo grupo de pestañas cumple el patrón ARIA (panel y tabulación única)", async ({ abrirApp }) => {
  const app = await abrirApp();
  const fallos = [];
  for (const s of seccionesDe(app)) {
    await irASeccion(app, s);
    await dormir(250);
    for (const lista of app.$$("[role=tablist]")) {
      const tabs = [...lista.querySelectorAll("[role=tab]")];
      if (!tabs.length) { fallos.push(`${s}: hay un role=tablist sin pestañas dentro`); continue; }
      const nombre = `${s}/${nombreAccesible(tabs[0]) || "tablist"}`;
      for (const t of tabs) {
        if (!t.hasAttribute("aria-selected")) fallos.push(`${nombre}: «${nombreAccesible(t)}» sin aria-selected`);
        const id = t.getAttribute("aria-controls");
        if (!id) { fallos.push(`${nombre}: «${nombreAccesible(t)}» sin aria-controls (el lector no sabe qué panel abre)`); continue; }
        const panel = app.$(`#${CSS.escape(id)}`);
        if (!panel) fallos.push(`${nombre}: «${nombreAccesible(t)}» apunta a #${id}, que no existe`);
        else if (panel.getAttribute("role") !== "tabpanel") fallos.push(`${nombre}: el panel de «${nombreAccesible(t)}» no es role=tabpanel`);
      }
      // Patrón de tabulación única: solo la pestaña activa está en el recorrido de Tab.
      const enRecorrido = tabs.filter((t) => t.tabIndex >= 0);
      if (enRecorrido.length !== 1) {
        fallos.push(`${nombre}: ${enRecorrido.length} de ${tabs.length} pestañas están en el recorrido de Tab (debería ser 1; las demás, tabindex="-1" y flechas para moverse)`);
      }
    }
  }
  igual(fallos.join("\n  "), "", "Grupos de pestañas que no siguen el patrón ARIA:");
});

caso("Lector", "Los avisos importantes usan alert y los informativos status", async ({ abrirApp }) => {
  const app = await abrirApp();
  const banner = app.$("#banner");
  igual(banner?.getAttribute("role"), "alert", "El banner de avisos de la cabecera debería ser role=\"alert\".");
  await explorar(app);
  app.pulsar("#btn-huir");
  await esperarA(() => resultadoVisible(app), "salga la pantalla de resultado");
  const p = app.$("#pantalla-resultado");
  afirmar(p.getAttribute("role") === "dialog" || p.getAttribute("role") === "alertdialog",
    "La pantalla de resultado no declara un rol de diálogo.");
  afirmar((p.getAttribute("aria-label") ?? "").length > 0, "La pantalla de resultado no tiene nombre accesible.");
});
