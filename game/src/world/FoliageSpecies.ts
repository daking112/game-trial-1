import * as THREE from 'three';
import {
  blade, clump, cog, facet, frond, limb, mergeGeos, paint, paintShaded, rand32, range, type Rnd,
} from './FoliageGeometry';

/**
 * Species definitions for the Gearwood Thicket.
 *
 * Every tree is authored at a canonical height of 1.0 and scaled up by the
 * instance matrix. That keeps one wind shader valid for a sapling and a
 * forty-foot spire at the same time, and it means "how tall is this tree" is a
 * single float on the placement side rather than a per-species special case.
 */

export interface Built {
  /** Bark + leaf + moss, all vertex-coloured, one material. */
  organic: THREE.BufferGeometry;
  /** Brass / copper fittings, metallic material. */
  metal: THREE.BufferGeometry;
  /** Canopy half-width at canonical height 1 -- used for placement spacing. */
  radius: number;
}

export interface LeafPalette {
  down: string;
  up: string;
}

export const LEAF_PALETTES: LeafPalette[] = [
  // One green family carries the whole forest; variation lives in *value*
  // (0 -> 2 get progressively lighter and warmer) rather than in hue. The last
  // two are accents and are deliberately rationed to the rarer species --
  // scattering four hues evenly makes a forest read as confetti.
  // The shaded undersides were dark enough that the canopy dragged the whole
  // playfield to the lowest luma in the frame. Lifted so the forest reads as
  // bright mass with form, rather than as a dark mat the eye slides off.
  { down: '#2f6b3c', up: '#86cc55' }, // forest green
  { down: '#2c6245', up: '#6cba5c' }, // deep green
  { down: '#4f6f31', up: '#b3d463' }, // sunlit yellow-green
  { down: '#276a5e', up: '#6cc4a0' }, // verdigris (accent)
  { down: '#6d4423', up: '#d59a4e' }, // oxidised copper (accent)
];

const BARK_DARK = new THREE.Color('#3a2c22');
const BARK_LIGHT = new THREE.Color('#8a7154');

function bark(g: THREE.BufferGeometry, tint = 1): THREE.BufferGeometry {
  return paintShaded(
    facet(g),
    BARK_DARK.clone().multiplyScalar(tint),
    BARK_LIGHT.clone().multiplyScalar(tint),
    { occlude: 0.3 },
  );
}

function leaf(g: THREE.BufferGeometry, pal: LeafPalette, occlude = 0.42): THREE.BufferGeometry {
  return paintShaded(facet(g), new THREE.Color(pal.down), new THREE.Color(pal.up), { occlude });
}

/** Normalise so the tallest point sits at y = 1 and the base at y = 0. */
function normalise(parts: THREE.BufferGeometry[]): number {
  let lo = Infinity, hi = -Infinity;
  for (const g of parts) {
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
  }
  const s = 1 / Math.max(hi - lo, 1e-3);
  for (const g of parts) {
    g.translate(0, -lo, 0);
    g.scale(s, s, s);
  }
  return s;
}

function widestRadius(parts: THREE.BufferGeometry[]): number {
  let r = 0;
  for (const g of parts) {
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const d = Math.hypot(p.getX(i), p.getZ(i));
      if (d > r) r = d;
    }
  }
  return r;
}

// ---------------------------------------------------------------------------
// Trees
// ---------------------------------------------------------------------------

/** Brass band wrapped around a trunk at height y. */
function band(y: number, radius: number, thickness: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(radius, radius * 1.02, thickness, 9, 1, true);
  g.translate(0, y, 0);
  return facet(g);
}

function rivets(y: number, radius: number, count: number, size: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const b = new THREE.IcosahedronGeometry(size, 0);
    b.translate(Math.cos(a) * radius, y, Math.sin(a) * radius);
    out.push(facet(b));
  }
  return out;
}

/** Spirewood: tall conifer built from stacked drooping tiers, not a cone. */
function buildSpire(rnd: Rnd, pal: LeafPalette): Built {
  const org: THREE.BufferGeometry[] = [];
  const met: THREE.BufferGeometry[] = [];
  const h = range(rnd, 8.5, 11);
  const lean = range(rnd, -0.25, 0.25);

  org.push(bark(limb({
    height: h, radiusBottom: range(rnd, 0.42, 0.56), radiusTop: 0.07,
    bendX: lean, bendZ: range(rnd, -0.2, 0.2), heightSeg: 7, radialSeg: 7, gnarl: 0.13, rnd,
  })));

  // Root buttresses -- three small flared limbs leaning into the trunk.
  for (let i = 0; i < 3; i++) {
    const a = range(rnd, 0, Math.PI * 2);
    const r = limb({ height: range(rnd, 0.7, 1.2), radiusBottom: 0.24, radiusTop: 0.05, flare: 2.2, gnarl: 0.2, rnd });
    r.rotateZ(Math.cos(a) * 0.75);
    r.rotateX(-Math.sin(a) * 0.75);
    r.translate(Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3);
    org.push(bark(r));
  }

  const tiers = Math.round(range(rnd, 5, 7));
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const y = h * (0.3 + t * 0.72);
    const rad = THREE.MathUtils.lerp(2.3, 0.5, Math.pow(t, 0.85)) * range(rnd, 0.86, 1.12);
    // Each tier is two or three overlapping lobes offset off-axis, which is
    // what stops the silhouette collapsing into a rotationally symmetric cone.
    const lobes = i < tiers - 1 ? 3 : 2;
    for (let j = 0; j < lobes; j++) {
      const a = range(rnd, 0, Math.PI * 2);
      const off = rad * range(rnd, 0.18, 0.45);
      const c = clump(rad * range(rnd, 0.6, 0.82), 1, rnd, 0.17);
      c.scale(1, range(rnd, 0.55, 0.75), 1);
      c.translate(Math.cos(a) * off + lean * (y / h) * (y / h) * 1.0, y + range(rnd, -0.18, 0.18), Math.sin(a) * off);
      org.push(leaf(c, pal));
    }
  }

  const parts = [...org, ...met];
  normalise(parts);
  return { organic: mergeGeos(org), metal: mergeGeos(met), radius: widestRadius(parts) };
}

/** Boughwood: broad deciduous crown carried on visible branches. */
function buildBough(rnd: Rnd, pal: LeafPalette): Built {
  const org: THREE.BufferGeometry[] = [];
  const met: THREE.BufferGeometry[] = [];
  const h = range(rnd, 4.2, 6.4);
  const rb = range(rnd, 0.5, 0.68);

  org.push(bark(limb({
    height: h, radiusBottom: rb, radiusTop: 0.2,
    bendX: range(rnd, -0.4, 0.4), bendZ: range(rnd, -0.4, 0.4),
    heightSeg: 6, radialSeg: 8, gnarl: 0.16, flare: 2.0, rnd,
  })));

  const nb = Math.round(range(rnd, 3, 5));
  const crown: { x: number; y: number; z: number; r: number }[] = [];
  for (let i = 0; i < nb; i++) {
    const a = (i / nb) * Math.PI * 2 + range(rnd, -0.4, 0.4);
    const tilt = range(rnd, 0.55, 0.95);
    const bl = range(rnd, 1.6, 2.6);
    const br = limb({ height: bl, radiusBottom: rb * 0.5, radiusTop: 0.07, gnarl: 0.2, flare: 1.3, radialSeg: 6, heightSeg: 4, rnd });
    br.rotateZ(tilt);
    br.rotateY(-a);
    const y0 = h * range(rnd, 0.55, 0.8);
    br.translate(0, y0, 0);
    org.push(bark(br));
    crown.push({
      x: Math.cos(a) * Math.sin(tilt) * bl * 0.95,
      y: y0 + Math.cos(tilt) * bl * 0.95,
      z: Math.sin(a) * Math.sin(tilt) * bl * 0.95,
      r: range(rnd, 1.35, 2.0),
    });
  }
  crown.push({ x: 0, y: h + range(rnd, 0.6, 1.2), z: 0, r: range(rnd, 1.7, 2.3) });

  for (const c of crown) {
    const n = Math.round(range(rnd, 2, 4));
    for (let j = 0; j < n; j++) {
      const g = clump(c.r * range(rnd, 0.62, 0.95), 1, rnd, 0.17);
      g.translate(
        c.x + range(rnd, -0.6, 0.6) * c.r,
        c.y + range(rnd, -0.35, 0.5) * c.r,
        c.z + range(rnd, -0.6, 0.6) * c.r,
      );
      org.push(leaf(g, pal));
    }
  }

  const parts = [...org, ...met];
  normalise(parts);
  return { organic: mergeGeos(org), metal: mergeGeos(met), radius: widestRadius(parts) };
}

/** Cogcap: squat brass-banded trunk under a wide flat cap. Reads at distance. */
function buildCogcap(rnd: Rnd, pal: LeafPalette): Built {
  const org: THREE.BufferGeometry[] = [];
  const met: THREE.BufferGeometry[] = [];
  const h = range(rnd, 3.0, 4.4);
  const rb = range(rnd, 0.66, 0.86);

  org.push(bark(limb({
    height: h, radiusBottom: rb, radiusTop: rb * 0.52,
    bendX: range(rnd, -0.2, 0.2), heightSeg: 5, radialSeg: 9, gnarl: 0.1, flare: 2.1, rnd,
  })));

  const bandY = h * range(rnd, 0.3, 0.45);
  met.push(paint(band(bandY, rb * 0.82, 0.28), new THREE.Color('#d0a13d')));
  met.push(...rivets(bandY, rb * 0.86, 6, 0.075).map((g) => paint(g, new THREE.Color('#e0b558'))));

  // The cap: a squashed dome with a darker gilled underside disc.
  const capR = range(rnd, 1.75, 2.4);
  const capY = h + range(rnd, 0.1, 0.4);
  const dome = clump(capR, 1, rnd, 0.13);
  dome.scale(1, range(rnd, 0.42, 0.58), 1);
  dome.translate(0, capY, 0);
  org.push(leaf(dome, pal, 0.3));

  const gills = new THREE.CylinderGeometry(capR * 0.92, capR * 0.55, 0.18, 14, 1, false);
  gills.translate(0, capY - capR * 0.2, 0);
  org.push(paint(facet(gills), new THREE.Color(pal.down).multiplyScalar(0.75)));

  // A second, smaller cap offset off-axis breaks the mushroom symmetry.
  if (rnd() > 0.4) {
    const cr = capR * range(rnd, 0.42, 0.6);
    const a = range(rnd, 0, Math.PI * 2);
    const d2 = clump(cr, 1, rnd, 0.16);
    d2.scale(1, 0.5, 1);
    d2.translate(Math.cos(a) * capR * 0.55, capY + range(rnd, 0.5, 0.9), Math.sin(a) * capR * 0.55);
    org.push(leaf(d2, pal, 0.3));
  }

  const parts = [...org, ...met];
  normalise(parts);
  return { organic: mergeGeos(org), metal: mergeGeos(met), radius: widestRadius(parts) };
}

/** Twistwood: leaning, gnarled, sparse. Used to break up regular stands. */
function buildTwist(rnd: Rnd, pal: LeafPalette): Built {
  const org: THREE.BufferGeometry[] = [];
  const met: THREE.BufferGeometry[] = [];
  const h = range(rnd, 5.0, 7.0);
  const lean = range(rnd, 1.1, 2.0) * (rnd() > 0.5 ? 1 : -1);

  org.push(bark(limb({
    height: h, radiusBottom: range(rnd, 0.44, 0.6), radiusTop: 0.12,
    bendX: lean, bendZ: range(rnd, -0.6, 0.6), heightSeg: 8, radialSeg: 7, gnarl: 0.3, flare: 2.4, rnd,
  }), 0.92));

  const bandY = h * 0.28;
  met.push(paint(band(bandY, 0.4, 0.22), new THREE.Color('#b07a3a')));

  const tipX = lean;
  const arms = Math.round(range(rnd, 2, 4));
  for (let i = 0; i < arms; i++) {
    const a = range(rnd, 0, Math.PI * 2);
    const bl = range(rnd, 1.2, 2.1);
    const br = limb({ height: bl, radiusBottom: 0.2, radiusTop: 0.05, gnarl: 0.3, flare: 1.2, radialSeg: 6, heightSeg: 4, rnd });
    br.rotateZ(range(rnd, 0.6, 1.2));
    br.rotateY(-a);
    const y0 = h * range(rnd, 0.6, 0.95);
    br.translate(tipX * (y0 / h) * (y0 / h), y0, 0);
    org.push(bark(br, 0.92));

    const cx = tipX * (y0 / h) * (y0 / h) + Math.cos(a) * bl * 0.8;
    const cz = Math.sin(a) * bl * 0.8;
    const cy = y0 + bl * 0.6;
    const n = Math.round(range(rnd, 1, 3));
    for (let j = 0; j < n; j++) {
      const g = clump(range(rnd, 0.8, 1.25), 1, rnd, 0.2);
      g.translate(cx + range(rnd, -0.5, 0.5), cy + range(rnd, -0.3, 0.4), cz + range(rnd, -0.5, 0.5));
      org.push(leaf(g, pal));
    }
  }

  const parts = [...org, ...met];
  normalise(parts);
  return { organic: mergeGeos(org), metal: mergeGeos(met), radius: widestRadius(parts) };
}

/** Sapling: two-clump filler that softens the base of the big stands. */
function buildSapling(rnd: Rnd, pal: LeafPalette): Built {
  const org: THREE.BufferGeometry[] = [];
  const h = range(rnd, 1.6, 2.6);
  org.push(bark(limb({
    height: h, radiusBottom: 0.14, radiusTop: 0.05,
    bendX: range(rnd, -0.35, 0.35), heightSeg: 4, radialSeg: 6, gnarl: 0.2, flare: 1.5, rnd,
  })));
  const n = Math.round(range(rnd, 2, 4));
  for (let i = 0; i < n; i++) {
    const g = clump(range(rnd, 0.5, 0.85), 1, rnd, 0.2);
    g.translate(range(rnd, -0.5, 0.5), h * range(rnd, 0.7, 1.05), range(rnd, -0.5, 0.5));
    org.push(leaf(g, pal));
  }
  const parts = [...org];
  normalise(parts);
  return { organic: mergeGeos(org), metal: mergeGeos([]), radius: widestRadius(parts) };
}

export type SpeciesKind = 'spire' | 'bough' | 'cogcap' | 'twist' | 'sapling';

export function buildSpecies(kind: SpeciesKind, seed: number, pal: LeafPalette): Built {
  const rnd = rand32(seed);
  switch (kind) {
    case 'spire': return buildSpire(rnd, pal);
    case 'bough': return buildBough(rnd, pal);
    case 'cogcap': return buildCogcap(rnd, pal);
    case 'twist': return buildTwist(rnd, pal);
    case 'sapling': return buildSapling(rnd, pal);
  }
}

// ---------------------------------------------------------------------------
// Ground cover
// ---------------------------------------------------------------------------

/** A tuft of grass blades, canonical height 1. */
export function buildTuft(seed: number, pal: LeafPalette, count = 6): THREE.BufferGeometry {
  const rnd = rand32(seed);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const yaw = (i / count) * Math.PI * 2 + range(rnd, -0.5, 0.5);
    const b = blade({
      height: range(rnd, 0.55, 1.0),
      width: range(rnd, 0.055, 0.1),
      bend: range(rnd, 0.25, 0.7),
      yaw,
      rnd,
      segments: 3,
    });
    b.translate(range(rnd, -0.09, 0.09), 0, range(rnd, -0.09, 0.09));
    parts.push(paintShaded(b, new THREE.Color(pal.down), new THREE.Color(pal.up), { yLow: 0, yHigh: 1, occlude: 0.55 }));
  }
  const g = mergeGeos(parts);
  normalise([g]);
  return g;
}

/** A fern: arched fronds radiating from a point. */
export function buildFern(seed: number, pal: LeafPalette): THREE.BufferGeometry {
  const rnd = rand32(seed);
  const parts: THREE.BufferGeometry[] = [];
  const n = Math.round(range(rnd, 5, 8));
  for (let i = 0; i < n; i++) {
    const f = frond({
      length: range(rnd, 0.8, 1.15),
      width: range(rnd, 0.16, 0.26),
      droop: range(rnd, 0.35, 0.6),
      yaw: (i / n) * Math.PI * 2 + range(rnd, -0.3, 0.3),
      lobes: 5,
    });
    parts.push(paintShaded(f, new THREE.Color(pal.down), new THREE.Color(pal.up), { yLow: 0, yHigh: 0.9, occlude: 0.5 }));
  }
  const g = mergeGeos(parts);
  normalise([g]);
  return g;
}

/** A low leafy bush: three overlapping clumps. */
export function buildBush(seed: number, pal: LeafPalette): THREE.BufferGeometry {
  const rnd = rand32(seed);
  const parts: THREE.BufferGeometry[] = [];
  const n = Math.round(range(rnd, 3, 5));
  for (let i = 0; i < n; i++) {
    const c = clump(range(rnd, 0.42, 0.75), 1, rnd, 0.2);
    c.scale(1, range(rnd, 0.7, 0.95), 1);
    c.translate(range(rnd, -0.45, 0.45), range(rnd, 0.25, 0.55), range(rnd, -0.45, 0.45));
    parts.push(paintShaded(facet(c), new THREE.Color(pal.down), new THREE.Color(pal.up), { occlude: 0.45 }));
  }
  const g = mergeGeos(parts);
  normalise([g]);
  return g;
}

/** A boulder: faceted, flattened, moss on the upward faces. */
export function buildRock(seed: number): THREE.BufferGeometry {
  const rnd = rand32(seed);
  const g = new THREE.IcosahedronGeometry(1, 1);
  g.scale(range(rnd, 0.85, 1.3), range(rnd, 0.45, 0.85), range(rnd, 0.85, 1.3));
  g.computeVertexNormals();
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nrm = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const d = 1 + (rand32(Math.round(pos.getX(i) * 97) * 31 + Math.round(pos.getZ(i) * 97) * 7 + Math.round(pos.getY(i) * 97) + seed)() - 0.5) * 0.55;
    pos.setXYZ(i, pos.getX(i) * d, pos.getY(i) * d, pos.getZ(i) * d);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  void nrm;
  const f = facet(g);
  // Stone below, moss above -- the split is what tells the eye it is outdoors.
  paintShaded(f, new THREE.Color('#5d5a56'), new THREE.Color('#7f8d5c'), { occlude: 0.32 });
  f.translate(0, 0.35, 0);
  return f;
}

/** A cracked mossy gear half-buried in the ground: the "gearwood" signature. */
export function buildGearStone(seed: number): { organic: THREE.BufferGeometry; metal: THREE.BufferGeometry } {
  const rnd = rand32(seed);
  const c = cog({ radius: 1, thickness: 0.34, teeth: Math.round(range(rnd, 7, 11)), bore: 0.22 });
  c.rotateX(Math.PI * 0.5 + range(rnd, -0.35, 0.35));
  c.rotateZ(range(rnd, -0.3, 0.3));
  c.translate(0, range(rnd, 0.42, 0.62), 0);
  paint(c, new THREE.Color('#8d6a34'));
  const moss: THREE.BufferGeometry[] = [];
  const n = Math.round(range(rnd, 2, 4));
  for (let i = 0; i < n; i++) {
    const m = clump(range(rnd, 0.28, 0.45), 0, rnd, 0.4);
    m.scale(1, 0.5, 1);
    m.translate(range(rnd, -0.7, 0.7), range(rnd, 0.05, 0.25), range(rnd, -0.5, 0.5));
    moss.push(paintShaded(facet(m), new THREE.Color('#26401e'), new THREE.Color('#6d9c3c'), { occlude: 0.4 }));
  }
  return { organic: mergeGeos(moss), metal: c };
}

/** A fallen log with a mossy top and a couple of broken stubs. */
export function buildLog(seed: number): THREE.BufferGeometry {
  const rnd = rand32(seed);
  const parts: THREE.BufferGeometry[] = [];
  const len = range(rnd, 2.6, 4.4);
  const l = limb({ height: len, radiusBottom: range(rnd, 0.32, 0.46), radiusTop: range(rnd, 0.22, 0.34), flare: 1.15, gnarl: 0.14, radialSeg: 8, heightSeg: 4, bendX: range(rnd, -0.3, 0.3), rnd });
  l.rotateZ(Math.PI * 0.5);
  l.translate(-len * 0.5, range(rnd, 0.26, 0.34), 0);
  parts.push(bark(l));
  for (let i = 0; i < 2; i++) {
    const s = limb({ height: range(rnd, 0.3, 0.6), radiusBottom: 0.12, radiusTop: 0.04, flare: 1.3, radialSeg: 5, heightSeg: 2, rnd });
    s.rotateZ(range(rnd, -1.2, 1.2));
    s.rotateX(range(rnd, -0.8, 0.8));
    s.translate(range(rnd, -len * 0.4, len * 0.4), 0.4, range(rnd, -0.2, 0.2));
    parts.push(bark(s));
  }
  const nm = Math.round(range(rnd, 2, 5));
  for (let i = 0; i < nm; i++) {
    const m = clump(range(rnd, 0.16, 0.3), 0, rnd, 0.4);
    m.scale(1.3, 0.45, 1);
    m.translate(range(rnd, -len * 0.45, len * 0.45), range(rnd, 0.5, 0.62), range(rnd, -0.12, 0.12));
    parts.push(paintShaded(facet(m), new THREE.Color('#2a4a1e'), new THREE.Color('#79ad3f'), { occlude: 0.35 }));
  }
  return mergeGeos(parts);
}

/** Glowing toadstool cluster. Emissive so the bloom pass picks it up. */
export function buildShroom(seed: number): { body: THREE.BufferGeometry; glow: THREE.BufferGeometry } {
  const rnd = rand32(seed);
  const stems: THREE.BufferGeometry[] = [];
  const caps: THREE.BufferGeometry[] = [];
  const n = Math.round(range(rnd, 3, 6));
  for (let i = 0; i < n; i++) {
    const a = range(rnd, 0, Math.PI * 2);
    const d = range(rnd, 0, 0.42);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const hh = range(rnd, 0.18, 0.44);
    const st = limb({ height: hh, radiusBottom: 0.055, radiusTop: 0.04, flare: 1.5, radialSeg: 6, heightSeg: 2, rnd, bendX: range(rnd, -0.06, 0.06) });
    st.translate(x, 0, z);
    stems.push(paintShaded(facet(st), new THREE.Color('#6a6250'), new THREE.Color('#d8d0b4'), { occlude: 0.3 }));
    const cr = range(rnd, 0.11, 0.2);
    const cap = new THREE.SphereGeometry(cr, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.55);
    cap.scale(1, 0.85, 1);
    cap.translate(x, hh, z);
    caps.push(paint(facet(cap), new THREE.Color('#7ff0d8')));
  }
  return { body: mergeGeos(stems), glow: mergeGeos(caps) };
}

/** A track-side lamp: post, arm and a glowing globe. */
export function buildLamp(seed: number): { metal: THREE.BufferGeometry; glow: THREE.BufferGeometry } {
  const rnd = rand32(seed);
  const met: THREE.BufferGeometry[] = [];
  const h = range(rnd, 2.4, 3.1);
  const post = limb({ height: h, radiusBottom: 0.12, radiusTop: 0.07, flare: 2.0, radialSeg: 7, heightSeg: 3, rnd, bendX: range(rnd, -0.08, 0.08) });
  met.push(paint(facet(post), new THREE.Color('#7a6a52')));
  const base = new THREE.CylinderGeometry(0.26, 0.34, 0.16, 8);
  base.translate(0, 0.07, 0);
  met.push(paint(facet(base), new THREE.Color('#8a6f3c')));
  const collar = new THREE.CylinderGeometry(0.13, 0.16, 0.1, 8);
  collar.translate(0, h * 0.62, 0);
  met.push(paint(facet(collar), new THREE.Color('#c39440')));
  const hood = new THREE.ConeGeometry(0.3, 0.28, 8);
  hood.translate(0, h + 0.3, 0);
  met.push(paint(facet(hood), new THREE.Color('#b8863a')));
  const cage = new THREE.CylinderGeometry(0.17, 0.19, 0.05, 8);
  cage.translate(0, h - 0.13, 0);
  met.push(paint(facet(cage), new THREE.Color('#c39440')));

  const globe = new THREE.IcosahedronGeometry(0.19, 1);
  globe.scale(1, 1.2, 1);
  globe.translate(0, h + 0.08, 0);
  const glow = paint(facet(globe), new THREE.Color('#ffd79a'));
  return { metal: mergeGeos(met), glow };
}
