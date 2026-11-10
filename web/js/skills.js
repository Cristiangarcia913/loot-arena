// Habilidades del héroe: datos declarativos puros (sin DOM, sin dependencias).
// `combat.js` interpreta los campos de efecto; este módulo solo decide qué habilidades
// tiene el héroe y en qué estado de enfriamiento están.

/**
 * @typedef {Object} DefHabilidad
 * @property {string} id
 * @property {string} nombre
 * @property {string} icono
 * @property {number} enfriamiento  turnos de espera tras usarla (0 = siempre disponible)
 * @property {string} descripcion
 * @property {boolean} [especial]   desbloqueada por un Legendario
 * @property {string} [tipoObjeto]  tipo de objeto Legendario que la desbloquea
 * @property {number} [nivelHeroe]  nivel de héroe que la desbloquea (ver NIVEL_HABILIDAD)
 * @property {string} [animacion3d] animación para el motor 3D (valor de combat.VALORES_3D.ataque)
 * // Campos de efecto (los interpreta combat.js):
 * @property {number} [mult]            multiplicador de daño (si falta, no golpea)
 * @property {boolean} [imparable]      no se puede esquivar
 * @property {boolean} [siempreCritico] crítico garantizado
 * @property {number} [criticoExtra]    suma a la probabilidad de crítico
 * @property {{tipo:string, turnos:number, pct?:number, valor?:number}} [estadoEnemigo] estado que aplica al enemigo
 * @property {Array<{tipo:string, turnos:number, pct?:number, valor?:number}>} [estadosPropios] estados que se aplica el héroe
 * @property {number} [curaPct]         cura este % de la vida máxima
 * @property {boolean} [limpia]         elimina veneno, sangrado y aturdido del héroe
 */

/** Habilidades del héroe: 3 básicas, 3 que se desbloquean por nivel y 5 especiales de Legendario. */
export const HABILIDADES = Object.freeze({
  golpe_poderoso: Object.freeze({
    id: "golpe_poderoso", nombre: "Golpe Poderoso", icono: "💥", enfriamiento: 3,
    descripcion: "Un golpe devastador: ×1,8 de daño.",
    mult: 1.8, animacion3d: "arma",
  }),
  desangrar: Object.freeze({
    id: "desangrar", nombre: "Desangrar", icono: "🩸", enfriamiento: 3,
    descripcion: "Tajo ×0,8 que provoca sangrado 3 turnos.",
    mult: 0.8, estadoEnemigo: Object.freeze({ tipo: "sangrado", turnos: 3, pct: 0.3 }), animacion3d: "arma",
  }),
  grito_guerra: Object.freeze({
    id: "grito_guerra", nombre: "Grito de guerra", icono: "📯", enfriamiento: 4,
    descripcion: "+40 % de ataque durante 2 turnos (no ataca este turno).",
    estadosPropios: Object.freeze([Object.freeze({ tipo: "furia", turnos: 2, valor: 0.4 })]), animacion3d: "apoyo",
  }),
  // ── Por nivel de héroe (ver NIVEL_HABILIDAD) ──
  estocada_precisa: Object.freeze({
    id: "estocada_precisa", nombre: "Estocada Precisa", icono: "🗡️", enfriamiento: 3, nivelHeroe: 5,
    descripcion: "Golpe ×1,2 imposible de esquivar, +15 % de crítico. Nivel 5.",
    mult: 1.2, imparable: true, criticoExtra: 0.15, animacion3d: "arma",
  }),
  segundo_aliento: Object.freeze({
    id: "segundo_aliento", nombre: "Segundo Aliento", icono: "💚", enfriamiento: 5, nivelHeroe: 10,
    descripcion: "Recuperas el 26 % de tu vida y te libras de veneno, sangrado y aturdimiento. Nivel 10.",
    curaPct: 0.26, limpia: true, animacion3d: "apoyo",
  }),
  rompearmaduras: Object.freeze({
    id: "rompearmaduras", nombre: "Rompearmaduras", icono: "🔨", enfriamiento: 4, nivelHeroe: 15,
    descripcion: "Mazazo ×1,4 que rompe la armadura del enemigo: −35 % de defensa durante 3 turnos. Nivel 15.",
    mult: 1.4, estadoEnemigo: Object.freeze({ tipo: "fragil", turnos: 3, valor: 0.35 }), animacion3d: "embestida",
  }),
  // ── Especiales (una por tipo de objeto Legendario) ──
  tajo_celestial: Object.freeze({
    id: "tajo_celestial", nombre: "Tajo Celestial", icono: "✨", enfriamiento: 5, especial: true, tipoObjeto: "Espada",
    descripcion: "Golpe sagrado ×2,5 imposible de esquivar, +25 % de crítico.",
    mult: 2.5, imparable: true, criticoExtra: 0.25, animacion3d: "arma",
  }),
  muro_de_fe: Object.freeze({
    id: "muro_de_fe", nombre: "Muro de Fe", icono: "🛡️", enfriamiento: 5, especial: true, tipoObjeto: "Escudo",
    descripcion: "Escudo del 30 % de tu vida y refleja el 50 % del daño 2 turnos.",
    estadosPropios: Object.freeze([
      Object.freeze({ tipo: "escudo", turnos: 2, pct: 0.3 }),
      Object.freeze({ tipo: "reflejo", turnos: 2, valor: 0.5 }),
    ]), animacion3d: "guardia",
  }),
  mente_ferrea: Object.freeze({
    id: "mente_ferrea", nombre: "Mente Férrea", icono: "🧠", enfriamiento: 5, especial: true, tipoObjeto: "Casco",
    descripcion: "Te libra de veneno, sangrado y aturdimiento y aturde al enemigo con un golpe ×1.",
    mult: 1, limpia: true, estadoEnemigo: Object.freeze({ tipo: "aturdido", turnos: 1 }), animacion3d: "conjuro",
  }),
  piel_de_dragon: Object.freeze({
    id: "piel_de_dragon", nombre: "Piel de Dragón", icono: "🐲", enfriamiento: 5, especial: true, tipoObjeto: "Armadura",
    descripcion: "Cura el 25 % de tu vida y te cubre con un escudo del 20 % durante 2 turnos.",
    curaPct: 0.25, estadosPropios: Object.freeze([Object.freeze({ tipo: "escudo", turnos: 2, pct: 0.2 })]), animacion3d: "apoyo",
  }),
  paso_sombrio: Object.freeze({
    id: "paso_sombrio", nombre: "Paso Sombrío", icono: "👣", enfriamiento: 4, especial: true, tipoObjeto: "Botas",
    descripcion: "Crítico garantizado ×1,5 y esquivas el próximo ataque enemigo.",
    mult: 1.5, siempreCritico: true, estadosPropios: Object.freeze([Object.freeze({ tipo: "evasion", turnos: 1 })]), animacion3d: "garra",
  }),
});

/** Ids de las habilidades básicas, en el orden en que se muestran. */
export const HABILIDADES_BASE = Object.freeze(["golpe_poderoso", "desangrar", "grito_guerra"]);

/**
 * Habilidades que se desbloquean al subir de nivel de héroe, en orden de nivel.
 * Son la recompensa de progresar sin equipo NFT: el héroe gana herramientas, no solo números.
 */
export const HABILIDADES_POR_NIVEL = Object.freeze(["estocada_precisa", "segundo_aliento", "rompearmaduras"]);

/** id de habilidad → nivel de héroe que la desbloquea. */
export const NIVEL_HABILIDAD = Object.freeze(Object.fromEntries(
  HABILIDADES_POR_NIVEL.map((id) => [id, HABILIDADES[id].nivelHeroe]),
));

/**
 * Ids de las habilidades por nivel ya desbloqueadas con `nivel`.
 * @param {number} [nivel] nivel de héroe (1 por defecto: solo las básicas)
 */
export function habilidadesDeNivel(nivel = 1) {
  const n = Math.max(1, Math.floor(Number(nivel) || 1));
  return HABILIDADES_POR_NIVEL.filter((id) => n >= NIVEL_HABILIDAD[id]);
}

/** La próxima habilidad por nivel que falta (o null si ya están todas): `{id, nombre, icono, nivel}`. */
export function proximaHabilidad(nivel = 1) {
  const n = Math.max(1, Math.floor(Number(nivel) || 1));
  const id = HABILIDADES_POR_NIVEL.find((x) => n < NIVEL_HABILIDAD[x]);
  if (!id) return null;
  const d = HABILIDADES[id];
  return { id, nombre: d.nombre, icono: d.icono, nivel: d.nivelHeroe };
}

/** Tipo de objeto Legendario → id de su habilidad especial. */
export const ESPECIAL_POR_TIPO = Object.freeze({
  Espada: "tajo_celestial", Escudo: "muro_de_fe", Casco: "mente_ferrea", Armadura: "piel_de_dragon", Botas: "paso_sombrio",
});

/** Rareza Legendaria en el contrato. */
export const RAREZA_LEGENDARIA = 2;

/** Devuelve la definición de una habilidad o `undefined`. */
export function habilidad(id) {
  return Object.hasOwn(HABILIDADES, id) ? HABILIDADES[id] : undefined;
}

/**
 * Habilidad especial que desbloquea el equipo: la del Legendario equipado con más poder
 * (ataque+defensa; desempate por orden de tipo Espada, Escudo, Casco, Armadura, Botas).
 * @param {Array<{tipo:string, rareza:number, ataque:number, defensa:number}>} equipados
 * @returns {string|null} id de la habilidad o null si no hay Legendario.
 */
export function habilidadEspecial(equipados = []) {
  const orden = Object.keys(ESPECIAL_POR_TIPO);
  const legendarios = (equipados ?? [])
    .filter((it) => Number(it?.rareza) === RAREZA_LEGENDARIA && Object.hasOwn(ESPECIAL_POR_TIPO, it.tipo))
    .sort((a, b) => (Number(b.ataque) + Number(b.defensa)) - (Number(a.ataque) + Number(a.defensa)) ||
      orden.indexOf(a.tipo) - orden.indexOf(b.tipo));
  return legendarios.length ? ESPECIAL_POR_TIPO[legendarios[0].tipo] : null;
}

/**
 * Ids de las habilidades del héroe: las 3 básicas + las desbloqueadas por nivel + (opcional) la especial.
 * @param {Array<object>} equipados objetos equipados
 * @param {number} [nivel] nivel de héroe (1 por defecto: solo las básicas)
 * @returns {string[]}
 */
export function idsHabilidades(equipados = [], nivel = 1) {
  const esp = habilidadEspecial(equipados);
  const ids = [...HABILIDADES_BASE, ...habilidadesDeNivel(nivel)];
  return esp ? [...ids, esp] : ids;
}

/**
 * Estado de las habilidades para pintar los botones.
 * `heroe` puede ser el jugador de un combate en curso (`combate.jugador`, con
 * `habilidades: [{id, restante}]`) o cualquier objeto sin ese campo (todas listas).
 * Si el héroe ya trae habilidades (combate en curso), se respetan esas; si no, se
 * calculan a partir de `equipados`.
 * @param {{habilidades?: Array<string|{id:string, restante?:number}>}} heroe
 * @param {Array<object>} [equipados]
 * @returns {Array<{id:string, nombre:string, icono:string, enfriamiento:number, restante:number, lista:boolean, especial:boolean, descripcion:string}>}
 */
export function habilidadesDisponibles(heroe, equipados = []) {
  const propias = Array.isArray(heroe?.habilidades) && heroe.habilidades.length
    ? heroe.habilidades.map((h) => (typeof h === "string" ? { id: h, restante: 0 } : h))
    : idsHabilidades(equipados, heroe?.nivel ?? 1).map((id) => ({ id, restante: 0 }));
  return propias
    .filter((h) => habilidad(h.id))
    .map(({ id, restante = 0 }) => {
      const d = HABILIDADES[id];
      const r = Math.max(0, Number(restante) || 0);
      return {
        id, nombre: d.nombre, icono: d.icono, enfriamiento: d.enfriamiento,
        restante: r, lista: r === 0, especial: !!d.especial, descripcion: d.descripcion,
      };
    });
}

/**
 * Estado inicial de enfriamientos para un combate.
 * @param {Array<string|{id:string}>} [ids]
 * @returns {Array<{id:string, restante:number}>}
 */
export function iniciarHabilidades(ids = HABILIDADES_BASE) {
  return ids
    .map((h) => (typeof h === "string" ? h : h?.id))
    .filter((id) => habilidad(id))
    .map((id) => ({ id, restante: 0 }));
}

/**
 * Marca una habilidad como usada (enfriamiento completo). No muta.
 * @param {Array<{id:string, restante:number}>} habs
 * @param {string} id
 */
export function usarHabilidad(habs, id) {
  return habs.map((h) => (h.id === id ? { ...h, restante: HABILIDADES[id].enfriamiento } : h));
}

/** Resta un turno a todos los enfriamientos (mínimo 0). No muta. */
export function avanzarEnfriamientos(habs) {
  return habs.map((h) => ({ ...h, restante: Math.max(0, h.restante - 1) }));
}
