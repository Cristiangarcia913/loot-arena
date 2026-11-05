import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  tirarLoot, generarObjeto, sortearRareza, generarNombre, generarStats, hayDrop,
  probabilidadesRareza, probabilidadPity, rangoStat, concordar, EstadoBotin,
  LISTA_TIPOS, RANGO_STAT, TIPOS, BASES, ADJETIVOS_COMUN, ADJETIVOS_RARO, SUFIJOS_RARO,
  NOMBRES_LEGENDARIO, EPITETOS_LEGENDARIO, MAX_LONGITUD_NOMBRE, PITY_UMBRAL,
  NIVEL_MIN, NIVEL_MAX,
} from '../src/loot.js';
import { rngSemilla, rngFijo } from './helpers.js';

const N = 100_000;
const NIVELES = Array.from({ length: NIVEL_MAX - NIVEL_MIN + 1 }, (_, i) => i + NIVEL_MIN);
const principalDe = (o) => (TIPOS[o.tipo].principal === 'ataque' ? o.ataque : o.defensa);
const secundariaDe = (o) => (TIPOS[o.tipo].principal === 'ataque' ? o.defensa : o.ataque);

/** RNG que devuelve los valores de la lista en orden y luego repite el último. */
const rngLista = (vals) => { let i = 0; return () => vals[Math.min(i++, vals.length - 1)]; };

describe('rareza según nivel y jefe', () => {
  // Tabla esperada (se documenta en el README): [Común, Raro, Legendario]
  const ESPERADA = [
    [1, false, [0.70, 0.25, 0.05]],
    [5, false, [0.60, 0.31, 0.09]],
    [10, false, [0.475, 0.385, 0.14]],
    [1, true, [0.55, 0.35, 0.10]],
    [10, true, [0.36, 0.44, 0.20]],
  ];

  test('probabilidades teóricas: base 70/25/5 y jefe nivel 10 → Legendario 20 %', () => {
    for (const [nivel, jefe, esperada] of ESPERADA) {
      const p = probabilidadesRareza(nivel, { jefe });
      p.forEach((x, i) => assert.ok(Math.abs(x - esperada[i]) < 1e-9, `nivel ${nivel} jefe ${jefe}: ${p}`));
    }
  });

  test('probabilidades suman 1 y Raro/Legendario crecen con el nivel y con jefe', () => {
    for (const jefe of [false, true]) {
      let prev = null;
      for (const nivel of NIVELES) {
        const p = probabilidadesRareza(nivel, { jefe });
        assert.ok(Math.abs(p[0] + p[1] + p[2] - 1) < 1e-9);
        assert.ok(p.every((x) => x >= 0 && x <= 1));
        if (prev) assert.ok(p[1] > prev[1] && p[2] > prev[2] && p[0] < prev[0], `nivel ${nivel}`);
        prev = p;
      }
    }
    for (const nivel of NIVELES) {
      const [, r, l] = probabilidadesRareza(nivel);
      const [, rj, lj] = probabilidadesRareza(nivel, { jefe: true });
      assert.ok(rj > r && lj > l, `nivel ${nivel}`);
    }
  });

  for (const nivel of [1, 5, 10]) {
    for (const jefe of [false, true]) {
      test(`distribución en 100k tiradas ≈ teórica (nivel ${nivel}${jefe ? ', jefe' : ''})`, () => {
        const rng = rngSemilla(1000 + nivel * 2 + Number(jefe));
        const cuenta = [0, 0, 0];
        for (let i = 0; i < N; i++) cuenta[sortearRareza(rng, nivel, { jefe })]++;
        const teorica = probabilidadesRareza(nivel, { jefe });
        // Tolerancia ±1 pp (≥ 6 desviaciones típicas con N = 100k)
        cuenta.forEach((c, i) =>
          assert.ok(Math.abs(c / N - teorica[i]) < 0.01, `rareza ${i}: ${c / N} vs ${teorica[i]}`));
      });
    }
  }

  test('sin argumentos sigue siendo 70/25/5 (compatibilidad)', () => {
    const rng = rngSemilla(42);
    const cuenta = [0, 0, 0];
    for (let i = 0; i < N; i++) cuenta[sortearRareza(rng)]++;
    assert.ok(Math.abs(cuenta[0] / N - 0.70) < 0.01);
    assert.ok(Math.abs(cuenta[1] / N - 0.25) < 0.01);
    assert.ok(Math.abs(cuenta[2] / N - 0.05) < 0.01);
  });

  test('niveles fuera de rango se acotan a 1..10', () => {
    assert.deepEqual(probabilidadesRareza(0), probabilidadesRareza(1));
    assert.deepEqual(probabilidadesRareza(99, { jefe: true }), probabilidadesRareza(10, { jefe: true }));
  });
});

describe('drop', () => {
  test('probabilidad de drop ≈ dropChance (60 % por defecto) y respeta 0 y 1', () => {
    const rng = rngSemilla(7);
    let drops = 0;
    for (let i = 0; i < N; i++) if (tirarLoot(rng)) drops++;
    assert.ok(Math.abs(drops / N - 0.6) < 0.01, `drop ${drops / N}`);
    assert.equal(tirarLoot(rngSemilla(1), { dropChance: 0 }), null);
    assert.notEqual(tirarLoot(rngFijo(0.999999), { dropChance: 1 }), null);
    assert.equal(hayDrop(rngFijo(0.6), 0.6), false);
    assert.equal(hayDrop(rngFijo(0.5999), 0.6), true);
  });

  test('los jefes SIEMPRE sueltan objeto, aunque dropChance sea 0', () => {
    const rng = rngSemilla(77);
    for (let i = 0; i < 10_000; i++) {
      assert.notEqual(tirarLoot(rng, { dropChance: 0, jefe: true, nivel: 1 + (i % 10) }), null);
    }
    assert.notEqual(tirarLoot(rngFijo(0.99), { jefe: true }), null);
    assert.equal(tirarLoot(rngFijo(0.99), { jefe: false }), null);
  });
});

describe('pity (protección contra la mala suerte)', () => {
  test('probabilidadPity: 0 hasta el umbral, luego 50 %, 60 %… hasta 100 %', () => {
    assert.equal(probabilidadPity(0), 0);
    assert.equal(probabilidadPity(PITY_UMBRAL - 1), 0);
    assert.equal(probabilidadPity(PITY_UMBRAL), 0.5);
    assert.ok(Math.abs(probabilidadPity(PITY_UMBRAL + 2) - 0.7) < 1e-9);
    assert.equal(probabilidadPity(PITY_UMBRAL + 5), 1);
    assert.equal(probabilidadPity(1000), 1);
  });

  test('con 15 drops sin Legendario, el siguiente es Legendario ≥ 50 %', () => {
    const p = probabilidadesRareza(1, { sinLegendario: PITY_UMBRAL });
    assert.ok(p[2] >= 0.5);
    assert.ok(Math.abs(p[0] + p[1] + p[2] - 1) < 1e-9);
    // Con 20 sin Legendario, seguro
    assert.deepEqual(probabilidadesRareza(10, { jefe: true, sinLegendario: PITY_UMBRAL + 5 }), [0, 0, 1]);
    // Con rng casi 1 el pity máximo da Legendario
    assert.equal(sortearRareza(rngFijo(0.9999999), 1, { sinLegendario: PITY_UMBRAL + 5 }), 2);
    // Distribución empírica con pity en el umbral
    const rng = rngSemilla(15);
    let leg = 0;
    for (let i = 0; i < N; i++) if (sortearRareza(rng, 1, { sinLegendario: PITY_UMBRAL }) === 2) leg++;
    assert.ok(Math.abs(leg / N - 0.5) < 0.01, `leg ${leg / N}`);
  });

  test('EstadoBotin cuenta drops por dirección y se reinicia con un Legendario', () => {
    const e = new EstadoBotin();
    const comun = { nombre: 'Espada Oxidada', tipo: 'Espada', rareza: 0, ataque: 1, defensa: 0 };
    const leg = { nombre: 'Albor, Espada del Fénix Eterno', tipo: 'Espada', rareza: 2, ataque: 20, defensa: 5 };
    for (let i = 0; i < PITY_UMBRAL; i++) e.registrar('A', comun);
    e.registrar('B', comun);
    e.registrar('A', null); // sin drop: no cuenta
    assert.equal(e.sinLegendario('A'), PITY_UMBRAL);
    assert.equal(e.sinLegendario('B'), 1);
    assert.equal(e.sinLegendario('C'), 0);
    assert.deepEqual(e.opciones('A'), { sinLegendario: PITY_UMBRAL, evitarNombre: null });
    e.registrar('A', leg);
    assert.equal(e.sinLegendario('A'), 0);
    assert.equal(e.ultimoLegendario, leg.nombre);
    assert.deepEqual(e.opciones('B'), { sinLegendario: 1, evitarNombre: leg.nombre });
  });

  test('EstadoBotin está acotado en memoria (olvida la dirección menos reciente)', () => {
    const e = new EstadoBotin({ maxDirecciones: 3 });
    const comun = { nombre: 'x', tipo: 'Botas', rareza: 0, ataque: 0, defensa: 1 };
    for (const d of ['A', 'B', 'C']) e.registrar(d, comun);
    e.registrar('A', comun); // A pasa a ser la más reciente
    e.registrar('D', comun); // se olvida B
    assert.equal(e.contadores.size, 3);
    assert.equal(e.sinLegendario('B'), 0);
    assert.equal(e.sinLegendario('A'), 2);
  });

  test('simulación: nunca más de 20 drops seguidos sin Legendario y la tasa sube', () => {
    const rng = rngSemilla(2024);
    const e = new EstadoBotin();
    let leg = 0;
    let maxRacha = 0;
    for (let i = 0; i < N; i++) {
      const item = generarObjeto(rng, { nivel: 1, ...e.opciones('jugador') });
      e.registrar('jugador', item);
      if (item.rareza === 2) leg++;
      maxRacha = Math.max(maxRacha, e.sinLegendario('jugador'));
    }
    assert.ok(maxRacha <= PITY_UMBRAL + 5, `racha ${maxRacha}`);
    assert.ok(leg / N > 0.07 && leg / N < 0.10, `tasa efectiva ${leg / N}`); // ≈ 8,7 % frente al 5 % base
  });
});

describe('nombres', () => {
  test('vocabulario mínimo: ≥ 15 bases por tipo y ≥ 20 afijos', () => {
    for (const t of LISTA_TIPOS) {
      assert.ok(BASES[t].length >= 15, t);
      assert.equal(new Set(BASES[t].map((x) => x.nombre)).size, BASES[t].length, `bases repetidas en ${t}`);
    }
    const afijos = ADJETIVOS_COMUN.length + ADJETIVOS_RARO.length + SUFIJOS_RARO.length + EPITETOS_LEGENDARIO.length;
    assert.ok(afijos >= 20);
    assert.ok(SUFIJOS_RARO.length >= 20);
    assert.ok(EPITETOS_LEGENDARIO.length >= 20);
    assert.ok(NOMBRES_LEGENDARIO.length >= 20);
  });

  test('concordancia de género y número', () => {
    assert.equal(concordar('Oxidado', 'f'), 'Oxidada');
    assert.equal(concordar('Oxidado', 'mp'), 'Oxidados');
    assert.equal(concordar('Oxidado', 'fp'), 'Oxidadas');
    assert.equal(concordar('Endeble', 'fp'), 'Endebles');
    assert.equal(concordar('Endeble', 'f'), 'Endeble');
    assert.equal(concordar('de Hierro', 'fp'), 'de Hierro');
    for (const a of [...ADJETIVOS_COMUN, ...ADJETIVOS_RARO]) {
      for (const g of ['m', 'f', 'mp', 'fp']) assert.equal(typeof concordar(a, g), 'string');
    }
  });

  test('formato por rareza (ejemplos de MEJORAS.md)', () => {
    assert.equal(generarNombre(rngFijo(0), 'Espada', 0), 'Espada Oxidada');
    assert.equal(generarNombre(rngFijo(0), 'Botas', 0), 'Botas Oxidadas');
    assert.equal(generarNombre(rngFijo(0), 'Escudo', 1), 'Escudo Rúnico de Escarcha');
    assert.equal(generarNombre(rngFijo(0), 'Espada', 1), 'Espada Rúnica de Escarcha');
    assert.equal(generarNombre(rngFijo(0), 'Espada', 2), 'Albor, Espada del Fénix Eterno');
    assert.match(generarNombre(rngSemilla(4), 'Casco', 2), /^[^,]+, [^ ].* (del?|de la|de los|de las) .+$/);
  });

  test('ningún nombre posible supera 60 caracteres (peor caso exhaustivo)', () => {
    const maxLen = (xs) => Math.max(...xs.map((x) => x.length));
    for (const t of LISTA_TIPOS) {
      for (const base of BASES[t]) {
        const formas = (lista) => lista.map((a) => concordar(a, base.genero));
        const comun = base.nombre.length + 1 + maxLen(formas(ADJETIVOS_COMUN));
        const raro = base.nombre.length + 1 + maxLen(formas(ADJETIVOS_RARO)) + 1 + maxLen(SUFIJOS_RARO);
        const leg = maxLen(NOMBRES_LEGENDARIO) + 2 + base.nombre.length + 1 + maxLen(EPITETOS_LEGENDARIO);
        assert.ok(Math.max(comun, raro, leg) <= MAX_LONGITUD_NOMBRE, `${t}/${base.nombre}`);
      }
    }
    const rng = rngSemilla(11);
    for (let i = 0; i < N; i++) {
      const o = generarObjeto(rng, { nivel: 1 + (i % 10), jefe: i % 3 === 0 });
      assert.ok(o.nombre.length > 0 && o.nombre.length <= MAX_LONGITUD_NOMBRE, o.nombre);
      assert.equal(o.nombre, o.nombre.trim());
      assert.ok(!o.nombre.includes('  '));
      if (o.rareza === 2) assert.ok(o.nombre.includes(', '), o.nombre);
      else assert.ok(!o.nombre.includes(','), o.nombre);
    }
  });

  test('la base del nombre pertenece al tipo del objeto', () => {
    const rng = rngSemilla(12);
    for (let i = 0; i < 5000; i++) {
      const o = generarObjeto(rng, { nivel: 5 });
      const sinPropio = o.rareza === 2 ? o.nombre.split(', ')[1] : o.nombre;
      assert.ok(BASES[o.tipo].some((x) => sinPropio.startsWith(`${x.nombre} `)), `${o.tipo}: ${o.nombre}`);
    }
  });

  test('hay mucha variedad de nombres', () => {
    const rng = rngSemilla(13);
    const vistos = new Set();
    for (let i = 0; i < 20_000; i++) vistos.add(generarObjeto(rng, { nivel: 10, jefe: true }).nombre);
    assert.ok(vistos.size > 8_000, `solo ${vistos.size} nombres distintos`);
  });

  test('no repite el mismo nombre legendario dos veces seguidas', () => {
    const primero = generarNombre(rngFijo(0), 'Espada', 2);
    const segundo = generarNombre(rngFijo(0), 'Espada', 2, { evitar: primero });
    assert.notEqual(segundo, primero);
    assert.equal(segundo, 'Ocaso, Espada del Fénix Eterno');
    // Último elemento de la lista → vuelve al primero
    const ultimo = generarNombre(rngFijo(0.9999999), 'Botas', 2);
    assert.notEqual(generarNombre(rngFijo(0.9999999), 'Botas', 2, { evitar: ultimo }), ultimo);
    // Con EstadoBotin y un RNG que fuerza siempre el mismo legendario
    const e = new EstadoBotin();
    let anterior = null;
    for (let i = 0; i < 50; i++) {
      const item = generarObjeto(rngFijo(0.9999999), { ...e.opciones('A'), sinLegendario: 99 });
      assert.equal(item.rareza, 2);
      assert.notEqual(item.nombre, anterior);
      anterior = item.nombre;
      e.registrar('A', item);
    }
  });

  test('tipo y rareza desconocidos lanzan error', () => {
    assert.throws(() => generarNombre(rngFijo(0), 'Anillo', 0), /Tipo desconocido/);
    assert.throws(() => generarNombre(rngFijo(0), 'Espada', 3), /Rareza desconocida/);
    assert.throws(() => generarStats(rngFijo(0), 'Anillo', 0), /Tipo desconocido/);
  });
});

describe('stats', () => {
  test('rangos absolutos ampliados: Común 1–6, Raro 6–14, Legendario 14–30', () => {
    assert.deepEqual(RANGO_STAT[0], [1, 6]);
    assert.deepEqual(RANGO_STAT[1], [6, 14]);
    assert.deepEqual(RANGO_STAT[2], [14, 30]);
  });

  test('rangoStat sube con el nivel, el jefe ayuda y nunca sale del rango absoluto', () => {
    assert.deepEqual(rangoStat(2, 1), [14, 24]);
    assert.deepEqual(rangoStat(2, 10), [20, 30]);
    assert.deepEqual(rangoStat(0, 1), [1, 4]);
    assert.deepEqual(rangoStat(0, 10), [3, 6]);
    for (const r of [0, 1, 2]) {
      const [min, max] = RANGO_STAT[r];
      let prev = [0, 0];
      for (const nivel of NIVELES) {
        for (const jefe of [false, true]) {
          const [lo, hi] = rangoStat(r, nivel, { jefe });
          assert.ok(min <= lo && lo <= hi && hi <= max, `r${r} n${nivel} ${lo}-${hi}`);
        }
        const [lo, hi] = rangoStat(r, nivel);
        const [loJ, hiJ] = rangoStat(r, nivel, { jefe: true });
        assert.ok(lo >= prev[0] && hi >= prev[1]);
        assert.ok(loJ >= lo && hiJ >= hi);
        prev = [lo, hi];
      }
    }
  });

  test('100k objetos: stats en rango, enteros, uint16, todos los valores alcanzables', () => {
    const rng = rngSemilla(99);
    const vistos = { 0: new Set(), 1: new Set(), 2: new Set() };
    for (let i = 0; i < N; i++) {
      const nivel = 1 + (i % 10);
      const jefe = i % 7 === 0;
      const o = generarObjeto(rng, { nivel, jefe, sinLegendario: i % 20 });
      const [lo, hi] = rangoStat(o.rareza, nivel, { jefe });
      const p = principalDe(o);
      const s = secundariaDe(o);
      assert.ok(p >= lo && p <= hi, `${o.nombre}: ${p} fuera de [${lo},${hi}] (nivel ${nivel})`);
      assert.ok(Number.isInteger(o.ataque) && Number.isInteger(o.defensa));
      assert.ok(o.ataque >= 0 && o.defensa >= 0 && o.ataque <= 65535 && o.defensa <= 65535);
      assert.ok(s >= Math.round(p * 0.1) && s <= Math.round(p * 0.4), `secundaria ${s} para ${p}`);
      vistos[o.rareza].add(p);
    }
    for (const r of [0, 1, 2]) {
      const [min, max] = RANGO_STAT[r];
      assert.equal(vistos[r].size, max - min + 1, `rareza ${r}: ${[...vistos[r]].sort((a, b) => a - b)}`);
    }
  });

  test('la media de la stat principal sube con el nivel', () => {
    const media = (nivel) => {
      const rng = rngSemilla(nivel);
      let suma = 0;
      for (let i = 0; i < 20_000; i++) suma += principalDe(generarObjeto(rng, { nivel }));
      return suma / 20_000;
    };
    const m1 = media(1);
    const m10 = media(10);
    assert.ok(m10 > m1 + 2, `nivel 1: ${m1}, nivel 10: ${m10}`);
  });

  test('stats con RNG en los extremos', () => {
    assert.deepEqual(generarStats(rngFijo(0), 'Espada', 2), { ataque: 14, defensa: 1 });
    assert.deepEqual(generarStats(rngFijo(0.9999999), 'Escudo', 2, { nivel: 10 }), { ataque: 12, defensa: 30 });
    assert.deepEqual(generarStats(rngFijo(0), 'Botas', 0), { ataque: 0, defensa: 1 });
    assert.deepEqual(generarStats(rngLista([0.9999999, 0]), 'Casco', 0, { nivel: 10 }), { ataque: 1, defensa: 6 });
  });

  test('Espada → ataque principal; resto → defensa principal', () => {
    const rng = rngSemilla(3);
    for (const tipo of LISTA_TIPOS) {
      for (let i = 0; i < 200; i++) {
        const s = generarStats(rng, tipo, 1, { nivel: 5 });
        if (tipo === 'Espada') assert.ok(s.ataque >= 6 && s.ataque <= 14 && s.ataque > s.defensa);
        else assert.ok(s.defensa >= 6 && s.defensa <= 14 && s.defensa > s.ataque);
      }
    }
  });
});

describe('objeto', () => {
  test('todos los tipos aparecen con frecuencia similar', () => {
    const rng = rngSemilla(5);
    const cuenta = Object.fromEntries(LISTA_TIPOS.map((t) => [t, 0]));
    for (let i = 0; i < N; i++) cuenta[generarObjeto(rng).tipo]++;
    for (const t of LISTA_TIPOS) assert.ok(Math.abs(cuenta[t] / N - 0.2) < 0.01, `${t} ${cuenta[t]}`);
  });

  test('formato del objeto coincide con SPEC.md (contrato sin cambios)', () => {
    const rng = rngSemilla(8);
    for (let i = 0; i < 1000; i++) {
      const o = generarObjeto(rng, { nivel: 10, jefe: true });
      assert.deepEqual(Object.keys(o).sort(), ['ataque', 'defensa', 'nombre', 'rareza', 'tipo']);
      assert.ok(LISTA_TIPOS.includes(o.tipo));
      assert.ok([0, 1, 2].includes(o.rareza));
      assert.equal(typeof o.nombre, 'string');
    }
  });
});
