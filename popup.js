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
};

function iconSvg(name, className = "") {
  return `<svg class="icon ${className}" viewBox="0 0 24 24" aria-hidden="true">${ICON_PATHS[name]}</svg>`;
}

/**
 * Markup de un estado vacío. `html` es texto fijo de la UI (o ya escapado por
 * quien llama) — nunca se le pasa un valor capturado de la página sin escapar.
 */
function emptyStateHtml(icon, html, withInject = false) {
  return `
    <div class="empty-state">
      ${iconSvg(icon, "empty-state__icon")}
      <p class="empty-state__text">${html}</p>
      ${withInject ? `<button class="btn-inject">Capturar ahora</button>` : ""}
    </div>`;
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
  showBlockedIn("mbox-list");
  showBlockedIn("event-list");
  document.getElementById("mbox-summary").hidden = true;
  document.getElementById("event-filters").innerHTML = "";
  document.getElementById("event-search-bar").hidden = true;
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
  ].filter(([, v]) => v != null);

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
      <summary class="raw-summary">Ver contenido</summary>
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
  chrome.storage.local.get(["requests", "tabUrl"], (data) => {
    if (showBlockedIn("list")) return;
    const requests = data.requests || [];
    const tabUrl = data.tabUrl || "";
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
      list.innerHTML = emptyStateHtml(
        "signal",
        "Sin capturas aún.<br>Recarga la página, o usa <strong>Capturar ahora</strong> si la pestaña ya estaba abierta antes de cargar la extensión.",
        true,
      );
      count.textContent = "0 ACT";
      // Sin capturas no hay "última": tras Limpiar no debe quedar la hora vieja.
      ts.textContent = "—";
      pageUrl.textContent = hostAndPath(currentTabUrl) || "Sin página activa";
      setIndicator(currentTabUrl ? "ok" : "idle");
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
    const seen = new Set();
    const unique = allDecisions.filter((d) => {
      const id = d.scopeDetails?.activity?.id;
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    count.textContent = `${unique.length} ACT`;

    lastRenderedDecisions = unique;

    // Todo valor que sale del payload (nombre, scope, experiencia, id) pasa
    // por escapeHtml: la extensión corre en cualquier sitio y la página
    // controla esos strings. El recorte de nombres largos lo hace el CSS.
    const rowsHtml = unique
      .map((d, idx) => {
        const scope = formatScope(d.scope);
        const { name, id, exp, actType } = getActivityInfo(d);
        const displayName = name || `Actividad ${id}`;
        const targetUrl = getTargetUrl(actType, id);
        // Si no se pudo detectar el tipo, se ofrecen ambos links como hipótesis
        const urlAB = !actType ? getTargetUrl("AB", id) : null;
        const urlXT = !actType ? getTargetUrl("XT", id) : null;
        const domAction = getDomActionData(d);

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
        <div class="activity">
          <div class="activity__tags">
            <span class="scope-tag scope-tag--${scope.type}" title="${escapeHtml(scope.type === "vec" ? "Visual Experience Composer (__view__)" : scope.label)}">${escapeHtml(scope.label)}</span>
            ${actType ? `<span class="activity__type activity__type--${actType.toLowerCase()}" title="Tipo inferido del nombre de la actividad: el payload no lo informa">${actType === "AB" ? "A/B" : "XT"}</span>` : ""}
          </div>
          <div class="activity__name" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</div>
          <div class="activity__meta">
            <button class="activity__id" data-copy="${escapeHtml(id)}" title="Copiar ID de la actividad">#${escapeHtml(id)}</button>
            ${exp ? `<span class="activity__separator" aria-hidden="true">·</span><span class="activity__experience">${escapeHtml(exp)}</span>` : ""}
          </div>
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

    const scrollTop = list.scrollTop;
    list.innerHTML = tenantNote + rowsHtml;
    list.scrollTop = scrollTop;
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
 * Limpia todo lo capturado (requests/domMboxes/digitalDataEvents). La usa el
 * botón Limpiar: es el único "empezar de nuevo" explícito, a diferencia del
 * reset automático por cambio de página de content.js.
 */
function clearCapturedData(callback) {
  chrome.storage.local.set({ requests: [], domMboxes: [], digitalDataEvents: [] }, () => {
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
  chrome.storage.local.get(["requests", "domMboxes", "digitalDataEvents"], (before) => {
    const hadData =
      (before.requests || []).length + (before.domMboxes || []).length + (before.digitalDataEvents || []).length > 0;
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
          chrome.storage.local.get(["requests", "domMboxes", "digitalDataEvents"], (now) => {
            chrome.storage.local.set(
              {
                requests: [...(now.requests || []), ...(before.requests || [])].slice(0, 50),
                domMboxes: [...new Set([...(now.domMboxes || []), ...(before.domMboxes || [])])],
                digitalDataEvents: [...(now.digitalDataEvents || []), ...(before.digitalDataEvents || [])].slice(0, 500),
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
  if (tab.dataset.tab === "mboxes") renderMboxes();
  if (tab.dataset.tab === "eventos") renderEventos();
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
 * Renderiza la pestaña "mBoxes".
 * Cruza los mboxes encontrados en el DOM con los que Target respondió,
 * y los clasifica en: En uso / Libres / Solo Alloy.
 */
function renderMboxes() {
  chrome.storage.local.get(["requests", "domMboxes"], (data) => {
    if (showBlockedIn("mbox-list")) return;
    const requests = data.requests || [];
    const domMboxes = data.domMboxes || [];

    // Construye un mapa scope → nombre de actividad a partir de las respuestas de Target
    const activeMboxes = new Map();
    requests.forEach((r) => {
      const decisions =
        r.payload?.handle
          ?.filter((h) => h.type === "personalization:decisions")
          ?.flatMap((h) => h.payload) || [];
      decisions.forEach((d) => {
        if (d.scope && d.scope !== "__view__") {
          const meta = d.items?.[0]?.meta;
          const name =
            meta?.["activity.name"] || d.scopeDetails?.activity?.name || null;
          if (!activeMboxes.has(d.scope)) activeMboxes.set(d.scope, name);
        }
      });
    });

    const activeSet = new Set(activeMboxes.keys());
    const domSet = new Set(domMboxes);

    // Mismas tres categorías que los badges de cada fila, así el resumen
    // siempre suma: En uso + Libres = mboxes del DOM, y Alloy va aparte.
    // (Antes "En uso" contaba también los scopes solo-Alloy, y En uso +
    // Libres no coincidía con el total del DOM.)
    const enUso = [...domSet].filter((m) => activeSet.has(m)).length;
    const libres = domSet.size - enUso;
    const soloAlloy = [...activeSet].filter((m) => !domSet.has(m)).length;

    const allMboxes = new Set([...domSet, ...activeSet]);
    const summary = document.getElementById("mbox-summary");
    summary.hidden = allMboxes.size === 0;
    summary.innerHTML = [
      `<b>${enUso}</b> en uso`,
      `<b>${libres}</b> ${libres === 1 ? "libre" : "libres"}`,
      `<b>${soloAlloy}</b> solo Alloy`,
      `<span title="Elementos [data-mbox] encontrados en la página">${domSet.size} en el DOM</span>`,
    ].join(" · ");

    if (allMboxes.size === 0) {
      // Dos motivos posibles y NO son lo mismo: "todavía no capturamos nada"
      // (requests vacío, hace falta recargar) vs. "sí capturamos, pero la
      // página no tiene ni un [data-mbox] ni un scope nombrado — todo es VEC
      // (__view__), que se excluye a propósito de esta clasificación". El
      // segundo caso mostraba el mismo "Sin datos aún, recargá" que el
      // primero, lo cual hacía parecer que la captura había fallado cuando
      // en realidad sí había actividades (visibles en Actividades).
      document.getElementById("mbox-list").innerHTML =
        requests.length === 0
          ? emptyStateHtml("box", "Sin datos aún.<br>Recarga la página con la extensión activa.", true)
          : emptyStateHtml(
              "target",
              `Esta página no usa mboxes nombrados — todo corre por VEC (<span class="mono">__view__</span>).<br>Mira la pestaña <strong>Actividades</strong> para ver qué se activó.`,
            );
      return;
    }

    // Orden: activos primero, luego libres; alfabético dentro de cada grupo
    const sorted = [...allMboxes].sort((a, b) => {
      const aA = activeSet.has(a),
        bA = activeSet.has(b);
      if (aA && !bA) return -1;
      if (!aA && bA) return 1;
      return String(a).localeCompare(String(b));
    });

    document.getElementById("mbox-list").innerHTML = sorted
      .map((mbox) => {
        const isActive = activeSet.has(mbox);
        const isInDom = domSet.has(mbox);
        const actName = activeMboxes.get(mbox);
        const onlyAlloy = isActive && !isInDom;

        let pillClass, pillLabel, pillTitle;
        if (isActive && isInDom) {
          pillClass = "status-badge--active";
          pillLabel = "En uso";
          pillTitle = "Está en el DOM y Target respondió para este scope";
        } else if (onlyAlloy) {
          pillClass = "status-badge--alloy";
          pillLabel = "Solo Alloy";
          pillTitle = "Target respondió, pero no hay ningún elemento [data-mbox] con este nombre";
        } else {
          pillClass = "status-badge--free";
          pillLabel = "Libre";
          pillTitle = "Está en el DOM, pero Target no le asignó nada";
        }

        // mbox sale de [data-mbox] de la página y actName del payload: ambos se escapan.
        return `
        <div class="mbox-row">
          <div class="mbox-row__info">
            <div class="mbox-row__name">${escapeHtml(mbox)}</div>
            ${actName ? `<div class="mbox-row__activity">↳ ${escapeHtml(actName)}</div>` : ""}
          </div>
          <div class="mbox-row__status">
            <span class="status-badge ${pillClass}" title="${pillTitle}">${pillLabel}</span>
          </div>
        </div>
      `;
      })
      .join("");
  });
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
        <summary class="raw-summary">Payload</summary>
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
  chrome.storage.local.get("digitalDataEvents", (data) => {
    if (showBlockedIn("event-list")) return;
    const events = data.digitalDataEvents || [];
    const list = document.getElementById("event-list");
    const filters = document.getElementById("event-filters");
    document.getElementById("event-search-bar").hidden = events.length === 0;

    if (events.length === 0) {
      filters.innerHTML = "";
      list.innerHTML = emptyStateHtml(
        "list",
        "Sin eventos aún.<br>Interactúa con la página para ver los pushes a la capa de datos (digitalData o adobeDataLayer).",
        true,
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

    filters.innerHTML = [...counts.entries()]
      .map(([key, count]) => {
        const active = eventFilterState.get(key);
        return `<button class="event-filter${active ? " event-filter--active" : ""}" data-event="${escapeHtml(key)}" aria-pressed="${!!active}">${escapeHtml(key)} · ${count}</button>`;
      })
      .join("");

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

// ── Live update: re-renderiza cuando cambia el storage ───────────────────────
chrome.storage.onChanged.addListener((changes) => {
  if (changes.instanceInfo) renderInstanceInfo();

  const activeTab = document.querySelector(".tabs__item--active")?.dataset?.tab;
  if (!activeTab) return;
  if (activeTab === "mboxes" && (changes.requests || changes.domMboxes))
    renderMboxes();
  if (activeTab === "eventos" && changes.digitalDataEvents) renderEventos();
  if (activeTab === "actividades" && changes.requests) {
    getInspectedTab((tab) => render(tab?.url || ""));
  }
});

// La pestaña inspeccionada puede cerrarse con la ventana abierta: antes eso
// solo se detectaba al reabrir la ventana.
chrome.tabs.onRemoved.addListener((tabId) => {
  if (String(tabId) === new URLSearchParams(location.search).get("tabId")) showTabClosed();
});
