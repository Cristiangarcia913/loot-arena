// Todo lo que toca la blockchain: carga del ABI, extracción del tokenId y el "minter".
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { getAddress } from 'ethers';
import { crearColaSerie } from './queue.js';

const here = dirname(fileURLToPath(import.meta.url));
export const RUTA_ABI = resolve(here, '../abi/GameItem.abi.json');

export function cargarAbi(ruta = RUTA_ABI) {
  let abi = JSON.parse(readFileSync(ruta, 'utf8'));
  if (!Array.isArray(abi) && Array.isArray(abi?.abi)) abi = abi.abi;
  if (!Array.isArray(abi)) throw new Error(`El ABI de ${ruta} no es un array`);
  return abi;
}

/**
 * Busca el evento ItemMinted en el recibo y devuelve el tokenId como string decimal.
 * @param {import('ethers').Interface} iface
 * @param {{ logs: Array<{ address: string, topics: string[], data: string }> }} receipt
 * @param {string} [contractAddress] si se da, solo acepta logs emitidos por ese contrato
 */
export function extraerTokenId(iface, receipt, contractAddress) {
  const objetivo = contractAddress ? getAddress(contractAddress) : null;
  for (const log of receipt?.logs ?? []) {
    if (objetivo && getAddress(log.address) !== objetivo) continue;
    let parsed;
    try { parsed = iface.parseLog({ topics: [...log.topics], data: log.data }); } catch { continue; }
    if (parsed?.name === 'ItemMinted') return parsed.args.tokenId.toString();
  }
  throw new Error('La transacción no emitió el evento ItemMinted');
}

/** Pide el nonce `pending` al nodo con `provider.send` (sin la caché de ethers). */
export function nonceDeFirmante(firmante) {
  return async () => {
    const hex = await firmante.provider.send('eth_getTransactionCount', [await firmante.getAddress(), 'pending']);
    return Number(BigInt(hex));
  };
}

/**
 * Emisor de transacciones de UNA wallet: las serializa en una cola (envío +
 * confirmación) y lleva el nonce localmente. El minter de objetos y el pago de
 * recompensas deben compartir el mismo emisor, porque usan la misma wallet.
 *
 * Por qué el nonce local: ethers v6 cachea ~250 ms las peticiones RPC idénticas,
 * así que `getTransactionCount('pending')` justo después de confirmar la tx
 * anterior puede devolver el nonce viejo (NONCE_EXPIRED). Se pide el nonce
 * la primera vez y tras cualquier error, y se incrementa en cada envío correcto.
 *
 * @param {{ obtenerNonce: () => Promise<number>, timeoutMs?: number }} opts
 * @returns {((construir: (overrides: { nonce: number }) => Promise<any>) => Promise<{ tx: any, receipt: any }>) & { cola: object }}
 */
export function crearEmisor({ obtenerNonce, timeoutMs = 120_000 }) {
  const cola = crearColaSerie();
  let nonce = null;
  async function enviar(construir) {
    return cola.run(async () => {
      try {
        if (nonce === null) nonce = await obtenerNonce();
        const tx = await construir({ nonce });
        nonce++;
        const receipt = await tx.wait(1, timeoutMs);
        if (!receipt || receipt.status !== 1) throw new Error('La transacción ha fallado');
        return { tx, receipt };
      } catch (err) {
        nonce = null; // ante la duda, se vuelve a preguntar al nodo en el siguiente envío
        throw err;
      }
    });
  }
  enviar.cola = cola;
  return enviar;
}

/**
 * Crea la función `mint(to, item)` que usa la app.
 * @param {import('ethers').Contract} contract  conectado a un Wallet owner
 * @param {{ timeoutMs?: number, obtenerNonce?: () => Promise<number>, emisor?: ReturnType<typeof crearEmisor> }} [opts]
 */
export function crearMinter(contract, { timeoutMs = 120_000, obtenerNonce, emisor } = {}) {
  emisor ??= crearEmisor({ timeoutMs, obtenerNonce: obtenerNonce ?? nonceDeFirmante(contract.runner) });
  const direccion = contract.target;
  async function mint(to, item) {
    const { tx, receipt } = await emisor((o) =>
      contract.mintItem(to, item.nombre, item.tipo, item.rareza, item.ataque, item.defensa, o));
    const tokenId = extraerTokenId(contract.interface, receipt, direccion);
    return { tokenId, txHash: tx.hash };
  }
  mint.cola = emisor.cola;
  return mint;
}

/** Mensaje legible para errores típicos de ethers. */
export function mensajeError(err, { accion = 'acuñar el objeto', rechazo = 'El contrato rechazó el mint' } = {}) {
  switch (err?.code) {
    case 'INSUFFICIENT_FUNDS': return 'El servidor no tiene ETH suficiente para pagar el gas';
    case 'CALL_EXCEPTION': return rechazo;
    case 'TIMEOUT': return 'La transacción está tardando demasiado; inténtalo más tarde';
    case 'NETWORK_ERROR':
    case 'SERVER_ERROR': return 'No se pudo conectar con la red Ethereum';
    case 'NONCE_EXPIRED':
    case 'REPLACEMENT_UNDERPRICED': return 'Conflicto de transacciones en el servidor; inténtalo de nuevo';
    default: return `Error interno al ${accion}`;
  }
}
