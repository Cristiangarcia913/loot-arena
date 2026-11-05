// Lecturas y escrituras al contrato GameItem (SPEC.md §1).
import { normalizarItem } from "./equipment.js";

export function crearContrato(ethers, cfg) {
  const provider = new ethers.BrowserProvider(window.ethereum);
  const contrato = new ethers.Contract(cfg.address, cfg.abi, provider);
  return { provider, contrato };
}

export async function hayCodigo(provider, address) {
  const code = await provider.getCode(address);
  return code && code !== "0x";
}

/** Lista los objetos de `owner` con balanceOf + tokenOfOwnerByIndex + getItem. */
export async function leerInventario(contrato, owner) {
  const n = Number(await contrato.balanceOf(owner));
  const ids = await Promise.all(Array.from({ length: n }, (_, i) => contrato.tokenOfOwnerByIndex(owner, i)));
  return Promise.all(ids.map(async (id) => normalizarItem(await contrato.getItem(id), id)));
}

/** safeTransferFrom(from, to, tokenId) firmado con MetaMask. Devuelve la tx enviada. */
export async function transferir(provider, contrato, from, to, tokenId) {
  const signer = await provider.getSigner();
  return contrato.connect(signer)["safeTransferFrom(address,address,uint256)"](from, to, tokenId);
}

export function enlacesExplorador(net, address) {
  const base = net.blockExplorerUrls?.[0];
  if (!base) return { tx: () => null, token: () => null };
  return {
    tx: (hash) => `${base}/tx/${hash}`,
    token: (id) => `${base}/nft/${address}/${id}`,
  };
}
