# Ficha de Chrome Web Store — Target Inspector

Textos listos para pegar en el panel de desarrollador
(https://chrome.google.com/webstore/devconsole). El paquete se arma con
`sh store/package.sh` → `dist/target-inspector-<versión>.zip`.

---

## Paquete y recursos

| Campo del panel | Qué subir |
| --- | --- |
| Paquete | `dist/target-inspector-2.2.0.zip` |
| Ícono de la tienda (128×128) | `assets/icon128.png` |
| Capturas (1280×800) | `store/screenshots/1-actividades.jpg`, `2-eventos.jpg`, `3-mboxes.jpg` |
| Idioma | Español |
| Categoría | Herramientas para desarrolladores |

Las capturas usan datos de ejemplo (una tienda ficticia), no un sitio real.

---

## Ficha

**Nombre:** Target Inspector

**Resumen** (máx. 132 caracteres):

> Inspecciona actividades de Adobe Target, mboxes y eventos de digitalData en cualquier página con Adobe Web SDK (Alloy).

**Descripción:**

> Target Inspector es una herramienta de depuración para equipos de marketing técnico, analítica y desarrollo que trabajan con Adobe Target y Adobe Web SDK (Alloy).
>
> Abre una ventana junto a la página que estás revisando y muestra en vivo:
>
> • Actividades: qué actividades A/B y de segmentación (XT) respondió Adobe Target, con su experiencia asignada, el contenido HTML de la oferta y un enlace directo a la actividad en Adobe Target (configurando el tenant de tu organización).
> • mBoxes: cruza los elementos [data-mbox] de la página con los scopes que Target respondió y los clasifica en en uso, libres y solo Alloy.
> • Eventos: registra los envíos a window.digitalData a lo largo de todo el recorrido, agrupados por página, con búsqueda de texto y filtros por nombre de evento.
>
> También muestra el datastream y el orgId de la instancia de Alloy activa, para confirmar que la página apunta a la configuración correcta.
>
> Privacidad: todo lo capturado se guarda solo en tu navegador (chrome.storage.local). La extensión no envía datos a ningún servidor, no usa analítica y no carga recursos externos. Es solo de lectura: no modifica las páginas, no escribe cookies y no recarga nada.
>
> Desarrollada por Marcos Romero, Ingeniero en Sistemas.
>
> Target Inspector es un proyecto independiente y no está afiliado, patrocinado ni respaldado por Adobe. Adobe, Adobe Target y Adobe Experience Platform son marcas de Adobe Inc.

---

## Pestaña "Prácticas de privacidad"

**Propósito único:**

> Inspeccionar y depurar las respuestas de personalización de Adobe Target / Adobe Web SDK y los eventos de la capa de datos digitalData de la página que el usuario está revisando.

**Justificación de permisos:**

| Permiso | Justificación |
| --- | --- |
| `storage` | Guarda localmente las respuestas de Adobe Target, los eventos de digitalData capturados y el tenant que configura el usuario, para mostrarlos en la ventana del inspector y actualizarla en vivo. Nada sale del equipo. |
| `scripting` | Lo usa únicamente el botón "Capturar ahora": inyecta los scripts de captura en una pestaña que ya estaba abierta antes de instalar o recargar la extensión, para no obligar a recargar la página. |
| Permiso de host `*://*/*` | La extensión inspecciona implementaciones de Adobe Web SDK, que pueden estar en cualquier dominio: el usuario la usa sobre los sitios que audita, que no se conocen de antemano. Los scripts solo leen las respuestas que Alloy expone y los envíos a digitalData; no modifican la página. |

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
