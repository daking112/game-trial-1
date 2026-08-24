# Monsterfall

A browser-based multiplayer monster collection + tower defense game. Original
creatures, steampunk-fantasy hybrid Verdant-Forest setting ("Gearwood
Thicket"). Not affiliated with or based on any existing franchise.

This is the MVP described in the project design doc: a single-player,
client-only vertical slice covering steps 1–16 of the doc's development
priority list (map, waves, monster placement/targeting/attacks/abilities,
damage/death, boss, victory/defeat, monster data, collection UI,
XP/leveling, basic evolution). Multiplayer, the authoritative server, and
persistence (steps 17+) are the next phase — see below.

## Layout

```
/client   React + TypeScript + Vite + Phaser 3 client (the whole MVP lives here)
/shared   Cross-cutting game data & types: elements, rarity, traits, monster
          species, enemies, abilities, waves. No client or server dependency.
/legacy-prototype
          The original single-file vanilla-JS tower defense prototype this
          project started from. Kept for reference; superseded by /client.
```

`/server` (Node + TypeScript + Socket.IO, PostgreSQL persistence, the
authoritative battle/lobby state) doesn't exist yet — see Roadmap.

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

1. **Play → Choose Your Team**: pick up to 6 wardens from your collection
   (you start with one, Cogling) and start a battle.
2. **Battle**: click a warden in the bottom tray, then click an open (non-path)
   tile on the map to deploy it. Deployed wardens auto-attack enemies in
   range and periodically cast their ability. Click a deployed warden to see
   its stats, cycle its targeting mode, or fire its ultimate once the purple
   meter fills. Waves start automatically after a short prep countdown (or
   click "Start Now"); wave 10 ends in a boss fight.
3. On victory you're offered a capture encounter for a randomly-rolled wild
   species — capture chance is shown up front, based on rarity.
4. **Collection**: view every warden you own, their level/XP/trait/ability,
   deploy them to your team, and evolve them once they hit the required
   level.
5. **Codex**: track which of the 10 Gearwood Thicket species you've
   discovered and captured.

## Design data

All game balance/content lives in `/shared` as plain data, not scattered
through UI or simulation code:

- `types.ts` — shared interfaces (nothing Phaser/React-specific)
- `constants.ts` — `ELEMENT_ADVANTAGES` (centralized elemental matchups),
  rarity scaling/capture chances, trait definitions, the XP curve
- `monsterData.ts` — the 10 original species, each with element, rarity,
  base stats, one active ability, one passive, and (for half of them) a
  single-step evolution
- `enemyData.ts` — the 3 enemy kinds (Rustling/Hullcrusher/Sprocketail) +
  the wave-10 boss (The Foreman)
- `abilityData.ts` — the active ability pool (fireball/freeze/chain/poison/
  barrage-style effects), referenced by monsters
- `waveData.ts` — the 10-wave table, boss on wave 10

The client's simulation (`client/src/battle/`) and UI
(`client/src/screens`, `client/src/components`) both read from this package,
so a future server can import the exact same data for authoritative combat
without duplicating balance numbers.

## Roadmap (not yet built)

Following the design doc's own priority order — client-side systems first,
then multiplayer:

- **Node/TypeScript/Socket.IO server** under `/server`, owning authoritative
  battle state (damage, enemy HP, rewards, wave/victory outcomes — never
  trusting the client)
- **PostgreSQL persistence** for accounts, collection, codex, currency
  (currently client-only via `localStorage`, standing in for this)
- **Multiplayer lobby**: create/join by code, ready-up, 1–4 players
- **Battle synchronization**: shared enemy positions/HP, monster placement,
  damage, waves, victory/defeat across clients, with interpolation for
  smooth movement
- Branching evolution, eggs, a real economy sink for gold/crystals
  (training/upgrades), and real portrait/sprite art (see
  `client/public/monsters/README.md` — concept art was generated but
  couldn't be pulled into this session due to network policy)
