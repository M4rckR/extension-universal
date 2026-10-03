// ── Guard de idempotencia ──────────────────────────────────────────────────────
// Permite reinyectar este script a demanda (botón "Capturar ahora" del popup,
// vía chrome.scripting.executeScript) sin registrar dos veces el listener de
// postMessage, lo que duplicaría cada request capturado.
if (!window.__mboxInspectorContentActive) {
window.__mboxInspectorContentActive = true;

// digitalDataEvents guarda hasta esta cantidad, más viejo primero afuera
// (mismo mecanismo unshift+slice que requests). Medido en vivo contra
// un sitio en producción: un push típico (trackScroll/trackAction) pesa ~60-120B de
// JSON crudo; con el wrapper {payload,time,timeSincePageLoad,pageUrl} cada
// entrada persistida ronda ~300-500B. 500 entradas ≈ 250KB, una fracción
// chica de los 10MB de cuota de chrome.storage.local (sin unlimitedStorage)
// — el límite real no es cuota, es cubrir cómodamente un recorrido de
// 30-50 páginas.
const MAX_DIGITAL_DATA_EVENTS = 500;

// ── Validación de mensajes ───────────────────────────────────────────────────
// El marcador source: "mbox-inspector" NO autentica nada: cualquier script de
// la página puede postear el mismo objeto. Por eso cada mensaje se trata como
// entrada no confiable — se valida su forma y se acota su tamaño antes de
// guardarlo (popup.js además escapa todo al renderizar). Los topes son por
// bytes de JSON, no solo por cantidad: 50 requests "normales" son unos pocos
// cientos de KB, pero un solo payload gigante (real o forjado) podía llenar
// la cuota de 10MB y hacer que todos los set() siguientes fallaran en silencio.
const MAX_ALLOY_PAYLOAD_CHARS = 200000;
const MAX_EVENT_PAYLOAD_CHARS = 20000;
const MAX_MBOXES = 500;
const MAX_MBOX_NAME = 200;
const MAX_SHORT_STRING = 300;
// Renderizado de Alloy: unos pocos eventos por sendEvent; 200 cubren de sobra
// una página con SPA. Reglas de Launch: se guardan agregadas (una entrada por
// regla y resultado, con contador), así que el tope es de reglas distintas —
// la propiedad más grande medida (viabcp.com) dispara ~150 por carga.
const MAX_RENDER_EVENTS = 200;
const MAX_LAUNCH_RULES = 400;
const MAX_RULES_PER_MESSAGE = 200;
const MAX_CONDITIONS_PER_RULE = 5;
// Código de una condición fallida (customCode) o su configuración en JSON.
// Las medidas en sitios reales rondan 0.2–2 KB; 8000 caracteres cubren casi
// todas, y con 400 reglas el peor caso queda lejos de la cuota de 10MB.
const MAX_CONDITION_CODE = 8000;
// Acciones de reglas completadas: se guardan una vez por regla (inject.js no
// las reenvía en cada disparo). Medido: mediana ~120-475 caracteres, pero hay
// customCode de 40-90KB (pixels, modales) — se recortan a 12000 con aviso.
// Peor caso real medido (bbva.pe, 71 customCode): ~200KB por carga.
const MAX_ACTIONS_PER_RULE = 10;
const MAX_ACTION_CODE = 12000;

/** Valida una acción de Launch que viene de inject.js (forma no confiable). */
function cleanAction(a) {
  if (!a || typeof a !== "object") return null;
  const code = typeof a.code === "string" ? a.code : "";
  const url = typeof a.externalUrl === "string" && /^https?:\/\//.test(a.externalUrl) ? a.externalUrl : undefined;
  return {
    extension: shortString(a.extension),
    kind: shortString(a.kind),
    language: shortString(a.language),
    externalUrl: shortString(url),
    code: code ? code.slice(0, MAX_ACTION_CODE) : undefined,
    codeTruncated: code.length > MAX_ACTION_CODE,
  };
}
const RENDER_STATUSES = new Set([
  "rendering-started",
  "rendering-succeeded",
  "rendering-failed",
  "rendering-redirect",
  "no-offers",
  "hide-containers",
  "show-containers",
]);

function jsonLength(value) {
  try {
    return JSON.stringify(value).length;
  } catch (e) {
    return Infinity;
  }
}

/** Solo strings no vacíos y de largo razonable; descarta cualquier otra cosa. */
function cleanNames(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((s) => typeof s === "string" && s.length > 0 && s.length <= MAX_MBOX_NAME)
    .slice(0, MAX_MBOXES);
}

function shortString(value) {
  return typeof value === "string" ? value.slice(0, MAX_SHORT_STRING) : undefined;
}

// ── Guarda de contexto de extensión invalidado ───────────────────────────────
// Recargar la extensión en chrome://extensions NO mata los content scripts ya
// inyectados en pestañas que estaban abiertas — quedan huérfanos: siguen
// corriendo (el listener de postMessage sigue registrado, es JS normal), pero
// su contexto de extensión ya no es válido. inject.js (world MAIN, sin acceso
// a chrome.*) no se entera de nada de esto y sigue posteando mensajes
// normalmente después de cada respuesta de Alloy o push a digitalData. Sin
// esta guarda, cada uno de esos mensajes terminaba llamando chrome.storage.*
// y tirando "Extension context invalidated" — ruido de desarrollo (la página
// nunca se rompe, Target/Alloy siguen andando igual), pero ensuciaba el panel
// de errores de chrome://extensions.
//
// chrome.runtime.id es la forma correcta de detectarlo: pasa a `undefined`
// cuando el contexto se invalida, y LEERLO nunca tira (a diferencia de llamar
// un método como chrome.storage.local.get(), que sí tira si el contexto ya
// no es válido). `chrome` en sí no debería poder faltar en un content script,
// pero se encadena con ?. de todos modos — es una lectura, no cuesta nada.
function isExtensionContextValid() {
  return !!chrome?.runtime?.id;
}

// Único lugar donde se llama chrome.storage.local.get/set en todo el archivo
// — todos los call sites de abajo pasan por acá, así que la guarda de
// contexto vive en un solo lugar en vez de repetirse en cada handler. Si el
// contexto ya no es válido, no-opean en silencio (resuelven con un valor
// vacío/nada) en vez de llamar chrome.* y tirar.
//
// chrome.storage.local.get/set devuelven Promise nativamente si se omite el
// callback (soportado desde Chrome 96) — se usa esa forma para poder
// encadenarlas en enqueueStorageTask de abajo sin promisificar a mano.
function safeStorageGet(keys) {
  if (!isExtensionContextValid()) return Promise.resolve({});
  return chrome.storage.local.get(keys);
}

function safeStorageSet(items) {
  if (!isExtensionContextValid()) return Promise.resolve();
  return chrome.storage.local.set(items);
}

// ── Cola de escrituras serializadas ──────────────────────────────────────────
// Todo handler que hace lectura-modificación-escritura (get → mergear/unshift
// → set) sobre chrome.storage.local tiene la misma carrera: si dos mensajes
// llegan casi juntos (dos digitalData.push seguidos, varias respuestas de
// Alloy en ráfaga), el segundo get() puede resolver ANTES de que el primer
// set() haya terminado — ambos leen el mismo array base, y el set() que
// aterriza último pisa por completo al que aterrizó primero. Confirmado con
// logs con timestamp contra un mock de chrome.storage.local con latencia
// real (setTimeout, no microtask instantáneo): en 2 de 3 corridas el segundo
// get() arrancaba antes de que el primer set() hubiera resuelto, y el evento
// más viejo desaparecía del todo — reproduce exactamente la pérdida de
// "NameA" reportada en vivo (dos trackPromotionClick seguidos, sobrevive
// siempre el último).
//
// Se encolan como tareas: cada una es la unidad completa get→modificar→set,
// y no arranca hasta que la anterior terminó (haya tenido éxito o no) —
// mismo mecanismo para las cuatro escrituras racy (alloyResponse, domMboxes,
// decisionScopes, digitalDataPush) y para el reset de página de abajo, en
// vez de reimplementarlo en cada handler. Es una sola cola global, no una
// por clave de storage: el volumen de mensajes acá es bajísimo (unos pocos
// por segundo como mucho), así que serializar operaciones sobre claves
// distintas entre sí no tiene costo real, y evita la complejidad de
// coordinar colas separadas por clave.
let storageQueue = Promise.resolve();

function enqueueStorageTask(task) {
  const result = storageQueue.then(task);
  // La cadena interna nunca debe quedar rechazada — si no, todas las tareas
  // encoladas después de una que falla se saltean en cascada. El resultado
  // que se devuelve sí refleja el éxito/fracaso real de ESTA tarea.
  storageQueue = result.catch(() => {});
  return result;
}

// ── Detección de cambio de página ────────────────────────────────────────────
// Compara la URL guardada en storage con la URL actual (origin + path + query
// string, sin el fragmento). El query string cuenta: /producto?id=A y
// /producto?id=B son páginas distintas, y comparando solo hostname + path sus
// capturas quedaban mezcladas.
// Si cambiaron, limpia requests/domMboxes/instanceInfo — son una foto del
// estado actual de la página, no un flujo, y acumularlos entre páginas
// confundiría cuál actividad es de dónde.
//
// digitalDataEvents NO se resetea acá a propósito: persiste a través de la
// navegación (ver abajo, donde cada entrada se etiqueta con pageUrl) para
// poder recorrer el sitio y después revisar el recorrido completo — dónde
// disparó cada push. Sí se limpia con el botón Limpiar (ver popup.js
// clearCapturedData), porque ese es un "empezar de nuevo" explícito, a
// diferencia de una navegación normal dentro del mismo recorrido.
//
// También pasa por la cola: es un get→set igual que los handlers de abajo, y
// si un mensaje de inject.js llega antes de que este chequeo termine (poco
// probable pero posible — content.js recién inyectado, mensaje casi
// inmediato), sin la cola ese handler podría leer el estado viejo antes del
// reset, o el reset podría pisar una escritura recién hecha.
enqueueStorageTask(async () => {
  const data = await safeStorageGet("tabUrl");
  const prevUrl = data.tabUrl || "";
  let prevPath = "";
  let currPath = "";
  const pageKey = (url) => {
    const u = new URL(url);
    return u.origin + u.pathname + u.search;
  };
  try {
    prevPath = pageKey(prevUrl);
  } catch (e) {}
  try {
    currPath = pageKey(window.location.href);
  } catch (e) {}

  if (prevPath !== currPath) {
    // Nueva página — limpiar la foto del estado actual, incluyendo el
    // orgId/edgeConfigId de la página anterior, el renderizado y las reglas
    // y propiedad de Launch. digitalDataEvents queda afuera.
    await safeStorageSet({
      requests: [],
      domMboxes: [],
      instanceInfo: null,
      renderEvents: [],
      launchRules: [],
      launchInfo: null,
      tabUrl: window.location.href,
    });
  } else {
    // Misma página recargada: requests/domMboxes se conservan (se deduplican
    // al mostrar), pero el renderizado y las reglas de Launch son de CADA
    // carga — sin esto, una recarga duplicaba cada regla (×2) y mezclaba el
    // prehiding de dos cargas.
    await safeStorageSet({ tabUrl: window.location.href, renderEvents: [], launchRules: [] });
  }
});

// ── Puente inject.js → storage ───────────────────────────────────────────────
// inject.js corre en world: MAIN (contexto de la página) y no tiene acceso a
// la API de Chrome. Este content script actúa como puente: escucha mensajes
// de inject.js vía postMessage y los persiste en chrome.storage.local.
//
// Handler con nombre (no arrow function inline) para poder desregistrarlo:
// si detecta el contexto invalidado, se saca a sí mismo del todo en vez de
// seguir chequeando en cada mensaje futuro — un content script huérfano no
// tiene nada más que hacer, la página eventualmente navega o se recarga y
// ahí entra un content.js nuevo con contexto válido.
function handleInjectedMessage(event) {
  if (event.source !== window) return;
  if (!event.data || event.data.source !== "mbox-inspector") return;

  if (!isExtensionContextValid()) {
    window.removeEventListener("message", handleInjectedMessage);
    return;
  }

  // Respuesta de Target: payload completo con decisiones de personalización.
  // get→modificar→set — pasa por la cola (ver arriba): si Alloy dispara
  // varias respuestas juntas, es el caso más probable de perder decisions
  // por la misma carrera que perdía eventos de digitalData.
  if (event.data.type === "alloyResponse") {
    const payload = event.data.payload;
    if (!payload || typeof payload !== "object") return;
    if (jsonLength(payload) > MAX_ALLOY_PAYLOAD_CHARS) return;
    enqueueStorageTask(async () => {
      const data = await safeStorageGet("requests");
      const requests = data.requests || [];
      requests.unshift({
        payload,
        url: window.location.href,
        time: new Date().toISOString(),
      });
      try {
        await safeStorageSet({ requests: requests.slice(0, 50) });
      } catch (e) {
        // Cuota llena: se conserva solo lo más reciente en vez de dejar de capturar.
        await safeStorageSet({ requests: requests.slice(0, 5) });
      }
    });
  }

  // Mboxes encontrados en el DOM con atributo [data-mbox]. get→merge→set,
  // misma carrera potencial que arriba si domMboxes/decisionScopes llegan
  // casi juntos — ambos tocan la misma clave "domMboxes".
  if (event.data.type === "domMboxes") {
    const incoming = cleanNames(event.data.mboxes);
    if (incoming.length === 0) return;
    enqueueStorageTask(async () => {
      const data = await safeStorageGet("domMboxes");
      const merged = [...new Set([...(data.domMboxes || []), ...incoming])].slice(0, MAX_MBOXES);
      await safeStorageSet({ domMboxes: merged });
    });
  }

  // Scopes pedidos por la página al llamar alloy('sendEvent', { decisionScopes })
  // Se guardan junto a los domMboxes para cruzar qué scopes existen vs. cuáles respondió Target
  if (event.data.type === "decisionScopes") {
    const incoming = cleanNames(event.data.scopes).filter((s) => s !== "__view__");
    if (incoming.length === 0) return;
    enqueueStorageTask(async () => {
      const data = await safeStorageGet("domMboxes");
      const merged = [...new Set([...(data.domMboxes || []), ...incoming])].slice(0, MAX_MBOXES);
      await safeStorageSet({ domMboxes: merged });
    });
  }

  // Config de cada instancia de Alloy: orgId, datastream/edge config, edge
  // domain. Se guarda una LISTA, una entrada por nombre de instancia: hay
  // sitios con dos instancias (p. ej. "alloy" para analítica y otra para
  // Target, cada una con su datastream) y guardando un solo valor la última
  // en configurarse pisaba a la otra. get→merge→set: pasa por la cola, como
  // el resto (y así el reset de "cambio de página" tampoco la pisa con null).
  if (event.data.type === "instanceInfo") {
    const p = event.data.payload || {};
    const info = {
      namespace: shortString(p.namespace),
      orgId: shortString(p.orgId),
      edgeConfigId: shortString(p.edgeConfigId),
      edgeDomain: shortString(p.edgeDomain),
    };
    enqueueStorageTask(async () => {
      const data = await safeStorageGet("instanceInfo");
      // Valor viejo (un solo objeto, versiones anteriores) → lista de uno.
      const prev = Array.isArray(data.instanceInfo) ? data.instanceInfo : data.instanceInfo ? [data.instanceInfo] : [];
      const list = prev.filter((i) => i && i.namespace !== info.namespace).concat(info).slice(-10);
      await safeStorageSet({ instanceInfo: list });
    });
  }

  // Push crudo a window.digitalData (Adobe Client Data Layer), capturado
  // antes de que Launch lo procese — ver hookPushProperty en inject.js.
  // pageUrl queda fijo en la página donde disparó, aunque digitalDataEvents
  // persista más allá de esa página (ver detección de cambio de página
  // arriba). get→modificar→set — la carrera original reportada.
  if (event.data.type === "digitalDataPush") {
    // Un timestamp inválido hacía tirar a toISOString() y el evento se perdía.
    const ts = Number.isFinite(event.data.timestamp) ? event.data.timestamp : Date.now();
    const size = jsonLength(event.data.payload);
    const entry = {
      // Un payload enorme (o no serializable) se reemplaza por un aviso en
      // vez de ocupar la cuota que comparten los 500 eventos del recorrido.
      payload:
        size <= MAX_EVENT_PAYLOAD_CHARS
          ? event.data.payload
          : { event: shortString(event.data.payload?.event), _omitido: `payload de ${size} caracteres, no se guardó` },
      time: new Date(ts).toISOString(),
      timeSincePageLoad: Number.isFinite(event.data.timeSincePageLoad) ? event.data.timeSincePageLoad : null,
      pageUrl: window.location.href,
      // Capa de datos de origen (inject.js escucha digitalData y adobeDataLayer).
      // Solo se aceptan esos dos nombres; cualquier otro valor se descarta.
      layer: event.data.layer === "adobeDataLayer" ? "adobeDataLayer" : "digitalData",
    };
    enqueueStorageTask(async () => {
      const data = await safeStorageGet("digitalDataEvents");
      const events = data.digitalDataEvents || [];
      events.unshift(entry);
      await safeStorageSet({ digitalDataEvents: events.slice(0, MAX_DIGITAL_DATA_EVENTS) });
    });
  }

  // Ciclo de renderizado y prehiding de Alloy (onContentRendering /
  // onContentHiding en inject.js). Solo estados conocidos; se guardan en
  // orden de llegada (el popup los recorre en ese orden para saber cuál
  // terminó cómo). Foto de la página actual: se limpia al cambiar de página.
  if (event.data.type === "renderEvent") {
    if (!RENDER_STATUSES.has(event.data.status)) return;
    const entry = {
      status: event.data.status,
      instance: shortString(event.data.instance),
      scope: shortString(event.data.scope),
      activityIds: cleanNames(event.data.activityIds),
      error: shortString(event.data.error),
      t: Number.isFinite(event.data.t) ? event.data.t : null,
    };
    enqueueStorageTask(async () => {
      const data = await safeStorageGet("renderEvents");
      const list = (data.renderEvents || []).concat(entry).slice(-MAX_RENDER_EVENTS);
      await safeStorageSet({ renderEvents: list });
    });
  }

  // Propiedad de Launch cargada en la página (nombre, entorno, build).
  if (event.data.type === "launchInfo") {
    const p = event.data.payload || {};
    const info = {
      propertyName: shortString(p.propertyName),
      propertyId: shortString(p.propertyId),
      environment: shortString(p.environment),
      environmentId: shortString(p.environmentId),
      buildDate: shortString(p.buildDate),
      turbineVersion: shortString(p.turbineVersion),
    };
    enqueueStorageTask(() => safeStorageSet({ launchInfo: info }));
  }

  // Tanda de reglas de Launch (completadas o con condición no cumplida). Se
  // agregan por regla + resultado: la misma regla de scroll puede dispararse
  // decenas de veces y guardar cada una llenaba la lista de duplicados.
  if (event.data.type === "launchRules") {
    if (!Array.isArray(event.data.rules)) return;
    const incoming = event.data.rules
      .slice(0, MAX_RULES_PER_MESSAGE)
      .filter((r) => r && (r.status === "completed" || r.status === "failed"))
      .map((r) => {
        const c = r.condition && typeof r.condition === "object" ? r.condition : null;
        return {
          status: r.status,
          ruleId: shortString(r.ruleId),
          ruleName: shortString(r.ruleName),
          condition: c
            ? {
                extension: shortString(c.extension),
                kind: shortString(c.kind),
                detail: shortString(c.detail),
                negate: c.negate === true,
                code: typeof c.code === "string" && c.code ? c.code.slice(0, MAX_CONDITION_CODE) : undefined,
                codeTruncated: typeof c.code === "string" && c.code.length > MAX_CONDITION_CODE,
              }
            : null,
          actions: Array.isArray(r.actions)
            ? r.actions.slice(0, MAX_ACTIONS_PER_RULE).map(cleanAction).filter(Boolean)
            : null,
          t: Number.isFinite(r.t) ? r.t : null,
        };
      })
      .filter((r) => r.ruleId || r.ruleName);
    if (incoming.length === 0) return;
    enqueueStorageTask(async () => {
      const data = await safeStorageGet("launchRules");
      const list = data.launchRules || [];
      incoming.forEach((r) => {
        const key = `${r.ruleId || r.ruleName}|${r.status}`;
        let entry = list.find((x) => x.key === key);
        if (!entry) {
          if (list.length >= MAX_LAUNCH_RULES) return;
          entry = { key, status: r.status, ruleId: r.ruleId, ruleName: r.ruleName, count: 0, firstT: r.t, lastT: r.t, conditions: [] };
          list.push(entry);
        }
        entry.count += 1;
        entry.lastT = r.t;
        if (r.actions && !entry.actions) entry.actions = r.actions;
        if (r.condition && entry.conditions.length < MAX_CONDITIONS_PER_RULE) {
          // El código cuenta: dos customCode de la misma regla tienen el mismo
          // extension/kind/detail vacío y solo se distinguen por el código.
          const same = (c) =>
            c.extension === r.condition.extension &&
            c.kind === r.condition.kind &&
            c.detail === r.condition.detail &&
            c.negate === r.condition.negate &&
            c.code === r.condition.code;
          if (!entry.conditions.some(same)) entry.conditions.push(r.condition);
        }
      });
      await safeStorageSet({ launchRules: list });
    });
  }
}

window.addEventListener("message", handleInjectedMessage);

} // fin guard __mboxInspectorContentActive
