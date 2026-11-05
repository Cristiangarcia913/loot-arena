// Equipo e inventario: lógica pura (sin DOM). Los tokenId se manejan como strings.
import { STATS_BASE } from "./combat.js";

export const RAREZAS = Object.freeze([
  Object.freeze({ id: 0, nombre: "Común", color: "#9ca3af" }),
  Object.freeze({ id: 1, nombre: "Raro", color: "#3b82f6" }),
  Object.freeze({ id: 2, nombre: "Legendario", color: "#f59e0b" }),
]);

export const TIPOS = Object.freeze(["Espada", "Escudo", "Casco", "Armadura", "Botas"]);

const EMOJI_TIPO = Object.freeze({ Espada: "🗡️", Escudo: "🛡️", Casco: "⛑️", Armadura: "🥋", Botas: "👢" });

export function rareza(r) {
  return RAREZAS[Number(r)] ?? { id: Number(r), nombre: "Desconocida", color: "#6b7280" };
}

export function emojiTipo(tipo) {
  return EMOJI_TIPO[tipo] ?? "💎";
}

/** Normaliza un objeto (de getItem o del servidor) a números/strings planos. */
export function normalizarItem(raw, tokenId) {
  return {
    tokenId: String(tokenId ?? raw.tokenId),
    nombre: String(raw.nombre ?? ""),
    tipo: String(raw.tipo ?? ""),
    rareza: Number(raw.rareza ?? 0),
    ataque: Number(raw.ataque ?? 0),
    defensa: Number(raw.defensa ?? 0),
  };
}

/** @param {Record<string,string>} equipo mapa tipo → tokenId */
export function estaEquipado(equipo, tokenId) {
  return Object.values(equipo).includes(String(tokenId));
}

/** Equipa un objeto; sustituye al que hubiera del mismo tipo (máx. 1 por tipo). */
export function equipar(equipo, item) {
  const nuevo = desequipar(equipo, item.tokenId);
  nuevo[item.tipo] = String(item.tokenId);
  return nuevo;
}

export function desequipar(equipo, tokenId) {
  const id = String(tokenId);
  return Object.fromEntries(Object.entries(equipo).filter(([, v]) => v !== id));
}

/** Conserva solo entradas cuyo tokenId siga en el inventario y coincida el tipo. */
export function sanearEquipo(equipo, inventario) {
  const porId = new Map(inventario.map((it) => [it.tokenId, it]));
  const limpio = {};
  for (const [tipo, id] of Object.entries(equipo ?? {})) {
    const it = porId.get(String(id));
    if (it && it.tipo === tipo) limpio[tipo] = it.tokenId;
  }
  return limpio;
}

export function itemsEquipados(equipo, inventario) {
  const ids = new Set(Object.values(equipo));
  return inventario.filter((it) => ids.has(it.tokenId));
}

/** Stats del jugador: base + suma de ataque/defensa del equipo. */
export function statsJugador(equipados) {
  const bonusAtaque = equipados.reduce((s, it) => s + it.ataque, 0);
  const bonusDefensa = equipados.reduce((s, it) => s + it.defensa, 0);
  return {
    vida: STATS_BASE.vida,
    ataque: STATS_BASE.ataque + bonusAtaque,
    defensa: STATS_BASE.defensa + bonusDefensa,
    bonusAtaque,
    bonusDefensa,
  };
}

export function claveEquipo(address, chainId) {
  return `lootarena:equipo:${chainId}:${String(address).toLowerCase()}`;
}

/** Parsea el equipo guardado; ante cualquier dato corrupto devuelve {}. */
export function parsearEquipo(texto) {
  try {
    const d = JSON.parse(texto);
    if (!d || typeof d !== "object" || Array.isArray(d)) return {};
    return Object.fromEntries(Object.entries(d).filter(([, v]) => typeof v === "string" && /^\d+$/.test(v)));
  } catch {
    return {};
  }
}

/** Ordena: equipados primero, luego rareza descendente, luego tokenId. */
export function ordenarInventario(inventario, equipo) {
  return [...inventario].sort((a, b) =>
    Number(estaEquipado(equipo, b.tokenId)) - Number(estaEquipado(equipo, a.tokenId)) ||
    b.rareza - a.rareza ||
    Number(a.tokenId) - Number(b.tokenId));
}
