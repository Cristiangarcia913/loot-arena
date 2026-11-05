# Loot Arena — Contrato `GameItem`

Contrato ERC-721 de los objetos de equipo de Loot Arena (Persona A). Interfaz descrita en `../SPEC.md` §1.

- Solidity `^0.8.24` (compilado con 0.8.28, `evmVersion: cancun`), OpenZeppelin Contracts v5.
- `ERC721("Loot Arena Item", "LOOT")` + `ERC721Enumerable` + `Ownable`.
- Solo el owner (la cuenta que despliega, que usará el servidor) puede llamar a `mintItem`.
- Los tokenId empiezan en 1.

## Estructura

```
contracts/
├── contracts/GameItem.sol     ← el contrato
├── test/GameItem.test.js      ← tests (mocha + chai)
├── scripts/deploy.js          ← despliega y actualiza ../shared/
├── scripts/mint-demo.js       ← mintea un objeto de prueba
├── hardhat.config.js          ← redes hardhat, localhost y sepolia
└── .env.example               ← plantilla de variables de entorno
```

Artefactos que genera `deploy.js` (los consumen el servidor y la web):

- `../shared/GameItem.abi.json` — array ABI puro.
- `../shared/deployments.json` — `{ "<red>": { "address": "0x...", "chainId": N } }`. Cada despliegue actualiza solo la clave de su red.

## Instalación y tests

Requiere Node.js 18 o superior.

```bash
cd contracts
npm install
npx hardhat compile
npx hardhat test
```

## Desarrollo en local (red Hardhat, chainId 31337)

En una terminal, arranca el nodo (déjalo abierto):

```bash
npx hardhat node
```

En otra terminal, despliega y (opcional) mintea un objeto de prueba:

```bash
npx hardhat run scripts/deploy.js --network localhost
npx hardhat run scripts/mint-demo.js --network localhost
```

Notas:

- El nodo local se reinicia vacío cada vez: vuelve a ejecutar `deploy.js` tras arrancarlo. Si el despliegue es la primera transacción, la dirección siempre es `0x5FbDB2315678afecb367f032d93F642f64180aa3`.
- La cuenta owner en local es la cuenta #0 que imprime `npx hardhat node` (`0xf39F...2266`). Su clave privada es pública y conocida: úsala solo en local (por ejemplo en `server/.env` con `RPC_URL=http://127.0.0.1:8545`).
- Para mintear a otra dirección: en PowerShell `$env:TO="0x..."; npx hardhat run scripts/mint-demo.js --network localhost` (en bash: `TO=0x... npx hardhat run ...`). También acepta `NOMBRE`, `TIPO`, `RAREZA`, `ATAQUE` y `DEFENSA`.

## Despliegue en Sepolia (chainId 11155111)

### 1. Crea una wallet de pruebas

Crea una cuenta nueva en MetaMask que uses **solo** para este proyecto. Esa cuenta será el owner del contrato, y su clave privada la usará también el servidor para mintear.

Para exportar la clave privada en MetaMask: menú de la cuenta → *Detalles de la cuenta* → *Mostrar clave privada*.

### 2. Consigue ETH de Sepolia (faucets)

Con 0,05 SepoliaETH tienes de sobra para desplegar y mintear muchas veces. Faucets (algunos piden tener algo de ETH en mainnet o iniciar sesión):

- Google Cloud Web3 Faucet: https://cloud.google.com/application/web3/faucet/ethereum/sepolia
- Alchemy: https://www.alchemy.com/faucets/ethereum-sepolia
- Infura / MetaMask: https://www.infura.io/faucet/sepolia
- PoW faucet (minado en el navegador, sin requisitos): https://sepolia-faucet.pk910.de/

Comprueba el saldo en https://sepolia.etherscan.io/ buscando tu dirección.

### 3. Consigue una URL RPC y una API key de Etherscan

- **RPC**: crea una app gratuita en [Alchemy](https://dashboard.alchemy.com/) o [Infura](https://app.infura.io/) y copia la URL HTTPS de Sepolia (por ejemplo `https://eth-sepolia.g.alchemy.com/v2/<clave>`). Si no rellenas `SEPOLIA_RPC_URL`, la configuración usa el RPC público `https://ethereum-sepolia-rpc.publicnode.com` (vale para pruebas, pero puede ser lento).
- **Etherscan**: crea una cuenta en https://etherscan.io/ y genera una API key en https://etherscan.io/myapikey (la misma clave vale para Sepolia).

### 4. Rellena `.env`

```bash
cp .env.example .env
```

(En PowerShell: `Copy-Item .env.example .env`.) Edita `contracts/.env`:

```
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/TU_API_KEY
PRIVATE_KEY=0xTU_CLAVE_PRIVADA
ETHERSCAN_API_KEY=TU_API_KEY_DE_ETHERSCAN
```

`.env` está en `.gitignore`: **no lo subas nunca a git**. Si faltan variables, compilar y testear siguen funcionando; solo falla el despliegue en Sepolia (sin cuenta).

### 5. Despliega

```bash
npx hardhat run scripts/deploy.js --network sepolia
```

El script imprime la dirección del contrato y añade la entrada `sepolia` a `../shared/deployments.json` (la entrada `localhost` se conserva). Copia la dirección en `server/.env` (`CONTRACT_ADDRESS`).

### 6. Verifica el contrato en Etherscan

Espera un minuto a que Etherscan indexe el contrato y ejecuta (el constructor no tiene argumentos):

```bash
npx hardhat verify --network sepolia <address>
```

Después, en `https://sepolia.etherscan.io/address/<address>#code` aparecerá el código verificado y las pestañas *Read/Write Contract*.

### 7. (Opcional) Mintea un objeto de prueba

```bash
npx hardhat run scripts/mint-demo.js --network sepolia
```

## Referencia rápida del contrato

| Función | Quién | Descripción |
|---|---|---|
| `mintItem(to, nombre, tipo, rareza, ataque, defensa)` | owner | Mintea un objeto; devuelve el `tokenId` y emite `ItemMinted`. Revierte con `RarezaInvalida(rareza)` si `rareza > 2`. |
| `getItem(tokenId)` | cualquiera | Devuelve `Item { nombre, tipo, rareza, ataque, defensa }`. Revierte con `ERC721NonexistentToken` si no existe. |
| `totalMinted()` | cualquiera | Número de objetos minteados. |
| `balanceOf`, `ownerOf`, `tokenOfOwnerByIndex`, `totalSupply` | cualquiera | Heredadas (ERC721 / Enumerable). |
| `transferFrom`, `safeTransferFrom` | dueño del token | Transferencia entre jugadores. |

Rareza: `0` Común, `1` Raro, `2` Legendario.

Para leer el `tokenId` minteado desde el servidor, lo más fiable es parsear el evento `ItemMinted` del recibo de la transacción (ver `scripts/mint-demo.js`).

---

## Economía: ORO, cosméticos y Mercado

Diseño completo en `../MEJORAS.md` §5. `GameItem` **no cambia**: se añaden tres contratos que lo leen.

| Contrato | Qué es |
|---|---|
| `LootGold.sol` | ERC-20 **"Oro de Loot Arena" (ORO)**, 18 decimales, `burn`/`burnFrom`. Desde la 1.2 admite **varios minters** (`setMinter(cuenta, activo)` del owner, consulta con `esMinter(cuenta)`): Mercado y Recompensas. Solo un minter puede acuñar (`mint`) y quemar ORO del comprador sin `approve` (`quemarDe`). |
| `LootCosmetics.sol` | ERC-1155 de cosméticos (ids 1..14 del catálogo). Solo el `minter` (= Mercado) acuña. Los jugadores pueden quemar los suyos (`burn`, p. ej. la poción extra id 14). `uri(id)` = `baseURI + id + ".json"` → `web/meta/cosmeticos/{id}.json`. |
| `Mercado.sol` | Vende objetos por ORO (+ un poco de ETH de su caja), vende cosméticos, abre cofres y da la bienvenida. `Ownable` + `ReentrancyGuard`. |

Todas las cantidades on-chain van en **unidades base** (ORO y ETH con 18 decimales): `precioVenta(t)` devuelve `54000000000000000000` para 54 ORO; usa `ethers.formatEther` para mostrarlo.

### Reglas del Mercado

- **Vender** (`venderItem(tokenId)` / `venderVarios(uint256[])`): requiere ser el dueño y haber hecho `GameItem.setApprovalForAll(mercado, true)`. El NFT va a `0x000000000000000000000000000000000000dEaD` y se acuñan `base[rareza] + 2 × (ataque + defensa)` ORO, con `base = [10, 40, 200]` (ajustable con `setFormulaVenta`).
- **ETH de la caja**: cada venta paga además `recompensaEth[rareza]` = `[0.0001, 0.0005, 0.002]` ETH, recortado a lo que quede de `maxEthDiario` (0.005 ETH por dirección y día UTC, `block.timestamp / 1 days`). Si la caja no tiene saldo para esa recompensa, se paga 0 ETH y la venta sigue (solo ORO). Cualquiera recarga la caja enviando ETH al Mercado (`receive`); solo el owner retira (`retirarEth`). Si la wallet receptora rechaza el ETH, la venta revierte.
- **Comprar** (`comprarCosmetico(id, cantidad)`): quema `precio × cantidad` ORO y acuña el cosmético. Una sola transacción, sin `approve`.
- **Cofre** (`abrirCofre()`): quema `PRECIO_COFRE` (120 ORO) y acuña un cosmético al azar: común 60 %, rara 32 %, legendaria 8 %, uniforme dentro de la rareza; nunca consumibles (`enCofre = false`). **Azar**: `keccak256(block.prevrandao, block.timestamp, msg.sender, nonce)`. Es predecible por validadores y por contratos que simulen antes de llamar: aceptable en Sepolia para un juego sin valor real, no en mainnet (usar Chainlink VRF o commit-reveal).
- **Bienvenida** (`reclamarBienvenida()`): 50 ORO una vez por dirección (`bienvenidaReclamada(addr)`).
- **Owner**: `agregarCosmetico`, `setPrecioCosmetico` (0 = retirar de la venta), `setEnCofre`, `setFormulaVenta`, `setPrecioCofre`, `setRecompensaEth`, `setMaxEthDiario`, `retirarEth`.
- **Vistas**: `catalogo()` (array; el elemento i es el id i+1), `cosmetico(id)`, `totalCosmeticos()`, `precioVenta(tokenId)`, `ethPorVenta(jugador, rareza)`, `ethRestanteHoy(jugador)`, `cajaEth()`.

### Tests

`npx hardhat test` ejecuta `test/GameItem.test.js` y `test/economia.test.js` (venta y precio, objetos ajenos, sin aprobación, permisos de acuñación, compra y saldo insuficiente, cofre, bienvenida, administración, caja de ETH y límite diario, reentrada con `contracts/test/AtacanteReentrada.sol` —solo para tests— y un caso de extremo a extremo).

### Despliegue en local

```bash
npx hardhat node
```

En otra terminal (el GameItem va primero, porque `deploy.js` reescribe la entrada `localhost`):

```bash
npx hardhat run scripts/deploy.js --network localhost
npx hardhat run scripts/deploy-economia.js --network localhost
```

`deploy-economia.js` lee la dirección de GameItem de `../shared/deployments.json[red].address`, despliega los tres contratos, hace `setMinter(mercado, true)` en ORO y `setMinter(mercado)` en cosméticos, recarga la caja (1 ETH en local por defecto) y escribe `oro`, `cosmeticos` y `mercado` en la entrada de la red, más `../shared/{LootGold,LootCosmetics,Mercado}.abi.json`. Variables opcionales: `CAJA_ETH` (ETH para la caja; 0 por defecto fuera de local) y `COSMETICOS_URI` (prefijo de los metadatos).

### Despliegue en Sepolia y verificación en Etherscan

Con `contracts/.env` configurado como en los pasos de arriba y la entrada `sepolia` de GameItem ya en `deployments.json`:

```bash
npx hardhat run scripts/deploy-economia.js --network sepolia
```

(En PowerShell, para recargar la caja al desplegar: `$env:CAJA_ETH="0.05"; npx hardhat run scripts/deploy-economia.js --network sepolia`. También se puede recargar después enviando ETH desde MetaMask a la dirección del Mercado.)

Coste aproximado: ~6,4 M de gas en total (Mercado ~4,0 M, LootCosmetics ~1,56 M, LootGold ~0,70 M, dos `setMinter` ~48 k cada uno).

El script imprime los comandos de verificación; espera ~1 min y ejecútalos:

```bash
npx hardhat verify --network sepolia <oro>
npx hardhat verify --network sepolia <cosmeticos> "https://cristiangarcia913.github.io/loot-arena/meta/cosmeticos/"
npx hardhat verify --network sepolia <mercado> <gameItem> <oro> <cosmeticos>
```

Gas por operación del jugador (medido en local): `setApprovalForAll` ~46 k (una vez), `venderItem` ~140–205 k, `venderVarios` de 3 ~265 k, `comprarCosmetico` ~81 k, `abrirCofre` ~176 k, `reclamarBienvenida` ~65 k.

---

## Loot Arena 1.2: recompensas diarias y premios del servidor

Diseño en `../MEJORAS-1.2.md` §2–§3. `GameItem` y `LootCosmetics` **no se redespliegan**; se redespliegan `LootGold` (v2, varios minters) y `Mercado` (mismo comportamiento, apuntando al ORO nuevo), y se añade `Recompensas.sol`. El ORO de la 1.1 queda abandonado (no había jugadores reales).

### `Recompensas.sol`

- **`reclamarDiario()`** → `(racha, oro, cosmeticoId)`: un reclamo por **día UTC** (`block.timestamp / 1 days`; cambia a las 00:00 UTC, no 24 h después). La racha sube si el reclamo anterior fue el día anterior; si no, vuelve a 1. ORO por día del ciclo: 10, 15, 20, 25, 30, 35, 40 (`tablaDiaria`, índice 0 = día 1). El día 7 regala además **un cofre cosmético gratis** (misma tirada 60/32/8 que `abrirCofre`, nunca consumibles). Tras el día 7 el ciclo vuelve al día 1, pero `racha` sigue contando (8, 9…) para el ranking de mayor racha. Evento `DiarioReclamado(jugador, dia, racha, oro, cosmeticoId)` (`cosmeticoId = 0` si no hubo cosmético).
- **`estadoDiario(jugador)`** → `(racha, ultimoDia, puedeReclamar, segundosHastaSiguiente, proximaRecompensa)`: `racha` es la vigente (0 si nunca reclamó o si ya se rompió), `ultimoDia` en días UTC, `segundosHastaSiguiente` = 0 si puede reclamar o los segundos hasta las 00:00 UTC, `proximaRecompensa` = ORO del próximo reclamo. **`proximoDiaCiclo(jugador)`** → 1..7 (7 = el próximo reclamo trae cofre).
- **`recompensar(jugador, cantidad, motivo)`**: solo `operador` (la wallet del servidor). Topes diarios: **500 ORO por jugador** y **5 000 ORO en total** (`setTopes`); si se supera revierte con `TopeJugadorSuperado(restante, pedido)` o `TopeGlobalSuperado(restante, pedido)`. Evento `Recompensado(jugador, cantidad, motivo)`. Vista `restanteHoy(jugador)` → `(jugadorRestante, globalRestante)`.
- **Owner**: `setOperador`, `setTablaDiaria(uint256[7])`, `setPremioDia7(activo, id)` (id 0 = cofre aleatorio; otro = ese cosmético), `setTopes(porJugador, global)`.
- Protegido con `ReentrancyGuard`; actualiza el estado antes de acuñar.

### Cómo se acuña el cofre del día 7

`LootCosmetics` solo tiene un minter (el Mercado) y no se redespliega, así que **Recompensas pide el premio al Mercado**: `Mercado.acunarPremio(jugador, id)` (solo lo puede llamar la dirección fijada con `Mercado.setRecompensas`). Con `id = 0` hace una tirada de cofre gratis; con otro id acuña ese cosmético. Emite `PremioAcunado(jugador, id, cofre)`.

### Despliegue (`scripts/deploy-1.2.js`)

Necesita en `../shared/deployments.json[red]` el GameItem (`address`) y el LootCosmetics (`cosmeticos`), y que la cuenta que despliega sea owner de LootCosmetics (para pasar su minter al Mercado nuevo). Orden de transacciones:

1. `deploy LootGold` (v2)
2. `deploy Mercado(gameItem, oro, cosmeticos)`
3. `deploy Recompensas(oro, mercado, operador)`
4. `LootGold.setMinter(mercado, true)`
5. `LootGold.setMinter(recompensas, true)`
6. `LootCosmetics.setMinter(mercado)` (el Mercado viejo deja de poder acuñar cosméticos)
7. `Mercado.setRecompensas(recompensas)`
8. (opcional) recargar la caja de ETH del Mercado nuevo (`CAJA_ETH`)

Es idempotente: con `LOOTGOLD_EXISTENTE`, `MERCADO_EXISTENTE` o `RECOMPENSAS_EXISTENTE` reutiliza lo ya desplegado (si un despliegue se cortó a medias) y solo envía las transacciones de permisos que falten. Usa nonce explícito. `OPERADOR` = wallet del servidor (por defecto, la cuenta que despliega). Escribe `oro`, `mercado`, `recompensas` y `bloqueDespliegue` (bloque del primer contrato nuevo, para `DEPLOY_BLOCK` del servidor) en la entrada de la red, y `../shared/{LootGold,Mercado,Recompensas}.abi.json`.

En local (con el nodo arrancado y tras `deploy.js` y `deploy-economia.js`):

```bash
npx hardhat run scripts/deploy-1.2.js --network localhost
```

En Sepolia (PowerShell; pon la dirección de la wallet del servidor):

```powershell
$env:OPERADOR="0xWALLET_DEL_SERVIDOR"; $env:CAJA_ETH="0.02"; npx hardhat run scripts/deploy-1.2.js --network sepolia
```

Verificación (el script imprime los comandos con las direcciones reales):

```bash
npx hardhat verify --network sepolia <oro>
npx hardhat verify --network sepolia <mercado> <gameItem> <oro> <cosmeticos>
npx hardhat verify --network sepolia <recompensas> <oro> <mercado> <operador>
```

Coste aproximado (medido en local): unos 6,3 M de gas en total (LootGold ~0,72 M, Mercado ~4,12 M, Recompensas ~1,30 M y unos 30–48 k por cada transacción de permisos). Operaciones: `reclamarDiario` ~103 k el primer día y ~53 k los siguientes, ~194 k el día 7 (con cofre); `recompensar` ~97 k la primera vez del día para un jugador y ~63 k después.

Recuerda recargar la caja de ETH del **Mercado nuevo** (la del viejo se puede recuperar con `retirarEth` desde el owner).
