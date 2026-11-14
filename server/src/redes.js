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

/**
 * Nombre de la variable de entorno que elige la red.
 *
 * NO se llama `RED` a secas, y la razón es una avería real del 14-nov-2026: `RED` es el
 * nombre que usan incontables scripts de shell para el código ANSI del color rojo
 * (`RED='\033[0;31m'`). El entorno de Render lo tenía exportado, el servidor lo leyó como
 * nombre de red y acabó con `red = "\u001b[31m"`, lo que además **desactivó en silencio la
 * comprobación de chainId** y guardó el estado en claves basura. Un nombre de tres letras
 * tan común no es un buen nombre de variable.
 */
export const VAR_RED = 'RED_BLOCKCHAIN';
/** Nombre antiguo, que se sigue aceptando si trae un valor con pinta de red. */
export const VAR_RED_ANTIGUA = 'RED';

/**
 * Forma válida de un nombre de red: letras, números y guiones. Cualquier otra cosa
 * (códigos de escape, espacios raros, caracteres de control) NO es una red, y tratarla
 * como "una red desconocida más" es justo lo que hizo daño.
 */
export const FORMA_RED = /^[a-z0-9][a-z0-9-]*$/;

/** Nombre de red → clave normalizada (minúsculas, espacios y guiones bajos a guiones). */
export function normalizarRed(valor) {
  return String(valor ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-');
}

/** ¿Tiene pinta de nombre de red? (para decidir si fiarse del `RED` antiguo). */
export function pareceRed(valor) {
  return FORMA_RED.test(normalizarRed(valor));
}

/**
 * Elige la red a partir del entorno: `RED_BLOCKCHAIN` y, si no está, el antiguo `RED`
 * **solo cuando su valor tiene pinta de red** (así un `RED` con el color de la terminal
 * se ignora en vez de colarse).
 */
export function redDelEntorno(env = process.env, limpiar = (v) => String(v ?? '').trim()) {
  const nuevo = limpiar(env[VAR_RED]);
  if (nuevo) return { valor: nuevo, variable: VAR_RED };
  const antiguo = limpiar(env[VAR_RED_ANTIGUA]);
  if (!antiguo) return { valor: '', variable: null };
  if (pareceRed(antiguo)) return { valor: antiguo, variable: VAR_RED_ANTIGUA };
  // Valor imposible en `RED`: casi seguro el color de la terminal, no una red.
  return { valor: '', variable: VAR_RED_ANTIGUA, ignorado: antiguo };
}

/**
 * Datos de la red pedida.
 *
 * - Nombre vacío → la red por defecto.
 * - Nombre con forma válida pero desconocido → se acepta (red privada), `conocida: false`,
 *   y entonces no se puede comprobar el chainId del nodo.
 * - Nombre con forma IMPOSIBLE → **no se acepta**: se vuelve a la red por defecto y se
 *   marca `invalido`, para que se vea y para no perder la comprobación del chainId.
 *
 * @returns {{ clave: string, nombre: string, chainId: number | null, moneda: string,
 *   explorador: string | null, conocida: boolean, invalido?: string }}
 */
export function resolverRed(valor) {
  const bruto = normalizarRed(valor);
  if (bruto && !FORMA_RED.test(bruto)) {
    // `JSON.stringify` escapa los caracteres de control, así que el aviso no "pinta" el log.
    return { clave: RED_POR_DEFECTO, ...REDES[RED_POR_DEFECTO], conocida: true, invalido: JSON.stringify(bruto) };
  }
  const clave = bruto || RED_POR_DEFECTO;
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
  // `red.clave` ya viene validada por `resolverRed`: nunca mete caracteres raros en
  // las claves del almacén (en producción llegó a quedar "loot-arena:\u001b[31m:").
  return `${conDosPuntos}${red.clave}:`;
}
