// Botín local del modo demo (sin wallet): lógica pura, sin DOM ni localStorage directo.
//
// Reproduce las reglas de server/src/loot.js (probabilidad de drop, rareza por nivel/jefe,
// pity, primer botín Raro, rangos de stats y nombres procedurales) para que un jugador sin
// MetaMask también vea caer objetos y pueda equiparlos. Los objetos NO son NFT: viven solo
// en localStorage de este navegador (main.js los guarda con `claveBotinLocal`).
//
// Los tokenId son strings numéricos ("1", "2"…) para encajar con equipment.js, y cada objeto
// lleva `local: true` para que la interfaz no ofrezca transferirlo ni venderlo.
//
// Conjuntos (conjuntos.js): con probabilidad PROB_CONJUNTO el objeto pertenece a uno de los
// 3 conjuntos temáticos; lleva el campo `conjunto` y el sufijo del conjunto en el nombre
// ("Sable Rúnico del Gladiador Sangriento"), que es lo que también identifica a los NFT.
import { CONJUNTOS, IDS_CONJUNTO, esConjuntoValido } from "./conjuntos.js";

export const VERSION = 1;
export const CLAVE_BOTIN_LOCAL = "lootarena:demo:botin";
export const CLAVE_EQUIPO_LOCAL = "lootarena:demo:equipo";
/** Tope de la mochila local: al pasarlo se descarta el objeto no equipado más débil. */
export const MAX_OBJETOS = 120;

export const DROP_CHANCE = 0.6;
/** Probabilidad de que un objeto pertenezca a un conjunto (Gladiador, Coloso o Sombras). */
export const PROB_CONJUNTO = 0.35;
const NIVEL_MIN = 1;
const NIVEL_MAX = 10;
const RANGO_STAT = [[1, 6], [6, 14], [14, 30]];
const DESPLAZAMIENTO_NIVEL = 0.4;
const BONO_NIVEL_JEFE = 2;
const PITY_UMBRAL = 15;
const PITY_BASE = 0.5;
const PITY_PASO = 0.1;

const TIPOS = Object.freeze({ Espada: "ataque", Escudo: "defensa", Casco: "defensa", Armadura: "defensa", Botas: "defensa" });
const LISTA_TIPOS = Object.keys(TIPOS);

const b = (nombre, genero) => ({ nombre, genero });
const BASES = {
  Espada: [b("Espada", "f"), b("Mandoble", "m"), b("Sable", "m"), b("Cimitarra", "f"), b("Estoque", "m"), b("Katana", "f"), b("Gladio", "m"), b("Claymore", "f")],
  Escudo: [b("Escudo", "m"), b("Broquel", "m"), b("Rodela", "f"), b("Pavés", "m"), b("Adarga", "f"), b("Égida", "f"), b("Bastión", "m"), b("Muralla", "f")],
  Casco: [b("Casco", "m"), b("Yelmo", "m"), b("Celada", "f"), b("Morrión", "m"), b("Bacinete", "m"), b("Barbuta", "f"), b("Corona", "f"), b("Máscara", "f")],
  Armadura: [b("Armadura", "f"), b("Coraza", "f"), b("Cota de Malla", "f"), b("Peto", "m"), b("Loriga", "f"), b("Brigantina", "f"), b("Gambesón", "m"), b("Manto", "m")],
  Botas: [b("Botas", "fp"), b("Grebas", "fp"), b("Botines", "mp"), b("Escarpes", "mp"), b("Sandalias", "fp"), b("Polainas", "fp"), b("Borceguíes", "mp"), b("Mocasines", "mp")],
};
const ADJ_COMUN = ["Oxidado", "Gastado", "Abollado", "Mellado", "Viejo", "Tosco", "Remendado", "de Madera", "de Bronce", "de Hierro", "de Recluta"];
const ADJ_RARO = ["Rúnico", "Encantado", "Templado", "Arcano", "Bruñido", "Élfico", "Grabado", "Sagrado", "Hechizado", "Reforzado"];
const SUF_RARO = ["de Escarcha", "de las Llamas", "del Trueno", "de la Tormenta", "del Lobo", "del Halcón", "de las Sombras", "del Alba", "de Obsidiana", "de Plata Lunar"];
const NOMBRES_LEG = ["Albor", "Ocaso", "Tempestad", "Aurora", "Eclipse", "Quimera", "Vorágine", "Lucero", "Furia", "Cenit", "Penumbra", "Valquiria"];
const EPITETOS_LEG = ["del Fénix Eterno", "del Dragón Eterno", "de los Dioses Caídos", "del Rey Olvidado", "del Sol Naciente", "de la Luna Sangrienta", "del Último Titán", "de la Llama Inmortal"];

const limitar = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const indice = (rng, n) => Math.min(n - 1, Math.floor(rng() * n));
const elegir = (rng, lista) => lista[indice(rng, lista.length)];
const fraccionNivel = (nivel) => (limitar(Number(nivel) || 1, NIVEL_MIN, NIVEL_MAX) - NIVEL_MIN) / (NIVEL_MAX - NIVEL_MIN);

function concordar(adj, genero) {
  if (adj.startsWith("de ") || adj.startsWith("del ")) return adj;
  if (adj.endsWith("o")) {
    const raiz = adj.slice(0, -1);
    return { m: adj, f: `${raiz}a`, mp: `${adj}s`, fp: `${raiz}as` }[genero];
  }
  return genero.endsWith("p") ? `${adj}s` : adj;
}

/** Probabilidades [Común, Raro, Legendario]: mismas curvas que el servidor. */
export function probabilidadesRareza(nivel = 1, { jefe = false, sinLegendario = 0 } = {}) {
  const t = fraccionNivel(nivel);
  let leg = jefe ? 0.10 + 0.10 * t : 0.05 + 0.09 * t;
  let raro = jefe ? 0.35 + 0.09 * t : 0.25 + 0.135 * t;
  if (sinLegendario >= PITY_UMBRAL) leg = Math.max(leg, Math.min(1, PITY_BASE + PITY_PASO * (sinLegendario - PITY_UMBRAL)));
  raro = Math.min(raro, 1 - leg);
  return [Math.max(0, 1 - raro - leg), raro, leg];
}

function sortearRareza(rng, nivel, opts) {
  const p = probabilidadesRareza(nivel, opts);
  const r = rng();
  let acc = 0;
  for (let i = 0; i < p.length; i++) { acc += p[i]; if (r < acc) return i; }
  return p.length - 1;
}

/** Nombre procedural. Si hay `sufijo` (conjunto) sustituye al sufijo/epíteto aleatorio. */
function generarNombre(rng, tipo, rareza, sufijo = null) {
  const base = elegir(rng, BASES[tipo]);
  if (rareza === 2) return `${elegir(rng, NOMBRES_LEG)}, ${base.nombre} ${sufijo ?? elegir(rng, EPITETOS_LEG)}`;
  if (rareza === 1) return `${base.nombre} ${concordar(elegir(rng, ADJ_RARO), base.genero)} ${sufijo ?? elegir(rng, SUF_RARO)}`;
  const comun = `${base.nombre} ${concordar(elegir(rng, ADJ_COMUN), base.genero)}`;
  return sufijo ? `${comun} ${sufijo}` : comun;
}

/** Rango [lo, hi] de la stat principal (como `rangoStat` del servidor). */
export function rangoStat(rareza, nivel = 1, { jefe = false } = {}) {
  const [min, max] = RANGO_STAT[rareza];
  const ancho = max - min;
  const t = fraccionNivel((Number(nivel) || 1) + (jefe ? BONO_NIVEL_JEFE : 0));
  return [min + Math.round(t * ancho * DESPLAZAMIENTO_NIVEL), max - Math.round((1 - t) * ancho * DESPLAZAMIENTO_NIVEL)];
}

/**
 * Objeto completo { nombre, tipo, rareza, ataque, defensa[, conjunto] } (sin tokenId).
 * `conjunto`: id fijo (de conjuntos.js), `null` para forzar que no tenga, o undefined para sortearlo.
 */
export function generarObjeto(rng, { nivel = 1, jefe = false, sinLegendario = 0, rareza: fija = null, conjunto: fijo } = {}) {
  const rareza = fija ?? sortearRareza(rng, nivel, { jefe, sinLegendario });
  const tipo = elegir(rng, LISTA_TIPOS);
  const conjunto = fijo !== undefined
    ? (esConjuntoValido(fijo) ? fijo : null)
    : (rng() < PROB_CONJUNTO ? elegir(rng, IDS_CONJUNTO) : null);
  const nombre = generarNombre(rng, tipo, rareza, conjunto ? CONJUNTOS[conjunto].sufijo : null);
  const [lo, hi] = rangoStat(rareza, nivel, { jefe });
  const principal = lo + Math.floor(rng() * (hi - lo + 1));
  const secundaria = Math.round(principal * (0.10 + rng() * 0.30));
  const [ataque, defensa] = TIPOS[tipo] === "ataque" ? [principal, secundaria] : [secundaria, principal];
  return conjunto ? { nombre, tipo, rareza, ataque, defensa, conjunto } : { nombre, tipo, rareza, ataque, defensa };
}

/** Estado vacío de la mochila local. */
export const estadoVacio = () => ({ v: VERSION, siguienteId: 1, sinLegendario: 0, primeroEntregado: false, items: [] });

function itemValido(it) {
  return it && typeof it === "object" &&
    typeof it.tokenId === "string" && /^\d+$/.test(it.tokenId) &&
    typeof it.nombre === "string" && Object.hasOwn(TIPOS, it.tipo) &&
    [0, 1, 2].includes(it.rareza) &&
    Number.isInteger(it.ataque) && it.ataque >= 0 && it.ataque <= 999 &&
    Number.isInteger(it.defensa) && it.defensa >= 0 && it.defensa <= 999;
}

/** Lee el estado guardado; ante datos corruptos devuelve un estado vacío (o descarta lo inválido). */
export function parsearEstado(texto) {
  let d;
  try { d = JSON.parse(texto); } catch { return estadoVacio(); }
  if (!d || typeof d !== "object" || !Array.isArray(d.items)) return estadoVacio();
  const items = d.items
    .map((it) => {
      if (!it || typeof it !== "object") return null;
      const limpio = { ...it, tokenId: String(it.tokenId), local: true };
      if (Object.hasOwn(limpio, "conjunto") && !esConjuntoValido(limpio.conjunto)) delete limpio.conjunto;
      return limpio;
    })
    .filter(itemValido)
    .slice(0, MAX_OBJETOS);
  const maxId = items.reduce((m, it) => Math.max(m, Number(it.tokenId)), 0);
  return {
    v: VERSION,
    siguienteId: Math.max(Number.isInteger(d.siguienteId) ? d.siguienteId : 1, maxId + 1),
    sinLegendario: Number.isInteger(d.sinLegendario) && d.sinLegendario >= 0 ? d.sinLegendario : 0,
    primeroEntregado: d.primeroEntregado === true || items.length > 0,
    items,
  };
}

export const serializarEstado = (estado) => JSON.stringify(estado);

/**
 * Tirada al ganar un combate en modo demo. Devuelve el estado nuevo y el objeto (o null).
 * Igual que el servidor: los jefes siempre sueltan objeto y la primera victoria da un Raro.
 * @param {ReturnType<typeof estadoVacio>} estado
 * @param {{nivel?: number, jefe?: boolean}} enemigo
 * @param {() => number} [rng]
 * @param {{equipados?: Iterable<string>}} [opts] tokenId equipados (no se descartan al llenarse)
 */
export function tirarBotinLocal(estado, { nivel = 1, jefe = false } = {}, rng = Math.random, { equipados = [] } = {}) {
  const primero = !estado.primeroEntregado;
  if (!primero && !jefe && !(rng() < DROP_CHANCE)) return { estado, item: null };

  const base = generarObjeto(rng, { nivel, jefe, sinLegendario: estado.sinLegendario, rareza: primero ? 1 : null });
  const item = { tokenId: String(estado.siguienteId), ...base, local: true };
  let items = [...estado.items, item];
  if (items.length > MAX_OBJETOS) items = descartarMasDebil(items, new Set([...equipados].map(String)), item.tokenId);
  return {
    item,
    estado: {
      ...estado,
      siguienteId: estado.siguienteId + 1,
      sinLegendario: item.rareza === 2 ? 0 : estado.sinLegendario + 1,
      primeroEntregado: true,
      items,
    },
  };
}

const poder = (it) => it.ataque + it.defensa;

function descartarMasDebil(items, equipados, nuevo) {
  let peor = -1;
  items.forEach((it, i) => {
    if (equipados.has(it.tokenId) || it.tokenId === nuevo) return;
    if (peor < 0 || poder(it) < poder(items[peor])) peor = i;
  });
  return peor < 0 ? items.slice(1) : items.filter((_, i) => i !== peor);
}
