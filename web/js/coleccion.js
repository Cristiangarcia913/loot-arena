// Colección: bestiario (criaturas vencidas y jefes), álbum de objetos (tipo × rareza)
// y álbum de cosméticos. Guarda lo que el jugador ha tenido ALGUNA VEZ (vender no lo borra).
// Lógica pura; `storage` inyectable.

import { BESTIARIO } from "./combat.js";
import { leerJSON, escribirJSON, claveJugador, normalizarEvento } from "./misiones.js";

export const TIPOS_OBJETO = Object.freeze(["Espada", "Escudo", "Casco", "Armadura", "Botas"]);
export const RAREZAS_OBJETO = Object.freeze(["Común", "Raro", "Legendario"]);
/** Ids de cosméticos coleccionables (catálogo de economy.js sin el consumible 14). */
export const IDS_COSMETICOS = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);

/** Colección vacía. */
export function coleccionNueva() {
  return { version: 1, bestiario: {}, objetos: [], cosmeticos: [] };
}

/** Normaliza datos guardados. */
export function sanearColeccion(d) {
  const c = coleccionNueva();
  if (!d || typeof d !== "object") return c;
  for (const b of BESTIARIO) {
    const e = d.bestiario?.[b.clave];
    if (e && typeof e === "object") {
      const v = Math.max(0, Math.floor(Number(e.vencidos) || 0));
      const j = Math.max(0, Math.floor(Number(e.jefes) || 0));
      if (v || j) c.bestiario[b.clave] = { vencidos: v, jefes: j };
    }
  }
  if (Array.isArray(d.objetos)) c.objetos = [...new Set(d.objetos.filter((k) => typeof k === "string" && esCeldaValida(k)))];
  if (Array.isArray(d.cosmeticos)) c.cosmeticos = [...new Set(d.cosmeticos.map(Number).filter((id) => IDS_COSMETICOS.includes(id)))];
  return c;
}

/** Clave de celda del álbum: "Espada:2". */
export const celda = (tipo, rareza) => `${tipo}:${Number(rareza)}`;
function esCeldaValida(k) {
  const [t, r] = k.split(":");
  return TIPOS_OBJETO.includes(t) && ["0", "1", "2"].includes(r);
}

function anotarObjeto(c, it) {
  if (!it || !TIPOS_OBJETO.includes(it.tipo) || ![0, 1, 2].includes(Number(it.rareza))) return false;
  const k = celda(it.tipo, it.rareza);
  if (c.objetos.includes(k)) return false;
  c.objetos = [...c.objetos, k];
  return true;
}

/**
 * Registra un evento. Usa: `victoria {clave, jefe}`, `botin {item}`, `inventario {items}`,
 * `cosmeticos {ids}` y `compra {id}` (cosmético comprado). El resto se ignora.
 * @returns {{progreso:object, nuevos:Array<{tipo:"bestiario"|"jefe"|"objeto"|"cosmetico", clave?:string, celda?:string, id?:number}>}}
 *   entradas que aparecen por primera vez (para resaltarlas en el álbum)
 */
export function registrar(col, evento) {
  const c = sanearColeccion(col);
  const ev = normalizarEvento(evento);
  const nuevos = [];
  if (!ev) return { progreso: c, nuevos };
  if (ev.tipo === "victoria" && BESTIARIO.some((b) => b.clave === ev.clave)) {
    const e = c.bestiario[ev.clave] ?? { vencidos: 0, jefes: 0 };
    if (!e.vencidos) nuevos.push({ tipo: "bestiario", clave: ev.clave });
    if (ev.jefe && !e.jefes) nuevos.push({ tipo: "jefe", clave: ev.clave });
    c.bestiario = { ...c.bestiario, [ev.clave]: { vencidos: e.vencidos + 1, jefes: e.jefes + (ev.jefe ? 1 : 0) } };
  } else if (ev.tipo === "botin") {
    if (anotarObjeto(c, ev.item)) nuevos.push({ tipo: "objeto", celda: celda(ev.item.tipo, ev.item.rareza) });
  } else if (ev.tipo === "inventario") {
    for (const it of ev.items ?? []) if (anotarObjeto(c, it)) nuevos.push({ tipo: "objeto", celda: celda(it.tipo, it.rareza) });
  } else if (ev.tipo === "cosmeticos" || (ev.tipo === "compra" && ev.id != null)) {
    const ids = ev.tipo === "compra" ? [ev.id] : ev.ids ?? [];
    for (const id of ids.map(Number)) {
      if (IDS_COSMETICOS.includes(id) && !c.cosmeticos.includes(id)) {
        c.cosmeticos = [...c.cosmeticos, id];
        nuevos.push({ tipo: "cosmetico", id });
      }
    }
  }
  return { progreso: c, nuevos };
}

/**
 * Vista para la UI.
 * @param {object} col
 * @param {Array<{id:number, nombre:string, ranura:string, rareza:number, icono:string}>} [catalogo] p. ej. economy.CATALOGO
 * @returns {{
 *   bestiario:{entradas:Array<{clave, nombre, emoji, vencidos, jefes, descubierto:boolean, jefeDerrotado:boolean}>, hechas:number, total:number, pct:number},
 *   objetos:{celdas:Array<{tipo, rareza, rarezaNombre, obtenido:boolean}>, hechas:number, total:number, pct:number},
 *   cosmeticos:{entradas:Array<{id, nombre?, ranura?, rareza?, icono?, obtenido:boolean}>, hechas:number, total:number, pct:number},
 *   total:{hechas:number, total:number, pct:number}
 * }}
 *   En el bestiario cada criatura cuenta 2 casillas (vencida + su jefe).
 */
export function resumenColeccion(col, catalogo = []) {
  const c = sanearColeccion(col);
  const entradas = BESTIARIO.map((b) => {
    const e = c.bestiario[b.clave] ?? { vencidos: 0, jefes: 0 };
    return { clave: b.clave, nombre: b.nombre, emoji: b.emoji, vencidos: e.vencidos, jefes: e.jefes, descubierto: e.vencidos > 0, jefeDerrotado: e.jefes > 0 };
  });
  const bHechas = entradas.reduce((s, e) => s + (e.descubierto ? 1 : 0) + (e.jefeDerrotado ? 1 : 0), 0);
  const bTotal = BESTIARIO.length * 2;
  const celdas = TIPOS_OBJETO.flatMap((tipo) => [0, 1, 2].map((rareza) => ({ tipo, rareza, rarezaNombre: RAREZAS_OBJETO[rareza], obtenido: c.objetos.includes(celda(tipo, rareza)) })));
  const oHechas = celdas.filter((x) => x.obtenido).length;
  const porId = new Map((catalogo ?? []).map((x) => [Number(x.id), x]));
  const cos = IDS_COSMETICOS.map((id) => {
    const x = porId.get(id);
    return { id, ...(x ? { nombre: x.nombre, ranura: x.ranura, rareza: x.rareza, icono: x.icono } : {}), obtenido: c.cosmeticos.includes(id) };
  });
  const cHechas = cos.filter((x) => x.obtenido).length;
  const hechas = bHechas + oHechas + cHechas;
  const total = bTotal + celdas.length + cos.length;
  const pct = (h, t) => (t ? h / t : 0);
  return {
    bestiario: { entradas, hechas: bHechas, total: bTotal, pct: pct(bHechas, bTotal) },
    objetos: { celdas, hechas: oHechas, total: celdas.length, pct: pct(oHechas, celdas.length) },
    cosmeticos: { entradas: cos, hechas: cHechas, total: cos.length, pct: pct(cHechas, cos.length) },
    total: { hechas, total, pct: pct(hechas, total) },
  };
}

export const claveColeccion = (address) => claveJugador("coleccion", address);

export function cargarColeccion(clave, storage = globalThis.localStorage) {
  return sanearColeccion(leerJSON(clave, storage));
}

export function guardarColeccion(clave, col, storage = globalThis.localStorage) {
  return escribirJSON(clave, col, storage);
}
