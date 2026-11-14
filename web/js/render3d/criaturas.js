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
import { colorEnemigo, rareza3d, hex, oscurecer, HEROE, CLAVES_ENEMIGO } from "./paleta.js";
import { CATALOGO, cosmetico } from "../economy.js";
import { metadatos3d, BESTIARIO } from "../combat.js";

const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : null);

// ───────────────────────── Cosméticos ─────────────────────────
//
// Los cosméticos son objetos ERC-1155 que el jugador compra: si equipa uno y no se distingue
// desde la cámara de combate, no vale nada. Por eso aquí son piezas con silueta propia y
// generosas de tamaño, no un detalle de dos píxeles.
//
// El color y la rareza SALEN DEL CATÁLOGO (`economy.CATALOGO`), que es de quien son los
// cosméticos. Aquí solo se decide la FORMA de cada uno, porque un «Yelmo con cuernos» y una
// «Corona del campeón» no se pueden dibujar igual por mucho que compartan ranura.

/** Qué forma tiene cada id del catálogo. Si falta una, `cosmeticosSinForma()` lo denuncia. */
const FORMA_COSMETICO = Object.freeze({
  1: "tinte", 2: "tinte", 3: "tinte",
  4: "capucha", 5: "yelmo", 6: "corona",
  7: "capa", 8: "capa", 9: "alas",
  10: "escarcha", 11: "llamas",
  12: "gato", 13: "dragoncito",
  14: null,                       // la poción es un consumible: no se lleva puesta
});

/**
 * Cosméticos del catálogo que este motor todavía no sabe dibujar de forma reconocible.
 * Está vacío a propósito: si el equipo del catálogo añade uno nuevo, sale aquí y hay que
 * decidir qué forma darle en vez de dejar al jugador con un cosmético invisible.
 * @returns {Array<{id:number, nombre:string, ranura:string}>}
 */
export function cosmeticosSinForma(catalogo = CATALOGO) {
  return catalogo
    .filter((c) => c.ranura !== "consumible" && !FORMA_COSMETICO[c.id])
    .map((c) => ({ id: c.id, nombre: c.nombre, ranura: c.ranura }));
}

/** Datos de dibujo de un cosmético: color del catálogo, forma de aquí. */
function datosCosmetico(id) {
  const n = num(id);
  if (n == null) return null;
  const c = cosmetico(n);
  const forma = FORMA_COSMETICO[n];
  if (!c || !forma) return null;
  return { forma, color: hex(c.tono), rareza: c.rareza, nombre: c.nombre };
}

/** El tinte de armadura: solo cambia colores, no añade piezas. */
export function tinteDe(id) {
  const d = datosCosmetico(id);
  return d?.forma === "tinte" ? [d.color, oscurecer(d.color, 0.55)] : null;
}

/**
 * Pone todos los cosméticos de una apariencia sobre un héroe ya construido.
 * @param {Taller} t
 * @param {{sombrero?:number|null, capa?:number|null, aura?:number|null, mascota?:number|null}} ap
 * @param {{raiz:object, cuerpo:object, cabeza:object}} piezas
 * @returns {object} las partes añadidas, con los nombres que usa la animación de reposo
 */
function ponerCosmeticos(t, ap, { raiz, cuerpo, cabeza }) {
  const extras = {};
  const brillo = (d) => (d.rareza === 2 ? { emision: d.color, fuerza: 0.75 } : d.rareza === 1 ? { emision: d.color, fuerza: 0.25 } : {});

  // ── Sombrero ──
  const s = datosCosmetico(ap?.sombrero);
  if (s) {
    const m = t.mat(s.color, { metal: s.forma === "corona" ? 0.95 : s.forma === "yelmo" ? 0.85 : 0.1, rugosidad: s.forma === "capucha" ? 0.95 : 0.25, ...brillo(s) });
    if (s.forma === "capucha") {
      // Capucha: cae por detrás y deja la cara a la vista, que si no el héroe pierde expresión.
      const cap = t.grupo("capucha");
      cap.add(t.en(t.esfera(0.235, m, 0.95), 0, 0.03, -0.02));
      cap.add(t.en(t.cono(0.21, 0.34, m), 0, 0.02, -0.16, { rx: 0.9 }));       // pico caído atrás
      cap.add(t.en(t.toro(0.2, 0.05, m), 0, -0.15, -0.02, { rx: Math.PI / 2 })); // cuello
      cabeza.add(cap);
      extras.sombrero = cap;
    } else if (s.forma === "yelmo") {
      const y = t.grupo("yelmo");
      y.add(t.en(t.esfera(0.225, m, 0.92), 0, 0.03, 0));
      y.add(t.en(t.caja(0.07, 0.16, 0.05, m), 0, 0.0, 0.2));                    // nasal
      for (const lado of [-1, 1]) {
        y.add(t.en(t.cono(0.055, 0.34, m), lado * 0.21, 0.12, -0.02, { rz: lado * 1.15, rx: -0.25 }));
      }
      cabeza.add(y);
      extras.sombrero = y;
    } else {
      const aro = t.grupo("corona");
      aro.add(t.en(t.cilindro(0.2, 0.2, 0.08, m), 0, 0, 0));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        aro.add(t.en(t.cono(0.04, 0.16, m), Math.cos(a) * 0.18, 0.11, Math.sin(a) * 0.18));
      }
      aro.add(t.en(t.esfera(0.05, t.matLuz(0xfff3c4, { aditivo: true })), 0, 0.1, 0.18));
      cabeza.add(t.en(aro, 0, 0.2, 0));
      extras.sombrero = aro;
      extras.corona = aro;
    }
  }

  // ── Capa (o alas) ──
  const cp = datosCosmetico(ap?.capa);
  if (cp) {
    if (cp.forma === "alas") {
      // «Alas de fénix»: son ALAS, no una capa. Es el cosmético más caro del catálogo (800 de
      // oro) y tiene que verse como lo que se compró desde la primera ojeada.
      const alas = t.grupo("alas");
      const pluma = t.mat(cp.color, { doble: true, rugosidad: 0.5, emision: cp.color, fuerza: 0.8 });
      const plumaClara = t.mat(0xfde68a, { doble: true, rugosidad: 0.45, emision: 0xfbbf24, fuerza: 0.6 });
      for (const lado of [-1, 1]) {
        const ala = t.grupo("ala");
        for (let i = 0; i < 4; i++) {
          const largo = 0.78 - i * 0.12;
          const p = t.plano(largo, 0.2, i % 2 ? plumaClara : pluma);
          t.en(p, lado * (0.26 + largo * 0.42), 0.34 - i * 0.2, -0.06, { rz: lado * (0.5 - i * 0.16), ry: lado * 0.25 });
          ala.add(p);
        }
        alas.add(ala);
      }
      t.en(alas, 0, 1.28, -0.16);
      cuerpo.add(alas);
      extras.capa = alas;
      extras.alas = alas;
    } else {
      const tela = t.mat(cp.color, { doble: true, rugosidad: 0.95, ...brillo(cp) });
      const capa = t.grupo("capa");
      capa.add(t.en(t.plano(0.62, 1.05, tela), 0, -0.45, 0));
      capa.add(t.en(t.toro(0.2, 0.035, t.mat(oscurecer(cp.color, 0.3), { metal: 0.6, rugosidad: 0.4 })), 0, 0.06, 0.02, { rx: Math.PI / 2 }));
      t.en(capa, 0, 1.33, -0.21, { rx: 0.12 });
      cuerpo.add(capa);
      extras.capa = capa;
    }
  }

  // ── Aura ──
  const au = datosCosmetico(ap?.aura);
  if (au) {
    const aura = t.grupo("aura");
    const luz = t.matLuz(au.color, { opacidad: 0.8, aditivo: true });
    aura.add(t.en(t.toro(0.58, 0.04, luz), 0, 0.04, 0, { rx: Math.PI / 2 }));
    aura.add(t.en(t.toro(0.4, 0.025, luz), 0, 0.18, 0, { rx: Math.PI / 2 }));
    if (au.forma === "escarcha") {
      // Cristales de hielo flotando: angulosos y fríos.
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        aura.add(t.en(t.roca(0.07, t.mat(au.color, { emision: au.color, fuerza: 0.9, rugosidad: 0.1, opacidad: 0.85 }), 0),
          Math.cos(a) * 0.5, 0.12 + (i % 3) * 0.16, Math.sin(a) * 0.5, { esc: [0.6, 1.5, 0.6] }));
      }
    } else {
      // Llamas: conos que apuntan hacia arriba, más altos cuanto más cerca del héroe.
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        aura.add(t.en(t.cono(0.08, 0.3 + (i % 3) * 0.12, t.matLuz(au.color, { aditivo: true, opacidad: 0.85 })),
          Math.cos(a) * 0.46, 0.16, Math.sin(a) * 0.46));
      }
    }
    raiz.add(aura);
    extras.aura = aura;
  }

  // ── Mascota ──
  const ma = datosCosmetico(ap?.mascota);
  if (ma) {
    const mas = t.grupo("mascota");
    const piel = t.mat(ma.color, { rugosidad: 0.8, ...brillo(ma) });
    const osc = t.mat(oscurecer(ma.color, 0.4), { rugosidad: 0.85 });
    if (ma.forma === "gato") {
      mas.add(t.en(t.capsula(0.09, 0.2, piel), 0, 0, 0, { rz: Math.PI / 2 }));
      const cab = t.en(t.esfera(0.085, piel), 0, 0.05, 0.17);
      mas.add(cab);
      for (const lado of [-1, 1]) mas.add(t.en(t.cono(0.035, 0.09, piel), lado * 0.045, 0.13, 0.16));
      for (const lado of [-1, 1]) mas.add(t.en(t.esfera(0.022, t.matLuz(0x86efac, { aditivo: true })), lado * 0.035, 0.06, 0.24));
      const cola = t.capsula(0.02, 0.22, piel);
      t.en(cola, 0, 0.1, -0.2, { rx: 0.7 });
      mas.add(cola);
      for (const z of [0.08, -0.08]) for (const lado of [-1, 1]) mas.add(t.en(t.capsula(0.022, 0.07, osc), lado * 0.06, -0.11, z));
    } else {
      mas.add(t.en(t.capsula(0.085, 0.16, piel), 0, 0, 0, { rx: 0.3 }));
      mas.add(t.en(t.esfera(0.075, piel), 0, 0.08, 0.14));
      mas.add(t.en(t.cono(0.04, 0.1, osc), 0, 0.06, 0.22, { rx: Math.PI / 2 }));
      for (const lado of [-1, 1]) mas.add(t.en(t.cono(0.022, 0.07, osc), lado * 0.04, 0.14, 0.1, { rz: lado * 0.4 }));
      const mAla = t.mat(oscurecer(ma.color, 0.2), { doble: true, rugosidad: 0.6, emision: ma.color, fuerza: 0.4 });
      for (const lado of [-1, 1]) mas.add(t.en(t.plano(0.3, 0.2, mAla), lado * 0.19, 0.1, -0.03, { rz: lado * 0.35, ry: lado * 0.3 }));
      const cola = t.capsula(0.022, 0.2, piel);
      t.en(cola, 0, -0.02, -0.2, { rx: 0.5 });
      mas.add(cola);
    }
    t.en(mas, -0.7, 1.45, 0.3);
    raiz.add(mas);
    extras.mascota = mas;
  }

  return extras;
}


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

  const tinte = tinteDe(ap.color);
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
  // Se construyen con el CATÁLOGO de economy.js: de ahí salen el color (`tono`) y la rareza, así
  // que lo que el jugador vio al comprarlo es lo que se le pone al héroe.
  const extras = ponerCosmeticos(t, ap, { raiz, cuerpo, cabeza });

  // Sombra barata: un disco oscuro a los pies (más rápido que una sombra real y siempre se ve).
  raiz.add(t.en(t.disco(0.42, t.matLuz(0x000000, { opacidad: 0.38 })), 0, 0.012, 0));

  // El radio no es fijo: unas alas de fénix ensanchan al héroe casi al doble, y el encuadre de la
  // cámara se calcula con este número. Sin esto, al equipar las alas el héroe se salía del plano.
  const radio = 0.45
    + (extras.alas ? 0.5 : 0)
    + (extras.capa && !extras.alas ? 0.1 : 0)
    + (extras.aura ? 0.15 : 0);

  return {
    raiz, taller: t, alto: 1.82, radio, flota: false,
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

  // ── Las diez que amplió el equipo de contenido ──
  // Antes se construían por silueta genérica: se veían, pero una quimera sin tres cabezas no es
  // una quimera. Cada una tiene ahora lo que la hace reconocible de un vistazo.

  /** Murciélago sanguino: casi todo alas, orejas enormes y colmillos. Nunca toca el suelo. */
  murcielago(t, c) {
    const m = t.mat(c.base, { rugosidad: 0.85, plano: true });
    const mo = t.mat(c.osc, { rugosidad: 0.9 });
    const mAla = t.mat(c.acento, { doble: true, rugosidad: 0.75, opacidad: 0.92 });
    const raiz = t.grupo("murcielago");
    const cuerpo = t.grupo("cuerpo");
    cuerpo.add(t.en(t.capsula(0.14, 0.26, m), 0, 0, 0, { rx: 0.35 }));
    const cabeza = t.grupo("cabeza");
    cabeza.add(t.en(t.esfera(0.14, m), 0, 0, 0));
    cabeza.add(t.en(t.cono(0.07, 0.13, mo), 0, -0.04, 0.14, { rx: Math.PI / 2 }));
    // Las orejas son la mitad de la silueta de un murciélago.
    for (const s of [-1, 1]) cabeza.add(t.en(t.cono(0.085, 0.3, mAla), s * 0.1, 0.19, -0.02, { rz: s * 0.3, rx: -0.15 }));
    for (const s of [-1, 1]) cabeza.add(t.en(t.cono(0.022, 0.07, t.mat(0xfff5e6, { rugosidad: 0.3 })), s * 0.05, -0.1, 0.12, { rx: 2.9 }));
    cabeza.add(ojos(t, c.acento, { r: 0.028, x: 0.055, y: 0.03, z: 0.12 }));
    t.en(cabeza, 0, 0.26, 0.06);
    cuerpo.add(cabeza);
    const alas = [];
    for (const s of [-1, 1]) {
      const a = t.grupo("ala");
      // Membrana en tres tramos, como los dedos de un ala de murciélago de verdad.
      for (let i = 0; i < 3; i++) {
        const largo = 0.5 - i * 0.07;
        a.add(t.en(t.plano(largo, 0.26, mAla), s * (0.2 + largo * 0.45), 0.06 - i * 0.12, -0.02, { rz: s * (0.3 - i * 0.3), ry: s * 0.2 }));
        a.add(t.en(t.capsula(0.012, largo, mo), s * (0.2 + largo * 0.45), 0.06 - i * 0.12, -0.02, { rz: s * (Math.PI / 2 + (0.3 - i * 0.3)) }));
      }
      t.en(a, s * 0.1, 0.08, 0);
      alas.push(a);
      cuerpo.add(a);
    }
    for (const s of [-1, 1]) cuerpo.add(t.en(t.capsula(0.025, 0.14, mo), s * 0.07, -0.24, -0.02, { rx: 0.4 }));
    t.en(cuerpo, 0, 1.0, 0);
    raiz.add(cuerpo);
    raiz.add(t.en(t.disco(0.4, t.matLuz(0x000000, { opacidad: 0.22 })), 0, 0.012, 0));
    return { raiz, cuerpo, cabeza, alas, alto: 1.25, radio: 0.75, flota: true };
  },

  /** Limo ácido: una masa gelatinosa que se derrama. Translúcido y con el núcleo encendido. */
  limo(t, c) {
    const gel = t.mat(c.base, { opacidad: 0.72, rugosidad: 0.15, metal: 0.05, emision: c.emision, fuerza: 0.3 });
    const gelOsc = t.mat(c.osc, { opacidad: 0.8, rugosidad: 0.2 });
    const raiz = t.grupo("limo");
    const cuerpo = t.grupo("cuerpo");
    // Cúpula achatada: lo que distingue a un limo es que NO tiene forma de bicho.
    const masa = t.esfera(0.46, gel, 0.62);
    cuerpo.add(t.en(masa, 0, 0, 0));
    const bultos = [masa];
    for (const [x, z, r] of [[0.22, 0.1, 0.2], [-0.2, -0.14, 0.17], [0.02, -0.22, 0.13]]) {
      const b = t.esfera(r, gel, 0.7);
      t.en(b, x, 0.1, z);
      bultos.push(b);
      cuerpo.add(b);
    }
    // Goterones por el borde: el limo siempre está a punto de caerse.
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      cuerpo.add(t.en(t.cono(0.055, 0.2, gel), Math.cos(a) * 0.4, -0.16, Math.sin(a) * 0.4, { rx: Math.PI }));
    }
    // Núcleo: lo que brilla dentro y le da la pinta de ácido.
    const nucleo = t.esfera(0.17, t.matLuz(c.emision || c.acento, { aditivo: true, opacidad: 0.9 }));
    cuerpo.add(t.en(nucleo, 0, 0.02, 0));
    for (let i = 0; i < 5; i++) {
      cuerpo.add(t.en(t.esfera(0.035, t.matLuz(c.acento, { aditivo: true, opacidad: 0.6 })),
        Math.cos(i * 2.2) * 0.2, -0.04 + (i % 3) * 0.12, Math.sin(i * 2.2) * 0.2));
    }
    for (const s of [-1, 1]) cuerpo.add(t.en(t.esfera(0.05, gelOsc), s * 0.12, 0.14, 0.33));
    t.en(cuerpo, 0, 0.3, 0);
    raiz.add(cuerpo);
    raiz.add(t.en(t.disco(0.55, t.matLuz(c.emision || 0x000000, { opacidad: 0.3 })), 0, 0.012, 0));
    return { raiz, cuerpo, bultos, nucleo, alto: 0.6, radio: 0.6 };
  },

  /** Bandido enmascarado: capucha, pañuelo rojo tapándole la cara y una daga en cada mano. */
  bandido(t, c) {
    const m = t.mat(c.base, { rugosidad: 0.88 });
    const mo = t.mat(c.osc, { rugosidad: 0.92 });
    const rojo = t.mat(c.acento, { rugosidad: 0.8, doble: true });
    const h = humanoide(t, { alto: 1.72, ancho: 0.46, matCuerpo: m, matOsc: mo, cabezaR: 0.19, cuello: 0.03 });
    // Capucha + pañuelo: la cara tapada es toda su personalidad.
    h.cabeza.add(t.en(t.esfera(0.21, mo, 0.95), 0, 0.04, -0.02));
    h.cabeza.add(t.en(t.cono(0.19, 0.26, mo), 0, 0.04, -0.14, { rx: 1.0 }));
    h.cabeza.add(t.en(t.caja(0.3, 0.12, 0.14, rojo), 0, -0.05, 0.08));
    h.cabeza.add(ojos(t, 0xfef3c7, { r: 0.028, x: 0.07, y: 0.05, z: 0.17 }));
    // Dos dagas, una por mano.
    const armas = [];
    for (const [brazo, nombre] of [[h.brazoDer, "arma"], [h.brazoIzq, "armaIzq"]]) {
      const daga = t.grupo(nombre);
      daga.add(t.en(t.caja(0.045, 0.3, 0.012, t.mat(0xc8ccd4, { metal: 0.9, rugosidad: 0.35 })), 0, 0.18, 0));
      daga.add(t.en(t.caja(0.11, 0.03, 0.03, mo), 0, 0.03, 0));
      daga.add(t.en(t.cilindro(0.022, 0.022, 0.09, rojo), 0, -0.03, 0));
      t.en(daga, 0, -0.42, 0.05, { rx: -0.35 });
      brazo.add(daga);
      armas.push(daga);
    }
    // Capa corta y bolsa del botín.
    const capa = t.en(t.plano(0.44, 0.6, mo), 0, 0.92, -0.2, { rx: 0.14 });
    h.cuerpo.add(capa);
    h.cuerpo.add(t.en(t.esfera(0.11, t.mat(0x6b4a2a, { rugosidad: 1 })), 0.26, 0.74, -0.1));
    return { ...h, arma: armas[0], armaIzq: armas[1], capa, alto: 1.74, radio: 0.48 };
  },

  /** Enjambre de avispas: no es una avispa, son muchas. La nube ES la criatura. */
  avispa(t, c) {
    const amarillo = t.mat(c.base, { rugosidad: 0.5, emision: c.base, fuerza: 0.2 });
    const negro = t.mat(c.osc, { rugosidad: 0.6 });
    const mAla = t.matLuz(0xffffff, { opacidad: 0.35, doble: true });
    const raiz = t.grupo("avispa");
    const cuerpo = t.grupo("cuerpo");
    const bichos = [];
    // Siete avispas repartidas en una nube: a distancia se lee como un enjambre, no como un bicho.
    const sitios = [[0, 0.1, 0], [0.26, 0.3, 0.1], [-0.24, 0.22, -0.08], [0.14, -0.14, -0.16],
      [-0.18, -0.08, 0.18], [0.3, 0.02, -0.2], [-0.08, 0.38, 0.14]];
    for (const [i, [x, y, z]] of sitios.entries()) {
      const b = t.grupo("avispilla");
      const esc = i === 0 ? 1 : 0.72 + (i % 3) * 0.1;
      b.add(t.en(t.capsula(0.055, 0.1, amarillo), 0, 0, 0, { rx: 0.2 }));
      for (const k of [-0.03, 0.03]) b.add(t.en(t.cilindro(0.057, 0.057, 0.022, negro), 0, k, 0.02, { rx: 1.57 }));
      b.add(t.en(t.esfera(0.045, negro), 0, 0.02, 0.1));
      for (const s of [-1, 1]) b.add(t.en(t.plano(0.14, 0.07, mAla), s * 0.08, 0.06, -0.01, { rz: s * 0.25, rx: -0.4 }));
      t.en(b, x, y, z, { esc, ry: i * 0.9 });
      b.userData.sitio = [x, y, z];        // su hueco en la nube: se mueve alrededor de él
      b.userData.fase = i * 1.37;
      bichos.push(b);
      cuerpo.add(b);
    }
    t.en(cuerpo, 0, 1.05, 0);
    raiz.add(cuerpo);
    raiz.add(t.en(t.disco(0.45, t.matLuz(0x000000, { opacidad: 0.2 })), 0, 0.012, 0));
    return { raiz, cuerpo, bichos, alto: 1.4, radio: 0.6, flota: true };
  },

  /** Caballero caído: armadura entera, visera con dos luces dentro y un mandoble. */
  caballero(t, c) {
    const acero = t.mat(c.base, { metal: 0.85, rugosidad: 0.3 });
    const oscuro = t.mat(c.osc, { metal: 0.6, rugosidad: 0.45 });
    const h = humanoide(t, { alto: 1.9, ancho: 0.62, matCuerpo: acero, matOsc: oscuro, cabezaR: 0.2, hombros: 1.15 });
    // Yelmo cerrado: la rejilla y las dos luces de dentro son lo que lo hace un muerto con armadura.
    h.cabeza.add(t.en(t.esfera(0.225, acero, 0.95), 0, 0.02, 0));
    h.cabeza.add(t.en(t.cono(0.17, 0.2, acero), 0, -0.06, 0.1, { rx: 1.9 }));
    for (let i = 0; i < 3; i++) h.cabeza.add(t.en(t.caja(0.02, 0.09, 0.02, oscuro), -0.05 + i * 0.05, -0.02, 0.21));
    h.cabeza.add(ojos(t, c.emision || 0x93c5fd, { r: 0.034, x: 0.07, y: 0.01, z: 0.19 }));
    // Hombreras y faldón de placas.
    for (const s of [-1, 1]) h.torso.add(t.en(t.esfera(0.2, oscuro, 0.6), s * 0.38, 0.14, 0));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI - Math.PI / 2;
      h.cuerpo.add(t.en(t.caja(0.17, 0.26, 0.05, oscuro), Math.sin(a) * 0.26, 0.72, Math.cos(a) * 0.2, { ry: -a }));
    }
    // Capa hecha jirones.
    const capa = t.grupo("capa");
    for (let i = 0; i < 4; i++) {
      capa.add(t.en(t.plano(0.16, 0.9 - (i % 2) * 0.22, t.mat(c.osc, { doble: true, rugosidad: 0.95 })), -0.24 + i * 0.16, -0.45, 0));
    }
    t.en(capa, 0, 1.5, -0.22, { rx: 0.1 });
    h.cuerpo.add(capa);
    // Mandoble.
    const arma = t.grupo("arma");
    arma.add(t.en(t.caja(0.1, 1.15, 0.025, t.mat(0xd1d5db, { metal: 0.95, rugosidad: 0.2, emision: c.emision, fuerza: 0.25 })), 0, 0.68, 0));
    arma.add(t.en(t.cono(0.07, 0.2, t.mat(0xd1d5db, { metal: 0.95, rugosidad: 0.2 })), 0, 1.35, 0));
    arma.add(t.en(t.caja(0.42, 0.06, 0.07, oscuro), 0, 0.1, 0));
    arma.add(t.en(t.cilindro(0.035, 0.035, 0.2, oscuro), 0, 0, 0));
    t.en(arma, 0, -0.5, 0.08, { rx: -0.3 });
    h.brazoDer.add(arma);
    return { ...h, arma, capa, alto: 1.95, radio: 0.62 };
  },

  /** Arpía de las cumbres: mujer pájaro. Alas por brazos y patas con garras. */
  arpia(t, c) {
    const piel = t.mat(c.base, { rugosidad: 0.85 });
    const pluma = t.mat(c.acento, { rugosidad: 0.8, doble: true });
    const plumaOsc = t.mat(c.osc, { rugosidad: 0.85, doble: true });
    const raiz = t.grupo("arpia");
    const cuerpo = t.grupo("cuerpo");
    cuerpo.add(t.en(t.capsula(0.2, 0.34, piel), 0, 0.05, 0));
    cuerpo.add(t.en(t.esfera(0.21, pluma, 0.65), 0, 0.2, 0));          // pechera de plumas
    const cabeza = t.grupo("cabeza");
    cabeza.add(t.en(t.esfera(0.17, piel), 0, 0, 0));
    cabeza.add(t.en(t.cono(0.06, 0.18, t.mat(0xf5c542, { rugosidad: 0.4 })), 0, -0.02, 0.17, { rx: Math.PI / 2 }));  // pico
    // Cresta de plumas: la silueta de la cabeza.
    for (let i = 0; i < 5; i++) cabeza.add(t.en(t.cono(0.04, 0.22 - Math.abs(i - 2) * 0.05, pluma), -0.08 + i * 0.04, 0.17, -0.06, { rx: -0.5 }));
    cabeza.add(ojos(t, 0xfbbf24, { r: 0.033, x: 0.07, y: 0.03, z: 0.14 }));
    t.en(cabeza, 0, 0.5, 0.02);
    cuerpo.add(cabeza);
    // Las alas SON los brazos: por eso no hay manos.
    const alas = [];
    for (const s of [-1, 1]) {
      const a = t.grupo("ala");
      for (let i = 0; i < 5; i++) {
        const largo = 0.72 - i * 0.1;
        a.add(t.en(t.plano(largo, 0.17, i % 2 ? pluma : plumaOsc),
          s * (0.22 + largo * 0.45), 0.12 - i * 0.14, -0.03, { rz: s * (0.42 - i * 0.14), ry: s * 0.22 }));
      }
      t.en(a, s * 0.18, 0.2, 0);
      alas.push(a);
      cuerpo.add(a);
    }
    // Patas de ave con tres garras.
    const patas = [];
    for (const s of [-1, 1]) {
      const p = t.grupo("pata");
      p.add(t.en(t.capsula(0.045, 0.26, t.mat(0xd9c38a, { rugosidad: 0.7 })), 0, -0.2, 0));
      for (let i = 0; i < 3; i++) {
        p.add(t.en(t.cono(0.025, 0.12, t.mat(0x3a3028, { rugosidad: 0.5 })), (i - 1) * 0.05, -0.36, 0.06, { rx: 1.9 }));
      }
      t.en(p, s * 0.12, 0, 0);
      patas.push(p);
      cuerpo.add(p);
    }
    const cola = t.grupo("cola");
    for (let i = 0; i < 3; i++) cola.add(t.en(t.plano(0.12, 0.42, pluma), (i - 1) * 0.08, -0.1, 0, { rx: 0.5, rz: (i - 1) * 0.2 }));
    t.en(cola, 0, -0.1, -0.22);
    cuerpo.add(cola);
    t.en(cuerpo, 0, 0.72, 0);
    raiz.add(cuerpo);
    raiz.add(t.en(t.disco(0.5, t.matLuz(0x000000, { opacidad: 0.32 })), 0, 0.012, 0));
    return { raiz, cuerpo, cabeza, alas, patas, cola, alto: 1.45, radio: 0.85 };
  },

  /** Basilisco pétreo: serpiente con patas y unos ojos que no quieres mirar. */
  basilisco(t, c) {
    const escama = t.mat(c.base, { rugosidad: 0.65, plano: true });
    const vientre = t.mat(c.osc, { rugosidad: 0.8 });
    const cresta = t.mat(c.acento, { rugosidad: 0.5, emision: c.emision, fuerza: 0.5 });
    const raiz = t.grupo("basilisco");
    const cuerpo = t.grupo("cuerpo");
    // Cuerpo largo y bajo, en tres tramos que se estrechan.
    for (let i = 0; i < 3; i++) {
      const tramo = t.capsula(0.24 - i * 0.04, 0.3, escama);
      t.en(tramo, 0, 0, 0.25 - i * 0.34, { rz: Math.PI / 2 });
      cuerpo.add(tramo);
    }
    const cabeza = t.grupo("cabeza");
    cabeza.add(t.en(t.esfera(0.23, escama, 0.8), 0, 0, 0));
    cabeza.add(t.en(t.cono(0.15, 0.32, vientre), 0, -0.03, 0.26, { rx: Math.PI / 2 }));
    // La cresta y los ojos: el bicho mata con la mirada, así que los ojos mandan.
    for (let i = 0; i < 4; i++) cabeza.add(t.en(t.cono(0.04, 0.17 - i * 0.02, cresta), 0, 0.2, 0.06 - i * 0.12, { rx: -0.3 }));
    cabeza.add(ojos(t, c.emision || 0xbef264, { r: 0.055, x: 0.12, y: 0.07, z: 0.16 }));
    cabeza.add(t.en(t.caja(0.02, 0.012, 0.16, t.mat(0xdc2626, { rugosidad: 0.4 })), 0, -0.1, 0.38));  // lengua
    t.en(cabeza, 0, 0.16, 0.6);
    cuerpo.add(cabeza);
    // Cuatro patas cortas, muy separadas: se arrastra más que camina.
    const patas = [];
    for (const z of [0.3, -0.3]) {
      for (const s of [-1, 1]) {
        const p = t.grupo("pata");
        p.add(t.en(t.capsula(0.06, 0.12, vientre), 0, -0.1, 0, { rz: s * 0.5 }));
        p.add(t.en(t.caja(0.17, 0.06, 0.2, vientre), s * 0.08, -0.2, 0.03));
        t.en(p, s * 0.22, 0, z);
        patas.push(p);
        cuerpo.add(p);
      }
    }
    const cola = t.grupo("cola");
    let prev = cola;
    for (let i = 0; i < 5; i++) {
      const seg = t.grupo(`cola${i}`);
      seg.add(t.en(t.capsula(0.12 - i * 0.021, 0.2, escama), 0, 0, -0.1));
      t.en(seg, 0, 0, -0.2);
      prev.add(seg);
      prev = seg;
    }
    t.en(cola, 0, 0.04, -0.62);
    cuerpo.add(cola);
    t.en(cuerpo, 0, 0.3, 0);
    raiz.add(cuerpo);
    raiz.add(t.en(t.disco(0.8, t.matLuz(0x000000, { opacidad: 0.34 })), 0, 0.012, 0));
    return { raiz, cuerpo, cabeza, cola, patas, alto: 0.72, radio: 0.85 };
  },

  /** Elemental de fuego: no tiene cuerpo, tiene llama. Todo luz, nada de piel. */
  elemental(t, c) {
    const llama = t.matLuz(c.base, { aditivo: true, opacidad: 0.85 });
    const nucleoMat = t.matLuz(c.emision || 0xfde047, { aditivo: true, opacidad: 0.95 });
    const brasa = t.mat(c.osc, { rugosidad: 0.9, emision: c.base, fuerza: 0.5 });
    const raiz = t.grupo("elemental");
    const cuerpo = t.grupo("cuerpo");
    // Cuerpo: una llama grande con lenguas alrededor, que se estrecha hacia abajo.
    cuerpo.add(t.en(t.cono(0.34, 1.1, llama), 0, 0.1, 0));
    const lenguas = [];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const l = t.en(t.cono(0.11, 0.5 + (i % 3) * 0.22, llama), Math.cos(a) * 0.24, 0.3 + (i % 2) * 0.16, Math.sin(a) * 0.24);
      lenguas.push(l);
      cuerpo.add(l);
    }
    const nucleo = t.esfera(0.19, nucleoMat);
    cuerpo.add(t.en(nucleo, 0, 0.18, 0));
    // Dos brazos de fuego y una «cara» de dos brasas: lo justo para que se lea como un ser.
    const brazos = {};
    for (const s of [-1, 1]) {
      const b = t.grupo("brazo");
      b.add(t.en(t.capsula(0.09, 0.3, llama), 0, -0.14, 0, { rz: s * 0.3 }));
      b.add(t.en(t.cono(0.1, 0.24, nucleoMat), s * 0.1, -0.32, 0.02));
      t.en(b, s * 0.33, 0.42, 0.02);
      brazos[s < 0 ? "brazoIzq" : "brazoDer"] = b;
      cuerpo.add(b);
    }
    const cabeza = t.grupo("cabeza");
    cabeza.add(t.en(t.cono(0.17, 0.4, llama), 0, 0, 0));
    cabeza.add(ojos(t, 0xffffff, { r: 0.04, x: 0.065, y: 0.02, z: 0.12 }));
    for (let i = 0; i < 3; i++) cabeza.add(t.en(t.esfera(0.03, t.matLuz(0xfff3c4, { aditivo: true })), (i - 1) * 0.1, 0.26 + (i % 2) * 0.1, 0));
    t.en(cabeza, 0, 0.72, 0);
    cuerpo.add(cabeza);
    for (let i = 0; i < 4; i++) cuerpo.add(t.en(t.roca(0.05, brasa, 0), Math.cos(i * 1.7) * 0.3, -0.3 + (i % 2) * 0.1, Math.sin(i * 1.7) * 0.3));
    t.en(cuerpo, 0, 0.95, 0);
    raiz.add(cuerpo);
    raiz.add(t.en(t.disco(0.62, t.matLuz(c.base, { opacidad: 0.45 })), 0, 0.012, 0));
    return { raiz, cuerpo, cabeza, nucleo, lenguas, ...brazos, alto: 1.7, radio: 0.62, flota: true };
  },

  /** Liche de la torre: calavera con corona, túnica hueca y un orbe de conjuro. Flota. */
  liche(t, c) {
    const tela = t.mat(c.base, { rugosidad: 0.9, doble: true });
    const telaOsc = t.mat(c.osc, { rugosidad: 0.95, doble: true });
    const hueso = t.mat(0xe9e4d8, { rugosidad: 0.7, plano: true });
    const verde = t.mat(c.acento, { emision: c.emision || 0x4ade80, fuerza: 0.9, rugosidad: 0.3 });
    const raiz = t.grupo("liche");
    const cuerpo = t.grupo("cuerpo");
    // Túnica hueca: no tiene piernas, se deshace en jirones.
    cuerpo.add(t.en(t.cono(0.42, 1.15, tela), 0, 0, 0));
    const jirones = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const j = t.en(t.cono(0.08, 0.4, telaOsc), Math.cos(a) * 0.28, -0.66, Math.sin(a) * 0.28, { rx: Math.PI });
      jirones.push(j);
      cuerpo.add(j);
    }
    // Calavera con corona: el rey muerto.
    const cabeza = t.grupo("cabeza");
    cabeza.add(t.en(t.esfera(0.18, hueso), 0, 0, 0));
    cabeza.add(t.en(t.caja(0.16, 0.07, 0.13, hueso), 0, -0.14, 0.03));
    cabeza.add(ojos(t, c.emision || 0x4ade80, { r: 0.042, x: 0.07, y: 0.02, z: 0.14 }));
    const corona = t.grupo("corona");
    corona.add(t.en(t.cilindro(0.19, 0.19, 0.06, verde), 0, 0, 0));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      corona.add(t.en(t.cono(0.035, 0.13, verde), Math.cos(a) * 0.17, 0.09, Math.sin(a) * 0.17));
    }
    cabeza.add(t.en(corona, 0, 0.17, 0));
    t.en(cabeza, 0, 0.66, 0);
    cuerpo.add(cabeza);
    // Manos de hueso saliendo de las mangas.
    const brazos = {};
    for (const s of [-1, 1]) {
      const b = t.grupo("brazo");
      b.add(t.en(t.capsula(0.08, 0.34, tela), 0, -0.18, 0));
      b.add(t.en(t.esfera(0.06, hueso), 0, -0.38, 0.02));
      for (let i = 0; i < 3; i++) b.add(t.en(t.capsula(0.014, 0.07, hueso), (i - 1) * 0.035, -0.46, 0.03));
      t.en(b, s * 0.36, 0.44, 0.04, { rz: -s * 0.3 });
      brazos[s < 0 ? "brazoIzq" : "brazoDer"] = b;
      cuerpo.add(b);
    }
    // El orbe: flota solo delante de la mano, que es lo que hace de él un conjurador.
    const orbe = t.esfera(0.14, t.matLuz(c.emision || 0x4ade80, { aditivo: true, opacidad: 0.9 }));
    const grupoOrbe = t.grupo("orbe");
    grupoOrbe.add(t.en(orbe, 0, 0, 0));
    grupoOrbe.add(t.en(t.toro(0.21, 0.018, verde), 0, 0, 0, { rx: 1.1 }));
    grupoOrbe.add(t.en(t.toro(0.24, 0.014, verde), 0, 0, 0, { rx: -0.6, ry: 0.8 }));
    t.en(grupoOrbe, 0.52, 0.3, 0.3);
    cuerpo.add(grupoOrbe);
    t.en(cuerpo, 0, 1.05, 0);
    raiz.add(cuerpo);
    return { raiz, cuerpo, cabeza, jirones, orbe: grupoOrbe, corona, ...brazos, alto: 1.85, radio: 0.6, flota: true };
  },

  /** Quimera de tres cabezas: león, cabra y serpiente en el mismo cuerpo. */
  quimera(t, c) {
    const pelo = t.mat(c.base, { rugosidad: 0.9, plano: true });
    const peloOsc = t.mat(c.osc, { rugosidad: 0.92, plano: true });
    const cuerno = t.mat(0xe9e4d8, { rugosidad: 0.5 });
    const raiz = t.grupo("quimera");
    const cuerpo = t.grupo("cuerpo");
    const tronco = t.capsula(0.34, 0.6, pelo);
    t.en(tronco, 0, 0, 0, { rz: Math.PI / 2 });
    cuerpo.add(tronco);
    cuerpo.add(t.en(t.esfera(0.3, pelo, 0.9), 0, 0.04, 0.3));

    // LAS TRES CABEZAS. Sin esto no es una quimera, y era justo lo que le faltaba.
    const cabezas = [];
    // 1) León, al centro y adelante: la cabeza principal.
    const leon = t.grupo("cabeza");
    leon.add(t.en(t.esfera(0.21, pelo), 0, 0, 0));
    leon.add(t.en(t.cono(0.12, 0.2, peloOsc), 0, -0.04, 0.2, { rx: Math.PI / 2 }));
    // Melena: solo por detrás y por arriba. Rodeando la cabeza entera tapaba a las otras dos.
    for (let i = 0; i < 7; i++) {
      const a = Math.PI * (0.15 + (i / 6) * 0.7);
      leon.add(t.en(t.cono(0.06, 0.17, peloOsc), Math.cos(a) * 0.19, Math.sin(a) * 0.19, -0.14, { rx: -0.7 }));
    }
    leon.add(ojos(t, 0xfbbf24, { r: 0.034, x: 0.08, y: 0.05, z: 0.18 }));
    t.en(leon, 0, 0.42, 0.52);
    cabezas.push(leon);
    cuerpo.add(leon);
    // 2) Cabra, a la izquierda: cuernos curvados hacia atrás.
    const cabra = t.grupo("cabezaCabra");
    cabra.add(t.en(t.esfera(0.15, peloOsc, 1.2), 0, 0, 0));
    cabra.add(t.en(t.cono(0.08, 0.2, peloOsc), 0, -0.1, 0.15, { rx: 1.3 }));
    for (const s of [-1, 1]) {
      cabra.add(t.en(t.cono(0.045, 0.3, cuerno), s * 0.1, 0.16, -0.04, { rz: s * 0.5, rx: -0.9 }));
    }
    cabra.add(ojos(t, 0xfef08a, { r: 0.026, x: 0.065, y: 0.02, z: 0.12 }));
    t.en(cabra, -0.36, 0.56, 0.42, { ry: -0.75, esc: 1.1 });
    cabezas.push(cabra);
    cuerpo.add(cabra);
    // 3) Serpiente, a la derecha y sobre un cuello largo.
    const serp = t.grupo("cabezaSerpiente");
    let prev = serp;
    for (let i = 0; i < 3; i++) {
      const seg = t.grupo(`cuello${i}`);
      seg.add(t.en(t.capsula(0.09 - i * 0.012, 0.16, t.mat(c.acento, { rugosidad: 0.6, plano: true })), 0, 0.1, 0));
      t.en(seg, 0, i ? 0.15 : 0, i ? 0.09 : 0, { rx: i ? -0.55 : -0.85 });
      prev.add(seg);
      prev = seg;
    }
    const cabezaSerp = t.grupo("cabezaS");
    cabezaSerp.add(t.en(t.esfera(0.12, t.mat(c.acento, { rugosidad: 0.5 }), 0.8), 0, 0, 0));
    cabezaSerp.add(t.en(t.cono(0.08, 0.16, peloOsc), 0, -0.02, 0.13, { rx: Math.PI / 2 }));
    cabezaSerp.add(ojos(t, 0xef4444, { r: 0.026, x: 0.055, y: 0.03, z: 0.1 }));
    cabezaSerp.add(t.en(t.caja(0.015, 0.01, 0.1, t.mat(0xdc2626, { rugosidad: 0.4 })), 0, -0.05, 0.22));
    t.en(cabezaSerp, 0, 0.2, 0.08);
    prev.add(cabezaSerp);
    t.en(serp, 0.34, 0.4, 0.34, { ry: 0.55 });
    cabezas.push(serp);
    cuerpo.add(serp);

    const patas = [];
    for (const z of [0.26, -0.3]) {
      for (const s of [-1, 1]) {
        const p = t.grupo("pata");
        p.add(t.en(t.capsula(0.1, 0.42, pelo), 0, -0.28, 0));
        p.add(t.en(t.caja(0.22, 0.09, 0.28, peloOsc), 0, -0.56, 0.04));
        t.en(p, s * 0.26, 0, z);
        patas.push(p);
        cuerpo.add(p);
      }
    }
    const cola = t.grupo("cola");
    prev = cola;
    for (let i = 0; i < 4; i++) {
      const seg = t.grupo(`cola${i}`);
      seg.add(t.en(t.capsula(0.07 - i * 0.012, 0.18, peloOsc), 0, 0, -0.09));
      t.en(seg, 0, 0, -0.18);
      prev.add(seg);
      prev = seg;
    }
    t.en(cola, 0, 0.1, -0.56);
    cuerpo.add(cola);

    t.en(cuerpo, 0, 0.78, 0);
    raiz.add(cuerpo);
    raiz.add(t.en(t.disco(0.85, t.matLuz(0x000000, { opacidad: 0.38 })), 0, 0.012, 0));
    return { raiz, cuerpo, cabeza: leon, cabezas, patas, cola, alto: 1.3, radio: 0.9 };
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

/** Tope del agrandado cuando una criatura no trae altura en su ficha. */
export const PRESENCIA_MAX = 1.6;

/**
 * Tope de estirado cuando la altura SÍ viene del bestiario.
 *
 * Está en 2 por medición, no a ojo: con 1,6 también se recortaba al dragón (necesita 1,70) y a la
 * quimera (1,93), que son grandes pero no desproporcionados. Con 2 solo saltan los dos casos de
 * verdad: el limo (2,36) y el basilisco (2,90), que son bajos y largos y, estirados hasta la
 * altura de su ficha, medirían varios metros de largo.
 */
export const ESTIRADO_MAX = 2;

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
  const { raiz, alto: altoDeclarado, radio, flota = false, ...partes } = receta(t, col);
  raiz.name = `enemigo-${k || "generico"}`;
  // La altura se MIDE, no se cree: ver `altoReal`. Lo declarado por la receta queda de reserva
  // por si el modelo sale vacío (una criatura desconocida, por ejemplo).
  const alto = altoReal(raiz) || altoDeclarado;

  // La altura la manda el bestiario y es RELATIVA (1 = el héroe), así que se escala el modelo
  // hasta medir lo que dice su ficha. Sin esto, una rata de 0,6 construida a tamaño real es un
  // punto en el suelo y un dragón de 2,6 no se distingue de un orco.
  // La altura la manda el bestiario, pero con tope: estirar un modelo más de esto le rompe las
  // proporciones, porque crece igual de ancho y de largo. Ver `alturasImposibles()`.
  const pedida = meta?.altura > 0 ? (meta.altura * ALTO_HEROE) / alto : factorPresencia(alto);
  const presencia = Math.min(pedida, meta?.altura > 0 ? ESTIRADO_MAX : PRESENCIA_MAX);
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
 * Mide la altura REAL de un modelo, recorriendo sus piezas y teniendo en cuenta cuánto sobresale
 * cada una de su centro (`userData.extension`) y las escalas de sus padres.
 *
 * Esto existe porque declarar la altura a mano en cada receta sale mal: la quimera decía medir
 * 1,1 m midiendo 1,45, y como la altura declarada es el divisor del factor de presencia, salía
 * escalada casi al triple y cortada por arriba. Medirlo quita de en medio una familia entera de
 * errores míos, y además una receta nueva no tiene que acertar ningún número.
 *
 * @param {object} raiz
 * @returns {number} metros desde el suelo hasta lo más alto
 */
export function altoReal(raiz) {
  let maximo = 0;
  const recorrer = (n, y, esc) => {
    const yy = y + n.position.y * esc;
    const e = (n.userData?.extension ?? 0) * esc * (n.scale?.y ?? 1);
    if (n.geometry) maximo = Math.max(maximo, yy + e);
    for (const c of n.children ?? []) recorrer(c, yy, esc * (n.scale?.y ?? 1));
  };
  recorrer(raiz, 0, 1);
  return maximo;
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

/**
 * Claves del BESTIARIO para las que hay receta hecha a mano (las demás se construyen por silueta).
 * Se mide contra `combat.js`, no contra `CLAVES_ENEMIGO` de sprites.js: esa lista es la del motor
 * 2D y se quedó en las 11 criaturas originales, así que daba una cobertura falsa.
 */
export const cobertura = () => BESTIARIO.filter((b) => tieneReceta(b.clave)).map((b) => b.clave);

/**
 * Criaturas cuya `altura` del bestiario NO se puede cumplir sin romperles las proporciones.
 *
 * Pasa con las criaturas bajas y largas. El contrato dice que `altura` es relativa al héroe
 * (1 = lo que mide el héroe), y escalar un modelo para que su punto más alto llegue ahí lo estira
 * también a lo ancho y a lo largo: un basilisco de 2,16 m de alto mide 5 m de largo y no cabe en
 * la arena. Aquí se recorta al tope y se deja constancia, en vez de reinterpretar por mi cuenta lo
 * que quiso decir el equipo de contenido.
 *
 * @returns {Array<{clave:string, pedida:number, aplicada:number}>} vacío si todo cuadra
 */
export function alturasImposibles(T, o = { segmentos: 10, sombras: false }) {
  const fuera = [];
  for (const b of BESTIARIO) {
    const meta = metadatos3d(b.clave);
    if (!(meta?.altura > 0)) continue;
    const receta = RECETAS[b.clave] ?? SILUETAS[meta.silueta] ?? SILUETAS[SILUETA_RESERVA];
    const t = new Taller(T, o);
    const { raiz, alto: declarado } = receta(t, colorEnemigo(b.clave));
    const medido = altoReal(raiz) || declarado;
    const pedida = (meta.altura * ALTO_HEROE) / medido;
    if (pedida > ESTIRADO_MAX + 0.01) {
      fuera.push({ clave: b.clave, pedida: Math.round(pedida * 100) / 100, aplicada: ESTIRADO_MAX });
    }
    t.liberar();
  }
  return fuera;
}

/** Criaturas del bestiario que todavía se construyen por silueta genérica. */
export const porSilueta = () => BESTIARIO.filter((b) => !tieneReceta(b.clave)).map((b) => b.clave);
