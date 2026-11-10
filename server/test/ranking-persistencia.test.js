// Persistencia del índice del ranking (1.4). SIN RED: provider simulado con logs
// codificados de verdad y `AlmacenMemoria` como almacén.
//
// Lo importante que se comprueba aquí:
//   - tras un reinicio NO se cuentan dos veces los eventos del solape;
//   - `GET /ranking` sirve desde el primer segundo en vez de dar 503 ~25 s;
//   - una instantánea de otro despliegue se rechaza (reindexa desde DEPLOY_BLOCK).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { Interface, parseUnits } from 'ethers';
import {
  IndexadorRanking, guardaSincronizando, VERSION_INSTANTANEA, BLOQUES_POR_GUARDADO,
} from '../src/ranking.js';
import { ABI_GAMEITEM_EVENTOS, ABI_MERCADO_EVENTOS, ABI_RECOMPENSAS } from '../src/abis.js';
import { AlmacenMemoria } from '../src/almacen.js';
import { conectar, conectarRegistros, CLAVES } from '../src/persistencia.js';
import { loggerMudo, levantar } from './helpers.js';

const GAME = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const MERCADO = '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9';
const RECOMP = '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9';
const A = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const B = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';

const iGame = new Interface(ABI_GAMEITEM_EVENTOS);
const iMerc = new Interface(ABI_MERCADO_EVENTOS);
const iRec = new Interface(ABI_RECOMPENSAS);

/** Provider simulado: guarda logs codificados de verdad y filtra como un nodo. */
class ProviderFalso {
  constructor() { this.logs = []; this.cabeza = 0; this.n = 0; this.llamadas = []; }
  async getBlockNumber() { return this.cabeza; }
  async getLogs({ address, topics, fromBlock, toBlock }) {
    this.llamadas.push([fromBlock, toBlock]);
    const dirs = address.map((x) => x.toLowerCase());
    return this.logs.filter((l) => l.blockNumber >= fromBlock && l.blockNumber <= toBlock
      && dirs.includes(l.address.toLowerCase()) && topics[0].includes(l.topics[0]));
  }
  _push(address, iface, evento, args, bloque) {
    const { data, topics } = iface.encodeEventLog(iface.getEvent(evento), args);
    const i = this.n++;
    this.logs.push({
      address, data, topics, blockNumber: bloque,
      transactionHash: `0x${i.toString(16).padStart(64, '0')}`, index: 0,
    });
  }
  mint(to, rareza, bloque) { this._push(GAME, iGame, 'ItemMinted', [to, BigInt(this.n), 'x', 'Espada', rareza, 1, 0], bloque); }
  venta(j, oro, bloque) { this._push(MERCADO, iMerc, 'ItemVendido', [j, 1n, parseUnits(String(oro), 18), 0n], bloque); }
  diario(j, racha, bloque) { this._push(RECOMP, iRec, 'DiarioReclamado', [j, 20397n, BigInt(racha), 10n, 0n], bloque); }
  recompensa(j, motivo, bloque) { this._push(RECOMP, iRec, 'Recompensado', [j, 1n, motivo], bloque); }
}

const RELOJ = Date.UTC(2026, 10, 6, 12);
const crear = (provider, extra = {}) => new IndexadorRanking({
  provider, gameItem: GAME, mercado: MERCADO, recompensas: RECOMP, deployBlock: 100,
  margen: 0, solape: 10, pausaMs: 0, logger: loggerMudo, now: () => RELOJ, ...extra,
});

/** Lo que de verdad importa de un índice, para comparar dos indexadores. */
const resumen = (r) => ({
  siguiente: r.siguiente,
  categorias: r.ranking().categorias,
  recompensados: [...r.recompensados].map(([a, s]) => [a, [...s].sort()]).sort(),
});

/** Mini app con el mismo guard y las mismas rutas que index.js + app.js. */
async function levantarRanking(r) {
  const app = express();
  app.use(guardaSincronizando(() => r));
  app.get('/ranking', (q, s) => s.json(r.ranking()));
  return levantar(app);
}

// ─── Ida y vuelta ─────────────────────────────────────────────────────────────

describe('IndexadorRanking: instantanea()/restaurar()', () => {
  test('el índice vuelve igual tras pasar por JSON', async () => {
    const p = new ProviderFalso();
    p.mint(A, 2, 110); p.mint(A, 0, 111); p.mint(B, 1, 112);
    p.venta(A, 250.5, 113);
    p.diario(B, 7, 114);
    p.recompensa(A, 'pase10@T1', 115);
    p.cabeza = 120;

    const antes = crear(p);
    await antes.refrescar();

    const despues = crear(new ProviderFalso());
    despues.restaurar(JSON.parse(JSON.stringify(antes.instantanea())));

    assert.deepEqual(resumen(despues), resumen(antes));
    assert.equal(despues.jugadores.get(A).oroVentas, parseUnits('250.5', 18), 'el bigint del ORO se recupera');
    assert.equal(despues.yaRecompensado(A, 'pase10@T1'), true, 'lo ya pagado on-chain se recuerda');
    assert.equal(despues.yaRecompensado(B, 'pase10@T1'), false);
  });

  test('restaurar deja el índice servible (listo) pero sin dar por sincronizado', () => {
    const r = crear(new ProviderFalso());
    assert.equal(r.listo(), false, 'un índice recién creado no es servible');
    r.restaurar({
      v: VERSION_INSTANTANEA, deployBlock: 100, dir: { gameItem: GAME, mercado: MERCADO, recompensas: RECOMP },
      siguiente: 500, actualizado: RELOJ, jugadores: [[A, 3, 1, '0', 0]], recompensados: [], vistos: [],
    });
    assert.equal(r.listo(), true, 'con índice restaurado sí: GET /ranking no da 503');
    assert.equal(r.restaurado, true);
    assert.equal(r.sincronizado, false, 'estar a la altura de la cabeza lo dirá el primer refresco');
    assert.equal(r.ranking().bloque, 499);
    assert.equal(r.ranking().actualizado, new Date(RELOJ).toISOString());
    assert.deepEqual(r.ranking().categorias.objetos, [{ address: A, valor: 3 }]);
  });

  test('restaurar reconstruye el orden de las categorías', () => {
    const r = crear(new ProviderFalso());
    r.restaurar({
      v: VERSION_INSTANTANEA, deployBlock: 100, dir: { gameItem: GAME, mercado: MERCADO, recompensas: RECOMP },
      siguiente: 200, actualizado: RELOJ,
      jugadores: [[A, 2, 0, '0', 0], [B, 9, 0, '0', 0]], recompensados: [], vistos: [],
    });
    assert.deepEqual(r.ranking().categorias.objetos, [{ address: B, valor: 9 }, { address: A, valor: 2 }]);
  });
});

// ─── Lo crítico: el solape no debe contar dos veces ──────────────────────────

describe('Reinicio: el solape no duplica eventos', () => {
  test('refrescar tras restaurar NO vuelve a sumar los eventos ya contados', async () => {
    const p = new ProviderFalso();
    // Varios eventos dentro de la ventana de solape (10 bloques antes de la cabeza).
    p.mint(A, 2, 112); p.mint(A, 1, 118); p.venta(A, 100, 119); p.diario(A, 5, 119);
    p.cabeza = 120;

    const antes = crear(p);
    await antes.refrescar();
    const esperado = resumen(antes);
    assert.equal(esperado.categorias.objetos[0].valor, 2);

    // Reinicio: índice nuevo, misma cadena, misma cabeza.
    const despues = crear(p);
    despues.restaurar(JSON.parse(JSON.stringify(antes.instantanea())));
    await despues.refrescar();

    assert.deepEqual(resumen(despues), esperado, 'los eventos del solape se descartan por (txHash, índice)');
    assert.equal(despues.jugadores.get(A).objetos, 2, 'ni un objeto de más');
    assert.equal(despues.jugadores.get(A).oroVentas, parseUnits('100', 18), 'ni un ORO de más');
    assert.equal(despues.jugadores.get(A).rachaDiaria, 5);
  });

  test('sin persistir `vistos`, sí se duplicarían (comprobación de que el test vale)', async () => {
    const p = new ProviderFalso();
    p.mint(A, 0, 118);
    p.cabeza = 120;
    const antes = crear(p);
    await antes.refrescar();

    const instantanea = JSON.parse(JSON.stringify(antes.instantanea()));
    assert.ok(instantanea.vistos.length > 0, 'la instantánea incluye los ids de log ya contados');
    instantanea.vistos = []; // simulamos no haberlos guardado
    const despues = crear(p);
    despues.restaurar(instantanea);
    await despues.refrescar();
    assert.equal(despues.jugadores.get(A).objetos, 2, 'sin `vistos` se contaría dos veces: por eso se guarda');
  });

  test('los eventos nuevos tras el reinicio sí se suman', async () => {
    const p = new ProviderFalso();
    p.mint(A, 0, 110);
    p.cabeza = 120;
    const antes = crear(p);
    await antes.refrescar();

    const despues = crear(p);
    despues.restaurar(JSON.parse(JSON.stringify(antes.instantanea())));
    p.mint(A, 2, 125);
    p.mint(B, 0, 126);
    p.cabeza = 130;
    await despues.refrescar();

    assert.equal(despues.jugadores.get(A).objetos, 2);
    assert.equal(despues.jugadores.get(A).legendarios, 1);
    assert.equal(despues.jugadores.get(B).objetos, 1);
    assert.equal(despues.sincronizado, true, 'tras el refresco ya se sabe que está a la altura');
  });

  test('solo se releen los bloques nuevos, no desde DEPLOY_BLOCK', async () => {
    const p = new ProviderFalso();
    p.cabeza = 40_000;
    const antes = crear(p);
    await antes.refrescar();

    const despues = crear(p);
    despues.restaurar(JSON.parse(JSON.stringify(antes.instantanea())));
    p.cabeza = 40_050;
    p.llamadas.length = 0;
    await despues.refrescar();

    assert.equal(p.llamadas.length, 1, 'una sola llamada a getLogs');
    const [desde] = p.llamadas[0];
    assert.equal(desde, 40_000 - 10 + 1, 'arranca en el solape, no en el bloque 100');
  });
});

// ─── Instantáneas que no se deben aplicar ────────────────────────────────────

describe('restaurar() rechaza instantáneas que no son de este despliegue', () => {
  const base = {
    v: VERSION_INSTANTANEA, deployBlock: 100,
    dir: { gameItem: GAME, mercado: MERCADO, recompensas: RECOMP },
    siguiente: 200, actualizado: RELOJ, jugadores: [], recompensados: [], vistos: [],
  };

  const casos = [
    ['otra versión del formato', { ...base, v: 99 }, /otra versión/],
    ['otro DEPLOY_BLOCK', { ...base, deployBlock: 7 }, /otro DEPLOY_BLOCK/],
    ['otro contrato GameItem', { ...base, dir: { ...base.dir, gameItem: B } }, /otro contrato gameItem/],
    ['otro contrato Mercado', { ...base, dir: { ...base.dir, mercado: B } }, /otro contrato mercado/],
    ['otro contrato Recompensas', { ...base, dir: { ...base.dir, recompensas: B } }, /otro contrato recompensas/],
    ['bloque anterior al despliegue', { ...base, siguiente: 50 }, /bloque inválido/],
    ['bloque que no es entero', { ...base, siguiente: 'ayer' }, /bloque inválido/],
    ['instantánea vacía', null, /vacía/],
  ];

  for (const [nombre, datos, patron] of casos) {
    test(nombre, () => {
      const r = crear(new ProviderFalso());
      assert.throws(() => r.restaurar(datos), patron);
    });
  }

  test('rechazada = se reindexa desde DEPLOY_BLOCK (el persistidor lo absorbe)', async () => {
    const almacen = new AlmacenMemoria();
    await almacen.escribir(CLAVES.ranking, { ...base, deployBlock: 7 });
    const p = new ProviderFalso();
    p.mint(A, 0, 110);
    p.cabeza = 120;
    const r = crear(p);

    const persistidor = await conectar({ almacen, registro: r, clave: CLAVES.ranking, logger: loggerMudo, retardoMs: 0 });
    assert.equal(persistidor.cargado, false, 'no se aplicó la instantánea ajena');
    assert.equal(r.restaurado, false);
    assert.equal(r.siguiente, 100, 'empieza en DEPLOY_BLOCK, como antes de la 1.4');
    await r.refrescar();
    assert.equal(r.jugadores.get(A).objetos, 1);
  });

  test('las filas sueltas con forma rara se ignoran, el resto se aplica', () => {
    const r = crear(new ProviderFalso());
    r.restaurar({
      ...base,
      jugadores: [
        [A, 3, 1, '5', 2],        // válida
        [B, -1, 0, '0', 0],       // contador negativo
        [B, 1, 0, 'muchísimo', 0], // ORO que no es un número
        [B, 1.5, 0, '0', 0],      // no entero
        ['no-es-direccion', 1, 0, '0', 0],
        ['corta'],
      ],
      recompensados: [[A, ['pase10@T1', 42]], ['mal', []], [B]],
      vistos: [['0xaa:0', 150], ['sin-bloque'], [7, 150]],
    });
    assert.equal(r.jugadores.size, 1);
    assert.equal(r.jugadores.get(A).objetos, 3);
    assert.equal(r.yaRecompensado(A, 'pase10@T1'), true);
    assert.equal(r.recompensados.get(A).size, 1, 'el motivo que no era texto se descarta');
    assert.equal(r.vistos.size, 1);
  });

  test('se respeta el máximo de jugadores (cota de memoria)', () => {
    const r = crear(new ProviderFalso(), { maxJugadores: 2 });
    r.restaurar({
      ...base,
      jugadores: [[A, 1, 0, '0', 0], [B, 1, 0, '0', 0], ['0x1111111111111111111111111111111111111111', 1, 0, '0', 0]],
    });
    assert.equal(r.jugadores.size, 2);
  });
});

// ─── Cuándo se guarda (consumo del plan gratuito) ────────────────────────────

describe('Cuándo se marca para guardar', () => {
  /** Indexador con un contador de veces que ha pedido guardar. */
  const conContador = (p, extra = {}) => {
    const marcas = { n: 0 };
    const r = crear(p, { alCambiar: () => { marcas.n += 1; }, ...extra });
    return { r, marcas };
  };

  test('un refresco con eventos nuevos pide guardar', async () => {
    const p = new ProviderFalso();
    p.mint(A, 0, 110);
    p.cabeza = 120;
    const { r, marcas } = conContador(p);
    await r.refrescar();
    assert.equal(marcas.n, 1);
  });

  test('refrescos sin eventos y con pocos bloques nuevos NO piden guardar', async () => {
    const p = new ProviderFalso();
    p.cabeza = 120;
    const { r, marcas } = conContador(p);
    await r.refrescar();
    assert.equal(marcas.n, 0, 'nada que guardar en el primer refresco vacío');
    for (let i = 1; i <= 5; i += 1) { p.cabeza += 10; await r.refrescar(); }
    assert.equal(marcas.n, 0, '50 bloques nuevos sin eventos: no gasta comandos');
  });

  test(`sin eventos, se guarda igual cada ${BLOQUES_POR_GUARDADO} bloques`, async () => {
    const p = new ProviderFalso();
    p.cabeza = 120;
    const { r, marcas } = conContador(p);
    await r.refrescar();
    p.cabeza += BLOQUES_POR_GUARDADO;
    await r.refrescar();
    assert.equal(marcas.n, 1, 'así un reinicio solo relee un tramo, no desde DEPLOY_BLOCK');
  });

  test('un nodo desfasado no pide guardar', async () => {
    const p = new ProviderFalso();
    p.cabeza = 200;
    const { r, marcas } = conContador(p);
    await r.refrescar();
    const antes = marcas.n;
    p.cabeza = 150; // el nodo dice que la cabeza está por detrás
    await r.refrescar();
    assert.equal(marcas.n, antes, 'no se ha tocado nada, no hay nada que guardar');
  });
});

// ─── Guarda de tamaño ─────────────────────────────────────────────────────────

describe('Tope de tamaño de la instantánea', () => {
  test('una instantánea demasiado grande no se guarda y lo dice', async () => {
    const p = new ProviderFalso();
    for (let i = 0; i < 20; i += 1) p.mint(`0x${(i + 1).toString(16).padStart(40, '0')}`, 0, 110 + i);
    p.cabeza = 200;
    const r = crear(p, { maxBytes: 200 });
    await r.refrescar();
    assert.throws(() => r.instantanea(), /ocupa \d+ bytes \(máximo 200\)/);
  });

  test('el persistidor absorbe ese error sin romper el ranking', async () => {
    const almacen = new AlmacenMemoria();
    const p = new ProviderFalso();
    p.mint(A, 0, 110);
    p.cabeza = 120;
    const r = crear(p, { maxBytes: 50 });
    const persistidor = await conectar({ almacen, registro: r, clave: CLAVES.ranking, logger: loggerMudo, retardoMs: 10_000 });
    await r.refrescar();
    await assert.doesNotReject(() => persistidor.vaciar());
    assert.equal(persistidor.guardados, 0);
    assert.equal(r.jugadores.get(A).objetos, 1, 'el ranking sigue funcionando');
  });
});

// ─── De punta a punta: lo que gana el jugador ────────────────────────────────

describe('De punta a punta: GET /ranking tras un reinicio', () => {
  test('con índice guardado responde 200 al instante, sin el 503 de "sincronizando"', async () => {
    const almacen = new AlmacenMemoria();
    const p = new ProviderFalso();
    p.mint(A, 2, 110); p.mint(A, 0, 111); p.mint(B, 0, 112);
    p.cabeza = 120;

    // ── Primera vida ──
    const antes = crear(p);
    const { vaciarTodo } = await conectarRegistros({
      almacen, registros: { ranking: antes }, logger: loggerMudo, retardoMs: 10_000,
    });
    await antes.refrescar();
    await vaciarTodo();

    // ── Render reinicia: índice nuevo, mismo almacén, sin refrescar todavía ──
    const despues = crear(p);
    await conectarRegistros({ almacen, registros: { ranking: despues }, logger: loggerMudo, retardoMs: 0 });

    const srv = await levantarRanking(despues);
    try {
      const r = await fetch(`${srv.url}/ranking`, { signal: AbortSignal.timeout(2000) });
      assert.equal(r.status, 200, 'antes de la 1.4 esto daba 503 durante ~25 s');
      const json = await r.json();
      assert.deepEqual(json.categorias.objetos, [{ address: A, valor: 2 }, { address: B, valor: 1 }]);
      assert.deepEqual(json.categorias.legendarios, [{ address: A, valor: 1 }]);
      assert.equal(json.bloque, 120);
      assert.equal(json.sincronizado, false, 'honesto: aún no se ha mirado la cabeza');
    } finally {
      await srv.cerrar();
    }
  });

  test('sin índice guardado sigue dando 503 con Retry-After (comportamiento anterior)', async () => {
    const r = crear(new ProviderFalso());
    const srv = await levantarRanking(r);
    try {
      const resp = await fetch(`${srv.url}/ranking`, { signal: AbortSignal.timeout(2000) });
      assert.equal(resp.status, 503);
      assert.equal(resp.headers.get('retry-after'), '5');
      assert.deepEqual(await resp.json(), { estado: 'sincronizando', bloqueActual: 99 });
    } finally {
      await srv.cerrar();
    }
  });
});
