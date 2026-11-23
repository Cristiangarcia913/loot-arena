import { nombreRevert } from "./wallet-errores.js";
// MetaMask (EIP-1193) + carga perezosa de ethers v6 desde CDN.
import { ETHERS_URL } from "../config/config.js";

let ethersPromise = null;

/** Importa ethers solo cuando hace falta: así el modo demo funciona aunque el CDN falle. */
export function cargarEthers() {
  ethersPromise ??= import(ETHERS_URL)
    .then((m) => m.ethers ?? m)
    .catch((e) => { ethersPromise = null; throw new Error(`No se pudo cargar ethers.js desde el CDN (${e.message})`); });
  return ethersPromise;
}

export const tieneMetaMask = () => typeof window !== "undefined" && !!window.ethereum;

const req = (method, params) => window.ethereum.request(params ? { method, params } : { method });

/** Cuentas ya autorizadas (no abre MetaMask). */
export const cuentasAutorizadas = () => req("eth_accounts");
/** Pide conexión (abre MetaMask). */
export const pedirCuentas = () => req("eth_requestAccounts");
export const chainIdActual = async () => Number(await req("eth_chainId"));

/** Cambia a la red; si MetaMask no la conoce (4902), la añade. */
export async function cambiarRed(net) {
  try {
    await req("wallet_switchEthereumChain", [{ chainId: net.chainIdHex }]);
  } catch (e) {
    const code = e?.code ?? e?.data?.originalError?.code;
    if (code !== 4902) throw e;
    const params = {
      chainId: net.chainIdHex,
      chainName: net.chainName,
      rpcUrls: net.rpcUrls,
      nativeCurrency: net.nativeCurrency,
    };
    if (net.blockExplorerUrls?.length) params.blockExplorerUrls = net.blockExplorerUrls;
    await req("wallet_addEthereumChain", [params]);
  }
}

export function escuchar({ onCuentas, onRed }) {
  window.ethereum.on?.("accountsChanged", onCuentas);
  window.ethereum.on?.("chainChanged", onRed);
}

/** Mensaje legible en español para errores de MetaMask / ethers. */
const ERRORES_ERC721 = {
  ERC721InvalidReceiver: "La dirección destino no es válida o no puede recibir NFTs.",
  ERC721IncorrectOwner: "Tu cuenta no es la dueña de este objeto en la blockchain.",
  ERC721InsufficientApproval: "No tienes autorización para transferir este objeto.",
  ERC721NonexistentToken: "El objeto no existe en la blockchain.",
  ERC721InvalidSender: "El remitente de la transferencia no es válido.",
};

export function mensajeError(e) {
  const rev = nombreRevert(e);
  if (rev && ERRORES_ERC721[rev]) return ERRORES_ERC721[rev];
  const code = e?.code ?? e?.info?.error?.code;
  if (code === 4001 || code === "ACTION_REJECTED") return "Has rechazado la operación en MetaMask.";
  if (code === -32002) return "Ya hay una solicitud pendiente: abre MetaMask para continuar.";
  if (code === "INSUFFICIENT_FUNDS") return "No tienes ETH suficiente para pagar el gas.";
  if (code === "CALL_EXCEPTION") return `El contrato rechazó la operación${e.reason ? `: ${e.reason}` : ""}.`;
  return e?.shortMessage || e?.message || String(e);
}
