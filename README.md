# ⚔️ Loot Arena

Mini-RPG de combate por turnos en el navegador. Cada objeto de equipo que consigues es un **NFT ERC-721 en la red de pruebas Sepolia** y pertenece a tu wallet, no al juego.

| | |
|---|---|
| 🎮 **Jugar en el navegador** | https://cristiangarcia913.github.io/loot-arena/ |
| 🕹️ **itch.io** (jugar o descargar) | https://cristiangarcia913.itch.io/loot-arena |
| ⬇️ **Descargar (Windows / macOS / Linux)** | [Última versión](https://github.com/Cristiangarcia913/loot-arena/releases/latest) |
| 📜 **Contrato (verificado)** | [`0x32B89E29fACa1b1418B5802b6a2C7de71f3AdA2f`](https://sepolia.etherscan.io/address/0x32B89E29fACa1b1418B5802b6a2C7de71f3AdA2f#code) |
| 🖥️ **Servidor de botín** | https://loot-arena-cg913.onrender.com/health |
| 📘 **Memoria** | [docs/MEMORIA.md](docs/MEMORIA.md) · [Guion de la demo](docs/DEMO.md) |

## Cómo jugar

1. Instala [MetaMask](https://metamask.io/) y selecciona la red **Sepolia** (el juego te la propone si no la tienes).
2. Abre el juego y pulsa **Conectar wallet**. Sin MetaMask puedes jugar en *modo demo*, pero no recibirás objetos.
3. Pulsa **Explorar**, lucha con **Atacar** / **Defender** y gana.
4. Si cae botín, el servidor lo mintea en la blockchain y aparece en tu **inventario** (Común 70 %, Raro 25 %, Legendario 5 %).
5. **Equipa** objetos para subir ataque y defensa, o **transfiérelos** a otra wallet (para transferir necesitas un poco de ETH de Sepolia para el gas: [faucet de Google](https://cloud.google.com/application/web3/faucet/ethereum/sepolia)).

> El servidor está en el plan gratuito de Render. Un workflow ([keepalive.yml](.github/workflows/keepalive.yml)) lo visita cada 10 min para que no se duerma, y la web lo despierta al cargar.

## Descargar

En [Releases](https://github.com/Cristiangarcia913/loot-arena/releases/latest) hay un ejecutable para cada sistema. Descomprime y ejecuta **LootArena**: el juego se abre en tu navegador (`http://localhost:7777`). Sigues necesitando MetaMask para conseguir objetos.

- **Windows:** si aparece *“Windows protegió su PC”* (el ejecutable no está firmado) → *Más información* → *Ejecutar de todas formas*.
- **macOS:** clic derecho → *Abrir*. **Linux:** `chmod +x LootArena && ./LootArena`.
- `LootArena-HTML5.zip` es la versión para subir a itch.io o Game Jolt.

Para publicar una nueva versión: `git tag v1.0.1 && git push origin v1.0.1` (lo compila [release.yml](.github/workflows/release.yml)).

## Estructura

| Carpeta | Contenido | Equipo |
|---|---|---|
| [`contracts/`](contracts/) | `GameItem.sol` (ERC-721 + Enumerable + Ownable), tests y scripts de Hardhat | Persona A |
| [`server/`](server/) | Express + ethers v6: `POST /ganar`, sorteo de drops, límite de peticiones | Persona B |
| [`web/`](web/) | Juego HTML/CSS/JS sin build: MetaMask, combate, inventario, transferir | Persona C |
| [`launcher/`](launcher/) | Lanzador descargable (Node SEA con la web embebida) | — |
| [`shared/`](shared/) | ABI y direcciones desplegadas (públicas) | — |
| [`docs/`](docs/) | Memoria y demo | Todos |
| [`SPEC.md`](SPEC.md) | Contrato de interfaces entre los tres equipos | — |

## Desarrollo local

```bash
# Contrato
cd contracts && npm ci && npx hardhat test
# Servidor (copiar .env.example a .env y rellenar)
cd server && npm ci && npm test && npm start
# Web (añade ?red=localhost para usar nodo y servidor locales)
npx http-server web -p 8080
# Lanzador descargable
node launcher/jugar.cjs        # sin empaquetar
node launcher/build.mjs        # genera dist/LootArena(.exe)
```

Tests: contrato 12 ✔ · servidor 34 ✔ · web 30 ✔.

## Seguridad

Este repo es público: ningún secreto se sube (ver [SECURITY.md](SECURITY.md) y [PUBLICAR.md](PUBLICAR.md)). Las claves viven solo en `.env` locales ignorados y en las variables de entorno de Render.
