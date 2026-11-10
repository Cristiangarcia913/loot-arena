// Simulación de balance: combates simulados con una IA de jugador sencilla.
// Uso:  node tools/balance.mjs [combates=10000] [semilla=1] [informe=niveles]
//   informe = niveles   tabla por nivel de arena (la de siempre)
//             criaturas tabla criatura a criatura (normal y como jefe)
//             todo      las dos
import * as C from "../js/combat.js";
import * as P from "../js/progression.js";
import { habilidadesDisponibles } from "../js/skills.js";

const N = Number(process.argv[2]) || 10000;
const SEMILLA = Number(process.argv[3]) || 1;
const INFORME = process.argv[4] || "niveles";
const rng = C.mulberry32(SEMILLA);

/** IA sencilla: defiende ante lo telegrafiado, bebe con poca vida, usa habilidades listas. */
export function iaJugador(c) {
  if (C.jugadorAturdido(c)) return "atacar";
  const it = C.intencionEnemigo(c);
  const j = c.jugador;
  if (it?.telegrafiado) return "defender";
  const estados = new Set(j.estados.filter((e) => e.turnos > 0).map((e) => e.tipo));
  const listas = new Set(habilidadesDisponibles(j).filter((h) => h.lista).map((h) => h.id));
  // Curarse: Segundo Aliento antes de gastar pociones (cura más y limpia estados).
  if (listas.has("segundo_aliento") && (j.vida < j.vidaMax * 0.6 || estados.has("veneno") || estados.has("sangrado"))) {
    return { habilidad: "segundo_aliento" };
  }
  if (j.vida < j.vidaMax * 0.35 && j.pociones > 0) return "pocion";
  for (const id of ["tajo_celestial", "paso_sombrio", "mente_ferrea", "muro_de_fe"]) if (listas.has(id)) return { habilidad: id };
  if (listas.has("piel_de_dragon") && j.vida < j.vidaMax * 0.7) return { habilidad: "piel_de_dragon" };
  // Rompearmaduras primero: todo lo que venga después pega más.
  if (listas.has("rompearmaduras") && !c.enemigo.estados.some((e) => e.tipo === "fragil")) return { habilidad: "rompearmaduras" };
  if (listas.has("grito_guerra") && !estados.has("furia") && listas.has("golpe_poderoso")) return { habilidad: "grito_guerra" };
  if (listas.has("golpe_poderoso")) return { habilidad: "golpe_poderoso" };
  // Estocada Precisa: imparable, la mejor opción contra lo que esquiva mucho.
  if (listas.has("estocada_precisa")) return { habilidad: "estocada_precisa" };
  if (listas.has("desangrar") && !c.enemigo.estados.some((e) => e.tipo === "sangrado")) return { habilidad: "desangrar" };
  return "atacar";
}

/** Juega un combate ya creado hasta el final. @returns {{victoria:boolean, turnos:number, vidaPct:number}} */
function jugar(c, r) {
  let t = 0;
  while (c.fase === "en_curso" && t++ < 300) c = C.turnoJugador(c, iaJugador(c), r).combate;
  return { victoria: c.fase === "victoria", turnos: t, vidaPct: c.jugador.vida / c.jugador.vidaMax };
}

/**
 * Simula `n` combates del nivel de arena dado.
 * @param {object} heroe stats de progression.statsHeroe
 * @param {number} nivel nivel de arena 1..10
 * @param {{jefe?:boolean, pociones?:number, n?:number, r?:() => number, clave?:string}} [op]
 *   `clave`: fuerza una criatura concreta (si falta, la que toque por nivel).
 */
export function simular(heroe, nivel, { jefe = false, pociones = 1, n = N, r = rng, clave = null } = {}) {
  let gana = 0, turnos = 0, vida = 0;
  for (let k = 0; k < n; k++) {
    const nv = jefe ? nivel : C.nivelEnemigo(nivel, r);
    const enemigo = clave ? C.generarEnemigoDe(clave, nv, { jefe }) : C.generarEnemigo(nv, r, { jefe });
    const res = jugar(C.crearCombate({ ...heroe, pociones }, enemigo, r), r);
    if (res.victoria) { gana++; vida += res.vidaPct; }
    turnos += res.turnos;
  }
  return { pct: (100 * gana) / n, turnos: turnos / n, vidaRestante: gana ? (100 * vida) / gana : 0 };
}

/** Nivel de héroe esperado al llegar a un nivel de arena (5 victorias por nivel, racha media 2). */
export function nivelHeroeEsperado(arena) {
  let p = P.progresoNuevo();
  for (let a = 1; a < arena; a++) for (let v = 0; v < C.VICTORIAS_POR_NIVEL; v++) {
    p = P.sumarXp(p, P.xpPorVictoria({ nivel: a, jefe: v === C.VICTORIAS_POR_NIVEL - 1 }, 2)).progreso;
  }
  return p.nivel;
}

/** Nivel de arena en el que aparece cada criatura (el primero de su ventana). */
export function nivelDeCriatura(clave) {
  for (let nv = 1; nv <= C.NIVEL_MAX; nv++) {
    const vistas = new Set();
    for (let k = 0; k < 60; k++) vistas.add(C.claveDeNivel(nv, C.mulberry32(k + 1)).clave);
    if (vistas.has(clave)) return nv;
  }
  return C.NIVEL_MAX;
}

const it = (tipo, ataque, defensa, rareza = 0) => ({ tipo, ataque, defensa, rareza });
/** Equipo medio: 5 piezas Común/Raro. */
export const EQUIPO_MEDIO = [it("Espada", 7, 2, 1), it("Escudo", 2, 6), it("Casco", 1, 5), it("Armadura", 2, 7, 1), it("Botas", 1, 4)];

const f = (x) => `${x.toFixed(1)} %`;

function tablaNiveles() {
  const filas = [];
  for (let nv = 1; nv <= 10; nv++) {
    const nh = nivelHeroeEsperado(nv);
    const p1 = P.progresoNuevo();
    const pE = { ...P.progresoNuevo(), nivel: nh };
    const sin = simular(P.statsHeroe(p1, []), nv);
    const sin0 = simular(P.statsHeroe(p1, []), nv, { pociones: 0 });
    const sin3 = simular(P.statsHeroe(p1, []), nv, { pociones: 3 });
    const sinE = simular(P.statsHeroe(pE, []), nv);
    const med = simular(P.statsHeroe(pE, EQUIPO_MEDIO), nv);
    const jefe = simular(P.statsHeroe(pE, EQUIPO_MEDIO), nv, { jefe: true, pociones: 3, n: Math.round(N / 5) });
    filas.push([nv, nh, sin.pct, sin0.pct, sin3.pct, sinE.pct, med.pct, jefe.pct, jefe.vidaRestante, sin.turnos]);
  }
  console.log(`\n${N} combates por celda (IA sencilla, semilla ${SEMILLA}). Héroe nv 1 salvo columnas "nv esp.".`);
  console.log("| Arena | Nv héroe esp. | Sin equipo (1 poción) | Sin equipo (0) | Sin equipo (3) | Sin equipo, nv esp. | Equipo medio, nv esp. | Jefe (equipo medio, 3 poc.) | Vida al ganar al jefe | Turnos medios |");
  console.log("|---|---|---|---|---|---|---|---|---|---|");
  for (const r of filas) {
    console.log(`| ${r[0]} | ${r[1]} | ${f(r[2])} | ${f(r[3])} | ${f(r[4])} | ${f(r[5])} | ${f(r[6])} | ${f(r[7])} | ${f(r[8])} | ${r[9].toFixed(1)} |`);
  }
}

function tablaCriaturas() {
  const n = Math.max(200, Math.round(N / 4));
  console.log(`\n${n} combates por celda. Cada criatura a su nivel de aparición, héroe del nivel esperado de ese nivel de arena.`);
  console.log("| # | Criatura | Nv | Familia / silueta | Normal, sin equipo | Normal, equipo medio | Jefe, equipo medio | Turnos (sin equipo) |");
  console.log("|---|---|---|---|---|---|---|---|");
  for (const [i, b] of C.BESTIARIO.entries()) {
    const nv = nivelDeCriatura(b.clave);
    const pE = { ...P.progresoNuevo(), nivel: nivelHeroeEsperado(nv) };
    const sin = simular(P.statsHeroe(pE, []), nv, { clave: b.clave, n });
    const med = simular(P.statsHeroe(pE, EQUIPO_MEDIO), nv, { clave: b.clave, n });
    const jefe = simular(P.statsHeroe(pE, EQUIPO_MEDIO), nv, { clave: b.clave, jefe: true, pociones: 3, n });
    console.log(`| ${i} | ${b.emoji} ${b.nombre} | ${nv} | ${b.familia} / ${b.silueta} | ${f(sin.pct)} | ${f(med.pct)} | ${f(jefe.pct)} | ${sin.turnos.toFixed(1)} |`);
  }
}

// Solo imprime si se ejecuta directamente. argv[1] no existe con `node -e` ni al importarlo desde un test.
const ejecutadoDirecto = (() => {
  const arg = process.argv[1];
  if (!arg) return false;
  return import.meta.url === `file://${arg.replace(/\\/g, "/")}` || import.meta.url.endsWith(arg.split(/[\\/]/).pop());
})();

if (ejecutadoDirecto) {
  if (INFORME === "niveles" || INFORME === "todo") tablaNiveles();
  if (INFORME === "criaturas" || INFORME === "todo") tablaCriaturas();
}
