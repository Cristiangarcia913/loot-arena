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
| `golem.gltf` | ["Golem Knight"](https://opengameart.org/content/golem-knight) (OpenGameArt), `golem.gltf` del paquete usado tal cual (un único archivo con texturas y buffers embebidos en base64, exportado de Blockbench; no hace falta `obj2gltf`) | CC0 1.0 (dominio público, sin atribución obligatoria) |

**`orco.glb` y `quimera.glb` no existen todavía.** Se buscó en OpenGameArt/Kenney/Quaternius (tras
descartar una fuente sin reputación verificable que sí los tenía) y no apareció ningún modelo CC0
utilizable: para el orco, solo había estilos incompatibles (voxel tipo Minecraft) o criaturas que
no son un orco de verdad (goblin, vikingo humano, zombi — ya usados o con la especie equivocada);
para la quimera, el único candidato real (`Hydrach`, CC0 en OpenGameArt) viene empaquetado en
`.rar`, formato que no se pudo abrir con las herramientas disponibles. Ambas criaturas se quedan
con su receta procedural de `criaturas.js`, que es el comportamiento seguro por defecto de este
sistema. Si aparece un modelo CC0/MIT válido para cualquiera de las dos, añadirlo con el mismo
nombre de clave (`orco.glb`/`orco.gltf`, `quimera.glb`/`quimera.gltf`) basta para que el motor lo
recoja solo.

**Fallo conocido de `golem.gltf`: a veces no se ve.** Verificado en el navegador (motor de
producción, `cargarModeloExterno` + `criaturaDesdeModelo` + `aplicarEnemigo`, sin atajos): en
~50% de las veces que aparece como enemigo, no se dibuja ni un píxel suyo — la arena queda vacía,
sin ningún error en consola. Se investigó a fondo antes de aceptar esto:

- La malla se carga y se mide bien siempre: 16 mallas, 2060 vértices, texturas (128×128 a
  256×256) totalmente decodificadas, posición y escala del pivote idénticas entre el caso que
  falla y el que funciona.
- El fotograma que falla SÍ llega a mandar la orden de dibujar: 50 `drawCalls`, 13.344 triángulos,
  las 16 mallas dentro del frustum de la cámara — tal cual el fotograma que sí se ve.
- No es un problema de licencia, geometría, textura, posición, tween de entrada (termina
  normalmente) ni frustum culling: todo eso se comprobó directamente en el motor real y salió
  idéntico en ambos casos.

Apunta a un problema de estado de la GPU (profundidad, cara visible o mezcla) que cambia entre
fotogramas — para seguir hace falta un inspector de fotogramas WebGL (Spector.js/RenderDoc), que
no estaba disponible al investigarlo. Se deja el archivo puesto (en partidas reales el jugador
tarda minutos en llegar al nivel 7, de sobra para que todo se asiente) pero si alguien lo
reproduce con herramientas de verdad, esto es el punto de partida.

## Qué pasa si lo pones

El modelo sustituye la malla entera (altura y pivote en los pies se recalculan solos). El equipo
visual del héroe (espada, escudo, cosméticos...) y las piezas con nombre que anima `escena3d.js`
(alas, cola, cabeza...) son cosa de la receta procedural: un modelo importado no los tiene, así
que esa criatura concreta pierde esos detalles hasta que alguien los añada a mano.
