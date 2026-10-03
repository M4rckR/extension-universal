# Ficha de Chrome Web Store — Alloyscope

Textos listos para pegar en el panel de desarrollador
(https://chrome.google.com/webstore/devconsole). El paquete se arma con
`sh store/package.sh` → `dist/alloyscope-<versión>.zip`.

---

## Paquete y recursos

| Campo del panel | Qué subir |
| --- | --- |
| Paquete | `dist/alloyscope-2.3.0.zip` |
| Ícono de la tienda (128×128) | `assets/icon128.png` |
| Capturas (1280×800) | Ficha en español: `store/screenshots/1-actividades.jpg`, `2-hits.jpg`, `3-launch.jpg`, `4-eventos.jpg`. Ficha en inglés: `store/screenshots/en/1-activities.jpg`, `2-hits.jpg`, `3-launch.jpg`, `4-events.jpg` |
| Idiomas | Inglés (por defecto) y español — una ficha por idioma, ver "Versión en inglés" |
| Categoría | Herramientas para desarrolladores |

Las capturas usan datos de ejemplo (una tienda ficticia), no un sitio real.

---

## Ficha

**Nombre** (máx. 75 caracteres; es `extName` en `_locales/*/messages.json`, igual en los dos idiomas):

> Alloyscope: Debugger for Adobe Target, Web SDK & Launch

"Alloyscope" es la marca propia (lo que aparece en la barra del navegador, `short_name`); el resto son las palabras que se buscan en la tienda. "Adobe" va como referencia ("for Adobe…"), no como dueño del producto — y el descargo de no afiliación de la descripción se mantiene.

**Resumen** (máx. 132 caracteres; es `extDescription` de `_locales/es`):

> Inspecciona Adobe Target (actividades y su renderizado), mboxes, reglas de Adobe Launch y la capa de datos en páginas con Web SDK.

**Descripción:**

> Alloyscope es una herramienta de depuración para equipos de marketing técnico, analítica y desarrollo que trabajan con Adobe Target y Adobe Web SDK (Alloy).
>
> Abre una ventana junto a la página que estás revisando y muestra en vivo:
>
> • Actividades: qué actividades A/B y de segmentación (XT) respondió Adobe Target, con su experiencia asignada, si Alloy llegó a renderizarlas en la página, el tiempo de prehiding, si se notificó la impresión, el contenido HTML de la oferta, una sección mBoxes que cruza los elementos [data-mbox] con los scopes que respondió Target y un enlace directo a la actividad en Adobe Target (configurando el tenant de tu organización).
> • Eventos: registra los envíos a la capa de datos (window.digitalData y window.adobeDataLayer) a lo largo de todo el recorrido, agrupados por página, con búsqueda de texto y filtros por nombre de evento.
> • Hits: cada llamada de Alloy a Adobe Edge con su respuesta: código de estado, tipo de evento, scopes pedidos, decisiones devueltas y qué actividades se notificaron como vistas, con el JSON completo del request y del response.
> • Launch: la propiedad de Adobe Launch (Tags) que carga la página, con su entorno (production, staging o development) y fecha de compilación, y las reglas que se completaron o cuya condición no se cumplió, con el motivo (por ejemplo, la cookie de consentimiento que falta).
>
> También muestra el datastream y el orgId de la instancia de Alloy activa, para confirmar que la página apunta a la configuración correcta.
>
> Privacidad: todo lo capturado se guarda solo en tu navegador (chrome.storage.local). La extensión no envía datos a ningún servidor, no usa analítica y no carga recursos externos. Es solo de lectura: no modifica las páginas, no escribe cookies y no recarga nada.
>
> La interfaz está en español e inglés, según el idioma del navegador.
>
> Desarrollada por Marcos Romero, Ingeniero en Sistemas.
>
> Alloyscope es un proyecto independiente y no está afiliado, patrocinado ni respaldado por Adobe. Adobe, Adobe Target y Adobe Experience Platform son marcas de Adobe Inc.

### Versión en inglés

La extensión declara dos idiomas (`_locales/en` y `_locales/es`, con `en` como
idioma por defecto), así que el panel deja cargar una ficha por idioma: en
"Store listing" se elige el idioma arriba y se pega el texto de cada uno. Quien
tenga Chrome en español ve la ficha en español; el resto, la de inglés. El
nombre y el resumen salen del paquete (`extName` / `extDescription` de cada
`messages.json`); la descripción larga se pega acá, en el panel.

**Summary** (max. 132 characters; `extDescription` in `_locales/en`):

> Debug Adobe Target, Web SDK (Alloy) and Launch on any page: activities, render status, Edge calls, rules and data layer events.

**Description:**

> Alloyscope is a debugging tool for marketing technologists, analysts and developers who work with Adobe Target, Adobe Web SDK (Alloy) and Adobe Launch (Tags).
>
> It opens a window next to the page you are checking and shows, live:
>
> • Activities: which A/B and experience targeting (XT) activities Adobe Target returned, with the assigned experience, whether Alloy actually rendered each one on the page, how long content stayed hidden (prehiding), and whether the impression was reported to Target. Each activity shows the offer's HTML and a direct link to the activity in Adobe Target (once you set your organization's tenant). An mBoxes strip matches the page's [data-mbox] elements against the scopes Target answered.
> • Hits: every call Alloy makes to the Adobe Edge Network with its response: status code, event type, requested scopes, decisions returned and which activities were reported as displayed, with the full request and response JSON.
> • Launch: the Adobe Launch (Tags) property loaded on the page, its environment (production, staging or development) and build date, and the rules that ran or did not meet a condition, with the reason (for example, a missing consent cookie) and the code of each condition and action.
> • Events: every push to the data layer (window.digitalData and window.adobeDataLayer) across your whole visit, grouped by page, with text search and filters by event name.
>
> When no activities show up, Alloyscope tells you why whenever the data allows: a consent cookie blocking the Target rule, a page that uses at.js instead of Web SDK, Target answering with no offers, or Alloy not making any call.
>
> It also shows the datastream and orgId of each Alloy instance on the page, so you can confirm the page points to the right configuration.
>
> Works on any site that uses Adobe Web SDK. On sites that use at.js (classic Adobe Target), the Launch and Events tabs work and Activities explains that the page uses at.js.
>
> Privacy: everything captured stays in your browser (chrome.storage.local). The extension sends no data to any server, uses no analytics and loads no external resources. It is read-only: it does not modify pages, write cookies or reload anything.
>
> The interface is available in English and Spanish, and follows your browser's language.
>
> Built by Marcos Romero, Systems Engineer.
>
> Alloyscope is an independent project and is not affiliated with, sponsored by or endorsed by Adobe. Adobe, Adobe Target and Adobe Experience Platform are trademarks of Adobe Inc.

---

## Pestaña "Prácticas de privacidad"

**Propósito único:**

> Inspeccionar y depurar la implementación de Adobe en la página que el usuario está revisando: las respuestas de personalización de Adobe Target / Adobe Web SDK, las reglas de Adobe Launch y los eventos de la capa de datos.

**Justificación de permisos:**

| Permiso | Justificación |
| --- | --- |
| `storage` | Guarda localmente las respuestas de Adobe Target, los eventos de la capa de datos y las reglas de Adobe Launch capturados y el tenant que configura el usuario, para mostrarlos en la ventana del inspector y actualizarla en vivo. Nada sale del equipo. |
| `scripting` | Lo usa únicamente el botón "Capturar ahora": inyecta los scripts de captura en una pestaña que ya estaba abierta antes de instalar o recargar la extensión, para no obligar a recargar la página. |
| Permiso de host `*://*/*` | La extensión inspecciona implementaciones de Adobe Web SDK, que pueden estar en cualquier dominio: el usuario la usa sobre los sitios que audita, que no se conocen de antemano. Los scripts solo leen lo que Alloy y Adobe Launch exponen y los envíos a la capa de datos; no modifican la página. |

**¿Usa código remoto?** No. Todo el código JavaScript va dentro del paquete.

**Uso de datos:** la extensión lee contenido de la página (respuestas de
personalización y eventos de la capa de datos), pero lo procesa y guarda solo
en el equipo del usuario y nunca lo transmite. Según la definición de Google,
eso no es "recopilación", así que no corresponde marcar ninguna categoría de
datos. Marcar las tres certificaciones:

- No vendo ni transfiero datos de usuarios a terceros, fuera de los casos de uso aprobados.
- No uso ni transfiero datos de usuarios para fines no relacionados con el propósito único del artículo.
- No uso ni transfiero datos de usuarios para determinar la solvencia crediticia ni para otorgar préstamos.

**URL de la política de privacidad:** el `PRIVACY.md` publicado, por ejemplo
`https://github.com/M4rckR/extension-universal/blob/main/PRIVACY.md`
(el repositorio tiene que ser público, o hay que alojar el texto en otra URL
pública).

---

## Antes de enviar

- [ ] Correr `sh store/package.sh` y subir el zip de `dist/`.
- [ ] Revisión: el permiso de host para todos los sitios suele llevar a una revisión más larga (días, a veces semanas).
- [ ] Para cada versión nueva: subir `version` en `manifest.json` (y en el README) y volver a empaquetar.
