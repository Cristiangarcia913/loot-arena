// Recompensas de ORO pagadas por el servidor (pase de temporada y misiones diarias).
//
// AVISO: es confianza en el cliente (testnet). El servidor no puede comprobar que el
// jugador haya llegado al nivel 10 del pase o completado sus misiones: solo limita
// cuánto y cuántas veces se paga. Los topes de verdad están on-chain en
// `Recompensas.recompensar` (tope diario por jugador y global).
//
// Reclamo único: cada motivo se paga una vez por periodo (temporada para el pase,
// día UTC para las misiones). Se controla en memoria y, además, el motivo on-chain
// lleva el periodo ("pase10@T1", "misiones_diarias@2026-11-05"), así que tras un
// reinicio el indexador del ranking reconstruye lo ya pagado desde los eventos
// `Recompensado`.
import { parseUnits } from 'ethers';
import { DECIMALES_ORO } from './abis.js';

/** Motivos válidos, ORO que pagan (unidades enteras) y periodo de reclamo único. */
export const MOTIVOS = Object.freeze({
  pase10: Object.freeze({ oro: 100, periodo: 'temporada' }),
  pase20: Object.freeze({ oro: 200, periodo: 'temporada' }),
  pase30: Object.freeze({ oro: 400, periodo: 'temporada' }),
  misiones_diarias: Object.freeze({ oro: 25, periodo: 'dia' }),
});
export const LISTA_MOTIVOS = Object.freeze(Object.keys(MOTIVOS));

/** Temporadas de 4 semanas desde el lunes 2 de noviembre de 2026, 00:00 UTC (configurable). */
export const INICIO_TEMPORADAS = Date.UTC(2026, 10, 2);
export const DURACION_TEMPORADA_MS = 28 * 24 * 60 * 60 * 1000;

/** Máximo de reclamos por dirección y día UTC (cubre los 4 motivos del mismo día). */
export const MAX_RECLAMOS_DIA = 4;

/** "YYYY-MM-DD" del día UTC. */
export function diaUtc(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Número de temporada (1 = la primera). Antes del inicio, 0. */
export function numeroTemporada(ms, inicio = INICIO_TEMPORADAS) {
  return ms < inicio ? 0 : Math.floor((ms - inicio) / DURACION_TEMPORADA_MS) + 1;
}

/** Periodo de reclamo único del motivo: "T3" o "2026-11-05". */
export function periodoDe(motivo, ms, inicio = INICIO_TEMPORADAS) {
  const info = MOTIVOS[motivo];
  if (!info) throw new Error(`Motivo desconocido: ${motivo}`);
  return info.periodo === 'temporada' ? `T${numeroTemporada(ms, inicio)}` : diaUtc(ms);
}

/** Texto del motivo que se envía al contrato (y aparece en el evento `Recompensado`). */
export function motivoOnchain(motivo, periodo) {
  return `${motivo}@${periodo}`;
}

/** Cantidad en unidades mínimas de ORO (18 decimales). */
export function cantidadWei(motivo) {
  return parseUnits(String(MOTIVOS[motivo].oro), DECIMALES_ORO);
}

/** Valida `motivo`. Devuelve el motivo o null. */
export function validarMotivo(valor) {
  return typeof valor === 'string' && Object.hasOwn(MOTIVOS, valor) ? valor : null;
}

// ── Recompensa diaria con racha (motivo "diaria") ─────────────────────────────
// Misma tabla que `Recompensas.tablaDiaria` del contrato: día 1 = 10 ORO … día 7 = 40 ORO.
// La racha sigue creciendo (día 8 = día 1 del ciclo, como en el contrato). El día 7 del
// ciclo además da un bonus de 25 ORO en una segunda llamada a `recompensar` ("diaria-bonus").
export const MOTIVO_DIARIA = 'diaria';
export const MOTIVO_BONUS_DIA7 = 'diaria-bonus';
export const TABLA_DIARIA = Object.freeze([10, 15, 20, 25, 30, 35, 40]);
export const DIA_BONUS = 7;
export const BONUS_DIA7 = 25;

const DIA_MS = 24 * 60 * 60 * 1000;

/** Día del ciclo (1..7) para una racha (1-based). */
export function diaCiclo(racha) {
  return ((racha - 1) % TABLA_DIARIA.length) + 1;
}

/** Días UTC entre dos "YYYY-MM-DD" (hasta − desde). */
function diferenciaDias(desde, hasta) {
  return Math.round((Date.parse(hasta) - Date.parse(desde)) / DIA_MS);
}

/** Racha vigente hoy: 0 si nunca reclamó o si pasó más de un día sin reclamar. */
export function rachaVigente(reg, hoy) {
  if (!reg) return 0;
  if (reg.ultimoDia === hoy) return reg.racha;
  return diferenciaDias(reg.ultimoDia, hoy) === 1 ? reg.racha : 0;
}

/** Segundos desde `ahora` hasta las 00:00 UTC del día siguiente (entero, redondeado hacia arriba). */
export function segundosHastaManana(ahora) {
  const d = new Date(ahora);
  const manana = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return Math.ceil((manana - ahora) / 1000);
}

/** ORO entero → unidades mínimas (18 decimales). */
export function oroWei(oro) {
  return parseUnits(String(oro), DECIMALES_ORO);
}

/**
 * Racha diaria en memoria: `address → { racha, ultimoDia }`.
 * AVISO: se pierde al reiniciar el servidor (plan gratis de Render). Ver README.
 */
export class RegistroDiario {
  constructor({ maxEntradas = 100_000 } = {}) {
    this.maxEntradas = maxEntradas;
    this.reg = new Map();
  }

  /**
   * Estado para `ahora`. `racha` es la vigente (0 si se rompió), `dia` el día del ciclo
   * (1..7) que toca en el próximo reclamo y `proximaOro` su ORO.
   */
  estado(address, ahora) {
    const hoy = diaUtc(ahora);
    const reg = this.reg.get(address);
    const racha = rachaVigente(reg, hoy);
    const dia = diaCiclo(racha + 1);
    const puedeReclamar = reg?.ultimoDia !== hoy;
    return {
      racha,
      dia,
      puedeReclamar,
      proximoEn: puedeReclamar ? 0 : segundosHastaManana(ahora),
      proximaOro: TABLA_DIARIA[dia - 1],
    };
  }

  /** Guarda el reclamo de hoy. */
  registrar(address, racha, hoy) {
    if (!this.reg.has(address) && this.reg.size >= this.maxEntradas) {
      this.reg.delete(this.reg.keys().next().value); // la más antigua
    }
    this.reg.set(address, { racha, ultimoDia: hoy });
  }
}

/**
 * Registro en memoria de reclamos: reserva → (pago) → confirmar | liberar.
 * La reserva evita que dos peticiones simultáneas cobren lo mismo.
 */
export class RegistroRecompensas {
  constructor({ maxPorDia = MAX_RECLAMOS_DIA, inicio = INICIO_TEMPORADAS } = {}) {
    this.maxPorDia = maxPorDia;
    this.inicio = inicio;
    this.reclamos = new Map(); // "address|motivo@periodo" → "pendiente" | "pagado"
    this.porDia = new Map();   // "address|YYYY-MM-DD" → nº de reclamos (pendientes + pagados)
    this.dia = null;
  }

  /** Clave on-chain y datos del reclamo para `ahora`. */
  datos(address, motivo, ahora) {
    const periodo = periodoDe(motivo, ahora, this.inicio);
    return { periodo, motivoOnchain: motivoOnchain(motivo, periodo), dia: diaUtc(ahora) };
  }

  /**
   * @returns {{ ok: true, periodo: string, motivoOnchain: string }
   *         | { ok: false, motivo: 'duplicado' | 'limite_diario' }}
   */
  reservar(address, motivo, ahora) {
    const { periodo, motivoOnchain: mo, dia } = this.datos(address, motivo, ahora);
    this._limpiar(dia);
    const clave = `${address}|${mo}`;
    if (this.reclamos.has(clave)) return { ok: false, motivo: 'duplicado' };
    const claveDia = `${address}|${dia}`;
    const n = this.porDia.get(claveDia) ?? 0;
    if (n >= this.maxPorDia) return { ok: false, motivo: 'limite_diario' };
    this.reclamos.set(clave, 'pendiente');
    this.porDia.set(claveDia, n + 1);
    return { ok: true, periodo, motivoOnchain: mo, clave, claveDia };
  }

  confirmar(reserva) {
    this.reclamos.set(reserva.clave, 'pagado');
  }

  /** Deshace una reserva cuyo pago ha fallado. */
  liberar(reserva) {
    this.reclamos.delete(reserva.clave);
    const n = this.porDia.get(reserva.claveDia) ?? 0;
    if (n <= 1) this.porDia.delete(reserva.claveDia);
    else this.porDia.set(reserva.claveDia, n - 1);
  }

  /** Al cambiar de día, olvida contadores diarios y reclamos de periodos pasados. */
  _limpiar(dia) {
    if (this.dia === dia) return;
    this.dia = dia;
    for (const k of this.porDia.keys()) if (!k.endsWith(`|${dia}`)) this.porDia.delete(k);
    for (const [k, estado] of this.reclamos) {
      const periodo = k.slice(k.lastIndexOf('@') + 1);
      const esDiario = /^\d{4}-\d{2}-\d{2}$/.test(periodo);
      if (estado === 'pagado' && esDiario && periodo !== dia) this.reclamos.delete(k);
    }
  }
}
