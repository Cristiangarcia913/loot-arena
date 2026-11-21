// Suite de Playtesting Multiagente: 4 arquetipos de jugador que estresan el motor de combate,
// la progresión, el inventario/economía y los módulos más frágiles (emociones.js, render3d) para
// cazar errores ocultos y dar un veredicto de balance. Es un SCRIPT de simulación con cuadro de
// mando en consola (`npm run test:agentes`), no una suite de `node --test`: por eso vive en
// `test/` pero su nombre no contiene `.test.`, así `node --test` (→ `npm test`) no lo recoge.
//
// Alcance deliberado (para no fabricar "bugs" que en realidad son huecos del entorno Node):
//   - render3d (THREE.js/WebGL) y la UI con DOM real (toast, popovers…) ya tienen su propia
//     batería con un doble de three.js en `test/render3d-*.test.js`; aquí solo se comprueba que
//     esos módulos CARGUEN sin romperse, no se repite la simulación 3D.
//   - `emociones.js`: se ejercitan sus funciones puras y `soportaCamara()` (sin DOM), pero NO
//     `activarMedidor()`, porque esa función usa `document`/`toast()` internamente — llamarla
//     sin navegador real solo demostraría que falta un DOM, no un bug del juego.
import * as C from "../js/combat.js";
import * as P from "../js/progression.js";
import * as EQ from "../js/equipment.js";
import * as SET from "../js/conjuntos.js";
import * as BOT from "../js/botin-local.js";
import * as ECON from "../js/economy.js";
import * as EMO from "../js/emociones.js";

// ─────────────────────────── Utilidades compartidas ───────────────────────────

/** storage en memoria con la interfaz de localStorage (mismo patrón que test/progression.test.js). */
function storageMemoria() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

function nuevoReporte(nombre) {
  return { nombre, combates: 0, victorias: 0, derrotas: 0, huidas: 0, errores: [], advertencias: [], info: [], metricas: {} };
}
const error = (r, msg) => r.errores.push(msg);
const advertencia = (r, msg) => r.advertencias.push(msg);
const media = (arr) => (arr.length ? Math.round((arr.reduce((s, x) => s + x, 0) / arr.length) * 10) / 10 : 0);
const pct = (x) => `${Math.round(x * 1000) / 10}%`;

/**
 * Juega un combate completo turno a turno con una política de IA, atrapando cualquier excepción
 * (la política, `turnoJugador`, valores no finitos…) en vez de dejar que reviente el proceso:
 * es justo lo que un "agente de pruebas" automatizado necesita para no bloquear el resto de la
 * batería por un solo combate raro.
 * @param {object} combate combate ya creado con `crearCombate`
 * @param {(combate:object)=>*} elegirAccion política de IA (puede lanzar: se captura)
 * @param {()=>number} rng
 * @param {object} reporte
 * @param {{permitirRevivir?:boolean}} [opts]
 */
function jugarCombate(combate, elegirAccion, rng, reporte, { permitirRevivir = false } = {}) {
  let revivioYa = false;
  let turnos = 0;
  let minPctVida = 1;
  const TOPE_RONDAS = 500; // un combate real nunca llega ni de lejos: si pasa, está colgado.
  while (combate.fase === "en_curso") {
    turnos += 1;
    if (turnos > TOPE_RONDAS) {
      error(reporte, `Combate colgado: superadas ${TOPE_RONDAS} rondas sin terminar (enemigo: ${combate.enemigo?.nombre ?? "?"}).`);
      break;
    }
    let accion;
    try {
      accion = elegirAccion(combate);
    } catch (e) {
      error(reporte, `La política de IA lanzó una excepción eligiendo acción: ${e.message}`);
      accion = "atacar";
    }
    if (!C.validarAccion(combate, accion).ok) accion = "atacar"; // fallback seguro ante una elección inválida
    let resultado;
    try {
      resultado = C.turnoJugador(combate, accion, rng);
    } catch (e) {
      error(reporte, `turnoJugador lanzó una excepción con una acción válida (${JSON.stringify(accion)}): ${e.message}`);
      break;
    }
    combate = resultado.combate;
    if (!Number.isFinite(combate.jugador.vida) || !Number.isFinite(combate.enemigo.vida)) {
      error(reporte, "Vida no finita (NaN/Infinity) tras un turno de combate.");
      break;
    }
    minPctVida = Math.min(minPctVida, combate.jugador.vida / combate.jugador.vidaMax);
    if (combate.fase === "derrota" && permitirRevivir && !revivioYa) {
      revivioYa = true;
      try {
        combate = C.revivirEnArena(combate, rng);
        reporte.metricas.revividos = (reporte.metricas.revividos ?? 0) + 1;
      } catch (e) {
        error(reporte, `revivirEnArena lanzó una excepción en un combate recién perdido: ${e.message}`);
      }
    }
  }
  return { combate, turnos, minPctVida };
}

/** Aplica el resultado de un combate terminado a la progresión y lo contabiliza en el reporte. */
function registrarResultado(final, progreso, reporte) {
  if (final.fase === "victoria") { reporte.victorias += 1; reporte.combates += 1; return P.aplicarVictoria(progreso, final.enemigo).progreso; }
  if (final.fase === "derrota") { reporte.derrotas += 1; reporte.combates += 1; return P.aplicarDerrota(progreso); }
  if (final.fase === "huida") { reporte.huidas += 1; reporte.combates += 1; return P.aplicarHuida(progreso); }
  error(reporte, `Un combate terminó en una fase inesperada ('${final.fase}'): probable combate colgado, no se contabiliza.`);
  return progreso;
}

// ═══════════════════════ AGENTE 1: El Berserker (nivel 1-10) ═══════════════════════
// 100% ofensivo: nunca Defender, nunca pociones, usa cualquier habilidad en cuanto está lista
// (sin esperar el momento óptimo) y gasta el Remate Definitivo en cuanto llega al 100%.

const HABILIDADES_OFENSIVAS = ["golpe_poderoso", "rompearmaduras", "estocada_precisa", "desangrar", "grito_guerra", "segundo_aliento"];

function accionBerserker(combate) {
  if (combate.jugador.furia >= C.FURIA_MAX) return "rematar";
  const libre = HABILIDADES_OFENSIVAS
    .map((id) => combate.jugador.habilidades.find((h) => h.id === id && h.restante === 0))
    .find(Boolean);
  if (libre) return { habilidad: libre.id };
  return "atacar";
}

function simularBerserker() {
  const reporte = nuevoReporte("Agente 1 · El Berserker (nivel de héroe 1-10)");
  const rng = C.mulberry32(0xbe125e17);
  let progreso = P.progresoNuevo();
  const COMBATES = 30;
  const turnosPorCombate = [];
  let minVidaGlobal = 1;

  for (let i = 0; i < COMBATES; i++) {
    const statsHeroe = P.statsHeroe(progreso, []);
    const nivelArenaActual = C.nivelArena(progreso.victorias);
    const esJefe = C.esCombateDeJefe(progreso.victorias);
    let enemigo, combate;
    try { enemigo = C.generarEnemigo(nivelArenaActual, rng, { jefe: esJefe }); }
    catch (e) { error(reporte, `generarEnemigo lanzó una excepción: ${e.message}`); continue; }
    try { combate = C.crearCombate(statsHeroe, enemigo, rng); }
    catch (e) { error(reporte, `crearCombate lanzó una excepción: ${e.message}`); continue; }

    const { combate: final, turnos, minPctVida } = jugarCombate(combate, accionBerserker, rng, reporte, { permitirRevivir: true });
    turnosPorCombate.push(turnos);
    minVidaGlobal = Math.min(minVidaGlobal, minPctVida);
    progreso = registrarResultado(final, progreso, reporte);
  }

  // Robustez del sistema de "anuncio": revivir fuera de una derrota real debe fallar, no corromper nada.
  try {
    const combatePrueba = C.crearCombate(P.statsHeroe(progreso, []), C.generarEnemigo(1, rng), rng);
    C.revivirEnArena(combatePrueba, rng);
    error(reporte, "revivirEnArena() no lanzó excepción sobre un combate 'en_curso' (debería exigir fase 'derrota').");
  } catch { /* comportamiento esperado */ }

  reporte.metricas = {
    ...reporte.metricas,
    nivelHeroeFinal: progreso.nivel,
    mejorRacha: progreso.mejorRacha,
    turnoMedioPorCombate: media(turnosPorCombate),
    vidaMinimaAlcanzada: `${Math.round(minVidaGlobal * 100)}%`,
  };
  const tasa = reporte.combates ? reporte.victorias / reporte.combates : 0;
  reporte.metricas.tasaVictoria = pct(tasa);
  if (tasa < 0.15) { advertencia(reporte, `Tasa de victoria muy baja (${pct(tasa)}) jugando 30 combates tempranos: el daño enemigo podría escalar demasiado rápido para un héroe recién llegado.`); reporte.señalBalance = "dificil"; }
  else if (tasa > 0.95) { advertencia(reporte, `Tasa de victoria muy alta (${pct(tasa)}) a pesar de jugar 100% ofensivo, sin Defender ni pociones: el enemigo podría ser demasiado blando en los primeros niveles.`); reporte.señalBalance = "facil"; }
  else reporte.señalBalance = "equilibrado";

  return reporte;
}

// ═════════════ AGENTE 2: El Táctico / Gladiador Maestro (nivel 10-20) ═════════════
// Juego óptimo: Defender ante todo ataque telegrafiado, pociones por debajo del 35% de vida,
// acumula sangrado/veneno con Desangrar y guarda el Remate para la fase de Enrage de los jefes.

function accionTactico(combate) {
  const intencion = C.intencionEnemigo(combate);
  if (intencion?.telegrafiado) return "defender";

  const pctVida = combate.jugador.vida / combate.jugador.vidaMax;
  if (pctVida < 0.35 && combate.jugador.pociones > 0) return "pocion";

  const enEnrage = combate.jefe && combate.enemigo.fase === 2;
  if (combate.jugador.furia >= C.FURIA_MAX && (!combate.jefe || enEnrage)) return "rematar";

  const desangrar = combate.jugador.habilidades.find((h) => h.id === "desangrar" && h.restante === 0);
  const enemigoYaSangra = combate.enemigo.estados.some((e) => (e.tipo === "sangrado" || e.tipo === "veneno") && e.turnos > 0);
  if (desangrar && !enemigoYaSangra) return { habilidad: "desangrar" };

  const prioridad = ["golpe_poderoso", "rompearmaduras", "estocada_precisa", "grito_guerra", "segundo_aliento"];
  const libre = prioridad.map((id) => combate.jugador.habilidades.find((h) => h.id === id && h.restante === 0)).find(Boolean);
  if (libre) return { habilidad: libre.id };

  return "atacar";
}

/**
 * Equipo "de Gladiador Maestro": una pieza Legendaria de cada tipo con la estadística principal
 * al máximo de su rango (ver `botin-local.rangoStat`). El "Táctico" representa a un jugador que
 * ya lleva muchas horas y ha progresado el inventario (trabajo del Agente 3): sin esto, un héroe
 * nivel 10-20 sin NINGÚN objeto equipado no tiene ninguna opción real contra un jefe de nivel 10
 * (el equipo NFT es, a propósito, la mayor parte del poder del héroe; ver `MEJORA_POR_NIVEL`), y
 * la racha de 20 no mediría el balance de los jefes sino solo la ausencia de equipo.
 */
function equipoDeGladiadorMaestro(nivel = 10) {
  const [, hi] = BOT.rangoStat(2, nivel, { jefe: true });
  return EQ.TIPOS.map((tipo) => {
    const esAtaque = tipo === "Espada";
    const secundaria = Math.round(hi * 0.2);
    return {
      tokenId: `gladiador-${tipo}`, nombre: `${tipo} Legendaria de prueba`, tipo, rareza: 2,
      ataque: esAtaque ? hi : secundaria, defensa: esAtaque ? secundaria : hi,
    };
  });
}

function simularTactico() {
  const reporte = nuevoReporte("Agente 2 · El Táctico / Gladiador Maestro (nivel de héroe 10-20)");
  const rng = C.mulberry32(0x7ac71c0);
  let progreso = { ...P.progresoNuevo(), nivel: 10 };
  const equipoTactico = equipoDeGladiadorMaestro(10);
  const JEFES = ["quimera", "liche", "dragon"];
  const RACHA_OBJETIVO = 20;
  const MAX_COMBATES = 200; // tope de seguridad: la dificultad escala SIN techo con la racha (a propósito).

  // Ojo: NO se para en cuanto la racha llega a 20. `escalarPorRacha` endurece al rival sin techo
  // a propósito (ver combat.js: "lo que hace que seguir arriesgando la racha dé más miedo cuanto
  // más larga es"), así que el objetivo real es ver si la escalada llega a morder de verdad en
  // `MAX_COMBATES` intentos, no solo si se toca 20 una vez con el mejor equipo posible.
  let racha = 0, mejorRacha = 0, intentos = 0, objetivoAlcanzado = false;
  const turnosPorCombate = [];

  while (intentos < MAX_COMBATES) {
    intentos += 1;
    const clave = JEFES[intentos % JEFES.length];
    const statsHeroe = P.statsHeroe(progreso, equipoTactico);
    let base, enemigo, combate;
    try { base = C.generarEnemigoDe(clave, 10, { jefe: true }); }
    catch (e) { error(reporte, `generarEnemigoDe('${clave}') lanzó una excepción: ${e.message}`); break; }
    try { enemigo = C.escalarPorRacha(base, racha, { jefeDeRacha: racha > 0 && racha % C.RACHA_CADA_JEFE === 0 }); }
    catch (e) { error(reporte, `escalarPorRacha lanzó una excepción: ${e.message}`); break; }
    try { combate = C.crearCombate(statsHeroe, enemigo, rng); }
    catch (e) { error(reporte, `crearCombate lanzó una excepción: ${e.message}`); break; }

    const { combate: final, turnos } = jugarCombate(combate, accionTactico, rng, reporte, { permitirRevivir: false });
    turnosPorCombate.push(turnos);
    progreso = registrarResultado(final, progreso, reporte);
    if (final.fase === "victoria") {
      racha += 1;
      mejorRacha = Math.max(mejorRacha, racha);
      if (racha >= RACHA_OBJETIVO) objetivoAlcanzado = true;
    } else if (final.fase === "derrota") {
      racha = 0;
    }
  }

  const nuncaPerdio = reporte.derrotas === 0;
  reporte.metricas = {
    mejorRachaConsecutiva: mejorRacha,
    rachaDe20AlcanzadaAlgunaVez: objetivoAlcanzado,
    combatesDeJefeJugados: intentos,
    derrotasTotales: reporte.derrotas,
    nivelHeroeFinal: progreso.nivel,
    turnoMedioPorCombate: media(turnosPorCombate),
  };
  const tasa = reporte.combates ? reporte.victorias / reporte.combates : 0;
  reporte.metricas.tasaVictoriaJefes = pct(tasa);

  if (mejorRacha < 5) {
    advertencia(reporte, `Con juego óptimo y el mejor equipo posible, la mejor racha lograda contra Quimera/Liche/Dragón en ${intentos} combates fue solo ${mejorRacha}: los jefes podrían ser demasiado duros incluso jugando y equipando de forma óptima.`);
    reporte.señalBalance = "dificil";
  } else if (nuncaPerdio) {
    advertencia(reporte, `Ni una sola derrota en ${intentos} combates de jefe consecutivos (incluida la escalada por racha): con el mejor equipo posible, la dificultad sin techo no llegó a morder. Los jefes podrían ser demasiado blandos en la cima.`);
    reporte.señalBalance = "facil";
  } else {
    if (!objetivoAlcanzado) advertencia(reporte, `No llegó a encadenar ${RACHA_OBJETIVO} victorias consecutivas tras ${intentos} combates (mejor racha: ${mejorRacha}), aunque sí perdió alguna vez; recordar que la dificultad por racha no tiene techo a propósito, así que esto no es necesariamente un bug.`);
    reporte.señalBalance = "equilibrado";
  }

  return reporte;
}

// ═══════════════ AGENTE 3: El Coleccionista y Mercader (economía e inventario) ═══════════════

const TIPO_STAT_PRINCIPAL = { Espada: "ataque", Escudo: "defensa", Casco: "defensa", Armadura: "defensa", Botas: "defensa" };
const poder = (it) => it.ataque + it.defensa;

async function simularColeccionista() {
  const reporte = nuevoReporte("Agente 3 · El Coleccionista y Mercader (economía e inventario)");
  const rng = C.mulberry32(0xc0115ec);
  let estado = BOT.estadoVacio();
  let equipo = {};
  const DROPS = 40;
  const setsConBono = new Set(), setsConEfecto = new Set();

  for (let i = 0; i < DROPS; i++) {
    const nivel = C.clampNivel(1 + Math.floor(i / 4));
    const jefe = i % 7 === 6;
    let resultado;
    try { resultado = BOT.tirarBotinLocal(estado, { nivel, jefe }, rng, { equipados: Object.values(equipo) }); }
    catch (e) { error(reporte, `tirarBotinLocal lanzó una excepción: ${e.message}`); continue; }
    estado = resultado.estado;
    const item = resultado.item;
    if (!item) continue;

    // Invariantes de generación: que ninguna estadística se desborde del rango definido para su rareza.
    const [lo, hi] = BOT.rangoStat(item.rareza, nivel, { jefe });
    const principal = item[TIPO_STAT_PRINCIPAL[item.tipo]];
    if (principal < lo || principal > hi) error(reporte, `Objeto fuera de rango: "${item.nombre}" (${principal}, esperado [${lo},${hi}] para rareza ${item.rareza}).`);
    if (item.ataque < 0 || item.ataque > 999 || item.defensa < 0 || item.defensa > 999) error(reporte, `Objeto con estadística fuera de los límites técnicos: ${JSON.stringify(item)}.`);

    // Ida y vuelta por localStorage: que no haya corrupción al guardar/releer la mochila.
    const storage = storageMemoria();
    storage.setItem(BOT.CLAVE_BOTIN_LOCAL, BOT.serializarEstado(estado));
    const relectura = BOT.parsearEstado(storage.getItem(BOT.CLAVE_BOTIN_LOCAL));
    if (relectura.items.length !== estado.items.length) error(reporte, `La ida y vuelta por localStorage perdió objetos: ${estado.items.length} → ${relectura.items.length}.`);
    if (JSON.stringify(relectura.items.at(-1)) !== JSON.stringify(estado.items.at(-1))) error(reporte, "El último objeto cambió tras pasar por localStorage (posible corrupción de datos).");

    // Equipa lo mejor: compara poder (ataque+defensa) con lo que ya lleva puesto en esa ranura.
    const actualId = equipo[item.tipo];
    const actual = actualId ? estado.items.find((x) => x.tokenId === actualId) : null;
    if (!actual || poder(item) > poder(actual)) {
      try { equipo = EQ.equipar(equipo, item); }
      catch (e) { error(reporte, `equipar() lanzó una excepción: ${e.message}`); }
    }

    // Set Bonuses: registra la primera vez que se activan (Gladiador, Coloso, Sombras).
    const equipados = EQ.itemsEquipados(equipo, estado.items);
    for (const s of SET.contarConjuntos(equipados)) {
      if (s.bonoActivo && !setsConBono.has(s.id)) { setsConBono.add(s.id); reporte.info.push(`Bono de 2 piezas activado: ${s.nombre} (${s.textoBono}).`); }
      if (s.efectoActivo && !setsConEfecto.has(s.id)) { setsConEfecto.add(s.id); reporte.info.push(`Efecto de 4 piezas activado: ${s.nombre} (${s.textoEfecto}).`); }
    }
  }

  // Topes de estadística del héroe (crítico/esquiva) con el mejor equipo conseguido: no deben desbordar.
  const equipadosFinal = EQ.itemsEquipados(equipo, estado.items);
  const statsFinal = P.statsHeroe({ ...P.progresoNuevo(), nivel: P.NIVEL_HEROE_MAX }, equipadosFinal);
  if (statsFinal.critico > P.CRITICO_TOPE_CONJUNTO + 1e-9) error(reporte, `La probabilidad de crítico desborda su tope: ${statsFinal.critico} > ${P.CRITICO_TOPE_CONJUNTO}.`);
  if (statsFinal.esquiva > P.ESQUIVA_TOPE_CONJUNTO + 1e-9) error(reporte, `La probabilidad de esquiva desborda su tope: ${statsFinal.esquiva} > ${P.ESQUIVA_TOPE_CONJUNTO}.`);

  // Economía simulada: Tienda del Día, compra y venta de equipo repetido, sin duplicar $ORO.
  // La oferta cambia con la fecha (hasta 900 ORO, "Mini dragón"): el saldo inicial cubre la oferta
  // de HOY más 500, para que el resultado no dependa del día en que se ejecute la suite.
  const oferta = ECON.ofertaDelDiaCosmetico(ECON.semillaDelDia());
  const oroInicial = 500 + (oferta?.precio ?? 0);
  const economia = ECON.crearEconomiaSimulada({ oro: oroInicial, latencia: 0, rng, aprobado: true });
  let oroEsperado = ECON.aUnidades(oroInicial);

  if (!oferta) {
    advertencia(reporte, "ofertaDelDiaCosmetico() no devolvió ninguna oferta del día.");
  } else {
    try {
      const tx = await economia.comprar(oferta.id, 1);
      await tx.esperar();
      oroEsperado -= ECON.aUnidades(oferta.precio);
    } catch (e) { error(reporte, `Comprar la Oferta del Día ("${oferta.nombre}") lanzó una excepción: ${e.message}`); }
  }
  let saldo = await economia.saldoOro();
  if (saldo !== oroEsperado) error(reporte, `Discrepancia de $ORO tras comprar en la Tienda del Día: esperado ${oroEsperado}, real ${saldo}.`);

  // "Vende equipo repetido": duplicados más débiles en un inventario de prueba.
  const duplicados = [
    { tokenId: "901", rareza: 0, ataque: 2, defensa: 1 },
    { tokenId: "902", rareza: 1, ataque: 8, defensa: 3 },
  ];
  for (const it of duplicados) economia._estado.inv.set(it.tokenId, it);
  const ids = duplicados.map((d) => d.tokenId);
  const totalVentaEsperado = duplicados.reduce((s, it) => s + ECON.aUnidades(ECON.precioVentaLocal(it)), 0n);
  try {
    const tx = await economia.vender(ids);
    await tx.esperar();
    oroEsperado += totalVentaEsperado;
  } catch (e) { error(reporte, `vender() de equipo repetido lanzó una excepción: ${e.message}`); }
  saldo = await economia.saldoOro();
  if (saldo !== oroEsperado) error(reporte, `Discrepancia de $ORO tras vender equipo repetido: esperado ${oroEsperado}, real ${saldo}.`);

  // Re-vender los MISMOS objetos debe fallar: si no, hay duplicación de $ORO.
  let segundaVentaFallo = false;
  try { const tx = await economia.vender(ids); await tx.esperar(); }
  catch { segundaVentaFallo = true; }
  if (!segundaVentaFallo) error(reporte, "¡Posible duplicación de $ORO! vender() aceptó dos veces los mismos objetos ya vendidos.");
  saldo = await economia.saldoOro();
  if (saldo !== oroEsperado) error(reporte, `El $ORO cambió tras un intento de venta que debía fallar: esperado ${oroEsperado}, real ${saldo}.`);

  reporte.combates = DROPS;
  reporte.victorias = estado.items.length;
  reporte.metricas = {
    objetosGenerados: estado.items.length,
    objetosEquipados: Object.keys(equipo).length,
    setsConBonoActivo: [...setsConBono],
    setsConEfectoActivo: [...setsConEfecto],
    oroFinal: ECON.oroEntero(saldo),
    duplicacionDeOroDetectada: !segundaVentaFallo,
  };
  return reporte;
}

// ═══════════════ AGENTE 4: Chaos Monkey (buscador de bugs y límites) ═══════════════

function accionAleatoria(rng) {
  return (combate) => {
    const candidatas = ["atacar", "defender", "pocion", "rematar", ...combate.jugador.habilidades.map((h) => ({ habilidad: h.id }))];
    const validas = candidatas.filter((o) => C.validarAccion(combate, o).ok);
    if (!validas.length) return "atacar";
    return validas[Math.floor(rng() * validas.length)];
  };
}

/** Sustituye temporalmente `globalThis.navigator` (que en Node moderno es un getter de solo
 * lectura: no se puede hacer `globalThis.navigator = …` sin `defineProperty`) y lo restaura siempre. */
function conNavigatorSimulado(valor, fn) {
  const descriptorOriginal = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: valor, configurable: true, writable: true });
  try { return fn(); }
  finally {
    if (descriptorOriginal) Object.defineProperty(globalThis, "navigator", descriptorOriginal);
    else delete globalThis.navigator;
  }
}

async function simularChaosMonkey() {
  const reporte = nuevoReporte("Agente 4 · Chaos Monkey (bugs y límites)");
  const rng = C.mulberry32(0xcaec0);

  // Red de seguridad: cualquier excepción/rechazo que escape de nuestros propios try/catch
  // (justo lo que pide la tarea: UnhandledPromiseRejection) se captura aquí en vez de tumbar el proceso.
  const capturados = [];
  const onRejection = (razon) => capturados.push(`UnhandledPromiseRejection: ${razon?.message ?? razon}`);
  const onException = (err) => capturados.push(`UncaughtException: ${err?.message ?? err}`);
  process.on("unhandledRejection", onRejection);
  process.on("uncaughtException", onException);

  // 1. Sanidad de carga de módulos: que ninguno rompa al importarse.
  const modulos = [
    "../js/combat.js", "../js/progression.js", "../js/skills.js", "../js/equipment.js",
    "../js/conjuntos.js", "../js/botin-local.js", "../js/economy.js", "../js/emociones.js",
    "../js/historial-local.js", "../js/render3d/modelos.js", "../js/render3d/criaturas.js",
  ];
  for (const ruta of modulos) {
    try { await import(ruta); }
    catch (e) { error(reporte, `No se pudo importar ${ruta}: ${e.message}`); }
  }
  reporte.info.push("render3d (THREE.js/WebGL) no se vuelve a simular aquí: ya lo cubre test/render3d-*.test.js con un doble de three.js; esta suite solo confirma que esos módulos cargan.");

  // 2. Las 20 criaturas del bestiario, con una política de acciones aleatoria (válidas) por turno.
  let combatesBestiario = 0;
  for (const b of C.BESTIARIO) {
    for (let rep = 0; rep < 3; rep++) {
      const jefe = rep === 2;
      let enemigo, combate;
      try { enemigo = C.generarEnemigoDe(b.clave, C.randInt(1, 10, rng), { jefe }); }
      catch (e) { error(reporte, `generarEnemigoDe('${b.clave}') lanzó una excepción: ${e.message}`); continue; }
      try { combate = C.crearCombate(C.STATS_BASE, enemigo, rng); }
      catch (e) { error(reporte, `crearCombate con '${b.clave}' lanzó una excepción: ${e.message}`); continue; }
      jugarCombate(combate, accionAleatoria(rng), rng, reporte, { permitirRevivir: false });
      combatesBestiario += 1;
    }
  }

  // 3. Acciones basura deliberadas: deben rechazarse de forma controlada, no reventar el motor.
  const combatePrueba = C.crearCombate(C.STATS_BASE, C.generarEnemigo(5, rng), rng);
  const accionesBasura = [undefined, null, 123, "volar", {}, [], { habilidad: "no_existe" }, { habilidad: 123 }];
  for (const basura of accionesBasura) {
    if (C.validarAccion(combatePrueba, basura).ok) { error(reporte, `validarAccion() aceptó una acción basura: ${JSON.stringify(basura)}.`); continue; }
    try { C.turnoJugador(combatePrueba, basura, rng); error(reporte, `turnoJugador() no lanzó excepción con una acción inválida: ${JSON.stringify(basura)}.`); }
    catch (e) { if (!(e instanceof Error)) error(reporte, `turnoJugador() lanzó algo que no es un Error: ${String(e)}.`); }
  }

  // 4. RNG corruptos o extremos: que no se filtren NaN/Infinity al estado del combate.
  const rngsExtremos = { siempreCero: () => 0, siempreCasiUno: () => 0.999999999 };
  for (const [nombre, rngExtremo] of Object.entries(rngsExtremos)) {
    try {
      const c0 = C.crearCombate(C.STATS_BASE, C.generarEnemigo(5, rngExtremo), rngExtremo);
      const { combate } = C.turnoJugador(c0, "atacar", rngExtremo);
      if (!Number.isFinite(combate.jugador.vida) || !Number.isFinite(combate.enemigo.vida)) error(reporte, `El rng '${nombre}' produjo vida no finita (NaN/Infinity).`);
    } catch (e) { error(reporte, `El rng '${nombre}' hizo que el motor lanzara una excepción: ${e.message}.`); }
  }

  // 5. emociones.js: entradas aleatorias/basura, sin cámara activa.
  const basuraEmocion = [null, undefined, {}, { happy: "no-numero" }, { happy: NaN }, { happy: Infinity }, "no-un-objeto", 42, []];
  for (const g of basuraEmocion) {
    try { EMO.puntuarEmocion(g); } catch (e) { error(reporte, `puntuarEmocion() lanzó con entrada basura (${JSON.stringify(g)}): ${e.message}.`); }
    try { EMO.clasificarReaccion({ antes: g, durante: g, despues: g }); } catch (e) { error(reporte, `clasificarReaccion() lanzó con entrada basura: ${e.message}.`); }
  }
  for (const ev of ["botin_raro", "jefe_vencido", "evento_inventado", 123, null, undefined]) {
    try { await EMO.capturarPico(ev); } catch (e) { error(reporte, `capturarPico('${ev}') lanzó una excepción (medidor inactivo): ${e.message}.`); }
  }

  // 6. "Cámara simulada" activa y denegada, a nivel de API (sin tocar el DOM: ver cabecera del fichero).
  try {
    conNavigatorSimulado({ mediaDevices: { getUserMedia: async () => ({}) } }, () => {
      if (EMO.soportaCamara() !== true) error(reporte, "soportaCamara() no detecta una cámara simulada disponible.");
    });
    conNavigatorSimulado({}, () => {
      if (EMO.soportaCamara() !== false) error(reporte, "soportaCamara() no detecta la ausencia/denegación de la cámara.");
    });
    conNavigatorSimulado(undefined, () => {
      if (EMO.soportaCamara() !== false) error(reporte, "soportaCamara() lanza o falla sin `navigator` global.");
    });
  } catch (e) { error(reporte, `La simulación de cámara lanzó una excepción inesperada: ${e.message}.`); }

  // Deja que cualquier microtarea pendiente dispare los handlers antes de desconectarlos.
  await new Promise((r) => setTimeout(r, 20));
  process.off("unhandledRejection", onRejection);
  process.off("uncaughtException", onException);
  for (const c of capturados) error(reporte, c);

  reporte.combates = combatesBestiario;
  reporte.metricas = { combatesBestiario, criaturasCubiertas: C.BESTIARIO.length, excepcionesNoControladas: capturados.length };
  return reporte;
}

// ─────────────────────────── Cuadro de mando en consola ───────────────────────────

const LINEA = "─".repeat(72);
const DOBLE = "═".repeat(72);

function imprimirAgente(r) {
  console.log(DOBLE);
  console.log(`🤖 ${r.nombre}`);
  console.log(LINEA);
  if (r.combates > 0) {
    const tasa = r.victorias / r.combates;
    console.log(`Acciones: ${r.combates}   Victorias/OK: ${r.victorias}   Derrotas: ${r.derrotas}   Huidas: ${r.huidas}   Tasa: ${pct(tasa)}`);
  } else {
    console.log("Agente sin métrica de victoria/derrota (ver métricas abajo).");
  }
  for (const [k, v] of Object.entries(r.metricas)) console.log(`  · ${k}: ${Array.isArray(v) ? (v.length ? v.join(", ") : "—") : v}`);
  if (r.info.length) { console.log(`ℹ Observaciones (${r.info.length}):`); for (const i of r.info) console.log(`  - ${i}`); }
  console.log(`⚠ Advertencias (${r.advertencias.length})${r.advertencias.length ? ":" : ""}`);
  for (const a of r.advertencias) console.log(`  - ${a}`);
  console.log(`✗ Errores (${r.errores.length})${r.errores.length ? ":" : ""}`);
  for (const e of r.errores) console.log(`  - ${e}`);
}

function veredictoBalance(reportes) {
  const señales = reportes.map((r) => r.señalBalance).filter(Boolean);
  const dificil = señales.includes("dificil");
  const facil = señales.includes("facil");
  if (dificil && facil) return "Mixto: revisar por tramo (algún extremo demasiado difícil y otro demasiado fácil).";
  if (dificil) return "Demasiado difícil.";
  if (facil) return "Demasiado fácil.";
  return "Equilibrado.";
}

function imprimirDashboard(reportes) {
  for (const r of reportes) imprimirAgente(r);
  console.log(DOBLE);
  console.log("🏁 VEREDICTO FINAL");
  console.log(LINEA);
  const totalErrores = reportes.reduce((s, r) => s + r.errores.length, 0);
  const totalAdvertencias = reportes.reduce((s, r) => s + r.advertencias.length, 0);
  console.log(`Balance del juego: ${veredictoBalance(reportes)}`);
  console.log(`Errores críticos detectados en total: ${totalErrores}`);
  console.log(`Advertencias totales: ${totalAdvertencias}`);
  console.log(DOBLE);
}

// ─────────────────────────── main ───────────────────────────

async function main() {
  const inicio = Date.now();
  const reportes = [];
  reportes.push(simularBerserker());
  reportes.push(simularTactico());
  reportes.push(await simularColeccionista());
  reportes.push(await simularChaosMonkey());
  imprimirDashboard(reportes);
  console.log(`Tiempo total: ${((Date.now() - inicio) / 1000).toFixed(2)} s`);
  const hayErroresCriticos = reportes.some((r) => r.errores.length > 0);
  process.exitCode = hayErroresCriticos ? 1 : 0;
}

main().catch((e) => {
  console.error("💥 La suite de simulación multiagente lanzó una excepción no controlada:");
  console.error(e);
  process.exitCode = 1;
});
