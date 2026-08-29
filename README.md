# Gearwood Thicket

A hybrid monster-collector / tower-defense game in the browser, built with
Three.js. You place original creatures along a winding track, waves of
clockwork enemies walk it, and your creatures level up, evolve and carry their
progress between runs.

Everything you see is generated in code. There are no model files, no texture
downloads and no image-generation service in the loop — meshes, textures,
audio and animation are all synthesised at runtime.

```
cd game
npm install
npm run dev
```

Then open the printed `http://127.0.0.1:5173` URL.

## Playing

| Input | Action |
|---|---|
| Left-drag | Orbit the camera |
| Right-drag | Pan |
| Scroll | Zoom |
| Click a roster card, then click the ground | Place a creature |
| Click a placed creature | Open its inspector (upgrade / sell) |
| `C` | Field Codex |
| `Esc` | Cancel placement |

On touch: one finger orbits, two fingers pinch to zoom and drag to pan, tap to
place or select. The HUD reflows to a scrolling roster strip on narrow screens.

Creatures cannot be placed on the track. Enemies that reach the end cost you
lives; stronger tiers split into weaker ones when destroyed, so a late kill can
still flood the lane.

## Structure

```
game/
  src/
    core/       Engine, post chain, procedural textures, camera rig, debug API
    world/      Sky and lighting, terrain, track, ground shading, foliage
    creatures/  Species table, procedural creature builder, rig and animation
    combat/     Enemies, waves, projectiles, the battle loop
    fx/         GPU particles, camera shake, hit-stop, floating numbers
    ui/         HUD, Field Codex, tower inspector
    meta/       XP curve, levels, evolution, persisted collection
    main.ts     Wiring
    showcase.ts Neutral studio scene for reviewing creature art
  tools/
    shoot.mjs     Deterministic screenshot harness
    simulate.mjs  Headless gameplay simulation
  docs/BRIEF.md   Build brief and quality bar
```

## How it was built

The work was split across parallel agents, each owning a slice of the codebase
and each running a build-and-critique loop: make a change, capture a
screenshot, hand it to a separate critic agent with fresh context that compares
the result blind against a real reference, fix the biggest flaw it names,
repeat. See `.claude/skills/gauntlet-loop/`.

Two tools make that loop possible, and they are the load-bearing part of this
repo:

**`tools/shoot.mjs`** drives headless Chromium and reads the WebGL backbuffer
directly. Simulation stepping is split from rendering (`stepLogic` vs `render`)
so a capture can fast-forward the world without paying to draw every
intermediate frame — under software rasterisation that is the difference
between a 4-second capture and a multi-minute one. Because the sim is advanced
by an exact amount, two runs of the same shot differ only where the render
actually changed.

**`tools/simulate.mjs`** runs the real battle loop at speed with no rendering
at all and asserts the game is playable: waves spawn and drain, splits fire,
the economy moves, both win and loss trigger. Screenshots prove it looks right;
only this proves it works.

## Rendering

ACES filmic tone mapping, bloom, a colour-grade pass (vignette, chromatic
aberration, grain) and SMAA. A PMREM environment map is baked from the sky
dome — without image-based lighting, PBR materials have no indirect light to
sample and the whole scene reads flat no matter how good the geometry is.

Ground and road are `MeshStandardMaterial`s with their albedo, roughness and
normal replaced by a world-space procedural stack injected via
`onBeforeCompile`, blended by slope, altitude and distance to the road rather
than sprayed uniformly. Foliage is instanced.

## Original work

The creatures, world, and all art in this repository are original. The quality
bar for creature presentation was set by comparing against real Pokémon
official artwork, but no existing creature's design, name, or likeness is
copied or shipped here, and no reference imagery is committed.

## Agent skills

`.claude/skills/` holds skills available to Claude Code in this repo.

- **`gauntlet-loop`** — turns a goal into one paste-ready prompt that sets a
  concrete quality bar, splits the work into judgeable pieces, and runs a
  builder plus a separate harsh critic on each until the work wins a blind
  comparison. Vendored from
  [robonuggets/gauntlet-loop](https://github.com/robonuggets/gauntlet-loop);
  see `.claude/skills/gauntlet-loop/ATTRIBUTION.md`.
