#!/usr/bin/env node
// Revisión estática del HTML de Loot Arena: lo que se puede ver sin abrir un navegador.
// Complementa al arnés (web/test/integracion), que revisa la página ya viva.
//
//   node herramientas/revisar-html.mjs                 # index.html
//   node herramientas/revisar-html.mjs web/*.html      # las demos también
//   node herramientas/revisar-html.mjs --json

import { readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const JSONSALIDA = process.argv.includes("--json");
const ARCHIVOS = args.length ? args.map((a) => resolve(a)) : [join(RAIZ, "web", "index.html")];

/** Etiquetas que se consideran interactivas y, por tanto, necesitan nombre accesible. */
const INTERACTIVAS = /<(button|a|input|select|textarea|summary)\b([^>]*)>/gi;
const atributo = (attrs, nombre) => new RegExp(`${nombre}\\s*=\\s*["']([^"']*)["']`, "i").exec(attrs)?.[1];
const tiene = (attrs, nombre) => new RegExp(`(^|\\s)${nombre}(\\s|=|$)`, "i").test(attrs);

function linea(texto, indice) { return texto.slice(0, indice).split("\n").length; }

function revisar(ruta, html) {
  const fallos = [];
  const add = (gravedad, regla, mensaje, indice) => fallos.push({ archivo: relative(RAIZ, ruta).replace(/\\/g, "/"), linea: linea(html, indice ?? 0), gravedad, regla, mensaje });

  // 1. idioma y título
  if (!/<html[^>]+lang=/i.test(html)) add("alto", "lang", "El <html> no declara el idioma (lang).", html.search(/<html/i));
  if (!/<title>[^<]{2,}<\/title>/i.test(html)) add("medio", "titulo", "Falta <title> o está vacío.", 0);
  if (!/<meta[^>]+name=["']viewport["']/i.test(html)) add("alto", "viewport", "Falta <meta name=\"viewport\">: la página no se adapta al móvil.", 0);

  // 2. ids repetidos (rompen aria-labelledby, <label for> y document.getElementById)
  const ids = new Map();
  for (const m of html.matchAll(/\sid\s*=\s*["']([^"']+)["']/gi)) {
    if (ids.has(m[1])) add("alto", "id-repetido", `El id «${m[1]}» aparece más de una vez (línea ${ids.get(m1 ?? m[1])}).`, m.index);
    else ids.set(m[1], linea(html, m.index));
  }

  // 3. elementos interactivos sin nombre accesible
  for (const m of html.matchAll(INTERACTIVAS)) {
    const [todo, tag, attrs] = m;
    const resto = html.slice(m.index + todo.length, m.index + todo.length + 400);
    const dentro = resto.split(new RegExp(`</${tag}`, "i"))[0] ?? "";
    // texto visible, quitando lo marcado como decorativo
    const visible = dentro.replace(/<[^>]*aria-hidden=["']true["'][^>]*>[\s\S]*?<\/[a-z]+>/gi, "").replace(/<[^>]+>/g, "").trim();
    const nombre = atributo(attrs, "aria-label") || atributo(attrs, "aria-labelledby") || atributo(attrs, "title") || visible
      || (tag.toLowerCase() === "input" ? atributo(attrs, "placeholder") : "");
    const tipo = (atributo(attrs, "type") ?? "").toLowerCase();
    if (tag.toLowerCase() === "input" && ["hidden", "submit", "reset", "button"].includes(tipo) && atributo(attrs, "value")) continue;
    if (tipo === "hidden") continue;
    if (!nombre) add("alto", "sin-nombre", `<${tag.toLowerCase()}> sin nombre accesible: un lector de pantalla solo diría «${tag.toLowerCase()}».`, m.index);
  }

  // 4. <input> sin <label for>
  for (const m of html.matchAll(/<input\b([^>]*)>/gi)) {
    const attrs = m[1];
    const tipo = (atributo(attrs, "type") ?? "text").toLowerCase();
    if (["hidden", "submit", "reset", "button", "image"].includes(tipo)) continue;
    const id = atributo(attrs, "id");
    const etiquetado = id && new RegExp(`<label[^>]+for=["']${id}["']`, "i").test(html);
    if (!etiquetado && !atributo(attrs, "aria-label") && !atributo(attrs, "aria-labelledby")) {
      add("alto", "input-sin-label", `<input${id ? ` id="${id}"` : ""}> sin <label for>: el campo no se puede identificar.`, m.index);
    }
  }

  // 5. imágenes sin alt
  for (const m of html.matchAll(/<img\b([^>]*)>/gi)) {
    if (!tiene(m[1], "alt")) add("alto", "img-sin-alt", "<img> sin atributo alt.", m.index);
  }

  // 6. jerarquía de encabezados
  const encabezados = [...html.matchAll(/<h([1-6])\b/gi)].map((m) => ({ n: Number(m[1]), i: m.index }));
  const h1 = encabezados.filter((e) => e.n === 1);
  if (h1.length === 0) add("medio", "h1", "La página no tiene ningún <h1>.", 0);
  if (h1.length > 1) add("bajo", "h1", `La página tiene ${h1.length} elementos <h1>.`, h1[1].i);
  for (let i = 1; i < encabezados.length; i++) {
    if (encabezados[i].n - encabezados[i - 1].n > 1) {
      add("bajo", "salto-encabezado", `Se salta de <h${encabezados[i - 1].n}> a <h${encabezados[i].n}>.`, encabezados[i].i);
    }
  }

  // 7. aria-labelledby / aria-controls que apuntan a nada
  for (const atr of ["aria-labelledby", "aria-controls", "aria-describedby"]) {
    for (const m of html.matchAll(new RegExp(`${atr}\\s*=\\s*["']([^"']+)["']`, "gi"))) {
      for (const id of m[1].split(/\s+/)) {
        if (id && !ids.has(id)) add("alto", "aria-roto", `${atr}="${id}" apunta a un id que no existe en el documento.`, m.index);
      }
    }
  }

  // 8. enlaces que abren ventana sin avisar ni protegerse
  for (const m of html.matchAll(/<a\b([^>]*target=["']_blank["'][^>]*)>/gi)) {
    if (!/rel\s*=\s*["'][^"']*noopener/i.test(m[1])) add("medio", "target-blank", "<a target=\"_blank\"> sin rel=\"noopener\".", m.index);
  }

  // 9. roles ARIA que exigen hijos o atributos
  for (const m of html.matchAll(/role\s*=\s*["']progressbar["']/gi)) {
    const etiqueta = html.slice(Math.max(0, m.index - 300), m.index + 300);
    if (!/aria-valuenow/i.test(etiqueta)) add("medio", "progressbar", "role=\"progressbar\" sin aria-valuenow: no se puede leer el valor.", m.index);
  }
  for (const m of html.matchAll(/aria-modal\s*=\s*["']true["']/gi)) {
    const etiqueta = html.slice(Math.max(0, m.index - 200), m.index + 200);
    if (!/<dialog/i.test(etiqueta)) {
      add("medio", "modal-sin-dialog", "aria-modal=\"true\" fuera de un <dialog>: hay que atrapar el foco a mano o el teclado se escapa detrás del diálogo.", m.index);
    }
  }

  // 10. tabindex positivo (rompe el orden natural)
  for (const m of html.matchAll(/tabindex\s*=\s*["']([1-9]\d*)["']/gi)) {
    add("medio", "tabindex-positivo", `tabindex="${m[1]}" altera el orden de tabulación de toda la página.`, m.index);
  }

  return fallos;
}

const GRAVEDAD = { critico: 0, alto: 1, medio: 2, bajo: 3 };
const todos = [];
for (const ruta of ARCHIVOS) {
  let html;
  try { html = await readFile(ruta, "utf8"); } catch { console.error(`No puedo leer ${ruta}`); process.exitCode = 1; continue; }
  todos.push(...revisar(ruta, html));
}
todos.sort((a, b) => GRAVEDAD[a.gravedad] - GRAVEDAD[b.gravedad] || a.archivo.localeCompare(b.archivo) || a.linea - b.linea);

if (JSONSALIDA) { console.log(JSON.stringify(todos, null, 2)); }
else {
  console.log(`\n🔎 Revisión estática del HTML (${ARCHIVOS.length} archivo(s))\n`);
  if (!todos.length) console.log("  ✔ Sin hallazgos.\n");
  for (const f of todos) console.log(`  [${f.gravedad.toUpperCase().padEnd(6)}] ${f.archivo}:${f.linea}  ${f.regla}\n            ${f.mensaje}`);
  const porGravedad = todos.reduce((a, f) => ({ ...a, [f.gravedad]: (a[f.gravedad] ?? 0) + 1 }), {});
  console.log(`\n  Total: ${todos.length} ${JSON.stringify(porGravedad)}\n`);
}
if (todos.some((f) => f.gravedad === "critico" || f.gravedad === "alto")) process.exitCode = 1;
