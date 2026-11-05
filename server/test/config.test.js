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

test('1.2: MERCADO_ADDRESS, RECOMPENSAS_ADDRESS y DEPLOY_BLOCK son opcionales (avisos, no errores)', () => {
  const sin = cargarConfig(BASE);
  assert.deepEqual(sin.errores, []);
  assert.equal(sin.avisos.length, 3);
  assert.equal(sin.config.mercadoAddress, null);
  assert.equal(sin.config.recompensasAddress, null);
  assert.equal(sin.config.deployBlock, null);

  const con = cargarConfig({
    ...BASE,
    MERCADO_ADDRESS: '0x2279b7a0a67db372996a5fab50d91eaa73d2ebe6',
    RECOMPENSAS_ADDRESS: '0x8A791620dd6260079BF849Dc5567aDC3F2FdC318',
    DEPLOY_BLOCK: ' 7012345 ',
    TEMPORADA_INICIO: '2026-11-02T00:00:00Z',
  });
  assert.deepEqual(con.errores, []);
  assert.deepEqual(con.avisos, []);
  assert.equal(con.config.mercadoAddress, '0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6');
  assert.equal(con.config.deployBlock, 7012345);
  assert.equal(con.config.inicioTemporadas, Date.UTC(2026, 10, 2));

  const mal = cargarConfig({ ...BASE, MERCADO_ADDRESS: 'x', RECOMPENSAS_ADDRESS: '0x0000000000000000000000000000000000000000', DEPLOY_BLOCK: '-5', TEMPORADA_INICIO: 'ayer' });
  assert.deepEqual(mal.errores, []);
  assert.equal(mal.avisos.length, 4);
  assert.equal(mal.config.deployBlock, null);
  assert.equal(mal.config.inicioTemporadas, null);
});
