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
import { INICIO_TEMPORADAS, RegistroDiario } from './recompensa.js';
import { RegistroGas, TOPE_DIARIO_POR_DEFECTO } from './gas.js';
import { RegistroTorre } from './torre.js';
import { EstadoBotin, RegistroPrimerBotin } from './loot.js';
import { crearAlmacen } from './almacen.js';
import { conectarRegistros } from './persistencia.js';

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

  // ── 1.3: grifo de gas. Mismo emisor (cola + nonce) que los mints y las recompensas. ──
  const gasTopeDiario = config.gasTopeDiario ?? TOPE_DIARIO_POR_DEFECTO;
  const enviarGas = async (to, wei) => {
    const { tx } = await emisor((o) => wallet.sendTransaction({ to, value: wei, ...o }));
    return { txHash: tx.hash };
  };

  // ── 1.4: persistencia. Todo lo que debe sobrevivir a un reinicio de Render se
  // guarda en la capa `almacen.js`. Si el almacén externo no responde, se sigue con
  // memoria (el servidor NO se cae) y `/health` lo publica. ──
  const { almacen, estado: estadoAlmacen } = await crearAlmacen(process.env);
  if (estadoAlmacen.aviso) console.warn(`⚠ [almacen] ${estadoAlmacen.aviso}`);

  const registroDiario = new RegistroDiario();
  const registroPrimerBotin = new RegistroPrimerBotin();
  const registroGas = new RegistroGas({ topeDiario: gasTopeDiario });
  const registroTorre = new RegistroTorre();
  const estadoBotin = new EstadoBotin();

  const { restaurados, vaciarTodo } = await conectarRegistros({
    almacen,
    estado: estadoAlmacen,
    registros: {
      diario: registroDiario,
      primerBotin: registroPrimerBotin,
      gas: registroGas,
      torre: registroTorre,
      botin: estadoBotin,
      // El índice del ranking solo existe si están sus variables. Al restaurarlo,
      // GET /ranking sirve desde el primer segundo en vez de dar 503 ~25 s.
      ranking,
    },
  });

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
    // /health informa del saldo de la wallet del servidor (alerta si baja de 0,002 ETH).
    obtenerSaldo: () => provider.getBalance(wallet.address),
    saldoDe: (address) => provider.getBalance(address),
    enviarGas,
    registroGas,
    registroDiario,
    registroPrimerBotin,
    registroTorre,
    estadoBotin,
    estadoAlmacen,
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
    const desdeRanking = ranking?.restaurado
      ? `restaurado en el bloque ${ranking.siguiente - 1}`
      : `activo desde el bloque ${config.deployBlock}`;
    console.log(`  ranking ${ranking ? desdeRanking : 'desactivado'} · recompensas ${pagarRecompensa ? 'activas' : 'desactivadas'}`);
    console.log(`  grifo de gas activo (tope diario ${formatEther(gasTopeDiario)} ETH)`);
    console.log(`  almacén ${estadoAlmacen.tipo}${estadoAlmacen.degradado ? ' (DEGRADADO: se pierde al reiniciar)' : ''}`
      + ` · restaurado: ${restaurados.length ? restaurados.join(', ') : 'nada (primer arranque)'}`);
    ranking?.iniciar(60_000);
  });

  // Al cerrar se vuelca lo que quede pendiente de guardar antes de salir.
  const cerrar = () => {
    console.log('Cerrando servidor…');
    ranking?.detener();
    server.close(async () => {
      try { await vaciarTodo(); } catch { /* ya se ha registrado en el log */ }
      process.exit(0);
    });
  };
  process.on('SIGTERM', cerrar);
  process.on('SIGINT', cerrar);
}

main().catch((e) => fatal(e?.shortMessage ?? e?.message ?? String(e)));
