import * as THREE from 'three';

/**
 * Wind-animated standard material.
 *
 * The sway is done in the vertex shader off the instance origin, so hundreds
 * of trees animate for the cost of one uniform update per frame and the
 * instance matrices never touch the CPU. `uSway` packs
 * (pivotY, spanY, curveExponent, speed) and `uAmp` is the world-space
 * amplitude at full height.
 *
 * The same injection is applied to a matching MeshDepthMaterial so the shadow
 * a tree casts sways with the tree instead of standing still underneath it.
 */

export interface WindConfig {
  /** Local Y below which nothing moves (the trunk base). */
  pivotY: number;
  /** Local Y span over which sway ramps to full. */
  spanY: number;
  /** Ramp exponent; >1 keeps the lower trunk stiff. */
  curve: number;
  /** Cycles per second. */
  speed: number;
  /** World-units of displacement at full ramp. */
  amplitude: number;
  /** Extra high-frequency flutter driven by local X (leaves, blades). */
  flutter?: number;
}

export interface WindHandle {
  material: THREE.MeshStandardMaterial;
  depthMaterial: THREE.MeshDepthMaterial;
  uniforms: {
    uTime: { value: number };
    uSway: { value: THREE.Vector4 };
    uAmp: { value: number };
    uFlutter: { value: number };
  };
}

let cacheKey = 0;

const WIND_DECL = /* glsl */ `
uniform float uTime;
uniform vec4 uSway;
uniform float uAmp;
uniform float uFlutter;
`;

const WIND_BODY = /* glsl */ `
{
  #ifdef USE_INSTANCING
    vec3 windOrigin = instanceMatrix[3].xyz;
  #else
    vec3 windOrigin = vec3(0.0);
  #endif
  float phase = windOrigin.x * 0.33 + windOrigin.z * 0.21 + windOrigin.y * 0.11;
  float ramp = clamp((transformed.y - uSway.x) / max(uSway.y, 0.0001), 0.0, 1.0);
  ramp = pow(ramp, uSway.z);
  float t = uTime * uSway.w;
  // Two detuned waves so the forest never pulses in unison, plus a slow gust
  // envelope that travels across the map along the wind direction.
  float gust = 0.62 + 0.38 * sin(uTime * 0.37 - windOrigin.x * 0.055 - windOrigin.z * 0.04);
  float s = sin(t + phase) * 0.66 + sin(t * 1.73 + phase * 2.13) * 0.34;
  float c = cos(t * 0.81 + phase * 1.37);
  float flut = sin(t * 3.1 + transformed.x * 5.5 + transformed.z * 4.1 + phase) * uFlutter;
  float a = uAmp * ramp * gust;
  transformed.x += (s + flut) * a;
  transformed.z += (c * 0.55 + flut * 0.4) * a;
  transformed.y -= abs(s) * a * 0.16;
}
`;

function inject(shader: { vertexShader: string; uniforms: Record<string, unknown> }, u: WindHandle['uniforms']) {
  shader.uniforms.uTime = u.uTime;
  shader.uniforms.uSway = u.uSway;
  shader.uniforms.uAmp = u.uAmp;
  shader.uniforms.uFlutter = u.uFlutter;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${WIND_DECL}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${WIND_BODY}`);
}

export function windMaterial(
  params: THREE.MeshStandardMaterialParameters,
  cfg: WindConfig,
  shared?: WindHandle['uniforms'],
): WindHandle {
  const uniforms: WindHandle['uniforms'] = shared ?? {
    uTime: { value: 0 },
    uSway: { value: new THREE.Vector4(cfg.pivotY, cfg.spanY, cfg.curve, cfg.speed) },
    uAmp: { value: cfg.amplitude },
    uFlutter: { value: cfg.flutter ?? 0 },
  };

  const key = `wind${cacheKey++}`;
  const material = new THREE.MeshStandardMaterial(params);
  material.onBeforeCompile = (s) => inject(s, uniforms);
  material.customProgramCacheKey = () => key;

  const depthMaterial = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    alphaTest: params.alphaTest,
    side: params.side ?? THREE.FrontSide,
  });
  depthMaterial.onBeforeCompile = (s) => inject(s, uniforms);
  depthMaterial.customProgramCacheKey = () => `${key}d`;

  return { material, depthMaterial, uniforms };
}
