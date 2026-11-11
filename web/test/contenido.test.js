// Contenido nuevo (equipo de Juego y contenido): contrato de metadatos con el motor 3D,
// las 20 criaturas del bestiario, sus mecánicas propias y las habilidades por nivel.
// `combat.test.js` cubre el motor de combate; aquí va solo el contenido.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as C from "../js/combat.js";
import * as S from "../js/skills.js";

const neutro = () => 0.5;
const HEROE = { ...C.STATS_BASE, critico: 0.1, esquiva: 0 };
const dummy = (extra = {}) => ({ nombre: "Dummy", emoji: "🎯", nivel: 1, vidaMax: 50, ataque: 12, defensa: 3, ...extra });
const HEX = /^#[0-9a-f]{6}$/i;

/** Intención del enemigo forzada a un movimiento concreto (para probar una mecánica suelta). */
function conIntencion(enemigo, id, heroe = HEROE) {
  const c = C.crearCombate(heroe, enemigo, neutro);
  const m = C.MOVIMIENTOS[id];
  const intencion = {
    tipo: m.tipo, id, nombre: m.nombre, icono: m.icono, texto: "",
    telegrafiado: false, bloqueable: !!m.bloqueable, definitiva: false,
  };
  return { ...c, enemigo: { ...c.enemigo, intencion } };
}

// ───────────────────── Contrato con el motor 3D ─────────────────────

test("contrato 3D: cada criatura trae metadatos de la lista cerrada VALORES_3D", () => {
  for (const b of C.BESTIARIO) {
    assert.ok(C.VALORES_3D.familia.includes(b.familia), `familia de ${b.clave}: ${b.familia}`);
    assert.ok(C.VALORES_3D.silueta.includes(b.silueta), `silueta de ${b.clave}: ${b.silueta}`);
    assert.ok(C.VALORES_3D.ataque.includes(b.ataque3d), `ataque3d de ${b.clave}: ${b.ataque3d}`);
    assert.ok(b.altura >= C.VALORES_3D.altura.min && b.altura <= C.VALORES_3D.altura.max, `altura de ${b.clave}: ${b.altura}`);
    assert.match(b.color, HEX, b.clave);
    assert.match(b.colorSecundario, HEX, b.clave);
    assert.ok(b.emision === null || HEX.test(b.emision), `emisión de ${b.clave}: ${b.emision}`);
    // `guardia` y `apoyo` son animaciones de movimiento, nunca el ataque característico de una criatura.
    assert.ok(!["guardia", "apoyo"].includes(b.ataque3d), b.clave);
  }
});

test("contrato 3D: metadatos3d() devuelve justo los siete campos del contrato", () => {
  const m = C.metadatos3d("dragon");
  assert.deepEqual(Object.keys(m).sort(), ["altura", "ataque3d", "color", "colorSecundario", "emision", "familia", "silueta"]);
  assert.equal(m.familia, "dragon");
  assert.equal(m.silueta, "alado");
  assert.equal(m.ataque3d, "aliento");
  assert.equal(C.metadatos3d("no_existe"), null);
  for (const b of C.BESTIARIO) assert.ok(C.metadatos3d(b.clave), b.clave);
});

test("contrato 3D: todo movimiento y toda habilidad traen una animación válida", () => {
  for (const [id, m] of Object.entries(C.MOVIMIENTOS)) {
    assert.ok(C.VALORES_3D.ataque.includes(m.animacion3d), `${id}: ${m.animacion3d}`);
    assert.equal(C.animacion3d(id), m.animacion3d);
  }
  for (const [id, h] of Object.entries(S.HABILIDADES)) {
    assert.ok(C.VALORES_3D.ataque.includes(h.animacion3d), `${id}: ${h.animacion3d}`);
    assert.equal(C.animacion3d(id), h.animacion3d);
  }
  assert.equal(C.animacion3d("lo_que_sea"), "arma", "respaldo por defecto");
  assert.equal(C.animacion3d("lo_que_sea", "garra"), "garra");
});

test("contrato 3D: la lista cerrada no tiene valores de adorno (todos se usan)", () => {
  const animaciones = new Set([...Object.values(C.MOVIMIENTOS), ...Object.values(S.HABILIDADES)].map((x) => x.animacion3d));
  for (const v of C.VALORES_3D.ataque) assert.ok(animaciones.has(v), `animación sin usar: ${v}`);
  for (const campo of ["familia", "silueta"]) {
    const vistos = new Set(C.BESTIARIO.map((b) => b[campo]));
    for (const v of C.VALORES_3D[campo]) assert.ok(vistos.has(v), `${campo} sin usar: ${v}`);
  }
});

// ───────────────────── Bestiario de 20 ─────────────────────

test("el bestiario tiene 20 criaturas con clave única y ordenadas de menor a mayor peligro", () => {
  assert.equal(C.BESTIARIO.length, 20);
  assert.equal(new Set(C.BESTIARIO.map((b) => b.clave)).size, 20);
  assert.equal(C.BESTIARIO[0].clave, "rata", "la más débil abre el bestiario");
  assert.equal(C.BESTIARIO.at(-1).clave, "dragon", "la más peligrosa lo cierra");
  for (const b of C.BESTIARIO) {
    assert.ok(b.nombre && b.emoji && b.titulo && b.definitiva && b.rasgo, b.clave);
    assert.ok(b.patron.length >= 1, b.clave);
    for (const p of b.patron) {
      assert.ok(C.MOVIMIENTOS[p.mov], `${b.clave}: movimiento ${p.mov}`);
      assert.ok(p.prob > 0 && p.prob < 1, `${b.clave}: prob ${p.prob}`);
    }
    // La suma de probabilidades deja sitio al ataque normal.
    assert.ok(b.patron.reduce((s, p) => s + p.prob, 0) < 0.8, b.clave);
  }
});

test("las 20 criaturas pueden aparecer (y ser jefe) en algún nivel de arena", () => {
  const normales = new Set();
  const jefes = new Set();
  for (let nv = 1; nv <= C.NIVEL_MAX; nv++) {
    const r = C.mulberry32(nv * 977);
    for (let k = 0; k < 400; k++) {
      normales.add(C.generarEnemigo(nv, r).clave);
      jefes.add(C.generarEnemigo(nv, r, { jefe: true }).clave);
    }
  }
  assert.equal(normales.size, C.BESTIARIO.length);
  assert.equal(jefes.size, C.BESTIARIO.length, "el logro «Señor de señores» tiene que ser alcanzable");
});

test("claveDeNivel saca criaturas acordes al nivel y nunca sale del bestiario", () => {
  const indice = (clave) => C.BESTIARIO.findIndex((b) => b.clave === clave);
  const r = C.mulberry32(5);
  for (const nv of [1, 5, 10]) {
    for (let k = 0; k < 200; k++) {
      const cr = C.claveDeNivel(nv, r);
      assert.ok(indice(cr.clave) >= 0);
    }
  }
  assert.equal(C.claveDeNivel(1, () => 0).clave, "rata");
  assert.equal(C.claveDeNivel(10, () => 0.999).clave, "dragon");
  // Niveles fuera de rango se acotan, no lanzan.
  assert.ok(C.claveDeNivel(0, neutro).clave);
  assert.ok(C.claveDeNivel(99, neutro).clave);
});

test("los jefes tienen la esquiva topada a JEFE.esquivaMax", () => {
  const esquiva = (clave, jefe) => C.generarEnemigoDe(clave, 5, { jefe }).esquiva;
  assert.equal(esquiva("espectro", false), 0.3);
  assert.equal(esquiva("espectro", true), C.JEFE.esquivaMax);
  assert.equal(esquiva("avispa", true), C.JEFE.esquivaMax);
  assert.equal(esquiva("rata", true), 0.08, "al que ya esquiva poco no se le toca");
});

// ───────────────────── Mecánicas de las criaturas nuevas ─────────────────────

test("el murciélago bebe sangre y se cura con el daño que hace", () => {
  const murci = { ...C.generarEnemigoDe("murcielago", 5), vidaMax: 200, ataque: 30 };
  const c = conIntencion(murci, "chupar_sangre", { ...HEROE, vidaMax: 400 });
  // Primero le quitamos vida: si está a tope no hay nada que curar.
  const herido = { ...c, enemigo: { ...c.enemigo, vida: 100 } };
  const ev = C.turnoJugador(herido, "defender", neutro).eventos.find((e) => e.id === "chupar_sangre");
  assert.ok(ev, "usa chupar sangre");
  assert.ok(ev.dano > 0);
  assert.ok(ev.curacion > 0, `se cura: ${ev.curacion}`);
  assert.match(ev.texto, /Recupera/);
});

test("el enjambre de avispas pega tres veces en un turno", () => {
  const avispa = conIntencion(C.generarEnemigoDe("avispa", 5), "aguijonazos", { ...HEROE, vidaMax: 400, esquiva: 0 });
  const golpes = C.turnoJugador(avispa, "atacar", neutro).eventos.filter((e) => e.id === "aguijonazos");
  assert.equal(golpes.length, 3);
  assert.ok(golpes.every((g) => g.dano > 0));
  assert.match(golpes[2].texto, /\(3\/3\)/);
});

test("el liche se cubre con un escudo propio que absorbe tu siguiente golpe", () => {
  const liche = { ...C.generarEnemigoDe("liche", 6), vidaMax: 400, ataque: 1 };
  const c = conIntencion(liche, "barrera_hueso", { ...HEROE, vidaMax: 400 });
  const { combate: c1, eventos } = C.turnoJugador(c, "defender", neutro);
  const ev = eventos.find((e) => e.tipo === "estado" && e.actor === "enemigo");
  assert.ok(ev, "emite el estado propio");
  assert.equal(ev.objetivo, "enemigo");
  assert.equal(ev.estado.tipo, "escudo");
  assert.equal(ev.estado.valor, Math.round(400 * 0.15));
  assert.match(ev.texto, /escudo/);
  const golpe = C.turnoJugador(c1, "atacar", neutro).eventos.find((e) => e.id === "atacar");
  assert.ok(golpe.absorbido > 0, `absorbido: ${golpe.absorbido}`);
});

test("un movimiento sin `mult` solo aplica sus estados propios: no golpea", () => {
  const limo = { ...C.generarEnemigoDe("limo", 2), vidaMax: 300, ataque: 50 };
  const c = conIntencion(limo, "endurecer", { ...HEROE, vidaMax: 400 });
  const { combate: c1, eventos } = C.turnoJugador(c, "defender", neutro);
  assert.equal(c1.jugador.vida, c1.jugador.vidaMax, "el héroe no recibe daño");
  assert.equal(eventos.filter((e) => e.actor === "enemigo" && e.dano > 0).length, 0);
  assert.ok(c1.enemigo.estados.some((e) => e.tipo === "escudo"));
});

test("la quimera se enfurece sola y después pega más fuerte", () => {
  const quimera = { ...C.generarEnemigoDe("quimera", 9), vidaMax: 500 };
  const heroe = { ...HEROE, vidaMax: 600, esquiva: 0 };
  const atacar = { tipo: "atacar", id: "ataque", nombre: "Ataque", icono: "⚔️", texto: "", telegrafiado: false, bloqueable: false, definitiva: false };

  const { combate: c1, eventos } = C.turnoJugador(conIntencion(quimera, "rugido_triple", heroe), "defender", neutro);
  const ev = eventos.find((e) => e.tipo === "estado" && e.actor === "enemigo");
  assert.ok(ev && ev.estado.tipo === "furia" && ev.estado.valor === 0.25, JSON.stringify(ev?.estado));

  const dano = (combate) => C.turnoJugador(combate, "atacar", neutro).eventos.find((e) => e.actor === "enemigo" && e.dano > 0).dano;
  const sinFuria = dano(conIntencion(quimera, "ataque", heroe));
  const conFuria = dano({ ...c1, enemigo: { ...c1.enemigo, intencion: atacar } });
  assert.ok(conFuria > sinFuria, `con furia ${conFuria} vs sin furia ${sinFuria}`);
});

test("el golpe a traición del bandido no se puede esquivar", () => {
  assert.equal(C.MOVIMIENTOS.ataque_traicion.imparable, true);
  const bandido = { ...C.generarEnemigoDe("bandido", 4), ataque: 20 };
  const esquivaSegura = { ...HEROE, vidaMax: 300, esquiva: 1 };
  const normal = C.turnoJugador(conIntencion(bandido, "ataque", esquivaSegura), "atacar", neutro)
    .eventos.find((e) => e.actor === "enemigo" && e.tipo === "ataque");
  assert.equal(normal.esquivado, true, "un ataque normal sí se esquiva");
  const traicion = C.turnoJugador(conIntencion(bandido, "ataque_traicion", esquivaSegura), "atacar", neutro)
    .eventos.find((e) => e.id === "ataque_traicion");
  assert.equal(traicion.esquivado, false);
  assert.ok(traicion.dano > 0);
});

// ───────────────────── Habilidades nuevas del héroe ─────────────────────

test("las habilidades por nivel se desbloquean en los niveles 5, 10 y 15", () => {
  assert.deepEqual(S.HABILIDADES_POR_NIVEL, ["estocada_precisa", "segundo_aliento", "rompearmaduras"]);
  assert.deepEqual(S.NIVEL_HABILIDAD, { estocada_precisa: 5, segundo_aliento: 10, rompearmaduras: 15 });
  assert.deepEqual(S.habilidadesDeNivel(1), []);
  assert.deepEqual(S.habilidadesDeNivel(4), []);
  assert.deepEqual(S.habilidadesDeNivel(5), ["estocada_precisa"]);
  assert.deepEqual(S.habilidadesDeNivel(10), ["estocada_precisa", "segundo_aliento"]);
  assert.deepEqual(S.habilidadesDeNivel(30), S.HABILIDADES_POR_NIVEL);
  // idsHabilidades: básicas + las de nivel + (si hay Legendario) la especial, en ese orden.
  assert.deepEqual(S.idsHabilidades([]), [...S.HABILIDADES_BASE]);
  assert.deepEqual(S.idsHabilidades([], 15), [...S.HABILIDADES_BASE, ...S.HABILIDADES_POR_NIVEL]);
  const legendaria = [{ tipo: "Espada", rareza: 2, ataque: 9, defensa: 1 }];
  assert.deepEqual(S.idsHabilidades(legendaria, 15), [...S.HABILIDADES_BASE, ...S.HABILIDADES_POR_NIVEL, "tajo_celestial"]);
});

test("proximaHabilidad dice qué viene y en qué nivel (null cuando ya están todas)", () => {
  assert.deepEqual(S.proximaHabilidad(1), { id: "estocada_precisa", nombre: "Estocada Precisa", icono: "🗡️", nivel: 5 });
  assert.equal(S.proximaHabilidad(7).id, "segundo_aliento");
  assert.equal(S.proximaHabilidad(12).id, "rompearmaduras");
  assert.equal(S.proximaHabilidad(15), null);
  assert.equal(S.proximaHabilidad(30), null);
});

test("Estocada Precisa es imparable y suma crítico", () => {
  const d = S.HABILIDADES.estocada_precisa;
  assert.equal(d.imparable, true);
  assert.equal(d.criticoExtra, 0.15);
  const heroe = { ...HEROE, vidaMax: 400, habilidades: ["estocada_precisa"] };
  const esquivador = dummy({ vidaMax: 999, esquiva: 1, ataque: 1 });
  const ev = C.turnoJugador(C.crearCombate(heroe, esquivador, neutro), { habilidad: "estocada_precisa" }, neutro).eventos[0];
  assert.equal(ev.esquivado, false, "imparable aunque el enemigo esquive siempre");
  assert.ok(ev.dano > 0);
});

test("Segundo Aliento cura y limpia veneno y sangrado", () => {
  const d = S.HABILIDADES.segundo_aliento;
  assert.equal(d.limpia, true);
  assert.ok(d.curaPct > 0);
  const heroe = { ...HEROE, vidaMax: 400, habilidades: ["segundo_aliento"] };
  const c0 = C.crearCombate(heroe, dummy({ ataque: 1 }), neutro);
  const herido = {
    ...c0,
    jugador: { ...c0.jugador, vida: 100, estados: [{ tipo: "veneno", turnos: 3, valor: 5 }, { tipo: "sangrado", turnos: 2, valor: 4 }] },
  };
  const { combate: c1 } = C.turnoJugador(herido, { habilidad: "segundo_aliento" }, neutro);
  assert.equal(c1.jugador.estados.filter((e) => ["veneno", "sangrado"].includes(e.tipo)).length, 0);
  // 100 de vida, menos el veneno y el sangrado del inicio del turno, más el 26 % de 400.
  assert.ok(c1.jugador.vida > 150, `vida: ${c1.jugador.vida}`);
  // El aturdimiento se limpia igual, pero estando aturdido se pierde el turno y no se puede usar.
  assert.ok(d.limpia, "limpia también el aturdimiento cuando el héroe puede actuar");
});

test("Rompearmaduras deja al enemigo frágil y tu daño sube mientras dure", () => {
  const heroe = { ...HEROE, ataque: 30, vidaMax: 400, habilidades: ["rompearmaduras"] };
  const c0 = C.crearCombate(heroe, dummy({ vidaMax: 999, defensa: 40, ataque: 1 }), neutro);
  const base = C.turnoJugador(c0, "atacar", neutro).eventos[0].dano;

  const { combate: tras, eventos } = C.turnoJugador(c0, { habilidad: "rompearmaduras" }, neutro);
  const fr = tras.enemigo.estados.find((e) => e.tipo === "fragil");
  assert.ok(fr, "aplica frágil");
  // Se aplica con 3 turnos y el enemigo ya ha gastado uno al terminar la ronda: quedan 2.
  assert.equal(fr.turnos, 2);
  assert.equal(fr.valor, 0.35);
  assert.match(eventos[0].texto, /armadura rota/);

  const roto = C.turnoJugador(tras, "atacar", neutro).eventos[0].dano;
  assert.ok(roto > base, `con armadura rota ${roto} vs ${base}`);
  // Dura tres ataques del héroe (el del propio mazazo y los dos siguientes) y luego se cae.
  const t2 = C.turnoJugador(tras, "atacar", neutro).combate;
  const t3 = C.turnoJugador(t2, "atacar", neutro).combate;
  assert.ok(t2.enemigo.estados.some((e) => e.tipo === "fragil"));
  assert.equal(t3.enemigo.estados.some((e) => e.tipo === "fragil"), false);
});

test("frágil es un estado negativo: la fase 2 del jefe se lo sacude", () => {
  const heroe = { ...HEROE, ataque: 30, vidaMax: 999, habilidades: ["rompearmaduras"] };
  const jefe = { ...C.generarEnemigoDe("golem", 3, { jefe: true }), vidaMax: 100, ataque: 1 };
  const c0 = C.crearCombate(heroe, jefe, neutro);
  const { combate: c1 } = C.turnoJugador(c0, { habilidad: "rompearmaduras" }, neutro);
  assert.ok(c1.enemigo.estados.some((e) => e.tipo === "fragil"));
  // Lo bajamos del umbral de fase 2 y comprobamos que al entrar en cólera se limpia.
  const alLimite = { ...c1, enemigo: { ...c1.enemigo, vida: Math.round(100 * C.JEFE.umbralFase2) + 1 } };
  const { combate: c2 } = C.turnoJugador(alLimite, "atacar", neutro);
  assert.equal(c2.enemigo.fase, 2);
  assert.equal(c2.enemigo.estados.some((e) => e.tipo === "fragil"), false);
});

test("una lista de habilidades vacía significa «ninguna», no «las de siempre»", () => {
  // El modificador «Sin trucos» del desafío diario deja al héroe con `habilidades: []`.
  // Antes se devolvían las básicas y la interfaz pintaba botones que al pulsarlos lanzaban.
  assert.deepEqual(S.habilidadesDisponibles({ habilidades: [] }), []);
  assert.deepEqual(S.habilidadesDisponibles({ habilidades: [] }, [{ tipo: "Espada", rareza: 2, ataque: 9, defensa: 1 }]), []);
  // Sin el campo sí se calculan a partir del equipo y del nivel.
  assert.equal(S.habilidadesDisponibles({}).length, S.HABILIDADES_BASE.length);
  assert.equal(S.habilidadesDisponibles({ nivel: 15 }).length, S.HABILIDADES_BASE.length + S.HABILIDADES_POR_NIVEL.length);
});
