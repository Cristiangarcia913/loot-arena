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
