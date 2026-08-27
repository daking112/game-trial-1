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
 * Everything is authored in a *unit space* where the creature is 1.0 tall,
 * and every piece of geometry is positioned in absolute unit coordinates.
 * That is the trick that keeps this readable: a leaf on the crest is placed
 * at "just above the head", not at "0.31 up and 0.02 back from the neck
 * joint, in the neck's rotated frame". At the end the whole thing is
 * measured, floored to y=0 and scaled to the species' real height.
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
  legL: THREE.Group;
  legR: THREE.Group;
  tail: THREE.Group[];
  wingL: THREE.Group | null;
  wingR: THREE.Group | null;
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

const gauss = (x: number, c: number, w: number) => Math.exp(-(((x - c) / w) ** 2));

/* ------------------------------------------------------------------ */
/* Materials                                                           */
/* ------------------------------------------------------------------ */

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

  const skin = (colour: string, repeat = 3, rough = 0.62) => {
    const t = tiled(repeat);
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(colour),
      map: t.map,
      normalMap: t.normalMap,
      normalScale: new THREE.Vector2(0.5, 0.5),
      roughness: rough,
      metalness: 0.0,
      envMapIntensity: 0.85,
    });
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

  const materials: Record<string, THREE.Material> = {
    primary: skin(pal.primary, 3, 0.6),
    secondary: skin(pal.secondary, 3, 0.66),
    belly: skin(pal.belly, 3, 0.55),
    accent: skin(pal.accent, 4, 0.5),
    dark: skin(pal.dark, 4, 0.5),
    metal: new THREE.MeshStandardMaterial({
      color: new THREE.Color(pal.metal),
      map: hideTextures('plate', 11).map.clone(),
      roughness: 0.32,
      metalness: 0.92,
      envMapIntensity: 1.25,
    }),
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

  /* --- anchors, all in unit space -------------------------------- */
  const t = s.torso;
  const hd = s.head;
  const hipY = t.hipY;
  const torsoY = hipY + t.height;
  const torsoTop = hipY + t.height * 2;
  const chestY = hipY + t.height * (1 + t.shoulderY);
  const headAbs = new THREE.Vector3(0, hd.y, hd.z);
  const chestAbs = new THREE.Vector3(0, chestY, t.radius * t.depth * 0.12);
  const neckAbs = new THREE.Vector3().lerpVectors(chestAbs, headAbs, 0.62);

  /* --- rig -------------------------------------------------------- */
  const bob = new Part('bob', scaler, new THREE.Vector3(0, 0, 0));
  const hips = new Part('hips', bob, new THREE.Vector3(0, hipY, 0));
  const torso = new Part('torso', hips, new THREE.Vector3(0, torsoY, 0));
  const chest = new Part('chest', torso, chestAbs);
  const neck = new Part('neck', chest, neckAbs);
  const head = new Part('head', neck, headAbs);
  const jawPivot = new THREE.Vector3(0, hd.y - hd.radius * 0.42, hd.z - hd.radius * hd.depth * 0.3);
  const jaw = new Part('jaw', head, jawPivot);
  const crest = new Part('crest', head, new THREE.Vector3(0, hd.y + hd.radius * 0.7, hd.z));

  /* --- torso ------------------------------------------------------ */
  {
    const bodyProfile = (y: number) => ({
      w: 1 + t.belly * gauss(y, -0.32, 0.62) + t.chest * gauss(y, 0.42, 0.55) - 0.16 * gauss(y, 1.0, 0.5),
      d: (1 + t.belly * 0.72 * gauss(y, -0.25, 0.7) + t.chest * 0.5 * gauss(y, 0.35, 0.6)) * t.depth,
      dz: t.belly * t.radius * 0.16 * gauss(y, -0.35, 0.7) + t.chest * t.radius * 0.22 * gauss(y, 0.42, 0.5),
    });
    const g = blob({ detail: 4, radius: t.radius, scaleY: t.height / t.radius, profile: bodyProfile });
    // Lean the whole torso about the hip so the pose is baked into the mesh
    // and the rig nodes can stay axis-aligned at rest.
    leanAboutHip(g, t.lean, hipY);
    torso.add('primary', xf(g, { pos: [0, torsoY, 0] }));

    // Darker saddle over the back and haunches: the second colour block.
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
    leanAboutHip(saddle, t.lean, hipY);
    torso.add('secondary', xf(saddle, { pos: [0, torsoY, 0] }));

    // Belly patch: a lens pressed through the front of the torso. Proud of
    // the surface at the centre, buried at the edges, so it crops itself.
    const bellyGeo = blob({
      detail: 3,
      radius: t.radius * 0.74,
      scaleY: (t.height * 1.02) / (t.radius * 0.74),
      profile: (y) => ({ w: 1 - 0.18 * Math.abs(y), d: 0.5 }),
    });
    leanAboutHip(bellyGeo, t.lean, hipY);
    torso.add(
      'belly',
      xf(bellyGeo, { pos: [0, torsoY - t.height * 0.12, t.radius * t.depth * 0.62 + t.chest * t.radius * 0.13] }),
    );
  }

  /* --- neck ------------------------------------------------------- */
  {
    const a = new THREE.Vector3(0, chestY + t.height * 0.1, chestAbs.z);
    const b = headAbs.clone().add(new THREE.Vector3(0, -hd.radius * 0.55, -hd.radius * hd.depth * 0.15));
    const mid = new THREE.Vector3().lerpVectors(a, b, 0.5).add(new THREE.Vector3(0, 0, -t.radius * 0.06));
    const curve = new THREE.CatmullRomCurve3([a, mid, b]);
    const rBase = t.radius * 0.56;
    const rTop = hd.radius * 0.62;
    const g = taperedTube(curve, (u) => THREE.MathUtils.lerp(rBase, rTop, u * u * 0.8 + u * 0.2), 12, 12);
    neck.add('primary', g);
  }

  /* --- head ------------------------------------------------------- */
  const headFrontZ = hd.z + hd.radius * hd.depth;
  {
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

    // Brow ridge: one wide wedge across both eyes. Reads as a scowl or a
    // soft forehead depending on `brow`, and it is what stops the head from
    // looking like a ball with dots on it.
    if (hd.brow > 0.1) {
      const bw = hd.radius * hd.width * 0.86;
      const brow = blob({
        detail: 3,
        radius: 1,
        profile: (y) => ({ w: 1 - 0.1 * y, d: 1 }),
      });
      brow.scale(bw, hd.radius * 0.20 * (0.6 + hd.brow), hd.radius * hd.depth * 0.46);
      head.add(
        'primary',
        xf(brow, {
          pos: [0, s.eye.y + s.eye.radius * (0.62 + hd.brow * 0.2), hd.z + hd.radius * hd.depth * 0.52],
          rot: [-0.26 - hd.brow * 0.2, 0, 0],
        }),
      );
    }

    // Snout / beak.
    if (hd.snout) {
      const sn = hd.snout;
      const base = new THREE.Vector3(0, hd.y - hd.radius * 0.14, hd.z + hd.radius * hd.depth * 0.24);
      const tip = new THREE.Vector3(0, base.y - sn.drop, headFrontZ + sn.length);
      const mid = new THREE.Vector3().lerpVectors(base, tip, 0.55).add(new THREE.Vector3(0, sn.drop * 0.28, 0));
      const curve = new THREE.CatmullRomCurve3([base, mid, tip]);
      const g = taperedTube(
        curve,
        (u) => THREE.MathUtils.lerp(sn.radius, sn.tipRadius, Math.pow(u, 0.7)) * (1 - 0.12 * Math.sin(u * Math.PI)),
        14,
        12,
      );
      head.add(sn.keel > 0.5 ? 'accent' : 'belly', g);

      if (sn.keel > 0.35) {
        // Hard keel along the top of a beak.
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

      // Nostrils.
      const nostril = blob({ detail: 2, radius: sn.tipRadius * 0.24 });
      for (const sx of [-1, 1]) {
        head.add(
          'dark',
          xf(nostril.clone(), {
            pos: [sx * sn.tipRadius * 0.52, tip.y + sn.tipRadius * 0.42, tip.z - sn.tipRadius * 0.5],
            scale: [1, 0.7, 1.1],
          }),
        );
      }
      nostril.dispose();

      // Mouth line: a dark wedge under the muzzle, plus the lower jaw.
      const mouthW = sn.radius * 1.62;
      const mouth = blob({ detail: 3, radius: 1, profile: (y) => ({ w: 1 - 0.2 * y * y }) });
      mouth.scale(mouthW, sn.radius * 0.30, sn.length * 0.92 + hd.radius * 0.16);
      jaw.add(
        'mouth',
        xf(mouth, { pos: [0, base.y - sn.radius * 0.62, (base.z + tip.z) * 0.5], rot: [-sn.drop * 0.6, 0, 0] }),
      );

      const chin = blob({
        detail: 3,
        radius: 1,
        profile: (y) => ({ w: 1 - 0.28 * Math.max(0, y), d: 1 - 0.2 * Math.max(0, y) }),
      });
      chin.scale(mouthW * 1.02, sn.radius * 0.52, (sn.length + hd.radius * 0.3) * 0.62);
      jaw.add(
        'belly',
        xf(chin, {
          pos: [0, base.y - sn.radius * 0.92, (base.z + tip.z) * 0.5 - sn.length * 0.06],
          rot: [-sn.drop * 0.5, 0, 0],
        }),
      );

      // Fangs poke down over the mouth line -- pure silhouette detail.
      for (let i = 0; i < s.fangs; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const k = Math.floor(i / 2);
        const g = spike(sn.radius * (0.62 - k * 0.16), sn.radius * (0.2 - k * 0.04), -0.4, 6, 6);
        g.rotateX(Math.PI);
        head.add(
          'claw',
          xf(g, {
            pos: [
              side * sn.radius * (0.78 - k * 0.14),
              base.y - sn.radius * 0.52,
              tip.z - sn.length * (0.18 + k * 0.34),
            ],
          }),
        );
      }
    }

    buildEyes(head, sp, materials);
  }

  /* --- limbs ------------------------------------------------------ */
  const legL = buildLimb('legL', hips, s.legs, -1, hipY, 'leg', sp);
  const legR = buildLimb('legR', hips, s.legs, 1, hipY, 'leg', sp);

  let armL: Part | null = null;
  let armR: Part | null = null;
  let foreL: Part | null = null;
  let foreR: Part | null = null;
  if (s.arms) {
    const shoulderY = chestY + t.height * 0.08;
    const shoulderX = t.radius * t.shoulderX;
    const shoulderZ = chestAbs.z + t.radius * t.depth * 0.1;
    const l = buildArm('armL', chest, s.arms, -1, new THREE.Vector3(-shoulderX, shoulderY, shoulderZ), sp);
    const r = buildArm('armR', chest, s.arms, 1, new THREE.Vector3(shoulderX, shoulderY, shoulderZ), sp);
    armL = l.upper;
    armR = r.upper;
    foreL = l.lower;
    foreR = r.lower;
  }

  /* --- tail ------------------------------------------------------- */
  const tailParts: Part[] = [];
  if (s.tail) {
    const tl = s.tail;
    const start = new THREE.Vector3(0, torsoY + t.height * 0.15, -t.radius * t.depth * 0.72);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= tl.segments; i++) {
      const u = i / tl.segments;
      pts.push(
        new THREE.Vector3(
          start.x + tl.sweep * tl.length * u * u,
          start.y + tl.rise * tl.length * Math.sin(u * Math.PI * 0.72) - tl.length * 0.14 * u * u,
          start.z - tl.length * (u * 0.82 + 0.18 * u * u),
        ),
      );
    }
    let parent: Part | THREE.Object3D = hips;
    for (let i = 0; i < tl.segments; i++) {
      const seg: Part = new Part(`tail${i}`, parent as Part, pts[i]);
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
      tailParts.push(seg);
      parent = seg;
    }
    buildTailTip(tailParts[tailParts.length - 1], pts[tl.segments], tl.tip, tl, sp);
  }

  /* --- features --------------------------------------------------- */
  const featureCtx: FeatureCtx = {
    sp,
    rnd,
    hips,
    torso,
    chest,
    neck,
    head,
    crest,
    hipY,
    torsoY,
    torsoTop,
    chestY,
    headAbs,
    headFrontZ,
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

  /* --- bake ------------------------------------------------------- */
  const parts = [
    bob, hips, torso, chest, neck, head, jaw, crest, earL, earR,
    legL, legR, ...tailParts,
  ];
  if (armL) parts.push(armL);
  if (armR) parts.push(armR);
  if (foreL) parts.push(foreL);
  if (foreR) parts.push(foreR);
  if (wingL) parts.push(wingL);
  if (wingR) parts.push(wingR);
  collectParts(scaler, parts);
  for (const p of parts) p.nb.bake(materials, geometries);

  /* --- floor and scale -------------------------------------------- */
  scaler.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scaler);
  const measured = box.max.y - box.min.y;
  const k = measured > 1e-4 ? s.height / measured : s.height;
  scaler.scale.setScalar(k);
  scaler.position.y = -box.min.y * k;
  scaler.updateMatrixWorld(true);

  const rig: CreatureRig = {
    root: group,
    bob: bob.object,
    hips: hips.object,
    torso: torso.object,
    chest: chest.object,
    neck: neck.object,
    head: head.object,
    jaw: jaw.object,
    earL: earL.object,
    earR: earR.object,
    crest: crest.object,
    armL: armL?.object ?? null,
    armR: armR?.object ?? null,
    foreL: foreL?.object ?? null,
    foreR: foreR?.object ?? null,
    legL: legL.object,
    legR: legR.object,
    tail: tailParts.map((p) => p.object),
    wingL: wingL?.object ?? null,
    wingR: wingR?.object ?? null,
  };

  return {
    group,
    rig,
    materials: Object.values(materials),
    geometries,
    height: s.height,
    glowMaterials,
  };
}

/** Any part whose parent chain was never attached lands on the scaler. */
function collectParts(scaler: THREE.Group, parts: Part[]) {
  for (const p of parts) if (!p.object.parent) scaler.add(p.object);
}

function leanAboutHip(geo: THREE.BufferGeometry, lean: number, hipY: number) {
  geo.translate(0, -0, 0);
  const m = new THREE.Matrix4()
    .makeTranslation(0, hipY, 0)
    .multiply(new THREE.Matrix4().makeRotationX(lean))
    .multiply(new THREE.Matrix4().makeTranslation(0, -hipY, 0));
  geo.applyMatrix4(m);
}

/* ------------------------------------------------------------------ */
/* Eyes                                                                */
/* ------------------------------------------------------------------ */

function buildEyes(head: Part, sp: Species, _materials: Record<string, THREE.Material>) {
  const e = sp.shape.eye;
  const hd = sp.shape.head;
  const R = e.radius;

  for (const side of [-1, 1]) {
    const centre = new THREE.Vector3(side * e.spacing, e.y, e.z);
    const dir = new THREE.Vector3(Math.sin(e.splay) * side, -0.06, Math.cos(e.splay)).normalize();
    const right = new THREE.Vector3().crossVectors(UP, dir).normalize().multiplyScalar(-1);
    const up = new THREE.Vector3().crossVectors(dir, right).normalize();

    // Dark socket behind the eye: gives every eye a hard outline against the
    // hide, which is the difference between "eye" and "bead glued on".
    const socket = blob({ detail: 3, radius: 1 });
    socket.scale(R * 1.30, R * 1.24, R * 0.9);
    orientFwd(socket, centre.clone().addScaledVector(dir, -R * 0.22), dir, e.lidTilt * side);
    head.add('dark', socket);

    if (e.mask > 0.05) {
      // Mask stripe sweeping back from the eye toward the ear.
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

    // Rim: a dark ring around the eyeball equator. Cheap, and it is what
    // makes the eye read as a graphic shape rather than a shaded ball.
    const rim = new THREE.TorusGeometry(R * 0.985, R * 0.085, 6, 22);
    orientFwd(rim, centre.clone().addScaledVector(dir, R * 0.1), dir);
    head.add('dark', rim);

    // Specular highlights, placed against the key light, not the camera.
    const keyRight = new THREE.Vector3().crossVectors(UP, KEY).normalize();
    const h1 = blob({ detail: 2, radius: R * 0.235 });
    h1.scale(1, 0.86, 0.55);
    const h1p = centre
      .clone()
      .addScaledVector(dir, R * 0.86)
      .addScaledVector(UP, R * 0.34)
      .addScaledVector(keyRight, -R * 0.3);
    orientFwd(h1, h1p, dir);
    head.add('hilite', h1);

    const h2 = blob({ detail: 2, radius: R * 0.105 });
    h2.scale(1, 1, 0.5);
    const h2p = centre
      .clone()
      .addScaledVector(dir, R * 0.86)
      .addScaledVector(UP, -R * 0.36)
      .addScaledVector(keyRight, R * 0.3);
    orientFwd(h2, h2p, dir);
    head.add('hilite', h2);

    // Upper lid: an eyelid bulge in hide colour that crops the sclera.
    if (e.lid > 0.02) {
      const lid = blob({ detail: 3, radius: 1, profile: (y) => ({ w: 1 - 0.18 * y }) });
      lid.scale(R * 1.30, R * 0.78, R * 1.24);
      const drop = R * (1.0 - e.lid * 1.28);
      const p = centre
        .clone()
        .addScaledVector(UP, R * 0.78 + drop)
        .addScaledVector(dir, -R * 0.1);
      const g = orientFwd(lid, p, dir, 0);
      // Tilt the lid line: positive rolls the inner corner up = fierce.
      const m = new THREE.Matrix4()
        .makeTranslation(centre.x, centre.y, centre.z)
        .multiply(new THREE.Matrix4().makeRotationZ(-e.lidTilt * side))
        .multiply(new THREE.Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z));
      g.applyMatrix4(m);
      head.add('primary', g);
    }

    // Lower lid, always light: a thin sliver that seats the eye in the face.
    const low = blob({ detail: 2, radius: 1, profile: (y) => ({ w: 1 - 0.2 * y }) });
    low.scale(R * 1.16, R * 0.5, R * 1.05);
    orientFwd(low, centre.clone().addScaledVector(UP, -R * 1.12).addScaledVector(dir, -R * 0.14), dir);
    head.add('primary', low);
  }

  // Cheek blush marks give the face a third read at distance.
  if (hd.cheek > 0.34 && sp.shape.crouch < 0.6) {
    for (const side of [-1, 1]) {
      const g = blob({ detail: 2, radius: 1 });
      g.scale(hd.radius * 0.16, hd.radius * 0.11, hd.radius * 0.1);
      head.add(
        'accent',
        xf(g, {
          pos: [
            side * hd.radius * hd.width * 0.72,
            e.y - e.radius * 1.9,
            hd.z + hd.radius * hd.depth * 0.66,
          ],
        }),
      );
    }
  }
}

/* ------------------------------------------------------------------ */
/* Limbs                                                               */
/* ------------------------------------------------------------------ */

function buildLimb(
  name: string,
  parent: Part,
  L: LimbShape,
  side: number,
  hipY: number,
  kind: 'leg',
  sp: Species,
): Part {
  const root = new THREE.Vector3(side * L.spread, hipY, L.forward);
  const part = new Part(name, parent, root);

  const half = L.bend * 0.5;
  const knee = root
    .clone()
    .add(new THREE.Vector3(side * L.spread * 0.06, -L.upperLength * Math.cos(half), L.upperLength * Math.sin(half)));
  const ankle = knee
    .clone()
    .add(new THREE.Vector3(side * L.spread * 0.02, -L.lowerLength * Math.cos(half), -L.lowerLength * Math.sin(half)));

  // Haunch: a big mass over the hip. Skinny legs on a round body read as
  // sticks; the haunch is what makes the stance look like it carries weight.
  const haunch = blob({ detail: 3, radius: 1 });
  haunch.scale(L.upperRadius * 1.5, L.upperLength * 0.95, L.upperRadius * 1.9);
  part.add(
    'secondary',
    xf(haunch, { pos: [root.x + side * L.upperRadius * 0.15, root.y - L.upperLength * 0.28, root.z] }),
  );

  const thigh = taperedTube(
    new THREE.CatmullRomCurve3([root, new THREE.Vector3().lerpVectors(root, knee, 0.5), knee]),
    (u) => THREE.MathUtils.lerp(L.upperRadius, L.lowerRadius * 1.05, u),
    6,
    10,
  );
  part.add('primary', thigh);

  const shin = taperedTube(
    new THREE.CatmullRomCurve3([knee, new THREE.Vector3().lerpVectors(knee, ankle, 0.5), ankle]),
    (u) => THREE.MathUtils.lerp(L.lowerRadius * 1.05, L.footRadius * 0.82, u),
    6,
    10,
  );
  part.add(kind === 'leg' ? 'secondary' : 'primary', shin);

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

  const outward = 0.30;
  const elbow = shoulder
    .clone()
    .add(
      new THREE.Vector3(
        side * L.upperLength * Math.sin(outward),
        -L.upperLength * Math.cos(outward),
        L.forward * 0.4,
      ),
    );
  const wrist = elbow
    .clone()
    .add(
      new THREE.Vector3(
        side * L.lowerLength * Math.sin(outward * 0.3),
        -L.lowerLength * Math.cos(L.bend * 0.8),
        L.lowerLength * Math.sin(L.bend * 0.8),
      ),
    );

  const deltoid = blob({ detail: 3, radius: 1 });
  deltoid.scale(L.upperRadius * 1.42, L.upperRadius * 1.5, L.upperRadius * 1.42);
  upper.add('secondary', xf(deltoid, { pos: [shoulder.x, shoulder.y, shoulder.z] }));

  upper.add(
    'primary',
    taperedTube(
      new THREE.CatmullRomCurve3([shoulder, new THREE.Vector3().lerpVectors(shoulder, elbow, 0.5), elbow]),
      (u) => THREE.MathUtils.lerp(L.upperRadius, L.lowerRadius, u),
      6,
      10,
    ),
  );

  const lower = new Part(`${name}_fore`, upper, elbow);
  lower.add(
    'primary',
    taperedTube(
      new THREE.CatmullRomCurve3([elbow, new THREE.Vector3().lerpVectors(elbow, wrist, 0.5), wrist]),
      (u) => THREE.MathUtils.lerp(L.lowerRadius, L.footRadius * 0.8, u),
      6,
      10,
    ),
  );
  buildHand(lower, wrist, L, side, sp);
  return { upper, lower };
}

function buildFoot(part: Part, ankle: THREE.Vector3, L: LimbShape, side: number, sp: Species) {
  const foot = blob({
    detail: 3,
    radius: 1,
    profile: (y) => ({ w: 1 - 0.2 * Math.max(0, y) }),
  });
  foot.scale(L.footRadius, L.footRadius * 0.62, L.footLength * 0.62);
  const centre = new THREE.Vector3(ankle.x, L.footRadius * 0.5, ankle.z + L.footLength * 0.22);
  part.add('secondary', xf(foot, { pos: [centre.x, centre.y, centre.z] }));

  const pad = blob({ detail: 2, radius: 1 });
  pad.scale(L.footRadius * 0.72, L.footRadius * 0.3, L.footLength * 0.36);
  part.add('belly', xf(pad, { pos: [centre.x, L.footRadius * 0.18, centre.z + L.footLength * 0.1] }));

  const spanA = -0.55;
  for (let i = 0; i < L.digits; i++) {
    const u = L.digits === 1 ? 0.5 : i / (L.digits - 1);
    const a = spanA + u * 1.1;
    const toeLen = L.footLength * 0.34 * (1 - Math.abs(u - 0.5) * 0.34);
    const toe = blob({ detail: 2, radius: 1 });
    toe.scale(L.footRadius * 0.3, L.footRadius * 0.3, toeLen);
    const tx = centre.x + Math.sin(a) * L.footRadius * 0.62;
    const tz = centre.z + L.footLength * 0.3 + Math.cos(a) * toeLen * 0.3;
    part.add('secondary', xf(toe, { pos: [tx, L.footRadius * 0.34, tz] }));

    if (L.clawLength > 0.004) {
      const claw = spike(L.clawLength, L.footRadius * 0.2, 0.9, 6, 6);
      orientUp(
        claw,
        new THREE.Vector3(tx, L.footRadius * 0.34, tz + toeLen * 0.72),
        new THREE.Vector3(Math.sin(a) * 0.2, -0.18, 1).normalize(),
      );
      part.add('claw', claw);
    }
  }
  void side;
  void sp;
}

function buildHand(part: Part, wrist: THREE.Vector3, L: LimbShape, side: number, sp: Species) {
  const hand = blob({ detail: 3, radius: 1, profile: (y) => ({ w: 1 - 0.18 * Math.abs(y) }) });
  hand.scale(L.footRadius * 0.9, L.footRadius, L.footRadius * 0.86);
  const centre = wrist.clone().add(new THREE.Vector3(0, -L.footRadius * 0.5, L.footLength * 0.12));
  part.add('secondary', xf(hand, { pos: [centre.x, centre.y, centre.z] }));

  for (let i = 0; i < L.digits; i++) {
    const u = L.digits === 1 ? 0.5 : i / (L.digits - 1);
    const a = (-0.5 + u) * 1.15;
    const dir = new THREE.Vector3(Math.sin(a) * 0.55 * side, -0.72, 0.42).normalize();
    const fingerLen = L.footLength * 0.5;
    const g = taperedTube(
      new THREE.CatmullRomCurve3([
        centre.clone(),
        centre.clone().addScaledVector(dir, fingerLen * 0.55),
        centre.clone().addScaledVector(dir, fingerLen),
      ]),
      (t) => L.footRadius * 0.3 * (1 - 0.35 * t),
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
  const back = new THREE.Vector3(0, 0.25, -1).normalize();
  switch (kind) {
    case 'leaf': {
      for (let i = 0; i < 3; i++) {
        const a = (i - 1) * 0.6;
        const g = leaf(tl.length * 0.42, tl.length * 0.24, tl.radius * 0.5);
        orientUp(g, tip, new THREE.Vector3(Math.sin(a) * 0.6, 0.55, -0.8).normalize(), 0);
        part.add(i === 1 ? 'primary' : 'accent', g);
      }
      break;
    }
    case 'ember': {
      const bulb = blob({ detail: 3, radius: tl.radius * 1.25 });
      part.add('metal', xf(bulb, { pos: [tip.x, tip.y, tip.z] }));
      for (let i = 0; i < 3; i++) {
        const g = spike(tl.length * (0.34 - i * 0.06), tl.radius * (0.55 - i * 0.1), 0.5, 8, 7);
        orientUp(
          g,
          tip.clone().addScaledVector(back, tl.radius * 0.5),
          new THREE.Vector3((i - 1) * 0.45, 1, -0.25).normalize(),
        );
        part.add('glow', g);
      }
      break;
    }
    case 'paddle': {
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
        orientUp(g, tip, new THREE.Vector3(Math.cos(a) * 0.8, Math.sin(a) * 0.8, -0.5).normalize());
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

  switch (f.kind) {
    case 'leafCrest': {
      for (let i = 0; i < f.count; i++) {
        const u = f.count === 1 ? 0.5 : i / (f.count - 1);
        const a = (u - 0.5) * f.spread * 2;
        const len = f.length * (1 - Math.abs(u - 0.5) * 0.42);
        const g = leaf(len, f.width * (1 - Math.abs(u - 0.5) * 0.3), hd.radius * 0.06);
        const dir = new THREE.Vector3(Math.sin(a), Math.cos(a) * 1.0, Math.sin(f.pitch)).normalize();
        orientUp(g, new THREE.Vector3(0, hd.y + hd.radius * 0.72, hd.z - hd.radius * 0.06), dir, Math.PI / 2);
        c.crest.add(i === Math.floor(f.count / 2) ? 'primary' : 'secondary', g);

        // Stem, so the leaves do not float free of the skull.
        const stem = taperedTube(
          new THREE.CatmullRomCurve3([
            new THREE.Vector3(0, hd.y + hd.radius * 0.4, hd.z - hd.radius * 0.06),
            new THREE.Vector3(0, hd.y + hd.radius * 0.62, hd.z - hd.radius * 0.06),
            new THREE.Vector3(0, hd.y + hd.radius * 0.78, hd.z - hd.radius * 0.06).addScaledVector(dir, len * 0.1),
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
      const l = new Part('earL', c.head, new THREE.Vector3(-hd.radius * hd.width * 0.82, hd.y + hd.radius * 0.3, hd.z));
      const r = new Part('earR', c.head, new THREE.Vector3(hd.radius * hd.width * 0.82, hd.y + hd.radius * 0.3, hd.z));
      for (const [part, side] of [
        [l, -1],
        [r, 1],
      ] as Array<[Part, number]>) {
        const base = part.abs.clone();
        const dir = new THREE.Vector3(side * 0.72, 1 - f.droop * 0.9, -f.back).normalize();
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
      const l = new Part('earL', c.head, new THREE.Vector3(-hd.radius * hd.width * 0.68, hd.y + hd.radius * f.height, hd.z - hd.radius * 0.08));
      const r = new Part('earR', c.head, new THREE.Vector3(hd.radius * hd.width * 0.68, hd.y + hd.radius * f.height, hd.z - hd.radius * 0.08));
      for (const [part, side] of [
        [l, -1],
        [r, 1],
      ] as Array<[Part, number]>) {
        const base = part.abs.clone();
        const dir = new THREE.Vector3(side * Math.sin(f.splay), Math.cos(f.splay), -0.1).normalize();
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

    case 'antlers': {
      for (const side of [-1, 1]) {
        const base = new THREE.Vector3(side * hd.radius * f.spread, hd.y + hd.radius * 0.62, hd.z - hd.radius * 0.12);
        const dir = new THREE.Vector3(side * 0.5, 1, -0.28).normalize();
        const main = spike(f.length, hd.radius * 0.11, 0.5, 12, 8);
        orientUp(main, base, dir);
        c.crest.add('claw', main);
        for (let i = 1; i <= f.tines; i++) {
          const u = i / (f.tines + 1);
          const at = base.clone().addScaledVector(dir, f.length * u * 0.92);
          const tdir = new THREE.Vector3(side * (0.5 + u * 0.5), 0.8, -0.2 + u * 0.5).normalize();
          const tine = spike(f.length * (0.5 - u * 0.16), hd.radius * 0.055, 0.6, 8, 6);
          orientUp(tine, at, tdir);
          c.crest.add('claw', tine);
        }
        // Brass cap where the Thicket has grown into the antler.
        const capG = new THREE.CylinderGeometry(hd.radius * 0.075, hd.radius * 0.085, hd.radius * 0.13, 10);
        orientUp(capG, base.clone().addScaledVector(dir, f.length * 0.32), dir);
        c.crest.add('metal', capG);
      }
      break;
    }

    case 'horns': {
      for (const side of [-1, 1]) {
        const base = new THREE.Vector3(side * f.spread, hd.y + hd.radius * 0.58, hd.z - hd.radius * 0.2);
        const dir = new THREE.Vector3(side * 0.34, Math.cos(f.pitch), Math.sin(f.pitch)).normalize();
        const g = spike(f.length, f.radius, f.bend, 10, 8);
        orientUp(g, base, dir);
        c.crest.add('metal', g);
      }
      break;
    }

    case 'stacks': {
      for (let i = 0; i < f.count; i++) {
        const side = f.count === 1 ? 0 : (i / (f.count - 1)) * 2 - 1;
        const base = new THREE.Vector3(
          side * f.spread,
          c.torsoTop - t.height * 0.3,
          -t.radius * t.depth * 0.42,
        );
        const dir = new THREE.Vector3(side * 0.22, 1, -Math.sin(f.lean)).normalize();
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
          const base = new THREE.Vector3(
            Math.sin(a) * t.radius * 0.95,
            c.torsoY + t.height * (0.55 - v * 0.5),
            -t.radius * t.depth * (0.1 + v * 0.95) + Math.cos(a) * t.radius * 0.1,
          );
          const dir = new THREE.Vector3(Math.sin(a) * 0.85, 0.75 - v * 0.35, -0.45 - v * 0.45).normalize();
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
      // Ribs across the sail.
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
      const shoulderY = c.chestY + t.height * 0.25;
      const l = new Part('wingL', c.chest, new THREE.Vector3(-t.radius * 0.72, shoulderY, -t.radius * t.depth * 0.5));
      const r = new Part('wingR', c.chest, new THREE.Vector3(t.radius * 0.72, shoulderY, -t.radius * t.depth * 0.5));
      for (const [part, side] of [
        [l, -1],
        [r, 1],
      ] as Array<[Part, number]>) {
        const base = part.abs.clone();
        // Feathers as a graded fan of plates. A membrane would read soft;
        // hard plates keep the Iron identity in the silhouette.
        for (let i = 0; i < f.fingers + 2; i++) {
          const u = i / (f.fingers + 1);
          const a = THREE.MathUtils.lerp(1.15, -0.35, u);
          const len = f.span * (0.55 + 0.45 * Math.sin(Math.PI * (0.25 + u * 0.6)));
          const w = f.chord * (0.30 - u * 0.1);
          const dir = new THREE.Vector3(side * Math.cos(a), Math.sin(a) - f.droop * u, -0.18 - u * 0.5).normalize();
          const g = splinePlate(
            [
              [0, 0],
              [w * 0.55, len * 0.2],
              [w * 0.5, len * 0.72],
              [0, len],
              [-w * 0.42, len * 0.6],
              [-w * 0.45, len * 0.16],
            ],
            len * 0.045,
          );
          orientUp(g, base.clone().addScaledVector(dir, f.span * 0.06), dir, side * Math.PI * 0.5);
          part.add(i % 2 === 0 ? 'primary' : 'secondary', g);

          const tipG = splinePlate(
            [
              [0, len * 0.72],
              [w * 0.42, len * 0.78],
              [0, len],
              [-w * 0.36, len * 0.76],
            ],
            len * 0.05,
          );
          orientUp(tipG, base.clone().addScaledVector(dir, f.span * 0.06), dir, side * Math.PI * 0.5);
          part.add('accent', tipG);
        }
        if (f.plated) {
          const joint = cog(f.chord * 0.28, 8, f.chord * 0.1, 0.24, 0.34);
          joint.rotateY(Math.PI / 2);
          part.add('metal', xf(joint, { pos: [base.x + side * f.chord * 0.06, base.y, base.z] }));
        }
      }
      return { wings: [l, r] };
    }

    case 'shoulderCogs': {
      for (const side of [-1, 1]) {
        const g = cog(f.radius, f.teeth, f.radius * 0.28, 0.22, 0.32);
        g.rotateY(Math.PI / 2);
        c.chest.add(
          'metal',
          xf(g, {
            pos: [side * (t.radius * t.shoulderX + f.radius * 0.1), c.chestY + t.height * 0.16, -t.radius * 0.1],
            rot: [0, 0, side * 0.2],
          }),
        );
      }
      break;
    }

    case 'chestPlate': {
      const g = blob({
        detail: 3,
        radius: 1,
        profile: (y) => ({ w: 1 - 0.24 * Math.abs(y) - 0.16 * Math.max(0, y) }),
      });
      g.scale(f.width, f.height, t.radius * 0.34);
      leanAboutHip(g, t.lean, c.hipY - c.chestY + t.height * 0.1);
      c.torso.add(
        f.grate ? 'metal' : 'belly',
        xf(g, { pos: [0, c.chestY - t.height * 0.05, t.radius * t.depth * 0.85 + t.chest * t.radius * 0.16] }),
      );
      if (f.grate) {
        for (let i = 0; i < 4; i++) {
          const y = c.chestY - t.height * 0.05 + (i - 1.5) * f.height * 0.34;
          const bar = new THREE.BoxGeometry(f.width * 1.24, f.height * 0.14, t.radius * 0.2);
          c.torso.add('dark', xf(bar, { pos: [0, y, t.radius * t.depth * 0.95 + t.chest * t.radius * 0.16] }));
          const emitter = new THREE.BoxGeometry(f.width * 1.1, f.height * 0.12, t.radius * 0.16);
          c.torso.add(
            'glow',
            xf(emitter, {
              pos: [0, y + f.height * 0.17, t.radius * t.depth * 0.93 + t.chest * t.radius * 0.16],
            }),
          );
        }
      }
      break;
    }

    case 'mane': {
      for (let i = 0; i < f.count; i++) {
        const u = f.count === 1 ? 0.5 : i / (f.count - 1);
        const a = (u - 0.5) * Math.PI * f.spread;
        const base = new THREE.Vector3(
          Math.sin(a) * t.radius * 0.8,
          c.chestY + t.height * 0.22,
          -Math.cos(a) * t.radius * t.depth * 0.55 + t.radius * 0.1,
        );
        const dir = new THREE.Vector3(Math.sin(a) * 0.9, 0.55, -Math.cos(a) * 0.75).normalize();
        const g = spike(f.length * (0.7 + 0.3 * Math.cos(a)), t.radius * 0.115, 0.4, 7, 6);
        orientUp(g, base, dir);
        c.chest.add(i % 2 === 0 ? 'secondary' : 'primary', g);
      }
      break;
    }

    case 'backPlates': {
      for (let i = 0; i < f.count; i++) {
        const u = i / (f.count - 1 || 1);
        const y = THREE.MathUtils.lerp(c.torsoTop - t.height * 0.12, c.hipY + t.height * 0.35, u);
        const z = -t.radius * t.depth * (0.55 + u * 0.28);
        const size = f.size * (1 - Math.abs(u - 0.25) * 0.5);
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
        c.torso.add('metal', xf(g, { pos: [0, y, z], rot: [-0.5 + u * 0.6, 0, 0] }));
      }
      break;
    }

    case 'collar': {
      const g = new THREE.TorusGeometry(f.radius, f.tube, 8, 20);
      g.rotateX(Math.PI / 2);
      const y = THREE.MathUtils.lerp(c.chestY, c.headAbs.y - hd.radius * 0.6, 0.55);
      c.neck.add('metal', xf(g, { pos: [0, y, c.headAbs.z * 0.4], rot: [0.3, 0, 0] }));
      const stud = blob({ detail: 2, radius: f.tube * 1.9 });
      c.neck.add('accent', xf(stud, { pos: [0, y - f.tube * 0.4, c.headAbs.z * 0.4 + f.radius * 0.95] }));
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
      const g = cog(f.radius, 8, f.radius * 0.34, 0.26, 0.36);
      c.torso.add(
        'accent',
        xf(g, { pos: [0, c.chestY + t.height * 0.1, t.radius * t.depth * 1.02 + t.chest * t.radius * 0.16], rot: [-0.2, 0, 0] }),
      );
      break;
    }
  }

  void earL;
  void earR;
  void c.rnd;
  void c.hips;
}
