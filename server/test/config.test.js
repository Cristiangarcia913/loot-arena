import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cargarConfig, origenCors } from '../src/config.js';

const BASE = {
  RPC_URL: 'http://127.0.0.1:8545',
  PRIVATE_KEY: '0x' + 'ac'.repeat(32),
  CONTRACT_ADDRESS: '0x5fbdb2315678afecb367f032d93f642f64180aa3',
};

test('config válida con valores por defecto', () => {
  const { config, errores } = cargarConfig(BASE);
  assert.deepEqual(errores, []);
  assert.equal(config.port, 3000);
  assert.equal(config.dropChance, 0.6);
  assert.equal(config.allowedOrigin, '*');
  assert.equal(config.contractAddress, '0x5FbDB2315678afecb367f032d93F642f64180aa3');
});

test('PRIVATE_KEY sin 0x se acepta', () => {
  const { config, errores } = cargarConfig({ ...BASE, PRIVATE_KEY: 'ac'.repeat(32) });
  assert.deepEqual(errores, []);
  assert.ok(config.privateKey.startsWith('0x'));
});

test('errores claros cuando faltan variables o son inválidas', () => {
  assert.equal(cargarConfig({}).errores.length, 3);
  const { errores } = cargarConfig({
    RPC_URL: 'ftp://x', PRIVATE_KEY: '0x12', CONTRACT_ADDRESS: '0x0000000000000000000000000000000000000000',
    PORT: 'abc', DROP_CHANCE: '2',
  });
  assert.equal(errores.length, 5);
  assert.ok(errores.some((e) => e.includes('dirección cero')));
});

test('ALLOWED_ORIGIN admite lista separada por comas', () => {
  assert.equal(origenCors('*'), '*');
  assert.equal(origenCors('https://a.com/'), 'https://a.com');
  assert.deepEqual(origenCors('https://a.com, https://b.com'), ['https://a.com', 'https://b.com']);
});
