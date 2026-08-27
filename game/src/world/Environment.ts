import * as THREE from 'three';

export interface EnvironmentOptions {
  /** Sun azimuth/elevation in degrees. */
  sunAzimuth?: number;
  sunElevation?: number;
}

/**
 * Sky dome, sun, fill light and fog.
 *
 * The lighting rig is a warm key from a low sun plus a cool sky-bounce fill.
 * That warm/cool split is what gives forms readable shading; a single white
 * light flattens everything into cardboard regardless of mesh quality.
 */
export class Environment {
  readonly group = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly sky: THREE.Mesh;

  private readonly skyUniforms;

  constructor(scene: THREE.Scene, opts: EnvironmentOptions = {}) {
    const azimuth = THREE.MathUtils.degToRad(opts.sunAzimuth ?? 135);
    // A high sun keeps N.L strong across the mostly-upward-facing terrain.
    // At a low elevation the whole playfield sits at grazing incidence and
    // reads muddy no matter how the albedo is authored.
    const elevation = THREE.MathUtils.degToRad(opts.sunElevation ?? 52);

    const sunDir = new THREE.Vector3(
      Math.cos(elevation) * Math.cos(azimuth),
      Math.sin(elevation),
      Math.cos(elevation) * Math.sin(azimuth),
    );

    this.skyUniforms = {
      topColor: { value: new THREE.Color('#3d8fd6') },
      midColor: { value: new THREE.Color('#bfe0f5') },
      bottomColor: { value: new THREE.Color('#dfe8d8') },
      sunDir: { value: sunDir.clone() },
      sunColor: { value: new THREE.Color('#ffd9a0') },
    };

    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(300, 48, 32),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: this.skyUniforms,
        vertexShader: /* glsl */ `
          varying vec3 vWorld;
          void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWorld = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 topColor;
          uniform vec3 midColor;
          uniform vec3 bottomColor;
          uniform vec3 sunDir;
          uniform vec3 sunColor;
          varying vec3 vWorld;

          void main() {
            vec3 dir = normalize(vWorld);
            float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);

            // Three-stop vertical ramp: zenith -> horizon haze -> ground bounce.
            vec3 col = mix(bottomColor, midColor, smoothstep(0.42, 0.52, h));
            col = mix(col, topColor, smoothstep(0.5, 0.92, h));

            // Sun disc plus a wide forward-scattering halo.
            float d = max(dot(dir, normalize(sunDir)), 0.0);
            col += sunColor * pow(d, 220.0) * 3.0;
            col += sunColor * pow(d, 6.0) * 0.28;

            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
    );
    this.sky.name = 'sky';
    this.group.add(this.sky);

    // Key light. Shadow frustum is kept tight around the playfield -- a wide
    // frustum spreads the same texels over more world and the contact shadows
    // under creatures turn to mush.
    this.sun = new THREE.DirectionalLight('#fff4e2', 4.2);
    this.sun.position.copy(sunDir).multiplyScalar(60);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 140;
    this.sun.shadow.camera.left = -34;
    this.sun.shadow.camera.right = 34;
    this.sun.shadow.camera.top = 34;
    this.sun.shadow.camera.bottom = -34;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 2.2;
    this.group.add(this.sun);
    this.group.add(this.sun.target);

    // Cool sky fill so shadowed faces stay readable instead of going black.
    this.hemi = new THREE.HemisphereLight('#a8d2ff', '#5b6b3a', 0.9);
    this.group.add(this.hemi);

    scene.add(this.group);
    // Density is deliberately low: fog is here to give depth cues between the
    // near and far side of the map, not to hide it. Colour is matched to the
    // horizon band of the sky so distant terrain dissolves into it.
    scene.fog = new THREE.FogExp2('#cfe2ee', 0.0055);
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
    const skyClone = this.sky.clone();
    probeScene.add(skyClone);

    const target = pmrem.fromScene(probeScene, 0, 0.1, 1000);
    scene.environment = target.texture;
    scene.environmentIntensity = 1.0;

    skyClone.geometry.dispose();
    pmrem.dispose();
    return target;
  }

  get sunDirection(): THREE.Vector3 {
    return this.skyUniforms.sunDir.value as THREE.Vector3;
  }

  dispose() {
    this.sky.geometry.dispose();
    (this.sky.material as THREE.Material).dispose();
  }
}
