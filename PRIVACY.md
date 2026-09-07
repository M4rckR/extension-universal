# Política de Privacidad — Target Inspector

Última actualización: septiembre de 2026

Target Inspector es una herramienta de depuración para desarrolladores que inspecciona implementaciones de Adobe Target y Adobe Web SDK (Alloy) en la página que el usuario está auditando.

## Qué datos se procesan

Mientras el usuario navega, la extensión lee de la página activa:

- Las respuestas de personalización que Adobe Target devuelve al SDK de Alloy, incluido el contenido HTML/JS de las ofertas.
- Los nombres de mbox presentes en el DOM y los decisionScopes solicitados por la página.
- Los eventos enviados a la capa de datos de la página (window.digitalData), junto con la URL de la página donde se originaron.
- La configuración de la instancia de Alloy activa (orgId, datastream, dominio de Edge).
- El estado de la cookie at_qa_mode de Adobe Target.

## Dónde se almacenan

Exclusivamente en el equipo del usuario, mediante chrome.storage.local. Los datos nunca se transmiten a ningún servidor, no se sincronizan entre dispositivos y no son accesibles para el desarrollador ni para terceros.

## Qué NO hace la extensión

- No envía datos fuera del equipo del usuario.
- No utiliza servidores propios, backend, analítica ni telemetría.
- No vende ni comparte datos con terceros.
- No recoge información de identificación personal, credenciales, datos financieros ni comunicaciones personales.
- No ejecuta código remoto.
- No modifica el contenido ni el comportamiento de los sitios visitados. La única escritura es la cookie at_qa_mode, activada explícitamente por el usuario desde la pestaña QA.

## Control y eliminación

El usuario puede borrar todo lo capturado en cualquier momento con el botón LIMPIAR de la extensión. Desinstalar la extensión elimina de forma permanente todos los datos almacenados.

## Contacto

Marcos Romero — <tu correo>