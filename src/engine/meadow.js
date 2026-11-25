import { onTrail } from './wind-route.js';
import * as THREE from 'three';
import { VEGETATION_ASSETS } from './vegetation.js';

/* ------------------------------------------------------------------ */
/*  C · meadow assembly                                                */
/*                                                                     */
/*  The ground is a heightfield now: a shallow rise toward the        */
/*  horizon plus long, low undulations. The dandelion keeps a small    */
/*  flattened clearing at the origin. Grass and flower assets are      */
/*  planted by sampling that heightfield.                              */
/* ------------------------------------------------------------------ */

const TAU = Math.PI * 2;
const clamp01 = (v) => Math.max(0, Math.min(1, v));

function smoothstep(a, b, x) {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

const NOISE_GLSL = /* glsl */ `
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
`;

/* Aerial perspective shared by the terrain and the grass. One exponential
   curve for everything keeps the two from fading at different distances,
   which is what made the far field look like a flat cut-out. */
const HAZE_GLSL = /* glsl */ `
  float aerialFog(float d, float h) {
    float x = max(d - 5.0, 0.0) * 0.021;
    float f = 1.0 - exp(-pow(x, 1.35));
    f *= mix(1.0, 0.90, clamp(h, 0.0, 1.0));
    return clamp(f, 0.0, 1.0);
  }

  vec3 aerialColor(vec3 haze, vec3 sunCol, vec3 sunDir, vec3 viewDir, vec2 p, float t) {
    float toward = pow(max(dot(viewDir, normalize(sunDir)), 0.0), 3.0);
    vec3 c = haze * (0.955 + 0.085 * toward);
    c = mix(c, sunCol * 0.92 + haze * 0.08, toward * 0.18);
    float n1 = vnoise(p * 0.016 + vec2(t * 0.0032, -t * 0.0014));
    float n2 = vnoise(p * 0.045 - vec2(t * 0.0041, 0.0));
    c *= 0.952 + 0.058 * n1 + 0.02 * n2;
    return c;
  }
`;

/* ------------------------------------------------------------------ */
/* terrain height                                                      */
/* ------------------------------------------------------------------ */

function rawHeight(x, z) {
  const rise = Math.max(0, -z) * 0.075;
  const roll =
    0.55 * Math.sin(x * 0.070 + z * 0.030 + 1.15) +
    0.26 * Math.sin(x * 0.170 - z * 0.055 + 2.30) +
    0.09 * Math.sin(x * 0.430 + z * 0.230 + 4.00);
  return rise + roll;
}

const ORIGIN_RAW = rawHeight(0, 0);

/** Gentle meadow slope with a flattened clearing around the dandelion. */
export function terrainHeight(x, z) {
  const flat = smoothstep(0.55, 2.35, Math.hypot(x, z));
  return (rawHeight(x, z) - ORIGIN_RAW) * flat;
}

/* ------------------------------------------------------------------ */
/* terrain mesh + shader                                               */
/* ------------------------------------------------------------------ */

export function createTerrain() {
  const size = 210;
  const segments = 190;
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, 0, -40);

  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, terrainHeight(x, z));
  }
  geometry.computeVertexNormals();

  // Soft ground occlusion under the flower clumps: a static, sun-independent
  // darkening that grounds the plants the way a contact AO pass would.
  const patchUniforms = PATCHES.map(
    (p) => new THREE.Vector4(p.x, p.z, p.radius, p.view ? 0.095 : 0.065)
  );

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uNear: { value: new THREE.Color('#5b7440') },
      uFar: { value: new THREE.Color('#9eae6d') },
      uSun: { value: new THREE.Color('#f3dfae') },
      uSunDir: { value: new THREE.Vector3(5.5, 8.5, 4.5).normalize() },
      uSunStrength: { value: 1 },
      uHaze: { value: new THREE.Color('#e7dfc3') },
      uHazeAmount: { value: 1 },
      uCloudShadow: { value: 0.9 },
      uTime: { value: 0 },
      uPatches: { value: patchUniforms }
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vN;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uNear;
      uniform vec3 uFar;
      uniform vec3 uSun;
      uniform vec3 uSunDir;
      uniform float uSunStrength;
      uniform vec3 uHaze;
      uniform float uHazeAmount;
      uniform float uCloudShadow;
      uniform float uTime;
      uniform vec4 uPatches[${PATCHES.length}];
      varying vec3 vWorld;
      varying vec3 vN;
      ${NOISE_GLSL}
      ${HAZE_GLSL}

      void main() {
        float d = length(vWorld - cameraPosition);
        vec3 col = mix(uNear, uFar, smoothstep(2.0, 44.0, d));

        float n1 = vnoise(vWorld.xz * 0.23);
        float n2 = vnoise(vWorld.xz * 1.10);
        float n3 = vnoise(vWorld.xz * 4.50);
        col *= 0.93 + n1 * 0.13 + n2 * 0.045;
        col += (n3 - 0.5) * 0.025;

        // The slope now actually catches the sun.
        float nd = max(dot(normalize(vN), normalize(uSunDir)), 0.0);
        col *= 0.72 + 0.28 * nd;
        col += uSun * nd * 0.05 * uSunStrength;

        // A very quiet colour lift on the crest.
        float crest = smoothstep(0.0, 2.4, vWorld.y);
        col = mix(col, uFar, crest * 0.14);

        // Contact AO beneath the flower clumps: soft, static, and strongest
        // right around each patch so the plants sit in the ground.
        float ao = 1.0;
        for (int i = 0; i < ${PATCHES.length}; i++) {
          vec4 p = uPatches[i];
          vec2 dv = vWorld.xz - p.xy;
          float falloff = exp(-dot(dv, dv) / max(p.z * p.z * 1.55, 0.02));
          ao *= 1.0 - p.w * falloff;
        }
        col *= max(ao, 0.80);

        // Cloud shadows: project the low deck along the sun direction so the
        // bands stretch at sunrise/sunset, and let them drift with the wind.
        vec2 sunXZ = uSunDir.xz / max(uSunDir.y, 0.18);
        vec2 deckDrift = vec2(uTime * 1.35, uTime * 0.42);
        vec2 deckPos = (vWorld.xz - sunXZ * 26.0 + deckDrift) * 0.016;
        float d1 = vnoise(deckPos);
        float d2 = vnoise(deckPos * 2.7 + 9.0);
        float deck = smoothstep(0.38, 0.72, d1 * 0.7 + d2 * 0.3);
        float shade = deck * uCloudShadow * clamp(uSunStrength, 0.0, 1.0);
        col *= 1.0 - shade * 0.22;

        // a much finer dapple on top of the big shadow bands
        float fine = vnoise(vWorld.xz * 0.072 + deckDrift * 0.5 + 11.0);
        col *= 0.97 + 0.03 * fine;

        float fleck = smoothstep(0.988, 1.0, vnoise(vWorld.xz * 8.0));
        col = mix(col, vec3(0.86, 0.80, 0.57), fleck * 0.18 * (1.0 - smoothstep(18.0, 55.0, d)));

        vec3 viewDir = normalize(vWorld - cameraPosition);
        float fog = aerialFog(d, 0.0) * uHazeAmount;
        vec3 fogCol = aerialColor(uHaze, uSun, uSunDir, viewDir, vWorld.xz, uTime);
        col = mix(col, fogCol, clamp(fog, 0.0, 0.985));

        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return { mesh, material };
}

/* ------------------------------------------------------------------ */
/* full valley: a real, encircling mountain heightfield                */
/*                                                                     */
/* The old scene stacked three billboard ridges behind a 210 m patch.  */
/* This heightfield is one continuous bowl: a flat clearing, a gentle  */
/* meadow floor, low foothills and an outer ring of mountains that      */
/* climbs all the way to the mesh edge. Because the mountains are part */
/* of the same surface, orbiting the camera gives real parallax,        */
/* occlusion and slope shading instead of a flat cut-out.              */
/* ------------------------------------------------------------------ */

const VALLEY_RADIUS = 345;
const VALLEY_CENTER = { x: 0, z: 0 };

function floorWave(x, z) {
  return (
    0.55 * Math.sin(x * 0.070 + z * 0.030 + 1.15) +
    0.26 * Math.sin(x * 0.170 - z * 0.055 + 2.30) +
    0.09 * Math.sin(x * 0.430 + z * 0.230 + 4.00)
  );
}

const FLOOR_ORIGIN = floorWave(0, 0);

export function valleyHeight(x, z) {
  const r = Math.hypot(x, z);
  const a = Math.atan2(x, z);

  // The dandelion clearing stays flat; the rest of the floor rolls gently.
  const clearing = smoothstep(0.55, 2.35, r);
  const floor = (floorWave(x, z) - FLOOR_ORIGIN) * clearing;

  // Two soft swells give the meadow some relief without blocking the view.
  const moundA = 1.9 * Math.exp(-(
    ((x + 34) / 24) ** 2 + ((z + 22) / 19) ** 2
  ));
  const moundB = 1.35 * Math.exp(-(
    ((x - 42) / 30) ** 2 + ((z + 40) / 24) ** 2
  ));
  const mounds = (moundA + moundB) * clearing;

  // A very shallow bowl: the floor lifts a little as it leaves the centre.
  const bowl = 0.0002 * r * r;

  // Rolling foothills. Their crest undulates around the valley.
  const footWave = Math.max(
    0.18,
    0.52 + 0.30 * Math.sin(a * 3.0 + 1.3) + 0.18 * Math.sin(a * 7.0 + 2.6)
  );
  const foot = 8.5 * smoothstep(42, 105, r) * (
    1 - 0.45 * smoothstep(115, 210, r)
  ) * footWave;

  // Main mountain ring. Different angular octaves give separate peaks and
  // saddles, so the skyline reads as a range rather than a smooth crater.
  const ridgeWave = Math.max(
    0.24,
    0.62 +
    0.40 * Math.sin(a * 2.0 + 0.7) +
    0.17 * Math.sin(a * 5.0 + 2.4) +
    0.07 * Math.sin(a * 9.0 + 4.6)
  );
  // The range rises to a crest around r=232, then falls away on the far
  // side. The camera sits inside the bowl, so the descending outer face is
  // hidden behind the crest and the skyline keeps its gaps and saddles.
  const ascend = Math.pow(smoothstep(105, 232, r), 1.25);
  const descend = 1 - 0.92 * smoothstep(245, 345, r);
  const crags = .10 * Math.sin(a*19 + .8) + .045 * Math.sin(a*37);
  const ridge = 60 * ascend * descend * (ridgeWave + crags);

  // Folds and spurs carved into the inner mountain face.
  const relief = smoothstep(72, 150, r);
  const detail = (
    Math.sin(a * 7.0 + r * 0.055) +
    0.55 * Math.sin(a * 13.0 - r * 0.031) +
    0.30 * Math.sin(a * 21.0 + r * 0.017 + 1.7)
  ) * (0.9 + 2.3 * smoothstep(120, 270, r)) * relief;

  return floor + bowl + mounds + foot + ridge + detail;
}

/** Gradient magnitude of the valley surface — used to keep grass on
 *  ground a plant could actually grow on. */
export function valleySlope(x, z) {
  const e = 0.8;
  const hx = (valleyHeight(x + e, z) - valleyHeight(x - e, z)) / (2 * e);
  const hz = (valleyHeight(x, z + e) - valleyHeight(x, z - e)) / (2 * e);
  return Math.hypot(hx, hz);
}

function buildValleyGeometry({ rings, segments, radius }) {
  const positions = [0, valleyHeight(0, 0), 0];
  const indices = [];

  for (let i = 1; i <= rings; i++) {
    const t = i / rings;
    const r = radius * Math.pow(t, 1.55);
    for (let j = 0; j < segments; j++) {
      const a = (j / segments) * TAU;
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      positions.push(x, valleyHeight(x, z), z);
    }
  }

  // centre fan
  for (let j = 0; j < segments; j++) {
    const cur = 1 + j;
    const next = 1 + (j + 1) % segments;
    indices.push(0, cur, next);
  }

  // ring quads
  for (let i = 1; i < rings; i++) {
    const inner = 1 + (i - 1) * segments;
    const outer = 1 + i * segments;
    for (let j = 0; j < segments; j++) {
      const jn = (j + 1) % segments;
      const a = inner + j;
      const b = inner + jn;
      const c = outer + j;
      const d = outer + jn;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export function createValleyTerrain({ coarse = false } = {}) {
  const geometry = buildValleyGeometry({
    rings: coarse ? 100 : 150,
    segments: coarse ? 176 : 248,
    radius: VALLEY_RADIUS
  });

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uMeadowNear: { value: new THREE.Color('#47612f') },
      uMeadowFar: { value: new THREE.Color('#8fa05f') },
      uScrub: { value: new THREE.Color('#4d602c') },
      uForest: { value: new THREE.Color('#2e4026') },
      uRock: { value: new THREE.Color('#878173') },
      uRockDark: { value: new THREE.Color('#4f4d42') },
      uSun: { value: new THREE.Color('#f3dfae') },
      uSunDir: { value: new THREE.Vector3(5.5, 8.5, 4.5).normalize() },
      uSunStrength: { value: 1 },
      uHaze: { value: new THREE.Color('#e7dfc3') },
      uHazeAmount: { value: 1 },
      uCloudShadow: { value: 0.9 },
      uTime: { value: 0 }
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vN;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uMeadowNear;
      uniform vec3 uMeadowFar;
      uniform vec3 uScrub;
      uniform vec3 uForest;
      uniform vec3 uRock;
      uniform vec3 uRockDark;
      uniform vec3 uSun;
      uniform vec3 uSunDir;
      uniform float uSunStrength;
      uniform vec3 uHaze;
      uniform float uHazeAmount;
      uniform float uCloudShadow;
      uniform float uTime;
      varying vec3 vWorld;
      varying vec3 vN;

      ${NOISE_GLSL}
      ${HAZE_GLSL}

      // The valley is ~690 m across, so the old 0.021 fog exponent would
      // erase the peaks. This wider curve keeps aerial depth readable.
      float valleyFog(float d, float h) {
        float x = max(d - 10.0, 0.0) * 0.0017;
        float f = 1.0 - exp(-pow(x, 1.35));
        f *= mix(1.0, 0.90, clamp(h / 130.0, 0.0, 1.0));
        return clamp(f, 0.0, 0.88);
      }

      void main() {
        vec3 N = normalize(vN);
        float d = length(vWorld - cameraPosition);
        float h = vWorld.y;
        float slope = 1.0 - clamp(N.y, 0.0, 1.0);

        float n1 = vnoise(vWorld.xz * 0.035);
        float n2 = vnoise(vWorld.xz * 0.16);
        float n3 = vnoise(vWorld.xz * 0.9);
        float tuft = vnoise(vWorld.xz * 0.62 + 6.2);
        float micro = vnoise(vWorld.xz * 2.4 - 2.8);

        // meadow: green and dappled, a little drier toward the distance.
        // The 0.6–0.9 m octave stands in for individual tufts and their
        // shadows once the real grass cards become sub-pixel.
        vec3 col = mix(uMeadowNear, uMeadowFar, smoothstep(8.0, 110.0, d));
        col *= 0.85 + 0.15 * n1 + 0.09 * n2 + 0.06 * tuft;
        col *= 0.98 + 0.04 * micro;

        float dry = smoothstep(0.64, 0.90, vnoise(vWorld.xz * 0.32 + 2.1));
        col = mix(col, vec3(0.74, 0.68, 0.42), dry * 0.09);
        col += (n3 - 0.5) * 0.02;

        // Flower-rich drifts. At valley scale the geometry flowers are only
        // a few pixels wide, so soft colour fields carry the bloom from the
        // middle distance instead of leaving a plain green carpet.
        float bloomA = vnoise(vWorld.xz * 0.055 + 3.8);
        float bloomB = vnoise(vWorld.xz * 0.21 - 1.7);
        float bloom = smoothstep(0.44, 0.74, bloomA * 0.6 + bloomB * 0.4);
        float bloomMask = (1.0 - smoothstep(30.0, 52.0, h)) *
                          (1.0 - smoothstep(0.26, 0.46, slope)) *
                          smoothstep(12.0, 42.0, d);
        vec3 bloomWarm = vec3(0.92, 0.85, 0.52);
        vec3 bloomCool = vec3(0.73, 0.75, 0.90);
        vec3 bloomPale = vec3(0.94, 0.93, 0.84);
        vec3 bloomCol = mix(bloomWarm, bloomCool,
                            smoothstep(0.34, 0.66, vnoise(vWorld.xz * 0.08 + 9.0)));
        bloomCol = mix(bloomCol, bloomPale,
                       smoothstep(0.62, 0.88, bloomB) * 0.6);
        col = mix(col, bloomCol, bloom * bloomMask * 0.14);
        float petal = smoothstep(0.70, 0.92, vnoise(vWorld.xz * 1.4 + 8.1));
        col = mix(col, bloomPale, petal * bloomMask * smoothstep(22.0, 60.0, d) * 0.07);

        // scrub and woodland take over as the ground starts to climb
        float scrub = smoothstep(0.45, 0.82, vnoise(vWorld.xz * 0.09 + 5.3));
        scrub *= smoothstep(2.0, 12.0, h) * (1.0 - smoothstep(32.0, 58.0, h));
        col = mix(col, uScrub * (0.86 + 0.22 * n2), scrub * 0.62);

        float forest = smoothstep(0.45, 0.80, vnoise(vWorld.xz * 0.055 - 3.1));
        forest *= smoothstep(7.0, 20.0, h) * (1.0 - smoothstep(46.0, 84.0, h));
        vec3 forestCol = uForest * (0.80 + 0.30 * n2 + 0.10 * n3);
        col = mix(col, forestCol, forest * 0.82);

        // rock on steep faces and high crests
        float rockMask = smoothstep(0.52, 0.90, slope);
        rockMask = max(rockMask, smoothstep(78.0, 125.0, h) * 0.90);
        rockMask *= 0.60 + 0.40 * smoothstep(0.20, 0.80, n2);
        vec3 rock = mix(uRockDark, uRock, n2);
        rock *= 0.94 + 0.10 * sin(h * 0.55 + vWorld.x * 0.02 + vWorld.z * 0.015);
        col = mix(col, rock, clamp(rockMask, 0.0, 0.90));

        // slope lighting
        float nd = max(dot(N, normalize(uSunDir)), 0.0);
        col *= 0.70 + 0.36 * nd;
        col += uSun * nd * 0.055 * uSunStrength;

        // a quiet rim on the crest, matching the old hills
        float crest = smoothstep(0.35, 0.95, slope) * smoothstep(28.0, 80.0, h);
        col += uSun * crest * 0.045 * uSunStrength;

        // cloud shadows, projected like the meadow so the whole bowl darkens
        vec2 sunXZ = uSunDir.xz / max(uSunDir.y, 0.18);
        vec2 deckDrift = vec2(uTime * 1.35, uTime * 0.42);
        vec2 deckPos = (vWorld.xz - sunXZ * 26.0 + deckDrift) * 0.016;
        float d1 = vnoise(deckPos);
        float d2 = vnoise(deckPos * 2.7 + 9.0);
        float deck = smoothstep(0.38, 0.72, d1 * 0.7 + d2 * 0.3);
        float shade = deck * uCloudShadow * clamp(uSunStrength, 0.0, 1.0);
        col *= 1.0 - shade * 0.22;

        vec3 viewDir = normalize(vWorld - cameraPosition);
        float fog = valleyFog(d, h) * uHazeAmount;
        float ridge = smoothstep(90., 270., d) * smoothstep(3., 55., h);
        col = mix(col, vec3(.16,.26,.29) * (.72+.32*nd), ridge*.83);
        vec3 fogCol = aerialColor(uHaze, uSun, uSunDir, viewDir, vWorld.xz, uTime);
        col = mix(col, fogCol, fog);

        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.receiveShadow = false;
  return { mesh, material, radius: VALLEY_RADIUS, center: VALLEY_CENTER };
}

/* ------------------------------------------------------------------ */
/* meadow material                                                     */
/* ------------------------------------------------------------------ */

function createMeadowMaterial() {
  const uniforms = {
    uTime: { value: 0 },
    uStrength: { value: 0 },
    uWind: { value: new THREE.Vector3(1, 0, 0) },
    uLocalStrength: { value: 0 },
    uLocalWind: { value: new THREE.Vector2(1, 0) },
    uSweepA: { value: new THREE.Vector2() },
    uSweepB: { value: new THREE.Vector2() },
    uRadiusNdc: { value: 0.35 },
    uAspect: { value: 1.6 },
    uSun: { value: new THREE.Color('#f0e0ad') },
    uSunDir: { value: new THREE.Vector3(5.5, 8.5, 4.5).normalize() },
    uSunStrength: { value: 1 },
    uHaze: { value: new THREE.Color('#e3ddc2') },
    uHazeAmount: { value: 1 },
    uCloudShadow: { value: 0.9 },
    uBendScale: { value: 1.0 },
    uTranslucency: { value: 0.16 },
    uRootAo: { value: 0.22 }
  };

  const material = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uStrength;
      uniform vec3 uWind;
      uniform float uLocalStrength;
      uniform vec2 uLocalWind;
      uniform vec2 uSweepA;
      uniform vec2 uSweepB;
      uniform float uRadiusNdc;
      uniform float uAspect;
      uniform vec3 uSun;
      uniform vec3 uSunDir;
      uniform vec3 uHaze;
      uniform float uBendScale;
      uniform float uSunStrength;
      uniform float uTranslucency;
      uniform float uRootAo;
      uniform float uHazeAmount;
      uniform float uCloudShadow;

      attribute vec3 color;
      attribute float aBend;
      attribute float aPhase;
      attribute float aFlutter;
      attribute float aInstancePhase;
      attribute float aInstanceShade;

      varying vec3 vColor;
      ${NOISE_GLSL}
      ${HAZE_GLSL}

      float distToSegment(vec2 p, vec2 a, vec2 b) {
        vec2 ab = b - a;
        float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
        return length(p - (a + ab * t));
      }

      void main() {
        vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vec4 root4 = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec3 root = root4.xyz;

        float h = clamp(aBend, 0.0, 1.0);
        float phase = aPhase + aInstancePhase;

        // The local gust is evaluated at the clump root, not per leaf, so
        // one clump bends as a unit and its root stays planted.
        vec4 clip0 = projectionMatrix * viewMatrix * root4;
        vec2 ndc = clip0.xy / max(clip0.w, 1e-4);
        vec2 aspectFix = vec2(uAspect, 1.0);
        float dLocal = distToSegment(ndc * aspectFix, uSweepA * aspectFix, uSweepB * aspectFix);
        float localFall = 1.0 - smoothstep(uRadiusNdc * 0.12, uRadiusNdc, dLocal);

        float wl = length(uWind.xz);
        vec2 wdir = wl > 0.001 ? normalize(uWind.xz) : vec2(0.74, 0.36);

        float ambientSway =
          uStrength * (0.85 + 0.15 * sin(uTime * 0.43 + world.x * 0.035 + world.z * 0.028));
        float idleAngle =
          sin(uTime * 1.15 + phase + world.x * 0.30) * 0.018 +
          sin(uTime * 0.47 + phase * 1.75 + world.z * 0.42) * 0.011 +
          ambientSway * 0.070;

        float localRipple =
          0.82 +
          0.12 * sin(uTime * 1.25 + phase * 1.9 + dLocal * 12.0) +
          0.06 * sin(uTime * 0.63 + phase * 2.4);

        float localAngle =
          uLocalStrength * localFall * localRipple *
          (0.54 + 0.035 * sin(uTime * 0.9 + phase)) *
          (0.70 + 0.30 * aInstanceShade);

        vec2 localDir = uLocalWind + vec2(sin(phase * 2.3), cos(phase * 1.7)) * 0.09;
        localDir = length(localDir) > 1e-4 ? normalize(localDir) : vec2(0.7, 0.3);

        vec2 bendVec = wdir * idleAngle + localDir * localAngle;
        float angle = length(bendVec);
        vec2 bendDir = angle > 1e-5 ? bendVec / angle : vec2(0.0);

        vec3 wind3 = vec3(bendDir.x, 0.0, bendDir.y);
        vec3 axis = vec3(0.0, 0.0, -1.0);
        if (dot(wind3, wind3) > 1e-8) {
          axis = normalize(cross(vec3(0.0, 1.0, 0.0), wind3));
        }

        float rot = angle * uBendScale * pow(h, 1.15);
        float rc = cos(rot);
        float rs = sin(rot);
        vec3 rel = world.xyz - root;
        vec3 bent = rel * rc + cross(axis, rel) * rs + axis * dot(axis, rel) * (1.0 - rc);
        world.xyz = root + bent;

        // The tips / petals breathe a little, but roots (aFlutter -> 0 at
        // the base) do not slide out of the stem.
        world.xyz += vec3(
          sin(uTime * 2.4 + phase * 2.1),
          sin(uTime * 1.9 + phase * 3.0) * 0.5,
          cos(uTime * 2.2 + phase * 1.6)
        ) * (aFlutter * 0.006 * h);

        vec3 n = normalize(mat3(instanceMatrix) * normal);
        vec3 sunDir = normalize(uSunDir);
        float sunFacing = abs(dot(n, sunDir));

        vec3 col = color * (0.84 + aInstanceShade * 0.30);
        col *= 0.86 + 0.14 * sunFacing;

        // Ambient occlusion between the blades: roots sit in their own shade.
        float ao = mix(1.0 - uRootAo, 1.0, smoothstep(0.0, 0.40, h));
        col *= ao;

        float tip = smoothstep(0.38, 1.0, h);
        col += uSun * tip * (0.022 + 0.018 * sunFacing) *
               smoothstep(-2.0, 26.0, world.x) * uSunStrength;

        // Back-lit leaves glow: light passing through the blade toward the
        // camera. This is the strongest cue at golden hour.
        vec3 V = normalize(cameraPosition - world.xyz);
        float back = pow(max(dot(-V, sunDir), 0.0), 2.2);
        col += uSun * back * tip * uTranslucency * uSunStrength;

        // A thin sheen on the blade surface, sun-side only.
        vec3 Hv = normalize(V + sunDir);
        float spec = pow(max(abs(dot(n, Hv)), 0.0), 26.0);
        col += uSun * spec * 0.07 * uSunStrength;

        // Cloud shadows projected along the sun, identical to the terrain so the
        // grass and ground darken as one field.
        vec2 sunXZ = sunDir.xz / max(sunDir.y, 0.18);
        vec2 deckDrift = vec2(uTime * 1.35, uTime * 0.42);
        vec2 deckPos = (world.xz - sunXZ * 26.0 + deckDrift) * 0.016;
        float d1 = vnoise(deckPos);
        float d2 = vnoise(deckPos * 2.7 + 9.0);
        float deck = smoothstep(0.38, 0.72, d1 * 0.7 + d2 * 0.3);
        float shade = deck * uCloudShadow * clamp(uSunStrength, 0.0, 1.0);
        col *= 1.0 - shade * 0.2;

        float fine = vnoise(world.xz * 0.072 + deckDrift * 0.5 + 11.0);
        col *= 0.97 + 0.03 * fine;

        vec4 mv = viewMatrix * world;
        vec3 toCam = cameraPosition - world.xyz;
        float viewDist = length(toCam);
        vec3 viewDir = toCam / max(viewDist, 1e-4);
        float fog = aerialFog(viewDist, h) * uHazeAmount;
        vec3 fogCol = aerialColor(uHaze, uSun, sunDir, viewDir, world.xz, uTime);
        col = mix(col, fogCol, clamp(fog, 0.0, 0.97));

        vColor = col;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() {
        gl_FragColor = vec4(vColor, 1.0);
        #include <colorspace_fragment>
      }
    `
  });

  return material;
}

/* ------------------------------------------------------------------ */
/* flower patches & scatter                                            */
/* ------------------------------------------------------------------ */

const CAMERA_Z = 9.4;

// The near patches sit in front of the dandelion, where the camera can
// actually see a 0.5 m flower. `view` carves a low-grass sight lane from
// the camera to the patch; `scale` makes foreground flowers readable.
const PATCHES = [
  { asset: 'flower-daisy',     x: 3.0,  z: 2.0,   radius: 1.70, count: 46, scale: 1.60, view: true },
  { asset: 'flower-buttercup', x: -3.2, z: 1.0,   radius: 1.60, count: 42, scale: 1.55, view: true },
  { asset: 'flower-forget',    x: 4.1,  z: -1.0,  radius: 1.40, count: 38, scale: 1.50, view: true },
  { asset: 'flower-lavender',  x: -4.6, z: -2.0,  radius: 1.60, count: 38, scale: 1.45, view: true },
  { asset: 'flower-daisy',     x: 2.9,  z: -6.0,  radius: 1.90, count: 40, scale: 1.35 },
  { asset: 'flower-buttercup', x: -3.3, z: -8.0,  radius: 1.90, count: 40, scale: 1.30 },
  { asset: 'flower-forget',    x: 5.0,  z: -10.5, radius: 1.90, count: 36, scale: 1.25 },
  { asset: 'flower-lavender',  x: -5.8, z: -12.5, radius: 1.90, count: 36, scale: 1.25 },
  { asset: 'flower-daisy',     x: 1.7,  z: -16.0, radius: 2.10, count: 30, scale: 1.10 },
  { asset: 'flower-buttercup', x: -6.0, z: -20.0, radius: 2.10, count: 30, scale: 1.00 },
  { asset: 'flower-forget',    x: 7.2,  z: -22.0, radius: 2.10, count: 28, scale: 1.00 },
  { asset: 'flower-lavender',  x: -9.0, z: -25.0, radius: 2.10, count: 28, scale: 1.00 }
];

function inSightCorridor(x, z, patch) {
  if (!patch.view) return false;
  if (z > CAMERA_Z || z < patch.z) return false;
  const t = (CAMERA_Z - z) / (CAMERA_Z - patch.z);
  const lineX = patch.x * t;
  const width = 0.65 + (1.0 - t) * 0.25;
  return Math.abs(x - lineX) < width;
}

/* Deterministic scatter of wildflower patches across the whole basin.
   The near PATCHES above stay as the readable foreground layer; these
   fill the middle distance so the meadow does not read as plain green. */
function seeded(i, salt) {
  const s = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

const VALLEY_PATCHES = (() => {
  const assets = [
    'flower-daisy',
    'flower-buttercup',
    'flower-forget',
    'flower-lavender'
  ];
  const list = [];
  const attempts = 56;

  for (let i = 0; i < attempts; i++) {
    const angle = i * 2.399963229728653;
    const t = (i + 0.7) / attempts;
    const r = 9 + 84 * Math.pow(t, 0.75);
    const x = Math.sin(angle) * r;
    const z = Math.cos(angle) * r;

    const h = valleyHeight(x, z);
    const slope = valleySlope(x, z);
    if (h > 18 || slope > 0.38) continue;

    list.push({
      asset: assets[i % assets.length],
      x,
      z,
      radius: 2.8 + seeded(i, 1) * 3.2,
      count: 24 + Math.floor(seeded(i, 2) * 26),
      scale: 1.25 + seeded(i, 3) * 0.75,
      view: false
    });
  }
  return list;
})();

export function getValleyPatches({ minRadius = 0, maxRadius = Infinity } = {}) {
  return VALLEY_PATCHES.concat(PATCHES).filter((patch) => {
    const r = Math.hypot(patch.x, patch.z);
    return r >= minRadius && r < maxRadius;
  });
}

const GRASS = VEGETATION_ASSETS.filter((asset) => asset.kind === 'grass');
const FLOWERS = VEGETATION_ASSETS.filter((asset) => asset.kind === 'flower');

// Deliberately equal weights: all five grass silhouettes appear in the
// same proportion, then the seed variants add the finer variation.
const GRASS_WEIGHTS = {
  'grass-silver': 0.20,
  'grass-meadow': 0.20,
  'grass-low': 0.20,
  'grass-dry': 0.20,
  'grass-broad': 0.20
};

function pickGrassAsset(z) {
  const weights = { ...GRASS_WEIGHTS };
  let sum = 0;
  for (const asset of GRASS) sum += weights[asset.id] || 0;
  let r = Math.random() * sum;
  for (const asset of GRASS) {
    r -= weights[asset.id] || 0;
    if (r <= 0) return asset;
  }
  return GRASS[0];
}

export function createAssetMeadow({
  coarse = false,
  layout = 'strip',
  heightAt = terrainHeight,
  slopeAt = null,
  radius = 92,
  minRadius = 0,
  maxHeight = 20,
  maxSlope = 0.45,
  count = null,
  patches = null,
  material = null
} = {}) {
  const entries = new Map();
  for (const asset of VEGETATION_ASSETS) {
    for (let v = 0; v < 3; v++) entries.set(`${asset.id}:${v}`, []);
  }

  const activePatches = patches || (layout === 'valley'
    ? VALLEY_PATCHES.concat(PATCHES)
    : PATCHES);
  const target = count || (coarse ? 5000 : 9000);
  let total = 0;
  let guard = 0;

  while (total < target && guard < target * 4) {
    guard++;

    let x;
    let z;
    if (layout === 'valley') {
      // A radial scatter fills the whole basin instead of one strip in
      // front of the camera. The inner disc is biased toward the centre;
      // outer LOD rings are sampled uniformly by area.
      const a = Math.random() * TAU;
      const u = Math.random();
      const rr = minRadius > 0
        ? Math.sqrt(minRadius * minRadius +
          (radius * radius - minRadius * minRadius) * u)
        : radius * Math.pow(u, 0.62);
      x = Math.sin(a) * rr;
      z = Math.cos(a) * rr;
    } else {
      // Bias the depth toward the camera: most clumps live in the near
      // and middle field, where the extra density actually reads.
      const u = Math.random();
      z = 8.0 - Math.pow(u, 1.5) * 42.0;
      x = (Math.random() * 2 - 1) * (18.0 + Math.abs(z) * 0.55);
    }
    if (x * x + z * z < 1.25 * 1.25 || (layout === 'valley' && onTrail(x, z))) continue;

    // In the valley, grass climbs the lower slopes and stops where the
    // ground turns to rock.
    if (layout === 'valley') {
      if (heightAt(x, z) > maxHeight) continue;
      if (slopeAt && slopeAt(x, z) > maxSlope) continue;
    }

    // Thin the grass into a soft low lane between the camera and the near
    // flower patches, otherwise 1.3 m foreground grass completely hides the
    // 0.5 m flowers. A radial valley has no single sight lane.
    let short = 1.0;
    let skip = false;
    if (layout !== 'valley') {
      for (const patch of activePatches) {
        if (!inSightCorridor(x, z, patch)) continue;
        if (Math.random() < 0.35) {
          skip = true;
          break;
        }
        short = Math.min(short, 0.45);
      }
      if (skip) continue;
    }

    // Thin and shorten the grass inside flower patches so the flowers
    // keep their heads above the meadow.
    for (const patch of activePatches) {
      const dx = x - patch.x;
      const dz = z - patch.z;
      if (dx * dx + dz * dz < patch.radius * patch.radius) {
        const skipChance = patch.view ? 0.38 : 0.32;
        if (Math.random() < skipChance) {
          skip = true;
          break;
        }
        short = Math.min(short, patch.view ? 0.52 : 0.62);
        break;
      }
    }
    if (skip) continue;

    const asset = pickGrassAsset(z);
    const variant = Math.floor(Math.random() * 3);
    const base = 0.78 + Math.random() * 0.5;
    const tall = layout === 'valley' ? 1.0 : (z > 2.0 ? 1.06 : 1.0);
    entries.get(`${asset.id}:${variant}`).push({
      x,
      z,
      y: heightAt(x, z),
      sx: base * (0.90 + Math.random() * 0.22),
      sy: base * tall * short,
      yaw: Math.random() * TAU,
      phase: Math.random() * TAU,
      shade: Math.random()
    });
    total++;
  }

  const flowerMul = coarse ? 0.72 : 1.0;
  for (const patch of activePatches) {
    const asset = FLOWERS.find((a) => a.id === patch.asset);
    if (!asset) continue;
    const count = Math.max(1, Math.round(patch.count * flowerMul));
    for (let i = 0; i < count; i++) {
      const r = Math.sqrt(Math.random()) * patch.radius;
      const a = Math.random() * TAU;
      const x = patch.x + Math.cos(a) * r;
      const z = patch.z + Math.sin(a) * r;
      if (x * x + z * z < 1.25 * 1.25 || (layout === 'valley' && onTrail(x, z))) continue;
      const variant = Math.floor(Math.random() * 3);
      const base = (0.90 + Math.random() * 0.30) * (patch.scale || 1.0);
      entries.get(`${asset.id}:${variant}`).push({
        x,
        z,
        y: heightAt(x, z),
        sx: base,
        sy: base * (0.92 + Math.random() * 0.16),
        yaw: Math.random() * TAU,
        phase: Math.random() * TAU,
        shade: Math.random()
      });
    }
  }

  const group = new THREE.Group();
  const mat = material || createMeadowMaterial();
  const meshes = [];
  const dummy = new THREE.Object3D();
  let grassCount = 0;
  let flowerCount = 0;

  for (const asset of VEGETATION_ASSETS) {
    for (let variant = 0; variant < 3; variant++) {
      const list = entries.get(`${asset.id}:${variant}`);
      if (!list.length) continue;

      const geometry = asset.build(asset.seeds[variant]);
      const mesh = new THREE.InstancedMesh(geometry, mat, list.length);
      mesh.frustumCulled = false;

      const phases = new Float32Array(list.length);
      const shades = new Float32Array(list.length);

      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        dummy.position.set(e.x, e.y, e.z);
        dummy.rotation.set(0, e.yaw, 0);
        dummy.scale.set(e.sx, e.sy, e.sx);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        phases[i] = e.phase;
        shades[i] = e.shade;
      }

      geometry.setAttribute('aInstancePhase', new THREE.InstancedBufferAttribute(phases, 1));
      geometry.setAttribute('aInstanceShade', new THREE.InstancedBufferAttribute(shades, 1));
      mesh.instanceMatrix.needsUpdate = true;

      group.add(mesh);
      meshes.push(mesh);
      if (asset.kind === 'grass') grassCount += list.length;
      else flowerCount += list.length;
    }
  }

  return { group, material: mat, meshes, grassCount, flowerCount, patches: activePatches };
}