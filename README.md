# Red de contactos — prototipo

Prototipo local de una herramienta para gestionar personas, organizaciones, proyectos y visualizar sus vínculos en una red interactiva.

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
- Personas, organizaciones y proyectos.
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

## Variante visual oscura
Esta versión adapta la interfaz a una visualización de red inmersiva: mapa a pantalla completa, nodos luminosos, conexiones atenuadas y paneles flotantes oscuros. La lógica de registros, relaciones y localStorage se mantiene.
