#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-secrets.mjs — escáner de secretos de Loot Arena (Node, sin dependencias)
//
// Uso:
//   node scripts/check-secrets.mjs              → revisa los archivos STAGED (pre-commit)
//   node scripts/check-secrets.mjs --all        → revisa todo lo que git subiría
//                                                 (tracked + untracked no ignorados)
//   node scripts/check-secrets.mjs --push       → modo pre-push: lee las refs por stdin
//                                                 y revisa TODOS los commits que se van a subir
//   node scripts/check-secrets.mjs --rev <rango>→ revisa los commits de un rango (p. ej. HEAD~3..HEAD)
//   node scripts/check-secrets.mjs --paths a b  → revisa archivos concretos (incluso fuera del repo)
//
// Sale con 0 si está limpio, 1 si encuentra algo, 2 si hay un error de ejecución.
// NUNCA imprime un secreto completo: solo una versión enmascarada.
//
// Falsos positivos: añade el comentario `secret-scan:allow` en la MISMA línea.
// Ese pragma NO sirve para claves privadas en contexto de "key/secret/mnemonic",
// para tokens de GitHub/OpenAI, cabeceras PEM ni archivos .env.
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";

// ── Allowlist documentada ────────────────────────────────────────────────────
// Claves privadas de las cuentas de prueba por defecto de Hardhat (#0–#19),
// derivadas del mnemonic público "test test … junk" (m/44'/60'/0'/0/i).
// Son PÚBLICAS (las imprime `npx hardhat node`) y no tienen valor en redes reales,
// pero aun así guardamos solo su SHA-256 (de la cadena en minúsculas sin "0x")
// para que este archivo no contenga literales con forma de clave privada.
// Regenerar: ver la sección "Allowlist de Hardhat" en PUBLICAR.md.
const HARDHAT_TEST_KEY_SHA256 = new Set([
"bc1a50966c9e6486bc4ebf880b51611a2a97fcb8e7a6976e9b81a9e3e8ca0e3c", // #0 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
  "8335c55334821eefd4334369ff9c04a8594f161013cf9d87f58802d87297837e", // #1 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
  "b26ab6529d20ebebb4192256f202984754f785481c64b1a1aed58cac93b3617e", // #2 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
  "64034b44c579b335ab5e85debbfe72789e970138cc8d296799c3833a2a8525fb", // #3 0x90F79bf6EB2c4f870365E785982E1f101E93b906
  "4d3e46eec8244d1d106f866ee48994f6176705298aee1b8426b2ad2529eb454b", // #4 0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65
  "0aedba9d586f34f95cf1f0d54926f62e8a078ce2ca593be73ab27a87d3ff9c5d", // #5 0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc
  "28e543d3753fc9d14c658ebef20b76a3b5f8e7d78667baf27832ceb3bea01bdf", // #6 0x976EA74026E726554dB657fA54763abd0C3a0aa9
  "f070994a8599478580678f2b9482c5f02bb3de0647281e8efae183669425808a", // #7 0x14dC79964da2C08b23698B3D3cc7Ca32193d9955
  "38e69fdd19aefeb4adf56312f10e62c30274997835173c7006308323ad7db506", // #8 0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f
  "967f21586cdf1248a862f2cfb330099701c942c2c7a7537c54f7ec48f8556505", // #9 0xa0Ee7A142d267C1f36714E4a8F75612F20a79720
  "0b33e0132123e78d42dd12a0fbbbacd19827d35ca88e0ad4ba83a47a65ba0487", // #10 0xBcd4042DE499D14e55001CcbB24a551F3b954096
  "84bc109b3d59b0173a76fc3d831360a6e5063b3d4c82793a97de992947a0e3a8", // #11 0x71bE63f3384f5fb98995898A86B02Fb2426c5788
  "85bde548053aab4b5a6c78473d5eb2addaa5824299ad009bf06775e3ce923010", // #12 0xFABB0ac9d68B0B445fB7357272Ff202C5651694a
  "f1513114f60e5e95732b840669fe83956d8a944d23e6c76f953e7edcf2491901", // #13 0x1CBd3b2770909D4e10f157cABC84C7264073C9Ec
  "5330d388af894c9e1a181a06a3ce44d61fd8602165d979942be4641f4002762f", // #14 0xdF3e18d64BC6A983f673Ab319CCaE4f1a57C7097
  "a2e06155cb1a424f972c3abfaddc9cea4820c4aec722d2378903fe28dd8fc40c", // #15 0xcd3B766CCDd6AE721141F452C550Ca635964ce71
  "4a67d7a0d8a16d6d954cef19eb5afdbdd82cc0e907a571f376ef0a0981a2a9d4", // #16 0x2546BcD3c84621e976D8185a91A922aE77ECEc30
  "b08bdfde9930d9202809530dcbe193c53fd0dc6928f2010d2ffca74df95ead36", // #17 0xbDA5747bFD65F08deb54cb465eB87D40e51B197E
  "cf1fc66f853151a4c6666909c8f1f80e1d855ecffefbcb65a709aae544de5588", // #18 0xdD2FD4581271e230360230F9337D5c0430Bf44C0
  "100546a8b020a55aa09b2d34b50de9a3fc45a70b261aec6a989bb2d9321af583", // #19 0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199
]);
// SHA-256 del mnemonic público de Hardhat ("test test test … junk", 12 palabras).
const HARDHAT_MNEMONIC_SHA256 = "f79cd64f9cea237897b8133e4b905b361c6f166faa5a1c64c32280938f5b707e";

// Archivos donde los valores 0x+64 hex (hashes de tx/bloque) son esperables.
const HASH_FRIENDLY_FILES = [
  /^shared\/deployments\.json$/,
  /^web\/config\/deployments\.json$/,
  /^docs\//,
  /(^|\/)[^/]*\.abi\.json$/,
];
// Archivos que no se revisan (generados/binarios conocidos; deberían estar ignorados igualmente).
const SKIP_FILES = [/(^|\/)package-lock\.json$/, /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|mp3|ogg|wav|pdf|zip)$/i];

// ── Utilidades ───────────────────────────────────────────────────────────────
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
// Los propios hashes de la allowlist (no son secretos) no deben dispararse a sí mismos.
const isAllowlistDigest = (hex) => HARDHAT_TEST_KEY_SHA256.has(hex) || hex === HARDHAT_MNEMONIC_SHA256;
const mask = (s) => {
  const v = String(s);
  if (v.length <= 8) return "*".repeat(v.length);
  return `${v.slice(0, 4)}…${v.slice(-2)} (${v.length} chars)`;
};
const git = (args, opts = {}) =>
  execFileSync("git", args, { encoding: "buffer", maxBuffer: 256 * 1024 * 1024, ...opts });
const gitText = (args, opts) => git(args, opts).toString("utf8");
const splitZ = (buf) => buf.toString("utf8").split("\0").filter(Boolean);

const isPlaceholder = (v) =>
  /^(TU_|YOUR|<|\$\{|xxx|XXX|\.\.\.|CHANGE|REPLACE|EXAMPLE|PLACEHOLDER)/i.test(v) ||
  /^[A-Z_]+$/.test(v) || // TU_API_KEY, API_KEY, …
  /^(.)\1+$/.test(v) || // 0000… / aaaa…
  /(.)\1{9,}/.test(v);

const KEY_CONTEXT = /(priv(ate)?[_\s-]?key|secret|mnemonic|seed|signer[_\s-]?key|\bpk\b|wallet[_\s-]?key|PRIVATE_KEY|deployer[_\s-]?key|owner[_\s-]?key)/i;
const HASH_CONTEXT = /(tx|hash|transaction|block|root|salt|topic|keccak|bytes32|role|selector|digest|commit|sha|integrity|codehash|nonce)/i;

// ── Reglas por nombre de archivo ─────────────────────────────────────────────
function checkFilename(file) {
  const base = path.posix.basename(file);
  const out = [];
  if ((/^\.env(\..*)?$/i.test(base) || /\.env$/i.test(base)) && base.toLowerCase() !== ".env.example") {
    out.push({ rule: "archivo .env", detail: `"${base}" no debe subirse nunca (solo .env.example)` });
  }
  if (/\.(pem|key|p12|pfx|keystore)$/i.test(base) || /^id_(rsa|ed25519|ecdsa|dsa)$/.test(base)) {
    out.push({ rule: "archivo de clave", detail: `"${base}" parece un archivo de clave privada/certificado` });
  }
  if (/^UTC--\d{4}-/.test(base) || /^keystore/i.test(base)) {
    out.push({ rule: "keystore", detail: `"${base}" parece un keystore de wallet` });
  }
  return out;
}

// ── Reglas por contenido ─────────────────────────────────────────────────────
function checkContent(file, text) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  const hashFriendly = HASH_FRIENDLY_FILES.some((r) => r.test(file));

  lines.forEach((line, i) => {
    const ln = i + 1;
    const allowPragma = /secret-scan:allow/.test(line);
    const add = (rule, value, hard = false) => {
      if (allowPragma && !hard) return;
      findings.push({ file, line: ln, rule, detail: mask(value) });
    };
    const keyCtx = KEY_CONTEXT.test(line);

    // 1) Cabecera PEM de clave privada
    if (/-----BEGIN ([A-Z0-9 ]+ )?PRIVATE KEY( BLOCK)?-----/.test(line)) {
      add("clave privada PEM", "cabecera BEGIN … PRIVATE KEY", true);
    }

    // 2) 0x + 64 hex (clave privada o hash de 32 bytes)
    for (const m of line.matchAll(/(?<![0-9a-fA-Fx])0x([0-9a-fA-F]{64})(?![0-9a-fA-F])/g)) {
      const hex = m[1].toLowerCase();
      if (HARDHAT_TEST_KEY_SHA256.has(sha256(hex)) || isAllowlistDigest(hex)) continue;
      if (isPlaceholder(hex)) continue;
      if (keyCtx) { add("clave privada (0x+64 hex en contexto de key)", m[0], true); continue; }
      if (HASH_CONTEXT.test(line) || hashFriendly) continue; // hash de tx/bloque, bytes32, etc.
      add("posible clave privada (0x+64 hex)", m[0]);
    }

    // 3) 64 hex sueltos (sin 0x) en contexto de key
    if (keyCtx) {
      for (const m of line.matchAll(/(?<![0-9a-fA-Fx])([0-9a-fA-F]{64})(?![0-9a-fA-F])/g)) {
        const hex = m[1].toLowerCase();
        if (m.index >= 2 && line.slice(m.index - 2, m.index).toLowerCase() === "0x") continue;
        if (HARDHAT_TEST_KEY_SHA256.has(sha256(hex)) || isAllowlistDigest(hex) || isPlaceholder(hex)) continue;
        add("clave privada (64 hex en contexto de key)", m[1], true);
      }
    }

    // 4) Mnemonic BIP-39 (12/15/18/21/24 palabras en minúsculas)
    const mnemonicCandidates = [];
    for (const m of line.matchAll(/["'`]([a-z]{3,8}(?: [a-z]{3,8}){11,23})["'`]/g)) mnemonicCandidates.push(m[1]);
    if (/(mnemonic|seed|phrase|frase|semilla)/i.test(line)) {
      for (const m of line.matchAll(/(?:^|[=:\s"'`])((?:[a-z]{3,8} ){11,23}[a-z]{3,8})(?=$|[\s"'`,;])/g)) mnemonicCandidates.push(m[1]);
    }
    for (const cand of new Set(mnemonicCandidates)) {
      const n = cand.split(" ").length;
      if (![12, 15, 18, 21, 24].includes(n)) continue;
      if (sha256(cand) === HARDHAT_MNEMONIC_SHA256) continue;
      add(`posible mnemonic (${n} palabras)`, cand, /(mnemonic|seed|semilla)/i.test(line));
    }

    // 5) URLs RPC con API key
    for (const m of line.matchAll(/alchemy(?:api)?\.(?:com|io)\/v2\/([A-Za-z0-9_-]{12,})/gi)) {
      if (!isPlaceholder(m[1])) add("URL de Alchemy con API key", m[1], true);
    }
    for (const m of line.matchAll(/infura\.io\/v3\/([A-Za-z0-9_-]{12,})/gi)) {
      if (!isPlaceholder(m[1])) add("URL de Infura con API key", m[1], true);
    }
    for (const m of line.matchAll(/(?:quiknode\.pro|ankr\.com\/[a-z_]+|blastapi\.io|chainstack\.com|drpc\.org\/ogrpc\?network=[a-z]+&dkey=)\/?([A-Za-z0-9_-]{20,})/gi)) {
      if (!isPlaceholder(m[1])) add("URL RPC con API key", m[1], true);
    }

    // 6) API key de Etherscan (34 alfanuméricos en mayúsculas junto a etherscan/API_KEY)
    if (/(etherscan|api[_-]?key)/i.test(line)) {
      for (const m of line.matchAll(/(?<![A-Za-z0-9])([A-Z0-9]{34})(?![A-Za-z0-9])/g)) {
        if (/[0-9]/.test(m[1]) && /[A-Z]/.test(m[1]) && !isPlaceholder(m[1])) add("API key de Etherscan", m[1], true);
      }
    }

    // 7) Tokens conocidos
    for (const m of line.matchAll(/\b(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{22,})\b/g)) add("token de GitHub", m[1], true);
    for (const m of line.matchAll(/(?<![A-Za-z0-9])(sk-(?:proj-|ant-[a-z0-9]+-)?[A-Za-z0-9_-]{20,})/g)) add("API key tipo sk- (OpenAI/Anthropic/…)", m[1], true);
    for (const m of line.matchAll(/\b(AKIA[0-9A-Z]{16})\b/g)) add("AWS access key", m[1], true);
    for (const m of line.matchAll(/\b(xox[abprs]-[A-Za-z0-9-]{10,})\b/g)) add("token de Slack", m[1], true);
    for (const m of line.matchAll(/\b(AIza[0-9A-Za-z_-]{35})\b/g)) add("API key de Google", m[1], true);
    for (const m of line.matchAll(/\b(rnd_[A-Za-z0-9]{20,})\b/g)) add("API key de Render", m[1], true);

    // 8) Keystore JSON cifrado
    if (/"ciphertext"\s*:/.test(line) && /"(kdf|cipher)"/.test(text)) add("keystore JSON cifrado", "ciphertext", true);
  });

  return findings;
}

// ── Fuentes de archivos ──────────────────────────────────────────────────────
function isBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

function scanBlob(file, buf, results) {
  for (const f of checkFilename(file)) results.push({ file, line: 0, ...f });
  if (checkFilename(file).some((f) => f.rule === "archivo .env")) return; // ni lo leemos
  if (SKIP_FILES.some((r) => r.test(file))) return;
  if (isBinary(buf)) return;
  results.push(...checkContent(file, buf.toString("utf8")));
}

function stagedFiles() {
  return splitZ(git(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]));
}

function scanStaged(results) {
  const files = stagedFiles();
  for (const f of files) scanBlob(f, git(["show", `:${f}`]), results);
  return files.length;
}

function scanAll(results) {
  const files = splitZ(git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]));
  let n = 0;
  for (const f of files) {
    if (!existsSync(f)) continue; // borrado en el árbol de trabajo
    // Nombre primero: un .env no ignorado se reporta sin leerlo.
    if (checkFilename(f).some((x) => x.rule === "archivo .env")) { scanBlob(f, Buffer.alloc(0), results); n++; continue; }
    scanBlob(f, readFileSync(f), results); n++;
  }
  return n;
}

function scanCommits(revArgs, results) {
  const commits = gitText(["rev-list", ...revArgs]).split(/\s+/).filter(Boolean);
  const seen = new Set();
  for (const c of commits) {
    const files = splitZ(git(["diff-tree", "--no-commit-id", "-r", "--root", "-m", "--name-only", "--diff-filter=ACMR", "-z", c]));
    for (const f of files) {
      const blob = gitText(["rev-parse", `${c}:${f}`]).trim();
      if (seen.has(blob + f)) continue;
      seen.add(blob + f);
      const before = results.length;
      scanBlob(f, git(["cat-file", "-p", blob]), results);
      for (let i = before; i < results.length; i++) results[i].commit = c.slice(0, 8);
    }
  }
  return commits.length;
}

function scanPush(results) {
  // stdin de pre-push: "<local ref> <local sha> <remote ref> <remote sha>" por línea
  let input = "";
  try { input = readFileSync(0, "utf8"); } catch { input = ""; }
  const ZERO = /^0+$/;
  let n = 0;
  for (const line of input.split(/\r?\n/).filter(Boolean)) {
    const [, localSha, , remoteSha] = line.split(" ");
    if (!localSha || ZERO.test(localSha)) continue; // borrado de rama
    const range = ZERO.test(remoteSha || "0") ? [localSha, "--not", "--remotes"] : [`${remoteSha}..${localSha}`];
    n += scanCommits(range, results);
  }
  if (!input.trim()) n += scanCommits(["HEAD", "--not", "--remotes"], results); // ejecución manual
  return n;
}

function scanPaths(paths, results) {
  for (const p of paths) {
    if (!existsSync(p) || statSync(p).isDirectory()) { console.error(`  (omitido: ${p})`); continue; }
    const rel = p.replace(/\\/g, "/");
    if (checkFilename(rel).some((x) => x.rule === "archivo .env")) { scanBlob(rel, Buffer.alloc(0), results); continue; }
    scanBlob(rel, readFileSync(p), results);
  }
  return paths.length;
}

// ── Main ─────────────────────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);
  const results = [];
  let mode, count;
  try {
    if (args[0] === "--paths") { mode = "archivos indicados"; count = scanPaths(args.slice(1), results); }
    else {
      const root = gitText(["rev-parse", "--show-toplevel"]).trim();
      process.chdir(root);
      if (args.includes("--all")) { mode = "árbol completo (lo que git subiría)"; count = scanAll(results); }
      else if (args.includes("--push")) { mode = "commits a subir (pre-push)"; count = scanPush(results); }
      else if (args.includes("--rev")) { mode = "rango de commits"; count = scanCommits([args[args.indexOf("--rev") + 1]], results); }
      else { mode = "archivos staged"; count = scanStaged(results); }
    }
  } catch (e) {
    console.error(`check-secrets: error de ejecución: ${e.message}`);
    process.exit(2);
  }

  const unit = mode.startsWith("commits") || mode.startsWith("rango") ? "commits" : "archivos";
  if (results.length === 0) {
    console.log(`check-secrets: OK — ${count} ${unit} revisados (${mode}), sin secretos.`);
    process.exit(0);
  }
  console.error(`\n✖ check-secrets: ${results.length} posible(s) secreto(s) en ${mode}:\n`);
  for (const r of results) {
    const where = `${r.file}${r.line ? `:${r.line}` : ""}${r.commit ? ` [commit ${r.commit}]` : ""}`;
    console.error(`  • ${where}\n      ${r.rule}: ${r.detail}`);
  }
  console.error(
    "\nNo se ha hecho commit/push. Qué hacer:\n" +
      "  - Si es un secreto real: quítalo del archivo (usa .env, que está ignorado) y ROTA la clave.\n" +
      "  - Si ya está en un commit: reescribe ese commit antes de subirlo.\n" +
      "  - Si es un falso positivo claro: añade `secret-scan:allow` en esa línea (no vale para claves/tokens).\n"
  );
  process.exit(1);
}

main();
