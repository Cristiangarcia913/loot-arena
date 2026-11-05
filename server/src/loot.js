// Lógica pura de drops (sin red ni estado). Todo recibe un RNG inyectable
// `rng: () => number` en [0, 1) para poder testear de forma determinista.

export const RAREZA = Object.freeze({ COMUN: 0, RARO: 1, LEGENDARIO: 2 });

/** Probabilidades de rareza acumuladas (SPEC.md §2): 70 / 25 / 5 %. */
export const PROB_RAREZA = Object.freeze([0.70, 0.25, 0.05]);

/** Rango de la stat principal por rareza (incluidos ambos extremos). */
export const RANGO_STAT = Object.freeze({
  0: Object.freeze([1, 5]),
  1: Object.freeze([6, 12]),
  2: Object.freeze([13, 25]),
});

/** La stat secundaria es ~25 % de la principal (entre 20 % y 30 %, redondeado). */
export const SECUNDARIA_MIN = 0.20;
export const SECUNDARIA_MAX = 0.30;

/** Tipos válidos, su stat principal y el género gramatical para concordar adjetivos. */
export const TIPOS = Object.freeze({
  Espada:   { principal: 'ataque',  genero: 'f'  },
  Escudo:   { principal: 'defensa', genero: 'm'  },
  Casco:    { principal: 'defensa', genero: 'm'  },
  Armadura: { principal: 'defensa', genero: 'f'  },
  Botas:    { principal: 'defensa', genero: 'fp' },
});
export const LISTA_TIPOS = Object.freeze(Object.keys(TIPOS));

// Adjetivos por rareza con concordancia: m = masc. sing., f = fem. sing., fp = fem. plural.
// Los legendarios usan un complemento invariable ("del Dragón Eterno").
const ADJETIVOS = {
  0: [
    { m: 'Oxidado',   f: 'Oxidada',   fp: 'Oxidadas'   },
    { m: 'Gastado',   f: 'Gastada',   fp: 'Gastadas'   },
    { m: 'de Madera', f: 'de Madera', fp: 'de Madera'  },
    { m: 'Abollado',  f: 'Abollada',  fp: 'Abolladas'  },
    { m: 'de Cuero',  f: 'de Cuero',  fp: 'de Cuero'   },
    { m: 'Viejo',     f: 'Vieja',     fp: 'Viejas'     },
  ],
  1: [
    { m: 'Rúnico',     f: 'Rúnica',     fp: 'Rúnicas'     },
    { m: 'Encantado',  f: 'Encantada',  fp: 'Encantadas'  },
    { m: 'de Acero Élfico', f: 'de Acero Élfico', fp: 'de Acero Élfico' },
    { m: 'Templado',   f: 'Templada',   fp: 'Templadas'   },
    { m: 'del Centinela', f: 'del Centinela', fp: 'del Centinela' },
    { m: 'Arcano',     f: 'Arcana',     fp: 'Arcanas'     },
  ],
  2: [
    { m: 'del Dragón Eterno',    f: 'del Dragón Eterno',    fp: 'del Dragón Eterno'    },
    { m: 'de los Dioses Caídos', f: 'de los Dioses Caídos', fp: 'de los Dioses Caídos' },
    { m: 'del Rey Olvidado',     f: 'del Rey Olvidado',     fp: 'del Rey Olvidado'     },
    { m: 'del Abismo',           f: 'del Abismo',           fp: 'del Abismo'           },
    { m: 'del Fénix Inmortal',   f: 'del Fénix Inmortal',   fp: 'del Fénix Inmortal'   },
  ],
};

/** Entero uniforme en [min, max] (ambos incluidos). */
export function enteroEntre(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

function elegir(rng, lista) {
  return lista[Math.floor(rng() * lista.length)];
}

/** ¿Cae objeto? true con probabilidad `dropChance`. */
export function hayDrop(rng, dropChance) {
  return rng() < dropChance;
}

/** Rareza según PROB_RAREZA (0 Común, 1 Raro, 2 Legendario). */
export function sortearRareza(rng) {
  const r = rng();
  let acumulado = 0;
  for (let i = 0; i < PROB_RAREZA.length; i++) {
    acumulado += PROB_RAREZA[i];
    if (r < acumulado) return i;
  }
  return PROB_RAREZA.length - 1;
}

export function sortearTipo(rng) {
  return elegir(rng, LISTA_TIPOS);
}

export function generarNombre(rng, tipo, rareza) {
  const info = TIPOS[tipo];
  if (!info) throw new Error(`Tipo desconocido: ${tipo}`);
  const adj = elegir(rng, ADJETIVOS[rareza]);
  return `${tipo} ${adj[info.genero]}`;
}

export function generarStats(rng, tipo, rareza) {
  const info = TIPOS[tipo];
  if (!info) throw new Error(`Tipo desconocido: ${tipo}`);
  const [min, max] = RANGO_STAT[rareza];
  const principal = enteroEntre(rng, min, max);
  const factor = SECUNDARIA_MIN + rng() * (SECUNDARIA_MAX - SECUNDARIA_MIN);
  const secundaria = Math.round(principal * factor);
  return info.principal === 'ataque'
    ? { ataque: principal, defensa: secundaria }
    : { ataque: secundaria, defensa: principal };
}

/** Genera un objeto completo con el formato de `item` de SPEC.md. */
export function generarObjeto(rng) {
  const rareza = sortearRareza(rng);
  const tipo = sortearTipo(rng);
  const nombre = generarNombre(rng, tipo, rareza);
  const { ataque, defensa } = generarStats(rng, tipo, rareza);
  return { nombre, tipo, rareza, ataque, defensa };
}

/**
 * Tirada completa al ganar un combate.
 * @returns {null | {nombre, tipo, rareza, ataque, defensa}} null si no cae nada.
 */
export function tirarLoot(rng = Math.random, { dropChance = 0.6 } = {}) {
  if (!hayDrop(rng, dropChance)) return null;
  return generarObjeto(rng);
}
