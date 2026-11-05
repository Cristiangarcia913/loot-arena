# Loot Arena 1.1 — Plan de mejoras ("que llame la atención")

Objetivo: pasar de un prototipo correcto a un juego con **espectáculo visual, profundidad de combate y botín emocionante**, sin perder lo que ya funciona (contrato desplegado, servidor en Render, publicación en GitHub Pages, itch.io y Release).

## Reglas para todos los equipos

1. **No os comunicáis entre sesiones.** Las dudas o cambios de interfaz van al informe final para la sesión maestra.
2. **Cada equipo toca solo sus archivos** (tabla de abajo). `web/js/main.js` y la integración final son de la sesión maestra.
3. **El contrato NO se cambia ni se redespliega.** Un objeto sigue siendo `{nombre, tipo, rareza 0..2, ataque, defensa}` con tipos `Espada, Escudo, Casco, Armadura, Botas`.
4. **Sin build, sin dependencias nuevas en la web** (ni Phaser ni npm): HTML + CSS + JS módulos ES, como ahora. Todo el arte y el sonido se generan con código (SVG/CSS/Canvas/WebAudio): nada de imágenes, fuentes o audios de terceros con licencia dudosa.
5. **Nada de secretos** en el código. No hagáis commits ni push.
6. Rendimiento: 60 fps en un portátil normal; respeta `prefers-reduced-motion` (efectos reducidos) y añade un botón de silencio.
7. Todo el texto en español.

| Equipo | Carpeta / archivos que posee |
|---|---|
| **Arte y sensación (sesión "arte")** | `web/index.html`, `web/css/**`, `web/js/fx.js`, `web/js/audio.js`, `web/js/sprites.js`, `web/assets/**` (si crea), `web/fx-demo.html` |
| **Jugabilidad (sesión "jugabilidad")** | `web/js/combat.js`, `web/js/skills.js`, `web/js/progression.js`, `web/test/**` |
| **Botín épico (sesión "botín")** | `server/src/loot.js`, `server/src/app.js` (solo validación del body), `server/test/**`, `server/README.md` |
| **Sesión maestra** | `web/js/main.js`, `web/js/ui.js`, `web/js/api.js`, `SPEC.md`, `MEJORAS.md`, docs, despliegues |

---

## 1. Arte y sensación (`fx.js`, `audio.js`, `sprites.js`, CSS, HTML)

**Qué debe conseguir:** que al abrir el juego entren ganas de jugar y que cada golpe y cada botín "se sientan".

- **Escenario vivo:** fondo de arena animado (canvas o capas CSS) con antorchas parpadeantes, niebla/polvo en parallax y viñeta. Paleta oscura con dorados (mantener la identidad actual).
- **Personajes con sprites propios** en SVG generados por código (`sprites.js`): héroe + los 10 enemigos del bestiario + 1 sprite de **jefe** (más grande, con aura). Animaciones idle (respiración/flotar), ataque (embestida), recibir golpe (parpadeo blanco + retroceso), muerte (disolución en partículas). El equipo equipado se ve en el héroe (al menos: espada y escudo coloreados por rareza).
- **Feedback de combate:** números de daño flotantes (más grandes y dorados en crítico), sacudida de pantalla en críticos/golpes brutales, destellos, "hit-stop" de ~80 ms, barras de vida con animación de daño retardado (la parte perdida se vacía con retraso), iconos de estados (veneno, aturdido, sangrado, escudo).
- **Intención del enemigo** visible sobre su cabeza (icono de lo que hará el próximo turno).
- **Revelado del botín:** cofre que tiembla y se abre; haz de luz y partículas por rareza (gris, azul, **dorado con rayos para Legendario**); la carta del objeto gira y aterriza en el inventario. Pantalla de "¡LEGENDARIO!" a pantalla completa.
- **Inventario como cartas de colección:** tarjetas con borde/brillo según rareza, efecto holográfico al pasar el ratón en Legendarios, contador de poder (ataque+defensa).
- **Sonido sintetizado** (`audio.js`, WebAudio, sin archivos): golpe, crítico, bloqueo, curación, subida de nivel, victoria, derrota, cofre y fanfarria legendaria; música ambiental opcional muy ligera. Botón 🔊/🔇 persistente en `localStorage`.
- **Pantallas:** portada con título animado y botón "Entrar en la arena"; pantallas de victoria/derrota con resumen (daño hecho, críticos, XP ganada).
- **Responsive** (móvil en vertical incluido) y accesible (contraste, foco visible, `aria-live` en la crónica).

**API que debe exponer `fx.js` (la usará la sesión maestra):**
```js
export function montarEscena(raizEl)                     // prepara fondo, sprites y capas
export function mostrarEnemigo(enemigo)                   // enemigo: {nombre, emoji, nivel, jefe?:bool, clave?:string}
export function animarAtaque(quien /* "heroe"|"enemigo" */, { critico=false, brutal=false } = {})
export function animarGolpe(quien, dano, { critico=false, bloqueado=false } = {})
export function animarCuracion(quien, cantidad)
export function mostrarEstado(quien, estados /* [{tipo:"veneno"|"aturdido"|"sangrado"|"escudo", turnos}] */)
export function mostrarIntencion(intencion /* {tipo:"atacar"|"cargar"|"defender"|"habilidad", texto} | null */)
export function animarMuerte(quien)
export async function revelarBotin(item /* {nombre,tipo,rareza,ataque,defensa} | null */) // resuelve al terminar
export function subidaDeNivel(nivel)
export function actualizarHeroe(equipados /* items */)
```
`audio.js`: `export function sonar(nombre)`, `export function setSilencio(bool)`, `export function silenciado()`.

Entrega también `web/fx-demo.html`: página de prueba con botones que disparan cada efecto (para verificar sin wallet).

**IDs del DOM que debe mantener o crear en `index.html`** (los usa `main.js`): `#btn-connect`, `#net-badge`, `#addr`, `#banner`, `#arena-level`, `#btn-explorar`, `#btn-atacar`, `#btn-defender`, `#btn-huir`, `#btn-refrescar`, `#form-transfer`, `#tr-to`, `#tr-error`, `#tr-cancel`, `#dlg-transfer`, más los nuevos: `#skills` (contenedor de botones de habilidad), `#btn-pocion`, `#hero-xp` (barra de XP), `#hero-nivel`, `#racha`, `#btn-sonido`, `#pantalla-portada`, `#pantalla-resultado`. Si cambias o añades IDs, lístalos en tu informe.

## 2. Jugabilidad (`combat.js`, `skills.js`, `progression.js`)

**Qué debe conseguir:** decisiones interesantes en cada turno y ganas de "una partida más". Todo **puro y determinista** (rng inyectable), sin DOM, con tests `node --test`.

- **Habilidades con enfriamiento** (`skills.js`): además de Atacar y Defender, 3 habilidades: *Golpe Poderoso* (x1.8, enfriamiento 3), *Torbellino/Desangrar* (aplica sangrado), *Grito de guerra* (sube ataque 2 turnos). Una 4.ª habilidad **desbloqueada por el equipo**: si llevas un Legendario, su tipo da una habilidad especial (p. ej. Espada legendaria → *Tajo Celestial*; Escudo legendario → *Muro de Fe* que refleja daño).
- **Críticos** (probabilidad base 10 %, +1 % por cada 3 de ataque del equipo) y **esquiva** según defensa.
- **Estados alterados:** veneno, sangrado (daño por turno), aturdido (pierde turno), escudo (absorbe daño). Con duración en turnos.
- **Enemigos con personalidad:** cada criatura del bestiario tiene un patrón/habilidad (la araña envenena, el gólem se defiende y contraataca, el espectro esquiva, el hechicero carga un hechizo que hay que bloquear…). La **intención** del próximo turno se calcula y se expone para mostrarla.
- **Jefes:** cada 5.º combate de un nivel de arena es un **jefe** (más vida, 2 fases, habilidad definitiva telegrafiada). Ganar a un jefe se marca para que el servidor dé mejor botín (`jefe: true`).
- **Pociones:** 3 por expedición, curan 35 % de la vida.
- **Progresión del héroe** (`progression.js`, persistida en `localStorage` por dirección; en modo demo, por "invitado"): XP por victoria según nivel del enemigo, niveles de héroe 1–30 con pequeñas mejoras de stats, **racha** de victorias (multiplica XP), récord personal. Las stats del NFT siguen siendo lo que más pesa.
- Mantener compatible el flujo actual: `crearCombate`, `turnoJugador`, `huir` pueden cambiar de firma, pero **documenta la API final** en el informe y en comentarios JSDoc.

**API mínima esperada:**
```js
// combat.js
export function crearCombate(heroe /* {vidaMax, ataque, defensa, nivel, habilidades} */, enemigo, rng?)
export function turnoJugador(combate, accion /* "atacar"|"defender"|"pocion"|{habilidad:id} */, rng?)
//   → { combate, eventos: [{actor, tipo, dano?, critico?, estado?, texto}], fin: null|"victoria"|"derrota"|"huida" }
export function intencionEnemigo(combate) // → {tipo, texto}
export function generarEnemigo(nivel, rng?, { jefe=false } = {})
// skills.js
export function habilidadesDisponibles(heroe, equipados) // → [{id, nombre, icono, enfriamiento, restante, descripcion}]
// progression.js
export function cargarProgreso(clave), guardarProgreso(clave, p), aplicarVictoria(p, enemigo), statsHeroe(p, equipados)
```
Objetivo de calidad: tests que cubran críticos, estados, enfriamientos, jefes, intenciones y progresión; y una simulación de 10 000 combates que demuestre que un héroe sin equipo gana ~70 % en nivel 1 y ~20 % en nivel 10 (balance), con la tabla en el informe.

## 3. Botín épico (`server/src/loot.js`)

**Qué debe conseguir:** que cada objeto tenga nombre y personalidad, y que los jefes y los niveles altos premien. Sin cambiar el contrato.

- **Nombres procedurales con afijos** según rareza: Común "Espada Oxidada"; Raro "Espada Rúnica de Escarcha"; Legendario con nombre propio y epíteto ("Albor, Espada del Fénix Eterno"). Mínimo 15 bases por tipo y 20 afijos; sin repetir el mismo nombre legendario dos veces seguidas. Máx. 60 caracteres.
- **Rareza según dificultad:** `enemyLevel` alto y `jefe: true` mejoran la probabilidad de Raro/Legendario (p. ej. jefe nivel 10 → Legendario 20 %). La tabla base 70/25/5 sigue valiendo para nivel 1 sin jefe. Los jefes **siempre** sueltan objeto.
- **Protección contra la mala suerte ("pity")** en memoria por dirección: tras 15 drops sin Legendario, el siguiente drop sube mucho la probabilidad. (En memoria está bien; Render reinicia a veces.)
- **Stats con más varianza** y ligadas al nivel del enemigo (sin pasar de `uint16`), manteniendo los rangos por rareza de `SPEC.md` como mínimo/máximo absolutos ampliados: Común 1–6, Raro 6–14, Legendario 14–30.
- **API compatible hacia atrás:** `POST /ganar` acepta además `jefe` (booleano opcional). Valida tipos; si `jefe` no es booleano → 400. La respuesta no cambia de forma.
- Tests: distribución por nivel y jefe (100 000 tiradas), pity, longitudes de nombre, rangos de stats, validación de `jefe`. `npm test` en verde.

## 5. Economía on-chain: ORO, vender y tienda (sesión "economía-contratos")

**Idea:** los objetos que consigues se pueden **vender por ORO**, una moneda ERC-20 que ves en MetaMask. Con ORO compras **cosméticos** para personalizar a tu héroe o abres **cofres cosméticos** al azar. Todo en Sepolia y sin servidor de por medio: el precio lo calcula el contrato con las stats guardadas en `GameItem`, así que nadie puede hacer trampas.

`GameItem` **no se toca**. Se despliegan tres contratos nuevos (Solidity 0.8.28, OpenZeppelin v5, en `contracts/contracts/`):

| Contrato | Qué es |
|---|---|
| `LootGold.sol` | ERC-20 **"Oro de Loot Arena" (ORO)**, 18 decimales. Solo el `Mercado` puede acuñar (`MINTER` = mercado, fijado por el owner). Permite `burn` / `burnFrom`. |
| `LootCosmetics.sol` | ERC-1155 de cosméticos (ids del catálogo de abajo). Solo el `Mercado` puede acuñar. `uri` apunta a JSON estático (puede ser `https://cristiangarcia913.github.io/loot-arena/meta/cosmeticos/{id}.json`). |
| `Mercado.sol` | `venderItem(tokenId)`: el jugador (dueño, con `setApprovalForAll(mercado)` en `GameItem`) entrega el NFT, que va a `0x…dEaD`, y recibe ORO. `venderVarios(uint256[])`. `precioVenta(tokenId) view`. `comprarCosmetico(id, cantidad)`: quema ORO y acuña el cosmético. `abrirCofre()`: quema `PRECIO_COFRE` ORO y acuña un cosmético aleatorio ponderado por rareza (azar con `block.prevrandao` + nonce: aceptable en testnet, documéntalo). `catalogo()` view. El owner puede cambiar precios y añadir cosméticos. Eventos: `ItemVendido(jugador, tokenId, oro)`, `CosmeticoComprado(jugador, id, cantidad, oro)`, `CofreAbierto(jugador, id)`. Protegido con `ReentrancyGuard`. Bono de bienvenida opcional: `reclamarBienvenida()` da 50 ORO una vez por dirección. |

**Precio de venta** (en ORO, entero): `base[rareza] + 2 × (ataque + defensa)`, con `base = [10, 40, 200]`.

**Además, pago en ETH de Sepolia (decisión del usuario):** al vender, el jugador recibe en su misma wallet conectada el ORO **y** un poco de ETH de Sepolia de la "caja" del Mercado:
- `recompensaEth[rareza]` por defecto `[0.0001, 0.0005, 0.002]` ETH (ajustable por el owner).
- Se paga solo si la caja tiene saldo suficiente; si no, la venta sigue funcionando y solo se paga ORO (no revierte). El evento indica cuánto ETH se pagó.
- `receive()` para recargar la caja (cualquiera puede donar), `retirarEth(cantidad)` solo owner, `cajaEth()` view.
- Límite anti-abuso: máximo `maxEthDiario` (por defecto 0.005 ETH) por dirección y día (por `block.timestamp / 1 days`).
- Pago con `call` tras actualizar estado (checks-effects-interactions + `ReentrancyGuard`).
- Evento: `ItemVendido(jugador, tokenId, oro, eth)`.

**Catálogo inicial de cosméticos** (fuente de verdad; el equipo de arte los dibuja y la tienda los muestra):

| id | Ranura | Nombre | Rareza | Precio ORO |
|---|---|---|---|---|
| 1 | color | Armadura carmesí | común | 60 |
| 2 | color | Armadura esmeralda | común | 60 |
| 3 | color | Armadura obsidiana | rara | 150 |
| 4 | sombrero | Capucha del cazador | común | 80 |
| 5 | sombrero | Yelmo con cuernos | rara | 180 |
| 6 | sombrero | Corona del campeón | legendaria | 600 |
| 7 | capa | Capa de viajero | común | 90 |
| 8 | capa | Capa real púrpura | rara | 220 |
| 9 | capa | Alas de fénix | legendaria | 800 |
| 10 | aura | Aura de escarcha | rara | 250 |
| 11 | aura | Aura de llamas | legendaria | 700 |
| 12 | mascota | Gato negro | rara | 300 |
| 13 | mascota | Mini dragón | legendaria | 900 |
| 14 | consumible | Poción extra (+1 poción por expedición, se gasta) | común | 25 |

Cofre cosmético: 120 ORO; probabilidades común 60 %, rara 32 %, legendaria 8 % (no da consumibles).

Tests con Hardhat: venta correcta y precio, no puedes vender lo que no es tuyo, sin aprobación revierte, ORO solo acuñable por el mercado, compra quema ORO, saldo insuficiente revierte, cofre acuña un id válido, bienvenida una sola vez, owner cambia precios y un no-owner no, reentrada. Script `scripts/deploy-economia.js` que despliega los tres, enlaza permisos y añade a `shared/deployments.json` (`sepolia.oro`, `sepolia.cosmeticos`, `sepolia.mercado`) y los ABI a `shared/` (`LootGold.abi.json`, `LootCosmetics.abi.json`, `Mercado.abi.json`), y JSON de metadatos de cosméticos en `web/meta/cosmeticos/{id}.json`. **No despliega en Sepolia** (lo hace la maestra); sí en la red local de Hardhat para probar.

Archivos: `contracts/contracts/{LootGold,LootCosmetics,Mercado}.sol`, `contracts/test/economia.test.js`, `contracts/scripts/deploy-economia.js`, `shared/*.abi.json` nuevos, `web/meta/**`.

## 6. Tienda, venta y vestuario en la web (sesión "tienda-web")

Archivos: `web/js/economy.js` (llamadas a contratos con ethers v6), `web/js/tienda.js` (UI), `web/css/tienda.css`, `web/test/economy.test.js`.

- **Saldo de ORO** siempre visible en la cabecera (`#saldo-oro`) con animación de monedas al cambiar, y botón **"Añadir ORO a MetaMask"** (`wallet_watchAsset`).
- **Vender** desde el inventario: botón en cada carta con el precio de venta (`precioVenta`), venta múltiple, primera vez pide `setApprovalForAll` explicando por qué. Animación de monedas volando a la cabecera.
- **Tienda** (`#tienda`): catálogo con vista previa del cosmético sobre el héroe antes de comprar; cofre cosmético con animación de apertura y revelado por rareza (reutiliza `fx.revelarBotin` si sirve, o una animación propia en `tienda.css`).
- **Vestuario** (`#vestuario`): lee los cosméticos de la wallet (ERC-1155 `balanceOfBatch`) y deja equipar uno por ranura; la apariencia se guarda en `localStorage` por dirección y se aplica con `fx.actualizarHeroe(equipados, apariencia)`.
- **Bienvenida**: si nunca la ha reclamado, banner "Reclama 50 ORO gratis".
- Mensajes claros de gas: vender/comprar son transacciones del jugador (necesita algo de ETH de Sepolia; enlace al faucet).
- Funciona sin wallet en modo demo (tienda visible pero deshabilitada) y si las direcciones de economía aún no están en `deployments.json` (oculta la tienda con un aviso), para no romper el juego actual.

**API para la maestra:** `export async function montarTienda({ provider, signer, cuenta, cfg, onCambioApariencia, onCambioSaldo, fx })`, `export function desmontarTienda()`, `export async function refrescarSaldo()`, `export function aparienciaGuardada(cuenta)`; y en `economy.js` funciones puras de precio (`precioVentaLocal(item)`) testeadas con la misma fórmula que el contrato.

## 7. Cambios para equipos ya en marcha

- **Arte (§1):** el revelado del botín debe crear **hype** de verdad: anticipación (cofre que tiembla cada vez más, luz que se escapa por las rendijas, suspense de 1–2 s), explosión, carta que gira, y para Legendario pantalla completa con rayos, fanfarria y confeti; botón "¡Otra vez!" para volver a la arena. Además: `sprites.js` debe dibujar los **cosméticos del catálogo de §5** sobre el héroe (color de armadura, sombrero, capa, aura, mascota) y `fx.actualizarHeroe(equipados, apariencia)` recibe `apariencia = {color, sombrero, capa, aura, mascota}` (ids del catálogo o null). Exporta también `export function previsualizarCosmetico(contenedorEl, id)` para la tienda. En `index.html` añade los contenedores vacíos `#saldo-oro` (cabecera), `#tienda`, `#vestuario` (pestañas o paneles) y enlaza `css/tienda.css`.
- **Jugabilidad (§2):** `crearCombate` acepta `pocionesExtra` (número de pociones compradas, consumible id 14) que se suman a las 3 por expedición; documenta cómo saber cuántas se gastaron para que la web pueda quemarlas (o no quemarlas si se decide que son permanentes: indícalo en el informe).

## 4. Sesión maestra (integración)

- Desplegar `LootGold`, `LootCosmetics` y `Mercado` en Sepolia, verificarlos en Etherscan y publicar las direcciones.

- Conectar `main.js` con las nuevas APIs, actualizar `SPEC.md`, probar en local con el servidor y Sepolia, revisar rendimiento y móvil.
- Desplegar el servidor nuevo en Render, publicar con escaneo de secretos, crear Release **v1.1.0** y actualizar itch.io (capturas incluidas).
