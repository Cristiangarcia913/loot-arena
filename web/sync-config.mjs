#!/usr/bin/env node
// Copia el ABI y las direcciones de despliegue desde ../shared/ a web/config/.
// Uso: node web/sync-config.mjs   (desde cualquier carpeta)
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const webDir = dirname(fileURLToPath(import.meta.url));
const sharedDir = join(webDir, "..", "shared");
const configDir = join(webDir, "config");

let fallos = 0;

async function copiar(nombre, validar) {
  const origen = join(sharedDir, nombre);
  let datos;
  try {
    datos = JSON.parse(await readFile(origen, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") {
      // Sin /shared (p. ej. en CI sin artefactos): se conserva la copia actual de web/config/.
      console.warn(`⚠ ${nombre}: no existe ${origen}; se mantiene web/config/${nombre}`);
      return;
    }
    console.error(`✗ ${nombre}: no se pudo leer ${origen} (${e.code ?? e.message})`);
    fallos++;
    return;
  }
  try {
    datos = validar(datos);
  } catch (e) {
    console.error(`✗ ${nombre}: ${e.message}`);
    fallos++;
    return;
  }
  await writeFile(join(configDir, nombre), JSON.stringify(datos, null, 2) + "\n");
  console.log(`✓ ${nombre} copiado a web/config/`);
}

await copiar("GameItem.abi.json", (d) => {
  // Acepta un array ABI puro o un artefacto de Hardhat ({ abi: [...] }).
  const abi = Array.isArray(d) ? d : d?.abi;
  if (!Array.isArray(abi)) throw new Error("no es un array ABI");
  for (const fn of ["balanceOf", "tokenOfOwnerByIndex", "getItem", "safeTransferFrom"]) {
    if (!abi.some((x) => x.type === "function" && x.name === fn)) {
      throw new Error(`al ABI le falta la función ${fn}`);
    }
  }
  return abi;
});

await copiar("deployments.json", (d) => {
  if (!d || typeof d !== "object") throw new Error("formato inválido");
  for (const [red, info] of Object.entries(d)) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(info?.address ?? "")) {
      throw new Error(`dirección inválida para la red "${red}"`);
    }
  }
  return d;
});

process.exitCode = fallos ? 1 : 0;
