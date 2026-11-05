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

test("normalizarEstadoDiario: Result de ethers, objeto, racha que sigue y racha rota", () => {
  const hoy = G.diaUTC(T);
  // Reclamó ayer con racha 3 → hoy toca el día 4 (25 ORO); proximaRecompensa en unidades base.
  const sigue = G.normalizarEstadoDiario([3n, BigInt(hoy - 1), true, 0n, 25n * UNO], T);
  assert.equal(sigue.racha, 3);
  assert.equal(sigue.puedeReclamar, true);
  assert.equal(sigue.rachaSiguiente, 4);
  assert.deepEqual(sigue.proxima, { dia: 4, oro: 25, cofre: false });
  // Último reclamo hace 3 días → la racha se rompe: día 1.
  const rota = G.normalizarEstadoDiario({ racha: 5, ultimoDia: hoy - 3, puedeReclamar: true, segundosHastaSiguiente: 0 }, T);
  assert.equal(rota.rachaSiguiente, 1);
  assert.equal(rota.proxima.oro, 10);
  // Ya reclamado hoy, día 6 → mañana día 7 con cofre.
  const hecho = G.normalizarEstadoDiario({ racha: 6, ultimoDia: hoy, puedeReclamar: false, segundosHastaSiguiente: 43200, proximaRecompensa: 40 }, T);
  assert.equal(hecho.segundos, 43200);
  assert.equal(hecho.rachaSiguiente, 7);
  assert.equal(hecho.proxima.cofre, true);
  assert.equal(hecho.proxima.oro, 40);
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
  assert.match((await G.pedirRanking("http://srv", null, { fetch: async () => ({ ok: false, status: 503 }) })).error, /no está disponible/);
  assert.match((await G.pedirRanking("http://srv", null, { fetch: async () => { throw new Error("red"); } })).error, /No se pudo/);
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

test("Recompensas simulada: un reclamo al día, racha y cofre el día 7", async () => {
  let ahora = T;
  const rec = G.crearRecompensasSimulada({ racha: 6, ultimoDia: G.diaUTC(T) - 1, latencia: 0, ahora: () => ahora });
  const e0 = await rec.estado();
  assert.equal(e0.puedeReclamar, true);
  assert.equal(e0.proxima.cofre, true);
  const r = await (await rec.reclamar()).esperar();
  assert.equal(r.racha, 7);
  assert.equal(r.oro, 40);
  assert.ok(r.cosmeticoId >= 1 && r.cosmeticoId <= 13);
  assert.equal((await rec.estado()).puedeReclamar, false);
  await assert.rejects(rec.reclamar(), /YaReclamado/);
  ahora += 3 * 86_400_000; // se salta dos días → racha rota
  assert.equal((await rec.estado()).rachaSiguiente, 1);
});

test("ABI mínimo de Recompensas según §3 y dirección desde deployments", async () => {
  for (const f of ["function reclamarDiario()", "function estadoDiario(address jugador)", "event DiarioReclamado(", "event Recompensado("]) {
    assert.ok(G.ABI_RECOMPENSAS.some((x) => x.startsWith(f)), f);
  }
  const dir = `0x${"7".repeat(40)}`;
  assert.equal(await G.resolverRecompensas({ recompensas: dir }), dir);
  const f = async () => ({ ok: true, json: async () => ({ sepolia: { recompensas: dir } }) });
  assert.equal(await G.resolverRecompensas({ red: "sepolia" }, { fetch: f, base: "http://x/js/enganche.js" }), dir);
  assert.equal(await G.resolverRecompensas({ red: "localhost" }, { fetch: f, base: "http://x/js/enganche.js" }), null);
});
