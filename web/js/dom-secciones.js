// Ayudante DOM de las secciones Inventario, Mercado y Héroe. Igual que ui.h() pero admite:
//   · style como objeto (las propiedades "--variable" se fijan con setProperty)
//   · checked / selected / value como propiedades (no solo atributos)
//   · hijos anidados en arrays (de cualquier profundidad)
// Todo el texto entra con textContent.

const PROPIEDADES = new Set(["checked", "selected", "value"]);

export function h(tag, props = {}, ...hijos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") {
      for (const [p, val] of Object.entries(v)) {
        if (val == null || val === false) continue;
        if (p.startsWith("--")) el.style.setProperty(p, String(val));
        else el.style[p] = String(val);
      }
    } else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (PROPIEDADES.has(k)) { el[k] = v; if (v === true) el.setAttribute(k, ""); }
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of hijos.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
