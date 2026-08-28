# Gearwood Thicket — build brief

A hybrid monster-collector / tower-defense game in Three.js. You place
collectable creatures along a track; waves of enemies walk it; creatures attack
them. Bloons-style tower defense structure, Pokemon-grade creature presentation.

## The bar

**Creature art & presentation:** Pokemon official artwork. Real reference PNGs
are on disk at `REFS_DIR` (see below) — actual official artwork fetched from the
PokeAPI sprite repo. Open them. Compare against the real image, never against
your memory of it.

**Tower-defense readability & game feel:** Bloons TD 6 — instant readability of
what is where, chunky silhouettes, clear affordances, heavy visual feedback on
every hit.

Reference images live OUTSIDE the repo and must never be committed. They are for
blind comparison only. All shipped art must be **original** — no copying any
existing creature's design, name, or likeness.

## Non-negotiables

1. **No asset downloads.** There is no image-generation service and the network
   allows GitHub only. Every texture is generated procedurally (see
   `src/core/Textures.ts`) and every mesh is built in code. This is a hard
   constraint, not a preference.
2. **It must typecheck.** `npx tsc -b --noEmit` must exit clean.
3. **It must render without console errors.** The harness reports them.
4. **Deterministic.** No `Math.random()` at module scope or in per-frame code
   used for anything persistent — seed it, so screenshots are reproducible.

## The harness — how you see your own work

The dev server runs on `http://127.0.0.1:5173` (start with `npx vite` from
`game/` if it is down).

```bash
node tools/shoot.mjs --out shots --shot overview,hero --width 1280 --height 720
```

Named shots are defined at the top of `tools/shoot.mjs`. Add your own if you
need a specific angle. Each capture takes ~4s under software rendering.

Then **look at the PNG with the Read tool**. This is the whole point. Do not
describe what you think it looks like — open it.

Rendering is software (SwiftShader), so it is slow but pixel-accurate. Sim
stepping is split from drawing: `advance()` runs logic only, `draw()` renders
one frame, so captures are reproducible.

`window.__game` exposes `{ engine, advance, draw, pose, reset, stats }`.

## Architecture

```
src/core/Engine.ts     renderer, post chain (bloom -> grade -> SMAA), step/render split
src/core/GradePass.ts  final colour grade: vignette, aberration, grain
src/core/Textures.ts   procedural texture generation (fbm noise, normal maps)
src/core/Debug.ts      window.__game control surface
src/world/Environment.ts  sky dome, sun, hemisphere fill, fog, PMREM env map
src/world/Terrain.ts   displaced heightfield, flattened under the track
src/world/Track.ts     the path: curve, ribbon mesh, arc-length lookup
src/main.ts            wiring — OWNED BY THE LEAD AGENT, do not edit
```

**Export a class or factory from your own module.** The lead agent wires it into
`main.ts`. Do not edit `main.ts` yourself — parallel agents will collide there.

## Art direction

Bright, saturated, high-key. Readable silhouettes over surface detail. This is a
stylised game, not a photoreal one — but stylised means *deliberate*, not cheap.
Warm key light, cool sky fill; that split is what makes forms read.

The terrain currently reads as muddy brown with acid-green blotches. That is a
known weakness and fair game to fix if it is in your scope.
REFS_DIR = /tmp/claude-0/-home-user-game-trial-1/6192ecc6-a18d-5224-9b2f-67e084e1b23d/scratchpad/refs

---

# Phase 2 — meta game

The battle layer is done and works: terrain, foliage, six creatures with
evolution, ten waves, upgrades, codex, win/loss, audio, VFX. Phase 2 wraps a
meta game around it.

## Ownership map — do not edit outside your slice

| Slice | Owner | Files |
|---|---|---|
| Multiplayer | agent | `server/**` (new), `src/net/**` (new), `src/ui/Lobby.ts` |
| World map, bases, raiding | agent | `src/metamap/**` (new, includes its own UI) |
| UI polish (in-battle) | agent | `src/ui/Hud.ts`, `CollectionPanel.ts`, `TowerPanel.ts`, `EndScreen.ts` |
| Gacha, currency, progression | lead | `src/meta/**` |
| Wiring | lead | `src/main.ts` |

`src/main.ts` is the lead's. Export a class or factory; the lead wires it.

## Shared rules, unchanged from phase 1

- Everything procedural. No asset downloads, no image generation, network is
  GitHub-only.
- `npx tsc -b --noEmit` must exit clean.
- Deterministic: seed all randomness. Screenshots must be reproducible.
- Screenshot with `tools/shoot.mjs` (add `--dom true` for HTML overlays), then
  **open the PNG with the Read tool**. Never assess work you have not viewed.
- `tools/analyse.mjs <png>` measures luma/saturation per band — check value
  claims against pixels.
- `tools/simulate.mjs` must still pass after your change.
- The game boots to a clean board. `?demo=1` seeds towers and starts a wave;
  the tools append it themselves.
- Commit after EVERY round. Rate limits terminate agents without warning and
  uncommitted work is lost.
