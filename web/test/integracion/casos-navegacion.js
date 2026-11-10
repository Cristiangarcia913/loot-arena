// Caminos principales sin wallet: portada, menú, router, atajos.

import { caso, afirmar, igual, esperarA, dormir } from "./arnes.js";
import { SECCIONES, irASeccion, seccionesVisibles, nombreAccesible } from "./ayudas.js";

caso("Arranque", "La portada aparece y «Entrar en la arena» la cierra", async ({ abrirApp }) => {
  const app = await abrirApp({ portada: "mostrada" });
  afirmar(app.visible("#pantalla-portada"), "La portada (#pantalla-portada) no se ve al cargar la página por primera vez.");
  afirmar(app.$("#btn-entrar"), "La portada no tiene el botón #btn-entrar.");
  app.pulsar("#btn-entrar");
  await esperarA(() => !app.visible("#pantalla-portada"), "la portada desaparezca tras pulsar «Entrar en la arena»");
  afirmar(app.visible("#seccion-arena"), "Tras cerrar la portada no se ve la sección Arena.");
  app.sinErrores("al cerrar la portada");
});

caso("Arranque", "La página arranca con la cabecera, el menú completo y una sola sección visible", async ({ abrirApp }) => {
  const app = await abrirApp();
  afirmar(app.$(".topbar"), "Falta la cabecera .topbar.");
  igual(app.$$("#menu .menu-item").length, SECCIONES.length, "El menú no tiene una entrada por sección.");
  igual(seccionesVisibles(app).join(","), "arena", "Al arrancar debería verse solo la Arena.");
  afirmar(app.texto("#net-badge").length > 0, "La insignia de red (#net-badge) está vacía.");
  app.sinErrores("al arrancar");
});

caso("Navegación", "Cada sección del menú se abre, deja solo una visible y no lanza errores", async ({ abrirApp }) => {
  const app = await abrirApp();
  for (const s of SECCIONES) {
    const el = await irASeccion(app, s);
    const visibles = seccionesVisibles(app);
    igual(visibles.join(","), s, `Al abrir «${s}» debería verse solo esa sección.`);
    await esperarA(() => el.textContent.trim().length > 40, `la sección «${s}» tenga contenido (se abre vacía y no se rellena)`, { ms: 3000 });
    igual(app.hash(), `#/${s}`, `El hash de la URL no acompaña a la sección «${s}».`);
    const activos = app.$$("#menu .menu-item[aria-current='page']").map((a) => a.dataset.ir);
    igual(activos.join(","), s, `El menú no marca «${s}» como sección actual.`);
    app.sinErrores(`al abrir la sección «${s}»`);
  }
});

caso("Navegación", "Cada sección tiene un encabezado o nombre accesible", async ({ abrirApp }) => {
  const app = await abrirApp();
  const sin = [];
  for (const s of SECCIONES) {
    await irASeccion(app, s);
    const el = app.$(`#seccion-${s}`);
    const nombre = nombreAccesible(el.querySelector("h2") ?? el) || el.getAttribute("aria-label") || "";
    if (!nombre.trim()) sin.push(s);
  }
  igual(sin.join(", "), "", "Hay secciones sin encabezado ni nombre accesible (un lector de pantalla no sabría dónde está el usuario).");
});

caso("Navegación", "Los atajos Alt+1…Alt+9 llevan a cada sección", async ({ abrirApp }) => {
  const app = await abrirApp();
  const fallos = [];
  for (let i = 0; i < SECCIONES.length; i++) {
    app.tecla(String(i + 1), { destino: app.doc.body, altKey: true });
    try {
      await esperarA(() => app.visible(`#seccion-${SECCIONES[i]}`), `Alt+${i + 1} abra «${SECCIONES[i]}»`, { ms: 2500 });
    } catch { fallos.push(`Alt+${i + 1} → ${SECCIONES[i]}`); }
  }
  igual(fallos.join("; "), "", "Atajos de teclado que no funcionan.");
});

caso("Navegación", "Al volver a entrar se recupera la última sección visitada", async ({ abrirApp }) => {
  const app1 = await abrirApp();
  await irASeccion(app1, "torre");
  app1.cerrar();
  const app2 = await abrirApp({ limpiar: false, ruta: "" });
  await esperarA(() => app2.visible("#seccion-torre"), "la app recuerde que la última sección fue la Torre");
  app2.sinErrores("al recuperar la última sección");
});

// Necesita una navegación de verdad: con document.write el historial del iframe no es el de la app.
caso("Navegación", "El botón Atrás del navegador vuelve a la sección anterior", async ({ abrirApp }) => {
  const app = await abrirApp({ modo: "real" });
  await irASeccion(app, "misiones");
  await irASeccion(app, "logros");
  app.win.history.back();
  await esperarA(() => app.visible("#seccion-misiones"), "Atrás devuelva a Misiones");
  app.sinErrores("al navegar hacia atrás");
});

caso("Navegación", "Un hash desconocido no deja la página en blanco", async ({ abrirApp }) => {
  const app = await abrirApp({ ruta: "#/no-existe" });
  afirmar(seccionesVisibles(app).length === 1, `Con un hash desconocido debería verse una sección por defecto; se ven ${seccionesVisibles(app).length}.`);
  app.sinErrores("con un hash desconocido");
});

caso("Navegación", "El enlace «Saltar al contenido» existe y apunta al contenido principal", async ({ abrirApp }) => {
  const app = await abrirApp();
  const saltar = app.$("a.saltar");
  afirmar(saltar, "No hay enlace «Saltar al contenido» (requisito básico de accesibilidad).");
  const destino = app.$(saltar.getAttribute("href"));
  afirmar(destino, `El enlace «Saltar al contenido» apunta a «${saltar.getAttribute("href")}», que no existe.`);
});

caso("Navegación", "Las pestañas del Mercado (Vender/Comprar) cambian de panel con el ratón y con las flechas", async ({ abrirApp }) => {
  const app = await abrirApp();
  await irASeccion(app, "mercado");
  const [vender, comprar] = [app.$("#merc-tab-vender"), app.$("#merc-tab-comprar")];
  afirmar(vender && comprar, "Faltan las pestañas del Mercado.");
  comprar.click();
  await esperarA(() => app.$("#merc-comprar").hidden === false && app.$("#merc-vender").hidden === true, "la pestaña Comprar muestre su panel");
  igual(comprar.getAttribute("aria-selected"), "true", "La pestaña Comprar no se marca como seleccionada.");
  app.tecla("ArrowLeft", { destino: comprar });
  await esperarA(() => app.$("#merc-vender").hidden === false, "la flecha izquierda vuelva a la pestaña Vender");
  app.sinErrores("al usar las pestañas del Mercado");
});

caso("Navegación", "El botón de sonido conmuta su estado", async ({ abrirApp }) => {
  const app = await abrirApp();
  const btn = app.$("#btn-sonido");
  afirmar(btn, "No existe el botón de sonido #btn-sonido.");
  const antes = btn.getAttribute("aria-pressed");
  btn.click();
  await dormir(80);
  afirmar(btn.getAttribute("aria-pressed") !== antes, "El botón de sonido no cambia su aria-pressed al pulsarlo: un lector de pantalla no sabría si está silenciado.");
  app.sinErrores("al conmutar el sonido");
});
