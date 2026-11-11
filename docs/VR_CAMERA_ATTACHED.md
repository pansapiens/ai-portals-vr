# Objects fixed to the camera: headset watch list

Worlds that place geometry on or near the camera and keep it there (mounts, wings, antennae, cockpits, carried things, full-frame planes). In a headset these can float in front of the face, look disconnected from the viewer, or poke into the head. This is a list to test against, not a list of fixes: nothing here has been changed unless the last column says so.

Compiled 2026-11-11 by reading the code (not by looking in a headset). Distances are rough. A world that builds its camera-following pose some other way may be missing.

## Why it happens

In a headset the camera handed to a world's `update()` is the rig (`src/core/xr.js` `pose()`): the route position and the heading (yaw) only. The route's pitch and roll are dropped, and the head's own pose is added only to the eyes. So:

- Anything fixed to the camera stays fixed to the body while the viewer looks round. Close objects with nothing joining them to the viewer (antennae, hands, wings) then read as floating.
- Many worlds size or place their mount from `camera.projectionMatrix` ("tips in the outer tenth of the frame"). In a headset there is no frame edge, so these rules no longer frame anything.
- Rules that read the gaze's pitch from `camera.matrixWorld` read 0 in a headset.
- A few worlds draw parts directly in eye space (`gl_Position = projectionMatrix * vec4(viewPos, 1.)`). Those are fixed to the head, not the body, at the same position in both eyes, so their depth is wrong. Hiding a mesh does not cover these; they need their own fix.
- Tricks that pull a far object toward the eye and shrink it only work for one eye; in stereo the object looks close.

The fix used so far is to hide the part when `ctx.headset?.()` is true.

## Highest risk: within about 1.5 m, or flat planes in front of the face

| World | Name | Where (file:line) | What follows the camera | Likely issue | Status |
|---|---|---|---|---|---|
| `reverse-angle` | Reverse Angle | worlds:1212, parts:267 | carried group (pigeon wingtips, mittens, veil plane at 0.6 m) and the cut quad at 0.5 m filling the frame | a flat screen in front of the face, fixed to the body | |
| `glass-painted-fleet` | The Fleet Under Glass | parts:516-520 | glass pane with glare, bubbles and hairline, 1 m ahead, sized to fill the frame | flat sheet that does not turn with the head | |
| `false-stars` | False Stars | 2069 | spray or cloud veil plane at 0.7 m, full frame | flat plane | |
| `beaded-sea` | A Sea Hung in Globes | 810 | meniscus plane at 0.8 m, full frame, about 0.2 s | brief flat-plane artefact | |
| `gannet-stack-gale` | (see index) | 2073 | spray veil, same kind as false-stars | worth a look | |
| `honey-cliff` | The Honey Cliff | 2143 | bee: thorax about 1 m ahead and 0.8 m below, antennae about 1.2 m ahead, wing-blur fans at 1.6 m to each side | antennae float in front of the face (as gilded-margin did) | |
| `mayfly-bloom` | The Tisza in Flower | 2497 | mayfly forelegs at the foot of the frame, wing blur about 0.25 m ahead | legs float; blur pokes into the head | |
| `spore-rain` | Spore Rain | 3790-3862 | beetle shield, head and antennae 0.27 m below the eye (placed with `lookAt` and the gaze, not `matrixWorld.copy`) | mostly a body; antennae float | |
| `banyan-homecoming` | The Tree That Is a Forest | 657, 1961 | our wings drawn in eye space, depth test off | fixed to the head, depth wrong in stereo | |
| `thousand-lagoons` | The Thousand Lagoons | 573, 1743 | heron bill in eye space at the bottom of the frame | as above | |
| `swordbill-round` | The Swordbill's Round | 2560 | hummingbird head and bill below and ahead, wing fans placed by frame | the bill may read as attached; the fans float | |
| `drowned-domes` | The Drowned Domes | 1034 | yacht corner parts about 1.3 m out, placed from the projection | float at the frame corners | |
| `the-same-minute` (part) | Tram with a Red Balloon | parts:883 | brass pole, knob, bonnet about 4 m out, scaled toward the eye on tall frames | one-eye scaling, depth looks wrong | |
| `azulejo-descent` | The Blue Tile Hill | 1121 | tram cab: window frame just outside the frame, controller and brake wheel about 1 m ahead | a cockpit, mostly fine; edges fitted to the frame will show | |
| `through-the-tower` | The Mountain City Line | 1435 | cable cab with glass and wipers, fitted to the frame | as above | |
| `the-umbra` | Eclipse over the Storm Tops | 1067 | research jet; the fin pod's mast fairing was right under the eye | | fairing hidden in a headset |
| `gilded-margin` | The Gilded Margin | 1539 | bee antennae about 1 m ahead, wing blur at the sides | antennae floated | antennae hidden in a headset; wing blur not yet checked |

## Mounts, bodies and wings at 1-3 m: may float or look disconnected

| World | Name | Where | What follows the camera | Likely issue |
|---|---|---|---|---|
| `dragons-blood-fog` | The Umbrella Forest | 1973 | our wings in the frame corners | disconnected wings |
| `fern-sea-midnight` | The Green Arctic Sea | 988 | our bird | floats |
| `leaded-forest` | A Year in Stained Glass | 1215 | glass dragonfly, banking | floats |
| `kurbits-night` | The Night the Kurbits Grew | 1098, 1107 | bird saddle and wings, tail 2.2 m below; escort birds at frame bearings | mostly a body; escort fixed to the frame |
| `mammoth-midnight-sun` | The Saiga River | 696 | raven and hands, parked 2.2 m below the frame | seen if you look down |
| `mud-tower-haboob` | The Wall of Dust | 2292 | wings sized to the frame edges | float |
| `painted-ridges` | The Painted Ridges | 2440 | horse neck, head and ears, scaled by field of view | a body, but the ears float |
| `sauropod-ford` | The Long Necks' Ford | 1153 | pterosaur wings and head | float |
| `scratched-kalahari` | Night Scratched White | 2441 | owl wingtips | float |
| `unstrung-falls` | Broken Necklace Falls | 1407 | wire-and-bead moth: head, antennae, forewing loops | antennae float |
| `well-of-rain` | The Well of Rain | 1538 | our wing | floats |
| `alpenglow-horn` | Alpenglow | 1185-1196 | golden eagle mount in the bottom fifth of the frame | floats ahead |
| `shoebox-reef` | The Shoebox Reef | 1479-1512 | turtle under the lens, hand on the string at 1.5-1.9 m | the hand floats |
| `snow-ghosts` | First Tracks | 1101 | skis, arms and poles | a body; arms float |
| `four-colour-launch` | Launch Row | 380 | sled stretched to the screen's aspect ratio | wrong stretch in a headset |
| `malecon-norther` | Norther on the Malecón | 2859 | car bonnet, ornament and spear, pitched by the projection | bonnet hovers |
| `folding-market` | The Folding Market | 1614 | cab, garland, mirror, lamp, scaled to the frame | a cockpit; scaling looks off |
| `twelve-metre-tide` | Twelve Metres of Tide | 923-941 | bow about 4.6 m ahead, 1.8 m below, set by a frame-edge rule | mostly fine; the rule misfires |
| `thousand-kite-roofs` | Kites at Uttarayan | 2060 | kite overhead, nose at the top of the frame | floats overhead |
| `firefly-lantern` (ride) | Firefly Lantern | src/rides, extras.js:165-191 | bamboo pole from a hand at bottom right, lantern upper right; swings back into the frame when the gaze turns | hand-held pole with no arm |

## Probably fine: vehicles and cockpits around the viewer

These surround the viewer, so being fixed to the body suits them. Check for frame-fitted edges and gaze-pitch rules.

`magic-carpet` (ride: carpet 1 m below the eye), `geode-run` (mine cart), `pier-comet` (coaster car), `ring-run` (skiff), `hull-town` (cable boat), `blown-city` (boat bow), `cloisonne-typhoon` (junk prow), `engraved-sea-chart` (bow rig), `sapphire-moulin` (raft), `drafted-city` (hoist cage), `thermal-cold-wake` (satellite deck), `comet-perihelion` (solar-sail rig), `coronal-rain` (probe shield), `the-striking-hour` (clock cradle), `splashdown` (capsule), `flying-boat-karst-bay` (airframe), `airbrush-black-hole` (ship), `sea-turns-square` (plate 4.4 m below), `uphill-to-black` (rocket seat; held still and pan made a snap turn in a headset).

## Companions placed in the camera's frame at 3-10 m (minor)

`city-in-the-lake` (seed about 3 m ahead, briefly), `stork-kettle-riso` (storks 8-9 m ahead), `swordbill-round` (companion bird 4-6.5 m ahead), `reverse-angle` (falcon 3-7 m), `checkerboard-approach` (beacon glow 9 m ahead, a uniform only), `the-tall-cloud` (hat about 60 m ahead, but drawn pulled toward the eye and shrunk, which may look close in stereo).

## Testing these

There is no scene picker yet. One world can be loaded alone with `?world=<id>` (add `&loop` to go on through its portal), for example `https://<host>:8444/?world=honey-cliff`.
