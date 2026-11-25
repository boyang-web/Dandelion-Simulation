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
/* meadow material                                                     */
/* ------------------------------------------------------------------ */

function createMeadowMaterial() {
  const uniforms = {
    uTime: { value: 0 },
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

        float idleAngle =
          sin(uTime * 1.15 + phase + world.x * 0.30) * 0.018 +
          sin(uTime * 0.47 + phase * 1.75 + world.z * 0.42) * 0.011;

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

        vec2 bendVec = vec2(0.74, 0.36) / 0.827 * idleAngle + localDir * localAngle;
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

export function createAssetMeadow({ coarse = false } = {}) {
  const entries = new Map();
  for (const asset of VEGETATION_ASSETS) {
    for (let v = 0; v < 3; v++) entries.set(`${asset.id}:${v}`, []);
  }

  const target = coarse ? 5000 : 9000;
  let total = 0;
  let guard = 0;

  while (total < target && guard < target * 4) {
    guard++;
    // Bias the depth toward the camera: most clumps live in the near
    // and middle field, where the extra density actually reads.
    const u = Math.random();
    const z = 8.0 - Math.pow(u, 1.5) * 42.0;
    const x = (Math.random() * 2 - 1) * (18.0 + Math.abs(z) * 0.55);
    if (x * x + z * z < 1.25 * 1.25) continue;

    // Thin the grass into a soft low lane between the camera and the near
// flower patches, otherwise 1.3 m foreground grass completely hides the
// 0.5 m flowers.
    let short = 1.0;
    let skip = false;
    for (const patch of PATCHES) {
      if (!inSightCorridor(x, z, patch)) continue;
      if (Math.random() < 0.35) {
        skip = true;
        break;
      }
      short = Math.min(short, 0.45);
    }
    if (skip) continue;

    // Thin and shorten the grass inside flower patches so the flowers
    // keep their heads above the meadow.
    for (const patch of PATCHES) {
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
    const tall = z > 2.0 ? 1.06 : 1.0;
    entries.get(`${asset.id}:${variant}`).push({
      x,
      z,
      y: terrainHeight(x, z),
      sx: base * (0.90 + Math.random() * 0.22),
      sy: base * tall * short,
      yaw: Math.random() * TAU,
      phase: Math.random() * TAU,
      shade: Math.random()
    });
    total++;
  }

  const flowerMul = coarse ? 0.72 : 1.0;
  for (const patch of PATCHES) {
    const asset = FLOWERS.find((a) => a.id === patch.asset);
    if (!asset) continue;
    const count = Math.max(1, Math.round(patch.count * flowerMul));
    for (let i = 0; i < count; i++) {
      const r = Math.sqrt(Math.random()) * patch.radius;
      const a = Math.random() * TAU;
      const x = patch.x + Math.cos(a) * r;
      const z = patch.z + Math.sin(a) * r;
      if (x * x + z * z < 1.25 * 1.25) continue;
      const variant = Math.floor(Math.random() * 3);
      const base = (0.90 + Math.random() * 0.30) * (patch.scale || 1.0);
      entries.get(`${asset.id}:${variant}`).push({
        x,
        z,
        y: terrainHeight(x, z),
        sx: base,
        sy: base * (0.92 + Math.random() * 0.16),
        yaw: Math.random() * TAU,
        phase: Math.random() * TAU,
        shade: Math.random()
      });
    }
  }

  const group = new THREE.Group();
  const material = createMeadowMaterial();
  const meshes = [];
  const dummy = new THREE.Object3D();
  let grassCount = 0;
  let flowerCount = 0;

  for (const asset of VEGETATION_ASSETS) {
    for (let variant = 0; variant < 3; variant++) {
      const list = entries.get(`${asset.id}:${variant}`);
      if (!list.length) continue;

      const geometry = asset.build(asset.seeds[variant]);
      const mesh = new THREE.InstancedMesh(geometry, material, list.length);
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

  return { group, material, meshes, grassCount, flowerCount, patches: PATCHES };
}