# Google Apps Script de Anaqueles Pro

Esta carpeta contiene el Web App que expone el catálogo de Google Sheets a la aplicación.

## Columnas de cada proveedor

Cada hoja de proveedor representa un pedido. La fila 1 contiene encabezados y los productos comienzan en la fila 2.

| Columna | Contenido |
| --- | --- |
| A | Nombre del producto |
| B | Requerido base / lunes a viernes |
| C | Requerido de sábado, opcional |
| D | Columna libre heredada |
| E | Imagen o fórmula `IMAGE("url")` |
| F | Activo (`Yes`/`No`) |
| G | Reportar cuando falten al menos estas piezas |
| H | Unidades por paquete |
| I | Ubicación, por ejemplo `Refrigerador` o `Anaquel` |
| J | ID de agrupación opcional |
| K | Imagen heredada de respaldo |

Cuando el mismo producto está en varias ubicaciones, se repite en varias filas. Para que sus existencias se sumen, usa el mismo ID en la columna J. Si J está vacía, la aplicación agrupa automáticamente por nombre normalizado.

El requerido se toma una sola vez usando el valor mayor configurado entre las filas agrupadas. Las existencias y los cambios sí se suman.

## Calendario de pedidos

Crea una hoja llamada `Calendario Pedidos` con esta estructura:

| A | B | C | D | E | F | G | H |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Proveedor | Lunes | Martes | Miércoles | Jueves | Viernes | Sábado | Domingo |
| Lala | Yes | No | No | Yes | No | No | No |

También se aceptan `Sí`, `X`, `1`, `true` o casillas de verificación activadas. El nombre del proveedor debe corresponder al nombre de su hoja; la comparación ignora mayúsculas, acentos y espacios repetidos.

- Si la hoja de calendario no existe, se muestran todos los proveedores.
- Si existe, sólo aparecen los proveedores activados para el día actual.
- Un proveedor ausente del calendario queda oculto mientras el calendario esté configurado.

## Archivos

- `appsscript.json`: permisos y configuración del Web App.
- `SyncEndpoint.gs`: lectura del catálogo, calendario y proxy de imágenes.

## Sincronización de imágenes

La aplicación descarga el catálogo con `includeImages=0` para que la sincronización y la prueba de conexión sean rápidas. Después guarda las imágenes de forma individual mediante el proxy `mode=image`, con progreso y fallos independientes.

El parámetro `includeImages=1` se conserva para pruebas manuales o diagnósticos, pero no se recomienda para catálogos completos porque genera respuestas muy grandes y puede superar el tiempo de espera del navegador.
