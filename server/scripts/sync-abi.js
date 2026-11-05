// Copia el ABI generado por la Persona A (../shared/GameItem.abi.json) a server/abi/.
// Acepta tanto un array ABI puro como un artefacto de Hardhat ({ abi: [...] }).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Interface } from 'ethers';

const here = dirname(fileURLToPath(import.meta.url));
const origen = resolve(here, '../../shared/GameItem.abi.json');
const destino = resolve(here, '../abi/GameItem.abi.json');

if (!existsSync(origen)) {
  console.error(`✗ No existe ${origen}. ¿Ha compilado/desplegado ya la Persona A el contrato?`);
  console.error('  Se mantiene el ABI mínimo escrito a mano en server/abi/.');
  process.exit(1);
}

let abi = JSON.parse(readFileSync(origen, 'utf8'));
if (!Array.isArray(abi) && Array.isArray(abi?.abi)) abi = abi.abi;
if (!Array.isArray(abi)) {
  console.error('✗ El archivo no contiene un array ABI válido.');
  process.exit(1);
}

// Comprobación de que las firmas coinciden con SPEC.md
const iface = new Interface(abi);
const requeridos = [
  ['function', 'mintItem(address,string,string,uint8,uint16,uint16)'],
  ['function', 'getItem(uint256)'],
  ['event', 'ItemMinted(address,uint256,string,string,uint8,uint16,uint16)'],
];
const faltan = requeridos.filter(([tipo, firma]) =>
  tipo === 'function' ? !iface.getFunction(firma) : !iface.getEvent(firma),
);
if (faltan.length) {
  console.error('✗ El ABI no cumple SPEC.md, faltan:', faltan.map(([, f]) => f).join(', '));
  process.exit(1);
}

writeFileSync(destino, JSON.stringify(abi, null, 2) + '\n');
console.log(`✓ ABI copiado (${abi.length} entradas) → ${destino}`);
