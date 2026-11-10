// El escenario: suelo de arena, muro de piedra, antorchas con luz que titila, niebla y polvo.
// Igual que las criaturas, todo por código y con `T` (three.js) por parámetro.

import { Taller } from "./piezas.js";
import { ARENA } from "./paleta.js";
import { CALIDADES } from "./rendimiento.js";

// Estos cuatro números son los que deciden si la escena «se ve bien» o parece una maqueta vista
// de lejos. Están medidos probando en el navegador, no elegidos a ojo:
//  · con la cámara a 7,4 de distancia los personajes quedaban diminutos y sobraba suelo;
//  · separándolos ±2,3 o más quedaba un hueco muerto en medio del plano.
/** Radio del redondel de arena. Más pequeño = el muro cierra el plano y no sobra suelo. */
// 10 y no 7: con un dragón de 4,7 m la cámara tiene que poder echarse atrás, y si se pasa del
// radio se queda FUERA de la arena (ver CAMARA.max).
export const RADIO_ARENA = 10;
/** Separación entre luchadores: cada uno a su lado, como en el 2D, pero llenando el plano. */
export const PUESTO_X = 1.9;
/**
 * Cámara. `max` es el tope de distancia y es la constante delicada de todo el archivo: el muro
 * está en RADIO_ARENA, así que una cámara más lejos se queda FUERA de la arena y el muro (y los
 * estandartes y las antorchas de delante) se le meten por medio del plano. Pasó de verdad en
 * móvil en vertical: salía una franja negra tapando a los luchadores.
 */
export const CAMARA = Object.freeze({
  alto: 1.95, mira: [0, 1.0, 0], fov: 42,
  min: 4.6, max: RADIO_ARENA - 1.6, fovMin: 38, fovMax: 72,
});

/** Medio ancho de la criatura más ancha (el dragón con las alas abiertas). */
export const ANCHO_LUCHADOR = 1.4;

/** Media anchura que la cámara tiene que abarcar: el puesto más el bicho más ancho. */
export const MEDIO_PLANO = PUESTO_X + ANCHO_LUCHADOR;

const grados = (rad) => (rad * 180) / Math.PI;
const tanMitad = (fovGrados) => Math.tan((fovGrados * Math.PI) / 360);

/**
 * Encuadre para una ventana de proporción `aspecto`: a qué distancia va la cámara y con qué
 * ángulo, para que los dos luchadores quepan siempre sin salirse de la arena.
 *
 * Primero se intenta la distancia ideal con el ángulo normal. Si esa distancia se saldría de la
 * arena (ventana estrecha), se queda en el tope y lo que se abre es el ANGULO. Al revés, en una
 * ventana muy ancha se acerca hasta `min`, que es lo medido: de más lejos los personajes quedan
 * diminutos y sobra suelo.
 *
 * @param {number} aspecto ancho/alto del lienzo
 * @returns {{distancia:number, fov:number}}
 */
export function encuadre(aspecto, altoMax = 2) {
  const a = Number.isFinite(aspecto) && aspecto > 0 ? aspecto : 16 / 9;
  const alto = Number.isFinite(altoMax) && altoMax > 0 ? altoMax : 2;

  // A qué altura se mira: el centro de la criatura más alta, sin bajar del pecho del héroe.
  const miraY = Math.min(2.4, Math.max(CAMARA.mira[1], alto * 0.45));
  // Medio alto y medio ancho que hay que abarcar.
  const medioAlto = Math.max(miraY, alto - miraY) * 1.14;
  const medioAncho = MEDIO_PLANO;

  const ideal = Math.max(medioAncho / (a * tanMitad(CAMARA.fov)), medioAlto / tanMitad(CAMARA.fov));
  const distancia = Math.min(CAMARA.max, Math.max(CAMARA.min, ideal));
  const fov = Math.min(CAMARA.fovMax, Math.max(CAMARA.fovMin,
    2 * grados(Math.atan(Math.max(medioAncho / a, medioAlto) / distancia))));

  // Lo que de verdad se abarca con ese encuadre. Si no llega (pantalla muy estrecha, o un bicho
  // enorme), los luchadores se JUNTAN en vez de salirse del plano.
  const cobertura = tanMitad(fov) * distancia * a;
  const puesto = Math.max(0.9, Math.min(PUESTO_X, cobertura - ANCHO_LUCHADOR));
  return { distancia, fov: Math.round(fov * 10) / 10, miraY: Math.round(miraY * 100) / 100, puesto: Math.round(puesto * 100) / 100, cobertura };
}

/** Solo la distancia (se mantiene por comodidad y para las pruebas). */
export const distanciaCamara = (aspecto, altoMax) => encuadre(aspecto, altoMax).distancia;

/**
 * Crea una malla instanciada: una geometría, un material y N copias colocadas por `colocar`.
 * `colocar(i, poner, color)` llama a `poner(x, y, z, rx, ry, escala)` y, si quiere, a `color(c)`.
 * @returns {object} InstancedMesh de three.js
 */
function instanciar(T, t, geo, mat, n, colocar, casta = true) {
  const im = new T.InstancedMesh(t.reg(geo), mat, n);
  im.frustumCulled = false;
  const m = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), pos = new T.Vector3(), esc = new T.Vector3();
  let usaColor = false;
  for (let i = 0; i < n; i++) {
    colocar(i,
      (x, y, z, rx = 0, ry = 0, s = 1) => {
        e.set(rx, ry, 0);
        q.setFromEuler(e);
        pos.set(x, y, z);
        esc.setScalar(s);
        im.setMatrixAt(i, m.compose(pos, q, esc));
      },
      (c) => { usaColor = true; im.setColorAt(i, c); });
  }
  im.instanceMatrix.needsUpdate = true;
  if (usaColor && im.instanceColor) im.instanceColor.needsUpdate = true;
  if (t.sombras) { im.castShadow = casta; im.receiveShadow = true; }
  return im;
}

/**
 * Monta el decorado y devuelve lo que hay que animar.
 *
 * @param {object} T three.js
 * @param {{calidad?:"alto"|"medio"|"bajo", reducido?:boolean}} [o]
 * @returns {{raiz:object, taller:Taller, antorchas:Array<{luz:object|null, llama:object, base:number}>,
 *            polvo:object|null, luces:{ambiente:object, hemisferio:object, clave:object},
 *            niebla:object, suelo:object}}
 */
export function construirEscenario(T, o = {}) {
  const cal = CALIDADES[o.calidad] ?? CALIDADES.medio;
  const t = new Taller(T, { segmentos: cal.segmentos, sombras: cal.sombras });
  const raiz = t.grupo("escenario");

  // ── Suelo: redondel de arena con un reborde de piedra ──
  const matArena = t.mat(ARENA.arena, { rugosidad: 0.98, plano: false });  // arena apagada: las criaturas tienen que destacar sobre ella
  const suelo = t.malla(new T.CircleGeometry(RADIO_ARENA, Math.max(16, cal.segmentos * 2)), matArena, false);
  t.en(suelo, 0, 0, 0, { rx: -Math.PI / 2 });
  suelo.receiveShadow = cal.sombras;
  raiz.add(suelo);

  // Manchas de arena pisada: rompen el color plano del suelo. Van INSTANCIADAS (un solo objeto
  // con 14 copias) en vez de 14 mallas sueltas: en una integrada lo que ahoga la escena no son
  // los píxeles, son las llamadas de dibujo, y cada malla suelta es una.
  const matMancha = t.matLuz(ARENA.arenaOsc, { opacidad: 0.3 });
  const manchas = instanciar(T, t, new T.CircleGeometry(1, 10), matMancha, 14, (i, poner) => {
    const a = (i * 2.399) % (Math.PI * 2);
    const r = 1.2 + ((i * 1.7) % 1) * (RADIO_ARENA - 2);
    const e = 0.5 + ((i * 0.37) % 1) * 1.1;
    poner(Math.cos(a) * r, 0.006, Math.sin(a) * r, -Math.PI / 2, 0, e);
  }, false);
  raiz.add(manchas);

  // Foso / reborde
  raiz.add(t.en(t.toro(RADIO_ARENA, 0.3, t.mat(ARENA.muroLuz, { rugosidad: 0.95, plano: true })), 0, 0.1, 0, { rx: Math.PI / 2 }));

  // ── Muro: ladrillos en círculo. Dos alturas, desfasadas, con huecos para los arcos ──
  // El muro son ~100 ladrillos. Sueltos costaban ~100 llamadas de dibujo por fotograma; como una
  // sola malla instanciada cuesta UNA, y el tono distinto de cada ladrillo se consigue con el
  // color por copia (`setColorAt`), que el material estándar multiplica por su color base.
  const matMuro = t.mat(0xffffff, { rugosidad: 1, plano: true });
  const nLadrillos = cal === CALIDADES.bajo ? 20 : 34;
  const anchoLadrillo = ((2 * Math.PI * RADIO_ARENA) / nLadrillos) * 0.92;
  const colA = new T.Color(ARENA.muro), colB = new T.Color(ARENA.muroLuz);
  const muro = instanciar(T, t, new T.BoxGeometry(anchoLadrillo, 1.05, 0.6), matMuro, nLadrillos * 3,
    (i, poner, color) => {
      const fila = Math.floor(i / nLadrillos), j = i % nLadrillos;
      const a = ((j + (fila % 2) * 0.5) / nLadrillos) * Math.PI * 2;
      poner(Math.cos(a) * (RADIO_ARENA + 0.3), 0.55 + fila * 1.05, Math.sin(a) * (RADIO_ARENA + 0.3), 0, -a, 1);
      color((j + fila) % 3 ? colA : colB);
    });
  raiz.add(muro);
  // Estandartes rojos colgando del muro, a los lados de la cámara
  const matTela = t.mat(ARENA.estandarte, { doble: true, rugosidad: 0.95 });
  for (const a of [-1.15, -1.99, 1.15, 1.99]) {
    const e = t.plano(1.1, 2.2, matTela);
    t.en(e, Math.cos(a) * (RADIO_ARENA - 0.1), 2.1, Math.sin(a) * (RADIO_ARENA - 0.1), { ry: -a + Math.PI / 2 });
    raiz.add(e);
  }

  // ── Antorchas: poste, pebetero, llama (aditiva) y una luz puntual que titila ──
  const antorchas = [];
  const matPoste = t.mat(ARENA.madera, { rugosidad: 1 });
  const matHierro = t.mat(0x3b2a1c, { metal: 0.6, rugosidad: 0.6 });
  const matLlama = t.matLuz(ARENA.llama, { aditivo: true, opacidad: 0.9 });
  const matNucleo = t.matLuz(ARENA.llamaNucleo, { aditivo: true, opacidad: 0.95 });
  const sitios = cal.antorchas === 2 ? [-0.6, Math.PI + 0.6] : [-0.55, -2.6, 0.55, Math.PI - 0.55];
  // Cada luz puntual la pagan TODOS los materiales en cada píxel. Cuatro era un lujo que en una
  // integrada se nota: se encienden solo las dos de atrás, que son las que recortan a las
  // criaturas contra el muro; las de delante dan llama pero no luz.
  const conLuz = cal.luzPorAntorcha ? 2 : 0;
  let iAntorcha = 0;
  for (const a of sitios) {
    const g = t.grupo("antorcha");
    const x = Math.cos(a) * (RADIO_ARENA - 0.5), z = Math.sin(a) * (RADIO_ARENA - 0.5);
    g.add(t.en(t.cilindro(0.08, 0.11, 2.6, matPoste), 0, 1.3, 0));
    g.add(t.en(t.cilindro(0.26, 0.14, 0.3, matHierro), 0, 2.7, 0));
    const llama = t.grupo("llama");
    llama.add(t.en(t.cono(0.2, 0.62, matLlama), 0, 0.3, 0));
    llama.add(t.en(t.cono(0.1, 0.34, matNucleo), 0, 0.2, 0));
    t.en(llama, 0, 2.82, 0);
    g.add(llama);
    t.en(g, x, 0, z);
    raiz.add(g);

    let luz = null;
    if (iAntorcha++ < conLuz) {
      // 26 sobreexponía: el héroe dorado salía blanco. Con 16 se ve el color del metal.
      luz = new T.PointLight(ARENA.llama, 16, 14, 2);
      luz.position.set(x, 3.1, z);
      raiz.add(luz);
    }
    antorchas.push({ luz, llama, base: luz ? luz.intensity : 0, fase: Math.random() * 6.28 });
  }

  // ── Luces generales ──
  // Intensidades medidas: ambiente 1,1 + clave 1,5 + antorchas fuertes lavaba el color de todo.
  const ambiente = new T.AmbientLight(0x3a2a20, 0.6);
  const hemisferio = new T.HemisphereLight(0x5b4636, 0x1a120c, 0.35);
  // Luz «clave»: la que define el volumen de las criaturas. Viene de arriba y de la cámara.
  const clave = new T.DirectionalLight(0xffd9a0, 1.3);
  clave.position.set(2.5, 7, 6);
  if (cal.sombras) {
    clave.castShadow = true;
    clave.shadow.mapSize.set(1024, 1024);
    clave.shadow.camera.near = 1;
    clave.shadow.camera.far = 28;
    clave.shadow.camera.left = -7; clave.shadow.camera.right = 7;
    clave.shadow.camera.top = 7; clave.shadow.camera.bottom = -7;
    clave.shadow.bias = -0.0012;
  }
  // Contraluz azulada: separa a las criaturas del muro oscuro
  const contra = new T.DirectionalLight(0x6ba3d6, 0.7);   // contraluz: recorta la silueta contra el muro
  contra.position.set(-4, 4, -7);
  raiz.add(ambiente, hemisferio, clave, contra);

  // ── Polvo en suspensión ──
  let polvo = null;
  if (cal.polvo > 0 && !o.reducido) {
    const n = cal.polvo;
    const pos = new Float32Array(n * 3);
    const vel = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * RADIO_ARENA * 0.95;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = 0.2 + Math.random() * 4.4;
      pos[i * 3 + 2] = Math.sin(a) * r;
      vel[i] = 0.08 + Math.random() * 0.3;
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.BufferAttribute(pos, 3));
    t.reg(geo);
    const mat = new T.PointsMaterial({
      color: 0xffd9a0, size: 0.055, sizeAttenuation: true,
      transparent: true, opacity: 0.55, depthWrite: false, blending: T.AdditiveBlending,
    });
    t.reg(mat);
    polvo = new T.Points(geo, mat);
    polvo.name = "polvo";
    polvo.userData.vel = vel;
    raiz.add(polvo);
  }

  const niebla = new T.FogExp2(ARENA.niebla, 0.052);

  return { raiz, taller: t, antorchas, polvo, luces: { ambiente, hemisferio, clave, contra }, niebla, suelo, calidad: cal };
}

/**
 * Anima el escenario un fotograma.
 * @param {object} esc lo que devolvió `construirEscenario`
 * @param {number} s segundos desde el arranque
 * @param {boolean} reducido si el usuario pidió movimiento reducido (las llamas se quedan quietas)
 */
export function animarEscenario(esc, s, reducido = false) {
  if (!esc) return;
  if (!reducido) {
    for (const a of esc.antorchas) {
      const p = a.fase ?? 0;
      // Titileo: dos senos de frecuencias distintas + un pellizco rápido. Nada de aleatorio puro,
      // que se ve como un parpadeo de bombilla fundida.
      const f = 0.78 + 0.14 * Math.sin(s * 7.3 + p) + 0.08 * Math.sin(s * 17.1 + p * 2.3);
      if (a.luz) a.luz.intensity = a.base * f;
      a.llama.scale.set(0.9 + f * 0.18, 0.82 + f * 0.3, 0.9 + f * 0.18);
      a.llama.rotation.y = s * 1.6 + p;
    }
  }
  const p = esc.polvo;
  if (p && !reducido) {
    const pos = p.geometry.attributes.position;
    const arr = pos.array, vel = p.userData.vel;
    const dt = 1 / 60;
    for (let i = 0; i < vel.length; i++) {
      arr[i * 3 + 1] += vel[i] * dt;
      arr[i * 3] += Math.sin(s * 0.7 + i) * 0.004;
      if (arr[i * 3 + 1] > 4.8) arr[i * 3 + 1] = 0.15;
    }
    pos.needsUpdate = true;
  }
}
