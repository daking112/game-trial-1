# World / map art

`tiles/` holds the hand-authored pixel tileset the battle map actually uses
today: `grass_a.png` / `grass_b.png` (checkerboarded moss floor),
`path_a.png` / `path_b.png` (worn brass-and-dirt path, one variant carries
a rivet cluster), and `decor_gear.png` (a sparse transparent gear decal
scattered over grass tiles). Each is 28×28 — exactly half of `GRID.cell`
(56px) in `client/src/battle/mapConfig.ts` — so Phaser's `pixelArt: true`
nearest-neighbor scaling lands on an exact 2× integer multiple and stays
crisp. `BattleScene.drawMap()` tiles them procedurally per-cell rather than
using one big background image, so there's no seam or resolution mismatch
to worry about.

These were generated with a small Python/Pillow script (seeded speckle +
hand-placed accent pixels), not an AI image tool, specifically so they have
no external-asset dependency. If you'd rather swap in a proper illustrated
key-art background image instead (or in addition, as a backdrop behind the
tiles), that's still an option — `gearwood-thicket.png` here would need
wiring into `drawMap()` as a `this.add.image()` sized to `MAP_WIDTH` /
`MAP_HEIGHT` before the tile loop.
