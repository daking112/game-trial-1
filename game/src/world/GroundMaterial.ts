import * as THREE from 'three';
import { GROUND_GLSL } from './GroundNoise';
import { cloudShadowSource, cloudShadowKey } from './CloudShadow';

/**
 * Ground shading.
 *
 * Both the terrain and the road are `MeshStandardMaterial`s with their albedo,
 * roughness and normal replaced by a world-space procedural stack injected via
 * `onBeforeCompile`. Doing it in the shader rather than baking a canvas texture
 * buys three things a tiling bitmap cannot:
 *
 *  - layers can be *blended by surface data* (slope, altitude, distance to the
 *    road) instead of sprayed uniformly, so steep faces read as exposed rock
 *    and flats read as grass without any authored masks;
 *  - detail is evaluated in world units, so it neither stretches on slopes nor
 *    repeats on a visible grid;
 *  - the road and the terrain sample one shared noise basis, so the dirt the
 *    terrain paints around the path and the road's own ragged edge interlock.
 *
 * Two rules keep it from turning into noise soup, which is the failure mode of
 * every procedural ground:
 *
 *  1. **The silhouette of the colour comes from the big scales.** Region tone is
 *     driven by 30 m and 4 m fields; everything finer than a metre is allowed to
 *     move the value by a few percent and no more.
 *  2. **Detail is faded out by view distance.** Procedural noise has no mip
 *     chain, so a sub-pixel term does not average — it aliases. Every band below
 *     ~1 m is lerped back to its own mean as it recedes, which is a hand-rolled
 *     mip and the difference between "grass" and "green television static".
 */

/**
 * Shared palette, in **linear** light. These are deliberately low: the rig runs
 * a 4.2-intensity key plus a sky IBL, so anything authored at sRGB-looking
 * values clips to fluorescent mush through ACES.
 */
export const GROUND_PALETTE_GLSL = /* glsl */ `
// Grass sits deliberately bright. Measured against the rest of the frame the
// playfield was the darkest plane at 0.32 luma, below sky, far range and
// midground; a tower defense wants the opposite -- ground second only to sky,
// with the track cutting a dark line through it. DEEP stays low so thicket
// still reads against meadow.
// Measured on the playfield before this: open ground rgb(86,94,59) at the top
// of its range and rgb(35,65,51) in the thicket, with the whole playfield band
// at 0.357 luma -- the darkest plane in a frame whose brief asks for bright,
// saturated and high-key. Every layer comes up by about a quarter. DEEP stays
// well below MID so thicket still reads against meadow, and DRY loses most of
// its yellow: at 0.340/0.306/0.140 it was the khaki that made the open ground
// read as mud rather than as meadow.
const vec3 GRASS_DEEP = vec3(0.082, 0.136, 0.054);
const vec3 GRASS_MID  = vec3(0.196, 0.310, 0.104);
const vec3 GRASS_LIT  = vec3(0.362, 0.488, 0.160);
const vec3 GRASS_DRY  = vec3(0.372, 0.356, 0.168);
// The road is a gameplay affordance before it is a surface: it has to read as a
// separate, lighter, warmer band from any camera angle, so the dirt ramp sits
// deliberately above the grass in value rather than beside it.
// Held where it was while the grass came up. The track has to be traceable at
// a glance from the default camera, and it was separating from the grass almost
// entirely by saturation -- luma 0.234 against 0.225 to 0.285 for the ground
// beside it. Lifting the grass and leaving the dirt alone converts that into a
// value difference, which is the one that survives being looked at from
// fifty metres up.
const vec3 DIRT_DARK  = vec3(0.074, 0.053, 0.034);
const vec3 DIRT_MID   = vec3(0.152, 0.112, 0.070);
const vec3 DIRT_LIT   = vec3(0.248, 0.198, 0.134);
const vec3 ROCK_DARK  = vec3(0.052, 0.052, 0.056);
const vec3 ROCK_LIT   = vec3(0.132, 0.130, 0.124);
// Mass tone for land past ~100 units. Distant hillsides do not show grass, dirt
// and rock as separate materials; they show one cool aggregate, and painting
// them as if they did is what makes a far ridge read as a near one.
// These sit high for albedos. The ranges are back-lit from azimuth 194, so the
// slopes the camera sees carry almost no N.L and nearly everything they return
// to the eye comes through the ambient and IBL terms -- which scale with
// albedo. A far-forest authored at a plausible 0.10 luma leaves the whole
// distant third of the frame at the same value as the playfield, and a
// four-plane composition reads as two.
const vec3 FAR_FOREST = vec3(0.268, 0.330, 0.252);
const vec3 FAR_ROCK   = vec3(0.360, 0.386, 0.470);
`;

export interface TerrainMaterialOptions {
  /** Half-width of the fully-worn dirt band either side of the path centreline. */
  roadInner?: number;
  /** Distance at which the worn scuff has faded fully back to grass. */
  roadOuter?: number;
  /** Half-width of the playable square, so the shader can tell map from apron. */
  mapHalf?: number;
}

/**
 * Terrain surface.
 *
 * Expects the geometry to carry two extra attributes:
 *   `aRoad` — distance from the vertex to the path centreline, world units.
 *   `aOcc`  — baked cavity term in [0,1], 0 = deep crevice, 1 = fully open.
 */
export function createTerrainMaterial(opts: TerrainMaterialOptions = {}): THREE.MeshStandardMaterial {
  const roadInner = opts.roadInner ?? 1.6;
  const roadOuter = opts.roadOuter ?? 4.2;
  const mapHalf = opts.mapHalf ?? 40;

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1.0,
    metalness: 0.0,
  });

  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        attribute float aRoad;
        attribute float aOcc;
        varying vec3 vGw;
        varying vec3 vGn;
        varying float vGRoad;
        varying float vGOcc;
        `,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `
        #include <begin_vertex>
        vec4 gWorld4 = modelMatrix * vec4(transformed, 1.0);
        vGw = gWorld4.xyz;
        vGn = normalize(mat3(modelMatrix) * objectNormal);
        vGRoad = aRoad;
        vGOcc = aOcc;
        `,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        ${GROUND_GLSL}
        ${GROUND_PALETTE_GLSL}
        ${cloudShadowSource()}
        varying vec3 vGw;
        varying vec3 vGn;
        varying float vGRoad;
        varying float vGOcc;
        vec3 gWorldN;
        float gRough;

        const float ROAD_INNER = ${roadInner.toFixed(3)};
        const float ROAD_OUTER = ${roadOuter.toFixed(3)};
        const float INV_MAP_HALF = ${(1 / mapHalf).toFixed(6)};

        /**
         * Where this pixel is relative to the playable square: below 1 inside
         * the map, exactly 1 on its boundary, above 1 on the apron.
         *
         * The same squircle the terrain's framing rim is built from, so the two
         * agree by construction. Every "is this map or is this backdrop"
         * decision keys off it. A plain radius cannot do the job: the map is
         * square, so its corners sit at r = 1.41 * half while its edge midpoints
         * sit at r = half, and any radial threshold either bites into the
         * corners of the playfield or leaves a band of apron untreated.
         */
        float gMapT(vec2 w) {
          vec2 q = abs(w) * INV_MAP_HALF;
          vec2 q4 = q * q * q * q;
          return pow(q4.x + q4.y, 0.25);
        }

        // Height field for the per-pixel normal. Clump scale carries the read;
        // the finer bands only survive close to camera.
        float gBump(vec2 q, float lodMid, float lodFine) {
          return gnFbm2(q * 0.30) * 0.70
               + gnValue(q * 1.25 + vec2(11.3, 4.1)) * 0.26 * lodMid
               + gnValue(q * 4.10 - vec2(3.7, 8.9)) * 0.12 * lodFine;
        }
        `,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        #include <map_fragment>
        {
          vec2 w = vGw.xz;
          float viewDist = length(vGw - cameraPosition);
          // Map-relative position, not view distance, so the same patch of
          // ground is painted the same way from every camera.
          float mapT = gMapT(w);

          // Hand-rolled mip: fade each detail band back to its own mean as it
          // recedes, so nothing below a pixel is left to alias.
          float lodMid  = 1.0 - smoothstep(22.0, 70.0, viewDist);
          float lodFine = 1.0 - smoothstep(9.0, 26.0, viewDist);

          // ---- per-pixel normal from the analytic bump gradient -------------
          vec3 geoN = normalize(vGn);
          // Slope must come from the *geometric* normal. Deriving it from the
          // bumped normal makes every 20 cm ripple cross the rock threshold and
          // sprays grey speckle over flat ground.
          float slope = 1.0 - clamp(geoN.y, 0.0, 1.0);

          float e = 0.30;
          float b0 = gBump(w, lodMid, lodFine);
          float bx = gBump(w + vec2(e, 0.0), lodMid, lodFine);
          float bz = gBump(w + vec2(0.0, e), lodMid, lodFine);
          float bumpAmp = mix(0.55, 0.30, smoothstep(0.25, 0.6, slope)) * mix(0.35, 1.0, lodMid);
          gWorldN = normalize(geoN + vec3(-(bx - b0) / e, 0.0, -(bz - b0) / e) * bumpAmp);

          // ---- decorrelated scales ------------------------------------------
          // 32 m regions, 7 m fields, 4 m clumps, then sub-metre grain.
          float macro = gnFbm5(w * 0.031 + vec2(4.2, -1.7));
          float meso  = gnFbm3(w * 0.145 - vec2(9.4, 2.6));
          float clump = gnFbm2(w * 0.27 + vec2(2.3, -6.1));
          float micro = mix(0.5, gnValue(w * 0.95 + vec2(1.9, 7.2)), lodMid);
          float fine  = mix(0.5, gnValue(w * 3.30 - vec2(5.1, 3.3)), lodFine);

          // ---- masks ---------------------------------------------------------
          // Slope drives the layer choice; noise wobbles the threshold so the
          // boundary is an irregular coastline rather than a contour line.
          float slopeN = slope + (meso - 0.5) * 0.22 + (clump - 0.5) * 0.10;
          float rockM  = smoothstep(0.34, 0.60, slopeN);
          float scree  = smoothstep(0.19, 0.38, slopeN) * (1.0 - rockM);

          // Past the rim these are forested foothills, not quarries. The local
          // rock layer is a neutral dark grey authored for outcrops seen from
          // three metres away; on a back-lit foothill flank a hundred metres out
          // it renders as a smooth grey slab pasted into the greenery, and it
          // measured rgb(83, 90, 91) -- the flattest, most colourless thing in
          // the frame. Rock on the apron is the far palette's job, and that one
          // is a cool blue-grey that belongs to the distance.
          float apron = smoothstep(1.00, 1.26, mapT);
          rockM *= 1.0 - apron * 0.94;
          scree *= 1.0 - apron * 0.80;

          // Worn earth beside the path. The boundary is pushed around by a
          // metre-scale noise so it never reads as a constant-width buffer.
          float roadD = vGRoad + (gnFbm2(w * 0.30) - 0.5) * 1.9 + (clump - 0.5) * 0.7;
          float roadCore  = 1.0 - smoothstep(ROAD_INNER, ROAD_INNER + 0.9, roadD);
          float roadScuff = 1.0 - smoothstep(ROAD_INNER + 0.5, ROAD_OUTER, roadD);

          // Large dry/bare regions on the flats, so open ground is not one flat
          // green field.
          //
          // Confined to the playfield. The macro field that scatters these runs
          // at a 32 m wavelength, so on the apron -- seen at a grazing angle,
          // where 32 m of ground compresses into a few pixels of screen -- one
          // region would cover the whole visible band and paint it a single flat
          // khaki. A texture idea that works underfoot is not automatically one
          // that works at two hundred metres.
          float bareM = smoothstep(0.62, 0.82, macro * 0.72 + meso * 0.28);
          bareM *= 1.0 - smoothstep(0.94, 1.30, mapT);

          float dirtM = clamp(max(max(scree, roadCore), max(bareM * 0.55, roadScuff * 0.45)), 0.0, 1.0);

          // ---- layer albedos -------------------------------------------------
          // Region tone first (32 m + 7 m), then clumping, then a whisper of
          // grain. Getting this order wrong is what makes procedural grass read
          // as static.
          float region = macro * 0.6 + meso * 0.4;
          vec3 grass = mix(GRASS_DEEP, GRASS_MID, smoothstep(0.30, 0.68, region));
          grass = mix(grass, GRASS_LIT, smoothstep(0.42, 0.80, clump) * 0.55);
          grass = mix(grass, GRASS_DRY, smoothstep(0.62, 0.88, macro) * 0.55);
          grass *= 0.95 + micro * 0.10;

          vec3 dirt = mix(DIRT_DARK, DIRT_MID, smoothstep(0.30, 0.70, meso * 0.55 + clump * 0.45));
          dirt = mix(dirt, DIRT_LIT, smoothstep(0.50, 0.82, micro) * 0.55);

          // Rock gets horizontal strata from world Y so cliffs read as bedded
          // stone rather than grey noise.
          float strata = gnValue(vec2(vGw.y * 2.1, (w.x + w.y) * 0.05));
          vec3 rock = mix(ROCK_DARK, ROCK_LIT, smoothstep(0.30, 0.72, gnFbm3(w * 0.30)));
          rock = mix(rock, rock * 0.76, smoothstep(0.45, 0.65, strata));

          vec3 col = grass;
          col = mix(col, dirt, dirtM);
          col = mix(col, rock, rockM);

          // Grain: a few percent of value, close range only. Below the eye's
          // pattern-finding threshold, but it stops flat areas looking like vinyl.
          col *= 0.97 + fine * 0.06;

          // Baked cavity. Cheap, but it is what gives the large forms volume in
          // ambient-only areas where N.L carries no information.
          col *= mix(0.80, 1.04, vGOcc);

          // ---- verge halo ------------------------------------------------
          // The path is the one piece of terrain the player has to be able to
          // trace at a glance from any camera, and a brown ribbon on green
          // ground is a hue difference, not a value difference -- at overview
          // scale it disappears. A pale dry band just outside the worn dirt
          // gives the route a light edge against both the dark road and the
          // mid-green field, which is the same trick a tower-defense map uses
          // when it outlines its track. It is *strengthened* with distance to
          // cancel the detail LOD, so the far half of the loop stays as legible
          // as the near half.
          float vergeD = vGRoad + (gnFbm2(w * 0.22 + vec2(6.1, -2.7)) - 0.5) * 1.7;
          float verge = smoothstep(ROAD_INNER - 0.15, ROAD_INNER + 1.25, vergeD)
                      * (1.0 - smoothstep(ROAD_OUTER - 0.6, ROAD_OUTER + 1.7, vergeD));
          col = mix(col, GRASS_DRY, verge * mix(0.34, 0.60, smoothstep(25.0, 95.0, viewDist)));

          // Collapse to mass tone with distance. Without this the apron's
          // ridgelines carry the same grass/rock mottling as the ground under
          // the player's feet, and the eye reads them as nearby hillocks.
          // Keyed off *world radius*, not view distance. View distance makes the
          // far corner of the playfield collapse to mass tone the moment the
          // camera pulls back, which costs track readability for nothing.
          //
          // Starts at the rim and nowhere before it. Because the metric is the
          // map's own squircle rather than a radius, this is exactly zero over
          // every square metre of playfield -- corners included -- and picks up
          // the moment the ground stops being playable. The radius version had
          // to be held back to r = 56 to protect the corners, which left the
          // whole first band of apron painted in the playfield's palette.
          //
          // And it completes fast. A ramp that took until mapT = 2.3 left the
          // first thirty metres of apron -- the flank the player looks straight
          // at -- painted with the playfield's own neutral grey rock, which is
          // what those smooth streaked slabs standing in the foothills actually
          // were. Everything past the rim is backdrop; there is no reason for it
          // to spend twenty metres pretending otherwise.
          float farBlend = smoothstep(1.02, 1.55, mapT);

          // Slope alone picks the far layer, and a big mountain face has one
          // slope over its whole area -- so it resolved to one flat grey plane,
          // the single ugliest thing in the low shot. A 90 m noise band pushed
          // into the threshold breaks that face into treed shoulders and bare
          // rock. It is deliberately coarse: anything finer is below a pixel at
          // the distance these surfaces are seen from, and would only alias.
          float farBreak = gnFbm3(w * 0.011 + vec2(17.0, -5.0));
          vec3 farTone = mix(FAR_FOREST, FAR_ROCK,
                             smoothstep(0.24, 0.62, slope + (farBreak - 0.5) * 0.36));

          // Separate the ranges by hue, not only by value. Four ridges sharing
          // one blue-grey differ solely in brightness, and the eye stacks them
          // as flat paper. Nearer land keeps a warm green cast; each range
          // further out is pushed cooler and bluer, so depth survives even
          // where two ridges happen to meet at the same luminance.
          float depthBand = smoothstep(1.90, 6.20, mapT);
          farTone = mix(farTone * vec3(1.10, 1.06, 0.88),
                        farTone * vec3(0.86, 0.94, 1.22), depthBand);
          // Not all the way: leaving a sixth of the local albedo means the key
          // still models the far peaks instead of flattening them to one value.
          col = mix(col, farTone, farBlend * 0.84);

          col *= cloudShadow(vGw);

          diffuseColor.rgb *= col;

          gRough = mix(0.98, 0.76, rockM);
        }
        `,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `
        #include <roughnessmap_fragment>
        roughnessFactor = gRough;
        `,
      )
      .replace(
        '#include <normal_fragment_begin>',
        /* glsl */ `
        #include <normal_fragment_begin>
        normal = normalize((viewMatrix * vec4(gWorldN, 0.0)).xyz);
        `,
      );
  };

  mat.customProgramCacheKey = () => `terrain-ground-${roadInner}-${roadOuter}-${mapHalf}-${cloudShadowKey()}`;
  return mat;
}

export interface RoadMaterialOptions {
  /** Half-width of the ribbon in world units, used to scale detail correctly. */
  halfWidth?: number;
}

/**
 * Worn cart track.
 *
 * The ribbon carries `uv.x` across the road (0..1) and `uv.y` as arc length in
 * world units, so everything below can be authored in real metres. The edge is
 * not an alpha ramp on a rectangle: the cut is a noise-displaced threshold, and
 * the terrain independently paints worn dirt over the same region, so the two
 * meet as a scuffed verge rather than a decal boundary.
 */
export function createRoadMaterial(opts: RoadMaterialOptions = {}): THREE.MeshStandardMaterial {
  const halfWidth = opts.halfWidth ?? 1.6;

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1.0,
    metalness: 0.0,
    transparent: true,
    depthWrite: true,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });

  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        varying vec3 vRw;
        varying vec2 vRuv;
        varying vec3 vRn;
        `,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `
        #include <begin_vertex>
        vec4 rWorld4 = modelMatrix * vec4(transformed, 1.0);
        vRw = rWorld4.xyz;
        vRuv = uv;
        vRn = normalize(mat3(modelMatrix) * objectNormal);
        `,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        ${GROUND_GLSL}
        ${GROUND_PALETTE_GLSL}
        ${cloudShadowSource()}
        varying vec3 vRw;
        varying vec2 vRuv;
        varying vec3 vRn;
        vec3 gRoadN;
        float gRoadRough;

        float rBump(vec2 q, float lodFine) {
          return gnFbm2(q * 0.5) * 0.55 + gnValue(q * 2.1) * 0.30 * lodFine;
        }
        `,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        #include <map_fragment>
        {
          vec2 w = vRw.xz;
          float across = vRuv.x * 2.0 - 1.0;   // -1 .. 1 across the road
          float along  = vRuv.y;               // arc length, world units
          float aa = abs(across);
          float viewDist = length(vRw - cameraPosition);
          float lodMid  = 1.0 - smoothstep(22.0, 70.0, viewDist);
          float lodFine = 1.0 - smoothstep(9.0, 26.0, viewDist);

          // ---- ragged edge ----------------------------------------------------
          // The cut line is displaced by two noise bands: a slow meander that
          // makes the road wander in width, and a crumbly higher-frequency term
          // that eats into it. No straight alpha ramp anywhere.
          float meander = gnFbm2(vec2(along * 0.07, 0.0)) - 0.5;
          float crumble = gnFbm3(vec2(along * 0.85, across * 0.6)) - 0.5;
          float cut = 0.86 + meander * 0.20 + crumble * 0.22;
          float alpha = 1.0 - smoothstep(cut - 0.07, cut + 0.05, aa);

          // ---- surface --------------------------------------------------------
          float macro = gnFbm5(w * 0.05);
          float meso  = gnFbm3(vec2(along * 0.18, across * 0.8));
          float micro = mix(0.5, gnValue(w * 1.6), lodMid);
          float fine  = mix(0.5, gnValue(w * 5.0), lodFine);

          vec3 base = mix(DIRT_DARK, DIRT_MID, smoothstep(0.28, 0.72, meso * 0.6 + macro * 0.4));
          base = mix(base, DIRT_LIT, smoothstep(0.48, 0.82, micro) * 0.50);

          // Twin wheel ruts: compacted, damper, darker.
          float rut = exp(-pow((aa - 0.48) / 0.18, 2.0));
          rut *= 0.72 + 0.28 * gnValue(vec2(along * 0.45, 0.0));
          base = mix(base, DIRT_DARK * 0.85, rut * 0.55);

          // The crown between the ruts stays dusty and pale; a thread of weeds
          // survives down the exact centre where no wheel runs.
          float crown = 1.0 - smoothstep(0.0, 0.26, aa);
          base = mix(base, DIRT_LIT, crown * 0.40);
          float weeds = crown * smoothstep(0.50, 0.88, gnFbm2(vec2(along * 1.1, 0.0)));
          base = mix(base, GRASS_DEEP, weeds * 0.50);

          // ---- stones ----------------------------------------------------------
          // Cobbles pressed into the surface, and loose pebbles collecting on the
          // verges where nothing drives. Both are kept low-contrast: individually
          // legible stones at 60 m is just pepper.
          vec2 cob = gnVoronoi(w * 1.9);
          float cobMask = smoothstep(0.40, 0.18, cob.x) * step(0.60, cob.y)
                        * (1.0 - rut * 0.5) * lodMid;
          vec3 cobCol = mix(DIRT_LIT, ROCK_LIT, 0.45 + cob.y * 0.35);
          base = mix(base, cobCol, cobMask * 0.45);

          vec2 peb = gnVoronoi(w * 5.5 + vec2(31.0, 17.0));
          float pebMask = smoothstep(0.26, 0.09, peb.x) * step(0.74, peb.y)
                        * smoothstep(0.30, 0.75, aa) * lodFine;
          base = mix(base, mix(ROCK_LIT, DIRT_LIT, 0.45), pebMask * 0.55);

          // Verge: trodden mud, darker, where grass has been ground away.
          base = mix(base, DIRT_DARK * 0.92, smoothstep(0.55, 0.95, aa) * 0.40);

          base *= 0.97 + fine * 0.06;

          // ---- normal ----------------------------------------------------------
          float e = 0.20;
          float b0 = rBump(w, lodFine) + cobMask * 0.30 - rut * 0.22;
          vec2 cobX = gnVoronoi((w + vec2(e, 0.0)) * 1.9);
          vec2 cobZ = gnVoronoi((w + vec2(0.0, e)) * 1.9);
          float mx = smoothstep(0.40, 0.18, cobX.x) * step(0.60, cobX.y) * lodMid;
          float mz = smoothstep(0.40, 0.18, cobZ.x) * step(0.60, cobZ.y) * lodMid;
          float bx = rBump(w + vec2(e, 0.0), lodFine) + mx * 0.30 - rut * 0.22;
          float bz = rBump(w + vec2(0.0, e), lodFine) + mz * 0.30 - rut * 0.22;
          gRoadN = normalize(normalize(vRn)
                 + vec3(-(bx - b0) / e, 0.0, -(bz - b0) / e) * 0.45 * mix(0.3, 1.0, lodMid));

          base *= cloudShadow(vRw);

          diffuseColor.rgb *= base;
          diffuseColor.a *= clamp(alpha, 0.0, 1.0);
          gRoadRough = mix(0.99, 0.84, rut) - cobMask * 0.10;
        }
        `,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `
        #include <roughnessmap_fragment>
        roughnessFactor = gRoadRough;
        `,
      )
      .replace(
        '#include <normal_fragment_begin>',
        /* glsl */ `
        #include <normal_fragment_begin>
        normal = normalize((viewMatrix * vec4(gRoadN, 0.0)).xyz);
        `,
      );
  };

  mat.customProgramCacheKey = () => `road-ground-${halfWidth}-${cloudShadowKey()}`;
  return mat;
}
