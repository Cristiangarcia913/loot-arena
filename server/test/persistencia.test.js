// Tests de la persistencia (1.4). SIN RED: se usa `AlmacenMemoria` como almacén
// "externo" y un almacén falso para los casos de fallo.
//
// Lo que se comprueba:
//   1. cada registro sabe hacer su instantánea y recuperarla (ida y vuelta);
//   2. el guardado se agrupa (no una escritura por cambio);
//   3. un almacén roto no rompe el registro ni las rutas;
//   4. basura en el almacén se ignora en vez de tumbar el arranque.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseEther } from 'ethers';
import { AlmacenMemoria, EstadoAlmacen } from '../src/almacen.js';
import { Persistidor, conectar, conectarRegistros, CLAVES } from '../src/persistencia.js';
import { RegistroDiario, diaUtc } from '../src/recompensa.js';
import { RegistroGas, CANTIDAD_GAS } from '../src/gas.js';
import { RegistroTorre } from '../src/torre.js';
import { EstadoBotin, RegistroPrimerBotin, RAREZA } from '../src/loot.js';
import { loggerMudo } from './helpers.js';

/** Almacén que falla siempre (para probar la degradación en caliente). */
const almacenRoto = (mensaje = 'Upstash no está accesible') => ({
  leer: async () => { throw new Error(mensaje); },
  escribir: async () => { throw new Error(mensaje); },
  borrar: async () => { throw new Error(mensaje); },
});

/** Almacén que devuelve un valor fijo al leer y no deja escribir. */
const almacenConDatos = (valor) => ({
  leer: async () => valor,
  escribir: async () => {},
  borrar: async () => {},
});

const DIR_A = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const DIR_B = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';

// ─── Ida y vuelta de cada registro ────────────────────────────────────────────

describe('instantanea()/restaurar() de cada registro', () => {
  test('RegistroDiario: racha y día del último reclamo sobreviven', () => {
    const a = new RegistroDiario();
    a.registrar(DIR_A, 3, '2026-11-06');
    a.registrar(DIR_B, 1, '2026-11-05');

    const b = new RegistroDiario();
    b.restaurar(JSON.parse(JSON.stringify(a.instantanea())));

    const ahora = Date.parse('2026-11-07T10:00:00Z');
    // La racha de A sigue viva (reclamó ayer): el próximo reclamo es el día 4.
    assert.deepEqual(b.estado(DIR_A, ahora), a.estado(DIR_A, ahora));
    assert.equal(b.estado(DIR_A, ahora).racha, 3);
    assert.equal(b.estado(DIR_A, ahora).dia, 4);
    // La de B se rompió (hace dos días): vuelve al día 1.
    assert.equal(b.estado(DIR_B, ahora).racha, 0);
  });

  test('RegistroDiario: "ya has reclamado hoy" sobrevive al reinicio', () => {
    const ahora = Date.parse('2026-11-06T23:59:00Z');
    const a = new RegistroDiario();
    a.registrar(DIR_A, 1, diaUtc(ahora));
    assert.equal(a.estado(DIR_A, ahora).puedeReclamar, false);

    const b = new RegistroDiario();
    b.restaurar(a.instantanea());
    assert.equal(b.estado(DIR_A, ahora).puedeReclamar, false);
    assert.ok(b.estado(DIR_A, ahora).proximoEn > 0);
  });

  test('RegistroPrimerBotin: lo entregado sobrevive; lo "en curso" no', () => {
    const a = new RegistroPrimerBotin();
    assert.equal(a.reservar(DIR_A), true);
    a.confirmar(DIR_A);
    assert.equal(a.reservar(DIR_B), true); // queda en curso, sin confirmar

    const b = new RegistroPrimerBotin();
    b.restaurar(a.instantanea());
    assert.equal(b.yaEntregado(DIR_A), true);
    assert.equal(b.reservar(DIR_A), false, 'A no debe cobrar otro primer botín');
    assert.equal(b.reservar(DIR_B), true, 'B no llegó a confirmar: le toca');
  });

  test('RegistroGas: tope diario y direcciones del día sobreviven', () => {
    const ahora = Date.parse('2026-11-06T12:00:00Z');
    const a = new RegistroGas({ topeDiario: CANTIDAD_GAS * 2n });
    assert.equal(a.reservar(DIR_A, ahora).ok, true);

    const b = new RegistroGas({ topeDiario: CANTIDAD_GAS * 2n });
    b.restaurar(JSON.parse(JSON.stringify(a.instantanea())));
    assert.equal(b.yaPedido(DIR_A, ahora), true, 'A ya pidió hoy');
    assert.equal(b.totalHoy, CANTIDAD_GAS, 'el bigint se recupera bien');
    assert.equal(b.reservar(DIR_A, ahora).motivo, 'duplicado');
    assert.equal(b.reservar(DIR_B, ahora).ok, true);
    // Y con eso se llena el tope: el tercero ya no entra.
    assert.equal(b.hayCupo(ahora), false);
  });

  test('RegistroGas: una instantánea de otro día no arrastra el tope viejo', () => {
    const ayer = Date.parse('2026-11-05T12:00:00Z');
    const hoy = Date.parse('2026-11-06T12:00:00Z');
    const a = new RegistroGas();
    a.reservar(DIR_A, ayer);

    const b = new RegistroGas();
    b.restaurar(a.instantanea());
    assert.equal(b.yaPedido(DIR_A, hoy), false, 'al cambiar de día se vacía');
    assert.equal(b.totalHoy, 0n);
  });

  test('RegistroTorre: récords y orden del ranking sobreviven', () => {
    let t = 1000;
    const a = new RegistroTorre({ now: () => t++ });
    for (let piso = 1; piso <= 5; piso += 1) a.registrar(DIR_A, piso, piso * 3);
    for (let piso = 1; piso <= 5; piso += 1) a.registrar(DIR_B, piso, piso * 2);

    const b = new RegistroTorre({ now: () => t++ });
    b.restaurar(JSON.parse(JSON.stringify(a.instantanea())));
    assert.equal(b.record(DIR_A), 5);
    assert.deepEqual(b.ranking(), a.ranking());
    // A igual piso gana quien usó menos turnos: B va primero.
    assert.equal(b.ranking()[0].address, DIR_B);
    // Y la defensa antitrampas sigue en pie tras el reinicio.
    assert.deepEqual(b.registrar(DIR_A, 99, 1), { ok: false, maximo: 6 });
  });

  test('EstadoBotin: pity y último legendario sobreviven', () => {
    const a = new EstadoBotin();
    for (let i = 0; i < 7; i += 1) a.registrar(DIR_A, { rareza: RAREZA.COMUN, nombre: 'Daga' });
    a.registrar(DIR_B, { rareza: RAREZA.LEGENDARIO, nombre: 'Mandoble del Alba' });

    const b = new EstadoBotin();
    b.restaurar(JSON.parse(JSON.stringify(a.instantanea())));
    assert.equal(b.sinLegendario(DIR_A), 7);
    assert.equal(b.ultimoLegendario, 'Mandoble del Alba');
    assert.deepEqual(b.opciones(DIR_A), a.opciones(DIR_A));
  });
});

// ─── restaurar() aguanta basura ───────────────────────────────────────────────

describe('restaurar() ignora datos inservibles en vez de fallar', () => {
  const casos = [
    ['RegistroDiario', () => new RegistroDiario(), (r) => r.reg.size],
    ['RegistroPrimerBotin', () => new RegistroPrimerBotin(), (r) => r.entregados.size],
    ['RegistroGas', () => new RegistroGas(), (r) => r.direcciones.size],
    ['RegistroTorre', () => new RegistroTorre(), (r) => r.records.size],
    ['EstadoBotin', () => new EstadoBotin(), (r) => r.contadores.size],
  ];

  for (const [nombre, crear, tamano] of casos) {
    test(`${nombre} con null/undefined/string/número/forma rara`, () => {
      for (const basura of [null, undefined, 'hola', 42, [], {}, { v: 1 }, { reg: 'no-array' }, { records: [[1, 2]] }]) {
        const r = crear();
        assert.doesNotThrow(() => r.restaurar(basura), `${nombre} con ${JSON.stringify(basura)}`);
        assert.equal(tamano(r), 0);
      }
    });
  }

  test('RegistroDiario descarta filas con fecha o racha inválidas', () => {
    const r = new RegistroDiario();
    r.restaurar({ v: 1, reg: [
      [DIR_A, 2, '2026-11-06'],      // válida
      [DIR_B, 2, 'ayer'],            // fecha mala
      [DIR_B, -1, '2026-11-06'],     // racha negativa
      [42, 1, '2026-11-06'],         // dirección no string
      ['solo-dos', 1],               // fila corta
    ] });
    assert.equal(r.reg.size, 1);
    assert.equal(r.estado(DIR_A, Date.parse('2026-11-06T00:00:00Z')).racha, 2);
  });

  test('RegistroTorre descarta pisos y turnos fuera de rango', () => {
    const r = new RegistroTorre();
    r.restaurar({ v: 1, records: [
      [DIR_A, 7, 20, 1000],          // válida
      [DIR_B, -1, 20, 1000],         // piso negativo
      [DIR_B, 1e9, 20, 1000],        // piso enorme
      [DIR_B, 3, 2.5, 1000],         // turnos no entero
      [DIR_B, 3, 20, 'ayer'],        // marca de tiempo mala
    ] });
    assert.equal(r.records.size, 1);
    assert.equal(r.record(DIR_A), 7);
  });

  test('RegistroGas descarta un totalHoy que no es un número entero', () => {
    const r = new RegistroGas();
    r.restaurar({ v: 1, dia: '2026-11-06', direcciones: [DIR_A], totalHoy: 'muchísimo' });
    assert.equal(r.direcciones.size, 0);
    r.restaurar({ v: 1, dia: '2026-11-06', direcciones: [DIR_A], totalHoy: '-5' });
    assert.equal(r.direcciones.size, 0);
  });

  test('restaurar() respeta el máximo de entradas (no se infla la memoria)', () => {
    const r = new RegistroTorre({ maxDirecciones: 2 });
    r.restaurar({ v: 1, records: [['a', 1, 1, 1], ['b', 2, 1, 1], ['c', 3, 1, 1], ['d', 4, 1, 1]] });
    assert.equal(r.records.size, 2);
  });

  test('restaurar() no dispara alCambiar (cargar no es un cambio)', () => {
    let cambios = 0;
    const r = new RegistroTorre({ alCambiar: () => { cambios += 1; } });
    r.restaurar({ v: 1, records: [[DIR_A, 3, 9, 1000]] });
    assert.equal(cambios, 0);
    r.registrar(DIR_A, 4, 10);
    assert.equal(cambios, 1, 'un cambio de verdad sí avisa');
  });
});

// ─── Persistidor ──────────────────────────────────────────────────────────────

describe('Persistidor', () => {
  const crearPersistidor = (almacen, opts = {}) => {
    const estadoLocal = { n: 0 };
    const p = new Persistidor({
      almacen,
      clave: 'prueba',
      instantanea: () => ({ n: estadoLocal.n }),
      restaurar: (d) => { estadoLocal.n = d.n; },
      logger: loggerMudo,
      retardoMs: 0,
      ...opts,
    });
    return { p, estadoLocal };
  };

  test('cargar() con la clave vacía deja el registro como estaba', async () => {
    const { p, estadoLocal } = crearPersistidor(new AlmacenMemoria());
    assert.equal(await p.cargar(), false);
    assert.equal(p.cargado, false);
    assert.equal(estadoLocal.n, 0);
  });

  test('cargar() restaura lo guardado', async () => {
    const almacen = new AlmacenMemoria();
    await almacen.escribir('prueba', { n: 9 });
    const { p, estadoLocal } = crearPersistidor(almacen);
    assert.equal(await p.cargar(), true);
    assert.equal(p.cargado, true);
    assert.equal(estadoLocal.n, 9);
  });

  test('marcar() + vaciar() escribe una sola vez aunque haya muchos cambios', async () => {
    const almacen = new AlmacenMemoria();
    const { p, estadoLocal } = crearPersistidor(almacen, { retardoMs: 10_000 });
    for (let i = 1; i <= 50; i += 1) { estadoLocal.n = i; p.marcar(); }
    assert.equal(p.guardados, 0, 'todavía no ha escrito: está agrupando');
    await p.vaciar();
    assert.equal(p.guardados, 1);
    assert.deepEqual(await almacen.leer('prueba'), { n: 50 });
  });

  test('el guardado agrupado salta solo pasado el retardo', async () => {
    const almacen = new AlmacenMemoria();
    const { p, estadoLocal } = crearPersistidor(almacen, { retardoMs: 5 });
    estadoLocal.n = 3;
    p.marcar();
    await new Promise((ok) => setTimeout(ok, 40));
    assert.equal(p.guardados, 1);
    assert.deepEqual(await almacen.leer('prueba'), { n: 3 });
  });

  test('vaciar() sin cambios pendientes no escribe nada', async () => {
    const almacen = new AlmacenMemoria();
    const { p } = crearPersistidor(almacen);
    await p.vaciar();
    assert.equal(p.guardados, 0);
    assert.equal(await almacen.leer('prueba'), null);
  });

  test('un almacén roto al leer no impide arrancar', async () => {
    const { p, estadoLocal } = crearPersistidor(almacenRoto());
    assert.equal(await p.cargar(), false);
    assert.equal(estadoLocal.n, 0);
  });

  test('datos corruptos al restaurar no impiden arrancar', async () => {
    const p = new Persistidor({
      almacen: almacenConDatos({ malo: true }),
      clave: 'prueba',
      instantanea: () => ({}),
      restaurar: () => { throw new Error('forma inesperada'); },
      logger: loggerMudo,
    });
    assert.equal(await p.cargar(), false);
    assert.equal(p.cargado, false);
  });

  test('un almacén roto al escribir cuenta el fallo y deja el cambio pendiente', async () => {
    const estado = new EstadoAlmacen({ tipo: 'upstash' });
    const { p } = crearPersistidor(almacenRoto('se cayó Upstash'), { estado, retardoMs: 10_000 });
    p.marcar();
    await p.vaciar();
    assert.equal(p.fallos, 1);
    assert.equal(p.guardados, 0);
    assert.equal(p.sucio, true, 'sigue pendiente para reintentarlo');
    assert.equal(estado.resumen().escriturasFallidas, 1);
    assert.match(estado.resumen().ultimoError, /se cayó Upstash/);
  });

  test('tras un fallo, el siguiente intento vuelve a escribir y limpia el error', async () => {
    const estado = new EstadoAlmacen({ tipo: 'upstash' });
    let falla = true;
    const almacen = new AlmacenMemoria();
    const { p, estadoLocal } = crearPersistidor({
      leer: (k) => almacen.leer(k),
      escribir: async (k, v) => {
        if (falla) throw new Error('corte de red');
        return almacen.escribir(k, v);
      },
      borrar: (k) => almacen.borrar(k),
    }, { estado, retardoMs: 10_000 });

    estadoLocal.n = 1;
    p.marcar();
    await p.vaciar();
    assert.equal(p.fallos, 1);

    falla = false;
    estadoLocal.n = 2;
    p.marcar();
    await p.vaciar();
    assert.equal(p.guardados, 1);
    assert.deepEqual(await almacen.leer('prueba'), { n: 2 });
    assert.equal(estado.resumen().ultimoError, undefined);
  });

  test('dos guardados simultáneos no se pisan y el último valor gana', async () => {
    const almacen = new AlmacenMemoria();
    const lento = {
      leer: (k) => almacen.leer(k),
      escribir: async (k, v) => { await new Promise((ok) => setTimeout(ok, 10)); return almacen.escribir(k, v); },
      borrar: (k) => almacen.borrar(k),
    };
    const { p, estadoLocal } = crearPersistidor(lento, { retardoMs: 10_000 });
    estadoLocal.n = 1;
    p.marcar();
    const primero = p.guardarAhora();
    estadoLocal.n = 2;
    p.marcar();
    await Promise.all([primero, p.guardarAhora()]);
    await p.vaciar();
    assert.deepEqual(await almacen.leer('prueba'), { n: 2 });
  });

  test('una instantánea que lanza no rompe el persistidor', async () => {
    const p = new Persistidor({
      almacen: new AlmacenMemoria(),
      clave: 'prueba',
      instantanea: () => { throw new Error('estado imposible'); },
      restaurar: () => {},
      logger: loggerMudo,
      retardoMs: 10_000,
    });
    p.marcar();
    await assert.doesNotReject(() => p.vaciar());
    assert.equal(p.guardados, 0);
  });
});

// ─── conectar / conectarRegistros ─────────────────────────────────────────────

describe('conectar()', () => {
  test('carga el estado y engancha alCambiar', async () => {
    const almacen = new AlmacenMemoria();
    const previo = new RegistroTorre({ now: () => 1000 });
    previo.registrar(DIR_A, 1, 5);
    await almacen.escribir(CLAVES.torre, previo.instantanea());

    const registro = new RegistroTorre({ now: () => 2000 });
    const p = await conectar({ almacen, registro, clave: CLAVES.torre, logger: loggerMudo, retardoMs: 0 });
    assert.equal(registro.record(DIR_A), 1, 'se restauró el récord');
    assert.equal(typeof registro.alCambiar, 'function');

    registro.registrar(DIR_A, 2, 7);
    await p.vaciar();
    const guardado = await almacen.leer(CLAVES.torre);
    assert.deepEqual(guardado.records, [[DIR_A, 2, 7, 2000]]);
  });

  test('un registro sin instantanea()/restaurar() se rechaza con un mensaje claro', async () => {
    await assert.rejects(
      () => conectar({ almacen: new AlmacenMemoria(), registro: {}, clave: 'x', logger: loggerMudo }),
      /no implementa instantanea\(\)\/restaurar\(\)/,
    );
  });
});

describe('conectarRegistros()', () => {
  /** Los cinco registros que deben sobrevivir a un reinicio. */
  const crearTodos = () => ({
    diario: new RegistroDiario(),
    primerBotin: new RegistroPrimerBotin(),
    gas: new RegistroGas({ topeDiario: parseEther('0.01') }),
    torre: new RegistroTorre({ now: () => 1000 }),
    botin: new EstadoBotin(),
  });

  test('primer arranque: nada restaurado y claves con nombre propio', async () => {
    const almacen = new AlmacenMemoria();
    const { persistidores, restaurados } = await conectarRegistros({
      almacen, registros: crearTodos(), logger: loggerMudo, retardoMs: 0,
    });
    assert.deepEqual(restaurados, []);
    assert.deepEqual(Object.keys(persistidores).sort(), ['botin', 'diario', 'gas', 'primerBotin', 'torre']);
    assert.deepEqual(
      Object.values(persistidores).map((p) => p.clave).sort(),
      ['botin', 'diario', 'gas', 'primer-botin', 'torre'],
    );
  });

  test('reinicio completo: todo lo del encargo vuelve tal cual', async () => {
    const almacen = new AlmacenMemoria();
    const ahora = Date.parse('2026-11-06T12:00:00Z');

    // ── Primera vida del servidor ──
    const antes = crearTodos();
    const { vaciarTodo } = await conectarRegistros({
      almacen, registros: antes, logger: loggerMudo, retardoMs: 10_000,
    });
    antes.diario.registrar(DIR_A, 4, diaUtc(ahora));                  // racha y reclamo diario
    antes.primerBotin.reservar(DIR_A); antes.primerBotin.confirmar(DIR_A); // primer botín
    antes.gas.reservar(DIR_A, ahora);                                  // tope del grifo
    antes.torre.registrar(DIR_B, 1, 4);                                // récord de la torre
    antes.botin.registrar(DIR_A, { rareza: RAREZA.COMUN, nombre: 'Daga' }); // pity del botín
    await vaciarTodo();

    // ── Render reinicia: proceso nuevo, mismo almacén ──
    const despues = crearTodos();
    const { restaurados } = await conectarRegistros({
      almacen, registros: despues, logger: loggerMudo, retardoMs: 0,
    });
    assert.deepEqual(restaurados.sort(), ['botin', 'diario', 'gas', 'primerBotin', 'torre']);

    assert.equal(despues.diario.estado(DIR_A, ahora).puedeReclamar, false, 'no cobra dos veces la diaria');
    assert.equal(despues.diario.estado(DIR_A, ahora).racha, 4);
    assert.equal(despues.primerBotin.yaEntregado(DIR_A), true, 'no regala otro Raro');
    assert.equal(despues.gas.yaPedido(DIR_A, ahora), true, 'no vacía el tope del grifo');
    assert.equal(despues.gas.totalHoy, CANTIDAD_GAS);
    assert.equal(despues.torre.record(DIR_B), 1, 'conserva el récord de la torre');
    assert.equal(despues.botin.sinLegendario(DIR_A), 1, 'conserva el contador de pity');
  });

  test('un registro que falta (undefined) simplemente se salta', async () => {
    const { persistidores } = await conectarRegistros({
      almacen: new AlmacenMemoria(),
      registros: { torre: new RegistroTorre(), gas: null, diario: undefined },
      logger: loggerMudo,
      retardoMs: 0,
    });
    assert.deepEqual(Object.keys(persistidores), ['torre']);
  });

  test('con el almacén roto, los registros siguen funcionando en memoria', async () => {
    const estado = new EstadoAlmacen({ tipo: 'upstash' });
    const registros = crearTodos();
    const { vaciarTodo } = await conectarRegistros({
      almacen: almacenRoto(), registros, estado, logger: loggerMudo, retardoMs: 10_000,
    });
    registros.torre.registrar(DIR_A, 1, 3);
    assert.equal(registros.torre.record(DIR_A), 1, 'la lógica del juego no depende del almacén');
    await assert.doesNotReject(() => vaciarTodo());
    assert.ok(estado.resumen().escriturasFallidas >= 1);
  });
});
