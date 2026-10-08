# Red de contactos — prototipo

Prototipo local de una herramienta para gestionar personas, organizaciones, instituciones y visualizar sus vínculos en una red interactiva.

## Requisitos
- Node.js 18 o superior
- npm

## Instalación y ejecución
```bash
npm install
npm run dev
```
Vite mostrará la URL local (normalmente `http://localhost:5173`). Abrila en el navegador.

## Build de producción
```bash
npm run build
npm run preview
```

## Datos
No usa backend ni servicios externos. Los registros y relaciones se guardan en `localStorage` bajo la clave `red-contactos:v1`. La primera apertura carga automáticamente los datos demo.

## Restablecer demo
En la parte inferior de la barra izquierda elegí **Restablecer demo** y confirmá. Se eliminan los cambios locales y se restauran los registros y relaciones de ejemplo.

## Funcionalidades
- Personas, organizaciones e instituciones.
- Alta, edición y eliminación de registros.
- Alta y eliminación de relaciones.
- Prevención de autorrelaciones y relaciones idénticas duplicadas.
- Búsqueda y filtros por tipo.
- Grafo SVG responsive e interactivo.
- Selección de nodos, foco de conexiones y navegación entre entidades.
- Panel de detalle con información y vínculos.
- Persistencia local.
- Navegación básica por teclado y estados de foco.

## Stack
React + TypeScript + Vite + CSS. El grafo está implementado con SVG propio para mantener el prototipo liviano y sin dependencias de visualización adicionales.

## Autenticación en Cloudflare Workers

Las contraseñas del administrador se almacenan como PBKDF2-HMAC-SHA256 con sal aleatoria y 100.000 iteraciones. El Web Crypto de Cloudflare Workers rechaza PBKDF2 con más de 100.000 iteraciones (`NotSupportedError`), por lo que este es el máximo compatible con el runtime aunque otros entornos puedan recomendar un costo mayor. Cada usuario guarda su algoritmo e iteraciones en `admin_users`, y el login usa esos valores por registro; los hashes con un algoritmo o costo no soportado se rechazan sin error interno.

Para probar el flujo completo en el runtime local compatible con Workers:

```bash
npm run test:auth
```

## Variante visual oscura
Esta versión adapta la interfaz a una visualización de red inmersiva: mapa a pantalla completa, nodos luminosos, conexiones atenuadas y paneles flotantes oscuros. La lógica de registros, relaciones y localStorage se mantiene.
