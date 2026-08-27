import * as THREE from 'three';
import { GROUND_GLSL } from './GroundNoise';

/**
 * Sky dome.
 *
 * A vertical gradient alone gives a scene nothing to sit against: it has no
 * scale reference, no light direction and nothing for the eye to read depth
 * from, so the horizon reads as a painted wall. This dome adds the three things
 * that fix that, all analytic and all evaluated per pixel:
 *
 *  - **A four-stop ramp** with a separate warm horizon band. Real skies are not
 *    monotonic; the band of forward-scattered light just above the horizon is
 *    what makes distant land feel far away rather than small.
 *  - **Two cloud decks**, projected onto flat planes at different altitudes so
 *    they converge toward the horizon on their own. Perspective convergence is
 *    the depth cue; a cloud texture mapped straight onto the dome has none and
 *    always reads as wallpaper.
 *  - **Directional cloud shading.** Each deck is sampled a second time offset
 *    toward the sun; where the offset sample is denser the pixel is inside the
 *    cloud's own shadow. One extra noise fetch turns flat blobs into lit volumes
 *    and, more importantly, states where the key light is before a single piece
 *    of terrain is drawn.
 *
 * Everything is a pure function of direction and `uTime`, and `uTime` is driven
 * from the engine's simulated clock, so screenshots stay reproducible.
 */

export interface SkyUniforms {
  topColor: { value: THREE.Color };
  midColor: { value: THREE.Color };
  horizonColor: { value: THREE.Color };
  horizonWarm: { value: THREE.Color };
  groundColor: { value: THREE.Color };
  sunDir: { value: THREE.Vector3 };
  sunColor: { value: THREE.Color };
  cloudLit: { value: THREE.Color };
  cloudDark: { value: THREE.Color };
  uTime: { value: number };
  uCover: { value: number };
  uScale: { value: number };
}

export interface SkyOptions {
  radius?: number;
  sunDir: THREE.Vector3;
  topColor?: THREE.ColorRepresentation;
  midColor?: THREE.ColorRepresentation;
  /** Horizon haze away from the sun. */
  horizonColor?: THREE.ColorRepresentation;
  /** Horizon haze in the sun's quarter. */
  horizonWarm?: THREE.ColorRepresentation;
  groundColor?: THREE.ColorRepresentation;
  sunColor?: THREE.ColorRepresentation;
  cloudLit?: THREE.ColorRepresentation;
  cloudDark?: THREE.ColorRepresentation;
  /** Density threshold. Lower = more sky covered. */
  cover?: number;
  /** Cloud feature size. Lower = larger clouds. */
  scale?: number;
}

export interface SkyHandle {
  mesh: THREE.Mesh;
  uniforms: SkyUniforms;
  /** A dome sharing the same material, for baking into a PMREM probe. */
  probeMesh(): THREE.Mesh;
  dispose(): void;
}

const SKY_FRAG = /* glsl */ `
${GROUND_GLSL}

uniform vec3  topColor;
uniform vec3  midColor;
uniform vec3  horizonColor;
uniform vec3  horizonWarm;
uniform vec3  groundColor;
uniform vec3  sunDir;
uniform vec3  sunColor;
uniform vec3  cloudLit;
uniform vec3  cloudDark;
uniform float uTime;
uniform float uCover;
uniform float uScale;

varying vec3 vWorld;

/**
 * Project a view ray onto a horizontal plane at height h.
 *
 * This is what makes a cloud deck converge toward the horizon: equal steps in
 * direction map to ever-larger steps across the plane as the ray flattens. The
 * clamp on dir.y stops the projection running to infinity at the horizon; the
 * caller fades the deck out well before that.
 */
vec2 deckUV(vec3 dir, float h) {
  return dir.xz * (h / max(dir.y, 0.055));
}

/** Puffy density field. The billow term is what gives cumulus their cauliflower edge. */
float deckDensity(vec2 p, float lod) {
  float base   = gnFbm5(p);
  float billow = 1.0 - abs(gnFbm3(p * 2.31 + vec2(7.3, -2.1)) * 2.0 - 1.0);
  float grain  = gnFbm3(p * 5.7 - vec2(3.1, 9.4));
  return base * 0.62 + billow * 0.26 + mix(0.5, grain, lod) * 0.12;
}

void main() {
  vec3 dir = normalize(vWorld);
  float h = dir.y;

  vec3 sd = normalize(sunDir);
  float sunAmt = max(dot(dir, sd), 0.0);

  /* ------------------------------------------------------------- gradient */
  // The horizon band is not one colour. Warm haze piles up in the sun's
  // quarter and stays cool everywhere else, so which way the key light points
  // is legible from the sky alone — and, more practically, so a camera looking
  // away from the sun gets a cool pale band that lets the greens read, instead
  // of a wall of sand yellow competing with the playfield for attention.
  vec2 flatDir = normalize(dir.xz + vec2(1e-5));
  vec2 flatSun = normalize(sd.xz + vec2(1e-5));
  float warmAz = pow(max(dot(flatDir, flatSun), 0.0), 2.2);

  float above = clamp(h, 0.0, 1.0);
  vec3 band = mix(horizonColor, horizonWarm, warmAz * (1.0 - smoothstep(0.0, 0.34, above)));
  vec3 col = mix(band, midColor, smoothstep(0.0, 0.19, above));
  col = mix(col, topColor, smoothstep(0.12, 0.70, above));
  col = mix(col, groundColor, smoothstep(0.0, -0.16, h));

  /* ------------------------------------------------------------------ sun */
  // Kept tight. A wide low-order halo lifts the value of the entire sun-side
  // hemisphere, which is exactly the flat bright wash the band split above is
  // there to avoid.
  col += sunColor * pow(sunAmt, 6.0) * 0.14;
  col += sunColor * pow(sunAmt, 60.0) * 0.50;
  col += sunColor * pow(sunAmt, 900.0) * 4.0;

  /* --------------------------------------------------------------- clouds */
  vec2 sunFlat = normalize(sd.xz + vec2(1e-4));
  float lod = 1.0 - smoothstep(0.05, 0.30, 1.0 - h);   // detail only high up

  // High cirrus. Stretched hard along one axis so it reads as wind-sheared
  // fibre rather than more cumulus at a smaller size.
  vec2 ci = deckUV(dir, 3.4) * uScale * 0.42;
  ci = mat2(0.87, -0.49, 0.49, 0.87) * ci;
  float cirrusD = gnFbm5(ci * vec2(0.28, 1.55) + vec2(uTime * 0.0045, 0.0));
  float cirrus = smoothstep(0.52, 0.86, cirrusD) * smoothstep(0.06, 0.34, h);
  col = mix(col, mix(cloudLit, sunColor, pow(sunAmt, 6.0) * 0.5), cirrus * 0.32);

  // Cumulus deck.
  vec2 cu = deckUV(dir, 1.0) * uScale + vec2(uTime * 0.010, uTime * 0.006);
  float d = deckDensity(cu, lod);
  float cover = smoothstep(uCover, uCover + 0.17, d);

  // Second sample offset toward the sun: the cheapest possible self-shadow.
  float dSun = deckDensity(cu + sunFlat * 0.62, lod);
  float lit = clamp((d - dSun) * 2.6 + 0.52, 0.0, 1.0);

  vec3 cloudCol = mix(cloudDark, cloudLit, lit);
  // Silver lining: thin edges near the sun transmit rather than reflect.
  float edge = cover * (1.0 - cover) * 4.0;
  cloudCol += sunColor * edge * pow(sunAmt, 2.0) * 0.85;
  cloudCol += sunColor * pow(sunAmt, 5.0) * lit * 0.10;

  // Fade the deck out into the horizon haze: at grazing angles the projection
  // is running to hundreds of UV units per pixel and would alias to static.
  float deckFade = smoothstep(0.020, 0.16, h);
  col = mix(col, cloudCol, clamp(cover, 0.0, 1.0) * deckFade);

  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

export function createSky(opts: SkyOptions): SkyHandle {
  const uniforms: SkyUniforms = {
    topColor: { value: new THREE.Color(opts.topColor ?? '#2c73c8') },
    midColor: { value: new THREE.Color(opts.midColor ?? '#8cc4ea') },
    horizonColor: { value: new THREE.Color(opts.horizonColor ?? '#cfe3ef') },
    horizonWarm: { value: new THREE.Color(opts.horizonWarm ?? '#f6dfae') },
    groundColor: { value: new THREE.Color(opts.groundColor ?? '#b9b492') },
    sunDir: { value: opts.sunDir.clone().normalize() },
    sunColor: { value: new THREE.Color(opts.sunColor ?? '#ffd39a') },
    cloudLit: { value: new THREE.Color(opts.cloudLit ?? '#fffaf0') },
    cloudDark: { value: new THREE.Color(opts.cloudDark ?? '#9fb3cc') },
    uTime: { value: 0 },
    uCover: { value: opts.cover ?? 0.50 },
    uScale: { value: opts.scale ?? 0.62 },
  };

  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: SKY_FRAG,
  });

  const radius = opts.radius ?? 420;
  const geometry = new THREE.SphereGeometry(radius, 64, 40);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'sky';
  mesh.frustumCulled = false;
  // Drawn first, writes no depth: everything else composites over it.
  mesh.renderOrder = -1000;

  return {
    mesh,
    uniforms,
    probeMesh() {
      // Its own geometry, so disposing the probe cannot pull the buffers out
      // from under the live dome.
      return new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 32), material);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
