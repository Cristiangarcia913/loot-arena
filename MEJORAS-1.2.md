# Loot Arena 1.2 — Menú por secciones y enganche

Peticiones del usuario tras probar la 1.1:
1. **No quiere una página larga con scroll**: el juego debe organizarse en **secciones con un menú** (como una app).
2. **Quiere que la gente se enganche más**: motivos para volver cada día y objetivos a medio y largo plazo.

Las reglas de `MEJORAS.md` siguen valiendo: sin comunicación entre sesiones (dudas al informe final), cada equipo toca solo sus archivos, sin build ni dependencias en la web, nada de recursos de terceros, nada de secretos, sin commits, todo en español. `GameItem` y `LootCosmetics` no se redespliegan.

## 1. Estructura de la app (secciones)

Una sola página, sin scroll de página completa en escritorio: **barra de menú** (lateral en escritorio, inferior tipo app en móvil) y **una sección visible a la vez**, con transición. Rutas por hash para poder enlazar y usar atrás/adelante:

| Ruta | Sección | Contenido |
|---|---|---|
| `#/arena` | ⚔️ Arena | Escena de combate a tamaño completo, acciones, habilidades, pociones, crónica plegable. Indicador "jefe en N". |
| `#/heroe` | 🧝 Héroe | Héroe grande con cosméticos, nivel/XP, stats, ranuras de equipo, **vestuario**. |
| `#/inventario` | 🎒 Inventario | Cartas de colección con filtros (rareza, tipo) y orden; equipar, vender, transferir. |
| `#/mercado` | 🏪 Mercado | Tienda, cofres, venta múltiple, saldo ORO/ETH. |
| `#/misiones` | 📜 Misiones | Recompensa diaria, 3 misiones diarias, misión semanal, **pase de temporada**. |
| `#/logros` | 🏅 Logros | Logros con medallas y títulos; **colección** (bestiario + álbum de objetos y cosméticos). |
| `#/ranking` | 🏆 Ranking | Salón de la fama on-chain. |

Cabecera fija y compacta: logo, saldo ORO/ETH, nivel del héroe, botón de wallet, sonido. **Insignias de aviso** en el menú (punto rojo) cuando hay algo que reclamar (recompensa diaria, misión completada, logro nuevo, botín sin ver).

## 2. Sistemas de enganche

**Diario (volver cada día)**
- **Recompensa diaria on-chain** con racha de días: día 1 → 10 ORO, +5 por día consecutivo hasta 7 (40 ORO) y el **día 7 regala además un cofre cosmético**. Si se rompe la racha, vuelve al día 1. Cuenta atrás visible hasta la siguiente.
- **3 misiones diarias** (iguales para todos ese día, sembradas por la fecha UTC): "gana 3 combates", "usa 4 habilidades", "haz 3 críticos", "vence a un jefe", "vende 1 objeto", "abre un cofre", "consigue una racha de 3"… Dan XP y **puntos de pase**; completar las 3 da un bonus.
- **Desafío diario**: un combate especial sembrado por la fecha (mismo enemigo con modificadores para todos, p. ej. "el enemigo envenena el doble", "sin pociones"). Un intento al día; da puntos de pase y entra en el ranking de desafío.

**Medio plazo**
- **Misión semanal** (p. ej. "vence 3 jefes").
- **Pase de temporada** (temporadas de 4 semanas): 30 niveles con puntos de pase; cada nivel da algo (XP, pociones gratis, títulos, marcos de carta) y los niveles 10/20/30 dan **ORO on-chain** reclamable.
- **Logros** (≥30): primeros pasos, combate (críticos, jefes, rachas), colección (tener 1 de cada tipo, primer legendario), economía (vender, comprar, abrir cofres), constancia (7 días seguidos). Cada logro da una medalla; algunos dan **títulos** que se ven junto al nombre del héroe.
- **Colección**: bestiario (enemigos vencidos, con contador y jefe derrotado), álbum de tipos × rarezas, álbum de cosméticos. Porcentaje de completado.

**Social / competición**
- **Ranking on-chain** (no se puede falsear): más objetos conseguidos, más legendarios, más ORO ganado vendiendo, mayor racha diaria. Top 20 y "tu posición".

## 3. Contratos (equipo `economia-contratos`)

`LootGold` actual solo admite **un** minter (el Mercado). Para pagar recompensas sin pasar por el Mercado:
- **`LootGold` v2**: varios minters (`setMinter(address, bool)`), resto igual. Se redespliega (las pruebas de ORO actuales se pierden; no hay jugadores reales).
- **`Mercado`** se redespliega apuntando al nuevo ORO (mismo código; `LootCosmetics` se reutiliza y su minter pasa al nuevo Mercado).
- **`Recompensas.sol`** (nuevo, minter de ORO y con permiso para acuñar el cofre vía Mercado o con su propio permiso en `LootCosmetics` si se cambia el minter a varios: decide y documenta):
  - `reclamarDiario()`: un reclamo por día UTC; racha por días consecutivos; paga según la tabla de §2; el día 7 da un cofre cosmético (o el cosmético directamente). Eventos `DiarioReclamado(jugador, dia, racha, oro, cosmeticoId)`. Vistas `estadoDiario(jugador) → (racha, ultimoDia, puedeReclamar, segundosHastaSiguiente, proximaRecompensa)`.
  - `recompensar(jugador, cantidad, motivo)` solo `operador` (la wallet del servidor) con **tope diario por jugador** (p. ej. 100 ORO) y tope global diario; evento `Recompensado(jugador, cantidad, motivo)`.
  - Owner ajusta tabla, topes y operador.
- Si `LootCosmetics` también necesita varios minters, **no lo redespliegues**: haz que el cofre del día 7 lo acuñe el Mercado mediante una función `acunarPremio(jugador, id)` solo llamable por `Recompensas`.
- Tests completos y `scripts/deploy-1.2.js` con reutilización por variables `*_EXISTENTE`, nonce explícito y `deployments.json` (`sepolia.oro`, `sepolia.mercado`, `sepolia.recompensas`). No despliega en Sepolia.

## 4. Servidor (equipo `mejora-botin`)

- **`GET /ranking`**: indexa eventos on-chain (`GameItem.ItemMinted`, `Mercado.ItemVendido`, `Recompensas.DiarioReclamado`) desde el bloque de despliegue, en memoria con refresco incremental cada 60 s y paginación de `getLogs` en tramos (el RPC público limita rangos). Devuelve `{ actualizado, categorias: { objetos:[{address, valor}], legendarios:[…], oroVentas:[…], rachaDiaria:[…] } }` top 20. `GET /ranking/:address` → posición en cada categoría.
- **`POST /recompensa`** `{address, motivo}` con `motivo ∈ {"pase10","pase20","pase30","misiones_diarias"}`: llama a `Recompensas.recompensar` con cantidades fijas (100/200/400 y 25), límite por dirección y día, 1 reclamo por motivo y temporada/día (en memoria). Es confianza en el cliente (testnet): documentado y con topes on-chain.
- Las direcciones nuevas llegan por variables de entorno `MERCADO_ADDRESS`, `RECOMPENSAS_ADDRESS`, `DEPLOY_BLOCK`; si faltan, esos endpoints devuelven 503 sin romper `/ganar`.
- Tests sin red (provider simulado).

## 5. Lógica de enganche en la web (equipo `mejora-jugabilidad`)

Módulos puros con `storage` y `ahora`/fecha inyectables, tests `node --test`:
- `web/js/misiones.js`: generación diaria/semanal sembrada por fecha UTC, registro de eventos de juego (`registrar(progreso, evento)` con eventos `victoria`, `jefe`, `critico`, `habilidad`, `venta`, `cofre`, `racha`…), completado y reclamo.
- `web/js/pase.js`: temporadas de 4 semanas desde una fecha fija, 30 niveles, puntos por fuente, recompensas por nivel (cuáles son on-chain → motivo para `/recompensa`).
- `web/js/logros.js`: ≥30 logros con id, nombre, descripción, icono, condición, título opcional; evaluación incremental.
- `web/js/coleccion.js`: bestiario, álbum de objetos (tipo × rareza) y cosméticos; % completado.
- `web/js/desafio.js`: desafío diario sembrado (enemigo + modificadores) usando `combat.js`; un intento al día.
- API documentada con JSDoc + informe con ejemplos de uso desde `main.js`.

## 6. Menú y secciones (equipo `mejora-arte`)

- Reestructura `web/index.html` y `web/css/style.css` en la app por secciones de §1, con `web/js/router.js` (rutas por hash, transición, foco accesible, recuerda la última sección), menú lateral/inferior con iconos e insignias (`marcarAviso(seccion, bool)`).
- Contenedores vacíos con estos IDs (los rellenan otros equipos y `main.js`): `#seccion-arena`, `#seccion-heroe`, `#seccion-inventario`, `#seccion-mercado`, `#seccion-misiones`, `#seccion-logros`, `#seccion-ranking`; dentro de misiones: `#diario`, `#misiones-diarias`, `#mision-semanal`, `#pase`, `#desafio`; dentro de logros: `#logros`, `#coleccion`; en ranking `#ranking`. Mantén todos los IDs actuales que use `main.js` (míralos en `web/js/main.js`).
- Efectos nuevos en `fx.js`: `celebrarLogro(logro)` (toast grande con medalla), `celebrarRecompensa({oro, cosmetico})` (monedas cayendo), `subirNivelPase(nivel)`, y animación de "racha de días" (llamas por día).
- La arena debe caber en una pantalla de portátil (1366×768) sin scroll y verse bien en móvil.

## 7. UI de enganche (equipo `economia-tienda-web`)

Archivos: `web/js/enganche.js`, `web/css/enganche.css`, `web/test/enganche.test.js`, y si quieres `web/enganche-demo.html`.
- Pinta en los contenedores de §6: recompensa diaria (on-chain con `Recompensas`, racha de 7 días con iconos, cuenta atrás), misiones diarias/semanal con barras y botón reclamar, pase de temporada (pista horizontal de 30 niveles), desafío diario, logros (cuadrícula de medallas y títulos), colección (bestiario y álbumes), ranking (pestañas por categoría, tu posición resaltada).
- Usa la lógica pura del equipo de jugabilidad (`misiones.js`, `pase.js`, `logros.js`, `coleccion.js`, `desafio.js`) según la API de §5; si aún no existe, define en tu informe exactamente qué esperas y degrada con elegancia.
- Llama a `GET /ranking` y `POST /recompensa` del servidor y a `Recompensas` (ABI mínimo human-readable según §3; si existe `shared/Recompensas.abi.json`, úsalo).
- API para `main.js`: `montarEnganche({ provider, signer, cuenta, cfg, fx, serverUrl, onAviso(seccion, hay) })`, `registrarEvento(evento)` (la maestra la llama en cada victoria, crítico, venta…), `refrescarEnganche()`.
