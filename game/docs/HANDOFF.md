# Handoff — how to resume this build in a fresh session

Read `BRIEF.md` first; it holds the quality bar and the hard constraints.
This file holds only what a new session needs in order to pick the work up
without re-deriving it.

## The container is disposable; the branch is not

Every session gets a fresh container. Nothing outside git survives — not
`node_modules`, not the dev server, not agent worktrees, and not the
reference art. This has already destroyed three agents' unpushed work.

**Consequences, in order of how much they cost when ignored:**

1. Agents must commit after every round, and the lead must push. An
   in-flight worktree branch that is not pushed is gone when the session ends.
2. Reference art must be re-fetched (see below). `REFS_DIR` in `BRIEF.md`
   points at a session-scoped scratchpad path that will not exist next time.
3. `npm install` again, and start the dev server again.

## Cold start

```bash
cd game && npm install
npx vite --host 127.0.0.1 --port 5173 --strictPort &   # detach it properly
```

Re-fetch reference art (the network allows GitHub only, which is where the
PokeAPI sprite repo lives). Put it wherever this session's scratchpad is and
update `REFS_DIR` in `BRIEF.md`:

```bash
mkdir -p "$REFS" && cd "$REFS"
for n in 1 4 7 25 94 133 143 149 197 248 282 373 445 448 658 700 887; do
  curl -sS -o "$n.png" \
    "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/$n.png"
done
```

Never commit these. All shipped art is original.

## The workflow, which is the actual method

One builder per slice, each with a SEPARATE, FRESH-CONTEXT critic. The critic
gets our screenshot and a real reference labelled A and B in random order, is
never told which is ours, and is told to be brutal. Fix the single biggest
flaw it names, re-shoot, repeat. Randomise which letter is ours between
rounds, and never claim a win the critic did not give.

Builders work in their own git worktree so they cannot collide, and each owns
a disjoint file set (the ownership map is in `BRIEF.md`). `src/main.ts` is the
lead's alone: builders export a factory and REPORT the wiring calls.

A worktree has no `node_modules`. Symlink the root one and take your own port:

```bash
cd game && ln -s /home/user/game-trial-1/game/node_modules node_modules
npx vite --host 127.0.0.1 --port 51NN &
```

Merging finished agents:

```bash
git branch --list 'worktree-agent-*'
git merge --no-edit <branch>
npx tsc -b --noEmit && node tools/simulate.mjs   # then screenshot and LOOK
```

## What the critics keep being right about

- **Measure, never assume.** Two plausible art fixes once moved their metrics
  by <0.003 and were no-ops; the real cause was fog saturating past 250u.
  Another agent later found the far apron wound inside out, so distant ranges
  were not drawing at all. `tools/analyse.mjs` exists for this.
- **Test generated systems statistically.** The gacha looked fine until 20,000
  pulls exposed a 99.8% Rare rate. The shard economy looked balanced per
  duplicate and was 5.5x out per unit of play time.
- **A screen that never renders its own core state cannot be judged.** The
  star screen had to be seeded with mixed ranks before a filled star appeared
  in a single capture.
- **Never ship a label the code does not honour.** The star button read
  "Star Up x2" while buying one.

## Tools

All real, all working. Use them rather than impressions.

| Command | What it proves |
|---|---|
| `node tools/shoot.mjs --shot overview,combat --dom true` | Deterministic captures. `--dom true` is REQUIRED for HTML/UI, or you get bare 3D. Then OPEN the PNG with the Read tool. |
| `node tools/simulate.mjs` | Plays all 10 waves headless, asserts the game rules |
| `node tools/test-gacha.mjs` | 20,000 pulls; odds, pity, ten-pull guarantee |
| `node tools/test-economy.mjs` | 20,000 pulls; time-to-max-stars is flat across rarities |
| `node tools/test-stars.mjs` | Star maths reaches placement, survives evolution |
| `node tools/analyse.mjs <png>` | Luma/saturation per band — checks art claims against pixels |
| `node tools/perf.mjs` | Draw calls and triangles |
| `node tools/test-touch.mjs` | Pinch and orbit |

Named camera shots live at the top of `tools/shoot.mjs`. The game boots to a
clean board; `?demo=1` seeds towers and the tools append it themselves. Demo
mode also pins the gacha seed, so captures reproduce.

## Rules that are not negotiable

No payments anywhere — cogs are earned only, and the odds are published
honestly. All art original and procedural; no asset downloads, no image
generation. `npx tsc -b --noEmit` clean. No console errors. Deterministic.
