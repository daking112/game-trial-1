// ---------------------------------------------------------------------------
// Wardens of Everglen — core game logic (state, simulation, rendering, UI).
// ---------------------------------------------------------------------------

const SAVE_KEY = 'wardens-everglen-save-v1';

let state = null;
let canvas, ctx;
let idCounter = 1;
const nextId = () => idCounter++;

const WAVE_SPAWN_INTERVAL = 0.55;

function freshState() {
  return {
    gold: 100,
    orbs: 3,
    lives: 20,
    wave: 1, // next wave to start
    unlocked: new Set(SPECIES.filter((s) => s.starter).map((s) => s.id)),
    towers: [],
    enemies: [],
    effects: [],
    spawnQueue: [],
    spawnTimer: 0,
    waveActive: false,
    gameTime: 0,
    speedMult: 1,
    selectedSpeciesId: null,
    selectedTowerId: null,
    hoverCol: -1,
    hoverRow: -1,
    gameOver: false,
    encounterPending: false,
  };
}

function serializeState(s) {
  return {
    gold: s.gold,
    orbs: s.orbs,
    lives: s.lives,
    wave: s.wave,
    unlocked: Array.from(s.unlocked),
    towers: s.towers.map((t) => ({ id: t.id, speciesId: t.speciesId, col: t.col, row: t.row, level: t.level, invested: t.invested })),
  };
}

function deserializeInto(s, data) {
  s.gold = data.gold;
  s.orbs = data.orbs;
  s.lives = data.lives;
  s.wave = data.wave;
  s.unlocked = new Set(data.unlocked);
  s.towers = data.towers.map((t) => {
    const { x, y } = cellToPixel(t.col, t.row);
    return { ...t, x, y, cooldown: 0 };
  });
  idCounter = Math.max(1, ...s.towers.map((t) => t.id + 1), 1);
}

function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(serializeState(state)));
  } catch (e) { /* ignore quota errors */ }
}

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Boot / menu wiring
// ---------------------------------------------------------------------------

window.addEventListener('DOMContentLoaded', () => {
  canvas = document.getElementById('game-canvas');
  ctx = canvas.getContext('2d');

  const existing = loadSave();
  if (existing) document.getElementById('btn-continue').style.display = 'block';

  document.getElementById('btn-start').addEventListener('click', () => {
    clearSave();
    state = freshState();
    beginGame();
  });
  document.getElementById('btn-continue').addEventListener('click', () => {
    state = freshState();
    deserializeInto(state, existing);
    beginGame();
  });
  document.getElementById('btn-restart').addEventListener('click', () => {
    clearSave();
    state = freshState();
    document.getElementById('game-over-screen').style.display = 'none';
    beginGame();
  });

  document.getElementById('btn-wave').addEventListener('click', startWave);
  document.getElementById('btn-speed').addEventListener('click', toggleSpeed);

  canvas.addEventListener('mousemove', onCanvasMouseMove);
  canvas.addEventListener('click', onCanvasClick);
  canvas.addEventListener('mouseleave', () => { state && (state.hoverCol = -1, state.hoverRow = -1); });
});

function beginGame() {
  document.getElementById('menu-screen').style.display = 'none';
  document.getElementById('game-over-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  log('Welcome, Warden. Defend the Hearthstone!');
  renderRoster();
  renderSelectionPanel();
  refreshHud();
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

let lastFrameT = null;

function loop(t) {
  if (lastFrameT === null) lastFrameT = t;
  let rawDt = (t - lastFrameT) / 1000;
  lastFrameT = t;
  rawDt = Math.min(rawDt, 0.05);

  if (!state.gameOver) {
    const dt = rawDt * state.speedMult;
    update(dt);
  }
  render();
  requestAnimationFrame(loop);
}

function update(dt) {
  state.gameTime += dt;

  // Spawn enemies from the queue.
  if (state.waveActive) {
    state.spawnTimer -= dt;
    while (state.waveActive && state.spawnTimer <= 0 && state.spawnQueue.length > 0) {
      spawnEnemy(state.spawnQueue.shift());
      state.spawnTimer += WAVE_SPAWN_INTERVAL;
    }
  }

  updateEnemies(dt);
  updateTowers(dt);
  updateEffects(dt);

  if (state.waveActive && state.spawnQueue.length === 0 && state.enemies.length === 0) {
    onWaveClear();
  }
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

function spawnEnemy(spec) {
  const start = pointAtDistance(0);
  state.enemies.push({
    id: nextId(),
    typeId: spec.typeId,
    hp: spec.hp,
    maxHp: spec.maxHp,
    speed: spec.speed,
    reward: spec.reward,
    lives: spec.lives,
    armor: spec.armor,
    dist: 0,
    x: start.x,
    y: start.y,
    slowUntil: 0,
    slowFactor: 1,
    poisonUntil: 0,
    poisonDps: 0,
    freezeUntil: 0,
    dead: false,
  });
}

function updateEnemies(dt) {
  const survivors = [];
  for (const en of state.enemies) {
    if (en.dead) continue;

    let speedMult = 1;
    if (state.gameTime < en.freezeUntil) speedMult = 0;
    else if (state.gameTime < en.slowUntil) speedMult = en.slowFactor;

    en.dist += en.speed * speedMult * dt;

    if (state.gameTime < en.poisonUntil) {
      en.hp -= en.poisonDps * dt;
    }

    if (en.hp <= 0) {
      killEnemy(en);
      continue;
    }

    if (en.dist >= PATH_LENGTH) {
      state.lives -= en.lives;
      toast(en.x, en.y, `-${en.lives} ❤️`, 'dmg');
      if (state.lives <= 0) {
        state.lives = 0;
        triggerGameOver();
      }
      continue;
    }

    const p = pointAtDistance(en.dist);
    en.x = p.x;
    en.y = p.y;
    survivors.push(en);
  }
  state.enemies = survivors;
}

function killEnemy(en) {
  en.dead = true;
  state.gold += en.reward;
  toast(en.x, en.y - 10, `+${en.reward}🪙`, 'gold');
  if (ENEMY_TYPES[en.typeId].boss) log(`The ${ENEMY_TYPES[en.typeId].name} has been defeated!`);
}

// ---------------------------------------------------------------------------
// Towers
// ---------------------------------------------------------------------------

function towerStats(tower) {
  const species = SPECIES_BY_ID[tower.speciesId];
  const lvl = tower.level;
  return {
    species,
    damage: species.damage * (1 + 0.35 * (lvl - 1)),
    range: species.range * (1 + 0.08 * (lvl - 1)),
    atkSpeed: species.atkSpeed * (1 + 0.15 * (lvl - 1)),
  };
}

function updateTowers(dt) {
  for (const tower of state.towers) {
    tower.cooldown -= dt;
    if (tower.cooldown > 0) continue;

    const stats = towerStats(tower);
    let best = null;
    let bestDist = -1;
    for (const en of state.enemies) {
      if (en.dead) continue;
      const d = Math.hypot(en.x - tower.x, en.y - tower.y);
      if (d <= stats.range && en.dist > bestDist) {
        best = en;
        bestDist = en.dist;
      }
    }
    if (best) {
      attack(tower, stats, best);
      tower.cooldown = 1 / stats.atkSpeed;
    } else {
      tower.cooldown = 0.1;
    }
  }
}

function attack(tower, stats, target) {
  const species = stats.species;
  let dmg = stats.damage;
  let crit = false;

  if (species.special && species.special.type === 'crit' && Math.random() < species.special.chance) {
    dmg *= species.special.mult;
    crit = true;
  }

  dealDamage(target, dmg, tower);
  addEffect({ kind: 'shot', x1: tower.x, y1: tower.y, x2: target.x, y2: target.y, color: species.color, timer: 0.12, maxTimer: 0.12 });
  toast(target.x, target.y - 18, crit ? `${Math.round(dmg)}!` : `${Math.round(dmg)}`, crit ? 'gold' : 'dmg');

  if (!species.special) return;

  switch (species.special.type) {
    case 'slow': {
      const until = state.gameTime + species.special.duration;
      if (until > target.slowUntil) {
        target.slowUntil = until;
        target.slowFactor = species.special.factor;
      }
      break;
    }
    case 'poison': {
      target.poisonUntil = Math.max(target.poisonUntil, state.gameTime + species.special.duration);
      target.poisonDps = Math.max(target.poisonDps, species.special.dps);
      break;
    }
    case 'freeze': {
      if (Math.random() < species.special.chance) {
        target.freezeUntil = Math.max(target.freezeUntil, state.gameTime + species.special.duration);
      }
      break;
    }
    case 'chain': {
      const others = state.enemies
        .filter((e) => !e.dead && e.id !== target.id && Math.hypot(e.x - target.x, e.y - target.y) <= species.special.radius)
        .slice(0, species.special.targets);
      for (const other of others) {
        dealDamage(other, dmg * species.special.falloff, tower);
        addEffect({ kind: 'shot', x1: target.x, y1: target.y, x2: other.x, y2: other.y, color: species.color, timer: 0.12, maxTimer: 0.12 });
      }
      break;
    }
    case 'splash': {
      const others = state.enemies.filter((e) => !e.dead && e.id !== target.id && Math.hypot(e.x - target.x, e.y - target.y) <= species.special.radius);
      for (const other of others) {
        dealDamage(other, dmg * species.special.falloff, tower);
      }
      addEffect({ kind: 'circle', x: target.x, y: target.y, radius: species.special.radius, color: species.color, timer: 0.25, maxTimer: 0.25 });
      break;
    }
  }
}

function dealDamage(enemy, dmg, tower) {
  const effective = Math.max(1, dmg - enemy.armor);
  enemy.hp -= effective;
}

// ---------------------------------------------------------------------------
// Effects (visual only)
// ---------------------------------------------------------------------------

function addEffect(e) { state.effects.push(e); }

function updateEffects(dt) {
  state.effects = state.effects.filter((e) => {
    e.timer -= dt;
    return e.timer > 0;
  });
}

function toast(x, y, text, cls) {
  const layer = document.getElementById('toast-layer');
  const el = document.createElement('div');
  el.className = `toast ${cls || ''}`;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.textContent = text;
  layer.appendChild(el);
  setTimeout(() => el.remove(), 900);
}

// ---------------------------------------------------------------------------
// Waves
// ---------------------------------------------------------------------------

function startWave() {
  if (state.waveActive || state.gameOver) return;
  state.spawnQueue = generateWave(state.wave);
  state.spawnTimer = 0;
  state.waveActive = true;
  log(`Wave ${state.wave} incoming!`);
  refreshHud();
}

function onWaveClear() {
  state.waveActive = false;
  const bonus = 15 + state.wave * 3;
  state.gold += bonus;
  const orbGain = 1 + (state.wave % 5 === 0 ? 2 : 0);
  state.orbs += orbGain;
  log(`Wave ${state.wave} cleared! +${bonus}🪙 +${orbGain}🔮`);
  state.wave += 1;
  save();
  refreshHud();
  maybeStartEncounter();
}

function maybeStartEncounter() {
  if (state.encounterPending) return;
  state.encounterPending = true;
  const species = weightedRandomSpecies(false);
  const alreadyOwned = state.unlocked.has(species.id);
  openCaptureModal({
    species,
    orbs: state.orbs,
    alreadyOwned,
    onResolve: (success) => {
      state.encounterPending = false;
      if (success === null) {
        log('You let the wild warden go.');
        return;
      }
      state.orbs -= 1;
      if (success) {
        if (alreadyOwned) {
          const bonus = 20 + RARITY_ORDER.indexOf(species.rarity) * 15;
          state.gold += bonus;
          log(`Captured a duplicate ${species.name} — converted to ${bonus}🪙.`);
        } else {
          state.unlocked.add(species.id);
          log(`New warden captured: ${species.name}!`);
          renderRoster();
        }
      } else {
        log(`The ${species.name} escaped your orb.`);
      }
      refreshHud();
      save();
    },
  });
}

function triggerGameOver() {
  state.gameOver = true;
  document.getElementById('final-wave').textContent = Math.max(0, state.wave - 1);
  document.getElementById('final-species').textContent = state.unlocked.size;
  document.getElementById('game-over-screen').style.display = 'flex';
  clearSave();
}

// ---------------------------------------------------------------------------
// Tower placement / selection
// ---------------------------------------------------------------------------

function getTowerAt(col, row) {
  return state.towers.find((t) => t.col === col && t.row === row) || null;
}

function placeTower(col, row) {
  const species = SPECIES_BY_ID[state.selectedSpeciesId];
  if (!species || !isBuildable(col, row) || getTowerAt(col, row)) return;
  if (state.gold < species.buildCost) { log('Not enough gold for that warden.'); return; }
  state.gold -= species.buildCost;
  const { x, y } = cellToPixel(col, row);
  state.towers.push({ id: nextId(), speciesId: species.id, col, row, x, y, level: 1, cooldown: 0, invested: species.buildCost });
  log(`Summoned ${species.name} to the field.`);
  refreshHud();
  save();
}

function upgradeSelectedTower() {
  const tower = state.towers.find((t) => t.id === state.selectedTowerId);
  if (!tower) return;
  const species = SPECIES_BY_ID[tower.speciesId];
  if (tower.level >= 3) return;
  const cost = species.upgradeCost * tower.level;
  if (state.gold < cost) return;
  state.gold -= cost;
  tower.level += 1;
  tower.invested += cost;
  log(`${species.name} upgraded to level ${tower.level}.`);
  refreshHud();
  renderSelectionPanel();
  save();
}

function sellSelectedTower() {
  const tower = state.towers.find((t) => t.id === state.selectedTowerId);
  if (!tower) return;
  const species = SPECIES_BY_ID[tower.speciesId];
  const refund = Math.round(tower.invested * 0.6);
  state.gold += refund;
  state.towers = state.towers.filter((t) => t.id !== tower.id);
  state.selectedTowerId = null;
  log(`Sold ${species.name} for ${refund}🪙.`);
  refreshHud();
  renderSelectionPanel();
  save();
}

// ---------------------------------------------------------------------------
// Canvas interaction
// ---------------------------------------------------------------------------

function canvasCoords(evt) {
  const rect = canvas.getBoundingClientRect();
  const x = (evt.clientX - rect.left) * (canvas.width / rect.width);
  const y = (evt.clientY - rect.top) * (canvas.height / rect.height);
  return { x, y };
}

function onCanvasMouseMove(evt) {
  const { x, y } = canvasCoords(evt);
  state.hoverCol = Math.floor(x / GRID.cell);
  state.hoverRow = Math.floor(y / GRID.cell);
}

function onCanvasClick(evt) {
  const { x, y } = canvasCoords(evt);
  const hitTower = state.towers.find((t) => Math.hypot(t.x - x, t.y - y) <= 18);
  if (hitTower) {
    state.selectedTowerId = hitTower.id;
    state.selectedSpeciesId = null;
    renderSelectionPanel();
    renderRoster();
    return;
  }
  const col = Math.floor(x / GRID.cell);
  const row = Math.floor(y / GRID.cell);
  if (state.selectedSpeciesId) {
    placeTower(col, row);
  } else {
    state.selectedTowerId = null;
    renderSelectionPanel();
  }
}

function toggleSpeed() {
  state.speedMult = state.speedMult === 1 ? 2 : 1;
  document.getElementById('btn-speed').textContent = `${state.speedMult}x Speed`;
}

// ---------------------------------------------------------------------------
// UI: HUD, roster, selection panel, log
// ---------------------------------------------------------------------------

function refreshHud() {
  document.getElementById('stat-gold').textContent = state.gold;
  document.getElementById('stat-orbs').textContent = state.orbs;
  document.getElementById('stat-lives').textContent = state.lives;
  document.getElementById('stat-wave').textContent = state.wave;
  const waveBtn = document.getElementById('btn-wave');
  waveBtn.disabled = state.waveActive;
  waveBtn.textContent = state.waveActive ? 'Wave in Progress…' : `Start Wave ${state.wave}`;
}

function renderRoster() {
  const list = document.getElementById('roster-list');
  list.innerHTML = '';
  for (const species of SPECIES) {
    const unlocked = state.unlocked.has(species.id);
    const item = document.createElement('div');
    item.className = `roster-item ${unlocked ? 'selectable' : 'locked'} ${state.selectedSpeciesId === species.id ? 'selected' : ''}`;

    const icon = document.createElement('div');
    icon.className = 'roster-icon';
    icon.style.background = unlocked ? `${species.color}33` : '#222';
    icon.style.borderColor = unlocked ? species.color : '#444';
    icon.textContent = unlocked ? species.icon : '❔';

    const info = document.createElement('div');
    info.className = 'roster-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'roster-name';
    nameEl.textContent = unlocked ? species.name : '??? Warden';
    const subEl = document.createElement('div');
    subEl.className = 'roster-sub';
    subEl.innerHTML = `<span class="rarity-${species.rarity}">${species.rarity}</span>` +
      (unlocked ? ` &middot; dmg ${species.damage} &middot; rng ${species.range}` : ' &middot; capture in the wild to unlock');
    info.appendChild(nameEl);
    info.appendChild(subEl);

    item.appendChild(icon);
    item.appendChild(info);

    if (unlocked) {
      const cost = document.createElement('div');
      cost.className = 'roster-cost';
      cost.textContent = `${species.buildCost}🪙`;
      item.appendChild(cost);
      item.addEventListener('click', () => {
        state.selectedSpeciesId = state.selectedSpeciesId === species.id ? null : species.id;
        state.selectedTowerId = null;
        renderRoster();
        renderSelectionPanel();
      });
    }

    list.appendChild(item);
  }
}

function renderSelectionPanel() {
  const panel = document.getElementById('selection-panel');
  const nameEl = document.getElementById('sel-name');
  const body = document.getElementById('sel-body');
  body.innerHTML = '';

  if (state.selectedTowerId) {
    const tower = state.towers.find((t) => t.id === state.selectedTowerId);
    if (!tower) { panel.style.display = 'none'; return; }
    const species = SPECIES_BY_ID[tower.speciesId];
    const stats = towerStats(tower);
    panel.style.display = 'block';
    nameEl.textContent = `${species.icon} ${species.name} (Lv. ${tower.level})`;

    const rows = [
      ['Damage', stats.damage.toFixed(1)],
      ['Range', stats.range.toFixed(0)],
      ['Attacks / sec', stats.atkSpeed.toFixed(2)],
      ['Special', species.special ? species.special.type : 'none'],
    ];
    for (const [k, v] of rows) {
      const row = document.createElement('div');
      row.className = 'stat-row';
      row.innerHTML = `<span>${k}</span><b>${v}</b>`;
      body.appendChild(row);
    }

    if (tower.level < 3) {
      const cost = species.upgradeCost * tower.level;
      const upBtn = document.createElement('button');
      upBtn.className = 'btn btn-primary';
      upBtn.textContent = `Upgrade (${cost}🪙)`;
      upBtn.disabled = state.gold < cost;
      upBtn.addEventListener('click', upgradeSelectedTower);
      body.appendChild(upBtn);
    } else {
      const maxed = document.createElement('div');
      maxed.className = 'stat-row';
      maxed.innerHTML = '<b>Max level reached</b>';
      body.appendChild(maxed);
    }

    const sellBtn = document.createElement('button');
    sellBtn.className = 'btn btn-danger';
    sellBtn.textContent = `Sell (+${Math.round(tower.invested * 0.6)}🪙)`;
    sellBtn.addEventListener('click', sellSelectedTower);
    body.appendChild(sellBtn);
    return;
  }

  if (state.selectedSpeciesId) {
    const species = SPECIES_BY_ID[state.selectedSpeciesId];
    panel.style.display = 'block';
    nameEl.textContent = `${species.icon} ${species.name}`;
    const rows = [
      ['Cost', `${species.buildCost}🪙`],
      ['Damage', species.damage],
      ['Range', species.range],
      ['Attacks / sec', species.atkSpeed],
      ['Special', species.special ? species.special.type : 'none'],
    ];
    for (const [k, v] of rows) {
      const row = document.createElement('div');
      row.className = 'stat-row';
      row.innerHTML = `<span>${k}</span><b>${v}</b>`;
      body.appendChild(row);
    }
    const hint = document.createElement('div');
    hint.className = 'panel-hint';
    hint.textContent = 'Click an open tile on the map to summon.';
    body.appendChild(hint);
    return;
  }

  panel.style.display = 'none';
}

function log(msg) {
  const list = document.getElementById('log-list');
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.textContent = msg;
  list.appendChild(entry);
  while (list.children.length > 40) list.removeChild(list.firstChild);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();
  drawHoverPreview();
  drawEffects();
  drawTowers();
  drawEnemies();
}

function drawGrid() {
  for (let r = 0; r < GRID.rows; r++) {
    for (let c = 0; c < GRID.cols; c++) {
      const onPath = PATH_SET.has(`${c},${r}`);
      const checker = (r + c) % 2 === 0;
      ctx.fillStyle = onPath ? '#3a2e22' : (checker ? '#24382b' : '#213526');
      ctx.fillRect(c * GRID.cell, r * GRID.cell, GRID.cell, GRID.cell);
      if (onPath) {
        ctx.strokeStyle = 'rgba(0,0,0,0.15)';
        ctx.strokeRect(c * GRID.cell + 0.5, r * GRID.cell + 0.5, GRID.cell - 1, GRID.cell - 1);
      }
    }
  }
  // Spawn + goal markers.
  const spawn = pointAtDistance(0);
  const goal = pointAtDistance(PATH_LENGTH);
  ctx.fillStyle = '#e05c5c';
  ctx.beginPath(); ctx.arc(spawn.x, spawn.y, 10, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#4fd1c5';
  ctx.beginPath(); ctx.arc(goal.x, goal.y, 12, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#0a1014';
  ctx.font = '14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('🏰', goal.x, goal.y + 5);
}

function drawHoverPreview() {
  if (state.hoverCol < 0 || state.hoverRow < 0) return;
  if (state.hoverCol >= GRID.cols || state.hoverRow >= GRID.rows) return;
  const buildable = isBuildable(state.hoverCol, state.hoverRow) && !getTowerAt(state.hoverCol, state.hoverRow);

  if (state.selectedSpeciesId) {
    const species = SPECIES_BY_ID[state.selectedSpeciesId];
    const { x, y } = cellToPixel(state.hoverCol, state.hoverRow);
    ctx.fillStyle = buildable ? 'rgba(79,209,197,0.25)' : 'rgba(224,92,92,0.25)';
    ctx.fillRect(state.hoverCol * GRID.cell, state.hoverRow * GRID.cell, GRID.cell, GRID.cell);
    if (buildable) {
      ctx.strokeStyle = species.color;
      ctx.beginPath();
      ctx.arc(x, y, species.range, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else if (buildable) {
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(state.hoverCol * GRID.cell, state.hoverRow * GRID.cell, GRID.cell, GRID.cell);
  }
}

function drawTowers() {
  for (const tower of state.towers) {
    const species = SPECIES_BY_ID[tower.speciesId];
    const selected = tower.id === state.selectedTowerId;

    if (selected) {
      const stats = towerStats(tower);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.arc(tower.x, tower.y, stats.range, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = species.color;
    ctx.beginPath();
    ctx.arc(tower.x, tower.y, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = selected ? '#fff' : 'rgba(0,0,0,0.4)';
    ctx.lineWidth = selected ? 2 : 1;
    ctx.stroke();
    ctx.lineWidth = 1;

    ctx.font = '16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(species.icon, tower.x, tower.y + 1);

    for (let i = 0; i < tower.level; i++) {
      ctx.fillStyle = '#f2c14e';
      ctx.beginPath();
      ctx.arc(tower.x - 10 + i * 8, tower.y + 20, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawEnemies() {
  for (const en of state.enemies) {
    const type = ENEMY_TYPES[en.typeId];
    const frozen = state.gameTime < en.freezeUntil;
    const slowed = !frozen && state.gameTime < en.slowUntil;

    ctx.fillStyle = frozen ? '#bfe9ff' : type.color;
    ctx.beginPath();
    ctx.arc(en.x, en.y, type.boss ? 20 : 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.stroke();

    ctx.font = type.boss ? '20px sans-serif' : '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(type.icon, en.x, en.y + 1);

    if (slowed) {
      ctx.fillStyle = 'rgba(79,176,255,0.9)';
      ctx.font = '10px sans-serif';
      ctx.fillText('❄', en.x + 12, en.y - 10);
    }

    const barW = type.boss ? 36 : 22;
    const hpPct = Math.max(0, en.hp / en.maxHp);
    const barY = en.y - (type.boss ? 26 : 18);
    ctx.fillStyle = '#000';
    ctx.fillRect(en.x - barW / 2, barY, barW, 4);
    ctx.fillStyle = hpPct > 0.5 ? '#6bc96f' : hpPct > 0.25 ? '#f2c14e' : '#e05c5c';
    ctx.fillRect(en.x - barW / 2, barY, barW * hpPct, 4);
  }
}

function drawEffects() {
  for (const e of state.effects) {
    const alpha = Math.max(0, e.timer / e.maxTimer);
    if (e.kind === 'shot') {
      ctx.strokeStyle = e.color;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(e.x1, e.y1);
      ctx.lineTo(e.x2, e.y2);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.globalAlpha = 1;
    } else if (e.kind === 'circle') {
      ctx.strokeStyle = e.color;
      ctx.globalAlpha = alpha * 0.8;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius * (1 - alpha) + e.radius * 0.4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}
