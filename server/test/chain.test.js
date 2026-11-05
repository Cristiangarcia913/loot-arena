import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Interface } from 'ethers';
import { cargarAbi, extraerTokenId, crearMinter, mensajeError } from '../src/chain.js';
import { crearColaSerie } from '../src/queue.js';

const CONTRATO = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const JUGADOR = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const iface = new Interface(cargarAbi());

function logItemMinted(tokenId, address = CONTRATO) {
  const ev = iface.getEvent('ItemMinted');
  const { data, topics } = iface.encodeEventLog(ev, [JUGADOR, tokenId, 'Espada Rúnica', 'Espada', 1, 12, 2]);
  return { address, data, topics };
}

test('el ABI tiene las firmas exactas de SPEC.md', () => {
  assert.ok(iface.getFunction('mintItem(address,string,string,uint8,uint16,uint16)'));
  assert.ok(iface.getFunction('getItem(uint256)'));
  assert.ok(iface.getEvent('ItemMinted(address,uint256,string,string,uint8,uint16,uint16)'));
  assert.equal(iface.getFunction('mintItem').outputs[0].type, 'uint256');
});

test('extraerTokenId lee el tokenId del evento ItemMinted', () => {
  const ajeno = { address: '0x0000000000000000000000000000000000000001', topics: ['0x' + '11'.repeat(32)], data: '0x' };
  const receipt = { logs: [ajeno, logItemMinted(5n)] };
  assert.equal(extraerTokenId(iface, receipt, CONTRATO), '5');
});

test('extraerTokenId ignora logs de otros contratos y falla si no hay evento', () => {
  const receipt = { logs: [logItemMinted(7n, '0x0000000000000000000000000000000000000002')] };
  assert.throws(() => extraerTokenId(iface, receipt, CONTRATO), /ItemMinted/);
  assert.throws(() => extraerTokenId(iface, { logs: [] }), /ItemMinted/);
});

test('crearMinter serializa los mints (nunca dos a la vez) y devuelve tokenId/txHash', async () => {
  let activos = 0, maxActivos = 0, siguiente = 1;
  const llamadas = [];
  const contrato = {
    target: CONTRATO,
    interface: iface,
    async mintItem(...args) {
      activos++; maxActivos = Math.max(maxActivos, activos);
      llamadas.push(args);
      const id = BigInt(siguiente++);
      await new Promise((r) => setTimeout(r, 5));
      return {
        hash: `0x${id.toString(16).padStart(64, '0')}`,
        async wait() {
          await new Promise((r) => setTimeout(r, 10));
          activos--;
          return { status: 1, logs: [logItemMinted(id)] };
        },
      };
    },
  };
  let consultasNonce = 0;
  const mint = crearMinter(contrato, { obtenerNonce: async () => { consultasNonce++; return 7; } });
  const item = { nombre: 'Espada Rúnica', tipo: 'Espada', rareza: 1, ataque: 12, defensa: 2 };
  const res = await Promise.all([1, 2, 3, 4, 5].map(() => mint(JUGADOR, item)));
  assert.equal(maxActivos, 1);
  assert.deepEqual(res.map((r) => r.tokenId), ['1', '2', '3', '4', '5']);
  assert.match(res[0].txHash, /^0x[0-9a-f]{64}$/);
  assert.deepEqual(llamadas[0], [JUGADOR, 'Espada Rúnica', 'Espada', 1, 12, 2, { nonce: 7 }]);
  // nonce local consecutivo, consultado al nodo una sola vez
  assert.deepEqual(llamadas.map((a) => a[6].nonce), [7, 8, 9, 10, 11]);
  assert.equal(consultasNonce, 1);
});

test('crearMinter falla si la tx revierte (status 0) y vuelve a pedir el nonce', async () => {
  const nonces = [];
  let consultas = 0;
  const contrato = {
    target: CONTRATO, interface: iface,
    async mintItem(...args) {
      nonces.push(args[6].nonce);
      return { hash: '0x' + '00'.repeat(32), async wait() { return { status: 0, logs: [] }; } };
    },
  };
  const mint = crearMinter(contrato, { obtenerNonce: async () => 3 + consultas++ });
  const item = { nombre: 'x', tipo: 'Espada', rareza: 0, ataque: 1, defensa: 0 };
  await assert.rejects(mint(JUGADOR, item));
  await assert.rejects(mint(JUGADOR, item));
  assert.deepEqual(nonces, [3, 4]);
  assert.equal(consultas, 2);
});

test('la cola sigue funcionando tras una tarea que falla', async () => {
  const cola = crearColaSerie();
  const orden = [];
  const a = cola.run(async () => { orden.push('a'); throw new Error('x'); });
  const b = cola.run(async () => { orden.push('b'); return 2; });
  await assert.rejects(a);
  assert.equal(await b, 2);
  assert.deepEqual(orden, ['a', 'b']);
});

test('mensajeError traduce códigos de ethers', () => {
  assert.match(mensajeError({ code: 'INSUFFICIENT_FUNDS' }), /ETH/);
  assert.match(mensajeError({ code: 'CALL_EXCEPTION' }), /rechazó/);
  assert.equal(mensajeError(new Error('?')), 'Error interno al acuñar el objeto');
});
