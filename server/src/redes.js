// Red de trabajo del servidor (fase E4). Hasta la 1.4 todo daba Sepolia por supuesto;
// aquí la red pasa a ser un parámetro.
//
// El servidor atiende UNA red a la vez (la que diga `RED`), no varias en paralelo: en el
// plan gratuito de Render hay una sola instancia y un solo juego de variables, y mezclar
// redes en un mismo proceso obligaría a duplicar wallet, nonce y grifo. Para una segunda
// red se levanta un segundo servicio con sus propias variables.
//
// Lo que sí se garantiza: nada de Sepolia escrito a fuego, el chainId se comprueba contra
// el que dice el nodo, y el estado guardado (índice del ranking, rachas, torre…) va con
// el nombre de la red en la clave, así que dos redes NUNCA se mezclan en el almacén.

/** Redes conocidas. Una red que no esté aquí se admite igual: solo se pierde la comprobación. */
export const REDES = Object.freeze({
  sepolia: Object.freeze({
    nombre: 'Sepolia', chainId: 11155111, moneda: 'SepoliaETH',
    explorador: 'https://sepolia.etherscan.io',
  }),
  'arbitrum-sepolia': Object.freeze({
    nombre: 'Arbitrum Sepolia', chainId: 421614, moneda: 'ETH',
    explorador: 'https://sepolia.arbiscan.io',
  }),
  'base-sepolia': Object.freeze({
    nombre: 'Base Sepolia', chainId: 84532, moneda: 'ETH',
    explorador: 'https://sepolia.basescan.org',
  }),
  'optimism-sepolia': Object.freeze({
    nombre: 'OP Sepolia', chainId: 11155420, moneda: 'ETH',
    explorador: 'https://sepolia-optimism.etherscan.io',
  }),
  localhost: Object.freeze({
    nombre: 'Hardhat local', chainId: 31337, moneda: 'ETH', explorador: null,
  }),
});

export const RED_POR_DEFECTO = 'sepolia';

/** Nombre de red → clave normalizada (minúsculas, espacios y guiones bajos a guiones). */
export function normalizarRed(valor) {
  return String(valor ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-');
}

/**
 * Datos de la red pedida. Una red desconocida no es un error: se devuelve con
 * `conocida: false` y `chainId: null`, y entonces no se puede comprobar el nodo.
 * @returns {{ clave: string, nombre: string, chainId: number | null, moneda: string, explorador: string | null, conocida: boolean }}
 */
export function resolverRed(valor) {
  const clave = normalizarRed(valor) || RED_POR_DEFECTO;
  const info = REDES[clave];
  if (!info) {
    return { clave, nombre: clave, chainId: null, moneda: 'ETH', explorador: null, conocida: false };
  }
  return { clave, ...info, conocida: true };
}

/**
 * ¿El nodo está en la red que creemos? Devuelve un mensaje de error o null.
 * Apuntar a la red equivocada con las direcciones de otra es el fallo más caro posible
 * (se acuñaría sobre contratos que no son), así que esto para el arranque.
 */
export function comprobarChainId(red, chainIdDelNodo) {
  if (!red.conocida || red.chainId === null) return null;
  if (Number(chainIdDelNodo) === red.chainId) return null;
  const otra = Object.entries(REDES).find(([, i]) => i.chainId === Number(chainIdDelNodo));
  return `RED=${red.clave} esperaba chainId ${red.chainId} (${red.nombre}) pero el nodo de RPC_URL responde ${chainIdDelNodo}`
    + (otra ? `, que es ${otra[1].nombre}. ¿RPC_URL apunta a la red equivocada?` : '. ¿RPC_URL apunta a la red equivocada?');
}

/**
 * Prefijo de las claves del almacén para esta red. SIEMPRE lleva la red dentro, aunque
 * se haya puesto `ALMACEN_PREFIJO` a mano: así dos despliegues en redes distintas pueden
 * compartir la misma base gratuita sin pisarse el índice ni las rachas.
 */
export function prefijoDeRed(prefijoBase, red) {
  const base = String(prefijoBase ?? '').trim() || 'loot-arena:';
  const conDosPuntos = base.endsWith(':') ? base : `${base}:`;
  return `${conDosPuntos}${red.clave}:`;
}
