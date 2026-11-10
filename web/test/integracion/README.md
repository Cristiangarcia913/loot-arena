# Arnés de pruebas de interfaz

Las pruebas de `web/test/*.test.js` y `server/test/` comprueban **lógica pura** con `node --test`.
Este arnés comprueba la otra mitad: que **la página real funcione en un navegador de verdad**.
Carga `web/index.html` tal cual, sin tocar ni una línea de producción, y recorre los caminos que
recorre un jugador: portada, tutorial, combate, derrota, cada sección del menú, expediciones y torre.

Además mide **rendimiento** (tiempo hasta ser jugable, peso descargado, fps en combate, en escritorio
y en móvil) y audita **accesibilidad** (contraste, teclado, foco, nombres accesibles, zonas vivas).

## Cómo se ejecuta

```bash
npx --yes http-server web -p 8101 -c-1
```

Y se abre en el navegador:

```
http://localhost:8101/test/integracion/ejecutar.html
```

Botones de la página:

| Botón | Qué hace |
|---|---|
| ▶ Ejecutar todo | los 57 casos, luego la auditoría de accesibilidad y las medidas de rendimiento |
| ♿ Solo accesibilidad | la auditoría detallada, con tabla de contrastes |
| 📈 Solo rendimiento | escritorio 1440×900 y móvil 375×812 |
| filtro | ejecuta solo los casos cuyo grupo o nombre contenga ese texto (Intro para lanzar) |
| ver los iframes | saca de su escondite las páginas bajo prueba, para mirar lo que hace el arnés |
| ⬇ Copiar informe JSON | copia al portapapeles todo el resultado |

`ejecutar.html?auto=1` lo lanza todo solo al abrirse: así se puede automatizar.

Desde la consola del navegador o desde un agente:

```js
await window.arnesEjecutarTodo();   // casos + accesibilidad + rendimiento
await window.arnesSoloCasos("Torre");
await window.arnesSoloA11y();
await window.arnesSoloPerf();
window.arnesCasos();                // lista de casos registrados
window.ARNES;                       // último resultado completo
```

Un caso falla con un mensaje en castellano que dice **qué se esperaba y qué pasó**, no con un
`expected true to be false`. Por ejemplo:

```
✘ [Robustez] Recargar a mitad de combate deja la arena utilizable
   Tras recargar a mitad de combate el botón Explorar está desactivado: el jugador se queda encallado.
```

Cualquier error de JavaScript de la página (excepción o promesa sin capturar) hace fallar el caso
en el que ocurra, con el archivo y la línea.

## Archivos

| Archivo | Contenido |
|---|---|
| `arnes.js` | el motor: carga la app, instala sondas, registra y ejecuta casos, aserciones |
| `ayudas.js` | ayudas del juego: explorar, combatir, leer la vida, ir a una sección, nombre accesible |
| `casos-navegacion.js` | portada, menú, router, atajos, historial, pestañas |
| `casos-combate.js` | combate completo, derrota, huida, habilidades, ritmo, tutorial de 5 pasos |
| `casos-contenido.js` | expediciones, torre, misiones, logros, inventario, mercado, ranking, héroe |
| `casos-robustez.js` | doble pulsación, recargas, almacenamiento roto, servidor caído, red lenta |
| `accesibilidad.js` | casos de accesibilidad + `auditar()` para el informe detallado |
| `rendimiento.js` | `medirPerfil()`: carga, peso y fps, en escritorio y móvil |
| `ejecutar.html` | la página que lo lanza y pinta los resultados |

## Cómo carga la página (y por qué así)

1. Se crea un `<iframe>` vacío (`about:blank`). Hereda el origen **y la URL** del runner, así que
   `location.hash` funciona de verdad y el router de la app se comporta como en producción.
2. **Antes** de escribir el HTML se instalan en esa ventana los oyentes de `error` y
   `unhandledrejection` y los dobles de red, movimiento y almacenamiento. Como no hay navegación,
   sobreviven: se cazan también los errores de evaluación de los módulos, que es donde más duelen.
3. Se descarga `index.html` del servidor y se escribe en el iframe con un `<base>` para que las
   rutas relativas resuelvan contra la raíz de `web/`.

`abrirApp({ modo: "real" })` hace una navegación normal con `src` en vez de eso: hace falta para
probar el botón Atrás y para que las marcas de `performance` sean auténticas, a cambio de que los
oyentes de error lleguen un poco tarde. `rendimiento.js` siempre mide así.

## Opciones de `abrirApp`

```js
const app = await abrirApp({
  ruta: "#/arena",          // hash inicial
  portada: "saltada",       // "mostrada" para probar la portada
  tutorial: "visto",        // "nuevo" para que arranque la guía
  almacen: "normal",        // "bloqueado" (modo privado) | "lleno" (cuota)
  servidor: "simulado",     // "caido" | "real"
  retardoRed: 0,            // ms que se añaden a cada fetch (red lenta)
  movimiento: "reducido",   // "normal" para probar con las animaciones puestas
  semilla: { "lootarena:progreso:invitado": "…" },  // progreso de partida
  visible: false,           // true para ver el iframe mientras corre
  modo: "sonda",            // "real" para una navegación de verdad
});
```

El servidor público (Render) **no** se usa: no permite CORS desde `localhost`, duerme y tarda. Por
defecto el arnés responde él mismo a `/health`, `/ganar`, `/ranking`, `/recompensa` y `/torre`, lo
que además hace los casos deterministas. `servidor: "real"` deja pasar las peticiones de verdad.

### Mando a distancia

```js
app.$(sel) / app.$$(sel)     // querySelector / querySelectorAll dentro de la página
app.visible(sel)             // visible de verdad (ojo: funciona con position:fixed)
app.texto(sel) / app.hash()
app.pulsar(sel)              // falla con mensaje claro si no existe o está desactivado
app.tecla("Escape", { destino })
app.sinErrores("al hacer X") // lanza si la página registró errores de JavaScript
app.errores / app.peticiones // lo que se ha cazado
app.cerrar()
```

## Escribir un caso nuevo

```js
import { caso, afirmar, igual, esperarA } from "./arnes.js";
import { explorar } from "./ayudas.js";

caso("Combate", "Lo que se comprueba, en una frase", async ({ abrirApp }) => {
  const app = await abrirApp();           // se cierra sola al terminar el caso
  await explorar(app);
  await esperarA(() => !app.$("#btn-atacar").disabled, "el botón Atacar se habilite");
  afirmar(app.$("#skills").children.length > 0, "No hay habilidades en la barra de combate.");
  app.sinErrores("durante el combate");
});
```

Reglas de la casa:

- El mensaje de fallo dice **qué está mal para el jugador**, no qué aserción falló.
- Nada de `setTimeout` a ojo: `esperarA(condición, "lo que espero")`.
- Los nodos se vuelven a buscar después de cada turno: `#skills` y las secciones se repintan enteras.
- Nada de tocar `web/js/`: si un caso encuentra un fallo, se documenta, no se arregla aquí.

## Convivencia con `node --test`

Estos archivos viven dentro de `web/test/`, así que `npm test` (que es `node --test`) los **carga**.
Hoy eso no molesta: solo registran casos al importarse, no tocan el DOM, pasan en verde y añaden
~1 s. Para que siga siendo así, **nada de este directorio debe tocar `document`, `window` ni
`localStorage` en el cuerpo del módulo**: todo eso va dentro de la función de un caso.

Si algún día se quiere que `node --test` ni los mire, basta con acotar el script en
`web/package.json`: `"test": "node --test \"test/*.test.js\""`. No lo he cambiado yo porque ese
archivo lo comparten todos los equipos.

## Lo que el arnés NO cubre

- Nada que necesite wallet: conectar MetaMask, mintear, vender, comprar cosméticos, transferir.
  Harían falta una wallet de prueba y un nodo; de momento esos caminos solo están probados por la
  lógica pura de `web/test/*.test.js`.
- El servidor real de Render (lo simula el arnés).
- Navegadores que no sean el que ejecuta la página: no hay matriz de navegadores.
