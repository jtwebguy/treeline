# Лісосмуга — Treeline

A first-person three.js walk through a shell-torn Scots pine forest on an eastern Ukrainian front line. This is the starting environment for a game.

## What's in it
- **Weapons**: M4A1 (automatic, iron sights) and a Mosin-Nagant M91/30 sniper with a PU 3.5× scope (bolt cycling, round-by-round reloads), plus a pump-action 12-gauge shotgun you can only get by taking it off a dead enemy (9-pellet spread, damage falls off with range, shell-by-shell reloads). Rigged first-person hands in fingerless gloves and camo sleeves, with the fingers posed round each gun's grip, recoil, muzzle flash, hitscan with impact puffs on trees and ground, synthesized gunshots with forest reverb.
- **Procedural Scots pines** in four states — living, young (conical, branched to the ground), burnt, and snapped by shellfire (with the broken tops lying nearby). Instanced, with wind sway.
- **Silver birch** with procedurally painted bark and late-autumn yellow leaves, mixed through the stand and colonising burnt ground.
- **Thickets**: ~30 dense clumps of pine, birch and saplings, plus young pines regenerating in shell-opened gaps.
- **Terrain** with 70 shell craters, a zig-zag trench with spoil banks, and a shader that blends forest floor, burnt ground and mud using per-vertex masks.
- **Props** scattered from real scanned assets: stumps, fallen trunks, boulders, dry branches, ferns, military crates, ammo boxes, jerrycans and tyres along the trench.
- **Enemy infantry**: waves of soldiers with M4A1s patrol no-man's land north of the trench. They spot you (line of sight through the trees, faster if you sprint or stand tall, slower if you crouch), advance, fire in bursts, duck into cover, go prone, run to new positions and reload. Hits are tested against the soldier's animated limbs, so a crouched or prone enemy is a smaller target; headshots do triple damage. About a third of each wave carries a pump shotgun instead: they close in to ~25 m before firing. Killed soldiers go limp as ragdolls (they keep their running momentum, fold at the knees, fall against trees and the ground, and can be pushed by further shots). The ragdoll keeps to human joint limits: knees and elbows only bend the natural way, and hips, shoulders and neck stay within a real range of motion, and their weapon falls from their hands. Walk up to a dropped gun and press **E** to take it, or to take its ammo if you already carry that weapon. You have 100 health that regenerates after a few seconds out of fire; each cleared wave brings a bigger one.
- **Atmosphere**: fog, overcast HDRI lighting, smoke columns and embers in fresh craters, falling ash, distant artillery flashes with delayed synthesized booms, wind audio.

## Play
Open the GitHub Pages link, or serve the folder locally (any static server):

```
npx serve .
```

Controls: **WASD** move · **Shift** run · **C** crouch · **Space** jump · **LMB** fire · **RMB** aim/scope (click to toggle) · **1/2/3** or wheel switch weapon · **E** pick up a dropped weapon · **R** reload · **Esc** pause.

The HUD shows health (bottom left), the current wave and hostiles left (top left) and a hit marker (red on a kill or headshot).

## Assets
All textures, models and the HDRI are **CC0** from [Poly Haven](https://polyhaven.com) and stream from its CDN at runtime (1k resolution), so nothing large is stored in this repo:
forest_ground_04, burned_ground_01, brown_mud_leaves_01, knotted_pine_bark, dead_tree_trunk, tree_stump_01, old_military_crate, ammo_box, metal_jerrycan_green, old_tyre, boulder_01, dry_branches_medium_01, fern_02, kloofendal_overcast_puresky.

Weapon and arm models (`models/`) were supplied by the project owner as Sketchfab downloads (M4A1, Mosin-Nagant M91, first-person arms with fingerless gloves), converted from FBX to GLB with 2K textures. Credit their authors here according to each model's Sketchfab licence.

The shotgun (`models/shotgun.obj`) and first-person hands (`models/hand_rigged.fbx`) were also supplied by the project owner. The OBJ has no textures, so its steel and wood are painted into vertex colours by region. The hands FBX loads directly with three's FBXLoader and is used for all three weapons, replacing the static arms baked into `vm_m4.glb` / `vm_mosin.glb` (which are hidden). It is the same mesh as those arms, so it wears their texture (`models/hands_basecolor.jpg`, `models/hands_normal.jpg`, extracted from the GLB because the FBX's own texture wasn't embedded). It has no animation, so each weapon's grip is posed in code (`src/hands.js`).

The enemy soldier (`models/soldier_m4.glb`) is the project owner's "Mark 1 Olive" character rigged with the M4A1 and seven clips — `Idle`, `Walk`, `Run`, `Duck`, `Prone`, `Fire`, `Reload` — plus gun bones (`Weapon_Root`, `Weapon_Magazine`, `Weapon_Bolt`, `Weapon_ChargingHandle`, `Weapon_Trigger`, `Weapon_Selector`). Its uniform uses flat colours because the source FBX didn't embed textures; the rifle reuses the textured materials from `vm_m4.glb`.

## Code layout
| File | Purpose |
|---|---|
| `src/world.js` | Seeded height function, craters, trench, damage map |
| `src/terrain.js` | Terrain mesh + texture-blending shader |
| `src/trees.js` | Procedural pine & birch generators, thickets, saplings |
| `src/props.js` | Instanced glTF props |
| `src/effects.js` | Smoke, embers, ash, artillery, audio |
| `src/weapons.js` | Viewmodels, firing, reloads, scope, hitscan, weapon audio |
| `src/enemies.js` | Enemy soldiers: waves, AI, animation, limb hitboxes, return fire |
| `src/ragdoll.js` | Verlet ragdoll that takes over a soldier's skeleton on death |
| `src/drops.js` | Weapons dropped by dead soldiers: falling, settling, pickup lookup |
| `src/shotgun.js` | Shotgun model: loading, painting, soldier mount, viewmodel, hand grip |
| `src/hands.js` | Rigged first-person hands and the code that poses them |
| `src/main.js` | Renderer, lighting, player controller, game loop |
