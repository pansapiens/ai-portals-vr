# Headset (Quest 3S) performance catalog

A ranking of all 471 worlds by how hard they are likely to be on a Meta Quest 3S, with notes on what to change in the 25 worst. Surveyed 2026-11-11 at commit 7cc827c.

## How the ranking was made

Each world was drawn in headless Chrome with a software renderer (SwiftShader) at three points of its flight (u = 0.15, 0.5, 0.85), with `tools/vr-survey.mjs`:

- **pixel**: draw time at 960x540 minus draw time at 48x27, in ms. This is the per-pixel work. In a headset the resolution governor (`src/core/xr.js`) can lower the drawing scale to 0.45 x 0.45, which cuts this to about a fifth.
- **vertex**: draw time at 48x27, in ms. This is vertex shading plus the overhead of each draw. The governor cannot reduce it, and a headset pays it twice (once per eye).
- **score** = vertex + pixel / 4, using the worst of the three points. Work the governor cannot remove counts in full.
- Draws, triangles, transparent materials and alpha-tested (`discard`) materials are per eye, also at the worst point.

Medians over all worlds: pixel 263 ms, vertex 122 ms, 47 draws, 360k triangles, score 207.

**Caveats.**

- The numbers are relative, not Quest frame times. Four worlds were measured at once, which inflates times 1.5 to 2 times and adds about +-50% noise. The order is what counts.
- A software renderer does not show the extra work a mobile tile-based GPU does. Every material with `discard` turns off early depth rejection for that draw (and on Adreno sometimes for the rest of the pass). Long shaders also run with fewer threads at once. The `discard` column is there for this reason.
- A software renderer also runs both sides of every branch, so changes that skip work with an `if` or an early `return`, or that draw large surfaces later so that the depth test rejects them, show no gain under SwiftShader. Measure those on a real GPU. This machine's AMD integrated GPU (2 RDNA2 compute units) is the closest thing to a Quest here: run Chrome with `--use-angle=vulkan --enable-features=Vulkan --ignore-gpu-blocklist` and the environment `MESA_VK_DEVICE_SELECT=1002:164e MESA_VK_DEVICE_SELECT_FORCE_DEFAULT_DEVICE=1`. It is not a tile-based GPU, so it does not show the `discard` effect above.
- Calibration against two reports from a Quest 3S: Bison in the Coloured Steam (`prismatic-dawn`, the geyser basin) is still very poor after the adaptive resolution change and ranks 163 (score 259). The Painted Ridges (`painted-ridges`) has not been reported again since that change and ranks 284 (score 180). If the geyser basin is typical, every world at or above score 259 (the High and Medium bands below) is likely to run poorly. That geyser world scores only about median on these measures, so the proxy is missing something device-specific. Frame rates from the Quest itself for a few worlds would calibrate the bands.

Bands: **High** score >= 500 (49 worlds), **Medium** 259-499 (117), **Watch** 180-258 (120), **Low** < 180 (185).

The notes on the top 25 come from reading the code, not from profiling on a headset. Line numbers are as of the commit above.

## Patterns that recur, and fixes that cover many worlds

1. **Lower `ctx.quality.detail` for worlds built in a headset.** The Quest gets the 'medium' level (detail 0.8). Many of the worst worlds already scale their instance counts by `detail` (dabs, leaves, strokes, threads, beads, grass). Building them at 0.4-0.5 while a headset session runs would be one change in `src/core/engine.js`. Some worlds clamp detail at a floor (e.g. 0.5 or 0.6) that would need lifting, and the first world of a visit is often built before the session starts.
2. **Hundreds of thousands of tiny instances, never culled.** 1-2 triangle dabs, leaves, strokes, birds and blades with `frustumCulled = false`. Hidden instances are collapsed inside the vertex shader, so they still run the full vertex shader, twice per frame in a headset. Fix: fewer instances in a headset; where possible, skip the rest of the vertex shader as soon as an instance is known to be hidden.
3. **Work that is constant per instance, done per vertex.** For example `sunMask` per tile vertex (the-toppling), `flyPos` or `flockPos` twice per vertex for the heading (monarch-sanctuary, the-murmuration), and tree shadows per tuft vertex (garden-carpet). Fix: an instance attribute computed at build time, or compute once per instance.
4. **One large shader for every surface, with a `discard` somewhere in it.** On a tile GPU the `discard` turns off early depth rejection on every surface that shares the material, walls and floors included (stone-knives, to-the-brim, moss-rain-veranda, lake-dyed-three-times). Fix: keep the `discard` on its own material copy (a define).
5. **Stacked full-screen transparent slices.** Light shafts and window beams drawn as 16-28 additive slices across the view, often faint (moss-rain-veranda, the-unspilling). Fix: fewer slices in a headset.
6. **Long per-pixel loops over lights and shadow casters**, plus ray-marched smoke (roofs-of-the-old-stone, room-is-a-camera, to-the-brim, the-digging-wheel, the-fire-comes-round). Fix: fewer steps or nearest-N lists in a headset; bake static shadows where the sun does not move.
7. **Shader terms computed everywhere and then multiplied by a weight that is zero over most of the screen.** Examples: noise octaves faded to their mean far away (the shared `bnz` helper computed the lookup and then mixed it out), sinter detail on meadow, ridge forest on the flats, a creek's strands away from the creek. Fix: an `if` on the weight. The picture is identical. Keep `dFdx`, `dFdy` and `fwidth` out of the branch (and ahead of any early `return`): on a real GPU a derivative is undefined for the rest of a 2x2 pixel quad when some of its pixels skip it, and the result is speckle along the branch edge.
8. **Large ground drawn first by an explicit `renderOrder`, and surfaces shaded under opaque layers.** three.js sorts opaque meshes front to back only within one `renderOrder`. A ground mesh set to -8 is shaded in full before the grass, animals and trees on top of it, and a sky set to -1 runs before the ground that covers it. 231 worlds set a negative `renderOrder` on something, so this is worth checking world by world. Fix: draw large opaque ground after the things standing on it and the sky after the ground (keep both ahead of any opaque mesh that does not write depth). Where an opaque layer always covers another (a ground sheet over a terrain), the lower one can return a flat colour under it.

Done so far for Bison in the Coloured Steam (`prismatic-dawn`):

- In a headset, half the meadow tussocks are drawn.
- The ground shaders were changed with patterns 7 and 8 and draw the same picture as before. Checked pixel for pixel at six flight points in the dawn, winter and summer looks, with at most 5 of 129,600 pixels differing. Measured on the AMD integrated GPU at 1600x900:
  - The pixel work for the whole scene is 29-40% lower across the dawn flight and 30-49% lower in summer.
  - The terrain's share fell from 28-47 ms to 10-22 ms.
  - The changes are: the terrain returns a flat colour where the hero's ground sheet covers it opaquely, each term is behind an `if` on its weight, the summer sheet stops shading past its edge, and the terrain and the sky draw after the herd, tussocks and pines.

## Top 25: what to change

Kinds: P pixel, V vertex, D alpha-tested (`discard`), O transparent overdraw, Dr draw calls. Effort: S small, M medium, L large.

| # | World | Score | Pixel | Vertex | Kind | Likely cause | Headset-only change | Effort |
|---|---|---|---|---|---|---|---|---|
| 1 | Pointillist Nebula (`pointillist-nursery`) | 1935 | 619 | 1781 | V, D | 240-330k one-triangle paint dabs (`parts/pointillist-nursery.js` DAB_VS :171-366), never culled; hidden dabs still run the full shader. Sky below the horizon runs two 12-step loops per pixel (`worlds/...:109-216`). | Scale dab density about 0.5 in a headset (`worlds:417`, `parts:572`); skip the mode-6 wrap bank. | S |
| 2 | A Digging Wheel in the Barley (`the-digging-wheel`) | 1933 | 6919 | 203 | P, D | Ground shader `landFrag` (`parts/the-digging-wheel-land.js:1619-2680`): about 170 vnoise and 52 fbm calls per pixel by surface kind; every lit pixel loops over 24 shadow boxes and 20 capsules (`parts/the-digging-wheel.js:240`). Barley is 4 stacked alpha-tested sheets plus ribbons. | Headset define that coarsens `footprint()` 3-4x so fine-detail branches skip; stop the shadow loops at the live box count. May still be too heavy. | M-L |
| 3 | The Clipped Menagerie (`clipped-menagerie`) | 1550 | 627 | 1393 | V, D | About 300k one-triangle leaf cards (zone caps `worlds:553-809`, hero budget `parts:601`), half of them hidden in the shader but still shaded. Hedge hulls drawn twice, both with discard. | Multiply zone `cardMax` and `cardBudget` by about 0.4 in a headset. | S |
| 4 | Stripes in the Grass (`stripes-in-the-grass`) | 1370 | 333 | 1287 | V, D | 66k grass blades drawn 3 times (one per paint pass, `worlds:455-480`): about 790k runs of a vertex shader with 4 noise calls, a texture read and a 12-step loop. Three overlapping alpha-tested layers. | Halve the far field's 40,000 blades; drop the black pass beyond about 60 m. | S |
| 5 | The Murmuration (`the-murmuration`) | 1251 | 329 | 1169 | V | Bird vertex shader calls `flockPos` twice per vertex (`parts/the-murmuration.js:324-397`) over 36k quads + 70k darts + 15k mirror birds; culled birds still pay. 28.5k alpha-tested reed cards plus mirror. | Quads about 12k, darts about 35k, mirror about 5k in a headset (`worlds:753, 759`). | S |
| 6 | Raku Aspens (`smoke-turns-the-aspens`) | 1107 | 315 | 1028 | V, D, P | About 56k hero leaves plus 20-60k grove leaves, one-triangle, double-sided, never culled, with fog and lustre per vertex; litter adds 8 noise calls per vertex. Full-screen sky runs the floor crackle code for every pixel and discards most of it. | `leaves: 25000`, halve grove and litter counts; branch the sky's floor code on `d.y < 0`. | S |
| 7 | Broken Necklace Falls (`unstrung-falls`) | 1091 | 378 | 996 | V, D | Bead impostors: pour 13.5k, heap 7.2k, river 5.25k and more, each vertex running clearance cones and projection maths; every bead uses discard plus alpha-to-coverage. | Scale the pour, heap and river counts by about 0.4 (fits the existing `detail` multiply). | S |
| 8 | The Same Field Every Hour (`same-field-every-hour`) | 1019 | 334 | 935 | V, D | Instanced brush-touch quads (hero 32k + 16k reflections, world 37k+), each vertex doing about 12 texture reads and cloud noise that is constant per touch; up to 5 discards per touch. | Build the touch batches at `detail` 0.6 in a headset (fewer, wider marks). | S |
| 9 | Mount Yoshino in Blossom (`petal-storm`) | 951 | 587 | 804 | P, V, Dr | Kit terrain with injected Voronoi and noise (`worlds/petal-storm.js:119-241`) over most of the screen; transparent stream and decals; 100k+ alpha-tested petals; sasa grass built 8 times (93 draws). | Cap petal instance counts at about 40%; merge or drop alternate sasa chunks. | S |
| 10 | The Boat with No One Aboard (`boat-with-no-one-aboard`) | 949 | 993 | 701 | P, O | Sea shader (`parts/boat-with-no-one-aboard.js:650-809`) evaluates the full sky for its reflection plus about 25 noise calls and loops over 46 objects per pixel; full-screen sky with a 27-cell 3D Voronoi in the red air. 45k additive stars, 32k birds. | Cheap sky-colour lookup in the sea reflection (M); halve stars and birds (S). | S-M |
| 11 | The Garden in the Lacquer Floor (`moss-rain-veranda`) | 911 | 3169 | 119 | O, P, D | 20 large additive light-shaft slices (`parts/moss-rain-veranda.js:1896`) with noise and a 6-step loop, mirrored in the floor, at a strength of 0.035; the lacquer-floor mirror draws the hall and garden a second time and puts `discard` into every patched material. | Hide the shafts (or keep 4 of 16) in a headset; next, switch the mirror off. | S |
| 12 | The Blue Tile Hill (`azulejo-descent`) | 901 | 3253 | 88 | P | One tile shader (`parts/azulejo-descent.js:715-828`) paints walls, sky and tram: sky pixels run the whole tile path before it is overwritten; the sea wall tests ship and whale outlines and a 10-step wave loop per pixel. | Return the sky picture at the top of `main()`; in a headset skip the tile-flip outline tests and use 6 wave rows. | S |
| 13 | Monarchs in the Firs (`monarch-sanctuary`) | 888 | 401 | 787 | V, Dr, D | About 70k animated butterflies (two `flyPos` calls per vertex), 34k far sprites, 22k grass blades, noise per vertex in the firs; 117 draws (234 in a headset); 69 alpha-tested materials. | Halve hero flyers, burst sprites and grass in a headset; one `flyPos` per vertex (M). | S |
| 14 | First Snow on Brown Paper (`first-snow-on-kraft`) | 872 | 253 | 808 | V, D | Everything is about 150k hatching quads through a 150-line vertex shader (`parts/first-snow-on-kraft.js:142-299`); thinned strokes run the whole shader first; tiles get a 180 m cull radius, snow and backdrop never culled; all strokes alpha-tested. | Scale strokes about 0.5; tighten tile radii to about 60 m; move the thinning test to the top of the vertex shader. | S-M |
| 15 | Camera Obscura (`room-is-a-camera`) | 839 | 2022 | 333 | P, V, O | Every wall pixel evaluates the outside harbour picture plus 40 shadow shapes (`parts/room-is-a-camera.js:685`); 17k dust motes run the same per vertex; wide additive beams. | Halve the motes; compute `picture() * shadowAt()` only where `face > 0` (exact). | S |
| 16 | Forest of Knives (`stone-knives`) | 826 | 2802 | 125 | P, D | One stone shader on nearly every surface (`parts/stone-knives.js:305-605`, about 30 noise + 7 fbm + 8 sphere shadows per pixel) that contains the far-fin `discard`, so overlapping blades lose early depth rejection. | Put the fin `discard` behind a define on its own material; skip the third flute layer and pits; 3 shadow spheres. | S-M |
| 17 | The Leaf Wind (`maple-gale`) | 810 | 459 | 696 | V, Dr, D | Leaf gust vertex shader with a 14-pass obstacle loop on about 41k leaves, 34k crown leaves, more litter; about 86 scatter meshes, all alpha-tested. | `gustLeaves` 12k, `ribbonLeaves` 3k, `mapleLeaves` 15k, `N_OBS` 6; halve scatter chunks. | S |
| 18 | Slate Country (`roofs-of-the-old-stone`) | 806 | 2483 | 185 | P | 600-line stone shader on every building: each pixel tests the sun against 40 boxes, 32 lamps, 8 masonry courses, some surfaces 24 fires and 16 pools; pools another 40-box reflection loop. | Nearest 12 boxes and 8 lamps per frame in a headset (M); bake the static sun shadow into a texture (L). | M |
| 19 | The Spill, Played Backwards (`the-unspilling`) | 793 | 491 | 670 | O, V | About 28 full-room additive window-beam slices, each with noise, a loop and `discard`; kit interior per-vertex lighting, double-sided; 11k nuts; cat drawn with 5 fur shells. | Space the beam slices to about 12; 2 fur shells; allow the nut count down to 0.3x. | S |
| 20 | Marble Run, Falling Dominoes (`the-toppling`) | 761 | 169 | 719 | V | Tile vertex shader runs a 16-pass window and roof-light loop per vertex (`parts/the-toppling.js:347-403`) though the result is constant per tile; tile geometry has no index (330-390k vertex runs). | Compute `sunMask` per tile at build time as an instance attribute (exact); index the tile geometry. | S-M |
| 21 | Ikat Lake (`lake-dyed-three-times`) | 755 | 394 | 656 | V, D | Nearly everything is 150k+ instanced thread strips through a long vertex shader with a 9-duck loop; far threads collapsed, not skipped; one material with `discard`; a 12-step bird loop per pixel. | Let `detail` go below its 0.6 floor in a headset (`worlds:92`); early exit in the vertex shader when the width is 0. | S |
| 22 | To the Brim (`to-the-brim`) | 740 | 2004 | 239 | P, D, O | `hallLight()` sums about 40 lights per pixel on every hall surface (`worlds/to-the-brim.js:274-374`); the floor adds flame reflections; the hall shader holds leaf `discard`s; 5,108 glasses each drawn 3 times (one additive, one transparent). | Headset define that skips floor flame reflections and far weak lights; leaf discard on its own material (M). | S-M |
| 23 | The Sky Drains into the Moon (`the-turning-night`) | 734 | 143 | 698 | V, D | Instanced painted strokes through one branchy vertex shader: 9,300 cypress flames calling `flameP()` twice per vertex, 30k wheat, 8.6k hills, never culled. | Hide the cypress and wheat sets once the camera has passed them; lower `detail` in a headset. | S |
| 24 | The Garden Underfoot (`garden-carpet`) | 725 | 928 | 493 | V, P, D | 9,800 pile tufts at 28 vertices each repeat a 40-tree shadow loop and 15-capsule sun test per vertex; the carpet floor runs the full pattern with a 24-creature loop per pixel; fur shells (cat 7 layers, pile 4) each with discard. | Cap tufts at about 3,000; cat 3 layers, pile 2. | S |
| 25 | Ahead of the Fire (`the-fire-comes-round`) | 717 | 1697 | 293 | P, O | Full-screen ray-marched smoke (`parts/the-fire-comes-round.js:1384`, 37-58 steps plus face search, far steps, thin smoke and an 8-step belt march); the water runs a second smoke march and a flame march for reflections; 6,800 additive sparks. | Smoke steps about 24 and 6 far steps in a headset (one line at `:1711`); halve or drop the reflected smoke march. | S |

## All worlds, ranked

Triangles in thousands; draws, triangles, transparent and discard counts per eye at the worst of the three points.

| # | World | Band | Score | Pixel | Vertex | Draws | Tris (k) | Transp. | Discard |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Pointillist Nebula (`pointillist-nursery`) | High | 1935 | 619 | 1781 | 22 | 296 | 2 | 18 |
| 2 | A Digging Wheel in the Barley (`the-digging-wheel`) | High | 1933 | 6919 | 203 | 14 | 498 | 3 | 4 |
| 3 | The Clipped Menagerie (`clipped-menagerie`) | High | 1550 | 627 | 1393 | 32 | 316 | 1 | 20 |
| 4 | Stripes in the Grass (`stripes-in-the-grass`) | High | 1370 | 333 | 1287 | 45 | 339 | 34 | 42 |
| 5 | The Murmuration (`the-murmuration`) | High | 1251 | 329 | 1169 | 33 | 312 | 5 | 25 |
| 6 | Raku Aspens (`smoke-turns-the-aspens`) | High | 1107 | 315 | 1028 | 40 | 402 | 13 | 12 |
| 7 | Broken Necklace Falls (`unstrung-falls`) | High | 1091 | 378 | 996 | 38 | 347 | 1 | 20 |
| 8 | The Same Field Every Hour (`same-field-every-hour`) | High | 1019 | 334 | 935 | 33 | 320 | 0 | 32 |
| 9 | Mount Yoshino in Blossom (`petal-storm`) | High | 951 | 587 | 804 | 93 | 439 | 16 | 52 |
| 10 | The Boat with No One Aboard (`boat-with-no-one-aboard`) | High | 949 | 993 | 701 | 69 | 339 | 19 | 24 |
| 11 | The Garden in the Lacquer Floor (`moss-rain-veranda`) | High | 911 | 3169 | 119 | 36 | 416 | 11 | 19 |
| 12 | The Blue Tile Hill (`azulejo-descent`) | High | 901 | 3253 | 88 | 61 | 302 | 16 | 19 |
| 13 | Monarchs in the Firs (`monarch-sanctuary`) | High | 888 | 401 | 787 | 117 | 493 | 42 | 69 |
| 14 | First Snow on Brown Paper (`first-snow-on-kraft`) | High | 872 | 253 | 808 | 36 | 315 | 1 | 26 |
| 15 | Camera Obscura (`room-is-a-camera`) | High | 839 | 2022 | 333 | 38 | 163 | 13 | 16 |
| 16 | Forest of Knives (`stone-knives`) | High | 826 | 2802 | 125 | 51 | 395 | 10 | 46 |
| 17 | The Leaf Wind (`maple-gale`) | High | 810 | 459 | 696 | 110 | 407 | 19 | 90 |
| 18 | Slate Country (`roofs-of-the-old-stone`) | High | 806 | 2483 | 185 | 35 | 418 | 3 | 5 |
| 19 | The Spill, Played Backwards (`the-unspilling`) | High | 793 | 491 | 670 | 56 | 403 | 20 | 19 |
| 20 | Marble Run, Falling Dominoes (`the-toppling`) | High | 761 | 169 | 719 | 80 | 384 | 9 | 5 |
| 21 | Ikat Lake (`lake-dyed-three-times`) | High | 755 | 394 | 656 | 16 | 406 | 0 | 10 |
| 22 | To the Brim (`to-the-brim`) | High | 740 | 2004 | 239 | 69 | 455 | 38 | 43 |
| 23 | The Sky Drains into the Moon (`the-turning-night`) | High | 734 | 143 | 698 | 17 | 285 | 1 | 11 |
| 24 | The Garden Underfoot (`garden-carpet`) | High | 725 | 928 | 493 | 36 | 352 | 5 | 29 |
| 25 | Ahead of the Fire (`the-fire-comes-round`) | High | 717 | 1697 | 293 | 35 | 371 | 13 | 30 |
| 26 | A Year in Stained Glass (`leaded-forest`) | High | 694 | 91 | 671 | 37 | 408 | 4 | 11 |
| 27 | The Bear at the Feast (`bare-oilcloth-night`) | High | 659 | 303 | 583 | 53 | 311 | 0 | 38 |
| 28 | The Groundswell (`groundswell-country`) | High | 641 | 607 | 490 | 34 | 433 | 5 | 17 |
| 29 | The Country of Pins (`country-of-pins`) | High | 617 | 1042 | 357 | 12 | 307 | 1 | 8 |
| 30 | Monsoon over the Saguaros (`saguaro-serigraph`) | High | 588 | 124 | 557 | 75 | 430 | 9 | 17 |
| 31 | The Snow Lattice (`snow-lattice-model`) | High | 582 | 198 | 532 | 14 | 371 | 4 | 9 |
| 32 | Superbloom (`the-desert-opens`) | High | 582 | 882 | 361 | 57 | 435 | 6 | 14 |
| 33 | Hill Town in Facets (`town-from-all-sides`) | High | 579 | 287 | 507 | 55 | 112 | 1 | 1 |
| 34 | Old Light Arriving (`old-light-arriving`) | High | 571 | 100 | 546 | 57 | 449 | 24 | 34 |
| 35 | The Comet Comes Apart (`comet-over-the-lake-town`) | High | 568 | 324 | 488 | 96 | 376 | 19 | 44 |
| 36 | The Organ Cave (`basalt-organ-cave`) | High | 565 | 1451 | 202 | 30 | 435 | 11 | 10 |
| 37 | Climbing the Tree City (`lamps-among-golden-leaves`) | High | 559 | 586 | 412 | 136 | 353 | 36 | 151 |
| 38 | The Ground Turns (`the-ground-turns`) | High | 551 | 299 | 476 | 13 | 94 | 4 | 0 |
| 39 | Green with the Rain (`green-with-the-rain`) | High | 549 | 1084 | 278 | 87 | 428 | 4 | 4 |
| 40 | A Dune Moving Cube by Cube (`walking-dune`) | High | 542 | 213 | 489 | 26 | 390 | 1 | 1 |
| 41 | Sulphur Burns Blue (`blue-fire-crater`) | High | 540 | 1291 | 217 | 23 | 463 | 6 | 2 |
| 42 | False Stars (`false-stars`) | High | 540 | 344 | 454 | 44 | 342 | 25 | 11 |
| 43 | The Raising of the Ger (`raising-the-ger`) | High | 534 | 164 | 492 | 58 | 275 | 17 | 17 |
| 44 | Storm over the Savanna (`storm-savanna`) | High | 533 | 280 | 463 | 64 | 503 | 21 | 47 |
| 45 | Waterfall of Tiles (`where-the-pattern-falls`) | High | 530 | 175 | 486 | 19 | 235 | 3 | 13 |
| 46 | Houses on Strings (`houses-on-strings`) | High | 527 | 432 | 419 | 30 | 369 | 9 | 9 |
| 47 | Pillars Before Trees (`pillars-before-trees`) | High | 520 | 516 | 391 | 123 | 392 | 18 | 5 |
| 48 | Fireworks in Wax and Ink (`fireworks-under-the-wash`) | High | 507 | 310 | 430 | 56 | 314 | 8 | 51 |
| 49 | The Wall of Dust (`mud-tower-haboob`) | High | 505 | 515 | 376 | 66 | 431 | 24 | 47 |
| 50 | Across on the Petals (`bridges-of-marigold`) | Medium | 494 | 432 | 386 | 52 | 375 | 11 | 48 |
| 51 | Three Shadows Each (`three-shadows-each`) | Medium | 492 | 694 | 318 | 57 | 343 | 15 | 2 |
| 52 | Heads Above the Poplars (`treetop-giants`) | Medium | 492 | 745 | 306 | 59 | 418 | 7 | 47 |
| 53 | The Mausoleum at Halicarnassus (`mausoleum-at-halicarnassus`) | Medium | 487 | 1532 | 104 | 75 | 453 | 63 | 21 |
| 54 | The Moth and the Telescope (`great-refractor`) | Medium | 480 | 1344 | 144 | 21 | 223 | 6 | 12 |
| 55 | The Hanging Gardens of Babylon (`hanging-gardens-of-babylon`) | Medium | 473 | 935 | 239 | 126 | 464 | 17 | 91 |
| 56 | The Colosseum at Its Opening Games (`flavian-amphitheatre`) | Medium | 467 | 397 | 368 | 34 | 460 | 10 | 12 |
| 57 | The Lake Takes Flight (`natron-liftoff`) | Medium | 461 | 270 | 393 | 40 | 429 | 20 | 24 |
| 58 | Every Reed a Metronome (`tempo-fen`) | Medium | 460 | 426 | 354 | 67 | 356 | 37 | 2 |
| 59 | The Other Side of Town (`the-other-side-of-town`) | Medium | 459 | 850 | 246 | 109 | 268 | 57 | 152 |
| 60 | The Deep End of the Vault (`sea-of-loose-coin`) | Medium | 456 | 340 | 372 | 73 | 234 | 5 | 63 |
| 61 | Valdrada, the City Built Twice (`city-doubled-in-its-lake`) | Medium | 453 | 861 | 237 | 69 | 427 | 4 | 64 |
| 62 | Three Million Bats (`deer-cave-exodus`) | Medium | 448 | 531 | 315 | 134 | 416 | 17 | 101 |
| 63 | Black Glass and Lava (`obsidian-forge`) | Medium | 444 | 790 | 247 | 40 | 369 | 23 | 14 |
| 64 | The Plain of Fans (`plain-of-fans`) | Medium | 444 | 312 | 366 | 37 | 407 | 7 | 10 |
| 65 | Inside a Growing Crystal (`where-the-lattice-grows`) | Medium | 442 | 152 | 404 | 31 | 130 | 30 | 1 |
| 66 | The Great Pyramid of Giza (`pyramid-of-khufu`) | Medium | 440 | 1452 | 77 | 99 | 389 | 17 | 93 |
| 67 | Backstage of a Painted Storm (`wooden-sea-stage`) | Medium | 435 | 1474 | 67 | 108 | 466 | 12 | 95 |
| 68 | The Field of Doors (`field-of-doors`) | Medium | 426 | 319 | 346 | 77 | 369 | 22 | 25 |
| 69 | The Tree That Is a Forest (`banyan-homecoming`) | Medium | 425 | 590 | 278 | 60 | 417 | 13 | 42 |
| 70 | Nobody Up Yet (`nobody-up-yet`) | Medium | 420 | 322 | 339 | 32 | 309 | 0 | 1 |
| 71 | Out the Nursery Window (`out-the-nursery-window`) | Medium | 416 | 1182 | 120 | 84 | 353 | 35 | 31 |
| 72 | Hammam of Stars (`hammam-of-stars`) | Medium | 414 | 1207 | 112 | 46 | 200 | 27 | 24 |
| 73 | The Drowned Domes (`drowned-domes`) | Medium | 407 | 1010 | 155 | 64 | 464 | 28 | 34 |
| 74 | The Cloudburst Local (`cloudburst-local`) | Medium | 405 | 686 | 233 | 79 | 384 | 24 | 67 |
| 75 | After the Sixth Sun (`after-the-sixth-sun`) | Medium | 403 | 365 | 312 | 62 | 346 | 21 | 35 |
| 76 | Museum of Frozen Weather (`frozen-weather-museum`) | Medium | 399 | 746 | 213 | 48 | 200 | 14 | 36 |
| 77 | Table for a Thousand (`tables-under-the-falling-sky`) | Medium | 398 | 1113 | 119 | 59 | 371 | 4 | 1 |
| 78 | The Swordbill's Round (`swordbill-round`) | Medium | 391 | 719 | 211 | 52 | 415 | 20 | 31 |
| 79 | Tram with a Red Balloon (`the-same-minute`) | Medium | 390 | 271 | 322 | 66 | 281 | 10 | 9 |
| 80 | The Iron Tide (`iron-tide`) | Medium | 389 | 270 | 321 | 61 | 374 | 11 | 7 |
| 81 | Kites at Uttarayan (`thousand-kite-roofs`) | Medium | 388 | 207 | 337 | 62 | 422 | 18 | 33 |
| 82 | A Bird's-Eye View of Paris (`towers-over-the-old-city`) | Medium | 384 | 714 | 206 | 60 | 408 | 4 | 1 |
| 83 | We Passed the Fields of Gazing Grain (`fields-of-gazing-grain`) | Medium | 376 | 1047 | 114 | 119 | 432 | 7 | 125 |
| 84 | Striped Tents Round a White Fire (`striped-tents-white-fire`) | Medium | 374 | 484 | 253 | 58 | 398 | 35 | 28 |
| 85 | A Beach in Fast Forward (`tenfold-every-two-seconds`) | Medium | 374 | 906 | 148 | 11 | 216 | 4 | 5 |
| 86 | A Ladybird Among the Dewdrops (`dew-garden`) | Medium | 372 | 364 | 281 | 89 | 355 | 25 | 4 |
| 87 | The Flinching Forest (`flinching-forest`) | Medium | 367 | 263 | 302 | 24 | 402 | 9 | 13 |
| 88 | Hall of a Million Mirrors (`million-mirrors`) | Medium | 367 | 684 | 196 | 69 | 296 | 13 | 16 |
| 89 | Holi over the Blue Roofs (`blue-city-holi`) | Medium | 362 | 354 | 273 | 52 | 349 | 4 | 18 |
| 90 | Light from the Left (`light-from-the-left`) | Medium | 359 | 698 | 185 | 48 | 360 | 6 | 6 |
| 91 | Slow Lightning (`the-leader`) | Medium | 357 | 314 | 278 | 42 | 359 | 30 | 28 |
| 92 | Mega Mendung (`batik-monsoon`) | Medium | 355 | 1025 | 99 | 30 | 437 | 3 | 19 |
| 93 | The Folding Market (`folding-market`) | Medium | 355 | 870 | 137 | 57 | 408 | 12 | 26 |
| 94 | The Jungle He Never Saw (`jungle-he-never-saw`) | Medium | 350 | 107 | 323 | 32 | 432 | 0 | 0 |
| 95 | Works Fine with Five Rings (`three-pegs-in-the-valley`) | Medium | 350 | 611 | 197 | 41 | 370 | 2 | 5 |
| 96 | Gemsbok out of the Sand (`wind-draws-the-namib`) | Medium | 350 | 315 | 272 | 28 | 453 | 11 | 20 |
| 97 | A Jungle Inside the Mountain (`cloud-in-the-cave`) | Medium | 349 | 1082 | 78 | 89 | 431 | 7 | 40 |
| 98 | Sunshafts in the Slot Canyon (`canyon-of-light`) | Medium | 348 | 1062 | 83 | 57 | 393 | 32 | 25 |
| 99 | The Moon in Dry Dock (`moon-in-dry-dock`) | Medium | 348 | 793 | 150 | 45 | 265 | 6 | 10 |
| 100 | The Temple of Artemis at Ephesus (`temple-of-artemis`) | Medium | 346 | 842 | 135 | 72 | 389 | 12 | 20 |
| 101 | Where the Doors Are Kept (`doors-in-transit`) | Medium | 342 | 186 | 295 | 42 | 285 | 7 | 4 |
| 102 | Sheer Ice (`seven-hundred-feet-of-ice`) | Medium | 341 | 496 | 217 | 106 | 374 | 12 | 81 |
| 103 | The Bamboo Sea (`bamboo-surf`) | Medium | 340 | 440 | 229 | 99 | 421 | 18 | 68 |
| 104 | The Door Under the Ivy (`garden-behind-the-ivy-wall`) | Medium | 340 | 627 | 184 | 92 | 459 | 5 | 66 |
| 105 | Walking Out the Airship (`airship-shed-dawn`) | Medium | 339 | 1097 | 64 | 51 | 380 | 8 | 46 |
| 106 | The Halls Between Sea and Cloud (`halls-between-sea-and-cloud`) | Medium | 339 | 1016 | 85 | 79 | 355 | 13 | 65 |
| 107 | The Chandelier City (`chandelier-city`) | Medium | 336 | 257 | 272 | 57 | 342 | 8 | 51 |
| 108 | A Hundred Springs Later (`stag-boulevard`) | Medium | 336 | 529 | 204 | 99 | 463 | 26 | 82 |
| 109 | A Sky Full of Model Planes (`tissue-and-balsa-meet`) | Medium | 336 | 244 | 275 | 64 | 307 | 44 | 39 |
| 110 | The Jade Range (`backlit-jade-range`) | Medium | 330 | 992 | 82 | 77 | 439 | 34 | 32 |
| 111 | A Very Small Universe (`the-way-back-round`) | Medium | 320 | 234 | 261 | 31 | 358 | 5 | 15 |
| 112 | The Long Necks' Ford (`sauropod-ford`) | Medium | 319 | 362 | 228 | 55 | 422 | 14 | 34 |
| 113 | Whales Down the Avenue (`after-rain-the-whales`) | Medium | 317 | 701 | 142 | 28 | 308 | 9 | 11 |
| 114 | A Tower Built to Burn (`pallet-tower-midsummer`) | Medium | 314 | 569 | 172 | 38 | 375 | 16 | 12 |
| 115 | Stepwell in the Monsoon (`first-rain-stepwell`) | Medium | 312 | 428 | 205 | 67 | 392 | 26 | 41 |
| 116 | A Great Huge Game of Chess (`country-in-squares`) | Medium | 309 | 165 | 268 | 162 | 427 | 36 | 49 |
| 117 | The Glass Birches (`ice-arcade`) | Medium | 309 | 436 | 200 | 51 | 388 | 15 | 35 |
| 118 | The Tisza in Flower (`mayfly-bloom`) | Medium | 309 | 258 | 244 | 52 | 411 | 4 | 47 |
| 119 | Crossing the Mara (`mara-crossing`) | Medium | 308 | 408 | 206 | 61 | 418 | 28 | 23 |
| 120 | Under the Snow Roof (`under-the-snow-roof`) | Medium | 305 | 598 | 155 | 58 | 329 | 13 | 46 |
| 121 | Hoopwind (`hoopwind-flats`) | Medium | 304 | 257 | 240 | 34 | 321 | 25 | 23 |
| 122 | Down the Ways (`slipway-blossom`) | Medium | 303 | 413 | 200 | 87 | 408 | 25 | 36 |
| 123 | The Saiga River (`mammoth-midnight-sun`) | Medium | 302 | 327 | 220 | 46 | 409 | 19 | 20 |
| 124 | Over the Rim (`over-the-rim`) | Medium | 302 | 546 | 165 | 57 | 437 | 11 | 21 |
| 125 | White with Gannets (`gannet-stack-gale`) | Medium | 301 | 306 | 224 | 36 | 402 | 16 | 15 |
| 126 | Surfing the Qiantang Bore (`silver-dragon-bore`) | Medium | 298 | 474 | 180 | 53 | 322 | 15 | 22 |
| 127 | The Red Drive Down to the Sea (`red-drive-down-to-the-sea`) | Medium | 297 | 520 | 167 | 126 | 396 | 15 | 93 |
| 128 | The Ring Run (`ring-run`) | Medium | 294 | 133 | 261 | 34 | 398 | 13 | 4 |
| 129 | The Shoebox Reef (`shoebox-reef`) | Medium | 294 | 699 | 119 | 99 | 252 | 51 | 50 |
| 130 | Up to the Rose Window (`glass-nave`) | Medium | 293 | 654 | 130 | 55 | 278 | 17 | 15 |
| 131 | Seabed Street (`sea-stands-open`) | Medium | 293 | 143 | 258 | 57 | 479 | 18 | 4 |
| 132 | Cables to the Moon (`cables-to-the-moon`) | Medium | 292 | 398 | 193 | 57 | 472 | 25 | 22 |
| 133 | Convent of Hidden Pictures (`one-standing-place`) | Medium | 291 | 550 | 153 | 35 | 326 | 8 | 21 |
| 134 | The Mountain That Reaches the Stars (`peak-above-the-singing-fields`) | Medium | 291 | 580 | 146 | 58 | 391 | 19 | 43 |
| 135 | The Pelican Peloton (`pelican-peloton`) | Medium | 289 | 114 | 260 | 44 | 396 | 0 | 42 |
| 136 | The Pier Comet (`pier-comet`) | Medium | 289 | 185 | 242 | 48 | 323 | 17 | 13 |
| 137 | The Garden Upside Down (`garden-upside-down`) | Medium | 288 | 514 | 159 | 69 | 441 | 16 | 22 |
| 138 | Isaura, the Lake Under the Town (`wells-over-the-buried-lake`) | Medium | 288 | 442 | 177 | 85 | 390 | 9 | 27 |
| 139 | The Fogged Palm House (`fogged-palm-house`) | Medium | 284 | 223 | 228 | 110 | 368 | 56 | 92 |
| 140 | The Town Under the Lid (`town-round-one-stair`) | Medium | 282 | 945 | 46 | 102 | 328 | 11 | 91 |
| 141 | Snow on Turquoise (`snow-on-turquoise`) | Medium | 281 | 570 | 139 | 51 | 394 | 11 | 68 |
| 142 | The Island Being Born (`island-being-born`) | Medium | 278 | 415 | 174 | 38 | 433 | 19 | 22 |
| 143 | The Tissue-Paper Pelicans (`pelican-collage`) | Medium | 278 | 176 | 234 | 39 | 400 | 4 | 37 |
| 144 | The Drawer Cliffs (`drawer-cliffs`) | Medium | 275 | 573 | 132 | 69 | 406 | 12 | 7 |
| 145 | The Hatch in the Forest Floor (`lamps-under-the-roots`) | Medium | 275 | 537 | 140 | 85 | 414 | 25 | 31 |
| 146 | That Enchanted Calm (`still-lake-in-the-herd`) | Medium | 275 | 171 | 232 | 46 | 419 | 16 | 32 |
| 147 | The Mother-of-Pearl Shoal (`mother-of-pearl-shoal`) | Medium | 271 | 191 | 223 | 23 | 310 | 8 | 17 |
| 148 | Count the Fingers (`hands-in-the-painted-cave`) | Medium | 270 | 202 | 219 | 36 | 164 | 21 | 32 |
| 149 | Stampede off the Cave Wall (`running-wall`) | Medium | 270 | 422 | 164 | 31 | 445 | 1 | 20 |
| 150 | The Tall Cloud (`the-tall-cloud`) | Medium | 270 | 237 | 211 | 42 | 317 | 4 | 37 |
| 151 | The Shaken Globe (`shaken-globe`) | Medium | 269 | 428 | 162 | 33 | 371 | 4 | 5 |
| 152 | The Day the Falls Flew Up (`upward-falls`) | Medium | 269 | 381 | 174 | 31 | 409 | 7 | 1 |
| 153 | The House of Four Seasons (`house-of-four-seasons`) | Medium | 267 | 575 | 124 | 134 | 306 | 43 | 187 |
| 154 | Castle Before the Tide (`castle-before-the-tide`) | Medium | 266 | 550 | 129 | 33 | 341 | 2 | 30 |
| 155 | Blueprint (`drafted-city`) | Medium | 266 | 66 | 249 | 16 | 114 | 11 | 10 |
| 156 | Otter in the Window Seat (`otter-in-the-window-seat`) | Medium | 265 | 218 | 210 | 38 | 359 | 13 | 13 |
| 157 | Rain at Walking Pace (`slow-rain-sea`) | Medium | 265 | 401 | 165 | 37 | 334 | 16 | 6 |
| 158 | The Calving (`the-calving`) | Medium | 265 | 293 | 192 | 41 | 414 | 9 | 13 |
| 159 | Gale in Green Glass (`gale-in-green-glass`) | Medium | 264 | 386 | 168 | 29 | 284 | 12 | 5 |
| 160 | Blue Sails on a Dry Sea (`blue-sails-dry-sea`) | Medium | 262 | 222 | 207 | 71 | 380 | 33 | 18 |
| 161 | The House That Opens to the Sea (`house-opens-seaward`) | Medium | 260 | 743 | 74 | 44 | 312 | 11 | 38 |
| 162 | Three-Tier Falls and a Rainbow (`valley-of-falls`) | Medium | 260 | 447 | 148 | 93 | 382 | 24 | 90 |
| 163 | Bison in the Coloured Steam (`prismatic-dawn`) | Medium | 259 | 158 | 220 | 34 | 364 | 15 | 31 |
| 164 | Checkerboard Approach (`checkerboard-approach`) | Medium | 259 | 715 | 80 | 89 | 417 | 35 | 29 |
| 165 | Right Angles Only (`sea-turns-square`) | Medium | 259 | 97 | 235 | 26 | 176 | 0 | 2 |
| 166 | Where the River Runs Chocolate (`valley-inside-the-works`) | Medium | 259 | 271 | 191 | 86 | 442 | 7 | 6 |
| 167 | The Water-Lit Hall (`net-on-the-vault`) | Watch | 258 | 882 | 37 | 19 | 100 | 0 | 2 |
| 168 | Spore Rain (`spore-rain`) | Watch | 258 | 514 | 130 | 147 | 428 | 8 | 150 |
| 169 | The Honey Cliff (`honey-cliff`) | Watch | 257 | 343 | 171 | 54 | 425 | 18 | 24 |
| 170 | Sixty Fountains (`sixty-fountains`) | Watch | 256 | 398 | 157 | 96 | 424 | 33 | 55 |
| 171 | Baucis, the City on Stilts (`city-on-stilts-above-the-cloud`) | Watch | 255 | 526 | 123 | 113 | 223 | 88 | 30 |
| 172 | The Gates in the Snow (`gates-in-the-snow`) | Watch | 251 | 40 | 241 | 60 | 393 | 18 | 48 |
| 173 | The Statue of Zeus at Olympia (`zeus-at-olympia`) | Watch | 251 | 668 | 84 | 141 | 411 | 10 | 32 |
| 174 | The Gold-Wire Harbour (`cloisonne-typhoon`) | Watch | 250 | 758 | 61 | 52 | 137 | 9 | 49 |
| 175 | The Stitched Country (`stitched-country`) | Watch | 250 | 124 | 219 | 42 | 375 | 5 | 5 |
| 176 | Down Through the Fog (`back-to-us-above-the-fog`) | Watch | 248 | 835 | 39 | 42 | 327 | 7 | 28 |
| 177 | The Gate Meant for You Alone (`courts-in-the-attics`) | Watch | 248 | 554 | 109 | 22 | 323 | 9 | 6 |
| 178 | The Country with No Up (`country-with-no-up`) | Watch | 247 | 335 | 163 | 21 | 156 | 14 | 5 |
| 179 | The Singing Erg (`singing-erg`) | Watch | 247 | 256 | 183 | 30 | 362 | 14 | 3 |
| 180 | The Hill of Round Doors (`hill-of-round-doors`) | Watch | 246 | 181 | 201 | 84 | 429 | 15 | 52 |
| 181 | Weaves Algebraical Patterns (`loom-of-numbers`) | Watch | 246 | 523 | 116 | 72 | 316 | 7 | 2 |
| 182 | Up to the Monastery in a Net (`net-up-the-pillar`) | Watch | 246 | 469 | 129 | 65 | 448 | 19 | 29 |
| 183 | Patio of Three Thousand Pots (`patio-of-pots`) | Watch | 244 | 543 | 108 | 45 | 373 | 9 | 35 |
| 184 | One Blue Box, Four Skies (`boathouse-full-of-morning`) | Watch | 243 | 620 | 88 | 75 | 258 | 8 | 75 |
| 185 | The Garden of Sixty Gardens (`garden-of-sixty-gardens`) | Watch | 243 | 229 | 186 | 31 | 435 | 0 | 30 |
| 186 | The Midwinter Express (`snowbound-viaduct`) | Watch | 242 | 290 | 170 | 95 | 408 | 36 | 65 |
| 187 | Where the Horses Are Blue (`where-horses-are-blue`) | Watch | 242 | 590 | 95 | 40 | 425 | 28 | 11 |
| 188 | What the Ocean Builds (`what-the-ocean-builds`) | Watch | 241 | 470 | 124 | 26 | 353 | 7 | 9 |
| 189 | Paperclips, As Requested (`every-last-wire`) | Watch | 240 | 303 | 164 | 17 | 301 | 12 | 14 |
| 190 | The Koi the Rain Falls Through (`neon-monsoon`) | Watch | 240 | 386 | 144 | 76 | 226 | 36 | 29 |
| 191 | The Cockerel Wall (`tiled-cockerel-kitchen`) | Watch | 240 | 694 | 66 | 36 | 382 | 17 | 14 |
| 192 | Twelve Metres of Tide (`twelve-metre-tide`) | Watch | 237 | 640 | 77 | 40 | 310 | 16 | 16 |
| 193 | Fedora, the Cities It Might Have Been (`blue-cities-in-glass-globes`) | Watch | 236 | 369 | 144 | 76 | 374 | 30 | 6 |
| 194 | The Blown-Glass City (`blown-city`) | Watch | 236 | 447 | 124 | 63 | 357 | 18 | 52 |
| 195 | Bridge Towers Above the Fog (`fog-river-bridge`) | Watch | 236 | 158 | 196 | 49 | 237 | 25 | 11 |
| 196 | River of Five Colours (`five-colour-river`) | Watch | 234 | 399 | 134 | 94 | 382 | 20 | 100 |
| 197 | The Sledge Between the Volcanoes (`sledge-between-volcanoes`) | Watch | 234 | 418 | 129 | 43 | 320 | 16 | 15 |
| 198 | Cloud-Capped Towers (`storm-that-drowned-no-one`) | Watch | 234 | 500 | 109 | 59 | 401 | 24 | 30 |
| 199 | Volcano Plume on an Airless Moon (`brimstone-parasol`) | Watch | 233 | 180 | 188 | 37 | 344 | 19 | 2 |
| 200 | The Thousand Lagoons (`thousand-lagoons`) | Watch | 232 | 227 | 175 | 30 | 414 | 15 | 6 |
| 201 | The Bone Garden (`whale-fall-garden`) | Watch | 230 | 279 | 160 | 35 | 391 | 7 | 5 |
| 202 | Airbrushed Black Hole (`airbrush-black-hole`) | Watch | 227 | 707 | 51 | 18 | 97 | 11 | 9 |
| 203 | Sea of Wax (`sea-sets-in-shade`) | Watch | 227 | 341 | 142 | 20 | 391 | 1 | 4 |
| 204 | The Walking Boulders (`boulders-that-walk`) | Watch | 226 | 90 | 204 | 69 | 401 | 26 | 8 |
| 205 | The Umbrella Forest (`dragons-blood-fog`) | Watch | 226 | 599 | 76 | 48 | 412 | 15 | 3 |
| 206 | Fire of the Moon Jars (`moon-jar-kiln`) | Watch | 226 | 613 | 73 | 49 | 257 | 29 | 8 |
| 207 | The Footprints of a Gigantic Hound (`moor-under-the-fog-bank`) | Watch | 226 | 448 | 114 | 123 | 388 | 31 | 49 |
| 208 | Rails at High Water (`railway-under-the-sea`) | Watch | 225 | 146 | 189 | 74 | 354 | 11 | 11 |
| 209 | Under the Fibre-Optic Willow (`glowwood`) | Watch | 224 | 296 | 150 | 95 | 477 | 26 | 90 |
| 210 | The Street Goes Up (`the-street-goes-up`) | Watch | 224 | 546 | 87 | 53 | 385 | 7 | 6 |
| 211 | The Inside-Out World (`inside-out-world`) | Watch | 223 | 178 | 178 | 72 | 389 | 24 | 43 |
| 212 | Whittled Winter (`curl-tree-winter`) | Watch | 222 | 143 | 186 | 96 | 415 | 11 | 46 |
| 213 | The Peacock Lakes (`drowned-forest-lakes`) | Watch | 221 | 443 | 110 | 66 | 452 | 16 | 48 |
| 214 | Stripes of April (`pastel-bulb-fields`) | Watch | 221 | 200 | 171 | 41 | 261 | 3 | 25 |
| 215 | Redwood Dawn (`redwood-dawn`) | Watch | 221 | 439 | 111 | 94 | 446 | 43 | 64 |
| 216 | Against the Falls (`salmon-falls`) | Watch | 221 | 422 | 116 | 115 | 417 | 19 | 85 |
| 217 | Okavango in Flood (`delta-in-flood`) | Watch | 220 | 219 | 165 | 65 | 436 | 17 | 64 |
| 218 | The Country Mended with Gold (`mended-country`) | Watch | 219 | 530 | 86 | 16 | 308 | 6 | 4 |
| 219 | Ten Past Ten (`ten-past-ten`) | Watch | 219 | 194 | 170 | 42 | 306 | 13 | 4 |
| 220 | The Sea Above (`the-sea-above`) | Watch | 219 | 108 | 192 | 75 | 350 | 22 | 43 |
| 221 | Zoetrope (`wheel-of-life`) | Watch | 219 | 437 | 109 | 58 | 466 | 2 | 55 |
| 222 | Down the Maelstrom (`maelstrom-descent`) | Watch | 218 | 393 | 120 | 35 | 273 | 12 | 11 |
| 223 | The Chinar Terraces (`chinar-water-terraces`) | Watch | 217 | 439 | 108 | 56 | 379 | 12 | 31 |
| 224 | The Clay Lick (`macaw-wall`) | Watch | 217 | 282 | 146 | 80 | 411 | 27 | 106 |
| 225 | Wool on the Thorn (`carded-moor`) | Watch | 216 | 268 | 149 | 66 | 401 | 17 | 40 |
| 226 | Launch Row (`four-colour-launch`) | Watch | 216 | 108 | 188 | 63 | 412 | 9 | 9 |
| 227 | A Light in Every Dark Place (`light-in-every-dark-place`) | Watch | 216 | 310 | 138 | 52 | 368 | 22 | 6 |
| 228 | A Bow-Shot Between Them (`strait-between-two-rocks`) | Watch | 216 | 442 | 105 | 25 | 383 | 2 | 10 |
| 229 | Nine Storeys of Sails (`salt-wind-city`) | Watch | 214 | 329 | 132 | 93 | 458 | 25 | 79 |
| 230 | Small Flat with Ballroom (`ball-inside-the-small-flat`) | Watch | 213 | 427 | 106 | 40 | 248 | 9 | 20 |
| 231 | The Galleon Among the Flowers (`galleon-in-the-flowers`) | Watch | 213 | 550 | 76 | 62 | 403 | 13 | 54 |
| 232 | The Eiffel Tower by Gaslight (`iron-tower-first-night`) | Watch | 213 | 225 | 157 | 46 | 253 | 16 | 10 |
| 233 | The Ember Moon (`ember-moon-tide`) | Watch | 212 | 324 | 131 | 37 | 290 | 10 | 1 |
| 234 | Lighthouse in a Four-Storey Swell (`tempest-light`) | Watch | 212 | 290 | 139 | 29 | 165 | 18 | 13 |
| 235 | The City in the Lake (`city-in-the-lake`) | Watch | 208 | 554 | 70 | 53 | 269 | 9 | 46 |
| 236 | Night by the Slice (`night-by-the-slice`) | Watch | 207 | 338 | 122 | 54 | 329 | 16 | 35 |
| 237 | Octavia, the City Hung Below Its Net (`city-hung-below-its-net`) | Watch | 206 | 361 | 116 | 81 | 395 | 16 | 68 |
| 238 | Raindrop Trees (`forest-from-a-drop`) | Watch | 206 | 148 | 169 | 44 | 318 | 19 | 9 |
| 239 | A Hall Roofed with Weather (`hall-roofed-with-weather`) | Watch | 206 | 175 | 162 | 37 | 304 | 13 | 8 |
| 240 | Violet Ribbons, Green Banner (`sown-with-cloth`) | Watch | 206 | 194 | 158 | 39 | 420 | 1 | 14 |
| 241 | The Signal Yard Goes Green (`the-yard-goes-green`) | Watch | 205 | 63 | 189 | 51 | 156 | 46 | 26 |
| 242 | Across the Sea of Ice (`across-the-sea-of-ice`) | Watch | 204 | 212 | 151 | 70 | 233 | 29 | 42 |
| 243 | The Breach at Gibraltar (`atlantic-falls-in`) | Watch | 204 | 457 | 90 | 26 | 352 | 7 | 7 |
| 244 | Shade Full of Stars (`night-under-the-oaks`) | Watch | 204 | 163 | 163 | 37 | 363 | 7 | 14 |
| 245 | A Kettle of Storks (`stork-kettle-riso`) | Watch | 204 | 176 | 160 | 52 | 365 | 2 | 7 |
| 246 | Caverns Measureless to Man (`river-that-sinks-under-the-garden`) | Watch | 202 | 327 | 120 | 94 | 381 | 37 | 102 |
| 247 | The Road Through the Poppies (`green-gate-past-the-poppies`) | Watch | 198 | 387 | 101 | 75 | 276 | 13 | 71 |
| 248 | The River Tied in a Knot (`knotted-river`) | Watch | 198 | 227 | 141 | 25 | 322 | 5 | 4 |
| 249 | Twenty Floods (`twenty-floods`) | Watch | 198 | 369 | 106 | 35 | 349 | 16 | 18 |
| 250 | Night Inside the Circle (`where-circles-hum`) | Watch | 198 | 126 | 166 | 31 | 68 | 29 | 28 |
| 251 | The Huddle (`emperor-clearing`) | Watch | 196 | 345 | 109 | 26 | 418 | 9 | 9 |
| 252 | The Mountain of Four Elements (`mountain-of-four-elements`) | Watch | 196 | 358 | 106 | 37 | 328 | 15 | 13 |
| 253 | From Lichen to Delta (`the-branching`) | Watch | 196 | 238 | 136 | 24 | 424 | 7 | 19 |
| 254 | Brick Above the Cloud (`brick-outgrows-the-cloud`) | Watch | 195 | 88 | 173 | 85 | 415 | 1 | 3 |
| 255 | The Carved House in Snow (`carved-house-in-snow`) | Watch | 195 | 252 | 132 | 34 | 378 | 18 | 12 |
| 256 | Four Stone Kings over the River (`four-stone-kings-over-the-river`) | Watch | 195 | 180 | 150 | 61 | 337 | 8 | 37 |
| 257 | Sophronia, Palaces on Wagons (`half-city-of-the-fair`) | Watch | 195 | 248 | 133 | 38 | 460 | 4 | 19 |
| 258 | Shark Pass (`atoll-pass-shark-wall`) | Watch | 194 | 245 | 132 | 51 | 375 | 7 | 13 |
| 259 | The Frieze Without End (`frieze-without-end`) | Watch | 194 | 184 | 148 | 77 | 393 | 6 | 8 |
| 260 | The Carousel Works (`carousel-works`) | Watch | 193 | 329 | 110 | 89 | 420 | 30 | 16 |
| 261 | The Hanging Meadow (`hanging-sea-lilies`) | Watch | 193 | 91 | 171 | 27 | 403 | 4 | 10 |
| 262 | The House with Its Roof Blown Off (`morning-after-the-gale`) | Watch | 193 | 263 | 127 | 61 | 423 | 0 | 43 |
| 263 | Five Geese to the Moon Gate (`thousand-li-blue-green`) | Watch | 191 | 406 | 90 | 48 | 185 | 10 | 4 |
| 264 | The Well of Rain (`well-of-rain`) | Watch | 191 | 171 | 149 | 54 | 393 | 31 | 20 |
| 265 | Behind the Waterfall (`house-behind-the-waterfall`) | Watch | 190 | 196 | 141 | 120 | 356 | 49 | 131 |
| 266 | The Turning Herd (`reindeer-cyclone`) | Watch | 190 | 280 | 120 | 46 | 414 | 11 | 7 |
| 267 | Inside the Manta Cyclone (`manta-cyclone`) | Watch | 189 | 111 | 161 | 23 | 349 | 8 | 4 |
| 268 | The Long Shelves of Memory (`shelves-of-lit-memories`) | Watch | 189 | 333 | 106 | 92 | 358 | 20 | 19 |
| 269 | Flying Boat Bay (`flying-boat-karst-bay`) | Watch | 188 | 401 | 88 | 53 | 324 | 29 | 38 |
| 270 | Corniche at 120 BPM (`corniche-120`) | Watch | 187 | 84 | 166 | 25 | 133 | 15 | 1 |
| 271 | Last Morning of the Cretaceous (`crescent-over-yucatan`) | Watch | 187 | 277 | 118 | 27 | 322 | 10 | 3 |
| 272 | The Geode Run (`geode-run`) | Watch | 187 | 232 | 130 | 38 | 246 | 6 | 4 |
| 273 | Five Masts and a Half Sun (`liquid-crystal-squall`) | Watch | 187 | -15 | 191 | 42 | 131 | 0 | 0 |
| 274 | The Longest Animal (`longest-animal`) | Watch | 185 | 52 | 172 | 33 | 338 | 23 | 1 |
| 275 | Highway Through a Living Cell (`cell-highway`) | Watch | 184 | 445 | 73 | 23 | 280 | 4 | 6 |
| 276 | Where Ships Go to Live (`hull-town`) | Watch | 183 | 292 | 110 | 82 | 427 | 38 | 43 |
| 277 | The Marigold Way Home (`marigold-way-home`) | Watch | 183 | 190 | 135 | 48 | 369 | 12 | 17 |
| 278 | The Attic Line (`attic-railway`) | Watch | 182 | 249 | 120 | 45 | 452 | 13 | 7 |
| 279 | The Cloud Armada (`cloud-armada`) | Watch | 182 | 248 | 121 | 46 | 429 | 16 | 12 |
| 280 | The Colossus of Rhodes (`colossus-of-rhodes`) | Watch | 182 | 321 | 102 | 99 | 335 | 32 | 36 |
| 281 | The Morning Lift (`crane-harbour`) | Watch | 182 | 192 | 134 | 63 | 361 | 16 | 18 |
| 282 | Kolam at Dawn (`kolam-at-dawn`) | Watch | 182 | 253 | 119 | 33 | 345 | 13 | 11 |
| 283 | The Sunken Colossus (`sunken-colossus`) | Watch | 182 | 114 | 153 | 61 | 448 | 9 | 72 |
| 284 | The Painted Ridges (`painted-ridges`) | Watch | 180 | 462 | 65 | 59 | 440 | 18 | 50 |
| 285 | Library with a Brass Orrery (`long-library`) | Watch | 180 | 151 | 142 | 88 | 382 | 19 | 20 |
| 286 | Norther on the Malecón (`malecon-norther`) | Watch | 180 | 428 | 73 | 93 | 335 | 17 | 82 |
| 287 | House Inside a House (`house-in-the-niche`) | Low | 178 | 269 | 111 | 28 | 371 | 19 | 10 |
| 288 | Keep Refrigerated (`the-light-comes-on`) | Low | 177 | 254 | 114 | 51 | 371 | 40 | 7 |
| 289 | The World Turtle (`world-turtle`) | Low | 177 | 64 | 161 | 53 | 424 | 28 | 8 |
| 290 | The Ice Finger (`brinicle-ice-finger`) | Low | 172 | 160 | 132 | 38 | 341 | 20 | 5 |
| 291 | Heavy Things on a Sheet (`heavy-things-on-a-sheet`) | Low | 172 | 351 | 85 | 29 | 358 | 8 | 12 |
| 292 | The Last Lit Windows (`last-lit-windows`) | Low | 172 | 243 | 111 | 55 | 390 | 26 | 14 |
| 293 | Devil Rays in Pencil (`pencil-test-rays`) | Low | 171 | 85 | 150 | 113 | 374 | 0 | 109 |
| 294 | Bouncy Castle Town (`town-kept-up-by-fans`) | Low | 171 | 76 | 152 | 52 | 417 | 14 | 1 |
| 295 | The Carillon Grove (`carillon-grove`) | Low | 170 | 248 | 108 | 43 | 352 | 30 | 13 |
| 296 | The Gilded Margin (`gilded-margin`) | Low | 170 | 100 | 146 | 32 | 360 | 13 | 17 |
| 297 | Mountains of Wet Ink (`ink-dragon`) | Low | 170 | 164 | 129 | 38 | 328 | 23 | 36 |
| 298 | Stairway Everywhere (`stairway-everywhere`) | Low | 170 | 322 | 89 | 76 | 408 | 24 | 25 |
| 299 | Matryoshka Mountain (`turned-country`) | Low | 170 | 180 | 125 | 47 | 457 | 4 | 1 |
| 300 | Lava Among the Dunes (`fire-in-the-sand-sea`) | Low | 168 | 276 | 99 | 37 | 356 | 23 | 10 |
| 301 | The Bed Went Walking (`bed-went-walking`) | Low | 167 | 102 | 142 | 48 | 332 | 0 | 8 |
| 302 | Cloth Turning Indigo (`indigo-pits`) | Low | 167 | 223 | 111 | 34 | 354 | 14 | 16 |
| 303 | Living Balloons over a Gas Giant (`storm-bands`) | Low | 167 | 276 | 98 | 25 | 345 | 16 | 12 |
| 304 | The Chamak Road (`chamak-road`) | Low | 166 | 307 | 90 | 62 | 333 | 21 | 34 |
| 305 | The Forest Before Flowers (`scale-tree-mire`) | Low | 164 | 224 | 108 | 56 | 403 | 16 | 12 |
| 306 | One Drop (`pond-drop`) | Low | 163 | 54 | 150 | 29 | 256 | 20 | 13 |
| 307 | Coronal Rain (`coronal-rain`) | Low | 162 | 162 | 122 | 17 | 317 | 13 | 3 |
| 308 | The Line Along the River of Stars (`line-along-the-river-of-stars`) | Low | 162 | 144 | 126 | 81 | 320 | 27 | 53 |
| 309 | A Hundred Bells Below Stairs (`bells-before-breakfast`) | Low | 161 | 205 | 109 | 130 | 405 | 36 | 38 |
| 310 | The Wind's Long Hair (`whiplash-wind`) | Low | 161 | 116 | 132 | 46 | 324 | 1 | 33 |
| 311 | Skin of a Bubble (`bubble-skin`) | Low | 160 | 368 | 68 | 26 | 160 | 21 | 14 |
| 312 | Rings in the Tea Mist (`tulou-rings`) | Low | 160 | 243 | 100 | 47 | 341 | 24 | 28 |
| 313 | Low Tide Under a Ringed Planet (`ringed-shore`) | Low | 159 | 146 | 123 | 42 | 317 | 14 | 33 |
| 314 | Sail Until the Horizon Stops (`sky-with-a-seam`) | Low | 159 | 418 | 54 | 41 | 305 | 29 | 27 |
| 315 | Kelp Cathedral (`kelp-cathedral`) | Low | 158 | 208 | 106 | 122 | 408 | 14 | 85 |
| 316 | Alpenglow (`alpenglow-horn`) | Low | 157 | 315 | 79 | 56 | 394 | 13 | 22 |
| 317 | Ribs of the Unfinished Ship (`hull-in-frames`) | Low | 157 | 255 | 93 | 64 | 368 | 25 | 25 |
| 318 | A Balloon at Polar Midnight (`night-shining`) | Low | 156 | 326 | 74 | 19 | 148 | 14 | 4 |
| 319 | A Sea Hung in Globes (`beaded-sea`) | Low | 155 | 216 | 101 | 55 | 394 | 13 | 28 |
| 320 | The Khlong Run (`khlong-run`) | Low | 155 | 303 | 79 | 70 | 407 | 13 | 66 |
| 321 | The Mountain City Line (`through-the-tower`) | Low | 155 | 224 | 99 | 114 | 460 | 27 | 71 |
| 322 | The Glaze Stops at the Knees (`glaze-stops-at-the-knees`) | Low | 154 | 116 | 125 | 68 | 485 | 4 | 1 |
| 323 | Still Waving (`still-waving`) | Low | 154 | 114 | 125 | 49 | 384 | 10 | 14 |
| 324 | Eclipse over the Storm Tops (`the-umbra`) | Low | 154 | 373 | 61 | 17 | 288 | 9 | 3 |
| 325 | Perihelion (`comet-perihelion`) | Low | 153 | 160 | 113 | 26 | 402 | 15 | 2 |
| 326 | Macramé Forest (`forest-tied-from-above`) | Low | 153 | 109 | 125 | 36 | 410 | 0 | 37 |
| 327 | The Chambered Sun (`chambered-sun`) | Low | 152 | 294 | 78 | 41 | 329 | 17 | 12 |
| 328 | Palms Beyond the Pack Ice (`harbour-in-the-aurora`) | Low | 151 | 285 | 80 | 40 | 296 | 8 | 6 |
| 329 | The Lighthouse Lens (`lens-works`) | Low | 150 | 466 | 33 | 41 | 239 | 9 | 7 |
| 330 | The Pedalling Bones (`pedalling-bones`) | Low | 150 | 345 | 64 | 33 | 364 | 1 | 30 |
| 331 | The Lighthouse of Alexandria (`pharos-of-alexandria`) | Low | 150 | 310 | 73 | 47 | 405 | 13 | 12 |
| 332 | The Wood Behind the Coats (`wood-behind-the-coats`) | Low | 150 | 234 | 92 | 103 | 364 | 20 | 87 |
| 333 | The Shore Without a Horizon (`shore-without-horizon`) | Low | 149 | 54 | 135 | 77 | 318 | 23 | 60 |
| 334 | A Moon Pulls Up the Sea (`standing-tide`) | Low | 148 | 152 | 110 | 36 | 338 | 12 | 16 |
| 335 | Isles of Jewelled Eggs (`engine-turned-sea`) | Low | 147 | 231 | 89 | 47 | 374 | 2 | 31 |
| 336 | The Field in Thick Paint (`field-in-thick-paint`) | Low | 147 | 253 | 84 | 76 | 388 | 2 | 72 |
| 337 | The Green Room (`the-green-room`) | Low | 147 | 288 | 75 | 25 | 135 | 11 | 10 |
| 338 | Slalom Through Five Waterspouts (`waterspout-sisters`) | Low | 147 | 292 | 74 | 60 | 171 | 50 | 5 |
| 339 | The Sundial Stair (`stair-that-points-at-the-pole`) | Low | 146 | 481 | 26 | 16 | 93 | 2 | 1 |
| 340 | What Happened Here (`what-happened-here`) | Low | 146 | 493 | 23 | 22 | 26 | 10 | 6 |
| 341 | The Upside-Down Pools (`mirror-chimneys`) | Low | 145 | 266 | 79 | 31 | 430 | 10 | 12 |
| 342 | The Valley Unzips (`the-valley-unzips`) | Low | 145 | 122 | 115 | 62 | 428 | 1 | 6 |
| 343 | A Contrail, Flown Backwards (`dawn-tracks-contrail`) | Low | 144 | 196 | 95 | 31 | 317 | 24 | 12 |
| 344 | Strawberries the Size of Houses (`lake-of-pink-fountains`) | Low | 143 | 82 | 122 | 92 | 445 | 8 | 86 |
| 345 | Mola Reef (`mola-reef`) | Low | 143 | 304 | 67 | 35 | 243 | 1 | 28 |
| 346 | The Cut Mountain (`cut-mountain`) | Low | 142 | 234 | 84 | 45 | 447 | 3 | 39 |
| 347 | The Green Arctic Sea (`fern-sea-midnight`) | Low | 142 | 182 | 97 | 37 | 395 | 5 | 14 |
| 348 | The Floor Without Windows (`floor-without-windows`) | Low | 142 | 233 | 84 | 47 | 256 | 10 | 9 |
| 349 | Wormhole over the Sea (`the-throat`) | Low | 142 | 529 | 10 | 1 | 0 | 0 | 0 |
| 350 | The Study at Mouse Height (`study-at-mouse-height`) | Low | 141 | 293 | 68 | 59 | 149 | 16 | 7 |
| 351 | Garden on an Egyptian Wall (`garden-in-plan`) | Low | 140 | 203 | 89 | 21 | 240 | 0 | 13 |
| 352 | Diomira, Silver Domes at Lamp-Lighting (`silver-domes-and-streets-of-lead`) | Low | 140 | 293 | 66 | 32 | 408 | 8 | 1 |
| 353 | Ichthyosaur in the Shallows (`titan-strait`) | Low | 138 | 206 | 86 | 34 | 392 | 8 | 9 |
| 354 | The Hundred-Segment Dragon (`dragon-kite-loft`) | Low | 137 | 278 | 68 | 64 | 354 | 12 | 15 |
| 355 | Twelve Waterfalls off a Floating Island (`sky-archipelago`) | Low | 137 | 270 | 69 | 75 | 382 | 20 | 33 |
| 356 | Lanterns Under the Ice (`lanterns-under-ice`) | Low | 136 | 120 | 105 | 81 | 420 | 41 | 63 |
| 357 | Not Giants but Windmills (`plain-with-two-sides`) | Low | 136 | 218 | 82 | 136 | 370 | 14 | 41 |
| 358 | The Sapphire Race (`sapphire-moulin`) | Low | 135 | 141 | 100 | 55 | 347 | 35 | 25 |
| 359 | The Morning Everything Got Loose (`shoal-over-the-high-street`) | Low | 134 | 185 | 88 | 57 | 338 | 1 | 1 |
| 360 | The Red Weed (`the-red-weed`) | Low | 134 | 210 | 81 | 56 | 375 | 20 | 26 |
| 361 | Mangroves, Half Under Water (`tideline-cloister`) | Low | 134 | 149 | 96 | 50 | 210 | 11 | 17 |
| 362 | Seven Rooms and One Clock (`seven-rooms-one-clock`) | Low | 132 | 422 | 26 | 27 | 171 | 10 | 1 |
| 363 | The Combed Sea (`combed-sea`) | Low | 131 | 421 | 25 | 12 | 131 | 4 | 1 |
| 364 | The Night the Kurbits Grew (`kurbits-night`) | Low | 131 | 17 | 126 | 132 | 408 | 0 | 128 |
| 365 | First Tracks (`snow-ghosts`) | Low | 131 | 154 | 93 | 66 | 378 | 20 | 16 |
| 366 | River with a Pulse (`amber-reticulum`) | Low | 130 | 237 | 71 | 33 | 390 | 4 | 1 |
| 367 | The Harbour of One Lamp (`harbour-of-one-lamp`) | Low | 130 | 320 | 50 | 37 | 194 | 6 | 39 |
| 368 | The Wine-Dark Cup (`wine-dark-cup`) | Low | 129 | 61 | 114 | 42 | 428 | 2 | 1 |
| 369 | Three Seas Deep (`canyon-of-three-airs`) | Low | 128 | 251 | 65 | 37 | 405 | 18 | 4 |
| 370 | Cast Off (`cast-off-sound`) | Low | 128 | 109 | 101 | 62 | 403 | 13 | 16 |
| 371 | The Milky Sea (`milky-sea`) | Low | 127 | 193 | 79 | 32 | 199 | 12 | 22 |
| 372 | The City That Left (`the-city-that-left`) | Low | 126 | 282 | 56 | 93 | 333 | 15 | 25 |
| 373 | Aurora Fjord (`aurora-fjord`) | Low | 125 | 255 | 62 | 58 | 394 | 28 | 22 |
| 374 | Lantern Night in the River Town (`lantern-river`) | Low | 123 | 125 | 92 | 58 | 404 | 13 | 20 |
| 375 | The Room Turning Red (`room-turning-red`) | Low | 123 | 200 | 73 | 87 | 138 | 0 | 34 |
| 376 | The Elk Who Carries the Sun (`sun-in-the-antlers`) | Low | 123 | 122 | 93 | 29 | 347 | 5 | 6 |
| 377 | Thirty-Seven Stones, One Falling (`stone-on-the-fifth-line`) | Low | 121 | 122 | 90 | 50 | 374 | 11 | 9 |
| 378 | The Striking Hour (`the-striking-hour`) | Low | 121 | 166 | 80 | 79 | 225 | 12 | 72 |
| 379 | The Pencil Railway (`line-through-the-hill`) | Low | 117 | 218 | 63 | 45 | 285 | 1 | 25 |
| 380 | Fired Through the Cash Tubes (`pneumatic-emporium`) | Low | 117 | 136 | 83 | 54 | 408 | 20 | 55 |
| 381 | Seventy-Eight in the Rain (`seventy-eight-in-the-rain`) | Low | 117 | 226 | 61 | 31 | 237 | 11 | 2 |
| 382 | Every Wingbeat Stays (`every-wingbeat-stays`) | Low | 116 | 24 | 110 | 16 | 255 | 1 | 1 |
| 383 | Palace of the First Rain (`first-rain-palace`) | Low | 116 | 188 | 69 | 24 | 236 | 1 | 18 |
| 384 | The Lemon Cliffs (`lemon-cliffs`) | Low | 116 | 47 | 104 | 24 | 312 | 1 | 2 |
| 385 | The Cabinetmaker's Harbour (`roll-top-harbour`) | Low | 116 | 254 | 53 | 37 | 198 | 1 | 5 |
| 386 | Seismograph Mountains (`written-range`) | Low | 116 | 177 | 72 | 23 | 317 | 0 | 19 |
| 387 | Cranes in the Steam (`cranes-in-steam`) | Low | 114 | 154 | 76 | 86 | 376 | 18 | 77 |
| 388 | Small Planet, Empty Chair (`forty-four-sunsets`) | Low | 114 | 187 | 67 | 41 | 319 | 11 | 5 |
| 389 | Still Warm (`still-warm`) | Low | 114 | 320 | 34 | 13 | 219 | 3 | 3 |
| 390 | The Balloon Stands Up Around You (`envelope-at-dawn`) | Low | 113 | 154 | 74 | 17 | 366 | 4 | 1 |
| 391 | Bridge of Light over the Falling Sea (`asgard-bridge-of-light`) | Low | 112 | 221 | 57 | 52 | 251 | 29 | 42 |
| 392 | The Engraved Sea (`engraved-sea-chart`) | Low | 112 | 121 | 81 | 51 | 375 | 12 | 1 |
| 393 | The Ladder Orchard (`ladder-orchard`) | Low | 111 | 55 | 97 | 16 | 106 | 14 | 2 |
| 394 | Ninety Bell Towers at Dusk (`dial-towers-at-dusk`) | Low | 109 | 47 | 97 | 18 | 393 | 10 | 1 |
| 395 | Inside the Great Wave (`hollow-of-the-wave`) | Low | 109 | 60 | 94 | 26 | 412 | 0 | 1 |
| 396 | Some Assembly Required (`still-on-the-sprue`) | Low | 109 | 72 | 90 | 34 | 366 | 11 | 4 |
| 397 | Honeycomb of Books (`shaft-between-the-hexagons`) | Low | 108 | 126 | 76 | 98 | 306 | 5 | 149 |
| 398 | Fish into Geese (`figure-and-ground`) | Low | 106 | 30 | 99 | 17 | 263 | 0 | 7 |
| 399 | Squall in Oils (`squall-of-light`) | Low | 105 | 295 | 32 | 49 | 65 | 19 | 27 |
| 400 | Leaves of Silver, Gold and Diamond (`three-avenues-under-the-floor`) | Low | 105 | 152 | 67 | 79 | 345 | 14 | 75 |
| 401 | Orbital Sunrise (`orbit-dawn`) | Low | 104 | 125 | 72 | 39 | 218 | 12 | 4 |
| 402 | Glass Under Strain (`weight-of-glass`) | Low | 104 | 139 | 69 | 28 | 407 | 18 | 2 |
| 403 | The Unrolling Wood (`unrolling-wood`) | Low | 103 | 52 | 90 | 36 | 439 | 4 | 0 |
| 404 | Breakfast Kingdom (`breakfast-table`) | Low | 102 | 204 | 51 | 54 | 265 | 11 | 11 |
| 405 | Glider Country (`glider-country`) | Low | 102 | 95 | 78 | 9 | 209 | 1 | 3 |
| 406 | Carved in Red Lacquer (`hundred-layer-red`) | Low | 101 | 126 | 69 | 49 | 364 | 1 | 7 |
| 407 | Market of Stone Trees (`chains-turned-to-stone`) | Low | 100 | 246 | 39 | 38 | 307 | 3 | 31 |
| 408 | Strapped to a Rocket (`uphill-to-black`) | Low | 99 | 217 | 45 | 32 | 166 | 13 | 10 |
| 409 | An Island in the Air (`island-that-shades-the-fields`) | Low | 99 | 196 | 50 | 73 | 417 | 7 | 16 |
| 410 | Half the Town Overhead (`city-closing-overhead`) | Low | 97 | 139 | 62 | 38 | 324 | 6 | 3 |
| 411 | Galimoto (`galimoto-yard`) | Low | 96 | 50 | 84 | 27 | 260 | 1 | 11 |
| 412 | The Standing Sleepers (`standing-sleepers`) | Low | 96 | 193 | 47 | 24 | 202 | 13 | 16 |
| 413 | Everything Misses (`stone-face`) | Low | 96 | 138 | 62 | 106 | 138 | 43 | 9 |
| 414 | Inside a Grand Piano (`hall-of-strings`) | Low | 95 | 127 | 63 | 28 | 254 | 13 | 5 |
| 415 | The Pop-Up Book Opens (`paper-kingdom`) | Low | 95 | 138 | 61 | 26 | 203 | 7 | 3 |
| 416 | A Page of Jellyfish (`litho-medusae`) | Low | 94 | 68 | 77 | 23 | 355 | 14 | 15 |
| 417 | One Day Under the Oculus (`oculus-day`) | Low | 94 | 176 | 50 | 36 | 317 | 14 | 15 |
| 418 | The Lake Comes Down in Curls (`lake-comes-down-in-curls`) | Low | 92 | 118 | 63 | 59 | 410 | 7 | 16 |
| 419 | Which One Is the Dog (`muffins-that-look-back`) | Low | 92 | 51 | 79 | 36 | 388 | 4 | 30 |
| 420 | Carnival on the Frozen River (`carnival-on-the-frozen-river`) | Low | 90 | 74 | 71 | 39 | 382 | 16 | 9 |
| 421 | The Floating Islands (`islands-in-custard`) | Low | 90 | 107 | 63 | 55 | 403 | 15 | 25 |
| 422 | Little Train to the Giant Cactus (`sweet-green-interior`) | Low | 90 | 98 | 66 | 49 | 409 | 1 | 1 |
| 423 | Harvest in Profile (`harvest-in-profile`) | Low | 89 | 183 | 44 | 52 | 380 | 3 | 52 |
| 424 | The Scroll at Rainbow Bridge (`rainbow-bridge-scroll`) | Low | 88 | 152 | 50 | 53 | 259 | 2 | 54 |
| 425 | The Blue Riband (`blue-riband-poster`) | Low | 87 | 36 | 78 | 25 | 235 | 1 | 1 |
| 426 | The Fleet Under Glass (`glass-painted-fleet`) | Low | 87 | 182 | 42 | 35 | 168 | 2 | 33 |
| 427 | The Hail Cathedral (`hail-cathedral`) | Low | 87 | 68 | 70 | 19 | 178 | 8 | 3 |
| 428 | Star in Harness (`silent-engine`) | Low | 86 | 154 | 48 | 31 | 117 | 14 | 2 |
| 429 | Frog's-Eye View (`what-the-frog-sees`) | Low | 86 | 125 | 55 | 13 | 270 | 3 | 8 |
| 430 | Inkblot (`where-the-page-was-folded`) | Low | 86 | 180 | 41 | 26 | 257 | 0 | 24 |
| 431 | Night Scratched White (`scratched-kalahari`) | Low | 85 | 93 | 62 | 83 | 415 | 1 | 17 |
| 432 | Not Enough Engine (`car-that-must-back-up`) | Low | 84 | 41 | 74 | 37 | 413 | 1 | 1 |
| 433 | The Isle of Broken Towers (`isle-of-broken-towers`) | Low | 84 | 166 | 42 | 57 | 264 | 24 | 29 |
| 434 | Reverse Angle (`reverse-angle`) | Low | 84 | 110 | 56 | 39 | 305 | 16 | 18 |
| 435 | X-Ray of a Sleeping Hill (`sleeping-hill`) | Low | 83 | 40 | 73 | 139 | 400 | 135 | 1 |
| 436 | Walled All Around in Bronze (`bronze-walled-island`) | Low | 77 | 196 | 28 | 21 | 396 | 9 | 10 |
| 437 | Splashdown (`splashdown`) | Low | 77 | 191 | 29 | 20 | 68 | 8 | 7 |
| 438 | Moon in Every Paddy (`moon-in-every-paddy`) | Low | 76 | 193 | 28 | 33 | 161 | 9 | 6 |
| 439 | Under the Long-Haired Star (`fleet-in-six-wools`) | Low | 75 | 37 | 66 | 75 | 448 | 0 | 0 |
| 440 | Change Here for All Lines (`octilinear-city`) | Low | 75 | 53 | 62 | 30 | 233 | 0 | 17 |
| 441 | Six Arms (`six-arms`) | Low | 75 | 166 | 34 | 19 | 224 | 24 | 7 |
| 442 | Paper Boat Rapids (`paper-boat-rapids`) | Low | 74 | 150 | 37 | 52 | 214 | 13 | 4 |
| 443 | The Cold Wake (`thermal-cold-wake`) | Low | 74 | 213 | 21 | 14 | 119 | 2 | 2 |
| 444 | Trompe l'Oeil (`painted-where-you-stood`) | Low | 71 | 181 | 26 | 21 | 3 | 11 | 16 |
| 445 | No Dark in June (`pillar-of-the-white-night`) | Low | 70 | 160 | 30 | 27 | 273 | 22 | 21 |
| 446 | The Long Swan (`the-long-swan`) | Low | 69 | 53 | 56 | 26 | 308 | 0 | 0 |
| 447 | The Sun Print (`sun-print-meadow`) | Low | 68 | 65 | 51 | 61 | 351 | 58 | 0 |
| 448 | Knee-Deep Under the Wave (`knee-deep-under-the-wave`) | Low | 66 | 179 | 21 | 13 | 129 | 7 | 3 |
| 449 | The Lamp-Lit Caravan (`shadow-theatre`) | Low | 66 | 149 | 29 | 9 | 128 | 3 | 4 |
| 450 | The Standing Wave (`standing-wave-schlieren`) | Low | 65 | 66 | 48 | 53 | 279 | 50 | 33 |
| 451 | The Sounding (`the-sounding`) | Low | 65 | 108 | 38 | 31 | 177 | 27 | 3 |
| 452 | Cut from the Sky (`cut-from-the-sky`) | Low | 64 | 132 | 31 | 24 | 217 | 0 | 22 |
| 453 | Painted Shadow Town (`painted-shadow-town`) | Low | 64 | 69 | 47 | 30 | 196 | 5 | 11 |
| 454 | Red Sails at Sunrise (`red-sails-dawn`) | Low | 63 | 96 | 39 | 25 | 425 | 11 | 14 |
| 455 | An Elephant Full of Water (`water-clock-city`) | Low | 62 | 75 | 43 | 12 | 298 | 0 | 2 |
| 456 | My House, in Crayon (`crayon-house`) | Low | 59 | 52 | 46 | 67 | 81 | 0 | 69 |
| 457 | Over the Wall on a Box (`over-the-wall-on-a-box`) | Low | 56 | 129 | 24 | 45 | 228 | 0 | 21 |
| 458 | The Room of Swallows (`room-of-swallows`) | Low | 56 | 116 | 27 | 14 | 150 | 5 | 2 |
| 459 | The Scholar's Shelves (`scholars-shelves`) | Low | 56 | 180 | 10 | 11 | 27 | 1 | 9 |
| 460 | The Sulking Fish (`pond-with-no-water`) | Low | 54 | 108 | 28 | 75 | 325 | 2 | 55 |
| 461 | Plywood Sky (`evening-is-the-beam-tipping`) | Low | 52 | 127 | 21 | 73 | 116 | 7 | 0 |
| 462 | A Star with One Blue World (`star-with-one-blue-world`) | Low | 52 | 142 | 16 | 16 | 134 | 12 | 1 |
| 463 | The Lotus Room (`kohbar-lotus-room`) | Low | 50 | 102 | 25 | 28 | 190 | 1 | 1 |
| 464 | No Colour upon Colour (`no-colour-on-colour`) | Low | 48 | 75 | 29 | 121 | 173 | 0 | 0 |
| 465 | Sky Through the Bone (`sky-through-the-bone`) | Low | 43 | 36 | 34 | 27 | 359 | 11 | 0 |
| 466 | The Square at the Wrong Hour (`square-at-the-wrong-hour`) | Low | 30 | 33 | 22 | 39 | 88 | 0 | 26 |
| 467 | Every Step Twice the Last (`stair-that-doubles`) | Low | 26 | 44 | 15 | 34 | 127 | 45 | 1 |
| 468 | The One-Bit Moon (`one-bit-moonrise`) | Low | 25 | 29 | 18 | 175 | 63 | 161 | 158 |
| 469 | Balancing School (`pole-that-must-not-fall`) | Low | 25 | 18 | 21 | 57 | 283 | 0 | 0 |
| 470 | Prizes for Going in Circles (`half-coloured-regatta`) | Low | 23 | 51 | 11 | 45 | 17 | 0 | 44 |
| 471 | Three Examples and a Blank (`the-blank-answer`) | Low | 17 | 44 | 6 | 7 | 11 | 4 | 1 |

## What to look for (Meta's WebXR performance guidance)

From [Meta's WebXR performance best practices](https://developers.meta.com/vr/documentation/web/webxr-perf-bp/), with what each point means here. The page gives no draw-call or triangle budgets.

| Guidance | What to look for in these worlds |
|---|---|
| Treat each recommendation as a hypothesis and measure it (the page links Meta's "Per Frame Cost" method). | Compare draw times before and after, at fixed flight points, on a real GPU (see the caveats above). Compare pictures too: most of these changes should leave the picture unchanged. |
| Draw each pixel once: render opaque objects front to back with depth testing, and draw large backgrounds such as the sky after the foreground. | Pattern 8. Look for `renderOrder` set below 0 on terrain, ground planes, sea and sky; look for full-screen layers drawn before what covers them. |
| Use complex materials sparingly: each extra texture map and higher map resolution adds GPU work and bandwidth. | Few worlds use texture maps, but a procedural shader with dozens of noise calls per pixel is the same problem (patterns 6 and 7). Look at per-pixel noise counts in ground, sea and sky shaders. |
| Limit real-time lights (directional is cheapest, then point, spot, area). Use one directional light with PBR; bake static light. | The kit's Lambert flora uses three.js lights; hand-written shaders loop over lamp arrays (roofs-of-the-old-stone, 32 lamps per pixel). Look for light loops and many `PointLight`/`SpotLight` objects. |
| Be careful with real-time shadows: a shadow map is another render of the scene from the light, and point-light shadows need six. | 27 world and part files turn on three.js shadow maps. `src/core/xr.js` already draws them once per frame, not once per eye. Look for shadow-casting point lights and shadow maps larger than needed; bake shadows where the sun does not move. |
| Compress textures (KTX 2.0 with Basis Universal). | Rarely applies: most textures here are generated. Large generated `DataTexture`s or canvas textures could still be kept small. |
| Be careful with transparent objects and overdraw; particle effects with many large overlapping quads are the usual cause. | Pattern 5 (stacked slices), steam and smoke sprites, cloud decks, glitter. Look at how much of the screen each transparent layer covers, not how many there are. |
| Do not draw what has faded to nothing: fully transparent objects take full rendering time. | Look for opacity or a fade uniform taken to 0 without `visible = false`, and for shaders whose alpha is zero over large areas but still compute everything before a final alpha. Discarding early is not always a like-for-like change: an invisible surface that writes depth can hide things behind it (the geyser world's summer sheet hides the river surface over the near bank). |
| Clear to black or white (fast clear on Quest 1 and 2 GPUs). | The engine does not set a clear colour, so three.js clears to black already. Nothing to do. |
| Stagger updates over several frames; update far objects less often. | Per-frame CPU is small in the worlds profiled so far (about 0.03 ms in the geyser world). Look for `update()` functions that rewrite large instance buffers every frame (`needsUpdate` on big attributes). |

Not on that page, but true of the Quest browser and worth knowing here:

- **Fixed foveation** (`XRWebGLLayer.fixedFoveation`, three.js `renderer.xr.setFoveation`) only applies to the headset's own framebuffer. This app draws each eye into its own float buffer and only grades onto the headset's buffer at the end (`src/core/xr.js`, `Post.renderXR`), so foveation would only lighten that last pass.
- **Multiview** (drawing both eyes in one pass) is not used, for the same reason: each eye is a separate draw of the scene, so vertex work and draw calls are paid twice.
- The Quest's GPU is tile-based: MSAA resolves on the tile cheaply, while `discard` and late depth writes are slower than on a desktop GPU (patterns 4 and 2).
- For frame rates on the headset itself, the browser's `window.__engine.stats` over `chrome://inspect` works, and Meta's OVR Metrics Tool shows GPU and CPU load as an overlay.

## Re-running

With `npm start` serving on port 8010 (or `URL=` set) and playwright-core installed (`npm i --no-save playwright-core`):

    node tools/vr-survey.mjs 4          # writes vr-survey.jsonl, one line per world; resumes if stopped
    node tools/vr-survey.mjs rank       # prints the ranking
    ONLY=prismatic-dawn,the-toppling OUT=after.jsonl node tools/vr-survey.mjs 1   # re-measure a few worlds alone

Measure single worlds with one worker (as in the last line) when comparing before and after a change: parallel workers add noise.
