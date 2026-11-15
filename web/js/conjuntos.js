// Bonificaciones de conjunto (set bonuses): lógica pura, sin DOM.
//
// Hay 3 conjuntos temáticos. Una pieza pertenece a un conjunto si:
//   1. trae el campo `conjunto` con un id válido (botín local nuevo, botin-local.js), o
//   2. su nombre contiene el sufijo del conjunto ("… del Gladiador Sangriento"). Así también
//      funcionan los NFT de la cadena, cuyo struct on-chain no tiene campo de conjunto.
//
// Con 2 piezas del mismo conjunto equipadas se activa un bono pasivo de estadísticas
// (lo aplica progression.statsHeroe) y con 4 un efecto especial de combate
// (lo resuelve combat.js a partir de `efectosConjunto`).

export const PIEZAS_BONO = 2;
export const PIEZAS_EFECTO = 4;

/** Parámetros de los efectos de 4 piezas (los usa combat.js). */
export const EFECTO = Object.freeze({
  /** Gladiador: los críticos del héroe dejan sangrando al enemigo. */
  sangrado: Object.freeze({ tipo: "sangrado", turnos: 3, pct: 0.3 }),
  /** Coloso: al bajar del umbral de vida (una vez por combate) se levanta un escudo. */
  umbralEscudo: 0.2,
  escudo: Object.freeze({ tipo: "escudo", turnos: 3, pct: 0.25 }),
});

export const CONJUNTOS = Object.freeze({
  gladiador: Object.freeze({
    id: "gladiador",
    nombre: "Set del Gladiador Sangriento",
    corto: "Set del Gladiador",
    sufijo: "del Gladiador Sangriento",
    icono: "🩸",
    color: "#dc2626",
    bono: Object.freeze({ critico: 0.15 }),
    textoBono: "+15 % de probabilidad de crítico",
    efecto: "sangradoCritico",
    textoEfecto: "Tus críticos hacen sangrar al enemigo (3 turnos)",
  }),
  coloso: Object.freeze({
    id: "coloso",
    nombre: "Set del Coloso de Hierro",
    corto: "Set del Coloso",
    sufijo: "del Coloso de Hierro",
    icono: "🗿",
    color: "#64748b",
    bono: Object.freeze({ multDefensa: 0.2 }),
    textoBono: "+20 % de defensa",
    efecto: "escudoVidaBaja",
    textoEfecto: "Al bajar del 20 % de vida te cubre un escudo del 25 % de tu vida máxima (1 vez por combate)",
  }),
  sombras: Object.freeze({
    id: "sombras",
    nombre: "Set de las Sombras",
    corto: "Set de las Sombras",
    sufijo: "de las Sombras",
    icono: "🌑",
    color: "#7c3aed",
    bono: Object.freeze({ esquiva: 0.1 }),
    textoBono: "+10 % de esquiva",
    efecto: "criticoTrasEsquivar",
    textoEfecto: "Tras esquivar un golpe, tu siguiente ataque es crítico seguro",
  }),
});

export const IDS_CONJUNTO = Object.freeze(Object.keys(CONJUNTOS));

export const esConjuntoValido = (id) => typeof id === "string" && Object.hasOwn(CONJUNTOS, id);

/** Datos del conjunto por id (o null). */
export function conjunto(id) {
  return esConjuntoValido(id) ? CONJUNTOS[id] : null;
}

/** Id del conjunto al que pertenece un objeto, o null. */
export function conjuntoDe(item) {
  if (!item || typeof item !== "object") return null;
  if (esConjuntoValido(item.conjunto)) return item.conjunto;
  const nombre = String(item.nombre ?? "");
  for (const c of Object.values(CONJUNTOS)) if (nombre.includes(c.sufijo)) return c.id;
  return null;
}

/**
 * Recuento de piezas equipadas por conjunto (solo los conjuntos con alguna pieza).
 * Cuenta como mucho una pieza por tipo, igual que las ranuras de equipo.
 * @param {Array<{tipo:string, nombre?:string, conjunto?:string}>} equipados
 * @returns {Array<{id:string, nombre:string, corto:string, icono:string, color:string, piezas:number, total:number,
 *          bonoActivo:boolean, efectoActivo:boolean, textoBono:string, textoEfecto:string}>}
 */
export function contarConjuntos(equipados = []) {
  const tipos = new Map();
  for (const it of equipados ?? []) {
    const id = conjuntoDe(it);
    if (!id) continue;
    if (!tipos.has(id)) tipos.set(id, new Set());
    tipos.get(id).add(String(it.tipo));
  }
  return IDS_CONJUNTO.filter((id) => tipos.has(id)).map((id) => {
    const c = CONJUNTOS[id];
    const piezas = tipos.get(id).size;
    return {
      id, nombre: c.nombre, corto: c.corto, icono: c.icono, color: c.color,
      piezas, total: PIEZAS_EFECTO,
      bonoActivo: piezas >= PIEZAS_BONO,
      efectoActivo: piezas >= PIEZAS_EFECTO,
      textoBono: c.textoBono, textoEfecto: c.textoEfecto,
    };
  });
}

/** Piezas equipadas de un conjunto concreto. */
export function piezasEquipadas(equipados, id) {
  return contarConjuntos(equipados).find((x) => x.id === id)?.piezas ?? 0;
}

/**
 * Bonos agregados de los conjuntos equipados.
 * @returns {{critico:number, esquiva:number, multDefensa:number, efectos:string[]}}
 *   `critico` y `esquiva` se suman a la probabilidad (fracción); `multDefensa` multiplica la defensa (+x);
 *   `efectos` son los ids de efecto de 4 piezas para combat.js.
 */
export function bonosConjunto(equipados = []) {
  const r = { critico: 0, esquiva: 0, multDefensa: 0, efectos: [] };
  for (const s of contarConjuntos(equipados)) {
    const c = CONJUNTOS[s.id];
    if (s.bonoActivo) {
      r.critico += c.bono.critico ?? 0;
      r.esquiva += c.bono.esquiva ?? 0;
      r.multDefensa += c.bono.multDefensa ?? 0;
    }
    if (s.efectoActivo) r.efectos.push(c.efecto);
  }
  return r;
}

/** Texto corto del progreso de un conjunto: "Set del Gladiador 2/4". */
export function textoProgreso(id, piezas) {
  const c = conjunto(id);
  return c ? `${c.corto} ${Math.min(piezas, PIEZAS_EFECTO)}/${PIEZAS_EFECTO}` : "";
}
