// GET /tesoreria y configuración por red (fase E3 y E4). SIN RED: la lectura de la
// cadena se inyecta, así que no hace falta ni RPC ni contratos.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseEther, parseUnits } from 'ethers';
import { crearApp } from '../src/app.js';
import { Tesoreria, MOTIVO_SIN_QUEMADO } from '../src/tesoreria.js';
import {
  resolverRed, comprobarChainId, prefijoDeRed, normalizarRed, REDES,
  redDelEntorno, pareceRed, VAR_RED, VAR_RED_ANTIGUA, RED_POR_DEFECTO,
} from '../src/redes.js';
import { cargarConfig } from '../src/config.js';
import { levantar, loggerMudo } from './helpers.js';

const CONTRATO = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const MERCADO = '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9';
const ORO = '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9';
const DUENO = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

const CRUDO = {
  cajaEth: parseEther('1.25'),
  operadorEth: parseEther('0.054'),
  oroCirculacion: parseUnits('13500', 18),
  owner: DUENO,
};

const pedir = async (url, ruta) => {
  const r = await fetch(`${url}${ruta}`, { signal: AbortSignal.timeout(2000) });
  return { status: r.status, cache: r.headers.get('cache-control'), json: await r.json() };
};

// ─── Redes ────────────────────────────────────────────────────────────────────

describe('redes.js: la red es un parámetro, no Sepolia a fuego', () => {
  test('resuelve las redes conocidas con su chainId', () => {
    assert.equal(resolverRed('sepolia').chainId, 11155111);
    assert.equal(resolverRed('base-sepolia').chainId, 84532);
    assert.equal(resolverRed('arbitrum-sepolia').chainId, 421614);
    assert.equal(resolverRed('localhost').chainId, 31337);
  });

  test('normaliza mayúsculas, espacios y guiones bajos', () => {
    assert.equal(normalizarRed('  Base_Sepolia '), 'base-sepolia');
    assert.equal(resolverRed(' SEPOLIA ').clave, 'sepolia');
    assert.equal(resolverRed('Base Sepolia').chainId, 84532);
  });

  test('sin RED, la de por defecto es sepolia (no cambia nada de lo que había)', () => {
    assert.equal(resolverRed('').clave, 'sepolia');
    assert.equal(resolverRed(undefined).clave, 'sepolia');
  });

  test('una red desconocida se admite, pero avisa de que no puede comprobarse', () => {
    const r = resolverRed('mi-red-privada');
    assert.equal(r.conocida, false);
    assert.equal(r.chainId, null);
    assert.equal(comprobarChainId(r, 999), null, 'sin chainId conocido no se puede comprobar nada');

    const { config, errores, avisos } = cargarConfig({
      RPC_URL: 'http://127.0.0.1:8545',
      PRIVATE_KEY: `0x${'1'.repeat(64)}`,
      CONTRACT_ADDRESS: CONTRATO,
      RED: 'mi-red-privada',
    });
    assert.deepEqual(errores, [], 'no impide arrancar');
    assert.equal(config.red.clave, 'mi-red-privada');
    assert.ok(avisos.some((a) => a.includes('redes conocidas')));
  });

  test('si el nodo está en otra red, se detecta con un mensaje que lo explica', () => {
    const msg = comprobarChainId(resolverRed('sepolia'), 84532);
    assert.match(msg, /RED=sepolia esperaba chainId 11155111/);
    assert.match(msg, /Base Sepolia/, 'y dice en qué red está de verdad el nodo');
    assert.equal(comprobarChainId(resolverRed('sepolia'), 11155111), null, 'coincide: sin error');
  });

  test('el prefijo del almacén SIEMPRE lleva la red: dos redes no se mezclan', () => {
    const a = prefijoDeRed('loot-arena:', resolverRed('sepolia'));
    const b = prefijoDeRed('loot-arena:', resolverRed('base-sepolia'));
    assert.equal(a, 'loot-arena:sepolia:');
    assert.equal(b, 'loot-arena:base-sepolia:');
    assert.notEqual(a, b);
  });

  test('aunque alguien ponga el MISMO ALMACEN_PREFIJO en dos redes, siguen separadas', () => {
    const a = prefijoDeRed('mio', resolverRed('sepolia'));
    const b = prefijoDeRed('mio', resolverRed('localhost'));
    assert.equal(a, 'mio:sepolia:');
    assert.equal(b, 'mio:localhost:');
    assert.notEqual(a, b);
  });

  test('todas las redes conocidas tienen chainId distinto', () => {
    const ids = Object.values(REDES).map((r) => r.chainId);
    assert.equal(new Set(ids).size, ids.length);
  });
});

// ─── REGRESIÓN 14-nov-2026: `RED` choca con el color de la terminal ──────────
//
// `RED='\033[0;31m'` es el nombre que usan incontables scripts de shell para el rojo
// ANSI. Render lo tenía exportado, el servidor lo leyó como nombre de red y acabó con
// `"red":"\u001b[31m"` en /health. No era solo feo: dejó `conocida: false`, lo que
// DESACTIVÓ la comprobación de chainId, y metió el escape en las claves del almacén.
describe('REGRESIÓN: un valor imposible en RED no puede colarse como red', () => {
  const ANSI = '\u001b[31m';

  test('un código ANSI no se acepta como red: se cae a la de por defecto', () => {
    const r = resolverRed(ANSI);
    assert.equal(r.clave, RED_POR_DEFECTO);
    assert.equal(r.conocida, true, 'y vuelve a ser una red conocida…');
    assert.equal(r.chainId, 11155111, '…con su chainId');
    assert.ok(r.invalido, 'dejando constancia de lo que se rechazó');
  });

  test('y así la comprobación de chainId VUELVE a funcionar (era el peligro real)', () => {
    const r = resolverRed(ANSI);
    const msg = comprobarChainId(r, 84532);
    assert.ok(msg, 'antes devolvía null y pasaba cualquier red');
    assert.match(msg, /esperaba chainId 11155111/);
  });

  test('y el prefijo del almacén queda limpio, sin escapes', () => {
    const p = prefijoDeRed('loot-arena:', resolverRed(ANSI));
    assert.equal(p, 'loot-arena:sepolia:');
    assert.ok(!p.includes('\u001b'), 'en producción llegó a quedar "loot-arena:\\u001b[31m:"');
  });

  test('el aviso escapa el valor, para no "pintar" el log', () => {
    const { avisos } = cargarConfig({
      RPC_URL: 'http://127.0.0.1:8545',
      PRIVATE_KEY: `0x${'1'.repeat(64)}`,
      CONTRACT_ADDRESS: CONTRATO,
      RED: ANSI,
    });
    const aviso = avisos.find((a) => a.includes(VAR_RED_ANTIGUA));
    assert.ok(aviso, `falta el aviso: ${avisos.join(' | ')}`);
    assert.ok(!aviso.includes('\u001b'), 'el escape va escapado, no en crudo');
    assert.match(aviso, /color de la terminal/);
    assert.match(aviso, new RegExp(VAR_RED));
  });

  test('otros valores imposibles también se rechazan', () => {
    for (const v of [ANSI, '\u001b[0m', 'red\u0007', 'con espacio!', '#sepolia', '-empieza-mal', '\t\u001b[32m']) {
      const r = resolverRed(v);
      assert.equal(r.clave, RED_POR_DEFECTO, `debería rechazar ${JSON.stringify(v)}`);
      assert.ok(r.invalido);
    }
  });

  test('una red privada con nombre razonable SÍ se sigue aceptando', () => {
    const r = resolverRed('mi-red-2');
    assert.equal(r.clave, 'mi-red-2');
    assert.equal(r.conocida, false);
    assert.equal(r.invalido, undefined);
  });
});

describe('redDelEntorno: RED_BLOCKCHAIN manda, RED solo si tiene sentido', () => {
  const ANSI = '\u001b[31m';

  test('usa RED_BLOCKCHAIN cuando está', () => {
    const r = redDelEntorno({ RED_BLOCKCHAIN: 'base-sepolia', RED: ANSI });
    assert.equal(r.valor, 'base-sepolia');
    assert.equal(r.variable, VAR_RED);
  });

  test('acepta el RED antiguo si trae algo con pinta de red (no se rompe a nadie)', () => {
    const r = redDelEntorno({ RED: 'sepolia' });
    assert.equal(r.valor, 'sepolia');
    assert.equal(r.variable, VAR_RED_ANTIGUA);
  });

  test('IGNORA el RED antiguo si trae un color de terminal', () => {
    const r = redDelEntorno({ RED: ANSI });
    assert.equal(r.valor, '', 'no se usa');
    assert.equal(r.ignorado, ANSI, 'pero se deja constancia para avisar');
  });

  test('pareceRed distingue un nombre de un escape', () => {
    assert.equal(pareceRed('sepolia'), true);
    assert.equal(pareceRed('base-sepolia'), true);
    assert.equal(pareceRed(ANSI), false);
    assert.equal(pareceRed(''), false);
  });

  test('con el RED antiguo bien puesto, avisa de que está en desuso', () => {
    const { config, avisos } = cargarConfig({
      RPC_URL: 'http://127.0.0.1:8545',
      PRIVATE_KEY: `0x${'1'.repeat(64)}`,
      CONTRACT_ADDRESS: CONTRATO,
      RED: 'localhost',
    });
    assert.equal(config.red.clave, 'localhost', 'sigue funcionando');
    assert.ok(avisos.some((a) => a.includes('desuso')), avisos.join(' | '));
  });

  test('RED_BLOCKCHAIN bien puesta no genera ningún aviso de red', () => {
    const { config, avisos } = cargarConfig({
      RPC_URL: 'http://127.0.0.1:8545',
      PRIVATE_KEY: `0x${'1'.repeat(64)}`,
      CONTRACT_ADDRESS: CONTRATO,
      RED_BLOCKCHAIN: 'base-sepolia',
    });
    assert.equal(config.red.clave, 'base-sepolia');
    assert.equal(config.red.aviso, undefined);
    assert.ok(!avisos.some((a) => a.includes('red')), avisos.join(' | '));
  });
});

// ─── La clase Tesoreria ───────────────────────────────────────────────────────

describe('Tesoreria: caché y tolerancia a fallos del RPC', () => {
  const crear = (leer, extra = {}) => {
    let reloj = 1_000_000;
    const t = new Tesoreria({
      leer, now: () => reloj, logger: loggerMudo,
      red: resolverRed('sepolia'), contratos: { mercado: MERCADO, oro: ORO },
      ...extra,
    });
    return { t, avanzar: (ms) => { reloj += ms; } };
  };

  test('da formato legible a los valores crudos', async () => {
    const { t } = crear(async () => CRUDO);
    const r = await t.resumen();
    assert.equal(r.ok, true);
    assert.equal(r.datos.cajaEth, '1.25');
    assert.equal(r.datos.operadorEth, '0.054');
    assert.equal(r.datos.oroCirculacion, '13500.0');
    assert.equal(r.datos.owner, DUENO);
    assert.equal(r.datos.red, 'sepolia');
    assert.equal(r.datos.chainId, 11155111);
    assert.equal(r.datos.explorador, 'https://sepolia.etherscan.io');
  });

  test('dice cómo se saca el dinero y quién puede', async () => {
    const { t } = crear(async () => CRUDO);
    const { datos } = await t.resumen();
    assert.match(datos.retirada.funcion, /retirarEth/);
    assert.equal(datos.retirada.quienPuede, DUENO);
    assert.match(datos.retirada.nota, /Solo el owner/);
  });

  test('el oro quemado se declara no disponible, con el motivo, en vez de inventarlo', async () => {
    const { t } = crear(async () => CRUDO);
    const { datos } = await t.resumen();
    assert.equal(datos.oroQuemado, null);
    assert.equal(datos.motivoOroQuemado, MOTIVO_SIN_QUEMADO);
    assert.match(datos.motivoOroQuemado, /no lleva contador de quemado/);
  });

  test('cachea: no castiga el RPC en cada visita', async () => {
    let lecturas = 0;
    const { t, avanzar } = crear(async () => { lecturas++; return CRUDO; }, { cacheMs: 45_000 });
    await t.resumen();
    await t.resumen();
    await t.resumen();
    assert.equal(lecturas, 1, 'tres visitas, una sola lectura de la cadena');

    avanzar(46_000);
    await t.resumen();
    assert.equal(lecturas, 2, 'pasada la caché, vuelve a leer');
  });

  test('varias visitas a la vez comparten UNA sola lectura', async () => {
    let lecturas = 0;
    const { t } = crear(async () => {
      lecturas++;
      await new Promise((ok) => setTimeout(ok, 10));
      return CRUDO;
    });
    await Promise.all([t.resumen(), t.resumen(), t.resumen(), t.resumen()]);
    assert.equal(lecturas, 1);
  });

  test('si el RPC falla, sirve lo último que tenía diciendo que está obsoleto', async () => {
    let roto = false;
    const { t, avanzar } = crear(async () => {
      if (roto) throw new Error('RPC caído');
      return CRUDO;
    }, { cacheMs: 1000 });

    const bueno = await t.resumen();
    assert.equal(bueno.obsoleto, false);

    roto = true;
    avanzar(5000);
    const viejo = await t.resumen();
    assert.equal(viejo.ok, true, 'no rompe la sección Cadena de la web');
    assert.equal(viejo.obsoleto, true);
    assert.equal(viejo.datos.cajaEth, '1.25');
  });

  test('si el RPC falla y no hay nada cacheado, lo dice sin lanzar', async () => {
    const { t } = crear(async () => { throw new Error('RPC caído'); });
    const r = await t.resumen();
    assert.equal(r.ok, false);
    assert.match(r.error, /RPC caído/);
  });

  test('un dato demasiado viejo deja de servirse', async () => {
    let roto = false;
    const { t, avanzar } = crear(async () => {
      if (roto) throw new Error('RPC caído');
      return CRUDO;
    }, { cacheMs: 1000, maxObsoletoMs: 60_000 });
    await t.resumen();
    roto = true;
    avanzar(2 * 60_000);
    const r = await t.resumen();
    assert.equal(r.ok, false, 'mejor decir que no se sabe que dar una cifra de hace una hora');
  });

  test('cuando el RPC vuelve, se recupera solo', async () => {
    let roto = true;
    const { t, avanzar } = crear(async () => {
      if (roto) throw new Error('RPC caído');
      return CRUDO;
    }, { cacheMs: 1000 });
    assert.equal((await t.resumen()).ok, false);
    roto = false;
    avanzar(2000);
    const r = await t.resumen();
    assert.equal(r.ok, true);
    assert.equal(r.obsoleto, false);
    assert.equal(t.ultimoError, null);
  });
});

// ─── La ruta HTTP ─────────────────────────────────────────────────────────────

describe('GET /tesoreria', () => {
  const montar = async ({ leer = async () => CRUDO, tesoreria, ...extra } = {}) => levantar(crearApp({
    mint: async () => ({ tokenId: 1n, txHash: '0x' }),
    contractAddress: CONTRATO, chainId: 11155111, logger: loggerMudo,
    red: resolverRed('sepolia'),
    tesoreria: tesoreria === undefined
      ? new Tesoreria({ leer, logger: loggerMudo, red: resolverRed('sepolia'), contratos: { mercado: MERCADO, oro: ORO } })
      : tesoreria,
    ...extra,
  }));

  test('200 con el resumen y caché en el navegador', async () => {
    const srv = await montar();
    try {
      const { status, cache, json } = await pedir(srv.url, '/tesoreria');
      assert.equal(status, 200);
      assert.equal(cache, 'public, max-age=30');
      assert.equal(json.cajaEth, '1.25');
      assert.equal(json.oroCirculacion, '13500.0');
      assert.equal(json.owner, DUENO);
      assert.equal(json.contratos.mercado, MERCADO);
      assert.ok(json.actualizado, 'siempre dice de cuándo es el dato');
    } finally {
      await srv.cerrar();
    }
  });

  test('503 claro si el servidor no tiene las direcciones', async () => {
    const srv = await montar({ tesoreria: null, tesoreriaNoDisponible: 'Tesorería no disponible: falta ORO_ADDRESS' });
    try {
      const { status, json } = await pedir(srv.url, '/tesoreria');
      assert.equal(status, 503);
      assert.match(json.error, /ORO_ADDRESS/);
    } finally {
      await srv.cerrar();
    }
  });

  test('503 con Retry-After si el RPC falla y no hay nada cacheado', async () => {
    const srv = await montar({ leer: async () => { throw new Error('RPC caído'); } });
    try {
      const r = await fetch(`${srv.url}/tesoreria`, { signal: AbortSignal.timeout(2000) });
      assert.equal(r.status, 503);
      assert.equal(r.headers.get('retry-after'), '30');
      const json = await r.json();
      assert.match(json.detalle, /RPC caído/);
    } finally {
      await srv.cerrar();
    }
  });

  test('marca obsoleto: true cuando sirve un dato viejo', async () => {
    let roto = false;
    let reloj = 1_000_000;
    const tesoreria = new Tesoreria({
      leer: async () => { if (roto) throw new Error('caído'); return CRUDO; },
      now: () => reloj, cacheMs: 1000, logger: loggerMudo, red: resolverRed('sepolia'),
    });
    const srv = await montar({ tesoreria });
    try {
      assert.equal((await pedir(srv.url, '/tesoreria')).json.obsoleto, undefined);
      roto = true;
      reloj += 5000;
      const { status, json } = await pedir(srv.url, '/tesoreria');
      assert.equal(status, 200);
      assert.equal(json.obsoleto, true);
      assert.equal(json.cajaEth, '1.25');
    } finally {
      await srv.cerrar();
    }
  });

  test('CORS como el resto de endpoints', async () => {
    const srv = await montar();
    try {
      const r = await fetch(`${srv.url}/tesoreria`, {
        headers: { origin: 'https://cristiangarcia913.github.io' }, signal: AbortSignal.timeout(2000),
      });
      assert.equal(r.headers.get('access-control-allow-origin'), '*');
    } finally {
      await srv.cerrar();
    }
  });

  test('/health dice en qué red está el servidor', async () => {
    const srv = await montar();
    try {
      const { json } = await pedir(srv.url, '/health');
      assert.equal(json.red, 'sepolia');
      assert.equal(typeof json.red, 'string', 'la web puede leerlo como texto');
      assert.equal(json.redAviso, undefined, 'sin problemas, sin aviso');
    } finally {
      await srv.cerrar();
    }
  });

  // El bug del 14-nov-2026 asomaba por DOS sitios: /health y los cinco campos de red de
  // /tesoreria. Son el mismo objeto `config.red`, pero antes solo había test del primero,
  // así que el segundo se encontró en producción. Queda cubierto.
  test('los cinco campos de red de /tesoreria aguantan un RED imposible', async () => {
    const { config } = cargarConfig({
      RPC_URL: 'http://127.0.0.1:8545',
      PRIVATE_KEY: `0x${'1'.repeat(64)}`,
      CONTRACT_ADDRESS: CONTRATO,
      RED: '\u001b[31m',
    });
    const srv = await montar({
      red: config.red,
      tesoreria: new Tesoreria({
        leer: async () => CRUDO, logger: loggerMudo, red: config.red,
        contratos: { mercado: MERCADO, oro: ORO },
      }),
    });
    try {
      const { json } = await pedir(srv.url, '/tesoreria');
      // Antes salían: red y redNombre con el escape, chainId null, explorador null.
      assert.equal(json.red, 'sepolia');
      assert.equal(json.redNombre, 'Sepolia');
      assert.equal(json.chainId, 11155111, 'era null');
      assert.equal(json.moneda, 'SepoliaETH');
      assert.equal(json.explorador, 'https://sepolia.etherscan.io', 'era null');
      assert.ok(!JSON.stringify(json).includes('\u001b'), 'ningún campo lleva escapes');
      // Y lo que ya iba bien sigue bien.
      assert.equal(json.cajaEth, '1.25');
      assert.equal(json.owner, DUENO);
    } finally {
      await srv.cerrar();
    }
  });

  test('ningún campo derivado de la red se queda en null con una red conocida', async () => {
    const srv = await montar();
    try {
      const { json } = await pedir(srv.url, '/tesoreria');
      for (const campo of ['red', 'redNombre', 'chainId', 'moneda', 'explorador']) {
        assert.notEqual(json[campo], null, `${campo} no debería ser null`);
      }
    } finally {
      await srv.cerrar();
    }
  });

  test('un problema con la red se VE en /health, no solo en los logs', async () => {
    // La configuración que había en producción el 14-nov-2026.
    const { config } = cargarConfig({
      RPC_URL: 'http://127.0.0.1:8545',
      PRIVATE_KEY: `0x${'1'.repeat(64)}`,
      CONTRACT_ADDRESS: CONTRATO,
      RED: '\u001b[31m',
    });
    const srv = await montar({ red: config.red });
    try {
      const { json } = await pedir(srv.url, '/health');
      assert.equal(json.red, 'sepolia', 'ya no publica el escape ANSI');
      assert.ok(!JSON.stringify(json).includes('\u001b'), 'ni en ningún otro campo');
      assert.ok(json.redAviso, 'y dice que algo no cuadraba con la configuración de red');
      assert.match(json.redAviso, /color de la terminal/);
    } finally {
      await srv.cerrar();
    }
  });
});
