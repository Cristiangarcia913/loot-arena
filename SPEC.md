# Loot Arena — Especificación compartida (contrato entre equipos)

Este documento es la fuente de verdad para las tres partes. Nadie cambia una interfaz de aquí sin actualizar este archivo.

## Estructura de carpetas

```
/SPEC.md            ← este archivo
/contracts/         ← Persona A (Hardhat)
/server/            ← Persona B (Node + Express + ethers v6)
/web/               ← Persona C (HTML + JS estático, ethers v6 por CDN)
/docs/              ← memoria y demo (sesión maestra)
/shared/            ← artefactos compartidos: GameItem.abi.json, deployments.json
```

Cada persona **solo escribe dentro de su carpeta** (A además escribe en `/shared/`).

## 1. Smart contract `GameItem` (Solidity ^0.8.24, OpenZeppelin v5)

- `ERC721("Loot Arena Item", "LOOT")` + `Ownable(msg.sender)` + `ERC721Enumerable` (para que la web liste los tokens de una wallet sin indexador).
- Rareza: `uint8` → `0 = Común`, `1 = Raro`, `2 = Legendario`.
- Tipo: `string` libre, valores usados: `"Espada"`, `"Escudo"`, `"Casco"`, `"Armadura"`, `"Botas"`.

```solidity
struct Item {
    string nombre;
    string tipo;
    uint8  rareza;   // 0..2
    uint16 ataque;
    uint16 defensa;
}

event ItemMinted(address indexed to, uint256 indexed tokenId, string nombre, string tipo, uint8 rareza, uint16 ataque, uint16 defensa);

function mintItem(address to, string calldata nombre, string calldata tipo, uint8 rareza, uint16 ataque, uint16 defensa)
    external onlyOwner returns (uint256 tokenId);   // revierte si rareza > 2
function getItem(uint256 tokenId) external view returns (Item memory); // revierte si no existe
function totalMinted() external view returns (uint256);
// heredadas: balanceOf, ownerOf, tokenOfOwnerByIndex, transferFrom, safeTransferFrom, owner
```

Los tokenId empiezan en 1.

Artefactos que entrega A:
- `/shared/GameItem.abi.json` → array ABI puro (JSON).
- `/shared/deployments.json` → `{ "sepolia": { "address": "0x...", "chainId": 11155111 }, "localhost": { "address": "0x...", "chainId": 31337 } }`.

## 2. Servidor (Persona B)

Variables de entorno (`server/.env`, con `server/.env.example` en el repo):
```
RPC_URL=...            # Sepolia (Alchemy/Infura) o http://127.0.0.1:8545
PRIVATE_KEY=...        # clave del owner del contrato (NUNCA se sube a git)
CONTRACT_ADDRESS=0x...
PORT=3000
ALLOWED_ORIGIN=*       # origen de la web para CORS
```

### `POST /ganar`
Request JSON: `{ "address": "0x...", "enemyLevel": 1 }` (`enemyLevel` entero 1..10, opcional, por defecto 1).

Respuestas:
- `200` con drop: `{ "drop": true, "tokenId": "5", "txHash": "0x...", "item": { "nombre": "Espada Rúnica", "tipo": "Espada", "rareza": 1, "ataque": 12, "defensa": 2 } }`
- `200` sin drop: `{ "drop": false }`
- `400`: `{ "error": "Dirección inválida" }`
- `429`: `{ "error": "Demasiadas peticiones, espera N s" }`
- `500`: `{ "error": "..." }`

Probabilidad de que caiga objeto: 60 % (configurable `DROP_CHANCE`). Si cae, rareza: 70 % Común, 25 % Raro, 5 % Legendario.

Rangos de estadísticas (stat principal según tipo: Espada→ataque; Escudo/Casco/Armadura/Botas→defensa; la secundaria es ~25 % de la principal):

| Rareza | Stat principal |
|---|---|
| Común (0) | 1–5 |
| Raro (1) | 6–12 |
| Legendario (2) | 13–25 |

Límite: máx. 1 petición `/ganar` cada 10 s por dirección y 30 por hora por IP.

### `GET /health` → `{ "ok": true, "contract": "0x...", "chainId": 11155111 }`

## 3. Web (Persona C)

- Lee `/shared/GameItem.abi.json` y `/shared/deployments.json` (copiados a `web/config/` en el build/publicación) y `SERVER_URL` de `web/config/config.js`.
- Red esperada: Sepolia (`chainId 0xaa36a7`); en modo dev permite Hardhat local (`0x7a69`).
- Stats base del jugador: vida 100, ataque 10, defensa 5. Equipo: máx. 1 objeto por tipo; suma ataque/defensa. El equipo equipado se guarda en `localStorage` por dirección (solo tokenIds que siga poseyendo).
- Combate: daño = max(1, ataque_atacante − defensa_objetivo) ± aleatorio pequeño; **Defender** dobla la defensa ese turno.
- Rareza → color: Común `#9ca3af`, Raro `#3b82f6`, Legendario `#f59e0b`.
- Transferir: `safeTransferFrom(from, to, tokenId)` firmado por el jugador con MetaMask.
