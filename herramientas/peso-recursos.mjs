#!/usr/bin/env node
// Peso de lo que descarga un jugador al abrir Loot Arena, sin navegador.
//
// Sigue index.html, resuelve los <link rel=stylesheet>, los <script src>, los @import de CSS y
// las cadenas de import de los módulos ES, y suma el tamaño en bruto y comprimido con gzip
// (que es como lo sirven GitHub Pages y Render).
//
//   node herramientas/peso-recursos.mjs            # resumen
//   node herramientas/peso-recursos.mjs --detalle  # fichero a fichero
//   node herramientas/peso-recursos.mjs --json

import { readFile, stat } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = join(RAIZ, "web");
const ENTRADA = join(WEB, "index.html");

const kb = (n) => Math.round(n / 102.4) / 10;

/** Objetivos razonables para una web de juego sin build. */
export const OBJETIVOS = { totalKb: 1024, gzipKb: 300, jsGzipKb: 150, cssGzipKb: 60, peticiones: 45 };

const vistos = new Map(); // ruta absoluta → {bytes, gzip, tipo, desde, nivel}
let nivelActual = 0;

async function medir(ruta, tipo, desde) {
  if (vistos.has(ruta)) return null;
  let datos;
  try { datos = await readFile(ruta); } catch { vistos.set(ruta, { bytes: 0, gzip: 0, tipo, desde, falta: true }); return null; }
  const reg = { bytes: datos.length, gzip: gzipSync(datos, { level: 9 }).length, tipo, desde, nivel: nivelActual };
  vistos.set(ruta, reg);
  return datos.toString("utf8");
}

const EXTERNOS = new Set();

function resolver(especificador, base) {
  if (/^(https?:)?\/\//.test(especificador) || especificador.startsWith("data:")) { EXTERNOS.add(especificador.split("?")[0]); return null; }
  return resolve(dirname(base), especificador.split("?")[0].split("#")[0]);
}

async function seguirCss(ruta, texto) {
  for (const m of texto.matchAll(/@import\s+(?:url\()?["']([^"')]+)["']\)?/g)) {
    const r = resolver(m[1], ruta);
    if (r) { const t = await medir(r, "css", ruta); if (t != null) await seguirCss(r, t); }
  }
  for (const m of texto.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
    if (m[1].startsWith("data:")) continue;
    const r = resolver(m[1], ruta);
    if (r) await medir(r, "recurso", ruta);
  }
}

const IMPORTA = /(?:^|[\s;}])(?:import|export)\s+(?:[^'"()]*?\sfrom\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

async function seguirJs(ruta, texto) {
  for (const m of texto.matchAll(IMPORTA)) {
    const esp = m[1] ?? m[2];
    if (!esp) continue;
    const r = resolver(esp, ruta);
    if (!r) continue;
    nivelActual++;
    const t = await medir(r, /\.json$/.test(r) ? "json" : "js", ruta);
    if (t != null && !/\.json$/.test(r)) await seguirJs(r, t);
    nivelActual--;
  }
  // fetch("./algo.json") y new URL("./algo.json", import.meta.url)
  for (const m of texto.matchAll(/new URL\(\s*["']([^"']+\.json)["']/g)) {
    const r = resolver(m[1], ruta);
    if (r) await medir(r, "json", ruta);
  }
}

async function main() {
  const html = await medir(ENTRADA, "html", null);
  if (html == null) { console.error(`No encuentro ${ENTRADA}`); process.exit(1); }

  for (const m of html.matchAll(/<link[^>]+rel=["']?stylesheet["']?[^>]*>/gi)) {
    const href = /href=["']([^"']+)["']/i.exec(m[0])?.[1];
    const r = href && resolver(href, ENTRADA);
    if (r) { const t = await medir(r, "css", ENTRADA); if (t != null) await seguirCss(r, t); }
  }
  for (const m of html.matchAll(/<script[^>]*src=["']([^"']+)["'][^>]*>/gi)) {
    const r = resolver(m[1], ENTRADA);
    if (r) { const t = await medir(r, "js", ENTRADA); if (t != null) await seguirJs(r, t); }
  }
  // Los <script type="module"> en línea de index.html también importan.
  for (const m of html.matchAll(/<script[^>]*type=["']module["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    await seguirJs(ENTRADA, m[1]);
  }

  const filas = [...vistos.entries()].map(([ruta, v]) => ({ archivo: relative(WEB, ruta).replace(/\\/g, "/"), ...v, desde: v.desde ? relative(WEB, v.desde).replace(/\\/g, "/") : "" }));
  const porTipo = {};
  for (const f of filas) {
    porTipo[f.tipo] ??= { n: 0, bytes: 0, gzip: 0 };
    porTipo[f.tipo].n++; porTipo[f.tipo].bytes += f.bytes; porTipo[f.tipo].gzip += f.gzip;
  }
  const total = filas.reduce((a, f) => ({ bytes: a.bytes + f.bytes, gzip: a.gzip + f.gzip }), { bytes: 0, gzip: 0 });
  const faltan = filas.filter((f) => f.falta);

  const resumen = {
    peticiones: filas.length,
    // Profundidad de la cadena de importaciones: cada nivel es un viaje de ida y vuelta más que el
    // navegador tiene que hacer EN FILA antes de poder ejecutar nada. Es lo que más pesa con latencia.
    profundidad: 1 + Math.max(0, ...filas.map((f) => f.nivel ?? 0)),
    nivelMasProfundo: [...filas].sort((a, b) => (b.nivel ?? 0) - (a.nivel ?? 0)).slice(0, 3).map((f) => `${f.archivo} (nivel ${f.nivel})`),
    totalKb: kb(total.bytes),
    gzipKb: kb(total.gzip),
    porTipo: Object.fromEntries(Object.entries(porTipo).map(([t, v]) => [t, { ficheros: v.n, kb: kb(v.bytes), gzipKb: kb(v.gzip) }])),
    externos: [...EXTERNOS],
    faltan: faltan.map((f) => f.archivo),
    masPesados: [...filas].sort((a, b) => b.bytes - a.bytes).slice(0, 12).map((f) => ({ archivo: f.archivo, kb: kb(f.bytes), gzipKb: kb(f.gzip) })),
  };

  if (process.argv.includes("--json")) { console.log(JSON.stringify({ resumen, filas, OBJETIVOS }, null, 2)); return; }

  console.log(`\n⚖️  Peso de la carga inicial de Loot Arena (web/index.html)\n`);
  console.log(`  Peticiones del propio origen : ${resumen.peticiones}  (objetivo ≤ ${OBJETIVOS.peticiones})`);
  console.log(`  Viajes de ida y vuelta en fila: ${resumen.profundidad}  → con 100 ms de latencia son ~${resumen.profundidad * 100} ms antes de poder pintar nada`);
  console.log(`  Sin comprimir                : ${resumen.totalKb} kB  (objetivo ≤ ${OBJETIVOS.totalKb} kB)`);
  console.log(`  Con gzip (lo que viaja)      : ${resumen.gzipKb} kB  (objetivo ≤ ${OBJETIVOS.gzipKb} kB)\n`);
  for (const [t, v] of Object.entries(resumen.porTipo)) console.log(`    ${t.padEnd(8)} ${String(v.ficheros).padStart(3)} ficheros  ${String(v.kb).padStart(7)} kB  →  ${String(v.gzipKb).padStart(6)} kB gzip`);
  console.log(`\n  Más pesados:`);
  for (const f of resumen.masPesados) console.log(`    ${String(f.kb).padStart(7)} kB (${String(f.gzipKb).padStart(6)} gzip)  ${f.archivo}`);
  if (resumen.externos.length) { console.log(`\n  Recursos externos (no cuentan arriba, pero el jugador los descarga):`); for (const e of resumen.externos) console.log(`    · ${e}`); }
  if (faltan.length) { console.log(`\n  ⚠️  Referencias rotas:`); for (const f of faltan) console.log(`    · ${f.archivo} (desde ${f.desde})`); }

  const malos = [];
  if (resumen.gzipKb > OBJETIVOS.gzipKb) malos.push(`el total comprimido (${resumen.gzipKb} kB) pasa de ${OBJETIVOS.gzipKb} kB`);
  if ((resumen.porTipo.js?.gzipKb ?? 0) > OBJETIVOS.jsGzipKb) malos.push(`el JavaScript comprimido (${resumen.porTipo.js.gzipKb} kB) pasa de ${OBJETIVOS.jsGzipKb} kB`);
  if ((resumen.porTipo.css?.gzipKb ?? 0) > OBJETIVOS.cssGzipKb) malos.push(`el CSS comprimido (${resumen.porTipo.css.gzipKb} kB) pasa de ${OBJETIVOS.cssGzipKb} kB`);
  if (resumen.peticiones > OBJETIVOS.peticiones) malos.push(`hay ${resumen.peticiones} peticiones (objetivo ≤ ${OBJETIVOS.peticiones})`);
  console.log(malos.length ? `\n  ❌ ${malos.join("; ")}.\n` : `\n  ✔ Todo dentro de los objetivos.\n`);
  if (faltan.length) process.exitCode = 1;
}

await stat(ENTRADA).catch(() => { console.error(`No encuentro ${ENTRADA}`); process.exit(1); });
await main();
