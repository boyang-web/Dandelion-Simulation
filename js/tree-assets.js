import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/*  Plane tree asset (梧桐)                                            */
/*                                                                     */
/*  Tall straight trunk -> four staggered thick limbs growing from     */
/*  different heights on the upper trunk, plus a central leader.       */
/*  Foliage fills the secondary branches, not only the twig tips.      */
/*  Bark: pale mottled plane-tree patches. Leaves: 5-lobed palms.      */
/* ------------------------------------------------------------------ */

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* textures                                                            */
/* ------------------------------------------------------------------ */

let leafAtlas = null;
let barkTexture = null;

function drawPlaneLeaf(ctx, cx, cy, size, seed) {
  const rng = mulberry32(seed);
  const R = size * 0.44;
  const steps = 88;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((rng() - 0.5) * 0.18);

  ctx.strokeStyle = '#8f7c52';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, R * 0.62);
  ctx.lineTo(0, R * 1.02);
  ctx.stroke();

  const outline = new Path2D();
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * TAU - Math.PI / 2;
    let r = R * (0.78 + 0.22 * Math.cos(5 * a + 0.25));
    r *= 1 + 0.02 * Math.sin(a * 34 + seed);
    const base = Math.exp(-Math.pow((a - Math.PI / 2) / 0.55, 2));
    r *= 1 - 0.3 * base;
    const x = Math.cos(a) * r * 0.95;
    const y = Math.sin(a) * r;
    if (i === 0) outline.moveTo(x, y);
    else outline.lineTo(x, y);
  }
  outline.closePath();

  const g = ctx.createLinearGradient(0, R * 0.4, 0, -R);
  g.addColorStop(0, `rgb(${40 + rng() * 14}, ${84 + rng() * 26}, ${38 + rng() * 12})`);
  g.addColorStop(0.55, `rgb(${52 + rng() * 14}, ${106 + rng() * 30}, ${46 + rng() * 12})`);
  g.addColorStop(1, `rgb(${40 + rng() * 12}, ${88 + rng() * 24}, ${36 + rng() * 10})`);
  ctx.fillStyle = g;
  ctx.fill(outline);
  ctx.strokeStyle = 'rgba(32, 58, 26, 0.32)';
  ctx.lineWidth = 1.1;
  ctx.stroke(outline);

  ctx.save();
  ctx.clip(outline);
  ctx.strokeStyle = 'rgba(44, 74, 34, 0.4)';
  ctx.lineWidth = 1.6;
  for (let k = -2; k <= 2; k++) {
    const a = -Math.PI / 2 + k * (TAU / 5) + 0.05;
    ctx.beginPath();
    ctx.moveTo(0, R * 0.42);
    ctx.lineTo(Math.cos(a) * R * 0.95, R * 0.42 + Math.sin(a) * R * 0.95);
    ctx.stroke();
  }
  ctx.restore();

  ctx.restore();
}

export function getLeafAtlas() {
  if (leafAtlas) return leafAtlas;

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 512, 512);

  drawPlaneLeaf(ctx, 128, 128, 210, 17);
  drawPlaneLeaf(ctx, 384, 128, 210, 43);
  drawPlaneLeaf(ctx, 128, 384, 210, 79);
  drawPlaneLeaf(ctx, 384, 384, 210, 113);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  leafAtlas = tex;
  return tex;
}

function getBarkTexture() {
  if (barkTexture) return barkTexture;

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#928a76';
  ctx.fillRect(0, 0, 256, 256);

  const rand = mulberry32(53);
  const palette = ['#c9bda2', '#818872', '#6f7562', '#b09a78', '#5f6655', '#d4c6aa'];

  for (let i = 0; i < 42; i++) {
    const x = rand() * 256;
    const y = rand() * 256;
    const rx = 10 + rand() * 28;
    const ry = 6 + rand() * 18;
    const rot = rand() * TAU;
    ctx.fillStyle = palette[Math.floor(rand() * palette.length)];
    ctx.globalAlpha = 0.55 + rand() * 0.35;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, rot, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  for (let i = 0; i < 90; i++) {
    const x = rand() * 256;
    const y = rand() * 256;
    ctx.strokeStyle = `rgba(62, 54, 42, ${0.06 + rand() * 0.14})`;
    ctx.lineWidth = 0.7 + rand() * 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rand() - 0.5) * 16, y + 2 + rand() * 7);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  barkTexture = tex;
  return tex;
}

/* ------------------------------------------------------------------ */
/* geometry                                                            */
/* ------------------------------------------------------------------ */

function newContext() {
  return {
    positions: [],
    colors: [],
    uvs: [],
    bends: [],
    phases: [],
    flutters: [],
    leaves: [],
    indices: [],
    count: 0
  };
}

function addVertex(ctx, p, color, uv, bend, phase, flutter, leaf) {
  ctx.positions.push(p.x, p.y, p.z);
  ctx.colors.push(color.r, color.g, color.b);
  ctx.uvs.push(uv[0], uv[1]);
  ctx.bends.push(bend);
  ctx.phases.push(phase);
  ctx.flutters.push(flutter);
  ctx.leaves.push(leaf);
  return ctx.count++;
}

function barkColor(rng) {
  const c = new THREE.Color('#b3a88f');
  c.multiplyScalar(0.9 + rng() * 0.16);
  return c;
}

function addTube(ctx, points, radiusA, radiusB, color, phase, sides = 8) {
  if (points.length < 2) return;
  const tangent = new THREE.Vector3();
  const side = new THREE.Vector3();
  const binormal = new THREE.Vector3();
  const ring = new THREE.Vector3();
  const rings = [];

  for (let i = 0; i < points.length; i++) {
    const t = i / (points.length - 1);
    const p = points[i];
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    tangent.copy(next).sub(prev).normalize();
    side.crossVectors(tangent, UP);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    else side.normalize();
    binormal.crossVectors(tangent, side).normalize();

    const radius = radiusA + (radiusB - radiusA) * t;
    const bend = Math.pow(Math.max(0, p.y) / 6.4, 1.1);
    const ringStart = ctx.count;

    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * TAU;
      ring.copy(p)
        .addScaledVector(side, Math.cos(a) * radius)
        .addScaledVector(binormal, Math.sin(a) * radius);
      addVertex(ctx, ring, color, [s / sides, t], bend, phase, 0.04, 0);
    }

    if (i > 0) {
      const prevStart = rings[i - 1];
      const start = ringStart;
      for (let s = 0; s < sides; s++) {
        const n = (s + 1) % sides;
        ctx.indices.push(
          prevStart + s, start + s, prevStart + n,
          start + s, start + n, prevStart + n
        );
      }
    }
    rings[i] = ringStart;
  }

  const capBend = (p) => Math.pow(Math.max(0, p.y) / 6.4, 1.1);
  const first = rings[0];
  const last = rings[points.length - 1];
  const c0 = addVertex(ctx, points[0], color, [0.5, 0], capBend(points[0]), phase, 0.04, 0);
  const c1 = addVertex(
    ctx, points[points.length - 1], color, [0.5, 1],
    capBend(points[points.length - 1]), phase, 0.04, 0
  );
  for (let s = 0; s < sides; s++) {
    const n = (s + 1) % sides;
    ctx.indices.push(c0, first + n, first + s);
    ctx.indices.push(c1, last + s, last + n);
  }
}

function addLeaf(ctx, position, size, quadrant, tint, phase, rng) {
  const start = ctx.count;
  const normal = new THREE.Vector3(
    rng() - 0.5,
    rng() - 0.38,
    rng() - 0.5
  );
  if (normal.lengthSq() < 1e-6) normal.set(0, 1, 0);
  normal.normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(Z, normal);
  const roll = new THREE.Quaternion().setFromAxisAngle(normal, rng() * TAU);
  q.premultiply(roll);

  const corners = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5]
  ];
  const qx = quadrant % 2;
  const qy = Math.floor(quadrant / 2);
  const bend = Math.pow(Math.max(0, position.y) / 6.4, 1.1);

  for (const [cx, cy] of corners) {
    const p = new THREE.Vector3(cx * size, cy * size, 0)
      .applyQuaternion(q)
      .add(position);
    const u = (qx + cx + 0.5) * 0.5;
    const v = (qy + cy + 0.5) * 0.5;
    addVertex(ctx, p, tint, [u, v], bend, phase, 1.0, 1);
  }

  ctx.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
}

function leafTint(rng) {
  const c = new THREE.Color(0.95 + rng() * 0.15, 1.0, 0.92 + rng() * 0.1);
  if (rng() < 0.2) c.lerp(new THREE.Color(1.12, 1.04, 0.76), 0.35);
  return c;
}

function addLeavesOnTwig(ctx, points, rng, phase, count) {
  const end = points[points.length - 1];

  for (let i = 0; i < count; i++) {
    const t = 0.28 + rng() * 0.72;
    const idx = Math.min(
      points.length - 1,
      Math.max(0, Math.floor(t * (points.length - 1)))
    );
    const base = points[idx];
    const pos = base.clone().add(new THREE.Vector3(
      (rng() - 0.5) * 0.42,
      (rng() - 0.5) * 0.28,
      (rng() - 0.5) * 0.42
    ));
    addLeaf(
      ctx,
      pos,
      0.32 + rng() * 0.16,
      Math.floor(rng() * 4),
      leafTint(rng),
      phase + rng() * 1.6,
      rng
    );
  }

  for (let i = 0; i < 4; i++) {
    addLeaf(
      ctx,
      end.clone().add(new THREE.Vector3(
        (rng() - 0.5) * 0.32,
        (rng() - 0.5) * 0.22,
        (rng() - 0.5) * 0.32
      )),
      0.3 + rng() * 0.14,
      Math.floor(rng() * 4),
      leafTint(rng),
      phase + rng() * 1.4,
      rng
    );
  }
}

function growBranch(ctx, start, dir, length, radius, depth, rng, phase) {
  const points = [start.clone()];
  const steps = depth >= 2 ? 4 : 3;
  const drift = new THREE.Vector3(
    (rng() - 0.5) * 0.18,
    0,
    (rng() - 0.5) * 0.18
  );

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const p = start.clone().addScaledVector(dir, length * t);
    p.x += drift.x * t * t;
    p.z += drift.z * t * t;
    if (depth <= 1) p.y -= length * 0.09 * t * t;
    points.push(p);
  }

  addTube(
    ctx,
    points,
    radius,
    radius * 0.6,
    barkColor(rng),
    phase,
    depth >= 1 ? 8 : 6
  );

  const end = points[points.length - 1];

  if (depth <= 0) {
    addLeavesOnTwig(ctx, points, rng, phase, 6);
    return;
  }

  if (depth === 1) addLeavesOnTwig(ctx, points, rng, phase, 2);

  const mid = points[Math.max(1, Math.floor(points.length * 0.58))];
  const lateralAxis = new THREE.Vector3(
    rng() - 0.5,
    rng() * 0.4,
    rng() - 0.5
  ).normalize();
  const lateralDir = dir.clone().applyAxisAngle(lateralAxis, 0.75 + rng() * 0.4);
  lateralDir.y += 0.12;
  lateralDir.normalize();
  growBranch(
    ctx,
    mid,
    lateralDir,
    length * 0.55,
    radius * 0.58,
    depth - 1,
    rng,
    phase + rng() * 2.0
  );

  for (let k = 0; k < 2; k++) {
    const axis = k === 0
      ? UP.clone()
      : new THREE.Vector3(rng() - 0.5, rng() * 0.5, rng() - 0.5).normalize();
    const spread = k === 0 ? 0.55 + rng() * 0.5 : 0.5 + rng() * 0.4;
    const nd = dir.clone().applyAxisAngle(axis, spread * (k === 0 ? (rng() < 0.5 ? -1 : 1) : 1));
    nd.y += 0.08;
    nd.normalize();
    growBranch(
      ctx,
      end,
      nd,
      length * (0.62 + rng() * 0.08),
      radius * 0.6,
      depth - 1,
      rng,
      phase + rng() * 2.0
    );
  }
}

/* ------------------------------------------------------------------ */
/* crown: coarse envelope first, fine foliage fill second              */
/* ------------------------------------------------------------------ */

const CROWN_PRESETS = [
  { trunk: 3.4, rx: 2.3, ry: 1.5 },
  { trunk: 3.3, rx: 2.55, ry: 1.6 },
  { trunk: 3.55, rx: 1.95, ry: 1.5 }
];

/* One continuous canopy envelope: ellipsoid + low-frequency harmonics,
   so the silhouette undulates organically instead of showing ball unions. */
function crownEnvelope(rng, trunkHeight, variant) {
  const p = CROWN_PRESETS[variant % 3];
  const c = new THREE.Vector3(0, trunkHeight + p.ry * 0.62, 0);
  const rx = p.rx + rng() * 0.2;
  const ry = p.ry + rng() * 0.15;
  const rz = rx * (0.9 + rng() * 0.15);
  const lobes = [];
  for (let i = 0; i < 3; i++) {
    lobes.push({
      k: 2 + Math.floor(rng() * 4),
      m: 1 + Math.floor(rng() * 3),
      amp: 0.05 + rng() * 0.07,
      pa: rng() * TAU,
      pb: rng() * TAU
    });
  }
  const sag = rng() * TAU;
  const notch = rng() * TAU;
  const radiusAt = (d) => {
    const base = 1 / Math.sqrt(
      (d.x * d.x) / (rx * rx) + (d.y * d.y) / (ry * ry) + (d.z * d.z) / (rz * rz)
    );
    const th = Math.atan2(d.z, d.x);
    const ph = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
    const bottom = Math.max(0, -d.y);
    let mod = 1 - 0.1 * Math.max(0, d.y);
    for (const l of lobes) {
      mod += l.amp * Math.sin(l.k * th + l.pa) * Math.cos(l.m * ph + l.pb);
    }
    // uneven underside: one side hangs, two notches lift to expose limb forks
    mod *= 1 - 0.3 * bottom;
    mod += 0.28 * bottom * Math.sin(th + sag);
    mod += 0.18 * bottom * Math.max(0, Math.sin(3 * th + notch));
    return base * mod;
  };
  return { c, rx, ry, rz, radiusAt };
}

function growLimb(ctx, start, target, radius, rng, phase) {
  const dist = start.distanceTo(target);
  const points = [];
  const steps = 5;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = start.clone().lerp(target, t);
    p.y += Math.sin(t * Math.PI) * dist * 0.07;
    p.x += (rng() - 0.5) * 0.06;
    p.z += (rng() - 0.5) * 0.06;
    points.push(p);
  }
  addTube(ctx, points, radius, radius * 0.5, barkColor(rng), phase, 8);
  return points[points.length - 1].clone().sub(start).normalize();
}

function fillCrown(ctx, env, rng, phase, density) {
  const volume = (4 / 3) * Math.PI * env.rx * env.ry * env.rz;
  const count = Math.round(volume * density);
  const dir = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    dir.set(rng() - 0.5, rng() - 0.5, rng() - 0.5);
    if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
    dir.normalize();
    // shell-biased radius: crisp outer silhouette, solid interior
    const rad = rng() < 0.62
      ? 0.82 + 0.18 * Math.cbrt(rng())
      : 0.82 * Math.cbrt(rng());
    const r = env.radiusAt(dir) * rad;
    const pos = new THREE.Vector3(
      env.c.x + dir.x * r,
      env.c.y + dir.y * r,
      env.c.z + dir.z * r
    );
    addLeaf(
      ctx,
      pos,
      0.36 + rng() * 0.2,
      Math.floor(rng() * 4),
      leafTint(rng),
      phase + rng() * 1.6,
      rng
    );
  }
}

export function buildTreeGeometry(seed = 7, variant = 0) {
  const rng = mulberry32(seed + variant * 101);
  const ctx = newContext();

  const trunkHeight = CROWN_PRESETS[variant % 3].trunk + rng() * 0.25;
  const leanX = (rng() - 0.5) * 0.5;
  const leanZ = (rng() - 0.5) * 0.35;

  const trunkPoint = (t) => new THREE.Vector3(
    leanX * Math.pow(t, 1.25),
    trunkHeight * t,
    leanZ * Math.pow(t, 1.25)
  );

  const trunkPts = [];
  for (let i = 0; i <= 6; i++) trunkPts.push(trunkPoint(i / 6));

  addTube(ctx, trunkPts, 0.27, 0.13, barkColor(rng), rng() * TAU, 12);

  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + rng() * 0.7;
    const start = new THREE.Vector3(leanX * 0.03, 0.18, leanZ * 0.03);
    const end = new THREE.Vector3(Math.cos(a) * 0.7, -0.02, Math.sin(a) * 0.7);
    const mid = start.clone().lerp(end, 0.5);
    mid.y = 0.09;
    addTube(ctx, [start, mid, end], 0.12, 0.035, barkColor(rng), rng() * TAU, 6);
  }

  const env = crownEnvelope(rng, trunkHeight, variant);
  const heights = [0.46, 0.6, 0.74, 0.88];
  for (let i = 0; i < heights.length; i++) {
    const az = i * (TAU / 4) + (rng() - 0.5) * 0.5;
    const out = new THREE.Vector3(
      Math.cos(az) * 0.95,
      0.22 + rng() * 0.3,
      Math.sin(az) * 0.95
    ).normalize();
    const target = env.c.clone().addScaledVector(out, env.radiusAt(out) * 0.62);
    const dir = growLimb(ctx, trunkPoint(heights[i]), target, 0.105, rng, rng() * TAU);
    for (let j = 0; j < 6; j++) {
      addLeaf(
        ctx,
        target.clone().add(new THREE.Vector3(
          (rng() - 0.5) * 0.7,
          (rng() - 0.5) * 0.5,
          (rng() - 0.5) * 0.7
        )),
        0.34 + rng() * 0.18,
        Math.floor(rng() * 4),
        leafTint(rng),
        rng() * TAU,
        rng
      );
    }
    for (let k = 0; k < 3; k++) {
      const axis = new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5);
      if (axis.lengthSq() < 1e-6) axis.set(1, 0, 0);
      axis.normalize();
      const nd = dir.clone().applyAxisAngle(axis, 0.5 + rng() * 0.7);
      nd.normalize();
      growBranch(ctx, target, nd, 0.55 + rng() * 0.25, 0.045, 1, rng, rng() * TAU);
    }
  }

  const top = trunkPoint(1);
  const upOut = new THREE.Vector3(leanX, 1, leanZ).normalize();
  const topTarget = env.c.clone().addScaledVector(upOut, env.radiusAt(upOut) * 0.5);
  const leadDir = growLimb(ctx, top, topTarget, 0.08, rng, rng() * TAU);
  for (let k = 0; k < 3; k++) {
    const axis = new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5);
    if (axis.lengthSq() < 1e-6) axis.set(1, 0, 0);
    axis.normalize();
    const nd = leadDir.clone().applyAxisAngle(axis, 0.5 + rng() * 0.7);
    nd.normalize();
    growBranch(ctx, topTarget, nd, 0.5 + rng() * 0.25, 0.04, 1, rng, rng() * TAU);
  }
  fillCrown(ctx, env, rng, rng() * TAU, 105);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(ctx.positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(ctx.colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(ctx.uvs, 2));
  geometry.setAttribute('aBend', new THREE.Float32BufferAttribute(ctx.bends, 1));
  geometry.setAttribute('aPhase', new THREE.Float32BufferAttribute(ctx.phases, 1));
  geometry.setAttribute('aFlutter', new THREE.Float32BufferAttribute(ctx.flutters, 1));
  geometry.setAttribute('aLeaf', new THREE.Float32BufferAttribute(ctx.leaves, 1));
  geometry.setIndex(ctx.indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  const targetHeight = [6.1, 6.4, 5.8][variant % 3];
  const span = geometry.boundingBox.max.y - geometry.boundingBox.min.y;
  geometry.scale(targetHeight / span, targetHeight / span, targetHeight / span);
  geometry.computeBoundingSphere();
  return geometry;
}

/* ------------------------------------------------------------------ */
/* material                                                            */
/* ------------------------------------------------------------------ */

export function createTreeMaterial() {
  const uniforms = {
    uLeafMap: { value: getLeafAtlas() },
    uBarkMap: { value: getBarkTexture() },
    uTime: { value: 0 },
    uWindStrength: { value: 0.3 },
    uWindDir: { value: new THREE.Vector2(0.9, 0.25).normalize() },
    uSunColor: { value: new THREE.Color('#ffddb0') },
    uSunDir: { value: new THREE.Vector3(0.3, 0.6, -0.7).normalize() },
    uSunStrength: { value: 1 },
    uHaze: { value: new THREE.Color('#e7dfc3') },
    uHazeAmount: { value: 1 },
    uNight: { value: 0 }
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute vec3 color;
      attribute float aBend;
      attribute float aPhase;
      attribute float aFlutter;
      attribute float aLeaf;

      uniform float uTime;
      uniform float uWindStrength;
      uniform vec2 uWindDir;

      varying vec2 vUv;
      varying vec3 vColor;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vLeaf;

      void main() {
        float angle =
          (uWindStrength * (0.2 + 0.06 * sin(uTime * 0.7 + aPhase * 0.35)) +
           sin(uTime * 1.1 + aPhase) * 0.016) * aBend;

        vec3 wdir = vec3(uWindDir.x, 0.0, uWindDir.y);
        vec3 axis = vec3(0.0, 0.0, 0.0);
        if (dot(wdir, wdir) > 1e-6) axis = normalize(cross(vec3(0.0, 1.0, 0.0), wdir));

        float c = cos(angle);
        float s = sin(angle);
        vec3 bent = position * c + cross(axis, position) * s +
                    axis * dot(axis, position) * (1.0 - c);

        bent += vec3(
          sin(uTime * 2.1 + aPhase * 2.1),
          sin(uTime * 1.6 + aPhase * 3.2) * 0.5,
          cos(uTime * 2.3 + aPhase * 1.8)
        ) * (aFlutter * (0.014 + 0.024 * uWindStrength));

        vec4 world = modelMatrix * vec4(bent, 1.0);
        vWorld = world.xyz;
        vUv = uv;
        vColor = color;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vLeaf = aLeaf;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uLeafMap;
      uniform sampler2D uBarkMap;
      uniform vec3 uSunColor;
      uniform vec3 uSunDir;
      uniform vec3 uHaze;
      uniform float uSunStrength;
      uniform float uHazeAmount;
      uniform float uNight;

      varying vec2 vUv;
      varying vec3 vColor;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vLeaf;

      void main() {
        vec3 albedo;
        if (vLeaf > 0.5) {
          vec4 tex = texture2D(uLeafMap, vUv);
          if (tex.a < 0.35) discard;
          albedo = tex.rgb * vColor * 1.5;
        } else {
          vec3 bark = texture2D(uBarkMap, vUv * vec2(1.6, 1.2)).rgb;
          albedo = bark * vColor * 1.6;
        }

        vec3 n = normalize(vNormal);
        vec3 L = normalize(uSunDir);
        vec3 V = normalize(cameraPosition - vWorld);
        float nd = abs(dot(n, L));

        vec3 col = albedo * (0.55 + 0.6 * nd);
        float back = pow(max(dot(-V, L), 0.0), 2.0) * max(dot(-n, L), 0.0);
        col += uSunColor * back * vLeaf * 0.3 * uSunStrength;

        float d = length(vWorld - cameraPosition);
        float fog = 1.0 - exp(-pow(max(d - 6.0, 0.0) * 0.021, 1.35));
        fog = clamp(fog * uHazeAmount, 0.0, 0.96);
        col = mix(col, uHaze, fog);
        col = mix(col, col * vec3(0.32, 0.40, 0.55), uNight * 0.6);

        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    side: THREE.DoubleSide,
    transparent: false
  });

  return material;
}