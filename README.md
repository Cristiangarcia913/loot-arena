# ⚔️ Loot Arena

Mini-RPG táctico de combate 1 contra 1 por turnos que se juega en el navegador, con **render dual 2D / 3D (three.js)**. Cada objeto de equipo que consigues es un **NFT ERC-721 en la red de pruebas Sepolia** y pertenece a tu wallet, no al juego. Véndelo por **ORO** (y algo de ETH de Sepolia) y gasta el ORO en **cosméticos** para personalizar a tu héroe. Sin wallet se juega entero en **modo demo**, guardando el progreso y el botín en el navegador.

| | |
|---|---|
| 🎮 **Jugar en el navegador** | https://cristiangarcia913.github.io/loot-arena/ |
| 🕹️ **itch.io** (jugar o descargar) | https://cristiangarcia913.itch.io/loot-arena |
| ⬇️ **Descargar (Windows / macOS / Linux)** | [Última versión](https://github.com/Cristiangarcia913/loot-arena/releases/latest) |
| 📜 **Contrato de objetos (verificado)** | [`0x32B89E29fACa1b1418B5802b6a2C7de71f3AdA2f`](https://sepolia.etherscan.io/address/0x32B89E29fACa1b1418B5802b6a2C7de71f3AdA2f#code) |
| 🖥️ **Servidor de botín** | https://loot-arena-cg913.onrender.com/health |
| 📘 **Memoria** | [docs/MEMORIA.md](docs/MEMORIA.md) · [Guion de la demo](docs/DEMO.md) |

## Novedades

**En `main` (después de v1.4.1)**
- **Motor 3D renovado:** bruma de combate a ras de suelo, brasas flotantes, antorchas con titileo orgánico, reflejos de metal (entorno PMREM procedural), materiales PBR calibrados, ojos con resplandor en los 20 rivales y relieve en la armadura del héroe.
- **Animación profesional** en 2D y 3D: anticipación, *squash & stretch*, sobreimpulso y asentamiento, caídas con gravedad, tambaleo de muelle al recibir golpes y sacudida de cámara con ruido suave (ver [Animación](#animación)).
- **Efectos de combate:** estelas de tajo que barren la curva, zarpazos de tres garras, chispas al bloquear, salpicaduras en críticos y plano cinematográfico para el ⚡ **Remate Definitivo**.
- **Suite de UX research:** encuesta de satisfacción de 5 segundos que se guarda en un **.csv listo para Excel**, descargable desde el juego, y Medidor Emocional opcional 100 % local (ver [UX research](#ux-research)).
- **Más pulido:** auras de cosmético en 3D en modo demo y con wallet, barras de vida con rastro de daño, compartir hazañas y una dificultad táctica con ataques telegrafiados.

**Versiones anteriores:** 1.4.1 (sección Cadena, cámara y cofre 3D) · 1.4 (arena en 3D, mercado entre jugadores) · 1.3 (grifo de gas, tutorial, expediciones, primer botín garantizado) · 1.2 (secciones con menú, recompensa diaria on-chain, misiones, pase de temporada, logros, ranking) · 1.1 (sprites, sonido, habilidades, estados, jefes con dos fases, tienda y vestuario).

## Cómo jugar

1. Abre el juego y pulsa **Entrar en la arena**. Sin wallet juegas en **modo demo**: el botín y los cosméticos se guardan en este navegador.
2. Para que el botín sea un NFT de verdad, instala [MetaMask](https://metamask.io/) y pulsa **Conectar MetaMask**. El juego te propone la red **Sepolia** si no la tienes, y el servidor te regala un poco de ETH de prueba para el gas si te falta.
3. Pulsa **Explorar** y lucha: **Atacar**, **Defender**, habilidades (**Golpe Poderoso**, **Desangrar**, **Grito de guerra**), **Pociones** y, con la Furia al 100 %, el **⚡ Remate Definitivo**. El cartel sobre el rival te avisa de lo que va a hacer.
4. Cada 5.º combate de un nivel aparece un **jefe**. Si cae botín (Común 70 %, Raro 25 %, Legendario 5 %), el servidor lo mintea y aparece en tu **Inventario**. La primera victoria siempre da un objeto Raro.
5. **Equipa** objetos (los conjuntos de 2 y 4 piezas dan bonos), véndelos en el **Mercado** por ORO, ponlos a la venta para otros jugadores o **transfiérelos** a otra wallet.

Cambia entre **2D y 3D** con el botón 🧊 / 🖼️ de la barra superior. El 3D ajusta su calidad solo según tu equipo, y con *movimiento reducido* activado en el sistema las animaciones se calman.

> El servidor está en el plan gratuito de Render. Un workflow ([keepalive.yml](.github/workflows/keepalive.yml)) lo visita cada 10 min para que no se duerma, y la web lo despierta al cargar.

## Qué hay en el juego

| Sección | Qué ofrece |
|---|---|
| ⚔️ **Arena** | Combate táctico por turnos contra 20 criaturas y jefes con dos fases, estados (veneno, sangrado, aturdido, escudo, furia…) y modificadores de arena por racha. |
| 🧝 **Héroe** | Niveles, estadísticas, equipo y vestuario de cosméticos (tintes, sombreros, capas, auras, mascotas). |
| 🎒 **Inventario** | Tus NFT (o el botín local en modo demo), conjuntos y transferencias. |
| 🏪 **Mercado** | Venta por ORO, tienda rotativa con oferta del día, cofres y mercado entre jugadores. |
| 📜 **Misiones / 🏅 Logros** | Misiones diarias y semanales, desafío diario, pase de temporada, recompensa diaria on-chain con racha, logros con títulos y colección. |
| 🧭 **Expediciones** | Manda al héroe de viaje (15 min a 8 h) y recoge XP, pociones y botín al volver. |
| 🏆 **Ranking / 🔗 Cadena** | Ranking on-chain de jugadores y un explorador de tus transacciones y contratos. |

## Motor 3D

Todo el 3D se construye por código (sin herramientas de build) en [`web/js/render3d/`](web/js/render3d/). three.js llega desde CDN y entra **por parámetro** en cada módulo, así que la lógica se prueba en Node con un doble de three.js.

| Módulo | Responsabilidad |
|---|---|
| `escena3d.js` | Montaje, bucle de dibujo, API de combate (ataque, golpe, defensa, muerte, victoria, cofre) y motor de tweens. |
| `escenario.js` | Coliseo: suelo, muro, antorchas, runas de jefe, polvo, brasas, bruma y niebla. |
| `criaturas.js` · `piezas.js` | Héroe y 20 rivales a partir de piezas, con acabados PBR con nombre (`metal`, `hueso`, `roca`, `piel`). |
| `modelos.js` | Carga opcional de modelos `.glb` (dragón, esqueleto, limo, lobo, murciélago), con orientación, altura y ojos calibrados por modelo. |
| `curvas.js` | Curvas de animación puras (ver abajo). |
| `camara.js` | Director de cámara: planos por evento (crítico, remate, muerte, botín…) que nunca dejan a un luchador fuera de cuadro. |
| `ataques.js` · `cofre.js` · `numeros.js` | Gestos de ataque por criatura, apertura de cofres por rareza y números de daño flotantes. |
| `rendimiento.js` | Perfiles de calidad (alto, medio, bajo) que bajan solos si caen los FPS. |

### Animación

Las animaciones siguen los principios clásicos de animación, con curvas reutilizables de `curvas.js`:

- **Anticipación:** antes de golpear, el luchador se echa atrás y se aplasta. Al saltar a la victoria, primero se agacha.
- **Squash & stretch con volumen constante:** respiración en reposo, estiramiento al lanzarse y aplastamiento en el contacto y al aterrizar.
- **Sobreimpulso y asentamiento:** el retorno de un ataque, una esquiva o unos brazos alzados se pasan un poco de su sitio y vuelven (*follow-through*).
- **Muelle amortiguado:** al recibir un golpe el cuerpo se tambalea y se calma, en vez de volver en línea recta. Un crítico tambalea más.
- **Gravedad:** las caídas aceleran (*ease-in*) y botan contra el suelo con polvo y sacudida.
- **Movimiento orgánico:** cambio de peso, mirada y sacudida de cámara con ruido suave continuo, no con valores aleatorios fotograma a fotograma.
- **Coreografías por tiempos:** entrada (salto, aterrizaje y asentamiento), muerte (tambaleo, desplome, impacto y disolución), victoria (impulso, salto, pose y vuelta) y cofre con temblor de suspense *in crescendo*.

Todo respeta `prefers-reduced-motion`, y la calidad baja reduce partículas y efectos.

## UX research

- **Encuesta de satisfacción:** al terminar una sesión o pulsar *📊 Evaluar Juego* aparece un modal con 1 a 5 estrellas, etiquetas rápidas (🔥 Muy Adictivo, ⚔️ Combate Táctico, 🐉 Jefes Épicos, 📈 Justo y Desafiante) y un comentario opcional.
- **Excel automático:** `POST /api/satisfaccion` añade cada respuesta a `server/data/satisfaccion_jugadores.csv` (UTF-8 con BOM, separador `;`, CRLF; se abre con doble clic en Excel) con las columnas `Fecha;Jugador;Nivel;RachaMax;Estrellas;EmocionDominante;TensionMedia;TiempoJuegoMin;Comentario;Tags`. `GET /api/satisfaccion/descargar` lo descarga.
- **Botón 📥 Descargar Datos de Satisfacción (Excel)** en la sección Héroe. Sin servidor (modo local o demo), genera el mismo `.csv` con las respuestas guardadas en el navegador.
- **Medidor Emocional (opcional, botón 📷):** con tu permiso analiza tu expresión con face-api.js **en tu navegador**. Solo toma 3 fotogramas sueltos en momentos clave (victoria, cofre, derrota), nunca vídeo continuo, y nunca guarda ni envía ninguna foto. A la encuesta solo llegan la emoción dominante y la tensión media.

## Descargar

En [Releases](https://github.com/Cristiangarcia913/loot-arena/releases/latest) hay un ejecutable para cada sistema. Descomprime y ejecuta **LootArena**: el juego se abre en tu navegador (`http://localhost:7777`).

- **Windows:** si aparece *«Windows protegió su PC»* (el ejecutable no está firmado) → *Más información* → *Ejecutar de todas formas*.
- **macOS:** clic derecho → *Abrir*. **Linux:** `chmod +x LootArena && ./LootArena`.
- `LootArena-HTML5.zip` es la versión para subir a itch.io o Game Jolt.

Para publicar una nueva versión: `git tag v1.5.0 && git push origin v1.5.0` (lo compila [release.yml](.github/workflows/release.yml)).

## Estructura

| Carpeta | Contenido |
|---|---|
| [`contracts/`](contracts/) | Solidity + Hardhat: `GameItem` (ERC-721 de equipo), `LootGold` (ERC-20 ORO), `LootCosmetics` (ERC-1155), `Mercado`, `MercadoP2P` y `Recompensas`, con sus tests y scripts. |
| [`server/`](server/) | Express + ethers v6: botín (`/ganar`), grifo de gas (`/gas`), recompensa diaria, ranking, tesorería, torre y satisfacción (`/api/satisfaccion`), con límites de peticiones. |
| [`web/`](web/) | Juego HTML/CSS/JS con ES modules y sin build: combate, render 2D y 3D, wallet, economía, misiones, UX research. |
| [`launcher/`](launcher/) | Lanzador descargable (Node SEA con la web embebida). |
| [`shared/`](shared/) | ABI y direcciones desplegadas (públicas). |
| [`docs/`](docs/) | Memoria y guion de la demo. |
| [`SPEC.md`](SPEC.md) | Contrato de interfaces entre contrato, servidor y web. |

## Desarrollo local

```bash
# Contratos
cd contracts && npm ci && npx hardhat test
# Servidor (copiar .env.example a .env y rellenar)
cd server && npm ci && npm test && npm start
# Web: tests unitarios y simulación con 4 arquetipos de jugador
cd web && npm test && npm run test:agentes
# Web: servirla (añade ?red=localhost para usar nodo y servidor locales)
npx http-server web -p 8080
# Lanzador descargable
node launcher/jugar.cjs        # sin empaquetar
node launcher/build.mjs        # genera dist/LootArena(.exe)
```

Tests: contratos 130 ✔ · servidor 352 ✔ · web 604 ✔ · simulación multiagente sin errores.

## Seguridad

Este repo es público: ningún secreto se sube (ver [SECURITY.md](SECURITY.md) y [PUBLICAR.md](PUBLICAR.md)). Las claves viven solo en `.env` locales ignorados y en las variables de entorno de Render. Un hook de *pre-commit* revisa los secretos con gitleaks.
