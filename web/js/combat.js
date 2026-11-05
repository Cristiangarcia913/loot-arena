// Lógica de combate pura (sin DOM ni red). Todas las funciones aceptan un `rng`
// inyectable (() => número en [0,1)) para poder testearlas de forma determinista.
// Las funciones no mutan sus argumentos: devuelven estados nuevos.

export const STATS_BASE = Object.freeze({ vida: 100, ataque: 10, defensa: 5 });
export const NIVEL_MIN = 1;
export const NIVEL_MAX = 10;
/** Variación aleatoria del daño: ±VARIACION_DANO. */
export const VARIACION_DANO = 2;
/** Probabilidad de que el enemigo prepare un golpe brutal en lugar de atacar. */
export const PROB_CARGA = 0.2;
/** Multiplicador del golpe brutal. */
export const MULT_GOLPE_BRUTAL = 1.75;
/** Victorias necesarias para subir un nivel de arena. */
export const VICTORIAS_POR_NIVEL = 3;

/** Bestiario ordenado de menor a mayor peligro. */
export const BESTIARIO = Object.freeze([
  { nombre: "Rata gigante", emoji: "🐀" },
  { nombre: "Lobo sombrío", emoji: "🐺" },
  { nombre: "Goblin saqueador", emoji: "👺" },
  { nombre: "Esqueleto errante", emoji: "💀" },
  { nombre: "Araña venenosa", emoji: "🕷️" },
  { nombre: "Orco berserker", emoji: "👹" },
  { nombre: "Espectro de la cripta", emoji: "👻" },
  { nombre: "Gólem de piedra", emoji: "🗿" },
  { nombre: "Hechicero oscuro", emoji: "🧙" },
  { nombre: "Dragón ancestral", emoji: "🐉" },
]);

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

/** Nivel de arena según victorias acumuladas (1..10). */
export function nivelArena(victorias) {
  return clampNivel(1 + Math.floor(Math.max(0, Number(victorias) || 0) / VICTORIAS_POR_NIVEL));
}

/** Nivel del próximo enemigo: nivel de arena ±1, acotado a 1..10. */
export function nivelEnemigo(nivelDeArena, rng = Math.random) {
  return clampNivel(clampNivel(nivelDeArena) + randInt(-1, 1, rng));
}

/** Estadísticas escaladas de un enemigo de nivel n. */
export function statsEnemigo(nivel) {
  const n = clampNivel(nivel);
  return { vidaMax: 30 + 10 * n, ataque: 7 + 2 * n, defensa: 1 + n };
}

/** Genera un enemigo del nivel dado, eligiendo criatura acorde al nivel. */
export function generarEnemigo(nivel, rng = Math.random) {
  const n = clampNivel(nivel);
  const centro = Math.round(((n - 1) * (BESTIARIO.length - 1)) / (NIVEL_MAX - 1));
  const lo = Math.max(0, centro - 1);
  const hi = Math.min(BESTIARIO.length - 1, centro + 1);
  const criatura = BESTIARIO[randInt(lo, hi, rng)];
  return { ...criatura, nivel: n, ...statsEnemigo(n) };
}

/**
 * Daño = max(1, ataque − defensa) ± aleatorio pequeño, nunca menor que 1.
 * @param {number} ataque
 * @param {number} defensa defensa efectiva (ya doblada si el objetivo defiende)
 */
export function calcularDano(ataque, defensa, rng = Math.random) {
  const base = Math.max(1, ataque - defensa);
  return Math.max(1, base + randInt(-VARIACION_DANO, VARIACION_DANO, rng));
}

/** Defensa efectiva: Defender dobla la defensa ese turno. */
export function defensaEfectiva(defensa, defendiendo) {
  return defendiendo ? defensa * 2 : defensa;
}

/**
 * Crea un combate nuevo.
 * @param {{vida:number, ataque:number, defensa:number}} statsJugador
 * @param {ReturnType<typeof generarEnemigo>} enemigo
 */
export function crearCombate(statsJugador, enemigo) {
  return {
    turno: 1,
    fase: "en_curso", // "en_curso" | "victoria" | "derrota" | "huida"
    jugador: {
      vidaMax: statsJugador.vida,
      vida: statsJugador.vida,
      ataque: statsJugador.ataque,
      defensa: statsJugador.defensa,
    },
    enemigo: { ...enemigo, vida: enemigo.vidaMax, cargando: false },
    log: [{ actor: "sistema", tipo: "inicio", texto: `¡Un ${enemigo.nombre} (nivel ${enemigo.nivel}) salta a la arena!` }],
  };
}

/**
 * Resuelve un turno: primero actúa el jugador ("atacar" | "defender"), luego el enemigo si sigue vivo.
 * @returns {{combate: object, eventos: Array<{actor:string, tipo:string, dano?:number, texto:string}>}}
 */
export function turnoJugador(combate, accion, rng = Math.random) {
  if (combate.fase !== "en_curso") throw new Error("El combate ya ha terminado");
  if (accion !== "atacar" && accion !== "defender") throw new Error(`Acción desconocida: ${accion}`);

  const jugador = { ...combate.jugador };
  const enemigo = { ...combate.enemigo };
  const eventos = [];
  let fase = "en_curso";
  const defendiendo = accion === "defender";

  // Turno del jugador
  if (accion === "atacar") {
    const dano = calcularDano(jugador.ataque, enemigo.defensa, rng);
    enemigo.vida = Math.max(0, enemigo.vida - dano);
    eventos.push({ actor: "jugador", tipo: "ataque", dano, texto: `Golpeas a ${enemigo.nombre}: ${dano} de daño.` });
    if (enemigo.vida === 0) {
      fase = "victoria";
      eventos.push({ actor: "sistema", tipo: "victoria", texto: `¡${enemigo.nombre} ha sido derrotado! 🏆` });
    }
  } else {
    eventos.push({ actor: "jugador", tipo: "defensa", texto: "Alzas la guardia: tu defensa se dobla este turno." });
  }

  // Turno del enemigo
  if (fase === "en_curso") {
    const def = defensaEfectiva(jugador.defensa, defendiendo);
    if (enemigo.cargando) {
      const atk = Math.round(enemigo.ataque * MULT_GOLPE_BRUTAL);
      const dano = calcularDano(atk, def, rng);
      enemigo.cargando = false;
      jugador.vida = Math.max(0, jugador.vida - dano);
      eventos.push({
        actor: "enemigo", tipo: "golpe_brutal", dano,
        texto: `${enemigo.nombre} descarga un golpe brutal: ${dano} de daño${defendiendo ? " (tu guardia amortigua el impacto)" : ""}.`,
      });
    } else if (rng() < PROB_CARGA) {
      enemigo.cargando = true;
      eventos.push({ actor: "enemigo", tipo: "carga", texto: `${enemigo.nombre} se prepara para un golpe brutal… ¡defiéndete!` });
    } else {
      const dano = calcularDano(enemigo.ataque, def, rng);
      jugador.vida = Math.max(0, jugador.vida - dano);
      eventos.push({ actor: "enemigo", tipo: "ataque", dano, texto: `${enemigo.nombre} te ataca: ${dano} de daño.` });
    }
    if (jugador.vida === 0) {
      fase = "derrota";
      eventos.push({ actor: "sistema", tipo: "derrota", texto: "Has caído en la arena… ☠️" });
    }
  }

  return {
    combate: { ...combate, turno: combate.turno + 1, fase, jugador, enemigo, log: [...combate.log, ...eventos] },
    eventos,
  };
}

/** Abandona el combate. */
export function huir(combate) {
  if (combate.fase !== "en_curso") return combate;
  const ev = { actor: "sistema", tipo: "huida", texto: "Huyes de la arena con el rabo entre las piernas." };
  return { ...combate, fase: "huida", log: [...combate.log, ev] };
}
