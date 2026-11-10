# Loot Arena — Plan maestro

Documento de referencia permanente. Sustituye a los `MEJORAS-*.md` por versión, que quedan como histórico.

## 1. Objetivo y requisitos

El proyecto debe cubrir **dos temas**: **3D/VR/XR** y **blockchain/fintech**. Hoy el segundo está cubierto con solidez y el primero **no existe**: toda la presentación es SVG y CSS en 2D.

Meta: un juego que se juegue en el navegador **en 3D**, cuyos objetos sean activos reales en blockchain con un mercado que funcione de verdad.

> **Decisión del usuario (6-nov-2026): nada de gafas de realidad virtual.** El tema «3D/VR/XR» se cubre con el 3D en pantalla. No se implementa WebXR ni modo gafas.

## 2. Estado actual (6-nov-2026)

| Área | Estado |
|---|---|
| Web | 31 módulos, ~11 100 líneas, sin framework ni build. 208 tests |
| Servidor | Express en Render: botín, recompensas, ranking, grifo de gas. 148 tests |
| Contratos | 5 en Sepolia, verificados: `GameItem`, `LootCosmetics`, `LootGold`, `Mercado`, `Recompensas`. 70 tests |
| Publicación | GitHub Pages, itch.io y ejecutables (Windows, macOS, Linux) |
| Jugabilidad | Combate por turnos, jefes, torre, expediciones, misiones, pase, logros, tutorial |
| **3D / XR** | **No hay nada** |
| **Fintech** | Venta al contrato a precio fijo. **No hay mercado entre jugadores ni datos de mercado** |

## 3. Lo que falta (análisis)

### 3.1 3D / VR / XR — el hueco grande
- No hay motor 3D. La arena es un `<canvas>` 2D con sprites SVG.
- No hay WebXR, ni modo gafas, ni controles de mano.
- Sin esto el proyecto cubre un solo tema de los dos.

### 3.2 Blockchain / fintech — falta la parte «fintech»
Hoy el Mercado compra al jugador a **precio fijo calculado por el contrato**. Eso es una tienda, no un mercado. Falta:
- **Mercado entre jugadores (P2P):** poner un objeto a la venta al precio que tú decidas y que otro lo compre. Es lo que convierte el ORO en una moneda con valor de uso.
- **Datos de mercado:** precio medio por rareza, volumen, histórico. Un panel que se lea de los eventos de la cadena.
- **Subastas** y **ofertas** (opcional, si da tiempo).

### 3.3 Calidad
- No hay pruebas automáticas de la interfaz (solo de lógica).
- No se ha medido el rendimiento ni la accesibilidad de forma sistemática.
- El registro del servidor vive en memoria: se pierde al reiniciar.

## 4. Decisiones técnicas

1. **3D con three.js por CDN** (licencia MIT, gratis, módulo ES). Sin build, como el resto del proyecto. WebXR va incluido en three.js y GitHub Pages sirve por HTTPS, que es lo que WebXR exige.
2. **El 3D no sustituye al 2D: lo envuelve.** Se implementa como un *renderizador* alternativo que cumple la misma API que `fx.js`. El jugador elige 2D, 3D o VR. Si el dispositivo no puede con el 3D, cae al 2D solo.
3. **Nada de recursos de terceros.** Los modelos se generan por código con geometrías de three.js, igual que hoy los sprites son SVG escritos a mano. Así no hay licencias dudosas ni descargas pesadas.
4. **Coste cero, siempre.** Red de pruebas Sepolia, servicios con plan gratuito, sin tarjetas.
5. **Los contratos ya desplegados no se tocan.** Lo nuevo se añade en contratos aparte.

## 5. Equipos permanentes

Cada equipo tiene un área fija y recibe encargos de la sesión maestra (que hace de ingeniería y coordinación). Reglas comunes: no se comunican entre sí, cada uno toca solo sus archivos, sin commits (publica el equipo de entregas), sin secretos, todo en español.

| Equipo | Área permanente | Archivos |
|---|---|---|
| **Motor 3D** | Render 3D en pantalla y rendimiento gráfico (sin WebXR) | `web/js/render3d/**`, `web/css/render3d.css`, demos |
| **Blockchain y economía** | Contratos, seguridad, mercado P2P, datos de mercado | `contracts/**`, `web/js/mercado-p2p.js`, `web/js/analitica.js` |
| **Servidor y datos** | API, indexado de la cadena, persistencia, operación | `server/**` |
| **Juego y contenido** | Balance, progresión, contenido nuevo, retención | `web/js/combat.js`, `skills.js`, `progression.js`, `misiones.js`, `logros.js`, `torre.js`, `expediciones.js`, `desafio.js` |
| **Calidad** | Pruebas, rendimiento, accesibilidad, revisión de código | `web/test/**`, `server/test/**`, herramientas de medición |
| **Entregas** (3 sesiones ya activas) | GitHub, Render, itch.io: publicar y vigilar | Publicación, sin cambios de código |

## 6. Hoja de ruta

### Fase A — Arena en 3D (prioridad máxima)
Escena 3D con héroe y enemigo, cámara, iluminación, animaciones de combate, y la misma API que `fx.js` para que `main.js` no cambie. Selector 2D/3D.

### Fase B — Profundidad visual en pantalla (sustituye a la antigua fase de realidad virtual, descartada)
Cámara cinematográfica (planos distintos según la acción), efectos de partículas, sombras, el héroe con sus cosméticos en 3D y el revelado del botín en 3D. Todo en pantalla, con ratón, teclado y táctil.

### Fase C — Mercado entre jugadores
Contrato de mercado P2P (listar, comprar, cancelar, comisión del juego en ORO), interfaz de compraventa y panel de precios leído de la cadena.

### Fase D — Pulido
Rendimiento, accesibilidad, pruebas de interfaz, memoria del proyecto y demo.
