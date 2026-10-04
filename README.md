# Night Club

Simulador de antro nightclub RimWorld-lite 2D isometrico. MVP jugable.
Vite + TypeScript + Phaser 3. UI en espanol.

## Como jugar

1. Instala dependencias del proyecto
2. Corre el script de desarrollo Vite
3. Controles:
   - Abrir noche: spawnea clientes
   - Toca bartender o cualquier cliente: panel unificado (Nombre, Rol, Energia/Paciencia, Animo, Habilidad, Estado)
   - Descansar: solo personal (Luna) cuando esta libre
   - Cerrar noche: resumen de la sesion
   - Clientes van a barra o sofa; Luna atiende sola; paciencia baja mientras esperan
   - Arrastra / desliza la pantalla para mover la camara (un dedo o mouse). Toque corto = seleccionar.
   - Construir: mueve y compra muebles (sin girar: cada pieza tiene una sola orientacion fija, estilo Ultima Online). Boton Muebles abre la tienda (Mesa de DJ, etc.). Listo vuelve al juego.
   - ✕ o Escape cierra el panel; toque en vacio deselecciona.

Meta: gana dinero sin dejar a Luna sin energia.

## Build

Instalar, luego build. Salida en carpeta dist. Preview disponible.

## Suelo (tema medieval) — tile-based

Camara isometrica fija 2:1 (sin giros, estilo Ultima Online). Rejilla 12x12; tile = rombo 64x32 px a 1x.

- `public/data/floor.json`: `types` (id, texture, file) + `grid[row][col]` con el id de cada casilla. Editarlo cambia el diseno sin tocar codigo.
- `public/assets/tiles/floor_<id>.png`: **128x64 px RGBA** (una casilla a 2x, rombo exacto). Reemplazar estos PNG cambia el arte sin tocar codigo. Cualquier tamano 2:1 sirve (se reescala); el motor re-enmascara cada tile al rombo exacto (regla de centro de pixel) y los estampa en UNA textura al iniciar, asi que no hay costuras a ningun zoom.
- `scripts/make_floor_tiles.py` genera los tiles placeholder (`--json` tambien reescribe floor.json con el diseno por defecto).
- En modo Construir aparece una rejilla tenue de rombos; en juego normal no se ve ninguna rejilla.

## Placement (Construir)

Tile-integer: la huella del mueble (casillas) debe caber en el 12x12 y no pisar otros muebles. `scenario.json > blocked` esta vacio (ya no hay escenario).

## Datos

- public/data/characters.json — bartender y clientes
- public/data/scenario.json — mapa, muebles (sofa.facing), bebidas, duracion
- public/data/shop_furniture.json — catalogo tienda Construir (id, name, price, category, sprite, footprint)

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

## Tienda Construir (Muebles / Decoracion)

En modo Construir, boton **Muebles** abre catalogo data-driven (`shop_furniture.json`).
Comprar deduce dinero, spawnea instancia en baldosa libre; arrastrar como sofa/barra (no se gira).
Compras + placements + dinero persisten en localStorage con el layout.

### Mesa de DJ (`dj_booth`)
- Precio: $120
- Sheet: `dj_booth_front_sheet.png` (SE, 2x4 idle); placement art `dj_booth_se.png`
- Una sola orientacion fija (SE: frente abajo-derecha, espalda hacia el escenario arriba-izquierda)
- **No** esta en el scenario inicial — solo via tienda

### Orientacion fija (sin girar)
Camara fija, sin giro de piezas. Todo mueble usa su arte SE (`sofa_se`, `bar_se`, `pinball_se`, `dj_booth_se`).
Los PNG sw/ne/nw siguen en `public/assets/furniture/` pero ya no se cargan. Saves antiguas con piezas
giradas se migran al cargar: facing=se, huella SE y se mueven a la casilla valida mas cercana.

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
