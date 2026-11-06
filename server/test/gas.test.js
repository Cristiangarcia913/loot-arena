import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { parseEther } from 'ethers';
import { crearApp } from '../src/app.js';
import { crearEmisor, crearMinter } from '../src/chain.js';
import { RegistroGas, CANTIDAD_GAS, UMBRAL_JUGADOR, TOPE_DIARIO_POR_DEFECTO } from '../src/gas.js';
import { cargarConfig } from '../src/config.js';
import { levantar, loggerMudo } from './helpers.js';

const CONTRATO = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const JUGADOR = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const dir = (i) => `0x${(i + 1).toString(16).padStart(40, '0')}`;
const DIA = Date.UTC(2026, 10, 6, 12, 0, 0); // 6 nov 2026, 12:00 UTC

async function pedir(url, body) {
  const r = await fetch(`${url}/gas`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json() };
}
async function consultar(url, address) {
  const r = await fetch(`${url}/gas/${address}`);
  return { status: r.status, json: await r.json() };
}

describe('RegistroGas', () => {
  test('constantes del documento: umbral 0,0003, envío 0,0005, tope 0,01', () => {
    assert.equal(UMBRAL_JUGADOR, parseEther('0.0003'));
    assert.equal(CANTIDAD_GAS, parseEther('0.0005'));
    assert.equal(TOPE_DIARIO_POR_DEFECTO, parseEther('0.01'));
  });
  test('una vez por dirección y día UTC; se reinicia a medianoche', () => {
    const r = new RegistroGas();
    assert.equal(r.reservar(JUGADOR, DIA).ok, true);
    assert.deepEqual(r.reservar(JUGADOR, DIA + 1000), { ok: false, motivo: 'duplicado' });
    assert.equal(r.yaPedido(JUGADOR, DIA), true);
    const manana = Date.UTC(2026, 10, 7, 0, 0, 1);
    assert.equal(r.yaPedido(JUGADOR, manana), false);
    assert.equal(r.reservar(JUGADOR, manana).ok, true);
  });
  test('tope global: 0,01 / 0,0005 = 20 envíos al día', () => {
    const r = new RegistroGas();
    for (let i = 0; i < 20; i++) assert.equal(r.reservar(dir(i), DIA).ok, true, `envío ${i}`);
    assert.equal(r.hayCupo(DIA), false);
    assert.deepEqual(r.reservar(dir(99), DIA), { ok: false, motivo: 'tope' });
  });
  test('liberar devuelve el cupo y permite reintentar', () => {
    const r = new RegistroGas({ topeDiario: CANTIDAD_GAS });
    const a = r.reservar(JUGADOR, DIA);
    assert.equal(r.hayCupo(DIA), false);
    r.liberar(a.reserva);
    assert.equal(r.hayCupo(DIA), true);
    assert.equal(r.reservar(JUGADOR, DIA).ok, true);
  });
});

describe('GAS_TOPE_DIARIO en config', () => {
  const base = {
    RPC_URL: 'http://127.0.0.1:8545', PRIVATE_KEY: `0x${'1'.repeat(64)}`, CONTRACT_ADDRESS: CONTRATO,
  };
  test('por defecto null (→ 0,01 ETH), acepta decimales y avisa si es basura', () => {
    assert.equal(cargarConfig(base).config.gasTopeDiario, null);
    assert.equal(cargarConfig({ ...base, GAS_TOPE_DIARIO: '0.02' }).config.gasTopeDiario, parseEther('0.02'));
    const mal = cargarConfig({ ...base, GAS_TOPE_DIARIO: 'mucho' });
    assert.equal(mal.config.gasTopeDiario, null);
    assert.ok(mal.avisos.some((a) => a.includes('GAS_TOPE_DIARIO')));
    assert.equal(mal.errores.length, 0);
  });
});

describe('POST /gas y GET /gas/:address (provider simulado, sin red)', () => {
  let srv, reloj, saldos, saldoSrv, envios, envioFalla;

  const arrancar = async (extra = {}) => {
    srv = await levantar(crearApp({
      primerBotin: false,
      mint: async () => ({ tokenId: 1n, txHash: '0x01' }),
      contractAddress: CONTRATO, chainId: 11155111, now: () => reloj, logger: loggerMudo,
      obtenerSaldo: async () => saldoSrv,
      saldoDe: async (a) => saldos.get(a) ?? 0n,
      enviarGas: async (to, wei) => {
        if (envioFalla) throw envioFalla;
        envios.push({ to, wei });
        saldos.set(to, (saldos.get(to) ?? 0n) + wei);
        return { txHash: `0x${'ee'.repeat(32)}` };
      },
      ...extra,
    }));
  };

  beforeEach(async () => {
    reloj = DIA; saldos = new Map(); saldoSrv = parseEther('0.05'); envios = []; envioFalla = null;
    await arrancar();
  });
  afterEach(() => srv.cerrar());

  test('200 envía 0,0005 ETH si el saldo es menor que 0,0003', async () => {
    saldos.set(JUGADOR, parseEther('0.0001'));
    const r = await pedir(srv.url, { address: JUGADOR.toLowerCase() });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { ok: true, enviado: 0.0005, txHash: `0x${'ee'.repeat(32)}` });
    assert.deepEqual(envios, [{ to: JUGADOR, wei: CANTIDAD_GAS }]);
  });

  test('200 enviado:0 "ya tienes gas" si tiene ≥ 0,0003 (y no gasta su petición del día)', async () => {
    saldos.set(JUGADOR, parseEther('0.0003'));
    const r = await pedir(srv.url, { address: JUGADOR });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.enviado, 0);
    assert.equal(r.json.motivo, 'ya tienes gas');
    assert.equal(envios.length, 0);
    saldos.set(JUGADOR, 0n);
    reloj += 11_000;
    assert.equal((await pedir(srv.url, { address: JUGADOR })).status, 200);
    assert.equal(envios.length, 1);
  });

  test('409 si ya lo pidió hoy, con proximoEn hasta medianoche UTC; al día siguiente vuelve a poder', async () => {
    assert.equal((await pedir(srv.url, { address: JUGADOR })).status, 200);
    saldos.set(JUGADOR, 0n); // lo gastó todo
    reloj += 11_000;
    const r = await pedir(srv.url, { address: JUGADOR });
    assert.equal(r.status, 409);
    assert.match(r.json.error, /hoy/);
    assert.equal(r.json.proximoEn, 12 * 3600 - 11);
    reloj = Date.UTC(2026, 10, 7, 0, 0, 5);
    assert.equal((await pedir(srv.url, { address: JUGADOR })).status, 200);
    assert.equal(envios.length, 2);
  });

  test('503 si el servidor bajaría de 0,002 ETH', async () => {
    saldoSrv = parseEther('0.0024'); // 0,0024 − 0,0005 = 0,0019 < 0,002
    const r = await pedir(srv.url, { address: JUGADOR });
    assert.equal(r.status, 503);
    assert.match(r.json.error, /sin ETH/);
    assert.equal(envios.length, 0);
    saldoSrv = parseEther('0.0025');
    reloj += 11_000;
    assert.equal((await pedir(srv.url, { address: JUGADOR })).status, 200);
  });

  test('503 cuando se agota el tope global diario', async () => {
    await srv.cerrar();
    await arrancar({ registroGas: new RegistroGas({ topeDiario: parseEther('0.001') }) }); // 2 envíos
    assert.equal((await pedir(srv.url, { address: dir(1) })).status, 200);
    assert.equal((await pedir(srv.url, { address: dir(2) })).status, 200);
    const r = await pedir(srv.url, { address: dir(3) });
    assert.equal(r.status, 503);
    assert.match(r.json.error, /agotado/);
    const g = await consultar(srv.url, dir(3));
    assert.equal(g.json.puedePedir, false);
  });

  test('si el envío falla se libera: puede volver a intentarlo; sin fondos → 503', async () => {
    envioFalla = Object.assign(new Error('boom'), { code: 'NETWORK_ERROR' });
    const r = await pedir(srv.url, { address: JUGADOR });
    assert.equal(r.status, 500);
    assert.equal(r.json.error, 'No se pudo conectar con la red Ethereum');
    envioFalla = Object.assign(new Error('pobre'), { code: 'INSUFFICIENT_FUNDS' });
    reloj += 11_000;
    assert.equal((await pedir(srv.url, { address: JUGADOR })).status, 503);
    envioFalla = null;
    reloj += 11_000;
    assert.equal((await pedir(srv.url, { address: JUGADOR })).status, 200);
  });

  test('dos peticiones simultáneas de la misma dirección: solo un envío', async () => {
    const [a, b] = await Promise.all([pedir(srv.url, { address: JUGADOR }), pedir(srv.url, { address: JUGADOR })]);
    assert.deepEqual([a.status, b.status].sort(), [200, 429]);
    assert.equal(envios.length, 1);
  });

  test('400 dirección inválida; 429 por dirección (1 cada 10 s)', async () => {
    assert.equal((await pedir(srv.url, { address: 'nope' })).status, 400);
    assert.equal((await consultar(srv.url, 'nope')).status, 400);
    saldos.set(JUGADOR, parseEther('1'));
    assert.equal((await pedir(srv.url, { address: JUGADOR })).status, 200);
    const r = await pedir(srv.url, { address: JUGADOR });
    assert.equal(r.status, 429);
    assert.match(r.json.error, /Demasiadas peticiones/);
  });

  test('GET /gas/:address → {saldo, puedePedir, proximoEn}', async () => {
    saldos.set(JUGADOR, parseEther('0.0001'));
    let g = await consultar(srv.url, JUGADOR);
    assert.equal(g.status, 200);
    assert.deepEqual(g.json, { saldo: '0.0001', puedePedir: true, proximoEn: 0 });
    await pedir(srv.url, { address: JUGADOR });
    g = await consultar(srv.url, JUGADOR);
    assert.equal(g.json.saldo, '0.0006');
    assert.equal(g.json.puedePedir, false);
    assert.equal(g.json.proximoEn, 12 * 3600);
    assert.equal(g.json.motivo, 'Ya has pedido gas hoy');
    saldos.set(dir(5), parseEther('0.01'));
    g = await consultar(srv.url, dir(5));
    assert.deepEqual(g.json, { saldo: '0.01', puedePedir: false, proximoEn: 0, motivo: 'ya tienes gas' });
  });

  test('503 si el servidor no tiene grifo configurado', async () => {
    await srv.cerrar();
    await arrancar({ enviarGas: null });
    assert.equal((await pedir(srv.url, { address: JUGADOR })).status, 503);
    assert.equal((await consultar(srv.url, JUGADOR)).status, 503);
  });
});

describe('gas y mints comparten emisor: nonces en orden, sin choques', () => {
  test('mint + gas + mint simultáneos usan nonces 7, 8, 9 en serie', async () => {
    let enVuelo = 0, maxEnVuelo = 0;
    const nonces = [];
    const txFalsa = (nonce) => {
      enVuelo++; maxEnVuelo = Math.max(maxEnVuelo, enVuelo); nonces.push(nonce);
      return {
        hash: `0x${String(nonce).padStart(64, '0')}`,
        wait: async () => { await new Promise((r) => setTimeout(r, 5)); enVuelo--; return { status: 1, logs: [] }; },
      };
    };
    const emisor = crearEmisor({ obtenerNonce: async () => 7 });
    const contrato = {
      target: CONTRATO,
      interface: { parseLog: () => null },
      mintItem: async (...args) => txFalsa(args.at(-1).nonce),
    };
    const mint = crearMinter(contrato, { emisor });
    const enviarGas = async (to, wei) => {
      const { tx } = await emisor((o) => Promise.resolve(txFalsa(o.nonce)));
      return { txHash: tx.hash };
    };
    const item = { nombre: 'x', tipo: 'Espada', rareza: 0, ataque: 1, defensa: 0 };
    const res = await Promise.allSettled([mint(JUGADOR, item), enviarGas(JUGADOR, CANTIDAD_GAS), mint(JUGADOR, item)]);
    // Los mints fallan al extraer el tokenId (el recibo falso no tiene logs), pero la tx se envió en orden.
    assert.equal(res[1].status, 'fulfilled');
    assert.deepEqual(nonces, [7, 8, 9]);
    assert.equal(maxEnVuelo, 1);
  });
});
