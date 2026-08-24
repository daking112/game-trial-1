# Monster sprite art

Drop each species' idle sprite here as `<spriteKey>.png`, matching the
`spriteKey` in `/shared/monsterData.ts` (e.g. `cogling.png`,
`boilerback.png`, ... `aetherwing.png`). It's picked up automatically —
`BattleScene.preload()` loads a texture per species and `MonsterSprite.tsx`
renders it everywhere in the UI; a species without a file here just falls
back to a colored circle + initial, no code changes needed either way.

**Format that already works well**: 32×32 (or similar) top-down pixel art
with a transparent background, one "facing the camera" idle frame — see
`cogling.png` for a working example. `cogling/` holds the full 8-directional
rotation set (`north.png`, `north-east.png`, ... ) for the same sprite, kept
for future use (e.g. facing the sprite toward its current target) but not
wired up yet — only the single front-facing frame is used today.

Larger illustrated portraits also work fine (`MonsterSprite` just renders
whatever image is at the path, scaled down), but the small transparent
top-down style reads best both in the battle grid and scaled up in the
Collection/Codex/Capture UI.
