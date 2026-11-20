import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crearApp } from '../src/app.js';
import {
  campoCsv, filaCsv, cabeceraCsv, validarEstrellas, normalizarSatisfaccion,
  asegurarCsv, anadirFilaSatisfaccion,
} from '../src/satisfaccion.js';
import { levantar, loggerMudo } from './helpers.js';

const CONTRATO = '0x5FbDB2315678afecb367f032d93F642f64180aa3';

describe('campoCsv / filaCsv / cabeceraCsv', () => {
  test('deja tal cual un campo sin caracteres especiales', () => {
    assert.equal(campoCsv('hola'), 'hola');
    assert.equal(campoCsv(5), '5');
    assert.equal(campoCsv(null), '');
    assert.equal(campoCsv(undefined), '');
  });
  test('entre comillas (y dobla las que ya lleve) si hay ";", \'"\' o salto de línea', () => {
    assert.equal(campoCsv('a;b'), '"a;b"');
    assert.equal(campoCsv('dijo "hola"'), '"dijo ""hola"""');
    assert.equal(campoCsv('línea1\nlínea2'), '"línea1\nlínea2"');
  });
  test('filaCsv une con ; y termina en CRLF', () => {
    assert.equal(filaCsv(['a', 'b;c', 3]), 'a;"b;c";3\r\n');
  });
  test('cabeceraCsv lleva el BOM UTF-8 delante', () => {
    assert.equal(cabeceraCsv()[0], '﻿');
    assert.match(cabeceraCsv(), /^﻿Fecha;Jugador;/);
  });
});

describe('validarEstrellas', () => {
  test('acepta enteros 1..5', () => {
    for (const v of [1, 2, 3, 4, 5]) assert.equal(validarEstrellas(v), v);
  });
  test('rechaza el resto', () => {
    for (const v of [0, 6, 2.5, '3', -1, NaN, undefined, null, true]) assert.equal(validarEstrellas(v), null);
  });
});

describe('normalizarSatisfaccion', () => {
  const ahora = () => 1_700_000_000_000;

  test('exige estrellas válidas', () => {
    const r = normalizarSatisfaccion({}, { now: ahora });
    assert.equal(r.ok, false);
    assert.match(r.error, /estrellas/);
  });

  test('con solo estrellas, rellena el resto con valores por defecto y la fecha de "ahora"', () => {
    const r = normalizarSatisfaccion({ estrellas: 4 }, { now: ahora });
    assert.equal(r.ok, true);
    assert.deepEqual(r.datos, {
      fecha: new Date(ahora()).toISOString(),
      jugador: 'Anónimo',
      nivel: '',
      rachaMax: '',
      estrellas: 4,
      emocionDominante: '',
      tensionMedia: '',
      tiempoMinutos: '',
      tags: '',
      comentario: '',
    });
  });

  test('acepta y normaliza una respuesta completa', () => {
    const r = normalizarSatisfaccion({
      fecha: '2024-01-01T00:00:00.000Z',
      jugador: '  Cristian  ',
      nivel: 12,
      rachaMax: 7,
      estrellas: 5,
      emocionDominante: 'Contento / Sorprendido',
      tensionMedia: 0.72,
      tiempoMinutos: 18.5,
      tags: ['🔥 Muy Adictivo', '🐉 Jefes Épicos'],
      comentario: 'Muy divertido,\ngran trabajo',
    }, { now: ahora });
    assert.equal(r.ok, true);
    assert.deepEqual(r.datos, {
      fecha: '2024-01-01T00:00:00.000Z',
      jugador: 'Cristian',
      nivel: 12,
      rachaMax: 7,
      estrellas: 5,
      emocionDominante: 'Contento / Sorprendido',
      tensionMedia: 0.72,
      tiempoMinutos: 18.5,
      tags: '🔥 Muy Adictivo, 🐉 Jefes Épicos',
      comentario: 'Muy divertido, gran trabajo',
    });
  });

  test('una fecha inválida se sustituye por la de "ahora"', () => {
    const r = normalizarSatisfaccion({ estrellas: 3, fecha: 'no-es-una-fecha' }, { now: ahora });
    assert.equal(r.datos.fecha, new Date(ahora()).toISOString());
  });

  test('rechaza nivel, rachaMax, tensionMedia y tiempoMinutos fuera de rango o con formato raro', () => {
    for (const campo of ['nivel', 'rachaMax', 'tensionMedia', 'tiempoMinutos']) {
      const r = normalizarSatisfaccion({ estrellas: 3, [campo]: 'no-es-un-numero' }, { now: ahora });
      assert.equal(r.ok, false, campo);
    }
    assert.equal(normalizarSatisfaccion({ estrellas: 3, tensionMedia: 1.5 }, { now: ahora }).ok, false);
    assert.equal(normalizarSatisfaccion({ estrellas: 3, tags: 'no-es-una-lista' }, { now: ahora }).ok, false);
  });

  test('recorta comentario largo y como mucho 10 etiquetas', () => {
    const r = normalizarSatisfaccion({
      estrellas: 3, comentario: 'x'.repeat(500), tags: Array.from({ length: 20 }, (_, i) => `tag${i}`),
    }, { now: ahora });
    assert.equal(r.datos.comentario.length, 300);
    assert.equal(r.datos.tags.split(', ').length, 10);
  });
});

describe('asegurarCsv / anadirFilaSatisfaccion (filesystem real, carpeta temporal)', () => {
  let dir, ruta;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'satisfaccion-'));
    ruta = join(dir, 'datos', 'satisfaccion_jugadores.csv');
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  test('crea la carpeta y el archivo con BOM + cabecera si no existe', async () => {
    await asegurarCsv(ruta);
    const txt = await readFile(ruta, 'utf8');
    assert.equal(txt, cabeceraCsv());
  });

  test('no toca el archivo (ni duplica la cabecera) si ya existe', async () => {
    await asegurarCsv(ruta);
    await asegurarCsv(ruta);
    const txt = await readFile(ruta, 'utf8');
    assert.equal(txt, cabeceraCsv());
  });

  test('anadirFilaSatisfaccion añade una fila nueva detrás de la cabecera', async () => {
    const r = normalizarSatisfaccion({ estrellas: 5, jugador: 'Ana' });
    await anadirFilaSatisfaccion(ruta, r.datos);
    const txt = await readFile(ruta, 'utf8');
    const lineas = txt.split('\r\n').filter(Boolean);
    assert.equal(lineas.length, 2);
    assert.match(lineas[1], /^.*;Ana;.*;5;/);
  });
});

describe('API HTTP: POST /api/satisfaccion y GET /api/satisfaccion/descargar', () => {
  let srv, dir, ruta, reloj;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'satisfaccion-app-'));
    ruta = join(dir, 'satisfaccion_jugadores.csv');
    reloj = 1_700_000_000_000;
    const app = crearApp({
      mint: async () => { throw new Error('no usado en este test'); },
      contractAddress: CONTRATO,
      chainId: 11155111,
      now: () => reloj,
      logger: loggerMudo,
      rutaSatisfaccionCsv: ruta,
    });
    srv = await levantar(app);
  });
  afterEach(async () => { await srv.cerrar(); await rm(dir, { recursive: true, force: true }); });

  test('POST con estrellas inválidas → 400', async () => {
    const r = await fetch(`${srv.url}/api/satisfaccion`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ estrellas: 9 }),
    });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /estrellas/);
  });

  test('POST válido → 200 ok, y queda escrito en el .csv', async () => {
    const r = await fetch(`${srv.url}/api/satisfaccion`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ estrellas: 5, jugador: 'Ana', nivel: 10, rachaMax: 3, tags: ['🔥 Muy Adictivo'] }),
    });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true });

    const txt = await readFile(ruta, 'utf8');
    assert.match(txt, /^﻿Fecha;Jugador;/);
    assert.match(txt, /;Ana;10;3;5;/);
  });

  test('GET /api/satisfaccion/descargar crea el archivo (con cabecera, BOM incluido) aunque nadie haya respondido aún', async () => {
    const r = await fetch(`${srv.url}/api/satisfaccion/descargar`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-disposition') ?? '', /satisfaccion_jugadores\.csv/);
    // `Response.text()` quita el BOM al decodificar: se comprueban los bytes crudos.
    const bytes = Buffer.from(await r.arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.match(bytes.toString('utf8'), /^﻿Fecha;Jugador;/);
  });

  test('GET /api/satisfaccion/descargar incluye las respuestas ya guardadas', async () => {
    await fetch(`${srv.url}/api/satisfaccion`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ estrellas: 2 }),
    });
    const r = await fetch(`${srv.url}/api/satisfaccion/descargar`);
    const txt = await r.text();
    const lineas = txt.split('\r\n').filter(Boolean);
    assert.equal(lineas.length, 2);
  });

  test('sin rutaSatisfaccionCsv, las rutas no se montan (404)', async () => {
    const app2 = crearApp({
      mint: async () => { throw new Error('no usado'); },
      contractAddress: CONTRATO, chainId: 11155111, now: () => reloj, logger: loggerMudo,
    });
    const srv2 = await levantar(app2);
    try {
      const r = await fetch(`${srv2.url}/api/satisfaccion/descargar`);
      assert.equal(r.status, 404);
    } finally {
      await srv2.cerrar();
    }
  });
});
