// Todo el archivo va dentro de una función que se ejecuta una sola vez: este
// script corre en world: MAIN (el mismo contexto JS que la página), y sin esta
// envoltura cada `function` y `const` de nivel superior quedaba como variable
// global de la página (window.interceptAlloy, window.scanDomMboxes, …), con
// riesgo de pisar o ser pisada por una función del sitio con el mismo nombre.
// Lo único que se expone a propósito es el guard window.__mboxInspectorInjected.
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
    reportPush(layer, args.length === 1 ? args[0] : args);
    return realPush.apply(this, args);
  };
  wrapped.__mboxWrapped = true;
  return wrapped;
}

function hookPushProperty(arr, layer) {
  if (!arr || typeof arr !== "object" || arr.__mboxPushHooked) return;
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

})();
