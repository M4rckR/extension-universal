# Target Inspector

Extensión de Chrome (Manifest V3) que intercepta y visualiza en tiempo real las actividades de **Adobe Target / Alloy SDK** y los eventos de **tracking (`window.digitalData` y `window.adobeDataLayer`)** activos en la página actual. Funciona en **cualquier sitio** que use Adobe Web SDK (Alloy), no en un dominio específico. La captura es puramente observacional: no altera el data layer, no escribe cookies ni recarga la página.

---

## ¿Qué hace?

Cuando Target responde a una llamada de personalización, o la página hace `push(...)` a su capa de datos (`window.digitalData` o `window.adobeDataLayer`), la extensión captura el dato completo y lo muestra en una ventana independiente con tres vistas:

| Pestaña | Qué muestra |
| --- | --- |
| **Actividades** | Lista de actividades A/B y XT que Target activó, con nombre, ID, experiencia asignada y link directo a la UI de Adobe Target (el link aparece solo si configuraste el tenant en el footer — ver abajo). Cada actividad es **expandible**: si la decisión trae una offer `dom-action`, muestra `type`/`format`/`selector`/`prehidingSelector`/tamaño, un preview truncado del `content` (HTML/JS que la offer inserta), y un botón **Copiar completo** para pegar el contenido íntegro en un editor. Un click en el `#ID` de la actividad lo copia |
| **mBoxes** | Todos los mboxes encontrados en la página, clasificados en *En uso* (Target respondió), *Libres* (existen en el DOM pero sin actividad asignada) y *Solo Alloy* (respondidos por Target pero sin elemento DOM con `data-mbox`), con una línea de resumen arriba que suma los tres. `__view__` (el scope del VEC) queda fuera de esta clasificación a propósito — en páginas 100% VEC (sin ningún mbox nombrado) esta pestaña avisa explícitamente que no hay mboxes en vez de sugerir que falta recargar |
| **Eventos** | Pushes crudos a `window.digitalData` y `window.adobeDataLayer` (la capa de datos de Adobe, ACDL) capturados en vivo — la capa de tracking *antes* de que Adobe Launch los procese. A diferencia de Actividades/mBoxes, **persiste a través de la navegación**: cada evento queda etiquetado con la página donde disparó, agrupados en secciones colapsables por página para poder recorrer el sitio y revisar después dónde disparó cada cosa. Dentro de cada página, eventos consecutivos del mismo tipo (p. ej. varios `trackScroll` seguidos) se colapsan en una fila `[nombre · N]` expandible; chips arriba de la lista filtran por nombre de evento en todo el recorrido, y un buscador filtra por texto (nombre, cualquier valor del payload o la página). Cada payload tiene **Copiar payload** |

También hay un footer con el `orgId`/`edgeConfigId` de la instancia de Alloy activa en la página, para confirmar que apunta al datastream correcto, y un campo para configurar el **tenant de Adobe Target**.

---

## Dónde funciona

La extensión se inyecta en **cualquier página http/https** (`*://*/*`). En páginas internas del navegador (`chrome://`, `about:`, etc.), donde Chrome no permite inyectar content scripts, la ventana muestra un aviso de página no inspeccionable.

En sitios que **no** usan Adobe Target/Alloy simplemente no hay nada que capturar y las pestañas quedan vacías ("Sin datos aún").

### Tenant de Adobe Target

Los links "Abrir en Target ↗" de la pestaña Actividades apuntan al admin de Adobe (`experience.adobe.com/#/@<tenant>/...`). Como el `<tenant>` (el slug de la organización en esa URL) cambia por organización y **no** es derivable del payload capturado, se configura manualmente en el input **Tenant Target** del footer:

- El valor se guarda en `chrome.storage.local` (clave `tenant`) y persiste entre sesiones.
- **Vacío** → no se muestran los deep-links; la extensión sigue siendo 100% funcional para inspección, solo sin el enlace directo al admin.
- Ojo: el tenant **no** es el `orgId` — es el slug que ves en la URL cuando abrís tu organización en `experience.adobe.com`.

---

## Instalación

1. Descarga o clona este repositorio.
2. Abre Chrome y ve a `chrome://extensions/`.
3. Activa **Modo desarrollador** (esquina superior derecha).
4. Haz clic en **Cargar descomprimida** y selecciona la carpeta del proyecto.
5. La extensión aparecerá en la barra de herramientas con su icono.

> No requiere ninguna dependencia ni paso de build. Es HTML/CSS/JS puro.

---

## Uso

1. Abre una pestaña en cualquier sitio con Adobe Target/Alloy.
2. **Recarga la página** con la extensión activa (importante: la captura ocurre al cargar).
3. Hacé clic en el icono de la barra de herramientas — abre una ventana independiente apuntada a esa pestaña.
4. Navega entre las pestañas **Actividades**, **mBoxes** y **Eventos** (también con las flechas del teclado).
5. Usa **Limpiar** para resetear todo lo capturado (incluidos los eventos del recorrido) y volver a capturar. Durante unos segundos aparece **Deshacer** por si fue un click accidental.

### Ventana independiente

No hay popup clásico — la extensión no tiene `default_popup`, así que el icono de la barra de herramientas siempre abre (o enfoca, si ya hay una) una ventana propia que se queda abierta y sigue mostrando datos en vivo, sin cerrarse al perder el foco. Si hacés clic en el icono con la ventana ya abierta, la enfoca en vez de crear una nueva.

Esa ventana sigue apuntando a la pestaña que estaba activa cuando la abriste, no a "la pestaña activa del navegador" en cada momento — si esa pestaña navega a otra URL, o si otra pestaña del mismo sitio pisa los datos compartidos (ver limitación abajo), la ventana muestra el aviso naranja de "Página distinta a la captura" en vez de datos desincronizados en silencio.

### Tips

- La ventana se actualiza en **tiempo real**: si Target o el data layer disparan más eventos después de la carga, los verás aparecer sin necesidad de reabrir nada.
- Si navegaste a otra ruta sin recargar, verás el aviso naranja de "Página distinta a la captura" en Actividades/mBoxes. Recarga para sincronizar esas dos — **Eventos no se ve afectado**, ese sigue acumulando a través de la navegación (ver "Datos que se almacenan").
- Si el tipo de actividad no se pudo detectar automáticamente (A/B o XT), la extensión muestra ambos botones como hipótesis para que puedas elegir.
- En "Eventos", los chips de filtro son efímeros: se resetean cada vez que reabrís la ventana, para que un chip apagado de una sesión anterior nunca te esconda un evento nuevo sin que te des cuenta. La sección de la página más reciente del recorrido arranca expandida; las anteriores, colapsadas.
- El preview de `content` en "Actividades" está truncado a propósito (40 líneas o 3000 caracteres, lo que ocurra primero) — para ver el contenido completo (HTML/JS grande de una offer), usá **Copiar completo** y pegalo en tu editor.
- Si una pestaña ya estaba abierta antes de instalar/recargar la extensión, no hace falta recargarla: el estado vacío de Actividades/mBoxes/Eventos tiene un botón **Capturar ahora** que reinyecta la captura sin perder lo que tenías abierto en esa pestaña.

---

## Arquitectura

Cuatro piezas que se comunican en cadena:

```text
Página web (cualquier sitio con Alloy)
  │
  ├─ window.__alloyMonitors  ──► inject.js  (world: MAIN, document_start)
  │    Intercepta respuestas de red de Alloy y llamadas a sendEvent de cada instancia (window.__alloyNS)
  │    Escanea atributos [data-mbox] en el DOM (+ MutationObserver para SPAs)
  │    Hookea .push de window.digitalData y window.adobeDataLayer (defineProperty en dos capas)
  │    Todo dentro de una función propia: no deja variables globales en la página
  │                         │
  │              window.postMessage({ source: 'mbox-inspector', ... })
  │                         │
  │                         ▼
  └─ content.js  (world: ISOLATED, document_start)
       Actúa como puente: escucha los mensajes y los persiste en storage
       (get→modificar→set serializado por una cola de promesas, ver abajo)
                         │
                chrome.storage.local
   { requests, domMboxes, digitalDataEvents, instanceInfo, tabUrl }
   requests/domMboxes/instanceInfo: se resetean al navegar a otra página.
   digitalDataEvents: NO — persiste a través de la navegación (pageUrl por evento).
                         │
                         ▼
                     popup.js  (popup.html, solo en ventana independiente)
          render()        → pestaña Actividades (+ contenido expandible)
          renderMboxes()  → pestaña mBoxes
          renderEventos() → pestaña Eventos (agrupada por página del recorrido)

background.js (service worker)
  chrome.action.onClicked crea o enfoca la ventana independiente (único
  entry point — no hay default_popup en el manifest); un click desde otra
  pestaña la reapunta a esa pestaña. Limpia el puntero
  {windowId, tabId, sourceTabId} de storage cuando se cierra la ventana
  del inspector.
```

### ¿Por qué dos scripts en la página?

- **`inject.js`** corre en `world: MAIN` (mismo contexto JS que la página), necesario para acceder a las instancias de Alloy, `window.__alloyMonitors` y las capas de datos antes de que la página los use.
- **`content.js`** corre en el mundo aislado de Chrome y es el único que puede usar `chrome.storage`. Actúa como puente entre ambos mundos vía `postMessage`.

### Captura de `push()` en la capa de datos (`digitalData` / `adobeDataLayer`)

En muchos sitios con Adobe Launch, `digitalData` es una instancia de **Adobe Client Data Layer (ACDL)**, no un array plano — tiene `.push`/`.getState`/`.addEventListener` propios, y ACDL se inicializa de forma asíncrona (vía Launch) reemplazando `.push` después de que la página carga. Por eso el hook es de **dos capas**, ambas con `Object.defineProperty` (nunca un `Proxy` recursivo genérico, no hace falta acá):

1. Un accessor en `window.digitalData` y en `window.adobeDataLayer` → detecta cuando se (re)asigna el array completo.
2. Un accessor en la propiedad `.push` de ese array → captura tanto los pushes de las offers como el momento en que ACDL reemplaza `.push`, envolviendo esa nueva función en vez de perder el hook.

Todo el bloque corre en `document_start` (antes que cualquier script de la página) y está envuelto en `try/catch`: si algo falla, se degrada a "no capturamos eventos" sin tocar el resto de `inject.js` ni el comportamiento real del data layer — es puramente observacional, nunca altera ni interrumpe la llamada real.

### Serialización de escrituras a `chrome.storage.local`

Todo handler de `content.js` que hace lectura-modificación-escritura (`get` → mergear/`unshift` → `set`) pasa por `enqueueStorageTask` (`content.js:83`), una cola de promesas encadenadas sobre una única `storageQueue` global — cada tarea (la unidad completa get→modificar→set) espera a que la anterior termine antes de arrancar.

**Por qué:** `chrome.storage.local.get` es asíncrono. Sin la cola, dos mensajes casi simultáneos leen el mismo array base y el `set()` que aterriza último pisa por completo al que aterrizó primero — determinístico, gana siempre el último en escribir. Reproducido y verificado con logs con timestamp: dos `digitalData.push()` seguidos (dos `trackPromotionClick` consecutivos) perdían siempre el primero.

**Afecta a:** `alloyResponse`, `domMboxes`, `decisionScopes`, `digitalDataPush`, y el reset de página al inicio del archivo — los cinco hacen get→modificar→set. `instanceInfo` es un `set()` puro, pero también pasa por la cola: si llegaba mientras el reset de página estaba pendiente, el reset lo pisaba con `null`.

**Esta carrera existía desde el día uno en `alloyResponse`** — en ráfagas de respuestas de Alloy (varias decisions llegando casi juntas) se podían perder decisions en silencio, mostrando de menos en la pestaña Actividades sin ningún aviso.

### Ventana independiente (`background.js`, único entry point)

El manifest no tiene `default_popup`, así que `chrome.action.onClicked` dispara en cada click del icono (esa API nunca dispara mientras haya `default_popup` configurado — por eso se sacó). `background.js` crea la ventana la primera vez (`chrome.windows.create`, apuntando a `popup.html?tabId=<pestaña activa>`) y la enfoca las siguientes (`chrome.windows.get`/`update`), guardando el puntero `{windowId, tabId, sourceTabId}` en storage (`windowId`/`tabId` son los de la propia ventana del inspector; `sourceTabId`, la pestaña inspeccionada). Si se hace click en el icono desde otra pestaña, la ventana existente pasa a inspeccionar esa pestaña. El puntero se limpia cuando se cierra la ventana del inspector — la ventana no puede hacer esa limpieza de forma confiable en su propio cierre.

`popup.html`/`popup.js` no cambiaron de rol: siguen siendo la UI, ahora montada exclusivamente dentro de esa ventana en vez de además servir como popup clásico.

> **Limitación conocida:** el storage no está particionado por pestaña. `requests`, `domMboxes`, `instanceInfo` y `tabUrl` son claves únicas y globales — si tenés dos pestañas del mismo sitio abiertas a la vez, se pisan datos entre sí durante esa página (mitigado por el aviso de "página distinta a la captura", que avisa en vez de mostrar datos desincronizados en silencio).
>
> `digitalDataEvents` tiene el mismo problema pero **más grave**, porque ahora persiste a través de la navegación: si dos pestañas del mismo sitio están abiertas mientras recorrés el sitio, sus eventos se entreveran en un solo timeline en vez de reflejar dos recorridos separados — no hay aviso para este caso, porque no hay un cambio de página que lo dispare. No resuelto todavía; requeriría que cada evento supiera su propio `tabId` (hoy no es trivial: un content script no conoce su `tabId` vía el canal `postMessage` que usa inject.js, haría falta un round-trip nuevo por `chrome.runtime.sendMessage` al service worker).

### Archivos

| Archivo | Rol |
| --- | --- |
| `manifest.json` | Configuración de la extensión (permisos, scripts, dominios, background) |
| `inject.js` | Captura respuestas de Alloy, intercepta `sendEvent` de cada instancia de Alloy y `push()` en `window.digitalData` / `window.adobeDataLayer` |
| `content.js` | Puente postMessage → chrome.storage; valida forma y tamaño de cada mensaje (cualquier script de la página puede postear el mismo formato) |
| `background.js` | Service worker: `chrome.action.onClicked` crea/enfoca la ventana independiente (único entry point), reapunta la ventana si se hace click desde otra pestaña, limpieza del puntero al cerrarse la ventana |
| `popup.html` | UI (estructura HTML + CSS con metodología BEM), montada solo dentro de la ventana independiente |
| `assets/fonts/` | IBM Plex Sans/Mono empaquetadas (licencia OFL en `LICENSE.txt`): la ventana no hace pedidos externos |
| `popup.js` | Lógica: renderizado de las 3 pestañas, tabs, live update |

---

## Alcance de dominios

No hace falta configurar dominios: la extensión ya se inyecta en todo sitio http/https (`*://*/*` en `host_permissions` y en los dos bloques `matches` de `content_scripts`). No hay lista de dominios permitidos en `popup.js` — `isAllowedDomain` solo descarta páginas internas del navegador (`chrome://`, `about:`, etc.).

> **Nota de permisos:** inyectar en `*://*/*` corre `inject.js` (world MAIN) en **todos** los sitios, incluidos bancarios/transaccionales. Es un footprint amplio a propósito: la extensión existe justamente para funcionar en cualquier página. La captura es puramente observacional: nunca escribe cookies ni recarga la página.

---

## Datos que se almacenan

Todo se guarda localmente en `chrome.storage.local` (solo en tu navegador, nunca sale del equipo):

| Clave | Contenido | Límite | ¿Sobrevive a navegar de página? |
| --- | --- | --- | --- |
| `requests` | Últimas respuestas de Target (payload completo + URL + timestamp) | 50 entradas | No — foto del estado actual |
| `domMboxes` | Nombres de mboxes encontrados en el DOM o pedidos vía `decisionScopes` | 500 nombres | No — foto del estado actual |
| `digitalDataEvents` | Pushes crudos a `window.digitalData` / `window.adobeDataLayer` (payload + timestamp + tiempo desde carga + `pageUrl` de origen + `layer`) | 500 entradas | **Sí** — es un recorrido, no una foto (ver el porqué del límite abajo) |
| `instanceInfo` | orgId/edgeConfigId/edgeDomain de la instancia de Alloy activa | — | No |
| `inspectorWindow` | Puntero `{windowId, tabId, sourceTabId}` de la ventana independiente abierta, si hay una | — | — |
| `tabUrl` | URL de la última página capturada (para detectar cambios de página) | — | — |
| `tenant` | Slug del tenant de Adobe Target configurado en el footer (para los deep-links) | — | Sí — es config del usuario, no de la página |

`digitalDataEvents` usa 500 como límite porque, a diferencia de `requests`/`domMboxes`, tiene que cubrir un recorrido completo por el sitio en vez de una sola página: medido en vivo, un push típico (`trackScroll`/`trackAction`) pesa ~60-120B de JSON crudo, y cada entrada persistida (con el wrapper + `pageUrl`) ronda ~300-500B — 500 entradas son ~250KB, una fracción chica de los 10MB de cuota de `chrome.storage.local` (la extensión no pide `unlimitedStorage`), y alcanza cómodo para 30-50 páginas de recorrido.

El botón **Limpiar** vacía `requests`, `domMboxes` y `digitalDataEvents` — las tres, incluido el recorrido de eventos: es un "empezar de nuevo" explícito, a diferencia de navegar dentro del mismo recorrido. Se puede deshacer durante unos segundos.

---

## Versión

`v2.2.0`

---

## Autor

**Marcos Romero** — Ingeniero en Sistemas

# extension-universal
