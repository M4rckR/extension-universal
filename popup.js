// Tenant de la organización en la URL del admin de Adobe Target
// (experience.adobe.com/#/@<tenant>/...). NO es el orgId: es el slug que Adobe
// usa en la URL, no derivable del payload, así que lo escribe el usuario en el
// popup y se persiste en chrome.storage.local (clave "tenant"). Vacío ("") →
// getTargetUrl devuelve null y el render oculta los deep-links.
let tenant = "";

// Umbral de truncado del preview de "content" en la pestaña Actividades — se
// corta por lo que se cumpla primero. Calibrado con datos reales de
// producción (dom-action de 1.4–6.6 KB / 42–233 líneas, mediana ~4 KB /
// ~117 líneas): 40 líneas cubre "un vistazo" para el caso típico, y el tope
// de caracteres protege contra un blob minificado en una sola línea gigante,
// que un corte solo por líneas no detectaría. Nombradas acá porque si algún
// día aparece una offer más grande, se ajustan en un solo lugar.
const MAX_PREVIEW_LINES = 40;
const MAX_PREVIEW_CHARS = 3000;

/**
 * Verifica que la URL sea una página web donde se puede inyectar (http/https).
 * La extensión corre en cualquier sitio; esto solo descarta páginas internas
 * del navegador (chrome://, about:, edge://, view-source:, etc.) y URLs
 * inválidas, donde los content scripts nunca se inyectan.
 */
function isAllowedDomain(url) {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch (e) {
    return false;
  }
}

// Trazos de los íconos (viewBox 24, un solo grosor — ver .icon en popup.html).
const ICON_PATHS = {
  signal:
    '<circle cx="12" cy="12" r="2"/><path d="M7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 19a10 10 0 0 1 0-14M19 5a10 10 0 0 1 0 14"/>',
  box: '<path d="M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
  closed: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 9l6 6M15 9l-6 6"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4-2v-4L3 5z"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  alert: '<path d="M12 3l9.5 16.5h-19L12 3z"/><path d="M12 10v4M12 17.2h.01"/>',
};

function iconSvg(name, className = "") {
  return `<svg class="icon ${className}" viewBox="0 0 24 24" aria-hidden="true">${ICON_PATHS[name]}</svg>`;
}

/**
 * Markup de un estado vacío. `html` es texto fijo de la UI (o ya escapado por
 * quien llama) — nunca se le pasa un valor capturado de la página sin escapar.
 */
function emptyStateHtml(icon, html, withInject = false, warn = false) {
  return `
    <div class="empty-state${warn ? " empty-state--warn" : ""}">
      ${iconSvg(icon, "empty-state__icon")}
      <p class="empty-state__text">${html}</p>
      ${withInject ? `<button class="btn-inject">Capturar ahora</button>` : ""}
    </div>`;
}

// Cada actualización en vivo reemplaza el innerHTML de la lista, y con eso
// el elemento enfocado desaparece: quien navega con teclado caía de vuelta
// en <body> con cada hit o regla nueva. Antes de repintar se anota qué
// estaba enfocado (el data-key más cercano + el control adentro) y después
// se vuelve a enfocar su equivalente.
const FOCUS_ATTRS = ["id", "data-hit-toggle", "data-hit-filter", "data-copy", "data-copy-event", "data-copy-code", "data-copy-hit", "data-goto", "data-idx", "data-event", "data-status", "href"];

function focusDescriptor(root) {
  const el = document.activeElement;
  if (!el || el === document.body || !root.contains(el)) return null;
  const attr = FOCUS_ATTRS.find((a) => el.hasAttribute(a));
  return {
    key: el.closest("[data-key]")?.dataset.key,
    selector: el.tagName.toLowerCase() + (el.classList[0] ? "." + CSS.escape(el.classList[0]) : ""),
    attr,
    value: attr ? el.getAttribute(attr) : null,
  };
}

function restoreFocus(root, d) {
  if (!d) return;
  const scope = d.key ? [...root.querySelectorAll("[data-key]")].find((e) => e.dataset.key === d.key) : root;
  if (!scope) return;
  const target = d.attr
    ? [...scope.querySelectorAll(`[${d.attr}]`)].find((e) => e.getAttribute(d.attr) === d.value)
    : scope.querySelector(d.selector);
  if (target) target.focus({ preventScroll: true });
}

/** ¿Hay señal de que la captura ya corre en esta página? (Alloy configurado, Launch detectado o respuestas guardadas). */
function captureIsLive(data) {
  const instances = Array.isArray(data.instanceInfo) ? data.instanceInfo : data.instanceInfo ? [data.instanceInfo] : [];
  return instances.length > 0 || !!data.launchInfo || (data.requests || []).length > 0;
}

/** Franja de veredicto de Actividades (#act-summary); "" la oculta. */
function setActSummary(html) {
  const el = document.getElementById("act-summary");
  el.hidden = !html;
  el.innerHTML = html;
}

/** Estado del punto de la barra de URL: "ok" | "warn" | "error" | "idle". El texto de #page-url siempre nombra el mismo estado. */
function setIndicator(state) {
  const el = document.querySelector(".url-bar__indicator");
  el.classList.remove("url-bar__indicator--ok", "url-bar__indicator--warn", "url-bar__indicator--error");
  if (state !== "idle") el.classList.add(`url-bar__indicator--${state}`);
}

/** hostname + pathname de una URL, o "" si no se puede parsear. */
function hostAndPath(url) {
  try {
    const u = new URL(url);
    return u.hostname + u.pathname;
  } catch (e) {
    return "";
  }
}

// ── Aviso de estado (#toast) ──────────────────────────────────────────────────
// Único canal de feedback para acciones que antes eran mudas (Capturar ahora,
// copiar, guardar tenant) y para el "Deshacer" de Limpiar. Es un
// role="status": el lector de pantalla lo anuncia sin robar el foco.
let toastTimer = null;

function showToast(text, { action, onAction, error = false, duration = 4000 } = {}) {
  const toast = document.getElementById("toast");
  const actionBtn = document.getElementById("toast-action");
  document.getElementById("toast-text").textContent = text;
  toast.classList.toggle("toast--error", error);
  actionBtn.hidden = !action;
  actionBtn.textContent = action || "";
  actionBtn.onclick = action
    ? () => {
        hideToast();
        onAction();
      }
    : null;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, duration);
}

function hideToast() {
  clearTimeout(toastTimer);
  document.getElementById("toast").hidden = true;
}

// Estado terminal de la ventana (página no inspeccionable o pestaña
// cerrada): { icon, html } o null. Mientras esté puesto, las tres pestañas
// muestran el mismo aviso — antes solo Actividades lo mostraba y mBoxes/
// Eventos seguían con datos de otra página, y una captura de otra pestaña
// (storage es global) volvía a pintar Actividades por encima del aviso.
let blockedState = null;

function setBlocked(icon, html, urlText) {
  blockedState = { icon, html };
  document.getElementById("count").textContent = "—";
  document.getElementById("page-url").textContent = urlText;
  setIndicator("error");
  showBlockedIn("list");
  document.getElementById("mbox-dock").innerHTML = "";
  showBlockedIn("event-list");
  showBlockedIn("launch-list");
  showBlockedIn("hits-list");
  setActSummary("");
  document.getElementById("hits-summary").hidden = true;
  document.getElementById("hits-filters").innerHTML = "";
  document.getElementById("event-filters").innerHTML = "";
  document.getElementById("event-search-bar").hidden = true;
  document.getElementById("launch-info").hidden = true;
  document.getElementById("launch-filters").innerHTML = "";
  document.getElementById("launch-search-bar").hidden = true;
}

/** Pinta el aviso terminal en una lista. Devuelve true si lo pintó (y quien llama debe cortar su render). */
function showBlockedIn(listId) {
  if (!blockedState) return false;
  document.getElementById(listId).innerHTML = emptyStateHtml(blockedState.icon, blockedState.html);
  return true;
}

/** Muestra un aviso cuando la página activa no admite inyección de scripts. */
function showBlocked() {
  setBlocked("ban", "Esta página no permite inyección de scripts.", "Página no inspeccionable");
}

/**
 * Resuelve qué pestaña hay que inspeccionar: popup.html ya no tiene
 * default_popup, así que la única forma real de abrirlo es la ventana
 * independiente que crea background.js (createInspectorWindow) con
 * ?tabId= en la URL — esa pestaña puntual, aunque ya no sea la activa del
 * navegador. El fallback de abajo (pestaña activa de la ventana actual)
 * queda solo por si algún día este documento se abre sin ese parámetro.
 */
function getInspectedTab(callback) {
  const paramTabId = new URLSearchParams(location.search).get("tabId");
  if (paramTabId) {
    chrome.tabs.get(Number(paramTabId), (tab) => {
      if (chrome.runtime.lastError) {
        callback(null);
        return;
      }
      callback(tab);
    });
    return;
  }
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) =>
    callback(tabs[0] || null),
  );
}

/** Muestra un aviso cuando la pestaña que la ventana independiente inspeccionaba ya se cerró. */
function showTabClosed() {
  setBlocked(
    "closed",
    "La pestaña que esta ventana estaba inspeccionando ya se cerró. Haz clic en el ícono de la extensión desde otra pestaña para inspeccionarla.",
    "Pestaña cerrada",
  );
}

/**
 * Muestra un aviso cuando la pestaña activa es distinta a la página capturada.
 * Ocurre si el usuario navega sin recargar la extensión.
 */
function showStale(tabUrl) {
  const host = (() => {
    try {
      return new URL(tabUrl).hostname;
    } catch (e) {
      return tabUrl;
    }
  })();
  document.getElementById("mbox-dock").innerHTML = "";
  setActSummary("");
  document.getElementById("list").innerHTML = emptyStateHtml(
    "refresh",
    `Página distinta a la captura.<br>Recarga <strong>${escapeHtml(host)}</strong> para capturar.`,
  );
  document.getElementById("count").textContent = "—";
  document.getElementById("page-url").textContent = hostAndPath(tabUrl) || "Página distinta a la captura";
  setIndicator("warn");
}

/**
 * Convierte un scope de Alloy a etiqueta visual.
 * '__view__' es VEC (Visual Experience Composer); el resto son mboxes con nombre.
 * El nombre va completo: el recorte lo hace el CSS (.scope-tag), no un slice
 * fijo que ignoraba el ancho de la ventana.
 */
function formatScope(scope) {
  if (scope === "__view__") return { label: "VEC", type: "vec" };
  return { label: String(scope ?? "?"), type: "mbox" };
}

/**
 * Construye la URL de la actividad en la UI de Adobe Target.
 * Requiere conocer el tipo (AB o XT) y el ID de la actividad.
 */
function getTargetUrl(actType, actId) {
  if (!tenant || !actType || !actId || actId === "?") return null;
  const type = actType === "AB" ? "ab_manual" : "experience_targeting";
  // actId viene del payload capturado (lo controla la página) — se codifica
  // para que no pueda salirse de su segmento de la ruta.
  return `https://experience.adobe.com/#/@${encodeURIComponent(tenant)}/target/activities/activity-details/${type}/${encodeURIComponent(actId)}/overview`;
}

/**
 * Detecta si una actividad es A/B o XT a partir del nombre y la experiencia.
 * Heurística: experiencia "B" → A/B. Palabras "A/B" o "AB" en el nombre → A/B.
 * Palabras "XT" en el nombre → XT.
 *
 * Es heurística porque el payload de personalization:decisions (Web SDK/Alloy)
 * no trae un campo de tipo de actividad — verificado contra Adobe Experience
 * Platform Debugger (extensión oficial de Adobe): su UI no referencia
 * personalization/decisionScopes/scopeDetails en ningún lado; toda su lógica
 * de tipo de actividad depende del sistema legado de trazas de at.js
 * (___target_traces), que no aplica a integraciones vía Web SDK como esta.
 */
function detectType(name, expName) {
  if (expName) {
    const e = expName.trim().toUpperCase();
    if (
      e === "B" ||
      e === "EXPERIENCIA B" ||
      e === "EXPERIENCE B" ||
      e.endsWith(" B")
    )
      return "AB";
  }
  if (!name) return null;
  const n = name.toUpperCase();
  if (/A\/B/.test(n)) return "AB";
  if (/(^|[\s\-_])AB([\s\-_]|$)/.test(n)) return "AB";
  if (/(^|[\s\-_])XT([\s\-_]|$)/.test(n)) return "XT";
  return null;
}

/** Extrae nombre, ID, experiencia y tipo de actividad desde el payload de Alloy. */
function getActivityInfo(d) {
  const meta = d.items?.[0]?.meta;
  const actName = meta?.["activity.name"] || d.scopeDetails?.activity?.name;
  const actId = d.scopeDetails?.activity?.id || "?";
  const expName = meta?.["experience.name"] || d.scopeDetails?.experience?.name;
  const expId = d.scopeDetails?.experience?.id;
  const exp = expName || (expId !== undefined ? `Exp. ${expId}` : null);
  return {
    name: actName || null,
    id: actId,
    exp,
    actType: detectType(actName, expName),
  };
}

/** Extrae type/format/selector/prehidingSelector/content del primer item de una decisión, si existe. */
function getDomActionData(d) {
  const data = d.items?.[0]?.data;
  if (!data) return null;
  return {
    type: data.type ?? null,
    format: data.format ?? null,
    selector: data.selector ?? null,
    prehidingSelector: data.prehidingSelector ?? null,
    content: typeof data.content === "string" ? data.content : null,
  };
}

/** Formatea un tamaño en caracteres a un indicador legible (B/KB) — de un vistazo, no una medición exacta en bytes UTF-8. */
function formatContentSize(len) {
  if (len < 1024) return `${len} B`;
  return `${(len / 1024).toFixed(1)} KB`;
}

/**
 * Trunca el content ANTES de escaparlo (nunca al revés) para que el costo de
 * escapeHtml + inserción en el DOM sea siempre chico, sin importar el tamaño
 * real del payload guardado. Corta por líneas (MAX_PREVIEW_LINES) o por
 * caracteres (MAX_PREVIEW_CHARS) — lo que se cumpla primero: el de líneas
 * cubre el caso típico (contenido con saltos de línea reales), el de
 * caracteres protege contra un blob minificado en una sola línea gigante,
 * que el corte por líneas no alcanzaría a detectar.
 */
function truncatePreview(content) {
  const lines = content.split("\n");
  let preview = content;
  let truncatedByLines = false;
  let truncatedByChars = false;

  if (lines.length > MAX_PREVIEW_LINES) {
    preview = lines.slice(0, MAX_PREVIEW_LINES).join("\n");
    truncatedByLines = true;
  }
  if (preview.length > MAX_PREVIEW_CHARS) {
    preview = preview.slice(0, MAX_PREVIEW_CHARS);
    truncatedByChars = true;
  }

  return {
    preview,
    truncated: truncatedByLines || truncatedByChars,
    truncatedByChars,
    totalLines: lines.length,
    previewLines: preview.split("\n").length,
  };
}

/**
 * Bloque expandible con metadata (type/format/selector/prehidingSelector/tamaño)
 * y preview truncado del content de una decisión dom-action. `idx` es la
 * posición de la decisión en lastRenderedDecisions, para que el botón
 * "Copiar completo" pueda tomar el content ORIGINAL sin escapar por índice,
 * sin tener que reinyectar el string completo en un atributo HTML.
 */
function renderActivityContent(domAction, idx, activityId) {
  const fields = [
    ["type", domAction.type],
    ["format", domAction.format],
    ["selector", domAction.selector],
    ["prehidingSelector", domAction.prehidingSelector],
  ].filter(([, v]) => v != null && v !== "");

  const hasContent = typeof domAction.content === "string";
  if (fields.length === 0 && !hasContent) return "";
  if (hasContent) fields.push(["tamaño", formatContentSize(domAction.content.length)]);

  const metaHtml = fields
    .map(([k, v]) => `<span class="activity__content-field"><b>${escapeHtml(k)}</b> ${escapeHtml(String(v))}</span>`)
    .join("");

  let bodyHtml = "";
  if (hasContent) {
    const { preview, truncated, truncatedByChars, totalLines, previewLines } = truncatePreview(domAction.content);
    const note = !truncated
      ? ""
      : truncatedByChars
        ? `Mostrando los primeros ${MAX_PREVIEW_CHARS} caracteres de ${domAction.content.length}.`
        : `Mostrando ${previewLines} de ${totalLines} líneas.`;

    bodyHtml = `
      <pre class="raw-pre">${escapeHtml(preview)}</pre>
      ${note ? `<div class="activity__content-note">${note}</div>` : ""}
      <button class="btn-copy-content" data-idx="${idx}">Copiar completo</button>
    `;
  }

  const key = String(activityId);
  return `
    <details class="activity__content" data-key="${escapeHtml(key)}"${openActivityContent.has(key) ? " open" : ""}>
      <summary class="raw-summary" aria-label="Ver contenido de la actividad ${escapeHtml(key)}">Ver contenido</summary>
      <div class="activity__content-meta">${metaHtml}</div>
      ${bodyHtml}
    </details>
  `;
}

// Última lista de decisiones renderizada en "Actividades" — referencia para
// que el botón "Copiar completo" tome el content original por índice sin
// tener que reinyectar el string completo en un atributo HTML.
let lastRenderedDecisions = [];

// Bloques "Ver contenido" que el usuario dejó abiertos, por activity.id. Cada
// respuesta nueva de Alloy re-renderiza la lista entera (innerHTML); sin esto
// el bloque que se estaba leyendo se cerraba solo. Vive en memoria, igual que
// eventFilterState.
const openActivityContent = new Set();

/**
 * Estado de renderizado de cada actividad a partir de renderEvents (ver
 * onContentRendering en inject.js), en el orden en que llegaron:
 *   - "rendering-started" marca las actividades que Alloy va a aplicar
 *     → "pending" hasta que llegue otra cosa.
 *   - "rendering-succeeded" lista las que aplicó → "ok".
 *   - "rendering-failed" → "failed", con el error.
 * Una actividad que nunca aparece no la renderizó Alloy solo (la aplica la
 * página con applyPropositions, o es una oferta JSON): eso se muestra aparte,
 * y solo si se capturó algún evento de renderizado — si no, no se sabe nada.
 */
function getRenderState(renderEvents) {
  const byActivity = new Map();
  let lastHide = null;
  let lastShow = null;
  renderEvents.forEach((ev) => {
    const ids = Array.isArray(ev.activityIds) ? ev.activityIds : [];
    if (ev.status === "rendering-started") {
      ids.forEach((id) => {
        if (!byActivity.has(id)) byActivity.set(id, { status: "pending" });
      });
    } else if (ev.status === "rendering-succeeded") {
      ids.forEach((id) => byActivity.set(id, { status: "ok" }));
    } else if (ev.status === "rendering-failed") {
      ids.forEach((id) => byActivity.set(id, { status: "failed", error: ev.error }));
    } else if (ev.status === "hide-containers") {
      lastHide = ev;
      lastShow = null;
    } else if (ev.status === "show-containers") {
      lastShow = ev;
    }
  });
  const hasRendering = renderEvents.some((ev) => String(ev.status).startsWith("rendering-"));
  // Prehiding: cuánto estuvo tapada la página la última vez, o si sigue tapada.
  let prehiding = null;
  if (lastHide) {
    prehiding =
      lastShow && Number.isFinite(lastShow.t) && Number.isFinite(lastHide.t)
        ? { hiddenMs: Math.max(0, Math.round(lastShow.t - lastHide.t)) }
        : { stillHidden: !lastShow };
  }
  return { byActivity, hasRendering, prehiding };
}

const RENDER_BADGES = {
  ok: { label: "Renderizada", title: "Alloy confirmó que aplicó esta actividad en la página." },
  failed: { label: "Falló el render", title: "Alloy intentó aplicar esta actividad y falló." },
  pending: {
    label: "Sin confirmar",
    title: "Alloy empezó a aplicarla pero no confirmó que terminó (p. ej. el selector no existe en la página).",
  },
  none: {
    label: "Sin render automático",
    title: "Alloy no la aplicó solo: la renderiza la página (applyPropositions o renderDecisions: false) o es una oferta JSON.",
  },
};

function renderBadgeHtml(state) {
  const badge = RENDER_BADGES[state.status];
  const title = state.error ? `${badge.title} Error: ${state.error}` : badge.title;
  return `<span class="render-badge render-badge--${state.status}" title="${escapeHtml(title)}">${badge.label}</span>`;
}

/** Aviso de prehiding arriba de Actividades: el tiempo que el contenido estuvo oculto, o si sigue oculto. */
function prehidingNoteHtml(prehiding) {
  if (!prehiding) return "";
  if (prehiding.stillHidden) {
    return `<div class="list__note list__note--warn"><span>Prehiding: Alloy ocultó contenido y todavía no lo volvió a mostrar.</span></div>`;
  }
  if (Number.isFinite(prehiding.hiddenMs)) {
    return `<div class="list__note" title="Tiempo entre hide-containers y show-containers de Alloy"><span>Prehiding: el contenido estuvo oculto <b>${prehiding.hiddenMs} ms</b> mientras respondía Target.</span></div>`;
  }
  return "";
}

// Cookies que suelen ser de consentimiento (OneTrust, Cookiebot, banners
// propios). Heurística por nombre: solo decide qué texto mostrar, nunca qué
// se captura.
const CONSENT_COOKIE_RE = /consent|politica|privacidad|privacy|gdpr|optanon|cookielaw|cookiebot|cmp|euconsent/i;
const TARGET_RULE_RE = /target|personaliz|alloy|web ?sdk|aep/i;

/**
 * Por qué Actividades está vacía, cuando los datos lo dicen. Devuelve
 * { html, warn } (todo valor capturado escapado) o null si no hay nada que
 * explicar. `warn` marca los motivos que bloquean (at.js, consentimiento):
 * se pintan como advertencia y el indicador de la URL pasa a naranja, en vez
 * de verse igual que el "Sin capturas aún" neutro. En orden:
 *   1. at.js sin Alloy: la extensión inspecciona Web SDK (medido en
 *      allianz.com, canada.ca, pwc.com, whirlpool.com, infosys.com).
 *   2. Una regla de Target que no corrió por una cookie de consentimiento
 *      (viabcp.com sin aceptar cookies: "Adobe Target" exige
 *      politica_privacidad_personalizacion y Target nunca se llama).
 *   3. Varias reglas esperando una cookie de consentimiento.
 *   4. Alloy configurado: con llamadas pero sin actividades, o sin llamadas.
 * Una regla "de Target" que falló por path/valueComparison NO se usa como
 * motivo: en nvidia.com o whirlpool.com hay decenas, de otras páginas, y
 * señalar una era engañoso.
 */
function whyNoActivities(data) {
  const instances = Array.isArray(data.instanceInfo) ? data.instanceInfo : data.instanceInfo ? [data.instanceInfo] : [];
  const hits = data.hits || [];
  const decisionCalls = hits.filter((h) => (h.scopes || []).length > 0 || (h.eventTypes || []).includes("decisioning.propositionFetch"));

  if (data.pageSdk?.atjs && instances.length === 0) {
    const v = data.pageSdk.atjsVersion ? ` ${escapeHtml(data.pageSdk.atjsVersion)}` : "";
    return { warn: true, html: `Esta página usa <strong>at.js${v}</strong> (Adobe Target clásico), no Web SDK (Alloy).<br>La extensión inspecciona Web SDK: acá funcionan <button class="inline-link" data-goto="launch">Launch</button> y <button class="inline-link" data-goto="eventos">Eventos</button>, no Actividades.` };
  }

  const failed = (data.launchRules || []).filter((r) => r.status === "failed");
  const condText = (c) =>
    `<strong>${escapeHtml([c.extension, c.kind].filter(Boolean).join(" · "))}</strong>${c.detail ? " " + escapeHtml(c.detail) : ""}`;
  const consentCond = (r) => (r.conditions || []).find((c) => c.kind === "cookie" && CONSENT_COOKIE_RE.test(c.detail || ""));

  if (decisionCalls.length === 0) {
    const targetRule = failed.find((r) => TARGET_RULE_RE.test(r.ruleName || "") && consentCond(r));
    if (targetRule) {
      return { warn: true, html: `Launch no ejecutó la regla <strong>${escapeHtml(targetRule.ruleName)}</strong>: no se cumplió ${condText(consentCond(targetRule))}.<br>Parece la cookie de consentimiento: acepta las cookies del sitio y recarga. <button class="inline-link" data-goto="launch" data-search="${escapeHtml(targetRule.ruleName)}">Ver la regla en Launch</button>` };
    }
    const consentBlocked = failed.filter(consentCond);
    if (consentBlocked.length > 0) {
      return { warn: true, html: `${consentBlocked.length} ${consentBlocked.length === 1 ? "regla de Launch espera" : "reglas de Launch esperan"} una cookie de consentimiento (p. ej. ${condText(consentCond(consentBlocked[0]))}) y Alloy no pidió decisiones a Target.<br>Acepta las cookies del sitio y recarga.` };
    }
  }

  if (instances.length > 0) {
    if (decisionCalls.length > 0) {
      const noOffers = (data.renderEvents || []).some((e) => e.status === "no-offers");
      return { warn: false, html: `Alloy pidió decisiones a Target${decisionCalls.length > 1 ? ` ${decisionCalls.length} veces` : ""}, pero no vino ninguna actividad para esta página${noOffers ? " (Alloy informó <span class=\"mono\">no-offers</span>)" : ""}.<br>Abre <button class="inline-link" data-goto="hits">Hits</button> para ver qué se pidió y qué respondió.` };
    }
    return { warn: false, html: hits.length > 0
      ? `Alloy hizo ${hits.length} ${hits.length === 1 ? "llamada" : "llamadas"} al Edge, pero ninguna pidió decisiones a Target.<br>Abre <button class="inline-link" data-goto="hits">Hits</button> para ver qué se envió.`
      : "Alloy está configurado, pero no envió ninguna llamada al Edge en esta carga.<br>Abre <button class=\"inline-link\" data-goto=\"launch\">Launch</button>: puede que la regla que lo dispara no se haya cumplido." };
  }
  return null;
}

/** Clave de "misma página" para comparar la pestaña con lo capturado: incluye el query string (dos productos distintos bajo el mismo path no son la misma página), excluye el fragmento. */
function pageKey(url) {
  const u = new URL(url);
  return u.origin + u.pathname + u.search;
}

/**
 * Renderiza la pestaña "Actividades".
 * Lee requests del storage, deduplica por activity.id y genera el listado.
 */
function render(currentTabUrl) {
  chrome.storage.local.get(["requests", "tabUrl", "renderEvents", "launchRules", "launchInfo", "instanceInfo", "hits", "pageSdk", "domMboxes"], (data) => {
    if (showBlockedIn("list")) return;
    const requests = data.requests || [];
    const tabUrl = data.tabUrl || "";
    const renderState = getRenderState(data.renderEvents || []);
    const list = document.getElementById("list");
    const count = document.getElementById("count");
    const pageUrl = document.getElementById("page-url");
    const ts = document.getElementById("ts");

    // Si el usuario navegó a otra página, los datos en storage no corresponden
    try {
      if (pageKey(currentTabUrl) !== pageKey(tabUrl) && requests.length > 0) {
        showStale(currentTabUrl);
        return;
      }
    } catch (e) {}

    if (requests.length === 0) {
      // Con un motivo concreto no se ofrece "Capturar ahora": reinyectar no
      // arregla una cookie que falta ni una regla que no corrió.
      const reason = whyNoActivities(data);
      setActSummary("");
      list.innerHTML = emptyStateHtml(
        reason?.warn ? "alert" : "signal",
        reason?.html ||
          "Sin capturas aún.<br>Recarga la página, o usa <strong>Capturar ahora</strong> si la pestaña ya estaba abierta antes de cargar la extensión.",
        !reason,
        !!reason?.warn,
      );
      renderMboxDock([], data.domMboxes || []);
      count.textContent = "0 ACT";
      // Sin capturas no hay "última": tras Limpiar no debe quedar la hora vieja.
      ts.textContent = "—";
      pageUrl.textContent = hostAndPath(currentTabUrl) || "Sin página activa";
      // Verde solo si hay señal de que la captura está viva (Alloy
      // configurado o Launch detectado); sin nada capturado, gris.
      setIndicator(!currentTabUrl ? "idle" : reason?.warn ? "warn" : reason || captureIsLive(data) ? "ok" : "idle");
      return;
    }

    pageUrl.textContent = hostAndPath(requests[0].url) || hostAndPath(currentTabUrl);
    setIndicator("ok");

    ts.textContent =
      "Última: " + new Date(requests[0].time).toLocaleTimeString("es-PE");

    // Aplana todas las decisiones de personalización de todos los requests capturados
    const allDecisions = requests.flatMap(
      (r) =>
        r.payload?.handle
          ?.filter((h) => h.type === "personalization:decisions")
          ?.flatMap((h) => h.payload) || [],
    );

    // Muestra una sola fila por actividad (pueden llegar duplicadas en múltiples requests)
    // Una actividad puede responder en varios scopes (bankofamerica.com: una
    // sola en 8 mboxes). Se junta la lista entera por actividad, ordenada
    // (__view__ primero): antes la fila mostraba el scope de la primera
    // decisión que llegara, y cambiaba de una carga a otra.
    const scopesByActivity = new Map();
    allDecisions.forEach((d) => {
      const id = d.scopeDetails?.activity?.id;
      if (!id || !d.scope) return;
      if (!scopesByActivity.has(id)) scopesByActivity.set(id, new Set());
      scopesByActivity.get(id).add(d.scope);
    });
    const sortedScopes = (id) =>
      [...(scopesByActivity.get(id) || [])].sort((a, b) => (a === "__view__" ? -1 : b === "__view__" ? 1 : String(a).localeCompare(String(b))));

    const seen = new Set();
    const unique = allDecisions.filter((d) => {
      const id = d.scopeDetails?.activity?.id;
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    count.textContent = `${unique.length} ACT`;

    // Hubo respuestas pero ninguna trajo actividades (identidad, consentimiento,
    // no-offers — medido en elpais.com, ibm.com, redhat.com): antes la lista
    // quedaba vacía con solo el aviso del tenant, sin decir nada.
    if (unique.length === 0) {
      const reason = whyNoActivities(data);
      setActSummary("");
      list.innerHTML = emptyStateHtml(
        reason?.warn ? "alert" : "target",
        reason?.html ||
          `Alloy recibió ${requests.length} ${requests.length === 1 ? "respuesta" : "respuestas"} del Edge, pero ninguna trajo actividades de Target para esta página.`,
        false,
        !!reason?.warn,
      );
      if (reason?.warn) setIndicator("warn");
      renderMboxDock(requests, data.domMboxes || []);
      return;
    }

    // Impresión: Target cuenta una actividad recién cuando Alloy le notifica
    // el display (decisioning.propositionDisplay, o propuestas en el
    // _experience de otro evento — ver summarizeHitBody en content.js). Solo
    // se evalúa si se capturaron hits en esta carga: sin hits no se sabe nada,
    // y afirmar "no notificada" sería falso (p. ej. captura iniciada tarde).
    const hits = data.hits || [];
    const displayed = new Set(hits.flatMap((h) => h.displayedActivities || []));
    const knowsDisplay = hits.length > 0;
    let renderedWithoutDisplay = 0;

    lastRenderedDecisions = unique;

    // Todo valor que sale del payload (nombre, scope, experiencia, id) pasa
    // por escapeHtml: la extensión corre en cualquier sitio y la página
    // controla esos strings. El recorte de nombres largos lo hace el CSS.
    const rowsHtml = unique
      .map((d, idx) => {
        const scopes = sortedScopes(d.scopeDetails?.activity?.id);
        const scope = formatScope(scopes[0] ?? d.scope);
        const moreScopes = scopes.slice(1);
        const { name, id, exp, actType } = getActivityInfo(d);
        const displayName = name || `Actividad ${id}`;
        const targetUrl = getTargetUrl(actType, id);
        // Si no se pudo detectar el tipo, se ofrecen ambos links como hipótesis
        const urlAB = !actType ? getTargetUrl("AB", id) : null;
        const urlXT = !actType ? getTargetUrl("XT", id) : null;
        const domAction = getDomActionData(d);
        const rendered = renderState.byActivity.get(String(id)) || (renderState.hasRendering ? { status: "none" } : null);
        const notified = displayed.has(String(id));
        if (knowsDisplay && rendered?.status === "ok" && !notified) renderedWithoutDisplay += 1;

        let actionsHtml = "";
        if (targetUrl) {
          actionsHtml = `<a class="activity__open" href="${escapeHtml(targetUrl)}" target="_blank" rel="noopener">Abrir en Target ↗</a>`;
        } else if (urlAB) {
          actionsHtml = `
            <span class="activity__guess-label">Tipo no detectado. Abrir como:</span>
            <a href="${escapeHtml(urlAB)}" target="_blank" rel="noopener" class="guess-btn guess-btn--ab">A/B ↗</a>
            <a href="${escapeHtml(urlXT)}" target="_blank" rel="noopener" class="guess-btn guess-btn--xt">XT ↗</a>`;
        }

        return `
        <div class="activity" data-key="act|${escapeHtml(id)}">
          <div class="activity__tags">
            <span class="scope-tag scope-tag--${scope.type}" title="${escapeHtml(scope.type === "vec" ? "Visual Experience Composer (__view__)" : scope.label)}">${escapeHtml(scope.label)}</span>
            ${moreScopes.length ? `<span class="scope-tag scope-tag--more" title="${escapeHtml(moreScopes.map((x) => formatScope(x).label).join("\n"))}">+${moreScopes.length} ${moreScopes.length === 1 ? "scope" : "scopes"}</span>` : ""}
            ${actType ? `<span class="activity__type activity__type--${actType.toLowerCase()}" title="Tipo inferido del nombre de la actividad: el payload no lo informa">${actType === "AB" ? "A/B" : "XT"}</span>` : ""}
            ${rendered ? renderBadgeHtml(rendered) : ""}
          </div>
          <div class="activity__name" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</div>
          <div class="activity__meta">
            <button class="activity__id" data-copy="${escapeHtml(id)}" title="Copiar ID de la actividad">#${escapeHtml(id)}</button>
            ${exp ? `<span class="activity__separator" aria-hidden="true">·</span><span class="activity__experience">${escapeHtml(exp)}</span>` : ""}
            ${knowsDisplay && notified ? `<span class="activity__separator" aria-hidden="true">·</span><span class="activity__display" title="Alloy notificó el display a Target: la impresión se cuenta">impresión notificada</span>` : ""}
            ${knowsDisplay && !notified && rendered?.status === "ok" ? `<span class="activity__separator" aria-hidden="true">·</span><span class="activity__display activity__display--missing" title="Alloy la aplicó, pero en esta carga no notificó el display a Target: la impresión no se contó">impresión sin notificar</span>` : ""}
          </div>
          ${rendered?.status === "failed" && rendered.error ? `<div class="activity__render-error">Error al renderizar: ${escapeHtml(rendered.error)}</div>` : ""}
          ${actionsHtml ? `<div class="activity__actions">${actionsHtml}</div>` : ""}
          ${domAction ? renderActivityContent(domAction, idx, id) : ""}
        </div>
      `;
      })
      .join("");

    // Sin tenant no hay links a Target: se dice acá, junto a las filas que
    // los tendrían, en vez de dejar que el usuario descubra la barra de abajo.
    const tenantNote = tenant
      ? ""
      : `<div class="list__note"><span>Configura el tenant para abrir actividades en Target.</span><button class="list__note-action" id="focus-tenant">Configurar</button></div>`;

    const displayNote = renderedWithoutDisplay
      ? `<div class="list__note list__note--warn"><span>${renderedWithoutDisplay} ${renderedWithoutDisplay === 1 ? "actividad renderizada no notificó" : "actividades renderizadas no notificaron"} la impresión (display) en esta carga: Target la cuenta recién cuando se notifica.</span><button class="list__note-action" data-goto="hits" data-filter="display">Ver Hits</button></div>`
      : "";

    // Veredicto de la página en una línea: lo que un QA firma. Cada tramo
    // aparece solo si hay datos para afirmarlo (sin eventos de render o sin
    // hits no se inventa un "0").
    const renderedOk = unique.filter((d) => renderState.byActivity.get(String(d.scopeDetails?.activity?.id))?.status === "ok").length;
    const notifiedCount = unique.filter((d) => displayed.has(String(d.scopeDetails?.activity?.id))).length;
    setActSummary(
      [
        `<b>${unique.length}</b> ${unique.length === 1 ? "actividad" : "actividades"}`,
        renderState.hasRendering ? `<b>${renderedOk}</b> ${renderedOk === 1 ? "renderizada" : "renderizadas"}` : null,
        knowsDisplay ? `<b>${notifiedCount}</b> con impresión notificada` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    );

    const scrollTop = list.scrollTop;
    const focused = focusDescriptor(list);
    list.innerHTML =
      prehidingNoteHtml(renderState.prehiding) +
      displayNote +
      tenantNote +
      rowsHtml;
    renderMboxDock(requests, data.domMboxes || []);
    list.scrollTop = scrollTop;
    restoreFocus(list, focused);
  });
}

// "toggle" no burbujea — se escucha en captura para registrar qué bloques
// "Ver contenido" quedan abiertos (ver openActivityContent).
document.getElementById("list").addEventListener(
  "toggle",
  (e) => {
    const key = e.target.dataset?.key;
    if (!key || !e.target.classList.contains("activity__content")) return;
    if (e.target.open) openActivityContent.add(key);
    else openActivityContent.delete(key);
  },
  true,
);

// Click delegado en "Copiar completo" (bloque de contenido expandido de una
// actividad): copia el content ORIGINAL sin escapar al portapapeles — la
// vista de arriba está truncada y escapada solo para mostrar, nunca es la fuente.
document.getElementById("list").addEventListener("click", (e) => {
  const btn = e.target.closest(".btn-copy-content");
  if (!btn) return;
  const decision = lastRenderedDecisions[Number(btn.dataset.idx)];
  const content = decision?.items?.[0]?.data?.content;
  if (typeof content !== "string") return;
  navigator.clipboard
    .writeText(content)
    .then(() => showToast("Contenido completo copiado al portapapeles."))
    .catch(() => showToast("No se pudo copiar al portapapeles.", { error: true }));
});

// Copia al portapapeles: el ID de una actividad (data-copy) o el payload
// completo de un evento (data-copy-event, tomado de lastRenderedEvents, no
// del texto mostrado). Un solo listener para las dos listas.
function copyText(text, okMessage) {
  navigator.clipboard
    .writeText(text)
    .then(() => showToast(okMessage))
    .catch(() => showToast("No se pudo copiar al portapapeles.", { error: true }));
}

document.addEventListener("click", (e) => {
  const idBtn = e.target.closest("[data-copy]");
  if (idBtn) {
    copyText(idBtn.dataset.copy, `ID ${idBtn.dataset.copy} copiado.`);
    return;
  }
  const evBtn = e.target.closest("[data-copy-event]");
  if (!evBtn) return;
  const ev = lastRenderedEvents.get(evBtn.dataset.copyEvent);
  if (!ev) return;
  let json;
  try {
    json = JSON.stringify(ev.payload, null, 2);
  } catch (err) {
    json = String(ev.payload);
  }
  copyText(json, "Payload copiado al portapapeles.");
});

// Búsqueda en Eventos: re-render con un pequeño debounce mientras se tipea.
let eventSearchTimer = null;
document.getElementById("event-search").addEventListener("input", (e) => {
  clearTimeout(eventSearchTimer);
  eventSearchTimer = setTimeout(() => {
    eventSearch = e.target.value.trim();
    renderEventos();
  }, 150);
});

// Atajo del aviso "Configura el tenant…" de la lista de actividades.
document.getElementById("list").addEventListener("click", (e) => {
  if (e.target.id === "focus-tenant") document.getElementById("tenant-input").focus();
});

/**
 * Limpia todo lo capturado (requests/domMboxes/digitalDataEvents, más el
 * renderizado y las reglas de Launch). La usa el botón Limpiar: es el único
 * "empezar de nuevo" explícito, a diferencia del reset automático por cambio
 * de página de content.js. launchInfo e instanceInfo quedan: son la
 * configuración de la página, no capturas.
 */
const CLEARABLE_KEYS = ["requests", "domMboxes", "digitalDataEvents", "renderEvents", "launchRules", "hits"];

function clearCapturedData(callback) {
  chrome.storage.local.set(Object.fromEntries(CLEARABLE_KEYS.map((k) => [k, []])), () => {
    callback && callback();
  });
}

// ── Botón Limpiar (con Deshacer) ──────────────────────────────────────────────
// digitalDataEvents es el registro de todo el recorrido: un click perdido acá
// borraba hasta 500 eventos sin vuelta atrás. Se guarda una copia en memoria
// antes de borrar y se ofrece "Deshacer" unos segundos. Al deshacer se mergea
// con lo que se haya capturado mientras tanto (lo nuevo primero, mismos topes
// que content.js) en vez de pisarlo.
const UNDO_WINDOW_MS = 6000;

document.getElementById("clear").addEventListener("click", () => {
  chrome.storage.local.get(CLEARABLE_KEYS, (before) => {
    const hadData = CLEARABLE_KEYS.some((k) => (before[k] || []).length > 0);
    clearCapturedData(() => {
      getInspectedTab((tab) => render(tab?.url || ""));
      if (!hadData) {
        showToast("No había capturas para borrar.");
        return;
      }
      showToast("Capturas y eventos borrados.", {
        action: "Deshacer",
        duration: UNDO_WINDOW_MS,
        onAction: () => {
          chrome.storage.local.get(CLEARABLE_KEYS, (now) => {
            // Reglas: agregadas por key en content.js — las de antes solo
            // vuelven si no se capturaron de nuevo mientras tanto.
            const nowRuleKeys = new Set((now.launchRules || []).map((r) => r.key));
            chrome.storage.local.set(
              {
                requests: [...(now.requests || []), ...(before.requests || [])].slice(0, 50),
                domMboxes: [...new Set([...(now.domMboxes || []), ...(before.domMboxes || [])])],
                digitalDataEvents: [...(now.digitalDataEvents || []), ...(before.digitalDataEvents || [])].slice(0, 500),
                // renderEvents va en orden de llegada (más viejo primero).
                renderEvents: [...(before.renderEvents || []), ...(now.renderEvents || [])].slice(-200),
                hits: [...(before.hits || []), ...(now.hits || [])].slice(-100),
                launchRules: [
                  ...(before.launchRules || []).filter((r) => !nowRuleKeys.has(r.key)),
                  ...(now.launchRules || []),
                ].slice(0, 400),
              },
              () => showToast("Capturas restauradas."),
            );
          });
        },
      });
    });
  });
});

/**
 * Botón "Capturar ahora" (en los estados vacíos): reinyecta inject.js y
 * content.js en la pestaña activa vía chrome.scripting.executeScript.
 * Soluciona el caso de una pestaña que ya estaba abierta antes de recargar
 * la extensión (los content_scripts del manifest solo se inyectan en cargas
 * de página nuevas). inject.js/content.js tienen guards de idempotencia
 * para que esto sea seguro aunque ya estén activos.
 */
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".btn-inject");
  if (!btn) return;
  getInspectedTab(async (tab) => {
    const tabId = tab?.id;
    if (!tabId) {
      showToast("No hay una pestaña para inspeccionar.", { error: true });
      return;
    }
    btn.disabled = true;
    try {
      // content.js primero y esperado: inject.js postea el escaneo del DOM
      // de forma síncrona al cargar, y si el listener del puente todavía no
      // está registrado ese mensaje se pierde.
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
      await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: ["inject.js"] });
      showToast("Captura activa en la pestaña. Lo que Target ya respondió antes no se recupera: recarga la página para verlo.", {
        duration: 7000,
      });
    } catch (err) {
      showToast("No se pudo inyectar en esta pestaña (página protegida o sin permiso).", { error: true });
    } finally {
      btn.disabled = false;
    }
  });
});

/**
 * Muestra orgId/edgeConfigId de las instancias de Alloy en el footer (si ya
 * se capturaron). content.js guarda una lista, una por instancia; con varias
 * se muestra la primera y "+N", y el detalle de todas va en el tooltip.
 */
function renderInstanceInfo() {
  chrome.storage.local.get("instanceInfo", (data) => {
    const el = document.getElementById("edge-info");
    const raw = data.instanceInfo;
    const list = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(Boolean);
    if (list.length === 0) {
      // La versión sale del manifest: una sola fuente, sin string duplicado acá.
      el.textContent = `v${chrome.runtime.getManifest().version} · Target Inspector`;
      el.title = "";
      return;
    }
    const shortEdge = (info) => (info.edgeConfigId ? String(info.edgeConfigId).slice(0, 8) : "?");
    el.textContent =
      list.length === 1
        ? `datastream ${shortEdge(list[0])}`
        : `${list.length} instancias · ${list.map(shortEdge).join(" · ")}`;
    el.title = list
      .map((i) => `${i.namespace || "?"} → datastream: ${i.edgeConfigId || "?"} · orgId: ${i.orgId || "?"} · edgeDomain: ${i.edgeDomain || "?"}`)
      .join("\n");
  });
}

// ── Carga inicial: verificar dominio y renderizar ─────────────────────────────
// Si este documento se abrió como ventana independiente (?tabId= en la URL),
// marcarlo para que el CSS relaje el ancho fijo y el tope de altura de las listas.
if (new URLSearchParams(location.search).has("tabId")) {
  document.body.classList.add("window-mode");
}

/**
 * Input del tenant de Adobe Target en el footer: lo puebla con el valor
 * guardado, y al cambiarlo lo persiste y re-renderiza la pestaña activa para
 * que aparezcan/desaparezcan los deep-links "Abrir en Target ↗".
 */
function setupTenantInput() {
  const input = document.getElementById("tenant-input");
  if (!input) return;
  input.value = tenant;
  const commit = () => {
    const next = input.value.trim();
    // El slug va dentro de una URL: solo letras, números, punto, guion y
    // guion bajo. Cualquier otra cosa (una URL pegada entera, espacios) se
    // rechaza con aviso en vez de guardarse y generar links rotos.
    const valid = next === "" || /^[A-Za-z0-9._-]+$/.test(next);
    input.setAttribute("aria-invalid", String(!valid));
    if (!valid) {
      showToast("Tenant inválido: usa solo el slug que aparece después de @ en la URL de Target.", { error: true });
      return;
    }
    if (next === tenant) return;
    tenant = next;
    chrome.storage.local.set({ tenant }, () =>
      showToast(tenant ? "Tenant guardado: los links a Target ya están activos." : "Tenant borrado: sin links a Target."),
    );
    getInspectedTab((tab) => tab && isAllowedDomain(tab.url) && render(tab.url));
  };
  input.addEventListener("change", commit);
  input.addEventListener("blur", commit);
}

// Cargar el tenant guardado ANTES del primer render, para que los deep-links
// se construyan con el valor correcto desde el arranque.
chrome.storage.local.get("tenant", (data) => {
  tenant = typeof data.tenant === "string" ? data.tenant : "";
  setupTenantInput();

  getInspectedTab((tab) => {
    if (!tab) {
      showTabClosed();
      return;
    }
    if (!isAllowedDomain(tab.url)) {
      showBlocked();
    } else {
      render(tab.url);
      renderInstanceInfo();
    }
  });
});

// La pestaña QA se eliminó: se borra la clave "qaMode" que pudo quedar en
// storage de versiones anteriores, para no dejar estado huérfano.
chrome.storage.local.remove("qaMode");

// ── Tabs ──────────────────────────────────────────────────────────────────────
// Patrón tablist de WAI-ARIA: una sola tab en el orden de tabulación (roving
// tabindex), flechas izquierda/derecha y Home/End para moverse entre ellas.
const tabItems = [...document.querySelectorAll(".tabs__item")];

function activateTab(tab) {
  tabItems.forEach((t) => {
    const selected = t === tab;
    t.classList.toggle("tabs__item--active", selected);
    t.setAttribute("aria-selected", String(selected));
    t.tabIndex = selected ? 0 : -1;
  });
  document
    .querySelectorAll(".panel")
    .forEach((p) => p.classList.remove("panel--active"));
  document
    .getElementById(`panel-${tab.dataset.tab}`)
    .classList.add("panel--active");
  if (tab.dataset.tab === "eventos") renderEventos();
  if (tab.dataset.tab === "launch") renderLaunch();
  if (tab.dataset.tab === "hits") renderHits();
}

tabItems.forEach((tab, i) => {
  tab.addEventListener("click", () => activateTab(tab));
  tab.addEventListener("keydown", (e) => {
    const last = tabItems.length - 1;
    const next =
      e.key === "ArrowRight" ? (i === last ? 0 : i + 1)
      : e.key === "ArrowLeft" ? (i === 0 ? last : i - 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : -1;
    if (next === -1) return;
    e.preventDefault();
    tabItems[next].focus();
    activateTab(tabItems[next]);
  });
});

/**
 * Sección "mBoxes" al final de Actividades (antes era una pestaña propia:
 * vacía o de una fila en los 17 sitios probados, y la que dejaba "Launch"
 * fuera de la ventana a 380px). Cruza los [data-mbox] del DOM con los scopes
 * que Target respondió y los clasifica en En uso / Libres / Solo Alloy.
 * Sin ningún mbox ni scope nombrado (páginas 100% VEC) la sección igual
 * aparece, con una línea que lo dice: cuando se omitía del todo parecía que
 * los mBoxes habían desaparecido de la extensión. Solo devuelve "" si además
 * no hubo ninguna respuesta de Target (ahí el estado vacío ya lo explica).
 */
// Va en una franja fija debajo de la lista (#mbox-dock), no adentro: al final
// de una lista con scroll nadie la encontraba. Cerrada por defecto — la franja
// con el resumen siempre está a la vista; al abrirla, sus filas scrollean aparte.
let mboxSectionOpen = false;

function renderMboxDock(requests, domMboxes) {
  const dock = document.getElementById("mbox-dock");
  const scroller = dock.querySelector(".mbox-section__rows");
  const scrollTop = scroller ? scroller.scrollTop : 0;
  const focused = focusDescriptor(dock);
  dock.innerHTML = mboxSectionHtml(requests, domMboxes);
  const next = dock.querySelector(".mbox-section__rows");
  if (next) next.scrollTop = scrollTop;
  restoreFocus(dock, focused);
}

function mboxSectionHtml(requests, domMboxes) {
  // scope → nombres de TODAS las actividades que respondieron en él (antes
  // se guardaba solo la primera, y bbva.pe mostraba una actividad distinta a
  // las dos que Actividades listaba para el mismo scope).
  const activeMboxes = new Map();
  let hasVec = false;
  requests.forEach((r) => {
    const decisions =
      r.payload?.handle?.filter((h) => h.type === "personalization:decisions")?.flatMap((h) => h.payload) || [];
    decisions.forEach((d) => {
      if (d.scope === "__view__") hasVec = true;
      if (!d.scope || d.scope === "__view__") return;
      const name = d.items?.[0]?.meta?.["activity.name"] || d.scopeDetails?.activity?.name || null;
      if (!activeMboxes.has(d.scope)) activeMboxes.set(d.scope, new Set());
      if (name) activeMboxes.get(d.scope).add(name);
    });
  });

  const activeSet = new Set(activeMboxes.keys());
  const domSet = new Set(domMboxes);
  const allMboxes = new Set([...domSet, ...activeSet]);
  if (allMboxes.size === 0) {
    if (requests.length === 0) return "";
    return `
    <div class="mbox-section mbox-section--empty">
      <div class="mbox-section__summary mbox-section__summary--static">
        <span class="mbox-section__title">mBoxes</span>
        <span>Sin mboxes con nombre ni elementos <span class="mono">[data-mbox]</span> en esta página.${hasVec ? ` Todo corre por VEC (<span class="mono">__view__</span>).` : ""}</span>
      </div>
    </div>`;
  }

  // Mismas tres categorías que los badges de cada fila, así el resumen
  // siempre suma: En uso + Libres = mboxes del DOM, y Alloy va aparte.
  const enUso = [...domSet].filter((m) => activeSet.has(m)).length;
  const libres = domSet.size - enUso;
  const soloAlloy = [...activeSet].filter((m) => !domSet.has(m)).length;
  // Cada contador usa el mismo badge que las filas de adentro (verde solo para
  // "en uso"); en cero va como texto, para que el color señale lo que hay.
  const pill = (n, label, cls) =>
    n > 0 ? `<span class="status-badge ${cls}">${n} ${label}</span>` : `<span class="mbox-section__zero">${n} ${label}</span>`;
  const summary = [
    pill(enUso, "en uso", "status-badge--active"),
    pill(libres, libres === 1 ? "libre" : "libres", "status-badge--free"),
    pill(soloAlloy, "solo Alloy", "status-badge--alloy"),
    `<span class="mbox-section__dom" title="Elementos [data-mbox] encontrados en la página">${domSet.size} en el DOM</span>`,
  ].join("");

  // Orden: activos primero, luego libres; alfabético dentro de cada grupo
  const sorted = [...allMboxes].sort((a, b) => {
    const aA = activeSet.has(a),
      bA = activeSet.has(b);
    if (aA && !bA) return -1;
    if (!aA && bA) return 1;
    return String(a).localeCompare(String(b));
  });

  const rows = sorted
    .map((mbox) => {
      const isActive = activeSet.has(mbox);
      const isInDom = domSet.has(mbox);
      const names = [...(activeMboxes.get(mbox) || [])];
      let pillClass, pillLabel, pillTitle;
      if (isActive && isInDom) {
        pillClass = "status-badge--active";
        pillLabel = "En uso";
        pillTitle = "Está en el DOM y Target respondió para este scope";
      } else if (isActive) {
        pillClass = "status-badge--alloy";
        pillLabel = "Solo Alloy";
        pillTitle = "Target respondió, pero no hay ningún elemento [data-mbox] con este nombre";
      } else {
        pillClass = "status-badge--free";
        pillLabel = "Libre";
        pillTitle = "Está en el DOM, pero Target no le asignó nada";
      }
      // mbox sale de [data-mbox] de la página y los nombres del payload: se escapan.
      return `
        <div class="mbox-row">
          <div class="mbox-row__info">
            <div class="mbox-row__name">${escapeHtml(mbox)}</div>
            ${names.map((n) => `<div class="mbox-row__activity"><span aria-hidden="true">↳</span> ${escapeHtml(n)}</div>`).join("")}
          </div>
          <div class="mbox-row__status">
            <span class="status-badge ${pillClass}" title="${pillTitle}">${pillLabel}</span>
          </div>
        </div>`;
    })
    .join("");

  return `
    <div class="mbox-section${mboxSectionOpen ? " mbox-section--open" : ""}">
      <button class="mbox-section__summary" aria-expanded="${mboxSectionOpen}" aria-controls="mbox-rows">
        ${iconSvg("chevron", "mbox-section__chevron")}
        <span class="mbox-section__title">mBoxes</span>
        <span class="mbox-section__counts">${summary}</span>
      </button>
      <div class="mbox-section__rows" id="mbox-rows">${rows}</div>
    </div>`;
}

/**
 * Escapa HTML para interpolar cualquier valor capturado de la página (payload
 * de Alloy, digitalData, [data-mbox], URLs) sin inyección de markup. Escapa
 * también las comillas: varios valores van dentro de atributos (title, href,
 * data-*), donde una comilla sin escapar cerraba el atributo.
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Extrae un resumen legible de un push a digitalData: el campo `event` como
 * tag, y el primer objeto anidado con `.name` (patrón "promotion", "product",
 * etc.) como título + el resto de sus campos como metadata. Si el payload no
 * sigue ese patrón, no hay resumen — el payload crudo siempre se muestra
 * completo abajo, sin depender de esta heurística.
 */
function getEventSummary(payload) {
  const eventName =
    (payload && typeof payload === "object" && typeof payload.event === "string"
      ? payload.event
      : null) || "push";

  let subject = null;
  if (payload && typeof payload === "object") {
    for (const [key, value] of Object.entries(payload)) {
      if (key === "event") continue;
      if (value && typeof value === "object" && !Array.isArray(value) && typeof value.name === "string") {
        subject = value;
        break;
      }
    }
  }

  const title = subject?.name || null;
  const meta = subject
    ? Object.entries(subject)
        .filter(([k]) => k !== "name")
        .map(([, v]) => v)
        .filter((v) => typeof v === "string" || typeof v === "number")
    : [];

  return { eventName, title, meta };
}

// Estado de los chips de filtro por event name. Efímero a propósito: vive
// solo en memoria mientras el popup está abierto (nunca se escribe a
// chrome.storage), para que un chip apagado en una sesión anterior no
// esconda eventos nuevos sin que el usuario se dé cuenta. Solo se le agregan
// claves (nunca se resetea a vacío) para no perder el toggle del usuario
// cuando llegan eventos nuevos mientras el popup sigue abierto.
const eventFilterState = new Map();

// Estado de expansión de la pestaña Eventos, en memoria igual que los
// filtros. Cada push nuevo re-renderiza la lista entera; sin esto, la página,
// el grupo o el payload que se estaba leyendo se cerraban solos en cada evento.
// Las claves usan el evento MÁS VIEJO de cada corrida: los eventos nuevos
// entran por adelante (unshift), así que esa punta es la que no cambia.
const pageExpandOverrides = new Map(); // clave de página → true/false elegido por el usuario
const expandedEventGroups = new Set();
const openEventPayloads = new Set();

function eventKey(e) {
  return `${e.time}|${e.timeSincePageLoad ?? ""}`;
}

// Búsqueda de texto en Eventos (en memoria, como los chips): se combina con
// los chips — primero filtran los chips, después el texto.
let eventSearch = "";

/** Coincidencia sin distinguir mayúsculas contra el payload serializado y la página del evento. */
function eventMatchesSearch(e, query) {
  const q = query.toLowerCase();
  let text = "";
  try {
    text = JSON.stringify(e.payload) || "";
  } catch (err) {
    text = String(e.payload);
  }
  return text.toLowerCase().includes(q) || String(e.pageUrl || "").toLowerCase().includes(q);
}

// Eventos del último render, por eventKey — fuente del botón "Copiar
// payload", igual que lastRenderedDecisions para "Copiar completo".
let lastRenderedEvents = new Map();

/** Renderiza una sola ocurrencia de evento (nombre, hora, resumen y payload crudo colapsable). */
function renderEventRow(e) {
  const { eventName, title, meta } = getEventSummary(e.payload);
  const time = new Date(e.time).toLocaleTimeString("es-PE");
  const sincePageLoad =
    typeof e.timeSincePageLoad === "number"
      ? `+${(e.timeSincePageLoad / 1000).toFixed(1)}s`
      : "";
  const rawJson = (() => {
    try {
      return JSON.stringify(e.payload, null, 2);
    } catch (err) {
      return String(e.payload);
    }
  })();

  return `
    <div class="event-row">
      <div class="event-row__header">
        <span class="event-tag">${escapeHtml(eventName)}</span>
        <span class="event-row__time">${e.layer === "adobeDataLayer" ? "adobeDataLayer · " : ""}${time}${sincePageLoad ? " · " + sincePageLoad : ""}</span>
      </div>
      ${title ? `<div class="event-row__title">${escapeHtml(title)}</div>` : ""}
      ${meta.length ? `<div class="event-row__meta">${meta.map(escapeHtml).join(" · ")}</div>` : ""}
      <details class="event-row__raw" data-key="${escapeHtml(eventKey(e))}"${openEventPayloads.has(eventKey(e)) ? " open" : ""}>
        <summary class="raw-summary" aria-label="Payload de ${escapeHtml(eventName)}">Payload</summary>
        <pre class="raw-pre">${escapeHtml(rawJson)}</pre>
        <button class="btn-copy-content" data-copy-event="${escapeHtml(eventKey(e))}">Copiar payload</button>
      </details>
    </div>
  `;
}

/**
 * Agrupa corridas de eventos consecutivos con el mismo event name (sin otro
 * event name distinto en el medio) — p.ej. scroll,scroll,view,scroll da dos
 * grupos de scroll (2 y 1), no uno de 3, para no perder el orden temporal.
 * `events` viene más reciente primero; cada grupo preserva ese mismo orden.
 */
function groupConsecutiveEvents(events) {
  const groups = [];
  events.forEach((e) => {
    const key = getEventSummary(e.payload).eventName;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(e);
    else groups.push({ key, items: [e] });
  });
  return groups;
}

/**
 * Agrupa corridas consecutivas del mismo pageUrl — análogo a
 * groupConsecutiveEvents pero por página en vez de por event name. Como
 * digitalDataEvents ahora persiste a través de la navegación (ver
 * content.js), esto reconstruye el recorrido completo: cada página queda en
 * su propia sección en vez de mezclarse en una sola lista plana. Entradas
 * sin pageUrl (modelo de storage anterior a este cambio) se agrupan bajo la
 * misma key `null` — ver formatPageLabel.
 */
function groupEventsByPage(events) {
  const groups = [];
  events.forEach((e) => {
    const key = e.pageUrl || null;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(e);
    else groups.push({ key, items: [e] });
  });
  return groups;
}

/** hostname+pathname legible para el header de una sección de página. Sin pageUrl (entradas del modelo viejo) → bucket "Página desconocida". */
function formatPageLabel(pageUrl) {
  if (!pageUrl) return "Página desconocida";
  try {
    const url = new URL(pageUrl);
    return url.hostname + url.pathname;
  } catch (e) {
    return "Página desconocida";
  }
}

/** Renderiza corridas consecutivas de un mismo event name dentro de una lista de eventos (toda la visible, o los de una sola sección de página). */
function renderEventGroupsHtml(events) {
  return groupConsecutiveEvents(events)
    .map((g) => {
      if (g.items.length === 1) return renderEventRow(g.items[0]);

      // items[0] es el más reciente del grupo (events viene más reciente primero)
      const newest = new Date(g.items[0].time).toLocaleTimeString("es-PE");
      const oldest = new Date(g.items[g.items.length - 1].time).toLocaleTimeString("es-PE");
      const timeLabel = oldest === newest ? newest : `${oldest} → ${newest}`;
      const groupKey = `${g.key}|${eventKey(g.items[g.items.length - 1])}`;
      const expanded = expandedEventGroups.has(groupKey);

      return `
        <div class="event-group${expanded ? " event-group--expanded" : ""}" data-key="${escapeHtml(groupKey)}">
          <button class="event-group__header" aria-expanded="${expanded}">
            ${iconSvg("chevron", "event-group__chevron")}
            <span class="event-tag">${escapeHtml(g.key)} · ${g.items.length}</span>
            <span class="event-row__time">${timeLabel}</span>
          </button>
          <div class="event-group__items">
            ${g.items.map(renderEventRow).join("")}
          </div>
        </div>
      `;
    })
    .join("");
}

/**
 * Renderiza la pestaña "Eventos": pushes crudos a window.digitalData / window.adobeDataLayer
 * capturados por inject.js (ver hookPushProperty), más recientes primero,
 * agrupados por página del recorrido (ver groupEventsByPage) — la sección
 * de la página más reciente arranca expandida, el resto colapsado. Arriba
 * de la lista genera un chip por cada event name presente en TODO el
 * recorrido (no solo la página actual); por default todos están activos.
 * Dentro de cada página, corridas consecutivas del mismo event name (p.ej.
 * varios trackScroll seguidos) se colapsan en una fila expandible.
 */
function renderEventos() {
  chrome.storage.local.get(["digitalDataEvents", "instanceInfo", "launchInfo", "requests"], (data) => {
    if (showBlockedIn("event-list")) return;
    const events = data.digitalDataEvents || [];
    const list = document.getElementById("event-list");
    const filters = document.getElementById("event-filters");
    document.getElementById("event-search-bar").hidden = events.length === 0;

    if (events.length === 0) {
      filters.innerHTML = "";
      // Si ya hay captura de Alloy o Launch en esta página, reinyectar no
      // aporta: lo que falta es que la página haga push (bbva.pe usa un
      // digitalData objeto plano, que a propósito no se engancha).
      const live = captureIsLive(data);
      list.innerHTML = emptyStateHtml(
        "list",
        live
          ? "Sin eventos aún.<br>La captura está activa: esta página todavía no hizo <span class=\"mono\">push</span> a <span class=\"mono\">digitalData</span> ni a <span class=\"mono\">adobeDataLayer</span> (o usa otra capa de datos)."
          : "Sin eventos aún.<br>Interactúa con la página para ver los pushes a la capa de datos (digitalData o adobeDataLayer).",
        !live,
      );
      return;
    }

    // Conteo por event name + alta de nombres nuevos en el filtro (default: activo)
    const counts = new Map();
    events.forEach((e) => {
      const key = getEventSummary(e.payload).eventName;
      counts.set(key, (counts.get(key) || 0) + 1);
      if (!eventFilterState.has(key)) eventFilterState.set(key, true);
    });

    const filterFocus = focusDescriptor(filters);
    filters.innerHTML = [...counts.entries()]
      .map(([key, count]) => {
        const active = eventFilterState.get(key);
        return `<button class="event-filter${active ? " event-filter--active" : ""}" data-event="${escapeHtml(key)}" aria-pressed="${!!active}">${escapeHtml(key)} · ${count}</button>`;
      })
      .join("");
    restoreFocus(filters, filterFocus);

    const byChip = events.filter((e) => eventFilterState.get(getEventSummary(e.payload).eventName));
    const visible = eventSearch ? byChip.filter((e) => eventMatchesSearch(e, eventSearch)) : byChip;

    if (visible.length === 0) {
      list.innerHTML =
        byChip.length === 0
          ? emptyStateHtml("filter", "Todos los eventos están filtrados.<br>Activa algún filtro arriba para verlos.")
          : emptyStateHtml("filter", `Ningún evento coincide con <strong>${escapeHtml(eventSearch)}</strong>.`);
      return;
    }

    lastRenderedEvents = new Map(visible.map((e) => [eventKey(e), e]));

    const scrollTop = list.scrollTop;
    const focused = focusDescriptor(list);
    list.innerHTML = groupEventsByPage(visible)
      .map((pageGroup, pageIdx) => {
        const label = formatPageLabel(pageGroup.key);
        const count = pageGroup.items.length;
        const key = `${pageGroup.key}|${eventKey(pageGroup.items[pageGroup.items.length - 1])}`;
        // Default: la más reciente abierta, el resto cerrado — salvo que el
        // usuario haya abierto o cerrado esa página a mano.
        const expanded = pageExpandOverrides.has(key) ? pageExpandOverrides.get(key) : pageIdx === 0;
        return `
        <div class="event-page${expanded ? " event-page--expanded" : ""}" data-key="${escapeHtml(key)}">
          <button class="event-page__header" aria-expanded="${expanded}">
            ${iconSvg("chevron", "event-page__chevron")}
            <span class="event-page__path" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
            ${pageIdx === 0 ? `<span class="event-page__current" title="Página con el evento más reciente">más reciente</span>` : ""}
            <span class="event-page__count">${count} evento${count === 1 ? "" : "s"}</span>
          </button>
          <div class="event-page__items">${renderEventGroupsHtml(pageGroup.items)}</div>
        </div>
      `;
      })
      .join("");
    list.scrollTop = scrollTop;
    restoreFocus(list, focused);
  });
}

// Click delegado en los chips de filtro: togglea el estado en memoria y
// vuelve a renderizar (chips + lista). El listener vive en el contenedor,
// que nunca se reemplaza entero — solo su innerHTML — así que alcanza con
// registrarlo una vez.
document.getElementById("event-filters").addEventListener("click", (e) => {
  const chip = e.target.closest(".event-filter");
  if (!chip) return;
  const key = chip.dataset.event;
  eventFilterState.set(key, !eventFilterState.get(key));
  renderEventos();
});

// Click delegado para expandir/colapsar una sección de página o un grupo de
// eventos consecutivos. Los encabezados son <button aria-expanded>, así que
// Enter/Espacio funcionan igual que el click. Cada toggle queda registrado
// (pageExpandOverrides / expandedEventGroups) para que el próximo re-render
// lo respete. Se chequea event-page__header primero porque
// .event-group__header vive DENTRO de una sección de página — un click ahí
// no debe además togglear la página que lo contiene.
document.getElementById("event-list").addEventListener("click", (e) => {
  const pageHeader = e.target.closest(".event-page__header");
  if (pageHeader) {
    const page = pageHeader.closest(".event-page");
    const expanded = page.classList.toggle("event-page--expanded");
    pageHeader.setAttribute("aria-expanded", String(expanded));
    pageExpandOverrides.set(page.dataset.key, expanded);
    return;
  }
  const header = e.target.closest(".event-group__header");
  if (!header) return;
  const group = header.closest(".event-group");
  const expanded = group.classList.toggle("event-group--expanded");
  header.setAttribute("aria-expanded", String(expanded));
  if (expanded) expandedEventGroups.add(group.dataset.key);
  else expandedEventGroups.delete(group.dataset.key);
});

// Payloads abiertos (ver openEventPayloads). "toggle" no burbujea: captura.
document.getElementById("event-list").addEventListener(
  "toggle",
  (e) => {
    if (!e.target.classList?.contains("event-row__raw")) return;
    if (e.target.open) openEventPayloads.add(e.target.dataset.key);
    else openEventPayloads.delete(e.target.dataset.key);
  },
  true,
);

// ── Pestaña Launch (Adobe Tags / Data Collection) ────────────────────────────
// Propiedad de Launch de la página (nombre, entorno, build) y las reglas que
// Turbine reportó — ver sección 5 de inject.js. content.js ya las guarda
// agregadas (una entrada por regla + resultado, con contador).
// Filtros y búsqueda en memoria, igual que en Eventos.
const launchFilterState = { completed: true, failed: true };
let launchSearch = "";

const RULE_STATUS = {
  completed: { label: "Completada", chip: "Completadas", badge: "status-badge--rule-ok", title: "Se disparó, cumplió sus condiciones y ejecutó sus acciones." },
  failed: {
    label: "Condición no cumplida",
    chip: "Condición no cumplida",
    badge: "status-badge--rule-failed",
    title: "Se disparó pero una condición dio falso: no ejecutó sus acciones en esta página. Es normal para reglas de otras páginas.",
  },
};

/** "+2.5s" desde la carga de la página, o "" si no hay tiempo. */
function formatSinceLoad(ms) {
  return Number.isFinite(ms) ? `+${(ms / 1000).toFixed(1)}s` : "";
}

/** Condición fallida legible: "core · cookie politica_x" (con NOT si estaba negada). */
function formatCondition(c) {
  const head = [c.extension, c.kind].filter(Boolean).join(" · ");
  return `${c.negate ? "NOT " : ""}<b>${escapeHtml(head || "condición")}</b>${c.detail ? " " + escapeHtml(c.detail) : ""}`;
}

// Bloques de código abiertos por el usuario (clave "<rule.key>|c|<i>" para
// condiciones, "<rule.key>|a|<i>" para acciones), en memoria como el resto
// de los desplegables: cada regla nueva re-renderiza la lista y sin esto el
// código que se estaba leyendo se cerraba solo.
const openRuleCode = new Set();
// Reglas del último render por key — fuente de "Copiar código" y del
// llenado diferido de los <pre> (ver abajo).
let lastRenderedRules = new Map();

/** "<rule.key>|c|<i>" → { ruleKey, type: "c"|"a", index }. */
function parseCodeKey(key) {
  const iSep = key.lastIndexOf("|");
  const tSep = key.lastIndexOf("|", iSep - 1);
  return { ruleKey: key.slice(0, tSep), type: key.slice(tSep + 1, iSep), index: Number(key.slice(iSep + 1)) };
}

/** Condición o acción (sus metadatos) a la que apunta una clave "<rule.key>|c|<i>" / "<rule.key>|a|<i>". */
function ruleCodeItem(key) {
  const { ruleKey, type, index } = parseCodeKey(key);
  const rule = lastRenderedRules.get(ruleKey);
  const list = type === "a" ? rule?.actions : rule?.conditions;
  return list?.[index] || null;
}

// El código de cada regla vive en su propia clave de storage
// ("launchCode:<rule.key>" → { c: [...], a: [...] }), fuera de launchRules —
// ver content.js. Se trae recién al abrir un bloque (o al buscar) y se cachea;
// storage.onChanged mantiene el cache al día con el newValue que ya trae.
const LAUNCH_CODE_PREFIX = "launchCode:";
const launchCodeCache = new Map();

function cachedCode(key) {
  const { ruleKey, type, index } = parseCodeKey(key);
  const stored = launchCodeCache.get(LAUNCH_CODE_PREFIX + ruleKey);
  const fromStore = stored?.[type]?.[index];
  // Entradas de antes de separar el código lo traían adentro (item.code).
  return typeof fromStore === "string" ? fromStore : ruleCodeItem(key)?.code;
}

/** Código de una condición/acción, del cache o de storage. */
function loadCode(key, cb) {
  const cached = cachedCode(key);
  if (typeof cached === "string") return cb(cached);
  const storageKey = LAUNCH_CODE_PREFIX + parseCodeKey(key).ruleKey;
  chrome.storage.local.get(storageKey, (d) => {
    if (d[storageKey]) launchCodeCache.set(storageKey, d[storageKey]);
    cb(cachedCode(key) || "");
  });
}

/** Trae TODO el código de las reglas (solo con una búsqueda activa: el buscador también mira el código). */
function loadAllLaunchCode(cb) {
  chrome.storage.local.get("launchCodeKeys", (d) => {
    const keys = (d.launchCodeKeys || []).filter((k) => !launchCodeCache.has(k));
    if (keys.length === 0) return cb();
    chrome.storage.local.get(keys, (codes) => {
      Object.entries(codes).forEach(([k, v]) => launchCodeCache.set(k, v));
      cb();
    });
  });
}

/** Después de repintar, llena los bloques que quedaron abiertos. */
function fillOpenCodeBlocks(list) {
  list.querySelectorAll(".rule-row__code[open]").forEach((det) => {
    const pre = det.querySelector(".raw-pre");
    if (pre && !pre.textContent) loadCode(det.dataset.key, (code) => (pre.textContent = code));
  });
}

/**
 * Desplegable con el código (customCode) o la configuración (resto) de una
 * condición o acción. El <pre> se llena recién al abrirlo (o ya lleno si
 * estaba abierto): hay acciones de hasta 12000 caracteres y re-escaparlas
 * todas en cada tanda de reglas hacía pesado el re-render.
 */
function codeBlockHtml(item, key, owner = "") {
  const length = Number.isFinite(item.codeLength) ? item.codeLength : (item.code || "").length;
  if (!length) return "";
  const isCode = item.kind === "customCode";
  const lang = item.language && item.language !== "javascript" ? ` (${item.language.toUpperCase()})` : "";
  const open = openRuleCode.has(key);
  return `
    <details class="rule-row__code" data-key="${escapeHtml(key)}"${open ? " open" : ""}>
      <summary class="raw-summary"${owner ? ` aria-label="${isCode ? "Ver código" : "Ver configuración"} de ${escapeHtml(owner)}"` : ""}>${isCode ? "Ver código" : "Ver configuración"}${escapeHtml(lang)}</summary>
      <pre class="raw-pre"></pre>
      ${item.codeTruncated ? `<div class="activity__content-note">Recortado a ${length} caracteres: el código completo está en la librería de Launch de la página.</div>` : ""}
      <button class="btn-copy-content" data-copy-code="${escapeHtml(key)}">${isCode ? "Copiar código" : "Copiar configuración"}</button>
    </details>`;
}

/** Línea de una condición fallida + su código o configuración, colapsado. */
function renderConditionHtml(rule, c, i) {
  return `<div class="rule-row__cond">${formatCondition(c)}</div>${codeBlockHtml(c, `${rule.key}|c|${i}`, `la condición ${c.kind || ""} de ${rule.ruleName || ""}`)}`;
}

/** Línea de una acción (ejecutada, o que habría ejecutado una regla fallida) + su código, configuración o URL externa. */
function renderActionHtml(rule, a, i) {
  const head = [a.extension, a.kind].filter(Boolean).join(" · ") || "acción";
  // externalUrl ya viene validada como http(s) desde content.js; se escapa igual.
  const external = a.externalUrl
    ? ` · <a class="rule-row__link" href="${escapeHtml(a.externalUrl)}" target="_blank" rel="noopener" title="${escapeHtml(a.externalUrl)}">código externo ↗</a>`
    : "";
  return `<div class="rule-row__cond"><span aria-hidden="true">→</span> <b>${escapeHtml(head)}</b>${external}</div>${codeBlockHtml(a, `${rule.key}|a|${i}`, `la acción ${a.kind || ""} de ${rule.ruleName || ""}`)}`;
}

function ruleMatchesSearch(rule, query) {
  const q = query.toLowerCase();
  const items = [...(rule.conditions || []), ...(rule.actions || [])];
  const stored = launchCodeCache.get(LAUNCH_CODE_PREFIX + rule.key) || {};
  const codes = [...(stored.c || []), ...(stored.a || []), ...items.map((c) => c.code)];
  const text = [rule.ruleName, rule.ruleId, ...items.flatMap((c) => [c.kind, c.detail, c.externalUrl]), ...codes]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return text.includes(q);
}

function renderLaunchInfoCard(info, rules) {
  const card = document.getElementById("launch-info");
  if (!info) {
    card.hidden = true;
    card.innerHTML = "";
    return;
  }
  const env = info.environment || "?";
  const envClass = ["production", "staging", "development"].includes(env) ? ` env-badge--${env}` : "";
  const build = (() => {
    const d = new Date(info.buildDate);
    return Number.isNaN(d.getTime()) ? null : d.toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" });
  })();
  const meta = [
    build ? `build ${build}` : null,
    info.turbineVersion ? `Turbine ${info.turbineVersion}` : null,
    info.propertyId || null,
  ].filter(Boolean);
  const completed = rules.filter((r) => r.status === "completed").length;
  const failed = rules.length - completed;
  card.hidden = false;
  card.innerHTML = `
    <div class="launch-card__row">
      <span class="launch-card__name" title="${escapeHtml(info.propertyName || "")}">${escapeHtml(info.propertyName || "Propiedad sin nombre")}</span>
      <span class="env-badge${envClass}" title="Entorno de la librería de Launch que cargó esta página">${escapeHtml(env)}</span>
    </div>
    ${meta.length ? `<div class="launch-card__meta">${meta.map(escapeHtml).join(" · ")}</div>` : ""}
    ${
      env !== "production" && env !== "?"
        ? `<div class="launch-card__warning">Esta página carga la librería de <strong>${escapeHtml(env)}</strong>, no la de production: no es lo que ven los usuarios.</div>`
        : ""
    }
    ${rules.length ? `<div class="launch-card__summary"><b>${completed}</b> ${completed === 1 ? "regla completada" : "reglas completadas"} · <b>${failed}</b> con condición no cumplida</div>` : ""}
  `;
}

function renderLaunch() {
  chrome.storage.local.get(["launchInfo", "launchRules"], (data) => {
    if (showBlockedIn("launch-list")) return;
    const info = data.launchInfo || null;
    const rules = data.launchRules || [];
    const list = document.getElementById("launch-list");
    const filters = document.getElementById("launch-filters");
    renderLaunchInfoCard(info, rules);
    document.getElementById("launch-search-bar").hidden = rules.length === 0;

    if (rules.length === 0) {
      filters.innerHTML = "";
      list.innerHTML = info
        ? emptyStateHtml(
            "list",
            "Launch está cargado, pero no se capturaron reglas.<br>Recarga la página: las reglas de carga se disparan antes de que se las pueda escuchar en una pestaña ya abierta.",
          )
        : emptyStateHtml(
            "box",
            "No se detectó Adobe Launch (Tags) en esta página.<br>Si la página lo usa, recárgala con la extensión activa.",
            true,
          );
      return;
    }

    const filterFocus = focusDescriptor(filters);
    filters.innerHTML = ["completed", "failed"]
      .map((status) => {
        const count = rules.filter((r) => r.status === status).length;
        const active = launchFilterState[status];
        return `<button class="event-filter${active ? " event-filter--active" : ""}" data-status="${status}" aria-pressed="${active}">${RULE_STATUS[status].chip} · ${count}</button>`;
      })
      .join("");
    restoreFocus(filters, filterFocus);

    // Con búsqueda activa primero se trae el código (el buscador también lo mira).
    if (launchSearch) loadAllLaunchCode(() => paintLaunchRules(rules));
    else paintLaunchRules(rules);
  });
}

/** Pinta la lista de reglas (chips + búsqueda ya resueltos arriba). */
function paintLaunchRules(rules) {
  const list = document.getElementById("launch-list");
  const byChip = rules.filter((r) => launchFilterState[r.status]);
  const visible = launchSearch ? byChip.filter((r) => ruleMatchesSearch(r, launchSearch)) : byChip;

  if (visible.length === 0) {
    list.innerHTML =
      byChip.length === 0
        ? emptyStateHtml("filter", "Todas las reglas están filtradas.<br>Activa algún filtro arriba para verlas.")
        : emptyStateHtml("filter", `Ninguna regla coincide con <strong>${escapeHtml(launchSearch)}</strong>.`);
    return;
  }

  // Completadas primero (lo que SÍ corrió en esta página), después las no
  // cumplidas; dentro de cada grupo, en el orden en que se dispararon. Antes
  // iban mezcladas y en viabcp.com 71 de 81 filas eran reglas de otras páginas.
  const rank = (r) => (r.status === "completed" ? 0 : 1);
  const sorted = [...visible].sort((a, b) => rank(a) - rank(b) || (a.firstT ?? Infinity) - (b.firstT ?? Infinity));
  lastRenderedRules = new Map(sorted.map((r) => [r.key, r]));
  const scrollTop = list.scrollTop;
  const focused = focusDescriptor(list);
  // Encabezado al empezar cada grupo: el orden "completadas primero" no se
  // notaba sin algo que marcara dónde terminan unas y empiezan las otras.
  const groupCount = { completed: sorted.filter((r) => r.status === "completed").length, failed: sorted.filter((r) => r.status === "failed").length };
  const groupHeader = (r, idx) =>
    idx === 0 || sorted[idx - 1].status !== r.status
      ? `<div class="list__group">${RULE_STATUS[r.status].chip} <span class="list__group-count">${groupCount[r.status]}</span></div>`
      : "";
  list.innerHTML = sorted
    .map((r, idx) => {
      const s = RULE_STATUS[r.status];
      const name = r.ruleName || r.ruleId || "Regla sin nombre";
      // Fallidas: la condición que no se cumplió + lo que habrían ejecutado.
      // Completadas: lo que ejecutaron.
      const conditions = r.status === "failed" ? r.conditions || [] : [];
      const actions = r.actions || [];
      // En las no cumplidas las acciones van colapsadas: no corrieron, y
      // abiertas triplicaban el alto de filas que casi nunca se miran.
      const actionsHtml = actions.map((a, i) => renderActionHtml(r, a, i)).join("");
      const actsKey = `${r.key}|acts`;
      const actionsBlock =
        r.status === "failed" && actions.length
          ? `<details class="rule-row__actions" data-key="${escapeHtml(actsKey)}"${openRuleCode.has(actsKey) ? " open" : ""}>
               <summary class="raw-summary" aria-label="Acciones que no se ejecutaron de ${escapeHtml(name)}" title="La condición no se cumplió, así que estas acciones no corrieron en esta página">${actions.length === 1 ? "1 acción que no se ejecutó" : `${actions.length} acciones que no se ejecutaron`}</summary>
               ${actionsHtml}
             </details>`
          : actionsHtml;
      const when = r.count > 1 && r.lastT > r.firstT
        ? `${formatSinceLoad(r.firstT)} → ${formatSinceLoad(r.lastT)}`
        : formatSinceLoad(r.firstT);
      // Nombre de regla, ID y condiciones salen de la librería de Launch de la página: se escapan.
      return `${groupHeader(r, idx)}
      <div class="rule-row" data-key="${escapeHtml(r.key)}|row">
        <div class="rule-row__header">
          <span class="status-badge ${s.badge}" title="${escapeHtml(s.title)}">${s.label}</span>
          ${r.count > 1 ? `<span class="rule-row__count" title="Veces que se disparó">×${r.count}</span>` : ""}
          ${when ? `<span class="event-row__time" title="Desde la carga de la página">${when}</span>` : ""}
        </div>
        <div class="rule-row__name" title="${escapeHtml(name)}${r.ruleId ? " · " + escapeHtml(r.ruleId) : ""}">${escapeHtml(name)}</div>
        ${conditions.map((c, i) => renderConditionHtml(r, c, i)).join("")}
        ${actionsBlock}
      </div>
    `;
    })
    .join("");
  list.scrollTop = scrollTop;
  restoreFocus(list, focused);
  fillOpenCodeBlocks(list);
}

document.getElementById("launch-filters").addEventListener("click", (e) => {
  const chip = e.target.closest(".event-filter");
  if (!chip) return;
  const status = chip.dataset.status;
  launchFilterState[status] = !launchFilterState[status];
  renderLaunch();
});

// "Copiar código" de una condición o acción: toma el string guardado, no el texto escapado del <pre>.
document.getElementById("launch-list").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-copy-code]");
  if (!btn) return;
  const item = ruleCodeItem(btn.dataset.copyCode);
  loadCode(btn.dataset.copyCode, (code) => {
    if (!code) return;
    copyText(code, item?.kind === "customCode" ? "Código copiado." : "Configuración copiada.");
  });
});

// "toggle" no burbujea — captura, igual que en Actividades y Eventos. Al
// abrir se llena el <pre> (ver codeBlockHtml); textContent, sin HTML.
document.getElementById("launch-list").addEventListener(
  "toggle",
  (e) => {
    if (e.target.classList?.contains("rule-row__actions")) {
      if (e.target.open) openRuleCode.add(e.target.dataset.key);
      else openRuleCode.delete(e.target.dataset.key);
      return;
    }
    if (!e.target.classList?.contains("rule-row__code")) return;
    const key = e.target.dataset.key;
    if (e.target.open) {
      openRuleCode.add(key);
      const pre = e.target.querySelector(".raw-pre");
      if (pre && !pre.textContent) loadCode(key, (code) => (pre.textContent = code));
    } else {
      openRuleCode.delete(key);
    }
  },
  true,
);

let launchSearchTimer = null;
document.getElementById("launch-search").addEventListener("input", (e) => {
  clearTimeout(launchSearchTimer);
  launchSearchTimer = setTimeout(() => {
    launchSearch = e.target.value.trim();
    renderLaunch();
  }, 150);
});

// ── Pestaña Hits: llamadas de Alloy al Edge ──────────────────────────────────
// Una fila por llamada (onBeforeNetworkRequest en inject.js), en el orden en
// que salieron, con su respuesta enlazada por requestId (onNetworkResponse
// completa status/handleTypes en el hit; el body de la respuesta se toma de
// `requests`, que ya lo guarda — no se duplica). content.js ya calculó el
// resumen (eventTypes, scopes, actividades cuyo display se notifica).
const HIT_TITLES = {
  "identity/acquire": "Pedido de identidad (ECID)",
  "privacy/set-consent": "Consentimiento",
};
// Filtro de Hits (en memoria, como los de Eventos y Launch).
const hitIsError = (h) => !!h.error || (Number.isFinite(h.status) && (h.status < 200 || h.status >= 300));
const HIT_FILTERS = {
  all: { label: "Todas", test: () => true },
  decisions: { label: "Decisiones", test: (h) => (h.scopes || []).length > 0 || (h.eventTypes || []).includes("decisioning.propositionFetch") || h.decisions > 0 },
  display: { label: "Impresión", test: (h) => (h.displayedActivities || []).length > 0 },
  error: { label: "Con error", test: hitIsError },
  pending: { label: "Sin respuesta", test: (h) => !h.responded && !h.error },
};
let hitFilter = "all";

// Desplegables Request/Response abiertos, por "<requestId>|req" / "|res".
const openHitBlocks = new Set();
let lastRenderedHits = new Map();
let lastHitResponses = new Map();

function hitStatusBadge(h) {
  if (h.error) return `<span class="status-badge status-badge--hit-error" title="${escapeHtml(h.error)}">Falló</span>`;
  if (!h.responded) return `<span class="status-badge status-badge--hit-pending" title="Alloy la envió y todavía no llegó respuesta">Sin respuesta</span>`;
  const ok = !Number.isFinite(h.status) || (h.status >= 200 && h.status < 300);
  const label = Number.isFinite(h.status) ? String(h.status) : "OK";
  return `<span class="status-badge status-badge--hit-${ok ? "ok" : "error"}" title="Código de estado de la respuesta del Edge">${label}</span>`;
}

function hitJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (e) {
    return String(value);
  }
}

/**
 * Request y Response de un hit: dos botones en un mismo renglón y un panel
 * por cada uno (antes eran dos <details> apilados: ocupaban un renglón cada
 * uno en las 27 filas, y con la ventana ancha no había forma de poner el
 * payload al costado). Devuelve { toggles, panels }; el <pre> se llena al
 * abrir, como en Launch.
 */
function hitBlocksHtml(h, title) {
  const blocks = [
    ["req", "Request", h.body],
    ["res", "Response", lastHitResponses.get(h.requestId)],
  ].filter(([, , value]) => value !== undefined && value !== null);
  const toggles = blocks
    .map(([which, label]) => {
      const key = `${h.requestId}|${which}`;
      const open = openHitBlocks.has(key);
      return `<button class="hit-row__toggle" data-hit-toggle="${escapeHtml(key)}" aria-expanded="${open}" aria-label="${label} de ${escapeHtml(title)}">${iconSvg("chevron", "hit-row__chevron")}${label}</button>`;
    })
    .join("");
  const panels = blocks
    .map(([which, label, value]) => {
      const key = `${h.requestId}|${which}`;
      const open = openHitBlocks.has(key);
      return `
      <div class="hit-row__panel" data-key="${escapeHtml(key)}"${open ? "" : " hidden"}>
        <div class="hit-row__panel-label">${label}</div>
        <pre class="raw-pre">${open ? escapeHtml(hitJson(value)) : ""}</pre>
        <button class="btn-copy-content" data-copy-hit="${escapeHtml(key)}">Copiar ${label.toLowerCase()}</button>
      </div>`;
    })
    .join("");
  return { toggles, panels };
}

function hitBlockValue(key) {
  const sep = key.lastIndexOf("|");
  const id = key.slice(0, sep);
  return key.slice(sep + 1) === "req" ? lastRenderedHits.get(id)?.body : lastHitResponses.get(id);
}

function renderHits() {
  chrome.storage.local.get(["hits", "requests", "instanceInfo", "launchInfo"], (data) => {
    if (showBlockedIn("hits-list")) return;
    const hits = data.hits || [];
    const list = document.getElementById("hits-list");
    const summary = document.getElementById("hits-summary");

    if (hits.length === 0) {
      summary.hidden = true;
      document.getElementById("hits-filters").innerHTML = "";
      const live = captureIsLive(data);
      list.innerHTML = emptyStateHtml(
        "signal",
        live
          ? "Sin llamadas al Edge en esta carga.<br>La captura está activa, pero Alloy no envió nada: puede que la regla que lo dispara no se haya cumplido. <button class=\"inline-link\" data-goto=\"launch\">Ver Launch</button>"
          : "Sin llamadas al Edge en esta carga.<br>Recarga la página con la extensión activa: Alloy hace sus llamadas al cargar.",
        !live,
      );
      return;
    }

    lastRenderedHits = new Map(hits.map((h) => [h.requestId, h]));
    lastHitResponses = new Map((data.requests || []).filter((r) => r.requestId).map((r) => [r.requestId, r.payload]));
    // ID de actividad → nombre, de las decisiones que ya están en requests:
    // "Notifica el display de #349874" obligaba a recordar qué era cada ID.
    const activityNames = new Map();
    (data.requests || []).forEach((r) =>
      (r.payload?.handle || [])
        .filter((x) => x.type === "personalization:decisions")
        .flatMap((x) => x.payload || [])
        .forEach((d) => {
          const id = d.scopeDetails?.activity?.id;
          const name = d.items?.[0]?.meta?.["activity.name"] || d.scopeDetails?.activity?.name;
          if (id !== undefined && name && !activityNames.has(String(id))) activityNames.set(String(id), name);
        }),
    );

    const failed = hits.filter((h) => h.error || (Number.isFinite(h.status) && (h.status < 200 || h.status >= 300))).length;
    const pending = hits.filter((h) => !h.responded && !h.error).length;
    const displays = hits.filter((h) => (h.displayedActivities || []).length > 0).length;
    summary.hidden = false;
    summary.innerHTML = [
      `<b>${hits.length}</b> ${hits.length === 1 ? "llamada" : "llamadas"} al Edge`,
      `<b>${failed}</b> con error`,
      pending ? `<b>${pending}</b> sin respuesta` : null,
      `<span title="Llamadas que notifican el display (decisioning.propositionDisplay): así Target cuenta la impresión">${displays} ${displays === 1 ? "notificación" : "notificaciones"} de impresión</span>`,
    ]
      .filter(Boolean)
      .join(" · ");

    // Chips "solo esto" (uno activo a la vez, no de exclusión como en
    // Eventos): con 27 hits lo que se busca es aislar los de decisiones o los
    // de impresión. Un tipo sin hits no muestra chip; si el activo se queda
    // sin hits, se vuelve a "Todas".
    const counts = Object.fromEntries(Object.keys(HIT_FILTERS).map((k) => [k, hits.filter(HIT_FILTERS[k].test).length]));
    if (!counts[hitFilter]) hitFilter = "all";
    const filters = document.getElementById("hits-filters");
    const filterFocus = focusDescriptor(filters);
    filters.innerHTML = Object.keys(HIT_FILTERS)
      .filter((k) => k === "all" || counts[k] > 0)
      .map((k) => `<button class="event-filter event-filter--solo${hitFilter === k ? " event-filter--active" : ""}" data-hit-filter="${k}" aria-pressed="${hitFilter === k}">${HIT_FILTERS[k].label} · ${counts[k]}</button>`)
      .join("");
    restoreFocus(filters, filterFocus);
    const shown = hits.filter(HIT_FILTERS[hitFilter].test);

    const multiInstance = new Set(hits.map((h) => h.instance)).size > 1;
    const scrollTop = list.scrollTop;
    const focused = focusDescriptor(list);
    // Todo lo que sale del hit (endpoint, eventTypes, scopes, IDs, instancia) viene de la página: se escapa.
    list.innerHTML = shown
      .map((h) => {
        const title = (h.eventTypes || []).length
          ? h.eventTypes.join(", ")
          : HIT_TITLES[h.endpoint] || h.endpoint || "Llamada";
        const meta = [];
        if ((h.scopes || []).length) meta.push(`scopes <b>${h.scopes.map(escapeHtml).join(", ")}</b>`);
        if (h.responded) {
          // Tipos de handle repetidos se agrupan: "state:store ×2" en vez de repetirlo.
          const typeCounts = new Map();
          (h.handleTypes || [])
            .filter((t) => t !== "personalization:decisions")
            .forEach((t) => typeCounts.set(t, (typeCounts.get(t) || 0) + 1));
          const resp = [
            h.decisions ? `${h.decisions} ${h.decisions === 1 ? "decisión" : "decisiones"}` : null,
            ...[...typeCounts].map(([t, n]) => (n > 1 ? `${t} ×${n}` : t)),
          ].filter(Boolean);
          if (resp.length) meta.push(`respuesta: ${resp.map(escapeHtml).join(" · ")}`);
        }
        const displayed = (h.displayedActivities || []).length
          ? `<div class="hit-row__meta hit-row__display">Notifica la impresión (display) de:</div>
             <ul class="hit-row__displayed">${h.displayedActivities
               .map((id) => {
                 const name = activityNames.get(String(id));
                 return `<li><span class="hit-row__display-id">#${escapeHtml(id)}</span>${name ? ` <span title="${escapeHtml(name)}">${escapeHtml(name)}</span>` : ""}</li>`;
               })
               .join("")}</ul>`
          : "";
        const blocks = hitBlocksHtml(h, title);
        return `
        <div class="hit-row" data-key="${escapeHtml(h.requestId)}|row">
          <div class="hit-row__main">
          <div class="hit-row__header">
            <span class="event-tag" title="${escapeHtml(h.url || "")}">${escapeHtml(h.endpoint || "?")}</span>
            ${hitStatusBadge(h)}
            ${multiInstance && h.instance ? `<span class="rule-row__count" title="Instancia de Alloy">${escapeHtml(h.instance)}</span>` : ""}
            ${Number.isFinite(h.t) ? `<span class="event-row__time" title="Desde la carga de la página">${formatSinceLoad(h.t)}</span>` : ""}
          </div>
          <div class="hit-row__title">${escapeHtml(title)}</div>
          ${meta.map((m) => `<div class="hit-row__meta">${m}</div>`).join("")}
          ${displayed}
          ${h.error ? `<div class="hit-row__meta">Error: ${escapeHtml(h.error)}</div>` : ""}
          ${blocks.toggles ? `<div class="hit-row__toggles">${blocks.toggles}</div>` : ""}
          </div>
          ${blocks.panels ? `<div class="hit-row__panels">${blocks.panels}</div>` : ""}
        </div>
      `;
      })
      .join("");
    list.scrollTop = scrollTop;
    restoreFocus(list, focused);
  });
}

document.getElementById("hits-list").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-copy-hit]");
  if (!btn) return;
  const value = hitBlockValue(btn.dataset.copyHit);
  if (value === undefined || value === null) return;
  copyText(hitJson(value), btn.dataset.copyHit.endsWith("|req") ? "Request copiado." : "Response copiada.");
});

document.getElementById("hits-filters").addEventListener("click", (e) => {
  const chip = e.target.closest("[data-hit-filter]");
  if (!chip) return;
  hitFilter = chip.dataset.hitFilter;
  renderHits();
});

// Abrir/cerrar Request o Response: el panel se llena la primera vez que se abre.
document.getElementById("hits-list").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-hit-toggle]");
  if (!btn) return;
  const key = btn.dataset.hitToggle;
  const panel = [...btn.closest(".hit-row").querySelectorAll(".hit-row__panel")].find((p) => p.dataset.key === key);
  if (!panel) return;
  const open = panel.hidden;
  panel.hidden = !open;
  btn.setAttribute("aria-expanded", String(open));
  if (open) {
    openHitBlocks.add(key);
    const pre = panel.querySelector(".raw-pre");
    if (!pre.textContent) pre.textContent = hitJson(hitBlockValue(key));
  } else {
    openHitBlocks.delete(key);
  }
});

// Atajos entre pestañas: los diagnósticos y avisos nombran la pestaña donde
// está el detalle ("Abre Hits") — un botón la activa, en vez de pedirle al
// usuario que la busque.
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-goto]");
  if (!btn) return;
  const tab = tabItems.find((t) => t.dataset.tab === btn.dataset.goto);
  if (!tab) return;
  // data-search: llega a Launch con la regla nombrada ya filtrada.
  // data-filter: "Ver Hits" desde el aviso de impresión llega ya filtrado.
  if (btn.dataset.goto === "hits" && HIT_FILTERS[btn.dataset.filter]) hitFilter = btn.dataset.filter;
  if (btn.dataset.goto === "launch" && btn.dataset.search) {
    launchSearch = btn.dataset.search;
    document.getElementById("launch-search").value = launchSearch;
    launchFilterState.completed = launchFilterState.failed = true;
  }
  activateTab(tab);
  tab.focus();
});

// Franja mBoxes: un <button aria-expanded> (no <details>: el <summary>
// nativo quedaba con el anillo de foco pegado después de un click con mouse).
// El estado se recuerda entre repintadas.
document.getElementById("mbox-dock").addEventListener("click", (e) => {
  const btn = e.target.closest("button.mbox-section__summary");
  if (!btn) return;
  mboxSectionOpen = !mboxSectionOpen;
  btn.closest(".mbox-section").classList.toggle("mbox-section--open", mboxSectionOpen);
  btn.setAttribute("aria-expanded", String(mboxSectionOpen));
});

// ── Live update: re-renderiza cuando cambia el storage ───────────────────────
// Las pintadas en vivo se agrupan: durante la carga de una página llegan
// ráfagas de cambios (una tanda de reglas de Launch cada 300ms, hits,
// eventos) y repintar en cada una trababa la ventana — medido en nvidia.com
// (313 reglas): ~1s por repintada de Launch. Como mucho una por pestaña cada
// LIVE_RENDER_MS; la primera de una ráfaga sale enseguida (sin demora visible
// en un cambio aislado) y la última siempre se pinta (nunca queda un estado viejo).
const LIVE_RENDER_MS = 400;
const liveRenderState = new Map(); // pestaña → { timer, last }

function scheduleLiveRender(tab, fn) {
  const st = liveRenderState.get(tab) || { timer: null, last: 0 };
  liveRenderState.set(tab, st);
  if (st.timer) return;
  const wait = Math.max(0, st.last + LIVE_RENDER_MS - Date.now());
  st.timer = setTimeout(() => {
    st.timer = null;
    st.last = Date.now();
    fn();
  }, wait);
}

const LIVE_TABS = {
  actividades: {
    keys: ["requests", "renderEvents", "launchRules", "launchInfo", "hits", "pageSdk", "domMboxes"],
    render: () => getInspectedTab((tab) => render(tab?.url || "")),
  },
  eventos: { keys: ["digitalDataEvents"], render: () => renderEventos() },
  hits: { keys: ["hits", "requests"], render: () => renderHits() },
  launch: { keys: ["launchRules", "launchInfo"], render: () => renderLaunch() },
};

chrome.storage.onChanged.addListener((changes) => {
  if (changes.instanceInfo) renderInstanceInfo();
  Object.keys(changes).forEach((k) => {
    if (!k.startsWith(LAUNCH_CODE_PREFIX)) return;
    if (changes[k].newValue) launchCodeCache.set(k, changes[k].newValue);
    else launchCodeCache.delete(k);
  });

  const activeTab = document.querySelector(".tabs__item--active")?.dataset?.tab;
  const live = LIVE_TABS[activeTab];
  if (live && live.keys.some((k) => changes[k])) scheduleLiveRender(activeTab, live.render);
});

// La pestaña inspeccionada puede cerrarse con la ventana abierta: antes eso
// solo se detectaba al reabrir la ventana.
chrome.tabs.onRemoved.addListener((tabId) => {
  if (String(tabId) === new URLSearchParams(location.search).get("tabId")) showTabClosed();
});
