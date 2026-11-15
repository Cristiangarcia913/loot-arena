// Anuncios recompensados de Loot Arena.
//
// mostrarAnuncioRecompensado(tipo, onSuccess, onFail):
//   - Con el SDK de CrazyGames (window.CrazyGames.SDK) pide un anuncio "rewarded" de verdad.
//   - Sin SDK (local, itch.io…) muestra un modal que simula el anuncio: cuenta atrás de 5 s y,
//     al acabar, un botón para cerrarlo y cobrar la recompensa. Cerrarlo antes no da nada.
//
// `tipo` solo identifica el gancho ("revivir_torre", "botin_expedicion", "renovar_tienda") para
// el texto del modal y para depurar. Devuelve además una Promise<boolean> (true = recompensa).
// Nunca hay dos anuncios a la vez: una segunda llamada mientras hay uno abierto falla al momento.
//
// No toca el DOM al importarse (solo al simular un anuncio).

export const SEGUNDOS_SIMULADO = 5;

const TEXTO_TIPO = Object.freeze({
  revivir_torre: "Revive en la Torre infinita",
  botin_expedicion: "Duplica el botín de la expedición",
  renovar_tienda: "Nuevo catálogo en el Mercado",
});

/** SDK de CrazyGames si está cargado (y tiene la API de anuncios), si no null. */
export function sdkCrazyGames(entorno = globalThis) {
  const sdk = entorno?.CrazyGames?.SDK;
  return sdk && typeof sdk.ad?.requestAd === "function" ? sdk : null;
}

/**
 * Crea un gestor de anuncios con entorno y simulador inyectables (para tests).
 * @param {{entorno?: object, simular?: (tipo:string, segundos:number) => Promise<boolean>, segundos?: number}} [o]
 */
export function crearGestorAnuncios({ entorno = globalThis, simular = modalSimulado, segundos = SEGUNDOS_SIMULADO } = {}) {
  let ocupado = false;
  let iniciado = null;

  /** SDK v3 exige init() antes de usarlo; se llama una sola vez y un fallo no bloquea el anuncio. */
  async function prepararSdk(sdk) {
    if (typeof sdk.init !== "function" || sdk.environment && sdk.environment !== "uninitialized") return;
    iniciado ??= Promise.resolve().then(() => sdk.init()).catch(() => {});
    await iniciado;
  }

  function anuncioSdk(sdk) {
    return new Promise((resolver) => {
      let hecho = false;
      const fin = (ok) => { if (!hecho) { hecho = true; resolver(ok); } };
      try {
        const r = sdk.ad.requestAd("rewarded", {
          adStarted: () => {},
          adFinished: () => fin(true),
          adError: () => fin(false),
        });
        // Algunas versiones devuelven una promesa que rechaza si no hay anuncio.
        if (r && typeof r.catch === "function") r.catch(() => fin(false));
      } catch {
        fin(false);
      }
    });
  }

  /**
   * @param {string} tipo
   * @param {() => void} [onSuccess] se llama si el anuncio se vio entero
   * @param {(motivo: "ocupado"|"cancelado"|"error") => void} [onFail]
   * @returns {Promise<boolean>}
   */
  async function mostrarAnuncioRecompensado(tipo, onSuccess, onFail) {
    if (ocupado) { onFail?.("ocupado"); return false; }
    ocupado = true;
    let ok = false;
    let motivo = "cancelado";
    try {
      const sdk = sdkCrazyGames(entorno);
      if (sdk) {
        await prepararSdk(sdk);
        ok = await anuncioSdk(sdk);
        if (!ok) motivo = "error";
      } else {
        ok = !!(await simular(String(tipo ?? ""), segundos));
      }
    } catch {
      ok = false;
      motivo = "error";
    } finally {
      ocupado = false;
    }
    if (ok) onSuccess?.(); else onFail?.(motivo);
    return ok;
  }

  return { mostrarAnuncioRecompensado, ocupado: () => ocupado };
}

// ───────────────────────── Modal simulado ─────────────────────────

let estilosPuestos = false;
function ponerEstilos(doc) {
  if (estilosPuestos || doc.getElementById("anuncio-estilos")) return;
  estilosPuestos = true;
  const s = doc.createElement("style");
  s.id = "anuncio-estilos";
  s.textContent = `
.anuncio-fondo{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:16px;
  background:rgba(8,6,4,.82);backdrop-filter:blur(4px);animation:anuncio-in .2s ease-out}
.anuncio-caja{width:min(420px,100%);background:var(--panel,#231b15);color:var(--texto,#f3e9d7);
  border:1px solid var(--borde,#5b4530);border-radius:var(--radio,14px);box-shadow:var(--sombra,0 10px 30px rgba(0,0,0,.45));
  padding:20px;text-align:center;font-family:var(--cuerpo,system-ui,sans-serif)}
.anuncio-etiqueta{display:inline-block;font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;
  color:var(--tenue,#b9a88e);border:1px solid var(--borde-suave,#3b2d21);border-radius:999px;padding:2px 10px}
.anuncio-titulo{margin:12px 0 4px;font-family:var(--titulo,Georgia,serif);color:var(--oro,#e8b75a);font-size:1.2rem}
.anuncio-pantalla{margin:14px 0;aspect-ratio:16/9;border-radius:10px;display:grid;place-items:center;
  background:linear-gradient(135deg,var(--panel-2,#2d231b),#3a2a1a 60%,var(--panel-2,#2d231b));
  border:1px solid var(--borde-suave,#3b2d21);font-size:2.6rem}
.anuncio-cuenta{font-variant-numeric:tabular-nums;font-size:2rem;font-weight:700;color:var(--oro,#e8b75a)}
.anuncio-barra{height:6px;border-radius:999px;background:var(--borde-suave,#3b2d21);overflow:hidden;margin:10px 0 14px}
.anuncio-barra>span{display:block;height:100%;width:0;background:var(--oro,#e8b75a);transition:width .25s linear}
.anuncio-acciones{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}
.anuncio-saltar{background:none;border:0;color:var(--tenue,#b9a88e);text-decoration:underline;cursor:pointer;font:inherit;font-size:.85rem}
@keyframes anuncio-in{from{opacity:0}to{opacity:1}}
@media (prefers-reduced-motion:reduce){.anuncio-fondo{animation:none}.anuncio-barra>span{transition:none}}`;
  doc.head.append(s);
}

/**
 * Simula un anuncio con un modal. Resuelve true si se cierra tras la cuenta atrás, false si se cancela.
 * @param {string} tipo
 * @param {number} [segundos]
 * @returns {Promise<boolean>}
 */
export function modalSimulado(tipo, segundos = SEGUNDOS_SIMULADO) {
  const doc = globalThis.document;
  if (!doc?.body) return Promise.resolve(false);
  ponerEstilos(doc);
  return new Promise((resolver) => {
    const previo = doc.activeElement;
    const fondo = doc.createElement("div");
    fondo.className = "anuncio-fondo";
    fondo.setAttribute("role", "dialog");
    fondo.setAttribute("aria-modal", "true");
    fondo.setAttribute("aria-labelledby", "anuncio-titulo");
    fondo.innerHTML = `<div class="anuncio-caja">
        <span class="anuncio-etiqueta">Anuncio · demo</span>
        <h2 class="anuncio-titulo" id="anuncio-titulo"></h2>
        <div class="anuncio-pantalla" aria-hidden="true">📺</div>
        <div class="anuncio-cuenta" aria-live="polite"></div>
        <div class="anuncio-barra" aria-hidden="true"><span></span></div>
        <div class="anuncio-acciones">
          <button type="button" class="btn btn-gold anuncio-cerrar" disabled></button>
        </div>
        <button type="button" class="anuncio-saltar">Cerrar sin recompensa</button>
      </div>`;
    fondo.querySelector(".anuncio-titulo").textContent = TEXTO_TIPO[tipo] ?? "Recompensa";
    const cuenta = fondo.querySelector(".anuncio-cuenta");
    const barra = fondo.querySelector(".anuncio-barra > span");
    const cerrar = fondo.querySelector(".anuncio-cerrar");
    const saltar = fondo.querySelector(".anuncio-saltar");

    const total = Math.max(0, Number(segundos) || 0);
    const inicio = Date.now();
    let listo = false;
    const pintar = () => {
      const pasado = (Date.now() - inicio) / 1000;
      const queda = Math.max(0, Math.ceil(total - pasado));
      barra.style.width = `${total ? Math.min(100, (100 * pasado) / total) : 100}%`;
      if (queda > 0) {
        cuenta.textContent = String(queda);
        cerrar.textContent = `Recompensa en ${queda} s`;
        return;
      }
      listo = true;
      clearInterval(timer);
      cuenta.textContent = "✓";
      cerrar.disabled = false;
      cerrar.textContent = "🎁 Cerrar y cobrar recompensa";
      saltar.hidden = true;
      cerrar.focus();
    };
    const terminar = (ok) => {
      clearInterval(timer);
      doc.removeEventListener("keydown", tecla, true);
      fondo.remove();
      try { previo?.focus?.(); } catch { /* el foco anterior ya no existe */ }
      resolver(ok);
    };
    const tecla = (e) => {
      if (e.key === "Escape") { e.preventDefault(); terminar(listo); }
      else if (e.key === "Tab") { e.preventDefault(); (listo ? cerrar : saltar).focus(); }
    };
    cerrar.addEventListener("click", () => { if (listo) terminar(true); });
    saltar.addEventListener("click", () => terminar(false));
    doc.addEventListener("keydown", tecla, true);
    doc.body.append(fondo);
    const timer = setInterval(pintar, 250);
    pintar();
    if (!listo) saltar.focus();
  });
}

// Gestor listo para usar en el juego.
const DEF = crearGestorAnuncios();
export const mostrarAnuncioRecompensado = DEF.mostrarAnuncioRecompensado;
