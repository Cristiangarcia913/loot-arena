// Lectura y validación de la configuración (SPEC.md §2). Función pura sobre `env`.
import { isAddress, getAddress, ZeroAddress } from 'ethers';

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ config: object, errores: string[] }}
 */
export function cargarConfig(env = process.env) {
  const errores = [];
  const limpio = (k) => (env[k] ?? '').trim();

  const rpcUrl = limpio('RPC_URL');
  if (!rpcUrl) errores.push('Falta RPC_URL (URL del nodo Sepolia de Alchemy/Infura o http://127.0.0.1:8545).');
  else if (!/^https?:\/\//i.test(rpcUrl)) errores.push(`RPC_URL debe empezar por http:// o https:// (recibido "${rpcUrl}").`);

  let privateKey = limpio('PRIVATE_KEY');
  if (privateKey && !privateKey.startsWith('0x')) privateKey = `0x${privateKey}`;
  if (!privateKey) errores.push('Falta PRIVATE_KEY (clave privada del owner del contrato).');
  else if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) errores.push('PRIVATE_KEY no tiene formato válido (deben ser 64 caracteres hexadecimales).');

  let contractAddress = limpio('CONTRACT_ADDRESS');
  if (!contractAddress) errores.push('Falta CONTRACT_ADDRESS (dirección del contrato GameItem, ver shared/deployments.json).');
  else if (!isAddress(contractAddress)) errores.push(`CONTRACT_ADDRESS no es una dirección válida ("${contractAddress}").`);
  else if (getAddress(contractAddress) === ZeroAddress) errores.push('CONTRACT_ADDRESS no puede ser la dirección cero.');
  else contractAddress = getAddress(contractAddress);

  const portTxt = limpio('PORT') || '3000';
  const port = Number(portTxt);
  if (!Number.isInteger(port) || port < 0 || port > 65535) errores.push(`PORT inválido ("${portTxt}").`);

  const dropTxt = limpio('DROP_CHANCE') || '0.6';
  const dropChance = Number(dropTxt);
  if (!Number.isFinite(dropChance) || dropChance < 0 || dropChance > 1) errores.push(`DROP_CHANCE debe estar entre 0 y 1 ("${dropTxt}").`);

  const allowedOrigin = limpio('ALLOWED_ORIGIN') || '*';

  const tpTxt = limpio('TRUST_PROXY') || '1';
  const trustProxy = /^\d+$/.test(tpTxt) ? Number(tpTxt) : tpTxt === 'true';

  return {
    config: { rpcUrl, privateKey, contractAddress, port, dropChance, allowedOrigin, trustProxy },
    errores,
  };
}

/** Traduce ALLOWED_ORIGIN al formato de la opción `origin` de `cors`. */
export function origenCors(allowedOrigin) {
  if (!allowedOrigin || allowedOrigin === '*') return '*';
  const lista = allowedOrigin.split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
  return lista.length === 1 ? lista[0] : lista;
}
