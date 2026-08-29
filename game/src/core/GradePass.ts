import * as THREE from 'three';

/**
 * Final colour-grade pass: vignette, subtle chromatic aberration at the edges,
 * saturation/contrast trim and animated grain.
 *
 * These are the cheap touches that separate "a WebGL demo" from "a shipped
 * game" -- a clean render straight out of the tone mapper reads sterile.
 */
export const GradePass = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    resolution: { value: new THREE.Vector2(1, 1) },
    time: { value: 0 },
    vignette: { value: 0.86 },
    saturation: { value: 1.14 },
    contrast: { value: 1.04 },
    aberration: { value: 0.0015 },
    grain: { value: 0.020 },
    lift: { value: new THREE.Color(0.008, 0.012, 0.022) },
    /** Tint pushed into the highlights; the shadows get its complement. */
    splitWarm: { value: new THREE.Color(0.045, 0.020, -0.020) },
    splitCool: { value: new THREE.Color(-0.014, 0.002, 0.036) },
  },

  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2  resolution;
    uniform float time;
    uniform float vignette;
    uniform float saturation;
    uniform float contrast;
    uniform float aberration;
    uniform float grain;
    uniform vec3  lift;
    uniform vec3  splitWarm;
    uniform vec3  splitCool;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
      vec2 uv = vUv;
      vec2 centred = uv - 0.5;
      float r2 = dot(centred, centred);

      // Chromatic aberration, scaled by distance from centre so the middle of
      // frame stays sharp and only the corners smear.
      vec2 dir = centred * aberration * (0.35 + r2 * 2.0);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + dir).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - dir).b;

      // Saturation around luma.
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, saturation);

      // Contrast around mid grey.
      col = (col - 0.5) * contrast + 0.5;

      // Split tone. Warm into the highlights, cool into the shadows, weighted
      // so the midtones are left alone. This is the cheapest way to get the
      // warm-key/cool-fill separation to survive the tone mapper -- ACES
      // compresses exactly the top end where that separation lives, and without
      // putting some of it back the whole frame drifts toward one hue.
      float sh = 1.0 - smoothstep(0.0, 0.45, luma);
      float hi = smoothstep(0.42, 1.0, luma);
      col += splitWarm * hi + splitCool * sh;

      // Lift the blacks slightly toward cool -- pure black reads as a hole.
      col += lift * (1.0 - luma);

      // Vignette. Note the edges are ordered low->high: GLSL smoothstep is
      // undefined when edge0 > edge1, so the falloff is inverted explicitly.
      float v = 1.0 - smoothstep(0.15, 0.85, r2 * vignette);
      col *= mix(0.89, 1.0, v);

      // Animated grain, strongest in the shadows where banding shows up.
      float n = hash(uv * resolution + fract(time) * 137.0) - 0.5;
      col += n * grain * (1.0 - luma * 0.7);

      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};
