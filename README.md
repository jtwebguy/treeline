# Лісосмуга — Treeline

A first-person three.js walk through a shell-torn Scots pine forest on an eastern Ukrainian front line. This is the starting environment for a game.

## What's in it
- **Procedural Scots pines** in three states — living, burnt, and snapped by shellfire (with the broken tops lying nearby). Instanced, with wind sway.
- **Terrain** with 70 shell craters, a zig-zag trench with spoil banks, and a shader that blends forest floor, burnt ground and mud using per-vertex masks.
- **Props** scattered from real scanned assets: stumps, fallen trunks, boulders, dry branches, ferns, military crates, ammo boxes, jerrycans and tyres along the trench.
- **Atmosphere**: fog, overcast HDRI lighting, smoke columns and embers in fresh craters, falling ash, distant artillery flashes with delayed synthesized booms, wind audio.

## Play
Open the GitHub Pages link, or serve the folder locally (any static server):

```
npx serve .
```

Controls: **WASD** move · **Shift** run · **C** crouch · **Space** jump · **Esc** pause.

## Assets
All textures, models and the HDRI are **CC0** from [Poly Haven](https://polyhaven.com) and stream from its CDN at runtime (1k resolution), so nothing large is stored in this repo:
forest_ground_04, burned_ground_01, brown_mud_leaves_01, knotted_pine_bark, dead_tree_trunk, tree_stump_01, old_military_crate, ammo_box, metal_jerrycan_green, old_tyre, boulder_01, dry_branches_medium_01, fern_02, kloofendal_overcast_puresky.

## Code layout
| File | Purpose |
|---|---|
| `src/world.js` | Seeded height function, craters, trench, damage map |
| `src/terrain.js` | Terrain mesh + texture-blending shader |
| `src/trees.js` | Procedural pine generator and forest placement |
| `src/props.js` | Instanced glTF props |
| `src/effects.js` | Smoke, embers, ash, artillery, audio |
| `src/main.js` | Renderer, lighting, player controller, game loop |
