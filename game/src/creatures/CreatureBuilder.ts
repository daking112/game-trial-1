import * as THREE from 'three';
import {
  blob,
  cog,
  leaf,
  makeRng,
  NodeBuilder,
  pipe,
  plate,
  spike,
  splinePlate,
  taperedTube,
  xf,
} from './Parts';
import { hideTextures, irisTexture } from './CreatureTextures';
import type { Feature, LimbShape, Species } from './species';

/**
 * Turns species data into a rigged, shaded creature.
 *
 * Everything is authored in a *unit space* where the creature is roughly 1.0
 * tall, and every piece of geometry is positioned in absolute unit
 * coordinates. That is the trick that keeps this readable: a leaf on the
 * crest is placed at "just above the head", not at "0.31 up and 0.02 back
 * from the neck joint, in the neck's rotated frame". At the end the whole
 * thing is measured, floored to y=0 and scaled to the species' real height.
 *
 * The body is assembled per **body plan**. `sproutling`, `brawler`,
 * `quadruped` and `raptor` share one parameterised spine -- a body axis with
 * a pitch, so the same numbers describe a standing biped and a horizontal
 * barrel on four legs -- while `serpent` and `drifter` have no legs at all
 * and build their mass along a curve or around a floating core.
 */

export interface CreatureRig {
  root: THREE.Group;
  /** Whole-body bob and lean. */
  bob: THREE.Group;
  hips: THREE.Group;
  /** Breathing scale lives here. */
  torso: THREE.Group;
  chest: THREE.Group;
  neck: THREE.Group;
  head: THREE.Group;
  jaw: THREE.Group;
  earL: THREE.Group;
  earR: THREE.Group;
  crest: THREE.Group;
  armL: THREE.Group | null;
  armR: THREE.Group | null;
  foreL: THREE.Group | null;
  foreR: THREE.Group | null;
  legL: THREE.Group | null;
  legR: THREE.Group | null;
  /** Tail, serpent body chain or drifter streamers -- all animate alike. */
  tail: THREE.Group[];
  /** Per-segment wave amplitude, so a ten-link body does not flail. */
  tailAmp: number[];
  /** Per-segment phase lag. Resets per streamer on a drifter. */
  tailLag: number[];
  wingL: THREE.Group | null;
  wingR: THREE.Group | null;
  /**
   * Baked rest rotations. The idle animation adds to these rather than
   * overwriting them, so a species keeps its stance while it breathes.
   */
  rest: RestPose;
}

export interface RestPose {
  bob: [number, number, number];
  chest: [number, number, number];
  neck: [number, number, number];
  head: [number, number, number];
  armL: [number, number, number];
  armR: [number, number, number];
  wingL: [number, number, number];
  wingR: [number, number, number];
}

export interface BuiltCreature {
  group: THREE.Group;
  rig: CreatureRig;
  materials: THREE.Material[];
  geometries: THREE.BufferGeometry[];
  /** Real-world height in metres. */
  height: number;
  /** Emissive materials, pulsed by the element glow. */
  glowMaterials: THREE.MeshStandardMaterial[];
}

/* ------------------------------------------------------------------ */

/** A rig node plus the absolute unit-space point it pivots around. */
class Part {
  readonly nb: NodeBuilder;
  readonly abs: THREE.Vector3;

  constructor(name: string, parent: Part | THREE.Object3D | null, abs: THREE.Vector3) {
    const parentObj = parent instanceof Part ? parent.nb.object : parent ?? undefined;
    this.nb = new NodeBuilder(name, parentObj);
    this.abs = abs.clone();
    const parentAbs = parent instanceof Part ? parent.abs : new THREE.Vector3();
    this.nb.object.position.copy(abs).sub(parentAbs);
  }

  /** Add geometry authored in absolute unit space. */
  add(material: string, geo: THREE.BufferGeometry): this {
    geo.translate(-this.abs.x, -this.abs.y, -this.abs.z);
    this.nb.add(material, geo);
    return this;
  }

  get object() {
    return this.nb.object;
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const FWD = new THREE.Vector3(0, 0, 1);
/** World direction the key light comes from -- highlights are placed against it. */
const KEY = new THREE.Vector3(-0.379, 0.788, 0.485).normalize();

function quatTo(dir: THREE.Vector3): THREE.Quaternion {
  return new THREE.Quaternion().setFromUnitVectors(FWD, dir.clone().normalize());
}
function quatUpTo(dir: THREE.Vector3): THREE.Quaternion {
  return new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize());
}

/** Place a geometry authored around the origin at `at`, oriented along `dir` (from +Y). */
function orientUp(geo: THREE.BufferGeometry, at: THREE.Vector3, dir: THREE.Vector3, roll = 0) {
  const m = new THREE.Matrix4().makeRotationFromQuaternion(
    quatUpTo(dir).multiply(new THREE.Quaternion().setFromAxisAngle(UP, roll)),
  );
  m.setPosition(at);
  geo.applyMatrix4(m);
  return geo;
}

/** Place a geometry authored around the origin at `at`, oriented along `dir` (from +Z). */
function orientFwd(geo: THREE.BufferGeometry, at: THREE.Vector3, dir: THREE.Vector3, roll = 0) {
  const m = new THREE.Matrix4().makeRotationFromQuaternion(
    quatTo(dir).multiply(new THREE.Quaternion().setFromAxisAngle(FWD, roll)),
  );
  m.setPosition(at);
  geo.applyMatrix4(m);
  return geo;
}

/**
 * Place a geometry authored in XY (X across, Y along, Z thickness) using an
 * explicit basis. Feathers and fins need their *flat face* aimed somewhere
 * specific; deriving that from a single direction vector leaves the roll to
 * chance, which is how a wing ends up as a sunburst of edge-on shards.
 */
/**
 * Place a geometry authored flat in XY using an explicit in-plane basis:
 * local +X follows `x`, local +Y follows `y` (orthogonalised), thickness
 * along the resulting normal. Drawing a complex shape -- a wing outline, a
 * fin -- is tractable in 2D and hopeless directly in 3D, so anything with a
 * real outline is authored flat and placed with this.
 */
function orientBasis(
  geo: THREE.BufferGeometry,
  at: THREE.Vector3,
  x: THREE.Vector3,
  y: THREE.Vector3,
) {
  const xx = x.clone().normalize();
  const yy = y.clone().sub(xx.clone().multiplyScalar(y.dot(xx))).normalize();
  const zz = new THREE.Vector3().crossVectors(xx, yy).normalize();
  const m = new THREE.Matrix4().makeBasis(xx, yy, zz);
  m.setPosition(at);
  geo.applyMatrix4(m);
  return geo;
}

function orientPlane(geo: THREE.BufferGeometry, at: THREE.Vector3, along: THREE.Vector3, normal: THREE.Vector3) {
  const y = along.clone().normalize();
  const z = normal.clone().sub(y.clone().multiplyScalar(normal.dot(y))).normalize();
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  m.setPosition(at);
  geo.applyMatrix4(m);
  return geo;
}

const gauss = (x: number, c: number, w: number) => Math.exp(-(((x - c) / w) ** 2));
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/* ------------------------------------------------------------------ */
/* Materials                                                           */
/* ------------------------------------------------------------------ */

/**
 * A wrap-light rim term, injected into the standard shader.
 *
 * Three-point lighting alone leaves a stylised creature reading as flat
 * colour fields: the terminator is the only edge in the whole form. A
 * view-dependent fresnel picks out every curve away from the camera, which
 * is what makes a rounded mass look rounded at a hundred pixels tall. It is
 * also the cheapest way to separate a dark creature from a dark background.
 */
function addRim(mat: THREE.MeshStandardMaterial, colour: THREE.Color, strength: number, power: number, key: string) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColour = { value: colour };
    shader.uniforms.uRimStrength = { value: strength };
    shader.uniforms.uRimPower = { value: power };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 uRimColour;\nuniform float uRimStrength;\nuniform float uRimPower;',
      )
      .replace(
        '#include <opaque_fragment>',
        [
          '{',
          '  vec3 rimN = normalize( normal );',
          '  vec3 rimV = normalize( vViewPosition );',
          '  float rimF = pow( clamp( 1.0 - dot( rimN, rimV ), 0.0, 1.0 ), uRimPower );',
          '  outgoingLight += uRimColour * ( rimF * uRimStrength );',
          '}',
          '#include <opaque_fragment>',
        ].join('\n'),
      );
  };
  mat.customProgramCacheKey = () => `rim:${key}`;
  return mat;
}

function buildMaterials(sp: Species) {
  const pal = sp.palette;
  const hide = hideTextures(sp.shape.hide, sp.shape.seed);

  const tiled = (repeat: number) => {
    const map = hide.map.clone();
    map.needsUpdate = true;
    map.repeat.set(repeat, repeat);
    const normalMap = hide.normalMap.clone();
    normalMap.needsUpdate = true;
    normalMap.repeat.set(repeat, repeat);
    normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
    return { map, normalMap };
  };

  // Rim tint: a cool sky bounce, pulled a third of the way toward the
  // species' own glow so an Ember creature rims warm and a Tide one cold.
  const rimColour = new THREE.Color('#a9cdff').lerp(new THREE.Color(pal.glow), 0.34);

  const skin = (
    colour: string,
    repeat = 3,
    rough = 0.62,
    normalScale = 0.62,
    rim = 0.16,
    key = colour,
  ) => {
    // Big, quiet grain. A tight tile at high normal strength reads as knitted
    // fabric at portrait distance and as noise at gameplay distance -- it is
    // surface *texture* where what the form needs is surface *variation*.
    const t = tiled(repeat);
    const m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(colour),
      map: t.map,
      normalMap: t.normalMap,
      normalScale: new THREE.Vector2(normalScale, normalScale),
      roughness: rough,
      metalness: 0.0,
      envMapIntensity: 1.05,
    });
    return addRim(m, rimColour, rim, 2.6, `${sp.id}:${key}`);
  };

  const glow = new THREE.MeshStandardMaterial({
    color: new THREE.Color(pal.glow),
    emissive: new THREE.Color(pal.glow),
    emissiveIntensity: 2.6,
    roughness: 0.35,
    metalness: 0,
  });

  const hilite = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xffffff,
    emissiveIntensity: 1.35,
    roughness: 0.05,
    metalness: 0,
  });

  // Value and finish are pushed apart deliberately: the primary hide is the
  // matte reference, the secondary reads slightly waxier, the belly is the
  // softest and least reflective, and the accent is the only saturated
  // near-gloss on the body. Without that spread every block reads as the
  // same plastic in a different colour.
  const materials: Record<string, THREE.Material> = {
    primary: skin(pal.primary, 1.7, 0.58, 0.26, 0.17, 'primary'),
    secondary: skin(pal.secondary, 1.9, 0.74, 0.34, 0.11, 'secondary'),
    belly: skin(pal.belly, 1.4, 0.88, 0.14, 0.07, 'belly'),
    accent: skin(pal.accent, 2.1, 0.38, 0.20, 0.28, 'accent'),
    dark: skin(pal.dark, 2.3, 0.46, 0.30, 0.24, 'dark'),
    metal: addRim(
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(pal.metal),
        map: hideTextures('plate', 11).map.clone(),
        roughness: 0.30,
        metalness: 0.92,
        envMapIntensity: 1.35,
      }),
      rimColour,
      0.20,
      3.2,
      `${sp.id}:metal`,
    ),
    claw: new THREE.MeshStandardMaterial({
      color: new THREE.Color('#f5ead2'),
      roughness: 0.26,
      metalness: 0.0,
      envMapIntensity: 1.1,
    }),
    eyeWhite: new THREE.MeshStandardMaterial({
      color: new THREE.Color('#fdfbf5'),
      roughness: 0.06,
      metalness: 0.0,
      envMapIntensity: 1.7,
    }),
    iris: new THREE.MeshStandardMaterial({
      color: new THREE.Color(pal.eye),
      map: irisTexture(pal.eye, sp.shape.seed),
      emissive: new THREE.Color(pal.eye),
      emissiveIntensity: 0.22,
      roughness: 0.09,
      metalness: 0.0,
      envMapIntensity: 1.4,
    }),
    pupil: new THREE.MeshStandardMaterial({
      color: new THREE.Color('#08080e'),
      roughness: 0.05,
      metalness: 0.0,
      envMapIntensity: 1.2,
    }),
    hilite,
    mouth: new THREE.MeshStandardMaterial({
      color: new THREE.Color('#6b2130'),
      roughness: 0.42,
      metalness: 0.0,
    }),
    glow,
  };

  const metalMap = (materials.metal as THREE.MeshStandardMaterial).map;
  if (metalMap) {
    metalMap.needsUpdate = true;
    metalMap.repeat.set(2, 2);
  }

  return { materials, glowMaterials: [glow, hilite] };
}

/* ------------------------------------------------------------------ */
/* Body frame                                                          */
/* ------------------------------------------------------------------ */

/**
 * The body axis. `pitch` rotates it out of vertical, and every anchor -- hip,
 * shoulder, dorsal line, belly line -- is expressed in that frame, so one set
 * of numbers describes both an upright brawler and a horizontal stag.
 */
interface Frame {
  /** Hip toward shoulder. */
  axis: THREE.Vector3;
  /** Back of the creature. */
  dorsal: THREE.Vector3;
  /** Underside. */
  ventral: THREE.Vector3;
  hip: THREE.Vector3;
  centre: THREE.Vector3;
  chest: THREE.Vector3;
  top: THREE.Vector3;
  pitch: number;
  /** u in -1..1 along the body axis -> absolute point on the centreline. */
  at: (u: number) => THREE.Vector3;
}

function makeFrame(sp: Species): Frame {
  const t = sp.shape.torso;
  const pitch = t.pitch;
  const axis = V(0, Math.cos(pitch), Math.sin(pitch));
  const dorsal = V(0, Math.sin(pitch), -Math.cos(pitch));
  const hip = V(0, t.hipY, t.hipZ);
  const at = (u: number) => hip.clone().addScaledVector(axis, t.height * (1 + u));
  return {
    axis,
    dorsal,
    ventral: dorsal.clone().negate(),
    pitch,
    hip,
    centre: at(0),
    chest: at(t.shoulderY),
    top: at(1),
    at,
  };
}

/* ------------------------------------------------------------------ */
/* The build                                                           */
/* ------------------------------------------------------------------ */

export function buildCreature(sp: Species): BuiltCreature {
  const s = sp.shape;
  const rnd = makeRng(s.seed);
  const { materials, glowMaterials } = buildMaterials(sp);
  const geometries: THREE.BufferGeometry[] = [];

  const group = new THREE.Group();
  group.name = `creature:${sp.id}`;
  const scaler = new THREE.Group();
  scaler.name = 'scale';
  group.add(scaler);

  const t = s.torso;
  const hd = s.head;
  const frame = makeFrame(sp);
  const headAbs = V(0, hd.y, hd.z);
  const legless = s.plan === 'serpent' || s.plan === 'drifter';

  /* --- spine rig -------------------------------------------------- */
  const bob = new Part('bob', scaler, V(0, 0, 0));
  const hips = new Part('hips', bob, frame.hip.clone());
  const torso = new Part('torso', hips, frame.centre.clone());
  const chest = new Part('chest', torso, frame.chest.clone());

  /* --- body mass -------------------------------------------------- */
  if (s.plan === 'serpent') {
    buildSerpentBody(sp, hips, materials);
  } else if (s.plan === 'drifter') {
    buildDrifterCore(sp, torso);
  } else {
    buildTorso(sp, frame, torso);
  }

  /* --- neck ------------------------------------------------------- */
  const neckParts = buildNeck(sp, frame, headAbs, chest);
  const neckRoot = neckParts[0] ?? chest;
  const headParent = neckParts[neckParts.length - 1] ?? chest;

  /* --- head ------------------------------------------------------- */
  const head = new Part('head', headParent, headAbs);
  const jawPivot = V(0, hd.y - hd.radius * 0.42, hd.z - hd.radius * hd.depth * 0.3);
  const jaw = new Part('jaw', head, jawPivot);
  const crest = new Part('crest', head, V(0, hd.y + hd.radius * 0.7, hd.z));
  const headFrontZ = hd.z + hd.radius * hd.depth;
  buildHead(sp, head, jaw, materials);

  /* --- limbs ------------------------------------------------------ */
  let legL: Part | null = null;
  let legR: Part | null = null;
  let armL: Part | null = null;
  let armR: Part | null = null;
  let foreL: Part | null = null;
  let foreR: Part | null = null;

  // Stagger and stance are baked into where the limb roots sit rather than
  // rotated in, so the feet stay planted on the floor plane exactly.
  const lead = s.pose?.legLead ?? 0;
  const stance = s.pose?.stance ?? 0;
  if (s.legs && !legless) {
    legL = buildLimb('legL', hips, s.legs, -1, frame.hip, sp, lead, stance);
    legR = buildLimb('legR', hips, s.legs, 1, frame.hip, sp, -lead, stance);
  }
  if (s.forelegs && !legless) {
    // Forelegs hang off the shoulder, a little below the chest node so the
    // barrel sits on top of them rather than between them.
    const root = frame.chest.clone().addScaledVector(frame.ventral, t.radius * 0.42);
    const l = buildLimb('foreLegL', chest, s.forelegs, -1, root, sp, -lead * 0.8, stance);
    const r = buildLimb('foreLegR', chest, s.forelegs, 1, root, sp, lead * 0.8, stance);
    foreL = l;
    foreR = r;
  }
  if (s.arms) {
    const shoulder = frame.chest
      .clone()
      .addScaledVector(frame.axis, t.height * 0.10)
      .addScaledVector(frame.ventral, -t.radius * 0.06);
    const l = buildArm('armL', chest, s.arms, -1, V(-t.radius * t.shoulderX, shoulder.y, shoulder.z), sp);
    const r = buildArm('armR', chest, s.arms, 1, V(t.radius * t.shoulderX, shoulder.y, shoulder.z), sp);
    armL = l.upper;
    armR = r.upper;
    // A quadruped's forelegs already occupy the `fore` slots.
    if (!foreL) {
      foreL = l.lower;
      foreR = r.lower;
    }
  }

  /* --- tail / streamers ------------------------------------------- */
  const tailParts: Part[] = [];
  const tailAmp: number[] = [];
  const tailLag: number[] = [];

  if (s.plan === 'serpent') {
    buildSerpentChain(sp, hips, tailParts, tailAmp, tailLag);
  } else if (s.plan === 'drifter') {
    buildStreamers(sp, torso, tailParts, tailAmp, tailLag);
  } else if (s.tail) {
    const tl = s.tail;
    const wave = tl.wave ?? 1;
    const start = frame.hip.clone().addScaledVector(frame.dorsal, t.radius * 0.62).addScaledVector(frame.axis, t.height * 0.1);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= tl.segments; i++) {
      const u = i / tl.segments;
      pts.push(
        V(
          start.x + tl.sweep * tl.length * u * u,
          start.y + tl.rise * tl.length * Math.sin(u * Math.PI * 0.72) - tl.length * 0.14 * u * u,
          start.z - tl.length * (u * 0.82 + 0.18 * u * u),
        ),
      );
    }
    let parent: Part = hips;
    for (let i = 0; i < tl.segments; i++) {
      const seg: Part = new Part(`tail${i}`, parent, pts[i]);
      const a = pts[i];
      const b = pts[i + 1];
      const mid = new THREE.Vector3().lerpVectors(a, b, 0.5);
      const curve = new THREE.CatmullRomCurve3([a, mid, b]);
      const u0 = i / tl.segments;
      const u1 = (i + 1) / tl.segments;
      const rAt = (u: number) => tl.radius * Math.pow(1 - u * 0.94, 0.9);
      seg.add(
        'primary',
        taperedTube(curve, (u) => rAt(THREE.MathUtils.lerp(u0, u1, u)), 6, 10),
      );
      // Ventral scutes: a lighter underside stripe running the tail. Cheap,
      // and it stops a long tail reading as a bare tube.
      if (i % 2 === 0 && tl.radius > 0.03) {
        const sc = blob({ detail: 2, radius: 1 });
        const rr = rAt((u0 + u1) * 0.5);
        sc.scale(rr * 0.66, rr * 0.42, tl.length / tl.segments * 0.46);
        seg.add('belly', xf(sc, { pos: [mid.x, mid.y - rr * 0.72, mid.z] }));
      }
      tailParts.push(seg);
      tailAmp.push((0.10 + i * 0.035) * wave);
      tailLag.push(i * 0.55);
      parent = seg;
    }
    buildTailTip(tailParts[tailParts.length - 1], pts[tl.segments], tl.tip, tl, sp);
  }

  /* --- features --------------------------------------------------- */
  const featureCtx: FeatureCtx = {
    sp,
    rnd,
    frame,
    hips,
    torso,
    chest,
    neck: neckRoot,
    head,
    crest,
    hipY: frame.hip.y,
    torsoY: frame.centre.y,
    torsoTop: frame.top.y,
    chestY: frame.chest.y,
    headAbs,
    headFrontZ,
    tailParts,
  };
  let earL = new Part('earL', head, headAbs.clone());
  let earR = new Part('earR', head, headAbs.clone());
  let wingL: Part | null = null;
  let wingR: Part | null = null;
  for (const f of s.features) {
    const made = buildFeature(f, featureCtx, earL, earR);
    if (made?.wings) {
      wingL = made.wings[0];
      wingR = made.wings[1];
    }
    if (made?.ears) {
      earL = made.ears[0];
      earR = made.ears[1];
    }
  }

  /* --- rest pose --------------------------------------------------- */
  // Baked, not animated: this is what the creature looks like standing still,
  // and it is the difference between a roster and a row of blockouts.
  const po = s.pose ?? {};
  const rest: RestPose = {
    bob: [po.bodyLean ?? 0, po.bodyYaw ?? 0, po.bodyRoll ?? 0],
    chest: [0, po.chestTwist ?? 0, 0],
    neck: [po.neckPitch ?? 0, 0, 0],
    head: [po.headPitch ?? 0, po.headYaw ?? 0, po.headRoll ?? 0],
    armL: po.armL ?? [0, 0, 0],
    armR: po.armR ?? [0, 0, 0],
    wingL: po.wingL ?? [0, 0, 0],
    wingR: po.wingR ?? [0, 0, 0],
  };
  bob.object.rotation.set(rest.bob[0], rest.bob[1], rest.bob[2]);
  chest.object.rotation.set(rest.chest[0], rest.chest[1], rest.chest[2]);
  neckRoot.object.rotation.set(rest.neck[0], rest.neck[1], rest.neck[2]);
  head.object.rotation.set(rest.head[0], rest.head[1], rest.head[2]);
  if (armL) armL.object.rotation.set(rest.armL[0], rest.armL[1], rest.armL[2]);
  if (armR) armR.object.rotation.set(rest.armR[0], rest.armR[1], rest.armR[2]);
  if (wingL) wingL.object.rotation.set(rest.wingL[0], rest.wingL[1], rest.wingL[2]);
  if (wingR) wingR.object.rotation.set(rest.wingR[0], rest.wingR[1], rest.wingR[2]);

  /* --- bake ------------------------------------------------------- */
  const parts: Part[] = [bob, hips, torso, chest, head, jaw, crest, earL, earR, ...neckParts, ...tailParts];
  for (const p of [legL, legR, armL, armR, foreL, foreR, wingL, wingR]) if (p) parts.push(p);
  collectParts(scaler, parts);
  for (const p of parts) p.nb.bake(materials, geometries);

  /* --- floor and scale -------------------------------------------- */
  scaler.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scaler);
  const measured = box.max.y - box.min.y;
  const k = measured > 1e-4 ? s.height / measured : s.height;
  scaler.scale.setScalar(k);
  // A drifter never touches the ground; everything else is floored to y=0.
  const hover = s.plan === 'drifter' ? (s.drifter?.hover ?? 0) * s.height : 0;
  scaler.position.y = -box.min.y * k + hover;
  scaler.updateMatrixWorld(true);

  const rig: CreatureRig = {
    root: group,
    bob: bob.object,
    hips: hips.object,
    torso: torso.object,
    chest: chest.object,
    neck: neckRoot.object,
    head: head.object,
    jaw: jaw.object,
    earL: earL.object,
    earR: earR.object,
    crest: crest.object,
    armL: armL?.object ?? null,
    armR: armR?.object ?? null,
    foreL: foreL?.object ?? null,
    foreR: foreR?.object ?? null,
    legL: legL?.object ?? null,
    legR: legR?.object ?? null,
    tail: tailParts.map((p) => p.object),
    tailAmp,
    tailLag,
    wingL: wingL?.object ?? null,
    wingR: wingR?.object ?? null,
    rest,
  };

  return {
    group,
    rig,
    materials: Object.values(materials),
    geometries,
    height: s.height + hover,
    glowMaterials,
  };
}

/** Any part whose parent chain was never attached lands on the scaler. */
function collectParts(scaler: THREE.Group, parts: Part[]) {
  for (const p of parts) if (!p.object.parent) scaler.add(p.object);
}

/** Rotate a geometry about a pivot on the X axis -- used to bake pose in. */
function pitchAbout(geo: THREE.BufferGeometry, angle: number, pivot: THREE.Vector3) {
  const m = new THREE.Matrix4()
    .makeTranslation(pivot.x, pivot.y, pivot.z)
    .multiply(new THREE.Matrix4().makeRotationX(angle))
    .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
  geo.applyMatrix4(m);
  return geo;
}

/* ------------------------------------------------------------------ */
/* Torso                                                               */
/* ------------------------------------------------------------------ */

function buildTorso(sp: Species, frame: Frame, torso: Part) {
  const t = sp.shape.torso;
  const waist = t.waist ?? 0;

  const bodyProfile = (y: number) => {
    const pinch = 1 - waist * gauss(y, -0.05, 0.34);
    return {
      w:
        (1 + t.belly * gauss(y, -0.32, 0.62) + t.chest * gauss(y, 0.42, 0.55) - 0.16 * gauss(y, 1.0, 0.5)) *
        pinch,
      d:
        (1 + t.belly * 0.72 * gauss(y, -0.25, 0.7) + t.chest * 0.5 * gauss(y, 0.35, 0.6)) * t.depth * pinch,
      dz: t.belly * t.radius * 0.16 * gauss(y, -0.35, 0.7) + t.chest * t.radius * 0.22 * gauss(y, 0.42, 0.5),
    };
  };

  const place = (g: THREE.BufferGeometry) => {
    // Author along +Y, then pitch the whole mass onto the body axis and lean
    // it about the hip, so the pose is baked in and the rig stays axis-aligned.
    pitchAbout(g, frame.pitch, V(0, 0, 0));
    g.translate(0, frame.centre.y, frame.centre.z);
    pitchAbout(g, t.lean, frame.hip);
    return g;
  };

  const body = blob({ detail: 4, radius: t.radius, scaleY: t.height / t.radius, profile: bodyProfile });
  torso.add('primary', place(body));

  // Darker saddle over the back: the second colour block, and the thing that
  // reads as counter-shading at a distance.
  const saddle = blob({
    detail: 3,
    radius: t.radius * 0.99,
    scaleY: (t.height * 0.98) / t.radius,
    profile: (y) => ({
      w: bodyProfile(y).w * 0.995,
      d: bodyProfile(y).d * 0.995,
      dz: bodyProfile(y).dz - t.radius * 0.30,
    }),
  });
  torso.add('secondary', place(saddle));

  // Belly patch: a lens pressed through the front of the torso. Proud of the
  // surface at the centre, buried at the edges, so it crops itself.
  const bellyGeo = blob({
    detail: 3,
    radius: t.radius * 0.74,
    scaleY: (t.height * 1.02) / (t.radius * 0.74),
    profile: (y) => ({ w: (1 - 0.18 * Math.abs(y)) * (1 - (t.waist ?? 0) * 0.6 * gauss(y, -0.05, 0.34)), d: 0.5 }),
  });
  bellyGeo.translate(0, -t.height * 0.12, t.radius * t.depth * 0.62 + t.chest * t.radius * 0.13);
  torso.add('belly', place(bellyGeo));
}

/* ------------------------------------------------------------------ */
/* Neck                                                                */
/* ------------------------------------------------------------------ */

/**
 * A segmented neck from the shoulders to the skull.
 *
 * Length here is the single biggest silhouette lever on the roster: the
 * difference between the stag and the brawler is mostly that one of them has
 * half a body length of neck and the other has none.
 */
function buildNeck(sp: Species, frame: Frame, headAbs: THREE.Vector3, chest: Part): Part[] {
  const nk = sp.shape.neck;
  const hd = sp.shape.head;
  const a = frame.chest.clone().addScaledVector(frame.axis, sp.shape.torso.height * 0.16);
  const b = headAbs.clone().addScaledVector(frame.dorsal, hd.radius * 0.30).add(V(0, -hd.radius * 0.35, 0));
  const dist = a.distanceTo(b);
  if (dist < 1e-4) return [];

  // Two offset controls rather than one, so a negative arch folds the neck
  // into an S instead of merely bowing it.
  const c1 = new THREE.Vector3().lerpVectors(a, b, 0.34).addScaledVector(frame.dorsal, -nk.arch * dist * 0.55);
  const c2 = new THREE.Vector3().lerpVectors(a, b, 0.74).addScaledVector(frame.dorsal, nk.arch * dist * 0.62);
  const curve = new THREE.CatmullRomCurve3([a, c1, c2, b]);
  const rAt = (u: number) => THREE.MathUtils.lerp(nk.radiusBase, nk.radiusTop, Math.pow(u, 0.75));

  const parts: Part[] = [];
  let parent: Part = chest;
  for (let i = 0; i < nk.segments; i++) {
    const u0 = i / nk.segments;
    const u1 = (i + 1) / nk.segments;
    const p0 = curve.getPointAt(u0);
    const seg = new Part(`neck${i}`, parent, p0);
    const sub = new THREE.CatmullRomCurve3([
      p0,
      curve.getPointAt((u0 + u1) * 0.5),
      curve.getPointAt(u1),
    ]);
    seg.add('primary', taperedTube(sub, (u) => rAt(THREE.MathUtils.lerp(u0, u1, u)), 8, 12));
    // Throat: a lighter strip down the front of the neck.
    const throat = taperedTube(sub, (u) => rAt(THREE.MathUtils.lerp(u0, u1, u)) * 0.62, 6, 9);
    throat.translate(0, 0, rAt((u0 + u1) * 0.5) * 0.62);
    seg.add('belly', throat);
    parts.push(seg);
    parent = seg;
  }

  // Ruff where the neck meets the shoulders: a collar of plates that hides
  // the join and widens the top of the silhouette.
  if (nk.ruff && parts.length) {
    const ruff = nk.ruff;
    const base = curve.getPointAt(0.10);
    const tan = curve.getTangentAt(0.10);
    const n = 9;
    for (let i = 0; i < n; i++) {
      const ang = (i / (n - 1) - 0.5) * Math.PI * 1.35;
      const side = V(Math.sin(ang), 0, 0);
      const dir = side
        .clone()
        .addScaledVector(frame.dorsal, Math.cos(ang) * 0.9)
        .addScaledVector(frame.axis, 0.45)
        .normalize();
      const len = nk.radiusBase * 1.9 * ruff * (0.7 + 0.3 * Math.cos(ang));
      const g = spike(len, nk.radiusBase * 0.36, 0.5, 7, 6);
      orientUp(g, base.clone().addScaledVector(tan, -nk.radiusBase * 0.1), dir);
      parts[0].add(i % 2 === 0 ? 'secondary' : 'metal', g);
    }
  }
  return parts;
}

/* ------------------------------------------------------------------ */
/* Head                                                                */
/* ------------------------------------------------------------------ */

function buildHead(sp: Species, head: Part, jaw: Part, materials: Record<string, THREE.Material>) {
  const s = sp.shape;
  const hd = s.head;
  const headFrontZ = hd.z + hd.radius * hd.depth;

  const skull = blob({
    detail: 4,
    radius: hd.radius,
    profile: (y) => ({
      w: hd.width * (1 + hd.cheek * 0.42 * gauss(y, -0.15, 0.5) - 0.1 * gauss(y, 1, 0.4)),
      d: hd.depth * (1 + hd.jaw * 0.16 * gauss(y, -0.5, 0.45)),
      dz: hd.radius * (hd.brow * 0.13 * gauss(y, 0.34, 0.3) + hd.jaw * 0.1 * gauss(y, -0.55, 0.4)),
      dy: -hd.crownFlat * hd.radius * 0.55 * Math.max(0, y - 0.15),
    }),
  });
  head.add('primary', xf(skull, { pos: [0, hd.y, hd.z], rot: [hd.tilt, 0, 0] }));

  // Brow ridge: one wide wedge across both eyes. Reads as a scowl or a soft
  // forehead depending on `brow`, and it is what stops the head from looking
  // like a ball with dots on it.
  if (hd.brow > 0.1) {
    const bw = hd.radius * hd.width * 0.86;
    const brow = blob({ detail: 3, radius: 1, profile: (y) => ({ w: 1 - 0.1 * y, d: 1 }) });
    brow.scale(bw, hd.radius * 0.20 * (0.6 + hd.brow), hd.radius * hd.depth * 0.46);
    head.add(
      'primary',
      xf(brow, {
        pos: [0, s.eye.y + s.eye.radius * (0.62 + hd.brow * 0.2), hd.z + hd.radius * hd.depth * 0.52],
        rot: [-0.26 - hd.brow * 0.2, 0, 0],
      }),
    );
  }

  if (hd.snout) {
    const sn = hd.snout;
    const spread = sn.spread ?? 1;
    const base = V(0, hd.y - hd.radius * 0.14, hd.z + hd.radius * hd.depth * 0.24);
    const tip = V(0, base.y - sn.drop, headFrontZ + sn.length);
    const mid = new THREE.Vector3().lerpVectors(base, tip, 0.55).add(V(0, sn.drop * 0.28, 0));
    const curve = new THREE.CatmullRomCurve3([base, mid, tip]);
    const g = taperedTube(
      curve,
      (u) => THREE.MathUtils.lerp(sn.radius, sn.tipRadius, Math.pow(u, 0.7)) * (1 - 0.12 * Math.sin(u * Math.PI)),
      14,
      12,
    );
    if (spread !== 1) {
      g.translate(0, -base.y, 0);
      g.scale(spread, 1 / Math.sqrt(spread), 1);
      g.translate(0, base.y, 0);
    }
    head.add(sn.keel > 0.5 ? 'accent' : 'belly', g);

    if (sn.keel > 0.35) {
      const keel = plate(
        [
          [0, 0],
          [sn.length * 0.98, -sn.drop * 0.9],
          [sn.length * 0.86, -sn.drop * 0.9 - sn.tipRadius * 1.3],
          [0, -sn.radius * 0.85],
        ],
        sn.radius * 0.5,
        sn.radius * 0.16,
      );
      keel.rotateY(Math.PI / 2);
      head.add(
        sn.keel > 0.5 ? 'accent' : 'primary',
        xf(keel, { pos: [0, base.y + sn.radius * 0.72, base.z + hd.radius * 0.02] }),
      );
    }

    const nostril = blob({ detail: 2, radius: sn.tipRadius * 0.24 });
    for (const sx of [-1, 1]) {
      head.add(
        'dark',
        xf(nostril.clone(), {
          pos: [sx * sn.tipRadius * 0.52 * spread, tip.y + sn.tipRadius * 0.42, tip.z - sn.tipRadius * 0.5],
          scale: [1, 0.7, 1.1],
        }),
      );
    }
    nostril.dispose();

    // Mouth and chin taper along the muzzle rather than being constant-width
    // boxes: a straight-sided mouth block wider than the snout tip reads as a
    // banana clamped to the face, which is exactly what it looked like.
    const mouthW = sn.radius * 1.18 * spread;
    const mouthLen = sn.length * 0.88 + hd.radius * 0.14;
    const taper = (k: number) => (y: number) => ({ w: 1 - k * Math.max(0, y), d: 1 - k * 0.5 * Math.max(0, y) });

    const mouth = blob({ detail: 3, radius: 1, profile: taper(0.58) });
    mouth.scale(mouthW, mouthLen * 0.5, sn.radius * 0.28);
    mouth.rotateX(-Math.PI / 2);
    jaw.add(
      'mouth',
      xf(mouth, { pos: [0, base.y - sn.radius * 0.52, (base.z + tip.z) * 0.5], rot: [-sn.drop * 0.6, 0, 0] }),
    );

    const chin = blob({ detail: 3, radius: 1, profile: taper(0.62) });
    chin.scale(mouthW * 1.04, (sn.length + hd.radius * 0.26) * 0.5, sn.radius * 0.46);
    chin.rotateX(-Math.PI / 2);
    jaw.add(
      'belly',
      xf(chin, {
        pos: [0, base.y - sn.radius * 0.80, (base.z + tip.z) * 0.5 - sn.length * 0.08],
        rot: [-sn.drop * 0.5, 0, 0],
      }),
    );

    for (let i = 0; i < s.fangs; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const kk = Math.floor(i / 2);
      const g2 = spike(sn.radius * (0.62 - kk * 0.16), sn.radius * (0.2 - kk * 0.04), -0.4, 6, 6);
      g2.rotateX(Math.PI);
      head.add(
        'claw',
        xf(g2, {
          pos: [
            side * sn.radius * (0.78 - kk * 0.14) * spread,
            base.y - sn.radius * 0.52,
            tip.z - sn.length * (0.18 + kk * 0.34),
          ],
        }),
      );
    }
  }

  buildEyes(head, sp, materials);
}

/* ------------------------------------------------------------------ */
/* Serpent                                                             */
/* ------------------------------------------------------------------ */

function serpentCurve(sp: Species) {
  const sr = sp.shape.serpent!;
  return new THREE.CatmullRomCurve3(sr.path.map((p) => V(p[0], p[1], p[2])));
}

function serpentRadius(sp: Species, u: number) {
  const sr = sp.shape.serpent!;
  const sw = Math.max(sr.swell, 1e-3);
  if (u < sw) return sr.radius * (0.74 + 0.26 * (u / sw));
  const k = THREE.MathUtils.clamp((u - sw) / (1 - sw), 0, 1);
  return sr.radius * (Math.pow(1 - k, 0.80) * 0.98 + 0.02);
}

/** Fins and rings live on the static hip node; the chain carries the tubes. */
function buildSerpentBody(sp: Species, hips: Part, _materials: Record<string, THREE.Material>) {
  void hips;
  void sp;
  void _materials;
}

function buildSerpentChain(sp: Species, hips: Part, out: Part[], amp: number[], lag: number[]) {
  const sr = sp.shape.serpent!;
  const curve = serpentCurve(sp);
  const n = sr.segments;

  let parent: Part = hips;
  for (let i = 0; i < n; i++) {
    const u0 = i / n;
    const u1 = (i + 1) / n;
    const p0 = curve.getPointAt(u0);
    const seg = new Part(`body${i}`, parent, p0);
    const sub = new THREE.CatmullRomCurve3([
      p0,
      curve.getPointAt((u0 + u1) * 0.5),
      curve.getPointAt(u1),
    ]);
    const rAt = (u: number) => serpentRadius(sp, THREE.MathUtils.lerp(u0, u1, u));
    seg.add('primary', taperedTube(sub, rAt, 8, 14));

    // Belly scutes: a pale ladder along the underside. This is what stops a
    // long smooth tube from reading as a hose.
    const perScute = Math.max(1, Math.round(sr.scutes / n));
    for (let k = 0; k < perScute; k++) {
      const u = THREE.MathUtils.lerp(u0, u1, (k + 0.5) / perScute);
      const p = curve.getPointAt(u);
      const tan = curve.getTangentAt(u);
      const rr = serpentRadius(sp, u);
      const side = new THREE.Vector3().crossVectors(tan, UP).normalize();
      const down = new THREE.Vector3().crossVectors(side, tan).normalize().multiplyScalar(-1);
      const g = blob({ detail: 2, radius: 1, profile: (y) => ({ w: 1 - 0.25 * Math.abs(y) }) });
      g.scale(rr * 0.72, rr * 0.34, (1 / sr.scutes) * 2.2);
      orientFwd(g, p.clone().addScaledVector(down, rr * 0.74), tan);
      seg.add('belly', g);
    }

    // Accent bands: three saturated rings around the body, spaced so they
    // read as markings rather than as stripes.
    if (i % 3 === 1) {
      const u = (u0 + u1) * 0.5;
      const p = curve.getPointAt(u);
      const tan = curve.getTangentAt(u);
      const rr = serpentRadius(sp, u);
      const ring = new THREE.TorusGeometry(rr * 0.99, rr * 0.16, 8, 20);
      orientFwd(ring, p, tan);
      seg.add('accent', ring);
    }

    // Dorsal fin plates over the front half.
    const fu = (u0 + u1) * 0.5;
    if (fu <= sr.finEnd) {
      const p = curve.getPointAt(fu);
      const tan = curve.getTangentAt(fu);
      const side = new THREE.Vector3().crossVectors(tan, UP).normalize();
      const up = new THREE.Vector3().crossVectors(side, tan).normalize();
      const h = sr.finHeight * Math.sin(Math.pow(fu / sr.finEnd, 0.7) * Math.PI) * 1.1 + sr.finHeight * 0.25;
      // Authored in XY with X along the spine, so the fin lies in the sagittal
      // plane and reads as a crest rather than as an edge-on sliver.
      const g = splinePlate(
        [
          [-h * 0.55, 0],
          [-h * 0.30, h * 0.72],
          [h * 0.10, h * 1.0],
          [h * 0.62, h * 0.55],
          [h * 0.66, 0],
        ],
        serpentRadius(sp, fu) * 0.22,
      );
      orientPlane(g, p.clone().addScaledVector(up, serpentRadius(sp, fu) * 0.55), up, side);
      seg.add('accent', g);
      const spineRib = spike(h * 0.9, serpentRadius(sp, fu) * 0.13, 0.3, 7, 6);
      orientUp(spineRib, p.clone().addScaledVector(up, serpentRadius(sp, fu) * 0.5), up);
      seg.add('secondary', spineRib);
    }

    out.push(seg);
    // A long chain needs a much gentler wave than a five-link tail, and the
    // amplitude has to grow toward the tip or the whole body swings as a bar.
    amp.push(0.020 + 0.035 * Math.pow(i / n, 1.6));
    lag.push(i * 0.42);
    parent = seg;
  }

  /*
   * Caudal fin.
   *
   * It has to run *along* the tail axis. The previous version faced the
   * plate down the tangent, which stuck a dinner plate on the end of the
   * tail -- at stage-2 body radius that read as a metre-wide yellow slab
   * floating beside the coil. Two lobes: one vertical, one horizontal and
   * shorter, so the fluke has depth from every angle.
   */
  const last = out[out.length - 1];
  const tip = curve.getPointAt(1);
  const tan = curve.getTangentAt(1);
  const sideV = new THREE.Vector3().crossVectors(tan, UP).normalize();
  const upV = new THREE.Vector3().crossVectors(sideV, tan).normalize();
  const L = sr.radius * 2.5;
  const W = sr.radius * 1.15;
  for (const [normal, k] of [
    [sideV, 1.0],
    [upV, 0.58],
  ] as Array<[THREE.Vector3, number]>) {
    const g = splinePlate(
      [
        [0, -sr.radius * 0.55],
        [W * k, L * 0.30],
        [W * 0.72 * k, L * 0.88],
        [0, L * 0.58],
        [-W * 0.72 * k, L * 0.88],
        [-W * k, L * 0.30],
      ],
      sr.radius * 0.13,
    );
    orientPlane(g, tip.clone().addScaledVector(tan, -sr.radius * 0.15), tan, normal);
    last.add('accent', g);
  }
}

/* ------------------------------------------------------------------ */
/* Drifter                                                             */
/* ------------------------------------------------------------------ */

function buildDrifterCore(sp: Species, torso: Part) {
  const d = sp.shape.drifter!;
  const c = V(0, d.coreY, 0);

  const core = blob({ detail: 4, radius: d.coreRadius, profile: (y) => ({ w: 1 - 0.06 * y * y, d: 1 - 0.06 * y * y }) });
  core.scale(1, d.coreFlat, 1);
  torso.add('primary', xf(core, { pos: [c.x, c.y, c.z] }));

  // A bright underside lens: the charged half of the creature.
  const lens = blob({ detail: 3, radius: d.coreRadius * 0.82 });
  lens.scale(1, d.coreFlat * 0.7, 1);
  torso.add('belly', xf(lens, { pos: [0, c.y - d.coreRadius * 0.30, d.coreRadius * 0.22] }));

  // Dark cap over the top, so the core has three values from above to below.
  const cap = blob({ detail: 3, radius: d.coreRadius * 0.94 });
  cap.scale(1, d.coreFlat * 0.86, 1);
  torso.add('secondary', xf(cap, { pos: [0, c.y + d.coreRadius * 0.26, -d.coreRadius * 0.12] }));

  // Copper rings, each on its own axis. Nothing else on the roster carries a
  // perfect circle, so this alone identifies the species in silhouette.
  for (let i = 0; i < d.rings; i++) {
    const tiltA = (i / Math.max(1, d.rings - 1) - 0.5) * 1.5 + 0.35;
    const ring = new THREE.TorusGeometry(d.ringRadius * (1 - i * 0.16), d.coreRadius * 0.075, 8, 40);
    torso.add('metal', xf(ring, { pos: [0, c.y, 0], rot: [Math.PI / 2 + tiltA * 0.6, tiltA, 0] }));
    const stud = blob({ detail: 2, radius: d.coreRadius * 0.13 });
    torso.add(
      'accent',
      xf(stud, {
        pos: [
          Math.sin(tiltA) * d.ringRadius * (1 - i * 0.16),
          c.y + Math.cos(tiltA) * d.ringRadius * 0.35,
          Math.cos(tiltA) * d.ringRadius * 0.4,
        ],
      }),
    );
  }

  // Quill halo: a fan radiating outward and back from the core equator.
  for (let i = 0; i < d.halo; i++) {
    const u = d.halo === 1 ? 0.5 : i / (d.halo - 1);
    const ang = (u - 0.5) * Math.PI * 1.7;
    const len = d.haloLength * (0.55 + 0.45 * Math.cos((u - 0.5) * Math.PI));
    const dir = V(Math.sin(ang) * 0.94, Math.cos(ang) * 0.62 + 0.18, -Math.abs(Math.cos(ang)) * 0.5 - 0.1).normalize();
    const g = spike(len, d.coreRadius * 0.085, 0.22, 8, 6);
    orientUp(g, c.clone().addScaledVector(dir, d.coreRadius * 0.78), dir);
    torso.add(i % 2 === 0 ? 'metal' : 'dark', g);
    if (i % 3 === 0) {
      const tipG = blob({ detail: 2, radius: d.coreRadius * 0.07 });
      torso.add('glow', xf(tipG, { pos: [
        c.x + dir.x * (d.coreRadius * 0.78 + len),
        c.y + dir.y * (d.coreRadius * 0.78 + len),
        c.z + dir.z * (d.coreRadius * 0.78 + len),
      ] }));
    }
  }
}

function buildStreamers(sp: Species, torso: Part, out: Part[], amp: number[], lag: number[]) {
  const d = sp.shape.drifter!;
  const segs = 4;
  for (let sIdx = 0; sIdx < d.streamers; sIdx++) {
    const u = d.streamers === 1 ? 0.5 : sIdx / (d.streamers - 1);
    const ang = (u - 0.5) * Math.PI * 1.1;
    const x0 = Math.sin(ang) * d.streamerSpread;
    const z0 = Math.cos(ang) * d.streamerSpread * 0.55 - d.coreRadius * 0.15;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= segs; i++) {
      const v = i / segs;
      pts.push(
        V(
          x0 * (1 + v * 0.5),
          d.coreY - d.coreRadius * 0.55 - d.streamerLength * v,
          z0 - d.streamerLength * 0.28 * v * v,
        ),
      );
    }
    let parent: Part = torso;
    for (let i = 0; i < segs; i++) {
      const seg = new Part(`streamer${sIdx}_${i}`, parent, pts[i]);
      const curve = new THREE.CatmullRomCurve3([
        pts[i],
        new THREE.Vector3().lerpVectors(pts[i], pts[i + 1], 0.5),
        pts[i + 1],
      ]);
      const r0 = d.coreRadius * 0.16 * (1 - i / segs) + d.coreRadius * 0.03;
      const r1 = d.coreRadius * 0.16 * (1 - (i + 1) / segs) + d.coreRadius * 0.03;
      seg.add('secondary', taperedTube(curve, (v) => THREE.MathUtils.lerp(r0, r1, v), 6, 8));
      if (i === segs - 1) {
        const bead = blob({ detail: 2, radius: d.coreRadius * 0.10 });
        seg.add('glow', xf(bead, { pos: [pts[segs].x, pts[segs].y, pts[segs].z] }));
      } else if (i % 2 === 0) {
        const bead = blob({ detail: 2, radius: d.coreRadius * 0.09 });
        seg.add('accent', xf(bead, { pos: [pts[i + 1].x, pts[i + 1].y, pts[i + 1].z] }));
      }
      out.push(seg);
      amp.push(0.06 + i * 0.05);
      lag.push(i * 0.5 + sIdx * 0.9);
      parent = seg;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Eyes                                                                */
/* ------------------------------------------------------------------ */

function buildEyes(head: Part, sp: Species, _materials: Record<string, THREE.Material>) {
  const e = sp.shape.eye;
  const hd = sp.shape.head;
  const R = e.radius;

  for (const side of [-1, 1]) {
    const centre = V(side * e.spacing, e.y, e.z);
    const dir = V(Math.sin(e.splay) * side, -0.06, Math.cos(e.splay)).normalize();
    const right = new THREE.Vector3().crossVectors(UP, dir).normalize().multiplyScalar(-1);
    const up = new THREE.Vector3().crossVectors(dir, right).normalize();

    const socket = blob({ detail: 3, radius: 1 });
    socket.scale(R * 1.30, R * 1.24, R * 0.9);
    orientFwd(socket, centre.clone().addScaledVector(dir, -R * 0.22), dir, e.lidTilt * side);
    head.add('dark', socket);

    if (e.mask > 0.05) {
      const mask = blob({ detail: 3, radius: 1, profile: (y) => ({ w: 1 - 0.3 * Math.abs(y) }) });
      mask.scale(R * 0.55, R * 0.62 * (0.6 + e.mask), R * 1.9 * e.mask);
      orientFwd(
        mask,
        centre
          .clone()
          .addScaledVector(dir, -R * 0.9)
          .addScaledVector(right, side * R * 0.7)
          .addScaledVector(up, R * 0.42),
        dir,
        0,
      );
      head.add('dark', mask);
    }

    const sclera = blob({ detail: 3, radius: R });
    sclera.scale(1, 1, 0.92);
    orientFwd(sclera, centre, dir);
    head.add('eyeWhite', sclera);

    const iris = blob({ detail: 3, radius: R * 0.66 });
    iris.scale(1, 1, 0.72);
    orientFwd(iris, centre.clone().addScaledVector(dir, R * 0.52), dir);
    head.add('iris', iris);

    const pupil = blob({ detail: 2, radius: R * 0.36 });
    pupil.scale(1, 1.18, 0.6);
    orientFwd(pupil, centre.clone().addScaledVector(dir, R * 0.72), dir);
    head.add('pupil', pupil);

    const rim = new THREE.TorusGeometry(R * 0.985, R * 0.085, 6, 22);
    orientFwd(rim, centre.clone().addScaledVector(dir, R * 0.1), dir);
    head.add('dark', rim);

    const keyRight = new THREE.Vector3().crossVectors(UP, KEY).normalize();
    const h1 = blob({ detail: 2, radius: R * 0.235 });
    h1.scale(1, 0.86, 0.55);
    orientFwd(
      h1,
      centre.clone().addScaledVector(dir, R * 0.86).addScaledVector(UP, R * 0.34).addScaledVector(keyRight, -R * 0.3),
      dir,
    );
    head.add('hilite', h1);

    const h2 = blob({ detail: 2, radius: R * 0.105 });
    h2.scale(1, 1, 0.5);
    orientFwd(
      h2,
      centre.clone().addScaledVector(dir, R * 0.86).addScaledVector(UP, -R * 0.36).addScaledVector(keyRight, R * 0.3),
      dir,
    );
    head.add('hilite', h2);

    if (e.lid > 0.02) {
      const lid = blob({ detail: 3, radius: 1, profile: (y) => ({ w: 1 - 0.18 * y }) });
      lid.scale(R * 1.30, R * 0.78, R * 1.24);
      const drop = R * (1.0 - e.lid * 1.28);
      const p = centre.clone().addScaledVector(UP, R * 0.78 + drop).addScaledVector(dir, -R * 0.1);
      const g = orientFwd(lid, p, dir, 0);
      const m = new THREE.Matrix4()
        .makeTranslation(centre.x, centre.y, centre.z)
        .multiply(new THREE.Matrix4().makeRotationZ(-e.lidTilt * side))
        .multiply(new THREE.Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z));
      g.applyMatrix4(m);
      head.add('primary', g);
    }

    const low = blob({ detail: 2, radius: 1, profile: (y) => ({ w: 1 - 0.2 * y }) });
    low.scale(R * 1.16, R * 0.5, R * 1.05);
    orientFwd(low, centre.clone().addScaledVector(UP, -R * 1.12).addScaledVector(dir, -R * 0.14), dir);
    head.add('primary', low);
  }

  if (hd.cheek > 0.34 && sp.shape.crouch < 0.6) {
    for (const side of [-1, 1]) {
      const g = blob({ detail: 2, radius: 1 });
      g.scale(hd.radius * 0.16, hd.radius * 0.11, hd.radius * 0.1);
      head.add(
        'accent',
        xf(g, {
          pos: [side * hd.radius * hd.width * 0.72, e.y - e.radius * 1.9, hd.z + hd.radius * hd.depth * 0.66],
        }),
      );
    }
  }
}

/* ------------------------------------------------------------------ */
/* Limbs                                                               */
/* ------------------------------------------------------------------ */

/**
 * A leg. With `pastern` set it is digitigrade: thigh forward, shank back,
 * metatarsus forward again. That zig-zag is most of what separates a bird or
 * a fighter from a creature standing on two pegs.
 */
function buildLimb(
  name: string,
  parent: Part,
  L: LimbShape,
  side: number,
  root0: THREE.Vector3,
  sp: Species,
  lead = 0,
  stance = 0,
): Part {
  const splay = L.splay ?? 0;
  const root = root0.clone().add(V(side * (L.spread + stance), 0, L.forward + lead));
  const part = new Part(name, parent, root);

  const digi = (L.pastern ?? 0) > 1e-4;
  const a1 = digi ? L.bend * 0.55 : L.bend * 0.5;
  const a2 = digi ? L.bend * 0.72 : L.bend * 0.5;
  const a3 = L.bend * 0.30;

  const knee = root.clone().add(
    V(side * (L.spread * 0.06 + Math.sin(splay) * L.upperLength), -L.upperLength * Math.cos(a1), L.upperLength * Math.sin(a1)),
  );
  const hock = knee.clone().add(
    V(side * L.spread * 0.02, -L.lowerLength * Math.cos(a2), -L.lowerLength * Math.sin(a2)),
  );
  const ankle = digi
    ? hock.clone().add(V(0, -(L.pastern ?? 0) * Math.cos(a3), (L.pastern ?? 0) * Math.sin(a3)))
    : hock;

  /*
   * Haunch: the thigh mass over the hip.
   *
   * A plain ellipsoid here reads as a coconut bolted to the body -- a hard
   * sphere silhouette in a contrasting value, floating clear of the barrel.
   * Two things fix it. It is a *teardrop*, narrowing to a point where it
   * meets the hip, so its outline runs into the torso instead of ending in a
   * curve; and it is aligned to the femur rather than to world up, so it
   * follows the leg it belongs to.
   */
  const femur = knee.clone().sub(root);
  const femurLen = Math.max(femur.length(), 1e-4);
  const haunch = blob({
    detail: 3,
    radius: 1,
    profile: (y) => ({
      w: 1 - 0.46 * Math.max(0, y) - 0.22 * Math.max(0, -y),
      d: 1 - 0.38 * Math.max(0, y) - 0.16 * Math.max(0, -y),
    }),
  });
  haunch.scale(L.upperRadius * 1.30, femurLen * (digi ? 0.72 : 0.86), L.upperRadius * 1.62);
  orientUp(
    haunch,
    root.clone().addScaledVector(femur, digi ? 0.30 : 0.34).add(V(side * L.upperRadius * 0.06, 0, 0)),
    femur.clone().negate().normalize(),
  );
  part.add('secondary', haunch);

  part.add(
    'primary',
    taperedTube(
      new THREE.CatmullRomCurve3([root, new THREE.Vector3().lerpVectors(root, knee, 0.5), knee]),
      (u) => THREE.MathUtils.lerp(L.upperRadius, L.lowerRadius * 1.05, u),
      7,
      10,
    ),
  );

  part.add(
    digi ? 'primary' : 'secondary',
    taperedTube(
      new THREE.CatmullRomCurve3([knee, new THREE.Vector3().lerpVectors(knee, hock, 0.5), hock]),
      (u) => THREE.MathUtils.lerp(L.lowerRadius * 1.05, (digi ? L.lowerRadius * 0.6 : L.footRadius * 0.82), u),
      7,
      10,
    ),
  );

  // Dark joint bands. Small, but they are the only near-black on most of the
  // body, and a value anchor is what stops a mid-toned creature going to mud
  // at thumbnail size.
  {
    const kneeBand = new THREE.CylinderGeometry(L.lowerRadius * 1.20, L.lowerRadius * 1.14, L.lowerRadius * 0.70, 12);
    orientUp(kneeBand, knee, knee.clone().sub(root).normalize());
    part.add('dark', kneeBand);
  }

  if (digi) {
    // Hock joint bulge, then the long metatarsus down to the toes.
    const j = blob({ detail: 2, radius: L.lowerRadius * 0.86 });
    part.add('dark', xf(j, { pos: [hock.x, hock.y, hock.z] }));
    part.add(
      'secondary',
      taperedTube(
        new THREE.CatmullRomCurve3([hock, new THREE.Vector3().lerpVectors(hock, ankle, 0.5), ankle]),
        (u) => THREE.MathUtils.lerp(L.lowerRadius * 0.6, L.footRadius * 0.60, u),
        6,
        9,
      ),
    );
  }

  buildFoot(part, ankle, L, side, sp);
  return part;
}

function buildArm(
  name: string,
  parent: Part,
  L: LimbShape,
  side: number,
  shoulder: THREE.Vector3,
  sp: Species,
): { upper: Part; lower: Part } {
  const upper = new Part(name, parent, shoulder);
  const outward = 0.22 + (L.splay ?? 0);

  const elbow = shoulder
    .clone()
    .add(V(side * L.upperLength * Math.sin(outward), -L.upperLength * Math.cos(outward), L.forward * 0.4));
  const wrist = elbow
    .clone()
    .add(
      V(
        side * L.lowerLength * Math.sin(outward * 0.3),
        -L.lowerLength * Math.cos(L.bend * 0.8),
        L.lowerLength * Math.sin(L.bend * 0.8),
      ),
    );

  // Deltoid, same rule as the haunch: a teardrop that runs into the chest
  // rather than a ball sitting beside it.
  const humerus = elbow.clone().sub(shoulder);
  const deltoid = blob({
    detail: 3,
    radius: 1,
    profile: (y) => ({
      w: 1 - 0.40 * Math.max(0, y) - 0.20 * Math.max(0, -y),
      d: 1 - 0.30 * Math.max(0, y) - 0.14 * Math.max(0, -y),
    }),
  });
  deltoid.scale(L.upperRadius * 1.34, Math.max(humerus.length(), 1e-4) * 0.62, L.upperRadius * 1.42);
  orientUp(
    deltoid,
    shoulder.clone().addScaledVector(humerus, 0.24),
    humerus.clone().negate().normalize(),
  );
  upper.add('secondary', deltoid);

  {
    const elbowBand = new THREE.CylinderGeometry(L.lowerRadius * 1.22, L.lowerRadius * 1.16, L.lowerRadius * 0.72, 12);
    orientUp(elbowBand, elbow, elbow.clone().sub(shoulder).normalize());
    upper.add('dark', elbowBand);
  }

  upper.add(
    'primary',
    taperedTube(
      new THREE.CatmullRomCurve3([shoulder, new THREE.Vector3().lerpVectors(shoulder, elbow, 0.5), elbow]),
      (u) => THREE.MathUtils.lerp(L.upperRadius, L.lowerRadius, u),
      7,
      10,
    ),
  );

  const lower = new Part(`${name}_fore`, upper, elbow);
  lower.add(
    'primary',
    taperedTube(
      new THREE.CatmullRomCurve3([elbow, new THREE.Vector3().lerpVectors(elbow, wrist, 0.5), wrist]),
      (u) => THREE.MathUtils.lerp(L.lowerRadius, L.footRadius * 0.8, u),
      7,
      10,
    ),
  );
  buildHand(lower, wrist, L, side, sp);
  return { upper, lower };
}

/**
 * Feet, per topology.
 *
 * A hoof, a talon, a paw and a stub are genuinely different structures, and
 * sharing one foot across a roster is the loudest possible signal that the
 * species came off one base mesh. This is the cheapest place to fix that.
 */
function buildFoot(part: Part, ankle: THREE.Vector3, L: LimbShape, side: number, sp: Species) {
  const kind = L.foot ?? 'paw';
  const groundY = Math.min(ankle.y, L.footRadius * 0.5);

  if (kind === 'hoof') {
    // A cloven hoof: two hard blocks and a dark pastern band. No toes, no
    // pads, nothing soft -- it should read as bone, not as a hand.
    const band = new THREE.CylinderGeometry(L.footRadius * 0.62, L.footRadius * 0.74, L.footRadius * 0.55, 12);
    part.add('dark', xf(band, { pos: [ankle.x, groundY + L.footRadius * 0.72, ankle.z] }));
    for (const sx of [-1, 1]) {
      const toe = blob({ detail: 3, radius: 1, profile: (y) => ({ w: 1 - 0.30 * Math.max(0, y), d: 1 - 0.12 * y }) });
      toe.scale(L.footRadius * 0.42, L.footRadius * 0.60, L.footLength * 0.52);
      part.add(
        'dark',
        xf(toe, {
          pos: [ankle.x + sx * L.footRadius * 0.40, groundY + L.footRadius * 0.30, ankle.z + L.footLength * 0.16],
          rot: [0.12, sx * 0.10, 0],
        }),
      );
      const cap = blob({ detail: 2, radius: 1 });
      cap.scale(L.footRadius * 0.34, L.footRadius * 0.22, L.footLength * 0.24);
      part.add(
        'claw',
        xf(cap, { pos: [ankle.x + sx * L.footRadius * 0.40, groundY + L.footRadius * 0.14, ankle.z + L.footLength * 0.34] }),
      );
    }
    void side;
    void sp;
    return;
  }

  if (kind === 'talon') {
    // Anisodactyl: three long forward toes plus one back. Almost no foot mass
    // between them -- the negative space between the toes is the shape.
    const ankleJoint = blob({ detail: 2, radius: L.footRadius * 0.72 });
    part.add('dark', xf(ankleJoint, { pos: [ankle.x, groundY + L.footRadius * 0.55, ankle.z] }));
    const toes: Array<[number, number]> = [
      [-0.62, 0.92],
      [0.0, 1.0],
      [0.62, 0.92],
      [Math.PI, 0.62],
    ];
    for (const [a, scale] of toes) {
      const len = L.footLength * scale;
      const dir = V(Math.sin(a), -0.22, Math.cos(a)).normalize();
      const start = V(ankle.x, groundY + L.footRadius * 0.42, ankle.z);
      const end = start.clone().addScaledVector(dir, len).setY(groundY * 0.55 + L.footRadius * 0.12);
      const g = taperedTube(
        new THREE.CatmullRomCurve3([start, new THREE.Vector3().lerpVectors(start, end, 0.5).add(V(0, L.footRadius * 0.12, 0)), end]),
        (u) => L.footRadius * (0.36 - 0.14 * u),
        7,
        8,
      );
      part.add('secondary', g);
      // Knuckles, so a toe is a chain of joints and not a smooth worm.
      for (const ku of [0.36, 0.7]) {
        const kp = new THREE.Vector3().lerpVectors(start, end, ku).add(V(0, L.footRadius * 0.10, 0));
        const kb = blob({ detail: 2, radius: L.footRadius * 0.24 });
        part.add('dark', xf(kb, { pos: [kp.x, kp.y, kp.z] }));
      }
      const claw = spike(L.clawLength * 1.5, L.footRadius * 0.20, 1.4, 8, 7);
      orientUp(claw, end, V(dir.x * 0.7, -0.55, dir.z * 0.7).normalize());
      part.add('claw', claw);
    }
    void side;
    void sp;
    return;
  }

  const stub = kind === 'stub';
  const foot = blob({ detail: 3, radius: 1, profile: (y) => ({ w: 1 - 0.2 * Math.max(0, y) }) });
  foot.scale(L.footRadius * (stub ? 1.12 : 1), L.footRadius * 0.62, L.footLength * (stub ? 0.72 : 0.62));
  const centre = V(ankle.x, groundY, ankle.z + L.footLength * 0.22);
  part.add(stub ? 'primary' : 'secondary', xf(foot, { pos: [centre.x, centre.y, centre.z] }));

  const pad = blob({ detail: 2, radius: 1 });
  pad.scale(L.footRadius * 0.72, L.footRadius * 0.3, L.footLength * 0.36);
  part.add('belly', xf(pad, { pos: [centre.x, centre.y - L.footRadius * 0.32, centre.z + L.footLength * 0.1] }));

  if (!stub) {
    // Ankle band: the dark value anchor again, and it separates leg from foot.
    const band = new THREE.CylinderGeometry(L.footRadius * 0.66, L.footRadius * 0.60, L.footRadius * 0.42, 12);
    part.add('dark', xf(band, { pos: [ankle.x, groundY + L.footRadius * 0.72, ankle.z] }));
  }

  const spanA = -0.55;
  for (let i = 0; i < L.digits; i++) {
    const u = L.digits === 1 ? 0.5 : i / (L.digits - 1);
    const a = spanA + u * 1.1;
    const toeLen = L.footLength * 0.34 * (1 - Math.abs(u - 0.5) * 0.34);
    const toe = blob({ detail: 2, radius: 1 });
    toe.scale(L.footRadius * (stub ? 0.36 : 0.3), L.footRadius * 0.3, toeLen * (stub ? 0.8 : 1));
    const tx = centre.x + Math.sin(a) * L.footRadius * 0.62;
    const tz = centre.z + L.footLength * 0.3 + Math.cos(a) * toeLen * 0.3;
    part.add(stub ? 'primary' : 'secondary', xf(toe, { pos: [tx, centre.y - L.footRadius * 0.16, tz] }));

    if (L.clawLength > 0.004) {
      const claw = spike(L.clawLength, L.footRadius * 0.2, 0.9, 6, 6);
      orientUp(
        claw,
        V(tx, centre.y - L.footRadius * 0.16, tz + toeLen * 0.72),
        V(Math.sin(a) * 0.2, -0.18, 1).normalize(),
      );
      part.add('claw', claw);
    }
  }
  void side;
  void sp;
}

function buildHand(part: Part, wrist: THREE.Vector3, L: LimbShape, side: number, sp: Species) {
  const hand = blob({ detail: 3, radius: 1, profile: (y) => ({ w: 1 - 0.18 * Math.abs(y) }) });
  hand.scale(L.footRadius * 0.95, L.footRadius * 1.05, L.footRadius * 0.9);
  const centre = wrist.clone().add(V(0, -L.footRadius * 0.5, L.footLength * 0.12));
  part.add('secondary', xf(hand, { pos: [centre.x, centre.y, centre.z] }));

  for (let i = 0; i < L.digits; i++) {
    const u = L.digits === 1 ? 0.5 : i / (L.digits - 1);
    const a = (-0.5 + u) * 1.15;
    const dir = V(Math.sin(a) * 0.55 * side, -0.72, 0.42).normalize();
    const fingerLen = L.footLength * 0.5;
    const g = taperedTube(
      new THREE.CatmullRomCurve3([
        centre.clone(),
        centre.clone().addScaledVector(dir, fingerLen * 0.55),
        centre.clone().addScaledVector(dir, fingerLen),
      ]),
      (tt) => L.footRadius * 0.3 * (1 - 0.35 * tt),
      5,
      7,
    );
    part.add('primary', g);

    if (L.clawLength > 0.004) {
      const claw = spike(L.clawLength, L.footRadius * 0.22, 0.8, 6, 6);
      orientUp(claw, centre.clone().addScaledVector(dir, fingerLen * 0.98), dir);
      part.add('claw', claw);
    }
  }
  void sp;
}

/* ------------------------------------------------------------------ */
/* Tail tips                                                           */
/* ------------------------------------------------------------------ */

function buildTailTip(
  part: Part,
  tip: THREE.Vector3,
  kind: string,
  tl: { length: number; radius: number },
  sp: Species,
) {
  const back = V(0, 0.25, -1).normalize();
  switch (kind) {
    case 'leaf': {
      for (let i = 0; i < 3; i++) {
        const a = (i - 1) * 0.6;
        const g = leaf(tl.length * 0.42, tl.length * 0.24, tl.radius * 0.5);
        orientUp(g, tip, V(Math.sin(a) * 0.6, 0.55, -0.8).normalize(), 0);
        part.add(i === 1 ? 'primary' : 'accent', g);
      }
      break;
    }
    case 'ember': {
      const bulb = blob({ detail: 3, radius: tl.radius * 1.25 });
      part.add('metal', xf(bulb, { pos: [tip.x, tip.y, tip.z] }));
      for (let i = 0; i < 3; i++) {
        const g = spike(tl.length * (0.34 - i * 0.06), tl.radius * (0.55 - i * 0.1), 0.5, 8, 7);
        orientUp(g, tip.clone().addScaledVector(back, tl.radius * 0.5), V((i - 1) * 0.45, 1, -0.25).normalize());
        part.add('glow', g);
      }
      break;
    }
    case 'paddle':
    case 'fin': {
      const g = splinePlate(
        [
          [0, 0],
          [tl.length * 0.26, tl.length * 0.16],
          [tl.length * 0.34, tl.length * 0.46],
          [0, tl.length * 0.6],
          [-tl.length * 0.34, tl.length * 0.46],
          [-tl.length * 0.26, tl.length * 0.16],
        ],
        tl.radius * 0.55,
      );
      g.rotateX(-Math.PI / 2 + 0.5);
      part.add('accent', xf(g, { pos: [tip.x, tip.y + tl.radius * 0.3, tip.z] }));
      break;
    }
    case 'spark': {
      const core = blob({ detail: 2, radius: tl.radius * 0.9 });
      part.add('glow', xf(core, { pos: [tip.x, tip.y, tip.z] }));
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        const g = spike(tl.length * 0.3, tl.radius * 0.34, 0.2, 6, 5);
        orientUp(g, tip, V(Math.cos(a) * 0.8, Math.sin(a) * 0.8, -0.5).normalize());
        part.add('metal', g);
      }
      break;
    }
    case 'blade': {
      const g = plate(
        [
          [0, 0],
          [tl.radius * 1.5, tl.length * 0.2],
          [0, tl.length * 0.62],
          [-tl.radius * 1.5, tl.length * 0.2],
        ],
        tl.radius * 0.7,
        tl.radius * 0.2,
      );
      g.rotateY(Math.PI / 2);
      g.rotateX(-0.9);
      part.add('metal', xf(g, { pos: [tip.x, tip.y, tip.z] }));
      break;
    }
    default:
      break;
  }
  void sp;
}

/* ------------------------------------------------------------------ */
/* Features                                                            */
/* ------------------------------------------------------------------ */

interface FeatureCtx {
  sp: Species;
  rnd: () => number;
  frame: Frame;
  hips: Part;
  torso: Part;
  chest: Part;
  neck: Part;
  head: Part;
  crest: Part;
  hipY: number;
  torsoY: number;
  torsoTop: number;
  chestY: number;
  headAbs: THREE.Vector3;
  headFrontZ: number;
  tailParts: Part[];
}

function buildFeature(
  f: Feature,
  c: FeatureCtx,
  earL: Part,
  earR: Part,
): { wings?: [Part, Part]; ears?: [Part, Part] } | void {
  const s = c.sp.shape;
  const hd = s.head;
  const t = s.torso;
  const fr = c.frame;

  switch (f.kind) {
    case 'leafCrest': {
      for (let i = 0; i < f.count; i++) {
        const u = f.count === 1 ? 0.5 : i / (f.count - 1);
        const a = (u - 0.5) * f.spread * 2;
        const len = f.length * (1 - Math.abs(u - 0.5) * 0.42);
        const g = leaf(len, f.width * (1 - Math.abs(u - 0.5) * 0.3), hd.radius * 0.06);
        const dir = V(Math.sin(a), Math.cos(a) * 1.0, Math.sin(f.pitch)).normalize();
        orientUp(g, V(0, hd.y + hd.radius * 0.72, hd.z - hd.radius * 0.06), dir, Math.PI / 2);
        c.crest.add(i === Math.floor(f.count / 2) ? 'primary' : 'secondary', g);

        const stem = taperedTube(
          new THREE.CatmullRomCurve3([
            V(0, hd.y + hd.radius * 0.4, hd.z - hd.radius * 0.06),
            V(0, hd.y + hd.radius * 0.62, hd.z - hd.radius * 0.06),
            V(0, hd.y + hd.radius * 0.78, hd.z - hd.radius * 0.06).addScaledVector(dir, len * 0.1),
          ]),
          (u2) => hd.radius * 0.075 * (1 - 0.4 * u2),
          5,
          7,
        );
        c.crest.add('secondary', stem);
      }
      break;
    }

    case 'longEars': {
      const l = new Part('earL', c.head, V(-hd.radius * hd.width * 0.82, hd.y + hd.radius * 0.3, hd.z));
      const r = new Part('earR', c.head, V(hd.radius * hd.width * 0.82, hd.y + hd.radius * 0.3, hd.z));
      for (const [part, side] of [
        [l, -1],
        [r, 1],
      ] as Array<[Part, number]>) {
        const base = part.abs.clone();
        const dir = V(side * 0.72, 1 - f.droop * 0.9, -f.back).normalize();
        const g = leaf(f.length, f.width, hd.radius * 0.055);
        orientUp(g, base, dir, Math.PI / 2);
        part.add('primary', g);
        const inner = leaf(f.length * 0.72, f.width * 0.55, hd.radius * 0.02);
        orientUp(inner, base.clone().addScaledVector(dir, f.length * 0.06), dir, Math.PI / 2);
        inner.translate(0, 0, side * 0.001);
        part.add('accent', inner);
      }
      return { ears: [l, r] };
    }

    case 'roundEars': {
      const l = new Part('earL', c.head, V(-hd.radius * hd.width * 0.68, hd.y + hd.radius * f.height, hd.z - hd.radius * 0.08));
      const r = new Part('earR', c.head, V(hd.radius * hd.width * 0.68, hd.y + hd.radius * f.height, hd.z - hd.radius * 0.08));
      for (const [part, side] of [
        [l, -1],
        [r, 1],
      ] as Array<[Part, number]>) {
        const base = part.abs.clone();
        const dir = V(side * Math.sin(f.splay), Math.cos(f.splay), -0.1).normalize();
        const shell = blob({ detail: 3, radius: 1, profile: (y) => ({ w: 1 - 0.16 * y }) });
        shell.scale(f.radius, f.radius * 1.15, f.radius * 0.42);
        orientUp(shell, base.clone().addScaledVector(dir, f.radius * 0.7), dir);
        part.add('primary', shell);
        const innerG = blob({ detail: 2, radius: 1 });
        innerG.scale(f.radius * 0.6, f.radius * 0.75, f.radius * 0.3);
        orientUp(innerG, base.clone().addScaledVector(dir, f.radius * 0.78), dir);
        innerG.translate(0, 0, 0.004);
        part.add('accent', innerG);
      }
      return { ears: [l, r] };
    }

    case 'finEars': {
      // Swept membrane fins off the back of the skull -- the aquatic and
      // storm answer to an ear, and a wide horizontal break in the silhouette.
      const l = new Part('earL', c.head, V(-hd.radius * hd.width * 0.72, hd.y + hd.radius * 0.18, hd.z - hd.radius * 0.35));
      const r = new Part('earR', c.head, V(hd.radius * hd.width * 0.72, hd.y + hd.radius * 0.18, hd.z - hd.radius * 0.35));
      for (const [part, side] of [
        [l, -1],
        [r, 1],
      ] as Array<[Part, number]>) {
        const base = part.abs.clone();
        const dir = V(side * Math.sin(f.splay), Math.cos(f.splay) * 0.55 + 0.2, -0.55).normalize();
        const g = splinePlate(
          [
            [0, 0],
            [f.width * 0.5, f.length * 0.30],
            [f.width * 0.34, f.length * 0.72],
            [0, f.length],
            [-f.width * 0.42, f.length * 0.55],
            [-f.width * 0.36, f.length * 0.12],
          ],
          hd.radius * 0.05,
        );
        orientUp(g, base, dir, side * Math.PI * 0.5);
        part.add('accent', g);
        // Ribs, so the fin reads as a fin and not a paddle.
        for (let i = 0; i < 3; i++) {
          const rib = spike(f.length * (0.85 - i * 0.16), hd.radius * 0.030, 0.2, 6, 5);
          const rd = dir.clone().add(V(side * (i - 1) * 0.18, 0, 0)).normalize();
          orientUp(rib, base, rd);
          part.add('secondary', rib);
        }
      }
      return { ears: [l, r] };
    }

    case 'antlers': {
      for (const side of [-1, 1]) {
        const base = V(side * hd.radius * f.spread, hd.y + hd.radius * 0.62, hd.z - hd.radius * 0.12);
        const dir = V(side * 0.5, 1, -0.28).normalize();
        const main = spike(f.length, hd.radius * 0.11, 0.5, 12, 8);
        orientUp(main, base, dir);
        c.crest.add('claw', main);
        for (let i = 1; i <= f.tines; i++) {
          const u = i / (f.tines + 1);
          const at = base.clone().addScaledVector(dir, f.length * u * 0.92);
          const tdir = V(side * (0.5 + u * 0.5), 0.8, -0.2 + u * 0.5).normalize();
          const tine = spike(f.length * (0.5 - u * 0.16), hd.radius * 0.055, 0.6, 8, 6);
          orientUp(tine, at, tdir);
          c.crest.add('claw', tine);
        }
        const capG = new THREE.CylinderGeometry(hd.radius * 0.075, hd.radius * 0.085, hd.radius * 0.13, 10);
        orientUp(capG, base.clone().addScaledVector(dir, f.length * 0.32), dir);
        c.crest.add('metal', capG);
      }
      break;
    }

    case 'horns': {
      for (const side of [-1, 1]) {
        const base = V(side * f.spread, hd.y + hd.radius * 0.58, hd.z - hd.radius * 0.2);
        const dir = V(side * 0.34, Math.cos(f.pitch), Math.sin(f.pitch)).normalize();
        const g = spike(f.length, f.radius, f.bend, 10, 8);
        orientUp(g, base, dir);
        c.crest.add('metal', g);
      }
      break;
    }

    case 'stacks': {
      for (let i = 0; i < f.count; i++) {
        const side = f.count === 1 ? 0 : (i / (f.count - 1)) * 2 - 1;
        const base = fr.at(0.62).clone().addScaledVector(fr.dorsal, t.radius * 0.5).add(V(side * f.spread, 0, 0));
        const dir = V(side * 0.22, 1, -Math.sin(f.lean)).normalize();
        const g = pipe(f.radius, f.height, 1.4, 12);
        orientUp(g, base, dir);
        c.torso.add('metal', g);

        const mouthG = new THREE.CircleGeometry(f.radius * 1.3, 12);
        mouthG.rotateX(-Math.PI / 2);
        orientUp(mouthG, base.clone().addScaledVector(dir, f.height * 0.97), dir);
        c.torso.add('glow', mouthG);
      }
      break;
    }

    case 'quills': {
      for (let row = 0; row < f.rows; row++) {
        const v = f.rows === 1 ? 0.5 : row / (f.rows - 1);
        for (let i = 0; i < f.perRow; i++) {
          const u = f.perRow === 1 ? 0.5 : i / (f.perRow - 1);
          const a = (u - 0.5) * f.spread * 2;
          const len = f.length * (0.62 + 0.38 * Math.sin(Math.PI * v)) * (1 - Math.abs(u - 0.5) * 0.5);
          const base = fr
            .at(0.55 - v * 1.0)
            .clone()
            .addScaledVector(fr.dorsal, t.radius * (0.6 + v * 0.3))
            .add(V(Math.sin(a) * t.radius * 0.95, 0, 0));
          const dir = V(Math.sin(a) * 0.85, 0.75 - v * 0.35, -0.45 - v * 0.45).normalize();
          const g = spike(len, t.radius * 0.075 * (1 - v * 0.25), 0.18, 8, 6);
          orientUp(g, base, dir);
          c.torso.add(row % 2 === 0 ? 'metal' : 'dark', g);
        }
      }
      break;
    }

    case 'dorsalSail': {
      const pts: Array<[number, number]> = [];
      const n = 18;
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        const z = THREE.MathUtils.lerp(f.start, f.end, u);
        const h = Math.sin(Math.pow(u, 0.85) * Math.PI) * f.height;
        pts.push([z, h]);
      }
      for (let i = n; i >= 0; i--) {
        const u = i / n;
        pts.push([THREE.MathUtils.lerp(f.start, f.end, u), 0]);
      }
      const g = plate(pts, t.radius * 0.14, t.radius * 0.045);
      g.rotateY(Math.PI / 2);
      c.torso.add('accent', xf(g, { pos: [0, c.torsoY + t.height * 0.72, 0] }));
      for (let i = 1; i < 5; i++) {
        const u = i / 5;
        const z = THREE.MathUtils.lerp(f.start, f.end, u);
        const h = Math.sin(Math.pow(u, 0.85) * Math.PI) * f.height;
        const rib = new THREE.CylinderGeometry(t.radius * 0.035, t.radius * 0.045, h, 7);
        c.torso.add('secondary', xf(rib, { pos: [0, c.torsoY + t.height * 0.72 + h * 0.5, z] }));
      }
      break;
    }

    case 'wings': {
      /*
       * A wing, not a fan of blades.
       *
       * The failure mode of a procedural wing is a pincushion: N feather
       * shapes radiating from one point, daylight between every pair, no
       * membrane. What makes a wing read is the *armature* -- humerus,
       * elbow, wrist, then fingers fanning back -- with one continuous
       * surface stretched between the fingers and scalloped where it hangs
       * between them.
       *
       * So the whole wing is authored flat, in its own plane: X runs span-
       * wise from shoulder to tip, Y runs chordwise with the leading edge
       * near 0 and the trailing edge at -chord. Then the plane is placed
       * into the body's frame. Authoring in 3D directly is what produced
       * the blade-fan; in 2D the outline is simply drawable.
       */
      const S = f.span;
      const C = f.chord;
      const shoulder = fr.at(t.shoulderY - 0.34).clone().addScaledVector(fr.dorsal, t.radius * 0.58);
      const l = new Part('wingL', c.chest, V(-t.radius * 0.62, shoulder.y, shoulder.z));
      const r = new Part('wingR', c.chest, V(t.radius * 0.62, shoulder.y, shoulder.z));

      for (const [part, side] of [
        [l, -1],
        [r, 1],
      ] as Array<[Part, number]>) {
        const base = part.abs.clone();
        // Wing plane. Spanwise goes out and up; chordwise-up goes up and
        // forward, so -Y (the membrane) falls back and down. The plane
        // therefore faces forward-outward and presents its full area to a
        // three-quarter view instead of turning edge-on.
        const spanAxis = V(side * 0.74, 0.56, -0.38).normalize();
        let upAxis = V(side * -0.16, 0.46, 0.87).normalize();
        upAxis = upAxis.sub(spanAxis.clone().multiplyScalar(upAxis.dot(spanAxis))).normalize();
        const faceN = new THREE.Vector3().crossVectors(spanAxis, upAxis);
        const at = (u: number, v: number) =>
          base.clone().addScaledVector(spanAxis, u).addScaledVector(upAxis, v);

        // --- armature ---------------------------------------------------
        const root: [number, number] = [0, 0];
        const elbow: [number, number] = [0.34 * S, 0.10 * S];
        const wrist: [number, number] = [0.70 * S, 0.15 * S];
        const tip: [number, number] = [1.0 * S, 0.05 * S];
        // Finger tips, outermost first. The hand carries most of them; a
        // final strut runs from the elbow and closes the inner membrane.
        const tips: Array<[number, number]> = [];
        const nf = Math.max(3, Math.min(5, f.fingers));
        for (let i = 0; i < nf - 1; i++) {
          const u = i / (nf - 2);
          tips.push([
            THREE.MathUtils.lerp(0.99, 0.60, Math.pow(u, 0.86)) * S,
            THREE.MathUtils.lerp(-0.30, -1.04, Math.sin(u * 1.24)) * C - f.droop * S * u,
          ]);
        }
        const innerTip: [number, number] = [0.34 * S, -0.98 * C - f.droop * S];
        const heel: [number, number] = [0.015 * S, -0.44 * C];

        // --- membrane ---------------------------------------------------
        // Leading edge out to the tip, then home along the trailing edge,
        // dipping toward the hub between each pair of finger tips so the
        // edge scallops instead of running straight.
        const outline: Array<[number, number]> = [
          root,
          [elbow[0], elbow[1] + 0.012 * S],
          [wrist[0], wrist[1] + 0.010 * S],
          tip,
        ];
        const scallop = (a: [number, number], b: [number, number], hub: [number, number], k: number) => {
          const mx = (a[0] + b[0]) * 0.5;
          const my = (a[1] + b[1]) * 0.5;
          return [hub[0] + (mx - hub[0]) * k, hub[1] + (my - hub[1]) * k] as [number, number];
        };
        outline.push(tips[0]);
        for (let i = 1; i < tips.length; i++) {
          outline.push(scallop(tips[i - 1], tips[i], wrist, 0.80));
          outline.push(tips[i]);
        }
        outline.push(scallop(tips[tips.length - 1], innerTip, elbow, 0.82));
        outline.push(innerTip);
        outline.push(scallop(innerTip, heel, [elbow[0] * 0.4, elbow[1]], 0.86));
        outline.push(heel);

        const skinG = splinePlate(outline, C * 0.055, C * 0.020);
        orientBasis(skinG, base, spanAxis, upAxis);
        part.add('secondary', skinG);

        // A lighter inner panel: the wing is not one flat colour, and the
        // value break is what gives it depth at thumbnail size.
        const innerPanel: Array<[number, number]> = [
          [0.03 * S, -0.02 * C],
          [elbow[0], elbow[1] * 0.5],
          [wrist[0] * 0.94, wrist[1] * 0.36],
          [wrist[0] * 0.86, -0.42 * C],
          [elbow[0] * 0.92, -0.66 * C],
          [0.05 * S, -0.34 * C],
        ];
        const panelG = splinePlate(innerPanel, C * 0.075, C * 0.026);
        orientBasis(panelG, base.clone().addScaledVector(faceN, C * 0.030), spanAxis, upAxis);
        part.add('belly', panelG);

        // --- bones ------------------------------------------------------
        const boneTube = (a: [number, number], b: [number, number], r0: number, r1: number) => {
          const pa = at(a[0], a[1]);
          const pb = at(b[0], b[1]);
          const mid = pa.clone().lerp(pb, 0.5);
          return taperedTube(
            new THREE.CatmullRomCurve3([pa, mid, pb]),
            (u) => THREE.MathUtils.lerp(r0, r1, u),
            8,
            8,
          );
        };
        part.add('primary', boneTube(root, elbow, C * 0.155, C * 0.115));
        part.add('primary', boneTube(elbow, wrist, C * 0.115, C * 0.085));
        part.add('primary', boneTube(wrist, tip, C * 0.085, C * 0.030));
        for (let i = 0; i < tips.length; i++) {
          part.add('primary', boneTube(wrist, tips[i], C * 0.070, C * 0.020));
        }
        part.add('primary', boneTube(elbow, innerTip, C * 0.078, C * 0.022));

        // --- graphic edge -----------------------------------------------
        // A dark band chasing the trailing edge, offset a hair proud of the
        // membrane. This is the single thing that makes a wing readable
        // against a bright sky at range.
        for (let i = 0; i < tips.length - 1; i++) {
          const a = tips[i];
          const b = tips[i + 1];
          const sc = scallop(a, b, wrist, 0.80);
          const inset = (p: [number, number], k: number) =>
            [wrist[0] + (p[0] - wrist[0]) * k, wrist[1] + (p[1] - wrist[1]) * k] as [number, number];
          const bandG = splinePlate(
            [a, sc, b, inset(b, 0.86), inset(sc, 0.84), inset(a, 0.86)],
            C * 0.075,
            C * 0.024,
          );
          orientBasis(bandG, base.clone().addScaledVector(faceN, C * 0.008), spanAxis, upAxis);
          part.add(i === 0 ? 'accent' : 'dark', bandG);
        }

        // --- hardware ---------------------------------------------------
        if (f.plated) {
          for (const [p, rad] of [
            [elbow, C * 0.20],
            [wrist, C * 0.165],
          ] as Array<[[number, number], number]>) {
            const g = cog(rad, 9, C * 0.085, 0.24, 0.34);
            orientBasis(g, at(p[0], p[1]), spanAxis, upAxis);
            part.add('metal', g);
          }
          // Wrist claw -- the thumb. Small, but it says "this is a hand".
          const claw = spike(C * 0.34, C * 0.055, 0.5, 8, 7);
          const clawDir = spanAxis.clone().multiplyScalar(0.55).addScaledVector(upAxis, 0.83).normalize();
          orientUp(claw, at(wrist[0], wrist[1] + 0.02 * S), clawDir);
          part.add('claw', claw);
          // Leading-edge armour strakes.
          for (const u of [0.16, 0.48, 0.82]) {
            const px = THREE.MathUtils.lerp(root[0], wrist[0], u);
            const py = THREE.MathUtils.lerp(root[1], wrist[1], u) + 0.012 * S;
            const g = plate(
              [
                [-C * 0.10, 0],
                [C * 0.10, 0],
                [C * 0.055, C * 0.15],
                [-C * 0.075, C * 0.13],
              ],
              C * 0.055,
              C * 0.018,
            );
            g.rotateZ(-Math.PI / 2);
            orientBasis(g, at(px, py), spanAxis, upAxis);
            part.add('metal', g);
          }
        }
      }
      return { wings: [l, r] };
    }

    case 'shoulderCogs': {
      const at = fr.at(t.shoulderY + 0.16);
      for (const side of [-1, 1]) {
        const g = cog(f.radius, f.teeth, f.radius * 0.28, 0.22, 0.32);
        g.rotateY(Math.PI / 2);
        c.chest.add(
          'metal',
          xf(g, {
            pos: [side * (t.radius * t.shoulderX + f.radius * 0.1), at.y, at.z - t.radius * 0.1],
            rot: [0, 0, side * 0.2],
          }),
        );
      }
      break;
    }

    case 'chestPlate': {
      const at = fr.at(t.shoulderY - 0.05).clone().addScaledVector(fr.ventral, t.radius * t.depth * 0.85);
      const g = blob({
        detail: 3,
        radius: 1,
        profile: (y) => ({ w: 1 - 0.24 * Math.abs(y) - 0.16 * Math.max(0, y) }),
      });
      g.scale(f.width, f.height, t.radius * 0.34);
      pitchAbout(g, fr.pitch + t.lean, V(0, 0, 0));
      g.translate(at.x, at.y, at.z);
      c.torso.add(f.grate ? 'metal' : 'belly', g);
      if (f.grate) {
        for (let i = 0; i < 4; i++) {
          const off = (i - 1.5) * f.height * 0.34;
          const p = at.clone().addScaledVector(fr.axis, off).addScaledVector(fr.ventral, t.radius * 0.1);
          const bar = new THREE.BoxGeometry(f.width * 1.24, f.height * 0.14, t.radius * 0.2);
          pitchAbout(bar, fr.pitch, V(0, 0, 0));
          c.torso.add('dark', xf(bar, { pos: [p.x, p.y, p.z] }));
          const emitter = new THREE.BoxGeometry(f.width * 1.05, f.height * 0.11, t.radius * 0.16);
          const pe = p.clone().addScaledVector(fr.axis, f.height * 0.17).addScaledVector(fr.ventral, t.radius * 0.03);
          c.torso.add('glow', xf(emitter, { pos: [pe.x, pe.y, pe.z] }));
        }
      }
      break;
    }

    case 'mane': {
      for (let i = 0; i < f.count; i++) {
        const u = f.count === 1 ? 0.5 : i / (f.count - 1);
        const a = (u - 0.5) * Math.PI * f.spread;
        const ring = fr.at(t.shoulderY + 0.22);
        const base = V(
          Math.sin(a) * t.radius * 0.8,
          ring.y + Math.cos(a) * fr.dorsal.y * t.radius * t.depth * 0.55,
          ring.z + Math.cos(a) * fr.dorsal.z * t.radius * t.depth * 0.55,
        );
        const dir = V(Math.sin(a) * 0.9, 0.55, -Math.cos(a) * 0.75).normalize();
        const g = spike(f.length * (0.7 + 0.3 * Math.cos(a)), t.radius * 0.115, 0.4, 7, 6);
        orientUp(g, base, dir);
        c.chest.add(i % 2 === 0 ? 'secondary' : 'primary', g);
      }
      break;
    }

    case 'backPlates': {
      for (let i = 0; i < f.count; i++) {
        const u = i / (f.count - 1 || 1);
        const along = THREE.MathUtils.lerp(0.88, -0.65, u);
        const size = f.size * (1 - Math.abs(u - 0.25) * 0.5);
        const p = fr.at(along).clone().addScaledVector(fr.dorsal, t.radius * (0.55 + u * 0.28) * t.depth);
        const g = plate(
          [
            [0, 0],
            [size * 0.6, size * 0.5],
            [0, size],
            [-size * 0.6, size * 0.5],
          ],
          size * 0.28,
          size * 0.08,
        );
        g.rotateY(Math.PI / 2);
        c.torso.add('metal', xf(g, { pos: [p.x, p.y, p.z], rot: [-0.5 + u * 0.6, 0, 0] }));
      }
      break;
    }

    case 'collar': {
      const g = new THREE.TorusGeometry(f.radius, f.tube, 8, 20);
      g.rotateX(Math.PI / 2);
      const y = THREE.MathUtils.lerp(c.chestY, c.headAbs.y - hd.radius * 0.6, 0.55);
      const z = THREE.MathUtils.lerp(fr.chest.z, c.headAbs.z, 0.55);
      c.neck.add('metal', xf(g, { pos: [0, y, z], rot: [0.3, 0, 0] }));
      const stud = blob({ detail: 2, radius: f.tube * 1.9 });
      c.neck.add('accent', xf(stud, { pos: [0, y - f.tube * 0.4, z + f.radius * 0.95] }));
      break;
    }

    case 'cheekVents': {
      for (const side of [-1, 1]) {
        for (let i = 0; i < f.count; i++) {
          const g = new THREE.CylinderGeometry(f.radius, f.radius, hd.radius * 0.06, 8);
          g.rotateZ(Math.PI / 2);
          c.head.add(
            'metal',
            xf(g, {
              pos: [
                side * hd.radius * hd.width * 0.9,
                hd.y - hd.radius * (0.1 + i * 0.24),
                hd.z + hd.radius * hd.depth * (0.32 - i * 0.2),
              ],
            }),
          );
        }
      }
      break;
    }

    case 'brandMark': {
      const at = fr.at(t.shoulderY + 0.1).clone().addScaledVector(fr.ventral, t.radius * t.depth * 1.02);
      const g = cog(f.radius, 8, f.radius * 0.34, 0.26, 0.36);
      c.torso.add('accent', xf(g, { pos: [at.x, at.y, at.z], rot: [-0.2 + fr.pitch * 0.5, 0, 0] }));
      break;
    }

    case 'bracers': {
      // Heavy brass cuffs at the wrists. On a brawler they are the visual
      // weight that makes the arms read as weapons.
      if (!s.arms) break;
      const arms = s.arms;
      const shoulderY = fr.chest.y + t.height * 0.10;
      const outward = 0.22 + (arms.splay ?? 0);
      for (const side of [-1, 1]) {
        const shoulder = V(side * t.radius * t.shoulderX, shoulderY, fr.chest.z);
        const elbow = shoulder
          .clone()
          .add(V(side * arms.upperLength * Math.sin(outward), -arms.upperLength * Math.cos(outward), arms.forward * 0.4));
        const wrist = elbow
          .clone()
          .add(
            V(
              side * arms.lowerLength * Math.sin(outward * 0.3),
              -arms.lowerLength * Math.cos(arms.bend * 0.8),
              arms.lowerLength * Math.sin(arms.bend * 0.8),
            ),
          );
        const dir = wrist.clone().sub(elbow).normalize();
        const g = new THREE.CylinderGeometry(f.radius, f.radius * 1.12, f.width, 14);
        orientUp(g, wrist.clone().addScaledVector(dir, -f.width * 0.55), dir);
        c.chest.add('metal', g);
        for (let i = 0; i < 3; i++) {
          const a = (i - 1) * 0.9;
          const stud = spike(f.radius * 0.9, f.radius * 0.26, 0.1, 6, 6);
          const sd = V(Math.sin(a) * side, 0.1, Math.cos(a)).normalize();
          orientUp(stud, wrist.clone().addScaledVector(dir, -f.width * 0.55).addScaledVector(sd, f.radius * 0.9), sd);
          c.chest.add('claw', stud);
        }
      }
      break;
    }

    case 'pectoralFins': {
      // Fins riding the serpent's body a fixed distance down the chain.
      const sr = s.serpent;
      if (!sr || !c.tailParts.length) break;
      const curve = serpentCurve(c.sp);
      const p = curve.getPointAt(f.at);
      const tan = curve.getTangentAt(f.at);
      const idx = Math.min(c.tailParts.length - 1, Math.floor(f.at * sr.segments));
      const host = c.tailParts[idx];
      for (const side of [-1, 1]) {
        const out = new THREE.Vector3().crossVectors(tan, UP).normalize().multiplyScalar(side);
        const dir = out.clone().addScaledVector(UP, 0.30).addScaledVector(tan, -0.35).normalize();
        const g = splinePlate(
          [
            [0, 0],
            [f.width * 0.5, f.length * 0.32],
            [f.width * 0.30, f.length * 0.78],
            [0, f.length],
            [-f.width * 0.5, f.length * 0.55],
            [-f.width * 0.45, f.length * 0.14],
          ],
          sr.radius * 0.1,
        );
        orientPlane(g, p.clone().addScaledVector(out, serpentRadius(c.sp, f.at) * 0.72), dir, tan.clone());
        host.add('accent', g);
        for (let i = 0; i < 3; i++) {
          const rib = spike(f.length * (0.8 - i * 0.15), sr.radius * 0.05, 0.2, 6, 5);
          const rd = dir.clone().addScaledVector(tan, (i - 1) * 0.22).normalize();
          orientUp(rib, p.clone().addScaledVector(out, serpentRadius(c.sp, f.at) * 0.72), rd);
          host.add('secondary', rib);
        }
      }
      break;
    }
  }

  void earL;
  void earR;
  void c.rnd;
  void c.hips;
}
