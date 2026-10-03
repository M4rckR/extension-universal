# Política de Privacidad — Target Inspector

Última actualización: octubre de 2026

Target Inspector es una herramienta de depuración para desarrolladores que inspecciona implementaciones de Adobe Target y Adobe Web SDK (Alloy) en la página que el usuario está auditando.

## Qué datos se procesan

Mientras el usuario navega, la extensión lee de la página activa:

- Las respuestas de personalización que Adobe Target devuelve al SDK de Alloy, incluido el contenido HTML/JS de las ofertas.
- Los nombres de mbox presentes en el DOM y los decisionScopes solicitados por la página.
- Los eventos enviados a la capa de datos de la página (window.digitalData y window.adobeDataLayer), junto con la URL de la página donde se originaron.
- La configuración de la instancia de Alloy activa (orgId, datastream, dominio de Edge).
- El estado de renderizado que informa Alloy (qué actividades aplicó en la página y cuánto tiempo estuvo oculto el contenido).
- La propiedad de Adobe Launch (Tags) que carga la página (nombre, entorno, fecha de compilación) y las reglas que se ejecutaron o cuyas condiciones no se cumplieron, con un resumen de esas condiciones el código o la configuración de cada condición que no se cumplió y el de las acciones de las reglas que se completaron (o la URL del archivo, si el código es externo): el mismo código que la página ya publica en su librería de Launch.

Además guarda el tenant de Adobe Target que el usuario escribe en la extensión, usado solo para armar los enlaces a la interfaz de Adobe Target.

## Dónde se almacenan

Exclusivamente en el equipo del usuario, mediante chrome.storage.local. Los datos nunca se transmiten a ningún servidor, no se sincronizan entre dispositivos y no son accesibles para el desarrollador ni para terceros.

## Qué NO hace la extensión

- No envía datos fuera del equipo del usuario.
- No utiliza servidores propios, backend, analítica ni telemetría.
- No vende ni comparte datos con terceros.
- No recoge información de identificación personal, credenciales, datos financieros ni comunicaciones personales.
- No ejecuta código remoto.
- No carga recursos externos: las fuentes y los íconos vienen incluidos en la extensión.
- No modifica el contenido ni el comportamiento de los sitios visitados: no escribe cookies, no altera la capa de datos y no recarga páginas. La captura es solo de lectura.

## Control y eliminación

El usuario puede borrar todo lo capturado en cualquier momento con el botón Limpiar de la extensión. Desinstalar la extensión elimina de forma permanente todos los datos almacenados.

## Contacto

Marcos Romero — marcromerogar4@gmail.com