// Lectura y validación de la configuración (SPEC.md §2). Función pura sobre `env`.
import { isAddress, getAddress, ZeroAddress, parseEther } from 'ethers';
import { resolverRed } from './redes.js';

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ config: object, errores: string[], avisos: string[] }}
 *   `errores` impiden arrancar; `avisos` solo desactivan /ranking o /recompensa (no rompen /ganar).
 */
export function cargarConfig(env = process.env) {
  const errores = [];
  const avisos = [];
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

  // ── Opcionales de la 1.2 (ranking y recompensas) ──
  const dirOpcional = (k, para) => {
    const v = limpio(k);
    if (!v) { avisos.push(`Falta ${k}: ${para} devolverá 503.`); return null; }
    if (!isAddress(v) || getAddress(v) === ZeroAddress) { avisos.push(`${k} no es una dirección válida ("${v}"): ${para} devolverá 503.`); return null; }
    return getAddress(v);
  };
  const mercadoAddress = dirOpcional('MERCADO_ADDRESS', 'GET /ranking y GET /tesoreria');
  const recompensasAddress = dirOpcional('RECOMPENSAS_ADDRESS', 'GET /ranking y POST /recompensa');
  const oroAddress = dirOpcional('ORO_ADDRESS', 'GET /tesoreria');
  const dbTxt = limpio('DEPLOY_BLOCK');
  let deployBlock = null;
  if (!dbTxt) avisos.push('Falta DEPLOY_BLOCK: GET /ranking devolverá 503.');
  else if (!/^\d+$/.test(dbTxt)) avisos.push(`DEPLOY_BLOCK debe ser un entero ≥ 0 ("${dbTxt}"): GET /ranking devolverá 503.`);
  else deployBlock = Number(dbTxt);

  const tiTxt = limpio('TEMPORADA_INICIO');
  let inicioTemporadas = null;
  if (tiTxt) {
    const ms = Date.parse(tiTxt);
    if (Number.isFinite(ms)) inicioTemporadas = ms;
    else avisos.push(`TEMPORADA_INICIO no es una fecha válida ("${tiTxt}"); se usa la de por defecto.`);
  }

  // ── 1.3: tope global diario del grifo de gas (ETH) ──
  const gtTxt = limpio('GAS_TOPE_DIARIO');
  let gasTopeDiario = null; // null → el de por defecto (0,01 ETH)
  if (gtTxt) {
    let wei = null;
    try { if (/^\d+(\.\d+)?$/.test(gtTxt)) wei = parseEther(gtTxt); } catch { wei = null; }
    if (wei === null) avisos.push(`GAS_TOPE_DIARIO debe ser una cantidad de ETH como 0.01 ("${gtTxt}"); se usa 0.01.`);
    else gasTopeDiario = wei;
  }

  // ── 1.4.1 (fase E4): la red es un parámetro, no Sepolia a fuego ──
  const red = resolverRed(limpio('RED'));
  if (!red.conocida) {
    avisos.push(`RED="${red.clave}" no está en la lista de redes conocidas: se usa igual, `
      + 'pero no se puede comprobar que RPC_URL apunte a la red correcta.');
  }

  return {
    config: {
      rpcUrl, privateKey, contractAddress, port, dropChance, allowedOrigin, trustProxy,
      mercadoAddress, recompensasAddress, oroAddress, deployBlock, inicioTemporadas, gasTopeDiario,
      red,
    },
    errores,
    avisos,
  };
}

/** Traduce ALLOWED_ORIGIN al formato de la opción `origin` de `cors`. */
export function origenCors(allowedOrigin) {
  if (!allowedOrigin || allowedOrigin === '*') return '*';
  const lista = allowedOrigin.split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
  return lista.length === 1 ? lista[0] : lista;
}
