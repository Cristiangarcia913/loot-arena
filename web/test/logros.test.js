import { test } from "node:test";
import assert from "node:assert/strict";
import * as L from "../js/logros.js";
import { BESTIARIO } from "../js/combat.js";

const memoria = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
const T = 1_800_000_000_000;
const ids = (r) => r.escalones.map((x) => `${x.id}#${x.n}`);

test("49 logros bien formados: ids únicos, escalones con medalla, metas crecientes y título final", () => {
  assert.equal(L.LOGROS.length, 49);
  assert.equal(new Set(L.LOGROS.map((l) => l.id)).size, L.LOGROS.length);
  assert.equal(new Set(L.LOGROS.map((l) => l.titulo)).size, L.LOGROS.length, "títulos únicos");
  const cats = new Set(L.CATEGORIAS.map((c) => c.id));
  for (const l of L.LOGROS) {
    assert.ok(cats.has(l.categoria), l.id);
    assert.ok(l.nombre && l.descripcion && l.icono, l.id);
    assert.ok(l.escalones.length >= 3 && l.escalones.length <= 4, l.id);
    for (let i = 1; i < l.escalones.length; i++) assert.ok(l.escalones[i].meta > l.escalones[i - 1].meta, l.id);
    assert.equal(l.objetivo, l.escalones.at(-1).meta, l.id);
    assert.deepEqual(l.escalones.slice(0, -1).map((e) => e.recompensa.tipo), l.escalones.slice(0, -1).map(() => "xp"), l.id);
    assert.equal(l.escalones.at(-1).recompensa.tipo, "titulo", l.id);
    assert.equal(L.TITULOS[l.titulo], l.tituloTexto, l.id);
  }
});

test("combate: victorias, nivel de enemigo, racha, intocable, jefes y bestiario", () => {
  // 1 victoria → primer escalón de "primera_victoria" (XP 15) y de "intocable"/"relampago" si aplica.
  let r = L.registrar(null, { tipo: "victoria", nivel: 1, clave: "rata", danoRecibido: 12, turnos: 6 }, T);
  assert.deepEqual(ids(r), ["primera_victoria#1"]);
  assert.equal(r.xp, 15);
  assert.deepEqual(r.nuevos.map((l) => l.id), ["primera_victoria"]);
  // Victoria perfecta contra un jefe de nivel 10: nivel 10, intocable, rápida, jefe.
  r = L.registrar(r.progreso, { tipo: "victoria", nivel: 10, clave: "dragon", jefe: true, danoRecibido: 0, turnos: 2 }, T + 1);
  assert.ok(ids(r).includes("nivel_10#1"));
  assert.ok(ids(r).includes("intocable#1"));
  assert.ok(ids(r).includes("relampago#1"));
  assert.ok(ids(r).includes("nivel_5#1"));
  assert.ok(ids(r).includes("jefes_sin_dano#1"), "victoria contra jefe sin daño cuenta");
  assert.ok(ids(r).includes("nivel_maximo#3"), "nivel 10 = mayor nivel vencido");
  // El mismo evento de nuevo no vuelve a premiar nada salvo contadores que suban.
  r = L.registrar(r.progreso, { tipo: "victoria", nivel: 1, clave: "rata" }, T + 2);
  assert.deepEqual(r.escalones, []);
  assert.equal(r.progreso.c.victorias, 3);
  assert.deepEqual(r.progreso.c.bestiario, ["rata", "dragon"]);
  // Racha: 10 seguidos → escalones 1, 2 y 3 de "racha" (metas 3, 5, 10) de golpe.
  r = L.registrar(r.progreso, { tipo: "racha", valor: 10 }, T + 3);
  assert.ok(ids(r).includes("racha#1") && ids(r).includes("racha#2") && ids(r).includes("racha#3"));
  assert.equal(r.xp, 15 + 30 + 45);
  // 50 victorias de golpe → escalones 1-3 de "primera_victoria" (XP 15+30+45); el 4.º (200) da el título.
  const pocas = L.registrarVarios(null, Array.from({ length: 50 }, () => ({ tipo: "victoria", nivel: 1 })), T);
  const v = pocas.escalones.filter((x) => x.id === "primera_victoria");
  assert.deepEqual(v.map((x) => x.n), [1, 2, 3]);
  assert.deepEqual(v.map((x) => x.recompensa.xp), [15, 30, 45]);
  assert.equal(L.listaLogros(pocas.progreso).find((x) => x.id === "primera_victoria").escalon, 3);
  // Jefes: victoria con jefe + evento jefe → jefes_todos y jefes sin daño.
  const jefes = BESTIARIO.flatMap((b) => [
    { tipo: "victoria", clave: b.clave, nivel: 10, jefe: true, danoRecibido: 0 },
    { tipo: "jefe", clave: b.clave },
  ]);
  const rj = L.registrarVarios(null, jefes, T);
  const idsJ = rj.escalones.map((x) => x.id);
  assert.ok(idsJ.includes("jefes_todos"));
  assert.ok(idsJ.includes("jefes_sin_dano"));
  assert.ok(idsJ.includes("bestiario"));
  assert.equal(L.listaLogros(rj.progreso).find((x) => x.id === "jefes_todos").completado, true);
  // Daño recibido y racha de cero no se cuentan como "victoria perfecta" si hay daño.
  const dr = L.registrar(null, { tipo: "victoria", nivel: 2, danoRecibido: 600 }, T);
  assert.equal(dr.progreso.c.danoRecibido, 600);
  assert.equal(dr.progreso.c.intocable, 0);
  assert.ok(ids(dr).includes("dano_recibido#1"));
});

test("colección: tipos, combinaciones tipo+rareza, maestría por tipo, raros, legendarios, cosméticos y bestiario", () => {
  const items = [
    { tipo: "Espada", rareza: 0 }, { tipo: "Espada", rareza: 1 }, { tipo: "Espada", rareza: 2 },
    { tipo: "Escudo", rareza: 0 }, { tipo: "Casco", rareza: 1 }, { tipo: "Armadura", rareza: 2 }, { tipo: "Botas", rareza: 0 },
    { tipo: "Espada", rareza: 1 }, // repetido: no cuenta
  ];
  const { progreso, escalones, xp } = L.registrarVarios(null, [
    ...items.map((item) => ({ tipo: "botin", item })),
    { tipo: "cosmeticos", ids: [1, 2, 3, 4, 5, 6, 7, 14, 14] },
  ], T);
  const idsE = escalones.map((x) => `${x.id}#${x.n}`);
  assert.ok(idsE.includes("tipos#1") && idsE.includes("tipos#2") && idsE.includes("tipos#3"), "5 tipos → 3 escalones");
  assert.ok(idsE.includes("combinaciones#1") && !idsE.includes("combinaciones#2"), "7 combinaciones distintas (metas 3, 8, 15)");
  assert.ok(idsE.includes("espadas#3"), "espadas de rareza 0, 1 y 2");
  assert.ok(idsE.includes("escudos#1") && !idsE.includes("escudos#2"));
  assert.ok(idsE.includes("legendarios#1"));
  assert.ok(idsE.includes("raros#1"));
  assert.ok(idsE.includes("botin#1"));
  assert.ok(idsE.includes("cosmeticos#2") && !idsE.includes("cosmeticos#3"), "7 distintos (el 14 no cuenta)");
  assert.equal(progreso.c.cosmeticos, 7);
  assert.ok(xp > 0);
  // Bestiario: vencer criaturas distintas.
  const b = L.registrarVarios(null, BESTIARIO.slice(0, 6).map((x) => ({ tipo: "victoria", clave: x.clave, nivel: 1 })), T);
  assert.equal(L.listaLogros(b.progreso).find((x) => x.id === "bestiario").escalon, 2);
  // Inventario instantánea: no duplica distintos ni sube "raros" por encima del contenido.
  const inv = L.registrar(null, { tipo: "inventario", items: [{ tipo: "Botas", rareza: 2 }, { tipo: "Botas", rareza: 2 }] }, T);
  assert.equal(inv.progreso.c.distintos.length, 1);
  assert.equal(inv.progreso.c.legendarios, 2);
});

test("economía: ventas, ORO vendido y acumulado, compras, gasto, cofres", () => {
  const { progreso, escalones } = L.registrarVarios(null, [
    { tipo: "venta", cantidad: 5, oro: 1200 },
    { tipo: "venta", cantidad: 1, oro: 300 },
    { tipo: "compra", cantidad: 1, oro: 1500 },
    { tipo: "cofre", cantidad: 10 },
    { tipo: "diario", racha: 7, oro: 40 },
  ], T);
  const idsE = escalones.map((x) => `${x.id}#${x.n}`);
  assert.ok(idsE.includes("ventas#1"));
  assert.ok(idsE.includes("venta_lote#2"), "vender 5 de una vez");
  assert.ok(!idsE.includes("venta_lote#3"));
  assert.ok(idsE.includes("oro_vendido#1") && !idsE.includes("oro_vendido#2"), "1500 ORO vendiendo");
  assert.ok(idsE.includes("oro_acumulado#1") && !idsE.includes("oro_acumulado#2"), "1500 de ventas + 40 de diario = 1540 ≥ 1000");
  assert.ok(idsE.includes("compras#1") && idsE.includes("gasto#1") && idsE.includes("compra_grande#2"));
  assert.ok(idsE.includes("cofres#1") && idsE.includes("cofres#2"), "10 cofres → escalones 1 y 2");
  assert.equal(progreso.c.oroAcumulado, 1540);
  assert.equal(progreso.c.diarioRachaMax, 7);
});

test("constancia: racha diaria, desafíos (racha de victorias), misiones y temporadas de pase", () => {
  const evs = [
    { tipo: "diario", racha: 3, oro: 20 },
    { tipo: "diario", racha: 7, oro: 40 },
    { tipo: "desafio", victoria: true },
    { tipo: "desafio", victoria: true },
    { tipo: "desafio", victoria: false },
    { tipo: "desafio", victoria: true },
    { tipo: "mision", cantidad: 2 },
    { tipo: "mision", cantidad: 1, semanal: true },
    { tipo: "pase", nivel: 10, temporada: 1 },
    { tipo: "pase", nivel: 12, temporada: 2 },
  ];
  const { progreso, escalones } = L.registrarVarios(null, evs, T);
  const idsE = escalones.map((x) => `${x.id}#${x.n}`);
  assert.ok(idsE.includes("diario_racha#1") && idsE.includes("diario_racha#2"), "racha 7 → escalones 1 y 2");
  assert.ok(!idsE.includes("diario_racha#3"));
  assert.ok(idsE.includes("desafios#1") && idsE.includes("desafios_ganados#1"));
  assert.equal(progreso.c.desafiosRachaMax, 2, "la derrota corta la racha");
  assert.ok(idsE.includes("desafios_racha#1") && !idsE.includes("desafios_racha#2"));
  assert.ok(idsE.includes("misiones#1") && idsE.includes("misiones_semanales#1"));
  assert.ok(idsE.includes("pase_nivel#1") && !idsE.includes("pase_nivel#2"));
  assert.equal(progreso.c.temporadas.length, 2);
  assert.ok(idsE.includes("temporadas#2") === false && idsE.includes("temporadas#1"), "2 temporadas → escalón 1 (meta 3)");
});

test("resumenLogros: total, desbloqueados, por categoría y lo siguiente que puedes conseguir", () => {
  const vacio = L.resumenLogros(null);
  assert.equal(vacio.total, 49);
  assert.equal(vacio.desbloqueados, 0);
  assert.equal(vacio.completados, 0);
  assert.deepEqual(Object.keys(vacio.porCategoria).sort(), ["coleccion", "combate", "constancia", "economia"]);
  assert.equal(vacio.siguientes.length, 5);
  for (const s of vacio.siguientes) {
    assert.ok(s.id && s.nombre && s.icono && s.categoria);
    assert.ok(s.meta > 0 && s.progreso < s.meta && s.escalon === 1); // nivel de héroe empieza en 1
    assert.equal(s.recompensa.tipo, "xp");
  }

  // Un jugador con 10 victorias: "primera_victoria" en escalón 2 → su siguiente está al 10/50 (no 0).
  const { progreso } = L.registrarVarios(null, Array.from({ length: 10 }, () => ({ tipo: "victoria", nivel: 1 })), T);
  const r = L.resumenLogros(progreso, 49);
  assert.equal(r.siguientes.length, 49 - r.completados);
  const sig = r.siguientes.find((s) => s.id === "primera_victoria");
  assert.deepEqual([sig.progreso, sig.meta, sig.escalon, sig.recompensa.tipo], [10, 50, 3, "xp"]);
  assert.ok(r.desbloqueados >= 1 && r.porCategoria.combate.desbloqueados >= 1);
  assert.equal(r.porCategoria.combate.total, 20);
  assert.equal(r.porCategoria.coleccion.total, 12);
  assert.equal(r.porCategoria.economia.total, 8);
  assert.equal(r.porCategoria.constancia.total, 9);
  // Orden: de más cerca de completar a más lejos.
  for (let i = 1; i < r.siguientes.length; i++) assert.ok(r.siguientes[i - 1].pct >= r.siguientes[i].pct);
  // Límite respetado.
  assert.equal(L.resumenLogros(progreso, 3).siguientes.length, 3);
  // Logros completos no aparecen en siguientes.
  const completo = L.registrarVarios(null, Array.from({ length: 200 }, () => ({ tipo: "victoria", nivel: 1 })), T);
  const rc = L.resumenLogros(completo.progreso, 49);
  assert.equal(rc.siguientes.some((s) => s.id === "primera_victoria"), false);
  assert.equal(rc.porCategoria.combate.completados >= 1, true);
});

test("listaLogros conserva la forma de siempre y añade escalones y siguiente", () => {
  const { progreso } = L.registrarVarios(null, [{ tipo: "racha", valor: 10 }, { tipo: "titulo", id: "campeon_temporada" }], T);
  const lista = L.listaLogros(progreso);
  assert.equal(lista.length, L.LOGROS.length);
  const racha = lista.find((l) => l.id === "racha");
  assert.equal(racha.desbloqueado, true);
  assert.equal(racha.escalon, 3);
  assert.equal(racha.tituloTexto, "Invicto");
  assert.equal(racha.escalones.filter((e) => e.conseguido).length, 3);
  assert.equal(racha.siguiente.meta, 25);
  const v10 = lista.find((l) => l.id === "primera_victoria");
  assert.deepEqual([v10.actual, v10.objetivo, v10.pct, v10.desbloqueado], [0, 200, 0, false]);
  assert.deepEqual(L.titulosDisponibles(progreso).sort(), ["campeon_temporada"]);
  assert.equal(L.elegirTitulo(progreso, "invicto").ok, false, "racha 10 no llega al título final");
});

test("títulos: solo al completar el último escalón; elegir y quitar", () => {
  const { progreso } = L.registrarVarios(null, Array.from({ length: 200 }, () => ({ tipo: "victoria", nivel: 1 })), T);
  assert.ok(L.titulosDisponibles(progreso).includes("leyenda_arena"));
  const e = L.elegirTitulo(progreso, "leyenda_arena");
  assert.equal(e.progreso.titulo, "leyenda_arena");
  assert.equal(L.elegirTitulo(e.progreso, null).progreso.titulo, null);
  assert.equal(L.textoTitulo("leyenda_arena"), "Leyenda de la Arena");
  assert.equal(L.textoTitulo("campeon_temporada", { campeon_temporada: "Campeón de temporada" }), "Campeón de temporada");
});

test("persistencia y datos corruptos", () => {
  const st = memoria();
  const k = L.claveLogros("0xBB");
  const { progreso } = L.registrarVarios(null, [{ tipo: "victoria", clave: "lobo", nivel: 1 }], T);
  assert.equal(L.guardarLogros(k, progreso, st), true);
  assert.deepEqual(L.cargarLogros(k, st), progreso);
  st.setItem(k, JSON.stringify({
    c: { victorias: "x", bestiario: "no", distintos: [1, 2] },
    desbloqueados: { falso: 1, primera_victoria: 5 },
    niveles: { primera_victoria: 99, falso: 4 },
    titulo: "invicto",
  }));
  const s = L.cargarLogros(k, st);
  assert.equal(s.c.victorias, 0);
  assert.deepEqual(s.c.bestiario, []);
  assert.deepEqual(s.c.distintos, ["1", "2"]);
  assert.deepEqual(Object.keys(s.desbloqueados), ["primera_victoria"]);
  assert.equal(s.niveles.primera_victoria, 4, "niveles acotados al nº de escalones");
  assert.equal(s.titulo, null, "no desbloqueado");
  st.setItem(k, "{{");
  assert.deepEqual(L.cargarLogros(k, st), L.logrosNuevos());
});

test("registrar no falla con eventos inválidos ni con títulos externos sin id", () => {
  assert.deepEqual(L.registrar(null, null, T).escalones, []);
  assert.deepEqual(L.registrar(null, { tipo: 3 }, T).nuevos, []);
  const r = L.registrar(null, { tipo: "titulo" }, T);
  assert.deepEqual(r.progreso.titulosExtra, []);
});
