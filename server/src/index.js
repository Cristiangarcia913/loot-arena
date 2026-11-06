// Punto de entrada: lee .env, comprueba la conexión con la red y el contrato,
// y arranca Express. Si algo falla, sale con un mensaje claro (código 1).
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import dotenv from 'dotenv';
import express from 'express';
import { JsonRpcProvider, Network, Wallet, Contract, FetchRequest, formatEther } from 'ethers';
import { cargarConfig } from './config.js';
import { cargarAbi, crearMinter, crearEmisor, nonceDeFirmante, RUTA_ABI } from './chain.js';
import { crearApp } from './app.js';
import { ABI_RECOMPENSAS } from './abis.js';
import { IndexadorRanking, guardaSincronizando } from './ranking.js';
import { INICIO_TEMPORADAS } from './recompensa.js';

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
  const { config, errores, avisos } = cargarConfig(process.env);
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

  // Una sola cola/nonce para todas las transacciones de esta wallet (mints y recompensas).
  const emisor = crearEmisor({ obtenerNonce: nonceDeFirmante(wallet) });

  // ── 1.2: ranking y recompensas (opcionales; si faltan variables, 503 en esos endpoints) ──
  for (const a of avisos) console.warn(`⚠ ${a}`);
  const faltan = (...claves) => claves.filter((k) => config[k] === null)
    .map((k) => ({ mercadoAddress: 'MERCADO_ADDRESS', recompensasAddress: 'RECOMPENSAS_ADDRESS', deployBlock: 'DEPLOY_BLOCK' })[k]);

  let ranking = null;
  const faltanRanking = faltan('mercadoAddress', 'recompensasAddress', 'deployBlock');
  if (!faltanRanking.length) {
    ranking = new IndexadorRanking({
      provider, gameItem: config.contractAddress, mercado: config.mercadoAddress,
      recompensas: config.recompensasAddress, deployBlock: config.deployBlock,
    });
  }

  let pagarRecompensa = null;
  const faltanRecompensa = faltan('recompensasAddress');
  if (!faltanRecompensa.length) {
    const recompensas = new Contract(config.recompensasAddress, ABI_RECOMPENSAS, wallet);
    if ((await provider.getCode(config.recompensasAddress)) === '0x') {
      console.warn(`⚠ No hay contrato en RECOMPENSAS_ADDRESS (${config.recompensasAddress}): POST /recompensa fallará.`);
    }
    try {
      const operador = await recompensas.operador();
      if (operador.toLowerCase() !== wallet.address.toLowerCase()) {
        console.warn(`⚠ La wallet del servidor (${wallet.address}) no es el operador de Recompensas (${operador}).`);
      }
    } catch (e) {
      console.warn(`⚠ No se pudo comprobar Recompensas.operador(): ${e.shortMessage ?? e.message}`);
    }
    pagarRecompensa = async (to, cantidad, motivo) => {
      const { tx } = await emisor((o) => recompensas.recompensar(to, cantidad, motivo, o));
      return { txHash: tx.hash };
    };
  }

  const app = crearApp({
    mint: crearMinter(contract, { emisor }),
    ranking,
    rankingNoDisponible: `Ranking no disponible: el servidor no tiene configurado ${faltanRanking.join(', ')}`,
    pagarRecompensa,
    recompensaNoDisponible: `Recompensas no disponibles: el servidor no tiene configurado ${faltanRecompensa.join(', ')}`,
    inicioTemporadas: config.inicioTemporadas ?? INICIO_TEMPORADAS,
    contractAddress: config.contractAddress,
    chainId,
    dropChance: config.dropChance,
    allowedOrigin: config.allowedOrigin,
    trustProxy: config.trustProxy,
  });

  // El guard va delante de la app: mientras no hay índice, GET /ranking responde 503 + Retry-After
  // en vez de colgar. El indexado inicial arranca después de escuchar, en segundo plano.
  const raiz = express();
  raiz.use(guardaSincronizando(() => ranking));
  raiz.use(app);

  const server = raiz.listen(config.port, () => {
    console.log(`✓ Loot Arena server en http://localhost:${server.address().port}`);
    console.log(`  chainId ${chainId} · contrato ${config.contractAddress}`);
    console.log(`  minter ${wallet.address} (${formatEther(saldo)} ETH) · DROP_CHANCE ${config.dropChance} · CORS ${config.allowedOrigin}`);
    console.log(`  ranking ${ranking ? `activo desde el bloque ${config.deployBlock}` : 'desactivado'} · recompensas ${pagarRecompensa ? 'activas' : 'desactivadas'}`);
    ranking?.iniciar(60_000);
  });

  const cerrar = () => { console.log('Cerrando servidor…'); ranking?.detener(); server.close(() => process.exit(0)); };
  process.on('SIGTERM', cerrar);
  process.on('SIGINT', cerrar);
}

main().catch((e) => fatal(e?.shortMessage ?? e?.message ?? String(e)));
