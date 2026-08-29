import * as THREE from 'three';
import { createSky, type SkyHandle } from './Sky';
import { configureAerialPerspective } from './AerialPerspective';
import { configureCloudShadow } from './CloudShadow';

export interface EnvironmentOptions {
  /** Sun azimuth/elevation in degrees. Overrides the art-directed default. */
  sunAzimuth?: number;
  sunElevation?: number;
  /** Opt out of the art-directed time of day and honour the options above. */
  useCallerSun?: boolean;
}

/**
 * The time of day, owned in one place.
 *
 * Late afternoon rather than noon. A high sun puts a strong N.L on every
 * upward face at once, which is exactly what removes form: the terrain, the
 * canopy and the road all take the same value and the frame flattens into a
 * green field with a brown line through it. Dropping the key to ~26 degrees
 * costs some raw brightness and buys three things back:
 *
 *  - shadows two to three times longer, so every tree stamps its own silhouette
 *    onto the ground and the eye gets a free readout of the terrain's shape;
 *  - a real light/shade split across every rounded form, warm on the key side
 *    and cool from the sky on the other, which is what makes shapes look solid;
 *  - a warm key against a cool ambient, so colour — not just value — separates
 *    lit from unlit.
 *
 * The fill is the other half of that. A single directional plus hemisphere
 * leaves the anti-key side of every trunk and rock reading as a flat silhouette;
 * a dim cool bounce from the opposite quarter puts a terminator back in.
 */
const ART = {
  // Near due-west. The bearing matters as much as the elevation: at 156 the
  // shadows fell away from the play camera and hid behind their own casters, so
  // the low sun bought nothing. Raking across the frame instead, every tree
  // lays a shadow the player can actually see, and those shadows are a free
  // read-out of the ground's shape and of what is standing on it.
  azimuth: 194,
  elevation: 30,
  keyColor: '#ffe2ba',
  keyIntensity: 5.4,
  fillColor: '#a6cbf0',
  fillIntensity: 0.75,
  hemiSky: '#cde6ff',
  hemiGround: '#63713f',
  hemiIntensity: 1.0,
};

export class Environment {
  readonly group = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  /** Cool bounce from the anti-key quarter. No shadow: it is a fill, not a key. */
  readonly fill: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly sky: THREE.Mesh;

  private readonly skyHandle: SkyHandle;
  private readonly sunDir: THREE.Vector3;

  constructor(scene: THREE.Scene, opts: EnvironmentOptions = {}) {
    const useCaller = opts.useCallerSun === true;
    const azimuth = THREE.MathUtils.degToRad(
      useCaller ? (opts.sunAzimuth ?? ART.azimuth) : ART.azimuth,
    );
    const elevation = THREE.MathUtils.degToRad(
      useCaller ? (opts.sunElevation ?? ART.elevation) : ART.elevation,
    );

    this.sunDir = new THREE.Vector3(
      Math.cos(elevation) * Math.cos(azimuth),
      Math.sin(elevation),
      Math.cos(elevation) * Math.sin(azimuth),
    ).normalize();

    /* --------------------------------------------------------------- sky */
    // The dome must comfortably enclose the terrain apron *and* stay inside the
    // camera's far plane. When it does not, the far corners of the ground mesh
    // punch through it and read as dark slabs hanging in the sky.
    this.skyHandle = createSky({
      radius: 430,
      sunDir: this.sunDir,
      topColor: '#2769c2',
      midColor: '#8ac6ee',
      horizonColor: '#cfe4f1',
      horizonWarm: '#f7e2b2',
      groundColor: '#a9bdd6',
      sunColor: '#ffd9a2',
      cloudLit: '#fff8ec',
      cloudDark: '#9db2cd',
      cover: 0.505,
      scale: 0.58,
    });
    this.sky = this.skyHandle.mesh;
    this.group.add(this.sky);

    // Ground materials compile the cloud-shadow field in as constants, so the
    // rig has to be published before the first of them is built.
    configureCloudShadow({
      sunDir: this.sunDir,
      deckY: 90,
      scale: 0.0165,
      cover: 0.505,
      strength: 0.19,
    });

    /* ------------------------------------------------------------ lights */
    this.sun = new THREE.DirectionalLight(ART.keyColor, ART.keyIntensity);
    this.sun.position.copy(this.sunDir).multiplyScalar(130);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 40;
    this.sun.shadow.camera.far = 260;
    // A low sun throws long shadows, so the frustum has to be wide enough to
    // hold the caster *and* everything its shadow lands on. Too tight and trees
    // near the edge of the map stop casting the moment the sun drops.
    this.sun.shadow.camera.left = -66;
    this.sun.shadow.camera.right = 66;
    this.sun.shadow.camera.top = 66;
    this.sun.shadow.camera.bottom = -66;
    this.sun.shadow.bias = -0.0007;
    this.sun.shadow.normalBias = 0.028;
    this.sun.shadow.radius = 2.4;
    this.group.add(this.sun);
    this.group.add(this.sun.target);

    this.fill = new THREE.DirectionalLight(ART.fillColor, ART.fillIntensity);
    this.fill.position.set(-this.sunDir.x, 0.42, -this.sunDir.z).multiplyScalar(60);
    this.fill.castShadow = false;
    this.group.add(this.fill);
    this.group.add(this.fill.target);

    this.hemi = new THREE.HemisphereLight(ART.hemiSky, ART.hemiGround, ART.hemiIntensity);
    this.group.add(this.hemi);

    scene.add(this.group);

    /* -------------------------------------------------------- atmosphere */
    const haze = configureAerialPerspective({
      haze: '#aec7ea',
      inscatter: '#ffe3b4',
      zenith: '#a8cfec',
      groundY: -1.0,
      // Roughly the height of the tree canopy plus the near hills: crests break
      // out of the layer, the basins behind them stay buried.
      scaleHeight: 33,
      sunDir: this.sunDir,
      // A tight inscatter lobe left every range the same cool grey, so four
      // ridges differed only in value and the eye stacked them as flat paper.
      // Widening the lobe lets bearing relative to the sun tint them, which is
      // what actually separates real ranges at distance.
      inscatterPower: 1.7,
      inscatterStrength: 1.25,
      // The whole playfield is inside this, so nothing that matters for
      // gameplay picks up haze at all.
      nearClear: 22,
    });
    // At 0.0118 the fog term saturates past ~250 units, so every distant range
    // resolved to exactly the haze colour and no albedo or inscatter change
    // could reach them. Thinner fog lets the ranges keep some of their own
    // value and hue, which is what lets them separate from each other.
    scene.fog = new THREE.FogExp2(0xffffff, 0.0062); // TEST
    scene.fog.color.copy(haze);
  }

  /**
   * Bake the sky dome into a prefiltered environment map.
   *
   * Without this, every PBR material in the scene has no ambient specular or
   * indirect diffuse to sample and the whole image reads flat and dead. This
   * is the single largest visual-quality lever in a three.js scene.
   */
  buildEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();

    // Render only the sky dome into the probe, not the geometry.
    const probeScene = new THREE.Scene();
    const probe = this.skyHandle.probeMesh();
    probeScene.add(probe);

    const target = pmrem.fromScene(probeScene, 0, 0.1, 1000);
    scene.environment = target.texture;
    scene.environmentIntensity = 1.15;

    // The probe owns its geometry; the material is shared with the live dome
    // and must not be disposed here.
    probe.geometry.dispose();
    pmrem.dispose();
    return target;
  }

  /** Advance cloud drift. Safe to call every frame; safe never to call. */
  update(_dt: number, elapsed: number) {
    this.skyHandle.uniforms.uTime.value = elapsed;
  }

  get sunDirection(): THREE.Vector3 {
    return this.sunDir;
  }

  dispose() {
    this.skyHandle.dispose();
  }
}
