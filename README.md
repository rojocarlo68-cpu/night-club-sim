# Night Club

Simulador de antro nightclub RimWorld-lite 2D isometrico. MVP jugable.
Vite + TypeScript + Phaser 3. UI en espanol.

## Como jugar

1. Instala dependencias del proyecto
2. Corre el script de desarrollo Vite
3. Controles:
   - Abrir noche: spawnea clientes
   - Clic en bartender Luna: panel Energia / Animo / Habilidad
   - Descansar: Luna al sofa recupera energia
   - Cerrar noche: resumen de la sesion
   - Clientes van a barra o sofa; Luna atiende sola

Meta: gana dinero sin dejar a Luna sin energia.

## Build

Instalar, luego build. Salida en carpeta dist. Preview disponible.

## Datos

- public/data/characters.json — bartender y clientes
- public/data/scenario.json — mapa, muebles, bebidas, duracion

## Arte — reemplazar placeholders

SVG anime/chibi en public/assets/.

Tamanos sugeridos PNG:
- tiles/floor 64x32, wall 64x48
- furniture/bar 96x80, sofa 96x64
- characters/* 64x64 (pie abajo)
- ui/favicon 64x64

Pasos Carlo: mismos nombres de archivo; si PNG, cambia load.svg a load.image en BootScene; paleta oscura + neon rosa/cyan + luz calida.

## Stack
- Vite 5 + TypeScript + Phaser 3
- A* pathfinding iso
- GitHub Actions Pages

## Sprint hooks
- Mas personal, bebidas, cola visual
- Musica, neon, VIP, guardado local

## GitHub Pages

Workflow: .github/workflows/pages.yml
URL esperada: https://rojocarlo68-cpu.github.io/night-club-sim/
Repos privados suelen requerir GitHub Pro para Pages. Activa Source=GitHub Actions.

## Licencia
Proyecto privado de Carlo Guayaba — MVP interno.

## Pages workflow (pendiente de scope)

El archivo Actions esta en `_pages_workflow_pending/pages.yml` porque el token OAuth no tiene scope `workflow`.
Para activar: mueve ese archivo a `.github/workflows/pages.yml` desde la web de GitHub o con un token que incluya scope workflow, luego Settings > Pages > Source = GitHub Actions.
