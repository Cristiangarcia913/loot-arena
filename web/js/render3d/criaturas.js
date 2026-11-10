// Criaturas en 3D, construidas pieza a pieza con geometrías de three.js. Nada descargado:
// ni modelos, ni texturas, ni licencias dudosas (decisión 3 del plan maestro).
//
// Todas las funciones reciben `T` (three.js) por parámetro, así que este módulo se puede probar
// en Node con un doble de three.js.
//
// Cada criatura devuelve siempre la misma forma:
//   { raiz, alto, radio, partes, materiales, flota, colores }
// `raiz` tiene el pivote EN LOS PIES (y = 0 es el suelo), para poder plantarla en la arena sin
// cálculos. `partes` son los trozos con nombre que animamos (cabeza, brazo, cola, alas…).

import { Taller, ALTO_HEROE } from "./piezas.js";
import { colorEnemigo, rareza3d, HEROE, CLAVES_ENEMIGO } from "./paleta.js";
import { metadatos3d, BESTIARIO } from "../combat.js";

/** Cosméticos: tinte de armadura por id del catálogo (ids 1-3, los mismos que en sprites.js). */
const TINTE = { 1: [0xe05555, 0x6b0f0f], 2: [0x34d399, 0x064e3b], 3: [0x5b5677, 0x0f0d1a] };
/** Sombreros (ids 4-6): [color, tipo]. */
const SOMBREROS = { 4: [0x3b82f6, "pico"], 5: [0xf59e0b, "corona"], 6: [0x1f2937, "cuernos"] };
/** Capas (ids 7-9). */
const CAPAS = { 7: 0x6b1414, 8: 0x1d4ed8, 9: 0x7e22ce };
/** Auras (ids 10-11): anillo de luz a los pies. */
const AURAS = { 10: 0x22d3ee, 11: 0xfbbf24 };
/** Mascotas (ids 12-13): bichito que orbita. */
const MASCOTAS = { 12: 0xfde047, 13: 0xf472b6 };

const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : null);

// ───────────────────────── Héroe ─────────────────────────

/**
 * El héroe, con su equipo puesto. El equipo SE NOTA: la espada y el escudo aparecen solo si están
 * equipados y toman el color de su rareza (gris común, azul raro, dorado legendario, que es la
 * misma paleta del 2D), el casco y la armadura cambian el metal del cuerpo y las botas el calzado.
 *
 * @param {object} T three.js
 * @param {Array<{tipo:string, rareza:number}>} [equipados] lo que devuelve `equipment.equipados()`
 * @param {{color?:number|null, sombrero?:number|null, capa?:number|null, aura?:number|null, mascota?:number|null}} [apariencia]
 * @param {{segmentos?:number, sombras?:boolean}} [o]
 */
export function construirHeroe(T, equipados = [], apariencia = {}, o = {}) {
  const t = new Taller(T, o);
  const eq = {};
  for (const x of equipados ?? []) if (x?.tipo) eq[x.tipo] = Math.max(0, Math.min(2, Number(x.rareza) || 0));
  const ap = apariencia ?? {};
  const pal = (tipo) => (eq[tipo] == null ? null : rareza3d(eq[tipo]));
  const esp = pal("Espada"), esc = pal("Escudo"), cas = pal("Casco"), arm = pal("Armadura"), bot = pal("Botas");

  const tinte = TINTE[num(ap.color)];
  const matPiel = t.mat(HEROE.piel, { rugosidad: 0.85 });
  const colTorso = tinte ? tinte[0] : arm ? arm.luz : HEROE.tunica;
  const colTorsoOsc = tinte ? tinte[1] : arm ? arm.osc : 0x5a3519;
  const matTorso = t.mat(colTorso, { metal: arm ? 0.6 : 0.05, rugosidad: arm ? 0.35 : 0.8, emision: arm?.emision, fuerza: arm ? arm.fuerza * 0.35 : 0 });
  const matTorsoOsc = t.mat(colTorsoOsc, { metal: arm ? 0.5 : 0.05, rugosidad: 0.5 });
  const matBota = t.mat(bot ? bot.base : HEROE.bota, { metal: bot ? 0.5 : 0.1, rugosidad: 0.55, emision: bot?.emision, fuerza: bot ? bot.fuerza * 0.3 : 0 });
  // Los brazos van SIEMPRE de cuero oscuro, aunque la armadura sea legendaria. Con todo dorado
  // (torso, hombreras, casco, espada y escudo) el heroe era un bulto de un solo color y no se
  // leia la figura: el cuero oscuro separa las piezas de metal.
  const matCuero = t.mat(0x5a3a22, { rugosidad: 0.85, metal: 0.05 });

  const raiz = t.grupo("heroe");
  const cuerpo = t.grupo("cuerpo");
  raiz.add(cuerpo);

  // Piernas y botas
  const pierna = (s) => {
    const g = t.grupo(s < 0 ? "piernaIzq" : "piernaDer");
    g.add(t.en(t.capsula(0.085, 0.42, matTorsoOsc), 0, 0.52, 0));
    g.add(t.en(t.caja(0.2, 0.14, 0.3, matBota), 0, 0.26, 0.04));
    return g;
  };
  const piernas = t.par(pierna, 0.13);
  piernas.forEach((p) => cuerpo.add(p));

  // Torso + cinturón + hombreras
  const torso = t.grupo("torso");
  torso.add(t.en(t.capsula(0.25, 0.4, matTorso), 0, 0, 0));
  torso.add(t.en(t.toro(0.26, 0.045, t.mat(HEROE.cinturon, { rugosidad: 0.7 })), 0, -0.22, 0, { rx: Math.PI / 2 }));
  if (arm) {
    const matHombro = t.mat(arm.base, { metal: 0.75, rugosidad: 0.3, emision: arm.emision, fuerza: arm.fuerza * 0.5 });
    for (const s of [-1, 1]) torso.add(t.en(t.esfera(0.135, matHombro, 0.7), s * 0.27, 0.2, 0));
  }
  t.en(torso, 0, 1.03, 0);
  cuerpo.add(torso);

  // Cabeza (y casco si lo lleva)
  const cabeza = t.grupo("cabeza");
  cabeza.add(t.en(t.esfera(0.17, matPiel), 0, 0, 0));
  cabeza.add(t.en(t.esfera(0.175, t.mat(HEROE.pelo, { rugosidad: 0.95 }), 0.6), 0, 0.06, -0.01));
  if (cas) {
    const matCasco = t.mat(cas.base, { metal: 0.85, rugosidad: 0.25, emision: cas.emision, fuerza: cas.fuerza * 0.6 });
    cabeza.add(t.en(t.esfera(0.195, matCasco, 0.85), 0, 0.03, 0));
    cabeza.add(t.en(t.caja(0.035, 0.1, 0.34, matCasco), 0, 0.16, 0)); // cresta
    cabeza.add(t.en(t.caja(0.07, 0.13, 0.03, matCasco), 0, 0.02, 0.17)); // nasal
  }
  t.en(cabeza, 0, 1.47, 0);
  cuerpo.add(cabeza);

  // Brazo derecho con espada (o puño)
  const brazoDer = t.grupo("brazoDer");
  brazoDer.add(t.en(t.capsula(0.07, 0.3, matCuero), 0, -0.2, 0));
  brazoDer.add(t.en(t.esfera(0.075, matPiel), 0, -0.38, 0));
  const arma = t.grupo("arma");
  if (esp) {
    // La hoja es acero (que se lee como hoja); lo que cambia con la rareza es su brillo y la
    // guarda. Una hoja entera dorada parecia un palo mas del mismo color.
    const matFilo = t.mat(0xe7ecf2, { metal: 0.98, rugosidad: 0.12, emision: esp.emision, fuerza: esp.fuerza * 0.8 });
    const matGuarda = t.mat(esp.osc, { metal: 0.8, rugosidad: 0.35 });
    arma.add(t.en(t.caja(0.055, 0.74, 0.015, matFilo), 0, 0.47, 0));
    arma.add(t.en(t.cono(0.04, 0.12, matFilo), 0, 0.9, 0));
    arma.add(t.en(t.caja(0.3, 0.045, 0.05, matGuarda), 0, 0.1, 0));
    arma.add(t.en(t.cilindro(0.032, 0.032, 0.18, t.mat(0x3a2414, { rugosidad: 0.9 })), 0, 0, 0));
    arma.add(t.en(t.esfera(0.045, matGuarda), 0, -0.1, 0));
  } else {
    arma.add(t.en(t.cilindro(0.03, 0.035, 0.5, t.mat(0x6b4a2a, { rugosidad: 0.9 })), 0, 0.25, 0)); // palo
  }
  t.en(arma, 0, -0.42, 0.04, { rx: -0.25 });
  brazoDer.add(arma);
  t.en(brazoDer, 0.3, 1.2, 0, { rz: -0.18 });
  cuerpo.add(brazoDer);

  // Brazo izquierdo con escudo
  const brazoIzq = t.grupo("brazoIzq");
  brazoIzq.add(t.en(t.capsula(0.07, 0.3, matCuero), 0, -0.2, 0));
  brazoIzq.add(t.en(t.esfera(0.075, matPiel), 0, -0.38, 0));
  const escudo = t.grupo("escudo");
  if (esc) {
    const matEsc = t.mat(esc.base, { metal: 0.8, rugosidad: 0.3, emision: esc.emision, fuerza: esc.fuerza * 0.7 });
    escudo.add(t.en(t.cilindro(0.3, 0.26, 0.055, matEsc), 0, 0, 0, { rx: Math.PI / 2 }));
    escudo.add(t.en(t.esfera(0.075, t.mat(esc.luz, { metal: 0.95, rugosidad: 0.1 })), 0, 0, 0.05));
    escudo.add(t.en(t.toro(0.29, 0.028, t.mat(esc.osc, { metal: 0.7, rugosidad: 0.4 })), 0, 0, 0.01));
    t.en(escudo, -0.14, -0.4, 0.14, { ry: 0.35 });
    brazoIzq.add(escudo);
  }
  t.en(brazoIzq, -0.3, 1.2, 0, { rz: 0.18 });
  cuerpo.add(brazoIzq);

  // ── Cosméticos ──
  const extras = {};
  const somb = SOMBREROS[num(ap.sombrero)];
  if (somb) {
    const [col, tipo] = somb;
    const m = t.mat(col, { metal: tipo === "corona" ? 0.9 : 0.2, rugosidad: tipo === "corona" ? 0.2 : 0.8, emision: tipo === "corona" ? col : 0, fuerza: 0.5 });
    if (tipo === "pico") cabeza.add(t.en(t.cono(0.2, 0.42, m), 0, 0.34, 0));
    else if (tipo === "corona") {
      const aro = t.grupo("corona");
      aro.add(t.en(t.cilindro(0.19, 0.19, 0.07, m), 0, 0, 0));
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        aro.add(t.en(t.cono(0.035, 0.11, m), Math.cos(a) * 0.17, 0.08, Math.sin(a) * 0.17));
      }
      cabeza.add(t.en(aro, 0, 0.19, 0));
    } else {
      for (const s of [-1, 1]) cabeza.add(t.en(t.cono(0.05, 0.3, m), s * 0.16, 0.16, 0, { rz: s * 0.6 }));
    }
  }
  const capaCol = CAPAS[num(ap.capa)];
  if (capaCol) {
    const capa = t.grupo("capa");
    capa.add(t.en(t.plano(0.56, 0.95, t.mat(capaCol, { doble: true, rugosidad: 0.95 })), 0, -0.4, 0));
    t.en(capa, 0, 1.3, -0.2, { rx: 0.12 });
    cuerpo.add(capa);
    extras.capa = capa;
  }
  const auraCol = AURAS[num(ap.aura)];
  if (auraCol) {
    const aura = t.grupo("aura");
    aura.add(t.en(t.toro(0.55, 0.035, t.matLuz(auraCol, { opacidad: 0.75, aditivo: true })), 0, 0.03, 0, { rx: Math.PI / 2 }));
    aura.add(t.en(t.toro(0.38, 0.02, t.matLuz(auraCol, { opacidad: 0.5, aditivo: true })), 0, 0.16, 0, { rx: Math.PI / 2 }));
    raiz.add(aura);
    extras.aura = aura;
  }
  const masCol = MASCOTAS[num(ap.mascota)];
  if (masCol) {
    const mas = t.grupo("mascota");
    const cuerpoM = t.esfera(0.12, t.mat(masCol, { emision: masCol, fuerza: 0.7, rugosidad: 0.4 }));
    mas.add(t.en(cuerpoM, 0, 0, 0));
    for (const s of [-1, 1]) mas.add(t.en(t.esfera(0.05, t.matLuz(0xffffff, { opacidad: 0.85 })), s * 0.055, 0.03, 0.1));
    t.en(mas, -0.65, 1.45, 0.25);
    raiz.add(mas);
    extras.mascota = mas;
  }

  // Sombra barata: un disco oscuro a los pies (más rápido que una sombra real y siempre se ve).
  raiz.add(t.en(t.disco(0.42, t.matLuz(0x000000, { opacidad: 0.38 })), 0, 0.012, 0));

  return {
    raiz, taller: t, alto: 1.82, radio: 0.45, flota: false,
    partes: { cuerpo, torso, cabeza, brazoDer, brazoIzq, arma, escudo, piernas, ...extras },
    materiales: t.materiales,
    colores: { base: colTorso, osc: colTorsoOsc, acento: esp ? esp.luz : HEROE.metal },
    equipo: { espada: !!esp, escudo: !!esc, casco: !!cas, armadura: !!arm, botas: !!bot },
  };
}

// ───────────────────────── Enemigos: utilidades comunes ─────────────────────────

/** Dos ojos que brillan, el detalle que más vida da a un bicho de cajas. */
function ojos(t, col, { r = 0.045, x = 0.07, y = 0, z = 0.14, opacidad = 1 } = {}) {
  const g = t.grupo("ojos");
  for (const s of [-1, 1]) g.add(t.en(t.esfera(r, t.matLuz(col, { opacidad, aditivo: true })), s * x, y, z));
  return g;
}

/** Cuadrúpedo (rata, lobo): cuerpo alargado, cuatro patas, hocico y cola. */
function cuadrupedo(t, col, { largo, alturaPata, radio, hocico, orejas, cola, matCuerpo, matOsc }) {
  const raiz = t.grupo("cuadrupedo");
  const cuerpo = t.grupo("cuerpo");
  const tronco = t.capsula(radio, largo, matCuerpo);
  t.en(tronco, 0, 0, 0, { rz: Math.PI / 2 });
  cuerpo.add(tronco);

  const cabeza = t.grupo("cabeza");
  cabeza.add(t.en(t.esfera(radio * 0.85, matCuerpo), 0, 0, 0));
  cabeza.add(t.en(t.cono(radio * 0.5, hocico, matOsc), 0, -0.02, radio * 0.75 + hocico * 0.4, { rx: Math.PI / 2 }));
  cabeza.add(ojos(t, col.acento || 0xfbbf24, { r: radio * 0.17, x: radio * 0.33, y: radio * 0.22, z: radio * 0.72 }));
  for (const s of [-1, 1]) cabeza.add(t.en(t.cono(orejas * 0.55, orejas, matOsc), s * radio * 0.42, radio * 0.75, -0.02, { rz: s * 0.3 }));
  t.en(cabeza, 0, radio * 0.45, largo / 2 + radio * 0.5);
  cuerpo.add(cabeza);

  const matPata = matOsc;
  const patas = [];
  for (const z of [largo * 0.32, -largo * 0.32]) {
    for (const s of [-1, 1]) {
      const p = t.grupo("pata");
      p.add(t.en(t.capsula(radio * 0.22, alturaPata * 0.7, matPata), 0, -alturaPata / 2, 0));
      t.en(p, s * radio * 0.72, 0, z);
      patas.push(p);
      cuerpo.add(p);
    }
  }

  const colaG = t.grupo("cola");
  let prev = colaG;
  for (let i = 0; i < 4; i++) {
    const seg = t.grupo(`cola${i}`);
    seg.add(t.en(t.capsula(radio * (0.16 - i * 0.03), cola / 4, matOsc), 0, 0, -cola / 8));
    t.en(seg, 0, 0, -cola / 4);
    prev.add(seg);
    prev = seg;
  }
  t.en(colaG, 0, radio * 0.2, -largo / 2 - radio * 0.3);
  cuerpo.add(colaG);

  t.en(cuerpo, 0, alturaPata + radio, 0);
  raiz.add(cuerpo);
  raiz.add(t.en(t.disco(largo * 0.55, t.matLuz(0x000000, { opacidad: 0.35 })), 0, 0.012, 0));
  return { raiz, cuerpo, cabeza, patas, cola: colaG };
}

/**
 * Humanoide (goblin, orco, esqueleto, hechicero, jefe): torso, cabeza, dos brazos y dos piernas,
 * con proporciones a medida. Devuelve los trozos para animarlos.
 */
function humanoide(t, { alto, ancho, matCuerpo, matOsc, cabezaR, cuello = 0, hombros = 1 }) {
  const raiz = t.grupo("humanoide");
  const cuerpo = t.grupo("cuerpo");
  const hCadera = alto * 0.46;

  const piernas = [];
  for (const s of [-1, 1]) {
    const p = t.grupo("pierna");
    p.add(t.en(t.capsula(ancho * 0.16, hCadera * 0.6, matOsc), 0, hCadera * 0.5, 0));
    p.add(t.en(t.caja(ancho * 0.3, alto * 0.05, ancho * 0.42, matOsc), 0, alto * 0.03, ancho * 0.07));
    t.en(p, s * ancho * 0.26, 0, 0);
    piernas.push(p);
    cuerpo.add(p);
  }

  const torso = t.grupo("torso");
  torso.add(t.en(t.capsula(ancho * 0.42, alto * 0.24, matCuerpo), 0, 0, 0));
  for (const s of [-1, 1]) torso.add(t.en(t.esfera(ancho * 0.26 * hombros, matOsc, 0.75), s * ancho * 0.46 * hombros, alto * 0.11, 0));
  t.en(torso, 0, hCadera + alto * 0.16, 0);
  cuerpo.add(torso);

  const cabeza = t.grupo("cabeza");
  cabeza.add(t.en(t.esfera(cabezaR, matCuerpo), 0, 0, 0));
  t.en(cabeza, 0, hCadera + alto * 0.3 + cuello + cabezaR * 0.7, 0);
  cuerpo.add(cabeza);

  const brazos = {};
  for (const s of [-1, 1]) {
    const b = t.grupo(s < 0 ? "brazoIzq" : "brazoDer");
    b.add(t.en(t.capsula(ancho * 0.13, alto * 0.2, matCuerpo), 0, -alto * 0.13, 0));
    b.add(t.en(t.esfera(ancho * 0.15, matOsc), 0, -alto * 0.25, 0));
    t.en(b, s * ancho * 0.5 * hombros, hCadera + alto * 0.26, 0, { rz: -s * 0.16 });
    brazos[s < 0 ? "izq" : "der"] = b;
    cuerpo.add(b);
  }

  raiz.add(cuerpo);
  raiz.add(t.en(t.disco(ancho * 0.85, t.matLuz(0x000000, { opacidad: 0.35 })), 0, 0.012, 0));
  return { raiz, cuerpo, torso, cabeza, brazoIzq: brazos.izq, brazoDer: brazos.der, piernas };
}

// ───────────────────────── Los diez del bestiario + el jefe ─────────────────────────

const RECETAS = {
  rata(t, c) {
    const m = t.mat(c.base, { rugosidad: 0.9 }), mo = t.mat(c.osc, { rugosidad: 0.95 });
    const p = cuadrupedo(t, c, { largo: 0.72, alturaPata: 0.2, radio: 0.21, hocico: 0.2, orejas: 0.14, cola: 0.8, matCuerpo: m, matOsc: mo });
    p.raiz.add(t.en(t.toro(0.1, 0.02, t.mat(c.acento, { rugosidad: 0.8 })), 0, 0.5, 0.42, { rx: 1.2 })); // dientes
    return { ...p, alto: 0.62, radio: 0.5 };
  },

  lobo(t, c) {
    const m = t.mat(c.base, { rugosidad: 0.95, plano: true }), mo = t.mat(c.osc, { rugosidad: 0.95 });
    const p = cuadrupedo(t, c, { largo: 1.05, alturaPata: 0.42, radio: 0.28, hocico: 0.26, orejas: 0.2, cola: 0.7, matCuerpo: m, matOsc: mo });
    // Crin de pelos puntiagudos por el lomo
    const crin = t.mat(c.osc, { rugosidad: 1, plano: true });
    for (let i = 0; i < 6; i++) p.cuerpo.add(t.en(t.cono(0.05, 0.18, crin), 0, 0.28, 0.4 - i * 0.16, { rx: -0.3 }));
    return { ...p, alto: 1.05, radio: 0.7 };
  },

  goblin(t, c) {
    const m = t.mat(c.base, { rugosidad: 0.85 }), mo = t.mat(c.osc, { rugosidad: 0.9 });
    const h = humanoide(t, { alto: 1.15, ancho: 0.42, matCuerpo: m, matOsc: mo, cabezaR: 0.23, hombros: 0.9 });
    // Orejas enormes y nariz: la silueta del goblin
    for (const s of [-1, 1]) h.cabeza.add(t.en(t.cono(0.07, 0.3, m), s * 0.22, 0.04, -0.02, { rz: s * 1.3 }));
    h.cabeza.add(t.en(t.cono(0.05, 0.14, m), 0, -0.02, 0.22, { rx: Math.PI / 2 }));
    h.cabeza.add(ojos(t, 0xfde047, { r: 0.035, x: 0.085, y: 0.05, z: 0.19 }));
    // Daga oxidada
    const daga = t.grupo("arma");
    daga.add(t.en(t.caja(0.05, 0.34, 0.012, t.mat(c.acento, { metal: 0.7, rugosidad: 0.5 })), 0, 0.2, 0));
    daga.add(t.en(t.cilindro(0.025, 0.025, 0.1, mo), 0, 0, 0));
    t.en(daga, 0, -0.3, 0.05, { rx: -0.4 });
    h.brazoDer.add(daga);
    // Saco de botín
    h.cuerpo.add(t.en(t.esfera(0.16, t.mat(0x6b4a2a, { rugosidad: 1 })), -0.3, 0.72, -0.16));
    return { ...h, arma: daga, alto: 1.2, radio: 0.4 };
  },

  esqueleto(t, c) {
    const m = t.mat(c.base, { rugosidad: 0.75, plano: true }), mo = t.mat(c.osc, { rugosidad: 0.85, plano: true });
    const h = humanoide(t, { alto: 1.7, ancho: 0.44, matCuerpo: m, matOsc: mo, cabezaR: 0.19, cuello: 0.05, hombros: 0.95 });
    // Costillas en lugar de torso macizo
    h.torso.scale.set(0.62, 1, 0.55);
    for (let i = 0; i < 4; i++) h.torso.add(t.en(t.toro(0.19 - i * 0.012, 0.022, m), 0, 0.17 - i * 0.1, 0, { rx: Math.PI / 2, esc: [1, 1, 0.75] }));
    h.torso.add(t.en(t.caja(0.05, 0.4, 0.05, m), 0, 0, 0)); // columna
    // Calavera: mandíbula y cuencas encendidas
    h.cabeza.add(t.en(t.caja(0.17, 0.07, 0.14, m), 0, -0.14, 0.03));
    h.cabeza.add(ojos(t, c.emision, { r: 0.04, x: 0.075, y: 0.02, z: 0.15 }));
    // Espada mellada
    const arma = t.grupo("arma");
    arma.add(t.en(t.caja(0.07, 0.6, 0.015, t.mat(0xb8c0cc, { metal: 0.85, rugosidad: 0.45 })), 0, 0.35, 0));
    arma.add(t.en(t.cilindro(0.03, 0.03, 0.14, mo), 0, 0, 0));
    t.en(arma, 0, -0.44, 0.04, { rx: -0.3 });
    h.brazoDer.add(arma);
    return { ...h, arma, alto: 1.72, radio: 0.42 };
  },

  arana(t, c) {
    const m = t.mat(c.base, { rugosidad: 0.55, plano: true }), mo = t.mat(c.osc, { rugosidad: 0.6 });
    const raiz = t.grupo("arana");
    const cuerpo = t.grupo("cuerpo");
    const abdomen = t.esfera(0.42, m);
    cuerpo.add(t.en(abdomen, 0, 0, -0.38));
    cuerpo.add(t.en(t.toro(0.3, 0.05, t.mat(c.acento, { emision: c.emision, fuerza: 0.7, rugosidad: 0.4 })), 0, 0.12, -0.4, { rx: 1.4 })); // marca roja
    const cabeza = t.grupo("cabeza");
    cabeza.add(t.en(t.esfera(0.26, mo), 0, 0, 0));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI - Math.PI / 8;
      cabeza.add(t.en(t.esfera(0.05, t.matLuz(c.acento, { aditivo: true })), Math.cos(a) * 0.17 - 0.085, 0.07 + (i % 2) * 0.07, 0.19));
    }
    for (const s of [-1, 1]) cabeza.add(t.en(t.cono(0.04, 0.16, t.mat(c.acento, { rugosidad: 0.4 })), s * 0.09, -0.14, 0.14, { rx: 2.4 })); // colmillos
    t.en(cabeza, 0, 0.02, 0.2);
    cuerpo.add(cabeza);
    // Ocho patas de dos tramos
    const patas = [];
    for (let i = 0; i < 4; i++) {
      for (const s of [-1, 1]) {
        const p = t.grupo("pata");
        const muslo = t.capsula(0.038, 0.42, mo);
        t.en(muslo, s * 0.2, 0.16, 0, { rz: -s * 0.9 });
        p.add(muslo);
        const tibia = t.capsula(0.03, 0.44, mo);
        t.en(tibia, s * 0.42, -0.08, 0, { rz: s * 0.5 });
        p.add(tibia);
        t.en(p, 0, 0, 0.1 - i * 0.2, { ry: s * (0.35 - i * 0.22) });
        patas.push(p);
        cuerpo.add(p);
      }
    }
    t.en(cuerpo, 0, 0.5, 0);
    raiz.add(cuerpo);
    raiz.add(t.en(t.disco(0.85, t.matLuz(0x000000, { opacidad: 0.33 })), 0, 0.012, 0));
    return { raiz, cuerpo, cabeza, patas, alto: 0.95, radio: 0.9 };
  },

  orco(t, c) {
    const m = t.mat(c.base, { rugosidad: 0.85 }), mo = t.mat(c.osc, { rugosidad: 0.9 });
    const h = humanoide(t, { alto: 1.95, ancho: 0.72, matCuerpo: m, matOsc: mo, cabezaR: 0.26, hombros: 1.25 });
    h.cabeza.add(t.en(t.caja(0.3, 0.12, 0.2, m), 0, -0.14, 0.06)); // mandíbula
    for (const s of [-1, 1]) h.cabeza.add(t.en(t.cono(0.035, 0.15, t.mat(0xf5f0e0, { rugosidad: 0.4 })), s * 0.1, -0.1, 0.14, { rx: 0.2 })); // colmillos
    h.cabeza.add(ojos(t, 0xef4444, { r: 0.035, x: 0.1, y: 0.05, z: 0.22 }));
    // Hacha de dos hojas
    const arma = t.grupo("arma");
    const matHoja = t.mat(0x9ca3af, { metal: 0.85, rugosidad: 0.4 });
    arma.add(t.en(t.cilindro(0.04, 0.045, 0.95, t.mat(0x4a3526, { rugosidad: 0.95 })), 0, 0.3, 0));
    for (const s of [-1, 1]) arma.add(t.en(t.cono(0.22, 0.34, matHoja), s * 0.17, 0.7, 0, { rz: s * 1.6, esc: [1, 1, 0.22] }));
    t.en(arma, 0, -0.5, 0.08, { rx: -0.35 });
    h.brazoDer.add(arma);
    return { ...h, arma, alto: 2.0, radio: 0.72 };
  },

  espectro(t, c) {
    const m = t.mat(c.base, { emision: c.emision, fuerza: c.fuerza, opacidad: 0.5, rugosidad: 0.2, doble: true });
    const raiz = t.grupo("espectro");
    const cuerpo = t.grupo("cuerpo");
    // Túnica: cono invertido que se deshilacha hacia abajo
    cuerpo.add(t.en(t.cono(0.46, 1.25, m), 0, 0, 0, { rx: Math.PI }));
    const jirones = [];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const j = t.en(t.cono(0.07, 0.45, m), Math.cos(a) * 0.3, -0.72, Math.sin(a) * 0.3, { rx: Math.PI });
      jirones.push(j);
      cuerpo.add(j);
    }
    const cabeza = t.grupo("cabeza");
    cabeza.add(t.en(t.esfera(0.21, m, 1.1), 0, 0, 0));
    cabeza.add(t.en(t.cono(0.27, 0.42, t.mat(c.osc, { opacidad: 0.75, rugosidad: 0.4, doble: true })), 0, 0.1, -0.03)); // capucha
    cabeza.add(ojos(t, 0xffffff, { r: 0.045, x: 0.075, y: 0, z: 0.16 }));
    t.en(cabeza, 0, 0.62, 0);
    cuerpo.add(cabeza);
    for (const s of [-1, 1]) {
      const b = t.grupo("brazo");
      b.add(t.en(t.capsula(0.065, 0.42, m), 0, -0.2, 0));
      t.en(b, s * 0.4, 0.42, 0.06, { rz: -s * 0.5 });
      cuerpo.add(b);
    }
    t.en(cuerpo, 0, 1.0, 0);
    raiz.add(cuerpo);
    return { raiz, cuerpo, cabeza, jirones, alto: 1.75, radio: 0.5, flota: true };
  },

  golem(t, c) {
    const m = t.mat(c.base, { rugosidad: 0.95, plano: true }), mo = t.mat(c.osc, { rugosidad: 1, plano: true });
    const grieta = t.mat(c.acento, { emision: c.emision, fuerza: c.fuerza, rugosidad: 0.5 });
    const raiz = t.grupo("golem");
    const cuerpo = t.grupo("cuerpo");
    for (const s of [-1, 1]) {
      const p = t.grupo("pierna");
      p.add(t.en(t.roca(0.26, mo), 0, 0.3, 0, { esc: [1, 1.5, 1] }));
      p.add(t.en(t.caja(0.42, 0.18, 0.5, mo), 0, 0.09, 0.04));
      t.en(p, s * 0.32, 0, 0);
      cuerpo.add(p);
    }
    const torso = t.grupo("torso");
    torso.add(t.en(t.roca(0.68, m, 1), 0, 0, 0, { esc: [1, 1.15, 0.8] }));
    torso.add(t.en(t.caja(0.1, 0.52, 0.06, grieta), 0.05, 0.02, 0.5, { rz: 0.3 }));
    torso.add(t.en(t.caja(0.08, 0.3, 0.06, grieta), -0.22, -0.1, 0.48, { rz: -0.5 }));
    t.en(torso, 0, 1.3, 0);
    cuerpo.add(torso);
    const cabeza = t.grupo("cabeza");
    cabeza.add(t.en(t.roca(0.3, m, 0), 0, 0, 0, { esc: [1, 0.9, 0.9] }));
    cabeza.add(ojos(t, c.emision, { r: 0.055, x: 0.1, y: 0.02, z: 0.24 }));
    t.en(cabeza, 0, 1.95, 0.02);
    cuerpo.add(cabeza);
    const brazos = {};
    for (const s of [-1, 1]) {
      const b = t.grupo("brazo");
      b.add(t.en(t.roca(0.22, mo, 0), 0, -0.25, 0, { esc: [1, 1.6, 1] }));
      b.add(t.en(t.roca(0.3, m, 0), 0, -0.68, 0)); // puño
      t.en(b, s * 0.78, 1.5, 0, { rz: -s * 0.1 });
      brazos[s < 0 ? "brazoIzq" : "brazoDer"] = b;
      cuerpo.add(b);
    }
    raiz.add(cuerpo);
    raiz.add(t.en(t.disco(1, t.matLuz(0x000000, { opacidad: 0.4 })), 0, 0.012, 0));
    return { raiz, cuerpo, torso, cabeza, ...brazos, alto: 2.3, radio: 1, piernas: [] };
  },

  hechicero(t, c) {
    const m = t.mat(c.base, { rugosidad: 0.8, doble: true }), mo = t.mat(c.osc, { rugosidad: 0.85, doble: true });
    const raiz = t.grupo("hechicero");
    const cuerpo = t.grupo("cuerpo");
    cuerpo.add(t.en(t.cono(0.44, 1.2, m), 0, 0, 0)); // túnica larga
    cuerpo.add(t.en(t.toro(0.2, 0.04, t.mat(c.acento, { emision: c.acento, fuerza: 0.6, rugosidad: 0.4 })), 0, 0.42, 0, { rx: Math.PI / 2 })); // collar
    const cabeza = t.grupo("cabeza");
    cabeza.add(t.en(t.esfera(0.18, t.mat(0xcbb79a, { rugosidad: 0.85 })), 0, 0, 0));
    cabeza.add(t.en(t.cono(0.3, 0.65, mo), 0, 0.42, -0.02, { rx: -0.12 })); // sombrero de pico
    cabeza.add(t.en(t.cilindro(0.3, 0.3, 0.03, mo), 0, 0.12, -0.01)); // ala del sombrero
    cabeza.add(t.en(t.esfera(0.21, t.mat(0xe5e7eb, { rugosidad: 0.95 }), 1.6), 0, -0.14, -0.06)); // barba
    cabeza.add(ojos(t, c.acento, { r: 0.03, x: 0.07, y: 0.02, z: 0.16 }));
    t.en(cabeza, 0, 0.78, 0);
    cuerpo.add(cabeza);
    const brazos = {};
    for (const s of [-1, 1]) {
      const b = t.grupo("brazo");
      b.add(t.en(t.capsula(0.08, 0.38, m), 0, -0.2, 0));
      t.en(b, s * 0.36, 0.5, 0.04, { rz: -s * 0.25 });
      brazos[s < 0 ? "brazoIzq" : "brazoDer"] = b;
      cuerpo.add(b);
    }
    // Bastón con orbe: la fuente de luz del bicho
    const arma = t.grupo("arma");
    arma.add(t.en(t.cilindro(0.03, 0.035, 1.5, t.mat(0x4a3526, { rugosidad: 0.95 })), 0, 0.35, 0));
    const orbe = t.esfera(0.13, t.matLuz(c.acento, { aditivo: true, opacidad: 0.95 }));
    arma.add(t.en(orbe, 0, 1.14, 0));
    arma.add(t.en(t.toro(0.19, 0.02, t.mat(c.acento, { emision: c.acento, fuerza: 1, rugosidad: 0.3 })), 0, 1.14, 0, { rx: 1.1 }));
    t.en(arma, 0, -0.34, 0.05, { rx: -0.1 });
    brazos.brazoDer.add(arma);
    t.en(cuerpo, 0, 0.6, 0);
    raiz.add(cuerpo);
    raiz.add(t.en(t.disco(0.55, t.matLuz(0x000000, { opacidad: 0.35 })), 0, 0.012, 0));
    return { raiz, cuerpo, cabeza, ...brazos, arma, orbe, alto: 1.9, radio: 0.5 };
  },

  dragon(t, c) {
    const m = t.mat(c.base, { rugosidad: 0.6, plano: true }), mo = t.mat(c.osc, { rugosidad: 0.7, plano: true });
    const mAla = t.mat(c.osc, { rugosidad: 0.8, doble: true, opacidad: 0.95 });
    const raiz = t.grupo("dragon");
    const cuerpo = t.grupo("cuerpo");
    const tronco = t.capsula(0.52, 0.9, m);
    t.en(tronco, 0, 0, 0, { rz: Math.PI / 2 });
    cuerpo.add(tronco);
    // Pecho encendido: tiene que verse el fuego dentro, no taparle el cuerpo. Mas pequeno, mas
    // metido y menos brillante que en el primer intento, donde parecia un huevo pegado delante.
    cuerpo.add(t.en(t.esfera(0.22, t.mat(c.acento, { emision: c.emision, fuerza: 0.5, rugosidad: 0.5 }), 0.8), 0, -0.2, 0.36));
    for (let i = 0; i < 5; i++) {  // escamas del vientre
      cuerpo.add(t.en(t.caja(0.34, 0.07, 0.05, t.mat(c.acento, { rugosidad: 0.6 })), 0, -0.42, 0.3 - i * 0.16, { rx: 0.1 }));
    }

    // Cuello articulado + cabeza
    const cuello = t.grupo("cuello");
    let prev = cuello;
    for (let i = 0; i < 3; i++) {
      const seg = t.grupo(`cuello${i}`);
      seg.add(t.en(t.capsula(0.22 - i * 0.03, 0.3, m), 0, 0.2, 0));
      t.en(seg, 0, i ? 0.34 : 0, i ? 0.06 : 0, { rx: i ? -0.18 : -0.5 });
      prev.add(seg);
      prev = seg;
    }
    const cabeza = t.grupo("cabeza");
    cabeza.add(t.en(t.esfera(0.26, m, 0.85), 0, 0, 0));
    cabeza.add(t.en(t.cono(0.17, 0.42, mo), 0, -0.04, 0.3, { rx: Math.PI / 2 })); // morro
    for (const s of [-1, 1]) cabeza.add(t.en(t.cono(0.055, 0.34, mo), s * 0.14, 0.2, -0.1, { rx: -0.5, rz: s * 0.4 })); // cuernos
    cabeza.add(ojos(t, c.acento, { r: 0.05, x: 0.13, y: 0.08, z: 0.2 }));
    t.en(cabeza, 0, 0.4, 0.1);
    prev.add(cabeza);
    t.en(cuello, 0, 0.3, 0.42);
    cuerpo.add(cuello);

    // Alas: dos planos con tres dedos cada uno
    const alas = [];
    for (const s of [-1, 1]) {
      const a = t.grupo("ala");
      const membrana = t.plano(1.5, 0.95, mAla);
      t.en(membrana, s * 0.78, 0.15, -0.1, { ry: s * 0.25, rz: s * 0.2 });
      a.add(membrana);
      for (let i = 0; i < 3; i++) {
        a.add(t.en(t.capsula(0.028, 0.9, mo), s * (0.5 + i * 0.3), 0.3 - i * 0.12, -0.1, { rz: s * (1.1 - i * 0.25) }));
      }
      t.en(a, s * 0.3, 0.3, -0.05);
      alas.push(a);
      cuerpo.add(a);
    }

    // Patas
    const patas = [];
    for (const z of [0.3, -0.34]) {
      for (const s of [-1, 1]) {
        const p = t.grupo("pata");
        p.add(t.en(t.capsula(0.1, 0.4, mo), 0, -0.28, 0));
        p.add(t.en(t.caja(0.26, 0.1, 0.34, mo), 0, -0.52, 0.08));
        t.en(p, s * 0.42, 0, z);
        patas.push(p);
        cuerpo.add(p);
      }
    }
    // Cola con pinchos
    const cola = t.grupo("cola");
    prev = cola;
    for (let i = 0; i < 5; i++) {
      const seg = t.grupo(`cola${i}`);
      seg.add(t.en(t.capsula(0.17 - i * 0.028, 0.26, m), 0, 0, -0.13));
      seg.add(t.en(t.cono(0.05, 0.14, mo), 0, 0.14 - i * 0.01, -0.13, { rx: -0.3 }));
      t.en(seg, 0, 0, -0.26);
      prev.add(seg);
      prev = seg;
    }
    t.en(cola, 0, 0.1, -0.6);
    cuerpo.add(cola);

    t.en(cuerpo, 0, 1.0, 0);
    raiz.add(cuerpo);
    raiz.add(t.en(t.disco(1.2, t.matLuz(0x000000, { opacidad: 0.4 })), 0, 0.012, 0));
    return { raiz, cuerpo, cuello, cabeza, alas, patas, cola, alto: 2.4, radio: 1.3 };
  },

  /** El jefe: un caudillo acorazado, el único que no sale del bestiario. */
  jefe(t, c) {
    const m = t.mat(c.base, { metal: 0.8, rugosidad: 0.3 }), mo = t.mat(c.osc, { metal: 0.6, rugosidad: 0.4 });
    const oro = t.mat(c.acento, { metal: 0.95, rugosidad: 0.2, emision: c.acento, fuerza: 0.5 });
    const h = humanoide(t, { alto: 2.5, ancho: 0.95, matCuerpo: m, matOsc: mo, cabezaR: 0.3, hombros: 1.35 });
    // Yelmo cerrado con rejilla y cuernos
    h.cabeza.add(t.en(t.esfera(0.33, mo, 0.95), 0, 0.02, 0));
    h.cabeza.add(t.en(t.caja(0.3, 0.1, 0.06, oro), 0, -0.04, 0.28));
    for (const s of [-1, 1]) h.cabeza.add(t.en(t.cono(0.07, 0.46, oro), s * 0.26, 0.16, -0.04, { rz: s * 1.1, rx: -0.3 }));
    h.cabeza.add(ojos(t, c.emision, { r: 0.05, x: 0.1, y: 0.0, z: 0.28 }));
    // Capa y hombreras con pinchos
    for (const s of [-1, 1]) {
      for (let i = 0; i < 3; i++) h.torso.add(t.en(t.cono(0.05, 0.2, oro), s * (0.56 + i * 0.03), 0.34 - i * 0.02, -0.14 + i * 0.14, { rz: s * 0.5 }));
    }
    const capa = t.grupo("capa");
    capa.add(t.en(t.plano(1.05, 1.7, t.mat(0x7f1d1d, { doble: true, rugosidad: 0.95 })), 0, -0.8, 0));
    t.en(capa, 0, 2.05, -0.3, { rx: 0.14 });
    h.cuerpo.add(capa);
    // Espadón
    const arma = t.grupo("arma");
    arma.add(t.en(t.caja(0.14, 1.7, 0.035, t.mat(0xd1d5db, { metal: 0.95, rugosidad: 0.15, emision: c.emision, fuerza: 0.35 })), 0, 1, 0));
    arma.add(t.en(t.cono(0.1, 0.26, t.mat(0xd1d5db, { metal: 0.95, rugosidad: 0.15 })), 0, 1.95, 0));
    arma.add(t.en(t.caja(0.62, 0.08, 0.09, oro), 0, 0.13, 0));
    arma.add(t.en(t.cilindro(0.045, 0.045, 0.28, mo), 0, 0, 0));
    t.en(arma, 0, -0.66, 0.1, { rx: -0.3 });
    h.brazoDer.add(arma);
    // Aura de jefe a los pies
    const aura = t.en(t.toro(0.95, 0.05, t.matLuz(c.emision, { aditivo: true, opacidad: 0.6 })), 0, 0.05, 0, { rx: Math.PI / 2 });
    h.raiz.add(aura);
    return { ...h, arma, capa, aura, alto: 2.6, radio: 1 };
  },
};

// ───────────────────────── Siluetas genéricas ─────────────────────────
//
// El bestiario de `combat.js` ya no son diez criaturas fijas: el equipo de contenido lo amplía y
// cada entrada declara su `silueta` (contrato VALORES_3D). Las once criaturas con receta propia
// se siguen construyendo a mano, porque quedan mejor; cualquier criatura nueva se construye por
// su silueta con el color y la altura que ella misma declara. Así, cuando el equipo de contenido
// añade un bicho, aparece en 3D sin que este equipo toque nada.

const SILUETAS = {
  cuadrupedo(t, c) {
    const m = t.mat(c.base, { rugosidad: 0.9, plano: true }), mo = t.mat(c.osc, { rugosidad: 0.95 });
    const p = cuadrupedo(t, c, { largo: 0.95, alturaPata: 0.38, radio: 0.27, hocico: 0.24, orejas: 0.17, cola: 0.7, matCuerpo: m, matOsc: mo });
    return { ...p, alto: 1.0, radio: 0.68 };
  },

  bipedo(t, c) {
    const m = t.mat(c.base, { rugosidad: 0.85 }), mo = t.mat(c.osc, { rugosidad: 0.9 });
    const h = humanoide(t, { alto: 1.7, ancho: 0.5, matCuerpo: m, matOsc: mo, cabezaR: 0.2, cuello: 0.03 });
    h.cabeza.add(ojos(t, c.acento, { r: 0.035, x: 0.075, y: 0.03, z: 0.17 }));
    const arma = t.grupo("arma");
    arma.add(t.en(t.caja(0.06, 0.52, 0.015, t.mat(c.acento, { metal: 0.8, rugosidad: 0.35 })), 0, 0.3, 0));
    arma.add(t.en(t.cilindro(0.028, 0.028, 0.13, mo), 0, 0, 0));
    t.en(arma, 0, -0.44, 0.05, { rx: -0.3 });
    h.brazoDer.add(arma);
    return { ...h, arma, alto: 1.72, radio: 0.46 };
  },

  aracnido: (t, c) => RECETAS.arana(t, c),
  flotante: (t, c) => RECETAS.espectro(t, c),

  /** Reptante (limo, basilisco): cuerpo bajo y pegado al suelo, sin patas largas. */
  reptante(t, c) {
    const m = t.mat(c.base, { rugosidad: 0.55, opacidad: 0.92, plano: true });
    const mo = t.mat(c.osc, { rugosidad: 0.7, plano: true });
    const raiz = t.grupo("reptante");
    const cuerpo = t.grupo("cuerpo");
    // Tres bultos de menos a más, como un cuerpo que se arrastra
    const bultos = [];
    for (const [i, r] of [0.42, 0.33, 0.22].entries()) {
      const b = t.esfera(r, i ? m : m, 0.78);
      t.en(b, 0, r * 0.7, 0.3 - i * 0.42);
      bultos.push(b);
      cuerpo.add(b);
    }
    const cabeza = t.grupo("cabeza");
    cabeza.add(t.en(t.esfera(0.24, m, 0.8), 0, 0, 0));
    cabeza.add(t.en(t.cono(0.13, 0.26, mo), 0, -0.03, 0.24, { rx: Math.PI / 2 }));
    cabeza.add(ojos(t, c.acento, { r: 0.04, x: 0.1, y: 0.09, z: 0.16 }));
    for (let i = 0; i < 4; i++) cabeza.add(t.en(t.cono(0.035, 0.14, mo), 0, 0.2, 0.1 - i * 0.14, { rx: -0.25 }));
    t.en(cabeza, 0, 0.3, 0.58);
    cuerpo.add(cabeza);
    const cola = t.grupo("cola");
    let prev = cola;
    for (let i = 0; i < 4; i++) {
      const seg = t.grupo(`cola${i}`);
      seg.add(t.en(t.capsula(0.12 - i * 0.025, 0.2, mo), 0, 0, -0.1));
      t.en(seg, 0, 0, -0.2);
      prev.add(seg);
      prev = seg;
    }
    t.en(cola, 0, 0.18, -0.6);
    cuerpo.add(cola);
    raiz.add(cuerpo);
    raiz.add(t.en(t.disco(0.75, t.matLuz(0x000000, { opacidad: 0.35 })), 0, 0.012, 0));
    return { raiz, cuerpo, cabeza, cola, bultos, alto: 0.72, radio: 0.75 };
  },

  /** Alado (murciélago, avispas, arpía): se mantiene en el aire batiendo las alas. */
  alado(t, c) {
    const m = t.mat(c.base, { rugosidad: 0.7, plano: true });
    const mo = t.mat(c.osc, { rugosidad: 0.8 });
    const mAla = t.mat(c.acento, { rugosidad: 0.85, doble: true, opacidad: 0.9 });
    const raiz = t.grupo("alado");
    const cuerpo = t.grupo("cuerpo");
    const tronco = t.capsula(0.2, 0.42, m);
    t.en(tronco, 0, 0, 0, { rx: 0.25 });
    cuerpo.add(tronco);
    const cabeza = t.grupo("cabeza");
    cabeza.add(t.en(t.esfera(0.18, m), 0, 0, 0));
    cabeza.add(t.en(t.cono(0.09, 0.18, mo), 0, -0.04, 0.18, { rx: Math.PI / 2 }));
    for (const sg of [-1, 1]) cabeza.add(t.en(t.cono(0.07, 0.26, mo), sg * 0.11, 0.17, -0.02, { rz: sg * 0.35 }));
    cabeza.add(ojos(t, c.acento, { r: 0.035, x: 0.07, y: 0.03, z: 0.15 }));
    t.en(cabeza, 0, 0.36, 0.1);
    cuerpo.add(cabeza);
    const alas = [];
    for (const sg of [-1, 1]) {
      const a = t.grupo("ala");
      a.add(t.en(t.plano(1.0, 0.62, mAla), sg * 0.56, 0.05, -0.04, { ry: sg * 0.2, rz: sg * 0.18 }));
      for (let i = 0; i < 3; i++) a.add(t.en(t.capsula(0.02, 0.6, mo), sg * (0.35 + i * 0.2), 0.16 - i * 0.1, -0.04, { rz: sg * (1.1 - i * 0.22) }));
      t.en(a, sg * 0.14, 0.14, 0);
      alas.push(a);
      cuerpo.add(a);
    }
    for (const sg of [-1, 1]) cuerpo.add(t.en(t.capsula(0.045, 0.26, mo), sg * 0.1, -0.34, 0.02, { rx: 0.3 }));
    t.en(cuerpo, 0, 1.15, 0);
    raiz.add(cuerpo);
    raiz.add(t.en(t.disco(0.45, t.matLuz(0x000000, { opacidad: 0.26 })), 0, 0.012, 0));
    return { raiz, cuerpo, cabeza, alas, alto: 1.5, radio: 0.75, flota: true };
  },
};

/** Silueta de reserva cuando una criatura no declara ninguna conocida. */
const SILUETA_RESERVA = "bipedo";

/**
 * Altura mínima con la que una criatura «tiene presencia» en el plano. Las alturas reales del
 * bestiario van de 0,6 (la rata) a 2,6 (el jefe) y, puestas a escala de verdad, la rata es un
 * punto en el suelo que no se ve. Las pequeñas se agrandan hasta este mínimo; las grandes no se
 * tocan, así que un dragón sigue siendo mucho más imponente que un goblin.
 */
export const PRESENCIA_MIN = 0.95;

/** Tope del agrandado: una rata agrandada 2,2 veces parecía una vaca al lado del héroe. */
export const PRESENCIA_MAX = 1.6;

/** Factor de presencia de una criatura de altura `alto` (1 si ya es lo bastante grande). */
export const factorPresencia = (alto) => (alto > 0 && alto < PRESENCIA_MIN ? Math.min(PRESENCIA_MAX, PRESENCIA_MIN / alto) : 1);

/** Claves que este motor sabe dibujar (las 10 del bestiario + el jefe). */
export const CLAVES_3D = Object.freeze(Object.keys(RECETAS));

/** ¿Hay receta para esta clave? */
export const tieneReceta = (clave) => Object.hasOwn(RECETAS, String(clave ?? "").toLowerCase());

/**
 * Construye un enemigo. Si la clave no tiene receta se usa la del esqueleto con los colores
 * genéricos: un enemigo nuevo del equipo de contenido se verá raro, pero se verá y no romperá nada.
 *
 * @param {object} T three.js
 * @param {string} clave clave del BESTIARIO (`rata`, `lobo`, … `dragon`) o `jefe`
 * @param {{jefe?:boolean, segmentos?:number, sombras?:boolean}} [o]
 *        jefe: lo agranda, le pone aura roja y le sube el brillo (igual que el 2D)
 * @returns {{raiz:object, alto:number, radio:number, partes:object, materiales:object[], flota:boolean, colores:object, taller:Taller, clave:string}}
 */
export function construirEnemigo(T, clave, o = {}) {
  const k = String(clave ?? "").toLowerCase();
  let meta = null;
  try { meta = metadatos3d(k); } catch { meta = null; }

  // 1) Receta propia si la hay (las once hechas a mano quedan mejor).
  // 2) Si no, la silueta que declara el bestiario.
  // 3) Y si tampoco, bípedo: algo se ve y nada revienta.
  const receta = RECETAS[k] ?? SILUETAS[meta?.silueta] ?? SILUETAS[SILUETA_RESERVA];
  const col = colorEnemigo(k);
  const t = new Taller(T, o);
  const { raiz, alto, radio, flota = false, ...partes } = receta(t, col);
  raiz.name = `enemigo-${k || "generico"}`;

  // La altura la manda el bestiario y es RELATIVA (1 = el héroe), así que se escala el modelo
  // hasta medir lo que dice su ficha. Sin esto, una rata de 0,6 construida a tamaño real es un
  // punto en el suelo y un dragón de 2,6 no se distingue de un orco.
  const presencia = meta?.altura > 0 ? (meta.altura * ALTO_HEROE) / alto : factorPresencia(alto);
  if (presencia !== 1) {
    raiz.scale.setScalar(presencia);
    // La sombra de debajo se agranda con el modelo, y en una criatura de 3 metros se convertía en
    // un óvalo negro enorme que tapaba media arena. Se le quita parte del crecimiento y se aclara.
    if (presencia > 1.15) ajustarSombra(raiz, presencia);
  }

  const jefe = !!o.jefe;
  if (jefe && k !== "jefe") {
    // Un jefe del bestiario es la misma criatura, más grande y con corona y aura.
    raiz.scale.setScalar(presencia * 1.35);
    const corona = t.grupo("corona");
    const oro = t.mat(0xfbbf24, { metal: 0.95, rugosidad: 0.2, emision: 0xfbbf24, fuerza: 0.7 });
    corona.add(t.en(t.cilindro(radio * 0.3, radio * 0.3, 0.08, oro), 0, 0, 0));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      corona.add(t.en(t.cono(0.04, 0.14, oro), Math.cos(a) * radio * 0.27, 0.1, Math.sin(a) * radio * 0.27));
    }
    t.en(corona, 0, alto * 1.02, 0);
    raiz.add(corona);
    partes.corona = corona;
    const aura = t.en(t.toro(radio * 1.05, 0.05, t.matLuz(0xef4444, { aditivo: true, opacidad: 0.55 })), 0, 0.05, 0, { rx: Math.PI / 2 });
    raiz.add(aura);
    partes.aura = aura;
    for (const m of t.materiales) m.userData.fuerzaBase = Math.min(1.4, (m.userData.fuerzaBase || 0) + 0.2);
  }

  return {
    raiz, taller: t, clave: RECETAS[k] ? k : "generico",
    alto: alto * (raiz.scale?.y ?? 1), radio: radio * (raiz.scale?.x ?? 1),
    partes, materiales: t.materiales, flota, colores: col, jefe,
  };
}

/**
 * Corrige el disco de sombra falsa de una criatura agrandada: crece mucho menos que el cuerpo y
 * se aclara, para que no quede un manchón negro en el suelo.
 */
function ajustarSombra(raiz, presencia) {
  raiz.traverse?.((n) => {
    if (!n.userData?.sombraFalsa) return;
    const k = Math.pow(presencia, -0.45);     // crece como la raíz, no como el cuerpo
    n.scale.set(k, k, k);
    if (n.material && typeof n.material.opacity === "number") {
      n.material.opacity = Math.max(0.12, n.material.opacity / Math.pow(presencia, 0.6));
    }
  });
}

/** Las claves del bestiario de combat.js para las que hay receta (comprobación de cobertura). */
export const cobertura = () => CLAVES_ENEMIGO.filter((k) => tieneReceta(k));
