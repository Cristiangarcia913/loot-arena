# Herramientas de calidad

Dos revisiones que corren con Node, sin navegador y sin dependencias. Complementan al arnés de
interfaz (`web/test/integracion/`), que es quien abre la página de verdad.

## `peso-recursos.mjs` — qué descarga un jugador al abrir el juego

```bash
node herramientas/peso-recursos.mjs            # resumen
node herramientas/peso-recursos.mjs --json     # para automatizar
```

Sigue `web/index.html`: resuelve los `<link rel=stylesheet>`, los `<script src>`, los `@import` del
CSS y toda la cadena de `import` de los módulos ES, y suma el tamaño en bruto y comprimido con gzip
(que es como lo sirven GitHub Pages y Render). Marca los recursos externos y las referencias rotas.

Objetivos que aplica: ≤ 45 peticiones, ≤ 1024 kB sin comprimir, ≤ 300 kB con gzip, ≤ 150 kB de
JavaScript con gzip, ≤ 60 kB de CSS con gzip. Sale con código 1 si hay referencias rotas.

Limitación conocida: solo ve los `import` y las `new URL("…json")` escritos con una cadena literal.
Los ABI que `config/config.js` pide con un nombre variable no aparecen; el peso real, medido en el
navegador, lo da `rendimiento.js` del arnés.

## `revisar-html.mjs` — revisión estática del HTML

```bash
node herramientas/revisar-html.mjs             # web/index.html
node herramientas/revisar-html.mjs web/*.html  # también las demos
node herramientas/revisar-html.mjs --json
```

Lo que se puede ver sin abrir un navegador, ordenado por gravedad:

- `lang`, `<title>`, `<meta viewport>`
- ids repetidos (rompen `aria-labelledby`, `<label for>` y `getElementById`)
- elementos interactivos sin nombre accesible
- `<input>` sin `<label for>`
- `<img>` sin `alt`
- jerarquía de encabezados (sin `h1`, varios `h1`, saltos de nivel)
- `aria-labelledby` / `aria-controls` / `aria-describedby` que apuntan a ids inexistentes
- `<a target="_blank">` sin `rel="noopener"`
- `role="progressbar"` sin `aria-valuenow`
- `aria-modal="true"` fuera de un `<dialog>` (hay que atrapar el foco a mano)
- `tabindex` positivo

Sale con código 1 si encuentra algo crítico o alto, así que sirve tal cual en un gancho de CI.

## Lo que mide cada cosa

| Pregunta | Dónde se contesta |
|---|---|
| ¿Funciona la página? | `web/test/integracion/` (arnés, navegador) |
| ¿Cuánto tarda y a cuántos fps va? | `web/test/integracion/rendimiento.js` |
| ¿Es accesible la página viva? | `web/test/integracion/accesibilidad.js` |
| ¿Es accesible el marcado? | `herramientas/revisar-html.mjs` |
| ¿Cuánto pesa la descarga? | `herramientas/peso-recursos.mjs` |
| ¿Funciona la lógica? | `web/test/*.test.js`, `server/test/`, `contracts/test/` |
