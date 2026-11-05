// Utilidades DOM. Todo el texto entra con textContent (los nombres de objetos vienen de la cadena).

export const $ = (sel) => document.querySelector(sel);

/** Crea un elemento: h("button", {class:"btn", onclick}, "texto", otroNodo) */
export function h(tag, props = {}, ...hijos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of hijos.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function enlace(href, texto) {
  return href ? h("a", { href, target: "_blank", rel: "noopener noreferrer" }, texto) : null;
}

export function acortar(addr) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "";
}

/** Notificación temporal. tipo: "info" | "ok" | "error" */
export function toast(contenido, tipo = "info", ms = 5000) {
  const cont = $("#toasts");
  const t = h("div", { class: `toast toast-${tipo}`, role: "status" }, contenido);
  cont.append(t);
  setTimeout(() => { t.classList.add("salida"); setTimeout(() => t.remove(), 400); }, ms);
}

/** Número flotante de daño sobre una tarjeta de luchador. */
export function flotar(tarjeta, texto, clase) {
  const f = h("span", { class: `flotante ${clase}` }, texto);
  tarjeta.append(f);
  setTimeout(() => f.remove(), 1100);
  tarjeta.classList.remove("golpe");
  void tarjeta.offsetWidth; // reinicia la animación
  if (clase === "dano") tarjeta.classList.add("golpe");
}

export const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
