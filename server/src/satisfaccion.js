// Sistema de UX Research (MEJORAS "Radiografía de Satisfacción del Jugador"): mini-encuesta al
// terminar una sesión que se guarda como fila nueva de un .csv listo para abrir en Excel.
//
// `POST /api/satisfaccion`  → valida y añade una fila a `rutaCsv` (crea el archivo con
//                             cabecera si es la primera vez).
// `GET  /api/satisfaccion/descargar` → descarga el .csv actualizado.
//
// El .csv lleva BOM UTF-8 (para que Excel en español lea bien los acentos) y usa ';' como
// separador (el que espera Excel configurado en español al abrir con doble clic).
import express from 'express';
import { mkdir, appendFile, access, constants as fsConstants } from 'node:fs/promises';
import { dirname } from 'node:path';
import { RateLimiter } from './rateLimit.js';

export const LIMITE_SATISFACCION_IP = { windowMs: 60 * 60 * 1000, max: 30 }; // 30 envíos por hora por IP

/** Cabecera del .csv, en el mismo orden que `normalizarSatisfaccion` produce los valores. */
export const CABECERA_SATISFACCION = Object.freeze([
  'Fecha', 'Jugador', 'Nivel', 'Racha máxima', 'Estrellas', 'Emoción dominante',
  'Tensión media', 'Tiempo (min)', 'Etiquetas', 'Comentario',
]);

const SEPARADOR = ';';

/** Escapa un campo para CSV con separador ';' (entre comillas si lleva ';', '"' o salto de línea). */
export function campoCsv(valor) {
  const s = valor === null || valor === undefined ? '' : String(valor);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Une una fila de valores en una línea CSV (CRLF: el salto de línea que espera Excel en Windows). */
export function filaCsv(valores) {
  return `${valores.map(campoCsv).join(SEPARADOR)}\r\n`;
}

/** BOM UTF-8 + cabecera: con esto Excel en español abre el .csv con acentos y columnas correctas. */
export function cabeceraCsv() {
  return `﻿${filaCsv(CABECERA_SATISFACCION)}`;
}

const enteroEntre = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

/** Valida `estrellas`: entero de 1 a 5 (sin forzar strings a número: solo el tipo `number`). */
export function validarEstrellas(valor) {
  return enteroEntre(valor, 1, 5) ? valor : null;
}

/** Texto corto y de una sola línea (quita saltos de línea, recorta a `max` caracteres). */
function textoCorto(valor, max) {
  if (valor === null || valor === undefined) return '';
  const s = String(valor).trim().replace(/[\r\n]+/g, ' ');
  return s.length > max ? s.slice(0, max) : s;
}

/** Entero opcional en un rango. `null`/`undefined`/'' → null (ausente). Fuera de rango → undefined (inválido). */
function enteroOpcional(valor, { min = -Infinity, max = Infinity } = {}) {
  if (valor === undefined || valor === null || valor === '') return null;
  const n = Number(valor);
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
}

/** Número opcional en un rango. Mismas reglas que `enteroOpcional` pero sin exigir entero. */
function numeroOpcional(valor, { min = -Infinity, max = Infinity } = {}) {
  if (valor === undefined || valor === null || valor === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
}

/**
 * Normaliza y valida el cuerpo de `POST /api/satisfaccion`.
 * @param {{fecha?:string, jugador?:string, nivel?:number, rachaMax?:number, estrellas:number,
 *          emocionDominante?:string, tensionMedia?:number, tiempoMinutos?:number,
 *          tags?:string[], comentario?:string}} body
 * @returns {{ok:true, datos:object} | {ok:false, error:string}}
 */
export function normalizarSatisfaccion(body, { now = Date.now } = {}) {
  const b = body ?? {};

  const estrellas = validarEstrellas(b.estrellas);
  if (estrellas === null) return { ok: false, error: 'estrellas debe ser un entero entre 1 y 5' };

  const nivel = enteroOpcional(b.nivel, { min: 0, max: 1000 });
  if (nivel === undefined) return { ok: false, error: 'nivel debe ser un entero' };

  const rachaMax = enteroOpcional(b.rachaMax, { min: 0, max: 1_000_000 });
  if (rachaMax === undefined) return { ok: false, error: 'rachaMax debe ser un entero' };

  const tensionMedia = numeroOpcional(b.tensionMedia, { min: 0, max: 1 });
  if (tensionMedia === undefined) return { ok: false, error: 'tensionMedia debe ser un número entre 0 y 1' };

  const tiempoMinutos = numeroOpcional(b.tiempoMinutos, { min: 0, max: 100_000 });
  if (tiempoMinutos === undefined) return { ok: false, error: 'tiempoMinutos debe ser un número' };

  if (b.tags !== undefined && !Array.isArray(b.tags)) return { ok: false, error: 'tags debe ser una lista de texto' };
  const tags = Array.isArray(b.tags) ? b.tags.map((t) => textoCorto(t, 40)).filter(Boolean).slice(0, 10) : [];

  let fecha = typeof b.fecha === 'string' ? b.fecha : null;
  if (!fecha || Number.isNaN(Date.parse(fecha))) fecha = new Date(now()).toISOString();

  return {
    ok: true,
    datos: {
      fecha,
      jugador: textoCorto(b.jugador, 60) || 'Anónimo',
      nivel: nivel ?? '',
      rachaMax: rachaMax ?? '',
      estrellas,
      emocionDominante: textoCorto(b.emocionDominante, 40),
      tensionMedia: tensionMedia ?? '',
      tiempoMinutos: tiempoMinutos ?? '',
      tags: tags.join(', '),
      comentario: textoCorto(b.comentario, 300),
    },
  };
}

/** Crea la carpeta y el .csv con cabecera si todavía no existen. Idempotente. */
export async function asegurarCsv(rutaCsv) {
  try {
    await access(rutaCsv, fsConstants.F_OK);
  } catch {
    await mkdir(dirname(rutaCsv), { recursive: true });
    await appendFile(rutaCsv, cabeceraCsv(), 'utf8');
  }
}

/** Añade una fila al .csv de satisfacción (crea el archivo con cabecera si hace falta). */
export async function anadirFilaSatisfaccion(rutaCsv, datos) {
  await asegurarCsv(rutaCsv);
  await appendFile(rutaCsv, filaCsv([
    datos.fecha, datos.jugador, datos.nivel, datos.rachaMax, datos.estrellas,
    datos.emocionDominante, datos.tensionMedia, datos.tiempoMinutos, datos.tags, datos.comentario,
  ]), 'utf8');
}

/**
 * Rutas `POST /api/satisfaccion` y `GET /api/satisfaccion/descargar`.
 * @param {{rutaCsv:string, now?:() => number, logger?:Pick<Console,'log'|'error'>}} deps
 */
export function crearRouterSatisfaccion({ rutaCsv, now = Date.now, logger = console }) {
  const router = express.Router();
  const limIp = new RateLimiter({ ...LIMITE_SATISFACCION_IP, now });
  const demasiadas = (res, s) =>
    res.set('Retry-After', String(s)).status(429).json({ error: `Demasiadas peticiones, espera ${s} s` });

  router.post('/api/satisfaccion', async (req, res) => {
    const porIp = limIp.hit(req.ip ?? 'desconocida');
    if (!porIp.ok) return demasiadas(res, porIp.retryAfterS);

    const r = normalizarSatisfaccion(req.body, { now });
    if (!r.ok) return res.status(400).json({ error: r.error });

    try {
      await anadirFilaSatisfaccion(rutaCsv, r.datos);
      return res.json({ ok: true });
    } catch (err) {
      logger.error('[satisfaccion] no se pudo guardar la respuesta:', err?.message ?? err);
      return res.status(500).json({ error: 'No se pudo guardar la respuesta' });
    }
  });

  router.get('/api/satisfaccion/descargar', async (_req, res) => {
    try {
      await asegurarCsv(rutaCsv);
      res.download(rutaCsv, 'satisfaccion_jugadores.csv', { headers: { 'Content-Type': 'text/csv; charset=utf-8' } });
    } catch (err) {
      logger.error('[satisfaccion] no se pudo preparar la descarga:', err?.message ?? err);
      res.status(500).json({ error: 'No se pudo preparar la descarga' });
    }
  });

  return router;
}
