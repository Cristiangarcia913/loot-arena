# Loot Arena 1.3 — Que la gente juegue y se quede

Objetivo del usuario: que el juego enganche más y la gente vuelva. Principios:
- **Cero fricción:** nadie debe quedarse bloqueado por no tener ETH de prueba.
- **Primer minuto memorable:** en 60 segundos el jugador gana, consigue un objeto y entiende el juego.
- **Motivos para volver** sin trampas de dinero: todo es gratis y de red de pruebas; nada de pagar para ganar.

Reglas de equipo (como siempre): sin comunicación entre subsesiones, cada una toca solo sus archivos, sin commits, sin secretos, sin dependencias nuevas en la web, todo en español. `main.js`, `index.html` y `router.js` los integra la sesión maestra: cada módulo web exporta funciones que pintan dentro de un contenedor que se le pasa.

## 1. Servidor (`server/`)
- **Grifo de gas** `POST /gas {address}`: si la wallet del jugador tiene menos de 0,0003 ETH de Sepolia, el servidor le envía 0,0005 ETH desde su wallet. Máximo 1 vez por dirección y día UTC, tope global diario configurable (`GAS_TOPE_DIARIO`, por defecto 0,01 ETH), y no envía si la wallet del servidor baja de 0,002 ETH. Respuestas: 200 `{ok, enviado, txHash}`, 200 `{ok, enviado:0, motivo:"ya tienes gas"}`, 409 ya pedido hoy, 503 sin fondos en el servidor. `GET /gas/:address` → `{saldo, puedePedir, proximoEn}`.
- **Primer botín garantizado:** la primera victoria de una dirección (`POST /ganar`) siempre suelta un objeto Raro (registro en memoria; documenta que se pierde al reiniciar).
- **Torre:** `POST /torre {address, piso, turnos}` guarda el mejor piso por dirección (en memoria, validando que el piso sube de uno en uno respecto al récord + 1 como máximo) y `GET /torre/ranking` devuelve el top 20. Confianza en el cliente (red de pruebas), documentada.

## 2. Gas en la web (`web/js/gas.js`)
- `asegurarGas({provider, cuenta, serverUrl})`: antes de cualquier transacción del jugador (vender, comprar, cofre, transferir), si el saldo es bajo pide `POST /gas` y espera a que llegue (lectura con reintentos). Devuelve `{ok, mensaje}`.
- Lo usa `tienda.js` en su flujo de venta/compra/cofre y `main.js` en transferir. El aviso "Necesitas ETH de Sepolia" solo debe salir si el grifo también falla.

## 3. Tutorial y primer minuto (`web/js/tutorial.js`, `web/css/tutorial.css`)
- Guía de 5 pasos con resaltado (foco en el botón, flecha, texto corto): Explorar → Atacar → usar una habilidad → ver el botín → equiparlo. Se activa la primera vez (guardado en `localStorage`), se puede saltar y repetir desde un botón de ayuda.
- El primer combate es contra un enemigo fácil fijo (lo decide `main.js` usando una función exportada `combateTutorial()`).
- API: `iniciarTutorial({fx, alPaso})`, `avanzarTutorial(evento)` (eventos: `explorar`, `ataque`, `habilidad`, `botin`, `equipar`), `tutorialActivo()`, `reiniciarTutorial()`.

## 4. Expediciones (`web/js/expediciones.js`, `web/css/expediciones.css`)
- El héroe puede ir de expedición mientras el jugador no está: 15 min, 1 h, 4 h u 8 h. Al volver da XP, pociones y una probabilidad de botín (que se reclama con `POST /ganar` normal al recogerla, con nivel según la duración). Una expedición a la vez. Cuenta atrás visible y aviso en el menú cuando está lista.
- Lógica pura con reloj y storage inyectables y tests. UI: `renderExpediciones(contenedor, {estado, onEnviar, onRecoger})`.

## 5. Torre infinita (`web/js/torre.js`, `web/css/torre.css`)
- Modo de pisos: cada piso es un combate algo más duro; entre pisos se conserva la vida (con una pequeña curación). Al caer, se registra el piso alcanzado (`POST /torre`). Récord personal, recompensa de XP por piso y botín cada 5 pisos (vía `/ganar` con `jefe:true`).
- Usa `combat.js` (no lo modifiques). Lógica pura testeada + UI `renderTorre(contenedor, {estado, ranking, onEmpezar, onSiguientePiso})`.

## 6. Integración (sesión maestra)
- Secciones nuevas en el menú: **Expediciones** y **Torre**. Llamadas a `asegurarGas` antes de cada transacción. Tutorial en el primer arranque. Desplegar servidor, publicar y actualizar itch.io.
