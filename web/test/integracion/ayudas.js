// Ayudas específicas de Loot Arena para los casos de interfaz: jugar un combate, leer la vida,
// sembrar un progreso concreto. Nada de esto toca código de producción: solo pulsa y observa.

import { esperarA, FalloPrueba, dormir } from "./arnes.js";

/**
 * Secciones por defecto. Es solo un respaldo: el juego va creciendo (en noviembre entró «cadena»),
 * así que los casos preguntan a la página con `seccionesDe(app)` en vez de fiarse de esta lista.
 */
export const SECCIONES = ["arena", "heroe", "inventario", "mercado", "misiones", "logros", "expediciones", "torre", "ranking", "cadena"];

/** Las secciones que el menú de la página ofrece ahora mismo, en su orden. */
export function seccionesDe(app) {
  const vistas = app.$$("#menu .menu-item[data-ir]").map((a) => a.dataset.ir);
  return vistas.length ? vistas : SECCIONES;
}

export const CLAVE_PROGRESO = "lootarena:progreso:invitado";

/**
 * Progreso sembrado para forzar un combate imposible: 49 victorias ⇒ nivel de arena 10 y, además,
 * 49 % 5 === 4, o sea que el siguiente combate es contra un JEFE de nivel 10, con el héroe a nivel 1.
 * Es la forma de provocar una derrota sin tocar el código del juego.
 */
export function semillaDerrotaSegura() {
  return { [CLAVE_PROGRESO]: JSON.stringify({ version: 1, nivel: 1, xp: 0, xpTotal: 0, racha: 0, mejorRacha: 0, victorias: 49, derrotas: 0, huidas: 0, jefes: 0, nivelMaxEnemigo: 10 }) };
}

/** Vida actual del luchador, leída de la barra de la interfaz («123 / 150»). */
export function vida(app, lado = "heroe") {
  const t = app.texto(`#f-${lado === "heroe" ? "jugador" : "enemigo"} .hp-text`);
  const m = /(-?\d+)\s*\/\s*(\d+)/.exec(t);
  return m ? { actual: Number(m[1]), max: Number(m[2]) } : null;
}

export const hayCombate = (app) => !app.$("#btn-atacar").disabled || !app.$("#btn-huir").disabled;
export const resultadoVisible = (app) => app.visible("#pantalla-resultado");

/** Pulsa Explorar y espera a que haya un enemigo en la arena. */
export async function explorar(app) {
  await esperarA(() => !app.$("#btn-explorar").disabled, "el botón Explorar esté disponible");
  app.pulsar("#btn-explorar");
  await esperarA(() => !app.$("#btn-atacar").disabled, "aparezca un enemigo y se habilite Atacar");
  const nombre = app.texto("#f-enemigo .f-name");
  if (!nombre || nombre === "Arena vacía") throw new FalloPrueba("Tras pulsar Explorar la arena sigue vacía.");
  return nombre;
}

/**
 * Juega el combate hasta que aparece la pantalla de resultado.
 *
 * @param {object} [o]
 * @param {number} [o.maxTurnos=120]
 * @param {"completa"|"solo-atacar"} [o.estrategia="completa"]
 *        «completa» = lo que haría alguien que ha entendido el juego: habilidad si está lista,
 *        poción por debajo del 40 % de vida, atacar si no. «solo-atacar» = pulsar siempre Atacar
 *        (lo que hace quien acaba de llegar; con el héroe de nivel 1 pierde siempre).
 * @returns {Promise<{titulo:string, turnos:number}>}
 */
export async function combatirHastaElFinal(app, { maxTurnos = 120, estrategia = "completa" } = {}) {
  let turnos = 0;
  while (turnos < maxTurnos && !resultadoVisible(app)) {
    if (estrategia === "completa") {
      const hp = vida(app, "heroe");
      const pocion = app.$("#btn-pocion");
      if (hp && hp.max && hp.actual / hp.max < 0.4 && pocion && !pocion.disabled) { pocion.click(); turnos++; await dormir(45); continue; }
      const hab = app.$$("#skills button").find((b) => !b.disabled);
      if (hab) { hab.click(); turnos++; await dormir(45); continue; }
    }
    const btn = app.$("#btn-atacar");
    if (btn && !btn.disabled) { btn.click(); turnos++; }
    await dormir(45);
    // Si se apagaron todos los botones y no hay pantalla de resultado, el turno se ha colgado.
    if (turnos > 0 && app.$("#btn-atacar").disabled && app.$("#btn-explorar").disabled && !resultadoVisible(app)) {
      await esperarA(() => resultadoVisible(app) || !app.$("#btn-atacar").disabled,
        "el turno termine (ningún botón quedó activo y no hay pantalla de resultado)", { ms: 8000 });
    }
  }
  if (!resultadoVisible(app)) throw new FalloPrueba(`El combate no terminó en ${maxTurnos} turnos: la pantalla de resultado nunca apareció.`);
  return { titulo: app.texto("#pantalla-resultado .resultado-titulo"), turnos };
}

/** Cierra la pantalla de resultado. `cual`: "continuar" | "otra". */
export async function cerrarResultado(app, cual = "continuar") {
  const botones = app.$$("#pantalla-resultado .resultado-acciones button");
  if (!botones.length) throw new FalloPrueba("La pantalla de resultado no tiene botones para cerrarla.");
  (cual === "otra" ? botones[0] : botones[1]).click();
  await esperarA(() => !app.visible("#pantalla-resultado"), "la pantalla de resultado se cierre");
}

/** Navega por el menú (como haría un jugador) y espera a que la sección esté visible. */
export async function irASeccion(app, seccion) {
  const enlace = app.$(`.menu-item[data-ir="${seccion}"]`);
  if (!enlace) throw new FalloPrueba(`No hay entrada de menú para la sección «${seccion}».`);
  enlace.click();
  await esperarA(() => app.visible(`#seccion-${seccion}`), `la sección «${seccion}» se haga visible`);
  return app.$(`#seccion-${seccion}`);
}

/** Secciones visibles ahora mismo (debería haber exactamente una). */
export function seccionesVisibles(app) {
  return seccionesDe(app).filter((s) => app.visible(`#seccion-${s}`));
}

/**
 * Elementos que pueden recibir foco con Tab dentro de un contenedor visible.
 *
 * Ojo con los diálogos: cuando hay un `<dialog>` abierto con `showModal()`, el navegador deja
 * inerte todo lo demás aunque siga teniendo caja y `tabIndex` 0. Mirar solo el DOM da un falso
 * positivo de «el diálogo no atrapa el foco», así que aquí se respeta el modal.
 */
export function enfocables(app, raiz = null) {
  const sel = 'a[href], button, input, select, textarea, summary, dialog, [tabindex]:not([tabindex="-1"])';
  const modal = app.$$("dialog[open]").find((d) => { try { return d.matches(":modal"); } catch { return false; } });
  return (raiz ? [...raiz.querySelectorAll(sel)] : app.$$(sel))
    .filter((e) => !e.disabled && e.tabIndex >= 0 && !e.closest("[hidden]") && e.getClientRects().length > 0
      && app.win.getComputedStyle(e).visibility !== "hidden"
      && !e.hasAttribute("inert") && !e.closest("[inert]")
      && (!modal || modal.contains(e)));
}

/** Nombre accesible aproximado (lo que anunciaría un lector de pantalla). */
export function nombreAccesible(el) {
  const etiquetado = el.getAttribute("aria-labelledby");
  if (etiquetado) {
    const txt = etiquetado.split(/\s+/).map((id) => el.ownerDocument.getElementById(id)?.textContent?.trim() ?? "").join(" ").trim();
    if (txt) return txt;
  }
  const aria = el.getAttribute("aria-label")?.trim();
  if (aria) return aria;
  if (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA") {
    const id = el.id && el.ownerDocument.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    const txt = (id ?? el.closest("label"))?.textContent?.trim();
    if (txt) return txt;
    if (el.placeholder?.trim()) return el.placeholder.trim();
  }
  // El texto visible, ignorando los iconos marcados como decorativos.
  const clon = el.cloneNode(true);
  clon.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
  const txt = clon.textContent?.replace(/\s+/g, " ").trim();
  if (txt) return txt;
  return el.getAttribute("title")?.trim() || "";
}
