// Punto de entrada: lee .env, comprueba la conexión con la red y el contrato,
// y arranca Express. Si algo falla, sale con un mensaje claro (código 1).
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import dotenv from 'dotenv';
import { JsonRpcProvider, Network, Wallet, Contract, FetchRequest, formatEther } from 'ethers';
import { cargarConfig } from './config.js';
import { cargarAbi, crearMinter, RUTA_ABI } from './chain.js';
import { crearApp } from './app.js';

const here = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(here, '../.env') }); // las variables del entorno real tienen prioridad

function fatal(...lineas) {
  console.error('\n✗ No se puede arrancar el servidor de Loot Arena:');
  for (const l of lineas) console.error(`  - ${l}`);
  console.error('');
  process.exit(1);
}

/** Pregunta eth_chainId con timeout, sin dejar reintentos en segundo plano. */
async function detectarChainId(rpcUrl, timeoutMs = 8000) {
  const req = new FetchRequest(rpcUrl);
  req.timeout = timeoutMs;
  req.body = { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] };
  const resp = await req.send();
  resp.assertOk();
  const json = resp.bodyJson;
  if (json?.error) throw new Error(json.error.message ?? 'error RPC');
  return Number(BigInt(json.result));
}

const ocultarClave = (url) => url.replace(/(\/v\d+\/)[^/?#]+/, '$1***').replace(/(api[_-]?key=)[^&]+/i, '$1***');

async function main() {
  const { config, errores } = cargarConfig(process.env);
  if (errores.length) fatal(...errores, 'Copia server/.env.example a server/.env y rellénalo (o define las variables en Render/Railway).');

  let abi;
  try { abi = cargarAbi(); } catch (e) { fatal(`No se pudo leer el ABI (${RUTA_ABI}): ${e.message}`); }

  let chainId;
  try {
    chainId = await detectarChainId(config.rpcUrl);
  } catch (e) {
    fatal(`No se pudo conectar con el RPC ${ocultarClave(config.rpcUrl)}: ${e.shortMessage ?? e.message}`,
      'Revisa RPC_URL (API key de Alchemy/Infura) o arranca el nodo local con `npx hardhat node`.');
  }

  const provider = new JsonRpcProvider(config.rpcUrl, Network.from(chainId), { staticNetwork: true });
  const wallet = new Wallet(config.privateKey, provider);
  const contract = new Contract(config.contractAddress, abi, wallet);

  const code = await provider.getCode(config.contractAddress);
  if (code === '0x') fatal(`No hay ningún contrato en ${config.contractAddress} en la red chainId ${chainId}.`,
    '¿CONTRACT_ADDRESS corresponde a esta red? (ver shared/deployments.json)');

  try {
    const owner = await contract.owner();
    if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
      fatal(`La PRIVATE_KEY (${wallet.address}) no es el owner del contrato (${owner}); mintItem fallaría siempre.`);
    }
  } catch (e) {
    console.warn(`⚠ No se pudo comprobar owner(): ${e.shortMessage ?? e.message}`);
  }

  const saldo = await provider.getBalance(wallet.address);
  if (saldo === 0n) console.warn(`⚠ La cuenta ${wallet.address} no tiene ETH: los mints fallarán por falta de gas.`);

  const app = crearApp({
    mint: crearMinter(contract),
    contractAddress: config.contractAddress,
    chainId,
    dropChance: config.dropChance,
    allowedOrigin: config.allowedOrigin,
    trustProxy: config.trustProxy,
  });

  const server = app.listen(config.port, () => {
    console.log(`✓ Loot Arena server en http://localhost:${server.address().port}`);
    console.log(`  chainId ${chainId} · contrato ${config.contractAddress}`);
    console.log(`  minter ${wallet.address} (${formatEther(saldo)} ETH) · DROP_CHANCE ${config.dropChance} · CORS ${config.allowedOrigin}`);
  });

  const cerrar = () => { console.log('Cerrando servidor…'); server.close(() => process.exit(0)); };
  process.on('SIGTERM', cerrar);
  process.on('SIGINT', cerrar);
}

main().catch((e) => fatal(e?.shortMessage ?? e?.message ?? String(e)));
