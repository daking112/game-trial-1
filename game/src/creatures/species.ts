/**
 * Species data for the Gearwood Thicket bestiary.
 *
 * Everything a creature is -- its stats, its colour blocking and the numbers
 * that drive its mesh -- lives here as plain data. `CreatureBuilder` reads it
 * and emits geometry; nothing in the builder is species-specific, so a new
 * creature is a new entry in this file rather than a new code path.
 *
 * Design rules the shapes follow, taken from studying premium creature art:
 *   - One dominant primary form. The torso or the head owns the silhouette.
 *   - Two or three colour blocks, no more. Primary / belly / dark accent.
 *   - Read the element from the silhouette, not from the palette alone.
 *   - Faces are large, forward-facing and asymmetric in weight (brow heavier
 *     than jaw) -- that is where all the appeal lives.
 */

export type Element = 'Verdant' | 'Ember' | 'Tide' | 'Storm' | 'Iron';
export type Rarity = 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary';

export interface CreatureStats {
  /** Damage per hit. */
  damage: number;
  /** Attack radius in world units. */
  range: number;
  /** Attacks per second. */
  attackSpeed: number;
  /** Enemies a single shot passes through. */
  pierce: number;
  /** Placement cost in scrap. */
  cost: number;
  projectile: 'seed' | 'ember' | 'jet' | 'bolt' | 'shard';
}

export interface Palette {
  /** Dominant hide colour -- owns most of the silhouette. */
  primary: string;
  /** Secondary mass: haunches, back plates, the darker half of the body. */
  secondary: string;
  /** Belly / muzzle / underside. Always the lightest value. */
  belly: string;
  /** Small saturated pops: markings, fins, crests. */
  accent: string;
  /** Near-black anchoring colour: claws, mask, mouth, joint lines. */
  dark: string;
  /** Brass, copper or steel. Every Gearwood creature carries some. */
  metal: string;
  /** Iris. */
  eye: string;
  /** Emissive element glow. */
  glow: string;
}

export interface SnoutShape {
  length: number;
  radius: number;
  tipRadius: number;
  /** Downward droop of the muzzle tip. */
  drop: number;
  /** 0 = rounded muzzle, 1 = hard beak. */
  keel: number;
}

export interface HeadShape {
  /** Centre height in unit space (creature is 1.0 tall before scaling). */
  y: number;
  z: number;
  radius: number;
  width: number;
  depth: number;
  /** Flattens the crown; high values read reptilian, low values read cute. */
  crownFlat: number;
  /** Brow ridge prominence. The single biggest lever on expression. */
  brow: number;
  /** Cheek mass. */
  cheek: number;
  /** Lower jaw prominence. */
  jaw: number;
  tilt: number;
  snout: SnoutShape | null;
}

export interface EyeShape {
  radius: number;
  /** Half the distance between the eyes. */
  spacing: number;
  y: number;
  z: number;
  /** Outward splay of the eye axis, radians. */
  splay: number;
  /** How far the upper lid comes down, 0..0.9. High = fierce. */
  lid: number;
  /** Roll of the lid line. Positive = angry, negative = friendly. */
  lidTilt: number;
  /** Dark mask patch behind the eye. */
  mask: number;
}

export interface TorsoShape {
  hipY: number;
  radius: number;
  height: number;
  belly: number;
  chest: number;
  depth: number;
  lean: number;
  /** Where the shoulders sit on the torso, -1 (hip) .. 1 (top). */
  shoulderY: number;
  shoulderX: number;
}

export interface LimbShape {
  upperLength: number;
  upperRadius: number;
  lowerLength: number;
  lowerRadius: number;
  footLength: number;
  footRadius: number;
  digits: number;
  clawLength: number;
  /** Lateral offset from centreline. */
  spread: number;
  /** Forward offset. */
  forward: number;
  /** Knee/elbow bend in radians. */
  bend: number;
}

export type TailTip = 'point' | 'ember' | 'paddle' | 'spark' | 'blade' | 'leaf';

export interface TailShape {
  length: number;
  radius: number;
  /** How much the tail rises before it falls. */
  rise: number;
  /** Sideways sweep, gives the silhouette asymmetry. */
  sweep: number;
  segments: number;
  tip: TailTip;
}

export type Feature =
  | { kind: 'leafCrest'; count: number; length: number; width: number; spread: number; pitch: number }
  | { kind: 'antlers'; tines: number; length: number; spread: number }
  | { kind: 'longEars'; length: number; width: number; droop: number; back: number }
  | { kind: 'roundEars'; radius: number; splay: number; height: number }
  | { kind: 'stacks'; count: number; height: number; radius: number; spread: number; lean: number }
  | { kind: 'quills'; rows: number; perRow: number; length: number; spread: number }
  | { kind: 'dorsalSail'; segments: number; height: number; start: number; end: number }
  | { kind: 'wings'; span: number; chord: number; fingers: number; droop: number; plated: boolean }
  | { kind: 'shoulderCogs'; radius: number; teeth: number }
  | { kind: 'chestPlate'; width: number; height: number; grate: boolean }
  | { kind: 'mane'; count: number; length: number; spread: number }
  | { kind: 'backPlates'; count: number; size: number }
  | { kind: 'collar'; radius: number; tube: number }
  | { kind: 'horns'; length: number; radius: number; spread: number; pitch: number; bend: number }
  | { kind: 'cheekVents'; count: number; radius: number }
  | { kind: 'brandMark'; radius: number };

export type HideStyleName = 'fur' | 'scale' | 'bark' | 'plate' | 'smooth';

export interface ShapeParams {
  /** World height in metres, feet to crown. */
  height: number;
  hide: HideStyleName;
  torso: TorsoShape;
  head: HeadShape;
  eye: EyeShape;
  arms: LimbShape | null;
  legs: LimbShape;
  tail: TailShape | null;
  features: Feature[];
  /** Teeth showing at the mouth line. */
  fangs: number;
  /** Overall pose attitude: 0 = upright biped, 1 = low quadrupedal crouch. */
  crouch: number;
  seed: number;
}

export interface Species {
  id: string;
  name: string;
  element: Element;
  rarity: Rarity;
  /** One line of flavour, shown on the collection card. */
  tagline: string;
  stage: 1 | 2;
  evolvesTo?: string;
  evolvesFrom?: string;
  stats: CreatureStats;
  palette: Palette;
  shape: ShapeParams;
}

/* ------------------------------------------------------------------ */

export const SPECIES: Record<string, Species> = {
  /* ---------------------------------------------------------------- *
   * FERNLET -- the starter. Round, top-heavy, unmistakably friendly.
   * Silhouette test: a circle on two stubs with three leaf points.
   * ---------------------------------------------------------------- */
  fernlet: {
    id: 'fernlet',
    name: 'Fernlet',
    element: 'Verdant',
    rarity: 'Common',
    stage: 1,
    evolvesTo: 'thornwarden',
    tagline: 'Sprouts in the shade of fallen boilers. Hums when it is happy.',
    stats: { damage: 4, range: 11, attackSpeed: 1.15, pierce: 1, cost: 120, projectile: 'seed' },
    palette: {
      primary: '#63c552',
      secondary: '#2f7f3d',
      belly: '#f6efc9',
      accent: '#ffb62e',
      dark: '#1d3f26',
      metal: '#c99a4c',
      eye: '#ffc93b',
      glow: '#b6ff6a',
    },
    shape: {
      height: 1.55,
      hide: 'fur',
      crouch: 0.15,
      fangs: 0,
      seed: 101,
      torso: {
        hipY: 0.20, radius: 0.235, height: 0.20, belly: 0.30, chest: 0.06,
        depth: 0.94, lean: 0.05, shoulderY: 0.45, shoulderX: 0.86,
      },
      head: {
        y: 0.735, z: 0.015, radius: 0.255, width: 1.03, depth: 0.98,
        crownFlat: 0.06, brow: 0.30, cheek: 0.30, jaw: 0.22, tilt: -0.04,
        snout: { length: 0.11, radius: 0.115, tipRadius: 0.072, drop: 0.030, keel: 0.10 },
      },
      eye: {
        radius: 0.084, spacing: 0.116, y: 0.755, z: 0.205,
        splay: 0.30, lid: 0.20, lidTilt: -0.10, mask: 0.0,
      },
      arms: {
        upperLength: 0.115, upperRadius: 0.049, lowerLength: 0.105, lowerRadius: 0.041,
        footLength: 0.065, footRadius: 0.048, digits: 3, clawLength: 0.030,
        spread: 0.215, forward: 0.02, bend: 0.62,
      },
      legs: {
        upperLength: 0.105, upperRadius: 0.070, lowerLength: 0.085, lowerRadius: 0.056,
        footLength: 0.115, footRadius: 0.062, digits: 3, clawLength: 0.030,
        spread: 0.115, forward: 0.015, bend: 0.44,
      },
      tail: { length: 0.30, radius: 0.052, rise: 0.16, sweep: -0.06, segments: 5, tip: 'leaf' },
      features: [
        { kind: 'leafCrest', count: 3, length: 0.36, width: 0.155, spread: 0.62, pitch: -0.30 },
        { kind: 'longEars', length: 0.20, width: 0.105, droop: 0.85, back: 0.35 },
        { kind: 'collar', radius: 0.125, tube: 0.026 },
        { kind: 'chestPlate', width: 0.19, height: 0.22, grate: false },
      ],
    },
  },

  /* ---------------------------------------------------------------- *
   * THORNWARDEN -- Fernlet grown into the wood. Wide shoulders, antlers,
   * heavy arms. The silhouette should read as a doorway with a head on it.
   * ---------------------------------------------------------------- */
  thornwarden: {
    id: 'thornwarden',
    name: 'Thornwarden',
    element: 'Verdant',
    rarity: 'Rare',
    stage: 2,
    evolvesFrom: 'fernlet',
    tagline: 'Its bark closed over an old brass axle. It has not let go since.',
    stats: { damage: 17, range: 15, attackSpeed: 0.62, pierce: 3, cost: 640, projectile: 'seed' },
    palette: {
      primary: '#43964d',
      secondary: '#6b4526',
      belly: '#dcc989',
      accent: '#ffab2b',
      dark: '#1b3220',
      metal: '#b98a3e',
      eye: '#ffd45e',
      glow: '#9dff7a',
    },
    shape: {
      height: 2.45,
      hide: 'bark',
      crouch: 0.28,
      fangs: 4,
      seed: 202,
      torso: {
        hipY: 0.38, radius: 0.245, height: 0.235, belly: 0.10, chest: 0.42,
        depth: 0.88, lean: 0.16, shoulderY: 0.62, shoulderX: 1.20,
      },
      head: {
        y: 0.845, z: 0.075, radius: 0.185, width: 1.02, depth: 1.18,
        crownFlat: 0.26, brow: 0.62, cheek: 0.38, jaw: 0.44, tilt: 0.10,
        snout: { length: 0.20, radius: 0.108, tipRadius: 0.062, drop: 0.045, keel: 0.34 },
      },
      eye: {
        radius: 0.056, spacing: 0.096, y: 0.868, z: 0.155,
        splay: 0.34, lid: 0.44, lidTilt: 0.26, mask: 0.9,
      },
      arms: {
        upperLength: 0.205, upperRadius: 0.075, lowerLength: 0.190, lowerRadius: 0.062,
        footLength: 0.105, footRadius: 0.072, digits: 3, clawLength: 0.085,
        spread: 0.275, forward: 0.03, bend: 0.72,
      },
      legs: {
        upperLength: 0.185, upperRadius: 0.095, lowerLength: 0.150, lowerRadius: 0.072,
        footLength: 0.165, footRadius: 0.078, digits: 3, clawLength: 0.052,
        spread: 0.145, forward: 0.01, bend: 0.58,
      },
      tail: { length: 0.42, radius: 0.068, rise: 0.10, sweep: 0.14, segments: 6, tip: 'leaf' },
      features: [
        { kind: 'antlers', tines: 3, length: 0.40, spread: 0.42 },
        { kind: 'mane', count: 11, length: 0.20, spread: 1.0 },
        { kind: 'backPlates', count: 5, size: 0.11 },
        { kind: 'shoulderCogs', radius: 0.105, teeth: 9 },
        { kind: 'chestPlate', width: 0.20, height: 0.26, grate: false },
      ],
    },
  },

  /* ---------------------------------------------------------------- *
   * EMBERBELLOW -- a walking furnace. Low, wide, heavy in the chest with
   * two brass stacks breaking the silhouette upward.
   * ---------------------------------------------------------------- */
  emberbellow: {
    id: 'emberbellow',
    name: 'Emberbellow',
    element: 'Ember',
    rarity: 'Uncommon',
    stage: 1,
    tagline: 'Eats charcoal, exhales sparks, sleeps on anything still warm.',
    stats: { damage: 9, range: 9, attackSpeed: 1.5, pierce: 2, cost: 340, projectile: 'ember' },
    palette: {
      primary: '#ea6a2c',
      secondary: '#a8341c',
      belly: '#ffdca4',
      accent: '#ffc12e',
      dark: '#3f150f',
      metal: '#d09a45',
      eye: '#fff0a8',
      glow: '#ff7a18',
    },
    shape: {
      height: 1.75,
      hide: 'fur',
      crouch: 0.55,
      fangs: 4,
      seed: 303,
      torso: {
        hipY: 0.30, radius: 0.275, height: 0.215, belly: 0.24, chest: 0.36,
        depth: 1.02, lean: 0.30, shoulderY: 0.50, shoulderX: 1.06,
      },
      head: {
        y: 0.735, z: 0.145, radius: 0.215, width: 1.10, depth: 1.02,
        crownFlat: 0.20, brow: 0.55, cheek: 0.52, jaw: 0.48, tilt: 0.16,
        snout: { length: 0.155, radius: 0.128, tipRadius: 0.085, drop: 0.030, keel: 0.18 },
      },
      eye: {
        radius: 0.066, spacing: 0.112, y: 0.775, z: 0.175,
        splay: 0.36, lid: 0.38, lidTilt: 0.30, mask: 0.75,
      },
      arms: {
        upperLength: 0.135, upperRadius: 0.078, lowerLength: 0.120, lowerRadius: 0.066,
        footLength: 0.090, footRadius: 0.070, digits: 3, clawLength: 0.070,
        spread: 0.255, forward: 0.05, bend: 0.85,
      },
      legs: {
        upperLength: 0.120, upperRadius: 0.090, lowerLength: 0.095, lowerRadius: 0.070,
        footLength: 0.140, footRadius: 0.075, digits: 3, clawLength: 0.045,
        spread: 0.155, forward: 0.02, bend: 0.62,
      },
      tail: { length: 0.44, radius: 0.082, rise: 0.20, sweep: -0.12, segments: 6, tip: 'ember' },
      features: [
        { kind: 'stacks', count: 2, height: 0.30, radius: 0.058, spread: 0.135, lean: 0.20 },
        { kind: 'roundEars', radius: 0.070, splay: 0.62, height: 0.86 },
        { kind: 'chestPlate', width: 0.22, height: 0.25, grate: true },
        { kind: 'cheekVents', count: 3, radius: 0.026 },
        { kind: 'mane', count: 9, length: 0.13, spread: 0.9 },
      ],
    },
  },

  /* ---------------------------------------------------------------- *
   * RILLSPOUT -- amphibian pressure-vessel. Wide flat head, tall dorsal
   * sail, broad paddle tail. Reads as a teardrop lying on its side.
   * ---------------------------------------------------------------- */
  rillspout: {
    id: 'rillspout',
    name: 'Rillspout',
    element: 'Tide',
    rarity: 'Uncommon',
    stage: 1,
    tagline: 'Pressurises millpond water and lets it go all at once.',
    stats: { damage: 7, range: 13, attackSpeed: 1.05, pierce: 4, cost: 300, projectile: 'jet' },
    palette: {
      primary: '#2fa9cb',
      secondary: '#125f7c',
      belly: '#ddf4ef',
      accent: '#ffd45e',
      dark: '#08303f',
      metal: '#c99a4c',
      eye: '#ffd45e',
      glow: '#7ff0ff',
    },
    shape: {
      height: 1.60,
      hide: 'scale',
      crouch: 0.45,
      fangs: 0,
      seed: 404,
      torso: {
        hipY: 0.26, radius: 0.255, height: 0.20, belly: 0.28, chest: 0.14,
        depth: 1.10, lean: 0.22, shoulderY: 0.46, shoulderX: 0.98,
      },
      head: {
        y: 0.685, z: 0.135, radius: 0.215, width: 1.22, depth: 1.12,
        crownFlat: 0.34, brow: 0.24, cheek: 0.40, jaw: 0.40, tilt: 0.06,
        snout: { length: 0.165, radius: 0.140, tipRadius: 0.098, drop: 0.010, keel: 0.06 },
      },
      eye: {
        radius: 0.082, spacing: 0.128, y: 0.795, z: 0.075,
        splay: 0.52, lid: 0.14, lidTilt: -0.06, mask: 0.0,
      },
      arms: {
        upperLength: 0.120, upperRadius: 0.058, lowerLength: 0.110, lowerRadius: 0.048,
        footLength: 0.085, footRadius: 0.058, digits: 4, clawLength: 0.020,
        spread: 0.230, forward: 0.04, bend: 0.72,
      },
      legs: {
        upperLength: 0.110, upperRadius: 0.080, lowerLength: 0.090, lowerRadius: 0.062,
        footLength: 0.150, footRadius: 0.070, digits: 4, clawLength: 0.020,
        spread: 0.145, forward: 0.02, bend: 0.58,
      },
      tail: { length: 0.50, radius: 0.075, rise: 0.06, sweep: 0.10, segments: 6, tip: 'paddle' },
      features: [
        { kind: 'dorsalSail', segments: 5, height: 0.20, start: -0.10, end: 0.34 },
        { kind: 'chestPlate', width: 0.17, height: 0.19, grate: false },
        { kind: 'collar', radius: 0.115, tube: 0.024 },
        { kind: 'cheekVents', count: 3, radius: 0.024 },
      ],
    },
  },

  /* ---------------------------------------------------------------- *
   * VOLTQUILL -- low, wide, and bristling. The quill fan is the whole
   * silhouette; the body underneath is deliberately simple.
   * ---------------------------------------------------------------- */
  voltquill: {
    id: 'voltquill',
    name: 'Voltquill',
    element: 'Storm',
    rarity: 'Rare',
    stage: 1,
    evolvesTo: 'gearhawk',
    tagline: 'Grounds itself through copper roots, then lets the sky have it.',
    stats: { damage: 12, range: 14, attackSpeed: 1.35, pierce: 2, cost: 520, projectile: 'bolt' },
    palette: {
      primary: '#3d3f96',
      secondary: '#1c1c52',
      belly: '#ffd93d',
      accent: '#ffe98a',
      dark: '#101132',
      metal: '#cf7f36',
      eye: '#8ef4ff',
      glow: '#b7e6ff',
    },
    shape: {
      height: 1.50,
      hide: 'fur',
      crouch: 0.62,
      fangs: 2,
      seed: 505,
      torso: {
        hipY: 0.26, radius: 0.270, height: 0.185, belly: 0.20, chest: 0.24,
        depth: 1.16, lean: 0.34, shoulderY: 0.46, shoulderX: 1.00,
      },
      head: {
        y: 0.660, z: 0.185, radius: 0.200, width: 1.06, depth: 1.10,
        crownFlat: 0.16, brow: 0.50, cheek: 0.42, jaw: 0.38, tilt: 0.14,
        snout: { length: 0.175, radius: 0.108, tipRadius: 0.060, drop: 0.035, keel: 0.22 },
      },
      eye: {
        radius: 0.068, spacing: 0.104, y: 0.705, z: 0.165,
        splay: 0.34, lid: 0.36, lidTilt: 0.28, mask: 1.0,
      },
      arms: {
        upperLength: 0.115, upperRadius: 0.060, lowerLength: 0.105, lowerRadius: 0.050,
        footLength: 0.080, footRadius: 0.056, digits: 3, clawLength: 0.055,
        spread: 0.230, forward: 0.06, bend: 0.90,
      },
      legs: {
        upperLength: 0.105, upperRadius: 0.082, lowerLength: 0.085, lowerRadius: 0.062,
        footLength: 0.125, footRadius: 0.066, digits: 3, clawLength: 0.045,
        spread: 0.150, forward: 0.02, bend: 0.64,
      },
      tail: { length: 0.34, radius: 0.060, rise: 0.26, sweep: -0.10, segments: 5, tip: 'spark' },
      features: [
        { kind: 'quills', rows: 4, perRow: 5, length: 0.40, spread: 0.90 },
        { kind: 'roundEars', radius: 0.062, splay: 0.70, height: 0.84 },
        { kind: 'mane', count: 9, length: 0.14, spread: 0.95 },
        { kind: 'collar', radius: 0.120, tube: 0.024 },
      ],
    },
  },

  /* ---------------------------------------------------------------- *
   * GEARHAWK -- Voltquill armoured by the Thicket. Tall, narrow-waisted,
   * plated wings held high so the silhouette is a wide V over a spike.
   * ---------------------------------------------------------------- */
  gearhawk: {
    id: 'gearhawk',
    name: 'Gearhawk',
    element: 'Iron',
    rarity: 'Epic',
    stage: 2,
    evolvesFrom: 'voltquill',
    tagline: 'The Thicket built it a second skeleton. It prefers the new one.',
    stats: { damage: 22, range: 19, attackSpeed: 0.95, pierce: 3, cost: 980, projectile: 'shard' },
    palette: {
      primary: '#8f9aab',
      secondary: '#4a5361',
      belly: '#e6ebf2',
      accent: '#c8392c',
      dark: '#20242b',
      metal: '#d6a44b',
      eye: '#ffcf3a',
      glow: '#ffd36e',
    },
    shape: {
      height: 2.30,
      hide: 'plate',
      crouch: 0.22,
      fangs: 0,
      seed: 606,
      torso: {
        hipY: 0.36, radius: 0.215, height: 0.235, belly: 0.06, chest: 0.44,
        depth: 0.92, lean: 0.18, shoulderY: 0.66, shoulderX: 1.14,
      },
      head: {
        y: 0.860, z: 0.055, radius: 0.160, width: 0.94, depth: 1.16,
        crownFlat: 0.30, brow: 0.72, cheek: 0.26, jaw: 0.30, tilt: 0.06,
        snout: { length: 0.235, radius: 0.086, tipRadius: 0.030, drop: 0.070, keel: 0.85 },
      },
      eye: {
        radius: 0.054, spacing: 0.082, y: 0.888, z: 0.115,
        splay: 0.44, lid: 0.42, lidTilt: 0.34, mask: 1.0,
      },
      arms: null,
      legs: {
        upperLength: 0.180, upperRadius: 0.090, lowerLength: 0.170, lowerRadius: 0.060,
        footLength: 0.165, footRadius: 0.060, digits: 3, clawLength: 0.070,
        spread: 0.135, forward: 0.0, bend: 0.70,
      },
      tail: { length: 0.40, radius: 0.062, rise: 0.04, sweep: 0.0, segments: 5, tip: 'blade' },
      features: [
        { kind: 'wings', span: 0.98, chord: 0.52, fingers: 4, droop: 0.20, plated: true },
        { kind: 'shoulderCogs', radius: 0.115, teeth: 11 },
        { kind: 'horns', length: 0.26, radius: 0.036, spread: 0.075, pitch: -0.55, bend: 0.35 },
        { kind: 'backPlates', count: 5, size: 0.085 },
        { kind: 'chestPlate', width: 0.185, height: 0.27, grate: false },
        { kind: 'brandMark', radius: 0.055 },
      ],
    },
  },
};

export const SPECIES_ORDER: string[] = [
  'fernlet',
  'thornwarden',
  'emberbellow',
  'rillspout',
  'voltquill',
  'gearhawk',
];

export function getSpecies(id: string): Species {
  const s = SPECIES[id];
  if (!s) throw new Error(`unknown species: ${id}`);
  return s;
}

/** Walk an evolution line from its first stage. */
export function evolutionLine(id: string): Species[] {
  let head = getSpecies(id);
  while (head.evolvesFrom) head = getSpecies(head.evolvesFrom);
  const out = [head];
  while (out[out.length - 1].evolvesTo) out.push(getSpecies(out[out.length - 1].evolvesTo!));
  return out;
}
