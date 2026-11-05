# Guion de la demo (≈ 6 min)

## Antes de empezar (5 min antes)
- Abrir https://loot-arena-cg913.onrender.com/health para despertar el servidor (Render free).
- Dos perfiles de navegador con MetaMask en Sepolia: **Wallet 1** (jugador) y **Wallet 2** (receptor). Wallet 1 con algo de ETH de Sepolia para la transferencia.
- Pestañas abiertas: el juego, el contrato en Etherscan y este guion.

## Desarrollo

| Min | Quién | Qué se muestra |
|---|---|---|
| 0:00 | Todos | Idea: RPG por turnos donde el botín es un NFT del jugador, no del juego. |
| 0:45 | C | Conectar MetaMask; el juego detecta/cambia a Sepolia. Stats base 100/10/5. |
| 1:30 | C | Explorar → combate: Atacar, Defender (dobla defensa), barras de vida y crónica. |
| 2:30 | B | Victoria → `POST /ganar` → drop. Explicar probabilidades (60 % drop; 70/25/5) y el límite de peticiones. Abrir la tx en Etherscan. |
| 3:30 | C | Inventario con colores por rareza; Equipar → suben ataque/defensa. |
| 4:15 | A | Etherscan: código verificado, `getItem(tokenId)` en *Read Contract*, `mintItem` es `onlyOwner` (anti-trampas). |
| 5:00 | C | Transferir el objeto a Wallet 2, confirmar en MetaMask; aparece en el inventario de Wallet 2. |
| 5:45 | Todos | Cierre: propiedad real, escasez verificable, anti-trampas, transferencia libre. Preguntas. |

## Plan B
- Si Render tarda: seguir con el combate en modo demo y enseñar un drop ya existente en Etherscan (token #1).
- Si falla la red: mostrar los tests (`npx hardhat test`, `npm test`) en local.
