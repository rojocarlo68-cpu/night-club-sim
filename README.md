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
   - Barra de bebidas: los clientes caminan a la barra, piden su bebida (cerveza $8, refresco $5, shot $6) y Luna/Nova la sirven ("Sirviendo cerveza/bebida"); pagan (+propina segun limpieza/estado) y luego se sientan en el sofa o pasean y se van. Sin barra en el club: se sientan en el sofa y pagan $3-$6 de relleno al terminar. Luna/Nova ademas limpian, descansan y deambulan
   - Arrastra / desliza la pantalla para mover la camara (un dedo o mouse). Toque corto = seleccionar.
   - Construir: mueve y compra muebles (sin girar: cada pieza tiene una sola orientacion fija, estilo Ultima Online). Boton Muebles abre la tienda (Sofa medieval $60, Barra de bebidas $80). Listo vuelve al juego.
   - ✕ o Escape cierra el panel; toque en vacio deselecciona.

Meta: gana dinero sin dejar a Luna sin energia.

## Build

Instalar, luego build. Salida en carpeta dist. Preview disponible.

## Suelo (tema medieval)

Camara isometrica fija 2:1 (sin giros, estilo Ultima Online). Rejilla 12x12; tile = rombo 64x32 px a 1x.

- **Modo imagen unica (activo)**: `public/data/floor.json > image` apunta a `public/assets/tiles/floor_planks.png`, **1536x768 px RGBA** = el rombo completo de 12x12 (768x384 mostrado, textureScale 2), bordes exactos 2:1, sin costuras. Reemplazar ese PNG cambia el suelo. `scripts/process_medieval_floor.py` lo genera desde `art_src/medieval/floor_planks_src.jpg` (recorta el borde de la losa, quita el fondo blanco).
- **Modo teselas** (queda disponible): quitar `image` de `floor.json` y usar `types` + `grid[row][col]` con PNG de 128x64 por tipo (`floor_<id>.png`; `scripts/make_floor_tiles.py` genera los de relleno stone/wood/carpet). El motor los estampa en UNA textura al iniciar.
- En modo Construir aparece una rejilla tenue de rombos; en juego normal no se ve ninguna rejilla.

## Muebles

Dos muebles, ambos con pose unica SW (frente hacia abajo a la izquierda, lado largo a la izquierda), huella 2x1, arte final a 2x:

- **Sofa medieval** (`public/assets/furniture/sofa_medieval_sw.png`, 212x176). `scripts/process_medieval_sofa.py` lo genera desde `art_src/medieval/sofa_sw_src.jpg` (recorte sin halo, escala uniforme 0.2385, sin deformar).
- **Barra de bebidas** (`public/assets/furniture/bar_medieval_sw.png`, 204x180). `scripts/process_medieval_bar.py` lo genera desde `art_src/medieval/bar_sw_src.jpg` (recorte sin halo, escala uniforme 0.3253 por minimos cuadrados de las 4 esquinas de la base contra el rombo 2x1, sin deformar: las verticales siguen verticales). Imprime el `baseVertex` y el desajuste residual por esquina. Se ancla por el vertice inferior (pata delantera). Barra inicial en la casilla (7,1); tambien se compra en la tienda ($80).

Ambos scripts imprimen el `baseVertex` (vertice inferior de la huella en px del arte) que va en `public/data/shop_furniture.json`. El arte original no es 2:1 exacto (la cara larga baja ~24 grados y la corta ~34), asi que la base no calza al 100% con el rombo 2x1 (ver el reporte del commit).
Mesa de DJ, pinball y los muebles neon de relleno (silla, mesas, planta, altavoz, luz) se quitaron; los guardados viejos los descartan y conservan el sofa. Los guardados anteriores a la barra reciben la barra inicial UNA vez (marca `seeded` en el guardado); si la eliminas no vuelve.

### Servicio en la barra
- Casilla de pedido = casilla frontal izquierda de la barra (lado SW); el personal sirve desde la frontal derecha. Si el frente esta tapado, el personal usa cualquier casilla pegada a la barra y los clientes hacen fila alrededor.
- Cliente: camina a la barra -> espera (Esperando, la paciencia baja) -> personal libre lo atiende (Atendiendo / Sirviendo cerveza|bebida) -> paga -> se sienta o pasea -> sale. Si se agota la paciencia se va enfadado sin pagar.
- Datos: `scenario.json > drinks`; precios/propinas en `ClubScene.computeServePayout`; `AI_TUNABLES.barQueueMaxSlots`.

## Placement (Construir)

Tile-integer: la huella del mueble (casillas) debe caber en el 12x12 y no pisar otros muebles. `scenario.json > blocked` esta vacio (ya no hay escenario).

## Datos

- public/data/characters.json — bartender y clientes
- public/data/scenario.json — mapa, muebles iniciales (sofa y barra), bebidas, duracion de la noche
- public/data/shop_furniture.json — catalogo tienda Construir (id, name, price, category, sprite, footprint)

## Arte

Ver "Suelo" y "Muebles" arriba. Personajes (Luna, Nova, clientes): hojas PNG en `public/assets/characters/`. Para cambiar el arte del suelo o del sofa sobrescribe esos PNG (mismos nombres/tamanos) o regeneralos con los scripts de `scripts/`.

## Tienda Construir (Muebles / Decoracion)

En modo Construir, boton **Muebles** abre catalogo data-driven (`shop_furniture.json`).
Comprar deduce dinero, spawnea instancia en baldosa libre; arrastrar para mover (no se gira).
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
