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

## Frontend local con la API remota

El servidor de desarrollo de Vite redirige las rutas relativas `/api` al despliegue remoto de Pages (`https://red-de-contactos.pages.dev`). Pages reenvía esas solicitudes al Worker `red-contactos`, que utiliza la base D1 remota configurada en Cloudflare.

Iniciá el frontend con:

```bash
npm run dev
```

Luego abrí `http://localhost:5173`. El login y las operaciones de escritura siguen requiriendo la cuenta de administrador y el token CSRF de la sesión remota. El proxy adapta únicamente las cookies `Secure` para que puedan funcionar en el origen HTTP local; no modifica el Worker ni la configuración de producción.

Para usar otro destino remoto sin editar archivos, definí `VITE_API_PROXY_TARGET` antes de iniciar Vite. En PowerShell:

```powershell
$env:VITE_API_PROXY_TARGET = "https://red-de-contactos.pages.dev"
npm run dev
```

No se envían credenciales desde el frontend ni se crea una base local. Las pruebas que escriben datos (`test:auth` y `test:import`) usan Wrangler y su entorno local independiente; no son necesarias para probar el frontend contra D1 remoto.

## Datos
En el entorno desplegado, los registros y relaciones se guardan en la base D1 del Worker. Cuando ejecutás el frontend local con el proxy remoto, las operaciones `/api` utilizan esa misma D1; no se crea una base local ni se usa `localStorage` para los datos de la red.

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

Para un reseteo excepcional, configurá temporalmente el secreto `ADMIN_PASSWORD_RESET_TOKEN`, desplegá solo el Worker y llamá al endpoint `POST /api/auth/reset-password` con los headers `X-Admin-Password-Reset-Token` y `Content-Type: application/json`, enviando `{ "email": "...", "password": "..." }`. El endpoint usa el mismo hash compatible con Workers y revoca las sesiones existentes. Eliminá el secreto temporal después del uso.

## Variante visual oscura
Esta versión adapta la interfaz a una visualización de red inmersiva: mapa a pantalla completa, nodos luminosos, conexiones atenuadas y paneles flotantes oscuros. La lógica de registros, relaciones y localStorage se mantiene.
