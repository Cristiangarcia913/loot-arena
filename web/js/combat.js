// Lógica de combate pura (sin DOM ni red). Todas las funciones aceptan un `rng`
// inyectable (() => número en [0,1)) para poder testearlas de forma determinista.
// Las funciones no mutan sus argumentos: devuelven estados nuevos.
//
// Flujo de un turno (`turnoJugador`):
//   1. Inicio del turno del héroe: sus estados hacen efecto (veneno/sangrado dañan,
//      aturdido le hace perder la acción) y bajan 1 turno.
//   2. Acción del héroe (atacar, defender, poción o habilidad).
//   3. Inicio del turno del enemigo (sus estados hacen efecto) y el enemigo ejecuta
//      la intención que se anunció en el turno anterior.
//   4. Fin de ronda: bajan los enfriamientos y se calcula la nueva intención.
// Un estado con `turnos: N` afecta a los N próximos turnos de su portador
// (aplicado por el rival) o a ese turno y los N−1 siguientes (escudo, furia, reflejo,
// evasión aplicados por uno mismo cubren los N ataques rivales siguientes).

import { HABILIDADES, HABILIDADES_BASE, habilidad, iniciarHabilidades, usarHabilidad, avanzarEnfriamientos } from "./skills.js";

export const STATS_BASE = Object.freeze({ vida: 100, ataque: 10, defensa: 5 });
export const NIVEL_MIN = 1;
export const NIVEL_MAX = 10;
/** Variación aleatoria del daño: ±VARIACION_DANO (fracción). */
export const VARIACION_DANO = 0.15;
/** Victorias necesarias para subir un nivel de arena (la 5.ª es contra el jefe). */
export const VICTORIAS_POR_NIVEL = 5;
/** Pociones al empezar una expedición. */
export const POCIONES_POR_EXPEDICION = 3;
/** Fracción de la vida máxima que cura una poción. */
export const CURA_POCION = 0.35;
/** Multiplicador de daño de un golpe crítico. */
export const MULT_CRITICO = 1.6;
/** Probabilidad base de crítico del héroe y extra por cada 3 de ataque del equipo. */
export const CRITICO_BASE = 0.10;
export const CRITICO_POR_3_ATAQUE = 0.01;
export const CRITICO_MAX = 0.5;
/** Esquiva del héroe: base + por punto de defensa, con tope. */
export const ESQUIVA_BASE = 0.02;
export const ESQUIVA_POR_DEFENSA = 0.002;
export const ESQUIVA_MAX = 0.25;
/** Probabilidad de crítico de los enemigos. */
export const CRITICO_ENEMIGO = 0.05;
/** Defender: el daño recibido se multiplica por esto (y por BLOQUEO_HECHIZO si el golpe es bloqueable). */
export const MULT_DEFENDER = 0.5;
export const MULT_BLOQUEO = 0.2;
/** Jefes: multiplicadores de stats, tope de esquiva y turnos entre definitivas por fase. */
export const JEFE = Object.freeze({ vida: 1.8, ataque: 1.2, defensa: 1.05, esquivaMax: 0.12, umbralFase2: 0.5, furiaFase2: 1.2, cadaFase1: 5, cadaFase2: 3, multDefinitiva: 3 });
/** Estado `fragil`: fracción de defensa que pierde quien lo sufre (lo aplica Rompearmaduras). */
export const FRAGIL_DEFECTO = 0.35;

// ───────────────────── Contrato con el motor 3D ─────────────────────
// El motor 3D construye cada enemigo con geometrías (no hay modelos descargados), así que
// cada entrada del BESTIARIO trae metadatos descriptivos. VALORES_3D es la LISTA CERRADA:
// el equipo 3D hace un modelo por `familia` × `silueta` y una animación por valor de `ataque`.
// Los valores van sin tildes ni ñ a propósito (se usan como claves, nombres de archivo y
// clases CSS), igual que `claveEnemigo` de sprites.js.
export const VALORES_3D = Object.freeze({
  /** Qué es la criatura: decide material, proporciones y esqueleto. */
  familia: Object.freeze(["bestia", "insecto", "humanoide", "no-muerto", "espectro", "constructo", "elemental", "dragon"]),
  /** Cómo se apoya y se mueve: decide el esqueleto y la animación de reposo/desplazamiento. */
  silueta: Object.freeze(["cuadrupedo", "bipedo", "aracnido", "reptante", "alado", "flotante"]),
  /** Animación de ataque. `guardia` y `apoyo` solo aparecen en movimientos/habilidades, nunca como `ataque3d` de una criatura. */
  ataque: Object.freeze(["mordisco", "garra", "arma", "proyectil", "aliento", "embestida", "conjuro", "guardia", "apoyo"]),
  /** `altura` es relativa: 1 = la altura del héroe. Siempre dentro de este rango. */
  altura: Object.freeze({ min: 0.5, max: 2.8 }),
});

/**
 * Metadatos 3D de una criatura (o null si la clave no existe). Atajo para el motor 3D:
 * `{familia, silueta, altura, color, colorSecundario, emision, ataque3d}`.
 * @param {string} clave clave del BESTIARIO
 */
export function metadatos3d(clave) {
  const b = BESTIARIO.find((x) => x.clave === clave);
  if (!b) return null;
  const { familia, silueta, altura, color, colorSecundario, emision, ataque3d } = b;
  return { familia, silueta, altura, color, colorSecundario, emision, ataque3d };
}

/**
 * Animación 3D de un id de movimiento enemigo o de habilidad del héroe.
 * Los eventos de `turnoJugador` traen `id`; con esto el motor 3D sabe qué animar sin tablas propias.
 * @param {string} id id de MOVIMIENTOS o de HABILIDADES
 * @param {string} [porDefecto] animación si el id no se conoce
 * @returns {string} uno de VALORES_3D.ataque
 */
export function animacion3d(id, porDefecto = "arma") {
  return MOVIMIENTOS[id]?.animacion3d ?? HABILIDADES[id]?.animacion3d ?? porDefecto;
}

/**
 * Movimientos de los enemigos. `tipo` es el de la intención que se muestra
 * ("atacar" | "cargar" | "defender" | "habilidad").
 * Campos de efecto: mult, golpes, bloqueable (Defender lo reduce a ×0,2), imparable (no se esquiva),
 * estado {tipo, turnos, pct}, estadosPropios (estados que se aplica el propio enemigo: escudo, furia),
 * drena (fracción del daño que cura), robaPocion, libera (id que se lanza el turno siguiente tras
 * cargar), contraataque (mult del contraataque mientras defiende).
 * `animacion3d` es un valor de VALORES_3D.ataque: contrato con el motor 3D (ver `animacion3d()`).
 * Un movimiento sin `mult` no golpea: solo aplica sus `estadosPropios`.
 */
export const MOVIMIENTOS = Object.freeze({
  ataque: { tipo: "atacar", nombre: "Ataque", icono: "⚔️", mult: 1, animacion3d: "arma" },
  // genérico (enemigos sin clave)
  carga_generica: { tipo: "cargar", nombre: "Preparar golpe", icono: "⚡", libera: "golpe_brutal", animacion3d: "apoyo" },
  golpe_brutal: { tipo: "habilidad", nombre: "Golpe brutal", icono: "💢", mult: 1.75, brutal: true, animacion3d: "embestida" },
  // rata
  roer: { tipo: "habilidad", nombre: "Roer", icono: "🦷", mult: 0.7, estado: { tipo: "sangrado", turnos: 2, pct: 0.3 }, animacion3d: "mordisco" },
  // murciélago
  chupar_sangre: { tipo: "habilidad", nombre: "Chupar sangre", icono: "🩸", mult: 0.65, drena: 1.1, animacion3d: "mordisco" },
  // lobo
  dentellada: { tipo: "habilidad", nombre: "Dentellada doble", icono: "🐾", mult: 0.6, golpes: 2, animacion3d: "mordisco" },
  // limo
  salpicadura_acida: { tipo: "habilidad", nombre: "Salpicadura ácida", icono: "🧫", mult: 0.6, estado: { tipo: "veneno", turnos: 3, pct: 0.3 }, animacion3d: "proyectil" },
  endurecer: { tipo: "habilidad", nombre: "Costra ácida", icono: "🫧", estadosPropios: [{ tipo: "escudo", turnos: 2, pct: 0.18 }], animacion3d: "guardia" },
  // goblin
  robar: { tipo: "habilidad", nombre: "Robar poción", icono: "🫳", mult: 0.5, robaPocion: true, animacion3d: "garra" },
  punalada: { tipo: "habilidad", nombre: "Puñalada trapera", icono: "🔪", mult: 1.4, animacion3d: "arma" },
  // esqueleto
  tajo_oxidado: { tipo: "habilidad", nombre: "Tajo oxidado", icono: "🦴", mult: 0.9, estado: { tipo: "sangrado", turnos: 3, pct: 0.3 }, animacion3d: "arma" },
  // bandido
  finta: { tipo: "defender", nombre: "Finta", icono: "🤺", contraataque: 0.9, animacion3d: "guardia" },
  ataque_traicion: { tipo: "habilidad", nombre: "Golpe a traición", icono: "🗡️", mult: 1.25, imparable: true, animacion3d: "arma" },
  // araña
  picadura: { tipo: "habilidad", nombre: "Picadura venenosa", icono: "🧪", mult: 0.6, estado: { tipo: "veneno", turnos: 3, pct: 0.35 }, animacion3d: "mordisco" },
  telarana: { tipo: "habilidad", nombre: "Telaraña", icono: "🕸️", mult: 0.3, estado: { tipo: "aturdido", turnos: 1 }, animacion3d: "proyectil" },
  // avispas
  aguijonazos: { tipo: "habilidad", nombre: "Aguijonazos", icono: "🐝", mult: 0.5, golpes: 3, animacion3d: "mordisco" },
  // orco
  enfurecer: { tipo: "cargar", nombre: "Enfurecerse", icono: "😤", libera: "hachazo", animacion3d: "apoyo" },
  hachazo: { tipo: "habilidad", nombre: "Hachazo brutal", icono: "🪓", mult: 1.85, brutal: true, animacion3d: "arma" },
  // caballero caído
  juramento: { tipo: "habilidad", nombre: "Juramento de hierro", icono: "⚜️", estadosPropios: [{ tipo: "escudo", turnos: 2, pct: 0.22 }], animacion3d: "guardia" },
  estocada: { tipo: "habilidad", nombre: "Estocada de luto", icono: "🗡️", mult: 1.35, bloqueable: true, animacion3d: "arma" },
  // espectro
  toque_helado: { tipo: "habilidad", nombre: "Toque helado", icono: "❄️", mult: 0.8, drena: 1, animacion3d: "conjuro" },
  // arpía
  zarpazo_doble: { tipo: "habilidad", nombre: "Zarpazo doble", icono: "🪶", mult: 0.65, golpes: 2, animacion3d: "garra" },
  vendaval: { tipo: "habilidad", nombre: "Vendaval", icono: "🌪️", mult: 0.35, estado: { tipo: "aturdido", turnos: 1 }, animacion3d: "aliento" },
  // gólem
  guardia_piedra: { tipo: "defender", nombre: "Guardia de piedra", icono: "🪨", contraataque: 0.7, animacion3d: "guardia" },
  // basilisco
  mirada_petrea: { tipo: "habilidad", nombre: "Mirada pétrea", icono: "👁️", mult: 0.4, estado: { tipo: "aturdido", turnos: 1 }, animacion3d: "conjuro" },
  colmillo_venenoso: { tipo: "habilidad", nombre: "Colmillo venenoso", icono: "🦎", mult: 0.75, estado: { tipo: "veneno", turnos: 3, pct: 0.3 }, animacion3d: "mordisco" },
  // hechicero
  concentrar: { tipo: "cargar", nombre: "Concentrar hechizo", icono: "🔮", libera: "bola_fuego", animacion3d: "apoyo" },
  bola_fuego: { tipo: "habilidad", nombre: "Bola de fuego", icono: "🔥", mult: 2.4, bloqueable: true, brutal: true, animacion3d: "proyectil" },
  maldicion: { tipo: "habilidad", nombre: "Maldición", icono: "🕯️", mult: 0.5, estado: { tipo: "veneno", turnos: 3, pct: 0.3 }, animacion3d: "conjuro" },
  // elemental de fuego
  avivar_llamas: { tipo: "cargar", nombre: "Avivar las llamas", icono: "🎇", libera: "oleada_ignea", animacion3d: "apoyo" },
  oleada_ignea: { tipo: "habilidad", nombre: "Oleada ígnea", icono: "🔥", mult: 2.1, bloqueable: true, brutal: true, animacion3d: "aliento" },
  reavivarse: { tipo: "habilidad", nombre: "Reavivarse", icono: "♨️", estadosPropios: [{ tipo: "furia", turnos: 2, valor: 0.3 }], animacion3d: "apoyo" },
  // liche
  barrera_hueso: { tipo: "habilidad", nombre: "Barrera de hueso", icono: "🦴", estadosPropios: [{ tipo: "escudo", turnos: 2, pct: 0.15 }], animacion3d: "conjuro" },
  sorbo_de_alma: { tipo: "habilidad", nombre: "Sorbo de alma", icono: "🫙", mult: 0.8, drena: 1, animacion3d: "conjuro" },
  // quimera
  tres_cabezas: { tipo: "habilidad", nombre: "Tres cabezas", icono: "🦁", mult: 0.55, golpes: 3, animacion3d: "mordisco" },
  rugido_triple: { tipo: "habilidad", nombre: "Rugido triple", icono: "📢", estadosPropios: [{ tipo: "furia", turnos: 3, valor: 0.25 }], animacion3d: "apoyo" },
  // dragón
  inspirar: { tipo: "cargar", nombre: "Tomar aire", icono: "🌬️", libera: "aliento", animacion3d: "apoyo" },
  aliento: { tipo: "habilidad", nombre: "Aliento de fuego", icono: "🔥", mult: 2.0, bloqueable: true, brutal: true, estado: { tipo: "veneno", turnos: 3, pct: 0.22 }, animacion3d: "aliento" },
  coletazo: { tipo: "habilidad", nombre: "Coletazo", icono: "🦎", mult: 0.8, estado: { tipo: "aturdido", turnos: 1 }, animacion3d: "garra" },
  // jefes
  definitiva_carga: { tipo: "cargar", nombre: "Preparar definitiva", icono: "☄️", libera: "definitiva", definitiva: true, animacion3d: "apoyo" },
  definitiva: { tipo: "habilidad", nombre: "Definitiva", icono: "☄️", mult: JEFE.multDefinitiva, bloqueable: true, imparable: true, brutal: true, definitiva: true, animacion3d: "conjuro" },
});

const tieneEstado = (q, tipo) => q.estados.some((e) => e.tipo === tipo && e.turnos > 0);
const sinAturdirReciente = (c) => c.turno - (c.enemigo.ultimoAturdir ?? -99) >= 4 && !tieneEstado(c.jugador, "aturdido");
const sinVeneno = (c) => !tieneEstado(c.jugador, "veneno");
const sinEscudo = (c) => !tieneEstado(c.enemigo, "escudo");
const sinFuria = (c) => !tieneEstado(c.enemigo, "furia");

/**
 * Bestiario ordenado de menor a mayor peligro (20 criaturas, 2 por nivel de arena).
 * Cada criatura tiene `clave` (para sprites), modificadores de stats, esquiva propia,
 * patrón de movimientos (probabilidades) y el nombre de su definitiva como jefe.
 *
 * Metadatos para el motor 3D (lista cerrada de valores en VALORES_3D):
 *   `familia`         qué es → material y proporciones.
 *   `silueta`         cómo se apoya → esqueleto y animación de reposo.
 *   `altura`          relativa al héroe (1 = la del héroe), entre 0,5 y 2,8.
 *   `color`           color principal del cuerpo (hex).
 *   `colorSecundario` color de los detalles (hex).
 *   `emision`         color de emisión/brillo (hex) o null si no brilla.
 *   `ataque3d`        animación de su ataque característico.
 * `rasgo` sigue siendo el texto que ve el jugador y `emoji` el respaldo 2D.
 */
export const BESTIARIO = Object.freeze([
  { clave: "rata", nombre: "Rata gigante", emoji: "🐀", titulo: "Reina de las Cloacas", definitiva: "Plaga de las cloacas",
    familia: "bestia", silueta: "cuadrupedo", altura: 0.6, color: "#8b7d6b", colorSecundario: "#c7b299", emision: null, ataque3d: "mordisco",
    mods: { vida: 0.9, ataque: 0.9, defensa: 0.8 }, esquiva: 0.08, rasgo: "Muerde y hace sangrar.",
    patron: [{ mov: "roer", prob: 0.3 }] },
  { clave: "murcielago", nombre: "Murciélago sanguino", emoji: "🦇", titulo: "Señor de la Noche Larga", definitiva: "Nube de alas",
    familia: "bestia", silueta: "alado", altura: 0.7, color: "#3f3550", colorSecundario: "#8b5cf6", emision: null, ataque3d: "mordisco",
    mods: { vida: 0.8, ataque: 0.95, defensa: 0.75 }, esquiva: 0.18, rasgo: "Revolotea, esquiva mucho y bebe tu sangre para curarse.",
    patron: [{ mov: "chupar_sangre", prob: 0.35 }] },
  { clave: "lobo", nombre: "Lobo sombrío", emoji: "🐺", titulo: "Alfa de la Manada", definitiva: "Aullido de la luna negra",
    familia: "bestia", silueta: "cuadrupedo", altura: 1, color: "#4b5563", colorSecundario: "#1f2937", emision: null, ataque3d: "mordisco",
    mods: { vida: 0.9, ataque: 1.05, defensa: 0.9 }, esquiva: 0.1, rasgo: "Ataca dos veces seguidas.",
    patron: [{ mov: "dentellada", prob: 0.3 }] },
  { clave: "limo", nombre: "Limo ácido", emoji: "🫧", titulo: "Marea Corrosiva", definitiva: "Diluvio ácido",
    familia: "elemental", silueta: "reptante", altura: 0.7, color: "#3fbf8f", colorSecundario: "#0f766e", emision: "#6ee7b7", ataque3d: "embestida",
    mods: { vida: 1.3, ataque: 0.85, defensa: 0.7 }, esquiva: 0, rasgo: "Blando y correoso: aguanta mucho, envenena y se cubre de costra.",
    patron: [{ mov: "salpicadura_acida", prob: 0.3, cond: sinVeneno }, { mov: "endurecer", prob: 0.2, cond: sinEscudo }] },
  { clave: "goblin", nombre: "Goblin saqueador", emoji: "👺", titulo: "Rey del Botín", definitiva: "Lluvia de dagas",
    familia: "humanoide", silueta: "bipedo", altura: 0.9, color: "#6b9b3f", colorSecundario: "#3f5f22", emision: null, ataque3d: "arma",
    mods: { vida: 1, ataque: 1, defensa: 1 }, esquiva: 0.08, rasgo: "Te roba pociones.",
    patron: [{ mov: "robar", prob: 0.25, cond: (c) => c.jugador.pociones > 0 }, { mov: "punalada", prob: 0.2 }] },
  { clave: "esqueleto", nombre: "Esqueleto errante", emoji: "💀", titulo: "Señor de los Huesos", definitiva: "Danza macabra",
    familia: "no-muerto", silueta: "bipedo", altura: 1, color: "#e5e7eb", colorSecundario: "#9ca3af", emision: null, ataque3d: "arma",
    mods: { vida: 1, ataque: 1, defensa: 1.1 }, esquiva: 0.05, rasgo: "Su hoja oxidada provoca sangrado.",
    patron: [{ mov: "tajo_oxidado", prob: 0.3 }] },
  { clave: "bandido", nombre: "Bandido enmascarado", emoji: "🥷", titulo: "Sombra de los Caminos", definitiva: "Mil cortes",
    familia: "humanoide", silueta: "bipedo", altura: 1, color: "#2f3440", colorSecundario: "#b91c1c", emision: null, ataque3d: "arma",
    mods: { vida: 0.95, ataque: 1.05, defensa: 0.9 }, esquiva: 0.14, rasgo: "Finta para contraatacar y su daga a traición no se puede esquivar.",
    patron: [{ mov: "finta", prob: 0.18, cond: (c) => !c.enemigo.defendioUltimo }, { mov: "ataque_traicion", prob: 0.22 }] },
  { clave: "arana", nombre: "Araña venenosa", emoji: "🕷️", titulo: "Madre de la Colmena", definitiva: "Nido de agujas",
    familia: "insecto", silueta: "aracnido", altura: 0.8, color: "#2b2238", colorSecundario: "#7c3aed", emision: null, ataque3d: "mordisco",
    mods: { vida: 0.9, ataque: 0.95, defensa: 0.9 }, esquiva: 0.08, rasgo: "Envenena y atrapa en su tela.",
    patron: [{ mov: "picadura", prob: 0.4, cond: sinVeneno }, { mov: "telarana", prob: 0.15, cond: sinAturdirReciente }] },
  { clave: "avispa", nombre: "Enjambre de avispas", emoji: "🐝", titulo: "Zumbido Interminable", definitiva: "Tormenta de aguijones",
    familia: "insecto", silueta: "alado", altura: 0.8, color: "#f59e0b", colorSecundario: "#1c1917", emision: null, ataque3d: "mordisco",
    mods: { vida: 0.85, ataque: 1, defensa: 0.7 }, esquiva: 0.2, rasgo: "Tres aguijonazos seguidos y cuesta acertarle.",
    patron: [{ mov: "aguijonazos", prob: 0.45 }] },
  { clave: "orco", nombre: "Orco berserker", emoji: "👹", titulo: "Caudillo Sangriento", definitiva: "Masacre",
    familia: "humanoide", silueta: "bipedo", altura: 1.3, color: "#7f8f4a", colorSecundario: "#4a2f1a", emision: null, ataque3d: "arma",
    mods: { vida: 1.1, ataque: 1.05, defensa: 0.9 }, esquiva: 0.03, rasgo: "Cuanto más herido, más fuerte golpea.",
    berserker: 0.3, patron: [{ mov: "enfurecer", prob: 0.25 }] },
  { clave: "caballero", nombre: "Caballero caído", emoji: "🪦", titulo: "Guardián del Juramento Roto", definitiva: "Sentencia final",
    familia: "no-muerto", silueta: "bipedo", altura: 1.2, color: "#58606e", colorSecundario: "#1e293b", emision: "#93c5fd", ataque3d: "arma",
    mods: { vida: 1.05, ataque: 1, defensa: 1.2 }, esquiva: 0.04, rasgo: "Se cubre con un escudo de juramento y castiga con estocadas.",
    patron: [{ mov: "juramento", prob: 0.22, cond: sinEscudo }, { mov: "estocada", prob: 0.25 }] },
  { clave: "espectro", nombre: "Espectro de la cripta", emoji: "👻", titulo: "Lamento Eterno", definitiva: "Grito de ultratumba",
    familia: "espectro", silueta: "flotante", altura: 1.1, color: "#9fb4d8", colorSecundario: "#2b3a55", emision: "#a5f3fc", ataque3d: "conjuro",
    mods: { vida: 0.9, ataque: 1, defensa: 0.8 }, esquiva: 0.3, rasgo: "Esquiva a menudo y roba vida.",
    patron: [{ mov: "toque_helado", prob: 0.3 }] },
  { clave: "arpia", nombre: "Arpía de las cumbres", emoji: "🪶", titulo: "Reina de los Vientos", definitiva: "Huracán de plumas",
    familia: "bestia", silueta: "alado", altura: 1.2, color: "#8b5e34", colorSecundario: "#e7d3b1", emision: null, ataque3d: "garra",
    mods: { vida: 0.9, ataque: 1.05, defensa: 0.85 }, esquiva: 0.16, rasgo: "Zarpazos dobles desde el aire y un vendaval que aturde.",
    patron: [{ mov: "zarpazo_doble", prob: 0.3 }, { mov: "vendaval", prob: 0.15, cond: sinAturdirReciente }] },
  { clave: "golem", nombre: "Gólem de piedra", emoji: "🗿", titulo: "Coloso Inquebrantable", definitiva: "Terremoto",
    familia: "constructo", silueta: "bipedo", altura: 1.6, color: "#7b7268", colorSecundario: "#44403c", emision: null, ataque3d: "embestida",
    mods: { vida: 1.3, ataque: 1, defensa: 1.25 }, esquiva: 0, rasgo: "Se defiende y contraataca.",
    patron: [{ mov: "guardia_piedra", prob: 0.35, cond: (c) => !c.enemigo.defendioUltimo }] },
  { clave: "basilisco", nombre: "Basilisco pétreo", emoji: "🦎", titulo: "Ojo que Petrifica", definitiva: "Mirada de la eternidad",
    familia: "bestia", silueta: "reptante", altura: 1.2, color: "#6b7f3f", colorSecundario: "#3f4a22", emision: "#bef264", ataque3d: "mordisco",
    mods: { vida: 0.95, ataque: 1, defensa: 1 }, esquiva: 0.05, rasgo: "Su mirada petrifica y su colmillo envenena.",
    patron: [{ mov: "mirada_petrea", prob: 0.12, cond: sinAturdirReciente }, { mov: "colmillo_venenoso", prob: 0.3, cond: sinVeneno }] },
  { clave: "hechicero", nombre: "Hechicero oscuro", emoji: "🧙", titulo: "Archimago del Abismo", definitiva: "Meteoro arcano",
    familia: "humanoide", silueta: "bipedo", altura: 1.1, color: "#4c1d95", colorSecundario: "#d8b4fe", emision: "#c084fc", ataque3d: "conjuro",
    mods: { vida: 0.85, ataque: 1.3, defensa: 0.9 }, esquiva: 0.06, rasgo: "Carga hechizos que hay que bloquear.",
    patron: [{ mov: "concentrar", prob: 0.15 }, { mov: "maldicion", prob: 0.15, cond: sinVeneno }] },
  { clave: "elemental", nombre: "Elemental de fuego", emoji: "🔥", titulo: "Corazón de la Fragua", definitiva: "Infierno vivo",
    familia: "elemental", silueta: "flotante", altura: 1.4, color: "#f97316", colorSecundario: "#7c2d12", emision: "#fde047", ataque3d: "aliento",
    mods: { vida: 0.85, ataque: 1.38, defensa: 0.9 }, esquiva: 0.08, rasgo: "Aviva sus llamas para arrasarte y se reaviva para pegar más fuerte.",
    patron: [{ mov: "avivar_llamas", prob: 0.14 }, { mov: "reavivarse", prob: 0.18, cond: sinFuria }] },
  { clave: "liche", nombre: "Liche de la torre", emoji: "☠️", titulo: "Guardián de los Grimorios", definitiva: "Sentencia de hueso",
    familia: "no-muerto", silueta: "flotante", altura: 1.3, color: "#3b2f4a", colorSecundario: "#86efac", emision: "#4ade80", ataque3d: "conjuro",
    mods: { vida: 1, ataque: 1.1, defensa: 1 }, esquiva: 0.1, rasgo: "Sorbe tu alma para curarse y se rodea de una barrera de hueso.",
    patron: [{ mov: "barrera_hueso", prob: 0.22, cond: sinEscudo }, { mov: "sorbo_de_alma", prob: 0.3 }] },
  { clave: "quimera", nombre: "Quimera de tres cabezas", emoji: "🦁", titulo: "Aberración del Foso", definitiva: "Tres fauces",
    familia: "bestia", silueta: "cuadrupedo", altura: 1.8, color: "#a16207", colorSecundario: "#7f1d1d", emision: null, ataque3d: "mordisco",
    mods: { vida: 1, ataque: 1.02, defensa: 1 }, esquiva: 0.06, rasgo: "Tres cabezas muerden a la vez y su rugido la enfurece.",
    patron: [{ mov: "tres_cabezas", prob: 0.3 }, { mov: "rugido_triple", prob: 0.15, cond: sinFuria }] },
  { clave: "dragon", nombre: "Dragón ancestral", emoji: "🐉", titulo: "Devorador de Reinos", definitiva: "Cataclismo",
    familia: "dragon", silueta: "alado", altura: 2.6, color: "#991b1b", colorSecundario: "#fbbf24", emision: "#f87171", ataque3d: "aliento",
    mods: { vida: 1.02, ataque: 1, defensa: 1 }, esquiva: 0.04, rasgo: "Su aliento abrasa; su cola aturde.",
    patron: [{ mov: "inspirar", prob: 0.15 }, { mov: "coletazo", prob: 0.12, cond: sinAturdirReciente }] },
].map((b) => Object.freeze({ ...b, patron: Object.freeze(b.patron.map((p) => Object.freeze({ ...p }))) })));

const PATRON_GENERICO = Object.freeze([{ mov: "carga_generica", prob: 0.2 }]);
const criaturaDe = (clave) => BESTIARIO.find((b) => b.clave === clave);

/** PRNG determinista (mulberry32) para tests y repeticiones. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Entero aleatorio en [min, max] (ambos incluidos). */
export function randInt(min, max, rng = Math.random) {
  return min + Math.floor(rng() * (max - min + 1));
}

export function clampNivel(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return NIVEL_MIN;
  return Math.min(NIVEL_MAX, Math.max(NIVEL_MIN, v));
}

/** Nivel de arena según victorias acumuladas (1..10): sube cada VICTORIAS_POR_NIVEL. */
export function nivelArena(victorias) {
  return clampNivel(1 + Math.floor(Math.max(0, Number(victorias) || 0) / VICTORIAS_POR_NIVEL));
}

/**
 * ¿El próximo combate es contra un jefe? Es el 5.º combate de cada nivel de arena:
 * con 4, 9, 14… victorias acumuladas. Hasta vencerlo no se sube de nivel.
 * @param {number} victorias victorias acumuladas antes del combate
 */
export function esCombateDeJefe(victorias) {
  const v = Math.max(0, Math.floor(Number(victorias) || 0));
  return v % VICTORIAS_POR_NIVEL === VICTORIAS_POR_NIVEL - 1;
}

/** Nivel del próximo enemigo: nivel de arena ±1, acotado a 1..10. */
export function nivelEnemigo(nivelDeArena, rng = Math.random) {
  return clampNivel(clampNivel(nivelDeArena) + randInt(-1, 1, rng));
}

/**
 * Escalado de los enemigos, antes de los mods de la criatura. Se define por los DOS EXTREMOS
 * (nivel 1 y nivel 10) y una curva con `exponente` que interpola los niveles de en medio.
 *
 * Con `exponente` 1 la curva es una recta. Con más de 1 sube despacio al principio y se
 * acelera al final, que es lo que queremos: la arena 1 tiene que perdonar y el nivel 10 tiene
 * que doler. Antes era una recta que arrancaba muy alta (ataque 16,3 en el nivel 1 contra los
 * 10 del héroe recién llegado), así que quien solo pulsaba «Atacar» perdía su primer combate:
 * 0,9 % de victorias en la arena 1. Los valores del nivel 10 son los de siempre, así que el
 * reto de arriba y los jefes no cambian.
 *
 * Para reequilibrar, mover `nivel1` (lo acogedor que es el recibimiento), `nivel10` (el techo)
 * y `exponente` (cómo de tarde llega la cuesta), y comprobar con `node tools/balance.mjs`.
 */
export const ESCALA_ENEMIGO = Object.freeze({
  exponente: 1.45,
  nivel1: Object.freeze({ vida: 82, ataque: 11.5, defensa: 2 }),
  nivel10: Object.freeze({ vida: 156.6, ataque: 26.06, defensa: 7.21 }),
});

/** Estadísticas escaladas de un enemigo "estándar" de nivel n (antes de los mods de la criatura). */
export function statsEnemigo(nivel) {
  const n = clampNivel(nivel);
  const { exponente, nivel1, nivel10 } = ESCALA_ENEMIGO;
  // t va de 0 (nivel 1) a 1 (nivel 10) siguiendo la curva.
  const t = (n ** exponente - 1) / (NIVEL_MAX ** exponente - 1);
  const v = (k) => nivel1[k] + (nivel10[k] - nivel1[k]) * t;
  return { vidaMax: v("vida"), ataque: v("ataque"), defensa: v("defensa") };
}

/**
 * Genera un enemigo del nivel dado, eligiendo criatura acorde al nivel.
 * @param {number} nivel 1..10
 * @param {() => number} [rng]
 * @param {{jefe?: boolean}} [opciones] jefe: versión jefe (más vida, 2 fases, definitiva)
 * @returns {{clave:string, nombre:string, emoji:string, nivel:number, jefe:boolean, vidaMax:number, ataque:number, defensa:number, esquiva:number, rasgo:string, definitiva:string|null}}
 */
export function generarEnemigo(nivel, rng = Math.random, { jefe = false } = {}) {
  return generarEnemigoDe(claveDeNivel(nivel, rng).clave, clampNivel(nivel), { jefe });
}

/**
 * Criatura que puede salir en un nivel de arena: ventana de 3 del bestiario centrada en el nivel.
 * Con 20 criaturas y 10 niveles la ventana avanza ~2 por nivel, así que toda criatura puede
 * aparecer (y ser jefe) en algún nivel. Consume un valor de `rng`.
 * @param {number} nivel 1..10
 * @param {() => number} [rng]
 */
export function claveDeNivel(nivel, rng = Math.random) {
  const n = clampNivel(nivel);
  const centro = Math.round(((n - 1) * (BESTIARIO.length - 1)) / (NIVEL_MAX - 1));
  const lo = Math.max(0, centro - 1);
  const hi = Math.min(BESTIARIO.length - 1, centro + 1);
  return BESTIARIO[randInt(lo, hi, rng)];
}

/**
 * Genera una criatura concreta del bestiario (no consume rng). Útil para el desafío diario.
 * @param {string} clave clave de BESTIARIO (rata, lobo, goblin…)
 * @param {number} nivel 1..10
 * @param {{jefe?: boolean}} [opciones]
 * @returns {ReturnType<typeof generarEnemigo>}
 * @throws si la clave no existe
 */
export function generarEnemigoDe(clave, nivel, { jefe = false } = {}) {
  const cr = criaturaDe(clave);
  if (!cr) throw new Error(`Criatura desconocida: ${clave}`);
  const n = clampNivel(nivel);
  const s = statsEnemigo(n);
  const mj = jefe ? JEFE : { vida: 1, ataque: 1, defensa: 1 };
  // En los jefes los modificadores de la criatura se suavizan a la mitad (ya llevan los de JEFE).
  const mod = (k) => (jefe ? (1 + cr.mods[k]) / 2 : cr.mods[k]);
  return {
    clave: cr.clave,
    nombre: jefe ? `${cr.nombre}, ${cr.titulo}` : cr.nombre,
    emoji: cr.emoji,
    nivel: n,
    jefe,
    vidaMax: Math.round(s.vidaMax * mod("vida") * mj.vida),
    ataque: Math.round(s.ataque * mod("ataque") * mj.ataque),
    defensa: Math.round(s.defensa * mod("defensa") * mj.defensa),
    // Un jefe muy escurridizo alarga el combate sin hacerlo interesante: se le topa la esquiva.
    esquiva: jefe ? Math.min(cr.esquiva, JEFE.esquivaMax) : cr.esquiva,
    rasgo: cr.rasgo,
    definitiva: jefe ? cr.definitiva : null,
  };
}

/**
 * Daño base = ataque² / (ataque + defensa) con variación ±VARIACION_DANO; entero ≥ 1.
 * La defensa reduce de forma suave (nunca anula del todo) para que el equipo alto no rompa el juego.
 * Consume exactamente un valor de `rng`.
 * @param {number} ataque
 * @param {number} defensa
 */
export function calcularDano(ataque, defensa, rng = Math.random) {
  const a = Math.max(1, Number(ataque) || 0);
  const d = Math.max(0, Number(defensa) || 0);
  const base = (a * a) / (a + d);
  const variacion = 1 - VARIACION_DANO + 2 * VARIACION_DANO * rng();
  return Math.max(1, Math.round(base * variacion));
}

/** Probabilidad de crítico del héroe según el ataque aportado por el equipo. */
export function probCritico(bonusAtaque = 0) {
  return Math.min(CRITICO_MAX, CRITICO_BASE + Math.floor(Math.max(0, bonusAtaque) / 3) * CRITICO_POR_3_ATAQUE);
}

/** Probabilidad de esquiva del héroe según su defensa total. */
export function probEsquiva(defensa = 0) {
  return Math.min(ESQUIVA_MAX, ESQUIVA_BASE + Math.max(0, defensa) * ESQUIVA_POR_DEFENSA);
}

const NOMBRE_ESTADO = { veneno: "veneno", sangrado: "sangrado", aturdido: "aturdido", fragil: "armadura rota", escudo: "escudo", furia: "furia", reflejo: "reflejo", evasion: "evasión" };
const NEGATIVOS = new Set(["veneno", "sangrado", "aturdido", "fragil"]);

/**
 * Crea un combate nuevo.
 * @param {{vidaMax?:number, vida?:number, ataque:number, defensa:number, nivel?:number,
 *          habilidades?:Array<string|{id:string}>, critico?:number, esquiva?:number,
 *          bonusAtaque?:number, pociones?:number, pocionesExtra?:number}} heroe
 *   Stats del héroe (usa `progression.statsHeroe`). `vida` se acepta como sinónimo de `vidaMax`.
 *   `pociones`: pociones normales que le quedan en la expedición (por defecto POCIONES_POR_EXPEDICION).
 *   `pocionesExtra`: pociones compradas en la tienda (consumible id 14) que se SUMAN a las normales.
 *   Se gastan siempre primero las normales; las extra solo si ya no quedan normales.
 *   Al terminar, `combate.jugador.pocionesExtra` son las extra que quedan y
 *   `combate.resumen.pocionesExtraGastadas` las que se consumieron (bebidas o robadas): esas son las que hay que quemar.
 * @param {ReturnType<typeof generarEnemigo>} enemigo
 * @param {() => number} [rng] se usa para la primera intención del enemigo
 */
export function crearCombate(heroe, enemigo, rng = Math.random) {
  const vidaMax = Math.round(heroe.vidaMax ?? heroe.vida);
  const bonusAtaque = heroe.bonusAtaque ?? Math.max(0, heroe.ataque - STATS_BASE.ataque);
  const jugador = {
    nombre: "Tu héroe",
    nivel: heroe.nivel ?? 1,
    vidaMax,
    vida: vidaMax,
    ataque: heroe.ataque,
    defensa: heroe.defensa,
    critico: heroe.critico ?? probCritico(bonusAtaque),
    esquiva: heroe.esquiva ?? probEsquiva(heroe.defensa),
    pociones: 0, // total (normales + extra); se recalcula abajo
    pocionesBase: Math.max(0, Math.floor(Number(heroe.pociones ?? POCIONES_POR_EXPEDICION) || 0)),
    pocionesExtra: Math.max(0, Math.floor(Number(heroe.pocionesExtra ?? 0) || 0)),
    habilidades: iniciarHabilidades(heroe.habilidades ?? HABILIDADES_BASE),
    estados: [],
    defendiendo: false,
  };
  jugador.pociones = jugador.pocionesBase + jugador.pocionesExtra;
  const en = {
    ...enemigo,
    jefe: !!enemigo.jefe,
    esquiva: enemigo.esquiva ?? 0,
    vida: enemigo.vidaMax,
    estados: [],
    defendiendo: false,
    defendioUltimo: false,
    cargando: null,
    fase: 1,
    turnosDefinitiva: 0,
    ultimoAturdir: -99,
    intencion: null,
  };
  const texto = en.jefe
    ? `👑 ¡JEFE! ${en.nombre} (nivel ${en.nivel}) domina la arena.`
    : `¡Un ${en.nombre} (nivel ${en.nivel}) salta a la arena!`;
  const c = {
    turno: 1,
    fase: "en_curso", // "en_curso" | "victoria" | "derrota" | "huida"
    jefe: en.jefe,
    jugador,
    enemigo: en,
    resumen: { danoHecho: 0, danoRecibido: 0, criticos: 0, esquivas: 0, pocionesUsadas: 0, pocionesExtraGastadas: 0, habilidadesUsadas: 0, turnos: 0 },
    log: [],
  };
  c.enemigo.intencion = decidirIntencion(c, rng);
  c.log.push(snap(c, { actor: "sistema", tipo: "inicio", jefe: en.jefe, texto }));
  return c;
}

/**
 * Intención del enemigo para su próximo turno (ya calculada; no consume rng).
 * @returns {{tipo:"atacar"|"cargar"|"defender"|"habilidad", id:string, nombre:string, icono:string,
 *           texto:string, telegrafiado:boolean, bloqueable:boolean, definitiva:boolean} | null}
 */
export function intencionEnemigo(combate) {
  return combate?.fase === "en_curso" ? combate.enemigo.intencion : null;
}

/** ¿El héroe perderá su próxima acción por estar aturdido? */
export function jugadorAturdido(combate) {
  return combate.jugador.estados.some((e) => e.tipo === "aturdido" && e.turnos > 0);
}

/**
 * Comprueba si una acción es válida ahora mismo (sin lanzar).
 * @returns {{ok:boolean, motivo?:string}}
 */
export function validarAccion(combate, accion) {
  if (combate.fase !== "en_curso") return { ok: false, motivo: "El combate ya ha terminado" };
  if (accion === "atacar" || accion === "defender") return { ok: true };
  if (accion === "pocion") return combate.jugador.pociones > 0 ? { ok: true } : { ok: false, motivo: "No te quedan pociones" };
  if (accion && typeof accion === "object" && typeof accion.habilidad === "string") {
    const h = combate.jugador.habilidades.find((x) => x.id === accion.habilidad);
    if (!h || !habilidad(h.id)) return { ok: false, motivo: `Habilidad no disponible: ${accion.habilidad}` };
    if (h.restante > 0) return { ok: false, motivo: `${HABILIDADES[h.id].nombre} está en enfriamiento (${h.restante})` };
    return { ok: true };
  }
  return { ok: false, motivo: `Acción desconocida: ${typeof accion === "object" ? JSON.stringify(accion) : accion}` };
}

/**
 * Resuelve una ronda: actúa el héroe y, si el enemigo sigue vivo, el enemigo.
 * @param {object} combate estado devuelto por crearCombate / turnoJugador (no se muta)
 * @param {"atacar"|"defender"|"pocion"|{habilidad:string}} accion
 * @param {() => number} [rng]
 * @returns {{combate:object, eventos:Array<Evento>, fin:null|"victoria"|"derrota"|"huida"}}
 * @throws si el combate terminó, la acción es desconocida, no hay pociones o la habilidad está en enfriamiento
 *
 * @typedef {Object} Evento
 * @property {"jugador"|"enemigo"|"sistema"} actor quién provoca el evento
 * @property {"jugador"|"enemigo"} [objetivo] quién lo recibe
 * @property {string} tipo inicio|ataque|habilidad|defensa|pocion|curacion|estado|dano_estado|aturdido|carga|
 *                         contraataque|reflejo|robo|fase|victoria|derrota|huida
 * @property {string} [id] id de la habilidad o del movimiento enemigo
 * @property {string} [nombre] nombre legible de la habilidad/movimiento
 * @property {number} [dano] daño a la vida del objetivo (tras escudo)
 * @property {boolean} [critico]
 * @property {boolean} [bloqueado] el objetivo defendía (daño reducido)
 * @property {boolean} [esquivado] el objetivo esquivó (dano 0)
 * @property {number} [absorbido] daño absorbido por escudo
 * @property {boolean} [brutal] golpe fuerte (para sacudir la pantalla)
 * @property {boolean} [definitiva] definitiva de jefe
 * @property {{tipo:string, turnos:number, valor?:number}} [estado] estado aplicado (o que hace daño en dano_estado)
 * @property {number} [curacion]
 * @property {{jugador:number, enemigo:number}} vidas vida de ambos tras el evento
 * @property {{jugador:Array, enemigo:Array}} estados estados de ambos tras el evento
 * @property {string} texto texto en español para la crónica
 */
export function turnoJugador(combate, accion, rng = Math.random) {
  const v = validarAccion(combate, accion);
  if (!v.ok) throw new Error(v.motivo);

  const c = {
    ...combate,
    jugador: structuredClone(combate.jugador),
    enemigo: structuredClone(combate.enemigo),
    resumen: { ...combate.resumen },
  };
  const eventos = [];
  const emit = (e) => { const ev = snap(c, e); eventos.push(ev); return ev; };
  const terminado = () => {
    if (c.fase !== "en_curso") return true;
    if (c.enemigo.vida <= 0) {
      c.fase = "victoria";
      emit({ actor: "sistema", tipo: "victoria", jefe: c.jefe, texto: c.jefe ? `👑 ¡Has derrotado al jefe ${c.enemigo.nombre}! 🏆` : `¡${c.enemigo.nombre} ha sido derrotado! 🏆` });
      return true;
    }
    if (c.jugador.vida <= 0) {
      c.fase = "derrota";
      emit({ actor: "sistema", tipo: "derrota", texto: "Has caído en la arena… ☠️" });
      return true;
    }
    return false;
  };
  const ctx = { c, rng, emit, terminado };

  // 1-2. Turno del héroe
  const aturdido = inicioTurno(ctx, "jugador");
  if (!terminado()) {
    if (aturdido) emit({ actor: "jugador", tipo: "aturdido", objetivo: "jugador", texto: "Estás aturdido y pierdes el turno 💫" });
    else accionJugador(ctx, accion);
    finTurno(c.jugador);
  }

  // 3. Turno del enemigo
  if (!terminado()) {
    const e = c.enemigo;
    e.defendiendo = false;
    const aturdidoE = inicioTurno(ctx, "enemigo");
    if (!terminado()) {
      if (aturdidoE) {
        emit({ actor: "enemigo", tipo: "aturdido", objetivo: "enemigo", texto: `${e.nombre} está aturdido y pierde el turno 💫` });
        e.defendioUltimo = false;
      } else {
        accionEnemigo(ctx);
      }
      finTurno(e);
      terminado();
    }
  }

  // 4. Fin de ronda
  c.jugador.defendiendo = false;
  c.jugador.habilidades = avanzarEnfriamientos(c.jugador.habilidades);
  c.resumen.turnos += 1;
  if (c.fase === "en_curso") c.enemigo.intencion = decidirIntencion(c, rng);
  else c.enemigo.intencion = null;

  const fin = c.fase === "en_curso" ? null : c.fase;
  return { combate: { ...c, turno: combate.turno + 1, log: [...combate.log, ...eventos] }, eventos, fin };
}

/** Abandona el combate. */
export function huir(combate) {
  if (combate.fase !== "en_curso") return combate;
  const ev = snap(combate, { actor: "sistema", tipo: "huida", texto: "Huyes de la arena con el rabo entre las piernas." });
  return { ...combate, fase: "huida", enemigo: { ...combate.enemigo, intencion: null }, log: [...combate.log, ev] };
}

/**
 * Pociones que le quedan al héroe al terminar (para la siguiente pelea de la expedición).
 * @returns {{pociones:number, pocionesExtra:number, total:number, extraGastadas:number}}
 *   `pociones` normales y `pocionesExtra` que quedan (pásalas tal cual al siguiente crearCombate);
 *   `extraGastadas` = extra consumidas en ESTE combate (a quemar del ERC-1155).
 */
export function pocionesRestantes(combate) {
  const j = combate.jugador;
  return { pociones: j.pocionesBase, pocionesExtra: j.pocionesExtra, total: j.pociones, extraGastadas: combate.resumen.pocionesExtraGastadas };
}

/** Gasta una poción: primero las normales, luego las extra (compradas). */
function gastarPocion(c) {
  const j = c.jugador;
  if (j.pocionesBase > 0) j.pocionesBase -= 1;
  else if (j.pocionesExtra > 0) { j.pocionesExtra -= 1; c.resumen.pocionesExtraGastadas += 1; }
  j.pociones = j.pocionesBase + j.pocionesExtra;
}

// ───────────────────────── Internos ─────────────────────────

function snap(c, e) {
  return {
    ...e,
    vidas: { jugador: c.jugador.vida, enemigo: c.enemigo.vida },
    estados: { jugador: c.jugador.estados.map((x) => ({ ...x })), enemigo: c.enemigo.estados.map((x) => ({ ...x })) },
  };
}

const nombreDe = (c, quien) => (quien === "jugador" ? "Tú" : c.enemigo.nombre);
const rival = (q) => (q === "jugador" ? "enemigo" : "jugador");

/** Efectos al inicio del turno de `quien`. Devuelve true si está aturdido. */
function inicioTurno({ c, emit }, quien) {
  const q = c[quien];
  let aturdido = false;
  for (const e of q.estados) {
    if (e.turnos <= 0) continue;
    if (e.tipo === "veneno" || e.tipo === "sangrado") {
      const dano = Math.min(q.vida, e.valor);
      q.vida -= dano;
      if (quien === "enemigo") c.resumen.danoHecho += dano; else c.resumen.danoRecibido += dano;
      const ico = e.tipo === "veneno" ? "🧪" : "🩸";
      emit({
        actor: "sistema", objetivo: quien, tipo: "dano_estado", dano, estado: { tipo: e.tipo, turnos: e.turnos - 1, valor: e.valor },
        texto: quien === "jugador" ? `${ico} El ${e.tipo} te inflige ${dano} de daño.` : `${ico} ${c.enemigo.nombre} sufre ${dano} por ${e.tipo}.`,
      });
      if (quien === "enemigo") comprobarFase({ c, emit });
    }
    if (e.tipo === "aturdido") aturdido = true;
    e.turnos -= 1;
  }
  return aturdido;
}

/** Al final del turno de su portador se quitan los estados agotados. */
function finTurno(q) {
  q.estados = q.estados.filter((e) => e.turnos > 0 && !(e.tipo === "escudo" && e.valor <= 0));
}

function aplicarEstado(c, quien, def, ataqueFuente) {
  const q = c[quien];
  let valor = def.valor;
  if (def.pct != null) {
    const baseValor = def.tipo === "escudo" ? q.vidaMax : ataqueFuente;
    // `enemigo.multEstados` (opcional, p. ej. desafío diario) potencia los estados que aplica el enemigo.
    const mult = quien === "jugador" && def.tipo !== "escudo" ? (c.enemigo.multEstados ?? 1) : 1;
    valor = Math.max(1, Math.round(baseValor * def.pct * mult));
  }
  const nuevo = { tipo: def.tipo, turnos: def.turnos, ...(valor != null ? { valor } : {}) };
  const i = q.estados.findIndex((e) => e.tipo === def.tipo);
  if (i >= 0) {
    // Refresca: se queda con la mayor duración y el mayor valor.
    const viejo = q.estados[i];
    q.estados[i] = { ...nuevo, turnos: Math.max(viejo.turnos, nuevo.turnos), ...(valor != null ? { valor: Math.max(viejo.valor ?? 0, valor) } : {}) };
  } else {
    q.estados.push(nuevo);
  }
  if (def.tipo === "aturdido" && quien === "jugador") c.enemigo.ultimoAturdir = c.turno;
  return { ...q.estados.find((e) => e.tipo === def.tipo) };
}

function ataqueEfectivo(c, quien) {
  const q = c[quien];
  let atk = q.ataque;
  const furia = q.estados.find((e) => e.tipo === "furia" && e.turnos >= 0);
  if (furia) atk *= 1 + (furia.valor ?? 0);
  if (quien === "enemigo") {
    const cr = criaturaDe(q.clave);
    if (cr?.berserker) atk *= 1 + (q.jefe ? cr.berserker / 2 : cr.berserker) * (1 - q.vida / q.vidaMax);
  }
  return atk;
}

/** Defensa efectiva: `fragil` (armadura rota) le quita esa fracción mientras dure. */
function defensaEfectiva(c, quien) {
  const q = c[quien];
  const fr = q.estados.find((e) => e.tipo === "fragil" && e.turnos > 0);
  return fr ? Math.max(0, q.defensa * (1 - Math.min(0.9, fr.valor ?? FRAGIL_DEFECTO))) : q.defensa;
}

/**
 * Resuelve un golpe de `de` contra su rival. Orden de rng: esquiva, crítico, variación.
 * Muta el estado y devuelve el resultado (no emite eventos).
 */
function golpear({ c, rng }, de, opts = {}) {
  const a = rival(de);
  const at = c[de];
  const ob = c[a];
  if (!opts.imparable) {
    const ev = ob.estados.findIndex((e) => e.tipo === "evasion");
    if (ev >= 0) {
      ob.estados.splice(ev, 1);
      if (a === "jugador") c.resumen.esquivas += 1;
      return { dano: 0, esquivado: true, critico: false, bloqueado: false, absorbido: 0 };
    }
    if (rng() < (ob.esquiva ?? 0)) {
      if (a === "jugador") c.resumen.esquivas += 1;
      return { dano: 0, esquivado: true, critico: false, bloqueado: false, absorbido: 0 };
    }
  }
  const pCrit = opts.siempreCritico ? 1 : (de === "jugador" ? at.critico : (at.critico ?? CRITICO_ENEMIGO)) + (opts.criticoExtra ?? 0);
  const critico = opts.siempreCritico ? true : rng() < pCrit;
  let dano = calcularDano(ataqueEfectivo(c, de), defensaEfectiva(c, a), rng) * (opts.mult ?? 1) * (critico ? MULT_CRITICO : 1);
  let bloqueado = false;
  if (ob.defendiendo) {
    dano *= opts.bloqueable && a === "jugador" ? MULT_BLOQUEO : MULT_DEFENDER;
    bloqueado = true;
  }
  dano = Math.max(1, Math.round(dano));
  const bruto = dano;
  let absorbido = 0;
  const esc = ob.estados.find((e) => e.tipo === "escudo" && e.valor > 0);
  if (esc) {
    absorbido = Math.min(esc.valor, dano);
    esc.valor -= absorbido;
    dano -= absorbido;
    if (esc.valor <= 0) ob.estados = ob.estados.filter((e) => e !== esc);
  }
  ob.vida = Math.max(0, ob.vida - dano);
  if (de === "jugador") { c.resumen.danoHecho += dano; if (critico) c.resumen.criticos += 1; }
  else c.resumen.danoRecibido += dano;
  return { dano, bruto, critico, bloqueado, absorbido, esquivado: false };
}

function textoGolpe(c, de, nombreAccion, r) {
  const yo = de === "jugador";
  const obj = yo ? c.enemigo.nombre : "te";
  if (r.esquivado) return yo ? `${c.enemigo.nombre} esquiva tu ${nombreAccion.toLowerCase()} 💨` : `¡Esquivas ${nombreAccion === "Ataque" ? "el ataque" : `«${nombreAccion}»`} de ${c.enemigo.nombre}! 💨`;
  const extra = [
    r.critico ? "¡CRÍTICO! " : "",
  ].join("");
  const cola = [
    r.bloqueado ? (yo ? " (se protege)" : " (tu guardia amortigua el golpe)") : "",
    r.absorbido ? ` (${r.absorbido} absorbido por el escudo)` : "",
  ].join("");
  if (yo) return nombreAccion === "Ataque"
    ? `${extra}Golpeas a ${obj}: ${r.dano} de daño${cola}.`
    : `${extra}«${nombreAccion}» golpea a ${obj}: ${r.dano} de daño${cola}.`;
  return nombreAccion === "Ataque"
    ? `${extra}${c.enemigo.nombre} te ataca: ${r.dano} de daño${cola}.`
    : `${extra}${c.enemigo.nombre} usa «${nombreAccion}»: ${r.dano} de daño${cola}.`;
}

function comprobarFase({ c, emit }) {
  const e = c.enemigo;
  if (!e.jefe || e.fase !== 1 || e.vida <= 0 || e.vida > e.vidaMax * JEFE.umbralFase2) return;
  e.fase = 2;
  e.ataque = Math.round(e.ataque * JEFE.furiaFase2);
  e.estados = e.estados.filter((x) => !NEGATIVOS.has(x.tipo));
  e.turnosDefinitiva = Math.max(e.turnosDefinitiva, JEFE.cadaFase2 - 1);
  emit({ actor: "enemigo", tipo: "fase", fase: 2, texto: `🔥 ¡${e.nombre} entra en cólera! (fase 2: más ataque y se sacude los estados)` });
}

/** Tras un golpe del héroe: reflejo no aplica; contraataque del gólem si defendía. */
function trasGolpeJugador(ctx, r) {
  const { c, emit } = ctx;
  comprobarFase(ctx);
  if (r.esquivado || c.enemigo.vida <= 0 || !c.enemigo.defendiendo || !c.enemigo.contraataque) return;
  const rc = golpear(ctx, "enemigo", { mult: c.enemigo.contraataque });
  emit({ actor: "enemigo", objetivo: "jugador", tipo: "contraataque", ...resultado(rc),
    texto: rc.esquivado ? `Esquivas el contraataque de ${c.enemigo.nombre} 💨` : `${c.enemigo.nombre} contraataca: ${rc.dano} de daño.` });
  trasGolpeEnemigo(ctx, rc);
}

/** Tras un golpe del enemigo: reflejo del héroe. */
function trasGolpeEnemigo(ctx, r) {
  const { c, emit } = ctx;
  if (r.esquivado || c.jugador.vida <= 0) return;
  const refl = c.jugador.estados.find((e) => e.tipo === "reflejo");
  if (!refl) return;
  const dano = Math.min(c.enemigo.vida, Math.max(1, Math.round(r.bruto * refl.valor)));
  c.enemigo.vida -= dano;
  c.resumen.danoHecho += dano;
  emit({ actor: "jugador", objetivo: "enemigo", tipo: "reflejo", dano, texto: `✨ Tu Muro de Fe devuelve ${dano} de daño a ${c.enemigo.nombre}.` });
  comprobarFase(ctx);
}

const resultado = (r) => ({ dano: r.dano, critico: r.critico, bloqueado: r.bloqueado, esquivado: r.esquivado, absorbido: r.absorbido });

function accionJugador(ctx, accion) {
  const { c, emit } = ctx;
  const j = c.jugador;
  if (accion === "atacar") {
    const r = golpear(ctx, "jugador", { mult: 1 });
    emit({ actor: "jugador", objetivo: "enemigo", tipo: "ataque", id: "atacar", nombre: "Ataque", ...resultado(r), texto: textoGolpe(c, "jugador", "Ataque", r) });
    trasGolpeJugador(ctx, r);
    return;
  }
  if (accion === "defender") {
    j.defendiendo = true;
    emit({ actor: "jugador", tipo: "defensa", id: "defender", nombre: "Defender", texto: "Alzas la guardia: recibirás la mitad de daño (y bloquearás hechizos)." });
    return;
  }
  if (accion === "pocion") {
    gastarPocion(c);
    const cura = Math.min(j.vidaMax - j.vida, Math.round(j.vidaMax * CURA_POCION));
    j.vida += cura;
    c.resumen.pocionesUsadas += 1;
    emit({ actor: "jugador", objetivo: "jugador", tipo: "pocion", curacion: cura, pociones: j.pociones,
      texto: `🧪 Bebes una poción y recuperas ${cura} de vida (te quedan ${j.pociones}).` });
    return;
  }
  // Habilidad
  const d = HABILIDADES[accion.habilidad];
  j.habilidades = usarHabilidad(j.habilidades, d.id);
  c.resumen.habilidadesUsadas += 1;
  const base = { actor: "jugador", tipo: "habilidad", id: d.id, nombre: d.nombre, icono: d.icono };
  let emitido = false;
  if (d.limpia) {
    const antes = j.estados.length;
    j.estados = j.estados.filter((e) => !NEGATIVOS.has(e.tipo));
    if (antes !== j.estados.length) {
      emit({ ...base, objetivo: "jugador", limpia: true, texto: `${d.icono} ${d.nombre}: te libras de los estados negativos.` });
      emitido = true;
    }
  }
  if (d.curaPct) {
    const cura = Math.min(j.vidaMax - j.vida, Math.round(j.vidaMax * d.curaPct));
    j.vida += cura;
    emit({ ...base, objetivo: "jugador", curacion: cura, texto: `${d.icono} ${d.nombre}: recuperas ${cura} de vida.` });
    emitido = true;
  }
  for (const est of d.estadosPropios ?? []) {
    const aplicado = aplicarEstado(c, "jugador", est, j.ataque);
    emit({ ...base, tipo: emitido ? "estado" : "habilidad", objetivo: "jugador", estado: aplicado,
      texto: `${d.icono} ${d.nombre}: ${textoEstadoPropio(aplicado)}` });
    emitido = true;
  }
  if (d.mult != null) {
    const r = golpear(ctx, "jugador", { mult: d.mult, imparable: d.imparable, siempreCritico: d.siempreCritico, criticoExtra: d.criticoExtra });
    const ev = { ...base, objetivo: "enemigo", ...resultado(r), brutal: d.mult >= 1.8, texto: `${d.icono} ${textoGolpe(c, "jugador", d.nombre, r)}` };
    if (!r.esquivado && d.estadoEnemigo && c.enemigo.vida > 0) {
      ev.estado = aplicarEstado(c, "enemigo", d.estadoEnemigo, ataqueEfectivo(c, "jugador"));
      ev.texto += ` ${c.enemigo.nombre} queda con ${NOMBRE_ESTADO[ev.estado.tipo]} (${ev.estado.turnos} t).`;
    }
    emit(ev);
    trasGolpeJugador(ctx, r);
  } else if (!emitido) {
    emit({ ...base, texto: `${d.icono} Usas ${d.nombre}.` });
  }
}

function textoEstadoPropio(e) {
  switch (e.tipo) {
    case "furia": return `tu ataque sube un ${Math.round(e.valor * 100)} % durante ${e.turnos} turnos.`;
    case "escudo": return `un escudo de ${e.valor} te protege.`;
    case "reflejo": return `reflejas el ${Math.round(e.valor * 100)} % del daño durante ${e.turnos} turnos.`;
    case "evasion": return "esquivarás el próximo ataque.";
    default: return `${NOMBRE_ESTADO[e.tipo] ?? e.tipo} (${e.turnos} t).`;
  }
}

/** Texto de un estado que el enemigo se aplica a sí mismo. */
function textoEstadoEnemigo(e) {
  switch (e.tipo) {
    case "escudo": return `se cubre con un escudo de ${e.valor} durante ${e.turnos} turnos.`;
    case "furia": return `su ataque sube un ${Math.round(e.valor * 100)} % durante ${e.turnos} turnos.`;
    default: return `gana ${NOMBRE_ESTADO[e.tipo] ?? e.tipo} (${e.turnos} t).`;
  }
}

function accionEnemigo(ctx) {
  const { c, emit } = ctx;
  const e = c.enemigo;
  const it = e.intencion ?? { id: "ataque" };
  const m = MOVIMIENTOS[it.id] ?? MOVIMIENTOS.ataque;
  const nombreMov = m.definitiva ? (e.definitiva ?? "Definitiva") : m.nombre;
  e.defendioUltimo = false;

  if (m.libera) {
    e.cargando = m.libera;
    emit({ actor: "enemigo", tipo: "carga", id: it.id, nombre: nombreMov, libera: m.libera, definitiva: !!m.definitiva, telegrafiado: true,
      texto: m.definitiva
        ? `☄️ ${e.nombre} reúne todo su poder para «${nombreMov}»… ¡DEFIÉNDETE!`
        : `${m.icono} ${e.nombre} usa «${m.nombre}»… ¡prepárate para «${MOVIMIENTOS[m.libera].nombre}»!` });
    if (e.jefe && !m.definitiva) e.turnosDefinitiva += 1;
    return;
  }
  if (e.cargando === it.id) e.cargando = null;

  if (m.tipo === "defender") {
    e.defendiendo = true;
    e.defendioUltimo = true;
    e.contraataque = m.contraataque ?? 0;
    emit({ actor: "enemigo", tipo: "defensa", id: it.id, nombre: m.nombre,
      texto: `${m.icono} ${e.nombre} adopta su ${m.nombre.toLowerCase()}: recibirá la mitad de daño${m.contraataque ? " y contraatacará" : ""}.` });
    if (e.jefe) e.turnosDefinitiva += 1;
    return;
  }
  e.contraataque = 0;

  // Estados que el enemigo se aplica a sí mismo (barrera de hueso, costra ácida, reavivarse…).
  for (const est of m.estadosPropios ?? []) {
    const aplicado = aplicarEstado(c, "enemigo", est, ataqueEfectivo(c, "enemigo"));
    emit({ actor: "enemigo", objetivo: "enemigo", tipo: "estado", id: it.id, nombre: m.nombre, estado: aplicado,
      texto: `${m.icono} ${e.nombre} usa «${m.nombre}»: ${textoEstadoEnemigo(aplicado)}` });
  }
  // Un movimiento sin `mult` no golpea: se queda en sus estados propios.
  if (m.mult == null) {
    if (e.jefe) e.turnosDefinitiva += 1;
    return;
  }

  const golpes = m.golpes ?? 1;
  for (let g = 0; g < golpes && c.jugador.vida > 0; g++) {
    const r = golpear(ctx, "enemigo", { mult: m.mult ?? 1, bloqueable: m.bloqueable, imparable: m.imparable });
    const ev = {
      actor: "enemigo", objetivo: "jugador", tipo: it.id === "ataque" ? "ataque" : "habilidad", id: it.id, nombre: nombreMov,
      ...resultado(r), brutal: !!m.brutal, definitiva: !!m.definitiva,
      texto: (m.definitiva ? "☄️ " : "") + textoGolpe(c, "enemigo", nombreMov, r) + (golpes > 1 ? ` (${g + 1}/${golpes})` : ""),
    };
    if (!r.esquivado) {
      if (m.estado && c.jugador.vida > 0) {
        ev.estado = aplicarEstado(c, "jugador", m.estado, ataqueEfectivo(c, "enemigo"));
        ev.texto += ` Sufres ${NOMBRE_ESTADO[ev.estado.tipo]} (${ev.estado.turnos} t).`;
      }
      if (m.drena && r.dano > 0) {
        const cura = Math.min(e.vidaMax - e.vida, Math.round(r.dano * m.drena));
        e.vida += cura;
        ev.curacion = cura;
        if (cura) ev.texto += ` Recupera ${cura} de vida.`;
      }
    }
    emit(ev);
    if (!r.esquivado && m.robaPocion && c.jugador.pociones > 0) {
      gastarPocion(c);
      emit({ actor: "enemigo", objetivo: "jugador", tipo: "robo", pociones: c.jugador.pociones,
        texto: `🫳 ¡${e.nombre} te roba una poción! (te quedan ${c.jugador.pociones})` });
    }
    trasGolpeEnemigo(ctx, r);
  }
  if (m.definitiva) e.turnosDefinitiva = 0;
  else if (e.jefe) e.turnosDefinitiva += 1;
}

/** Calcula la intención del próximo turno del enemigo (consume 1 valor de rng salvo si está forzada). */
function decidirIntencion(c, rng) {
  const e = c.enemigo;
  const nombreMov = (id) => (MOVIMIENTOS[id].definitiva ? (e.definitiva ?? "Definitiva") : MOVIMIENTOS[id].nombre);
  const crear = (id, telegrafiado = false) => {
    const m = MOVIMIENTOS[id];
    const nombre = nombreMov(id);
    let texto;
    if (m.definitiva && m.libera) texto = `Prepara su definitiva «${nombre}»`;
    else if (m.definitiva) texto = `¡Va a lanzar «${nombre}»! Defiéndete o caerás`;
    else if (telegrafiado) texto = `¡Va a lanzar «${nombre}»!${m.bloqueable ? " Defiéndete para bloquearlo" : " Defiéndete"}`;
    else if (m.tipo === "atacar") texto = "Va a atacar";
    else if (m.tipo === "defender") texto = `Se va a proteger${m.contraataque ? " y contraatacar" : ""}`;
    else if (m.tipo === "cargar") texto = `Se dispone a ${m.nombre.toLowerCase()}`;
    else texto = `Va a usar «${nombre}»`;
    return { tipo: m.tipo, id, nombre, icono: m.icono, texto, telegrafiado: telegrafiado || !!m.definitiva,
      bloqueable: !!m.bloqueable, definitiva: !!m.definitiva };
  };
  if (e.cargando && MOVIMIENTOS[e.cargando]) return crear(e.cargando, true);
  if (e.jefe && e.turnosDefinitiva >= (e.fase === 2 ? JEFE.cadaFase2 : JEFE.cadaFase1)) return crear("definitiva_carga", true);
  const cr = criaturaDe(e.clave);
  const patron = cr ? cr.patron : PATRON_GENERICO;
  const r = rng();
  let acum = 0;
  for (const p of patron) {
    if (p.cond && !p.cond(c)) continue;
    acum += p.prob;
    if (r < acum) return crear(p.mov);
  }
  return crear("ataque");
}
