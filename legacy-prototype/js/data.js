// ---------------------------------------------------------------------------
// Static game data: grid/path, warden (tower) species, enemy types, waves.
// ---------------------------------------------------------------------------

const GRID = {
  cols: 15,
  rows: 9,
  cell: 48,
};

// Waypoints in (col, row) grid space. Each consecutive pair must differ in
// only one axis so the path can be walked one cell at a time.
const PATH_WAYPOINTS = [
  [-1, 4],
  [3, 4],
  [3, 1],
  [7, 1],
  [7, 7],
  [11, 7],
  [11, 2],
  [15, 2],
];

function buildPathCells(waypoints) {
  const cells = [waypoints[0].slice()];
  for (let i = 1; i < waypoints.length; i++) {
    let [cx, cy] = cells[cells.length - 1];
    const [tx, ty] = waypoints[i];
    while (cx !== tx || cy !== ty) {
      if (cx < tx) cx++;
      else if (cx > tx) cx--;
      else if (cy < ty) cy++;
      else if (cy > ty) cy--;
      cells.push([cx, cy]);
    }
  }
  return cells;
}

const PATH_CELLS = buildPathCells(PATH_WAYPOINTS);

const PATH_SET = new Set(PATH_CELLS.map(([c, r]) => `${c},${r}`));

function cellToPixel(col, row) {
  return {
    x: col * GRID.cell + GRID.cell / 2,
    y: row * GRID.cell + GRID.cell / 2,
  };
}

const PATH_POINTS = PATH_CELLS.map(([c, r]) => cellToPixel(c, r));

// Cumulative distance along the path, for interpolating enemy position.
const PATH_DIST = [0];
for (let i = 1; i < PATH_POINTS.length; i++) {
  const a = PATH_POINTS[i - 1];
  const b = PATH_POINTS[i];
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  PATH_DIST.push(PATH_DIST[i - 1] + d);
}
const PATH_LENGTH = PATH_DIST[PATH_DIST.length - 1];

function pointAtDistance(dist) {
  if (dist <= 0) return { ...PATH_POINTS[0] };
  if (dist >= PATH_LENGTH) return { ...PATH_POINTS[PATH_POINTS.length - 1] };
  // Linear scan is fine: path has ~50 points.
  let i = 1;
  while (i < PATH_DIST.length && PATH_DIST[i] < dist) i++;
  const d0 = PATH_DIST[i - 1];
  const d1 = PATH_DIST[i];
  const t = d1 === d0 ? 0 : (dist - d0) / (d1 - d0);
  const a = PATH_POINTS[i - 1];
  const b = PATH_POINTS[i];
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function isBuildable(col, row) {
  if (col < 0 || row < 0 || col >= GRID.cols || row >= GRID.rows) return false;
  return !PATH_SET.has(`${col},${row}`);
}

// ---------------------------------------------------------------------------
// Warden species (towers). "rarity" gates how hard they are to capture.
// ---------------------------------------------------------------------------

const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic'];
const RARITY_CAPTURE_ZONE = { common: 0.42, uncommon: 0.30, rare: 0.20, epic: 0.13 };
const RARITY_WEIGHT = { common: 50, uncommon: 28, rare: 15, epic: 7 };

const SPECIES = [
  {
    id: 'emberling',
    name: 'Emberling',
    icon: '🔥',
    color: '#ff7a45',
    rarity: 'common',
    starter: true,
    desc: 'A steady flame-pup. Reliable single-target damage.',
    buildCost: 50,
    upgradeCost: 40,
    damage: 12,
    range: 108,
    atkSpeed: 1.2,
    special: null,
  },
  {
    id: 'tidefin',
    name: 'Tidefin',
    icon: '💧',
    color: '#4fb0ff',
    rarity: 'common',
    desc: 'Douses foes, slowing them with every hit.',
    buildCost: 60,
    upgradeCost: 45,
    damage: 8,
    range: 100,
    atkSpeed: 1.0,
    special: { type: 'slow', factor: 0.5, duration: 1.5 },
  },
  {
    id: 'sproutling',
    name: 'Sproutling',
    icon: '🌱',
    color: '#6bc96f',
    rarity: 'uncommon',
    desc: 'Coats enemies in spores that poison over time.',
    buildCost: 70,
    upgradeCost: 50,
    damage: 5,
    range: 92,
    atkSpeed: 1.0,
    special: { type: 'poison', dps: 5, duration: 3 },
  },
  {
    id: 'voltpup',
    name: 'Voltpup',
    icon: '⚡',
    color: '#f4d13f',
    rarity: 'uncommon',
    desc: 'Fast bites that arc lightning to nearby foes.',
    buildCost: 90,
    upgradeCost: 60,
    damage: 9,
    range: 120,
    atkSpeed: 1.5,
    special: { type: 'chain', targets: 2, falloff: 0.5, radius: 64 },
  },
  {
    id: 'pebblehide',
    name: 'Pebblehide',
    icon: '🪨',
    color: '#b6a27a',
    rarity: 'common',
    desc: 'Slow but heavy — smashes an area on impact.',
    buildCost: 65,
    upgradeCost: 48,
    damage: 17,
    range: 80,
    atkSpeed: 0.6,
    special: { type: 'splash', radius: 46, falloff: 0.6 },
  },
  {
    id: 'shadowkit',
    name: 'Shadowkit',
    icon: '🌑',
    color: '#9d7bd8',
    rarity: 'rare',
    desc: 'Strikes from the dark for heavy critical damage.',
    buildCost: 120,
    upgradeCost: 80,
    damage: 26,
    range: 74,
    atkSpeed: 0.85,
    special: { type: 'crit', chance: 0.3, mult: 2 },
  },
  {
    id: 'gustling',
    name: 'Gustling',
    icon: '🌪️',
    color: '#8fe0d8',
    rarity: 'uncommon',
    desc: 'A blur of wind — very fast, light hits.',
    buildCost: 75,
    upgradeCost: 52,
    damage: 5,
    range: 100,
    atkSpeed: 2.4,
    special: null,
  },
  {
    id: 'crystalis',
    name: 'Crystalis',
    icon: '❄️',
    color: '#bfe9ff',
    rarity: 'epic',
    desc: 'Rare frost warden that can freeze foes solid.',
    buildCost: 150,
    upgradeCost: 100,
    damage: 13,
    range: 100,
    atkSpeed: 0.9,
    special: { type: 'freeze', chance: 0.25, duration: 1.0 },
  },
];

const SPECIES_BY_ID = Object.fromEntries(SPECIES.map((s) => [s.id, s]));

function weightedRandomSpecies(excludeStarter) {
  const pool = SPECIES.filter((s) => !excludeStarter || !s.starter);
  const total = pool.reduce((sum, s) => sum + RARITY_WEIGHT[s.rarity], 0);
  let roll = Math.random() * total;
  for (const s of pool) {
    roll -= RARITY_WEIGHT[s.rarity];
    if (roll <= 0) return s;
  }
  return pool[pool.length - 1];
}

// ---------------------------------------------------------------------------
// Enemy types (the Blight).
// ---------------------------------------------------------------------------

const ENEMY_TYPES = {
  grub: { id: 'grub', name: 'Blight Grub', icon: '🐛', color: '#7a8f4a', hp: 28, speed: 42, reward: 4, lives: 1, armor: 0 },
  fang: { id: 'fang', name: 'Blight Fang', icon: '🦴', color: '#c9c2a8', hp: 18, speed: 74, reward: 5, lives: 1, armor: 0 },
  shell: { id: 'shell', name: 'Blight Shell', icon: '🐌', color: '#8a6b4f', hp: 85, speed: 26, reward: 11, lives: 2, armor: 3 },
  wisp: { id: 'wisp', name: 'Blight Wisp', icon: '👻', color: '#c9a8e0', hp: 42, speed: 58, reward: 7, lives: 1, armor: 0 },
  behemoth: { id: 'behemoth', name: 'Blight Behemoth', icon: '👹', color: '#b23b3b', hp: 480, speed: 20, reward: 60, lives: 5, armor: 6, boss: true },
};

// Build the spawn queue for a given wave number (1-indexed).
function generateWave(waveNum) {
  const hpMult = 1 + (waveNum - 1) * 0.16;
  const speedMult = 1 + Math.min(waveNum - 1, 12) * 0.02;
  const count = 6 + waveNum * 2;

  const available = ['grub'];
  if (waveNum >= 2) available.push('fang');
  if (waveNum >= 4) available.push('shell');
  if (waveNum >= 6) available.push('wisp');

  const queue = [];
  for (let i = 0; i < count; i++) {
    const typeId = available[Math.floor(Math.random() * available.length)];
    queue.push(makeEnemySpec(typeId, hpMult, speedMult));
  }
  // Shuffle lightly so types interleave.
  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }

  if (waveNum % 5 === 0) {
    queue.push(makeEnemySpec('behemoth', 1 + (waveNum / 5 - 1) * 0.5, 1));
  }

  return queue;
}

function makeEnemySpec(typeId, hpMult, speedMult) {
  const base = ENEMY_TYPES[typeId];
  return {
    typeId,
    hp: Math.round(base.hp * hpMult),
    maxHp: Math.round(base.hp * hpMult),
    speed: base.speed * speedMult,
    reward: base.reward,
    lives: base.lives,
    armor: base.armor,
  };
}
