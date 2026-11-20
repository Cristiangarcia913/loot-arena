// Carga opcional de modelos .glb/.gltf descargados (p.ej. de CGTrader) para sustituir la malla
// procedural de una criatura. Decisión 3 del plan maestro, revisada: ya no se prohíben recursos de
// terceros sin más, pero el equipo de Motor 3D tiene que comprobar a mano la licencia de cada
// archivo antes de dejarlo en `web/assets/models/`. Si el archivo no está, no carga o el navegador
// no puede con él, el motor sigue exactamente igual que antes: la criatura se construye por código
// en `criaturas.js`. Nada de aquí puede tumbar un combate por un modelo roto o sin red.
//
// Todo lo que recibe `T` (three.js) por parámetro se puede probar en Node sin CDN ni GPU, igual que
// `piezas.js`.

import { cargarTres, urlTresCargada, TRES_VERSION } from "./tres.js";

/** Carpeta donde el equipo de Motor 3D deja los modelos ya verificados. */
export const BASE_MODELOS = new URL("../../assets/models/", import.meta.url);

/**
 * Corrección de orientación por modelo: algunos `.glb` descargados miran hacia -Z en vez de hacia
 * +Z (de cara al jugador), según cómo los haya orientado quien los modeló. Se arregla aquí, con un
 * giro sobre Y en radianes, sin tocar `criaturaDesdeModelo`. Vacío a propósito: se rellena a mano
 * tras comprobar en pantalla cómo mira cada modelo nuevo.
 */
export const ROTACION_Y_MODELOS = Object.freeze({
  lobo: Math.PI / 2,
});

/**
 * Altura final en metros (pies a cabeza) para un modelo, cuando la fórmula genérica del bestiario
 * (altura relativa al héroe, con tope `ESTIRADO_MAX` en `criaturas.js`) se queda demasiado grande y
 * la criatura tapa la interfaz de combate. Anula ese cálculo para la clave que tenga entrada aquí;
 * las demás siguen exactamente igual. Vacío a propósito, igual que `ROTACION_Y_MODELOS`.
 */
export const ALTURA_MODELOS = Object.freeze({
  dragon: 2.7,
});

/**
 * Tinte de material por modelo: algunos `.glb` descargados llegan con una sola textura muy oscura
 * y se funden con el suelo y el muro de la arena. `color` multiplica el `baseColorFactor` (se
 * permite subir algún canal por encima de 1 a propósito, para que NO se quede más oscuro al
 * multiplicarse con una textura ya oscura); `emissive`/`emissiveIntensity` suman brillo propio, que
 * no depende de la textura y por eso separa ojos/fauces/escamas del fondo aunque no haya luz
 * directa encima.
 *
 * Vacío a propósito: el dragón llevaba aquí un tinte escarlata plano + brillo emisivo general que
 * tapaba la textura real de `dragon.glb` (sus escamas, cuernos, garras y ojos, con su sombreado 3D
 * propio). Para destacarlo contra el fondo oscuro de la arena basta con el rim light potente
 * (`recorte`, en `escenario.js`) que ya recorta la silueta con luz, SIN pintar la malla; si algún
 * modelo nuevo necesita tinte porque su textura es plana y se pierde, añádelo aquí, pero antes
 * prueba si el rim light ya existente alcanza.
 */
export const TINTE_MODELOS = Object.freeze({});

const urlAddon = (archivo) => `https://cdn.jsdelivr.net/npm/three@${TRES_VERSION}/examples/jsm/${archivo}`;

let promesaLoader = null;

/**
 * Clase `GLTFLoader` de three.js, enganchada a la MISMA instancia que ya cargó `cargarTres()`.
 *
 * `GLTFLoader.js` (y sus dos utilidades, `BufferGeometryUtils.js` y `SkeletonUtils.js`) importan
 * three.js con el especificador desnudo `"three"`, que sin un `<script type="importmap">` en
 * `index.html` no resuelve. Tocar ese HTML no es cosa de este módulo, por el mismo motivo que
 * explica `tres.js` para su propio import. La solución es la misma en espíritu: en vez de un
 * especificador desnudo, se reescribe el import a la URL exacta ya cargada y el archivo se sirve
 * como `Blob`, así el navegador ve tres módulos (el loader y sus dos utilidades) que importan
 * three.js por URL completa, igual que hace `tres.js` a mano con el propio three.js.
 */
function cargarGLTFLoader() {
  if (promesaLoader) return promesaLoader;
  promesaLoader = (async () => {
    const urlTres = urlTresCargada();
    if (!urlTres) throw new Error("cargarGLTFLoader: three.js todavía no está cargado");

    const parchear = (txt) => txt.replace(/\}\s*from\s*(['"])three\1;/, `} from '${urlTres}';`);
    const comoBlob = (txt) => URL.createObjectURL(new Blob([txt], { type: "text/javascript" }));

    const [bufTxt, skelTxt, loaderTxt] = await Promise.all([
      fetch(urlAddon("utils/BufferGeometryUtils.js")).then((r) => r.text()),
      fetch(urlAddon("utils/SkeletonUtils.js")).then((r) => r.text()),
      fetch(urlAddon("loaders/GLTFLoader.js")).then((r) => r.text()),
    ]);
    const bufUrl = comoBlob(parchear(bufTxt));
    const skelUrl = comoBlob(parchear(skelTxt));
    const loaderUrl = comoBlob(
      parchear(loaderTxt)
        .replace("../utils/BufferGeometryUtils.js", bufUrl)
        .replace("../utils/SkeletonUtils.js", skelUrl),
    );
    const mod = await import(/* @vite-ignore */ loaderUrl);
    if (!mod?.GLTFLoader) throw new Error("GLTFLoader.js no exportó la clase esperada");
    return mod.GLTFLoader;
  })();
  // Un fallo de red no puede dejar la caché atascada para siempre: la próxima vez se reintenta.
  promesaLoader.catch(() => { promesaLoader = null; });
  return promesaLoader;
}

/** Plantillas ya resueltas: `nombre -> Object3D | null`. `null` = se pidió y no hay archivo (o falló). */
const listos = new Map();
/** Cargas en curso, para no pedir dos veces el mismo nombre a la vez. */
const cargando = new Map();

/**
 * ¿Hay ya en memoria la plantilla del modelo `nombre`? `undefined` si todavía no se pidió o sigue
 * cargando; `null` si se pidió y no hay archivo (o algo falló); si no, la plantilla cargada.
 * Nunca espera: es la forma de usarla desde código síncrono como `construirHeroe`/`construirEnemigo`.
 * @param {string} nombre
 */
export const modeloEnMemoria = (nombre) => listos.get(nombre);

/**
 * Carga de verdad `nombre.glb` (o `nombre.gltf` si no hay `.glb`) desde `web/assets/models/`.
 * Se cachea: una vez resuelta, siempre devuelve lo mismo sin volver a tocar la red.
 *
 * No hay pre-chequeo de existencia con `fetch(url, { method: "HEAD" })`: los CDN de hosting como
 * Itch.io (sirven el juego detrás de un iframe propio) bloquean o rechazan peticiones HEAD con
 * 403/405, así que ese pre-chequeo daba `false` para un `.glb` que sí estaba servido y la criatura
 * se quedaba sin modelo externo en producción aunque funcionara en local. En su lugar, se intenta
 * la carga directa con `loadAsync` y, si falla (404 real, red caída, archivo roto...), se prueba
 * la siguiente extensión; el `try/catch` de más abajo sigue siendo la red de seguridad final.
 * @param {string} nombre sin extensión, p.ej. `"heroe"` o `"dragon"`
 * @returns {Promise<object|null>} la escena cargada (NUNCA se usa directamente: se clona con
 *          `criaturaDesdeModelo`), o `null` si no hay archivo o algo falló.
 */
export async function cargarModeloExterno(nombre) {
  if (listos.has(nombre)) return listos.get(nombre);
  let resultado = null;
  try {
    await cargarTres();
    const GLTFLoader = await cargarGLTFLoader();
    for (const ext of ["glb", "gltf"]) {
      const url = new URL(`${nombre}.${ext}`, BASE_MODELOS).href;
      try {
        const cargador = new GLTFLoader();
        // eslint-disable-next-line no-await-in-loop
        const gltf = await cargador.loadAsync(url);
        resultado = gltf?.scene ?? gltf?.scenes?.[0] ?? null;
        // Los clips embebidos (idle, respiración, alas...) viajan sueltos en `gltf.animations`, no
        // colgados de la escena: se guardan aquí como propiedad de conveniencia, LEÍDA ANTES de
        // clonar en `criaturaDesdeModelo` (un `clone()` de three.js no copia propiedades ajenas).
        if (resultado) resultado.animaciones = gltf.animations ?? [];
        break;
      } catch {
        // No había `.${ext}` (404) o ese archivo concreto está roto: se prueba la otra extensión.
      }
    }
  } catch {
    resultado = null; // modelo roto, CDN caído o navegador sin soporte: no es motivo para romper nada
  }
  listos.set(nombre, resultado);
  return resultado;
}

/**
 * Empieza a cargar `nombre` en segundo plano, sin esperar el resultado: se recoge después con
 * `modeloEnMemoria`. Si ya se pidió (o está en curso), no hace nada. Nunca lanza.
 * @param {string} nombre
 */
export function precargarModelo(nombre) {
  if (listos.has(nombre) || cargando.has(nombre)) return;
  const promesa = cargarModeloExterno(nombre);
  cargando.set(nombre, promesa);
  promesa.catch(() => {}).finally(() => cargando.delete(nombre));
}

/**
 * Convierte la plantilla que devolvió `cargarModeloExterno` en una criatura con el MISMO contrato
 * que las recetas procedurales de `criaturas.js` ({ raiz, taller, alto, radio, partes, materiales,
 * flota }): pivote en los pies, altura medida y una copia PROPIA de cada geometría y material.
 *
 * La copia importa por la memoria de la GPU: `tirar()`/`liberarRama` disponen de cada instancia al
 * sacarla de la arena o desalojarla del almacén, y si dos criaturas compartieran la misma
 * geometría, liberar una dejaría a la otra con un `dispose()` de más (WebGL ya no podría dibujarla).
 * Clonar aquí es barato: una vez por aparición, no por fotograma.
 *
 * Clonar y medir una escena ya cargada son operaciones de los propios objetos, no del espacio de
 * nombres `THREE`, así que `T` solo hace falta si el modelo trae clips de animación (para crear el
 * `AnimationMixer`); en las pruebas, sin `T`, esa parte simplemente se omite.
 *
 * @param {object} plantilla la escena de `cargarModeloExterno` (no se modifica)
 * @param {number} alturaObjetivo metros, de los pies a lo más alto
 * @param {object} [T] three.js, solo para arrancar el `AnimationMixer` si hay clips embebidos
 * @param {string} [nombre] clave del bestiario (para `ROTACION_Y_MODELOS` y `TINTE_MODELOS`)
 * @returns {{raiz:object, taller:{liberar:Function}, alto:number, radio:number, partes:object,
 *            materiales:object[], flota:boolean, externo:true, mixer:object|null}}
 */
export function criaturaDesdeModelo(plantilla, alturaObjetivo, T, nombre) {
  const raiz = plantilla.clone(true);
  const clips = plantilla.animaciones ?? [];
  const materiales = [];
  const tinte = nombre && TINTE_MODELOS[nombre];

  raiz.traverse((n) => {
    if (!n.isMesh || !n.geometry) return;
    n.geometry = n.geometry.clone();
    n.geometry.computeBoundingBox?.();
    const clonar = (m) => {
      const c = m.clone();
      if (tinte && T?.Color) {
        if (c.color && tinte.colorRGB) c.color.setRGB(...tinte.colorRGB);
        else if (c.color && tinte.color != null) c.color = new T.Color(tinte.color);
        if (c.emissive && tinte.emissive != null) {
          c.emissive = new T.Color(tinte.emissive);
          c.emissiveIntensity = tinte.emissiveIntensity ?? 1;
        }
      }
      materiales.push(c);
      return c;
    };
    if (!n.material && T?.MeshStandardMaterial) {
      // Malla sin material (algún exportador lo deja vacío): sin esto se ve negra o blanca lisa.
      const m = new T.MeshStandardMaterial({ color: 0x6b3a2e, roughness: 0.6, metalness: 0.1 });
      materiales.push(m);
      n.material = m;
    } else if (n.material) {
      n.material = Array.isArray(n.material) ? n.material.map(clonar) : clonar(n.material);
    }
    n.castShadow = true;
    n.receiveShadow = true;
  });

  // Caja del modelo en espacio de `raiz`, con la transformación COMPLETA (posición, rotación y
  // escala) de cada antepasado hasta cada malla: a diferencia de `altoReal` en `criaturas.js` (que
  // sí puede ignorar la rotación porque las recetas procedurales nunca rotan una rama entera), un
  // `.glb` descargado puede traer una rotación de conversión de ejes (Z-up → Y-up, muy habitual en
  // piezas exportadas de Blender) en algún antepasado de las mallas; sumar solo posiciones como si
  // nada rotara mediría la "altura" en el eje equivocado. `raiz` acaba de clonarse y no tiene padre
  // (`clone()` no conserva `.parent`), así que su propio `matrixWorld` es la identidad y el
  // `matrixWorld` de cada malla tras `updateMatrixWorld` ya está expresado en el espacio de `raiz`.
  raiz.updateMatrixWorld(true);
  let caja = null;
  raiz.traverse((n) => {
    if (!n.isMesh || !n.geometry?.boundingBox) return;
    const b = n.geometry.boundingBox.clone().applyMatrix4(n.matrixWorld);
    caja = caja ? caja.union(b) : b;
  });

  const altoBruto = caja && caja.max.y > caja.min.y ? caja.max.y - caja.min.y : 1;
  const escala = altoBruto > 0 ? alturaObjetivo / altoBruto : 1;
  raiz.scale.setScalar(escala);
  raiz.position.y -= (caja ? caja.min.y : 0) * escala;
  // Centrado horizontal: el centro de la caja (no el origen del archivo) cae en x=0,z=0 del puesto.
  if (caja) {
    raiz.position.x -= ((caja.min.x + caja.max.x) / 2) * escala;
    raiz.position.z -= ((caja.min.z + caja.max.z) / 2) * escala;
  }

  const radio = caja
    ? Math.max(0.3, Math.max(caja.max.x - caja.min.x, caja.max.z - caja.min.z) * escala * 0.5)
    : 0.3;

  // Giro de corrección (ver `ROTACION_Y_MODELOS`): algunos `.glb` miran hacia -Z en vez de hacia
  // el jugador. Rota sobre el propio pivote (ya centrado en x/z), así que no desplaza nada más.
  const giro = (nombre && ROTACION_Y_MODELOS[nombre]) || 0;
  if (giro) raiz.rotation.y = giro; // `raiz` recién clonada: su rotación de partida siempre es 0

  // Clips embebidos (idle, respiración, alas...): si hay y tenemos `T`, se reproducen en bucle
  // desde ya. Sin esto un modelo externo se queda congelado en su pose de reposo del archivo.
  let mixer = null;
  if (T?.AnimationMixer && clips.length) {
    mixer = new T.AnimationMixer(raiz);
    for (const clip of clips) mixer.clipAction(clip).play();
  }

  return {
    raiz, taller: { liberar() { mixer?.stopAllAction(); } }, alto: alturaObjetivo, radio,
    partes: {}, materiales, flota: false, externo: true, mixer,
    // `escena3d.js` reutiliza instancias desde un almacén y `restaurar()` repone la posición y la
    // rotación del modelo; sin esto volvería a (0,0,0) y perdería el centrado/giro de arriba en
    // cuanto se reciclara una segunda vez.
    posBase: { x: raiz.position.x, y: raiz.position.y, z: raiz.position.z },
    rotYBase: giro,
  };
}

/** Solo para pruebas: olvida todo lo cargado y en curso. */
export function _olvidarModelos() {
  listos.clear();
  cargando.clear();
  promesaLoader = null;
}

/**
 * Solo para pruebas: pone en memoria la plantilla de `nombre` sin tocar la red, como si
 * `cargarModeloExterno` ya hubiera terminado. Así se puede probar la rama "hay modelo externo" de
 * `construirHeroe`/`construirEnemigo` sin CDN, sin GPU y sin un `.glb` de verdad.
 */
export function _forzarModeloParaPruebas(nombre, plantilla) {
  listos.set(nombre, plantilla);
}
