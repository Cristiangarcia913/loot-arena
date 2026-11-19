# Modelos externos (opcional)

Esta carpeta es para modelos `.glb`/`.gltf` que sustituyen la malla procedural de una criatura
(ver `web/js/render3d/modelos.js` y `web/js/render3d/criaturas.js`). **No hace falta que haya
nada aquí**: si un archivo no existe, el motor construye esa criatura por código, igual que
siempre (decisión 3 del plan maestro, revisada en `PLAN-MAESTRO.md`).

**El héroe es la única excepción: nunca pide `heroe.glb`.** `construirHeroe` sabe atender un
modelo externo (y `render3d-modelos.test.js` lo comprueba), pero `escena3d.js` ya no lo pide en
`arrancar()`. Un `.glb` sustituye la malla ENTERA y se lleva por delante las piezas con nombre que
anima el equipo (mano de la espada, asa del escudo, cresta del casco...), así que equipar o
desequipar algo deja de notarse en pantalla. Hasta que exista un modelo de gladiador que traiga
esas piezas con los nombres que espera `criaturas.js`, el héroe se queda con la receta procedural
de `construirHeroe` (en `criaturas.js`), que sí sabe pintar cada arma y pieza de armadura con el
color de su rareza.

## Cómo añadir uno

1. El nombre del archivo es la clave de la criatura en minúsculas: `dragon.glb` para el dragón,
   `jefe.glb` para el jefe propio, etc. (`.gltf` también vale si no hay `.glb`). **`heroe.glb` no
   se usa** (ver arriba), así que no lo añadas aunque `modelos.js`/`criaturas.js` sepan leerlo.
2. **Antes de añadir cualquier archivo, comprueba su licencia** (en CGTrader o donde sea): tiene
   que permitir el uso en este proyecto (incluido publicarlo en GitHub Pages). Si la licencia no
   lo deja claro, no se usa.
3. Apunta aquí mismo, en una línea de esta tabla, de dónde sale cada modelo y qué licencia tiene:

| Archivo | Origen | Licencia |
|---|---|---|
| `dragon.glb` | [Cethiel's Dragon 3D](https://opengameart.org/content/cethiels-dragon-3d) (Drummyfish, OpenGameArt), malla `dragon.obj`+textura convertida a `.glb` con `obj2gltf` (sin los clips de animación Collada del paquete original, que el motor no carga) | CC0 1.0 (dominio público, sin atribución obligatoria) |
| `esqueleto.glb` | ["LowPoly Animated Monsters"](https://opengameart.org/content/lowpoly-animated-monsters) (Quaternius, OpenGameArt), malla `Skeleton.obj`+textura del paquete, convertida a `.glb` con `obj2gltf` (sin los clips de animación Blend del paquete original, que el motor no carga) | CC0 1.0 (dominio público, sin atribución obligatoria) |
| `lobo.glb` | ["Animated Animales Low Poly"](https://opengameart.org/content/animated-animales-low-poly) (Quaternius, OpenGameArt), malla `Wolf.obj`+textura del paquete, convertida a `.glb` con `obj2gltf` (sin los clips de animación Blend del paquete original, que el motor no carga) | CC0 1.0 (dominio público, sin atribución obligatoria) |
| `murcielago.glb` | ["LowPoly Animated Monsters"](https://opengameart.org/content/lowpoly-animated-monsters) (Quaternius, OpenGameArt — el mismo paquete de `esqueleto.glb`), malla `Bat.obj` (sin textura: colores planos por material, como el esqueleto) convertida a `.glb` con `obj2gltf` | CC0 1.0 (dominio público, sin atribución obligatoria) |
| `limo.glb` | ["LowPoly Animated Monsters"](https://opengameart.org/content/lowpoly-animated-monsters) (Quaternius, OpenGameArt — el mismo paquete de `esqueleto.glb`), malla `Slime.obj` (sin textura: colores planos por material) convertida a `.glb` con `obj2gltf` | CC0 1.0 (dominio público, sin atribución obligatoria) |

**`orco.glb` y `quimera.glb` siguen sin existir — sustituidos por `murcielago.glb` y `limo.glb`.**
Tercer intento, esta vez en sitios nuevos (Sketchfab con su filtro de licencia CC0 vía la propia
API pública, Free3D, CGTrader, Clara.io e itch.io otra vez con términos más amplios: también se
aceptaba un troll, ogro o bárbaro para el orco, y una hidra o cualquier bestia mítica de varias
cabezas para la quimera, no solo el animal exacto). Resultado, verificado consultando la licencia
real de cada ficha, no por fama del sitio ni texto de búsqueda:

- **Sketchfab**, filtrando por licencia CC0 de verdad: para *orc*, *troll*, *ogre*, *barbarian*,
  *minotaur*, *chimera*, *manticore*, *hydra*, *wyvern* y *beast* el resultado fue, prácticamente
  entero, escaneos de museo (artsmia, Cleveland Museum, Smithsonian...) de jarrones, vasijas,
  lápidas y flores — nada parecido a una criatura de fantasía jugable, y con cientos de miles de
  triángulos cuando aparecía algo con forma de bestia (el único "Mythological Beast" real son
  200 000 caras de una pieza china del siglo V a. C., ni es una quimera ni cabría en el
  presupuesto 3D del juego). Un vistazo a *Orc Bloodlust* (CC Attribution) y a toda la familia
  Manticore/Hydra de otros autores confirmó que lo único con pinta correcta es CC-BY (atribución
  obligatoria), no CC0.
- **CGTrader**: cada orco libre encontrado usa la licencia propia de CGTrader ("Royalty Free"),
  que no es lo mismo que CC0/dominio público y no se ajusta a la regla de este README.
- **itch.io**: el "orc axe enemy" de Summer Engine, que un resultado de búsqueda describía como
  CC0, resultó ser `"licenseType":"attribution"` al mirar los datos reales de la página (CC-BY, no
  CC0). La "Mythic Beastiary Collection" (con una criatura con cuernos que podría valer de orco)
  no declara ninguna licencia en la página y además admite ser generada con IA y retocada a mano,
  así que no pasa el filtro de licencia clara de este README por partida doble.
- **Free3D y Clara.io**: ninguna búsqueda encontró una ficha de orco o quimera con CC0/dominio
  público declarado; son bibliotecas sin filtro de licencia fiable para comprobarlo en bloque.

No apareció ningún candidato nuevo que pasara el filtro de licencia en ninguno de los dos casos.
En vez de forzar una sustitución de mala calidad o dejar las dos claves vacías, el intento
anterior ya había cubierto dos claves del bestiario que SÍ estaban sin modelo con contenido del
mismo paquete CC0 ya verificado: el murciélago (`murcielago`) y el limo ácido (`limo`). `orco` y
`quimera` se quedan con su receta procedural de `criaturas.js`, que es el comportamiento seguro
por defecto de este sistema — y, a estas alturas, tras tres búsquedas distintas en las webs de
assets CC0/MIT más relevantes (OpenGameArt, Kenney, Quaternius, Poly Pizza, Sketchfab, CGTrader,
Free3D, Clara.io, itch.io), es razonable asumir que no hay un modelo real adecuado disponible
gratis para ninguna de las dos claves. Si en el futuro aparece uno con licencia CC0/MIT clara,
añadirlo con el mismo nombre de clave (`orco.glb`/`orco.gltf`, `quimera.glb`/`quimera.gltf`)
basta para que el motor lo recoja solo.

**`golem.gltf` se retiró — el gólem se queda con su receta procedural.** Había estado puesto con
["Golem Knight"](https://opengameart.org/content/golem-knight) (OpenGameArt, CC0), pero verificado
en el navegador (motor de producción, `cargarModeloExterno` + `criaturaDesdeModelo` +
`aplicarEnemigo`, sin atajos): en ~50% de las veces que aparecía como enemigo no se dibujaba ni un
píxel suyo — la arena quedaba vacía, sin ningún error en consola. Se investigó a fondo antes de
retirarlo:

- La malla se cargaba y medía bien siempre: 16 mallas, 2060 vértices, texturas (128×128 a
  256×256) totalmente decodificadas, posición y escala del pivote idénticas entre el caso que
  fallaba y el que funcionaba.
- El fotograma que fallaba SÍ llegaba a mandar la orden de dibujar: 50 `drawCalls`, 13.344
  triángulos, las 16 mallas dentro del frustum de la cámara — tal cual el fotograma que sí se veía.
- No era un problema de licencia, geometría, textura, posición, tween de entrada (terminaba
  normalmente) ni frustum culling: todo eso se comprobó directamente en el motor real y salió
  idéntico en ambos casos.

Apuntaba a un problema de estado de la GPU (profundidad, cara visible o mezcla) que cambiaba entre
fotogramas, y para seguir hacía falta un inspector de fotogramas WebGL (Spector.js/RenderDoc) que
no estaba disponible. Un enemigo que desaparece la mitad de las veces que sale (incluido como
jefe de la Arena, ver `CLAVES_JEFE_ARENA` en `combat.js`) no es aceptable, así que en vez de seguir
dejándolo puesto se retiró el archivo: `golem` queda igual que `orco`/`quimera` más abajo, sin
`.glb`, con su receta a mano en `criaturas.js` (bloques de roca angulares con `flatShading`,
grietas de magma emisivas y ojos encendidos), que SIEMPRE se ve. Si algún día aparece una versión
corregida del modelo (o uno nuevo con licencia clara), añadirlo de nuevo como `golem.glb`/
`golem.gltf` basta para que el motor lo recoja — pero antes de hacerlo, confirmar con un inspector
de fotogramas de verdad que el problema de arriba no reaparece.

## Qué pasa si lo pones

El modelo sustituye la malla entera (altura y pivote en los pies se recalculan solos). El equipo
visual del héroe (espada, escudo, cosméticos...) y las piezas con nombre que anima `escena3d.js`
(alas, cola, cabeza...) son cosa de la receta procedural: un modelo importado no los tiene, así
que esa criatura concreta pierde esos detalles hasta que alguien los añada a mano.
