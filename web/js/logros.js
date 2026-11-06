// Logros de Loot Arena (49) agrupados en 4 categorías: combate, colección, economía y constancia.
// Cada logro es una "familia" con 3–4 escalones: cada escalón tiene su medalla (bronce → diamante).
// Los escalones intermedios dan XP (`recompensa.tipo === "xp"`); el último da un título
// (`recompensa.tipo === "titulo"`), que es también el título que el jugador puede llevar.
// Evaluación incremental y pura: `ahora` y `storage` se inyectan. Los contadores se alimentan de los
// eventos de juego (ver `aplicar` y misiones.normalizarEvento). main.js debe leer `xp` del resultado de
// `registrar`/`registrarVarios` y sumarlo a la progresión (ver el informe de la sesión).

import { leerJSON, escribirJSON, claveJugador, normalizarEvento } from "./misiones.js";
import { BESTIARIO } from "./combat.js";

const TIPOS = ["Espada", "Escudo", "Casco", "Armadura", "Botas"];
const RAREZAS = [0, 1, 2];

/** Medallas por escalón (índice 0 = primer escalón). */
export const MEDALLAS = Object.freeze(["bronce", "plata", "oro", "diamante"]);
/** XP del escalón intermedio n (1-based): XP_ESCALON * n. */
export const XP_ESCALON = 15;

export const CATEGORIAS = Object.freeze([
  Object.freeze({ id: "combate", nombre: "Combate", icono: "⚔️" }),
  Object.freeze({ id: "coleccion", nombre: "Colección", icono: "📖" }),
  Object.freeze({ id: "economia", nombre: "Economía", icono: "🪙" }),
  Object.freeze({ id: "constancia", nombre: "Constancia", icono: "📅" }),
]);

/** Contadores que alimentan los logros. */
export function contadoresNuevos() {
  return {
    // combate
    victorias: 0, victoriasNivel5: 0, victoriasNivel10: 0, nivelMaxVencido: 0, combates: 0, derrotas: 0, huidas: 0,
    jefes: 0, jefesIntocables: 0, criticos: 0, habilidades: 0, habilidadesDistintas: [], pociones: 0,
    dano: 0, danoRecibido: 0, intocable: 0, rapidas: 0, rachaMax: 0, nivelHeroe: 1,
    // economía
    ventas: 0, ventaMax: 0, oroVentas: 0, oroAcumulado: 0, compras: 0, gastado: 0, compraMax: 0, cofres: 0,
    // colección
    botin: 0, raros: 0, legendarios: 0, cosmeticos: 0,
    // constancia
    diarios: 0, diarioRachaMax: 0, desafios: 0, desafiosGanados: 0, desafiosRacha: 0, desafiosRachaMax: 0,
    misiones: 0, semanales: 0, paseNivelMax: 0, temporadas: [],
    // listas (conjuntos)
    tipos: [], distintos: [], bestiario: [], jefesClaves: [],
  };
}

const len = (k) => (c) => c[k].length;
const porTipo = (tipo) => (c) => c.distintos.filter((k) => k.startsWith(`${tipo}:`)).length;

/**
 * Familia de logro. `metas` ascendentes (la última es el objetivo). El último escalón da el título
 * `[id, texto]`; los anteriores dan XP.
 */
const F = (id, categoria, icono, nombre, descripcion, contador, metas, [titulo, tituloTexto]) => {
  const escalones = Object.freeze(metas.map((meta, i) => Object.freeze({
    n: i + 1,
    meta,
    medalla: MEDALLAS[i],
    recompensa: i === metas.length - 1
      ? Object.freeze({ tipo: "titulo", id: titulo, texto: tituloTexto })
      : Object.freeze({ tipo: "xp", xp: XP_ESCALON * (i + 1) }),
  })));
  return Object.freeze({
    id, categoria, icono, nombre, descripcion, contador,
    objetivo: metas[metas.length - 1], titulo, tituloTexto, escalones,
  });
};

/** Definición de los 49 logros (4 categorías). */
export const LOGROS = Object.freeze([
  // ── Combate (20)
  // id histórico "primera_victoria": lo usa enganche.test.js y estados guardados.
  F("primera_victoria", "combate", "🏟️", "Gladiador", "Gana combates en la arena.", "victorias", [1, 10, 50, 200], ["leyenda_arena", "Leyenda de la Arena"]),
  F("nivel_5", "combate", "🐗", "Desafiante", "Vence enemigos de nivel 5 o más.", "victoriasNivel5", [1, 10, 30], ["desafiante", "Desafiante"]),
  F("nivel_10", "combate", "🗻", "En la cima", "Vence enemigos de nivel 10.", "victoriasNivel10", [1, 5, 20], ["en_la_cima", "En la Cima"]),
  F("nivel_maximo", "combate", "🧭", "Alto rango", "Vence al enemigo de mayor nivel.", "nivelMaxVencido", [3, 6, 10], ["alto_rango", "Cazador de Alto Rango"]),
  F("criticos", "combate", "🎯", "Ojo de halcón", "Haz golpes críticos.", "criticos", [25, 100, 400], ["ojo_halcon", "Ojo de Halcón"]),
  F("habilidades", "combate", "✨", "Maestro de armas", "Usa habilidades en combate.", "habilidades", [10, 50, 200], ["maestro_armas", "Maestro de Armas"]),
  F("habilidades_distintas", "combate", "📚", "Repertorio", "Usa habilidades distintas.", len("habilidadesDistintas"), [2, 4, 6], ["repertorio", "Repertorio"]),
  F("jefes", "combate", "👑", "Matajefes", "Vence jefes.", "jefes", [1, 10, 30], ["matajefes", "Matajefes"]),
  F("jefes_todos", "combate", "🐉", "Señor de señores", "Vence al jefe de cada criatura.", len("jefesClaves"), [1, 5, BESTIARIO.length], ["senor_de_senores", "Señor de Señores"]),
  F("jefes_sin_dano", "combate", "🛡️", "Sin heridas", "Vence jefes sin recibir daño.", "jefesIntocables", [1, 3, 10], ["sin_heridas", "Sin Heridas"]),
  F("racha", "combate", "🔥", "Invicto", "Encadena victorias seguidas.", "rachaMax", [3, 5, 10, 25], ["invicto", "Invicto"]),
  F("intocable", "combate", "🧱", "Intocable", "Gana combates sin recibir daño.", "intocable", [1, 5, 20], ["intocable", "Intocable"]),
  F("relampago", "combate", "⚡", "Relámpago", "Gana combates en 3 turnos o menos.", "rapidas", [1, 10, 30], ["relampago", "Relámpago"]),
  F("dano", "combate", "🗡️", "Carnicero", "Inflige daño total.", "dano", [1000, 10000, 50000], ["carnicero", "Carnicero"]),
  F("dano_recibido", "combate", "💢", "Aguante de hierro", "Recibe daño total en combate.", "danoRecibido", [500, 5000, 20000], ["aguante", "Aguante de Hierro"]),
  F("pociones", "combate", "🧪", "Alquimista", "Bebe pociones.", "pociones", [5, 25, 100], ["alquimista", "Alquimista"]),
  F("combates", "combate", "🏛️", "Veterano de arena", "Disputa combates (victorias, derrotas o huidas).", "combates", [10, 100, 500], ["veterano_arena", "Veterano de Arena"]),
  F("derrotas", "combate", "🤕", "Testarudo", "Cae derrotado y sigue luchando.", "derrotas", [1, 10, 50], ["testarudo", "Testarudo"]),
  F("huidas", "combate", "🏃", "Escurridizo", "Huye de combates.", "huidas", [1, 10, 30], ["escurridizo", "Escurridizo"]),
  F("nivel_heroe", "combate", "🧝", "Curtido", "Sube de nivel de héroe.", "nivelHeroe", [5, 10, 20, 30], ["ascendido", "Ascendido"]),

  // ── Colección (13)
  F("tipos", "coleccion", "🧰", "Equipo completo", "Consigue objetos de cada tipo.", len("tipos"), [1, 3, 5], ["equipo_completo", "Equipo Completo"]),
  F("combinaciones", "coleccion", "🗂️", "Coleccionista", "Consigue combinaciones distintas de tipo y rareza.", len("distintos"), [3, 8, 15], ["coleccionista", "Coleccionista"]),
  F("espadas", "coleccion", "⚔️", "Maestro de espadas", "Consigue espadas de distinta rareza.", porTipo("Espada"), [1, 2, 3], ["maestro_espadas", "Maestro de Espadas"]),
  F("escudos", "coleccion", "🛡️", "Maestro de escudos", "Consigue escudos de distinta rareza.", porTipo("Escudo"), [1, 2, 3], ["maestro_escudos", "Maestro de Escudos"]),
  F("cascos", "coleccion", "⛑️", "Maestro de cascos", "Consigue cascos de distinta rareza.", porTipo("Casco"), [1, 2, 3], ["maestro_cascos", "Maestro de Cascos"]),
  F("armaduras", "coleccion", "🥋", "Maestro de armaduras", "Consigue armaduras de distinta rareza.", porTipo("Armadura"), [1, 2, 3], ["maestro_armaduras", "Maestro de Armaduras"]),
  F("botas", "coleccion", "👢", "Maestro de botas", "Consigue botas de distinta rareza.", porTipo("Botas"), [1, 2, 3], ["maestro_botas", "Maestro de Botas"]),
  F("raros", "coleccion", "🔷", "Buen ojo", "Consigue objetos Raros.", "raros", [1, 5, 20], ["buen_ojo", "Buen Ojo"]),
  F("legendarios", "coleccion", "🌟", "Portador de leyendas", "Consigue objetos Legendarios.", "legendarios", [1, 3, 10], ["portador_leyendas", "Portador de Leyendas"]),
  F("botin", "coleccion", "💎", "Saqueador", "Consigue objetos de botín.", "botin", [1, 10, 50, 200], ["saqueador", "Saqueador"]),
  F("cosmeticos", "coleccion", "🎩", "Elegante", "Ten cosméticos distintos.", "cosmeticos", [3, 7, 14], ["elegante", "Elegante"]),
  F("bestiario", "coleccion", "📖", "Cazador de bestias", "Vence a criaturas distintas del bestiario.", len("bestiario"), [3, 6, BESTIARIO.length], ["cazador_bestias", "Cazador de Bestias"]),

  // ── Economía (8)
  F("ventas", "economia", "💰", "Tendero", "Vende objetos.", "ventas", [1, 10, 50, 200], ["tendero", "Tendero"]),
  F("venta_lote", "economia", "📦", "Al por mayor", "Vende varios objetos de una vez.", "ventaMax", [2, 5, 10], ["al_por_mayor", "Al por Mayor"]),
  F("oro_vendido", "economia", "🪙", "Mercader", "ORO ganado vendiendo.", "oroVentas", [1000, 10000, 50000], ["mercader", "Mercader"]),
  F("oro_acumulado", "economia", "🏦", "Magnate", "ORO acumulado (ventas y recompensas diarias).", "oroAcumulado", [1000, 10000, 50000, 250000], ["magnate", "Magnate"]),
  F("compras", "economia", "🛒", "Cliente fiel", "Compra en la tienda.", "compras", [1, 10, 50], ["cliente_fiel", "Cliente Fiel"]),
  F("gasto", "economia", "💸", "Gran comprador", "ORO gastado en la tienda.", "gastado", [500, 5000, 50000], ["gran_comprador", "Gran Comprador"]),
  F("compra_grande", "economia", "🧾", "Derrochador", "Haz una compra de mucho ORO de una vez.", "compraMax", [100, 1000, 5000], ["derrochador", "Derrochador"]),
  F("cofres", "economia", "🎁", "Cazatesoros", "Abre cofres.", "cofres", [1, 10, 50], ["cazatesoros", "Cazatesoros"]),

  // ── Constancia (9)
  F("diario_racha", "constancia", "📅", "Constante", "Racha de recompensa diaria.", "diarioRachaMax", [3, 7, 14, 30], ["constante", "Constante"]),
  F("diarios", "constancia", "🗓️", "Habitual", "Reclama recompensas diarias.", "diarios", [1, 10, 30, 100], ["habitual", "Habitual"]),
  F("desafios", "constancia", "🎯", "Aceptado", "Juega desafíos diarios.", "desafios", [1, 10, 30, 100], ["retador", "Retador"]),
  F("desafios_ganados", "constancia", "🏅", "Campeón del desafío", "Gana desafíos diarios.", "desafiosGanados", [1, 10, 30], ["campeon_desafio", "Campeón del Desafío"]),
  F("desafios_racha", "constancia", "☄️", "Imbatible", "Gana desafíos diarios seguidos.", "desafiosRachaMax", [2, 5, 10], ["imbatible", "Imbatible"]),
  F("misiones", "constancia", "📜", "Cumplidor", "Reclama misiones.", "misiones", [1, 10, 50, 150], ["cumplidor", "Cumplidor"]),
  F("misiones_semanales", "constancia", "🗞️", "Semanero", "Reclama misiones semanales.", "semanales", [1, 5, 20], ["semanero", "Semanero"]),
  F("pase_nivel", "constancia", "🎟️", "Pase en marcha", "Alcanza un nivel alto del pase de temporada.", "paseNivelMax", [10, 20, 30], ["pase_completo", "Pase Completo"]),
  F("temporadas", "constancia", "🏆", "Veterano de temporadas", "Llega al nivel 10 del pase en temporadas distintas.", len("temporadas"), [1, 3, 6], ["veterano_temporadas", "Veterano de Temporadas"]),
]);

/** Títulos que conceden los logros (id → texto). Los externos (p. ej. pase.TITULOS_PASE) van aparte. */
export const TITULOS = Object.freeze(Object.fromEntries(LOGROS.map((l) => [l.titulo, l.tituloTexto])));

/** Logro por id. */
export const logro = (id) => LOGROS.find((x) => x.id === id);

const valor = (l, c) => (typeof l.contador === "function" ? l.contador(c) : c[l.contador] ?? 0);

/** Número de escalones alcanzados por los contadores `c` (0..escalones.length). */
export function escalonesAlcanzados(l, c) {
  const v = valor(l, c);
  return l.escalones.filter((e) => v >= e.meta).length;
}

/** Títulos ganados según los contadores (último escalón de cada logro). */
function titulosGanados(c) {
  return LOGROS.filter((l) => escalonesAlcanzados(l, c) === l.escalones.length).map((l) => l.titulo);
}

/** Estado inicial. `desbloqueados`: id → instante del primer escalón. `niveles`: id → escalones ya premiados. */
export function logrosNuevos() {
  return { version: 2, c: contadoresNuevos(), desbloqueados: {}, niveles: {}, titulosExtra: [], titulo: null };
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
  for (const l of LOGROS) {
    const n = Math.floor(Number(d.niveles?.[l.id]));
    e.niveles[l.id] = Number.isFinite(n) ? Math.min(l.escalones.length, Math.max(0, n)) : 0;
  }
  e.titulosExtra = Array.isArray(d.titulosExtra) ? [...new Set(d.titulosExtra.map(String))] : [];
  e.titulo = typeof d.titulo === "string" ? d.titulo : null;
  if (e.titulo && ![...titulosGanados(e.c), ...e.titulosExtra].includes(e.titulo)) e.titulo = null;
  return e;
}

const añadir = (arr, v) => (v == null || arr.includes(String(v)) ? arr : [...arr, String(v)]);
const entero = (v) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0; };

function aplicar(c, ev) {
  const n = ev.cantidad;
  switch (ev.tipo) {
    case "victoria": {
      const nivel = entero(ev.nivel);
      c.victorias += 1;
      c.combates += 1;
      if (nivel >= 5) c.victoriasNivel5 += 1;
      if (nivel >= 10) c.victoriasNivel10 += 1;
      c.nivelMaxVencido = Math.max(c.nivelMaxVencido, nivel);
      if (ev.danoRecibido != null) c.danoRecibido += entero(ev.danoRecibido);
      if (ev.danoRecibido === 0) { c.intocable += 1; if (ev.jefe) c.jefesIntocables += 1; }
      if (ev.turnos != null && ev.turnos <= 3) c.rapidas += 1;
      c.bestiario = añadir(c.bestiario, ev.clave);
      break;
    }
    case "jefe": c.jefes += n; c.jefesClaves = añadir(c.jefesClaves, ev.clave); break;
    case "derrota": c.derrotas += 1; c.combates += 1; break;
    case "huida": c.huidas += 1; c.combates += 1; break;
    case "critico": c.criticos += n; break;
    case "habilidad":
      c.habilidades += n;
      if (ev.id != null) c.habilidadesDistintas = añadir(c.habilidadesDistintas, ev.id);
      break;
    case "pocion": c.pociones += n; break;
    case "dano": c.dano += n; break;
    case "venta": {
      const oro = entero(ev.oro);
      c.ventas += n;
      c.ventaMax = Math.max(c.ventaMax, n);
      c.oroVentas += oro;
      c.oroAcumulado += oro;
      break;
    }
    case "cofre": c.cofres += n; break;
    case "compra": {
      const oro = entero(ev.oro);
      c.compras += n;
      c.gastado += oro;
      c.compraMax = Math.max(c.compraMax, oro);
      break;
    }
    case "botin": {
      c.botin += 1;
      const r = Number(ev.item?.rareza);
      if (r === 1) c.raros += 1;
      if (r === 2) c.legendarios += 1;
      if (TIPOS.includes(ev.item?.tipo)) {
        c.tipos = añadir(c.tipos, ev.item.tipo);
        if (RAREZAS.includes(r)) c.distintos = añadir(c.distintos, `${ev.item.tipo}:${r}`);
      }
      break;
    }
    case "inventario": {
      const items = ev.items ?? [];
      for (const it of items) {
        const r = Number(it?.rareza);
        if (TIPOS.includes(it?.tipo)) {
          c.tipos = añadir(c.tipos, it.tipo);
          if (RAREZAS.includes(r)) c.distintos = añadir(c.distintos, `${it.tipo}:${r}`);
        }
      }
      c.legendarios = Math.max(c.legendarios, items.filter((it) => Number(it?.rareza) === 2).length);
      c.raros = Math.max(c.raros, items.filter((it) => Number(it?.rareza) === 1).length);
      break;
    }
    case "cosmeticos":
      c.cosmeticos = Math.max(c.cosmeticos, new Set((ev.ids ?? []).map(Number).filter((id) => id !== 14)).size);
      break;
    case "racha": c.rachaMax = Math.max(c.rachaMax, entero(ev.valor)); break;
    case "nivel": c.nivelHeroe = Math.max(c.nivelHeroe, entero(ev.valor)); break;
    case "diario":
      c.diarios += 1;
      c.diarioRachaMax = Math.max(c.diarioRachaMax, entero(ev.racha));
      c.oroAcumulado += entero(ev.oro);
      break;
    case "desafio":
      c.desafios += 1;
      if (ev.victoria) {
        c.desafiosGanados += 1;
        c.desafiosRacha += 1;
        c.desafiosRachaMax = Math.max(c.desafiosRachaMax, c.desafiosRacha);
      } else c.desafiosRacha = 0;
      break;
    case "mision":
      c.misiones += n;
      if (ev.semanal) c.semanales += n;
      break;
    case "pase":
      c.paseNivelMax = Math.max(c.paseNivelMax, entero(ev.nivel));
      if (entero(ev.nivel) >= 10 && ev.temporada != null) c.temporadas = añadir(c.temporadas, ev.temporada);
      break;
    default: break;
  }
}

/**
 * Registra un evento (ver misiones.normalizarEvento; además `{tipo:"titulo", id}` añade un título
 * externo permanente, p. ej. del pase).
 * @returns {{progreso:object, nuevos:Array<typeof LOGROS[number]>, escalones:Array<object>, xp:number}}
 *   `nuevos`: logros que han subido de escalón en esta llamada (para fx.celebrarLogro).
 *   `escalones`: cada escalón recién alcanzado `{id, nombre, icono, categoria, n, medalla, meta, recompensa}`.
 *   `xp`: XP total a sumar a la progresión por los escalones intermedios.
 */
export function registrar(estado, evento, ahora = Date.now()) {
  const e = sanearLogros(estado);
  const ev = normalizarEvento(evento);
  if (!ev) return { progreso: e, nuevos: [], escalones: [], xp: 0 };
  if (ev.tipo === "titulo") {
    if (ev.id) e.titulosExtra = añadir(e.titulosExtra, ev.id);
    return { progreso: e, nuevos: [], escalones: [], xp: 0 };
  }
  aplicar(e.c, ev);
  const nuevos = [];
  const escalones = [];
  let xp = 0;
  for (const l of LOGROS) {
    const n = escalonesAlcanzados(l, e.c);
    const antes = e.niveles[l.id] ?? 0;
    if (n <= antes) continue;
    for (let k = antes + 1; k <= n; k++) {
      const esc = l.escalones[k - 1];
      escalones.push({ id: l.id, nombre: l.nombre, icono: l.icono, categoria: l.categoria, n: k, medalla: esc.medalla, meta: esc.meta, recompensa: esc.recompensa });
      if (esc.recompensa.tipo === "xp") xp += esc.recompensa.xp;
    }
    e.niveles[l.id] = n;
    if (e.desbloqueados[l.id] == null) e.desbloqueados[l.id] = Number(ahora);
    nuevos.push(l);
  }
  return { progreso: e, nuevos, escalones, xp };
}

/** Registra varios eventos seguidos. @returns {{progreso, nuevos, escalones, xp}} */
export function registrarVarios(estado, eventos, ahora = Date.now()) {
  let progreso = sanearLogros(estado);
  const nuevos = [];
  const escalones = [];
  let xp = 0;
  for (const ev of eventos ?? []) {
    const r = registrar(progreso, ev, ahora);
    progreso = r.progreso;
    nuevos.push(...r.nuevos);
    escalones.push(...r.escalones);
    xp += r.xp;
  }
  return { progreso, nuevos: [...new Set(nuevos)], escalones, xp };
}

/**
 * Lista para la UI: todos los logros con su progreso y escalones.
 * `desbloqueado` = tiene al menos una medalla; `completado` = tiene todos los escalones.
 * `pct` = progreso hacia el objetivo final; `siguiente` = próximo escalón (null si completado).
 */
export function listaLogros(estado) {
  const e = sanearLogros(estado);
  return LOGROS.map((l) => {
    const v = valor(l, e.c);
    const n = escalonesAlcanzados(l, e.c);
    const actual = Math.min(l.objetivo, v);
    const sig = l.escalones[n] ?? null;
    return {
      id: l.id, categoria: l.categoria, icono: l.icono, nombre: l.nombre, descripcion: l.descripcion,
      titulo: l.titulo, tituloTexto: l.tituloTexto,
      objetivo: l.objetivo, actual, pct: actual / l.objetivo,
      desbloqueado: n >= 1, completado: n === l.escalones.length, fecha: e.desbloqueados[l.id] ?? null,
      escalon: n, totalEscalones: l.escalones.length,
      escalones: l.escalones.map((x) => ({ ...x, conseguido: x.n <= n })),
      siguiente: sig ? { ...sig, progreso: Math.min(v, sig.meta), pct: Math.min(1, v / sig.meta) } : null,
    };
  });
}

/**
 * Resumen para la UI.
 * @param {object} estado
 * @param {number} [limite=5] nº máximo de próximos escalones en `siguientes`
 * @returns {{total:number, desbloqueados:number, completados:number, medallas:number, totalMedallas:number,
 *            pct:number, pctMedallas:number,
 *            porCategoria:Record<string,{nombre:string, icono:string, total:number, desbloqueados:number, completados:number, medallas:number, totalMedallas:number}>,
 *            siguientes:Array<{id:string, nombre:string, icono:string, categoria:string, progreso:number, meta:number, escalon:number, medalla:string, recompensa:object, pct:number}>}}
 *   `total` = nº de logros (familias); `desbloqueados` = logros con ≥1 medalla; `siguientes` = próximos escalones
 *   ordenados por cercanía (pct desc).
 */
export function resumenLogros(estado, limite = 5) {
  const lista = listaLogros(estado);
  const suma = (arr, k) => arr.reduce((s, x) => s + x[k], 0);
  const porCategoria = Object.fromEntries(CATEGORIAS.map((cat) => {
    const ls = lista.filter((x) => x.categoria === cat.id);
    return [cat.id, {
      nombre: cat.nombre, icono: cat.icono, total: ls.length,
      desbloqueados: ls.filter((x) => x.desbloqueado).length,
      completados: ls.filter((x) => x.completado).length,
      medallas: suma(ls, "escalon"), totalMedallas: suma(ls, "totalEscalones"),
    }];
  }));
  const total = LOGROS.length;
  const desbloqueados = lista.filter((x) => x.desbloqueado).length;
  const medallas = suma(lista, "escalon");
  const totalMedallas = suma(lista, "totalEscalones");
  const siguientes = lista
    .filter((x) => x.siguiente)
    .map((x) => ({
      id: x.id, nombre: x.nombre, icono: x.icono, categoria: x.categoria,
      progreso: x.siguiente.progreso, meta: x.siguiente.meta, escalon: x.siguiente.n,
      medalla: x.siguiente.medalla, recompensa: x.siguiente.recompensa, pct: x.siguiente.pct,
    }))
    .sort((a, b) => b.pct - a.pct || a.meta - b.meta)
    .slice(0, Math.max(0, Number(limite) || 0));
  return {
    total, desbloqueados, completados: lista.filter((x) => x.completado).length,
    medallas, totalMedallas, pct: desbloqueados / total, pctMedallas: medallas / totalMedallas,
    porCategoria, siguientes,
  };
}

/** Ids de títulos que el jugador puede llevar (logros completos + externos). */
export function titulosDisponibles(estado) {
  const s = sanearLogros(estado);
  return [...new Set([...titulosGanados(s.c), ...s.titulosExtra])];
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
