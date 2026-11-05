// Simulación de balance: N combates por nivel de arena 1..10 con una IA de jugador sencilla.
// Uso:  node tools/balance.mjs [combates=10000] [semilla=1]
import * as C from "../js/combat.js";
import * as P from "../js/progression.js";
import { habilidadesDisponibles } from "../js/skills.js";

const N = Number(process.argv[2]) || 10000;
const rng = C.mulberry32(Number(process.argv[3]) || 1);

/** IA sencilla: defiende ante lo telegrafiado, bebe con poca vida, usa habilidades listas. */
export function iaJugador(c) {
  if (C.jugadorAturdido(c)) return "atacar";
  const it = C.intencionEnemigo(c);
  const j = c.jugador;
  if (it?.telegrafiado) return "defender";
  if (j.vida < j.vidaMax * 0.35 && j.pociones > 0) return "pocion";
  const listas = new Set(habilidadesDisponibles(j).filter((h) => h.lista).map((h) => h.id));
  for (const id of ["tajo_celestial", "paso_sombrio", "mente_ferrea", "muro_de_fe"]) if (listas.has(id)) return { habilidad: id };
  if (listas.has("piel_de_dragon") && j.vida < j.vidaMax * 0.7) return { habilidad: "piel_de_dragon" };
  const furia = j.estados.some((e) => e.tipo === "furia");
  if (listas.has("grito_guerra") && !furia && listas.has("golpe_poderoso")) return { habilidad: "grito_guerra" };
  if (listas.has("golpe_poderoso")) return { habilidad: "golpe_poderoso" };
  if (listas.has("desangrar") && !c.enemigo.estados.some((e) => e.tipo === "sangrado")) return { habilidad: "desangrar" };
  return "atacar";
}

export function simular(heroe, nivel, { jefe = false, pociones = 1, n = N, r = rng } = {}) {
  let gana = 0, turnos = 0;
  for (let k = 0; k < n; k++) {
    const nv = jefe ? nivel : C.nivelEnemigo(nivel, r);
    let c = C.crearCombate({ ...heroe, pociones }, C.generarEnemigo(nv, r, { jefe }), r);
    let t = 0;
    while (c.fase === "en_curso" && t++ < 300) c = C.turnoJugador(c, iaJugador(c), r).combate;
    if (c.fase === "victoria") gana++;
    turnos += t;
  }
  return { pct: (100 * gana) / n, turnos: turnos / n };
}

/** Nivel de héroe esperado al llegar a un nivel de arena (5 victorias por nivel, racha media 2). */
export function nivelHeroeEsperado(arena) {
  let p = P.progresoNuevo();
  for (let a = 1; a < arena; a++) for (let v = 0; v < C.VICTORIAS_POR_NIVEL; v++) {
    p = P.sumarXp(p, P.xpPorVictoria({ nivel: a, jefe: v === C.VICTORIAS_POR_NIVEL - 1 }, 2)).progreso;
  }
  return p.nivel;
}

const it = (tipo, ataque, defensa, rareza = 0) => ({ tipo, ataque, defensa, rareza });
/** Equipo medio: 5 piezas Común/Raro. */
export const EQUIPO_MEDIO = [it("Espada", 7, 2, 1), it("Escudo", 2, 6), it("Casco", 1, 5), it("Armadura", 2, 7, 1), it("Botas", 1, 4)];

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
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
    filas.push([nv, nh, sin.pct, sin0.pct, sin3.pct, sinE.pct, med.pct, jefe.pct, sin.turnos]);
  }
  const f = (x) => `${x.toFixed(1)} %`;
  console.log(`${N} combates por celda (IA sencilla). Héroe nv 1 salvo columnas "nv esp.".`);
  console.log("| Arena | Nv héroe esp. | Sin equipo (1 poción) | Sin equipo (0) | Sin equipo (3) | Sin equipo, nv esp. | Equipo medio, nv esp. | Jefe (equipo medio, 3 poc.) | Turnos medios |");
  console.log("|---|---|---|---|---|---|---|---|---|");
  for (const r of filas) console.log(`| ${r[0]} | ${r[1]} | ${f(r[2])} | ${f(r[3])} | ${f(r[4])} | ${f(r[5])} | ${f(r[6])} | ${f(r[7])} | ${r[8].toFixed(1)} |`);
}
