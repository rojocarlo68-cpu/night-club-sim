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
   - Arrastra / desliza la pantalla para mover la camara (un dedo o mouse). Toque corto = seleccionar.
   - Construir: coloca sofa y barra (mover + girar 4 caras). Listo vuelve al juego.
   - En juego, toca Luna para su panel. El sofa no gira fuera de Construir.

Meta: gana dinero sin dejar a Luna sin energia.

## Build

Instalar, luego build. Salida en carpeta dist. Preview disponible.

## Datos

- public/data/characters.json — bartender y clientes
- public/data/scenario.json — mapa, muebles (sofa.facing), bebidas, duracion

## Arte — room + sofa (Carlo)

Room: public/assets/tiles/room_floor.jpeg (tambien .png)
Sofa 4 angulos PNG transparente:
- public/assets/furniture/sofa_se.png (frente abajo-derecha)
- public/assets/furniture/sofa_sw.png (frente abajo-izquierda)
- public/assets/furniture/sofa_ne.png (frente arriba-derecha)
- public/assets/furniture/sofa_nw.png (frente arriba-izquierda)

Reemplazar: sobrescribe esos archivos con los mismos nombres. Si cambias nombres, actualiza BootScene y scenario.json sprites.
Barra 4 angulos PNG transparente (mismo pipeline que el sofa):
- public/assets/furniture/bar_se.png (frente clientes abajo-derecha)
- public/assets/furniture/bar_sw.png (frente clientes abajo-izquierda)
- public/assets/furniture/bar_ne.png (frente clientes arriba-derecha)
- public/assets/furniture/bar_nw.png (frente clientes arriba-izquierda)
Personajes y tiles: PNG (sin load.svg). Paleta oscura + neon magenta/cyan.
Sofas max ~512px ancho; room_floor.jpeg max ~1280 en el lado largo.

## Stack
- Vite 5 + TypeScript + Phaser 3
- A* pathfinding iso
- GitHub Actions Pages

## Sprint hooks
- Mas personal, bebidas, cola visual
- Musica, neon, VIP
- Arte final del bartender (placeholder PNG por ahora)

## GitHub Pages

URL esperada: https://rojocarlo68-cpu.github.io/night-club-sim/
Workflow pendiente en _pages_workflow_pending/pages.yml (scope workflow).
Deploy manual: dist/ + .nojekyll a rama gh-pages.

## Licencia
Proyecto privado de Carlo Guayaba — MVP interno.
