import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/* Vegetation asset library                                            */
/*                                                                     */
/* Every asset is one merged BufferGeometry with:                      */
/*   position, color, normal                                           */
/*   aBend    0 at root -> 1 at the highest point (wind bend weight)   */
/*   aPhase   per-blade / per-petal phase                              */
/*   aFlutter extra tip motion                                         */
/*                                                                     */
/* The same geometry can be drawn as a single Mesh (asset shelf) or     */
/* fed to an InstancedMesh later by the meadow builder.                */
/* ------------------------------------------------------------------ */

const TAU = Math.PI * 2;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth01 = (t) => {
  t = clamp01(t);
  return t * t * (3 - 2 * t);
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function between(rng, a, b) {
  return a + (b - a) * rng();
}

function newContext() {
  return {
    positions: [],
    colors: [],
    bends: [],
    phases: [],
    flutters: [],
    indices: [],
    vertexCount: 0
  };
}

function addVertex(ctx, p, color, bend, phase, flutter) {
  ctx.positions.push(p.x, p.y, p.z);
  ctx.colors.push(color.r, color.g, color.b);
  ctx.bends.push(clamp01(bend));
  ctx.phases.push(phase);
  ctx.flutters.push(clamp01(flutter));
  return ctx.vertexCount++;
}

function gradient(base, mid, tip, t) {
  const c = new THREE.Color();
  if (t < 0.55) c.copy(base).lerp(mid, smooth01(t / 0.55));
  else c.copy(mid).lerp(tip, smooth01((t - 0.55) / 0.45));
  return c;
}

/* ------------------------------------------------------------------ */
/* grass blade / leaf                                                  */
/* ------------------------------------------------------------------ */

function addBlade(ctx, {
  x = 0,
  baseY = 0,
  z = 0,
  yaw = 0,
  rise = 0.8,
  width = 0.03,
  lean = 0.12,
  curve = 0,
  plantHeight = 1,
  base,
  mid,
  tip,
  phase = 0,
  flutter = 0.2,
  bendBoost = 0,
  shade = 1,
  rows = 6
}) {
  const dirX = Math.cos(yaw);
  const dirZ = Math.sin(yaw);
  const sideX = -dirZ;
  const sideZ = dirX;
  const start = ctx.vertexCount;

  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const outward = lean * Math.pow(t, 1.65) + curve * Math.sin(t * Math.PI) * t;
    const cx = x + dirX * outward;
    const cz = z + dirZ * outward;
    const cy = baseY + rise * t;

    const half = width * Math.pow(1 - t, 0.82);
    const keel = half * 0.28;
    const absolute = cy / Math.max(plantHeight, 1e-4);
    const bend = Math.pow(clamp01(absolute), 1.18) + bendBoost;
    const c = gradient(base, mid, tip, t).multiplyScalar(shade);

    for (let col = 0; col < 3; col++) {
      const s = col - 1;
      const p = new THREE.Vector3(
        cx + sideX * s * half,
        cy + (col === 1 ? keel : keel * 0.22),
        cz + sideZ * s * half
      );
      const vc = c.clone();
      if (col === 1) vc.multiplyScalar(1.045);
      else if (s < 0) vc.multiplyScalar(0.95);
      addVertex(ctx, p, vc, bend, phase, Math.pow(t, 2) * flutter);
    }
  }

  for (let i = 0; i < rows; i++) {
    const a = start + i * 3;
    ctx.indices.push(
      a, a + 1, a + 3,
      a + 1, a + 4, a + 3,
      a + 1, a + 2, a + 4,
      a + 2, a + 5, a + 4
    );
  }
}

/* ------------------------------------------------------------------ */
/* flower petal and centre                                             */
/* ------------------------------------------------------------------ */

function addPetal(ctx, {
  cx, cy, cz,
  angle = 0,
  length = 0.06,
  width = 0.025,
  cup = 0.012,
  pitch = 0.006,
  base,
  tip,
  phase = 0,
  flutter = 0.4,
  bend = 1,
  rows = 4
}) {
  const outX = Math.cos(angle);
  const outZ = Math.sin(angle);
  const sideX = -outZ;
  const sideZ = outX;
  const start = ctx.vertexCount;

  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const radius = length * t;
    const half = Math.pow(Math.sin(Math.PI * Math.min(t, 0.999)), 0.62) * width;
    const lift = cup * Math.sin(Math.PI * t) + pitch * t;
    const c = base.clone().lerp(tip, t);
    for (let col = 0; col < 3; col++) {
      const s = col - 1;
      const p = new THREE.Vector3(
        cx + outX * radius + sideX * s * half,
        cy + lift,
        cz + outZ * radius + sideZ * s * half
      );
      addVertex(ctx, p, c, bend, phase, flutter * t);
    }
  }

  for (let i = 0; i < rows; i++) {
    const a = start + i * 3;
    ctx.indices.push(
      a, a + 1, a + 3,
      a + 1, a + 4, a + 3,
      a + 1, a + 2, a + 4,
      a + 2, a + 5, a + 4
    );
  }
}

function addCenter(ctx, { x, y, z, radius, colorA, colorB, phase }) {
  const geo = new THREE.SphereGeometry(radius, 10, 6);
  const pos = geo.attributes.position;
  const idx = geo.index;
  const start = ctx.vertexCount;

  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const py = pos.getY(i) * 0.62;
    const pz = pos.getZ(i);
    const t = clamp01(py / radius + 0.5);
    const c = colorA.clone().lerp(colorB, t);
    addVertex(ctx, new THREE.Vector3(x + px, y + py, z + pz), c, 1, phase, 0.02);
  }
  if (idx) {
    for (let i = 0; i < idx.count; i++) {
      ctx.indices.push(start + idx.getX(i));
    }
  } else {
    for (let i = 0; i < pos.count; i += 3) {
      ctx.indices.push(start + i, start + i + 1, start + i + 2);
    }
  }
  geo.dispose();
}

/* ------------------------------------------------------------------ */
/* curved stem                                                         */
/* ------------------------------------------------------------------ */

function stemPoint(t, { height, leanX, leanZ, bowX, bowZ }) {
  return new THREE.Vector3(
    leanX * Math.pow(t, 1.45) + bowX * Math.sin(Math.PI * t),
    height * t,
    leanZ * Math.pow(t, 1.45) + bowZ * Math.sin(Math.PI * t)
  );
}

function addStem(ctx, {
  height,
  leanX,
  leanZ,
  bowX,
  bowZ,
  radius = 0.006,
  phase = 0,
  base,
  tip,
  segments = 9,
  sides = 5
}) {
  const points = [];
  for (let i = 0; i <= segments; i++) {
    points.push(stemPoint(i / segments, { height, leanX, leanZ, bowX, bowZ }));
  }
  const start = ctx.vertexCount;
  const up = new THREE.Vector3(0, 1, 0);
  const tangent = new THREE.Vector3();
  const side = new THREE.Vector3();
  const binormal = new THREE.Vector3();
  const ring = new THREE.Vector3();

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = points[i];
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(segments, i + 1)];
    tangent.copy(next).sub(prev).normalize();
    side.crossVectors(tangent, up);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    else side.normalize();
    binormal.crossVectors(tangent, side).normalize();

    const r = radius * (1 - 0.42 * t);
    const c = base.clone().lerp(tip, smooth01(t * 0.9));

    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * TAU;
      ring.copy(p)
        .addScaledVector(side, Math.cos(a) * r)
        .addScaledVector(binormal, Math.sin(a) * r);
      addVertex(ctx, ring.clone(), c, Math.pow(t, 1.18), phase, 0);
    }
  }

  for (let i = 0; i < segments; i++) {
    for (let s = 0; s < sides; s++) {
      const a = start + i * sides + s;
      const b = start + i * sides + (s + 1) % sides;
      const c = a + sides;
      const d = b + sides;
      ctx.indices.push(a, b, c, b, d, c);
    }
  }
}

/* ------------------------------------------------------------------ */
/* builders                                                            */
/* ------------------------------------------------------------------ */

function finalize(ctx, requestedHeight) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(ctx.positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(ctx.colors, 3));
  geometry.setAttribute('aBend', new THREE.Float32BufferAttribute(ctx.bends, 1));
  geometry.setAttribute('aPhase', new THREE.Float32BufferAttribute(ctx.phases, 1));
  geometry.setAttribute('aFlutter', new THREE.Float32BufferAttribute(ctx.flutters, 1));
  geometry.setIndex(ctx.indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.userData.height = requestedHeight;
  return geometry;
}

function buildGrass(spec, seed) {
  const rng = mulberry32(seed);
  const ctx = newContext();
  const height = between(rng, spec.height[0], spec.height[1]);
  const blades = Math.round(between(rng, spec.blades[0], spec.blades[1]));
  const base = new THREE.Color(spec.colors[0]);
  const mid = new THREE.Color(spec.colors[1]);
  const tip = new THREE.Color(spec.colors[2]);
  const root = base.clone().multiplyScalar(0.78);

  for (let i = 0; i < blades; i++) {
    const a = rng() * TAU;
    const radius = Math.sqrt(rng()) * spec.spread;
    const x = Math.cos(a) * radius;
    const z = Math.sin(a) * radius;
    const yaw = a + between(rng, -0.55, 0.55);
    const h = height * between(rng, 0.68, 1.06);
    const w = spec.width * between(rng, 0.72, 1.18);
    const lean = spec.lean * between(rng, 0.55, 1.35);

    addBlade(ctx, {
      x, z, yaw,
      rise: h,
      width: w,
      lean,
      curve: between(rng, -0.06, 0.06),
      plantHeight: height,
      base, mid, tip,
      phase: rng() * TAU,
      flutter: spec.flutter,
      shade: between(rng, 0.84, 1.09)
    });
  }

  for (let i = 0; i < spec.tuft; i++) {
    const a = rng() * TAU;
    const radius = Math.sqrt(rng()) * spec.spread * 0.55;
    addBlade(ctx, {
      x: Math.cos(a) * radius,
      z: Math.sin(a) * radius,
      yaw: a,
      rise: height * between(rng, 0.12, 0.25),
      width: spec.width * 0.6,
      lean: spec.lean * 0.55,
      plantHeight: height,
      base: root, mid: base, tip: mid,
      phase: rng() * TAU,
      flutter: 0.05,
      shade: between(rng, 0.72, 0.9)
    });
  }

  return finalize(ctx, height);
}

function buildFlower(spec, seed) {
  const rng = mulberry32(seed);
  const ctx = newContext();
  const height = between(rng, spec.height[0], spec.height[1]);
  const leanX = between(rng, -0.06, 0.07);
  const leanZ = between(rng, -0.04, 0.06);
  const bowX = between(rng, -0.05, 0.05);
  const bowZ = between(rng, -0.04, 0.04);
  const stem = { height, leanX, leanZ, bowX, bowZ };
  const stemBase = new THREE.Color(spec.stem[0]);
  const stemTip = new THREE.Color(spec.stem[1]);
  const leafBase = new THREE.Color(spec.leaf[0]);
  const leafMid = new THREE.Color(spec.leaf[1]);
  const leafTip = new THREE.Color(spec.leaf[2]);
  // The stem, leaves, centre and every petal share one bending phase:
  // the flower must move as one object, not as separate floating parts.
  const stemPhase = rng() * TAU;

  addStem(ctx, {
    ...stem,
    radius: spec.stemRadius,
    phase: stemPhase,
    base: stemBase,
    tip: stemTip
  });

  for (let i = 0; i < spec.leaves; i++) {
    const at = between(rng, 0.24, 0.72);
    const p = stemPoint(at, stem);
    addBlade(ctx, {
      x: p.x,
      baseY: p.y,
      z: p.z,
      yaw: rng() * TAU,
      rise: between(rng, 0.035, 0.085),
      width: spec.leafWidth * between(rng, 0.8, 1.2),
      lean: between(rng, 0.1, 0.2),
      curve: between(rng, -0.02, 0.02),
      plantHeight: height,
      base: leafBase,
      mid: leafMid,
      tip: leafTip,
      phase: stemPhase,
      flutter: 0.12,
      shade: between(rng, 0.9, 1.04)
    });
  }

  for (let i = 0; i < 2; i++) {
    addBlade(ctx, {
      x: between(rng, -0.02, 0.02),
      baseY: 0,
      z: between(rng, -0.02, 0.02),
      yaw: rng() * TAU,
      rise: between(rng, 0.025, 0.05),
      width: 0.022,
      lean: between(rng, 0.1, 0.16),
      plantHeight: height,
      base: leafBase,
      mid: leafMid,
      tip: leafTip,
      phase: stemPhase,
      flutter: 0.04,
      shade: 0.82
    });
  }

  const top = stemPoint(1, stem);
  const petalBase = new THREE.Color(spec.petal[0]);
  const petalTip = new THREE.Color(spec.petal[1]);

  if (spec.head === 'daisy') {
    const count = Math.round(between(rng, spec.petals[0], spec.petals[1]));
    for (let i = 0; i < count; i++) {
      addPetal(ctx, {
        cx: top.x, cy: top.y + 0.006, cz: top.z,
        angle: (i / count) * TAU + between(rng, -0.08, 0.08),
        length: between(rng, 0.048, 0.066),
        width: between(rng, 0.011, 0.016),
        cup: 0.008,
        pitch: 0.006,
        base: petalBase,
        tip: petalTip,
        phase: stemPhase,
        flutter: 0.32
      });
    }
    addCenter(ctx, {
      x: top.x, y: top.y + 0.012, z: top.z,
      radius: 0.023,
      colorA: new THREE.Color('#c9972f'),
      colorB: new THREE.Color('#f1cc6a'),
      phase: stemPhase
    });
  } else if (spec.head === 'buttercup') {
    for (let i = 0; i < 5; i++) {
      addPetal(ctx, {
        cx: top.x, cy: top.y + 0.008, cz: top.z,
        angle: (i / 5) * TAU + between(rng, -0.07, 0.07),
        length: between(rng, 0.045, 0.058),
        width: between(rng, 0.03, 0.04),
        cup: 0.026,
        pitch: 0.018,
        base: petalBase,
        tip: petalTip,
        phase: stemPhase,
        flutter: 0.36
      });
    }
    addCenter(ctx, {
      x: top.x, y: top.y + 0.014, z: top.z,
      radius: 0.012,
      colorA: new THREE.Color('#5f7334'),
      colorB: new THREE.Color('#95a84e'),
      phase: stemPhase
    });
  } else if (spec.head === 'forget') {
    for (let i = 0; i < 5; i++) {
      addPetal(ctx, {
        cx: top.x, cy: top.y + 0.005, cz: top.z,
        angle: (i / 5) * TAU + between(rng, -0.06, 0.06),
        length: between(rng, 0.026, 0.035),
        width: between(rng, 0.012, 0.017),
        cup: 0.004,
        pitch: 0.003,
        base: petalBase,
        tip: petalTip,
        phase: stemPhase,
        flutter: 0.4
      });
    }
    addCenter(ctx, {
      x: top.x, y: top.y + 0.005, z: top.z,
      radius: 0.0075,
      colorA: new THREE.Color('#cda739'),
      colorB: new THREE.Color('#ffe68e'),
      phase: stemPhase
    });
  } else if (spec.head === 'lavender') {
    for (let i = 0; i < spec.whorls; i++) {
      const level = i / Math.max(1, spec.whorls - 1);
      const y = top.y - (0.13 - level * 0.13) - 0.012;
      const at = clamp01(y / Math.max(height, 1e-4));
      const p = stemPoint(at, stem);
      const whorlBend = Math.pow(at, 1.18);
      for (let j = 0; j < 6; j++) {
        addPetal(ctx, {
          cx: p.x,
          cy: y,
          cz: p.z,
          angle: (j / 6) * TAU + between(rng, -0.1, 0.1),
          length: 0.017 + rng() * 0.007,
          width: 0.008,
          cup: 0.005,
          pitch: 0.005,
          base: petalBase,
          tip: petalTip,
          phase: stemPhase,
          flutter: 0.3,
          bend: whorlBend
        });
      }
    }
  }

  return finalize(ctx, height);
}

/* ------------------------------------------------------------------ */
/* wind material                                                       */
/* ------------------------------------------------------------------ */

export function createVegetationMaterial() {
  const uniforms = {
    uTime: { value: 0 },
    uWind: { value: 0.35 },
    uWindDir: { value: new THREE.Vector2(1, 0.32).normalize() }
  };

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    shadowSide: THREE.DoubleSide,
    roughness: 0.78,
    metalness: 0.0,
    dithering: true
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWind = uniforms.uWind;
    shader.uniforms.uWindDir = uniforms.uWindDir;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aBend;
        attribute float aPhase;
        attribute float aFlutter;
        uniform float uTime;
        uniform float uWind;
        uniform vec2 uWindDir;`
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        {
          vec2 wd = normalize(uWindDir);
          vec3 w3 = vec3(wd.x, 0.0, wd.y);
          vec3 ax = normalize(cross(vec3(0.0, 1.0, 0.0), w3));
          float nAngle = (uWind * (0.30 + 0.18 * sin(uTime * 0.7 + aPhase * 0.5)) +
                          sin(uTime * 1.15 + aPhase) * 0.02) * aBend;
          float nc = cos(nAngle);
          float ns = sin(nAngle);
          objectNormal = objectNormal * nc + cross(ax, objectNormal) * ns +
                         ax * dot(ax, objectNormal) * (1.0 - nc);
        }`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec2 wd = normalize(uWindDir);
          vec3 w3 = vec3(wd.x, 0.0, wd.y);
          vec3 ax = normalize(cross(vec3(0.0, 1.0, 0.0), w3));
          float sway = sin(uTime * 1.15 + aPhase) * 0.035 +
                       sin(uTime * 0.47 + aPhase * 1.7) * 0.02;
          float angle = (uWind * (0.30 + 0.18 * sin(uTime * 0.7 + aPhase * 0.5)) +
                         sway) * aBend;
          float c = cos(angle);
          float s = sin(angle);
          vec3 rel = transformed;
          transformed = rel * c + cross(ax, rel) * s +
                        ax * dot(ax, rel) * (1.0 - c);
          transformed += vec3(
            sin(uTime * 2.6 + aPhase * 2.0),
            sin(uTime * 1.9 + aPhase * 3.0) * 0.5,
            cos(uTime * 2.2 + aPhase * 1.6)
          ) * (aFlutter * 0.006 * aBend);
        }`
      );

    material.userData.shader = shader;
  };

  material.userData.uniforms = uniforms;
  material.customProgramCacheKey = () => 'vegetation-wind-v1';
  return material;
}

/* ------------------------------------------------------------------ */
/* assets                                                              */
/* ------------------------------------------------------------------ */

function grassAsset(def, spec) {
  return {
    ...def,
    build: (seed) => buildGrass(spec, seed)
  };
}

function flowerAsset(def, spec) {
  return {
    ...def,
    build: (seed) => buildFlower(spec, seed)
  };
}

export const VEGETATION_ASSETS = [
  grassAsset({
    id: 'grass-silver',
    index: '01',
    kind: 'grass',
    label: '银羽草',
    en: 'Silver feather',
    accent: '#b9c697',
    height: [0.9, 1.3],
    stat: '6–8 blades',
    note: '细长、微微外倾，适合做前景高草与逆光轮廓。',
    seeds: [11, 29, 47]
  }, {
    height: [0.9, 1.3],
    blades: [6, 8],
    spread: 0.16,
    width: 0.028,
    lean: 0.105,
    flutter: 0.22,
    tuft: 2,
    colors: ['#324727', '#7f9159', '#c9d2a2']
  }),

  grassAsset({
    id: 'grass-meadow',
    index: '02',
    kind: 'grass',
    label: '草甸草',
    en: 'Meadow tuft',
    accent: '#8fa85c',
    height: [0.55, 0.85],
    stat: '9–12 blades',
    note: '最接近主场景的基准草簇，密度和高度都居中。',
    seeds: [17, 41, 71]
  }, {
    height: [0.55, 0.85],
    blades: [9, 12],
    spread: 0.13,
    width: 0.033,
    lean: 0.085,
    flutter: 0.2,
    tuft: 3,
    colors: ['#2c411f', '#64803d', '#a9ba6a']
  }),

  grassAsset({
    id: 'grass-low',
    index: '03',
    kind: 'grass',
    label: '低簇草',
    en: 'Low rosette',
    accent: '#5c7438',
    height: [0.3, 0.5],
    stat: '14–18 blades',
    note: '低矮而密，用来铺满近地面的缝隙，避免草地出现空洞。',
    seeds: [23, 53, 83]
  }, {
    height: [0.3, 0.5],
    blades: [14, 18],
    spread: 0.11,
    width: 0.024,
    lean: 0.07,
    flutter: 0.14,
    tuft: 4,
    colors: ['#26391c', '#536c33', '#8da258']
  }),

  grassAsset({
    id: 'grass-dry',
    index: '04',
    kind: 'grass',
    label: '干芒草',
    en: 'Dry wisp',
    accent: '#c9b579',
    height: [0.75, 1.1],
    stat: '5–7 blades',
    note: '偏干、偏硬，色调发暖，给整片绿色里一点秋天。',
    seeds: [31, 67, 97]
  }, {
    height: [0.75, 1.1],
    blades: [5, 7],
    spread: 0.14,
    width: 0.021,
    lean: 0.145,
    flutter: 0.16,
    tuft: 2,
    colors: ['#514227', '#94804b', '#cfbc82']
  }),

  grassAsset({
    id: 'grass-broad',
    index: '05',
    kind: 'grass',
    label: '宽叶草',
    en: 'Broad leaf',
    accent: '#78974d',
    height: [0.42, 0.68],
    stat: '4–6 leaves',
    note: '宽叶片会形成更大面积的明暗，适合做主场景的视觉锚点。',
    seeds: [37, 73, 109]
  }, {
    height: [0.42, 0.68],
    blades: [4, 6],
    spread: 0.15,
    width: 0.055,
    lean: 0.11,
    flutter: 0.12,
    tuft: 2,
    colors: ['#294120', '#5d7a3e', '#aabc74']
  }),

  flowerAsset({
    id: 'flower-daisy',
    index: '06',
    kind: 'flower',
    label: '小白菊',
    en: 'Oxeye daisy',
    accent: '#efe8d2',
    height: [0.38, 0.52],
    stat: '12–15 petals',
    note: '白瓣黄心，花头最大；适合作为草地里的留白和高光点。',
    seeds: [101, 137, 173]
  }, {
    height: [0.38, 0.52],
    head: 'daisy',
    petals: [12, 15],
    leaves: 3,
    leafWidth: 0.018,
    stemRadius: 0.0055,
    stem: ['#3b5128', '#748a45'],
    leaf: ['#2e4522', '#5f793c', '#98ad66'],
    petal: ['#eee8d6', '#fffdf4']
  }),

  flowerAsset({
    id: 'flower-buttercup',
    index: '07',
    kind: 'flower',
    label: '小毛茛',
    en: 'Buttercup',
    accent: '#efc74f',
    height: [0.3, 0.44],
    stat: '5 cupped petals',
    note: '五片小杯状花瓣，亮黄、低矮，适合在近景里成片出现。',
    seeds: [113, 151, 191]
  }, {
    height: [0.3, 0.44],
    head: 'buttercup',
    petals: [5, 5],
    leaves: 3,
    leafWidth: 0.02,
    stemRadius: 0.005,
    stem: ['#3b5128', '#728a44'],
    leaf: ['#2d4422', '#5d793b', '#92a964'],
    petal: ['#e0a92e', '#ffe27b']
  }),

  flowerAsset({
    id: 'flower-forget',
    index: '08',
    kind: 'flower',
    label: '勿忘我',
    en: 'Forget-me-not',
    accent: '#8197dd',
    height: [0.26, 0.38],
    stat: '5 blue petals',
    note: '很小的蓝色花，适合藏在草缝里，作为冷色点缀。',
    seeds: [127, 163, 199]
  }, {
    height: [0.26, 0.38],
    head: 'forget',
    petals: [5, 5],
    leaves: 2,
    leafWidth: 0.015,
    stemRadius: 0.0045,
    stem: ['#3a5028', '#718845'],
    leaf: ['#2c4222', '#5a753b', '#8fa661'],
    petal: ['#6d84cf', '#a9baf0']
  }),

  flowerAsset({
    id: 'flower-lavender',
    index: '09',
    kind: 'flower',
    label: '蓝紫穗',
    en: 'Lavender spike',
    accent: '#9a82c4',
    height: [0.5, 0.66],
    stat: '5 whorls · 6 florets',
    note: '不是单朵花，而是一支蓝紫色小花穗；给草地增加竖向节奏。',
    seeds: [139, 179, 211]
  }, {
    height: [0.5, 0.66],
    head: 'lavender',
    whorls: 5,
    leaves: 2,
    leafWidth: 0.012,
    stemRadius: 0.005,
    stem: ['#3c5229', '#6f8543'],
    leaf: ['#34492a', '#647d45', '#99ac6d'],
    petal: ['#725da3', '#c0aede']
  })
];

export const ASSET_GROUPS = [
  { id: 'grass', label: '草 · GRASSES', assets: VEGETATION_ASSETS.filter((a) => a.kind === 'grass') },
  { id: 'flower', label: '花 · FLOWERS', assets: VEGETATION_ASSETS.filter((a) => a.kind === 'flower') }
];

export function getVegetationAsset(id) {
  return VEGETATION_ASSETS.find((asset) => asset.id === id) || VEGETATION_ASSETS[0];
}