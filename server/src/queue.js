// Cola en serie: ejecuta las tareas de una en una, en orden de llegada.
// Se usa para que dos mints nunca se envíen a la vez con el mismo nonce.

export function crearColaSerie() {
  let cola = Promise.resolve();
  let pendientes = 0;
  return {
    /** Encola `tarea` (async) y devuelve una promesa con su resultado. */
    run(tarea) {
      pendientes++;
      const resultado = cola.then(() => tarea());
      // La cola sigue aunque la tarea falle.
      cola = resultado.catch(() => {}).finally(() => { pendientes--; });
      return resultado;
    },
    get pendientes() { return pendientes; },
  };
}
