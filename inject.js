// Todo el archivo va dentro de una función que se ejecuta una sola vez: este
// script corre en world: MAIN (el mismo contexto JS que la página), y sin esta
// envoltura cada `function` y `const` de nivel superior quedaba como variable
// global de la página (window.interceptAlloy, window.scanDomMboxes, …), con
// riesgo de pisar o ser pisada por una función del sitio con el mismo nombre.
// Lo único que se expone a propósito es el guard window.__mboxInspectorInjected
// (más los hooks que la página ya espera: __alloyMonitors, los accessors de la
// capa de datos y el de window._satellite — ver secciones 1, 4 y 5).
(() => {

// ── 0. Guard de idempotencia ──────────────────────────────────────────────────
// Permite reinyectar este script a demanda (botón "Capturar ahora" del popup,
// vía chrome.scripting.executeScript) en una pestaña que ya estaba abierta
// antes de recargar la extensión, sin duplicar el hook de Alloy ni el
// MutationObserver si el script ya corre en esta página.
if (window.__mboxInspectorInjected) return;
window.__mboxInspectorInjected = true;

// ── 1. Alloy Monitors ────────────────────────────────────────────────────────
// Alloy expone window.__alloyMonitors para interceptar su ciclo de red.
// Este script corre en world: MAIN (mismo contexto que la página), por eso
// puede leer y modificar window.alloy antes de que la página lo use.
//
// Si la página tiene un __alloyMonitors que no es array, el .push() tiraba
// DESPUÉS de haber marcado el guard de arriba, y todo "Capturar ahora"
// posterior quedaba en no-op para siempre. Ahora ese caso deshace el guard
// (para que un reintento pueda volver a probar) y el resto de inject.js
// —DOM y capa de datos— sigue corriendo igual.
try {
  if (window.__alloyMonitors !== undefined && !Array.isArray(window.__alloyMonitors)) {
    throw new Error("__alloyMonitors no es un array");
  }
  window.__alloyMonitors = window.__alloyMonitors || [];
  window.__alloyMonitors.push({
    // Se ejecuta cada vez que Alloy recibe una respuesta de la red de Adobe Edge.
    // data.parsedBody contiene el payload completo con las decisiones de personalización.
    onNetworkResponse(data) {
      window.postMessage({ source: 'mbox-inspector', type: 'alloyResponse', payload: data.parsedBody }, '*');
    },
    // Se ejecuta una vez por instancia de Alloy configurada (alloy('configure', {...})).
    // Da orgId, datastream/edge config y dominio de Edge — sirve para confirmar
    // que la página está apuntando al datastream correcto (patrón tomado de
    // alloyHooks.js de Adobe Experience Platform Debugger).
    onInstanceConfigured(data) {
      window.postMessage({
        source: 'mbox-inspector',
        type: 'instanceInfo',
        payload: {
          namespace: data.instanceName,
          orgId: data.config?.orgId,
          edgeConfigId: data.config?.datastreamId ?? data.config?.edgeConfigId,
          edgeDomain: data.config?.edgeDomain,
        },
      }, '*');
    },
    // Ciclo de renderizado de las propuestas que Alloy aplica solo
    // (renderDecisions: true). Medido en sitios reales:
    //   - "rendering-started": payload { scope, propositions } → lo que va a aplicar.
    //   - "rendering-succeeded": payload { <scope>: [propuestas aplicadas] }.
    //   - "rendering-failed" / "no-offers" / "rendering-redirect".
    // Solo se reenvían los IDs de actividad (el contenido de las ofertas ya
    // llega completo por onNetworkResponse). Así Actividades puede decir si
    // cada actividad se pintó de verdad, no solo si Target respondió.
    onContentRendering(data) {
      const p = (data && data.payload) || {};
      const idsOf = (list) => (Array.isArray(list) ? list : [])
        .map((prop) => prop && prop.scopeDetails && prop.scopeDetails.activity && prop.scopeDetails.activity.id)
        .filter((id) => id !== undefined && id !== null)
        .map(String);
      const activityIds = Array.isArray(p.propositions)
        ? idsOf(p.propositions)
        : Object.values(p).flatMap(idsOf);
      const err = data.error || p.error;
      window.postMessage({
        source: 'mbox-inspector',
        type: 'renderEvent',
        status: data.status,
        instance: data.instanceName,
        scope: typeof p.scope === 'string' ? p.scope : undefined,
        activityIds,
        error: err ? String(err.message || err) : undefined,
        t: window.performance ? window.performance.now() : null,
      }, '*');
    },
    // Prehiding: Alloy oculta contenedores mientras espera a Target
    // ("hide-containers") y los vuelve a mostrar ("show-containers"). La
    // diferencia entre los dos es el tiempo que el usuario vio la página tapada.
    onContentHiding(data) {
      window.postMessage({
        source: 'mbox-inspector',
        type: 'renderEvent',
        status: data && data.status,
        instance: data && data.instanceName,
        activityIds: [],
        t: window.performance ? window.performance.now() : null,
      }, '*');
    },
  });
} catch (e) {
  window.__mboxInspectorInjected = false;
}

// ── 2. Interceptar las instancias de Alloy para capturar decisionScopes ──────
// Envuelve cada función de instancia de Alloy para leer los decisionScopes
// antes de que el SDK los envíe a Adobe Edge. Esto permite saber qué
// mboxes/scopes pidió la página, aunque Target no les responda con contenido.
//
// - Instancias: no solo window.alloy. El nombre de la instancia es
//   configurable y Alloy registra todos los que existen en window.__alloyNS
//   (p. ej. ["alloy"] o ["miInstancia"]); se interceptan todos.
// - Proxy en vez de una función nueva: el snippet base de Alloy define
//   window.alloy como una cola con una propiedad .q que la librería lee al
//   cargar. Una función envoltorio no tenía .q, y en sitios con ese snippet
//   los comandos encolados se perdían. El Proxy reenvía todas las
//   propiedades (lectura y escritura) a la función original y solo
//   intercepta la llamada.
// - Se sigue revisando durante 30s (antes eran 10s y se cortaba en la
//   primera instancia): la librería reemplaza la función de cola por la real
//   al terminar de cargar, y ese reemplazo hay que volver a envolverlo.
const interceptedAlloy = new WeakSet();

function reportDecisionScopes(command, options) {
  if (command !== 'sendEvent' || !options) return;
  // `decisionScopes` es la forma original; las versiones nuevas de Web SDK
  // usan `personalization.decisionScopes`. Se reportan las dos.
  const scopes = [
    ...(Array.isArray(options.decisionScopes) ? options.decisionScopes : []),
    ...(Array.isArray(options.personalization?.decisionScopes) ? options.personalization.decisionScopes : []),
  ];
  if (scopes.length > 0) {
    window.postMessage({ source: 'mbox-inspector', type: 'decisionScopes', scopes }, '*');
  }
}

function interceptAlloyInstances() {
  const names = new Set(['alloy', ...(Array.isArray(window.__alloyNS) ? window.__alloyNS : [])]);
  names.forEach((name) => {
    if (typeof name !== 'string') return;
    const fn = window[name];
    if (typeof fn !== 'function' || interceptedAlloy.has(fn)) return;
    try {
      const proxied = new Proxy(fn, {
        apply(target, thisArg, args) {
          try {
            reportDecisionScopes(args[0], args[1]);
          } catch (e) {
            // nunca dejar que un fallo de captura afecte la llamada real
          }
          return Reflect.apply(target, thisArg, args);
        },
      });
      interceptedAlloy.add(proxied);
      window[name] = proxied;
    } catch (e) {
      // La propiedad no se puede reasignar — no capturamos decisionScopes de esta instancia.
    }
  });
}

// Intento inmediato (si Alloy ya cargó antes que este script) y después
// revisión cada 100ms durante 30s.
try {
  interceptAlloyInstances();
} catch (e) {
  // Se reintenta en el polling de abajo.
}
const alloyPoll = setInterval(() => {
  try {
    interceptAlloyInstances();
  } catch (e) {
    // un fallo puntual no corta el polling
  }
}, 100);
setTimeout(() => clearInterval(alloyPoll), 30000);

// ── 3. Escanear atributos data-mbox del DOM ───────────────────────────────────
// Busca elementos con [data-mbox] para reportar qué mboxes existen en la página,
// independientemente de si Target les asignó una actividad o no.
function scanDomMboxes() {
  const nodes  = document.querySelectorAll('[data-mbox]');
  const mboxes = [...new Set([...nodes].map(n => n.getAttribute('data-mbox')).filter(Boolean))];
  if (mboxes.length > 0) window.postMessage({ source: 'mbox-inspector', type: 'domMboxes', mboxes }, '*');
}

// Primer escaneo al cargar el DOM
try {
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', scanDomMboxes); }
  else { scanDomMboxes(); }
} catch (e) {
  // El escaneo falló — el resto de la captura sigue igual.
}

// Re-escaneo con debounce cuando el DOM cambia (SPAs que renderizan dinámicamente).
// Debounce de 200ms con espera máxima de 1s: con un debounce puro, una página
// que muta el DOM más seguido que cada 200ms (carruseles, contadores)
// posponía el escaneo indefinidamente y un [data-mbox] nuevo nunca se reportaba.
//
// Se observa `document` y no `document.documentElement`: en document_start el
// <html> puede no existir todavía, y observe(null) tiraba un error que cortaba
// el resto de inject.js (la captura de la capa de datos, abajo). Por la misma
// razón todo el bloque va en su propio try/catch.
const SCAN_DEBOUNCE_MS = 200;
const SCAN_MAX_WAIT_MS = 1000;
let scanTimer = null;
let scanPendingSince = 0;
try {
  const observer = new MutationObserver(() => {
    const now = Date.now();
    if (!scanPendingSince) scanPendingSince = now;
    clearTimeout(scanTimer);
    const wait = now - scanPendingSince >= SCAN_MAX_WAIT_MS ? 0 : SCAN_DEBOUNCE_MS;
    scanTimer = setTimeout(() => {
      scanPendingSince = 0;
      scanDomMboxes();
    }, wait);
  });
  observer.observe(document, { childList: true, subtree: true });
} catch (e) {
  // Sin observer: solo queda el escaneo inicial de [data-mbox].
}

// ── 4. Capturar pushes a la capa de datos (eventos crudos de tracking) ───────
// Se escuchan las dos capas de datos habituales:
//   - window.digitalData: el nombre que usan las offers de Target
//     (`window.digitalData = window.digitalData || []; window.digitalData.push({...})`).
//   - window.adobeDataLayer: el nombre por defecto de Adobe Client Data Layer
//     (ACDL) — el que usan la mayoría de los sitios con Adobe Launch. Antes
//     solo se escuchaba digitalData y en esos sitios Eventos quedaba vacía.
// Cada push lleva el nombre de la capa de donde salió (`layer`).
//
// Cualquiera de las dos puede ser una instancia de ACDL: tiene .push/.getState/
// .addEventListener propios, no es un array plano. ACDL se inicializa async
// (vía Launch) y en ese momento pisa `.push` con su propia función — si solo
// envolviéramos `.push` una vez, ese pisado posterior de ACDL borraría
// nuestro hook sin avisar. Por eso hookeamos en dos capas:
//   A) un accessor en window.<capa> → detecta cuando se (re)asigna el
//      array completo (pasa una sola vez, al inicializar ACDL).
//   B) un accessor en la propiedad .push de ESE array → detecta tanto los
//      pushes de las offers como el momento en que ACDL reemplaza .push,
//      y envuelve esa nueva función en vez de perder el hook.
// Corre en document_start, antes que cualquier script de la página, así que
// llegamos siempre primero sin importar si la capa ya existe o no.
//
// Es exclusivamente observacional: nunca se altera el array real, nunca se
// atrapan errores de la llamada real (si la offer o ACDL tiran, deben seguir
// tirando igual que sin esta extensión), y cada capa se instrumenta en su
// propio try/catch — si algo falla, se degrada a "no capturamos eventos de
// esa capa" sin tocar el resto de inject.js ni el comportamiento de la página.
const DATA_LAYER_NAMES = ["digitalData", "adobeDataLayer"];

function reportPush(layer, payload) {
  try {
    window.postMessage({
      source: "mbox-inspector",
      type: "digitalDataPush",
      layer,
      payload,
      timestamp: Date.now(),
      timeSincePageLoad: window.performance ? window.performance.now() : null,
    }, "*");
  } catch (e) {
    // nunca dejar que un fallo de captura afecte la página
  }
}

function wrapPush(realPush, layer) {
  if (typeof realPush !== "function" || realPush.__mboxWrapped) return realPush;
  const wrapped = function (...args) {
    // push() sin argumentos no agrega nada a la capa (visto en sitios reales):
    // no se reporta, solo ensuciaba Eventos con entradas vacías.
    if (args.length > 0) reportPush(layer, args.length === 1 ? args[0] : args);
    return realPush.apply(this, args);
  };
  wrapped.__mboxWrapped = true;
  return wrapped;
}

function hookPushProperty(arr, layer) {
  if (!arr || typeof arr !== "object" || arr.__mboxPushHooked) return;
  // Solo arrays o capas que ya tienen su propio push (ACDL). Hay sitios que
  // usan digitalData como un objeto plano (estilo W3C: { page, user, … });
  // antes se le agregaba una propiedad push que la página no tenía, lo que
  // modificaba un objeto ajeno. Esos objetos no se tocan.
  if (!Array.isArray(arr) && typeof arr.push !== "function") return;
  // Lo que la capa ya trae al engancharla (p. ej. `window.adobeDataLayer =
  // [{ event: "pageLoad", … }]`) nunca pasa por push: se reporta una vez acá.
  // Solo la primera vez — si la página reasigna el mismo array, el guard de
  // arriba evita duplicarlo.
  if (Array.isArray(arr)) arr.forEach((item) => reportPush(layer, item));
  try {
    let current = wrapPush(typeof arr.push === "function" ? arr.push : Array.prototype.push, layer);
    Object.defineProperty(arr, "push", {
      configurable: true,
      enumerable: false,
      get() { return current; },
      set(fn) { current = wrapPush(fn, layer); },
    });
    Object.defineProperty(arr, "__mboxPushHooked", { value: true, enumerable: false });
  } catch (e) {
    // La capa no permitió instrumentar .push (p. ej. no configurable) — no capturamos.
  }
}

DATA_LAYER_NAMES.forEach((name) => {
  try {
    let currentDL = window[name];
    if (currentDL) hookPushProperty(currentDL, name);

    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: true,
      get() { return currentDL; },
      set(value) {
        currentDL = value;
        hookPushProperty(currentDL, name);
      },
    });
  } catch (e) {
    // window.<capa> no se pudo instrumentar — la extensión sigue funcionando
    // normalmente, solo sin los eventos de esa capa.
  }
});

// ── 5. Adobe Launch (Tags / Data Collection): propiedad y reglas ─────────────
// Turbine (el motor de Launch) avisa a los objetos de window._satellite._monitors
// cada vez que una regla se dispara, se completa o no cumple una condición —
// el mismo mecanismo que usa el Debugger oficial de Adobe.
//
// No se crea window._satellite antes de tiempo (el patrón que documenta Adobe
// es `window._satellite = window._satellite || {}`): hay sitios que hacen
// `if (window._satellite) _satellite.track(...)` antes de que cargue Launch, y
// un objeto vacío los haría tirar. En su lugar, un accessor en
// window._satellite engancha el monitor en el momento en que la librería de
// Launch asigna su objeto (lo mismo que se hace con la capa de datos).
//
// Las reglas se juntan y se mandan en tandas cada 300ms: una carga normal
// dispara entre 50 y 300 reglas, y un postMessage por regla era una escritura
// a storage por regla.
const LAUNCH_FLUSH_MS = 300;
let launchBuffer = [];
let launchFlushTimer = null;
let launchInfoSent = false;
let currentSatellite;

// Tope del código/configuración que viaja por condición (content.js vuelve a
// recortar al guardar). Evita mensajes enormes si una condición trae un blob.
const MAX_CONDITION_CODE_CHARS = 20000;

/**
 * Lo que una persona necesita para entender por qué no se cumplió: en
 * customCode, el código de la condición (Turbine lo guarda como función en
 * settings.source — o como string en algunas builds); en el resto, la
 * configuración completa en JSON (operandos, regex, valores de cookie…).
 * Es el mismo código que la página ya sirve en su librería de Launch.
 */
function conditionCode(kind, settings) {
  try {
    let code;
    if (kind === 'customCode') {
      const src = settings.source;
      code = typeof src === 'function' ? String(src) : typeof src === 'string' ? src : '';
    } else {
      code = JSON.stringify(settings, (k, v) => (typeof v === 'function' ? String(v) : v), 2) || '';
    }
    return code === '{}' ? '' : code.slice(0, MAX_CONDITION_CODE_CHARS);
  } catch (e) {
    return '';
  }
}

/**
 * "core/src/lib/conditions/cookie.js" → { extension: "core", kind: "cookie" }.
 * Las extensiones compiladas usan carpeta + index.js
 * ("adobe-alloy/dist/lib/actions/sendEvent/index.js"): ahí el tipo es la carpeta.
 */
function moduleName(modulePath) {
  const parts = modulePath.split('/');
  let file = parts[parts.length - 1];
  if (file === 'index.js' && parts.length > 1) file = parts[parts.length - 2];
  return { extension: parts[0], kind: file.replace(/\.js$/, '') };
}

/** Resumen de una condición fallida: extensión, tipo, el dato que la explica y su código/configuración. */
function summarizeCondition(condition) {
  if (!condition || typeof condition.modulePath !== 'string') return undefined;
  const { extension, kind } = moduleName(condition.modulePath);
  const s = condition.settings || {};
  let detail = '';
  try {
    if (kind === 'cookie') detail = String(s.name || '');
    else if (kind === 'path' || kind === 'pathAndQuerystring') {
      detail = (Array.isArray(s.paths) ? s.paths : []).map((x) => x && x.value).filter(Boolean).join(', ');
    } else if (kind === 'valueComparison') {
      detail = `${s.leftOperand} ${(s.comparison && s.comparison.operator) || '?'} ${s.rightOperand}`;
    } else if (kind === 'queryStringParameter') {
      detail = String(s.name || '');
    }
  } catch (e) {
    detail = '';
  }
  return { extension, kind, detail, negate: !!condition.negate, code: conditionCode(kind, s) };
}

/**
 * Acción de una regla completada: módulo, lenguaje (customCode: javascript/
 * html) y su código o configuración. Un customCode "externo" tiene en
 * settings.source la URL del archivo hasta que Launch lo descarga (después
 * pasa a ser el código): en ese caso se manda la URL en vez de código.
 */
function summarizeAction(action) {
  if (!action || typeof action.modulePath !== 'string') return undefined;
  const { extension, kind } = moduleName(action.modulePath);
  const s = action.settings || {};
  const src = s.source;
  const externalUrl =
    kind === 'customCode' && s.isExternal && typeof src === 'string' && /^https?:\/\//.test(src) ? src : undefined;
  return {
    extension,
    kind,
    language: kind === 'customCode' && typeof s.language === 'string' ? s.language : undefined,
    externalUrl,
    code: externalUrl ? '' : conditionCode(kind, s),
  };
}

// Las acciones se mandan UNA vez por regla: el código no cambia entre
// disparos y hay acciones de ~90KB (medido en bbva.pe) — una regla de scroll
// mandaba ese bloque en cada evento.
const launchActionsSent = new Set();

function postLaunchInfo() {
  const s = currentSatellite;
  if (launchInfoSent || !s || !s.buildInfo) return;
  launchInfoSent = true;
  try {
    window.postMessage({
      source: 'mbox-inspector',
      type: 'launchInfo',
      payload: {
        propertyName: s.property && s.property.name,
        propertyId: s.property && s.property.id,
        environment: s.environment && s.environment.stage,
        environmentId: s.environment && s.environment.id,
        buildDate: s.buildInfo.buildDate,
        turbineVersion: s.buildInfo.turbineVersion,
      },
    }, '*');
  } catch (e) {
    launchInfoSent = false;
  }
}

function flushLaunchRules() {
  launchFlushTimer = null;
  postLaunchInfo();
  if (launchBuffer.length === 0) return;
  const rules = launchBuffer;
  launchBuffer = [];
  try {
    window.postMessage({ source: 'mbox-inspector', type: 'launchRules', rules }, '*');
  } catch (e) {
    // nunca dejar que un fallo de captura afecte la página
  }
}

function queueLaunchRule(status, event) {
  try {
    const rule = (event && event.rule) || {};
    const actionsKey = rule.id || rule.name;
    let actions;
    if (status === 'completed' && actionsKey && !launchActionsSent.has(actionsKey) && Array.isArray(rule.actions)) {
      launchActionsSent.add(actionsKey);
      actions = rule.actions.map(summarizeAction).filter(Boolean);
    }
    launchBuffer.push({
      status,
      ruleId: rule.id,
      ruleName: rule.name,
      condition: status === 'failed' ? summarizeCondition(event.condition) : undefined,
      actions,
      t: window.performance ? window.performance.now() : null,
    });
    if (!launchFlushTimer) launchFlushTimer = setTimeout(flushLaunchRules, LAUNCH_FLUSH_MS);
  } catch (e) {
    // un evento raro de Turbine no corta la captura del resto
  }
}

const launchMonitor = {
  ruleCompleted(event) { queueLaunchRule('completed', event); },
  ruleConditionFailed(event) { queueLaunchRule('failed', event); },
};

function attachLaunchMonitor(satellite) {
  if (!satellite || typeof satellite !== 'object') return;
  try {
    if (!Array.isArray(satellite._monitors)) satellite._monitors = [];
    if (!satellite._monitors.includes(launchMonitor)) satellite._monitors.push(launchMonitor);
  } catch (e) {
    // _satellite no admite el monitor — sin reglas de Launch, el resto sigue.
  }
}

try {
  currentSatellite = window._satellite;
  attachLaunchMonitor(currentSatellite);
  Object.defineProperty(window, '_satellite', {
    configurable: true,
    enumerable: true,
    get() { return currentSatellite; },
    set(value) {
      currentSatellite = value;
      attachLaunchMonitor(value);
    },
  });
} catch (e) {
  // window._satellite no se pudo instrumentar (p. ej. no configurable): si ya
  // existe, el monitor quedó enganchado arriba; si no, no hay reglas de Launch.
}

// buildInfo/property/environment los completa la librería después de asignar
// el objeto, así que se revisan hasta encontrarlos (máx. 30s, como Alloy).
const launchInfoPoll = setInterval(() => {
  postLaunchInfo();
  if (launchInfoSent) clearInterval(launchInfoPoll);
}, 500);
setTimeout(() => clearInterval(launchInfoPoll), 30000);

})();
