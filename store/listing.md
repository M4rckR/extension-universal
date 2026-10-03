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
| Capturas (1280×800) | `store/screenshots/1-actividades.jpg`, `2-hits.jpg`, `3-launch.jpg`, `4-eventos.jpg` |
| Idioma | Español |
| Categoría | Herramientas para desarrolladores |

Las capturas usan datos de ejemplo (una tienda ficticia), no un sitio real.

---

## Ficha

**Nombre** (máx. 75 caracteres; es el `name` del manifest):

> Alloyscope: Debugger for Adobe Target, Web SDK & Launch

"Alloyscope" es la marca propia (lo que aparece en la barra del navegador, `short_name`); el resto son las palabras que se buscan en la tienda. "Adobe" va como referencia ("for Adobe…"), no como dueño del producto — y el descargo de no afiliación de la descripción se mantiene.

**Resumen** (máx. 132 caracteres):

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
> Desarrollada por Marcos Romero, Ingeniero en Sistemas.
>
> Alloyscope es un proyecto independiente y no está afiliado, patrocinado ni respaldado por Adobe. Adobe, Adobe Target y Adobe Experience Platform son marcas de Adobe Inc.

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
