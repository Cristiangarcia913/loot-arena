# Loot Arena — Servidor (Persona B)

Servidor Node (Express + ethers v6) que decide los **drops** al ganar un combate y, si cae objeto,
lo acuña como NFT llamando a `mintItem` del contrato `GameItem` con la wallet *owner*.
Las interfaces siguen `../SPEC.md` §2.

## Requisitos

- Node **18.17+** (probado con Node 20 y 24).
- Un RPC de Sepolia (Alchemy o Infura, gratis) o un nodo local de Hardhat.
- La clave privada del **owner** del contrato, con algo de SepoliaETH para el gas.

## Puesta en marcha local

```bash
cd server
npm install
cp .env.example .env      # y rellénalo
npm run sync-abi          # copia ../shared/GameItem.abi.json → abi/
npm test                  # tests sin red
npm start
```

### Variables de entorno

| Variable | Obligatoria | Descripción |
|---|---|---|
| `RPC_URL` | sí | `https://eth-sepolia.g.alchemy.com/v2/<key>`, `https://sepolia.infura.io/v3/<key>` o `http://127.0.0.1:8545` |
| `PRIVATE_KEY` | sí | Clave del owner del contrato (64 hex, con o sin `0x`). **Nunca a git.** |
| `CONTRACT_ADDRESS` | sí | Dirección de `GameItem` (ver `../shared/deployments.json`) |
| `PORT` | no (3000) | Puerto HTTP. Render/Railway lo inyectan solos. |
| `ALLOWED_ORIGIN` | no (`*`) | Origen de la web para CORS. Admite varios separados por comas. |
| `DROP_CHANCE` | no (0.6) | Probabilidad de drop por victoria, de 0 a 1. |
| `TRUST_PROXY` | no (1) | Nº de proxies delante (Render/Railway = 1) para leer la IP real del cliente. En local da igual. |
| `MERCADO_ADDRESS` | no¹ | Dirección del `Mercado` de la 1.2 (`shared/deployments.json` → `sepolia.mercado`). |
| `RECOMPENSAS_ADDRESS` | no¹ | Dirección de `Recompensas` (`sepolia.recompensas`). La wallet de `PRIVATE_KEY` debe ser su `operador`. |
| `DEPLOY_BLOCK` | no¹ | Bloque desde el que se indexa el ranking: el del **despliegue de GameItem** (el más antiguo de los tres). |
| `TEMPORADA_INICIO` | no | Inicio de la temporada 1 del pase (ISO UTC). Por defecto `2026-11-02T00:00:00Z`. Debe coincidir con `web/js/pase.js`. |

¹ Sin `MERCADO_ADDRESS` + `RECOMPENSAS_ADDRESS` + `DEPLOY_BLOCK`, `GET /ranking*` responde 503; sin `RECOMPENSAS_ADDRESS`,
`POST /recompensa` responde 503. En ambos casos el servidor arranca (solo avisa con `⚠`) y `/ganar` funciona igual.

Al arrancar, el servidor comprueba, en este orden, y **sale con código 1 y un mensaje claro** si algo falla:
1. variables presentes y con formato válido;
2. que el RPC responde (`eth_chainId`, timeout 8 s);
3. que hay código de contrato en `CONTRACT_ADDRESS` en esa red;
4. que la wallet de `PRIVATE_KEY` es el `owner()` del contrato.

Si la wallet no tiene ETH solo avisa (`⚠`), porque arranca igualmente.

### Probar con Hardhat local

```bash
# terminal 1 (carpeta contracts/)
npx hardhat node
# terminal 2: despliega (script de la Persona A) y usa en server/.env:
#   RPC_URL=http://127.0.0.1:8545
#   PRIVATE_KEY=<clave de la cuenta #0 que imprime `hardhat node`>
#   CONTRACT_ADDRESS=<dirección desplegada>
npm start
curl -X POST localhost:3000/ganar -H "content-type: application/json" \
     -d '{"address":"0x70997970C51812dc3A010C7d01b50e0d17dc79C8","enemyLevel":2,"jefe":true}'
```

## API

### `GET /health`
```json
{ "ok": true, "contract": "0x...", "chainId": 11155111, "saldoOperador": "0.0215", "alertaSaldoBajo": false }
```
`saldoOperador` es el ETH de la wallet del servidor (caché de 60 s). `alertaSaldoBajo` es `true` si baja de 0,002 ETH.
Si el RPC falla al leerlo, ambos campos van a `null` y `/health` sigue dando 200.

### `POST /ganar`
Body: `{ "address": "0x...", "enemyLevel": 1, "jefe": false }`
- `enemyLevel`: entero 1..10, opcional, por defecto 1.
- `jefe`: **booleano** opcional, por defecto `false`. `true` = el combate ganado era contra un jefe
  (siempre suelta objeto y mejora rareza y stats). Cualquier otro tipo (`"true"`, `1`, `null`…) → 400.

La forma de la respuesta no cambia respecto a la 1.0.

| Código | Cuerpo |
|---|---|
| 200 con drop | `{ "drop": true, "tokenId": "5", "txHash": "0x...", "item": { "nombre": "Cimitarra Rúnica de Escarcha", "tipo": "Espada", "rareza": 1, "ataque": 12, "defensa": 3 } }` |
| 200 sin drop | `{ "drop": false }` |
| 400 | `{ "error": "Dirección inválida" }` · `{ "error": "enemyLevel debe ser un entero entre 1 y 10" }` · `{ "error": "jefe debe ser un booleano" }` · `{ "error": "JSON inválido" }` |
| 429 | `{ "error": "Demasiadas peticiones, espera N s" }` (más cabecera `Retry-After: N`) |
| 500 | `{ "error": "..." }` con mensaje legible (sin ETH para gas, contrato rechazó el mint, timeout…) |

- `tokenId` va siempre como **string** decimal.
- La respuesta con drop llega **cuando la tx está minada** (1 confirmación). En Sepolia son ~12-15 s; la web debe mostrar un "acuñando…".
- La dirección se valida con `ethers.isAddress` (las mixtas deben tener checksum correcto), se normaliza con `getAddress` y se rechaza la dirección cero.

**Límites** (en memoria, una sola instancia): 30 peticiones/hora por IP (se cuenta antes de validar) y
1 petición cada 10 s por dirección (se cuenta tras validar, también si no hay drop).

### `GET /ranking` (1.2)
Salón de la fama on-chain: top 20 por categoría, leído de los eventos de los contratos (no se puede falsear).
```json
{
  "actualizado": "2026-11-05T12:00:00.000Z",
  "bloque": 7012345,
  "sincronizado": true,
  "categorias": {
    "objetos":     [{ "address": "0x7099…79C8", "valor": 42 }, { "address": "0x3C44…93BC", "valor": 17 }],
    "legendarios": [{ "address": "0x7099…79C8", "valor": 3 }],
    "oroVentas":   [{ "address": "0x3C44…93BC", "valor": 1250.5 }],
    "rachaDiaria": [{ "address": "0x3C44…93BC", "valor": 7 }]
  }
}
```
| Categoría | Evento | Valor |
|---|---|---|
| `objetos` | `GameItem.ItemMinted` | nº de objetos acuñados para la dirección |
| `legendarios` | `GameItem.ItemMinted` con `rareza = 2` | nº de legendarios |
| `oroVentas` | `Mercado.ItemVendido` | ORO ganado vendiendo, en ORO (número; ya dividido entre 10¹⁸) |
| `rachaDiaria` | `Recompensas.DiarioReclamado` | mayor `racha` alcanzada |

- Solo aparecen direcciones con valor > 0. Empates: dirección ascendente. `address` va en checksum.
- `actualizado`: hora del último refresco correcto. `bloque`: último bloque indexado.
  `sincronizado: false` = aún recorriendo el historial (se sirve lo que hay).
- `Cache-Control: public, max-age=30`. Límite: 60 peticiones/min por IP.
- 503 `{ "error": "Ranking no disponible: el servidor no tiene configurado DEPLOY_BLOCK" }` si faltan variables;
  503 `{ "error": "El ranking se está generando, vuelve en unos segundos" }` + `Retry-After: 30` hasta el primer refresco.

### `GET /ranking/:address` (1.2)
```json
{
  "address": "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  "actualizado": "2026-11-05T12:00:00.000Z", "bloque": 7012345, "sincronizado": true,
  "posiciones": {
    "objetos":     { "posicion": 2,    "valor": 17,     "participantes": 58 },
    "legendarios": { "posicion": null, "valor": 0,      "participantes": 9 },
    "oroVentas":   { "posicion": 1,    "valor": 1250.5, "participantes": 12 },
    "rachaDiaria": { "posicion": 1,    "valor": 7,      "participantes": 20 }
  }
}
```
`posicion` empieza en 1 y es `null` si la dirección no puntúa en esa categoría (fuera del top 20 también tiene posición).
400 `{ "error": "Dirección inválida" }`; 503 como `/ranking`.

### `POST /recompensa` (1.2)
Body: `{ "address": "0x...", "motivo": "pase10" }`.

| `motivo` | ORO | Una vez por |
|---|---|---|
| `pase10` | 100 | temporada (4 semanas desde `TEMPORADA_INICIO`) |
| `pase20` | 200 | temporada |
| `pase30` | 400 | temporada |
| `misiones_diarias` | 25 | día UTC |

| Código | Cuerpo |
|---|---|
| 200 | `{ "ok": true, "motivo": "pase10", "periodo": "T1", "oro": 100, "txHash": "0x..." }` (`periodo` = `"T<n>"` o `"YYYY-MM-DD"`) |
| 400 | `{ "error": "Dirección inválida" }` · `{ "error": "motivo debe ser uno de: pase10, pase20, pase30, misiones_diarias" }` |
| 409 | `{ "error": "Ya has reclamado esta recompensa", "motivo": "pase10", "periodo": "T1" }` · `{ "error": "Has alcanzado el tope diario de ORO de recompensas; vuelve mañana" }` · `{ "error": "Se ha agotado el ORO de recompensas de hoy para todos; vuelve mañana" }` |
| 429 | `{ "error": "Demasiadas peticiones, espera N s" }` · `{ "error": "Has alcanzado el límite de recompensas de hoy" }` |
| 500 | `{ "error": "..." }` (sin gas, red caída, el servidor no es operador…) |
| 503 | `{ "error": "Recompensas no disponibles: el servidor no tiene configurado RECOMPENSAS_ADDRESS" }` |

- La respuesta llega con la tx minada (~12-15 s en Sepolia).
- Llama a `Recompensas.recompensar(jugador, cantidad·10¹⁸, "<motivo>@<periodo>")`, p. ej. `"pase10@T1"` o
  `"misiones_diarias@2026-11-05"`. Como el periodo va en el motivo on-chain, tras un reinicio el indexador
  reconstruye lo ya pagado desde los eventos `Recompensado` y no se paga dos veces (si el ranking está activo).
- Límites en memoria: 1 reclamo por motivo y periodo, máx. 4 reclamos por dirección y día, 1 petición cada 10 s
  por dirección, 20 por hora por IP. Si la tx falla, la reserva se libera y se puede reintentar.
- Topes on-chain (`Recompensas`): 500 ORO por jugador y día y 5000 en total por día (por defecto). Ojo: `pase30` + `pase20`
  el mismo día (600) supera el tope por jugador: el segundo da 409 y se puede reclamar al día siguiente.

### Recompensa diaria con racha: `POST /recompensa` con `motivo: "diaria"` y `GET /recompensa/diaria/:address`

Sustituye al reclamo con MetaMask: la web pide `POST` y **el servidor paga el gas** de `Recompensas.recompensar`.
La cantidad la calcula el servidor (no se envía).

Body: `{ "address": "0x...", "motivo": "diaria" }`

Tabla (la misma que `Recompensas.tablaDiaria` del contrato), por día del ciclo:

| Día | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| ORO | 10 | 15 | 20 | 25 | 30 | 35 | 40 |

- Día 7 del ciclo: además del ORO del día, **bonus de 25 ORO** (`bonusDia7`) en una segunda llamada a
  `recompensar` con motivo `"diaria-bonus"`. Tras el día 7 la racha sigue y el ciclo vuelve al día 1 (día 8 = día 1).
- Si pasa más de un día UTC sin reclamar, la racha vuelve al día 1.
- Un reclamo por dirección y día UTC. Llamadas on-chain: motivo `"diaria"` (principal) y `"diaria-bonus"`.

| Código | Cuerpo |
|---|---|
| 200 | `{ "ok": true, "motivo": "diaria", "dia": 7, "racha": 7, "oro": 40, "bonusDia7": 25, "txHash": "0x...", "txHashBonus": "0x..." }` |
| 200 (bonus fallido) | igual, sin `txHashBonus` y con `"bonusPendiente": true`: el ORO principal sí está pagado |
| 200 (días 1–6 y 8+) | `{ "ok": true, "motivo": "diaria", "dia": 3, "racha": 3, "oro": 20, "bonusDia7": 0, "txHash": "0x..." }` |
| 400 | `{ "error": "Dirección inválida" }` |
| 409 | `{ "error": "Ya has reclamado hoy", "proximoEn": 43189 }` (`proximoEn` = segundos hasta las 00:00 UTC) · topes on-chain (como arriba) |
| 429 | `{ "error": "Demasiadas peticiones, espera N s" }` (1 cada 10 s por dirección) |
| 500 | `{ "error": "..." }` (el pago principal falla: no se registra el reclamo y se puede reintentar) |
| 503 | `{ "error": "Recompensas no disponibles: ..." }` |

`GET /recompensa/diaria/:address` no escribe nada; sirve para pintar la web:

```json
{ "racha": 2, "dia": 3, "puedeReclamar": true, "proximoEn": 0, "proximaOro": 20 }
```

- `racha`: racha vigente (0 si nunca reclamó o se rompió).
- `dia`: día del ciclo (1–7) que toca en el **próximo** reclamo; `proximaOro` es su ORO (sin contar el bonus del día 7).
- `puedeReclamar`: `false` si ya reclamó en el día UTC actual.
- `proximoEn`: segundos hasta las 00:00 UTC si `puedeReclamar` es `false`; `0` si no.
- 400 con dirección inválida, 503 si no hay `RECOMPENSAS_ADDRESS`.

> **Límite: la racha vive en memoria.** `{racha, ultimoDia}` por dirección se guarda en el servidor. En el plan gratis de
> Render el servicio se reinicia (y se duerme), así que **tras un reinicio el servidor olvida la racha y los reclamos
> de hoy**: el siguiente reclamo cuenta como día 1 y, si el jugador ya había reclamado ese día, vuelve a cobrarlo
> (hasta el tope on-chain de 500 ORO por jugador y día, que no cubre dos días seguidos a la vez).
> No se puede reconstruir desde la cadena: `Recompensas.estadoDiario` solo registra los reclamos hechos por el propio
> jugador con `reclamarDiario`, no los pagados por el servidor, así que no es fuente de verdad y no se usa.
> Los topes on-chain (500 ORO por jugador y día, 5000 globales) siguen protegiendo el gasto.

> **Confianza en el cliente (testnet).** El servidor no puede comprobar que el jugador haya llegado al nivel 10 del pase
> o completado sus misiones (eso vive en el `localStorage` de la web): solo limita cuánto y cuántas veces paga.
> Lo que acota el daño son los topes on-chain. Para mainnet haría falta mover el progreso al servidor o a la cadena.

## Cómo funciona

```
src/
  index.js      arranque: .env, comprobaciones de red/contrato, listen
  app.js        Express: rutas, validación, límites (dependencias inyectadas)
  loot.js       lógica PURA de drops (RNG inyectable)
  ranking.js    indexador de eventos on-chain para GET /ranking (1.2)
  recompensa.js motivos, cantidades, periodos y registro de reclamos de POST /recompensa (1.2)
  abis.js       ABIs mínimos human-readable de GameItem, Mercado y Recompensas (1.2)
  chain.js      ABI, extracción del tokenId del evento ItemMinted, emisor de tx con cola y nonce, minter
  queue.js      cola en serie
  rateLimit.js  limitador de ventana deslizante con reloj inyectable
  config.js     lectura y validación de variables
abi/GameItem.abi.json   ABI (se actualiza con npm run sync-abi)
scripts/sync-abi.js     copia y valida el ABI de ../shared/
test/                   tests con node --test (sin red)
```

### Botín (`loot.js`)

Lógica **pura** con RNG inyectable; el único estado (pity y último legendario) vive en `EstadoBotin`, en memoria.

**¿Cae objeto?** `rng() < DROP_CHANCE` (60 % por defecto). **Los jefes siempre sueltan objeto.**

**Rareza** según `enemyLevel` (interpolación lineal entre nivel 1 y 10) y `jefe`:

| Combate | Común | Raro | Legendario |
|---|---|---|---|
| Nivel 1 | 70 % | 25 % | 5 % |
| Nivel 3 | 65 % | 28 % | 7 % |
| Nivel 5 | 60 % | 31 % | 9 % |
| Nivel 7 | 55 % | 34 % | 11 % |
| Nivel 10 | 47,5 % | 38,5 % | 14 % |
| Jefe nivel 1 | 55 % | 35 % | 10 % |
| Jefe nivel 5 | 46,6 % | 39 % | 14,4 % |
| Jefe nivel 10 | 36 % | 44 % | 20 % |

Fórmulas (`t = (nivel − 1) / 9`): sin jefe Legendario `5 % + 9 %·t`, Raro `25 % + 13,5 %·t`;
con jefe Legendario `10 % + 10 %·t`, Raro `35 % + 9 %·t`; Común = el resto.
Los tests comprueban estas tablas con 100 000 tiradas (±1 pp).

**Pity** (protección contra la mala suerte, por dirección): tras **15 drops seguidos sin Legendario**, el
siguiente tiene al menos un 50 % de Legendario, y sube 10 puntos por cada drop más (al 21.º es seguro).
Se reinicia al recibir un Legendario. Solo cuentan los drops **acuñados** (si el mint falla, no cuenta).
Con pity, la tasa efectiva de Legendario en nivel 1 pasa del 5 % a ≈ 8,7 %. Vive en memoria (máx. 10 000
direcciones): un reinicio de Render lo pone a cero.

**Stats.** Tipo uniforme entre Espada, Escudo, Casco, Armadura y Botas. Stat principal (Espada → ataque;
resto → defensa) dentro de un rango absoluto por rareza, desplazado según el nivel (un jefe cuenta como +2 niveles):

| Rareza | Rango absoluto | Nivel 1 | Nivel 5 | Nivel 10 / jefe 8+ |
|---|---|---|---|---|
| Común (0) | 1–6 | 1–4 | 2–5 | 3–6 |
| Raro (1) | 6–14 | 6–11 | 7–12 | 9–14 |
| Legendario (2) | 14–30 | 14–24 | 17–26 | 20–30 |

La secundaria es el 10–40 % de la principal, redondeado (puede salir 0 en Comunes). Todo cabe de sobra en `uint16`.

**Nombres procedurales** (≤ 60 caracteres, con concordancia de género y número). 16 bases por tipo,
16 adjetivos comunes, 13 adjetivos raros, 20 sufijos raros, 28 nombres propios y 20 epítetos legendarios:
- Común: `<Base> <adjetivo>` → *Falcata de Recluta*, *Clípeo Rayado*, *Capellina Oxidada*, *Gambesón Corriente*, *Babuchas Rayadas*.
- Raro: `<Base> <adjetivo> <sufijo>` → *Cimitarra Encantada del Centinela*, *Broquel Élfico del Coloso*, *Capucha Templada del Halcón*, *Arnés Imponente del Vigía*, *Alpargatas Arcanas de Obsidiana*.
- Legendario: `<Nombre>, <Base> <epíteto>` → *Quimera, Espadón del Último Titán*, *Sílfide, Bastión del Abismo Sin Fin*, *Brasa, Yelmo de los Dioses Caídos*, *Augurio, Cota de Malla del Dragón Eterno*, *Nadir, Botines del Primer Amanecer*.

El servidor no repite el mismo nombre legendario dos veces seguidas (si sale igual que el último, cambia el nombre propio).
La base pertenece siempre al tipo del NFT (una *Cimitarra* es `tipo: "Espada"`), así que la web debe usar `tipo`, no el nombre, para iconos y slots.

### Ranking (`ranking.js`)

`IndexadorRanking` lee con `getLogs` los eventos `ItemMinted` (GameItem), `ItemVendido` (Mercado),
`DiarioReclamado` y `Recompensado` (Recompensas) desde `DEPLOY_BLOCK`, en una sola consulta por tramo
(las tres direcciones y los cuatro topics juntos). Arranca con el servidor y se refresca cada 60 s de forma
incremental; todo vive en memoria y tras un reinicio se reconstruye desde `DEPLOY_BLOCK`.

Tolerancia a RPC públicos (publicnode a veces va desfasado o limita rangos):
- Tramos de 10 000 bloques; si `getLogs` falla, el tramo se parte por la mitad (mín. 50) y se reintenta.
  Tras 8 fallos seguidos se deja para el siguiente refresco **sin perder lo ya indexado**. Máx. 100 tramos por refresco.
- Solo se indexa hasta `cabeza − 3` bloques. Si el nodo devuelve una cabeza **por detrás** de lo indexado, se ignora.
- Cada refresco vuelve a leer los últimos 50 bloques: los logs que un nodo desfasado no devolvió aparecen después.
  Los repetidos se descartan por `(txHash, índice)`.
- Se ignoran logs `removed`, de otras direcciones o que no se pueden decodificar.

Los ABIs son mínimos (`abis.js`). Los tests comparan cada firma (incluidos los `indexed`) con
`shared/Mercado.abi.json` y `shared/Recompensas.abi.json`.

### Mints y ABI

Todas las tx de la wallet del servidor (mints y recompensas) pasan por **un único emisor** (`crearEmisor`): misma cola y mismo nonce local.

**Mints en serie**: todos los `mintItem` pasan por una cola (envío + espera del recibo), y el nonce se lleva
en memoria: se pide al nodo con `eth_getTransactionCount(pending)` la primera vez y después de cualquier error,
y se incrementa en cada envío. Esto es necesario porque ethers v6 cachea unos 250 ms las peticiones RPC
idénticas y, sin nonce local, los mints seguidos fallaban con `NONCE_EXPIRED` (comprobado con Hardhat:
8 victorias simultáneas → tokenIds consecutivos sin errores).

**ABI**: `abi/` traía un ABI mínimo escrito a mano (`mintItem`, `getItem`, `totalMinted`, `owner`, `ItemMinted`).
Ahora está el ABI completo de la Persona A. Si el contrato cambia, ejecuta `npm run sync-abi`: valida que las firmas de SPEC.md sigan ahí.

## Tests

```bash
npm test
```
Sin red: distribución de rarezas por nivel y jefe en 100k tiradas (±1 pp), drop garantizado de jefes, pity
(umbral, escalado, reinicio, memoria acotada, racha máxima de 20), rangos de stats por nivel (todos los valores alcanzables),
nombres (vocabulario mínimo, concordancia, ≤ 60 caracteres en el peor caso, sin legendario repetido),
validación de dirección, `enemyLevel` y `jefe`, indexador del ranking con un provider simulado (tramos, rango rechazado,
errores transitorios, nodo desfasado, solape sin duplicados, margen, logs inválidos), recompensas (cantidades, periodos,
reclamo único, límites, reintento tras fallo, errores del contrato), 503 sin variables con `/ganar` intacto,
emisor compartido de tx, comparación de los ABIs mínimos con los de `shared/`, respuestas 200/400/429/500 con un minter simulado y reloj falso,
extracción del `tokenId` de un log `ItemMinted` codificado de verdad, serialización y nonce del minter, y configuración.

## Despliegue

> El servidor guarda la clave del owner: **despliégalo tú desde tu cuenta** y define los secretos solo en el panel del proveedor.
> Los límites viven en memoria: usa **una sola instancia**.

### Render (recomendado)

**Opción A: Blueprint (`render.yaml`)**

El Blueprint vive en **`server/render.yaml`** (no en la raíz). Lleva `rootDir: server` y Render
resuelve esa ruta respecto a la raíz del repo, así que el archivo funciona igual en las dos ubicaciones:
- **Tal cual (`server/render.yaml`)**: al crear el Blueprint hay que indicar *Blueprint Path* = `server/render.yaml`.
- **Movido a la raíz (`/render.yaml`)**: Render lo detecta solo; no hay que tocar su contenido.

Pasos:
1. Sube el repo a GitHub (es **público**). Antes del primer push, comprueba que no se cuela ningún secreto:
   `git status` no debe listar `server/.env` (lo ignoran `server/.gitignore` y el `.gitignore` raíz), y
   `git add -n server` solo debe mostrar `.env.example`.
2. En Render: **New → Blueprint**, elige el repo y en *Blueprint Path* escribe `server/render.yaml`.
3. Render pide los valores marcados `sync: false`: `RPC_URL`, `PRIVATE_KEY`, `CONTRACT_ADDRESS`, `ALLOWED_ORIGIN`
   (la URL de la web, p. ej. `https://usuario.github.io`). Se guardan cifrados en Render, nunca en el repo.
4. **Apply**. Cuando termine, abre `https://<servicio>.onrender.com/health`.

Con `rootDir: server`, Render solo redepliega cuando cambian archivos de `server/`. Build: `npm ci --omit=dev`
(usa el `package-lock.json`); arranque: `npm start`.

> Si la `PRIVATE_KEY` llega a subirse alguna vez a GitHub, dala por comprometida: crea otra wallet,
> transfiere el ownership del contrato (`transferOwnership`) y cambia la variable en Render.

**Opción B: a mano** — New → Web Service → repo, y:
- Root Directory: `server`
- Runtime: Node · Build Command: `npm ci --omit=dev` · Start Command: `npm start`
- Health Check Path: `/health`
- Environment: las variables de la tabla de arriba (no definas `PORT`) y `NODE_VERSION=20`.

Notas: en el plan free el servicio se duerme tras ~15 min sin tráfico y la primera petición tarda ~30-50 s;
la web puede llamar a `/health` al cargar para despertarlo. Pon la URL final como `SERVER_URL` en `web/config/config.js`.

### Railway (alternativa)

1. **New Project → Deploy from GitHub repo** y elige el repo.
2. En el servicio, **Settings → Root Directory**: `server`. Railway detecta Node y usa `npm start` (también puedes poner *Custom Start Command* `npm start`).
3. **Variables**: `RPC_URL`, `PRIVATE_KEY`, `CONTRACT_ADDRESS`, `ALLOWED_ORIGIN`, y opcionalmente `DROP_CHANCE`, `TRUST_PROXY=1`. `PORT` lo pone Railway.
4. **Settings → Networking → Generate Domain** y comprueba `https://<dominio>.up.railway.app/health`.
5. (Opcional) **Settings → Deploy → Healthcheck Path**: `/health`.

### Comprobación tras desplegar

```bash
curl https://<tu-servidor>/health
curl -X POST https://<tu-servidor>/ganar -H "content-type: application/json" -d '{"address":"0xTU_WALLET"}'
```
Si `/health` no responde, revisa los logs: los errores de arranque empiezan por `✗ No se puede arrancar el servidor`.
