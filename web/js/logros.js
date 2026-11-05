// Logros (≥30) con medallas y títulos. Evaluación incremental: cada evento de juego
// actualiza unos contadores y se devuelven los logros recién desbloqueados.
// Lógica pura; `ahora` y `storage` inyectables.

import { leerJSON, escribirJSON, claveJugador, normalizarEvento } from "./misiones.js";
import { BESTIARIO } from "./combat.js";

const TIPOS = ["Espada", "Escudo", "Casco", "Armadura", "Botas"];
const ID_CONSUMIBLE = 14;

/** Contadores que alimentan los logros. */
export function contadoresNuevos() {
  return {
    victorias: 0, derrotas: 0, huidas: 0, jefes: 0, criticos: 0, habilidades: 0, pociones: 0, dano: 0,
    ventas: 0, oroVentas: 0, cofres: 0, compras: 0, botin: 0, raros: 0, legendarios: 0,
    rachaMax: 0, nivelHeroe: 1, diarios: 0, diarioRachaMax: 0, desafios: 0, desafiosGanados: 0,
    intocable: 0, victoriasNivel10: 0, misiones: 0, paseNivelMax: 0, cosmeticos: 0, rapidas: 0,
    tipos: [], bestiario: [], jefesClaves: [],
  };
}

const L = (id, categoria, icono, nombre, descripcion, contador, objetivo, titulo = null) =>
  Object.freeze({ id, categoria, icono, nombre, descripcion, contador, objetivo, titulo });
const len = (k) => (c) => c[k].length;

/**
 * Definición de logros. `contador`: nombre de contador o función (contadores → número);
 * se desbloquea cuando llega a `objetivo`. `titulo`: id de título que concede (o null).
 */
export const LOGROS = Object.freeze([
  // Primeros pasos
  L("primera_victoria", "primeros", "🥇", "Primera sangre", "Gana tu primer combate.", "victorias", 1),
  L("primer_botin", "primeros", "💎", "¡Botín!", "Consigue tu primer objeto NFT.", "botin", 1),
  L("primer_cofre", "primeros", "🎁", "¿Qué habrá dentro?", "Abre tu primer cofre.", "cofres", 1),
  L("primera_venta", "primeros", "💰", "Negociante", "Vende tu primer objeto.", "ventas", 1),
  L("primera_compra", "primeros", "🛒", "De compras", "Compra algo en la tienda.", "compras", 1),
  L("primera_mision", "primeros", "📜", "Recadero", "Reclama tu primera misión.", "misiones", 1),
  // Combate
  L("victorias_10", "combate", "⚔️", "Aprendiz de gladiador", "Gana 10 combates.", "victorias", 10),
  L("victorias_50", "combate", "⚔️", "Gladiador", "Gana 50 combates.", "victorias", 50),
  L("victorias_200", "combate", "🏛️", "Leyenda de la arena", "Gana 200 combates.", "victorias", 200, "leyenda_arena"),
  L("primer_jefe", "combate", "👑", "Regicida", "Vence a tu primer jefe.", "jefes", 1),
  L("jefes_10", "combate", "👑", "Matajefes", "Vence a 10 jefes.", "jefes", 10, "matajefes"),
  L("jefes_todos", "combate", "🐉", "Señor de señores", "Vence al jefe de cada criatura.", len("jefesClaves"), BESTIARIO.length, "senor_de_senores"),
  L("criticos_25", "combate", "💥", "Golpe certero", "Haz 25 críticos.", "criticos", 25),
  L("criticos_100", "combate", "🎯", "Ojo de halcón", "Haz 100 críticos.", "criticos", 100, "ojo_halcon"),
  L("habilidades_50", "combate", "✨", "Maestro de armas", "Usa 50 habilidades.", "habilidades", 50),
  L("racha_5", "combate", "🔥", "En racha", "Gana 5 combates seguidos.", "rachaMax", 5),
  L("racha_10", "combate", "🔥", "Imparable", "Gana 10 combates seguidos.", "rachaMax", 10, "imparable"),
  L("racha_25", "combate", "☄️", "Invicto", "Gana 25 combates seguidos.", "rachaMax", 25, "invicto"),
  L("intocable", "combate", "🛡️", "Intocable", "Gana un combate sin recibir daño.", "intocable", 1),
  L("relampago", "combate", "⚡", "Relámpago", "Gana un combate en 3 turnos o menos.", "rapidas", 1),
  L("nivel_10", "combate", "🗻", "En la cima", "Vence a un enemigo de nivel 10.", "victoriasNivel10", 1),
  L("dano_10000", "combate", "🗡️", "Carnicero", "Inflige 10 000 de daño en total.", "dano", 10000),
  L("pociones_25", "combate", "🧪", "Alquimista", "Bebe 25 pociones.", "pociones", 25),
  L("derrotas_10", "combate", "🤕", "Testarudo", "Cae 10 veces y sigue luchando.", "derrotas", 10, "testarudo"),
  // Héroe
  L("heroe_10", "heroe", "🧝", "Curtido", "Alcanza el nivel 10 de héroe.", "nivelHeroe", 10),
  L("heroe_20", "heroe", "🧝", "Veterano", "Alcanza el nivel 20 de héroe.", "nivelHeroe", 20),
  L("heroe_30", "heroe", "🌟", "Ascendido", "Alcanza el nivel 30 de héroe.", "nivelHeroe", 30, "ascendido"),
  // Colección
  L("primer_raro", "coleccion", "🔷", "Algo especial", "Consigue un objeto Raro.", "raros", 1),
  L("primer_legendario", "coleccion", "🌟", "Portador de leyendas", "Consigue un objeto Legendario.", "legendarios", 1, "portador_leyendas"),
  L("legendarios_5", "coleccion", "🏺", "Coleccionista de mitos", "Consigue 5 objetos Legendarios.", "legendarios", 5),
  L("uno_de_cada", "coleccion", "🧰", "Equipo completo", "Consigue un objeto de cada tipo.", len("tipos"), TIPOS.length),
  L("bestiario_completo", "coleccion", "📖", "Cazador de bestias", "Vence a cada criatura del bestiario.", len("bestiario"), BESTIARIO.length, "cazador_bestias"),
  L("cosmeticos_5", "coleccion", "🎩", "Elegante", "Ten 5 cosméticos distintos.", "cosmeticos", 5, "elegante"),
  // Economía
  L("ventas_10", "economia", "💰", "Tendero", "Vende 10 objetos.", "ventas", 10),
  L("oro_1000", "economia", "🪙", "Mercader", "Gana 1000 ORO vendiendo.", "oroVentas", 1000, "mercader"),
  L("cofres_10", "economia", "🎁", "Cazatesoros", "Abre 10 cofres.", "cofres", 10),
  // Constancia
  L("diario_7", "constancia", "📅", "Constante", "Reclama la recompensa diaria 7 días seguidos.", "diarioRachaMax", 7, "constante"),
  L("diario_30", "constancia", "🗓️", "Habitual", "Reclama la recompensa diaria 30 veces.", "diarios", 30),
  L("desafio_1", "constancia", "🎯", "Aceptado", "Juega tu primer desafío diario.", "desafios", 1),
  L("desafio_10", "constancia", "🏅", "Retador", "Gana 10 desafíos diarios.", "desafiosGanados", 10, "retador"),
  L("misiones_30", "constancia", "📜", "Cumplidor", "Reclama 30 misiones.", "misiones", 30),
  L("pase_10", "constancia", "🎟️", "Temporada en marcha", "Llega al nivel 10 del pase.", "paseNivelMax", 10),
  L("pase_30", "constancia", "🏆", "Pase completo", "Llega al nivel 30 del pase.", "paseNivelMax", 30),
]);

/** Títulos que conceden los logros (id → texto). */
export const TITULOS = Object.freeze({
  leyenda_arena: "Leyenda de la Arena", matajefes: "Matajefes", senor_de_senores: "Señor de Señores",
  ojo_halcon: "Ojo de Halcón", imparable: "Imparable", invicto: "Invicto", testarudo: "Testarudo",
  ascendido: "Ascendido", portador_leyendas: "Portador de Leyendas", cazador_bestias: "Cazador de Bestias",
  elegante: "Elegante", mercader: "Mercader", constante: "Constante", retador: "Retador",
});

/** Logro por id. */
export const logro = (id) => LOGROS.find((x) => x.id === id);

const valor = (l, c) => (typeof l.contador === "function" ? l.contador(c) : c[l.contador] ?? 0);

/** Estado inicial. */
export function logrosNuevos() {
  return { version: 1, c: contadoresNuevos(), desbloqueados: {}, titulosExtra: [], titulo: null };
}

/** Normaliza un estado guardado (tolera datos viejos o corruptos). */
export function sanearLogros(d) {
  const e = logrosNuevos();
  if (!d || typeof d !== "object") return e;
  const c0 = d.c && typeof d.c === "object" ? d.c : {};
  for (const [k, v] of Object.entries(e.c)) {
    if (Array.isArray(v)) e.c[k] = Array.isArray(c0[k]) ? [...new Set(c0[k].map(String))] : [];
    else { const n = Math.floor(Number(c0[k])); e.c[k] = Number.isFinite(n) ? Math.max(v, n) : v; }
  }
  if (d.desbloqueados && typeof d.desbloqueados === "object") {
    for (const [id, t] of Object.entries(d.desbloqueados)) if (logro(id)) e.desbloqueados[id] = Number(t) || 0;
  }
  e.titulosExtra = Array.isArray(d.titulosExtra) ? [...new Set(d.titulosExtra.map(String))] : [];
  e.titulo = typeof d.titulo === "string" ? d.titulo : null;
  if (e.titulo && !titulosDisponibles(e).includes(e.titulo)) e.titulo = null;
  return e;
}

const añadir = (arr, v) => (v == null || arr.includes(String(v)) ? arr : [...arr, String(v)]);

function aplicar(c, ev) {
  const n = ev.cantidad;
  switch (ev.tipo) {
    case "victoria":
      c.victorias += 1;
      if (Number(ev.nivel) >= 10) c.victoriasNivel10 += 1;
      if (ev.danoRecibido === 0) c.intocable += 1;
      if (ev.turnos != null && ev.turnos <= 3) c.rapidas += 1;
      c.bestiario = añadir(c.bestiario, ev.clave);
      break;
    case "jefe": c.jefes += n; c.jefesClaves = añadir(c.jefesClaves, ev.clave); break;
    case "derrota": c.derrotas += 1; break;
    case "huida": c.huidas += 1; break;
    case "critico": c.criticos += n; break;
    case "habilidad": c.habilidades += n; break;
    case "pocion": c.pociones += n; break;
    case "dano": c.dano += n; break;
    case "venta": c.ventas += n; c.oroVentas += Math.max(0, Math.floor(Number(ev.oro) || 0)); break;
    case "cofre": c.cofres += n; break;
    case "compra": c.compras += n; break;
    case "botin": {
      c.botin += 1;
      const r = Number(ev.item?.rareza);
      if (r === 1) c.raros += 1;
      if (r === 2) c.legendarios += 1;
      if (TIPOS.includes(ev.item?.tipo)) c.tipos = añadir(c.tipos, ev.item.tipo);
      break;
    }
    case "inventario":
      for (const it of ev.items ?? []) {
        if (TIPOS.includes(it?.tipo)) c.tipos = añadir(c.tipos, it.tipo);
      }
      c.legendarios = Math.max(c.legendarios, (ev.items ?? []).filter((it) => Number(it?.rareza) === 2).length);
      c.raros = Math.max(c.raros, (ev.items ?? []).filter((it) => Number(it?.rareza) === 1).length);
      break;
    case "cosmeticos":
      c.cosmeticos = Math.max(c.cosmeticos, new Set((ev.ids ?? []).map(Number).filter((id) => id !== ID_CONSUMIBLE)).size);
      break;
    case "racha": c.rachaMax = Math.max(c.rachaMax, Math.floor(Number(ev.valor) || 0)); break;
    case "nivel": c.nivelHeroe = Math.max(c.nivelHeroe, Math.floor(Number(ev.valor) || 0)); break;
    case "diario": c.diarios += 1; c.diarioRachaMax = Math.max(c.diarioRachaMax, Math.floor(Number(ev.racha) || 0)); break;
    case "desafio": c.desafios += 1; if (ev.victoria) c.desafiosGanados += 1; break;
    case "mision": c.misiones += n; break;
    case "pase": c.paseNivelMax = Math.max(c.paseNivelMax, Math.floor(Number(ev.nivel) || 0)); break;
    default: break;
  }
}

/**
 * Registra un evento (ver misiones.normalizarEvento; además `{tipo:"titulo", id}` añade un título
 * externo permanente, p. ej. del pase).
 * @returns {{progreso:object, nuevos:Array<typeof LOGROS[number]>}} logros recién desbloqueados (para fx.celebrarLogro)
 */
export function registrar(estado, evento, ahora = Date.now()) {
  const e = sanearLogros(estado);
  const ev = normalizarEvento(evento);
  if (!ev) return { progreso: e, nuevos: [] };
  if (ev.tipo === "titulo") {
    if (ev.id) e.titulosExtra = añadir(e.titulosExtra, ev.id);
    return { progreso: e, nuevos: [] };
  }
  aplicar(e.c, ev);
  const nuevos = [];
  for (const l of LOGROS) {
    if (e.desbloqueados[l.id] == null && valor(l, e.c) >= l.objetivo) {
      e.desbloqueados[l.id] = Number(ahora);
      nuevos.push(l);
    }
  }
  return { progreso: e, nuevos };
}

/** Registra varios eventos seguidos. @returns {{progreso, nuevos}} */
export function registrarVarios(estado, eventos, ahora = Date.now()) {
  let progreso = sanearLogros(estado);
  const nuevos = [];
  for (const ev of eventos ?? []) {
    const r = registrar(progreso, ev, ahora);
    progreso = r.progreso;
    nuevos.push(...r.nuevos);
  }
  return { progreso, nuevos };
}

/**
 * Lista para la UI: todos los logros con su progreso.
 * @returns {Array<{id, categoria, icono, nombre, descripcion, titulo:string|null, tituloTexto:string|null,
 *                  objetivo:number, actual:number, pct:number, desbloqueado:boolean, fecha:number|null}>}
 */
export function listaLogros(estado) {
  const e = sanearLogros(estado);
  return LOGROS.map((l) => {
    const actual = Math.min(l.objetivo, valor(l, e.c));
    const fecha = e.desbloqueados[l.id] ?? null;
    return {
      id: l.id, categoria: l.categoria, icono: l.icono, nombre: l.nombre, descripcion: l.descripcion,
      titulo: l.titulo, tituloTexto: l.titulo ? TITULOS[l.titulo] : null,
      objetivo: l.objetivo, actual, pct: actual / l.objetivo, desbloqueado: fecha != null, fecha,
    };
  });
}

/** Resumen: {desbloqueados, total, pct}. */
export function resumenLogros(estado) {
  const e = sanearLogros(estado);
  const desbloqueados = Object.keys(e.desbloqueados).length;
  return { desbloqueados, total: LOGROS.length, pct: desbloqueados / LOGROS.length };
}

/** Ids de títulos que el jugador puede llevar (logros + externos). */
export function titulosDisponibles(estado) {
  const e = estado ?? logrosNuevos();
  const deLogros = LOGROS.filter((l) => l.titulo && e.desbloqueados?.[l.id] != null).map((l) => l.titulo);
  return [...new Set([...deLogros, ...(e.titulosExtra ?? [])])];
}

/**
 * Elige el título que se muestra junto al nombre (null = ninguno).
 * @returns {{ok:boolean, progreso:object, motivo?:string}}
 */
export function elegirTitulo(estado, id) {
  const e = sanearLogros(estado);
  if (id == null) return { ok: true, progreso: { ...e, titulo: null } };
  if (!titulosDisponibles(e).includes(id)) return { ok: false, progreso: e, motivo: "Título no desbloqueado" };
  return { ok: true, progreso: { ...e, titulo: id } };
}

/**
 * Texto de un título. `extra` permite resolver títulos externos (p. ej. pase.TITULOS_PASE).
 * @param {string|null} id
 * @param {Record<string,string>} [extra]
 */
export function textoTitulo(id, extra = {}) {
  if (!id) return null;
  return TITULOS[id] ?? extra[id] ?? id;
}

export const claveLogros = (address) => claveJugador("logros", address);

export function cargarLogros(clave, storage = globalThis.localStorage) {
  return sanearLogros(leerJSON(clave, storage));
}

export function guardarLogros(clave, estado, storage = globalThis.localStorage) {
  return escribirJSON(clave, estado, storage);
}
