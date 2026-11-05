// Empaqueta launcher/jugar.cjs + web/ en un ejecutable único con Node SEA.
// Uso: node launcher/build.mjs   → dist/LootArena(.exe) y dist/loot-arena-web.zip (si hay `zip`/PowerShell)
// Requiere Node >= 22. Ver https://nodejs.org/api/single-executable-applications.html
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const web = path.join(raiz, "web");
const dist = path.join(raiz, "dist");
const tmp = path.join(dist, "tmp");
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });

// 1. Assets: todo web/ salvo tests y archivos de desarrollo.
const EXCLUIR = new Set(["test", "node_modules", "package.json", "package-lock.json", "sync-config.mjs", "README.md"]);
const assets = {};
(function recorrer(dir, rel = "") {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!rel && EXCLUIR.has(e.name)) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) recorrer(path.join(dir, e.name), r);
    else assets[`web/${r}`] = path.join(dir, e.name);
  }
})(web);
if (!assets["web/index.html"]) throw new Error("web/index.html no encontrado");
console.log(`Assets embebidos: ${Object.keys(assets).length}`);

// 2. Blob SEA.
const cfg = path.join(tmp, "sea-config.json");
const blob = path.join(tmp, "sea-prep.blob");
fs.writeFileSync(cfg, JSON.stringify({
  main: path.join(raiz, "launcher", "jugar.cjs"),
  output: blob,
  disableExperimentalSEAWarning: true,
  useCodeCache: false,
  assets,
}, null, 2));
execFileSync(process.execPath, ["--experimental-sea-config", cfg], { stdio: "inherit" });

// 3. Copiar el binario de Node e inyectar el blob.
const win = process.platform === "win32";
const mac = process.platform === "darwin";
const exe = path.join(dist, win ? "LootArena.exe" : "LootArena");
fs.copyFileSync(process.execPath, exe);
if (mac) execFileSync("codesign", ["--remove-signature", exe], { stdio: "inherit" });
const npx = win ? "npx.cmd" : "npx";
const args = ["--yes", "postject@1.0.0-alpha.6", exe, "NODE_SEA_BLOB", blob,
  "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"];
if (mac) args.push("--macho-segment-name", "NODE_SEA");
execFileSync(npx, args, { stdio: "inherit", shell: win });
if (mac) execFileSync("codesign", ["--sign", "-", exe], { stdio: "inherit" });
if (!win) fs.chmodSync(exe, 0o755);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`Listo: ${exe}`);
