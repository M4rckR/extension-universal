# Política de Privacidad — Alloyscope

[English version below](#privacy-policy--alloyscope)

Última actualización: octubre de 2026

Alloyscope es una herramienta de depuración para desarrolladores que inspecciona implementaciones de Adobe Target, Adobe Web SDK (Alloy) y Adobe Launch (Tags) en la página que el usuario está auditando.

## Qué datos se procesan

Mientras el usuario navega, la extensión lee de la página activa:

- Las respuestas de personalización que Adobe Target devuelve al SDK de Alloy, incluido el contenido HTML/JS de las ofertas.
- Los nombres de mbox presentes en el DOM y los decisionScopes solicitados por la página.
- Los eventos enviados a la capa de datos de la página (window.digitalData y window.adobeDataLayer), junto con la URL de la página donde se originaron.
- La configuración de la instancia de Alloy activa (orgId, datastream, dominio de Edge).
- El contenido de las llamadas que Alloy envía a Adobe Edge (el XDM del evento, los scopes pedidos y las notificaciones de display), que puede incluir el identificador de visitante de Adobe (ECID) y los datos que la propia página agregue al evento, junto con el código de estado de la respuesta.
- El estado de renderizado que informa Alloy (qué actividades aplicó en la página y cuánto tiempo estuvo oculto el contenido).
- La propiedad de Adobe Launch (Tags) que carga la página (nombre, entorno, fecha de compilación) y las reglas que se ejecutaron o cuyas condiciones no se cumplieron, con un resumen de esas condiciones, el código o la configuración de cada condición que no se cumplió y el de las acciones de cada regla, se haya ejecutado o no (o la URL del archivo, si el código es externo): el mismo código que la página ya publica en su librería de Launch.
- Si la página usa at.js (Adobe Target clásico) y su versión, solo para avisarlo en la ventana.

Además guarda el tenant de Adobe Target que el usuario escribe en la extensión, usado solo para armar los enlaces a la interfaz de Adobe Target.

## Dónde se almacenan

Exclusivamente en el equipo del usuario, mediante chrome.storage.local. Los datos nunca se transmiten a ningún servidor, no se sincronizan entre dispositivos y no son accesibles para el desarrollador ni para terceros.

## Qué NO hace la extensión

- No envía datos fuera del equipo del usuario.
- No utiliza servidores propios, backend, analítica ni telemetría.
- No vende ni comparte datos con terceros.
- No busca ni extrae información de identificación personal, credenciales, datos financieros ni comunicaciones personales. Guarda en el equipo, tal cual, lo que la página ya envía a Adobe y a su capa de datos: si el sitio incluye ahí un identificador o un dato del visitante, queda dentro de lo capturado, solo en el equipo del usuario.
- No ejecuta código remoto.
- No carga recursos externos: las fuentes y los íconos vienen incluidos en la extensión.
- No modifica el contenido ni el comportamiento de los sitios visitados: no escribe cookies, no altera la capa de datos y no recarga páginas. La captura es solo de lectura.

## Control y eliminación

El usuario puede borrar lo capturado en cualquier momento con el botón Limpiar de la extensión. Desinstalar la extensión elimina de forma permanente todos los datos almacenados.

## Contacto

Marcos Romero — marcromerogar4@gmail.com

---

# Privacy Policy — Alloyscope

[Versión en español arriba](#política-de-privacidad--alloyscope)

Last updated: October 2026

Alloyscope is a debugging tool for developers that inspects Adobe Target, Adobe Web SDK (Alloy) and Adobe Launch (Tags) implementations on the page the user is auditing.

## What data is processed

While the user browses, the extension reads from the active page:

- The personalization responses Adobe Target returns to the Alloy SDK, including the HTML/JS content of the offers.
- The mbox names present in the DOM and the decisionScopes requested by the page.
- The events sent to the page's data layer (window.digitalData and window.adobeDataLayer), together with the URL of the page they came from.
- The configuration of the active Alloy instance (orgId, datastream, Edge domain).
- The content of the calls Alloy sends to Adobe Edge (the event's XDM, the requested scopes and the display notifications), which may include Adobe's visitor identifier (ECID) and any data the page itself adds to the event, together with the status code of the response.
- The render status reported by Alloy (which activities it applied on the page and how long content stayed hidden).
- The Adobe Launch (Tags) property the page loads (name, environment, build date) and the rules that ran or whose conditions were not met, with a summary of those conditions, the code or settings of each condition that was not met, and the code or settings of each rule's actions, whether they ran or not (or the file's URL, when the code is external): the same code the page already publishes in its Launch library.
- Whether the page uses at.js (classic Adobe Target) and its version, only to say so in the window.

It also stores the Adobe Target tenant the user types into the extension, used only to build the links to the Adobe Target interface.

## Where it is stored

Only on the user's device, through chrome.storage.local. The data is never transmitted to any server, is not synced across devices and is not accessible to the developer or to third parties.

## What the extension does NOT do

- It does not send data off the user's device.
- It does not use its own servers, a backend, analytics or telemetry.
- It does not sell or share data with third parties.
- It does not look for or extract personally identifiable information, credentials, financial data or personal communications. It stores on the device, as is, what the page already sends to Adobe and to its data layer: if the site includes an identifier or a piece of visitor data there, it remains part of what was captured, on the user's device only.
- It does not execute remote code.
- It does not load external resources: fonts and icons are bundled with the extension.
- It does not modify the content or behavior of the sites visited: it does not write cookies, alter the data layer or reload pages. Capture is read-only.

## Control and deletion

The user can delete what was captured at any time with the extension's Clear button. Uninstalling the extension permanently removes all stored data.

## Contact

Marcos Romero — marcromerogar4@gmail.com
