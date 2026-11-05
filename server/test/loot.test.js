import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tirarLoot, generarObjeto, sortearRareza, generarNombre, generarStats, hayDrop,
  LISTA_TIPOS, RANGO_STAT, TIPOS,
} from '../src/loot.js';
import { rngSemilla, rngFijo } from './helpers.js';

const N = 100_000;

test('distribución de rarezas ≈ 70/25/5 en 100k tiradas', () => {
  const rng = rngSemilla(42);
  const cuenta = [0, 0, 0];
  for (let i = 0; i < N; i++) cuenta[sortearRareza(rng)]++;
  const p = cuenta.map((c) => c / N);
  // Tolerancia de ±1 punto porcentual (≈ 4-7 desviaciones típicas)
  assert.ok(Math.abs(p[0] - 0.70) < 0.01, `Común ${p[0]}`);
  assert.ok(Math.abs(p[1] - 0.25) < 0.01, `Raro ${p[1]}`);
  assert.ok(Math.abs(p[2] - 0.05) < 0.01, `Legendario ${p[2]}`);
});

test('probabilidad de drop ≈ DROP_CHANCE (60 % por defecto) y respeta 0 y 1', () => {
  const rng = rngSemilla(7);
  let drops = 0;
  for (let i = 0; i < N; i++) if (tirarLoot(rng)) drops++;
  assert.ok(Math.abs(drops / N - 0.6) < 0.01, `drop ${drops / N}`);
  assert.equal(tirarLoot(rngSemilla(1), { dropChance: 0 }), null);
  assert.notEqual(tirarLoot(rngFijo(0.999999), { dropChance: 1 }), null);
  assert.equal(hayDrop(rngFijo(0.6), 0.6), false);
  assert.equal(hayDrop(rngFijo(0.5999), 0.6), true);
});

test('stats dentro de los rangos de SPEC.md y secundaria ≈ 25 %', () => {
  const rng = rngSemilla(99);
  const vistos = { 0: new Set(), 1: new Set(), 2: new Set() };
  for (let i = 0; i < N; i++) {
    const o = generarObjeto(rng);
    const [min, max] = RANGO_STAT[o.rareza];
    const principal = TIPOS[o.tipo].principal === 'ataque' ? o.ataque : o.defensa;
    const secundaria = TIPOS[o.tipo].principal === 'ataque' ? o.defensa : o.ataque;
    assert.ok(principal >= min && principal <= max, `${o.nombre}: ${principal} fuera de [${min},${max}]`);
    assert.ok(Number.isInteger(o.ataque) && Number.isInteger(o.defensa));
    assert.ok(secundaria >= Math.round(principal * 0.2) && secundaria <= Math.round(principal * 0.3),
      `secundaria ${secundaria} para principal ${principal}`);
    assert.ok(o.ataque <= 65535 && o.defensa <= 65535); // cabe en uint16
    vistos[o.rareza].add(principal);
  }
  // Se alcanzan todos los valores de cada rango (extremos incluidos)
  for (const r of [0, 1, 2]) {
    const [min, max] = RANGO_STAT[r];
    assert.equal(vistos[r].size, max - min + 1, `rareza ${r}`);
  }
});

test('stats con RNG en los extremos (0 y casi 1)', () => {
  assert.deepEqual(generarStats(rngFijo(0), 'Espada', 2), { ataque: 13, defensa: 3 });
  assert.deepEqual(generarStats(rngFijo(0.9999999), 'Escudo', 2), { ataque: 7, defensa: 25 });
  assert.deepEqual(generarStats(rngFijo(0), 'Botas', 0), { ataque: 0, defensa: 1 });
});

test('Espada → ataque principal; resto → defensa principal', () => {
  const rng = rngSemilla(3);
  for (const tipo of LISTA_TIPOS) {
    const s = generarStats(rng, tipo, 1);
    if (tipo === 'Espada') assert.ok(s.ataque >= 6 && s.ataque <= 12);
    else assert.ok(s.defensa >= 6 && s.defensa <= 12);
  }
});

test('todos los tipos aparecen con frecuencia similar', () => {
  const rng = rngSemilla(5);
  const cuenta = Object.fromEntries(LISTA_TIPOS.map((t) => [t, 0]));
  for (let i = 0; i < N; i++) cuenta[generarObjeto(rng).tipo]++;
  for (const t of LISTA_TIPOS) assert.ok(Math.abs(cuenta[t] / N - 0.2) < 0.01, `${t} ${cuenta[t]}`);
});

test('nombres: base por tipo + adjetivo concordado según rareza', () => {
  assert.equal(generarNombre(rngFijo(0), 'Espada', 0), 'Espada Oxidada');
  assert.equal(generarNombre(rngFijo(0), 'Escudo', 1), 'Escudo Rúnico');
  assert.equal(generarNombre(rngFijo(0), 'Casco', 2), 'Casco del Dragón Eterno');
  assert.equal(generarNombre(rngFijo(0), 'Botas', 0), 'Botas Oxidadas');
  assert.equal(generarNombre(rngFijo(0), 'Armadura', 1), 'Armadura Rúnica');
  const rng = rngSemilla(11);
  for (let i = 0; i < 2000; i++) {
    const o = generarObjeto(rng);
    assert.ok(o.nombre.startsWith(`${o.tipo} `), o.nombre);
    assert.ok(o.nombre.length > o.tipo.length + 2);
  }
});

test('formato del objeto coincide con SPEC.md', () => {
  const o = generarObjeto(rngSemilla(8));
  assert.deepEqual(Object.keys(o).sort(), ['ataque', 'defensa', 'nombre', 'rareza', 'tipo']);
  assert.ok(LISTA_TIPOS.includes(o.tipo));
  assert.ok([0, 1, 2].includes(o.rareza));
});
