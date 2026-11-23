// Panel de Administración / Desarrollador (F2 o Ctrl+Shift+D): trucos para pruebas.
// Recibe las dependencias de main.js para no acoplarse a su estado interno.

const NOMBRES_RAREZA = ["Común", "Raro", "Legendario"];

export function iniciarAdmin(d) {
  const dlg = document.getElementById("dlg-admin");
  if (!dlg || dlg.dataset.listo) return;
  dlg.dataset.listo = "1";
  const { S, C } = d;
  const q = (id) => document.getElementById(id);

  const abrir = () => { if (!dlg.open) dlg.showModal?.(); };
  const cerrar = () => { if (dlg.open) dlg.close(); };
  q("btn-admin")?.addEventListener("click", () => (dlg.open ? cerrar() : abrir()));
  document.addEventListener("keydown", (e) => {
    const atajo = e.key === "F2" || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "d");
    if (!atajo) return;
    e.preventDefault();
    if (dlg.open) cerrar(); else abrir();
  });
  q("adm-cerrar")?.addEventListener("click", cerrar);

  // Pestañas
  const tabs = dlg.querySelectorAll("[data-adm-tab]");
  const mostrar = (id) => {
    tabs.forEach((t) => { const on = t.dataset.admTab === id; t.setAttribute("aria-selected", String(on)); t.classList.toggle("activa", on); });
    dlg.querySelectorAll("[data-adm-panel]").forEach((p) => { p.hidden = p.dataset.admPanel !== id; });
  };
  tabs.forEach((t) => t.addEventListener("click", () => mostrar(t.dataset.admTab)));
  mostrar("objetos");

  // Objetos
  q("adm-generar")?.addEventListener("click", () => {
    const tipo = q("adm-tipo").value;
    const rareza = Number(q("adm-rareza").value);
    const num = (id) => Math.max(0, Math.min(999, Math.floor(Number(q(id).value) || 0)));
    const base = { nombre: `${tipo} Admin (${NOMBRES_RAREZA[rareza]})`, tipo, rareza, ataque: num("adm-ataque"), defensa: num("adm-defensa") };
    if (d.enModoDemo()) {
      const est = d.BL.parsearEstado(d.leer(d.BL.CLAVE_BOTIN_LOCAL));
      const item = { tokenId: String(est.siguienteId), ...base, local: true };
      d.guardar(d.BL.CLAVE_BOTIN_LOCAL, d.BL.serializarEstado({ ...est, items: [...est.items, item], siguienteId: est.siguienteId + 1 }));
    } else {
      const id = String(9000 + S.inventario.length + Math.floor(Math.random() * 1000));
      S.inventario = [...S.inventario, { tokenId: id, ...base, local: true }];
    }
    d.cargarInventario?.();
    d.toast(`🛠️ Objeto creado: ${base.nombre} (+${base.ataque} ATQ / +${base.defensa} DEF)`, "ok", 3000);
  });

  // Economía
  const oro = async (n) => { await d.T.ganarOro?.(n); d.renderCabecera?.(); d.toast(`🛠️ +${n.toLocaleString("es-ES")} ORO`, "ok", 2000); };
  q("adm-oro-1k")?.addEventListener("click", () => oro(1000));
  q("adm-oro-10k")?.addEventListener("click", () => oro(10000));

  // Combate
  q("adm-dios")?.addEventListener("change", (e) => {
    C.dev.modoDios = e.target.checked;
    if (C.dev.modoDios && d.enCurso()) S.combate.jugador.vida = S.combate.jugador.vidaMax;
    d.renderLuchadores?.();
    d.toast(C.dev.modoDios ? "🛠️ Modo Dios activado" : "🛠️ Modo Dios desactivado", "info", 2000);
  });
  q("adm-furia")?.addEventListener("click", () => {
    if (!d.enCurso()) return d.toast("No hay combate en curso.", "info", 2000);
    S.combate.jugador.furia = C.FURIA_MAX;
    d.renderLuchadores();
    d.renderBotones();
  });
  q("adm-instakill")?.addEventListener("click", async () => {
    if (!d.enCurso() || S.animando) return d.toast("No hay combate en curso.", "info", 2000);
    S.combate.enemigo.vida = 0;
    S.combate.fase = "victoria";
    cerrar();
    await d.alTerminar("victoria");
  });
  q("adm-dragon")?.addEventListener("click", () => {
    if (S.animando) return;
    cerrar();
    d.explorar("dragon");
  });

  // Misiones: limpia el estado diario guardado para poder reclamar de nuevo.
  q("adm-reiniciar-diario")?.addEventListener("click", () => {
    try {
      const borrar = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i) ?? "";
        if (/^lootarena:(misiones|desafio|enganche|pase)/.test(k) || /diari/i.test(k)) borrar.push(k);
      }
      borrar.forEach((k) => localStorage.removeItem(k));
    } catch { /* sin almacenamiento */ }
    d.toast("🛠️ Temporizador diario reiniciado. Recargando…", "ok", 1500);
    setTimeout(() => location.reload(), 900);
  });
}
