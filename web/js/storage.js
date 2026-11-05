// localStorage tolerante a fallos (modo privado, almacenamiento bloqueado…).
export function leer(clave) {
  try { return localStorage.getItem(clave); } catch { return null; }
}
export function guardar(clave, valor) {
  try { localStorage.setItem(clave, valor); } catch { /* sin almacenamiento */ }
}
