// Lógica de drops de Loot Arena 1.1 ("botín épico").
//
// Todas las funciones exportadas son PURAS y reciben un RNG inyectable
// `rng: () => number` en [0, 1) para poder testear de forma determinista.
// El único estado (pity por dirección y último nombre legendario) vive en
// `EstadoBotin`, que es una clase aparte y en memoria (Render reinicia a veces,
// y está bien que se pierda).
//
// El contrato NO cambia: un objeto sigue siendo
// { nombre: string, tipo: Espada|Escudo|Casco|Armadura|Botas, rareza: 0..2, ataque: uint16, defensa: uint16 }.

export const RAREZA = Object.freeze({ COMUN: 0, RARO: 1, LEGENDARIO: 2 });

export const NIVEL_MIN = 1;
export const NIVEL_MAX = 10;
export const MAX_LONGITUD_NOMBRE = 60;

/** Rango ABSOLUTO de la stat principal por rareza (ambos extremos incluidos). */
export const RANGO_STAT = Object.freeze({
  0: Object.freeze([1, 6]),
  1: Object.freeze([6, 14]),
  2: Object.freeze([14, 30]),
});

/**
 * Fracción del rango que "se desplaza" con el nivel. Con 0.4, en nivel 1 la stat
 * sale en el 60 % inferior del rango y en nivel 10 en el 60 % superior.
 */
export const DESPLAZAMIENTO_NIVEL = 0.4;
/** Un jefe cuenta como este número de niveles más para las stats. */
export const BONO_NIVEL_JEFE = 2;

/** La stat secundaria es entre el 10 % y el 40 % de la principal (redondeado). */
export const SECUNDARIA_MIN = 0.10;
export const SECUNDARIA_MAX = 0.40;

/** Pity: tras este número de drops seguidos sin Legendario, el siguiente sube mucho. */
export const PITY_UMBRAL = 15;
/** Probabilidad mínima de Legendario en el primer drop con pity... */
export const PITY_BASE = 0.5;
/** ...y cuánto sube por cada drop extra sin Legendario (al 6.º ya es seguro). */
export const PITY_PASO = 0.1;

/** Tipos válidos (los del contrato) y su stat principal. */
export const TIPOS = Object.freeze({
  Espada:   { principal: 'ataque'  },
  Escudo:   { principal: 'defensa' },
  Casco:    { principal: 'defensa' },
  Armadura: { principal: 'defensa' },
  Botas:    { principal: 'defensa' },
});
export const LISTA_TIPOS = Object.freeze(Object.keys(TIPOS));

// ─── Vocabulario ──────────────────────────────────────────────────────────────
// Género: m = masc. sing., f = fem. sing., mp = masc. plural, fp = fem. plural.

const b = (nombre, genero) => Object.freeze({ nombre, genero });

/** Bases por tipo (≥ 15 cada uno), con su género para concordar adjetivos. */
export const BASES = Object.freeze({
  Espada: Object.freeze([
    b('Espada', 'f'), b('Mandoble', 'm'), b('Sable', 'm'), b('Cimitarra', 'f'),
    b('Estoque', 'm'), b('Alfanje', 'm'), b('Gladio', 'm'), b('Montante', 'm'),
    b('Florete', 'm'), b('Katana', 'f'), b('Espadón', 'm'), b('Bracamarte', 'm'),
    b('Falcata', 'f'), b('Claymore', 'f'), b('Hoja', 'f'), b('Espada Ropera', 'f'),
  ]),
  Escudo: Object.freeze([
    b('Escudo', 'm'), b('Broquel', 'm'), b('Rodela', 'f'), b('Pavés', 'm'),
    b('Adarga', 'f'), b('Tarja', 'f'), b('Clípeo', 'm'), b('Hoplón', 'm'),
    b('Baluarte', 'm'), b('Égida', 'f'), b('Bastión', 'm'), b('Parma', 'f'),
    b('Tablachina', 'f'), b('Mantelete', 'm'), b('Pavesina', 'f'), b('Muralla', 'f'),
  ]),
  Casco: Object.freeze([
    b('Casco', 'm'), b('Yelmo', 'm'), b('Celada', 'f'), b('Morrión', 'm'),
    b('Bacinete', 'm'), b('Capacete', 'm'), b('Almete', 'm'), b('Barbuta', 'f'),
    b('Capellina', 'f'), b('Gálea', 'f'), b('Borgoñota', 'f'), b('Cimera', 'f'),
    b('Diadema', 'f'), b('Corona', 'f'), b('Capucha', 'f'), b('Máscara', 'f'),
  ]),
  Armadura: Object.freeze([
    b('Armadura', 'f'), b('Coraza', 'f'), b('Cota de Malla', 'f'), b('Peto', 'm'),
    b('Loriga', 'f'), b('Brigantina', 'f'), b('Jubón', 'm'), b('Gambesón', 'm'),
    b('Arnés', 'm'), b('Coselete', 'm'), b('Pechera', 'f'), b('Túnica', 'f'),
    b('Manto', 'm'), b('Sobrevesta', 'f'), b('Lorigón', 'm'), b('Malla', 'f'),
  ]),
  Botas: Object.freeze([
    b('Botas', 'fp'), b('Grebas', 'fp'), b('Botines', 'mp'), b('Escarpes', 'mp'),
    b('Sandalias', 'fp'), b('Polainas', 'fp'), b('Borceguíes', 'mp'), b('Zapatos', 'mp'),
    b('Abarcas', 'fp'), b('Alpargatas', 'fp'), b('Babuchas', 'fp'), b('Zuecos', 'mp'),
    b('Coturnos', 'mp'), b('Mocasines', 'mp'), b('Espinilleras', 'fp'), b('Calzas', 'fp'),
  ]),
});

// Adjetivos: un string terminado en -o o -e se concuerda solo; los demás llevan
// sus cuatro formas explícitas. Los complementos "de X" son invariables.

/** Adjetivos de los objetos Comunes ("Espada Oxidada"). */
export const ADJETIVOS_COMUN = Object.freeze([
  'Oxidado', 'Gastado', 'Abollado', 'Mellado', 'Agrietado', 'Viejo', 'Tosco',
  'Remendado', 'Torcido', 'Rayado', 'Endeble', 'Corriente',
  'de Madera', 'de Bronce', 'de Hierro', 'de Recluta',
]);

/** Adjetivos de los objetos Raros ("Espada Rúnica de Escarcha"). */
export const ADJETIVOS_RARO = Object.freeze([
  'Rúnico', 'Encantado', 'Templado', 'Arcano', 'Bruñido', 'Élfico', 'Enano',
  'Grabado', 'Sagrado', 'Hechizado', 'Reforzado', 'Imponente',
  Object.freeze({ m: 'Ancestral', f: 'Ancestral', mp: 'Ancestrales', fp: 'Ancestrales' }),
]);

/** Sufijos de los objetos Raros. */
export const SUFIJOS_RARO = Object.freeze([
  'de Escarcha', 'de las Llamas', 'del Trueno', 'de la Tormenta', 'del Centinela',
  'del Lobo', 'del Halcón', 'de la Marea', 'de las Sombras', 'del Alba',
  'de Ceniza', 'del Vendaval', 'de la Bruma', 'de Obsidiana', 'del Coloso',
  'del Vigía', 'de Plata Lunar', 'de la Víbora', 'del Juramento', 'de los Ecos',
]);

/** Nombres propios de los Legendarios ("Albor, Espada del Fénix Eterno"). */
export const NOMBRES_LEGENDARIO = Object.freeze([
  'Albor', 'Ocaso', 'Tempestad', 'Aurora', 'Eclipse', 'Quimera', 'Vorágine',
  'Lucero', 'Furia', 'Cenit', 'Nadir', 'Centella', 'Brasa', 'Letanía', 'Zafiro',
  'Ébano', 'Ventisca', 'Réquiem', 'Oráculo', 'Augurio', 'Hálito', 'Nébula',
  'Sílfide', 'Valquiria', 'Sentencia', 'Penumbra', 'Relámpago', 'Ámbar',
]);

/** Epítetos de los Legendarios. */
export const EPITETOS_LEGENDARIO = Object.freeze([
  'del Fénix Eterno', 'del Dragón Eterno', 'de los Dioses Caídos', 'del Rey Olvidado',
  'del Abismo Sin Fin', 'del Sol Naciente', 'de la Luna Sangrienta', 'del Último Titán',
  'de las Mil Batallas', 'del Juicio Final', 'de la Estrella Errante', 'del Trono Perdido',
  'del Primer Amanecer', 'de los Siete Mares', 'del Vacío Estelar', 'de la Corona Rota',
  'del Cazador de Dioses', 'de la Llama Inmortal', 'del Archimago Caído', 'del Héroe Sin Nombre',
]);

/** Concuerda un adjetivo con el género de la base. */
export function concordar(adj, genero) {
  if (typeof adj === 'object') return adj[genero];
  if (adj.startsWith('de ') || adj.startsWith('del ')) return adj;
  if (adj.endsWith('o')) {
    const raiz = adj.slice(0, -1);
    return { m: adj, f: `${raiz}a`, mp: `${adj}s`, fp: `${raiz}as` }[genero];
  }
  if (adj.endsWith('e')) return genero.endsWith('p') ? `${adj}s` : adj;
  throw new Error(`Adjetivo sin concordancia: ${adj}`);
}

// ─── Utilidades ───────────────────────────────────────────────────────────────

/** Entero uniforme en [min, max] (ambos incluidos). */
export function enteroEntre(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

function indice(rng, n) {
  return Math.min(n - 1, Math.floor(rng() * n));
}

function elegir(rng, lista) {
  return lista[indice(rng, lista.length)];
}

const limitar = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** Nivel normalizado a [0, 1] (nivel 1 → 0, nivel 10 → 1). */
function fraccionNivel(nivel) {
  return (limitar(nivel, NIVEL_MIN, NIVEL_MAX) - NIVEL_MIN) / (NIVEL_MAX - NIVEL_MIN);
}

// ─── Drop y rareza ────────────────────────────────────────────────────────────

/** ¿Cae objeto? true con probabilidad `dropChance`. */
export function hayDrop(rng, dropChance) {
  return rng() < dropChance;
}

/** Probabilidad extra de Legendario por pity (0 si no aplica). */
export function probabilidadPity(sinLegendario = 0) {
  if (sinLegendario < PITY_UMBRAL) return 0;
  return Math.min(1, PITY_BASE + PITY_PASO * (sinLegendario - PITY_UMBRAL));
}

/**
 * Probabilidades [Común, Raro, Legendario] según dificultad y pity.
 *
 * Sin jefe: Legendario 5 % → 14 % y Raro 25 % → 38,5 % del nivel 1 al 10.
 * Con jefe: Legendario 10 % → 20 % y Raro 35 % → 44 %.
 * Pity: si `sinLegendario ≥ PITY_UMBRAL`, Legendario pasa a ser al menos
 * 50 %, 60 %, 70 %… (se quita primero de Común y luego de Raro).
 *
 * @param {number} nivel enemyLevel 1..10
 * @param {{ jefe?: boolean, sinLegendario?: number }} [opts]
 * @returns {[number, number, number]}
 */
export function probabilidadesRareza(nivel = 1, { jefe = false, sinLegendario = 0 } = {}) {
  const t = fraccionNivel(nivel);
  let leg = jefe ? 0.10 + 0.10 * t : 0.05 + 0.09 * t;
  let raro = jefe ? 0.35 + 0.09 * t : 0.25 + 0.135 * t;
  leg = Math.max(leg, probabilidadPity(sinLegendario));
  raro = Math.min(raro, 1 - leg);
  const comun = Math.max(0, 1 - raro - leg);
  return [comun, raro, leg];
}

/**
 * Rareza 0 (Común), 1 (Raro) o 2 (Legendario).
 * @param {() => number} rng
 * @param {number} [nivel]
 * @param {{ jefe?: boolean, sinLegendario?: number }} [opts]
 */
export function sortearRareza(rng, nivel = 1, opts = {}) {
  const p = probabilidadesRareza(nivel, opts);
  const r = rng();
  let acumulado = 0;
  for (let i = 0; i < p.length; i++) {
    acumulado += p[i];
    if (r < acumulado) return i;
  }
  return p.length - 1;
}

export function sortearTipo(rng) {
  return elegir(rng, LISTA_TIPOS);
}

// ─── Nombres ──────────────────────────────────────────────────────────────────

/**
 * Nombre procedural según rareza:
 *  - Común:      "<Base> <adjetivo>"              → "Espada Oxidada"
 *  - Raro:       "<Base> <adjetivo> <sufijo>"     → "Cimitarra Rúnica de Escarcha"
 *  - Legendario: "<Nombre>, <Base> <epíteto>"     → "Albor, Espada del Fénix Eterno"
 * Si `evitar` coincide con el nombre resultante, se cambia el nombre propio
 * (legendario) o el adjetivo (resto) por el siguiente de la lista.
 */
export function generarNombre(rng, tipo, rareza, { evitar = null } = {}) {
  const bases = BASES[tipo];
  if (!bases) throw new Error(`Tipo desconocido: ${tipo}`);
  const base = elegir(rng, bases);

  let componer;
  let lista;
  if (rareza === RAREZA.LEGENDARIO) {
    const epiteto = elegir(rng, EPITETOS_LEGENDARIO);
    lista = NOMBRES_LEGENDARIO;
    componer = (propio) => `${propio}, ${base.nombre} ${epiteto}`;
  } else if (rareza === RAREZA.RARO) {
    const sufijo = elegir(rng, SUFIJOS_RARO);
    lista = ADJETIVOS_RARO;
    componer = (adj) => `${base.nombre} ${concordar(adj, base.genero)} ${sufijo}`;
  } else if (rareza === RAREZA.COMUN) {
    lista = ADJETIVOS_COMUN;
    componer = (adj) => `${base.nombre} ${concordar(adj, base.genero)}`;
  } else {
    throw new Error(`Rareza desconocida: ${rareza}`);
  }

  const i = indice(rng, lista.length);
  let nombre = componer(lista[i]);
  if (evitar !== null && nombre === evitar) nombre = componer(lista[(i + 1) % lista.length]);
  return nombre.length > MAX_LONGITUD_NOMBRE ? nombre.slice(0, MAX_LONGITUD_NOMBRE) : nombre;
}

// ─── Stats ────────────────────────────────────────────────────────────────────

/**
 * Rango [lo, hi] de la stat principal para una rareza y un nivel. Siempre
 * dentro de RANGO_STAT[rareza]; en nivel 1 es el 60 % bajo y en nivel 10 el
 * 60 % alto. Un jefe suma BONO_NIVEL_JEFE niveles.
 */
export function rangoStat(rareza, nivel = 1, { jefe = false } = {}) {
  const rango = RANGO_STAT[rareza];
  if (!rango) throw new Error(`Rareza desconocida: ${rareza}`);
  const [min, max] = rango;
  const ancho = max - min;
  const t = fraccionNivel(nivel + (jefe ? BONO_NIVEL_JEFE : 0));
  const lo = min + Math.round(t * ancho * DESPLAZAMIENTO_NIVEL);
  const hi = max - Math.round((1 - t) * ancho * DESPLAZAMIENTO_NIVEL);
  return [lo, hi];
}

export function generarStats(rng, tipo, rareza, { nivel = 1, jefe = false } = {}) {
  const info = TIPOS[tipo];
  if (!info) throw new Error(`Tipo desconocido: ${tipo}`);
  const [lo, hi] = rangoStat(rareza, nivel, { jefe });
  const principal = enteroEntre(rng, lo, hi);
  const factor = SECUNDARIA_MIN + rng() * (SECUNDARIA_MAX - SECUNDARIA_MIN);
  const secundaria = Math.round(principal * factor);
  return info.principal === 'ataque'
    ? { ataque: principal, defensa: secundaria }
    : { ataque: secundaria, defensa: principal };
}

// ─── Objeto completo ──────────────────────────────────────────────────────────

/**
 * @typedef {{ nivel?: number, jefe?: boolean, sinLegendario?: number, evitarNombre?: string|null }} OpcionesBotin
 */

/**
 * Genera un objeto completo con el formato de `item` de SPEC.md.
 * @param {() => number} rng
 * @param {OpcionesBotin} [opts]
 */
export function generarObjeto(rng, { nivel = 1, jefe = false, sinLegendario = 0, evitarNombre = null } = {}) {
  const rareza = sortearRareza(rng, nivel, { jefe, sinLegendario });
  const tipo = sortearTipo(rng);
  const nombre = generarNombre(rng, tipo, rareza, { evitar: evitarNombre });
  const { ataque, defensa } = generarStats(rng, tipo, rareza, { nivel, jefe });
  return { nombre, tipo, rareza, ataque, defensa };
}

/**
 * Tirada completa al ganar un combate. Los jefes SIEMPRE sueltan objeto.
 * @param {() => number} [rng]
 * @param {OpcionesBotin & { dropChance?: number }} [opts]
 * @returns {null | {nombre, tipo, rareza, ataque, defensa}} null si no cae nada.
 */
export function tirarLoot(rng = Math.random, { dropChance = 0.6, ...opts } = {}) {
  if (!opts.jefe && !hayDrop(rng, dropChance)) return null;
  return generarObjeto(rng, opts);
}

// ─── Estado en memoria (pity y último legendario) ─────────────────────────────

/**
 * Lleva, por dirección, cuántos drops seguidos lleva sin Legendario, y el último
 * nombre legendario repartido (para no repetirlo dos veces seguidas).
 * Acotado a `maxDirecciones` entradas (se olvida la menos reciente).
 */
export class EstadoBotin {
  constructor({ maxDirecciones = 10_000 } = {}) {
    this.maxDirecciones = maxDirecciones;
    this.contadores = new Map();
    this.ultimoLegendario = null;
  }

  /** Drops seguidos sin Legendario de esta dirección. */
  sinLegendario(direccion) {
    return this.contadores.get(direccion) ?? 0;
  }

  /** Opciones de pity/no-repetición para pasar a `tirarLoot`. */
  opciones(direccion) {
    return { sinLegendario: this.sinLegendario(direccion), evitarNombre: this.ultimoLegendario };
  }

  /** Apunta un drop entregado (llamar solo si el mint ha ido bien). */
  registrar(direccion, item) {
    if (!item) return;
    const n = item.rareza === RAREZA.LEGENDARIO ? 0 : this.sinLegendario(direccion) + 1;
    if (item.rareza === RAREZA.LEGENDARIO) this.ultimoLegendario = item.nombre;
    this.contadores.delete(direccion);
    if (this.contadores.size >= this.maxDirecciones) {
      this.contadores.delete(this.contadores.keys().next().value);
    }
    this.contadores.set(direccion, n);
  }
}
