// Configuración de la web de Loot Arena.
// Edita SERVER_URL y NETWORK antes de publicar.

/** URL del servidor de botín (Persona B). Sin barra final. */
// Por defecto, el servidor público de Render (web publicada y versión descargable).
// Con ?red=localhost (desarrollo con nodo Hardhat) se usa el servidor local.
// Se decide con la red elegida (URL o preferencia guardada), que se resuelve más abajo en
// redActiva(); aquí solo mira la de la URL porque esto se evalúa al importar el módulo.
const RED_URL = (() => {
  try {
    const q = new URLSearchParams(globalThis.location?.search ?? "").get("red");
    if (q) return q;
    return globalThis.localStorage?.getItem("lootarena:red") ?? null;
  } catch { return null; }
})();
export const SERVER_URL = RED_URL === "localhost" ? "http://localhost:3000" : "https://loot-arena-cg913.onrender.com";

/** Red por defecto. Se puede cambiar desde el juego, o forzar con ?red=… en la URL. */
export const NETWORK = "sepolia";

/** Clave donde se recuerda la red elegida en el juego. */
export const CLAVE_RED = "lootarena:red";

/** ethers v6 como módulo ES desde CDN (versión fijada). */
export const ETHERS_URL = "https://cdn.jsdelivr.net/npm/ethers@6.13.4/dist/ethers.min.js";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Redes que el juego conoce, con los parámetros de wallet_switchEthereumChain /
 * wallet_addEthereumChain. Todas son de prueba: en este juego no se juega con dinero real.
 *
 * Los chainId están comprobados contra el RPC público de cada red (eth_chainId), no copiados
 * de memoria: un chainId equivocado haría que la cartera añadiera una red falsa.
 * `grifo` es de dónde se saca gas de prueba gratis, que es lo primero que pregunta quien
 * cambia de red y se queda sin fondos.
 */
export const NETWORKS = Object.freeze({
  sepolia: {
    chainId: 11155111,
    chainIdHex: "0xaa36a7",
    chainName: "Sepolia",
    rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],
    nativeCurrency: { name: "Sepolia Ether", symbol: "SepoliaETH", decimals: 18 },
    blockExplorerUrls: ["https://sepolia.etherscan.io"],
    grifo: "https://cloud.google.com/application/web3/faucet/ethereum/sepolia",
  },
  "arbitrum-sepolia": {
    chainId: 421614,
    chainIdHex: "0x66eee",
    chainName: "Arbitrum Sepolia",
    rpcUrls: ["https://sepolia-rollup.arbitrum.io/rpc"],
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    blockExplorerUrls: ["https://sepolia.arbiscan.io"],
    grifo: "https://www.alchemy.com/faucets/arbitrum-sepolia",
  },
  "base-sepolia": {
    chainId: 84532,
    chainIdHex: "0x14a34",
    chainName: "Base Sepolia",
    rpcUrls: ["https://sepolia.base.org"],
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    blockExplorerUrls: ["https://sepolia.basescan.org"],
    grifo: "https://portal.cdp.coinbase.com/products/faucet",
  },
  "optimism-sepolia": {
    chainId: 11155420,
    chainIdHex: "0xaa37dc",
    chainName: "OP Sepolia",
    rpcUrls: ["https://sepolia.optimism.io"],
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    blockExplorerUrls: ["https://sepolia-optimism.etherscan.io"],
    grifo: "https://www.alchemy.com/faucets/optimism-sepolia",
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

/** Nombre legible de una red conocida (o la clave, si no la conocemos). */
export const nombreRed = (red) => NETWORKS[red]?.chainName ?? red;

/** Clave de red a partir de un chainId, o null si no la conocemos. */
export function redDeChainId(chainId) {
  const n = Number(chainId);
  for (const [clave, net] of Object.entries(NETWORKS)) if (net.chainId === n) return clave;
  return null;
}

/**
 * Red activa, por orden de prioridad:
 *   1. ?red=… en la URL (manda siempre: sirve para enlazar una red concreta y para desarrollo)
 *   2. la que el jugador eligió en el juego (guardada)
 *   3. NETWORK
 */
export function redActiva() {
  try {
    const q = new URLSearchParams(globalThis.location?.search ?? "").get("red");
    if (q && Object.hasOwn(NETWORKS, q)) return q;
  } catch { /* sin location (tests) */ }
  try {
    const g = globalThis.localStorage?.getItem(CLAVE_RED);
    if (g && Object.hasOwn(NETWORKS, g)) return g;
  } catch { /* sin storage */ }
  return NETWORK;
}

/** Recuerda la red elegida. No recarga: de eso se encarga quien llama. */
export function guardarRed(red) {
  if (!Object.hasOwn(NETWORKS, red)) return false;
  try { globalThis.localStorage?.setItem(CLAVE_RED, red); return true; } catch { return false; }
}

async function fetchJson(nombre) {
  const url = new URL(`./${nombre}`, import.meta.url);
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`No se pudo cargar config/${nombre} (HTTP ${res.status})`);
  return res.json();
}

/**
 * Carga ABI y despliegues (web/config/*.json, copiados desde /shared con sync-config.mjs).
 *
 * `desplegada` dice si esa red tiene contratos. El juego conoce más redes de las que tienen
 * contratos puestos, y eso no es un error: al cambiar a una red sin desplegar hay que explicar
 * qué falta, no reventar con direcciones vacías.
 *
 * @returns {Promise<{serverUrl:string, red:string, net:object, abi:any[], address:string,
 *   chainId:number, desplegada:boolean, redesDesplegadas:string[]}>}
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
  const desplegada = !!dep.address && dep.address !== ZERO_ADDRESS;
  const redesDesplegadas = Object.keys(NETWORKS)
    .filter((r) => { const d = deployments?.[r]; return !!d?.address && d.address !== ZERO_ADDRESS; });
  return {
    serverUrl: SERVER_URL.replace(/\/+$/, ""),
    red,
    net,
    abi,
    address: dep.address || ZERO_ADDRESS,
    chainId: Number(dep.chainId ?? net.chainId),
    desplegada,
    redesDesplegadas,
  };
}
