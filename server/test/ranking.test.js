import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Interface, parseUnits } from 'ethers';
import { IndexadorRanking, CATEGORIAS, TOPICS } from '../src/ranking.js';
import { ABI_GAMEITEM_EVENTOS, ABI_MERCADO_EVENTOS, ABI_RECOMPENSAS } from '../src/abis.js';
import { loggerMudo } from './helpers.js';

const GAME = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const MERCADO = '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9';
const RECOMP = '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9';
const A = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const B = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
const C = '0x90F79bf6EB2c4f870365E785982E1f101E93b906';
const dir = (i) => `0x${(i + 1).toString(16).padStart(40, '0')}`;

const iGame = new Interface(ABI_GAMEITEM_EVENTOS);
const iMerc = new Interface(ABI_MERCADO_EVENTOS);
const iRec = new Interface(ABI_RECOMPENSAS);

/** Provider simulado: guarda logs codificados de verdad y filtra como un nodo. */
class ProviderFalso {
  constructor() {
    this.logs = [];
    this.cabeza = 0;
    this.maxRango = Infinity;     // rangos mayores → error como los RPC públicos
    this.retraso = 0;             // el nodo "no ha visto" aún los últimos N bloques (datos desfasados)
    this.fallarVeces = 0;         // errores transitorios
    this.llamadas = [];
    this.n = 0;
  }
  async getBlockNumber() { return this.cabeza; }
  async getLogs({ address, topics, fromBlock, toBlock }) {
    this.llamadas.push([fromBlock, toBlock]);
    if (this.fallarVeces > 0) { this.fallarVeces--; throw new Error('timeout'); }
    if (toBlock - fromBlock + 1 > this.maxRango) throw new Error('query exceeds max block range');
    const dirs = address.map((x) => x.toLowerCase());
    return this.logs.filter((l) => l.blockNumber >= fromBlock && l.blockNumber <= toBlock
      && l.blockNumber <= this.cabeza - this.retraso
      && dirs.includes(l.address.toLowerCase()) && topics[0].includes(l.topics[0]));
  }
  _push(address, iface, evento, args, bloque) {
    const { data, topics } = iface.encodeEventLog(iface.getEvent(evento), args);
    const i = this.n++;
    this.logs.push({ address, data, topics, blockNumber: bloque, transactionHash: `0x${i.toString(16).padStart(64, '0')}`, index: 0 });
  }
  mint(to, rareza, bloque) { this._push(GAME, iGame, 'ItemMinted', [to, BigInt(this.n), 'x', 'Espada', rareza, 1, 0], bloque); }
  venta(j, oro, bloque) { this._push(MERCADO, iMerc, 'ItemVendido', [j, 1n, parseUnits(String(oro), 18), 0n], bloque); }
  diario(j, racha, bloque) { this._push(RECOMP, iRec, 'DiarioReclamado', [j, 20397n, BigInt(racha), 10n, 0n], bloque); }
  recompensa(j, motivo, bloque) { this._push(RECOMP, iRec, 'Recompensado', [j, 1n, motivo], bloque); }
}

const crear = (provider, extra = {}) => new IndexadorRanking({
  provider, gameItem: GAME, mercado: MERCADO, recompensas: RECOMP, deployBlock: 100,
  margen: 0, solape: 10, logger: loggerMudo, now: () => Date.UTC(2026, 10, 5, 12), ...extra,
});

describe('ABIs mínimos', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const shared = (n) => resolve(here, '../../shared', `${n}.abi.json`);
  const leer = (ruta) => { const j = JSON.parse(readFileSync(ruta, 'utf8')); return new Interface(Array.isArray(j) ? j : j.abi); };
  const mismaFirma = (min, completo, nombre) => {
    const a = min.getEvent(nombre) ?? min.getFunction(nombre);
    const b = completo.getEvent(nombre) ?? completo.getFunction(nombre);
    assert.ok(b, `${nombre} no está en el ABI completo`);
    assert.equal(a.format('full'), b.format('full'), nombre);
  };

  test('GameItem.ItemMinted coincide con el ABI del servidor', () => {
    mismaFirma(iGame, leer(resolve(here, '../abi/GameItem.abi.json')), 'ItemMinted');
  });
  test('Mercado.ItemVendido coincide con shared/Mercado.abi.json (incluidos los indexed)', { skip: !existsSync(shared('Mercado')) }, () => {
    mismaFirma(iMerc, leer(shared('Mercado')), 'ItemVendido');
  });
  test('Recompensas coincide con shared/Recompensas.abi.json', { skip: !existsSync(shared('Recompensas')) && 'shared/Recompensas.abi.json aún no existe' }, () => {
    const completo = leer(shared('Recompensas'));
    for (const n of ['DiarioReclamado', 'Recompensado', 'recompensar']) mismaFirma(iRec, completo, n);
  });
  test('topics de los 4 eventos', () => {
    assert.equal(new Set(Object.values(TOPICS)).size, 4);
  });
});

describe('IndexadorRanking', () => {
  test('agrega las 4 categorías, ordena, top 20 y posición', async () => {
    const p = new ProviderFalso();
    p.mint(A, 0, 100); p.mint(A, 2, 101); p.mint(A, 2, 150); p.mint(B, 1, 120); p.mint(C, 0, 99); // C: antes del despliegue
    p.venta(B, 12.5, 130); p.venta(B, 7.5, 131); p.venta(A, 3, 140);
    p.diario(A, 3, 200); p.diario(A, 5, 201); p.diario(A, 1, 202); p.diario(B, 7, 203);
    for (let i = 0; i < 25; i++) p.mint(dir(i), 0, 300 + i);
    p.cabeza = 400;
    const r = crear(p);
    assert.equal(r.ranking().actualizado, null);
    await r.refrescar();
    const k = r.ranking();
    assert.equal(k.actualizado, '2026-11-05T12:00:00.000Z');
    assert.equal(k.bloque, 400);
    assert.equal(k.sincronizado, true);
    assert.deepEqual(Object.keys(k.categorias), CATEGORIAS);
    assert.deepEqual(k.categorias.objetos[0], { address: A, valor: 3 });
    assert.equal(k.categorias.objetos.length, 20);
    assert.deepEqual(k.categorias.legendarios, [{ address: A, valor: 2 }]);
    assert.deepEqual(k.categorias.oroVentas, [{ address: B, valor: 20 }, { address: A, valor: 3 }]);
    assert.deepEqual(k.categorias.rachaDiaria, [{ address: B, valor: 7 }, { address: A, valor: 5 }]);
    assert.ok(!k.categorias.objetos.some((x) => x.address === C));

    const pos = r.posicion(B.toLowerCase());
    assert.equal(pos.address, B);
    // Empates: por dirección ascendente (las 25 de prueba 0x00…01.. van antes que B)
    assert.deepEqual(pos.posiciones.objetos, { posicion: 27, valor: 1, participantes: 27 });
    assert.deepEqual(pos.posiciones.legendarios, { posicion: null, valor: 0, participantes: 1 });
    assert.deepEqual(pos.posiciones.oroVentas, { posicion: 1, valor: 20, participantes: 2 });
    const nadie = r.posicion(C);
    assert.ok(CATEGORIAS.every((c) => nadie.posiciones[c].posicion === null && nadie.posiciones[c].valor === 0));
  });

  test('refresco incremental: solo pide los bloques nuevos (más el solape) y no duplica', async () => {
    const p = new ProviderFalso();
    p.mint(A, 0, 105);
    p.cabeza = 200;
    const r = crear(p);
    await r.refrescar();
    p.mint(A, 0, 210);
    p.cabeza = 250;
    p.llamadas = [];
    await r.refrescar();
    assert.deepEqual(p.llamadas, [[191, 250]]); // 201 - solape(10)
    await r.refrescar();
    assert.equal(r.posicion(A).posiciones.objetos.valor, 2);
  });

  test('getLogs por tramos: respeta el tramo y lo parte si el RPC rechaza el rango', async () => {
    const p = new ProviderFalso();
    p.maxRango = 300;
    for (let b = 100; b <= 2000; b += 100) p.mint(A, 0, b);
    p.cabeza = 2000;
    const r = crear(p, { tramo: 1000, tramoMin: 10 });
    await r.refrescar();
    assert.equal(r.posicion(A).posiciones.objetos.valor, 20);
    const ok = p.llamadas.filter(([a, b]) => b - a + 1 <= 300);
    assert.ok(ok.every(([a, b], i) => i === 0 || a === ok[i - 1][1] + 1), 'tramos contiguos');
    assert.equal(ok[0][0], 100);
    assert.equal(ok.at(-1)[1], 2000);
    assert.ok(r.tramo <= 300);
  });

  test('límite de tramos por refresco: continúa en el siguiente', async () => {
    const p = new ProviderFalso();
    p.mint(A, 0, 1500);
    p.cabeza = 2000;
    const r = crear(p, { tramo: 100, maxTramosPorRefresco: 5 });
    await r.refrescar();
    assert.equal(r.siguiente, 600);
    assert.equal(r.sincronizado, false);
    assert.notEqual(r.ranking().actualizado, null); // se puede servir lo que hay
    for (let i = 0; i < 4; i++) await r.refrescar();
    assert.equal(r.sincronizado, true);
    assert.equal(r.posicion(A).posiciones.objetos.valor, 1);
  });

  test('errores transitorios se reintentan; si persisten, falla sin perder el progreso', async () => {
    const p = new ProviderFalso();
    p.mint(A, 0, 150);
    p.cabeza = 300;
    p.fallarVeces = 2;
    const r = crear(p, { tramo: 1000 });
    await r.refrescar();
    assert.equal(r.posicion(A).posiciones.objetos.valor, 1);

    p.mint(B, 0, 350);
    p.cabeza = 400;
    p.fallarVeces = 100;
    await assert.rejects(r.refrescar(), /getLogs falló/);
    assert.equal(r.siguiente, 301);           // lo ya indexado se conserva
    assert.equal(r.posicion(A).posiciones.objetos.valor, 1);
    p.fallarVeces = 0;
    await r.refrescar();
    assert.equal(r.posicion(B).posiciones.objetos.valor, 1);
  });

  test('RPC desfasado: cabeza por detrás de lo indexado → se ignora sin borrar nada', async () => {
    const p = new ProviderFalso();
    p.mint(A, 2, 150);
    p.cabeza = 300;
    const r = crear(p);
    await r.refrescar();
    const antes = r.ranking();
    p.cabeza = 250; // otro nodo del balanceador, más atrasado
    const res = await r.refrescar();
    assert.equal(res.desfasado, true);
    assert.deepEqual(r.ranking(), antes);
  });

  test('RPC desfasado: logs que faltaron en un refresco aparecen en el siguiente (solape) sin duplicar', async () => {
    const p = new ProviderFalso();
    p.mint(A, 0, 120);
    p.mint(A, 0, 295); // el nodo aún no lo "ve"
    p.cabeza = 300;
    p.retraso = 8;
    const r = crear(p);
    await r.refrescar();
    assert.equal(r.posicion(A).posiciones.objetos.valor, 1);
    p.retraso = 0;
    p.cabeza = 305;
    await r.refrescar();
    assert.equal(r.posicion(A).posiciones.objetos.valor, 2);
    await r.refrescar();
    assert.equal(r.posicion(A).posiciones.objetos.valor, 2);
  });

  test('margen: no indexa los últimos bloques', async () => {
    const p = new ProviderFalso();
    p.mint(A, 0, 199);
    p.cabeza = 200;
    const r = crear(p, { margen: 3 });
    await r.refrescar();
    assert.equal(r.siguiente, 198);
    assert.equal(r.posicion(A).posiciones.objetos.valor, 0);
    p.cabeza = 210;
    await r.refrescar();
    assert.equal(r.posicion(A).posiciones.objetos.valor, 1);
  });

  test('ignora logs removed, de otras direcciones, fuera de rango o corruptos', async () => {
    const p = new ProviderFalso();
    p.mint(A, 0, 150);
    p.logs.push({ ...p.logs[0], transactionHash: '0x01', removed: true });
    p.logs.push({ ...p.logs[0], transactionHash: '0x02', data: '0x1234' }); // no decodifica
    const otro = { ...p.logs[0], transactionHash: '0x03', address: MERCADO }; // ItemMinted desde otro contrato
    p.logs.push(otro);
    p.cabeza = 200;
    const r = crear(p);
    await r.refrescar();
    assert.equal(r.posicion(A).posiciones.objetos.valor, 1);
    assert.equal(r.descartados, 1);
  });

  test('refrescos simultáneos comparten la misma ejecución', async () => {
    const p = new ProviderFalso();
    p.cabeza = 200;
    const r = crear(p);
    await Promise.all([r.refrescar(), r.refrescar(), r.refrescar()]);
    assert.equal(p.llamadas.length, 1);
  });

  test('yaRecompensado lee los eventos Recompensado', async () => {
    const p = new ProviderFalso();
    p.recompensa(A, 'pase10@T1', 150);
    p.cabeza = 200;
    const r = crear(p);
    await r.refrescar();
    assert.equal(r.yaRecompensado(A.toLowerCase(), 'pase10@T1'), true);
    assert.equal(r.yaRecompensado(A, 'pase20@T1'), false);
    assert.equal(r.yaRecompensado(B, 'pase10@T1'), false);
  });

  test('iniciar/detener: refresca al arrancar y registra errores sin lanzar', async () => {
    const p = new ProviderFalso();
    p.cabeza = 200;
    const errores = [];
    const r = crear(p, { logger: { ...loggerMudo, error: (...a) => errores.push(a.join(' ')) } });
    p.getBlockNumber = async () => { throw new Error('caído'); };
    r.iniciar(1_000_000);
    await new Promise((ok) => setTimeout(ok, 10));
    r.detener();
    assert.match(errores[0], /caído/);
    assert.equal(r.ultimoError, 'caído');
  });
});
