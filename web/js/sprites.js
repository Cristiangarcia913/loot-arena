// Sprites SVG generados por código (sin imágenes externas).
// Todas las funciones devuelven una cadena SVG (viewBox 0 0 120 120 salvo que se indique otra cosa)
// con los pies apoyados hacia y≈110. Cada SVG usa ids únicos para sus gradientes/filtros.
//
// Claves de enemigo (derivadas del nombre del BESTIARIO de combat.js con claveEnemigo):
//   "Rata gigante" → rata · "Lobo sombrío" → lobo · "Goblin saqueador" → goblin
//   "Esqueleto errante" → esqueleto · "Araña venenosa" → arana · "Orco berserker" → orco
//   "Espectro de la cripta" → espectro · "Gólem de piedra" → golem
//   "Hechicero oscuro" → hechicero · "Dragón ancestral" → dragon · (jefe dedicado) → jefe
// Regla: primera palabra del nombre, en minúsculas y sin tildes/ñ→n. Si no existe → sprite genérico.

let contador = 0;
const uid = (p) => `${p}${(++contador).toString(36)}`;

/** Paleta por rareza (0 Común, 1 Raro, 2 Legendario). Mismos colores base que equipment.js. */
export const PALETA_RAREZA = Object.freeze([
  Object.freeze({ base: "#a8b0bb", luz: "#eef0f3", osc: "#5b626c", color: "#9ca3af" }),
  Object.freeze({ base: "#3b82f6", luz: "#a5c8ff", osc: "#1e3a8a", color: "#3b82f6" }),
  Object.freeze({ base: "#f59e0b", luz: "#fff1b8", osc: "#92400e", color: "#f59e0b" }),
]);

export const CLAVES_ENEMIGO = Object.freeze(["rata", "lobo", "goblin", "esqueleto", "arana", "orco", "espectro", "golem", "hechicero", "dragon", "jefe"]);

/**
 * Deriva la clave de sprite a partir del nombre de la criatura.
 * @param {string} nombre p. ej. "Araña venenosa"
 * @returns {string} p. ej. "arana"
 */
export function claveEnemigo(nombre) {
  const primera = String(nombre ?? "").trim().split(/\s+/)[0] ?? "";
  return primera.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
}

const sombra = (rx = 26) => `<ellipse cx="60" cy="111" rx="${rx}" ry="4.5" fill="#000" opacity=".45"/>`;
const grad = (id, a, b, vertical = true) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="${vertical ? 0 : 1}" y2="${vertical ? 1 : 0}"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
const radial = (id, a, b, op = 1) =>
  `<radialGradient id="${id}"><stop offset="0" stop-color="${a}" stop-opacity="${op}"/><stop offset="1" stop-color="${b}" stop-opacity="0"/></radialGradient>`;
const brillo = (id, d = 2.2) =>
  `<filter id="${id}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="${d}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
const svg = (cuerpo, clase = "", vb = "0 0 120 120") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" class="sp ${clase}" aria-hidden="true" focusable="false">${cuerpo}</svg>`;

// ───────────────────────── Héroe ─────────────────────────

/** Colores de los cosméticos de "color" de armadura (ids 1-3 del catálogo §5). */
const COLOR_ARMADURA = { 1: ["#e05555", "#6b0f0f"], 2: ["#34d399", "#064e3b"], 3: ["#5b5677", "#0f0d1a"] };

/** Apariencia vacía (ningún cosmético). */
export const APARIENCIA_VACIA = Object.freeze({ color: null, sombrero: null, capa: null, aura: null, mascota: null });

/** Ranura de cada id de cosmético del catálogo (§5). */
export const RANURA_COSMETICO = Object.freeze({ 1: "color", 2: "color", 3: "color", 4: "sombrero", 5: "sombrero", 6: "sombrero", 7: "capa", 8: "capa", 9: "capa", 10: "aura", 11: "aura", 12: "mascota", 13: "mascota", 14: "consumible" });

function capaSvg(g, id) {
  if (id === 9) {
    return `<g class="sp-alas">
      <path d="M54 54 Q30 30 8 34 Q22 40 18 48 Q30 46 30 54 Q38 52 40 62 Q48 58 56 64 Z" fill="url(#${g}fe)" stroke="#9a3412" stroke-width="1"/>
      <path d="M66 54 Q78 28 100 26 Q90 34 96 40 Q86 42 88 50 Q80 50 80 60 Q72 58 64 64 Z" fill="url(#${g}fe)" stroke="#9a3412" stroke-width="1" opacity=".85"/>
      <path d="M14 40 Q28 44 40 56 M92 32 Q82 42 72 56" stroke="#fde68a" stroke-width="1.2" fill="none" opacity=".8"/></g>`;
  }
  const [a, b] = id === 7 ? ["#8b6a48", "#3e2a18"] : id === 8 ? ["#9333ea", "#3b0764"] : ["#9b2c2c", "#4c0d0d"];
  const borde = id === 8 ? `<path d="M41 108 L62 106" stroke="#fbbf24" stroke-width="2.5"/>` : "";
  return `<defs>${grad(`${g}k`, a, b)}</defs><path d="M52 50 C40 66 37 92 41 108 L62 106 C57 88 57 68 60 52 Z" fill="url(#${g}k)" stroke="#1a0a05" stroke-width="1"/>${borde}`;
}

function auraSvg(g, id) {
  if (id === 10) {
    return `<defs>${radial(`${g}au`, "#bae6fd", "#7dd3fc", .55)}</defs><g class="sp-aura sp-aura-hielo"><ellipse cx="60" cy="66" rx="36" ry="48" fill="url(#${g}au)"/>
      ${[[24, 40], [96, 50], [30, 92], [92, 96], [60, 14]].map(([x, y]) => `<path d="M${x} ${y - 4} V${y + 4} M${x - 4} ${y} H${x + 4} M${x - 3} ${y - 3} L${x + 3} ${y + 3} M${x + 3} ${y - 3} L${x - 3} ${y + 3}" stroke="#e0f2fe" stroke-width="1.2"/>`).join("")}</g>`;
  }
  if (id === 11) {
    return `<defs>${radial(`${g}au`, "#fdba74", "#f97316", .5)}</defs><g class="sp-aura sp-aura-fuego"><ellipse cx="60" cy="70" rx="36" ry="46" fill="url(#${g}au)"/>
      <path d="M28 108 Q22 84 34 70 Q32 86 40 92 Q38 74 48 62 Q48 80 56 86 Q56 66 66 56 Q66 78 74 84 Q76 70 84 66 Q80 84 88 92 Q96 82 94 70 Q104 88 92 108 Z" fill="#f97316" opacity=".55"/>
      <path d="M36 108 Q32 92 42 84 Q42 96 50 100 Q52 86 60 80 Q62 94 70 98 Q72 88 80 86 Q78 98 86 108 Z" fill="#fde047" opacity=".55"/></g>`;
  }
  return "";
}

function sombreroSvg(g, id, conCasco) {
  if (id === 4) return `<path d="M48 46 Q46 24 62 24 Q76 26 74 42 L72 46 Q70 34 61 33 Q53 33 51 47 Z M74 42 Q80 44 82 52 Q74 48 72 46 Z" fill="#4d6b3c" stroke="#1f3317" stroke-width="1"/>`;
  if (id === 5) return `<path d="M49.5 42 Q49 26 61 26 Q73 26 72.5 40 L72.5 43 L67.5 43 L67.5 37.5 L57 37.5 L57 47 L51 47 Z" fill="#8a8f99" stroke="#3f444d" stroke-width="1"/>
      <path d="M52 30 Q40 26 38 12 Q46 22 54 26 Z M70 30 Q82 26 84 12 Q76 22 68 26 Z" fill="#f1e8d5" stroke="#8a7a5a" stroke-width=".8"/>`;
  if (id === 6) {
    const y = conCasco ? 0 : 3;
    return `<defs>${grad(`${g}co`, "#fff1b8", "#d97706")}</defs><path d="M51 ${28 + y} L52.5 ${19 + y} L56.5 ${24 + y} L61 ${16 + y} L65.5 ${24 + y} L69.5 ${19 + y} L71 ${28 + y} Z" fill="url(#${g}co)" stroke="#92400e" filter="url(#${g}f)"/>
      <circle cx="61" cy="${25 + y}" r="1.6" fill="#dc2626"/>`;
  }
  return "";
}

function mascotaSvg(id) {
  if (id === 12) return `<g class="sp-mascota sp-gato">
      <path d="M30 104 Q38 96 34 88" stroke="#18181b" stroke-width="2.4" fill="none" stroke-linecap="round"/>
      <ellipse cx="22" cy="104" rx="9" ry="5.5" fill="#18181b"/>
      <circle cx="14" cy="97" r="5.5" fill="#18181b"/><path d="M10 94 L10 88 L13 92 Z M16 92 L18 87 L18.5 93 Z" fill="#18181b"/>
      <circle cx="12.5" cy="97" r="1.1" fill="#facc15"/><circle cx="16" cy="97" r="1.1" fill="#facc15"/>
      <rect x="15" y="107" width="3" height="3" fill="#18181b"/><rect x="26" y="107" width="3" height="3" fill="#18181b"/></g>`;
  if (id === 13) return `<g class="sp-mascota sp-minidragon">
      <path d="M22 70 L12 56 L18 58 L18 50 L26 62 Z" fill="#7f1d1d"/>
      <ellipse cx="22" cy="72" rx="8" ry="5.5" fill="#dc2626"/>
      <path d="M28 74 Q36 78 38 70" stroke="#dc2626" stroke-width="2.4" fill="none" stroke-linecap="round"/>
      <circle cx="14" cy="67" r="4.5" fill="#dc2626"/><path d="M12 63 L11 59 L14 62 Z" fill="#fef3c7"/>
      <circle cx="12.5" cy="66.5" r="1" fill="#fde047"/>
      <circle cx="8" cy="69" r="1.8" fill="#fb923c" opacity=".85" class="sp-fuego"/></g>`;
  return "";
}

/**
 * Héroe mirando a la derecha. El equipo se ve (espada, escudo, casco, armadura y botas coloreados por
 * rareza; los legendarios brillan) y encima los cosméticos del catálogo §5.
 * @param {Array<{tipo:string, rareza:number}>} equipados objetos NFT equipados
 * @param {{color?:number|null, sombrero?:number|null, capa?:number|null, aura?:number|null, mascota?:number|null}} [apariencia]
 *        ids del catálogo de cosméticos (1-13) o null en cada ranura
 */
export function spriteHeroe(equipados = [], apariencia = APARIENCIA_VACIA) {
  const ap = { ...APARIENCIA_VACIA, ...(apariencia ?? {}) };
  for (const k of Object.keys(ap)) ap[k] = ap[k] == null ? null : Number(ap[k]);
  const eq = {};
  for (const it of equipados ?? []) if (it?.tipo) eq[it.tipo] = Math.max(0, Math.min(2, Number(it.rareza) || 0));
  const p = (t) => (eq[t] == null ? null : PALETA_RAREZA[eq[t]]);
  const esp = p("Espada"), esc = p("Escudo"), cas = p("Casco"), arm = p("Armadura"), bot = p("Botas");
  const g = uid("h");
  const fl = (t) => (eq[t] === 2 ? ` filter="url(#${g}f)"` : "");
  const piel = "#e8b88f";
  const botaCol = bot ? bot.base : "#5b3a22";
  const botaOsc = bot ? bot.osc : "#3a2414";
  const tinte = COLOR_ARMADURA[ap.color];
  const torsoA = tinte ? tinte[0] : arm ? arm.luz : "#a0703f";
  const torsoB = tinte ? tinte[1] : arm ? arm.osc : "#5a3519";
  const brazoCol = tinte ? tinte[0] : arm ? arm.base : "#8b5a2b";

  const defs = `<defs>${brillo(`${g}f`, 2.4)}
    ${grad(`${g}t`, torsoA, torsoB)}
    ${grad(`${g}e`, esp ? esp.luz : "#d1d5db", esp ? esp.base : "#6b7280")}
    ${grad(`${g}s`, esc ? esc.luz : "#9a6b3d", esc ? esc.osc : "#4a2c14")}
    ${grad(`${g}c`, cas ? cas.luz : "#6b4423", cas ? cas.osc : "#3a2414")}
    ${grad(`${g}fe`, "#fde047", "#dc2626")}</defs>`;

  const piernas = `
    <rect x="52" y="84" width="8" height="18" rx="2" fill="#3b2a1e"/>
    <rect x="62" y="84" width="8" height="18" rx="2" fill="#4a3526"/>
    <path d="M50 100 h11 v9 h-14 q0 -6 3 -9z" fill="${botaOsc}"${fl("Botas")}/>
    <path d="M61 100 h11 q3 3 3 9 h-14z" fill="${botaCol}" stroke="${botaOsc}" stroke-width="1"${fl("Botas")}/>`;
  const torso = `
    <path d="M47 54 Q60 47 73 54 L71 86 Q60 90 49 86 Z" fill="url(#${g}t)" stroke="#2a1a0c" stroke-width="1.2"${fl("Armadura")}/>
    ${arm || tinte ? `<path d="M53 60 Q60 57 67 60 L66 72 Q60 75 54 72 Z" fill="#fff" opacity=".18"/><circle cx="60" cy="66" r="3" fill="${arm ? arm.luz : "#e5e7eb"}"/>` : `<path d="M54 56 L60 70 L66 56" stroke="#3a2414" stroke-width="1.5" fill="none"/>`}
    <rect x="48" y="78" width="24" height="5" rx="1" fill="#2e1b0e"/><rect x="58" y="77.5" width="5" height="6" rx="1" fill="#e8b75a"/>`;
  const tapaCabeza = ap.sombrero === 4 || ap.sombrero === 5;
  const pelo = cas
    ? `<path d="M50 42 Q49 27 61 27 Q73 27 72.5 40 L72.5 43 L67.5 43 L67.5 37.5 L57 37.5 L57 47 L51 47 Z" fill="url(#${g}c)" stroke="${cas.osc}" stroke-width="1"${fl("Casco")}/>
       ${ap.sombrero === 6 ? "" : `<path d="M58 27.5 Q60 15 71 16 Q64 21 64 27.5 Z" fill="${eq.Casco === 2 ? "#fde047" : "#b91c1c"}"/>`}`
    : `<path d="M50.5 42 Q50 29 61 29 Q71 29 71.5 36 Q65 33 58 35 Q54 38 53 46 Z" fill="#5a3418"/>`;
  const cabeza = `
    <rect x="57" y="47" width="7" height="6" fill="#c9966c"/>
    <circle cx="61" cy="40" r="10" fill="${piel}"/>
    <circle cx="66" cy="40" r="1.6" fill="#1b1b1b"/>
    <path d="M64 45 q2 1 4 0" stroke="#7a4a2a" stroke-width="1" fill="none"/>
    ${tapaCabeza ? "" : pelo}
    ${sombreroSvg(g, ap.sombrero, !!cas && !tapaCabeza)}`;
  const escudo = esc
    ? `<g class="sp-escudo"${fl("Escudo")}><path d="M33 55 H55 V69 Q55 83 44 90 Q33 83 33 69 Z" fill="url(#${g}s)" stroke="${esc.osc}" stroke-width="2"/>
        <path d="M44 60 V84 M37 68 H51" stroke="${esc.luz}" stroke-width="2.4" opacity=".9"/>
        ${eq.Escudo === 2 ? `<circle cx="44" cy="68" r="4" fill="#fff7cc"/>` : ""}</g>`
    : `<path d="M50 57 L44 74" stroke="${piel}" stroke-width="5" stroke-linecap="round"/>`;
  const largo = esp ? 40 : 18;
  const espada = `<g class="sp-arma" transform="rotate(32 81 72)"${fl("Espada")}>
      <path d="M79 70 L79 ${70 - largo + 6} L81 ${70 - largo} L83 ${70 - largo + 6} L83 70 Z" fill="url(#${g}e)" stroke="${esp ? esp.osc : "#4b5563"}" stroke-width=".8"/>
      <line x1="81" y1="68" x2="81" y2="${70 - largo + 8}" stroke="#fff" stroke-width=".8" opacity=".55"/>
      <rect x="74" y="68" width="14" height="4" rx="1.5" fill="${esp ? esp.base : "#6b4423"}"/>
      <rect x="79.5" y="72" width="3" height="8" fill="#3a2414"/><circle cx="81" cy="81.5" r="2.2" fill="${esp ? esp.luz : "#9ca3af"}"/></g>`;
  const brazo = `<path d="M70 56 L80 71" stroke="${brazoCol}" stroke-width="6" stroke-linecap="round"/><circle cx="81" cy="72" r="3.4" fill="${piel}"/>`;

  return svg(`${defs}${auraSvg(g, ap.aura)}${sombra(24)}<g class="sp-cuerpo">${capaSvg(g, ap.capa)}${piernas}${torso}${cabeza}${escudo}${brazo}${espada}</g>${mascotaSvg(ap.mascota)}`, "sp-heroe");
}

/** Icono de un cosmético por id (para la tienda/vestuario). viewBox 0 0 120 120: el héroe sin equipo con solo ese cosmético. */
export function spriteCosmetico(id) {
  const r = RANURA_COSMETICO[id];
  if (!r) return "";
  if (r === "consumible") {
    return svg(`<defs>${radial("pz" + id, "#fecaca", "#dc2626", .9)}</defs>${sombra(16)}
      <path d="M52 30 H68 V44 Q86 54 84 78 Q82 104 60 106 Q38 104 36 78 Q34 54 52 44 Z" fill="#fee2e2" opacity=".25" stroke="#fca5a5"/>
      <path d="M40 72 Q60 64 80 72 Q82 102 60 102 Q38 102 40 72 Z" fill="#dc2626"/><rect x="50" y="22" width="20" height="10" rx="2" fill="#92400e"/>`, "sp-cosmetico");
  }
  return spriteHeroe([], { [r]: id });
}

// ───────────────────────── Enemigos (miran a la izquierda) ─────────────────────────

const ENEMIGOS = {
  rata(g) {
    return `<defs>${grad(`${g}a`, "#8d7a68", "#463a30")}${brillo(`${g}f`, 1.5)}</defs>${sombra(30)}
    <g class="sp-cuerpo">
      <path d="M86 98 Q108 102 105 84 Q102 72 112 64" stroke="#c48a8a" stroke-width="3" fill="none" stroke-linecap="round"/>
      <ellipse cx="66" cy="92" rx="27" ry="16" fill="url(#${g}a)"/>
      <path d="M70 78 q8 -4 16 2" stroke="#a89380" stroke-width="2" fill="none"/>
      <ellipse cx="52" cy="106" rx="6" ry="3.5" fill="#33291f"/><ellipse cx="80" cy="106" rx="7" ry="3.5" fill="#33291f"/>
      <path d="M48 82 Q32 84 20 95 Q32 102 48 99 Z" fill="url(#${g}a)"/>
      <circle cx="48" cy="80" r="6.5" fill="#8a7565"/><circle cx="48" cy="80" r="3.8" fill="#d68a9a"/>
      <circle cx="33" cy="89" r="2.3" fill="#ff3b3b" filter="url(#${g}f)"/>
      <circle cx="20.5" cy="95" r="2.2" fill="#e79aa8"/>
      <path d="M25 99 l2 4 l2 -4z" fill="#fff"/>
      <path d="M24 93 l-10 -3 M24 95 l-11 1 M25 97 l-9 4" stroke="#d6c7b5" stroke-width=".7"/>
    </g>`;
  },
  lobo(g) {
    return `<defs>${grad(`${g}a`, "#6b7280", "#1f2937")}${brillo(`${g}f`, 1.6)}</defs>${sombra(32)}
    <g class="sp-cuerpo">
      <path d="M90 74 Q110 64 113 46 Q104 64 92 68 Z" fill="#374151"/>
      <rect x="80" y="84" width="7" height="24" rx="3" fill="#1f2937"/><rect x="88" y="84" width="7" height="24" rx="3" fill="#273142"/>
      <ellipse cx="68" cy="80" rx="27" ry="14" fill="url(#${g}a)"/>
      <rect x="44" y="84" width="7" height="25" rx="3" fill="#273142"/><rect x="53" y="84" width="7" height="25" rx="3" fill="#1f2937"/>
      <path d="M52 70 L46 58 L42 66 L38 60 L36 66 Q40 74 50 82 Z" fill="#4b5563"/>
      <path d="M50 72 L42 50 L37 58 L30 50 L29 58 L14 64 L16 70 L28 73 L44 84 Z" fill="url(#${g}a)" stroke="#111827" stroke-width="1"/>
      <path d="M16 70 l3 3 l2 -3 l3 3 l2 -3 l3 3" stroke="#f3f4f6" stroke-width="1.2" fill="none"/>
      <circle cx="31" cy="61" r="2.3" fill="#facc15" filter="url(#${g}f)"/>
      <circle cx="14.5" cy="65" r="1.8" fill="#0b0f17"/>
    </g>`;
  },
  goblin(g) {
    return `<defs>${grad(`${g}a`, "#84cc16", "#3f6212")}${grad(`${g}b`, "#7c4a24", "#3d2410")}${brillo(`${g}f`, 1.4)}</defs>${sombra(22)}
    <g class="sp-cuerpo">
      <ellipse cx="74" cy="76" rx="12" ry="14" fill="#6b4c2a" stroke="#3d2410"/>
      <rect x="51" y="92" width="6" height="14" fill="#4d7c0f"/><rect x="62" y="92" width="6" height="14" fill="#3f6212"/>
      <path d="M48 106 h11 v4 h-13z M60 106 h11 v4 h-12z" fill="#3d2410"/>
      <path d="M46 70 Q59 64 72 70 L70 96 L48 96 Z" fill="url(#${g}b)"/>
      <path d="M46 72 L36 86" stroke="#65a30d" stroke-width="5" stroke-linecap="round"/>
      <g transform="rotate(-50 35 87)"><path d="M33 86 L33 66 L35 62 L37 66 L37 86 Z" fill="#cbd5e1"/><rect x="30" y="85" width="10" height="3" fill="#78350f"/></g>
      <path d="M45 55 L20 46 L42 62 Z" fill="#65a30d"/><path d="M71 55 L90 44 L72 62 Z" fill="#4d7c0f"/>
      <ellipse cx="57" cy="56" rx="15" ry="13" fill="url(#${g}a)"/>
      <circle cx="50" cy="54" r="3.6" fill="#fde047"/><circle cx="49" cy="54" r="1.6" fill="#dc2626" filter="url(#${g}f)"/>
      <circle cx="60" cy="54" r="3.2" fill="#fde047"/><circle cx="59" cy="54" r="1.4" fill="#dc2626"/>
      <path d="M46 58 q-6 4 -2 6 q3 0 4 -3" fill="#4d7c0f"/>
      <path d="M48 63 Q56 69 64 63" stroke="#1a2e05" stroke-width="1.6" fill="#1a2e05"/>
      <path d="M51 64 l1.5 3 l1.5 -3 M57 64.5 l1.5 3 l1.5 -3" fill="#fff"/>
    </g>`;
  },
  esqueleto(g) {
    const hueso = "#ece8e1";
    return `<defs>${brillo(`${g}f`, 1.8)}</defs>${sombra(22)}
    <g class="sp-cuerpo" stroke="${hueso}" stroke-linecap="round">
      <path d="M55 82 L52 96 L50 108 M65 82 L67 96 L70 108" stroke-width="3.5" fill="none"/>
      <path d="M46 108 h7 M67 108 h8" stroke-width="3.5"/>
      <path d="M52 80 Q60 86 68 80" stroke-width="4" fill="none"/>
      <path d="M60 50 L60 82" stroke-width="3"/>
      <path d="M50 56 Q60 52 70 56 M49 62 Q60 58 71 62 M50 68 Q60 64 70 68 M52 74 Q60 70 68 74" stroke-width="2.4" fill="none"/>
      <path d="M50 54 L42 66 L34 72 M70 54 L74 68 L72 80" stroke-width="3" fill="none"/>
      <g transform="rotate(-70 33 73)" stroke="none"><path d="M31 72 L31 48 L33 42 L35 48 L35 72 Z" fill="#a16207"/><path d="M33 70 L33 50" stroke="#fbbf24" stroke-width=".6" opacity=".5"/><rect x="28" y="71" width="10" height="3" fill="#57534e"/></g>
      <g stroke="none">
        <circle cx="58" cy="38" r="12" fill="${hueso}"/>
        <rect x="51" y="45" width="13" height="7" rx="2" fill="${hueso}"/>
        <path d="M53 47 v4 M56 47 v4 M59 47 v4 M62 47 v4" stroke="#57534e" stroke-width=".8"/>
        <ellipse cx="51.5" cy="38" rx="3.6" ry="4.2" fill="#1c1917"/><ellipse cx="61" cy="38" rx="3.3" ry="4" fill="#1c1917"/>
        <circle cx="51.5" cy="38.5" r="1.3" fill="#ef4444" filter="url(#${g}f)"/><circle cx="61" cy="38.5" r="1.2" fill="#ef4444"/>
        <path d="M55 42 l1.5 -3 l1.5 3z" fill="#1c1917"/>
      </g>
    </g>`;
  },
  arana(g) {
    const patas = [];
    const ang = [[-1, 30, 26], [-1, 18, 18], [-1, 8, 10], [-1, 0, 4], [1, 4, 10], [1, 14, 16], [1, 24, 22], [1, 34, 28]];
    ang.forEach(([lado, alto, ancho], i) => {
      const x0 = 56 + i * 3, y0 = 86;
      const kx = x0 + lado * ancho, ky = y0 - alto - 6;
      const px = kx + lado * 10, py = 109;
      patas.push(`<path d="M${x0} ${y0} L${kx} ${ky} L${px} ${py}" stroke="${i % 2 ? "#2a2140" : "#1c162b"}" stroke-width="3.2" fill="none" stroke-linejoin="round" stroke-linecap="round"/>`);
    });
    return `<defs>${radial(`${g}a`, "#6b21a8", "#120a1f")}${brillo(`${g}f`, 1.3)}</defs>${sombra(36)}
    <g class="sp-cuerpo">
      ${patas.join("")}
      <ellipse cx="78" cy="78" rx="24" ry="19" fill="url(#${g}a)" stroke="#0b0614"/>
      <path d="M74 70 L82 70 L78 78 L82 86 L74 86 L78 78 Z" fill="#dc2626"/>
      <circle cx="50" cy="86" r="13" fill="#24193a" stroke="#0b0614"/>
      <circle cx="42" cy="81" r="2" fill="#ef4444" filter="url(#${g}f)"/><circle cx="47" cy="79" r="1.7" fill="#ef4444"/>
      <circle cx="40" cy="85" r="1.5" fill="#ef4444"/><circle cx="45" cy="84" r="1.4" fill="#ef4444"/>
      <path d="M39 92 q-3 6 1 9 M45 93 q-2 6 2 8" stroke="#e5e7eb" stroke-width="2" fill="none"/>
      <path d="M40 102 q-2 3 0 5 q2 -2 0 -5z" fill="#84cc16" filter="url(#${g}f)"/>
    </g>`;
  },
  orco(g) {
    return `<defs>${grad(`${g}a`, "#6b8e23", "#2f4a0e")}${grad(`${g}h`, "#d1d5db", "#4b5563", false)}${brillo(`${g}f`, 1.6)}</defs>${sombra(30)}
    <g class="sp-cuerpo">
      <rect x="48" y="84" width="11" height="20" rx="3" fill="#3f5212"/><rect x="63" y="84" width="11" height="20" rx="3" fill="#4d6316"/>
      <path d="M45 104 h15 v6 h-17z M62 104 h15 v6 h-15z" fill="#3b2412"/>
      <path d="M40 50 Q61 40 82 50 L78 88 Q61 94 44 88 Z" fill="url(#${g}a)" stroke="#1e2f08"/>
      <path d="M44 56 L78 82 M78 56 L44 82" stroke="#5b3a1c" stroke-width="4"/>
      <rect x="44" y="80" width="34" height="6" fill="#3b2412"/><circle cx="61" cy="83" r="3.2" fill="#a8a29e"/>
      <path d="M74 46 L88 42 L84 54 Z M76 44 l2 -8 l3 6z" fill="#78716c"/>
      <path d="M44 54 L30 72" stroke="#4d6316" stroke-width="9" stroke-linecap="round"/>
      <line x1="30" y1="44" x2="30" y2="96" stroke="#5b3a1c" stroke-width="3.5"/>
      <path d="M30 46 Q12 50 12 62 Q16 72 30 68 Z" fill="url(#${g}h)" stroke="#374151"/>
      <circle cx="30" cy="72" r="4.5" fill="#4d6316"/>
      <ellipse cx="58" cy="38" rx="13" ry="12" fill="url(#${g}a)"/>
      <path d="M46 34 L58 37" stroke="#b91c1c" stroke-width="3"/>
      <circle cx="51" cy="35.5" r="1.9" fill="#fef08a" filter="url(#${g}f)"/>
      <path d="M46 31 L57 33" stroke="#1e2f08" stroke-width="2"/>
      <path d="M47 46 Q56 50 64 46" stroke="#1e2f08" stroke-width="2" fill="none"/>
      <path d="M48 46 l-1 -6 l3 5z M58 47 l0 -6 l2.5 5.5z" fill="#fffbeb"/>
    </g>`;
  },
  espectro(g) {
    return `<defs>${radial(`${g}a`, "#d5fbff", "#22d3ee", .95)}${grad(`${g}b`, "#a5f3fc", "#0e7490")}${brillo(`${g}f`, 3)}</defs>
    <ellipse cx="60" cy="111" rx="18" ry="3.5" fill="#22d3ee" opacity=".25"/>
    <g class="sp-cuerpo sp-flota">
      <path d="M60 20 Q84 20 86 50 L88 94 Q82 88 78 98 Q72 88 66 100 Q60 88 54 98 Q48 88 42 96 L38 52 Q38 20 60 20 Z" fill="url(#${g}b)" opacity=".78" filter="url(#${g}f)"/>
      <path d="M40 56 Q26 60 18 74 Q24 72 28 76 Q30 68 42 66" fill="#67e8f9" opacity=".7"/>
      <ellipse cx="52" cy="44" rx="5" ry="7" fill="#062a33"/><ellipse cx="66" cy="44" rx="4.5" ry="6.5" fill="#062a33"/>
      <circle cx="52" cy="45" r="1.8" fill="#ecfeff"/><circle cx="66" cy="45" r="1.6" fill="#ecfeff"/>
      <ellipse cx="58" cy="60" rx="5" ry="8" fill="#062a33" opacity=".85"/>
      <path d="M44 78 q4 4 8 0 q4 4 8 0 q4 4 8 0" stroke="#94a3b8" stroke-width="2" fill="none" stroke-dasharray="3 2"/>
    </g>`;
  },
  golem(g) {
    return `<defs>${grad(`${g}a`, "#a8a29e", "#44403c")}${brillo(`${g}f`, 2)}</defs>${sombra(32)}
    <g class="sp-cuerpo">
      <rect x="44" y="86" width="14" height="20" rx="3" fill="#57534e"/><rect x="64" y="86" width="14" height="20" rx="3" fill="#78716c"/>
      <path d="M36 46 L84 42 L88 88 L34 90 Z" fill="url(#${g}a)" stroke="#292524" stroke-width="1.5"/>
      <path d="M50 52 L56 64 L50 74 M70 56 L64 66 L72 80" stroke="#fb923c" stroke-width="2" fill="none" filter="url(#${g}f)"/>
      <circle cx="60" cy="66" r="5" fill="#fdba74" filter="url(#${g}f)"/>
      <path d="M40 48 q6 -3 10 0 q-2 4 -10 0z M72 84 q6 -4 12 0z" fill="#4d7c0f" opacity=".85"/>
      <rect x="18" y="48" width="18" height="26" rx="4" fill="#78716c" stroke="#292524"/>
      <rect x="14" y="72" width="22" height="18" rx="5" fill="#57534e" stroke="#292524"/>
      <rect x="84" y="50" width="16" height="24" rx="4" fill="#57534e" stroke="#292524"/>
      <rect x="84" y="72" width="18" height="16" rx="5" fill="#44403c" stroke="#292524"/>
      <rect x="48" y="24" width="24" height="20" rx="4" fill="url(#${g}a)" stroke="#292524"/>
      <rect x="51" y="32" width="6" height="3" fill="#fb923c" filter="url(#${g}f)"/><rect x="61" y="32" width="6" height="3" fill="#fb923c"/>
    </g>`;
  },
  hechicero(g) {
    return `<defs>${grad(`${g}a`, "#7e22ce", "#1e0b3a")}${radial(`${g}o`, "#fdf4ff", "#d946ef")}${brillo(`${g}f`, 2.6)}</defs>${sombra(26)}
    <g class="sp-cuerpo">
      <line x1="30" y1="26" x2="34" y2="108" stroke="#5b3a1c" stroke-width="3.5" stroke-linecap="round"/>
      <path d="M26 30 Q30 18 36 26" stroke="#5b3a1c" stroke-width="3" fill="none"/>
      <circle cx="31" cy="22" r="7" fill="url(#${g}o)" filter="url(#${g}f)" class="sp-orbe"/>
      <path d="M60 30 Q76 40 80 108 L38 108 Q44 40 60 30 Z" fill="url(#${g}a)" stroke="#12051f"/>
      <path d="M38 108 L80 108 M52 60 Q60 66 68 60" stroke="#e8b75a" stroke-width="2" fill="none"/>
      <path d="M60 56 L60 108" stroke="#e8b75a" stroke-width="1.5"/>
      <path d="M46 58 L34 66" stroke="#4c1d95" stroke-width="7" stroke-linecap="round"/><circle cx="33" cy="66" r="3" fill="#d6b4a0"/>
      <path d="M44 46 Q46 22 62 18 Q74 26 76 50 Q66 42 60 44 Q52 42 44 46 Z" fill="#3b0764" stroke="#12051f"/>
      <ellipse cx="56" cy="40" rx="9" ry="8" fill="#0b0414"/>
      <circle cx="52" cy="39" r="1.8" fill="#f0abfc" filter="url(#${g}f)"/><circle cx="58" cy="39" r="1.6" fill="#f0abfc"/>
      <path d="M50 46 Q55 60 60 46" fill="#d1d5db"/>
    </g>`;
  },
  dragon(g) {
    return `<defs>${grad(`${g}a`, "#dc2626", "#5c0b0b")}${grad(`${g}w`, "#7f1d1d", "#2b0505")}${radial(`${g}r`, "#fff7ad", "#f97316")}${brillo(`${g}f`, 2.4)}</defs>${sombra(40)}
    <g class="sp-cuerpo">
      <path class="sp-ala" d="M70 60 L96 14 L102 34 L112 26 L108 52 L118 50 L100 74 Z" fill="url(#${g}w)" stroke="#2b0505"/>
      <path d="M96 14 L80 62 M108 30 L86 66 M114 50 L92 70" stroke="#450a0a" stroke-width="1.5"/>
      <path d="M86 86 Q110 92 116 76 Q118 96 92 98 Z" fill="#991b1b"/>
      <ellipse cx="72" cy="82" rx="26" ry="17" fill="url(#${g}a)" stroke="#3b0606"/>
      <path d="M56 90 Q70 98 86 92" stroke="#fca5a5" stroke-width="5" fill="none" opacity=".55"/>
      <rect x="56" y="92" width="9" height="16" rx="3" fill="#7f1d1d"/><rect x="80" y="92" width="9" height="16" rx="3" fill="#991b1b"/>
      <path d="M54 108 l-4 2 h14z M78 108 l-4 2 h14z" fill="#fef3c7"/>
      <path d="M58 76 Q44 66 42 48 L52 46 Q54 62 66 70 Z" fill="url(#${g}a)" stroke="#3b0606"/>
      <path d="M52 50 L36 42 L22 46 L18 52 L30 56 L48 58 Z" fill="url(#${g}a)" stroke="#3b0606"/>
      <path d="M44 44 L52 30 L50 44 M40 44 L44 32 L46 44" fill="#fef3c7"/>
      <circle cx="38" cy="47" r="2.2" fill="#fde047" filter="url(#${g}f)"/>
      <path d="M20 52 l3 3 l2 -3 l3 3" stroke="#fff" stroke-width="1" fill="none"/>
      <circle cx="14" cy="54" r="5" fill="url(#${g}r)" filter="url(#${g}f)" opacity=".9" class="sp-fuego"/>
    </g>`;
  },
  jefe(g) {
    return `<defs>${grad(`${g}a`, "#374151", "#0b0f17")}${grad(`${g}c`, "#b91c1c", "#3b0606")}${grad(`${g}e`, "#fecaca", "#7f1d1d")}${brillo(`${g}f`, 2.4)}</defs>${sombra(34)}
    <g class="sp-cuerpo">
      <path d="M44 44 Q30 70 30 108 L90 108 Q88 70 76 44 Z" fill="url(#${g}c)" opacity=".9"/>
      <path d="M30 108 l6 -8 l6 8 l6 -6 l6 6 l6 -7 l6 7 l6 -6 l6 6 l6 -8 l6 8z" fill="#3b0606"/>
      <rect x="48" y="84" width="11" height="22" rx="2" fill="#1f2937"/><rect x="62" y="84" width="11" height="22" rx="2" fill="#111827"/>
      <path d="M42 48 Q60 40 78 48 L76 88 Q60 94 44 88 Z" fill="url(#${g}a)" stroke="#000"/>
      <path d="M50 56 L60 64 L70 56 M60 64 L60 84" stroke="#ef4444" stroke-width="2" fill="none" filter="url(#${g}f)"/>
      <path d="M38 44 L50 42 L46 56 Z M82 44 L70 42 L74 56 Z" fill="#1f2937" stroke="#ef4444" stroke-width="1"/>
      <g transform="rotate(-18 34 74)" class="sp-arma">
        <path d="M31 74 L31 14 L35 6 L39 14 L39 74 Z" fill="url(#${g}e)" stroke="#450a0a"/>
        <path d="M35 66 L35 18" stroke="#fde047" stroke-width="1.2" stroke-dasharray="4 3" filter="url(#${g}f)"/>
        <rect x="24" y="72" width="22" height="5" rx="2" fill="#111827" stroke="#ef4444"/>
        <rect x="33" y="77" width="4" height="12" fill="#3b0606"/>
      </g>
      <path d="M44 56 L36 76" stroke="#1f2937" stroke-width="8" stroke-linecap="round"/>
      <path d="M48 40 Q48 22 60 22 Q72 22 72 40 L70 46 L50 46 Z" fill="url(#${g}a)" stroke="#000"/>
      <path d="M48 30 Q36 24 34 10 Q42 20 50 24 Z M72 30 Q84 24 86 10 Q78 20 70 24 Z" fill="#e7e5e4"/>
      <path d="M50 22 L52 12 L56 18 L60 8 L64 18 L68 12 L70 22 Z" fill="#fbbf24" stroke="#92400e" filter="url(#${g}f)"/>
      <path d="M51 34 L58 36 L58 38 L51 37 Z M69 34 L62 36 L62 38 L69 37 Z" fill="#fb923c" filter="url(#${g}f)" class="sp-ojos"/>
    </g>`;
  },
};

/**
 * Sprite de un enemigo.
 * @param {string} clave una de CLAVES_ENEMIGO (o cualquier otra → sprite genérico con el emoji)
 * @param {{jefe?:boolean, emoji?:string}} [opts] jefe añade corona/aura (clase CSS sp-jefe)
 */
export function spriteEnemigo(clave, { jefe = false, emoji = "❔" } = {}) {
  const g = uid("e");
  const f = ENEMIGOS[clave];
  let cuerpo;
  if (f) cuerpo = f(g);
  else {
    const em = String(emoji).replace(/[<>&"]/g, "");
    cuerpo = `<defs>${radial(`${g}a`, "#3b2d21", "#000", .9)}</defs>${sombra(24)}
      <g class="sp-cuerpo"><ellipse cx="60" cy="74" rx="34" ry="34" fill="url(#${g}a)"/>
      <text x="60" y="90" font-size="44" text-anchor="middle">${em}</text></g>`;
  }
  // Variante jefe de una criatura: sombra roja bajo los pies (el aura y el tamaño los pone el CSS de .fighter.jefe).
  const corona = jefe && clave !== "jefe"
    ? `<ellipse cx="60" cy="111" rx="40" ry="6" fill="#ef4444" opacity=".35"/>`
    : "";
  return svg(corona + cuerpo,`sp-${f ? clave : "generico"}${jefe ? " sp-jefe" : ""}`);
}

// ───────────────────────── Cofre ─────────────────────────

/** Cofre (viewBox 0 0 140 120). La tapa es el grupo .cofre-tapa y el resplandor interior .cofre-luz. */
export function spriteCofre() {
  const g = uid("c");
  return svg(`<defs>${grad(`${g}m`, "#a0672f", "#4a2810")}${grad(`${g}h`, "#fde68a", "#b45309")}${radial(`${g}l`, "#fffbe6", "#fbbf24")}</defs>
    <ellipse cx="70" cy="110" rx="56" ry="6" fill="#000" opacity=".5"/>
    <ellipse class="cofre-luz" cx="70" cy="58" rx="46" ry="16" fill="url(#${g}l)" opacity="0"/>
    <g class="cofre-base">
      <rect x="18" y="56" width="104" height="50" rx="5" fill="url(#${g}m)" stroke="#2b1607" stroke-width="2"/>
      <path d="M18 72 H122 M18 88 H122" stroke="#5b3417" stroke-width="1.5"/>
      <rect x="28" y="56" width="10" height="50" fill="url(#${g}h)" opacity=".9"/><rect x="102" y="56" width="10" height="50" fill="url(#${g}h)" opacity=".9"/>
      <rect x="60" y="62" width="20" height="22" rx="3" fill="url(#${g}h)" stroke="#78350f"/>
      <path d="M70 69 a3 3 0 1 1 0.01 0 M70 72 v6" stroke="#3b1d06" stroke-width="2.4" fill="#3b1d06"/>
    </g>
    <g class="cofre-tapa">
      <path d="M18 58 L18 42 Q18 18 70 18 Q122 18 122 42 L122 58 Z" fill="url(#${g}m)" stroke="#2b1607" stroke-width="2"/>
      <path d="M22 40 Q24 24 70 24 Q116 24 118 40" stroke="#5b3417" stroke-width="1.5" fill="none"/>
      <path d="M28 58 L28 30 Q30 22 38 21 L38 58 Z M102 58 L102 21 Q110 22 112 30 L112 58 Z" fill="url(#${g}h)" opacity=".9"/>
      <rect x="60" y="48" width="20" height="10" rx="2" fill="url(#${g}h)" stroke="#78350f"/>
    </g>`, "sp-cofre", "0 0 140 120");
}

// ───────────────────────── Iconos ─────────────────────────

const ICONOS_ESTADO = {
  veneno: `<path d="M12 2 C12 2 5 10 5 15 a7 7 0 0 0 14 0 C19 10 12 2 12 2Z" fill="#65d837" stroke="#1a4d0a"/><circle cx="9.5" cy="14" r="1.6" fill="#1a4d0a"/><circle cx="14.5" cy="14" r="1.6" fill="#1a4d0a"/><path d="M10 18 h4" stroke="#1a4d0a" stroke-width="1.4"/>`,
  aturdido: `<path d="M12 3 l2 5 l5 .4 l-4 3.3 l1.3 5 l-4.3 -2.8 l-4.3 2.8 l1.3 -5 l-4 -3.3 l5 -.4z" fill="#fde047" stroke="#a16207"/><path d="M3 20 q9 -5 18 0" stroke="#fde047" stroke-width="1.6" fill="none"/>`,
  sangrado: `<path d="M12 2 C12 2 5 11 5 15.5 a7 7 0 0 0 14 0 C19 11 12 2 12 2Z" fill="#dc2626" stroke="#450a0a"/><path d="M9 13 q-1 4 2 6" stroke="#fecaca" stroke-width="1.4" fill="none"/>`,
  escudo: `<path d="M12 2 L20 5 V11 Q20 18 12 22 Q4 18 4 11 V5 Z" fill="#3b82f6" stroke="#1e3a8a"/><path d="M12 5 V19 M7 10 H17" stroke="#dbeafe" stroke-width="1.6"/>`,
  furia: `<path d="M12 1 Q16 7 15 10 Q19 8 19 4 Q23 10 21 16 Q19 22 12 23 Q5 22 3 16 Q2 10 6 6 Q6 10 9 11 Q8 6 12 1Z" fill="#f97316" stroke="#7c2d12"/><path d="M12 10 Q15 14 14 17 Q12 20 10 17 Q9 14 12 10Z" fill="#fde047"/>`,
  reflejo: `<path d="M12 2 L20 5 V11 Q20 18 12 22 Q4 18 4 11 V5 Z" fill="#a78bfa" stroke="#4c1d95"/><path d="M7 15 L12 7 L17 15 M12 7 V3" stroke="#f5f3ff" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
  evasion: `<path d="M3 16 Q9 4 21 6 Q14 8 12 12 Q18 11 21 13 Q13 14 9 20 Q8 16 3 16Z" fill="#5eead4" stroke="#115e59"/>`,
};
const ICONOS_INTENCION = {
  atacar: `<g transform="rotate(45 12 12)"><path d="M11 2 h2 v13 h-2z" fill="#f1f5f9" stroke="#475569" stroke-width=".6"/><rect x="7" y="14" width="10" height="2.4" rx="1" fill="#b91c1c"/><rect x="11" y="16" width="2" height="5" fill="#57534e"/></g>`,
  cargar: `<path d="M13 1 L4 13 H11 L9 23 L20 9 H13 Z" fill="#f97316" stroke="#7c2d12"/>`,
  defender: ICONOS_ESTADO.escudo,
  habilidad: `<path d="M12 1 L14.5 9.5 L23 12 L14.5 14.5 L12 23 L9.5 14.5 L1 12 L9.5 9.5 Z" fill="#c084fc" stroke="#581c87"/><circle cx="12" cy="12" r="2.4" fill="#fdf4ff"/>`,
};

/** Icono de estado (viewBox 24). tipo: veneno | aturdido | sangrado | escudo | furia | reflejo | evasion */
export function iconoEstado(tipo) {
  return svg(ICONOS_ESTADO[tipo] ?? `<circle cx="12" cy="12" r="9" fill="#9ca3af"/>`, `ico ico-${tipo}`, "0 0 24 24");
}

/** Icono de intención del enemigo (viewBox 24). tipo: atacar | cargar | defender | habilidad */
export function iconoIntencion(tipo) {
  return svg(ICONOS_INTENCION[tipo] ?? ICONOS_INTENCION.atacar, `ico ico-int-${tipo}`, "0 0 24 24");
}

/**
 * Ilustración de un objeto para cartas (viewBox 0 0 64 64), coloreada por rareza.
 * @param {string} tipo Espada | Escudo | Casco | Armadura | Botas
 * @param {number} rareza 0..2
 */
export function iconoObjeto(tipo, rareza = 0) {
  const p = PALETA_RAREZA[Math.max(0, Math.min(2, Number(rareza) || 0))];
  const g = uid("o");
  const defs = `<defs>${grad(`${g}a`, p.luz, p.base)}${grad(`${g}b`, p.base, p.osc)}${brillo(`${g}f`, rareza >= 2 ? 2.2 : 0.01)}</defs>`;
  const formas = {
    Espada: `<g transform="rotate(45 32 32)" filter="url(#${g}f)"><path d="M29 44 V10 L32 4 L35 10 V44 Z" fill="url(#${g}a)" stroke="${p.osc}"/><path d="M32 40 V12" stroke="#fff" opacity=".6"/><rect x="22" y="43" width="20" height="5" rx="2" fill="url(#${g}b)"/><rect x="30" y="48" width="4" height="9" fill="#3a2414"/><circle cx="32" cy="59" r="3" fill="${p.luz}"/></g>`,
    Escudo: `<path d="M32 6 L54 13 V30 Q54 48 32 58 Q10 48 10 30 V13 Z" fill="url(#${g}b)" stroke="${p.osc}" stroke-width="2" filter="url(#${g}f)"/><path d="M32 12 V52 M17 27 H47" stroke="${p.luz}" stroke-width="3"/>`,
    Casco: `<path d="M12 40 Q10 12 32 10 Q54 12 52 40 L52 46 L40 46 L40 34 L24 34 L24 52 L12 52 Z" fill="url(#${g}a)" stroke="${p.osc}" stroke-width="2" filter="url(#${g}f)"/><path d="M28 10 Q34 0 46 4 Q38 6 36 11Z" fill="${rareza >= 2 ? "#fde047" : "#b91c1c"}"/>`,
    Armadura: `<path d="M14 14 L24 8 Q32 14 40 8 L50 14 L54 28 L46 30 L46 56 L18 56 L18 30 L10 28 Z" fill="url(#${g}a)" stroke="${p.osc}" stroke-width="2" filter="url(#${g}f)"/><path d="M24 22 Q32 26 40 22 M22 36 H42 M22 46 H42" stroke="${p.osc}" stroke-width="2" fill="none"/>`,
    Botas: `<path d="M14 8 H30 V40 Q44 40 52 48 V56 H14 Z" fill="url(#${g}a)" stroke="${p.osc}" stroke-width="2" filter="url(#${g}f)"/><path d="M14 18 H30 M14 50 H52" stroke="${p.osc}" stroke-width="2"/>`,
  };
  return svg(defs + (formas[tipo] ?? `<circle cx="32" cy="32" r="18" fill="url(#${g}a)" stroke="${p.osc}" stroke-width="2"/>`), `ico-obj rar-${rareza}`, "0 0 64 64");
}
