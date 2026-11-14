// Regresión de la 1.4.1: el ranking se quedaba en 503 PARA SIEMPRE. SIN RED.
//
// Qué pasó en producción (12-nov-2026), reproducido aquí con un provider simulado:
//   1. El RPC público poda su historia (~20 000 bloques). DEPLOY_BLOCK quedó a 46 000 de la
//      cabeza, así que `getLogs` devolvía `{"code":4444,"message":"pruned history unavailable"}`.
//   2. Ante un fallo, el indexador troceaba el rango... pero trocear mueve el FINAL, y lo que
//      estorbaba era el PRINCIPIO: los 8 reintentos salían todos del mismo bloque y fallaban.
//   3. Al agotarlos, `_refrescar` lanzaba ANTES de poner `actualizado`, así que `listo()` se
//      quedaba en false y el guard devolvía 503 eternamente, con datos buenos ya indexados.
//
// Los tests de abajo fijan las tres cosas para que no vuelva a pasar en silencio.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { Interface } from 'ethers';
import { IndexadorRanking, guardaSincronizando, esHistoriaPodada } from '../src/ranking.js';
import { ABI_GAMEITEM_EVENTOS } from '../src/abis.js';
import { crearApp } from '../src/app.js';
import { levantar, loggerMudo } from './helpers.js';

const GAME = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const MERCADO = '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9';
const RECOMP = '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9';
const A = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const iGame = new Interface(ABI_GAMEITEM_EVENTOS);

/** Error tal y como lo devuelve ethers cuando el nodo ha podado su historia. */
const errorPodado = () => Object.assign(new Error('could not coalesce error'), {
  code: 'UNKNOWN_ERROR',
  error: { code: 4444, message: 'pruned history unavailable' },
});
const errorPasajero = () => Object.assign(new Error('timeout'), { code: 'TIMEOUT' });

const logMint = (to, bloque, i) => {
  const { data, topics } = iGame.encodeEventLog(iGame.getEvent('ItemMinted'), [to, BigInt(i), 'x', 'Espada', 0, 1, 0]);
  return { address: GAME, data, topics, blockNumber: bloque, transactionHash: `0x${i.toString(16).padStart(64, '0')}`, index: 0 };
};

const DEPLOY = 1_000_000;
let reloj = Date.UTC(2026, 10, 12, 12);
const crear = (provider, extra = {}) => new IndexadorRanking({
  provider, gameItem: GAME, mercado: MERCADO, recompensas: RECOMP, deployBlock: DEPLOY,
  margen: 0, solape: 10, pausaMs: 0, logger: loggerMudo, now: () => reloj, ...extra,
});

// ─── El clasificador de errores ───────────────────────────────────────────────

describe('esHistoriaPodada', () => {
  test('reconoce el código 4444 y los mensajes habituales', () => {
    assert.equal(esHistoriaPodada(errorPodado()), true);
    for (const m of ['pruned history unavailable', 'missing trie node', 'state unavailable',
      'block not found', 'requested block is older than', 'not available on this node']) {
      assert.equal(esHistoriaPodada(new Error(m)), true, m);
    }
  });

  test('no confunde un error pasajero con historia podada', () => {
    for (const e of [errorPasajero(), new Error('query exceeds max block range'),
      new Error('rate limit exceeded'), new Error('ECONNRESET'), null, undefined]) {
      assert.equal(esHistoriaPodada(e), false, String(e?.message));
    }
  });
});

// ─── La regresión: progreso parcial debe ser servible ─────────────────────────

describe('REGRESIÓN: un refresco que falla no puede dejar el ranking en 503 para siempre', () => {
  /**
   * Provider que sirve bien los primeros `tramosOk` tramos y luego falla siempre.
   * Es el caso real: algunos backends del RPC tenían la historia y otros no.
   */
  const providerAMedias = (tramosOk, cabeza) => {
    let servidos = 0;
    return {
      getBlockNumber: async () => cabeza,
      getLogs: async ({ fromBlock }) => {
        if (servidos >= tramosOk) throw errorPasajero();
        servidos++;
        return [logMint(A, fromBlock, servidos)];
      },
    };
  };

  test('tras lanzar, el índice conserva el progreso Y es servible', async () => {
    const r = crear(providerAMedias(3, DEPLOY + 500_000), { tramo: 10_000 });
    await assert.rejects(() => r.refrescar(), /getLogs falló/);

    assert.ok(r.siguiente > DEPLOY, 'el progreso de los tramos buenos no se tira');
    assert.equal(r.listo(), true, 'ESTA es la regresión: antes se quedaba en false para siempre');
    assert.equal(r.sincronizado, false, 'y es honesto: no ha llegado a la cabeza');
    assert.equal(r.ranking().categorias.objetos[0].valor, 3, 'sirve lo que sí indexó');
    assert.equal(r.estado().ultimoError, 'timeout');
  });

  test('GET /ranking responde 200 con datos parciales en vez de 503', async () => {
    const r = crear(providerAMedias(2, DEPLOY + 500_000), { tramo: 10_000 });
    await assert.rejects(() => r.refrescar());

    const app = express();
    app.use(guardaSincronizando(() => r));
    app.get('/ranking', (q, s) => s.json(r.ranking()));
    const srv = await levantar(app);
    try {
      const resp = await fetch(`${srv.url}/ranking`, { signal: AbortSignal.timeout(2000) });
      assert.equal(resp.status, 200, 'antes de la 1.4.1 esto era un 503 permanente');
      const json = await resp.json();
      assert.equal(json.sincronizado, false);
      assert.equal(json.categorias.objetos[0].valor, 2);
    } finally {
      await srv.cerrar();
    }
  });

  test('si no se llegó a indexar NADA, sigue dando 503 (no se inventa un ranking vacío)', async () => {
    const r = crear(providerAMedias(0, DEPLOY + 500_000), { tramo: 10_000 });
    await assert.rejects(() => r.refrescar());
    assert.equal(r.listo(), false);
    assert.equal(r.estado().atascado, true, 'y se marca como atascado');
  });
});

// ─── Historia podada: saltar hacia delante en vez de trocear ──────────────────

describe('Historia podada: el indexador salta hasta donde el nodo sí tiene datos', () => {
  /** Nodo que solo conserva los últimos `retencion` bloques. */
  const providerPodado = (cabeza, retencion) => {
    const llamadas = [];
    return {
      llamadas,
      getBlockNumber: async () => cabeza,
      getLogs: async ({ fromBlock, toBlock }) => {
        llamadas.push([fromBlock, toBlock]);
        if (fromBlock < cabeza - retencion) throw errorPodado();
        return [logMint(A, fromBlock, llamadas.length)];
      },
    };
  };

  test('converge, sirve el ranking y NO agota los reintentos', async () => {
    const cabeza = DEPLOY + 46_000;
    const p = providerPodado(cabeza, 20_000);
    const r = crear(p, { tramo: 50_000 });

    const res = await r.refrescar();
    assert.equal(res.desfasado, false);
    assert.equal(r.listo(), true);
    assert.equal(r.sincronizado, true, 'llega hasta la cabeza');
    assert.ok(r.huecos.length > 0, 'y deja constancia de lo que no pudo leer');
    assert.ok(p.llamadas.length < 12, `converge rápido (${p.llamadas.length} llamadas)`);
  });

  test('cada salto mueve el PRINCIPIO del rango, que es lo que fallaba', async () => {
    const cabeza = DEPLOY + 46_000;
    const p = providerPodado(cabeza, 20_000);
    await crear(p, { tramo: 50_000 }).refrescar();

    const principios = [...new Set(p.llamadas.map(([desde]) => desde))];
    assert.ok(principios.length >= 3,
      `el bloque inicial avanza (${principios.length} distintos); antes se repetía 8 veces el mismo`);
    for (let i = 1; i < principios.length; i += 1) {
      assert.ok(principios[i] > principios[i - 1], 'y siempre hacia delante');
    }
  });

  test('reintenta antes de rendirse (un backend puede sí tener la historia)', async () => {
    let fallosDados = 0;
    const p = {
      getBlockNumber: async () => DEPLOY + 1000,
      getLogs: async ({ fromBlock }) => {
        if (fallosDados === 0) { fallosDados++; throw errorPodado(); }
        return [logMint(A, fromBlock, 1)];
      },
    };
    const r = crear(p, { maxFallosHistoria: 2 });
    await r.refrescar();
    assert.deepEqual(r.huecos, [], 'un fallo suelto no debe provocar un salto ni perder historia');
    assert.equal(r.sincronizado, true);
  });

  test('el hueco se publica en /ranking y en estado(), no se esconde', async () => {
    const cabeza = DEPLOY + 46_000;
    const r = crear(providerPodado(cabeza, 20_000), { tramo: 50_000 });
    await r.refrescar();

    const rk = r.ranking();
    assert.equal(rk.incompleto, true);
    assert.ok(rk.desdeBloque > DEPLOY, 'dice desde qué bloque es fiable');
    assert.ok(rk.bloquesSinHistoria > 0);

    const e = r.estado();
    assert.equal(e.incompleto, true);
    assert.match(e.motivoIncompleto, /podado la historia/);
    assert.equal(r.posicion(A).incompleto, true, 'también en /ranking/:address');
  });

  test('un índice completo NO lleva la marca de incompleto', async () => {
    const r = crear(providerPodado(DEPLOY + 1000, 1_000_000), { tramo: 50_000 });
    await r.refrescar();
    assert.equal(r.ranking().incompleto, undefined);
    assert.equal(r.estado().incompleto, undefined);
  });

  test('los huecos sobreviven al reinicio (instantánea)', async () => {
    const cabeza = DEPLOY + 46_000;
    const antes = crear(providerPodado(cabeza, 20_000), { tramo: 50_000 });
    await antes.refrescar();

    const despues = crear(providerPodado(cabeza, 20_000), { tramo: 50_000 });
    despues.restaurar(JSON.parse(JSON.stringify(antes.instantanea())));
    assert.deepEqual(despues.huecos, antes.huecos);
    assert.equal(despues.bloquesSinHistoria, antes.bloquesSinHistoria);
    assert.equal(despues.ranking().incompleto, true);
    assert.equal(despues.ranking().desdeBloque, antes.primerBloqueIndexado);
  });
});

// ─── Lo que pidió el encargo: detectar «no avanza entre dos refrescos» ────────

describe('Detección de atasco: el índice no avanza entre dos refrescos', () => {
  /** Provider que siempre falla: el indexado no puede avanzar. */
  const providerMuerto = (cabeza) => ({
    getBlockNumber: async () => cabeza,
    getLogs: async () => { throw errorPasajero(); },
  });

  test('dos refrescos sin avanzar → atascado:true con el bloque y el error', async () => {
    const r = crear(providerMuerto(DEPLOY + 50_000));
    const bloqueInicial = r.estado().bloque;

    await assert.rejects(() => r.refrescar());
    reloj += 60_000;
    await assert.rejects(() => r.refrescar());

    const e = r.estado();
    assert.equal(e.bloque, bloqueInicial, 'el bloque es el mismo: no ha avanzado');
    assert.equal(e.atascado, true, 'y el servidor lo dice en vez de callarse');
    assert.equal(e.refrescosFallidos, 2);
    assert.equal(e.ultimoError, 'timeout');
    assert.ok(e.pendientes > 0, 'y cuántos bloques le faltan');
  });

  test('en cuanto avanza, deja de estar atascado y se olvida el error', async () => {
    let roto = true;
    const p = {
      getBlockNumber: async () => DEPLOY + 1000,
      getLogs: async ({ fromBlock }) => {
        if (roto) throw errorPasajero();
        return [logMint(A, fromBlock, 1)];
      },
    };
    const r = crear(p);
    await assert.rejects(() => r.refrescar());
    reloj += 60_000;
    await assert.rejects(() => r.refrescar());
    assert.equal(r.estado().atascado, true);

    roto = false;
    reloj += 60_000;
    await r.refrescar();
    const e = r.estado();
    assert.equal(e.atascado, false);
    assert.equal(e.refrescosFallidos, undefined);
    assert.equal(e.ultimoError, undefined);
    assert.equal(e.sincronizado, true);
  });

  test('indexado al día pero parado mucho rato NO es atasco (no hay nada que indexar)', async () => {
    const p = { getBlockNumber: async () => DEPLOY + 100, getLogs: async () => [] };
    const r = crear(p);
    await r.refrescar();
    reloj += 60 * 60 * 1000; // una hora sin eventos
    assert.equal(r.estado().atascado, false, 'sincronizado = sano, aunque no se mueva');
  });

  test('avanzar hace tiempo y quedarse parado por debajo de la cabeza SÍ es atasco', async () => {
    let permitir = 1;
    const p = {
      getBlockNumber: async () => DEPLOY + 500_000,
      getLogs: async ({ fromBlock }) => {
        if (permitir-- <= 0) throw errorPasajero();
        return [logMint(A, fromBlock, 1)];
      },
    };
    const r = crear(p, { tramo: 10_000, umbralAtascoMs: 5 * 60 * 1000 });
    await assert.rejects(() => r.refrescar());
    assert.equal(r.listo(), true, 'sirve lo poco que tiene');
    assert.equal(r.estado().atascado, false, 'acaba de avanzar: todavía no es atasco');

    reloj += 10 * 60 * 1000; // diez minutos sin moverse
    assert.equal(r.estado().atascado, true);
    assert.ok(r.estado().segundosSinAvanzar >= 600);
  });

  test('un nodo desfasado no cuenta como refresco fallido', async () => {
    const p = { getBlockNumber: async () => DEPLOY + 1000, getLogs: async () => [] };
    const r = crear(p);
    await r.refrescar();
    p.getBlockNumber = async () => DEPLOY + 500; // el nodo retrocede
    const res = await r.refrescar();
    assert.equal(res.desfasado, true);
    assert.equal(r.estado().atascado, false);
  });

  test('si getBlockNumber falla, también se anota (no se pierde el error)', async () => {
    const r = crear({
      getBlockNumber: async () => { throw new Error('ECONNREFUSED'); },
      getLogs: async () => [],
    });
    await assert.rejects(() => r.refrescar(), /ECONNREFUSED/);
    assert.equal(r.estado().ultimoError, 'ECONNREFUSED');
    assert.equal(r.estado().refrescosFallidos, 1);
  });
});

// ─── Visible desde fuera: GET /health ─────────────────────────────────────────

describe('GET /health publica cómo va el indexado', () => {
  test('un indexador atascado se ve en /health sin leer los logs', async () => {
    const r = crear({
      getBlockNumber: async () => DEPLOY + 50_000,
      getLogs: async () => { throw errorPasajero(); },
    });
    await assert.rejects(() => r.refrescar());
    reloj += 60_000;
    await assert.rejects(() => r.refrescar());

    const srv = await levantar(crearApp({
      mint: async () => ({ tokenId: 1n, txHash: '0x' }),
      contractAddress: GAME, chainId: 11155111, logger: loggerMudo, ranking: r,
    }));
    try {
      const { status, json } = await fetch(`${srv.url}/health`, { signal: AbortSignal.timeout(2000) })
        .then(async (resp) => ({ status: resp.status, json: await resp.json() }));
      assert.equal(status, 200, '/health nunca se cae por el indexador');
      assert.equal(json.ok, true);
      assert.equal(json.indexador.atascado, true);
      assert.equal(json.indexador.sincronizado, false);
      assert.equal(json.indexador.ultimoError, 'timeout');
      assert.ok(json.indexador.pendientes > 0);
    } finally {
      await srv.cerrar();
    }
  });

  test('sin ranking configurado, /health no inventa el campo', async () => {
    const srv = await levantar(crearApp({
      mint: async () => ({ tokenId: 1n, txHash: '0x' }),
      contractAddress: GAME, chainId: 11155111, logger: loggerMudo,
    }));
    try {
      const json = await fetch(`${srv.url}/health`, { signal: AbortSignal.timeout(2000) }).then((r) => r.json());
      assert.equal(json.indexador, undefined);
    } finally {
      await srv.cerrar();
    }
  });
});
