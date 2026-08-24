# Snarl.io

A browser-based diep.io-style arena shooter with monster-collecting gacha
mechanics. You control a tank-like avatar in a top-down arena, killing
shapes and rival tanks for XP and stat points — classic diep.io. Which
monster you have equipped determines your gun pattern and base stats, like
a diep.io tank class; new monsters are pulled from a gacha using Gears
earned from arena runs. Original creatures, not affiliated with or based on
any existing franchise.

This is a single-player, client-only vertical slice: the arena, leveling,
stat allocation, gacha pulls, and collection are all playable now.
Multiplayer and an authoritative server are a future phase — see Roadmap.

## Layout

```
/client   React + TypeScript + Vite + Phaser 3 client (the whole game lives here)
/shared   Cross-cutting game data & types: rarity, monster species/loadouts,
          arena shapes, leveling curve, gacha config. No client or server
          dependency.
/legacy-prototype
          An earlier single-file vanilla-JS tower defense prototype. Kept
          for reference only; unrelated to the current game.
```

`/server` (Node + TypeScript + Socket.IO, PostgreSQL persistence, an
authoritative arena) doesn't exist yet — see Roadmap.

## Running it

```
cd client
npm install
npm run dev
```

Then open the printed `http://localhost:5173` URL. `npm run build` produces
a production build (`npm run preview` to serve it locally); `npx tsc -b`
type-checks the client + shared packages together.

## How to play

1. **Arena**: pick your equipped monster (you start with Snubnose) and
   click "Enter Arena". Move with **WASD**, aim with the mouse, and hold
   **left click** to fire.
2. Destroy squares, triangles, and pentagons scattered around the arena
   (and rival AI tanks) for XP. Each level grants one stat point to spend
   on the left-hand panel — Health Regen, Max Health, Body Damage, Bullet
   Speed, Penetration, Bullet Damage, Reload, and Movement Speed, same
   eight stats diep.io uses.
3. Ramming shapes/tanks deals contact damage both ways (scaled by Body
   Damage); take too much and the run ends. Gears earned from the run
   (based on score, level, and kills) are banked immediately.
4. **Gacha**: spend Gears on single or 10x pulls. Rarity odds are shown
   up front, with a soft pity that guarantees an Epic+ within 10 pulls.
   Duplicate pulls raise that monster's star rank (up to 5), boosting its
   stats when equipped.
5. **Collection**: browse every monster you've pulled — rarity, star
   rank, barrel count, flavor text — and equip whichever loadout you want
   to take into the Arena next.

## Design data

All game balance/content lives in `/shared` as plain data, not scattered
through UI or simulation code:

- `types.ts` — shared interfaces (nothing Phaser/React-specific)
- `constants.ts` — rarity config (gacha weights/colors), the 8 diep.io-style
  stats and their per-point effects, the in-run XP curve, arena shape/bot
  tuning, gacha economy (pull costs, pity threshold)
- `monsterData.ts` — the 11-species gacha pool, each a "loadout": a barrel
  pattern (diep.io tank-class equivalent) plus stat multipliers

The client's simulation (`client/src/arena/`) and UI (`client/src/screens`,
`client/src/components`) both read from this package, so a future server
can import the exact same data for authoritative combat without
duplicating balance numbers.

## Roadmap (not yet built)

- **Node/TypeScript/Socket.IO server** under `/server`, owning
  authoritative arena state (positions, HP, kills, XP — never trusting the
  client) so multiple players can share one arena like real diep.io
- **PostgreSQL persistence** for accounts, collection, currency (currently
  client-only via `localStorage`, standing in for this)
- **Multiplayer arena**: shared shapes/players, damage, leaderboards, with
  interpolation for smooth movement
- More monster loadouts, evolving/branching gacha banners, a real
  cosmetic/economy sink for spare Gears, and bespoke sprite art for each
  species (the current build renders everything procedurally — colored
  circles, barrels, and polygons — so no external art pipeline is needed)
