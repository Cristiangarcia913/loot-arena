import { test } from "node:test";
import assert from "node:assert/strict";
import * as S from "../js/skills.js";

const it = (tipo, rareza, ataque = 1, defensa = 1) => ({ tipo, rareza, ataque, defensa });

test("sin Legendario: las 3 habilidades básicas, todas listas", () => {
  const hs = S.habilidadesDisponibles({}, [it("Espada", 1)]);
  assert.deepEqual(hs.map((h) => h.id), ["golpe_poderoso", "desangrar", "grito_guerra"]);
  for (const h of hs) {
    assert.ok(h.nombre && h.icono && h.descripcion);
    assert.equal(h.restante, 0);
    assert.equal(h.lista, true);
    assert.ok(h.enfriamiento > 0);
  }
  assert.equal(S.HABILIDADES.golpe_poderoso.mult, 1.8);
  assert.equal(S.HABILIDADES.golpe_poderoso.enfriamiento, 3);
});

test("un Legendario desbloquea la especial de su tipo (el de más poder si hay varios)", () => {
  for (const [tipo, id] of Object.entries(S.ESPECIAL_POR_TIPO)) {
    assert.equal(S.habilidadEspecial([it(tipo, 2)]), id);
    const hs = S.habilidadesDisponibles({}, [it(tipo, 2)]);
    assert.equal(hs.length, 4);
    assert.equal(hs[3].id, id);
    assert.equal(hs[3].especial, true);
  }
  assert.equal(S.habilidadEspecial([it("Botas", 2, 1, 20), it("Espada", 2, 18, 1)]), "paso_sombrio");
  assert.equal(S.habilidadEspecial([it("Escudo", 2, 2, 15), it("Espada", 2, 15, 2)]), "tajo_celestial"); // empate → orden de tipo
  assert.equal(S.habilidadEspecial([it("Espada", 1)]), null);
  assert.equal(S.habilidadEspecial([]), null);
});

test("en combate respeta los enfriamientos del héroe", () => {
  const heroe = { habilidades: [{ id: "golpe_poderoso", restante: 2 }, { id: "desangrar", restante: 0 }] };
  const hs = S.habilidadesDisponibles(heroe, [it("Espada", 2)]);
  assert.deepEqual(hs.map((h) => [h.id, h.restante, h.lista]), [["golpe_poderoso", 2, false], ["desangrar", 0, true]]);
});

test("usarHabilidad y avanzarEnfriamientos no mutan", () => {
  const h0 = S.iniciarHabilidades();
  const h1 = S.usarHabilidad(h0, "desangrar");
  assert.equal(h0.find((h) => h.id === "desangrar").restante, 0);
  assert.equal(h1.find((h) => h.id === "desangrar").restante, 3);
  const h2 = S.avanzarEnfriamientos(h1);
  assert.equal(h2.find((h) => h.id === "desangrar").restante, 2);
  assert.equal(S.avanzarEnfriamientos(h0)[0].restante, 0);
  assert.deepEqual(S.iniciarHabilidades(["x", "grito_guerra"]), [{ id: "grito_guerra", restante: 0 }]);
});
