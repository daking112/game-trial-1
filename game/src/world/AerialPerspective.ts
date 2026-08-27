import * as THREE from 'three';

/**
 * Aerial perspective.
 *
 * `THREE.FogExp2` is a single lerp toward one flat colour driven by view depth
 * alone. It cannot express the two things that actually make a landscape read
 * deep:
 *
 *  1. **Height falloff.** Haze is a layer of atmosphere sitting on the ground.
 *     A ridge crest pokes out of it while the valley behind it is buried, which
 *     is what separates one landform from the next. Depth-only fog washes both
 *     by the same amount and the hills stack up like flat cutouts.
 *  2. **In-scattering.** The haze is not one colour. Looking toward the sun it
 *     glows warm; looking away it goes cool and blue. That gradient across the
 *     frame is most of what "atmosphere" means, and it also tells the eye where
 *     the key light is coming from without a single lit surface.
 *
 * Rather than hand-patching every material, this replaces three's four fog
 * shader chunks globally. Every fogged material in the scene — terrain,
 * foliage, creatures, projectiles — picks it up for free, so nothing in the
 * frame sits at a different depth cue from anything else.
 *
 * The optical depth is the analytic integral of an exponential density profile
 * along the view ray:
 *
 *     rho(y) = D * exp(-(y - y0) / H)
 *     tau    = integral rho ds  =  D * len * H * (e_a - e_b) / (y_b - y_a)
 *
 * which is exact, branch-free apart from the degenerate horizontal case, and
 * costs three exponentials.
 *
 * Constants are baked into the chunk source rather than passed as uniforms:
 * three clones `UniformsLib.fog` per material, so any extra uniform added there
 * becomes a per-material copy that cannot be driven from one place. The time of
 * day is fixed, so baking is both simpler and cheaper. `configureAerialPerspective`
 * must therefore run before the first material compiles.
 */

export interface AerialConfig {
  /** Haze colour on the horizon, away from the sun. Authored in sRGB. */
  haze: THREE.ColorRepresentation;
  /** Haze colour looking straight into the sun — the forward-scatter lobe. */
  inscatter: THREE.ColorRepresentation;
  /** Haze colour looking up into clear sky, so airborne things match the dome. */
  zenith: THREE.ColorRepresentation;
  /** World Y at which density equals the scene fog's density. */
  groundY: number;
  /** e-folding height of the density falloff, in world units. */
  scaleHeight: number;
  /** Unit vector pointing at the sun. */
  sunDir: THREE.Vector3;
  /** Width of the forward-scatter lobe. Higher = tighter around the sun. */
  inscatterPower: number;
  /** How far the lobe pushes the haze toward `inscatter`, 0..1. */
  inscatterStrength: number;
  /** Distance in world units before any haze is applied at all. */
  nearClear: number;
}

/* ------------------------------------------------------------ tone mapping */

const ACES_IN = [
  0.59719, 0.35458, 0.04823,
  0.07600, 0.90834, 0.01566,
  0.02840, 0.13383, 0.83777,
];
const ACES_OUT = [
  1.60475, -0.53108, -0.07367,
  -0.10208, 1.10813, -0.00605,
  -0.00327, -0.07276, 1.07602,
];

function mul3(m: number[], v: [number, number, number]): [number, number, number] {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/**
 * The exact fit three's `ACESFilmicToneMapping` uses, evaluated on the CPU.
 *
 * Fog is composited *after* tone mapping (three's chunk order is
 * opaque -> tonemapping -> colorspace -> fog), so a haze colour authored as a
 * raw scene radiance sits brighter than the tone-mapped sky it is supposed to
 * dissolve into, and the horizon shows a visible seam. Pushing the authored
 * colour through the same curve the sky went through removes the seam by
 * construction, and keeps it removed when the sky is retuned.
 */
export function acesFilmic(c: THREE.Color, exposure = 1): THREE.Color {
  let v: [number, number, number] = [c.r * exposure / 0.6, c.g * exposure / 0.6, c.b * exposure / 0.6];
  v = mul3(ACES_IN, v);
  const fit = (x: number) => {
    const a = x * (x + 0.0245786) - 0.000090537;
    const b = x * (0.983729 * x + 0.4329510) + 0.238081;
    return a / b;
  };
  v = [fit(v[0]), fit(v[1]), fit(v[2])];
  v = mul3(ACES_OUT, v);
  return new THREE.Color(
    THREE.MathUtils.clamp(v[0], 0, 1),
    THREE.MathUtils.clamp(v[1], 0, 1),
    THREE.MathUtils.clamp(v[2], 0, 1),
  );
}

const f = (n: number) => n.toFixed(5);
const v3 = (c: THREE.Color) => `vec3(${f(c.r)}, ${f(c.g)}, ${f(c.b)})`;

let installed = false;
const original = {
  fog_pars_vertex: THREE.ShaderChunk.fog_pars_vertex,
  fog_vertex: THREE.ShaderChunk.fog_vertex,
  fog_pars_fragment: THREE.ShaderChunk.fog_pars_fragment,
  fog_fragment: THREE.ShaderChunk.fog_fragment,
};

/** Restore three's stock fog. Only used by tests and hot reload. */
export function resetAerialPerspective() {
  Object.assign(THREE.ShaderChunk, original);
  installed = false;
}

export function configureAerialPerspective(cfg: AerialConfig) {
  if (installed) resetAerialPerspective();
  installed = true;

  // Authored in sRGB, converted to the linear working space by THREE.Color,
  // then through the same tone curve the rest of the frame has already taken.
  const haze = acesFilmic(new THREE.Color(cfg.haze));
  const inscatter = acesFilmic(new THREE.Color(cfg.inscatter));
  const zenith = acesFilmic(new THREE.Color(cfg.zenith));
  const s = cfg.sunDir.clone().normalize();

  THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
    #ifdef USE_FOG
      varying float vFogDepth;
      varying vec3 vFogWorld;
    #endif
  `;

  // mvPosition is the one thing every shader that includes this chunk is
  // guaranteed to have. Rotating it back out of view space costs one mat3
  // transpose and avoids depending on `transformed` or `worldPosition`, which
  // only some of the built-in shaders define at this point.
  THREE.ShaderChunk.fog_vertex = /* glsl */ `
    #ifdef USE_FOG
      vFogDepth = - mvPosition.z;
      vFogWorld = cameraPosition + transpose(mat3(viewMatrix)) * mvPosition.xyz;
    #endif
  `;

  THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
    #ifdef USE_FOG
      uniform vec3 fogColor;
      uniform float fogDensity;
      varying float vFogDepth;
      varying vec3 vFogWorld;

      const float AP_GROUND_Y  = ${f(cfg.groundY)};
      const float AP_SCALE_H   = ${f(Math.max(cfg.scaleHeight, 0.01))};
      const float AP_NEAR      = ${f(cfg.nearClear)};
      const float AP_INS_POW   = ${f(cfg.inscatterPower)};
      const float AP_INS_STR   = ${f(cfg.inscatterStrength)};
      const vec3  AP_SUN       = vec3(${f(s.x)}, ${f(s.y)}, ${f(s.z)});
      const vec3  AP_INSCATTER = ${v3(inscatter)};
      const vec3  AP_ZENITH    = ${v3(zenith)};
    #endif
  `;

  THREE.ShaderChunk.fog_fragment = /* glsl */ `
    #ifdef USE_FOG
    {
      vec3 apRay = vFogWorld - cameraPosition;
      float apLen = max(length(apRay), 1e-4);
      vec3 apDir = apRay / apLen;

      // Analytic optical depth through rho(y) = D * exp(-(y - y0) / H).
      float ya = (cameraPosition.y - AP_GROUND_Y) / AP_SCALE_H;
      float yb = (vFogWorld.y     - AP_GROUND_Y) / AP_SCALE_H;
      float dy = yb - ya;
      float ea = exp(-clamp(ya, -12.0, 12.0));
      float eb = exp(-clamp(yb, -12.0, 12.0));
      float shape = abs(dy) < 1e-3 ? ea : (ea - eb) / dy;

      float travel = max(apLen - AP_NEAR, 0.0);
      float tau = fogDensity * travel * max(shape, 0.0);
      float fogFactor = 1.0 - exp(-tau);

      // The haze itself is a gradient, not a colour: warm into the sun, cool
      // away from it, and matched to the dome when the ray points at sky.
      float sunAmt = max(dot(apDir, AP_SUN), 0.0);
      vec3 haze = mix(fogColor, AP_INSCATTER, pow(sunAmt, AP_INS_POW) * AP_INS_STR);
      haze = mix(haze, AP_ZENITH, smoothstep(0.02, 0.62, apDir.y) * 0.7);

      gl_FragColor.rgb = mix(gl_FragColor.rgb, haze, clamp(fogFactor, 0.0, 1.0));
    }
    #endif
  `;

  return haze;
}
