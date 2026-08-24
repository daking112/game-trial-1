# Monster portrait art

Drop generated/final portrait art here as `<spriteKey>.png`, matching each
species' `spriteKey` in `/shared/monsterData.ts` (e.g. `cogling.png`,
`boilerback.png`, ... `aetherwing.png`).

Concept art for all 10 species (steampunk-fantasy hybrid: brass, copper,
gears, and steam fused with an organic forest-animal base) was generated via
the Artlist MCP in an earlier session, but that session's network egress
policy blocked downloading the resulting files into this repo. Regenerate or
re-download them into this folder, then wire them into
`client/src/battle/scenes/BattleScene.ts` (`createPlacedView`) and the React
`MonsterCard`/`CollectionScreen`/`CodexScreen`/`CaptureModal` components,
which currently render a colored circle + initial as a placeholder.
