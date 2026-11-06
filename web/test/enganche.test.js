import { test } from "node:test";
import assert from "node:assert/strict";
import * as G from "../js/enganche.js";
import * as misiones from "../js/misiones.js";
import * as pase from "../js/pase.js";
import * as logros from "../js/logros.js";
import * as coleccion from "../js/coleccion.js";
import * as desafio from "../js/desafio.js";

const MODS = { misiones, pase, logros, coleccion, desafio };
const T = Date.UTC(2026, 10, 5, 12, 0, 0); // jueves 5-11-2026 12:00 UTC
const UNO = 10n ** 18n;
const memoria = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), _m: m }; };

test("fechas UTC y cuenta atrás", () => {
  assert.equal(G.diaUTC(T), Math.floor(T / 86_400_000));
  assert.equal(G.finDiaUTC(T), Date.UTC(2026, 10, 6));
  assert.equal(G.semanaUTC(T), misiones.semanaUTC(T));
  assert.equal(G.finSemanaUTC(T), Date.UTC(2026, 10, 9)); // lunes siguiente
  assert.equal(G.finSemanaUTC(T) - T, misiones.msHastaProximaSemana(T));
  assert.equal(G.fechaUTC(T), "2026-11-05");
  assert.equal(G.formatearCuentaAtras(0), "00:00:00");
  assert.equal(G.formatearCuentaAtras(-5000), "00:00:00");
  assert.equal(G.formatearCuentaAtras(3_725_000), "01:02:05");
  assert.equal(G.formatearCuentaAtras(90_061_000), "1 d 01:01:01");
});

test("tabla de recompensa diaria: 10 ORO +5/día hasta 40 y cofre el día 7, en ciclo", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map((n) => G.recompensaDiaria(n).oro), [10, 15, 20, 25, 30, 35, 40]);
  assert.equal(G.recompensaDiaria(7).cofre, true);
  assert.equal(G.recompensaDiaria(6).cofre, false);
  assert.deepEqual(G.recompensaDiaria(8), { dia: 1, oro: 10, cofre: false });
  assert.equal(G.recompensaDiaria(14).cofre, true);
  assert.equal(G.recompensaDiaria(0).dia, 1);
});

test("normalizarRanking: top 20 ordenado, ORO en unidades base, categorías ausentes", () => {
  const dir = (n) => `0x${n.toString(16).padStart(40, "0")}`;
  const objetos = Array.from({ length: 25 }, (_, i) => ({ address: dir(i + 1), valor: String(i) }));
  const r = G.normalizarRanking({
    actualizado: "2026-11-05T11:59:00Z",
    categorias: { objetos, oroVentas: [{ address: dir(1), valor: (54n * UNO).toString() }, { address: dir(2), valor: 300 }], basura: [1] },
  });
  assert.equal(r.actualizado, Date.parse("2026-11-05T11:59:00Z"));
  assert.equal(r.categorias.objetos.length, 20);
  assert.equal(r.categorias.objetos[0].valor, 24);
  assert.equal(r.categorias.objetos[0].posicion, 1);
  assert.deepEqual(r.categorias.oroVentas.map((x) => x.valor), [300, 54]);
  assert.deepEqual(r.categorias.legendarios, []);
  assert.deepEqual(r.categorias.rachaDiaria, []);
  assert.deepEqual(G.normalizarRanking(null).categorias.objetos, []);
});

test("normalizarPosicion acepta varias formas", () => {
  assert.deepEqual(G.normalizarPosicion({ categorias: { objetos: { posicion: 3, valor: 12 }, legendarios: { posicion: 0 } } }).objetos, { posicion: 3, valor: 12 });
  assert.equal(G.normalizarPosicion({ categorias: { legendarios: { posicion: 0 } } }).legendarios.posicion, null);
  assert.equal(G.normalizarPosicion({ posiciones: { rachaDiaria: 7 } }).rachaDiaria.posicion, 7);
  assert.equal(G.normalizarPosicion({ oroVentas: { position: 2, valor: (10n * UNO).toString() } }).oroVentas.valor, 10);
  assert.equal(G.normalizarPosicion({}).objetos.posicion, null);
});

test("calcularAvisos: diario, misiones, pase, desafío y logros nuevos", () => {
  assert.deepEqual(G.calcularAvisos(), { misiones: false, logros: false, cuentas: { misiones: 0, logros: 0 } });
  const a = G.calcularAvisos({
    diario: { puedeReclamar: true },
    misiones: { diarias: [{ completada: true, reclamada: false }, { completada: false }], semanal: { completada: true, reclamada: true }, bonus: null },
    pase: { niveles: [{ alcanzado: true, reclamado: false }, { alcanzado: true, reclamado: true }, { alcanzado: false }] },
    logrosNuevos: 2,
  });
  assert.deepEqual(a, { misiones: true, logros: true, cuentas: { misiones: 3, logros: 2 } });
  const solo = G.calcularAvisos({ desafio: { disponible: true, intentado: false } });
  assert.equal(solo.misiones, true);
  assert.equal(solo.cuentas.misiones, 0);
});

test("normalizarEntrada convierte formas alternativas al formato de misiones.normalizarEvento", () => {
  assert.deepEqual(G.normalizarEntrada({ tipo: "victoria", enemigo: { clave: "lobo", jefe: true, nivel: 3, nombre: "Lobo" } }),
    { tipo: "victoria", clave: "lobo", jefe: true, nivel: 3, nombre: "Lobo" });
  assert.equal(G.normalizarEntrada({ tipo: "desafio", resultado: "victoria" }).victoria, true);
  assert.equal(G.normalizarEntrada({ tipo: "nivel", nivel: 12 }).valor, 12);
  assert.deepEqual(G.normalizarEntrada({ tipo: "cosmeticos", saldos: { 3: 1, 4: 0, 9: 2 } }).ids, [3, 9]);
  assert.equal(G.normalizarEntrada({ nada: 1 }), null);
  assert.equal(G.normalizarEntrada(null), null);
});

test("adaptarModulos: usa los módulos de §5 y marca los que faltan", () => {
  const ok = G.adaptarModulos(MODS);
  assert.deepEqual(ok.origen, { misiones: "ok", pase: "ok", logros: "ok", coleccion: "ok", desafio: "ok" });
  assert.equal(typeof ok.eventosDeCombate, "function");
  const parcial = G.adaptarModulos({ misiones, pase: { estadoPase() {} } });
  assert.equal(parcial.origen.misiones, "ok");
  assert.equal(parcial.origen.pase, "falta");
  assert.equal(parcial.sistemas.pase, null);
  assert.equal(parcial.sistemas.logros, null);
  assert.deepEqual(G.adaptarModulos().origen, { misiones: "falta", pase: "falta", logros: "falta", coleccion: "falta", desafio: "falta" });
});

test("vistas adaptadas: misiones, pase (30 niveles, ORO on-chain en 10/20/30), logros, colección, desafío", () => {
  const { sistemas: A } = G.adaptarModulos(MODS);
  const vm = A.misiones.vista(null, T);
  assert.equal(vm.diarias.length, 3);
  for (const m of vm.diarias) {
    assert.equal(typeof m.nombre, "string");
    assert.ok(m.objetivo >= 1 && m.recompensa.puntos > 0);
  }
  assert.equal(vm.bonus.recompensa.motivo, "misiones_diarias");
  assert.equal(vm.finDia, G.finDiaUTC(T));
  const vp = A.pase.vista(null, T);
  assert.equal(vp.niveles.length, 30);
  assert.deepEqual(vp.niveles.filter((n) => n.recompensa.motivo).map((n) => [n.nivel, n.recompensa.motivo, n.recompensa.oro]),
    [[10, "pase10", 100], [20, "pase20", 200], [30, "pase30", 400]]);
  assert.ok(vp.niveles.every((n) => typeof n.recompensa.texto === "string" && n.recompensa.icono));
  assert.ok(vp.fin > T && vp.inicio <= T);
  const vl = A.logros.vista(null);
  assert.ok(vl.length >= 30);
  assert.ok(vl.every((l) => !l.conseguido && l.objetivo >= 1));
  const vc = A.coleccion.vista(null);
  assert.equal(vc.objetos.length, 15);
  assert.equal(vc.cosmeticos.length, 13);
  assert.equal(vc.porcentaje, 0);
  assert.ok(vc.cosmeticos.every((c) => c.nombre && c.icono));
  const vd = A.desafio.vista(null, T);
  assert.equal(vd.intentado, false);
  assert.ok(vd.enemigo.nombre && vd.enemigo.nivel >= 2);
  assert.ok(vd.modificadores.length >= 1 && vd.modificadores.every((m) => m.texto && m.icono));
  assert.ok(vd.recompensa.puntos > 0);
});

test("aplicarEvento reparte un combate a misiones, pase, logros y colección", () => {
  const { sistemas: A, eventosDeCombate } = G.adaptarModulos(MODS);
  let E = {};
  const combate = { fase: "victoria", enemigo: { clave: "lobo", nivel: 2, jefe: true }, resumen: { criticos: 2, habilidadesUsadas: 1, turnos: 5, danoRecibido: 10 } };
  const nuevos = [];
  let niveles = [];
  for (const ev of eventosDeCombate(combate)) {
    const r = G.aplicarEvento(E, ev, A, T);
    E = r.estados; nuevos.push(...r.logrosNuevos); niveles.push(...r.nivelesPase);
  }
  assert.ok(nuevos.some((l) => l.id === "primera_victoria"), "logro de primera victoria");
  assert.equal(A.pase.vista(E.pase, T).puntos, pase.PUNTOS_EVENTO.victoria + pase.PUNTOS_EVENTO.jefe);
  const col = A.coleccion.vista(E.coleccion);
  const lobo = col.bestiario.find((b) => b.clave === "lobo");
  assert.equal(lobo.vencidos, 1);
  assert.equal(lobo.jefe, true);
  assert.ok(col.porcentaje > 0);
  // Botín y formato alternativo con `enemigo` anidado.
  E = G.aplicarEvento(E, { tipo: "botin", item: { tipo: "Espada", rareza: 2 } }, A, T).estados;
  E = G.aplicarEvento(E, { tipo: "victoria", enemigo: { clave: "rata", nivel: 1 } }, A, T).estados;
  const col2 = A.coleccion.vista(E.coleccion);
  assert.ok(col2.objetos.find((o) => o.tipo === "Espada" && o.rareza === 2).tengo);
  assert.equal(col2.bestiario.find((b) => b.clave === "rata").vencidos, 1);
  // Muchos puntos → subidas de nivel del pase (y logros de pase).
  for (let i = 0; i < 40; i++) {
    const r = G.aplicarEvento(E, { tipo: "jefe", clave: "lobo" }, A, T);
    E = r.estados; niveles.push(...r.nivelesPase);
  }
  assert.ok(niveles.length >= 5, `niveles alcanzados: ${niveles}`);
  assert.deepEqual(niveles, [...niveles].sort((a, b) => a - b));
  // Sin sistemas: no lanza.
  assert.doesNotThrow(() => G.aplicarEvento({}, { tipo: "victoria" }, G.adaptarModulos({}).sistemas, T));
});

test("misiones: reclamar exige completar y el bonus pide ORO on-chain", () => {
  const { sistemas: A } = G.adaptarModulos(MODS);
  let e = A.misiones.vista(null, T) && null;
  const m0 = A.misiones.vista(e, T).diarias[0];
  assert.equal(A.misiones.reclamar(e, m0.id, T).ok, false);
  e = misiones.estadoMisiones(null, T);
  e.diarias = e.diarias.map((m) => ({ ...m, progreso: m.objetivo, completada: true }));
  for (const m of A.misiones.vista(e, T).diarias) {
    const r = A.misiones.reclamar(e, m.id, T);
    assert.equal(r.ok, true);
    assert.ok(r.recompensa.puntos > 0);
    e = r.estado;
  }
  const v = A.misiones.vista(e, T);
  assert.equal(v.bonus.completada, true);
  const b = A.misiones.reclamar(e, "bonus", T);
  assert.equal(b.ok, true);
  assert.equal(b.recompensa.motivo, "misiones_diarias");
});

test("desafío: un intento al día con iniciar/finalizar", () => {
  const { sistemas: A } = G.adaptarModulos(MODS);
  const r = A.desafio.iniciar(null, T);
  assert.equal(r.ok, true);
  assert.ok(r.desafio.clave);
  assert.equal(A.desafio.vista(r.estado, T).intentado, true);
  assert.equal(A.desafio.iniciar(r.estado, T).ok, false);
  const { combate } = A.desafio.crearCombate(r.desafio, { vidaMax: 100, ataque: 12, defensa: 6, nivel: 1, habilidades: [] });
  const fin = A.desafio.finalizar(r.estado, { ...combate, fase: "derrota" }, T);
  assert.equal(fin.ok, true);
  assert.equal(fin.evento.tipo, "desafio");
  assert.equal(A.desafio.vista(fin.estado, T).terminado, true);
  // Al día siguiente vuelve a estar disponible.
  assert.equal(A.desafio.vista(fin.estado, T + 86_400_000).intentado, false);
});

test("logros y títulos: elegir solo títulos desbloqueados; títulos del pase como externos", () => {
  const { sistemas: A } = G.adaptarModulos(MODS);
  let e = null;
  assert.deepEqual(A.logros.titulos(e), []);
  assert.equal(A.logros.elegirTitulo(e, "imparable").ok, false);
  e = A.logros.registrar(e, { tipo: "titulo", id: "aspirante" }, T).estado;
  const t = A.logros.titulos(e, A.pase.titulos);
  assert.deepEqual(t, [{ id: "aspirante", texto: "Aspirante" }]);
  const r = A.logros.elegirTitulo(e, "aspirante");
  assert.equal(r.ok, true);
  assert.equal(A.logros.tituloActual(r.estado), "aspirante");
});

test("persistencia por dirección con storage inyectable", () => {
  const st = memoria();
  const { sistemas: A } = G.adaptarModulos(MODS);
  const cta = "0xAbC0000000000000000000000000000000000001";
  const e = G.aplicarEvento({}, { tipo: "victoria", clave: "lobo", nivel: 1 }, A, T).estados;
  for (const k of Object.keys(G.FIRMAS)) if (e[k]) A[k].guardar(cta, e[k], st);
  assert.ok([...st._m.keys()].every((k) => k.endsWith(cta.toLowerCase())));
  assert.equal(A.coleccion.vista(A.coleccion.cargar(cta, st)).bestiario.find((b) => b.clave === "lobo").vencidos, 1);
  assert.equal(A.coleccion.vista(A.coleccion.cargar("0xotra", st)).porcentaje, 0);
  G.guardarPropio(cta, { vistos: ["primera_victoria", 3] }, st);
  assert.deepEqual(G.cargarPropio(cta.toLowerCase(), st), { vistos: ["primera_victoria"] });
  assert.deepEqual(G.cargarPropio(null, st), { vistos: [] });
  assert.equal(G.claveEnganche(null), "lootarena:enganche:invitado");
  const roto = { getItem() { throw new Error("x"); }, setItem() { throw new Error("x"); } };
  assert.deepEqual(G.cargarPropio(cta, roto), { vistos: [] });
  assert.doesNotThrow(() => G.guardarPropio(cta, { vistos: [] }, roto));
});

test("servidor: GET /ranking (+ /ranking/:address) y errores", async () => {
  const cta = "0x00000000000000000000000000000000000000aa";
  const llamadas = [];
  const f = async (url) => {
    llamadas.push(url);
    if (url.endsWith(`/ranking/${cta}`)) return { ok: true, status: 200, json: async () => ({ categorias: { objetos: { posicion: 42, valor: 3 } } }) };
    return { ok: true, status: 200, json: async () => ({ actualizado: 1, categorias: { objetos: [{ address: cta, valor: 3 }] } }) };
  };
  const r = await G.pedirRanking("http://srv/", cta, { fetch: f });
  assert.deepEqual(llamadas, ["http://srv/ranking", `http://srv/ranking/${cta}`]);
  assert.equal(r.ranking.categorias.objetos[0].address, cta);
  assert.equal(r.posicion.objetos.posicion, 42);
  const sin503 = await G.pedirRanking("http://srv", null, { fetch: async () => ({ ok: false, status: 503 }), esperar: async () => {}, intentos: 1 });
  assert.match(sin503.error, /no está disponible/);
  assert.equal(sin503.sincronizando, true);
  assert.match((await G.pedirRanking("http://srv", null, { fetch: async () => { throw new Error("red"); } })).error, /No se pudo/);
});

test("pedirRanking: 503 con Retry-After reintenta, avisa de la espera y devuelve el ranking", async () => {
  const esperas = [], avisos = [];
  let n = 0;
  const f = async (url) => {
    if (!url.endsWith("/ranking")) throw new Error("ruta inesperada " + url);
    n++;
    if (n < 3) return { ok: false, status: 503, headers: { get: (k) => (k === "Retry-After" ? "2" : null) } };
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ actualizado: 1, categorias: { objetos: [{ address: "0x00000000000000000000000000000000000000bb", valor: 7 }] } }) };
  };
  const r = await G.pedirRanking("http://srv", null, { fetch: f, esperar: async (ms) => { esperas.push(ms); }, onEstado: (e) => avisos.push(e) });
  assert.equal(n, 3, "tres peticiones en total");
  assert.deepEqual(esperas, [2000, 2000], "espera según Retry-After");
  assert.equal(avisos.length, 2);
  assert.equal(avisos[0].estado, "sincronizando");
  assert.equal(r.error, undefined);
  assert.equal(r.ranking.categorias.objetos[0].valor, 7);
});

test("pedirRanking: tras 3 intentos con 503 devuelve error reintentable (no timeout)", async () => {
  let n = 0;
  const f = async () => { n++; return { ok: false, status: 503, headers: { get: () => null } }; };
  const esperas = [];
  const r = await G.pedirRanking("http://srv", null, { fetch: f, esperar: async (ms) => { esperas.push(ms); } });
  assert.equal(n, 3, "máximo 3 intentos");
  assert.equal(esperas.length, 2, "no espera tras el último intento");
  assert.equal(r.sincronizando, true);
  assert.match(r.error, /sincronizando/);
  assert.equal(r.ranking, undefined);
});

test("esperaRetryAfter: segundos, fecha HTTP, ausente y acotado", () => {
  assert.equal(G.esperaRetryAfter("3"), 3000);
  assert.equal(G.esperaRetryAfter(null), 5000);
  assert.equal(G.esperaRetryAfter("9999"), 30000);
  assert.equal(G.esperaRetryAfter("Wed, 21 Oct 2015 07:28:00 GMT", Date.parse("Wed, 21 Oct 2015 07:27:58 GMT")), 2000);
});

test("servidor: POST /recompensa {address, motivo}", async () => {
  let cuerpo = null;
  const ok = await G.pedirRecompensaServidor("http://srv", "0xabc", "pase10", {
    fetch: async (url, init) => { cuerpo = { url, metodo: init.method, body: JSON.parse(init.body) }; return { ok: true, status: 200, json: async () => ({ txHash: "0x1", cantidad: (100n * UNO).toString() }) }; },
  });
  assert.deepEqual(cuerpo, { url: "http://srv/recompensa", metodo: "POST", body: { address: "0xabc", motivo: "pase10" } });
  assert.deepEqual([ok.ok, ok.txHash, ok.cantidad], [true, "0x1", 100]);
  const rep = await G.pedirRecompensaServidor("http://srv", "0xabc", "pase10", { fetch: async () => ({ ok: false, status: 409, json: async () => ({}) }) });
  assert.equal(rep.ok, false);
  assert.equal(rep.status, 409);
  assert.match(rep.mensaje, /Ya reclamaste/);
  const caido = await G.pedirRecompensaServidor("http://srv", "0xabc", "pase10", { fetch: async () => ({ ok: false, status: 503, json: async () => { throw new Error(); } }) });
  assert.match(caido.mensaje, /no están disponibles/);
});

const respuesta = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (k) => headers[k] ?? null }, json: async () => body });

test("pedirRecompensaDiaria: POST {address, motivo:'diaria'} y 200 con el premio", async () => {
  let llamada = null;
  const r = await G.pedirRecompensaDiaria("http://srv/", "0xabc", {
    fetch: async (url, init) => { llamada = { url, metodo: init.method, body: JSON.parse(init.body) }; return respuesta(200, { ok: true, dia: 7, racha: 7, oro: 40, bonusDia7: 25, txHash: "0x1" }); },
  });
  assert.deepEqual(llamada, { url: "http://srv/recompensa", metodo: "POST", body: { address: "0xabc", motivo: "diaria" } });
  assert.deepEqual(r, { ok: true, dia: 7, racha: 7, oro: 40, bonusDia7: 25, txHash: "0x1" });
  const sinBonus = await G.pedirRecompensaDiaria("http://srv", "0xabc", { fetch: async () => respuesta(200, { dia: 2, racha: 2, oro: 15, txHash: "0x2" }) });
  assert.equal(sinBonus.bonusDia7, 0);
});

test("pedirRecompensaDiaria: 409 → ya reclamado con proximoEn (segundos epoch o ISO)", async () => {
  const manana = Date.UTC(2026, 10, 6);
  const r = await G.pedirRecompensaDiaria("http://srv", "0xabc", { fetch: async () => respuesta(409, { error: "Ya", proximoEn: manana / 1000 }) });
  assert.deepEqual(r, { ok: false, status: 409, yaReclamado: true, mensaje: "Ya reclamaste la recompensa de hoy.", proximoEn: manana });
  const iso = await G.pedirRecompensaDiaria("http://srv", "0xabc", { fetch: async () => respuesta(409, { proximoEn: "2026-11-06T00:00:00Z" }) });
  assert.equal(iso.proximoEn, manana);
});

test("pedirRecompensaDiaria: 503 reintenta una vez respetando Retry-After; 503 persistente → despertando", async () => {
  const esperas = [];
  let n = 0;
  const f = async () => { n++; return n === 1 ? respuesta(503, null, { "Retry-After": "3" }) : respuesta(200, { dia: 1, racha: 1, oro: 10, bonusDia7: 0, txHash: "0x2" }); };
  const r = await G.pedirRecompensaDiaria("http://srv", "0xabc", { fetch: f, esperar: async (ms) => esperas.push(ms) });
  assert.equal(n, 2);
  assert.deepEqual(esperas, [3000]);
  assert.equal(r.ok, true);
  assert.equal(r.oro, 10);

  let m = 0;
  const siempre = await G.pedirRecompensaDiaria("http://srv", "0xabc", { fetch: async () => { m++; return respuesta(503, null); }, esperar: async () => {} });
  assert.equal(m, 2);
  assert.equal(siempre.ok, false);
  assert.equal(siempre.despertando, true);
  assert.equal(siempre.mensaje, "El servidor está despertando, reintenta en unos segundos.");
  assert.doesNotMatch(siempre.mensaje, /dormid|MetaMask/i);
});

test("pedirRecompensaDiaria: fallo de red o timeout → despertando, sin reintentar", async () => {
  let n = 0;
  const red = await G.pedirRecompensaDiaria("http://srv", "0xabc", { fetch: async () => { n++; throw new TypeError("Failed to fetch"); } });
  assert.equal(n, 1);
  assert.equal(red.despertando, true);
  assert.equal(red.mensaje, G.MSG_DESPIERTANDO);
  const tarda = await G.pedirRecompensaDiaria("http://srv", "0xabc", {
    timeoutMs: 20,
    fetch: (url, init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))),
  });
  assert.equal(tarda.despertando, true);
});

test("pedirRecompensaDiaria: otros errores del servidor se muestran legibles", async () => {
  const r = await G.pedirRecompensaDiaria("http://srv", "0xabc", { fetch: async () => respuesta(500, { error: "Sin saldo para gas" }) });
  assert.deepEqual(r, { ok: false, status: 500, mensaje: "Sin saldo para gas" });
  const vacio = await G.pedirRecompensaDiaria("http://srv", "0xabc", { fetch: async () => respuesta(500, null) });
  assert.equal(vacio.ok, false);
  assert.equal(vacio.status, 500);
  assert.match(vacio.mensaje, /Inténtalo de nuevo/);
});

test("estadoRecompensaDiaria: GET /recompensa/diaria/:address, 503 y red", async () => {
  let llamada = null;
  const r = await G.estadoRecompensaDiaria("http://srv/", "0xabc", {
    fetch: async (u, init) => { llamada = [u, init.method]; return respuesta(200, { racha: 6, dia: 7, puedeReclamar: true, proximoEn: null, proximaOro: 40 }); },
  });
  assert.deepEqual(llamada, ["http://srv/recompensa/diaria/0xabc", "GET"]);
  assert.deepEqual(r, { ok: true, racha: 6, dia: 7, puedeReclamar: true, proximoEn: null, proximaOro: 40 });
  const hecho = await G.estadoRecompensaDiaria("http://srv", "0xabc", { fetch: async () => respuesta(200, { racha: 7, dia: 7, puedeReclamar: false, proximoEn: "2026-11-06T00:00:00Z" }) });
  assert.equal(hecho.puedeReclamar, false);
  assert.equal(hecho.proximoEn, Date.UTC(2026, 10, 6));
  const caido = await G.estadoRecompensaDiaria("http://srv", "0xabc", { fetch: async () => respuesta(503, null) });
  assert.equal(caido.despertando, true);
  const red = await G.estadoRecompensaDiaria("http://srv", "0xabc", { fetch: async () => { throw new TypeError("x"); } });
  assert.equal(red.despertando, true);
});

test("recompensa diaria: día 7 = 40 ORO + 25 de bonus", () => {
  assert.equal(G.BONUS_DIA_7, 25);
  assert.equal(G.recompensaDiaria(7).oro, 40);
});
