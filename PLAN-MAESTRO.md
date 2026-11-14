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

---

## 7. Fase E — Transparencia on-chain (encargo del profesor, 12-nov-2026)

Al ver la versión publicada, el profesor pidió cuatro cosas. Las cuatro son del tema
**blockchain/fintech**, que es justo donde puntúa el trabajo, así que pasan a prioridad máxima
por delante del pulido visual.

Lo que pidió, literal:

> poder explorar la red sepolia desde juego donde puedas ver: lo que tienes tú y tus
> transacciones, además de lo que tiene todos los jugadores contra los que juegas / Además de
> verificar quién se está llevando el dinero de cuando haces una compra o una venta, y poder ver
> el dinero que tiene el juego y cómo sacarlo / Además de una opción de cambiar de red de sepolia

### E1. Explorador de la cadena dentro del juego

Sección nueva **«Cadena»** en el menú, al lado de Mercado y Ranking. Tres pestañas:

1. **Tu cartera.** Dirección, red, saldo de ETH, saldo de oro (ERC-20), lista de objetos
   (ERC-721) con su metadato real leído del contrato, cosméticos (ERC-1155). Todo leído de la
   cadena en vivo, no del estado local del juego: si los dos no cuadran, se dice.
2. **Tus transacciones.** Historial de lo que has hecho en el juego, reconstruido de los
   *eventos* de nuestros contratos (`Transfer`, `Comprado`, `Vendido`, `Reclamado`…) con
   `getLogs` desde el bloque de despliegue. Cada fila: qué pasó, cuándo, cuánto, y enlace al
   explorador público. Sin API de pago y sin clave: solo el RPC que ya usamos.
3. **Los demás jugadores.** Para cada rival con el que te cruzas (ranking de la torre, mercado
   entre jugadores, desafío diario): su dirección, su oro, sus objetos, cuántas victorias lleva.
   Es información pública de la cadena; se presenta como lo que es.

Decisión técnica: **sin Etherscan API**. El historial completo de una dirección (incluidas las
transacciones ajenas al juego) requeriría una clave de API, y la norma del proyecto es que nada
cueste dinero y que ninguna clave viaje al navegador. Se indexan nuestros contratos, que es lo
que el juego puede explicar de verdad, y para lo demás se enlaza al explorador público.

### E2. Verificar quién se lleva el dinero

Dos momentos, y los dos hacen falta:

- **Antes de firmar**: desglose del movimiento. Quién paga, quién cobra, cuánto se queda el
  juego, cuánto se quema, cuánto cuesta el gas y a quién va (al validador, no a nosotros).
  Las cifras salen de las vistas del contrato (`precioVenta`, `ethPorVenta`, comisión), no de
  constantes copiadas en la web.
- **Después**: se lee el **recibo real** de la transacción, se decodifican sus eventos y se
  muestra el movimiento que de verdad ocurrió, dirección por dirección. Esto es lo que convierte
  la promesa en verificación: si el contrato hiciera algo distinto de lo anunciado, se vería.

### E3. El dinero del juego y cómo sacarlo

Panel **«Tesorería»** dentro de la sección Cadena:

- ETH en la caja del Mercado (`Mercado.cajaEth()`), ETH de la cartera del servidor (la que paga
  el gas de las recompensas y del grifo), oro en circulación (`totalSupply`) y oro quemado.
- Quién es el dueño del contrato (`owner()`), dicho con su dirección.
- **Cómo se saca**: `Mercado.retirarEth(cantidad)`, que solo puede llamar el dueño. Si la
  cartera conectada es el dueño, el panel ofrece el botón y pide la cantidad; si no, explica el
  mecanismo y queda claro que un jugador cualquiera no puede tocar la caja.

### E4. Cambiar de red

El juego deja de dar Sepolia por supuesto:

- Selector de red en la interfaz, con las redes conocidas y la que está activa.
- Cada red lleva sus propias direcciones de contrato en `shared/deployments.json`. Una red sin
  contratos desplegados aparece como tal y el juego dice qué falta, en vez de fallar.
- Al cambiar se pide el cambio a la cartera (`wallet_switchEthereumChain`), y si la red no está
  añadida se ofrece añadirla (`wallet_addEthereumChain`).
- Despliegue en una **segunda red de prueba** (candidata: Arbitrum Sepolia o Base Sepolia, las
  dos con grifo gratuito) para que el selector tenga dos opciones reales. Se hace cuando haya
  gas de prueba de esa red; mientras, el selector ya funciona con la red que haya.

### Reparto

| Trozo | Quién | Por qué |
|---|---|---|
| Datos y vistas de la sección Cadena (E1, E2, E3) | **Blockchain y economía** | Es leer la cadena y explicar los flujos: su área exacta |
| Resumen de tesorería servido y cacheado, indexado por red (E3, E4) | **Servidor y datos** | El RPC no se puede castigar desde cada navegador |
| Chasis multired, hueco de la sección y menú (E4) | **Sesión maestra** | `config.js`, `wallet.js`, `index.html`, `main.js` son de integración |
| Auditoría de los cuatro puntos | **Calidad** | Al cerrar la fase |

### Estado de la fase E (12-nov-2026, sesión maestra)

- **Chasis multired (E4)**: hecho. `config.js` tiene 5 redes (Sepolia + 3 testnets más verificadas
  contra su RPC real + localhost), selector en la cabecera, se recuerda en `localStorage`, y
  `cargarConfig()` dice si la red elegida tiene contratos (`desplegada`, `redesDesplegadas`).
  Pruebas en `web/test/redes.test.js`.
- **Sección «Cadena» (E1, E2, E3)**: equipo de blockchain entregó las cinco piezas
  (`datos.js`, `lectura.js`, `eventos.js`, `desglose.js`, `vista.js`) antes de quedarse sin
  cuota; la sesión maestra escribió el orquestador que faltaba (`cadena/index.js`) y el CSS
  (`cadena.css`). Verificado en vivo contra Sepolia sin cartera conectada: tesorería, cartera de
  una dirección y objetos NFT reales se leen correctamente del RPC público.
  - **Hallazgo de rendimiento**: el RPC público de Sepolia recorta el rango de `getLogs` más de
    lo que promete `BLOQUES_POR_TRAMO` (2000): un solo evento de los 18 que pide el historial
    tardó 8,4 s con 20 tramos fallidos; el historial completo desde el despliegue (~20 000
    bloques) se quedó más de 2 minutos sin resolver. Mientras tanto, la sesión maestra acotó la
    pestaña «Tus transacciones» a los últimos 3000 bloques por defecto (≈10 h), reutilizando el
    aviso «se muestran los más recientes» que ya existía. **Pendiente para cuando vuelva el
    equipo de blockchain**: tunear `BLOQUES_POR_TRAMO`/reintentos en `lectura.js`, o considerar un
    historial completo bajo demanda (botón aparte) en vez de automático.
  - Pendiente también: sus propios tests para `cadena/**` (no llegaron a escribirlos).
- **Aviso de guardian-render (12-nov-2026, sin desplegar nada)**: `/ranking` en producción se
  recuperó solo (200, sincronizado, bloque 12120583) sin que el arreglo de `ranking.js` esté
  desplegado. Su hipótesis: era la puesta al día inicial desde `DEPLOY_BLOCK` por el RPC público
  (tramos con reintentos y pausas), que en modo memoria se repite en cada reinicio o despliegue
  (`/ranking` dará 503 un rato tras cada uno). Complementa, no sustituye, el diagnóstico de
  «historia podada» de equipo-servidor: pueden ser dos causas distintas del mismo síntoma.
  Para cuando vuelva equipo-servidor: confirmar con logs antes de desplegar su arreglo, y tener
  en cuenta que Upstash (pendiente de que el usuario lo configure) evitaría el reinicio en frío.
- **Fase B (cámara 3D): COMPLETA.** B1 (cámara con intención), B2 (cosméticos en el héroe) y B3
  (cofre del botín, `cofre.js`) hechas. 124 pruebas de `render3d-*` + 459 de toda la web en
  verde (informe de equipo-3d, 13-nov-2026). No hizo falta tocar `main.js`: `revelarBotin` y
  `iniciarInterfaz` siguen siendo el único contrato con `escena3d.js`.
- **Servidor (E3, E4) y ranking: COMPLETO.** Diagnóstico real del atasco del ranking: el RPC
  público *poda* su historial más allá de ~20 000-40 000 bloques («pruned history unavailable»,
  código 4444); trocear el rango no sirve porque el problema es el *principio* del rango, no su
  tamaño. Arreglo: `esHistoriaPodada()` distingue ese error de uno pasajero, salta hacia delante
  en vez de trocear, y `actualizado` se pone también si el refresco acaba mal pero avanzó algo
  (mata el 503 eterno). `/health` gana `indexador` (atascado, segundosSinAvanzar…); `/ranking`
  avisa con `incompleto`+`desdeBloque` cuando hubo huecos. `GET /tesoreria` nuevo, cacheado 45 s,
  con red como parámetro (`RED`, nunca Sepolia a fuego). 299 tests, verificado contra la cadena
  real (converge en 4 s donde antes daba 503 eterno). **Pendiente del usuario**: variables
  `ORO_ADDRESS` y `RED` en el panel de Render (el `render.yaml` no se está aplicando — avisado a
  guardian-render) y las tres de Upstash de siempre.
  - `oroQuemado` en `/tesoreria` queda en `null` con motivo: LootGold es un `ERC20Burnable` sin
    contador acumulado, y sumar todo el historial de `Transfer` a 0x0 se topa con la misma pared
    de historia podada. Haría falta un `totalQuemado` en el contrato — decisión para el equipo
    de blockchain, no algo que el servidor pueda inventar.
- **Blockchain, explorador del navegador (E1): COMPLETO.** Sondeo de horizonte equivalente al
  del servidor (`horizonte()`/`pedirLogs` en `lectura.js`), para que «Tus transacciones» no se
  tope con la misma pared de historia podada al leer desde el navegador. 479/479 en verde.

### Auditoría de Calidad tras la fase E (13/14-nov-2026)

Informe completo en `side-session-notes/calidad-auditoria-2.md`. Arnés de 57 a 84 casos.
De los 9 hallazgos anteriores: **#1 arreglado y verificado** (queda de regresión). De los 6
nuevos, la sesión maestra arregló y verificó en vivo los cuatro bien acotados:

| # | Hallazgo | Severidad | Estado |
|---|---|---|---|
| 10 | Barra de vida sin anunciar (sin `role="progressbar"`/`aria-valuenow`) | ALTO | **Arreglado** en `fx.js`/`index.html`. Avisado a equipo-3d: `escena3d.js` tiene su propio `actualizarVida()` con el mismo hueco, con el parche exacto para copiar. |
| 11 | Torre/Expediciones/Cadena se tragan el foco al repintar tras enfocar el router | ALTO | **Arreglado**: `router.js` exporta `enfocarSeccion`; `main.js` la reusa para recuperar el foco solo si cayó a `<body>`. Verificado en vivo en las tres secciones. |
| 12 | «Saltar al contenido» no mueve el foco | MEDIO | **Arreglado**: `tabindex="-1"` en `<main id="secciones">`. Verificado en vivo. |
| 13 | Pestañas del Ranking sin `aria-controls`, las 4 en el recorrido de Tab | MEDIO | **Arreglado** en `enganche.js`: roving tabindex + flechas + `aria-controls`/`aria-labelledby`, igual que el Mercado. Verificado en vivo. |
| 14 | Alt+1..9 deja «cadena» (10.ª sección) sin atajo | BAJO | **Arreglado** en `router.js`: Alt+0 → 10.ª sección (convención de pestañas de navegador). Verificado en vivo. |

**Pendientes, sin tocar por ahora** (necesitan juicio de diseño o remedición, no son mecánicos):

| # | Hallazgo | Severidad | Por qué se deja |
|---|---|---|---|
| 2 | `mostrarResultado()` (fx.js) es `aria-modal` pero no atrapa el foco; a peor (18→21 elementos alcanzables por detrás) | ALTO | Falta implementar un trap de foco de verdad, no una línea suelta. |
| 3 | Contraste bajo AA en Poción (1,93:1), Defender (2,42:1), Atacar/«Aceptar el desafío» (2,81:1), habilidades (3,52:1), «Vacía» del inventario (2,53:1) | MEDIO-ALTO | Toca la paleta visual de varios botones: es una decisión de diseño, no solo un cambio mecánico de color. Remedir tras cualquier cambio. |
| 6 | La Torre acaba los pisos de forma distinta | — | Sin reproducir todavía. |
| 7 | Misiones vacía ~0,4 s | BAJO | Cosmético. |
| 8 | Peso del JS: 165→258 kB gzip, +307 kB de three.js por CDN si hay 3D | — | Esperable para el alcance del proyecto; vigilar, no urgente. |
| 9 | Sin CORS desde localhost | BAJO | Molesta en desarrollo, no en producción (el servidor sí acepta Pages/itch.zone). |
| 15 | 3D: 307 kB CDN + 165 kB propios + 9 peticiones, 193-370 ms de más al montar | BAJO | Coste conocido y aceptado del 3D; no hay dato de FPS real todavía (el panel del navegador tiene que estar visible para medir: `requestAnimationFrame` se frena en segundo plano). |
