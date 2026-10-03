// Textos de la ventana en español e inglés. popup.js los usa como `T.clave` o
// `T.clave(args)`; el marcado fijo de popup.html se traduce con atributos
// data-i18n* (ver applyStaticI18n, abajo).
//
// Idioma: español si Chrome está en español, inglés para el resto (el mismo
// criterio que _locales, donde `en` es el idioma por defecto). `?lang=es|en`
// en la URL lo fuerza — lo usan las pruebas y las capturas de la tienda.
//
// No se usa chrome.i18n.getMessage para estos textos: casi todos llevan HTML,
// plurales o valores intercalados, y como funciones se leen y se prueban
// mejor que como mensajes con $PLACEHOLDERS$. _locales queda solo para lo que
// Chrome exige ahí (nombre y resumen de la extensión).
//
// Los valores con HTML son texto fijo de la UI: todo dato capturado de la
// página llega a estas funciones YA escapado por quien llama (escapeHtml).
const LANG = (() => {
  const forced = new URLSearchParams(location.search).get("lang");
  if (forced === "es" || forced === "en") return forced;
  let ui = "";
  try {
    ui = chrome.i18n.getUILanguage();
  } catch (e) {
    ui = navigator.language || "";
  }
  return String(ui).toLowerCase().startsWith("es") ? "es" : "en";
})();

/** Botón-link que activa otra pestaña de la ventana (ver el listener de [data-goto] en popup.js). */
const gotoBtn = (tab, label, extra = "") => `<button class="inline-link" data-goto="${tab}"${extra}>${label}</button>`;

const STRINGS = {
  es: {
    locale: "es-PE",

    // Pestañas y marcado fijo (popup.html)
    tabActivities: "Actividades",
    tabEvents: "Eventos",
    countTitle: "Actividades capturadas en esta página",
    clear: "Limpiar",
    clearTitle: "Borra actividades, mboxes, eventos y reglas de Launch capturados. Se puede deshacer unos segundos.",
    tablistLabel: "Secciones del inspector",
    noPage: "Sin página activa",
    eventSearchPlaceholder: "Buscar en eventos: nombre, valor del payload o página…",
    eventSearchLabel: "Buscar en eventos",
    eventFiltersLabel: "Filtrar por nombre de evento",
    hitFiltersLabel: "Mostrar solo un tipo de llamada",
    launchSearchPlaceholder: "Buscar regla, condición o código…",
    launchSearchLabel: "Buscar en reglas de Launch",
    launchFiltersLabel: "Filtrar reglas por resultado",
    tenantPlaceholder: "slug de la org (experience.adobe.com/#/@…)",
    tenantTitle: "Slug de la organización en la URL del admin de Adobe Target (no es el orgId). Vacío = sin links a Target.",

    // Estados generales
    captureNow: "Capturar ahora",
    blockedText: "Esta página no permite inyección de scripts.",
    blockedUrl: "Página no inspeccionable",
    tabClosedText:
      "La pestaña que esta ventana estaba inspeccionando ya se cerró. Haz clic en el ícono de la extensión desde otra pestaña para inspeccionarla.",
    tabClosedUrl: "Pestaña cerrada",
    staleHtml: (host) => `Página distinta a la captura.<br>Recarga <strong>${host}</strong> para capturar.`,
    staleUrl: "Página distinta a la captura",
    lastResponse: (time) => `Última respuesta: ${time}`,

    // Actividades
    fieldSize: "tamaño",
    previewChars: (shown, total) => `Mostrando los primeros ${shown} caracteres de ${total}.`,
    previewLines: (shown, total) => `Mostrando ${shown} de ${total} líneas.`,
    copyFull: "Copiar completo",
    viewContent: "Ver contenido",
    viewContentAria: (id) => `Ver contenido de la actividad ${id}`,
    render: {
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
    },
    prehidingStill: "Prehiding: Alloy ocultó contenido y todavía no lo volvió a mostrar.",
    prehidingTitle: "Tiempo entre hide-containers y show-containers de Alloy",
    prehidingMs: (ms) => `Prehiding: el contenido estuvo oculto <b>${ms} ms</b> mientras respondía Target.`,
    whyAtjs: (version) =>
      `Esta página usa <strong>at.js${version}</strong> (Adobe Target clásico), no Web SDK (Alloy).<br>La extensión inspecciona Web SDK: acá funcionan ${gotoBtn("launch", "Launch")} y ${gotoBtn("eventos", "Eventos")}, no Actividades.`,
    whyTargetRule: (rule, cond, searchAttr) =>
      `Launch no ejecutó la regla <strong>${rule}</strong>: no se cumplió ${cond}.<br>Parece la cookie de consentimiento: acepta las cookies del sitio y recarga. ${gotoBtn("launch", "Ver la regla en Launch", searchAttr)}`,
    whyConsent: (n, cond) =>
      `${n} ${n === 1 ? "regla de Launch espera" : "reglas de Launch esperan"} una cookie de consentimiento (p. ej. ${cond}) y Alloy no pidió decisiones a Target.<br>Acepta las cookies del sitio y recarga.`,
    whyNoOffers: (n, noOffers) =>
      `Alloy pidió decisiones a Target${n > 1 ? ` ${n} veces` : ""}, pero no vino ninguna actividad para esta página${noOffers ? ' (Alloy informó <span class="mono">no-offers</span>)' : ""}.<br>Abre ${gotoBtn("hits", "Hits")} para ver qué se pidió y qué respondió.`,
    whyNoDecisionCalls: (n) =>
      `Alloy hizo ${n} ${n === 1 ? "llamada" : "llamadas"} al Edge, pero ninguna pidió decisiones a Target.<br>Abre ${gotoBtn("hits", "Hits")} para ver qué se envió.`,
    whyNoCalls: `Alloy está configurado, pero no envió ninguna llamada al Edge en esta carga.<br>Abre ${gotoBtn("launch", "Launch")}: puede que la regla que lo dispara no se haya cumplido.`,
    noCaptures:
      "Sin capturas aún.<br>Recarga la página, o usa <strong>Capturar ahora</strong> si la pestaña ya estaba abierta antes de cargar la extensión.",
    responsesNoActivities: (n) =>
      `Alloy recibió ${n} ${n === 1 ? "respuesta" : "respuestas"} del Edge, pero ninguna trajo actividades de Target para esta página.`,
    activityFallback: (id) => `Actividad ${id}`,
    openInTarget: "Abrir en Target ↗",
    typeUnknown: "Tipo no detectado. Abrir como:",
    typeInferred: "Tipo inferido del nombre de la actividad: el payload no lo informa",
    copyIdTitle: "Copiar ID de la actividad",
    impNotified: "impresión notificada",
    impNotifiedTitle: "Alloy notificó el display a Target: la impresión se cuenta",
    impMissing: "impresión sin notificar",
    impMissingTitle: "Alloy la aplicó, pero en esta carga no notificó el display a Target: la impresión no se contó",
    renderError: (err) => `Error al renderizar: ${err}`,
    tenantNote: "Configura el tenant para abrir actividades en Target.",
    configure: "Configurar",
    displayNote: (n) =>
      `${n} ${n === 1 ? "actividad renderizada no notificó" : "actividades renderizadas no notificaron"} la impresión (display) en esta carga: Target la cuenta recién cuando se notifica.`,
    viewHits: "Ver Hits",
    verdictActivities: (n) => `<b>${n}</b> ${n === 1 ? "actividad" : "actividades"}`,
    verdictRendered: (n) => `<b>${n}</b> ${n === 1 ? "renderizada" : "renderizadas"}`,
    verdictNotified: (n) => `<b>${n}</b> con impresión notificada`,

    // Avisos (toast)
    contentCopied: "Contenido completo copiado al portapapeles.",
    copyFailed: "No se pudo copiar al portapapeles.",
    idCopied: (id) => `ID ${id} copiado.`,
    payloadCopied: "Payload copiado al portapapeles.",
    nothingToClear: "No había capturas para borrar.",
    cleared: "Capturas y eventos borrados.",
    undo: "Deshacer",
    restored: "Capturas restauradas.",
    noTab: "No hay una pestaña para inspeccionar.",
    captureActive: "Captura activa en la pestaña. Lo que Target ya respondió antes no se recupera: recarga la página para verlo.",
    injectFailed: "No se pudo inyectar en esta pestaña (página protegida o sin permiso).",
    tenantInvalid: "Tenant inválido: usa solo el slug que aparece después de @ en la URL de Target.",
    tenantSaved: "Tenant guardado: los links a Target ya están activos.",
    tenantCleared: "Tenant borrado: sin links a Target.",

    // Pie
    instances: (n) => `${n} instancias`,

    // mBoxes
    mboxNone: (hasVec) =>
      `Sin mboxes con nombre ni elementos <span class="mono">[data-mbox]</span> en esta página.${hasVec ? ' Todo corre por VEC (<span class="mono">__view__</span>).' : ""}`,
    mboxInUseCount: "en uso",
    mboxFreeCount: (n) => (n === 1 ? "libre" : "libres"),
    mboxAlloyCount: "solo Alloy",
    mboxInDom: (n) => `${n} en el DOM`,
    mboxDomTitle: "Elementos [data-mbox] encontrados en la página",
    mboxInUse: "En uso",
    mboxInUseTitle: "Está en el DOM y Target respondió para este scope",
    mboxAlloy: "Solo Alloy",
    mboxAlloyTitle: "Target respondió, pero no hay ningún elemento [data-mbox] con este nombre",
    mboxFree: "Libre",
    mboxFreeTitle: "Está en el DOM, pero Target no le asignó nada",

    // Eventos
    unknownPage: "Página desconocida",
    payloadAria: (name) => `Payload de ${name}`,
    copyPayload: "Copiar payload",
    noEventsLive:
      'Sin eventos aún.<br>La captura está activa: esta página todavía no hizo <span class="mono">push</span> a <span class="mono">digitalData</span> ni a <span class="mono">adobeDataLayer</span> (o usa otra capa de datos).',
    noEvents: "Sin eventos aún.<br>Interactúa con la página para ver los pushes a la capa de datos (digitalData o adobeDataLayer).",
    allEventsFiltered: "Todos los eventos están filtrados.<br>Activa algún filtro arriba para verlos.",
    noEventMatch: (q) => `Ningún evento coincide con <strong>${q}</strong>.`,
    mostRecent: "más reciente",
    mostRecentTitle: "Página con el evento más reciente",
    eventCount: (n) => `${n} evento${n === 1 ? "" : "s"}`,

    // Launch
    rule: {
      completed: { label: "Completada", chip: "Completadas", title: "Se disparó, cumplió sus condiciones y ejecutó sus acciones." },
      failed: {
        label: "Condición no cumplida",
        chip: "Condición no cumplida",
        title: "Se disparó pero una condición dio falso: no ejecutó sus acciones en esta página. Es normal para reglas de otras páginas.",
      },
    },
    conditionFallback: "condición",
    actionFallback: "acción",
    viewCode: "Ver código",
    viewSettings: "Ver configuración",
    labelOf: (label, owner) => `${label} de ${owner}`,
    ownerCondition: (kind, rule) => `la condición ${kind} de ${rule}`,
    ownerAction: (kind, rule) => `la acción ${kind} de ${rule}`,
    codeTruncated: (n) => `Recortado a ${n} caracteres: el código completo está en la librería de Launch de la página.`,
    copyCode: "Copiar código",
    copySettings: "Copiar configuración",
    externalCode: "código externo ↗",
    unnamedProperty: "Propiedad sin nombre",
    envTitle: "Entorno de la librería de Launch que cargó esta página",
    envWarning: (env) => `Esta página carga la librería de <strong>${env}</strong>, no la de production: no es lo que ven los usuarios.`,
    launchSummary: (completed, failed) =>
      `<b>${completed}</b> ${completed === 1 ? "regla completada" : "reglas completadas"} · <b>${failed}</b> con condición no cumplida`,
    launchNoRules:
      "Launch está cargado, pero no se capturaron reglas.<br>Recarga la página: las reglas de carga se disparan antes de que se las pueda escuchar en una pestaña ya abierta.",
    launchNotDetected: "No se detectó Adobe Launch (Tags) en esta página.<br>Si la página lo usa, recárgala con la extensión activa.",
    allRulesFiltered: "Todas las reglas están filtradas.<br>Activa algún filtro arriba para verlas.",
    noRuleMatch: (q) => `Ninguna regla coincide con <strong>${q}</strong>.`,
    unnamedRule: "Regla sin nombre",
    actionsNotRunAria: (name) => `Acciones que no se ejecutaron de ${name}`,
    actionsNotRunTitle: "La condición no se cumplió, así que estas acciones no corrieron en esta página",
    actionsNotRun: (n) => (n === 1 ? "1 acción que no se ejecutó" : `${n} acciones que no se ejecutaron`),
    timesFired: "Veces que se disparó",
    sinceLoad: "Desde la carga de la página",
    codeCopied: "Código copiado.",
    settingsCopied: "Configuración copiada.",

    // Hits
    hitIdentity: "Pedido de identidad (ECID)",
    hitConsent: "Consentimiento",
    hitFilter: { all: "Todas", decisions: "Decisiones", display: "Impresión", error: "Con error", pending: "Sin respuesta" },
    hitFailed: "Falló",
    hitPending: "Sin respuesta",
    hitPendingTitle: "Alloy la envió y todavía no llegó respuesta",
    hitStatusTitle: "Código de estado de la respuesta del Edge",
    copyBlock: (label) => `Copiar ${label.toLowerCase()}`,
    noHitsLive: `Sin llamadas al Edge en esta carga.<br>La captura está activa, pero Alloy no envió nada: puede que la regla que lo dispara no se haya cumplido. ${gotoBtn("launch", "Ver Launch")}`,
    noHits: "Sin llamadas al Edge en esta carga.<br>Recarga la página con la extensión activa: Alloy hace sus llamadas al cargar.",
    hitsCalls: (n) => `<b>${n}</b> ${n === 1 ? "llamada" : "llamadas"} al Edge`,
    hitsErrors: (n) => `<b>${n}</b> con error`,
    hitsPending: (n) => `<b>${n}</b> sin respuesta`,
    hitsImpTitle: "Llamadas que notifican el display (decisioning.propositionDisplay): así Target cuenta la impresión",
    hitsImp: (n) => `${n} ${n === 1 ? "notificación" : "notificaciones"} de impresión`,
    callFallback: "Llamada",
    decisions: (n) => `${n} ${n === 1 ? "decisión" : "decisiones"}`,
    responsePrefix: "respuesta: ",
    reportsImpression: "Notifica la impresión (display) de:",
    instanceTitle: "Instancia de Alloy",
    requestCopied: "Request copiado.",
    responseCopied: "Response copiada.",
  },

  en: {
    locale: "en-US",

    tabActivities: "Activities",
    tabEvents: "Events",
    countTitle: "Activities captured on this page",
    clear: "Clear",
    clearTitle: "Clears captured activities, mboxes, events and Launch rules. You can undo it for a few seconds.",
    tablistLabel: "Inspector sections",
    noPage: "No active page",
    eventSearchPlaceholder: "Search events: name, payload value or page…",
    eventSearchLabel: "Search events",
    eventFiltersLabel: "Filter by event name",
    hitFiltersLabel: "Show only one kind of call",
    launchSearchPlaceholder: "Search rule, condition or code…",
    launchSearchLabel: "Search Launch rules",
    launchFiltersLabel: "Filter rules by result",
    tenantPlaceholder: "org slug (experience.adobe.com/#/@…)",
    tenantTitle: "Your organization's slug in the Adobe Target admin URL (not the orgId). Empty = no links to Target.",

    captureNow: "Capture now",
    blockedText: "This page does not allow script injection.",
    blockedUrl: "Page cannot be inspected",
    tabClosedText: "The tab this window was inspecting has been closed. Click the extension icon from another tab to inspect it.",
    tabClosedUrl: "Tab closed",
    staleHtml: (host) => `This is not the page that was captured.<br>Reload <strong>${host}</strong> to capture it.`,
    staleUrl: "Different page from the capture",
    lastResponse: (time) => `Last response: ${time}`,

    fieldSize: "size",
    previewChars: (shown, total) => `Showing the first ${shown} of ${total} characters.`,
    previewLines: (shown, total) => `Showing ${shown} of ${total} lines.`,
    copyFull: "Copy full content",
    viewContent: "View content",
    viewContentAria: (id) => `View content of activity ${id}`,
    render: {
      ok: { label: "Rendered", title: "Alloy confirmed it applied this activity on the page." },
      failed: { label: "Render failed", title: "Alloy tried to apply this activity and failed." },
      pending: {
        label: "Unconfirmed",
        title: "Alloy started applying it but did not confirm it finished (e.g. the selector does not exist on the page).",
      },
      none: {
        label: "Not auto-rendered",
        title: "Alloy did not apply it by itself: the page renders it (applyPropositions or renderDecisions: false) or it is a JSON offer.",
      },
    },
    prehidingStill: "Prehiding: Alloy hid content and has not shown it again yet.",
    prehidingTitle: "Time between Alloy's hide-containers and show-containers",
    prehidingMs: (ms) => `Prehiding: content was hidden for <b>${ms} ms</b> while Target responded.`,
    whyAtjs: (version) =>
      `This page uses <strong>at.js${version}</strong> (classic Adobe Target), not Web SDK (Alloy).<br>This extension inspects Web SDK: ${gotoBtn("launch", "Launch")} and ${gotoBtn("eventos", "Events")} work here, Activities does not.`,
    whyTargetRule: (rule, cond, searchAttr) =>
      `Launch did not run the rule <strong>${rule}</strong>: ${cond} was not met.<br>It looks like the consent cookie: accept the site's cookies and reload. ${gotoBtn("launch", "See the rule in Launch", searchAttr)}`,
    whyConsent: (n, cond) =>
      `${n} Launch ${n === 1 ? "rule is" : "rules are"} waiting for a consent cookie (e.g. ${cond}) and Alloy did not ask Target for decisions.<br>Accept the site's cookies and reload.`,
    whyNoOffers: (n, noOffers) =>
      `Alloy asked Target for decisions${n > 1 ? ` ${n} times` : ""}, but no activity came back for this page${noOffers ? ' (Alloy reported <span class="mono">no-offers</span>)' : ""}.<br>Open ${gotoBtn("hits", "Hits")} to see what was requested and what came back.`,
    whyNoDecisionCalls: (n) =>
      `Alloy made ${n} ${n === 1 ? "call" : "calls"} to the Edge, but none asked Target for decisions.<br>Open ${gotoBtn("hits", "Hits")} to see what was sent.`,
    whyNoCalls: `Alloy is configured, but it made no calls to the Edge in this load.<br>Open ${gotoBtn("launch", "Launch")}: the rule that triggers it may not have met its conditions.`,
    noCaptures: "No captures yet.<br>Reload the page, or use <strong>Capture now</strong> if the tab was already open before the extension was loaded.",
    responsesNoActivities: (n) =>
      `Alloy received ${n} ${n === 1 ? "response" : "responses"} from the Edge, but none carried Target activities for this page.`,
    activityFallback: (id) => `Activity ${id}`,
    openInTarget: "Open in Target ↗",
    typeUnknown: "Type not detected. Open as:",
    typeInferred: "Type inferred from the activity name: the payload does not state it",
    copyIdTitle: "Copy activity ID",
    impNotified: "impression reported",
    impNotifiedTitle: "Alloy reported the display to Target: the impression counts",
    impMissing: "impression not reported",
    impMissingTitle: "Alloy applied it, but in this load it did not report the display to Target: the impression was not counted",
    renderError: (err) => `Render error: ${err}`,
    tenantNote: "Set the tenant to open activities in Target.",
    configure: "Set up",
    displayNote: (n) =>
      `${n} rendered ${n === 1 ? "activity did" : "activities did"} not report the impression (display) in this load: Target only counts it once it is reported.`,
    viewHits: "View Hits",
    verdictActivities: (n) => `<b>${n}</b> ${n === 1 ? "activity" : "activities"}`,
    verdictRendered: (n) => `<b>${n}</b> rendered`,
    verdictNotified: (n) => `<b>${n}</b> with impression reported`,

    contentCopied: "Full content copied to the clipboard.",
    copyFailed: "Could not copy to the clipboard.",
    idCopied: (id) => `ID ${id} copied.`,
    payloadCopied: "Payload copied to the clipboard.",
    nothingToClear: "There were no captures to clear.",
    cleared: "Captures and events cleared.",
    undo: "Undo",
    restored: "Captures restored.",
    noTab: "There is no tab to inspect.",
    captureActive: "Capture is active in the tab. What Target already answered is not recovered: reload the page to see it.",
    injectFailed: "Could not inject into this tab (protected page or missing permission).",
    tenantInvalid: "Invalid tenant: use only the slug that appears after @ in the Target URL.",
    tenantSaved: "Tenant saved: links to Target are now active.",
    tenantCleared: "Tenant cleared: no links to Target.",

    instances: (n) => `${n} instances`,

    mboxNone: (hasVec) =>
      `No named mboxes or <span class="mono">[data-mbox]</span> elements on this page.${hasVec ? ' Everything runs through the VEC (<span class="mono">__view__</span>).' : ""}`,
    mboxInUseCount: "in use",
    mboxFreeCount: () => "free",
    mboxAlloyCount: "Alloy only",
    mboxInDom: (n) => `${n} in the DOM`,
    mboxDomTitle: "[data-mbox] elements found on the page",
    mboxInUse: "In use",
    mboxInUseTitle: "It is in the DOM and Target answered for this scope",
    mboxAlloy: "Alloy only",
    mboxAlloyTitle: "Target answered, but there is no [data-mbox] element with this name",
    mboxFree: "Free",
    mboxFreeTitle: "It is in the DOM, but Target assigned nothing to it",

    unknownPage: "Unknown page",
    payloadAria: (name) => `Payload of ${name}`,
    copyPayload: "Copy payload",
    noEventsLive:
      'No events yet.<br>Capture is active: this page has not pushed to <span class="mono">digitalData</span> or <span class="mono">adobeDataLayer</span> yet (or it uses a different data layer).',
    noEvents: "No events yet.<br>Interact with the page to see pushes to the data layer (digitalData or adobeDataLayer).",
    allEventsFiltered: "All events are filtered out.<br>Turn on a filter above to see them.",
    noEventMatch: (q) => `No event matches <strong>${q}</strong>.`,
    mostRecent: "most recent",
    mostRecentTitle: "Page with the most recent event",
    eventCount: (n) => `${n} event${n === 1 ? "" : "s"}`,

    rule: {
      completed: { label: "Completed", chip: "Completed", title: "It fired, met its conditions and ran its actions." },
      failed: {
        label: "Condition not met",
        chip: "Condition not met",
        title: "It fired but a condition was false: it did not run its actions on this page. That is normal for rules meant for other pages.",
      },
    },
    conditionFallback: "condition",
    actionFallback: "action",
    viewCode: "View code",
    viewSettings: "View settings",
    labelOf: (label, owner) => `${label} of ${owner}`,
    ownerCondition: (kind, rule) => `the ${kind} condition of ${rule}`,
    ownerAction: (kind, rule) => `the ${kind} action of ${rule}`,
    codeTruncated: (n) => `Cut to ${n} characters: the full code is in the page's Launch library.`,
    copyCode: "Copy code",
    copySettings: "Copy settings",
    externalCode: "external code ↗",
    unnamedProperty: "Unnamed property",
    envTitle: "Environment of the Launch library this page loaded",
    envWarning: (env) => `This page loads the <strong>${env}</strong> library, not production: it is not what users see.`,
    launchSummary: (completed, failed) =>
      `<b>${completed}</b> ${completed === 1 ? "rule" : "rules"} completed · <b>${failed}</b> with a condition not met`,
    launchNoRules:
      "Launch is loaded, but no rules were captured.<br>Reload the page: load rules fire before they can be listened to in a tab that was already open.",
    launchNotDetected: "Adobe Launch (Tags) was not detected on this page.<br>If the page uses it, reload it with the extension active.",
    allRulesFiltered: "All rules are filtered out.<br>Turn on a filter above to see them.",
    noRuleMatch: (q) => `No rule matches <strong>${q}</strong>.`,
    unnamedRule: "Unnamed rule",
    actionsNotRunAria: (name) => `Actions that did not run for ${name}`,
    actionsNotRunTitle: "The condition was not met, so these actions did not run on this page",
    actionsNotRun: (n) => (n === 1 ? "1 action that did not run" : `${n} actions that did not run`),
    timesFired: "Times it fired",
    sinceLoad: "Since page load",
    codeCopied: "Code copied.",
    settingsCopied: "Settings copied.",

    hitIdentity: "Identity request (ECID)",
    hitConsent: "Consent",
    hitFilter: { all: "All", decisions: "Decisions", display: "Impression", error: "Errors", pending: "No response" },
    hitFailed: "Failed",
    hitPending: "No response",
    hitPendingTitle: "Alloy sent it and no response has arrived yet",
    hitStatusTitle: "Status code of the Edge response",
    copyBlock: (label) => `Copy ${label.toLowerCase()}`,
    noHitsLive: `No calls to the Edge in this load.<br>Capture is active, but Alloy sent nothing: the rule that triggers it may not have met its conditions. ${gotoBtn("launch", "View Launch")}`,
    noHits: "No calls to the Edge in this load.<br>Reload the page with the extension active: Alloy makes its calls on load.",
    hitsCalls: (n) => `<b>${n}</b> ${n === 1 ? "call" : "calls"} to the Edge`,
    hitsErrors: (n) => `<b>${n}</b> with errors`,
    hitsPending: (n) => `<b>${n}</b> with no response`,
    hitsImpTitle: "Calls that report the display (decisioning.propositionDisplay): this is how Target counts the impression",
    hitsImp: (n) => `${n} impression ${n === 1 ? "report" : "reports"}`,
    callFallback: "Call",
    decisions: (n) => `${n} ${n === 1 ? "decision" : "decisions"}`,
    responsePrefix: "response: ",
    reportsImpression: "Reports the impression (display) of:",
    instanceTitle: "Alloy instance",
    requestCopied: "Request copied.",
    responseCopied: "Response copied.",
  },
};

const T = STRINGS[LANG];

/**
 * Traduce el marcado fijo de popup.html: data-i18n (texto), data-i18n-title,
 * data-i18n-placeholder y data-i18n-aria-label nombran una clave de T. El
 * HTML trae el español escrito, así que si este script fallara la ventana
 * igual se lee.
 */
function applyStaticI18n() {
  document.documentElement.lang = LANG;
  const set = (attr, apply) =>
    document.querySelectorAll(`[${attr}]`).forEach((el) => {
      const value = T[el.getAttribute(attr)];
      if (typeof value === "string") apply(el, value);
    });
  set("data-i18n", (el, v) => (el.textContent = v));
  set("data-i18n-title", (el, v) => (el.title = v));
  set("data-i18n-placeholder", (el, v) => (el.placeholder = v));
  set("data-i18n-aria-label", (el, v) => el.setAttribute("aria-label", v));
}

applyStaticI18n();
