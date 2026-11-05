# Loot Arena — Web (Persona C)

Web estática **sin build**: HTML + CSS + módulos ES. ethers v6 se carga desde jsDelivr solo al conectar la wallet, así que el combate funciona en **modo demo** aunque no haya MetaMask ni conexión al CDN.

```
web/
├── index.html
├── css/style.css
├── js/
│   ├── main.js        ← orquestación de la UI
│   ├── combat.js      ← lógica de combate pura (testeada)
│   ├── equipment.js   ← equipo, rarezas y stats (puro, testeado)
│   ├── api.js         ← cliente de POST /ganar (testeado)
│   ├── wallet.js      ← MetaMask: conexión, cambio/alta de red, eventos
│   ├── chain.js       ← lecturas/escrituras del contrato GameItem
│   ├── ui.js, storage.js
├── config/
│   ├── config.js          ← SERVER_URL, NETWORK, redes
│   ├── GameItem.abi.json  ← copiado de /shared
│   └── deployments.json   ← copiado de /shared
├── sync-config.mjs    ← copia ../shared/*.json a config/
└── test/              ← node --test
```

## Configuración

1. Copia el ABI y las direcciones que genera el contrato:
   ```bash
   node web/sync-config.mjs
   ```
   Valida que el ABI tenga `balanceOf`, `tokenOfOwnerByIndex`, `getItem` y `safeTransferFrom`, y que las direcciones sean válidas. Mientras `/shared` no exista, `config/` trae un ABI mínimo escrito a mano y direcciones `0x0` (la web avisa de que el contrato no está desplegado).
2. Edita `web/config/config.js`:
   - `SERVER_URL`: URL del servidor de botín (p. ej. `https://loot-arena-api.onrender.com`). El servidor debe permitir el origen de la web en `ALLOWED_ORIGIN`.
   - `NETWORK`: `"sepolia"` (producción) o `"localhost"` (Hardhat, chainId 31337).
   - En desarrollo puedes forzar la red sin editar nada con `?red=localhost` en la URL.

## Probar en local

```bash
npx serve web
```

Abre la URL que imprime (normalmente http://localhost:3000; si el servidor de botín ya ocupa el 3000, usa `npx serve -l 5173 web`). No abras `index.html` con doble clic: los módulos ES y `fetch` de la configuración necesitan HTTP.

Flujo completo en local:

1. `cd contracts && npx hardhat node` y, en otra terminal, el deploy a `localhost`.
2. `node web/sync-config.mjs`.
3. Arranca el servidor (`server/`, con `RPC_URL=http://127.0.0.1:8545`).
4. Abre `http://localhost:5173/?red=localhost`, importa en MetaMask una cuenta de prueba de Hardhat y conecta. La web ofrece añadir la red «Hardhat Local» si MetaMask no la tiene.

Sin MetaMask la página entra en **modo demo**: puedes explorar y combatir; al ganar se indica que hace falta MetaMask para recibir botín.

### Tests

```bash
cd web
node --test
```

Cubren daño (mínimo 1, variación, Defender dobla la defensa), golpe brutal, victoria/derrota, escalado de enemigos, equipo (1 por tipo, suma de stats, saneado y persistencia) e interpretación de las respuestas del servidor (drop, sin drop, 400, 429, 500, fallo de red).

## Publicar en GitHub Pages

Opción A — workflow (ya existe `.github/workflows/pages.yml` en la raíz): en *Settings → Pages* elige **Source: GitHub Actions** y haz push a `main`. El workflow ejecuta `sync-config.mjs` y publica la carpeta `web/`.

Opción B — manual: ejecuta `node web/sync-config.mjs`, commitea `web/config/*.json` y publica la carpeta `web/` (por ejemplo copiándola a una rama `gh-pages`).

Todas las rutas son relativas, así que funciona bajo `https://usuario.github.io/repo/`. Recuerda poner en `SERVER_URL` la URL pública (HTTPS) del servidor: una página HTTPS no puede llamar a `http://localhost`.

## Publicar en itch.io

1. `node web/sync-config.mjs` y revisa `config/config.js` (`SERVER_URL` público, `NETWORK = "sepolia"`).
2. Comprime el **contenido** de `web/` (que `index.html` quede en la raíz del zip). Puedes excluir `test/`, `package.json` y `sync-config.mjs`:
   ```bash
   cd web && zip -r ../loot-arena-web.zip index.html css js config
   ```
   En Windows (PowerShell):
   ```powershell
   Compress-Archive -Path web\index.html, web\css, web\js, web\config -DestinationPath loot-arena-web.zip
   ```
3. En itch.io: *Create new project → Kind of project: HTML*, sube el zip y marca *This file will be played in the browser*.
4. Añade el origen de itch (`https://html-classic.itch.zone`) a `ALLOWED_ORIGIN` del servidor. Nota: MetaMask funciona dentro del iframe de itch.io en navegadores de escritorio; si da problemas, enlaza también a la versión de GitHub Pages.

## Reglas de juego (SPEC.md §3)

- Héroe base: vida 100, ataque 10, defensa 5; cada objeto equipado suma su ataque y defensa (máx. 1 por tipo). El equipo se guarda en `localStorage` por dirección y red, y solo conserva tokens que sigas poseyendo.
- Daño = `max(1, ataque − defensa) ± 2`, nunca menor que 1. **Defender** dobla tu defensa ese turno (no atacas).
- Explorar genera un enemigo de nivel *arena ±1* (el nivel de arena sube cada 3 victorias, máx. 10). Vida `30+10·nv`, ataque `7+2·nv`, defensa `1+nv`.
- A veces el enemigo carga un **golpe brutal** (×1,75) que anuncia un turno antes: buen momento para Defender.
- Al ganar se llama a `POST {SERVER_URL}/ganar` con `{address, enemyLevel}`.
- Rarezas: Común `#9ca3af`, Raro `#3b82f6`, Legendario `#f59e0b`.
- Transferir usa `safeTransferFrom(from, to, tokenId)` firmado con MetaMask; si el objeto estaba equipado, se desequipa.
