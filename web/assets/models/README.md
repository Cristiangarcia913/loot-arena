# Modelos externos (opcional)

Esta carpeta es para modelos `.glb`/`.gltf` que sustituyen la malla procedural de una criatura
(ver `web/js/render3d/modelos.js` y `web/js/render3d/criaturas.js`). **No hace falta que haya
nada aquí**: si un archivo no existe, el motor construye esa criatura por código, igual que
siempre (decisión 3 del plan maestro, revisada en `PLAN-MAESTRO.md`).

## Cómo añadir uno

1. El nombre del archivo es la clave de la criatura en minúsculas: `heroe.glb` para el héroe,
   `dragon.glb` para el dragón, `jefe.glb` para el jefe propio, etc. (`.gltf` también vale si no
   hay `.glb`).
2. **Antes de añadir cualquier archivo, comprueba su licencia** (en CGTrader o donde sea): tiene
   que permitir el uso en este proyecto (incluido publicarlo en GitHub Pages). Si la licencia no
   lo deja claro, no se usa.
3. Apunta aquí mismo, en una línea de esta tabla, de dónde sale cada modelo y qué licencia tiene:

| Archivo | Origen | Licencia |
|---|---|---|
| `heroe.glb` | [KhronosGroup/glTF-Sample-Assets — "RiggedFigure"](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/RiggedFigure) | CC-BY-4.0 (requiere atribución, uso libre incluida publicación en GitHub Pages) |

## Qué pasa si lo pones

El modelo sustituye la malla entera (altura y pivote en los pies se recalculan solos). El equipo
visual del héroe (espada, escudo, cosméticos...) y las piezas con nombre que anima `escena3d.js`
(alas, cola, cabeza...) son cosa de la receta procedural: un modelo importado no los tiene, así
que esa criatura concreta pierde esos detalles hasta que alguien los añada a mano.
