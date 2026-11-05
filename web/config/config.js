// Configuración de la web de Loot Arena.
// Edita SERVER_URL y NETWORK antes de publicar.

/** URL del servidor de botín (Persona B). Sin barra final. */
// Por defecto, el servidor público de Render (web publicada y versión descargable).
// Con ?red=localhost (desarrollo con nodo Hardhat) se usa el servidor local.
const RED_URL = (() => { try { return new URLSearchParams(globalThis.location?.search ?? "").get("red"); } catch { return null; } })();
export const SERVER_URL = RED_URL === "localhost" ? "http://localhost:3000" : "https://loot-arena-cg913.onrender.com";

/** Red esperada: "sepolia" | "localhost". Se puede forzar con ?red=localhost en la URL. */
export const NETWORK = "sepolia";

/** ethers v6 como módulo ES desde CDN (versión fijada). */
export const ETHERS_URL = "https://cdn.jsdelivr.net/npm/ethers@6.13.4/dist/ethers.min.js";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Parámetros para wallet_switchEthereumChain / wallet_addEthereumChain. */
export const NETWORKS = Object.freeze({
  sepolia: {
    chainId: 11155111,
    chainIdHex: "0xaa36a7",
    chainName: "Sepolia",
    rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],
    nativeCurrency: { name: "Sepolia Ether", symbol: "SepoliaETH", decimals: 18 },
    blockExplorerUrls: ["https://sepolia.etherscan.io"],
  },
  localhost: {
    chainId: 31337,
    chainIdHex: "0x7a69",
    chainName: "Hardhat Local",
    rpcUrls: ["http://127.0.0.1:8545"],
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    blockExplorerUrls: [],
  },
});

/** Red activa: NETWORK, o ?red=sepolia|localhost en la URL (útil en desarrollo). */
export function redActiva() {
  try {
    const q = new URLSearchParams(globalThis.location?.search ?? "").get("red");
    if (q && Object.hasOwn(NETWORKS, q)) return q;
  } catch { /* sin location (tests) */ }
  return NETWORK;
}

async function fetchJson(nombre) {
  const url = new URL(`./${nombre}`, import.meta.url);
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`No se pudo cargar config/${nombre} (HTTP ${res.status})`);
  return res.json();
}

/**
 * Carga ABI y despliegues (web/config/*.json, copiados desde /shared con sync-config.mjs).
 * @returns {Promise<{serverUrl:string, red:string, net:object, abi:any[], address:string, chainId:number}>}
 */
export async function cargarConfig() {
  const [abiRaw, deployments] = await Promise.all([
    fetchJson("GameItem.abi.json"),
    fetchJson("deployments.json"),
  ]);
  const abi = Array.isArray(abiRaw) ? abiRaw : abiRaw?.abi;
  if (!Array.isArray(abi)) throw new Error("GameItem.abi.json no contiene un ABI válido");
  const red = redActiva();
  const net = NETWORKS[red];
  const dep = deployments?.[red] ?? {};
  return {
    serverUrl: SERVER_URL.replace(/\/+$/, ""),
    red,
    net,
    abi,
    address: dep.address || ZERO_ADDRESS,
    chainId: Number(dep.chainId ?? net.chainId),
  };
}
