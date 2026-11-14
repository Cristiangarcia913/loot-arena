// Pintado de la sección «Cadena». Aquí vive el DOM y nada más: los datos los preparan
// lectura.js, eventos.js, desglose.js y datos.js, que son puros y están cubiertos por tests.
//
// Todo el texto entra con textContent (vía `h`), porque los nombres de objetos y los motivos
// de las recompensas vienen de la cadena y no son de fiar como HTML.

import { h } from "../dom-secciones.js";
import { formatearEth, formatearOro } from "../economy.js";
import { corta, fechaTexto } from "./eventos.js";
import { QUEMADO, ACUNADO, VALIDADOR } from "./desglose.js";

const ORO = (u, d = 2) => (u == null ? "—" : `${formatearOro(u, { decimales: d })} ORO`);
const ETH = (w, d = 6) => (w == null ? "—" : `${formatearEth(w, { decimales: d })} ETH`);

/** Enlaces al explorador público de la red (null si la red no tiene explorador). */
export function enlaces(net) {
  const base = net?.blockExplorerUrls?.[0];
  if (!base) return { tx: () => null, dir: () => null, token: () => null };
  return {
    tx: (hash) => `${base}/tx/${hash}`,
    dir: (d) => `${base}/address/${d}`,
    token: (contrato, id) => `${base}/nft/${contrato}/${id}`,
  };
}

const enlaceExt = (href, texto, clase = "cad-enlace") =>
  href ? h("a", { class: clase, href, target: "_blank", rel: "noopener noreferrer" }, texto) : h("span", { class: "cad-apagado" }, texto);

/** Fila de dato: etiqueta a la izquierda, valor a la derecha. */
export const dato = (etiqueta, valor, extra = null) =>
  h("div", { class: "cad-dato" },
    h("span", { class: "cad-etiqueta" }, etiqueta),
    h("span", { class: "cad-valor" }, valor ?? "—"),
    extra);

export const aviso = (texto, tipo = "info") =>
  h("p", { class: `cad-aviso cad-aviso-${tipo}` }, texto);

export const cargando = (texto = "Leyendo la cadena…") =>
  h("p", { class: "cad-cargando", role: "status" }, texto);

export const titulo = (t, sub = null) =>
  h("header", { class: "cad-cabecera" }, h("h3", {}, t), sub ? h("p", { class: "cad-sub" }, sub) : null);

/** Dirección con enlace al explorador y botón de copiar. */
export function direccion(d, net, { etiqueta = null } = {}) {
  if (!d) return h("span", { class: "cad-apagado" }, "—");
  const e = enlaces(net);
  return h("span", { class: "cad-dir" },
    etiqueta ? h("span", { class: "cad-dir-etiqueta" }, etiqueta) : null,
    enlaceExt(e.dir(d), corta(d), "cad-enlace cad-mono"),
    h("button", {
      class: "cad-copiar", type: "button", title: `Copiar ${d}`, "aria-label": `Copiar la dirección ${d}`,
      onclick: async (ev) => {
        try {
          await navigator.clipboard.writeText(d);
          const b = ev.currentTarget;
          b.classList.add("copiado");
          setTimeout(() => b.classList.remove("copiado"), 1200);
        } catch { /* sin permiso de portapapeles: no pasa nada */ }
      },
    }, "⧉"));
}

// ───────────────────────── E1.1 Tu cartera ─────────────────────────

export function pintarCartera(cartera, { net, red, chainId, comparacion, conectada }) {
  const caja = h("div", { class: "cad-bloque" });
  caja.append(
    titulo("Tu cartera en la cadena",
      conectada ? "Leído del contrato en vivo, no del estado local del juego."
        : "Sin cartera conectada: se muestra la dirección que estás consultando."),
    h("div", { class: "cad-rejilla" },
      dato("Dirección", direccion(cartera.direccion, net)),
      dato("Red", `${net?.chainName ?? red} (chainId ${chainId ?? net?.chainId ?? "?"})`),
      dato("ETH", ETH(cartera.eth)),
      dato("ORO", ORO(cartera.oro)),
      dato("Objetos (ERC-721)", cartera.totalObjetos ?? "—"),
      dato("Cosméticos (ERC-1155)", cartera.cosmeticos.reduce((a, c) => a + c.cantidad, 0) || 0)),
  );

  if (comparacion && !comparacion.coincide) {
    caja.append(h("div", { class: "cad-discrepancia" },
      h("strong", {}, "La cadena y el juego no dicen lo mismo:"),
      h("ul", {}, comparacion.diferencias.map((d) => h("li", {}, d)))));
  } else if (comparacion) {
    caja.append(aviso("El estado local del juego cuadra con la cadena.", "ok"));
  }

  caja.append(h("h4", { class: "cad-subtitulo" }, `Objetos (${cartera.objetos.length}${cartera.totalObjetos > cartera.objetos.length ? ` de ${cartera.totalObjetos}` : ""})`));
  caja.append(cartera.objetos.length
    ? tabla(["#", "Nombre", "Tipo", "Rareza", "Ataque", "Defensa", ""],
        cartera.objetos.map((o) => [
          String(o.tokenId), o.nombre, o.tipo, o.rarezaTexto, String(o.ataque), String(o.defensa),
          enlaceExt(enlaces(net).token(cartera.contratoObjetos ?? "", o.tokenId), "ver", "cad-enlace"),
        ]))
    : aviso("Esta dirección no tiene ningún objeto del juego.", "info"));

  if (cartera.cosmeticos.length) {
    caja.append(h("h4", { class: "cad-subtitulo" }, "Cosméticos"));
    caja.append(tabla(["#", "Nombre", "Cantidad"], cartera.cosmeticos.map((c) => [String(c.id), c.nombre, String(c.cantidad)])));
  }
  for (const a of cartera.avisos ?? []) caja.append(aviso(a, "info"));
  return caja;
}

// ───────────────────────── E1.2 Tus transacciones ─────────────────────────

export function pintarTransacciones(txs, {
  net, recortado, fallos, bloqueDespliegue, bloqueActual,
  limitadoPorRpc = false, desdeDisponible = null, completo = true, onCargarTodo = null,
}) {
  const caja = h("div", { class: "cad-bloque" });
  const leidoDesde = desdeDisponible ?? bloqueDespliegue;
  caja.append(titulo("Tus transacciones en el juego",
    `Reconstruidas de los eventos de nuestros contratos con getLogs, del bloque ${leidoDesde ?? "?"} al ${bloqueActual ?? "?"}. Sin API de pago ni claves.`));

  // Lo importante que hay que decir sin adornos: el RPC público de Sepolia solo conserva los
  // logs de las últimas ~10 000 bloques (unas 33 horas). Más atrás no es que falle: es que
  // no los tiene. Fingir que el historial está completo sería mentir.
  if (limitadoPorRpc) {
    const faltan = leidoDesde != null && bloqueDespliegue != null ? leidoDesde - bloqueDespliegue : null;
    const horas = faltan && faltan > 0 ? Math.round((faltan * 12) / 3600) : null;
    const caja2 = h("div", { class: "cad-discrepancia" },
      h("strong", {}, "Esto no es todo tu historial."),
      h("p", { class: "cad-parrafo" },
        `El RPC público de Sepolia solo guarda los eventos recientes: se ha podido leer desde el bloque ${leidoDesde}`,
        faltan && faltan > 0
          ? `, así que se quedan fuera los ${faltan.toLocaleString("es-ES")} bloques que van desde el despliegue del contrato (${bloqueDespliegue}) hasta ahí, unas ${horas} horas de juego`
          : "",
        ". No es un fallo del juego ni de tu conexión: ese nodo no conserva los logs antiguos, y el proyecto no usa servicios de pago con clave de API."),
      h("p", { class: "cad-parrafo" },
        "Para el historial completo hace falta un indexador: el servidor del juego sí puede guardar los eventos según ocurren. Mientras tanto, cada transacción suelta se puede comprobar por su hash en el explorador público, que sí tiene toda la historia."));
    if (onCargarTodo) {
      caja2.append(h("button", {
        class: "btn btn-small btn-ghost", type: "button",
        onclick: (ev) => { ev.currentTarget.disabled = true; onCargarTodo(); },
      }, "Intentarlo igualmente desde el despliegue"));
    }
    caja.append(caja2);
  } else if (completo) {
    caja.append(aviso(`Historial completo: leído desde el bloque del despliegue (${bloqueDespliegue}).`, "ok"));
  }

  if (recortado) caja.append(aviso("El rango de bloques era demasiado grande para el RPC público: se muestran los más recientes.", "info"));
  if (fallos > 0) caja.append(aviso(`${fallos} tramo(s) de bloques no respondieron (fallo pasajero del RPC): puede faltar algo. Prueba a volver a leer.`, "aviso"));

  if (!txs.length) {
    caja.append(aviso(
      limitadoPorRpc
        ? "No hay transacciones de esta dirección en el tramo que el RPC conserva. Puede que las haya más atrás."
        : "No hay ninguna transacción de esta dirección en nuestros contratos. Si has jugado en modo demo, no hay nada en la cadena todavía.",
      "info"));
    return caja;
  }

  const e = enlaces(net);
  const lista = h("ol", { class: "cad-historial" });
  for (const tx of txs) {
    const neto = [];
    if (tx.oro !== 0n) neto.push(h("span", { class: `cad-neto ${tx.oro > 0n ? "pos" : "neg"}` }, `${tx.oro > 0n ? "+" : "−"}${ORO(tx.oro < 0n ? -tx.oro : tx.oro)}`));
    if (tx.eth !== 0n) neto.push(h("span", { class: `cad-neto ${tx.eth > 0n ? "pos" : "neg"}` }, `${tx.eth > 0n ? "+" : "−"}${ETH(tx.eth < 0n ? -tx.eth : tx.eth)}`));
    lista.append(h("li", { class: "cad-tx" },
      h("div", { class: "cad-tx-fila" },
        h("span", { class: "cad-tx-titulo" }, tx.titulo),
        h("span", { class: "cad-tx-neto" }, neto)),
      h("div", { class: "cad-tx-meta" },
        h("span", {}, fechaTexto(tx.fecha)),
        h("span", {}, `bloque ${tx.bloque}`),
        enlaceExt(e.tx(tx.hash), "ver en el explorador")),
      h("details", { class: "cad-tx-detalle" },
        h("summary", {}, "Qué movió exactamente"),
        h("ul", {}, tx.detalle.map((d) => h("li", {}, d))))));
  }
  caja.append(lista);
  return caja;
}

// ───────────────────────── E1.3 Los demás jugadores ─────────────────────────

export function pintarRivales(rivales, { net, sinFuentes }) {
  const caja = h("div", { class: "cad-bloque" });
  caja.append(titulo("Los demás jugadores",
    "Información pública de la cadena: cualquiera puede leer el saldo y los objetos de cualquier dirección."));

  if (sinFuentes) {
    caja.append(aviso("Todavía no te has cruzado con nadie. Juega la torre o entra al mercado y aquí aparecerán los rivales.", "info"));
    return caja;
  }
  if (!rivales.length) {
    caja.append(aviso("No se pudo leer a ningún rival ahora mismo.", "aviso"));
    return caja;
  }

  const lista = h("div", { class: "cad-rivales" });
  for (const r of rivales) {
    lista.append(h("article", { class: "cad-rival" },
      h("header", {}, direccion(r.direccion, net, { etiqueta: r.alias ?? null })),
      h("div", { class: "cad-rejilla cad-rejilla-estrecha" },
        dato("ORO", ORO(r.oro)),
        dato("ETH", ETH(r.eth, 4)),
        dato("Objetos", r.objetos ?? "—"),
        dato("Victorias", r.victorias ?? "—", r.victorias != null ? h("span", { class: "cad-fuente" }, "del servidor, no de la cadena") : null)),
      r.muestra?.length
        ? h("ul", { class: "cad-muestra" }, r.muestra.map((m) => h("li", {}, `${m.nombre} · ${m.rarezaTexto}`)))
        : null));
  }
  caja.append(lista);
  caja.append(aviso("Las victorias las lleva el servidor del juego (no están en la cadena); el oro y los objetos sí son de la cadena.", "info"));
  return caja;
}

// ───────────────────────── E3 Tesorería ─────────────────────────

export function pintarTesoreria(t, { net, cuenta, permiso, onRetirar }) {
  const caja = h("div", { class: "cad-bloque" });
  caja.append(titulo("El dinero del juego",
    t.fuente === "servidor" ? "Resumen servido por el servidor (cacheado) y comprobable en el contrato."
      : "Leído directamente de los contratos por el RPC público."));

  caja.append(h("div", { class: "cad-rejilla" },
    dato("ETH en la caja del Mercado", ETH(t.cajaEth), h("span", { class: "cad-fuente" }, "Mercado.cajaEth()")),
    dato("ETH de la cartera del servidor", ETH(t.ethOperador), h("span", { class: "cad-fuente" }, "paga el gas de recompensas y del grifo")),
    dato("ORO en circulación", ORO(t.oroCirculacion), h("span", { class: "cad-fuente" }, "LootGold.totalSupply()")),
    dato("ORO quemado",
      t.oroQuemado?.alcance ? ORO(t.oroQuemado.valor) : "—",
      h("span", { class: "cad-fuente" },
        t.oroQuemado?.alcance === "completo" ? "total desde el despliegue"
          : t.oroQuemado?.alcance === "parcial" ? `solo desde el bloque ${t.oroQuemado.desdeBloque}` : "hace falta el servidor")),
    t.oroQuemadoP2P != null ? dato("ORO quemado en comisiones P2P", ORO(t.oroQuemadoP2P), h("span", { class: "cad-fuente" }, "MercadoP2P.oroQuemado(), exacto")) : null,
    dato("Objetos destruidos", t.objetosDestruidos ?? "—", h("span", { class: "cad-fuente" }, "NFT que están en 0x…dEaD")),
    dato("Objetos acuñados", t.objetosAcunados ?? "—", h("span", { class: "cad-fuente" }, "GameItem.totalMinted()"))));

  caja.append(h("h4", { class: "cad-subtitulo" }, "Quién manda en esos contratos"));
  caja.append(h("div", { class: "cad-rejilla" },
    dato("Dueño (puede retirar)", direccion(t.owner, net), h("span", { class: "cad-fuente" }, "Mercado.owner()")),
    dato("Cartera del servidor", direccion(t.operador, net), h("span", { class: "cad-fuente" }, "Recompensas.operador()"))));

  caja.append(h("h4", { class: "cad-subtitulo" }, "Cómo se saca el dinero"));
  caja.append(h("p", { class: "cad-parrafo" },
    "El ETH de la caja sale con ", h("code", {}, "Mercado.retirarEth(cantidad)"),
    ", que está marcada ", h("code", {}, "onlyOwner"),
    ": la transacción solo la puede firmar la dirección de arriba. Cualquier otra cuenta que lo intente recibe un rechazo del contrato, no una transferencia. ",
    "El ORO no se puede «sacar»: no hay ninguna función que mueva el ORO de los jugadores, y las comisiones no se acumulan en ninguna cartera porque se queman."));

  caja.append(h("p", { class: `cad-permiso ${permiso.puede ? "si" : "no"}` }, permiso.motivo));
  if (permiso.puede) caja.append(formRetirada(t, onRetirar));

  for (const a of t.avisos ?? []) caja.append(aviso(a, "info"));
  return caja;
}

function formRetirada(t, onRetirar) {
  const campo = h("input", {
    class: "cad-input", type: "text", inputmode: "decimal", placeholder: "0.01",
    "aria-label": "Cantidad de ETH a retirar",
  });
  const estado = h("p", { class: "cad-estado", role: "status" });
  const boton = h("button", { class: "btn btn-peligro", type: "submit" }, "Retirar de la caja");
  return h("form", {
    class: "cad-retirada",
    onsubmit: async (ev) => {
      ev.preventDefault();
      const texto = campo.value.trim().replace(",", ".");
      if (!/^\d+(\.\d+)?$/.test(texto) || Number(texto) <= 0) {
        estado.textContent = "Escribe una cantidad en ETH mayor que 0 (por ejemplo 0.01).";
        return;
      }
      boton.disabled = true;
      estado.textContent = "Confirma en MetaMask…";
      try {
        const r = await onRetirar(texto);
        estado.textContent = r?.mensaje ?? "Retirada enviada.";
      } catch (e) {
        estado.textContent = e?.mensaje ?? e?.message ?? "No se pudo retirar.";
      } finally {
        boton.disabled = false;
      }
    },
  },
    h("label", { class: "cad-label" }, "Cantidad en ETH", campo),
    boton,
    h("p", { class: "cad-mini" }, `Tope: lo que haya en la caja (${ETH(t.cajaEth)}).`),
    estado);
}

// ───────────────────────── E2 Desglose ─────────────────────────

/**
 * Pinta un desglose (previsión o recibo). Si se pasan los dos y la comparación, se ve
 * lo prometido junto a lo ocurrido: la verificación de la fase E2.
 */
export function pintarDesglose(d, { net, comparacion = null, compacto = false } = {}) {
  const caja = h("div", { class: `cad-desglose${compacto ? " compacto" : ""}` });
  caja.append(h("h4", { class: "cad-subtitulo" }, d.titulo));
  caja.append(h("ul", { class: "cad-flujos" }, d.flujos.map((f) => h("li", { class: `cad-flujo cad-${f.clase}` }, f.texto))));

  if (d.reparto?.length) {
    caja.append(h("h5", { class: "cad-subtitulo-mini" }, "Quién acaba con el dinero"));
    caja.append(tabla(["Quién", "ORO", "ETH"], d.reparto.map((r) => [
      r.quien,
      r.oro === 0n ? "—" : `${r.oro > 0n ? "+" : "−"}${ORO(r.oro < 0n ? -r.oro : r.oro)}`,
      r.eth === 0n ? "—" : `${r.eth > 0n ? "+" : "−"}${ETH(r.eth < 0n ? -r.eth : r.eth)}`,
    ]), { clases: (r) => (r[0] === QUEMADO || r[0] === ACUNADO ? "cad-fila-especial" : r[0] === VALIDADOR ? "cad-fila-gas" : "") }));
  }
  if (d.gas != null) {
    caja.append(h("p", { class: "cad-mini" }, `Gas: ${ETH(d.gas)}. Lo cobra el validador que mina el bloque, no el juego.`));
  }
  for (const a of d.avisos ?? []) caja.append(aviso(a, "info"));

  if (comparacion) {
    caja.append(h("h5", { class: "cad-subtitulo-mini" }, "Lo anunciado frente a lo ocurrido"));
    caja.append(h("p", { class: `cad-veredicto ${comparacion.coincide ? "ok" : "mal"}` },
      comparacion.coincide
        ? "Cuadra: el contrato movió el dinero exactamente a donde se anunció."
        : "No cuadra. El contrato no hizo lo que se anunció:"));
    if (!comparacion.coincide) caja.append(h("ul", {}, comparacion.diferencias.map((x) => h("li", {}, x))));
    caja.append(tabla(["Quién", "Anunciado", "Ocurrido", ""], comparacion.lineas.map((l) => [
      l.quien, l.previsto, l.real, l.igual ? "✓" : "✗",
    ]), { clases: (r) => (r[3] === "✓" ? "cad-fila-ok" : "cad-fila-mal") }));
  }
  return caja;
}

// ───────────────────────── utilidades ─────────────────────────

/** Tabla simple. `filas` es un array de arrays de strings o nodos. */
export function tabla(cabeceras, filas, { clases = null } = {}) {
  return h("div", { class: "cad-tabla-caja" },
    h("table", { class: "cad-tabla" },
      h("thead", {}, h("tr", {}, cabeceras.map((c) => h("th", {}, c)))),
      h("tbody", {}, filas.map((f) => h("tr", { class: clases ? clases(f) : null }, f.map((c) => h("td", {}, c)))))));
}

/** Pestañas accesibles. Devuelve {nodo, mostrar(id)}. */
export function pestanas(defs, { onCambio } = {}) {
  const botones = new Map();
  const paneles = new Map();
  const barra = h("div", { class: "cad-pestanas", role: "tablist" });
  const cuerpo = h("div", { class: "cad-cuerpo" });

  const mostrar = (id) => {
    for (const [k, b] of botones) {
      const activo = k === id;
      b.setAttribute("aria-selected", activo ? "true" : "false");
      b.classList.toggle("activa", activo);
      b.tabIndex = activo ? 0 : -1;
      paneles.get(k).hidden = !activo;
    }
    onCambio?.(id);
  };

  for (const d of defs) {
    const panel = h("div", { class: "cad-panel", role: "tabpanel", id: `cad-panel-${d.id}`, "aria-labelledby": `cad-tab-${d.id}`, hidden: true });
    const boton = h("button", {
      class: "cad-pestana", type: "button", role: "tab", id: `cad-tab-${d.id}`,
      "aria-controls": `cad-panel-${d.id}`, "aria-selected": "false",
      onclick: () => mostrar(d.id),
      onkeydown: (ev) => {
        const ids = defs.map((x) => x.id);
        const i = ids.indexOf(d.id);
        if (ev.key === "ArrowRight") mostrar(ids[(i + 1) % ids.length]);
        else if (ev.key === "ArrowLeft") mostrar(ids[(i - 1 + ids.length) % ids.length]);
        else return;
        ev.preventDefault();
        botones.get(defs[(ev.key === "ArrowRight" ? i + 1 : i - 1 + ids.length) % ids.length].id)?.focus();
      },
    }, d.titulo);
    botones.set(d.id, boton);
    paneles.set(d.id, panel);
    barra.append(boton);
    cuerpo.append(panel);
  }
  return { nodo: h("div", { class: "cad-pestanas-caja" }, barra, cuerpo), paneles, mostrar };
}
