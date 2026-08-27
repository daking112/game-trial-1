# game-trial-1

Fresh start. Nothing built yet.

## Layout

```
/.claude/skills   Agent skills available to Claude Code in this repo — see below.
```

## Agent skills

`.claude/skills/` holds skills available to Claude Code in this repo.

- **`gauntlet-loop`** — turns a goal into one paste-ready prompt that makes an
  agent set a concrete quality bar, split the work into judgeable pieces, run a
  builder and a separate harsh critic on each, and loop until the work wins a
  blind comparison. Invoke with `/gauntlet-loop <goal>`. Vendored from
  [robonuggets/gauntlet-loop](https://github.com/robonuggets/gauntlet-loop);
  see `.claude/skills/gauntlet-loop/ATTRIBUTION.md`.

## History

This repo previously held **Monsterfall**, a browser-based monster collection +
tower defense prototype (`/client`, `/shared`, `/legacy-prototype`). It was
cleared to start fresh. That code is still in git history at commit `8d8db58`
(`git checkout 8d8db58 -- client shared legacy-prototype`) if you ever want it back.
