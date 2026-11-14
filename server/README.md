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
| `GAS_TOPE_DIARIO` | no (0.01) | ETH máximo que el grifo de gas (`POST /gas`) reparte al día entre todos los jugadores. |
| `TEMPORADA_INICIO` | no | Inicio de la temporada 1 del pase (ISO UTC). Por defecto `2026-11-02T00:00:00Z`. Debe coincidir con `web/js/pase.js`. |
| `ORO_ADDRESS` | no¹ | Dirección de `LootGold` (`shared/deployments.json` → `sepolia.oro`). Sin ella, `GET /tesoreria` responde 503. |
| `RED` | no (`sepolia`) | Red en la que trabaja el servidor: `sepolia`, `base-sepolia`, `arbitrum-sepolia`, `optimism-sepolia`, `localhost`… Ver [Trabajar en otra red](#trabajar-en-otra-red). |
| `ALMACEN` | no² | `memoria` o `upstash`. Dónde se guarda el estado del juego. Ver [Persistencia](#persistencia). |
| `UPSTASH_REDIS_REST_URL` | no² | URL REST de la base de Upstash (`https://….upstash.io`). |
| `UPSTASH_REDIS_REST_TOKEN` | no² | Token REST **Standard** de Upstash. **Es un secreto: nunca a git.** |
| `ALMACEN_PREFIJO` | no (`loot-arena:`) | Prefijo de las claves. Cámbialo para que dos entornos compartan una base gratuita. |

¹ Sin `MERCADO_ADDRESS` + `RECOMPENSAS_ADDRESS` + `DEPLOY_BLOCK`, `GET /ranking*` responde 503; sin `RECOMPENSAS_ADDRESS`,
`POST /recompensa` responde 503. En ambos casos el servidor arranca (solo avisa con `⚠`) y `/ganar` funciona igual.

² Si faltan, el servidor **arranca igual** pero guarda el estado solo en memoria y lo pierde al reiniciar.
No hay ningún caso en el que el almacén impida arrancar. Ver [Persistencia](#persistencia).

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

## Trabajar en otra red

Hasta la 1.4 el servidor daba Sepolia por supuesto. Desde la 1.4.1 la red es un parámetro: `RED`.

```bash
RED=sepolia          # por defecto; no hay que ponerla para que todo siga igual
RED=base-sepolia
RED=localhost        # nodo de Hardhat
```

Redes conocidas (`src/redes.js`): `sepolia`, `base-sepolia`, `arbitrum-sepolia`,
`optimism-sepolia`, `localhost`. Una red que no esté en la lista **se admite igual**: solo se
pierde la comprobación del chainId y se avisa con `⚠`.

**Un servidor atiende una red a la vez**, no varias en paralelo. En el plan gratuito de Render
hay una sola instancia y un solo juego de variables, y mezclar redes en un proceso obligaría a
duplicar wallet, nonce y grifo de gas. Para una segunda red se levanta un **segundo servicio**
con sus propias variables, y la web apunta a uno o a otro según la red elegida.

Tres cosas que esto garantiza:

1. **Nada de Sepolia a fuego.** Direcciones, bloque de despliegue y RPC ya venían de variables;
   ahora el nombre y el chainId de la red también.
2. **El chainId se comprueba al arrancar.** Si `RED=sepolia` pero `RPC_URL` apunta a otra red, el
   servidor **no arranca** y dice en qué red está el nodo de verdad. Acuñar sobre las direcciones
   de otra red sería el fallo más caro posible.
3. **El estado nunca se mezcla entre redes.** El prefijo del almacén lleva la red dentro
   (`loot-arena:sepolia:`, `loot-arena:base-sepolia:`), **incluso si se pone el mismo
   `ALMACEN_PREFIJO` a mano**. Así dos despliegues pueden compartir la misma base gratuita de
   Upstash sin pisarse el índice del ranking ni las rachas.

Para desplegar en otra red hay que cambiar, en el panel: `RED`, `RPC_URL`, `CONTRACT_ADDRESS`,
`MERCADO_ADDRESS`, `RECOMPENSAS_ADDRESS`, `ORO_ADDRESS` y `DEPLOY_BLOCK` (los de esa red en
`shared/deployments.json`). `PRIVATE_KEY` puede ser la misma cartera si es owner allí también.

## El RPC y la historia podada

**Esto es lo que rompió el ranking en producción el 12-nov-2026. Conviene leerlo antes de tocar nada.**

Los RPC públicos **podan** su historia: solo conservan los últimos bloques. Medido contra
`https://ethereum-sepolia-rpc.publicnode.com` (el de `render.yaml`):

| Profundidad desde la cabeza | `getLogs` |
|---|---|
| 200, 1 000, 5 000 bloques | siempre OK |
| ~20 000 bloques | **a veces sí y a veces no** (es un grupo de nodos y no todos han podado lo mismo) |
| 40 000+ bloques | siempre `{"code":4444,"message":"pruned history unavailable"}` |

El tamaño del rango **no** es el problema: un `getLogs` de 50 000 bloques pegado a la cabeza
funciona. Lo que estorba es la **antigüedad** del primer bloque pedido.

`DEPLOY_BLOCK = 12072405` quedó a más de 46 000 bloques de la cabeza, así que **el servidor ya
no puede reconstruir el índice completo desde cero con este RPC**. Qué hacer, de mejor a peor:

1. **Configurar la persistencia** (`ALMACEN=upstash`, ver [Persistencia](#persistencia)). Es la
   solución de verdad: el índice se construye una vez y después solo se leen bloques recientes,
   que nunca están podados. **Mientras no se configure, cada arranque en frío pierde el histórico.**
2. **Usar un RPC con historia**: el plan gratuito de Alchemy o Infura conserva Sepolia entera.
   Basta cambiar `RPC_URL` en Render.
3. **Subir `DEPLOY_BLOCK`** a un bloque reciente. Es gratis e inmediato, pero tira el histórico
   anterior a ese bloque a propósito.

Qué hace el servidor cuando se topa con un hueco (desde la 1.4.1): **salta hacia delante** hasta
donde el nodo sí tiene datos, sirve el ranking parcial y lo dice con `incompleto: true` y
`desdeBloque` en `GET /ranking`, y con `incompleto` + `bloquesSinHistoria` en `GET /health`.
Nunca finge que el ranking está entero.

> **Para la web (fase E1, pestaña «Tus transacciones»):** leer `getLogs` desde el bloque de
> despliegue **desde el navegador** se va a topar con esta misma pared. O se usa un RPC con
> historia, o ese historial tiene que servirlo el servidor desde su índice persistido.

## Persistencia

### El problema

El plan gratuito de Render **no permite discos persistentes** y **duerme el servicio** tras ~15 min sin tráfico.
Hasta la 1.3, todo el estado del juego vivía en `Map`/`Set` dentro del proceso, así que cada reinicio (varios al día)
borraba:

| Qué se perdía | Consecuencia |
|---|---|
| Racha y reclamo diario | La racha volvía a día 1 y se podía cobrar la diaria **dos veces** el mismo día |
| Primer botín por dirección | Cada jugador recibía otro objeto Raro de regalo tras cada reinicio |
| Tope diario del grifo de gas | `GAS_TOPE_DIARIO` se reiniciaba: el grifo podía repartir mucho más de lo previsto en un día |
| Récords de la torre | `GET /torre/ranking` se quedaba vacío |
| Pity del botín | El contador de "drops sin Legendario" volvía a cero |
| Índice del ranking on-chain | Había que reindexar desde `DEPLOY_BLOCK`: `GET /ranking` daba 503 unos 25 s en cada arranque |

### La solución (1.4)

Una **capa de almacenamiento intercambiable** (`src/almacen.js`) con tres operaciones (`leer`, `escribir`, `borrar`
por clave) y dos implementaciones: `memoria` (la de siempre) y `upstash`.

Se eligió **Upstash Redis por su API REST**. Comparación de las opciones gratuitas y sin tarjeta (noviembre de 2026):

| Opción | ¿Gratis sin tarjeta? | Límites del plan gratuito | Por qué sí / no |
|---|---|---|---|
| **Disco persistente de Render** | ❌ | Solo en planes de pago (desde $7/mes + $0,25/GB) | **Descartado:** la documentación de Render dice que los servicios *free* no pueden tener disco |
| **Upstash Redis (REST)** | ✅ sin tarjeta | 250 MB, 500 000 comandos/mes, 10 GB de tráfico, 1 base | **Elegido:** se habla por HTTPS con `fetch`, así que **no añade ninguna dependencia** al `package.json` |
| Neon (Postgres) | ✅ sin tarjeta | 100 CU-hora/mes, ~0,5 GB por proyecto | Habría que añadir el driver `pg` y escribir SQL para guardar cinco claves |
| Turso / libSQL | ✅ | ~5 GB, 500 M lecturas/mes | Límites generosos, pero archiva bases inactivas a los 10 días y requiere `@libsql/client` |
| Supabase | ⚠️ no confirmado | 500 MB, 2 proyectos | **Descartado:** pausa los proyectos gratuitos a la semana de inactividad, justo nuestro caso |
| Un fichero en el propio servicio | ✅ | — | **Inútil:** el disco de un servicio *free* se borra en cada redespliegue o reinicio |

Enlaces: [planes gratuitos de Render](https://render.com/docs/free) ·
[precios de Upstash](https://upstash.com/docs/redis/overall/pricing) ·
[API REST de Upstash](https://upstash.com/docs/redis/features/restapi) ·
[FAQ de Upstash](https://upstash.com/docs/redis/help/faq)

> Upstash **archiva** una base gratuita tras un mínimo de 30 días sin usarse, avisando por correo antes, y guarda una
> copia para poder restaurarla. Con el monitor de UptimeRobot visitando el servidor cada 5 minutos esto no debería pasar.

### Cómo se guarda (y por qué no ralentiza el juego)

**Caché con escritura retrasada** (`src/persistencia.js`):

1. Al arrancar se lee **una vez** cada clave y se vuelca en el registro correspondiente.
2. Durante la partida, leer y escribir sigue siendo **síncrono y en memoria**: ninguna ruta (`/ganar`, `/gas`,
   `/torre`, `/recompensa`) espera al almacén, así que una caída de Upstash **no añade latencia ni devuelve errores**.
3. Cada cambio programa un guardado a los 1,5 s. Muchos cambios seguidos = **una sola escritura**.

Por eso el consumo cabe de sobra en los 500 000 comandos al mes: cinco lecturas al arrancar y unos pocos cientos
de escrituras al día. Lo único que se puede perder son los cambios de los últimos ~1,5 s antes de un corte brusco
(al cerrar ordenadamente, `SIGTERM`/`SIGINT`, se vuelca lo pendiente antes de salir).

Claves que se guardan: `diario`, `primer-botin`, `gas`, `torre`, `botin` y `ranking`
(con el prefijo `ALMACEN_PREFIJO`).

### El caso especial del ranking

El índice de `GET /ranking` se guarda con los mismos mecanismos, pero tiene tres particularidades:

- **Se guardan también los ids de los logs ya contados** (`vistos`). Cada refresco vuelve a leer los últimos
  50 bloques por si el nodo iba desfasado; sin esos ids, el primer refresco tras un reinicio **contaría dos veces**
  los eventos de esa ventana. Hay un test que lo demuestra.
- **Se guarda el despliegue al que pertenece** (`DEPLOY_BLOCK` y las tres direcciones). Si cambias cualquiera de
  ellos, la instantánea se descarta con un aviso y el servidor reindexa desde `DEPLOY_BLOCK`, como antes de la 1.4.
  Lo mismo si subes la versión del formato.
- **No se guarda en cada refresco.** Solo cuando hay eventos nuevos o cuando han pasado 500 bloques (~100 min en
  Sepolia). Guardar cada minuto gastaría ~45 000 comandos al mes para nada; así un reinicio solo tiene que releer
  un tramo, que es **una sola llamada a `getLogs`**.

Al restaurar, `actualizado` conserva la fecha real del último refresco (la web ya enseña lo vieja que es) y
`sincronizado` se pone a `false` hasta que el primer refresco comprueba la cabeza de la cadena.

> **Lo que sigue sin cubrir:** una reorganización de la cadena más profunda que la ventana de 50 bloques dejaría
> contadores mal, igual que ya pasaba con el índice en memoria. En Sepolia y con el margen de 3 bloques no es
> un riesgo práctico. Si alguna vez hiciera falta, basta con borrar la clave `ranking` del almacén para forzar
> una reindexación completa.

### Qué tiene que hacer el usuario en Render

**1) Crear la base en Upstash** (gratis, sin tarjeta):
1. Entra en <https://console.upstash.com> y regístrate (sirve la cuenta de GitHub o Google).
2. **Create Database**. Nombre: `loot-arena`. Región: la más cercana a Render (el servicio está en `frankfurt`,
   así que vale `eu-west-1`). Tipo: **Free**.
3. En la base creada, pestaña **REST** del apartado *Connect*. Copia los dos valores:
   `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN` (el **Standard**, no el *Read Only*).

> **No pongas tarjeta.** Según la documentación de Upstash, añadir una tarjeta convierte la base al plan
> *pay-as-you-go* y pierde la cuota gratuita.

**2) Añadir las variables en Render:**
1. Panel de Render → el servicio `loot-arena-cg913` → **Environment**.
2. **Add Environment Variable**, tres veces:
   - `ALMACEN` = `upstash`
   - `UPSTASH_REDIS_REST_URL` = la URL copiada
   - `UPSTASH_REDIS_REST_TOKEN` = el token copiado
3. **Save Changes**. Render redespliega solo.

**3) Comprobar que ha funcionado:**
```bash
curl https://<tu-servidor>/health
```
Debe aparecer `"almacen": { "tipo": "upstash", "persistente": true, "degradado": false }`.
Si sale `"degradado": true`, el campo `aviso` dice exactamente qué falta.

### Qué pasa si faltan las variables

**El servidor arranca igual, siempre.** El almacén nunca es motivo de error de arranque:

| Situación | Qué hace el servidor | Qué dice `/health` |
|---|---|---|
| Sin ninguna de las variables | Usa memoria, como hasta la 1.3 | `{ "tipo": "memoria", "persistente": false, "degradado": false }` |
| `ALMACEN=upstash` sin URL o sin token | Usa memoria y avisa con `⚠` en los logs | `degradado: true` y `aviso` nombrando la variable que falta |
| Token mal copiado | Usa memoria | `degradado: true`, `aviso: "Upstash rechazó el token…"` |
| Upstash no responde al arrancar | Usa memoria | `degradado: true`, `aviso: "Upstash no está accesible…"` |
| `ALMACEN` con un valor inventado | Usa memoria | `degradado: true` y la lista de tipos válidos |
| Upstash se cae con el servidor en marcha | Las rutas siguen dando 200; el cambio queda pendiente y se reintenta | `escriturasFallidas` y `ultimoError` (se limpian al primer éxito) |
| Datos corruptos en una clave | Ignora esa clave y arranca con el registro vacío | `⚠` en los logs |

En desarrollo local no hace falta tocar nada: sin variables se usa memoria.
Para probar contra Upstash de verdad, rellena `.env` como indica `.env.example`.

## API

### `GET /health`
```json
{ "ok": true, "contract": "0x...", "chainId": 11155111, "saldoOperador": "0.0215", "alertaSaldoBajo": false,
  "almacen": { "tipo": "upstash", "persistente": true, "degradado": false } }
```
`saldoOperador` es el ETH de la wallet del servidor (caché de 60 s). `alertaSaldoBajo` es `true` si baja de 0,002 ETH.
Si el RPC falla al leerlo, ambos campos van a `null` y `/health` sigue dando 200.

`red` (1.4.1) es la red en la que trabaja el servidor (ver [Trabajar en otra red](#trabajar-en-otra-red)).

`indexador` (1.4.1) dice cómo va el indexado del ranking. **Nació de la avería del 12-nov-2026**,
en la que el indexado se quedó parado y desde fuera no se notaba: solo un 503 eterno.

| Campo | Significado |
|---|---|
| `bloque` / `cabeza` / `pendientes` | hasta dónde ha indexado, dónde está la cadena y cuánto falta |
| `listo` | si `GET /ranking` ya sirve algo (`false` = responde 503) |
| `sincronizado` | si ha llegado a la cabeza |
| **`atascado`** | **la señal de alarma**: `true` si lleva dos refrescos fallando o más de 5 min sin avanzar sin estar al día |
| `segundosSinAvanzar`, `refrescosFallidos`, `ultimoError` | para saber qué le pasa sin abrir los logs |
| `incompleto`, `bloquesSinHistoria`, `desdeBloque` | solo si el RPC no pudo servir parte de la historia |

Un indexado al día que no se mueve **no** es un atasco: si está `sincronizado`, no hay nada que indexar.

`almacen` (1.4) dice dónde se guarda el estado del juego, sin tener que mirar los logs de Render:

| Campo | Significado |
|---|---|
| `tipo` | `upstash` o `memoria`: el almacén que se está usando **de verdad**. |
| `persistente` | `false` cuando es `memoria`: el estado se perderá al reiniciar. |
| `degradado` | `true` si se pidió un almacén externo y hubo que caer a memoria. **Es la señal de alarma.** |
| `aviso` | Solo si `degradado`: por qué (falta una variable, token rechazado, no responde…). |
| `escriturasFallidas`, `ultimoError` | Solo si alguna escritura ha fallado. `ultimoError` se borra en cuanto una va bien. |

El token nunca aparece en la respuesta.

### `POST /ganar`
Body: `{ "address": "0x...", "enemyLevel": 1, "jefe": false }`
- `enemyLevel`: entero 1..10, opcional, por defecto 1.
- `jefe`: **booleano** opcional, por defecto `false`. `true` = el combate ganado era contra un jefe
  (siempre suelta objeto y mejora rareza y stats). Cualquier otro tipo (`"true"`, `1`, `null`…) → 400.

La forma de la respuesta no cambia respecto a la 1.0, salvo el campo opcional `primerBotin` (1.3, ver abajo).

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

**Primer botín garantizado (1.3).** La primera victoria de cada dirección suelta **siempre un objeto Raro** (`rareza: 1`),
aunque el RNG dijera "sin drop" y aunque fuera un jefe; tipo, nombre y stats se sortean como siempre según `enemyLevel`/`jefe`.
La respuesta añade `"primerBotin": true`:
```json
{ "drop": true, "tokenId": "12", "txHash": "0x...", "primerBotin": true,
  "item": { "nombre": "Calzas Ancestrales de los Ecos", "tipo": "Botas", "rareza": 1, "ataque": 4, "defensa": 11 } }
```
Si el mint falla, no cuenta: la siguiente victoria vuelve a ser el primer botín.
> **Persistente desde la 1.4.** Con `ALMACEN=upstash` el servidor recuerda quién ya cobró su primer botín, así que
> deja de regalar un Raro a todo el mundo tras cada reinicio. Sin almacén externo sigue pasando lo de antes
> (asumible en red de pruebas). Ver [Persistencia](#persistencia).

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
- **Desde la 1.4**, con `ALMACEN=upstash` ese 503 de arranque casi desaparece: el índice guardado se restaura y
  `GET /ranking` responde 200 desde el primer segundo (con `sincronizado: false` y el `actualizado` de antes del
  reinicio, hasta que el primer refresco pone al día). La web no necesita cambiar nada: ya trata los dos casos.

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

> **Persistente desde la 1.4.** `{racha, ultimoDia}` por dirección se guarda en la capa `almacen.js`: con
> `ALMACEN=upstash` la racha y el "ya has reclamado hoy" **sobreviven** a los reinicios y a que Render duerma el
> servicio. **Sin almacén externo** vuelve el comportamiento de la 1.3: tras un reinicio la racha cuenta como día 1 y
> un jugador que ya había reclamado puede cobrarlo otra vez (hasta el tope on-chain de 500 ORO por jugador y día).
> No se puede reconstruir desde la cadena: `Recompensas.estadoDiario` solo registra los reclamos hechos por el propio
> jugador con `reclamarDiario`, no los pagados por el servidor, así que no es fuente de verdad y no se usa.
> Los topes on-chain (500 ORO por jugador y día, 5000 globales) siguen protegiendo el gasto en los dos casos.
> Ver [Persistencia](#persistencia).

> **Confianza en el cliente (testnet).** El servidor no puede comprobar que el jugador haya llegado al nivel 10 del pase
> o completado sus misiones (eso vive en el `localStorage` de la web): solo limita cuánto y cuántas veces paga.
> Lo que acota el daño son los topes on-chain. Para mainnet haría falta mover el progreso al servidor o a la cadena.

### Grifo de gas: `POST /gas` y `GET /gas/:address` (1.3)

Para que nadie se quede sin poder vender, comprar o abrir cofres por no tener ETH de Sepolia, el servidor regala un poco
desde su propia wallet (la misma que mintea; los envíos van por **la misma cola y el mismo nonce** que los mints y las
recompensas, así que nunca chocan).

Reglas:
- Solo si el jugador tiene **menos de 0,0003 ETH**; se le envían **0,0005 ETH**.
- **1 vez por dirección y día UTC** (se reinicia a las 00:00 UTC).
- **Tope global diario** `GAS_TOPE_DIARIO` (por defecto 0,01 ETH = 20 envíos).
- **Nunca deja la wallet del servidor por debajo de 0,002 ETH** (si `saldo − 0,0005 < 0,002`, no envía).

`POST /gas` — body `{ "address": "0x..." }`. La respuesta llega cuando la tx está **minada** (1 confirmación, ~12-15 s en Sepolia):

| Código | Cuerpo |
|---|---|
| 200 enviado | `{ "ok": true, "enviado": 0.0005, "txHash": "0x..." }` |
| 200 no hace falta | `{ "ok": true, "enviado": 0, "motivo": "ya tienes gas", "saldo": "0.0012" }` (no gasta la petición del día) |
| 400 | `{ "error": "Dirección inválida" }` |
| 409 | `{ "error": "Ya has pedido gas hoy; vuelve mañana", "proximoEn": 43200 }` |
| 429 | `{ "error": "Demasiadas peticiones, espera N s" }` + `Retry-After` |
| 500 | `{ "error": "No se pudo conectar con la red Ethereum" }` u otro mensaje legible (la petición del día no se gasta) |
| 502 | `{ "error": "No se pudo conectar con la red Ethereum; inténtalo de nuevo" }` (fallo al leer saldos) |
| 503 | `{ "error": "El servidor se ha quedado sin ETH para regalar; inténtalo más tarde" }` · `{ "error": "Se ha agotado el gas de hoy para todos; vuelve mañana", "proximoEn": N }` |

`GET /gas/:address` — solo lee, no envía nada:
```json
{ "saldo": "0.0001", "puedePedir": true, "proximoEn": 0 }
{ "saldo": "0.0006", "puedePedir": false, "proximoEn": 43200, "motivo": "Ya has pedido gas hoy" }
{ "saldo": "0.01",   "puedePedir": false, "proximoEn": 0, "motivo": "ya tienes gas" }
```
`saldo` es el ETH del jugador (string). `proximoEn` son segundos hasta las 00:00 UTC si ya lo pidió hoy (si no, 0).
`motivo` solo aparece cuando `puedePedir` es `false`. `puedePedir` no mira el saldo del servidor (eso solo lo sabe `POST`).

**Límites:** `POST /gas` 10/hora por IP y 1 cada 10 s por dirección; `GET /gas/:address` 60/minuto por IP.

> **Limitaciones.** El registro (quién pidió hoy, total repartido) **se persiste desde la 1.4**: con `ALMACEN=upstash`
> un reinicio ya no vacía el tope diario ni deja pedir dos veces el mismo día. Sin almacén externo sí pasa, y el grifo
> puede repartir varias veces `GAS_TOPE_DIARIO` en un mismo día. Una persona con muchas direcciones puede pedir para
> cada una: lo acotan el tope global y la reserva de 0,002 ETH. Vigila `/health` (`alertaSaldoBajo`) y recarga la wallet
> del servidor con un faucet. Ver [Persistencia](#persistencia).

### `GET /tesoreria` (1.4.1, fase E3)

Resumen de lo que tiene el juego en la cadena, para el panel «Tesorería» de la sección Cadena.

```json
{
  "red": "sepolia", "redNombre": "Sepolia", "chainId": 11155111, "moneda": "SepoliaETH",
  "explorador": "https://sepolia.etherscan.io",
  "actualizado": "2026-11-12T18:32:54.075Z",
  "cajaEth": "0.0",
  "operadorEth": "0.054047816139690622",
  "oroCirculacion": "358.0",
  "oroQuemado": null,
  "motivoOroQuemado": "El contrato LootGold no lleva contador de quemado: …",
  "owner": "0x9032…14C23",
  "retirada": {
    "funcion": "Mercado.retirarEth(uint256 cantidad)",
    "quienPuede": "0x9032…14C23",
    "nota": "Solo el owner del Mercado puede retirar. Cualquier otra cuenta recibe un revert."
  },
  "contratos": { "gameItem": "0x…", "mercado": "0x…", "oro": "0x…", "recompensas": "0x…", "operador": "0x…" }
}
```

| Campo | De dónde sale |
|---|---|
| `cajaEth` | `Mercado.cajaEth()`: el ETH que el Mercado guarda de las compras |
| `operadorEth` | saldo de la cartera con la que el servidor paga el gas |
| `oroCirculacion` | `LootGold.totalSupply()`: el ORO que existe ahora (acuñado menos quemado) |
| `owner` | `Mercado.owner()`: quién puede sacar el ETH de la caja |

**Por qué lo sirve el servidor y no cada navegador:** son cuatro llamadas al RPC por visita.
Con un RPC público compartido, que cada pestaña las repita agota la cuota. Aquí se leen una vez
cada 45 s y se reparten cacheadas (`Cache-Control: public, max-age=30`). Varias visitas
simultáneas comparten **una sola** lectura.

**Si el RPC falla**, se devuelve el último dato bueno con `"obsoleto": true` y su `actualizado`,
en vez de romper la sección. Solo si no hay nada que servir (o lo que hay pasa de 30 min) se
responde 503 con `Retry-After: 30`. Límite: 60 peticiones/min por IP.

> **`oroQuemado` va a `null` a propósito.** `LootGold` es un `ERC20Burnable` normal: `quemarDe`
> solo hace `_burn`, que baja `totalSupply` y emite `Transfer(de, 0x0, cantidad)`. **No hay
> contador acumulado en el contrato**, así que la única forma de saberlo sería sumar todos los
> eventos `Transfer` al `0x0` desde el despliegue, que es justo lo que el RPC público ya no
> sirve. Se dice en vez de inventar una cifra. Para tenerlo de verdad hace falta un
> `totalQuemado` en el contrato (decisión del equipo de contratos).

### Torre infinita: `POST /torre` y `GET /torre/ranking` (1.3)

`POST /torre` — body `{ "address": "0x...", "piso": 3, "turnos": 14 }`. Guarda el mejor piso de cada dirección.
- `piso`: pisos superados, entero 0..100000 (0 = no cambia nada); `turnos`: entero 0..10000000 (desempata el ranking: menos turnos, mejor).
- **El récord sube de uno en uno:** se acepta `piso ≤ récord + 1`. Por eso la web debe enviar `POST /torre` **al superar
  cada piso** (1, 2, 3…), no solo al caer; si no, una primera partida que llegue al piso 7 sería rechazada.

| Código | Cuerpo |
|---|---|
| 200 | `{ "ok": true, "record": 3, "nuevoRecord": true }` (si no mejora: `nuevoRecord: false` y `record` = el récord guardado) |
| 400 | `{ "error": "Dirección inválida" }` · `{ "error": "piso debe ser un entero entre 0 y 100000" }` · `{ "error": "turnos debe ser un entero entre 0 y 10000000" }` |
| 409 | `{ "error": "Piso no válido: tu récord es 2, solo puedes registrar hasta el piso 3", "maximo": 3 }` |
| 429 | `{ "error": "Demasiadas peticiones, espera N s" }` + `Retry-After` |

`GET /torre/ranking` → top 20, de más a menos piso:
```json
[ { "address": "0x7099...79C8", "piso": 12 }, { "address": "0x3C44...93BC", "piso": 9 } ]
```

**Límites:** `POST /torre` 300/hora por IP y 1 cada 2 s por dirección; `GET /torre/ranking` 60/minuto por IP.

> **Confianza en el cliente.** El servidor no rejuega los combates: solo exige subir de piso en piso.
> Es red de pruebas, así que basta. Los récords (hasta 50 000 direcciones) **se persisten desde la 1.4**: con
> `ALMACEN=upstash` el ranking de la torre sobrevive a los reinicios, y la defensa de "piso ≤ récord + 1" sigue
> contando desde el récord recuperado. Sin almacén externo se pierden al reiniciar.
> Ver [Persistencia](#persistencia).

## Cómo funciona

```
src/
  index.js      arranque: .env, comprobaciones de red/contrato, listen
  app.js        Express: rutas, validación, límites (dependencias inyectadas)
  loot.js       lógica PURA de drops (RNG inyectable)
  ranking.js    indexador de eventos on-chain para GET /ranking (1.2)
  recompensa.js motivos, cantidades, periodos y registro de reclamos de POST /recompensa (1.2)
  gas.js        grifo de ETH de prueba: reglas del tope diario y rutas /gas (1.3)
  torre.js      torre infinita: récords, ranking y rutas /torre (1.3)
  almacen.js    capa de almacenamiento intercambiable: memoria y Upstash Redis (1.4)
  persistencia.js  carga al arrancar y guardado agrupado de los registros (1.4)
  tesoreria.js  GET /tesoreria: el dinero del juego, cacheado y tolerante a fallos (1.4.1)
  redes.js      redes conocidas, comprobación de chainId y separación del estado por red (1.4.1)
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
Con pity, la tasa efectiva de Legendario en nivel 1 pasa del 5 % a ≈ 8,7 %. Acotado a 10 000 direcciones y
**persistido desde la 1.4**: con `ALMACEN=upstash` un reinicio de Render ya no pone el contador a cero.

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
incremental. **Desde la 1.4 el índice se persiste**: tras un reinicio se restaura y solo se leen los bloques
nuevos, en vez de reindexar desde `DEPLOY_BLOCK`. Ver [Persistencia](#el-caso-especial-del-ranking).

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
1.3: grifo de gas con provider simulado (umbral, 1 por día UTC, tope global, reserva de 0,002 ETH, fallo y reintento,
peticiones simultáneas, `GET /gas/:address`, `GAS_TOPE_DIARIO`), nonces en serie entre gas y mints con el mismo emisor,
primer botín Raro (también tras un mint fallido) y torre (subida de piso en piso, ranking, límites, validación).
1.4: capa de almacenamiento (misma interfaz en memoria y en Upstash contra un `fetch` falso que imita el API REST:
prefijos, Bearer, timeout, token rechazado, error en el cuerpo con HTTP 200, valor no-JSON), elección según el entorno,
**arranque degradado** (sin variables, token mal copiado, Upstash caído → memoria y `/health` lo publica),
ida y vuelta de los cinco registros, `restaurar()` frente a datos corruptos, guardado agrupado (50 cambios = 1 escritura),
reintento tras un fallo de escritura, caída del almacén en caliente sin afectar a las rutas, y un reinicio completo
comprobado a través de las rutas HTTP. Persistencia del ranking: ida y vuelta del índice, **el solape no duplica
eventos** (con el contraejemplo de qué pasaría sin guardar los ids de log), solo se releen los bloques nuevos,
rechazo de instantáneas de otro `DEPLOY_BLOCK`/contrato/versión, cuándo se marca para guardar, tope de tamaño,
y `GET /ranking` respondiendo 200 nada más reiniciar en vez del 503 de "sincronizando".
1.4.1: **regresión del 12-nov-2026** (un refresco fallido ya no deja el ranking en 503 eterno; progreso parcial
servible; 503 solo si no se indexó nada), clasificación de errores de historia podada frente a errores pasajeros,
salto hacia delante que mueve el *principio* del rango, huecos publicados en `/ranking` y en `/health`,
**detección de atasco** (el índice no avanza entre dos refrescos, con bloque, error y segundos sin avanzar),
tesorería (formato, caché, lecturas simultáneas compartidas, dato obsoleto cuando el RPC falla, recuperación,
`oroQuemado` declarado no disponible) y redes (normalización, chainId que no cuadra, prefijos que no se mezclan).

## Despliegue

> El servidor guarda la clave del owner: **despliégalo tú desde tu cuenta** y define los secretos solo en el panel del proveedor.
> Los límites de peticiones viven en memoria: usa **una sola instancia**. El estado del juego sí se persiste
> (ver [Persistencia](#persistencia)).

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
   (la URL de la web, p. ej. `https://usuario.github.io`) y, desde la 1.4, `UPSTASH_REDIS_REST_URL` y
   `UPSTASH_REDIS_REST_TOKEN` (ver [Persistencia](#persistencia); si se dejan en blanco el servicio arranca
   igual, en modo memoria). Se guardan cifrados en Render, nunca en el repo.
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
