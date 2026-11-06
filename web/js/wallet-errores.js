// Errores y reintentos de las transacciones de Loot Arena (MetaMask + ethers v6 + contratos
// Mercado / LootGold / LootCosmetics). Módulo PURO: sin DOM, sin red, sin ethers.
// Lo usan economy.js (gas, red, tiempo de espera) y tienda.js (mensajes y botones).
// Probado en web/test/wallet-errores.test.js.

const GWEI = 10n ** 9n;

/** Gas de respaldo para una operación de n objetos, si la estimación falla por el RPC (no por un revert). */
export const GAS_BASE = 350000n;
export const GAS_POR_OBJETO = 120000n;
export const GAS_MAXIMO = 3000000n;
/** Tope de maxFeePerGas y de maxPriorityFeePerGas en Sepolia (gwei). Evita tarifas absurdas. */
export const MAX_FEE_GWEI = 40n;
export const MAX_PRIORITY_GWEI = 2n;
/** Umbrales de ETH para gas (wei): por debajo de BLOQUEO no se firma; por debajo de AVISO se avisa. */
export const ETH_BLOQUEO_GAS = 10n ** 14n; // 0,0001 ETH
export const ETH_AVISO_GAS = 10n ** 15n;   // 0,001 ETH
/** Espera máxima a que una transacción se mine antes de avisar (ms). */
export const TIMEOUT_TX_MS = 180000;

/** Errores personalizados de los contratos de Loot Arena (nombres, sin argumentos). */
const ERRORES_CONOCIDOS = Object.freeze([
  "SaldoInsuficiente", "ERC20InsufficientBalance", "ERC721InsufficientApproval", "ERC721InvalidOperator",
  "NoEresDueno", "ERC721IncorrectOwner", "ERC721NonexistentToken", "NoALaVenta", "CosmeticoInexistente",
  "CofreVacio", "YaReclamada", "CantidadCero", "ListaVacia", "RarezaInvalida", "SaldoEthInsuficiente",
  "ERC1155InsufficientBalance", "SoloRecompensas",
]);

/** Revert por nombre → [código, texto, acción]. */
const POR_REVERT = Object.freeze({
  SaldoInsuficiente: ["sin-oro", "No tienes ORO suficiente para esta operación.", "refrescar"],
  ERC20InsufficientBalance: ["sin-oro", "No tienes ORO suficiente para esta operación.", "refrescar"],
  ERC721InsufficientApproval: ["sin-permiso", "El Mercado no tiene permiso para mover tus objetos (¿revocaste el permiso?). Vuelve a intentarlo y acepta el permiso.", "reintentar"],
  ERC721InvalidOperator: ["sin-permiso", "El Mercado no tiene permiso para mover tus objetos (¿revocaste el permiso?). Vuelve a intentarlo y acepta el permiso.", "reintentar"],
  NoEresDueno: ["no-dueno", "Ese objeto ya no es tuyo (¿lo vendiste o transferiste?). Actualiza el inventario.", "refrescar"],
  ERC721IncorrectOwner: ["no-dueno", "Ese objeto ya no es tuyo (¿lo vendiste o transferiste?). Actualiza el inventario.", "refrescar"],
  ERC721NonexistentToken: ["no-dueno", "Ese objeto ya no existe. Actualiza el inventario.", "refrescar"],
  NoALaVenta: ["no-a-la-venta", "Ese cosmético no está a la venta ahora mismo.", null],
  CosmeticoInexistente: ["cosmetico-inexistente", "Ese cosmético no existe en el contrato.", null],
  CofreVacio: ["cofre-vacio", "No hay cosméticos disponibles para los cofres ahora mismo. No se ha cobrado nada.", null],
  YaReclamada: ["ya-reclamada", "Ya reclamaste el bono de bienvenida con esta cuenta.", "refrescar"],
  CantidadCero: ["argumentos", "La cantidad debe ser al menos 1.", null],
  ListaVacia: ["argumentos", "No has seleccionado ningún objeto.", null],
  RarezaInvalida: ["argumentos", "La rareza de ese objeto no es válida.", null],
  SaldoEthInsuficiente: ["caja-vacia", "La caja de ETH del Mercado no tiene fondos para ese pago.", null],
  ERC1155InsufficientBalance: ["sin-objetos", "No tienes unidades suficientes de ese objeto.", "refrescar"],
});

/** Texto legible de un error (mensaje corto + razón + mensaje largo), para buscar patrones. */
export function textoError(e) {
  if (typeof e === "string") return e;
  return [e?.shortMessage, e?.reason, e?.message].filter((x) => typeof x === "string" && x).join(" | ");
}

/** ¿El usuario pulsó «Rechazar» en MetaMask (EIP-1193 4001 o ACTION_REJECTED de ethers)? */
export function esRechazoUsuario(e) {
  return e?.code === 4001 || e?.code === "ACTION_REJECTED" || e?.info?.error?.code === 4001 ||
    e?.error?.code === 4001 || /user (denied|rejected)|rejected the request/i.test(textoError(e));
}

/** ¿Falta ETH para pagar el gas? */
export function esSinGas(e) {
  return e?.code === "INSUFFICIENT_FUNDS" || /insufficient funds/i.test(textoError(e));
}

/** ¿El contrato revirtió? (CALL_EXCEPTION, revert decodificado o «execution reverted»). */
export function esRevert(e) {
  return e?.code === "CALL_EXCEPTION" || !!e?.revert || /execution reverted|reverted/i.test(textoError(e));
}

/** ¿Fallo de RPC/red (la estimación no llegó al nodo)? */
export function esFalloDeRed(e) {
  if (esRechazoUsuario(e) || esSinGas(e) || esRevert(e)) return false;
  if (e?.code === "RED_INCORRECTA") return false;
  return true;
}

/** Nombre del error personalizado del contrato, si se puede averiguar (null si no). */
export function nombreRevert(e) {
  const directo = e?.revert?.name ?? e?.errorName;
  if (typeof directo === "string" && directo) return directo;
  const msg = textoError(e);
  const m = msg.match(/custom error '?"?(\w+)/i) ?? msg.match(/reverted with (?:the )?(?:custom )?error '?"?(\w+)/i);
  if (m) return m[1];
  return ERRORES_CONOCIDOS.find((n) => new RegExp(`\\b${n}\\b`).test(msg)) ?? null;
}

const esRed = (e) =>
  e?.code === "NETWORK_ERROR" || e?.code === "SERVER_ERROR" || e?.code === "TIMEOUT" ||
  /failed to fetch|network error|rate limit|too many requests|\b(429|502|503|504)\b|could not coalesce|timeout/i.test(textoError(e));

/**
 * Traduce cualquier error de una transacción a `{codigo, texto, accion}`.
 * - `codigo`: identificador estable (p. ej. "rechazado", "sin-gas", "sin-permiso", "no-dueno", "nonce"…).
 * - `texto`: mensaje en español para el usuario.
 * - `accion`: "reintentar" | "faucet" | "cambiar-red" | "aprobar" | "abrir-metamask" | "refrescar" | null.
 * @param {any} e
 * @returns {{codigo:string, texto:string, accion:string|null}}
 */
export function mensajeErrorTransaccion(e) {
  const r = (codigo, texto, accion = null) => ({ codigo, texto, accion });
  const msg = textoError(e);

  if (esRechazoUsuario(e)) return r("rechazado", "Has cancelado la operación en MetaMask. No se ha enviado nada y no pagas gas.", "reintentar");
  if (e?.code === -32002 || e?.info?.error?.code === -32002) {
    return r("pendiente-wallet", "MetaMask ya tiene una solicitud abierta. Ábrela, confírmala o recházala y vuelve a intentarlo.", "abrir-metamask");
  }
  if (e?.code === "RED_INCORRECTA") return r("red", "MetaMask está en otra red. Cambia a Sepolia para continuar.", "cambiar-red");
  if (e?.code === "TRANSACTION_REPLACED") {
    if (e.reason === "cancelled") {
      return r("cancelada", "La transacción se canceló desde MetaMask (o la sustituyó otra con el mismo número de orden). No se ha cobrado nada.", "reintentar");
    }
    return r("sustituida", "Otra transacción sustituyó a la tuya (por ejemplo, una aceleración desde MetaMask). Actualiza los saldos para ver qué pasó.", "refrescar");
  }
  if (e?.code === "NONCE_EXPIRED" || /nonce (has already been used|too low)|nonce.*too low/i.test(msg)) {
    return r("nonce", "MetaMask usa un número de orden (nonce) desfasado. Espera a que se confirmen las transacciones pendientes o borra los datos de actividad de la cuenta en MetaMask (Configuración › Avanzado) y vuelve a intentarlo.", "reintentar");
  }
  if (e?.code === "REPLACEMENT_UNDERPRICED" || /replacement (transaction )?underpriced/i.test(msg)) {
    return r("pendiente-red", "Ya tienes una transacción pendiente con ese mismo número de orden. Acelérala o cancélala en MetaMask antes de reintentar.", "abrir-metamask");
  }
  if (e?.code === "TIMEOUT") {
    return r("timeout", "La transacción sigue sin confirmarse tras varios minutos. Puede confirmarse más tarde: revísala en MetaMask o en Etherscan antes de repetirla.", "refrescar");
  }
  if (esSinGas(e)) return r("sin-gas", "No tienes ETH de Sepolia suficiente para pagar el gas.", "faucet");
  if (e?.code === "RED_CAMBIADA" || /network changed/i.test(msg)) return r("red-cambiada", "La red ha cambiado mientras operabas. Vuelve a intentarlo.", "reintentar");

  const rev = nombreRevert(e);
  if (rev && Object.hasOwn(POR_REVERT, rev)) return r(...POR_REVERT[rev]);
  if (esRevert(e)) {
    return r("revert", rev ? `El contrato rechazó la operación (${rev}).` : "El contrato rechazó la operación. Revisa el saldo, el permiso y la red.", "refrescar");
  }
  if (esRed(e)) return r("rpc", "El nodo de Sepolia no responde bien (red o demasiadas peticiones). Espera unos segundos y vuelve a intentarlo.", "reintentar");
  const corto = msg.slice(0, 160);
  return r("desconocido", corto ? `Algo salió mal: ${corto}` : "Algo salió mal. Vuelve a intentarlo.", "reintentar");
}

/**
 * Gas de respaldo (limit) para n objetos, solo si la estimación falla por el RPC.
 * @param {number|bigint} [objetos=1] @returns {bigint}
 */
export function gasRespaldo(objetos = 1) {
  const n = BigInt(Math.max(1, Math.floor(Number(objetos) || 1)));
  const g = GAS_BASE + GAS_POR_OBJETO * (n - 1n);
  return g > GAS_MAXIMO ? GAS_MAXIMO : g;
}

/** Margen del 20 % sobre una estimación de gas. @param {bigint} estimado @returns {bigint} */
export const conMargenGas = (estimado) => (BigInt(estimado) * 12n) / 10n;

const aBig = (v) => {
  if (v == null) return null;
  try { return BigInt(v); } catch { return null; }
};

/**
 * Tarifas EIP-1559 acotadas a un máximo razonable para Sepolia. Sin datos de la red → {} (valores por defecto de ethers).
 * @param {{maxFeePerGas?:any, maxPriorityFeePerGas?:any}|null} feeData
 * @returns {{maxFeePerGas?:bigint, maxPriorityFeePerGas?:bigint}}
 */
export function tarifasAcotadas(feeData, { maxFeeGwei = MAX_FEE_GWEI, maxPrioGwei = MAX_PRIORITY_GWEI } = {}) {
  const mf = aBig(feeData?.maxFeePerGas);
  if (mf == null) return {};
  const tope = maxFeeGwei * GWEI, topePrio = maxPrioGwei * GWEI;
  const maxFee = mf > tope ? tope : mf;
  const mp = aBig(feeData?.maxPriorityFeePerGas);
  let prio = mp == null || mp > topePrio ? topePrio : mp;
  if (prio > maxFee) prio = maxFee;
  return { maxFeePerGas: maxFee, maxPriorityFeePerGas: prio };
}

/**
 * Clasifica el saldo de ETH para pagar gas.
 * @param {bigint|number|string|null} eth wei
 * @returns {{nivel:"ok"|"aviso"|"bloqueo"|"desconocido"}}
 */
export function evaluarGas(eth) {
  const v = aBig(eth);
  if (v == null) return { nivel: "desconocido" };
  if (v < ETH_BLOQUEO_GAS) return { nivel: "bloqueo" };
  if (v < ETH_AVISO_GAS) return { nivel: "aviso" };
  return { nivel: "ok" };
}

/**
 * Relee hasta que `listo(valor)` sea verdadero, con esperas crecientes (los RPC públicos a veces
 * devuelven datos desfasados justo después de minar). Los errores de lectura se reintentan.
 * @template T
 * @param {() => Promise<T>} leer
 * @param {(v:T) => boolean} listo
 * @param {{intentos?:number, esperaMs?:number, dormir?:(ms:number) => Promise<void>}} [o]
 * @returns {Promise<{valor:T|undefined, ok:boolean, intentos:number}>}
 */
export async function hastaQue(leer, listo, { intentos = 5, esperaMs = 1500, dormir = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let valor;
  for (let i = 0; i < intentos; i++) {
    try {
      valor = await leer();
      if (listo(valor)) return { valor, ok: true, intentos: i + 1 };
    } catch { /* se reintenta */ }
    if (i < intentos - 1) await dormir(esperaMs * (i + 1));
  }
  return { valor, ok: false, intentos };
}
