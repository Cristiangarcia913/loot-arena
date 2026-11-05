// Economía de Loot Arena (MEJORAS.md §5 y §6): ORO (ERC-20), cosméticos (ERC-1155) y Mercado.
//
// Este módulo NO toca el DOM. Tiene tres partes:
//   1. Constantes y funciones puras (precio de venta, catálogo, apariencia, parseo de saldos)
//      → probadas con `node --test` en web/test/economy.test.js.
//   2. Resolución de direcciones y ABI (config/deployments.json y, si existen, *.abi.json).
//   3. Dos "economías" con la misma interfaz: `crearEconomiaChain` (ethers v6 + MetaMask)
//      y `crearEconomiaSimulada` (en memoria, para el modo demo y tienda-demo.html).

// ───────────────────────── 1. Constantes ─────────────────────────

/** Base del precio de venta por rareza (Común, Raro, Legendario). Igual que en Mercado.sol. */
export const BASE_VENTA = Object.freeze([10, 40, 200]);
/** Precio del cofre cosmético en ORO (se intenta leer del contrato; esto es el valor por defecto). */
export const PRECIO_COFRE = 120;
/** Bono de bienvenida en ORO. */
export const ORO_BIENVENIDA = 50;
/** Probabilidad de cada rareza al abrir un cofre (0 común, 1 rara, 2 legendaria). */
export const PROB_COFRE = Object.freeze([0.60, 0.32, 0.08]);
/** Id del consumible "Poción extra". */
export const ID_POCION = 14;
/** Decimales de ORO. */
export const DECIMALES_ORO = 18;
/** Ranuras de apariencia, en el orden en que se muestran. */
export const RANURAS = Object.freeze(["color", "sombrero", "capa", "aura", "mascota"]);
export const NOMBRE_RANURA = Object.freeze({
  color: "Color de armadura", sombrero: "Sombrero", capa: "Capa", aura: "Aura", mascota: "Mascota", consumible: "Consumible",
});
/** Rarezas de cosméticos (femenino: "pieza común / rara / legendaria"). */
export const RAREZAS_COSMETICO = Object.freeze([
  Object.freeze({ id: 0, nombre: "Común", clase: "comun", color: "#9ca3af" }),
  Object.freeze({ id: 1, nombre: "Rara", clase: "rara", color: "#3b82f6" }),
  Object.freeze({ id: 2, nombre: "Legendaria", clase: "legendaria", color: "#f59e0b" }),
]);
/** ETH de Sepolia (wei) que paga la caja del Mercado por vender, según rareza: 0.0001 / 0.0005 / 0.002. */
export const RECOMPENSA_ETH = Object.freeze([10n ** 14n, 5n * 10n ** 14n, 2n * 10n ** 15n]);
/** Máximo de ETH (wei) que la caja paga por dirección y día: 0.005 ETH. */
export const MAX_ETH_DIARIO = 5n * 10n ** 15n;
/** Faucet de ETH de Sepolia (Google Cloud Web3). */
export const FAUCET_SEPOLIA = "https://cloud.google.com/application/web3/faucet/ethereum/sepolia";
/** Por debajo de este saldo de ETH (0,001) se avisa de que puede faltar gas. */
export const ETH_MINIMO_GAS = 10n ** 15n;

const c = (id, ranura, nombre, rareza, precio, icono, tono) =>
  Object.freeze({ id, ranura, nombre, rareza, precio, icono, tono });

/**
 * Catálogo inicial de cosméticos (MEJORAS.md §5, fuente de verdad).
 * `icono` y `tono` solo se usan en la previsualización de reserva cuando `fx.js` no la ofrece.
 * @type {ReadonlyArray<{id:number, ranura:string, nombre:string, rareza:0|1|2, precio:number, icono:string, tono:string}>}
 */
export const CATALOGO = Object.freeze([
  c(1, "color", "Armadura carmesí", 0, 60, "🟥", "#b91c1c"),
  c(2, "color", "Armadura esmeralda", 0, 60, "🟩", "#059669"),
  c(3, "color", "Armadura obsidiana", 1, 150, "⬛", "#312e46"),
  c(4, "sombrero", "Capucha del cazador", 0, 80, "🏹", "#4d6b3c"),
  c(5, "sombrero", "Yelmo con cuernos", 1, 180, "🪖", "#8a8f99"),
  c(6, "sombrero", "Corona del campeón", 2, 600, "👑", "#f5c542"),
  c(7, "capa", "Capa de viajero", 0, 90, "🧥", "#7c5a3a"),
  c(8, "capa", "Capa real púrpura", 1, 220, "🟪", "#7e22ce"),
  c(9, "capa", "Alas de fénix", 2, 800, "🪽", "#f97316"),
  c(10, "aura", "Aura de escarcha", 1, 250, "❄️", "#7dd3fc"),
  c(11, "aura", "Aura de llamas", 2, 700, "🔥", "#f97316"),
  c(12, "mascota", "Gato negro", 1, 300, "🐈‍⬛", "#27272a"),
  c(13, "mascota", "Mini dragón", 2, 900, "🐉", "#dc2626"),
  c(14, "consumible", "Poción extra", 0, 25, "🧪", "#ef4444"),
]);

const POR_ID = new Map(CATALOGO.map((x) => [x.id, x]));
/** Ids del catálogo, en orden. */
export const IDS_CATALOGO = Object.freeze(CATALOGO.map((x) => x.id));

/** @param {number|string|bigint} id @returns {typeof CATALOGO[number] | null} */
export function cosmetico(id) {
  return POR_ID.get(Number(id)) ?? null;
}

/** Cosméticos que puede dar un cofre (todos menos consumibles), agrupados por rareza. */
export function poolCofre(catalogo = CATALOGO) {
  const pool = [[], [], []];
  for (const x of catalogo) if (x.ranura !== "consumible") pool[x.rareza]?.push(x.id);
  return pool;
}

/**
 * Tirada local de cofre (solo para la economía simulada; en cadena decide el contrato).
 * Elige rareza con PROB_COFRE y luego un cosmético uniforme de esa rareza.
 * @param {() => number} rng en [0,1)
 * @returns {number} id del cosmético
 */
export function tirarCofre(rng = Math.random) {
  const pool = poolCofre();
  let r = rng(), rareza = 0;
  for (; rareza < PROB_COFRE.length - 1; rareza++) {
    if (r < PROB_COFRE[rareza]) break;
    r -= PROB_COFRE[rareza];
  }
  const lista = pool[rareza];
  return lista[Math.min(lista.length - 1, Math.floor(rng() * lista.length))];
}

// ───────────────────────── Precio de venta ─────────────────────────

/**
 * Precio de venta de un objeto en ORO (entero), con la misma fórmula que `Mercado.precioVenta`:
 * `BASE_VENTA[rareza] + 2 × (ataque + defensa)`.
 * @param {{rareza:number|string, ataque:number|string, defensa:number|string}} item
 * @returns {number}
 * @throws {RangeError} si la rareza no es 0, 1 o 2 o las stats no son enteros ≥ 0
 */
export function precioVentaLocal(item) {
  const rareza = Number(item?.rareza), ataque = Number(item?.ataque), defensa = Number(item?.defensa);
  if (!Number.isInteger(rareza) || rareza < 0 || rareza >= BASE_VENTA.length) throw new RangeError(`Rareza inválida: ${item?.rareza}`);
  for (const v of [ataque, defensa]) if (!Number.isInteger(v) || v < 0) throw new RangeError("Stats inválidas");
  return BASE_VENTA[rareza] + 2 * (ataque + defensa);
}

/** Suma de precios locales de varios objetos. */
export function precioVentaTotal(items) {
  return items.reduce((s, it) => s + precioVentaLocal(it), 0);
}

/**
 * ETH (wei) que se cobraría por vender `item` si la caja tiene fondos, con la tabla por defecto.
 * @param {{rareza:number|string}} item @param {ReadonlyArray<bigint>} [tabla]
 * @returns {bigint}
 */
export function recompensaEthLocal(item, tabla = RECOMPENSA_ETH) {
  const r = Number(item?.rareza);
  if (!Number.isInteger(r) || r < 0 || r >= tabla.length) throw new RangeError(`Rareza inválida: ${item?.rareza}`);
  return aBigInt(tabla[r]);
}

/**
 * Estima el ETH que pagará una venta (uno o varios objetos, en orden). Cada objeto cobra su
 * recompensa completa solo si la caja y el cupo diario restante la cubren; si no, ese objeto
 * paga solo ORO (la venta no revierte). El valor real llega en el evento `ItemVendido`.
 * @param {Array<bigint|number|string>} recompensas  wei por objeto
 * @param {{caja?:bigint|null, restanteHoy?:bigint|null}} [o]  null/undefined = sin límite conocido
 * @returns {{total:bigint, porObjeto:bigint[], soloOro:boolean[]}}
 */
export function estimarEthVenta(recompensas, { caja = null, restanteHoy = null } = {}) {
  let quedaCaja = caja == null ? null : aBigInt(caja);
  let quedaHoy = restanteHoy == null ? null : aBigInt(restanteHoy);
  const porObjeto = [], soloOro = [];
  let total = 0n;
  for (const raw of recompensas) {
    const r = aBigInt(raw);
    const cabe = r > 0n && (quedaCaja == null || quedaCaja >= r) && (quedaHoy == null || quedaHoy >= r);
    const pago = cabe ? r : 0n;
    if (quedaCaja != null) quedaCaja -= pago;
    if (quedaHoy != null) quedaHoy -= pago;
    total += pago;
    porObjeto.push(pago);
    soloOro.push(!cabe);
  }
  return { total, porObjeto, soloOro };
}

/**
 * Suma los eventos `ItemVendido(jugador, tokenId, oro, eth)` de una venta.
 * @param {Array<{tokenId:any, oro:any, eth?:any}>} eventos
 * @returns {{oro:bigint, eth:bigint, tokenIds:string[]}}
 */
export function sumarVentas(eventos) {
  let oro = 0n, eth = 0n;
  const tokenIds = [];
  for (const ev of eventos) {
    oro += aBigInt(ev.oro ?? 0n);
    eth += aBigInt(ev.eth ?? 0n);
    tokenIds.push(String(ev.tokenId));
  }
  return { oro, eth, tokenIds };
}

/** Día on-chain usado por el límite diario (`block.timestamp / 1 days`). */
export const diaOnChain = (ms = Date.now()) => Math.floor(ms / 86_400_000);

// ───────────────────────── Cantidades de ORO ─────────────────────────

const UNIDAD = 10n ** BigInt(DECIMALES_ORO);

/** Convierte cualquier entero (bigint, número, string decimal o hex, BigNumber-like) a bigint. */
export function aBigInt(v) {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new RangeError("Número no finito");
    return BigInt(Math.trunc(v));
  }
  if (typeof v === "string" && v.trim() !== "") return BigInt(v.trim());
  if (v != null && typeof v.toString === "function" && /^-?(0x[0-9a-f]+|\d+)$/i.test(String(v))) return BigInt(String(v));
  throw new TypeError(`No es un entero: ${v}`);
}

/** ORO entero → unidades base (18 decimales). */
export function aUnidades(oro) {
  return aBigInt(oro) * UNIDAD;
}

/** Unidades base → ORO entero (trunca decimales). */
export function oroEntero(unidades) {
  return Number(aBigInt(unidades) / UNIDAD);
}

/**
 * Formatea unidades base de ORO para mostrar ("1.250", "12,5").
 * @param {bigint|number|string} unidades
 * @param {{decimales?:number}} [o] decimales visibles como máximo (por defecto 0; se recortan ceros)
 */
export function formatearOro(unidades, { decimales = 0 } = {}) {
  const v = aBigInt(unidades);
  const neg = v < 0n, abs = neg ? -v : v;
  const entero = abs / UNIDAD;
  let txt = new Intl.NumberFormat("es-ES", { useGrouping: "always" }).format(entero);
  if (decimales > 0) {
    const frac = (abs % UNIDAD).toString().padStart(DECIMALES_ORO, "0").slice(0, decimales).replace(/0+$/, "");
    if (frac) txt += `,${frac}`;
  }
  return (neg ? "-" : "") + txt;
}

/**
 * Formatea wei de ETH ("0,0005"). Recorta ceros finales; 0 → "0".
 * @param {bigint|number|string} wei @param {{decimales?:number}} [o] máximo de decimales (por defecto 4)
 */
export function formatearEth(wei, { decimales = 4 } = {}) {
  const v = aBigInt(wei);
  const neg = v < 0n, abs = neg ? -v : v;
  const ent = abs / UNIDAD;
  const frac = (abs % UNIDAD).toString().padStart(DECIMALES_ORO, "0").slice(0, decimales).replace(/0+$/, "");
  return (neg ? "-" : "") + ent.toString() + (frac ? `,${frac}` : "");
}

/**
 * Normaliza un precio devuelto por el contrato a ORO entero. Acepta tanto ORO entero (p. ej. 54n)
 * como unidades base (54n × 10¹⁸): cualquier valor ≥ 10¹² se interpreta como unidades base.
 * @returns {number}
 */
export function normalizarPrecio(raw) {
  const v = aBigInt(raw);
  return v >= 10n ** 12n ? Number(v / UNIDAD) : Number(v);
}

/**
 * Convierte la salida de `balanceOfBatch` en un mapa id → cantidad (solo cantidades > 0).
 * @param {Array<number|string|bigint>} ids
 * @param {Array<number|string|bigint>} saldos
 * @returns {Record<number, number>}
 */
export function parsearSaldos(ids, saldos) {
  if (!Array.isArray(ids) || !saldos || ids.length !== saldos.length) throw new TypeError("ids y saldos deben tener la misma longitud");
  const out = {};
  ids.forEach((id, i) => {
    const n = Number(aBigInt(saldos[i]));
    if (n > 0) out[Number(id)] = n;
  });
  return out;
}

// ───────────────────────── Apariencia (vestuario) ─────────────────────────

/** @typedef {{color:number|null, sombrero:number|null, capa:number|null, aura:number|null, mascota:number|null}} Apariencia */

/** @returns {Apariencia} */
export function aparienciaVacia() {
  return { color: null, sombrero: null, capa: null, aura: null, mascota: null };
}

/**
 * Equipa un cosmético en su ranura (sustituye al que hubiera). Los consumibles no se equipan.
 * @param {Apariencia} ap @param {number} id @returns {Apariencia} nueva apariencia
 */
export function equiparCosmetico(ap, id) {
  const cos = cosmetico(id);
  if (!cos || !RANURAS.includes(cos.ranura)) throw new RangeError(`El cosmético ${id} no se puede equipar`);
  return { ...aparienciaVacia(), ...ap, [cos.ranura]: cos.id };
}

/** Vacía una ranura. @returns {Apariencia} */
export function quitarRanura(ap, ranura) {
  if (!RANURAS.includes(ranura)) throw new RangeError(`Ranura desconocida: ${ranura}`);
  return { ...aparienciaVacia(), ...ap, [ranura]: null };
}

/**
 * Limpia una apariencia: cada ranura solo puede tener un id del catálogo de esa ranura y,
 * si se pasan `saldos`, que la cuenta posea (cantidad > 0).
 * @param {any} ap @param {Record<number,number>} [saldos] @returns {Apariencia}
 */
export function sanearApariencia(ap, saldos) {
  const limpio = aparienciaVacia();
  if (!ap || typeof ap !== "object") return limpio;
  for (const ranura of RANURAS) {
    const v = ap[ranura];
    if (v == null) continue;
    const cos = cosmetico(v);
    if (!cos || cos.ranura !== ranura || !Number.isInteger(Number(v))) continue;
    if (saldos && !(saldos[cos.id] > 0)) continue;
    limpio[ranura] = cos.id;
  }
  return limpio;
}

/** Parsea una apariencia guardada (JSON); ante datos corruptos devuelve la vacía. */
export function parsearApariencia(texto) {
  try { return sanearApariencia(JSON.parse(texto)); } catch { return aparienciaVacia(); }
}

/** Clave de localStorage por dirección (en minúsculas). Sin cuenta → "invitado". */
export function claveApariencia(cuenta) {
  return `lootarena:apariencia:${cuenta ? String(cuenta).toLowerCase() : "invitado"}`;
}

/** Storage tolerante a fallos (modo privado, tests sin localStorage…). */
function storagePorDefecto() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

/** @param {string|null} cuenta @param {Storage} [storage] @returns {Apariencia} */
export function cargarApariencia(cuenta, storage = storagePorDefecto()) {
  try { return parsearApariencia(storage?.getItem(claveApariencia(cuenta)) ?? "null"); } catch { return aparienciaVacia(); }
}

/** @param {string|null} cuenta @param {Apariencia} ap @param {Storage} [storage] */
export function guardarApariencia(cuenta, ap, storage = storagePorDefecto()) {
  try { storage?.setItem(claveApariencia(cuenta), JSON.stringify(sanearApariencia(ap))); } catch { /* sin almacenamiento */ }
}

/** ¿Hay alguna ranura ocupada? */
export const aparienciaVaciaQ = (ap) => RANURAS.every((r) => ap?.[r] == null);

// ───────────────────────── Errores ─────────────────────────

/**
 * Traduce errores de MetaMask/ethers/contratos a un mensaje en español.
 * @returns {{texto:string, gas:boolean, rechazado:boolean}}
 */
export function mensajeErrorEconomia(e) {
  const code = e?.code ?? e?.info?.error?.code ?? e?.error?.code;
  const msg = String(e?.shortMessage || e?.message || e || "");
  const revert = e?.revert?.name ?? "";
  if (code === 4001 || code === "ACTION_REJECTED") return { texto: "Has cancelado la operación en MetaMask.", gas: false, rechazado: true };
  if (code === -32002) return { texto: "Ya hay una solicitud pendiente: abre MetaMask para continuar.", gas: false, rechazado: false };
  if (code === "INSUFFICIENT_FUNDS" || /insufficient funds/i.test(msg)) {
    return { texto: "No tienes ETH suficiente para pagar el gas de la transacción.", gas: true, rechazado: false };
  }
  if (/ERC20InsufficientBalance|SaldoInsuficiente/.test(revert + msg) || /saldo insuficiente|oro insuficiente/i.test(msg)) {
    return { texto: "No tienes ORO suficiente.", gas: false, rechazado: false };
  }
  if (/ERC721InsufficientApproval|ERC721InvalidApprover|not approved|aprobaci/i.test(revert + msg)) {
    return { texto: "El Mercado no tiene permiso para recoger tus objetos. Vuelve a intentarlo y acepta el permiso.", gas: false, rechazado: false };
  }
  if (/ERC721IncorrectOwner|ERC721NonexistentToken|NoEresDueno|no eres (el )?due/i.test(revert + msg)) {
    return { texto: "Ese objeto ya no es tuyo (¿lo vendiste o transferiste?). Refresca el inventario.", gas: false, rechazado: false };
  }
  if (/bienvenida|YaReclamada/i.test(revert + msg)) return { texto: "Ya reclamaste el bono de bienvenida.", gas: false, rechazado: false };
  if (code === "CALL_EXCEPTION") {
    const motivo = e?.reason || revert;
    return { texto: `El contrato rechazó la operación${motivo ? `: ${motivo}` : ""}.`, gas: false, rechazado: false };
  }
  return { texto: msg || "Error desconocido.", gas: false, rechazado: false };
}

// ───────────────────────── 2. Direcciones y ABI ─────────────────────────

/** ABI mínimos "human-readable" según la interfaz de §5 (se usan si no hay *.abi.json). */
export const ABI_ORO = Object.freeze([
  "function balanceOf(address cuenta) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);
export const ABI_COSMETICOS = Object.freeze([
  "function balanceOf(address cuenta, uint256 id) view returns (uint256)",
  "function balanceOfBatch(address[] cuentas, uint256[] ids) view returns (uint256[])",
  "function uri(uint256 id) view returns (string)",
  "function burn(address cuenta, uint256 id, uint256 valor)",
  "event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)",
]);
export const ABI_MERCADO = Object.freeze([
  "function precioVenta(uint256 tokenId) view returns (uint256)",
  "function venderItem(uint256 tokenId)",
  "function venderVarios(uint256[] tokenIds)",
  "function comprarCosmetico(uint256 id, uint256 cantidad)",
  "function abrirCofre()",
  "function reclamarBienvenida()",
  "function bienvenidaReclamada(address jugador) view returns (bool)",
  "function PRECIO_COFRE() view returns (uint256)",
  "function cosmetico(uint256 id) view returns (tuple(string nombre, string ranura, uint8 rareza, uint256 precio, bool enCofre))",
  "function recompensaEth(uint256 rareza) view returns (uint256)",
  "function cajaEth() view returns (uint256)",
  "function maxEthDiario() view returns (uint256)",
  "event ItemVendido(address indexed jugador, uint256 indexed tokenId, uint256 oro, uint256 eth)",
  "event CosmeticoComprado(address indexed jugador, uint256 indexed id, uint256 cantidad, uint256 oro)",
  "event CofreAbierto(address indexed jugador, uint256 indexed id)",
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  "error ERC721InsufficientApproval(address operator, uint256 tokenId)",
  "error ERC721IncorrectOwner(address sender, uint256 tokenId, address owner)",
  "error NoEresDueno(uint256 tokenId, address dueno)",
  "error SaldoInsuficiente(uint256 tienes, uint256 necesitas)",
  "error YaReclamada()",
]);
export const ABI_GAMEITEM_APROBACION = Object.freeze([
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
  "function setApprovalForAll(address operator, bool approved)",
]);

const RE_DIR = /^0x[0-9a-fA-F]{40}$/;
/** ¿Dirección con formato válido y distinta de 0x000…0? */
export function direccionValida(a) {
  return typeof a === "string" && RE_DIR.test(a) && !/^0x0{40}$/i.test(a);
}

/**
 * Extrae las direcciones de economía de un objeto de despliegues para la red `red`.
 * @returns {{oro:string, cosmeticos:string, mercado:string} | null} null si falta alguna
 */
export function direccionesDe(deployments, red) {
  const d = deployments?.[red];
  if (!d) return null;
  const dir = { oro: d.oro, cosmeticos: d.cosmeticos, mercado: d.mercado };
  return Object.values(dir).every(direccionValida) ? dir : null;
}

/**
 * Direcciones de economía de la red activa. Prioridad: `cfg.economia` → `cfg.oro/cosmeticos/mercado`
 * → `config/deployments.json` (claves `oro`, `cosmeticos`, `mercado` de `cfg.red`).
 * @param {{red?:string, economia?:object, oro?:string, cosmeticos?:string, mercado?:string}} cfg
 * @param {{fetch?:typeof fetch, base?:string|URL}} [o]
 * @returns {Promise<{oro:string, cosmeticos:string, mercado:string} | null>}
 */
export async function resolverDirecciones(cfg, { fetch: f = globalThis.fetch, base = import.meta.url } = {}) {
  const red = cfg?.red ?? "sepolia";
  for (const fuente of [cfg?.economia, cfg]) {
    const d = fuente && direccionesDe({ [red]: fuente }, red);
    if (d) return d;
  }
  if (!f) return null;
  try {
    const res = await f(new URL("../config/deployments.json", base), { cache: "no-cache" });
    return res.ok ? direccionesDe(await res.json(), red) : null;
  } catch { return null; }
}

/** Acepta un array ABI o un artefacto de Hardhat `{abi:[...]}`. */
export function abiDe(datos) {
  const abi = Array.isArray(datos) ? datos : datos?.abi;
  return Array.isArray(abi) ? abi : null;
}

const nombreFragmento = (f) => (typeof f === "string" ? f.match(/^\s*(?:function|event|error)\s+(\w+)/)?.[1] : f?.name) ?? null;

/**
 * Une un ABI completo (prioritario) con el mínimo: añade solo fragmentos cuyo nombre no exista.
 * Así, si el contrato real usa otros nombres, las llamadas de reserva fallan y se degradan.
 */
export function unirAbi(completo, minimo) {
  if (!completo) return [...minimo];
  const nombres = new Set(completo.map(nombreFragmento).filter(Boolean));
  return [...completo, ...minimo.filter((f) => !nombres.has(nombreFragmento(f)))];
}

/**
 * Carga los ABI de economía: primero `config/<Nombre>.abi.json` (copiados de /shared), luego
 * `../shared/<Nombre>.abi.json` (desarrollo local), y si no, los mínimos de arriba.
 * @returns {Promise<{oro:any[], cosmeticos:any[], mercado:any[], completos:{oro:boolean,cosmeticos:boolean,mercado:boolean}}>}
 */
export async function cargarAbis({ fetch: f = globalThis.fetch, base = import.meta.url } = {}) {
  const leer = async (nombre) => {
    if (!f) return null;
    for (const ruta of [`../config/${nombre}`, `../../shared/${nombre}`]) {
      try {
        const res = await f(new URL(ruta, base), { cache: "no-cache" });
        if (res.ok) { const abi = abiDe(await res.json()); if (abi) return abi; }
      } catch { /* siguiente */ }
    }
    return null;
  };
  const [oro, cos, mer] = await Promise.all(["LootGold.abi.json", "LootCosmetics.abi.json", "Mercado.abi.json"].map(leer));
  return {
    oro: unirAbi(oro, ABI_ORO),
    cosmeticos: unirAbi(cos, ABI_COSMETICOS),
    mercado: unirAbi(mer, ABI_MERCADO),
    completos: { oro: !!oro, cosmeticos: !!cos, mercado: !!mer },
  };
}

// ───────────────────────── 3. Economías ─────────────────────────

/**
 * @typedef {object} Operacion  transacción enviada
 * @property {string} hash
 * @property {() => Promise<any>} esperar  resuelve al minarse (con el resultado de la operación)
 */

/**
 * @typedef {object} Economia  interfaz común (cadena o simulada)
 * @property {"chain"|"simulada"} modo
 * @property {{oro:string, cosmeticos:string, mercado:string}|null} direcciones
 * @property {() => Promise<bigint>} saldoOro          unidades base
 * @property {() => Promise<bigint|null>} saldoEth     wei (null si no se sabe)
 * @property {(item:{tokenId:string}) => Promise<number>} precioVenta  ORO entero
 * @property {(item:{tokenId:string, rareza:number}) => Promise<bigint>} recompensaEth  wei que paga la caja por ese objeto
 * @property {() => Promise<{caja:bigint|null, max:bigint, pagadoHoy:bigint|null}>} infoEth  estado de la caja y cupo diario
 * @property {() => Promise<boolean>} aprobado         ¿Mercado aprobado en GameItem?
 * @property {() => Promise<Operacion>} aprobar
 * @property {(tokenIds:string[]) => Promise<Operacion>} vender  `esperar()` → {oro, eth, tokenIds} reales (o null si no hay eventos)
 * @property {(id:number, cantidad:number) => Promise<Operacion>} comprar
 * @property {() => Promise<Operacion>} abrirCofre     `esperar()` resuelve con el id obtenido (o null)
 * @property {() => Promise<number>} precioCofre
 * @property {(id:number) => Promise<number>} precioCosmetico
 * @property {() => Promise<Record<number,number>>} cosmeticos  id → cantidad
 * @property {() => Promise<boolean|null>} bienvenidaReclamada  null = no se puede saber
 * @property {() => Promise<Operacion>} reclamarBienvenida
 * @property {(n:number) => Promise<Operacion>} gastarPociones  quema n pociones (id 14)
 * @property {() => Promise<boolean>} anadirAMetaMask   wallet_watchAsset
 */

const buscarFn = (contrato, pred) => contrato.interface.fragments.find((f) => f.type === "function" && pred(f)) ?? null;

/**
 * Economía en cadena con ethers v6.
 * @param {{ethers:any, provider:any, signer:any, cuenta:string, cfg:{address:string, abi?:any[]},
 *          direcciones:{oro:string,cosmeticos:string,mercado:string}, abis:Awaited<ReturnType<typeof cargarAbis>>,
 *          eip1193?:{request:Function}}} o
 * @returns {Economia}
 */
export function crearEconomiaChain({ ethers, provider, signer, cuenta, cfg, direcciones, abis, eip1193 }) {
  const C = ethers.Contract;
  const oro = new C(direcciones.oro, abis.oro, provider);
  const cos = new C(direcciones.cosmeticos, abis.cosmeticos, provider);
  const mer = new C(direcciones.mercado, abis.mercado, provider);
  const item = new C(cfg.address, unirAbi(abiDe(cfg.abi), ABI_GAMEITEM_APROBACION), provider);
  const conFirma = (k) => k.connect(signer);

  /** Envuelve una tx de ethers en {hash, esperar}. */
  const op = async (txPromesa, alMinar = () => null) => {
    const tx = await txPromesa;
    return {
      hash: tx.hash,
      esperar: async () => {
        const rec = await tx.wait();
        if (rec && rec.status === 0) throw Object.assign(new Error("La transacción falló"), { code: "CALL_EXCEPTION" });
        return alMinar(rec);
      },
    };
  };

  // Funciones opcionales: se buscan por forma (el contrato real puede llamarlas distinto).
  const fnBienvenida = buscarFn(mer, (f) => /bienvenida/i.test(f.name) && f.constant && f.inputs.length === 1 &&
    f.inputs[0].type === "address" && f.outputs[0]?.type === "bool");
  const fnCofre = buscarFn(mer, (f) => /cofre/i.test(f.name) && /precio/i.test(f.name) && f.constant && f.inputs.length === 0);
  // ETH pagado hoy por la cuenta: mapping(address => uint) o mapping(address => mapping(dia => uint)).
  const fnEthHoy = buscarFn(mer, (f) => /eth/i.test(f.name) && !/max|caja|recompensa/i.test(f.name) && f.constant &&
    f.inputs[0]?.type === "address" && (f.inputs.length === 1 || (f.inputs.length === 2 && /^uint/.test(f.inputs[1].type))) &&
    /^uint/.test(f.outputs[0]?.type ?? ""));
  const recompensas = new Map();
  const opcional = async (fn, porDefecto) => { try { return await fn(); } catch { return porDefecto; } };

  const ventasDe = (rec) => {
    const evs = [];
    for (const log of rec?.logs ?? []) {
      if (log.address?.toLowerCase() !== direcciones.mercado.toLowerCase()) continue;
      try {
        const p = mer.interface.parseLog(log);
        if (p?.name === "ItemVendido") evs.push({ tokenId: p.args[1], oro: p.args[2], eth: p.args.length > 3 ? p.args[3] : 0n });
      } catch { /* otro evento */ }
    }
    return evs.length ? sumarVentas(evs) : null;
  };

  const idDeCofre = (rec) => {
    const yo = cuenta.toLowerCase();
    for (const log of rec?.logs ?? []) {
      try {
        if (log.address?.toLowerCase() === direcciones.cosmeticos.toLowerCase()) {
          const p = cos.interface.parseLog(log);
          if (p?.name === "TransferSingle" && /^0x0{40}$/i.test(p.args.from) && p.args.to.toLowerCase() === yo) return Number(p.args.id);
        }
        if (log.address?.toLowerCase() === direcciones.mercado.toLowerCase()) {
          const p = mer.interface.parseLog(log);
          if (p?.name === "CofreAbierto") return Number(p.args.id ?? p.args[1]);
        }
      } catch { /* log de otro contrato o formato distinto */ }
    }
    return null;
  };

  return {
    modo: "chain",
    direcciones,
    saldoOro: async () => aBigInt(await oro.balanceOf(cuenta)),
    saldoEth: async () => { try { return aBigInt(await provider.getBalance(cuenta)); } catch { return null; } },
    precioVenta: async (it) => normalizarPrecio(await mer.precioVenta(it.tokenId)),
    aprobado: async () => !!(await item.isApprovedForAll(cuenta, direcciones.mercado)),
    aprobar: () => op(conFirma(item).setApprovalForAll(direcciones.mercado, true)),
    recompensaEth: async (it) => {
      const r = Number(it.rareza);
      if (!recompensas.has(r)) recompensas.set(r, opcional(async () => aBigInt(await mer.recompensaEth(r)), recompensaEthLocal(it)));
      return recompensas.get(r);
    },
    infoEth: async () => {
      const [caja, max, pagadoHoy] = await Promise.all([
        opcional(async () => aBigInt(await mer.cajaEth()), null),
        opcional(async () => aBigInt(await mer.maxEthDiario()), MAX_ETH_DIARIO),
        fnEthHoy ? opcional(async () => aBigInt(await (fnEthHoy.inputs.length === 1
          ? mer[fnEthHoy.name](cuenta) : mer[fnEthHoy.name](cuenta, diaOnChain()))), null) : null,
      ]);
      return { caja, max, pagadoHoy };
    },
    vender: (ids) => op(ids.length === 1 ? conFirma(mer).venderItem(ids[0]) : conFirma(mer).venderVarios(ids), ventasDe),
    comprar: (id, n) => op(conFirma(mer).comprarCosmetico(id, n)),
    abrirCofre: () => op(conFirma(mer).abrirCofre(), idDeCofre),
    precioCofre: async () => {
      if (!fnCofre) return PRECIO_COFRE;
      try { return normalizarPrecio(await mer[fnCofre.name]()); } catch { return PRECIO_COFRE; }
    },
    precioCosmetico: async (id) => {
      const local = cosmetico(id)?.precio ?? 0;
      try { const p = normalizarPrecio((await mer.cosmetico(id)).precio); return p > 0 ? p : local; } catch { return local; }
    },
    cosmeticos: async () => {
      const ids = [...IDS_CATALOGO];
      const saldos = await cos.balanceOfBatch(ids.map(() => cuenta), ids);
      return parsearSaldos(ids, [...saldos]);
    },
    bienvenidaReclamada: async () => {
      if (!fnBienvenida) return null;
      try { return !!(await mer[fnBienvenida.name](cuenta)); } catch { return null; }
    },
    reclamarBienvenida: () => op(conFirma(mer).reclamarBienvenida()),
    gastarPociones: (n) => op(conFirma(cos).burn(cuenta, ID_POCION, n)),
    anadirAMetaMask: async () => {
      const req = eip1193?.request ? (m, p) => eip1193.request({ method: m, params: p }) : (m, p) => provider.send(m, p);
      return !!(await req("wallet_watchAsset", { type: "ERC20", options: { address: direcciones.oro, symbol: "ORO", decimals: DECIMALES_ORO } }));
    },
  };
}

/**
 * Economía simulada en memoria (modo demo / tienda-demo.html). Misma interfaz que la de cadena.
 * @param {{oro?:number, eth?:bigint, cosmeticos?:Record<number,number>, inventario?:Array<object>,
 *          aprobado?:boolean, bienvenida?:boolean, latencia?:number, rng?:() => number}} [o]
 * @returns {Economia & {_estado: object}}
 */
export function crearEconomiaSimulada({
  oro = 300, eth = 5n * 10n ** 16n, cosmeticos = {}, inventario = [], aprobado = false,
  bienvenida = false, latencia = 700, rng = Math.random, caja = 10n ** 16n, pagadoHoy = 0n,
} = {}) {
  const e = { oro: aUnidades(oro), eth, caja, pagadoHoy, cos: { ...cosmeticos }, inv: new Map(inventario.map((it) => [String(it.tokenId), it])), aprobado, bienvenida, n: 0 };
  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
  const op = async (accion) => {
    await dormir(latencia / 3);
    const hash = `0x${(++e.n).toString(16).padStart(64, "0")}`;
    return { hash, esperar: async () => { await dormir(latencia); return accion(); } };
  };
  const gastar = (cant) => {
    const u = aUnidades(cant);
    if (e.oro < u) throw Object.assign(new Error("ORO insuficiente"), { code: "CALL_EXCEPTION", revert: { name: "ERC20InsufficientBalance" } });
    e.oro -= u;
  };
  const sumar = (id, n) => { e.cos[id] = (e.cos[id] ?? 0) + n; };
  return {
    modo: "simulada",
    direcciones: null,
    _estado: e,
    saldoOro: async () => e.oro,
    saldoEth: async () => e.eth,
    precioVenta: async (it) => precioVentaLocal(e.inv.get(String(it.tokenId)) ?? it),
    recompensaEth: async (it) => recompensaEthLocal(e.inv.get(String(it.tokenId)) ?? it),
    infoEth: async () => ({ caja: e.caja, max: MAX_ETH_DIARIO, pagadoHoy: e.pagadoHoy }),
    aprobado: async () => e.aprobado,
    aprobar: () => op(() => { e.aprobado = true; }),
    vender: (ids) => {
      if (!e.aprobado) throw Object.assign(new Error("not approved"), { code: "CALL_EXCEPTION", revert: { name: "ERC721InsufficientApproval" } });
      return op(() => {
        const evs = [];
        for (const id of ids) {
          const it = e.inv.get(String(id));
          if (!it) throw Object.assign(new Error("no eres dueño"), { code: "CALL_EXCEPTION", revert: { name: "NoEresDueno" } });
          const oroU = aUnidades(precioVentaLocal(it));
          const [eth] = estimarEthVenta([recompensaEthLocal(it)], { caja: e.caja, restanteHoy: MAX_ETH_DIARIO - e.pagadoHoy }).porObjeto;
          e.oro += oroU; e.caja -= eth; e.pagadoHoy += eth; e.eth += eth;
          e.inv.delete(String(id));
          evs.push({ tokenId: id, oro: oroU, eth });
        }
        return sumarVentas(evs);
      });
    },
    comprar: async (id, n) => {
      const cos = cosmetico(id);
      if (!cos) throw new RangeError("Cosmético desconocido");
      if (e.oro < aUnidades(cos.precio * n)) gastar(cos.precio * n); // lanza antes de "enviar", como estimateGas
      return op(() => { gastar(cos.precio * n); sumar(id, n); });
    },
    abrirCofre: async () => {
      if (e.oro < aUnidades(PRECIO_COFRE)) gastar(PRECIO_COFRE);
      return op(() => { gastar(PRECIO_COFRE); const id = tirarCofre(rng); sumar(id, 1); return id; });
    },
    precioCofre: async () => PRECIO_COFRE,
    precioCosmetico: async (id) => cosmetico(id)?.precio ?? 0,
    cosmeticos: async () => Object.fromEntries(Object.entries(e.cos).filter(([, n]) => n > 0).map(([k, n]) => [Number(k), n])),
    bienvenidaReclamada: async () => e.bienvenida,
    reclamarBienvenida: async () => {
      if (e.bienvenida) throw Object.assign(new Error("bienvenida ya reclamada"), { code: "CALL_EXCEPTION" });
      return op(() => { e.bienvenida = true; e.oro += aUnidades(ORO_BIENVENIDA); });
    },
    gastarPociones: (n) => op(() => { e.cos[ID_POCION] = Math.max(0, (e.cos[ID_POCION] ?? 0) - n); }),
    anadirAMetaMask: async () => false,
  };
}
