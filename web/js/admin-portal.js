// Portal de administración aislado (web/admin.html). No lo importa el juego público.
// Seguridad: el PIN es solo una barrera de interfaz (el código es público); lo que de verdad
// protege es que mintItem/mint son onlyOwner/onlyMinter en el contrato y los firma MetaMask.
import { ETHERS_URL, NETWORKS, NETWORK } from "../config/config.js";

export const CLAVE_PIN = "lootarena:admin-pin-hash";
// SHA-256 de "arena2026" (PIN por defecto). Para cambiarlo: localStorage[CLAVE_PIN] = sha256(nuevoPin).
export const PIN_POR_DEFECTO_HASH = "c9a9a52fd65190f5121c8055c8c0aa67b1ea71c27b677a9c67158499addfb0db";

export async function sha256(texto) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function validarMint({ destino, rareza, ataque, defensa }) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(destino ?? "")) return "Dirección destino no válida.";
  if (![0, 1, 2].includes(Number(rareza))) return "Rareza no válida.";
  for (const v of [ataque, defensa]) if (!Number.isInteger(v) || v < 0 || v > 999) return "Ataque/Defensa deben ser enteros 0–999.";
  return null;
}

if (typeof document !== "undefined") {
  const $ = (id) => document.getElementById(id);
  const msg = (t, cls = "") => { $("msg").textContent = t; $("msg").className = cls; };
  let ethers, firmante, deploy, red;

  const hashPin = () => { try { return localStorage.getItem(CLAVE_PIN) || PIN_POR_DEFECTO_HASH; } catch { return PIN_POR_DEFECTO_HASH; } };

  $("form-pin").addEventListener("submit", async (e) => {
    e.preventDefault();
    if ((await sha256($("pin").value)) === hashPin()) {
      $("bloqueo").hidden = true; $("panel").hidden = false; $("pin").value = "";
      pintarEstado();
    } else { $("pin-err").textContent = "PIN incorrecto."; $("pin").value = ""; }
  });
  $("btn-salir").addEventListener("click", () => location.reload());

  async function cargarConfig() {
    if (deploy) return;
    red = NETWORKS[NETWORK];
    deploy = (await (await fetch("config/deployments.json")).json())[NETWORK];
    ethers = await import(ETHERS_URL);
  }
  const abi = async (n) => (await fetch(`config/${n}.abi.json`)).json();
  const fila = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;

  async function pintarEstado() {
    try {
      await cargarConfig();
      const prov = new ethers.JsonRpcProvider(red.rpcUrls[0]);
      const oro = new ethers.Contract(deploy.oro, await abi("LootGold"), prov);
      const item = new ethers.Contract(deploy.address, await abi("GameItem"), prov);
      const [bloque, sup, objetos, own] = await Promise.all([prov.getBlockNumber(), oro.totalSupply(), item.totalSupply(), item.owner()]);
      $("estado").innerHTML = fila("Red", `${NETWORK} · bloque ${bloque}`) + fila("Owner", own)
        + fila("ORO en circulación", ethers.formatUnits(sup, 18)) + fila("Objetos acuñados", objetos)
        + fila("Tu cuenta", firmante ? await firmante.getAddress() : "sin conectar");
    } catch (err) { $("estado").innerHTML = fila("Estado", `Error: ${err.message}`); }
  }

  $("btn-conectar").addEventListener("click", async () => {
    try {
      await cargarConfig();
      if (!window.ethereum) throw new Error("MetaMask no está instalado.");
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x" + red.chainId.toString(16) }] });
      firmante = await new ethers.BrowserProvider(window.ethereum).getSigner();
      $("btn-mint").disabled = $("btn-oro").disabled = false;
      msg("Conectado.", "ok"); pintarEstado();
    } catch (err) { msg(err.shortMessage ?? err.message, "err"); }
  });

  async function ejecutar(fn) {
    try {
      msg("Firma en MetaMask…");
      const tx = await fn();
      msg(`Enviada ${tx.hash}. Esperando confirmación…`);
      await tx.wait();
      msg(`✔ Confirmada ${tx.hash}`, "ok");
      pintarEstado();
    } catch (err) { msg(err.shortMessage ?? err.message, "err"); }
  }

  $("btn-mint").addEventListener("click", () => {
    const datos = { destino: $("destino").value.trim(), rareza: Number($("rareza").value), ataque: Number($("ataque").value), defensa: Number($("defensa").value) };
    const error = validarMint(datos);
    if (error) return msg(error, "err");
    const nombres = ["Común", "Raro", "Legendario"], tipo = $("tipo").value;
    ejecutar(async () => new ethers.Contract(deploy.address, await abi("GameItem"), firmante)
      .mintItem(datos.destino, `${tipo} Admin (${nombres[datos.rareza]})`, tipo, datos.rareza, datos.ataque, datos.defensa));
  });

  $("btn-oro").addEventListener("click", () => {
    const destino = $("destino").value.trim(), n = Number($("oro").value);
    if (!/^0x[0-9a-fA-F]{40}$/.test(destino)) return msg("Dirección destino no válida.", "err");
    if (!Number.isInteger(n) || n <= 0) return msg("Cantidad no válida.", "err");
    ejecutar(async () => new ethers.Contract(deploy.oro, await abi("LootGold"), firmante).mint(destino, ethers.parseUnits(String(n), 18)));
  });
}
