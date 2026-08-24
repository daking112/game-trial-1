// ---------------------------------------------------------------------------
// Capture minigame: a marker sweeps a bar, player stops it inside the zone.
// Zone width is set by the species' rarity (rarer = narrower = harder).
// ---------------------------------------------------------------------------

function openCaptureModal({ species, orbs, alreadyOwned, onResolve }) {
  const root = document.getElementById('capture-modal');
  root.style.display = 'flex';
  root.innerHTML = '';

  const card = document.createElement('div');
  card.className = 'capture-card';

  const icon = document.createElement('div');
  icon.className = 'capture-icon';
  icon.style.borderColor = species.color;
  icon.textContent = species.icon;

  const name = document.createElement('div');
  name.className = 'capture-name';
  name.textContent = `A wild ${species.name} appeared!`;

  const desc = document.createElement('div');
  desc.className = 'capture-desc';
  desc.innerHTML = `<span class="rarity-${species.rarity}">${species.rarity.toUpperCase()}</span> &middot; ${species.desc}` +
    (alreadyOwned ? '<br>Already in your roster — a capture here grants a bonus of gold instead.' : '');

  const barWrap = document.createElement('div');
  barWrap.className = 'capture-bar-wrap';

  const zoneWidthPct = RARITY_CAPTURE_ZONE[species.rarity] * 100;
  const zoneStartPct = Math.random() * (100 - zoneWidthPct);
  const zone = document.createElement('div');
  zone.className = 'capture-zone';
  zone.style.left = `${zoneStartPct}%`;
  zone.style.width = `${zoneWidthPct}%`;

  const marker = document.createElement('div');
  marker.className = 'capture-marker';
  marker.style.left = '0%';

  barWrap.appendChild(zone);
  barWrap.appendChild(marker);

  const result = document.createElement('div');
  result.className = 'capture-result';

  const actions = document.createElement('div');
  actions.className = 'capture-actions';

  const throwBtn = document.createElement('button');
  throwBtn.className = 'btn btn-primary';
  throwBtn.textContent = orbs > 0 ? `Throw Orb (${orbs} left)` : 'No Orbs Left';
  throwBtn.disabled = orbs <= 0;

  const skipBtn = document.createElement('button');
  skipBtn.className = 'btn btn-secondary';
  skipBtn.textContent = 'Let it go';

  actions.appendChild(throwBtn);
  actions.appendChild(skipBtn);

  card.appendChild(icon);
  card.appendChild(name);
  card.appendChild(desc);
  card.appendChild(barWrap);
  card.appendChild(result);
  card.appendChild(actions);
  root.appendChild(card);

  let pos = 0;
  let dir = 1;
  const speed = 1.6 + Math.random() * 0.6; // sweeps per second-ish
  let running = true;
  let rafId = null;
  let lastT = performance.now();

  function tick(t) {
    if (!running) return;
    const dt = (t - lastT) / 1000;
    lastT = t;
    pos += dir * speed * dt * 100;
    if (pos >= 100) { pos = 100; dir = -1; }
    if (pos <= 0) { pos = 0; dir = 1; }
    marker.style.left = `${pos}%`;
    rafId = requestAnimationFrame(tick);
  }
  rafId = requestAnimationFrame(tick);

  function finish(success) {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    throwBtn.disabled = true;
    result.textContent = success
      ? (alreadyOwned ? 'Captured! (Duplicate — bonus gold awarded)' : 'Captured! Added to your roster.')
      : 'It broke free and fled...';
    result.className = `capture-result ${success ? 'success' : 'fail'}`;
    skipBtn.textContent = 'Close';
    setTimeout(() => {
      root.style.display = 'none';
      root.innerHTML = '';
      onResolve(success);
    }, success ? 950 : 850);
  }

  throwBtn.addEventListener('click', () => {
    if (!running) return;
    const inZone = pos >= zoneStartPct && pos <= zoneStartPct + zoneWidthPct;
    finish(inZone);
  });

  skipBtn.addEventListener('click', () => {
    if (!running) {
      return; // already resolving via finish()
    }
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    root.style.display = 'none';
    root.innerHTML = '';
    onResolve(null); // null = declined, no orb spent
  });
}
