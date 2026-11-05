// Lanzador de Loot Arena: sirve el juego en http://localhost:7777 y abre el navegador.
// Se empaqueta como ejecutable único (Node SEA) con la carpeta web/ embebida.
// También funciona sin empaquetar:  node launcher/jugar.cjs   (lee ../web del disco).
"use strict";
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const { exec } = require("node:child_process");

// Puertos permitidos por el CORS del servidor de botín (ALLOWED_ORIGIN en Render).
const PUERTOS = [7777, 7778, 7779];

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

// Origen de los archivos: assets embebidos (ejecutable) o carpeta web/ (desarrollo).
let leer;
let sea = null;
try { sea = require("node:sea"); } catch { /* Node sin SEA */ }
if (sea && sea.isSea()) {
  leer = (rel) => {
    try { return Buffer.from(sea.getAsset("web/" + rel)); } catch { return null; }
  };
} else {
  const raiz = path.resolve(__dirname, "..", "web");
  leer = (rel) => {
    const abs = path.resolve(raiz, rel);
    if (!abs.startsWith(raiz + path.sep)) return null;
    try { return fs.readFileSync(abs); } catch { return null; }
  };
}

const servidor = http.createServer((req, res) => {
  let rel;
  try {
    rel = decodeURIComponent((req.url || "/").split(/[?#]/)[0]).replace(/\\/g, "/").replace(/^\/+/, "");
  } catch { res.writeHead(400).end(); return; }
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  if (rel.split("/").includes("..") || rel.startsWith("test/")) { res.writeHead(404).end(); return; }
  const datos = leer(rel);
  if (!datos) { res.writeHead(404, { "content-type": "text/plain" }).end("No encontrado"); return; }
  res.writeHead(200, {
    "content-type": TIPOS[path.extname(rel).toLowerCase()] || "application/octet-stream",
    "cache-control": "no-cache",
  });
  res.end(datos);
});

function abrirNavegador(url) {
  const cmd = process.platform === "win32" ? `start "" "${url}"`
    : process.platform === "darwin" ? `open "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

function escuchar(i) {
  if (i >= PUERTOS.length) {
    console.error("No hay ningún puerto libre (7777-7779). Cierra otras copias del juego e inténtalo de nuevo.");
    setTimeout(() => process.exit(1), 8000);
    return;
  }
  servidor.once("error", (e) => {
    if (e.code === "EADDRINUSE") escuchar(i + 1);
    else { console.error(e); process.exit(1); }
  });
  servidor.listen(PUERTOS[i], "127.0.0.1", () => {
    const url = `http://localhost:${PUERTOS[i]}/`;
    console.log("⚔️  Loot Arena");
    console.log(`   Jugando en ${url}`);
    console.log("   Necesitas MetaMask en el navegador (red Sepolia) para conseguir objetos NFT.");
    console.log("   Deja esta ventana abierta mientras juegas; ciérrala para salir.");
    if (!process.env.LOOT_ARENA_SIN_NAVEGADOR) abrirNavegador(url);
  });
}

escuchar(0);
