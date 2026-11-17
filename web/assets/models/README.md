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
| _(ninguno todavía)_ | | |

## Qué pasa si lo pones

El modelo sustituye la malla entera (altura y pivote en los pies se recalculan solos). El equipo
visual del héroe (espada, escudo, cosméticos...) y las piezas con nombre que anima `escena3d.js`
(alas, cola, cabeza...) son cosa de la receta procedural: un modelo importado no los tiene, así
que esa criatura concreta pierde esos detalles hasta que alguien los añada a mano.
