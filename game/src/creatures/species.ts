/**
 * Species data for the Gearwood Thicket bestiary.
 *
 * Everything a creature is -- its stats, its colour blocking and the numbers
 * that drive its mesh -- lives here as plain data. `CreatureBuilder` reads it
 * and emits geometry; nothing in the builder is species-specific, so a new
 * creature is a new entry in this file rather than a new code path.
 *
 * Design rules the shapes follow, taken from studying premium creature art:
 *   - **Skeleton first.** Six species means six *body plans*, not one body
 *     with six paint jobs. A serpent, a stag, a brawler, a raptor, a drifter
 *     and a sprout share almost no joints between them.
 *   - Silhouette is owned by proportion, not by accessories: neck length,
 *     limb length and where the mass sits.
 *   - Two or three colour blocks, no more. Primary / belly / dark accent.
 *   - Scale is a design tool. The roster runs 0.95m to 3.4m and the steps
 *     between neighbours are deliberate, not arbitrary.
 */

export type Element = 'Verdant' | 'Ember' | 'Tide' | 'Storm' | 'Iron';
export type Rarity = 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary';

/**
 * The skeleton. This is the single most important field in the file -- it
 * decides which joints exist at all, not merely how long they are.
 *
 *  - `sproutling` upright, top-heavy, stub limbs. The small round one.
 *  - `brawler`    upright humanoid: narrow waist, wide chest, long arms,
 *                 digitigrade legs.
 *  - `quadruped`  horizontal barrel on four pillars, long neck out front.
 *  - `raptor`     bird: two long digitigrade legs, pitched body, wings.
 *  - `serpent`    no legs at all; the body *is* a chain along a curve.
 *  - `drifter`    no legs, no ground contact; a hovering core and streamers.
 */
export type BodyPlan = 'sproutling' | 'brawler' | 'quadruped' | 'raptor' | 'serpent' | 'drifter';

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
  /** Lateral flattening of the muzzle. >1 = broad and froggy, <1 = narrow. */
  spread?: number;
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
  /** Hip joint: the *rear* end of the body axis. */
  hipY: number;
  hipZ: number;
  /**
   * Pitch of the body axis, radians. 0 = a vertical column (upright plans),
   * ~1.35 = a horizontal barrel (quadruped). This one number is what turns a
   * standing biped into a walking animal.
   */
  pitch: number;
  radius: number;
  /** Half-length along the body axis. */
  height: number;
  belly: number;
  chest: number;
  depth: number;
  lean: number;
  /** Where the shoulders sit on the body axis, -1 (hip) .. 1 (top). */
  shoulderY: number;
  shoulderX: number;
  /** Waist pinch, 0..1. High values give a brawler its hourglass read. */
  waist?: number;
}

export interface LimbShape {
  upperLength: number;
  upperRadius: number;
  lowerLength: number;
  lowerRadius: number;
  /**
   * Third segment. >0 makes the leg digitigrade -- thigh forward, shank
   * back, metatarsus forward again -- which is what separates a bird or a
   * brawler's leg from a stumpy plantigrade peg.
   */
  pastern?: number;
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
  /** Extra outward splay of the whole limb, radians. */
  splay?: number;
  /**
   * Foot topology. Not decoration -- a hoof, a talon and a paw are different
   * skeletons, and identical feet across a roster is the single clearest tell
   * that six species came off one base mesh.
   */
  foot?: 'paw' | 'hoof' | 'talon' | 'stub';
}

/**
 * The rest pose.
 *
 * An A-pose lineup reads as a blockout no matter how varied the skeletons
 * are: same ground contact, same negative space, no line of action. Every
 * value here is a baked offset the idle animation adds to, so each species
 * stands like itself.
 */
export interface PoseShape {
  /** Yaw/lean/roll of the whole body. */
  bodyYaw?: number;
  bodyLean?: number;
  bodyRoll?: number;
  chestTwist?: number;
  neckPitch?: number;
  headYaw?: number;
  headPitch?: number;
  headRoll?: number;
  /** Stagger: the left leg moves forward by this, the right one back. */
  legLead?: number;
  /** Extra stance width beyond `legs.spread`. */
  stance?: number;
  /** Left/right arm rest rotation, XYZ radians. */
  armL?: [number, number, number];
  armR?: [number, number, number];
  wingL?: [number, number, number];
  wingR?: [number, number, number];
}

export type TailTip = 'point' | 'ember' | 'paddle' | 'spark' | 'blade' | 'leaf' | 'fin';

export interface TailShape {
  length: number;
  radius: number;
  /** How much the tail rises before it falls. */
  rise: number;
  /** Sideways sweep, gives the silhouette asymmetry. */
  sweep: number;
  segments: number;
  tip: TailTip;
  /** Multiplier on the idle travelling wave. Long tails need less. */
  wave?: number;
}

/** The spine of a legless creature: the body follows this, head at u=0. */
export interface SerpentShape {
  /** Control points in unit space, neck-base first, tail-tip last. */
  path: Array<[number, number, number]>;
  /** Body radius at the thickest point. */
  radius: number;
  /** Where the body is thickest, 0..1. */
  swell: number;
  segments: number;
  /** Dorsal fin plates riding the top of the chain, over u in [0, finEnd]. */
  fins: number;
  finHeight: number;
  finEnd: number;
  /** Belly scute plates under the chain. */
  scutes: number;
}

/** A hovering creature: a core, orbiting rings and trailing streamers. */
export interface DrifterShape {
  coreY: number;
  coreRadius: number;
  /** Vertical squash of the core. */
  coreFlat: number;
  rings: number;
  ringRadius: number;
  /** Radiating quills around the core. */
  halo: number;
  haloLength: number;
  /** Trailing streamers -- these use the tail rig, so they drift. */
  streamers: number;
  streamerLength: number;
  streamerSpread: number;
  /** Ground clearance as a fraction of world height. */
  hover: number;
}

export interface NeckShape {
  /** Rig segments. More = a neck that can arc and follow through. */
  segments: number;
  radiusBase: number;
  radiusTop: number;
  /**
   * Arc of the neck curve. Positive bows it forward (a stag reaching),
   * negative pulls it into an S (a heron, a raptor at rest).
   */
  arch: number;
  /** Ruff of plates or fur where the neck meets the shoulders. */
  ruff?: number;
}

export type Feature =
  | { kind: 'leafCrest'; count: number; length: number; width: number; spread: number; pitch: number }
  | { kind: 'antlers'; tines: number; length: number; spread: number }
  | { kind: 'longEars'; length: number; width: number; droop: number; back: number }
  | { kind: 'roundEars'; radius: number; splay: number; height: number }
  | { kind: 'finEars'; length: number; width: number; splay: number }
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
  | { kind: 'brandMark'; radius: number }
  | { kind: 'bracers'; radius: number; width: number }
  | { kind: 'pectoralFins'; length: number; width: number; at: number };

export type HideStyleName = 'fur' | 'scale' | 'bark' | 'plate' | 'smooth';

export interface ShapeParams {
  /** World height in metres, feet (or lowest point) to crown. */
  height: number;
  /** The skeleton. */
  plan: BodyPlan;
  hide: HideStyleName;
  torso: TorsoShape;
  neck: NeckShape;
  head: HeadShape;
  eye: EyeShape;
  arms: LimbShape | null;
  legs: LimbShape | null;
  /** Forelegs, quadrupeds only. */
  forelegs?: LimbShape | null;
  tail: TailShape | null;
  serpent?: SerpentShape;
  drifter?: DrifterShape;
  features: Feature[];
  /** Teeth showing at the mouth line. */
  fangs: number;
  /** Overall pose attitude: 0 = upright biped, 1 = low quadrupedal crouch. */
  crouch: number;
  pose?: PoseShape;
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
   * FERNLET -- the starter, and the smallest thing on the roster at
   * under a metre. Plan: sproutling. The head is nearly half the
   * creature and the limbs are deliberately vestigial, so it reads as a
   * seedling that has only just decided to walk.
   * Silhouette test: a fat teardrop under a three-point crest.
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
      primary: '#74bf4e',
      secondary: '#2d5f33',
      belly: '#f2e6b4',
      accent: '#f0a52b',
      dark: '#14261a',
      metal: '#c79a4e',
      eye: '#ffc93b',
      glow: '#c4ff74',
    },
    shape: {
      height: 0.95,
      plan: 'sproutling',
      hide: 'fur',
      crouch: 0.15,
      pose: {
        bodyYaw: 0.16, bodyLean: -0.05, bodyRoll: 0.04,
        headYaw: -0.24, headPitch: -0.10, headRoll: 0.09,
        legLead: 0.030, stance: 0.010,
        armL: [-0.55, 0.20, 0.32], armR: [0.28, -0.14, -0.16],
      },
      fangs: 0,
      seed: 101,
      torso: {
        hipY: 0.175, hipZ: 0, pitch: 0.0,
        radius: 0.245, height: 0.185, belly: 0.38, chest: 0.02,
        depth: 0.96, lean: 0.04, shoulderY: 0.36, shoulderX: 0.82,
      },
      neck: { segments: 1, radiusBase: 0.12, radiusTop: 0.11, arch: 0.0 },
      head: {
        y: 0.700, z: 0.020, radius: 0.285, width: 1.02, depth: 0.98,
        crownFlat: 0.04, brow: 0.26, cheek: 0.34, jaw: 0.20, tilt: -0.05,
        snout: { length: 0.085, radius: 0.115, tipRadius: 0.078, drop: 0.026, keel: 0.06 },
      },
      eye: {
        radius: 0.098, spacing: 0.126, y: 0.720, z: 0.225,
        splay: 0.30, lid: 0.14, lidTilt: -0.14, mask: 0.0,
      },
      arms: {
        upperLength: 0.085, upperRadius: 0.044, lowerLength: 0.075, lowerRadius: 0.037,
        footLength: 0.058, footRadius: 0.044, digits: 3, clawLength: 0.022,
        spread: 0.225, forward: 0.02, bend: 0.70,
      },
      legs: {
        upperLength: 0.085, upperRadius: 0.068, lowerLength: 0.065, lowerRadius: 0.055,
        footLength: 0.115, footRadius: 0.060, digits: 3, clawLength: 0.024,
        spread: 0.112, forward: 0.015, bend: 0.40, foot: 'stub',
      },
      tail: { length: 0.24, radius: 0.048, rise: 0.20, sweep: -0.06, segments: 4, tip: 'leaf' },
      features: [
        { kind: 'leafCrest', count: 3, length: 0.40, width: 0.175, spread: 0.66, pitch: -0.30 },
        { kind: 'longEars', length: 0.22, width: 0.115, droop: 0.88, back: 0.35 },
        { kind: 'collar', radius: 0.125, tube: 0.026 },
      ],
    },
  },

  /* ---------------------------------------------------------------- *
   * THORNWARDEN -- Fernlet grown into the wood. Plan: quadruped, and the
   * largest creature on the roster at 3.4m. A horizontal barrel on four
   * pillars, with a long neck reaching out front and an antler rack that
   * doubles the width of the silhouette.
   * Silhouette test: a bridge. Long, high, daylight underneath it.
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
      primary: '#5b8f4a',
      secondary: '#5c3d24',
      belly: '#cbb884',
      accent: '#e08b28',
      dark: '#12201a',
      metal: '#b8863c',
      eye: '#ffd45e',
      glow: '#9dff7a',
    },
    shape: {
      height: 3.40,
      plan: 'quadruped',
      hide: 'bark',
      crouch: 0.70,
      pose: {
        bodyYaw: -0.10, bodyRoll: 0.02,
        chestTwist: 0.10, neckPitch: -0.14,
        headYaw: 0.46, headPitch: 0.12, headRoll: -0.10,
        legLead: 0.085, stance: 0.018,
      },
      fangs: 2,
      seed: 202,
      torso: {
        hipY: 0.520, hipZ: -0.300, pitch: 1.30,
        radius: 0.190, height: 0.300, belly: 0.20, chest: 0.30,
        depth: 1.06, lean: 0.0, shoulderY: 0.62, shoulderX: 1.02,
      },
      neck: { segments: 3, radiusBase: 0.130, radiusTop: 0.082, arch: -0.16, ruff: 0.7 },
      head: {
        y: 0.905, z: 0.545, radius: 0.150, width: 0.92, depth: 1.30,
        crownFlat: 0.30, brow: 0.60, cheek: 0.30, jaw: 0.40, tilt: 0.22,
        snout: { length: 0.230, radius: 0.088, tipRadius: 0.056, drop: 0.055, keel: 0.30 },
      },
      eye: {
        radius: 0.050, spacing: 0.082, y: 0.930, z: 0.660,
        splay: 0.62, lid: 0.40, lidTilt: 0.22, mask: 0.85,
      },
      arms: null,
      legs: {
        upperLength: 0.270, upperRadius: 0.078, lowerLength: 0.240, lowerRadius: 0.055,
        pastern: 0.075,
        footLength: 0.150, footRadius: 0.070, digits: 2, clawLength: 0.050,
        spread: 0.150, forward: 0.02, bend: 0.86, foot: 'hoof',
      },
      forelegs: {
        upperLength: 0.280, upperRadius: 0.070, lowerLength: 0.250, lowerRadius: 0.052,
        pastern: 0.060,
        footLength: 0.145, footRadius: 0.068, digits: 2, clawLength: 0.048,
        spread: 0.145, forward: 0.02, bend: 0.34, foot: 'hoof',
      },
      tail: { length: 0.52, radius: 0.058, rise: 0.10, sweep: 0.18, segments: 6, tip: 'leaf', wave: 0.7 },
      features: [
        { kind: 'antlers', tines: 3, length: 0.46, spread: 0.60 },
        { kind: 'mane', count: 11, length: 0.20, spread: 1.0 },
        { kind: 'backPlates', count: 6, size: 0.10 },
        { kind: 'shoulderCogs', radius: 0.095, teeth: 9 },
      ],
    },
  },

  /* ---------------------------------------------------------------- *
   * EMBERBELLOW -- a walking furnace. Plan: brawler. Narrow waist, huge
   * chest, arms that hang past the knee, digitigrade legs. Every mass is
   * pushed up and forward so it reads as a fighter leaning into a punch.
   * Silhouette test: a wedge, widest at the shoulders, on a pinched waist.
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
      primary: '#e2662a',
      secondary: '#7e2418',
      belly: '#f6d29a',
      accent: '#f7b32b',
      dark: '#24100c',
      metal: '#cf9a45',
      eye: '#fff0a8',
      glow: '#ff7a18',
    },
    shape: {
      height: 2.15,
      plan: 'brawler',
      hide: 'fur',
      crouch: 0.10,
      pose: {
        bodyYaw: -0.30, bodyLean: 0.10, bodyRoll: -0.05,
        chestTwist: 0.24, headYaw: 0.34, headPitch: 0.10, headRoll: 0.06,
        legLead: 0.075, stance: 0.048,
        armL: [-0.95, 0.30, 0.42], armR: [0.62, -0.36, -0.30],
      },
      fangs: 4,
      seed: 303,
      torso: {
        hipY: 0.400, hipZ: 0, pitch: 0.10,
        radius: 0.195, height: 0.215, belly: -0.06, chest: 0.62,
        depth: 0.90, lean: 0.06, shoulderY: 0.74, shoulderX: 1.28, waist: 0.34,
      },
      neck: { segments: 1, radiusBase: 0.125, radiusTop: 0.095, arch: 0.05, ruff: 0.5 },
      head: {
        y: 0.900, z: 0.055, radius: 0.150, width: 1.06, depth: 1.06,
        crownFlat: 0.18, brow: 0.66, cheek: 0.50, jaw: 0.52, tilt: 0.10,
        snout: { length: 0.130, radius: 0.098, tipRadius: 0.070, drop: 0.026, keel: 0.16 },
      },
      eye: {
        radius: 0.052, spacing: 0.086, y: 0.928, z: 0.145,
        splay: 0.36, lid: 0.42, lidTilt: 0.32, mask: 0.75,
      },
      arms: {
        upperLength: 0.235, upperRadius: 0.070, lowerLength: 0.215, lowerRadius: 0.058,
        footLength: 0.120, footRadius: 0.082, digits: 3, clawLength: 0.055,
        spread: 0.265, forward: 0.02, bend: 0.52, splay: 0.16,
      },
      legs: {
        upperLength: 0.215, upperRadius: 0.085, lowerLength: 0.195, lowerRadius: 0.062,
        pastern: 0.110,
        footLength: 0.155, footRadius: 0.072, digits: 3, clawLength: 0.042,
        spread: 0.130, forward: 0.0, bend: 0.92, foot: 'paw',
      },
      tail: { length: 0.36, radius: 0.070, rise: 0.24, sweep: -0.14, segments: 5, tip: 'ember' },
      features: [
        { kind: 'stacks', count: 2, height: 0.30, radius: 0.052, spread: 0.150, lean: 0.22 },
        { kind: 'roundEars', radius: 0.058, splay: 0.66, height: 0.82 },
        { kind: 'chestPlate', width: 0.19, height: 0.24, grate: true },
        { kind: 'cheekVents', count: 3, radius: 0.022 },
        { kind: 'mane', count: 9, length: 0.15, spread: 0.9 },
        { kind: 'bracers', radius: 0.078, width: 0.070 },
      ],
    },
  },

  /* ---------------------------------------------------------------- *
   * RILLSPOUT -- Plan: serpent. No legs at all. A rearing S out of a
   * coiled tail, three times as long as it is tall, with a dorsal fin
   * running the length of the spine and a broad flat head at the top.
   * Silhouette test: a question mark.
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
      primary: '#2c9ab5',
      secondary: '#124a63',
      belly: '#dceee9',
      accent: '#edb944',
      dark: '#061d27',
      metal: '#c2933f',
      eye: '#ffd45e',
      glow: '#7ff0ff',
    },
    shape: {
      height: 2.05,
      plan: 'serpent',
      hide: 'scale',
      crouch: 0.0,
      pose: {
        bodyYaw: 0.34, bodyRoll: -0.06,
        neckPitch: -0.20, headYaw: -0.44, headPitch: -0.16, headRoll: 0.12,
      },
      fangs: 0,
      seed: 404,
      torso: {
        hipY: 0.30, hipZ: 0, pitch: 0,
        radius: 0.12, height: 0.14, belly: 0, chest: 0,
        depth: 1, lean: 0, shoulderY: 0.5, shoulderX: 1,
      },
      neck: { segments: 2, radiusBase: 0.108, radiusTop: 0.085, arch: -0.10 },
      head: {
        y: 0.905, z: 0.245, radius: 0.140, width: 1.10, depth: 1.42,
        crownFlat: 0.48, brow: 0.42, cheek: 0.22, jaw: 0.30, tilt: 0.20,
        snout: { length: 0.185, radius: 0.082, tipRadius: 0.048, drop: 0.012, keel: 0.42, spread: 1.25 },
      },
      eye: {
        radius: 0.062, spacing: 0.110, y: 0.955, z: 0.290,
        splay: 0.66, lid: 0.16, lidTilt: -0.08, mask: 0.4,
      },
      arms: null,
      legs: null,
      serpent: {
        // A rearing S out of a long ground coil. The horizontal run matters as
        // much as the height: nothing else on the roster is wider than it is
        // tall, and that alone identifies it in a thumbnail row.
        path: [
          [0.000, 0.780, 0.230],
          [0.005, 0.640, 0.150],
          [-0.020, 0.490, 0.045],
          [-0.070, 0.340, -0.075],
          [-0.090, 0.200, -0.215],
          [-0.020, 0.105, -0.350],
          [0.150, 0.078, -0.415],
          [0.340, 0.082, -0.360],
          [0.480, 0.100, -0.205],
          [0.545, 0.130, -0.010],
          [0.520, 0.175, 0.180],
          [0.400, 0.230, 0.320],
          [0.230, 0.290, 0.375],
        ],
        radius: 0.118, swell: 0.20, segments: 12,
        fins: 12, finHeight: 0.125, finEnd: 0.58,
        scutes: 16,
      },
      tail: null,
      features: [
        { kind: 'finEars', length: 0.26, width: 0.150, splay: 0.85 },
        { kind: 'pectoralFins', length: 0.26, width: 0.145, at: 0.16 },
        { kind: 'collar', radius: 0.112, tube: 0.024 },
        { kind: 'cheekVents', count: 3, radius: 0.020 },
      ],
    },
  },

  /* ---------------------------------------------------------------- *
   * VOLTQUILL -- Plan: drifter. It never touches the ground. A charged
   * core hangs inside copper rings, a halo of quills radiates from it and
   * four streamers trail below.
   * Silhouette test: a starburst with nothing under it.
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
      primary: '#4a3f8f',
      secondary: '#221b4a',
      belly: '#f2c14e',
      accent: '#f2d98a',
      dark: '#0d0a20',
      metal: '#c9752f',
      eye: '#8ef4ff',
      glow: '#bfe9ff',
    },
    shape: {
      height: 1.45,
      plan: 'drifter',
      hide: 'smooth',
      crouch: 0.0,
      pose: {
        bodyYaw: 0.22, bodyRoll: 0.10, bodyLean: -0.12,
        headYaw: -0.30, headPitch: -0.08, headRoll: -0.10,
      },
      fangs: 2,
      seed: 505,
      torso: {
        hipY: 0.34, hipZ: 0, pitch: 0,
        radius: 0.215, height: 0.16, belly: 0.2, chest: 0.1,
        depth: 1, lean: 0, shoulderY: 0.5, shoulderX: 1,
      },
      neck: { segments: 1, radiusBase: 0.09, radiusTop: 0.075, arch: 0 },
      head: {
        y: 0.760, z: 0.045, radius: 0.170, width: 1.02, depth: 1.00,
        crownFlat: 0.10, brow: 0.52, cheek: 0.30, jaw: 0.26, tilt: 0.02,
        snout: { length: 0.095, radius: 0.078, tipRadius: 0.050, drop: 0.024, keel: 0.30 },
      },
      eye: {
        radius: 0.062, spacing: 0.092, y: 0.782, z: 0.155,
        splay: 0.34, lid: 0.34, lidTilt: 0.30, mask: 1.0,
      },
      arms: null,
      legs: null,
      drifter: {
        coreY: 0.470, coreRadius: 0.215, coreFlat: 0.80,
        rings: 2, ringRadius: 0.335,
        halo: 13, haloLength: 0.300,
        streamers: 4, streamerLength: 0.360, streamerSpread: 0.145,
        hover: 0.16,
      },
      tail: null,
      features: [
        { kind: 'finEars', length: 0.235, width: 0.105, splay: 0.55 },
        { kind: 'horns', length: 0.150, radius: 0.024, spread: 0.062, pitch: -0.30, bend: 0.30 },
      ],
    },
  },

  /* ---------------------------------------------------------------- *
   * GEARHAWK -- Voltquill armoured by the Thicket. Plan: raptor. Two very
   * long digitigrade legs, a body pitched forward off the hip, a neck that
   * folds into an S and plated wings held in a wide V.
   * Silhouette test: an arrowhead on stilts.
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
      primary: '#8b95a4',
      secondary: '#3a424e',
      belly: '#e4e9f0',
      accent: '#b4432f',
      dark: '#171b21',
      metal: '#cfa04a',
      eye: '#ffcf3a',
      glow: '#ffd36e',
    },
    shape: {
      height: 2.80,
      plan: 'raptor',
      hide: 'plate',
      crouch: 0.30,
      pose: {
        bodyYaw: -0.22, bodyLean: 0.06,
        chestTwist: -0.14, neckPitch: 0.10,
        headYaw: 0.40, headPitch: -0.06, headRoll: 0.08,
        legLead: 0.110, stance: 0.020,
        wingL: [0.04, 0.22, -0.10], wingR: [-0.02, -0.14, 0.06],
      },
      fangs: 0,
      seed: 606,
      torso: {
        hipY: 0.500, hipZ: -0.145, pitch: 1.02,
        radius: 0.160, height: 0.235, belly: 0.16, chest: 0.40,
        depth: 0.94, lean: 0.0, shoulderY: 0.66, shoulderX: 1.10,
      },
      neck: { segments: 3, radiusBase: 0.115, radiusTop: 0.068, arch: -0.42, ruff: 0.9 },
      head: {
        y: 0.930, z: 0.185, radius: 0.118, width: 0.92, depth: 1.20,
        crownFlat: 0.34, brow: 0.78, cheek: 0.22, jaw: 0.26, tilt: 0.10,
        snout: { length: 0.215, radius: 0.070, tipRadius: 0.024, drop: 0.080, keel: 0.90 },
      },
      eye: {
        radius: 0.044, spacing: 0.068, y: 0.955, z: 0.240,
        splay: 0.56, lid: 0.44, lidTilt: 0.36, mask: 1.0,
      },
      arms: null,
      legs: {
        upperLength: 0.235, upperRadius: 0.082, lowerLength: 0.225, lowerRadius: 0.050,
        pastern: 0.165,
        footLength: 0.185, footRadius: 0.056, digits: 3, clawLength: 0.070,
        spread: 0.115, forward: 0.02, bend: 1.00, foot: 'talon',
      },
      tail: { length: 0.46, radius: 0.055, rise: 0.02, sweep: 0.0, segments: 5, tip: 'blade', wave: 0.6 },
      features: [
        { kind: 'wings', span: 1.24, chord: 0.56, fingers: 4, droop: 0.05, plated: true },
        { kind: 'shoulderCogs', radius: 0.100, teeth: 11 },
        { kind: 'horns', length: 0.24, radius: 0.030, spread: 0.062, pitch: -0.72, bend: 0.30 },
        { kind: 'backPlates', count: 5, size: 0.075 },
        { kind: 'brandMark', radius: 0.050 },
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
