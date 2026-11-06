// UI de enganche de Loot Arena 1.2 (MEJORAS-1.2.md §7): recompensa diaria on-chain, misiones,
// pase de temporada, desafío diario, logros, colección y ranking.
//
// Partes:
//   1. Utilidades puras (fechas UTC, tabla diaria, normalización de respuestas, avisos) → tests.
//   2. Adaptadores de misiones.js / pase.js / logros.js / coleccion.js / desafio.js (§5): la lógica
//      es suya; aquí solo se unifica la interfaz y se reparte cada evento a todos los sistemas.
//   3. Recompensas on-chain (ethers v6) y servidor (GET /ranking, POST /recompensa).
//   4. UI: montarEnganche / registrarEvento / registrarCombate / refrescarEnganche / desmontarEnganche,
//      iniciarDesafio / terminarDesafio, tituloActivo.
//
// No toca el DOM al importarse (se puede probar con node --test).
import {
  CATALOGO, RAREZAS_COSMETICO, direccionValida, abiDe, unirAbi, aBigInt, normalizarPrecio, aUnidades, mensajeErrorEconomia,
} from "./economy.js";

// ───────────────────────── 1. Utilidades puras ─────────────────────────

export const DIA_MS = 86_400_000;
/** Días desde 1970-01-01 (UTC), como `block.timestamp / 1 days`. */
export const diaUTC = (ms = Date.now()) => Math.floor(ms / DIA_MS);
/** Instante (ms) en que empieza el siguiente día UTC. */
export const finDiaUTC = (ms = Date.now()) => (diaUTC(ms) + 1) * DIA_MS;
/** Semana UTC empezando en lunes (igual que misiones.semanaUTC: el día 4 desde epoch fue lunes). */
export const semanaUTC = (ms = Date.now()) => Math.floor((diaUTC(ms) - 4) / 7);
export const finSemanaUTC = (ms = Date.now()) => ((semanaUTC(ms) + 1) * 7 + 4) * DIA_MS;
/** Fecha "AAAA-MM-DD" (UTC). */
export const fechaUTC = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);

/**
 * Cuenta atrás legible: "1 d 03:05:09", "03:05:09", "00:00:00".
 * @param {number} ms
 */
export function formatearCuentaAtras(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(t / 86400), hh = Math.floor((t % 86400) / 3600), mm = Math.floor((t % 3600) / 60), ss = t % 60;
  const p = (n) => String(n).padStart(2, "0");
  return `${d ? `${d} d ` : ""}${p(hh)}:${p(mm)}:${p(ss)}`;
}

/** Racha de la recompensa diaria: ciclo de 7 días. */
export const RACHA_CICLO = 7;
/**
 * Recompensa del día `n` de racha (1..∞; se repite el ciclo de 7): 10 ORO el día 1, +5 por día,
 * 40 ORO el día 7 + cofre cosmético.
 * @returns {{dia:number, oro:number, cofre:boolean}}
 */
export function recompensaDiaria(n) {
  const dia = ((Math.max(1, Math.floor(n)) - 1) % RACHA_CICLO) + 1;
  return { dia, oro: 10 + 5 * (dia - 1), cofre: dia === RACHA_CICLO };
}

/**
 * Normaliza `Recompensas.estadoDiario(jugador)` → (racha, ultimoDia, puedeReclamar, segundosHastaSiguiente, proximaRecompensa).
 * Acepta el Result de ethers (array con nombres), un array o un objeto.
 * @returns {{racha:number, ultimoDia:number, puedeReclamar:boolean, segundos:number, proxima:{dia:number, oro:number, cofre:boolean}, rachaSiguiente:number}}
 */
export function normalizarEstadoDiario(raw, ahora = Date.now()) {
  const v = (i, k) => raw?.[k] ?? raw?.[i];
  const racha = Number(aBigInt(v(0, "racha") ?? 0));
  const ultimoDia = Number(aBigInt(v(1, "ultimoDia") ?? 0));
  const puedeReclamar = !!v(2, "puedeReclamar");
  const segundos = Number(aBigInt(v(3, "segundosHastaSiguiente") ?? 0));
  const hoy = diaUTC(ahora);
  // Si reclamó ayer, la racha sigue; si no, vuelve al día 1.
  const rachaSiguiente = puedeReclamar ? (ultimoDia === hoy - 1 && racha > 0 ? racha + 1 : 1) : racha + 1;
  const tabla = recompensaDiaria(rachaSiguiente);
  const crudo = v(4, "proximaRecompensa");
  const oro = crudo != null ? normalizarPrecio(crudo) : tabla.oro;
  return { racha, ultimoDia, puedeReclamar, segundos, rachaSiguiente, proxima: { ...tabla, oro: oro || tabla.oro } };
}

/** Categorías del ranking (GET /ranking). */
export const CATEGORIAS_RANKING = Object.freeze([
  Object.freeze({ id: "objetos", nombre: "Objetos", largo: "Más objetos conseguidos", icono: "🎒", unidad: "" }),
  Object.freeze({ id: "legendarios", nombre: "Legendarios", largo: "Más legendarios", icono: "🌟", unidad: "" }),
  Object.freeze({ id: "oroVentas", nombre: "ORO vendiendo", largo: "Más ORO ganado vendiendo", icono: "🪙", unidad: " ORO" }),
  Object.freeze({ id: "rachaDiaria", nombre: "Racha diaria", largo: "Mayor racha diaria", icono: "🔥", unidad: " días" }),
]);

const valorNumero = (cat, v) => {
  try { return cat === "oroVentas" ? normalizarPrecio(v) : Number(aBigInt(v)); } catch { return Number(v) || 0; }
};

/**
 * Normaliza la respuesta de GET /ranking: `{actualizado, categorias:{objetos:[{address, valor}], …}}`.
 * Tolerante: valores como string/bigint/número, ORO en unidades base o entero, categorías ausentes.
 * @returns {{actualizado:number|null, categorias:Record<string, Array<{posicion:number, address:string, valor:number}>>}}
 */
export function normalizarRanking(json) {
  const cats = json?.categorias ?? {};
  const out = {};
  for (const { id } of CATEGORIAS_RANKING) {
    const lista = Array.isArray(cats[id]) ? cats[id] : [];
    out[id] = lista
      .filter((x) => typeof (x?.address ?? x?.jugador) === "string")
      .map((x) => ({ address: x.address ?? x.jugador, valor: valorNumero(id, x.valor ?? x.value ?? 0) }))
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 20)
      .map((x, i) => ({ posicion: i + 1, ...x }));
  }
  const act = json?.actualizado;
  return { actualizado: act == null ? null : (typeof act === "number" ? act : Date.parse(act) || null), categorias: out };
}

/**
 * Normaliza GET /ranking/:address. Acepta `{categorias:{objetos:{posicion, valor}}}`, `{objetos:{…}}`
 * o `{posiciones:{objetos: 3}}`. Posición null = fuera del ranking.
 * @returns {Record<string, {posicion:number|null, valor:number|null}>}
 */
export function normalizarPosicion(json) {
  const fuente = json?.categorias ?? json?.posiciones ?? json ?? {};
  const out = {};
  for (const { id } of CATEGORIAS_RANKING) {
    const x = fuente[id];
    if (x == null) { out[id] = { posicion: null, valor: null }; continue; }
    if (typeof x === "number") { out[id] = { posicion: x > 0 ? x : null, valor: null }; continue; }
    const pos = Number(x.posicion ?? x.position ?? x.puesto);
    out[id] = { posicion: Number.isFinite(pos) && pos > 0 ? pos : null, valor: x.valor == null ? null : valorNumero(id, x.valor) };
  }
  return out;
}

/** Dirección abreviada. */
export const acortar = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

/**
 * Calcula qué secciones del menú deben mostrar el punto rojo.
 * @param {{diario?:{puedeReclamar:boolean}|null, misiones?:any, pase?:any, logrosNuevos?:number}} v
 * @returns {{misiones:boolean, logros:boolean, cuentas:{misiones:number, logros:number}}}
 *   El desafío pendiente enciende el aviso pero no suma a la cuenta (no es "algo que reclamar").
 */
export function calcularAvisos({ diario = null, misiones = null, pase = null, desafio = null, logrosNuevos = 0 } = {}) {
  const pendiente = (m) => !!m && m.completada && !m.reclamada;
  const nMisiones = misiones ? [...(misiones.diarias ?? []), misiones.semanal, misiones.bonus].filter(pendiente).length : 0;
  const nPase = pase ? (pase.niveles ?? []).filter((n) => n.alcanzado && !n.reclamado).length : 0;
  const nDiario = diario?.puedeReclamar ? 1 : 0;
  const hayDesafio = !!desafio && desafio.disponible && !desafio.intentado;
  const cm = nMisiones + nPase + nDiario;
  return { misiones: cm > 0 || hayDesafio, logros: logrosNuevos > 0, cuentas: { misiones: cm, logros: Math.max(0, logrosNuevos) } };
}


// ───────────────────────── 2. Adaptadores de los módulos de §5 ─────────────────────────
// enganche.js no reimplementa la lógica: envuelve misiones.js, pase.js, logros.js, coleccion.js y
// desafio.js en una interfaz común. Si un módulo falta o no exporta lo necesario, su panel se
// muestra como "no disponible" y el resto sigue funcionando.

const NOMBRE_RAREZA = ["Común", "Raro", "Legendario"];

/** Funciones que debe exportar cada módulo de §5 para poder usarse. */
export const FIRMAS = Object.freeze({
  misiones: ["estadoMisiones", "registrar", "reclamar", "cargarMisiones", "guardarMisiones", "claveMisiones"],
  pase: ["estadoPase", "sumarPuntos", "puntosPorEvento", "reclamarNivel", "recompensaNivel", "temporada", "nivelPase", "cargarPase", "guardarPase", "clavePase"],
  logros: ["registrar", "listaLogros", "titulosDisponibles", "elegirTitulo", "cargarLogros", "guardarLogros", "claveLogros"],
  coleccion: ["registrar", "resumenColeccion", "cargarColeccion", "guardarColeccion", "claveColeccion"],
  desafio: ["desafioDeHoy", "estadoDesafio", "iniciarIntento", "finalizarIntento", "cargarDesafio", "guardarDesafio", "claveDesafio"],
});

const cumple = (m, fns) => !!m && fns.every((f) => typeof m[f] === "function");

/** Recompensa del pase en formato de UI: {tipo, texto, icono, motivo?, oro?, cantidad?, id?, titulo?}. */
export function recompensaUI(r = {}) {
  const texto = r.nombre ?? r.texto ?? (r.tipo === "oro" ? `${r.cantidad} ORO` : r.tipo ?? "Premio");
  return { ...r, texto, icono: r.icono ?? "🎁", motivo: r.onchain || r.motivo ? r.motivo : undefined, oro: r.tipo === "oro" ? Number(r.cantidad) || 0 : undefined };
}

function adaptarMisiones(m) {
  return {
    cargar: (cta, st, t) => m.cargarMisiones(m.claveMisiones(cta), st, t),
    guardar: (cta, e, st) => m.guardarMisiones(m.claveMisiones(cta), e, st),
    registrar: (e, ev, t) => { const r = m.registrar(e, ev, t); return { estado: r.progreso, completadas: r.completadas ?? [] }; },
    vista(e, t) {
      const q = m.estadoMisiones(e, t);
      const conv = (x, rec) => ({ id: x.id, nombre: x.texto, icono: x.icono, progreso: x.progreso, objetivo: x.objetivo, completada: !!x.completada, reclamada: !!x.reclamada, recompensa: rec ?? {} });
      const diarias = q.diarias.map((x) => conv(x, m.RECOMPENSA_DIARIA?.[x.dificultad]));
      const hechas = q.diarias.filter((x) => x.completada && x.reclamada).length;
      return {
        diarias,
        bonus: { id: "bonus", nombre: "Completa y reclama las 3 misiones", icono: "🏆", progreso: hechas, objetivo: q.diarias.length,
          completada: hechas === q.diarias.length, reclamada: !!q.bonusReclamado, recompensa: m.RECOMPENSA_BONUS ?? {} },
        semanal: conv(q.semanal, m.RECOMPENSA_SEMANAL),
        finDia: t + (m.msHastaManana?.(t) ?? finDiaUTC(t) - t),
        finSemana: t + (m.msHastaProximaSemana?.(t) ?? finSemanaUTC(t) - t),
      };
    },
    reclamar: (e, id, t) => { const r = m.reclamar(e, id, t); return { ok: !!r.ok, estado: r.progreso, recompensa: r.recompensa, motivo: r.motivo }; },
  };
}

function adaptarPase(m) {
  const total = m.NIVELES_PASE ?? 30;
  return {
    cargar: (cta, st, t) => m.cargarPase(m.clavePase(cta), st, t),
    guardar: (cta, e, st) => m.guardarPase(m.clavePase(cta), e, st),
    puntosPorEvento: (ev) => Number(m.puntosPorEvento(ev)) || 0,
    sumar: (e, pts, t) => { const r = m.sumarPuntos(e, pts, t); return { estado: r.progreso, niveles: r.niveles ?? [] }; },
    vista(e, t) {
      const q = m.estadoPase(e, t), temp = m.temporada(t), nv = m.nivelPase(q.puntos);
      return {
        temporada: temp.numero, inicio: temp.inicio, fin: temp.fin, nivel: nv.nivel, max: total, puntos: q.puntos,
        puntosNivel: nv.puntosEnNivel, puntosSiguiente: nv.necesarios,
        niveles: Array.from({ length: total }, (_, i) => ({ nivel: i + 1, recompensa: recompensaUI(m.recompensaNivel(i + 1)), alcanzado: nv.nivel >= i + 1, reclamado: q.reclamados.includes(i + 1) })),
      };
    },
    reclamar: (e, n, t) => { const r = m.reclamarNivel(e, n, t); return { ok: !!r.ok, estado: r.progreso, recompensa: r.recompensa && recompensaUI(r.recompensa), motivo: r.motivo }; },
    titulos: m.TITULOS_PASE ?? {},
  };
}

function adaptarLogros(m) {
  return {
    cargar: (cta, st) => m.cargarLogros(m.claveLogros(cta), st),
    guardar: (cta, e, st) => m.guardarLogros(m.claveLogros(cta), e, st),
    registrar: (e, ev, t) => { const r = m.registrar(e, ev, t); return { estado: r.progreso, nuevos: r.nuevos ?? [] }; },
    vista: (e) => m.listaLogros(e).map((l) => ({
      id: l.id, nombre: l.nombre, descripcion: l.descripcion, icono: l.icono, categoria: l.categoria,
      titulo: l.tituloTexto ?? null, conseguido: !!l.desbloqueado, progreso: l.actual, objetivo: l.objetivo, fecha: l.fecha,
    })),
    titulos: (e, extra = {}) => m.titulosDisponibles(e).map((id) => ({ id, texto: m.textoTitulo ? m.textoTitulo(id, extra) : extra[id] ?? id })),
    tituloActual: (e) => e?.titulo ?? null,
    elegirTitulo: (e, id) => { const r = m.elegirTitulo(e, id); return { ok: !!r.ok, estado: r.progreso, motivo: r.motivo }; },
  };
}

function adaptarColeccion(m) {
  return {
    cargar: (cta, st) => m.cargarColeccion(m.claveColeccion(cta), st),
    guardar: (cta, e, st) => m.guardarColeccion(m.claveColeccion(cta), e, st),
    registrar: (e, ev) => { const r = m.registrar(e, ev); return { estado: r.progreso, nuevos: r.nuevos ?? [] }; },
    vista(e) {
      const r = m.resumenColeccion(e, CATALOGO);
      return {
        bestiario: r.bestiario.entradas.map((b) => ({ clave: b.clave, nombre: b.nombre, emoji: b.emoji, vencidos: b.vencidos, jefe: !!b.jefeDerrotado })),
        objetos: r.objetos.celdas.map((c) => ({ tipo: c.tipo, rareza: c.rareza, tengo: !!c.obtenido })),
        cosmeticos: r.cosmeticos.entradas.map((c) => ({ id: c.id, nombre: c.nombre ?? `Cosmético ${c.id}`, icono: c.icono ?? "❔", rareza: c.rareza ?? 0, tengo: !!c.obtenido })),
        porcentaje: Math.round((r.total?.pct ?? 0) * 100),
      };
    },
  };
}

function adaptarDesafio(m, pase) {
  return {
    cargar: (cta, st, t) => m.cargarDesafio(m.claveDesafio(cta), st, t),
    guardar: (cta, e, st) => m.guardarDesafio(m.claveDesafio(cta), e, st),
    vista(e, t) {
      const d = m.desafioDeHoy(t), q = m.estadoDesafio(e, t);
      const puntos = pase ? pase.puntosPorEvento({ tipo: "desafio", victoria: true }) : null;
      return {
        dia: d.dia, titulo: d.titulo, semilla: d.semilla,
        enemigo: { clave: d.clave, nombre: d.nombre, emoji: d.emoji, nivel: d.nivel, jefe: !!d.jefe },
        modificadores: (d.modificadores ?? []).map((x) => ({ id: x.id, icono: x.icono, texto: x.nombre, detalle: x.descripcion })),
        recompensa: { puntos }, disponible: true,
        intentado: !!q.intentado, terminado: !!q.terminado, victoria: !!q.victoria, puntuacion: q.puntuacion ?? 0,
        mejor: q.mejor ?? 0, ganados: q.ganados ?? 0, jugados: q.jugados ?? 0, fin: t + (d.msRestantes ?? finDiaUTC(t) - t),
      };
    },
    iniciar: (e, t) => { const r = m.iniciarIntento(e, t); return { ok: !!r.ok, estado: r.progreso, desafio: r.desafio, motivo: r.motivo }; },
    finalizar: (e, combate, t) => { const r = m.finalizarIntento(e, combate, t); return { ok: !!r.ok, estado: r.progreso, resultado: r.resultado, evento: r.evento, motivo: r.motivo }; },
    crearCombate: typeof m.crearCombateDesafio === "function" ? (desafio, heroe) => m.crearCombateDesafio(desafio, heroe) : null,
  };
}

/**
 * Envuelve los módulos de §5 que cumplan su firma. Los que falten quedan a null.
 * @param {{misiones?:any, pase?:any, logros?:any, coleccion?:any, desafio?:any}} mods
 * @returns {{sistemas:Record<string, object|null>, origen:Record<string, "ok"|"falta">, eventosDeCombate:Function|null}}
 */
export function adaptarModulos(mods = {}) {
  const ok = Object.fromEntries(Object.entries(FIRMAS).map(([k, fns]) => [k, cumple(mods[k], fns)]));
  const pase = ok.pase ? adaptarPase(mods.pase) : null;
  const sistemas = {
    misiones: ok.misiones ? adaptarMisiones(mods.misiones) : null,
    pase,
    logros: ok.logros ? adaptarLogros(mods.logros) : null,
    coleccion: ok.coleccion ? adaptarColeccion(mods.coleccion) : null,
    desafio: ok.desafio ? adaptarDesafio(mods.desafio, pase) : null,
  };
  const origen = Object.fromEntries(Object.keys(FIRMAS).map((k) => [k, ok[k] ? "ok" : "falta"]));
  const eventosDeCombate = typeof mods.misiones?.eventosDeCombate === "function" ? mods.misiones.eventosDeCombate : null;
  return { sistemas, origen, eventosDeCombate };
}

/**
 * Convierte formas alternativas de evento a la de misiones.normalizarEvento (la canónica):
 * `{tipo:"victoria", enemigo:{clave, jefe, nivel}}` → `{tipo:"victoria", clave, jefe, nivel}`;
 * `{tipo:"desafio", resultado:"victoria"}` → `{victoria:true}`; `{tipo:"nivel", nivel}` → `{valor}`;
 * `{tipo:"cosmeticos", saldos:{id:n}}` → `{ids:[…]}`. Devuelve null si no es un evento.
 */
export function normalizarEntrada(ev) {
  if (!ev || typeof ev !== "object" || typeof ev.tipo !== "string") return null;
  let e = { ...ev };
  if (e.enemigo && typeof e.enemigo === "object") {
    const { clave, jefe, nivel, nombre } = e.enemigo;
    e = { ...e, clave: e.clave ?? clave, jefe: e.jefe ?? !!jefe, nivel: e.nivel ?? nivel, nombre: e.nombre ?? nombre };
    delete e.enemigo;
  }
  if (e.tipo === "desafio" && e.victoria == null && e.resultado != null) e.victoria = e.resultado === "victoria";
  if (e.tipo === "nivel" && e.valor == null && e.nivel != null) e.valor = e.nivel;
  if (e.tipo === "cosmeticos" && !Array.isArray(e.ids) && e.saldos) e.ids = Object.entries(e.saldos).filter(([, n]) => Number(n) > 0).map(([id]) => Number(id));
  return e;
}

/**
 * Aplica un evento a todos los sistemas disponibles (pura). Los niveles de pase alcanzados se
 * registran también en logros como `{tipo:"pase", nivel}`.
 * @param {Record<string, any>} estados  estado de cada sistema
 * @param {object} evento
 * @param {Record<string, object|null>} sistemas  de adaptarModulos
 * @returns {{estados:object, logrosNuevos:object[], nivelesPase:number[], misionesCompletadas:object[]}}
 */
export function aplicarEvento(estados, evento, sistemas, ahora = Date.now()) {
  const ev = normalizarEntrada(evento);
  const out = { estados: { ...estados }, logrosNuevos: [], nivelesPase: [], misionesCompletadas: [] };
  if (!ev) return out;
  const E = out.estados, A = sistemas;
  if (A.misiones) { const r = A.misiones.registrar(E.misiones, ev, ahora); E.misiones = r.estado; out.misionesCompletadas = r.completadas; }
  if (A.coleccion) E.coleccion = A.coleccion.registrar(E.coleccion, ev, ahora).estado;
  const logro = (x) => { if (!A.logros) return; const r = A.logros.registrar(E.logros, x, ahora); E.logros = r.estado; out.logrosNuevos.push(...r.nuevos); };
  logro(ev);
  if (A.pase) {
    const pts = A.pase.puntosPorEvento(ev);
    if (pts > 0) {
      const r = A.pase.sumar(E.pase, pts, ahora);
      E.pase = r.estado; out.nivelesPase = r.niveles;
      for (const n of r.niveles) logro({ tipo: "pase", nivel: n });
    }
  }
  return out;
}

/** Clave del estado propio de enganche.js (logros ya vistos). */
export const claveEnganche = (cuenta) => `lootarena:enganche:${cuenta ? String(cuenta).toLowerCase() : "invitado"}`;
function storagePorDefecto() { try { return globalThis.localStorage ?? null; } catch { return null; } }
/** @returns {{vistos:string[]}} */
export function cargarPropio(cuenta, storage = storagePorDefecto()) {
  try {
    const d = JSON.parse(storage?.getItem(claveEnganche(cuenta)) ?? "null");
    return { vistos: Array.isArray(d?.vistos) ? d.vistos.filter((x) => typeof x === "string") : [] };
  } catch { return { vistos: [] }; }
}
export function guardarPropio(cuenta, propio, storage = storagePorDefecto()) {
  try { storage?.setItem(claveEnganche(cuenta), JSON.stringify({ vistos: propio.vistos ?? [] })); } catch { /* sin almacenamiento */ }
}

// ───────────────────────── 3. Recompensas on-chain y servidor ─────────────────────────

/** ABI mínimo de Recompensas.sol (MEJORAS-1.2 §3). */
export const ABI_RECOMPENSAS = Object.freeze([
  "function reclamarDiario()",
  "function estadoDiario(address jugador) view returns (uint256 racha, uint256 ultimoDia, bool puedeReclamar, uint256 segundosHastaSiguiente, uint256 proximaRecompensa)",
  "event DiarioReclamado(address indexed jugador, uint256 indexed dia, uint256 racha, uint256 oro, uint256 cosmeticoId)",
  "event Recompensado(address indexed jugador, uint256 cantidad, string motivo)",
  "error YaReclamadoHoy(uint256 segundosHastaSiguiente)",
  "error TopeJugadorSuperado(uint256 restante, uint256 pedido)",
]);

/** Dirección de Recompensas de la red activa (`cfg.recompensas` o `config/deployments.json` → `<red>.recompensas`). */
export async function resolverRecompensas(cfg, { fetch: f = globalThis.fetch, base = import.meta.url } = {}) {
  if (direccionValida(cfg?.recompensas)) return cfg.recompensas;
  if (direccionValida(cfg?.economia?.recompensas)) return cfg.economia.recompensas;
  if (!f) return null;
  try {
    const res = await f(new URL("../config/deployments.json", base), { cache: "no-cache" });
    const d = res.ok ? await res.json() : null;
    const dir = d?.[cfg?.red ?? "sepolia"]?.recompensas;
    return direccionValida(dir) ? dir : null;
  } catch { return null; }
}

async function cargarAbiRecompensas({ fetch: f = globalThis.fetch, base = import.meta.url } = {}) {
  for (const ruta of ["../config/Recompensas.abi.json", "../../shared/Recompensas.abi.json"]) {
    try {
      const res = await f(new URL(ruta, base), { cache: "no-cache" });
      if (res.ok) { const abi = abiDe(await res.json()); if (abi) return unirAbi(abi, ABI_RECOMPENSAS); }
    } catch { /* siguiente */ }
  }
  return [...ABI_RECOMPENSAS];
}

/** Interpreta el recibo de reclamarDiario. */
function leerDiarioReclamado(iface, direccion, rec) {
  for (const log of rec?.logs ?? []) {
    if (log.address?.toLowerCase() !== direccion.toLowerCase()) continue;
    try {
      const p = iface.parseLog(log);
      if (p?.name === "DiarioReclamado") return { racha: Number(p.args[2]), oro: normalizarPrecio(p.args[3]), cosmeticoId: Number(p.args[4]) || null };
    } catch { /* otro evento */ }
  }
  return null;
}

/**
 * Recompensas en cadena. @returns {{estado:() => Promise<ReturnType<typeof normalizarEstadoDiario>>, reclamar:() => Promise<{hash:string, esperar:() => Promise<any>}>}}
 */
export function crearRecompensasChain({ ethers, provider, signer, cuenta, direccion, abi }) {
  const c = new ethers.Contract(direccion, abi, provider);
  return {
    modo: "chain",
    estado: async () => normalizarEstadoDiario(await c.estadoDiario(cuenta)),
    reclamar: async () => {
      const tx = await c.connect(signer).reclamarDiario();
      return { hash: tx.hash, esperar: async () => leerDiarioReclamado(c.interface, direccion, await tx.wait()) };
    },
  };
}

/** Recompensas simuladas en memoria (demo). */
export function crearRecompensasSimulada({ racha = 0, ultimoDia = null, latencia = 600, ahora = () => Date.now() } = {}) {
  const e = { racha, ultimoDia: ultimoDia ?? diaUTC(ahora()) - 1 };
  const crudo = () => {
    const hoy = diaUTC(ahora());
    const puede = e.ultimoDia < hoy;
    const sig = puede ? (e.ultimoDia === hoy - 1 ? e.racha + 1 : 1) : e.racha + 1;
    return { racha: e.racha, ultimoDia: e.ultimoDia, puedeReclamar: puede, segundosHastaSiguiente: puede ? 0 : Math.ceil((finDiaUTC(ahora()) - ahora()) / 1000), proximaRecompensa: aUnidades(recompensaDiaria(sig).oro) };
  };
  return {
    modo: "simulada",
    _estado: e,
    estado: async () => normalizarEstadoDiario(crudo(), ahora()),
    reclamar: async () => {
      const est = normalizarEstadoDiario(crudo(), ahora());
      if (!est.puedeReclamar) throw Object.assign(new Error("YaReclamadoHoy"), { code: "CALL_EXCEPTION", revert: { name: "YaReclamadoHoy" } });
      await new Promise((r) => setTimeout(r, latencia / 3));
      return {
        hash: `0x${"d".repeat(64)}`,
        esperar: async () => {
          await new Promise((r) => setTimeout(r, latencia));
          e.racha = est.rachaSiguiente; e.ultimoDia = diaUTC(ahora());
          const p = recompensaDiaria(e.racha);
          return { racha: e.racha, oro: p.oro, cosmeticoId: p.cofre ? 1 + Math.floor(Math.random() * 13) : null };
        },
      };
    },
  };
}

/** Espera (ms) que indica Retry-After (segundos o fecha HTTP), acotada a 30 s; sin cabecera, 5 s. */
export function esperaRetryAfter(valor, ahora = Date.now()) {
  if (valor == null || String(valor).trim() === "") return 5000;
  const s = Number(valor);
  if (Number.isFinite(s)) return Math.min(30_000, Math.max(0, s * 1000));
  const f = Date.parse(valor);
  return Number.isFinite(f) ? Math.min(30_000, Math.max(0, f - ahora)) : 5000;
}

const MSG_SINCRONIZANDO = "El ranking aún no está disponible: el servidor lo está sincronizando con la blockchain.";
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * GET /ranking y, si hay cuenta, GET /ranking/:address. Un 503 (el servidor está indexando; la primera
 * vez tarda ~30 s) se reintenta esperando Retry-After, hasta `intentos` peticiones en total.
 * `onEstado({estado:"sincronizando", intento, de, esperaMs})` avisa antes de cada espera.
 * @returns {Promise<{ranking, posicion}|{error:string, sincronizando?:true}>}
 */
export async function pedirRanking(serverUrl, cuenta, { fetch: f = globalThis.fetch, timeoutMs = 60_000, intentos = 3, esperar = dormir, onEstado } = {}) {
  const base = String(serverUrl ?? "").replace(/\/+$/, "");
  // Una petición con timeout: {status:503, retryAfter} | {json} | {error}.
  const una = async (ruta) => {
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const t = ctl && setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await f(`${base}${ruta}`, { signal: ctl?.signal, cache: "no-store" });
      if (res.status === 503) return { status: 503, retryAfter: res.headers?.get?.("Retry-After") ?? null };
      if (!res.ok) return { error: `El servidor respondió ${res.status}.` };
      return { json: await res.json() };
    } catch (e) {
      return { error: e?.name === "AbortError" ? "El servidor tarda en responder (puede estar despertando)." : "No se pudo contactar con el servidor." };
    } finally { if (t) clearTimeout(t); }
  };
  const get = async (ruta, avisar) => {
    for (let intento = 1; ; intento++) {
      const r = await una(ruta);
      if (r.status !== 503) return r;
      if (intento >= intentos) return { error: MSG_SINCRONIZANDO, sincronizando: true };
      const esperaMs = esperaRetryAfter(r.retryAfter);
      if (avisar) { try { onEstado?.({ estado: "sincronizando", intento, de: intentos, esperaMs }); } catch { /* solo UI */ } }
      await esperar(esperaMs);
    }
  };
  const [r, p] = await Promise.all([get("/ranking", true), cuenta ? get(`/ranking/${cuenta}`, false) : Promise.resolve(null)]);
  if (r.error) return r.sincronizando ? { error: r.error, sincronizando: true } : { error: r.error };
  return { ranking: normalizarRanking(r.json), posicion: p?.json ? normalizarPosicion(p.json) : null };
}

/**
 * POST /recompensa {address, motivo}. motivo ∈ pase10 | pase20 | pase30 | misiones_diarias.
 * @returns {Promise<{ok:boolean, mensaje:string, txHash?:string, cantidad?:number}>}
 */
export async function pedirRecompensaServidor(serverUrl, address, motivo, { fetch: f = globalThis.fetch } = {}) {
  try {
    const res = await f(`${String(serverUrl ?? "").replace(/\/+$/, "")}/recompensa`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address, motivo }),
    });
    let body = null; try { body = await res.json(); } catch { /* sin cuerpo */ }
    if (res.ok) return { ok: true, mensaje: "Recompensa enviada a tu wallet.", txHash: body?.txHash ?? body?.hash, cantidad: body?.cantidad != null ? normalizarPrecio(body.cantidad) : undefined };
    const msg = { 400: "Petición no válida.", 409: "Ya reclamaste esta recompensa.", 429: "Has llegado al límite de recompensas de hoy.", 503: "Las recompensas on-chain aún no están disponibles." }[res.status];
    return { ok: false, mensaje: body?.error ?? msg ?? `El servidor respondió ${res.status}.`, status: res.status };
  } catch {
    return { ok: false, mensaje: "No se pudo contactar con el servidor." };
  }
}


// ───────────────────────── 4. UI ─────────────────────────

function h(tag, props = {}, ...hijos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") for (const [p, val] of Object.entries(v)) p.startsWith("--") ? el.style.setProperty(p, val) : (el.style[p] = val);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of hijos.flat(Infinity)) { if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c))); }
  return el;
}
const poner = (el, ...hijos) => el?.replaceChildren(...hijos.flat(Infinity).filter((x) => x != null && x !== false));
const barra = (v, max, clase = "") => h("div", { class: `eg-barra ${clase}`, role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(max), "aria-valuenow": String(v) },
  h("div", { class: "eg-barra-relleno", style: { width: `${max ? Math.min(100, (v / max) * 100) : 0}%` } }));
const cuentaAtras = (hasta, ahora) => h("span", { class: "eg-reloj", "data-eg-hasta": String(hasta) }, formatearCuentaAtras(hasta - ahora));
const noDisponible = (titulo, texto = "Este sistema aún no está disponible.") => [h("div", { class: "eg-cabeza" }, h("h3", {}, titulo)), h("p", { class: "eg-tenue" }, texto)];
/** IDs de los contenedores de MEJORAS-1.2 §6. */
export const IDS = Object.freeze({ diario: "diario", misiones: "misiones-diarias", semanal: "mision-semanal", pase: "pase", desafio: "desafio", logros: "logros", coleccion: "coleccion", ranking: "ranking" });
const SISTEMAS = Object.keys(FIRMAS);

let S = null;
let generacion = 0;
const cola = [];

/**
 * Monta la UI de enganche en los contenedores de §6 (#diario, #misiones-diarias, #mision-semanal,
 * #pase, #desafio, #logros, #coleccion, #ranking). Los que no existan se omiten. Idempotente.
 *
 * @param {object} o
 * @param {any} [o.provider]  ethers.BrowserProvider (sin él no se puede reclamar la recompensa diaria)
 * @param {any} [o.signer]
 * @param {string|null} [o.cuenta]  dirección conectada (null → progreso de "invitado")
 * @param {object} o.cfg            cargarConfig(): {red, net, serverUrl, …}; puede traer `recompensas`
 * @param {object} [o.fx]           fx.js: celebrarLogro, celebrarRecompensa, subirNivelPase, sonar (todos opcionales)
 * @param {string} [o.serverUrl]    por defecto cfg.serverUrl
 * @param {(seccion:"misiones"|"logros", hay:boolean, cuenta?:number) => void} [o.onAviso]  router.marcarAviso
 * @param {(r:{tipo:string, [k:string]:any}) => void} [o.onRecompensa]  premios que aplica main:
 *        {tipo:"xp", xp} · {tipo:"pociones", cantidad} · {tipo:"marco", id} · {tipo:"diario", oro, racha, cosmetico}
 * @param {(desafio:object, ayuda:{crearCombate:(heroe:object)=>{combate:object, rng:Function}}) => void} [o.onJugarDesafio]
 *        main lanza el combate y al acabar llama terminarDesafio(combate)
 * @param {(titulo:{id:string, texto:string}|null) => void} [o.onCambioTitulo]
 * @param {object} [o.modulos]      {misiones, pase, logros, coleccion, desafio} ya importados (si no, import ./misiones.js…)
 * @param {object} [o.recompensas]  implementación inyectada (crearRecompensasSimulada) en lugar del contrato
 * @param {typeof fetch} [o.fetch]  fetch para el servidor (demo/tests)
 * @param {any} [o.ethers]          módulo ethers (si no, wallet.cargarEthers)
 * @param {Storage} [o.storage]     por defecto localStorage
 * @param {() => number} [o.ahora]  reloj (por defecto Date.now)
 * @param {Record<string, HTMLElement>} [o.raiz]  contenedores alternativos (claves de IDS)
 * @returns {Promise<{origen:Record<string,"ok"|"falta">, recompensas:"chain"|"simulada"|"no-desplegada"|"sin-wallet"|"error"}|null>}
 */
export async function montarEnganche(o = {}) {
  desmontarEnganche();
  const gen = ++generacion;
  const ahora = o.ahora ?? (() => Date.now());
  const mods = o.modulos ?? await importarModulos();
  if (gen !== generacion) return null;
  const { sistemas, origen, eventosDeCombate } = adaptarModulos(mods);
  S = {
    gen, o, ahora, A: sistemas, origen, eventosDeCombate,
    cuenta: o.cuenta ?? null,
    serverUrl: o.serverUrl ?? o.cfg?.serverUrl ?? "",
    els: Object.fromEntries(Object.entries(IDS).map(([k, id]) => [k, o.raiz?.[k] ?? document.getElementById(id)])),
    E: {}, propio: cargarPropio(o.cuenta ?? null, o.storage),
    diario: null, modoDiario: "sin-wallet", rec: null,
    ranking: null, posicion: null, errorRanking: null, catRanking: "objetos", cargandoRanking: false, sincronizando: false,
    ocupado: new Set(), timer: null, avisos: {},
  };
  for (const k of SISTEMAS) {
    if (!S.A[k]) continue;
    try { S.E[k] = S.A[k].cargar(S.cuenta, o.storage ?? globalThis.localStorage, ahora()); } catch (e) { console.warn(`[enganche] cargar ${k}:`, e); S.A[k] = null; }
  }
  for (const el of Object.values(S.els)) el?.classList.add("eg-montado");

  try {
    if (o.recompensas) { S.rec = o.recompensas; S.modoDiario = o.recompensas.modo ?? "simulada"; }
    else {
      const dir = await resolverRecompensas(o.cfg, { fetch: globalThis.fetch });
      if (!dir) S.modoDiario = "no-desplegada";
      else if (o.provider && o.cuenta) {
        const [eth, abi] = await Promise.all([o.ethers ?? import("./wallet.js").then((w) => w.cargarEthers()), cargarAbiRecompensas()]);
        const code = await o.provider.getCode(dir).catch(() => "0x");
        if (!code || code === "0x") S.modoDiario = "no-desplegada";
        else { S.rec = crearRecompensasChain({ ethers: eth, provider: o.provider, signer: o.signer ?? await o.provider.getSigner(), cuenta: o.cuenta, direccion: dir, abi }); S.modoDiario = "chain"; }
      }
    }
  } catch (e) {
    console.warn("[enganche] Recompensas no disponible:", e);
    if (S) S.modoDiario = "error";
  }
  if (!S || gen !== S.gen) return null;

  for (const ev of cola.splice(0)) procesar(ev, { silencioso: true });
  renderTodo();
  S.timer = setInterval(tic, 1000);
  await refrescarEnganche();
  return S ? { origen, recompensas: S.modoDiario } : null;
}

/** Desmonta: vacía los contenedores y para las cuentas atrás. */
export function desmontarEnganche() {
  generacion++;
  if (!S) return;
  clearInterval(S.timer);
  for (const el of Object.values(S.els)) { if (el) { el.replaceChildren(); el.classList.remove("eg-montado"); } }
  S = null;
}

/**
 * Registra un evento de juego (formato de misiones.normalizarEvento). Si la UI aún no está montada,
 * se encola (máx. 100) y se aplica al montar.
 *   victoria {clave, nivel, jefe, danoRecibido, turnos} · jefe {clave, nivel} · derrota · huida ·
 *   critico {cantidad} · habilidad {id, cantidad} · pocion {cantidad} · dano {cantidad} ·
 *   racha {valor} · nivel {valor} · botin {item} · inventario {items} · venta {cantidad, oro} ·
 *   compra {id, cantidad} · cofre {cantidad} · cosmeticos {ids}
 * (`diario`, `mision`, `pase`, `titulo` y `desafio` los emite enganche.js por su cuenta.)
 * Una victoria contra jefe debe ir acompañada de {tipo:"jefe"}: usa registrarCombate(combate).
 * @param {{tipo:string, [k:string]:any}} evento
 */
export function registrarEvento(evento) {
  if (!evento || typeof evento.tipo !== "string") return;
  if (!S) { if (cola.length < 100) cola.push(evento); return; }
  procesar(evento);
  renderTodo();
}

/** Registra todos los eventos de un combate terminado (misiones.eventosDeCombate). */
export function registrarCombate(combate) {
  const evs = S?.eventosDeCombate?.(combate) ?? [];
  if (!S) { for (const ev of evs) if (cola.length < 100) cola.push(ev); return evs; }
  for (const ev of evs) procesar(ev);
  renderTodo();
  return evs;
}

/** Vuelve a leer la recompensa diaria y el ranking, y repinta. */
export async function refrescarEnganche() {
  if (!S) return;
  renderTodo();
  await Promise.allSettled([refrescarDiario(), refrescarRanking()]);
}

/** Título elegido por el jugador: {id, texto} o null. */
export function tituloActivo() {
  if (!S?.A.logros) return null;
  const id = S.A.logros.tituloActual(S.E.logros);
  if (!id) return null;
  return S.A.logros.titulos(S.E.logros, S.A.pase?.titulos).find((t) => t.id === id) ?? { id, texto: id };
}

/**
 * Empieza el desafío de hoy: gasta el intento (y lo guarda) y devuelve el desafío y el combate.
 * La UI lo llama al pulsar «Aceptar el desafío»; main también puede llamarlo directamente.
 * @param {object} [heroe]  stats del héroe para desafio.crearCombateDesafio
 * @returns {{ok:boolean, desafio?:object, combate?:object, rng?:Function, motivo?:string}}
 */
export function iniciarDesafio(heroe) {
  if (!S?.A.desafio) return { ok: false, motivo: "El desafío no está disponible." };
  const r = S.A.desafio.iniciar(S.E.desafio, S.ahora());
  if (!r.ok) return { ok: false, motivo: r.motivo };
  S.E.desafio = r.estado; guardarSistema("desafio"); renderTodo();
  const c = heroe && S.A.desafio.crearCombate ? S.A.desafio.crearCombate(r.desafio, heroe) : {};
  return { ok: true, desafio: r.desafio, ...c };
}

/**
 * Registra el resultado del desafío de hoy con el combate terminado (y sus eventos de pase/logros/misiones).
 * @returns {{ok:boolean, resultado?:{victoria:boolean, puntuacion:number, mejorPersonal:boolean}, motivo?:string}}
 */
export function terminarDesafio(combate) {
  if (!S?.A.desafio) return { ok: false, motivo: "El desafío no está disponible." };
  const r = S.A.desafio.finalizar(S.E.desafio, combate, S.ahora());
  if (!r.ok) return { ok: false, motivo: r.motivo };
  S.E.desafio = r.estado; guardarSistema("desafio");
  if (r.evento) procesar(r.evento);
  renderTodo();
  return { ok: true, resultado: r.resultado };
}

function guardarSistema(k) {
  try { S.A[k]?.guardar(S.cuenta, S.E[k], S.o.storage ?? globalThis.localStorage); } catch (e) { console.warn(`[enganche] guardar ${k}:`, e); }
}
const guardarTodo = () => { for (const k of SISTEMAS) guardarSistema(k); };

function procesar(ev, { silencioso = false } = {}) {
  const r = aplicarEvento(S.E, ev, S.A, S.ahora());
  S.E = r.estados;
  guardarTodo();
  if (!silencioso) celebrar(r);
}

function celebrar({ logrosNuevos = [], nivelesPase = [], misionesCompletadas = [] }) {
  const fx = S.o.fx;
  for (const m of misionesCompletadas) aviso(`📜 Misión completada: ${m.texto ?? m.nombre}. ¡Reclámala en Misiones!`, "ok");
  for (const l of logrosNuevos) {
    const titulo = l.titulo ? S.A.logros?.titulos(S.E.logros, S.A.pase?.titulos).find((t) => t.id === l.titulo)?.texto : null;
    if (typeof fx?.celebrarLogro === "function") { try { fx.celebrarLogro({ ...l, tituloTexto: titulo }); continue; } catch (e) { console.warn(e); } }
    aviso(`🏅 ¡Logro: ${l.nombre}!${titulo ? ` Título «${titulo}» desbloqueado.` : ""}`, "ok");
  }
  for (const n of nivelesPase) {
    const rec = S.A.pase?.vista(S.E.pase, S.ahora()).niveles[n - 1]?.recompensa;
    if (typeof fx?.subirNivelPase === "function") { try { fx.subirNivelPase(n, { recompensa: rec?.texto ?? "" }); continue; } catch (e) { console.warn(e); } }
    aviso(`🎟️ ¡Nivel ${n} del pase de temporada!${rec ? ` Recompensa: ${rec.texto}` : ""}`, "ok");
  }
}

async function refrescarDiario() {
  if (!S?.rec) { renderDiario(); return; }
  const gen = S.gen;
  try {
    const d = await S.rec.estado();
    if (!S || gen !== S.gen) return;
    S.diario = { ...d, leido: S.ahora() };
  } catch (e) {
    console.warn("[enganche] estadoDiario:", e);
    if (S && gen === S.gen) S.diario = null;
  }
  if (!S || gen !== S.gen) return;
  renderDiario(); actualizarAvisos();
}

async function refrescarRanking() {
  if (!S || !S.els.ranking) return;
  if (!S.serverUrl && !S.o.fetch) { S.errorRanking = "Sin servidor configurado."; renderRanking(); return; }
  const gen = S.gen;
  S.cargandoRanking = true; S.sincronizando = false; S.errorRanking = null; renderRanking();
  const r = await pedirRanking(S.serverUrl, S.cuenta, {
    fetch: S.o.fetch ?? globalThis.fetch,
    onEstado: (e) => { if (S && gen === S.gen) { S.sincronizando = e.estado === "sincronizando"; renderRanking(); } },
  });
  if (!S || gen !== S.gen) return;
  S.cargandoRanking = false; S.sincronizando = false;
  if (r.error) S.errorRanking = r.error; else { S.errorRanking = null; S.ranking = r.ranking; S.posicion = r.posicion; }
  renderRanking();
}

function tic() {
  if (!S) return;
  const t = S.ahora();
  for (const el of document.querySelectorAll("[data-eg-hasta]")) {
    const hasta = Number(el.dataset.egHasta);
    el.textContent = formatearCuentaAtras(hasta - t);
    if (hasta <= t && !el.dataset.egVencido) { el.dataset.egVencido = "1"; setTimeout(() => { if (S) refrescarEnganche(); }, 1500); }
  }
}

function aviso(contenido, tipo = "info", ms = 5000) {
  let cont = document.getElementById("toasts");
  if (!cont) { cont = document.querySelector(".tn-toasts") ?? h("div", { class: "tn-toasts toasts", "aria-live": "polite" }); if (!cont.isConnected) document.body.append(cont); }
  const t = h("div", { class: `toast toast-${tipo}`, role: "status" }, contenido);
  cont.append(t);
  setTimeout(() => { t.classList.add("salida"); setTimeout(() => t.remove(), 400); }, ms);
}

function vistas() {
  const t = S.ahora(), A = S.A, E = S.E;
  const v = (k, fn) => { if (!A[k]) return null; try { return fn(); } catch (e) { console.warn(`[enganche] vista ${k}:`, e); return null; } };
  return {
    misiones: v("misiones", () => A.misiones.vista(E.misiones, t)),
    pase: v("pase", () => A.pase.vista(E.pase, t)),
    logros: v("logros", () => A.logros.vista(E.logros)),
    coleccion: v("coleccion", () => A.coleccion.vista(E.coleccion)),
    desafio: v("desafio", () => A.desafio.vista(E.desafio, t)),
  };
}

function actualizarAvisos(v = vistas()) {
  const nuevos = (v.logros ?? []).filter((l) => l.conseguido && !S.propio.vistos.includes(l.id)).length;
  const diario = S.modoDiario === "chain" || S.modoDiario === "simulada" ? S.diario : null;
  const a = calcularAvisos({ diario, misiones: v.misiones, pase: v.pase, desafio: v.desafio, logrosNuevos: nuevos });
  for (const k of ["misiones", "logros"]) {
    const clave = `${a[k]}:${a.cuentas[k]}`;
    if (S.avisos[k] === clave) continue;
    S.avisos[k] = clave;
    try { S.o.onAviso?.(k, a[k], a.cuentas[k] || undefined); } catch (e) { console.warn(e); }
  }
}

function renderTodo() {
  if (!S) return;
  const v = vistas();
  renderDiario(); renderMisiones(v.misiones); renderSemanal(v.misiones); renderPase(v.pase);
  renderDesafio(v.desafio); renderLogros(v.logros); renderColeccion(v.coleccion); renderRanking();
  actualizarAvisos(v);
}

// ── Recompensa diaria ──
function renderDiario() {
  const el = S?.els.diario;
  if (!el) return;
  const cab = h("div", { class: "eg-cabeza" }, h("h3", {}, "📅 Recompensa diaria"));
  if (S.modoDiario === "no-desplegada" || S.modoDiario === "error") {
    poner(el, cab, h("p", { class: "eg-tenue" }, S.modoDiario === "error" ? "La recompensa diaria no está disponible ahora mismo." : "La recompensa diaria on-chain llegará pronto a esta red."), filaRacha(0, 1));
    return;
  }
  if (S.modoDiario === "sin-wallet") {
    poner(el, cab, h("p", { class: "eg-tenue" }, "🦊 Conecta tu wallet para reclamar ORO cada día. ¡El día 7 regala un cofre!"), filaRacha(0, 1));
    return;
  }
  const d = S.diario;
  if (!d) { poner(el, cab, h("p", { class: "eg-tenue" }, "Leyendo tu racha…"), filaRacha(0, 1)); return; }
  const rachaVisible = d.puedeReclamar ? d.rachaSiguiente - 1 : d.racha;
  const hechos = rachaVisible <= 0 ? 0 : ((rachaVisible - 1) % RACHA_CICLO) + 1;
  const hoyCiclo = d.puedeReclamar ? recompensaDiaria(d.rachaSiguiente).dia : null;
  const ocupado = S.ocupado.has("diario");
  const hasta = d.puedeReclamar ? null : (d.segundos ? d.leido + d.segundos * 1000 : finDiaUTC(S.ahora()));
  if (d.puedeReclamar && d.rachaSiguiente === 1 && d.racha > 0) cab.append(h("span", { class: "eg-chip eg-chip-rota" }, "Racha rota: vuelves al día 1"));
  poner(el, cab,
    h("p", { class: "eg-diario-racha" }, d.racha > 0 ? `🔥 Racha: ${d.racha} día${d.racha === 1 ? "" : "s"}` : "Empieza tu racha hoy"),
    filaRacha(hechos, hoyCiclo),
    d.puedeReclamar
      ? h("button", { type: "button", class: "btn btn-gold eg-btn-diario", disabled: ocupado, onclick: reclamarDiario },
        ocupado ? "Reclamando…" : `Reclamar ${d.proxima.oro} ORO${d.proxima.cofre ? " + cofre 🎁" : ""}`)
      : h("p", { class: "eg-cuenta" }, "Siguiente recompensa en ", h("strong", {}, cuentaAtras(hasta, S.ahora()))),
    h("p", { class: "eg-tenue eg-mini" }, "Es una transacción tuya en Sepolia (paga un poco de gas). Si un día no reclamas, la racha vuelve al día 1."));
}

function filaRacha(hechos, hoy) {
  return h("ol", { class: "eg-racha", "aria-label": "Racha de 7 días" }, Array.from({ length: RACHA_CICLO }, (_, i) => {
    const n = i + 1, r = recompensaDiaria(n);
    const estado = n <= hechos ? "hecho" : n === hoy ? "hoy" : "";
    return h("li", { class: `eg-dia ${estado}${r.cofre ? " cofre" : ""}`, title: `Día ${n}: ${r.oro} ORO${r.cofre ? " + cofre cosmético" : ""}` },
      h("span", { class: "eg-dia-n" }, `Día ${n}`),
      h("span", { class: "eg-dia-ico", "aria-hidden": "true" }, n <= hechos ? "🔥" : r.cofre ? "🎁" : "🪙"),
      h("span", { class: "eg-dia-oro" }, `${r.oro}`));
  }));
}

async function reclamarDiario() {
  if (!S?.rec || S.ocupado.has("diario")) return;
  const gen = S.gen;
  S.ocupado.add("diario"); renderDiario();
  try {
    if (S.modoDiario === "chain") aviso("🦊 Confirma la recompensa diaria en MetaMask…", "info", 4000);
    const op = await S.rec.reclamar();
    aviso("⏳ Recompensa diaria enviada…", "info", 4000);
    const r = await op.esperar();
    if (!S || gen !== S.gen) return;
    const racha = r?.racha ?? (S.diario?.rachaSiguiente ?? 1);
    const oro = r?.oro ?? S.diario?.proxima?.oro ?? 0;
    const cos = r?.cosmeticoId ? CATALOGO.find((x) => x.id === r.cosmeticoId) ?? null : null;
    const fx = S.o.fx;
    if (typeof fx?.celebrarRecompensa === "function") { try { fx.celebrarRecompensa({ oro, cosmetico: cos, texto: `Racha de ${racha} día${racha === 1 ? "" : "s"}` }); } catch (e) { console.warn(e); } }
    aviso(`🎉 +${oro} ORO${cos ? ` y ${cos.nombre}` : ""} · racha de ${racha} día${racha === 1 ? "" : "s"}`, "ok", 6000);
    procesar({ tipo: "diario", racha });
    if (cos) procesar({ tipo: "cosmeticos", ids: [cos.id] });
    try { S.o.onRecompensa?.({ tipo: "diario", oro, racha, cosmetico: cos }); } catch (e) { console.warn(e); }
  } catch (e) {
    if (!S || gen !== S.gen) return;
    const m = mensajeErrorEconomia(e);
    aviso(/YaReclamado/i.test(String(e?.revert?.name ?? e?.message)) ? "Ya reclamaste la recompensa de hoy." : m.texto, m.rechazado ? "info" : "error", 6000);
  } finally {
    if (S && gen === S.gen) { S.ocupado.delete("diario"); await refrescarDiario(); renderTodo(); }
  }
}

// ── Misiones ──
function tarjetaMision(m, { onReclamar, extra } = {}) {
  const rec = m.recompensa ?? {};
  const partes = [rec.xp ? `${rec.xp} XP` : null, rec.puntos ? `${rec.puntos} pts de pase` : null, rec.motivo ? "25 ORO" : null].filter(Boolean).join(" · ");
  const ocupado = S.ocupado.has(`m:${m.id}`);
  return h("li", { class: `eg-mision${m.completada ? " completa" : ""}${m.reclamada ? " reclamada" : ""}` },
    h("span", { class: "eg-mision-ico", "aria-hidden": "true" }, m.icono ?? "📜"),
    h("div", { class: "eg-mision-cuerpo" },
      h("strong", {}, m.nombre ?? m.id),
      barra(m.progreso ?? 0, m.objetivo ?? 1),
      h("span", { class: "eg-tenue eg-mini" }, `${Math.min(m.progreso ?? 0, m.objetivo ?? 1)}/${m.objetivo ?? 1}${partes ? ` · ${partes}` : ""}`), extra),
    m.reclamada ? h("span", { class: "eg-chip eg-chip-ok" }, "✔ Reclamada")
      : h("button", { type: "button", class: `btn btn-small${m.completada ? " btn-gold" : ""}`, disabled: !m.completada || ocupado, onclick: onReclamar }, ocupado ? "…" : "Reclamar"));
}

function renderMisiones(v) {
  const el = S?.els.misiones;
  if (!el) return;
  if (!v) { poner(el, noDisponible("📜 Misiones diarias")); return; }
  poner(el,
    h("div", { class: "eg-cabeza" }, h("h3", {}, "📜 Misiones diarias"), h("span", { class: "eg-chip" }, "Nuevas en ", cuentaAtras(v.finDia, S.ahora()))),
    h("ul", { class: "eg-misiones" }, v.diarias.map((m) => tarjetaMision(m, { onReclamar: () => reclamarMision(m) })),
      tarjetaMision(v.bonus, { onReclamar: () => reclamarMision(v.bonus),
        extra: v.bonus.recompensa?.motivo && !S.cuenta ? h("span", { class: "eg-tenue eg-mini" }, "El ORO del bonus necesita la wallet conectada.") : null })));
}

function renderSemanal(v) {
  const el = S?.els.semanal;
  if (!el) return;
  if (!v) { poner(el, noDisponible("🗓️ Misión semanal")); return; }
  poner(el, h("div", { class: "eg-cabeza" }, h("h3", {}, "🗓️ Misión semanal"), h("span", { class: "eg-chip" }, "Termina en ", cuentaAtras(v.finSemana, S.ahora()))),
    h("ul", { class: "eg-misiones" }, tarjetaMision(v.semanal, { onReclamar: () => reclamarMision(v.semanal) })));
}

/** Pide al servidor un premio on-chain. @returns {Promise<boolean>} true si se puede dar por cobrado */
async function cobrarOnchain(motivo, oro, clave) {
  if (!S.cuenta) { aviso("🦊 Conecta tu wallet para cobrar el ORO de este premio.", "info"); return false; }
  const gen = S.gen;
  S.ocupado.add(clave); renderTodo();
  const res = await pedirRecompensaServidor(S.serverUrl, S.cuenta, motivo, { fetch: S.o.fetch ?? globalThis.fetch });
  if (!S || gen !== S.gen) return false;
  S.ocupado.delete(clave);
  if (!res.ok && res.status !== 409) { aviso(`No se pudo cobrar el ORO: ${res.mensaje}`, "error", 6000); renderTodo(); return false; }
  if (res.ok && typeof S.o.fx?.celebrarRecompensa === "function") { try { S.o.fx.celebrarRecompensa({ oro: res.cantidad ?? oro }); } catch { /* opcional */ } }
  aviso(res.ok ? `🪙 +${res.cantidad ?? oro} ORO en camino a tu wallet.` : res.mensaje, res.ok ? "ok" : "info");
  return true;
}

function sumarPase(puntos) {
  if (!S.A.pase || !(puntos > 0)) return;
  const r = S.A.pase.sumar(S.E.pase, puntos, S.ahora());
  S.E.pase = r.estado;
  const extra = { logrosNuevos: [], nivelesPase: r.niveles };
  for (const n of r.niveles) {
    if (!S.A.logros) continue;
    const rl = S.A.logros.registrar(S.E.logros, { tipo: "pase", nivel: n }, S.ahora());
    S.E.logros = rl.estado; extra.logrosNuevos.push(...rl.nuevos);
  }
  celebrar(extra);
}

async function reclamarMision(m) {
  const clave = `m:${m.id}`;
  if (!S.A.misiones || S.ocupado.has(clave)) return;
  const r = S.A.misiones.reclamar(S.E.misiones, m.id, S.ahora());
  if (!r.ok) { aviso(r.motivo ?? "No se puede reclamar.", "info"); return; }
  const rec = r.recompensa ?? {};
  // Premio on-chain (bonus): primero el servidor; si falla, no se guarda y se puede reintentar.
  if (rec.motivo && !(await cobrarOnchain(rec.motivo, 25, clave))) return;
  if (!S) return;
  S.E.misiones = r.estado;
  if (S.A.logros) { const rl = S.A.logros.registrar(S.E.logros, { tipo: "mision", id: m.id }, S.ahora()); S.E.logros = rl.estado; celebrar({ logrosNuevos: rl.nuevos }); }
  sumarPase(rec.puntos);
  guardarTodo();
  if (rec.xp) { try { S.o.onRecompensa?.({ tipo: "xp", xp: rec.xp, fuente: "mision" }); } catch (e) { console.warn(e); } }
  aviso(`✅ ${m.nombre}: ${[rec.xp ? `+${rec.xp} XP` : null, rec.puntos ? `+${rec.puntos} pts de pase` : null].filter(Boolean).join(" · ")}`, "ok");
  try { S.o.fx?.sonar?.("victoria"); } catch { /* opcional */ }
  renderTodo();
}

// ── Pase de temporada ──
function renderPase(v) {
  const el = S?.els.pase;
  if (!el) return;
  if (!v) { poner(el, noDisponible("🎟️ Pase de temporada")); return; }
  const pista = h("ol", { class: "eg-pista", "aria-label": "Niveles del pase" }, v.niveles.map((n) => {
    const ocupado = S.ocupado.has(`p:${n.nivel}`);
    const puede = n.alcanzado && !n.reclamado;
    return h("li", { class: `eg-nivel${n.alcanzado ? " alcanzado" : ""}${n.reclamado ? " reclamado" : ""}${n.recompensa.motivo ? " onchain" : ""}${n.nivel === v.nivel + 1 ? " siguiente" : ""}`, "data-nivel": n.nivel },
      h("span", { class: "eg-nivel-n" }, n.nivel),
      h("span", { class: "eg-nivel-ico", "aria-hidden": "true" }, n.recompensa.icono),
      h("span", { class: "eg-nivel-txt" }, n.recompensa.texto),
      puede ? h("button", { type: "button", class: "btn btn-small btn-gold", disabled: ocupado, onclick: () => reclamarPase(n) }, ocupado ? "…" : "Reclamar")
        : n.reclamado ? h("span", { class: "eg-mini eg-ok" }, "✔") : h("span", { class: "eg-mini eg-tenue", "aria-label": "Bloqueado" }, "🔒"));
  }));
  const pendientes = v.niveles.filter((n) => n.alcanzado && !n.reclamado).length;
  poner(el,
    h("div", { class: "eg-cabeza" }, h("h3", {}, `🎟️ Pase de temporada ${v.temporada}`),
      pendientes ? h("span", { class: "eg-chip eg-chip-titulo" }, `${pendientes} por reclamar`) : null,
      h("span", { class: "eg-chip" }, "Termina en ", cuentaAtras(v.fin, S.ahora()))),
    h("div", { class: "eg-pase-resumen" },
      h("span", { class: "eg-pase-nivel" }, `Nivel ${v.nivel}`, h("small", {}, ` / ${v.max}`)),
      h("div", { class: "eg-pase-barra" }, barra(v.puntosNivel, v.puntosSiguiente, "dorada"),
        h("span", { class: "eg-tenue eg-mini" }, v.nivel >= v.max ? "¡Pase completado!" : `${v.puntosNivel}/${v.puntosSiguiente} puntos para el nivel ${v.nivel + 1} · ${v.puntos} en total`))),
    h("div", { class: "eg-pista-wrap", tabindex: "0", role: "region", "aria-label": "Pista del pase (desplázate en horizontal)" }, pista),
    h("p", { class: "eg-tenue eg-mini" }, "Ganas puntos con victorias, jefes, misiones, el desafío y la recompensa diaria. Los niveles 10, 20 y 30 dan ORO on-chain."));
  const wrap = el.querySelector(".eg-pista-wrap"), objetivo = el.querySelector(`.eg-nivel[data-nivel="${Math.max(1, v.nivel)}"]`);
  if (wrap && objetivo) wrap.scrollLeft = Math.max(0, objetivo.offsetLeft - wrap.clientWidth / 2 + objetivo.clientWidth / 2);
}

async function reclamarPase(n) {
  const clave = `p:${n.nivel}`;
  if (!S.A.pase || S.ocupado.has(clave)) return;
  const r = S.A.pase.reclamar(S.E.pase, n.nivel, S.ahora());
  if (!r.ok) { aviso(r.motivo ?? "No se puede reclamar.", "info"); return; }
  const rec = r.recompensa ?? n.recompensa;
  if (rec.motivo && !(await cobrarOnchain(rec.motivo, rec.oro, clave))) return;
  if (!S) return;
  S.E.pase = r.estado;
  // Títulos del pase → logros (títulos externos permanentes).
  for (const id of [rec.tipo === "titulo" ? rec.id : null, rec.titulo].filter(Boolean)) {
    if (S.A.logros) S.E.logros = S.A.logros.registrar(S.E.logros, { tipo: "titulo", id }, S.ahora()).estado;
    if (!tituloActivo()) cambiarTitulo(id, { guardar: false });
  }
  guardarTodo();
  if (!rec.motivo) aviso(`🎁 Nivel ${n.nivel}: ${rec.texto}`, "ok");
  const local = rec.tipo === "xp" ? { tipo: "xp", xp: Number(rec.cantidad) || 0 } : rec.tipo === "pociones" ? { tipo: "pociones", cantidad: Number(rec.cantidad) || 1 }
    : rec.tipo === "marco" ? { tipo: "marco", id: rec.id } : null;
  if (local) { try { S.o.onRecompensa?.({ ...local, fuente: "pase", nivel: n.nivel }); } catch (e) { console.warn(e); } }
  renderTodo();
}

// ── Desafío diario ──
function renderDesafio(v) {
  const el = S?.els.desafio;
  if (!el) return;
  if (!v) { poner(el, noDisponible("🎯 Desafío diario")); return; }
  const puedeJugar = typeof S.o.onJugarDesafio === "function";
  const e = v.enemigo;
  let pie;
  if (!v.intentado) {
    pie = h("button", { type: "button", class: "btn btn-red", disabled: !puedeJugar, title: puedeJugar ? null : "Disponible en el juego", onclick: jugarDesafio }, "⚔️ Aceptar el desafío");
  } else if (!v.terminado) {
    pie = h("p", { class: "eg-desafio-res" }, "⚔️ Intento en curso… (si lo abandonas, cuenta como gastado)");
  } else {
    pie = h("p", { class: `eg-desafio-res ${v.victoria ? "ok" : "ko"}` }, v.victoria ? `🏆 ¡Superado! Puntuación ${v.puntuacion}.` : `☠️ Hoy no ha podido ser (puntuación ${v.puntuacion}).`, " Vuelve mañana.");
  }
  poner(el,
    h("div", { class: "eg-cabeza" }, h("h3", {}, "🎯 Desafío diario"), h("span", { class: "eg-chip" }, "Cambia en ", cuentaAtras(v.fin, S.ahora()))),
    h("div", { class: `eg-desafio${e.jefe ? " jefe" : ""}` },
      h("div", { class: "eg-desafio-enemigo", "aria-hidden": "true" }, e.emoji ?? "❔"),
      h("div", {},
        h("strong", {}, `${e.jefe ? "👑 " : ""}${e.nombre} · nivel ${e.nivel}`),
        h("ul", { class: "eg-mods" }, v.modificadores.map((m) => h("li", { title: m.detalle ?? null }, h("span", { "aria-hidden": "true" }, m.icono), " ", m.texto))),
        h("p", { class: "eg-tenue eg-mini" }, v.modificadores.map((m) => m.detalle).filter(Boolean).join(" ")),
        h("p", { class: "eg-tenue eg-mini" }, `Mismo combate para todos hoy. Un intento al día${v.recompensa.puntos ? ` · hasta ${v.recompensa.puntos} puntos de pase` : ""}${v.mejor ? ` · tu mejor puntuación: ${v.mejor}` : ""}.`))),
    pie);
}

function jugarDesafio() {
  if (!S?.A.desafio || typeof S.o.onJugarDesafio !== "function") return;
  const r = iniciarDesafio();
  if (!r.ok) { aviso(r.motivo, "info"); return; }
  try { S.o.onJugarDesafio(r.desafio, { crearCombate: (heroe) => S.A.desafio.crearCombate?.(r.desafio, heroe) }); } catch (e) { console.warn(e); }
}

// ── Logros ──
// Categorías de logros (las de logros.js; "otros" recoge cualquier categoría nueva que no conozcamos).
const GRUPOS_LOGROS = Object.freeze([
  { id: "primeros", nombre: "Primeros pasos", icono: "🚩" },
  { id: "combate", nombre: "Combate", icono: "⚔️" },
  { id: "heroe", nombre: "Héroe", icono: "🧝" },
  { id: "coleccion", nombre: "Colección", icono: "📖" },
  { id: "economia", nombre: "Economía", icono: "🪙" },
  { id: "constancia", nombre: "Constancia", icono: "📅" },
  { id: "otros", nombre: "Otros", icono: "✨" },
]);

const fechaLogro = (ms) => new Date(ms).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });

/** Tarjeta de un logro: medalla (color + fecha si está conseguido) o barra hacia su objetivo. */
function tarjetaLogro(l, { nuevo, cerca }) {
  const progreso = Math.min(l.progreso ?? 0, l.objetivo ?? 1);
  return h("li", { class: `eg-logro ${l.conseguido ? "conseguido" : "bloqueado"}${nuevo ? " nuevo" : ""}${cerca ? " cerca" : ""}`, "data-logro": l.id, title: l.descripcion },
    h("span", { class: "eg-logro-medalla", "aria-hidden": "true" }, l.conseguido ? l.icono : "🔒"),
    h("div", { class: "eg-logro-cuerpo" },
      h("strong", { class: "eg-logro-nombre" }, l.nombre),
      h("span", { class: "eg-logro-desc eg-tenue eg-mini" }, l.descripcion),
      l.conseguido
        ? h("span", { class: "eg-logro-fecha eg-mini" }, `✔ Desbloqueado${l.fecha ? ` el ${fechaLogro(l.fecha)}` : ""}`)
        : [barra(progreso, l.objetivo, "eg-logro-barra"), h("span", { class: "eg-mini eg-tenue" }, `${progreso}/${l.objetivo} · siguiente escalón`)],
      l.titulo ? h("span", { class: "eg-chip eg-chip-titulo" }, `«${l.titulo}»`) : null),
    nuevo ? h("span", { class: "eg-nuevo" }, "¡Nuevo!") : cerca ? h("span", { class: "eg-cerca" }, "🎯 Más cerca") : null);
}

function renderLogros(lista) {
  const el = S?.els.logros;
  if (!el) return;
  if (!Array.isArray(lista)) { poner(el, noDisponible("🏅 Logros")); return; }
  const total = lista.length;
  const conseguidos = lista.filter((l) => l.conseguido);
  const titulos = S.A.logros.titulos(S.E.logros, S.A.pase?.titulos);
  const actual = S.A.logros.tituloActual(S.E.logros);
  const elegido = titulos.find((t) => t.id === actual) ?? null;
  const nuevos = new Set(conseguidos.filter((l) => !S.propio.vistos.includes(l.id)).map((l) => l.id));
  const pct = total ? conseguidos.length / total : 0;

  // Agrupa por categoría (orden de GRUPOS_LOGROS); dentro de cada grupo, el orden de logros.js.
  const conocidas = new Set(GRUPOS_LOGROS.map((g) => g.id));
  const grupos = GRUPOS_LOGROS.map((g) => ({ ...g, items: lista.filter((l) => (g.id === "otros" ? !conocidas.has(l.categoria) : l.categoria === g.id)) }))
    .filter((g) => g.items.length);

  poner(el,
    h("div", { class: "eg-cabeza" }, h("h3", {}, "🏅 Logros"),
      nuevos.size ? h("button", { type: "button", class: "btn btn-small btn-ghost", onclick: () => { S.propio.vistos = conseguidos.map((l) => l.id); guardarPropio(S.cuenta, S.propio, S.o.storage); renderTodo(); } }, `Marcar ${nuevos.size} como vistos`) : null),
    h("div", { class: "eg-logros-total" },
      h("div", { class: "eg-logros-total-txt" },
        h("strong", {}, `${conseguidos.length}/${total} logros`),
        h("span", { class: "eg-tenue eg-mini" }, pct >= 1 ? "¡Todos conseguidos!" : `${Math.round(pct * 100)} % completado`)),
      barra(conseguidos.length, total, "dorada")),
    h("div", { class: "eg-titulo-box" },
      h("label", { class: "eg-titulo-sel" }, "Título junto a tu nombre",
        h("select", { disabled: !titulos.length, onchange: (ev) => cambiarTitulo(ev.target.value || null) },
          h("option", { value: "" }, titulos.length ? "— ninguno —" : "— consigue logros para ganar títulos —"),
          titulos.map((t) => h("option", { value: t.id, selected: actual === t.id }, t.texto)))),
      h("div", { class: "eg-titulo-prev", "aria-live": "polite" },
        h("span", { class: "eg-tenue eg-mini" }, "Vista previa:"),
        h("span", { class: "eg-nombre-prev" }, S.cuenta ? acortar(S.cuenta) : "Invitado"),
        elegido ? h("span", { class: "eg-chip eg-chip-titulo eg-chip-grande" }, `«${elegido.texto}»`) : h("span", { class: "eg-tenue eg-mini" }, "sin título"))),
    grupos.map((g) => {
      const hechos = g.items.filter((l) => l.conseguido).length;
      // "Más cerca": el logro bloqueado con mayor progreso del grupo.
      const cerca = g.items.filter((l) => !l.conseguido).reduce((mejor, l) => (!mejor || (l.progreso / l.objetivo) > (mejor.progreso / mejor.objetivo) ? l : mejor), null);
      return h("section", { class: "eg-grupo", "data-grupo": g.id },
        h("h4", {}, `${g.icono} ${g.nombre} · ${hechos}/${g.items.length}`),
        barra(hechos, g.items.length),
        h("ul", { class: "eg-logros-grid" }, g.items.map((l) => tarjetaLogro(l, { nuevo: nuevos.has(l.id), cerca: cerca?.id === l.id }))));
    }));
}

function cambiarTitulo(id, { guardar = true } = {}) {
  if (!S.A.logros) return;
  const r = S.A.logros.elegirTitulo(S.E.logros, id);
  if (!r.ok) { aviso(r.motivo ?? "No puedes usar ese título.", "info"); return; }
  S.E.logros = r.estado;
  if (guardar) { guardarSistema("logros"); renderTodo(); }
  try { S.o.onCambioTitulo?.(tituloActivo()); } catch (e) { console.warn(e); }
}

// ── Colección ──
function renderColeccion(v) {
  const el = S?.els.coleccion;
  if (!el) return;
  if (!v) { poner(el, noDisponible("📖 Colección")); return; }
  const tipos = [...new Set(v.objetos.map((o) => o.tipo))];
  const vistos = v.bestiario.filter((b) => b.vencidos).length;
  poner(el,
    h("div", { class: "eg-cabeza" }, h("h3", {}, "📖 Colección"), h("span", { class: "eg-chip" }, `${v.porcentaje} % completada`)),
    barra(v.porcentaje, 100, "dorada"),
    h("h4", {}, `Bestiario · ${vistos}/${v.bestiario.length}`),
    h("ul", { class: "eg-bestiario" }, v.bestiario.map((b) => h("li", { class: `eg-bestia${b.vencidos ? " vista" : ""}${b.jefe ? " jefe" : ""}`, title: b.vencidos ? `${b.nombre}: ${b.vencidos} vencidos${b.jefe ? " · jefe derrotado" : ""}` : "Aún no lo has vencido" },
      h("span", { class: "eg-bestia-ico", "aria-hidden": "true" }, b.vencidos ? b.emoji : "❔"),
      h("span", { class: "eg-mini" }, b.vencidos ? b.nombre : "???"),
      b.vencidos ? h("span", { class: "eg-mini eg-tenue" }, `×${b.vencidos}${b.jefe ? " 👑" : ""}`) : null))),
    h("h4", {}, `Álbum de objetos · ${v.objetos.filter((o) => o.tengo).length}/${v.objetos.length}`),
    h("table", { class: "eg-album" },
      h("thead", {}, h("tr", {}, h("th", {}, h("span", { class: "eg-sr" }, "Tipo")), NOMBRE_RAREZA.map((r, i) => h("th", { class: `rz-${i}`, scope: "col" }, r)))),
      h("tbody", {}, tipos.map((t) => h("tr", {}, h("th", { scope: "row" }, t), [0, 1, 2].map((r) => {
        const o = v.objetos.find((x) => x.tipo === t && x.rareza === r);
        return h("td", { class: `rz-${r}${o?.tengo ? " tengo" : ""}`, title: `${t} ${NOMBRE_RAREZA[r]}${o?.tengo ? ": conseguido" : ": sin conseguir"}` }, o?.tengo ? "✔" : "·");
      }))))),
    h("h4", {}, `Álbum de cosméticos · ${v.cosmeticos.filter((c) => c.tengo).length}/${v.cosmeticos.length}`),
    h("ul", { class: "eg-album-cos" }, v.cosmeticos.map((c) => h("li", { class: `rz-${RAREZAS_COSMETICO[c.rareza]?.clase ?? "comun"}${c.tengo ? " tengo" : ""}`, title: c.tengo ? c.nombre : "Sin conseguir" },
      h("span", { "aria-hidden": "true" }, c.tengo ? c.icono : "❔"), h("span", { class: "eg-mini" }, c.tengo ? c.nombre : "???")))));
}

// ── Ranking ──
function renderRanking() {
  const el = S?.els.ranking;
  if (!el) return;
  const cat = CATEGORIAS_RANKING.find((c) => c.id === S.catRanking) ?? CATEGORIAS_RANKING[0];
  const lista = S.ranking?.categorias?.[cat.id] ?? [];
  const yo = S.cuenta?.toLowerCase();
  const mia = S.posicion?.[cat.id];
  const enTop = lista.some((x) => x.address.toLowerCase() === yo);
  const medalla = (p) => ({ 1: "🥇", 2: "🥈", 3: "🥉" }[p] ?? `${p}.`);
  const fmt = (v) => `${new Intl.NumberFormat("es-ES").format(v)}${cat.unidad}`;
  poner(el,
    h("div", { class: "eg-cabeza" }, h("h3", {}, "🏆 Salón de la fama"),
      h("button", { type: "button", class: "btn btn-small btn-ghost", disabled: S.cargandoRanking, onclick: refrescarRanking, title: "Actualizar", "aria-label": "Actualizar ranking" }, S.cargandoRanking ? "…" : "↻")),
    h("div", { class: "eg-tabs", role: "tablist", "aria-label": "Categorías" }, CATEGORIAS_RANKING.map((c) => h("button", {
      type: "button", role: "tab", class: `eg-tab${c.id === cat.id ? " on" : ""}`, "aria-selected": String(c.id === cat.id),
      onclick: () => { S.catRanking = c.id; renderRanking(); },
    }, h("span", { "aria-hidden": "true" }, c.icono), " ", c.nombre))),
    h("p", { class: "eg-tenue eg-mini" }, `${cat.largo}. Datos leídos de la cadena: no se pueden falsear.`,
      S.ranking?.actualizado ? ` Actualizado a las ${new Date(S.ranking.actualizado).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}.` : ""),
    S.sincronizando ? h("div", { class: "eg-sync", role: "status", "aria-live": "polite" }, h("span", { class: "eg-spinner", "aria-hidden": "true" }),
      h("span", {}, "Sincronizando el ranking con la blockchain… (puede tardar medio minuto la primera vez)")) : null,
    !S.sincronizando && S.cargandoRanking && !S.ranking ? h("div", { class: "eg-sync", role: "status" }, h("span", { class: "eg-spinner", "aria-hidden": "true" }), h("span", {}, "Cargando ranking…")) : null,
    S.errorRanking && !S.cargandoRanking ? h("div", { class: "eg-aviso eg-aviso-fila", role: "alert" }, h("span", {}, `⚠️ ${S.errorRanking}`),
      h("button", { type: "button", class: "btn btn-small", onclick: refrescarRanking }, "Reintentar")) : null,
    S.ranking && !lista.length ? h("p", { class: "eg-tenue" }, "Todavía nadie en esta categoría. ¡Sé el primero!") : null,
    lista.length ? h("ol", { class: "eg-ranking" }, lista.map((x) => h("li", { class: `eg-fila${x.address.toLowerCase() === yo ? " yo" : ""}${x.posicion <= 3 ? ` top${x.posicion}` : ""}` },
      h("span", { class: "eg-pos" }, medalla(x.posicion)),
      h("span", { class: "eg-dir", title: x.address }, x.address.toLowerCase() === yo ? "Tú" : acortar(x.address)),
      h("span", { class: "eg-val" }, fmt(x.valor))))) : null,
    S.cuenta && S.ranking && !enTop ? h("p", { class: "eg-tu-pos" }, mia?.posicion ? `Tu posición: ${mia.posicion}.º${mia.valor != null ? ` (${fmt(mia.valor)})` : ""}` : "Aún no apareces en esta categoría.") : null,
    !S.cuenta ? h("p", { class: "eg-tenue eg-mini" }, "Conecta tu wallet para ver tu posición.") : null);
}

/** Importa los módulos de §5 (cada uno por separado: si uno falta, los demás siguen). */
async function importarModulos() {
  const nombres = ["misiones", "pase", "logros", "coleccion", "desafio"];
  const r = await Promise.allSettled(nombres.map((n) => import(`./${n}.js`)));
  return Object.fromEntries(nombres.map((n, i) => [n, r[i].status === "fulfilled" ? r[i].value : null]));
}
