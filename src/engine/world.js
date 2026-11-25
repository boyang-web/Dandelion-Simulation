import { onTrail } from './wind-route.js';
import * as THREE from 'three';
import { createTerrain, createAssetMeadow, terrainHeight, createValleyTerrain, valleyHeight, valleySlope, getValleyPatches } from './meadow.js';
import { createFireflies } from './fireflies.js';
import { createBirds } from './birds.js';
import { createClouds } from './clouds.js';

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

/* ------------------------------------------------------------------ */
/* ground                                                              */
/* ------------------------------------------------------------------ */

function createGround() {
  const geometry = new THREE.PlaneGeometry(320, 320, 1, 1);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uNear: { value: new THREE.Color('#5b7440') },
      uFar: { value: new THREE.Color('#9eae6d') },
      uSun: { value: new THREE.Color('#f3dfae') },
      uHaze: { value: new THREE.Color('#e7dfc3') },
      uTime: { value: 0 }
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uNear;
      uniform vec3 uFar;
      uniform vec3 uSun;
      uniform vec3 uHaze;
      uniform float uTime;
      varying vec3 vWorld;

      ${NOISE_GLSL}

      void main() {
        float d = length(vWorld - cameraPosition);

        vec3 col = mix(uNear, uFar, smoothstep(3.0, 38.0, d));

        float n1 = vnoise(vWorld.xz * 0.24);
        float n2 = vnoise(vWorld.xz * 1.15);
        float n3 = vnoise(vWorld.xz * 4.5);
        col *= 0.93 + n1 * 0.13 + n2 * 0.045;
        col += (n3 - 0.5) * 0.025;

        // slow cloud shade drifting over the meadow
        float cloud = vnoise(vWorld.xz * 0.034 + vec2(uTime * 0.0045, -uTime * 0.003));
        col *= 0.945 + cloud * 0.085;

        // warm late-afternoon light coming from the sun (screen right)
        float sun = smoothstep(-4.0, 34.0, vWorld.x) * (1.0 - smoothstep(8.0, 58.0, d));
        col += uSun * sun * 0.07;

        // sparse dry-grass flecks, kept only in the midground
        float fleck = smoothstep(0.988, 1.0, vnoise(vWorld.xz * 8.0));
        col = mix(col, vec3(0.86, 0.80, 0.57), fleck * 0.22 * (1.0 - smoothstep(18.0, 55.0, d)));

        float haze = smoothstep(24.0, 92.0, d);
        col = mix(col, uHaze, haze * 0.88);

        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, 0, -24);
  mesh.receiveShadow = false;
  return mesh;
}

/* ------------------------------------------------------------------ */
/* a thin treeline sitting on the near ridge                           */
/* ------------------------------------------------------------------ */

function createTreeline({ radius = 50, width = 200, segments = 440 } = {}) {
  const rand = (i) => {
    const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
    return s - Math.floor(s);
  };

  // A canopy made of overlapping rounded crowns instead of a sawtooth.
  const trees = [];
  for (let i = 0; i < 120; i++) {
    trees.push({
      x: (rand(i) - 0.5) * width,
      r: 0.55 + rand(i + 41) * 1.15,
      h: 0.38 + rand(i + 97) * 0.5
    });
  }
  const crown = (x) => {
    let best = 0;
    for (const t of trees) {
      const d = (x - t.x) / t.r;
      if (d > 2.8 || d < -2.8) continue;
      const h = t.h * Math.exp(-d * d * 1.6);
      if (h > best) best = h;
    }
    return Math.min(0.95, best);
  };

  const positions = [];
  const grads = [];
  const us = [];
  const indices = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const x = Math.sin(a) * radius;
    const z = -Math.cos(a) * radius;
    const profileX = THREE.MathUtils.clamp(
      radius * Math.tan(a), -width * 0.5, width * 0.5
    );
    const y = terrainHeight(x, z) + 0.08 + crown(profileX);
    positions.push(x, y, z, x, -6, z);
    grads.push(1, 0);
    us.push(a * radius, a * radius);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    indices.push(a, a + 2, a + 1, a + 2, a + 3, a + 1);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aGrad', new THREE.Float32BufferAttribute(grads, 1));
  geometry.setAttribute('aU', new THREE.Float32BufferAttribute(us, 1));
  geometry.setIndex(indices);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uLow: { value: new THREE.Color('#33472c') },
      uHigh: { value: new THREE.Color('#4e6539') },
      uHaze: { value: new THREE.Color('#ddd7bf') },
      uMist: { value: 0.4 },
      uNight: { value: 0 },
      uTime: { value: 0 }
    },
    vertexShader: /* glsl */ `
      attribute float aGrad;
      attribute float aU;
      varying float vGrad;
      varying vec2 vLocal;
      void main() {
        vGrad = aGrad;
        vLocal = vec2(aU, position.y);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uLow;
      uniform vec3 uHigh;
      uniform vec3 uHaze;
      uniform float uMist;
      uniform float uNight;
      uniform float uTime;
      varying float vGrad;
      varying vec2 vLocal;

      ${NOISE_GLSL}

      void main() {
        float n = vnoise(vLocal * vec2(2.1, 0.8) + vec2(uTime * 0.01, 0.0));
        vec3 col = mix(uLow, uHigh, smoothstep(0.0, 1.0, vGrad));
        col *= 0.9 + 0.12 * n;
        col = mix(col, uHaze, (0.34 + 0.66 * (1.0 - vGrad)) * uMist);
        col = mix(col, col * vec3(0.30, 0.37, 0.52), uNight * 0.75);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `,
    side: THREE.DoubleSide
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.userData.baseHaze = new THREE.Color('#ddd7bf');
  return mesh;
}

/* ------------------------------------------------------------------ */
/* valley mist between the near and middle ridges                      */
/* ------------------------------------------------------------------ */

function createValleyMist({ radius = 74, height = 26, opacity = 0.38 } = {}) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color('#e7dfc3') },
      uOpacity: { value: opacity },
      uTime: { value: 0 }
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uTime;
      varying vec2 vUv;

      ${NOISE_GLSL}

      void main() {
        float band = smoothstep(0.0, 0.34, vUv.y) * (1.0 - smoothstep(0.46, 0.72, vUv.y));
        float n = vnoise(vUv * vec2(3.4, 1.5) + vec2(uTime * 0.012, 0.0));
        float n2 = vnoise(vUv * vec2(9.0, 3.0) - vec2(uTime * 0.02, 0.0));
        float alpha = band * (0.58 + 0.3 * n + 0.12 * n2);
        gl_FragColor = vec4(uColor, alpha * uOpacity);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false
  });

  const geometry = new THREE.CylinderGeometry(radius, radius, height, 200, 1, true);
  geometry.translate(0, height * 0.35, 0);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 1;
  mesh.frustumCulled = false;
  mesh.userData.baseOpacity = opacity;
  return mesh;
}

/* ------------------------------------------------------------------ */
/* layered hills                                                       */
/* ------------------------------------------------------------------ */

function createHillLayer({
  radius,
  width,
  base,
  amp,
  phase,
  low,
  high,
  haze,
  mist,
  segments = 288
}) {
  const positions = [];
  const gradients = [];
  const us = [];
  const indices = [];

  const heightAt = (x) => {
    const a = Math.sin(x * 0.024 + phase) * 0.55;
    const b = Math.sin(x * 0.061 + phase * 1.9 + 1.2) * 0.24;
    const c = Math.sin(x * 0.011 + phase * 0.6) * 0.42;
    const ridge = (a + b + c) * 0.5 + 0.5;
    // A little crest detail: in a range this far away a 0.5 m notch still
    // reads as a fold rather than a clean vector edge.
    const detail =
      Math.sin(x * 0.085 + phase * 2.1) * 0.44 +
      Math.sin(x * 0.215 + phase * 0.9) * 0.2 +
      Math.sin(x * 0.047 + phase * 4.3) * 0.3;
    return base + amp * (ridge * ridge * 0.75 + ridge * 0.25) + detail * amp * 0.28;
  };

  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const x = Math.sin(a) * radius;
    const z = -Math.cos(a) * radius;
    const profileX = THREE.MathUtils.clamp(
      radius * Math.tan(a), -width * 0.5, width * 0.5
    );
    const y = heightAt(profileX);
    positions.push(x, y, z, x, -6, z);
    gradients.push(1, 0);
    us.push(a * radius, a * radius);
  }

  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    indices.push(a, a + 2, a + 1, a + 2, a + 3, a + 1);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aGrad', new THREE.Float32BufferAttribute(gradients, 1));
  geometry.setAttribute('aU', new THREE.Float32BufferAttribute(us, 1));
  geometry.setIndex(indices);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uLow: { value: new THREE.Color(low) },
      uHigh: { value: new THREE.Color(high) },
      uHaze: { value: new THREE.Color(haze) },
      uMist: { value: mist },
      uNight: { value: 0 },
      uWarm: { value: 0 },
      uTime: { value: 0 }
    },
    vertexShader: /* glsl */ `
      attribute float aGrad;
      attribute float aU;
      varying float vGrad;
      varying vec2 vLocal;
      varying float vX;
      void main() {
        vGrad = aGrad;
        vX = position.x;
        vLocal = vec2(aU, position.y);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uLow;
      uniform vec3 uHigh;
      uniform vec3 uHaze;
      uniform float uMist;
      uniform float uNight;
      uniform float uWarm;
      uniform float uTime;
      varying float vGrad;
      varying vec2 vLocal;
      varying float vX;

      ${NOISE_GLSL}

      void main() {
        float n = vnoise(vLocal * vec2(0.35, 1.1));
        float fine = vnoise(vLocal * 2.6);

        vec3 col = mix(uLow, uHigh, smoothstep(0.05, 1.0, vGrad));
        col *= 0.965 + (n - 0.5) * 0.08 + (fine - 0.5) * 0.025;

        // Valley haze at the foot of each ridge, thinning toward the crest.
        float hazeNoise = vnoise(vLocal * vec2(0.55, 1.4) + vec2(uTime * 0.012, 0.0));
        vec3 hazeCol = uHaze * (0.955 + 0.06 * hazeNoise + 0.025 * vnoise(vLocal * 2.2));
        float mistMix = (0.34 + 0.66 * (1.0 - vGrad)) * uMist;
        col = mix(col, hazeCol, clamp(mistMix, 0.0, 0.94));

        // a quiet rim of sunlight on the crest, warmer on the sun side
        col += uHigh * smoothstep(0.88, 1.0, vGrad) * 0.05;
        col += vec3(0.10, 0.062, 0.02) * smoothstep(0.82, 1.0, vGrad) * uWarm * 0.55;

        // scrub and folds: darker vegetation patches on the lower slopes
        float scrub = smoothstep(0.56, 0.9, vnoise(vLocal * vec2(0.13, 0.4) + 7.0));
        col = mix(col, col * vec3(0.82, 0.87, 0.78), scrub * 0.2 * (1.0 - vGrad * 0.55));
        col += vec3(0.026, 0.018, 0.0) * smoothstep(-18.0, 32.0, vX);

        // Keep the ridges in the same night air as the meadow.
        col = mix(col, col * vec3(0.30, 0.37, 0.52), uNight * 0.72);

        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `,
    side: THREE.DoubleSide
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.userData.baseHaze = new THREE.Color(haze);
  return mesh;
}

/* ------------------------------------------------------------------ */
/* instanced meadow grass                                               */
/* ------------------------------------------------------------------ */

function bladeGeometry() {
  const rows = 4;
  const positions = [];
  const uvs = [];
  const indices = [];

  for (let i = 0; i <= rows; i++) {
    const h = i / rows;
    const half = 0.042 * Math.pow(1 - h, 1.35);
    const z = Math.sin(h * Math.PI * 0.42) * 0.085;
    positions.push(-half, h, z, half, h, z);
    uvs.push(0, h, 1, h);
  }

  for (let i = 0; i < rows; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

/* ------------------------------------------------------------------ */
/* instanced grass carpet                                              */
/*                                                                     */
/* Single-ribbon blades carry the far ground cover cheaply. The hero   */
/* clumps (meadow.js) sit on top near the centre; this layer spreads   */
/* across the whole basin and up the lower slopes.                     */
/* ------------------------------------------------------------------ */

function createGrassCarpet({
  coarse = window.matchMedia('(pointer: coarse)').matches,
  count = coarse ? 3800 : 6800,
  layout = 'strip',
  heightAt = terrainHeight,
  slopeAt = null,
  radius = 115,
  minRadius = 0,
  maxHeight = Infinity,
  maxSlope = Infinity,
  fadeNear = 13,
  fadeFar = 44,
  baseColor = '#35491f',
  midColor = '#6d8644',
  tipColor = '#a6b96a',
  material = null
} = {}) {
  const geometry = bladeGeometry();
  const mat = material || new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uStrength: { value: 0 },
      uWind: { value: new THREE.Vector3(1, 0, 0) },
      uLocalStrength: { value: 0 },
      uLocalWind: { value: new THREE.Vector2(1, 0) },
      uSweepA: { value: new THREE.Vector2() },
      uSweepB: { value: new THREE.Vector2() },
      uRadiusNdc: { value: 0.35 },
      uAspect: { value: 1.6 },
      uBase: { value: new THREE.Color(baseColor) },
      uMid: { value: new THREE.Color(midColor) },
      uTip: { value: new THREE.Color(tipColor) },
      uSun: { value: new THREE.Color('#f0e0ad') },
      uSunDir: { value: new THREE.Vector3(5.5, 8.5, 4.5).normalize() },
      uHaze: { value: new THREE.Color('#e3ddc2') },
      uFadeNear: { value: fadeNear },
      uFadeFar: { value: fadeFar }
    },
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
      uniform vec3 uBase;
      uniform vec3 uMid;
      uniform vec3 uTip;
      uniform vec3 uSun;
      uniform vec3 uSunDir;
      uniform vec3 uHaze;
      uniform float uFadeNear;
      uniform float uFadeFar;
      attribute float aPhase;
      attribute float aShade;

      varying vec3 vColor;
      varying float vH;

      float distToSegment(vec2 p, vec2 a, vec2 b) {
        vec2 ab = b - a;
        float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
        return length(p - (a + ab * t));
      }

      void main() {
        vec3 p = position;
        vec4 world = modelMatrix * instanceMatrix * vec4(p, 1.0);
        vec4 root4 = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec3 root = root4.xyz;
        float h = clamp(p.y, 0.0, 1.0);

        float wl = length(uWind.xz);
        vec2 wdir = wl > 0.001 ? normalize(uWind.xz) : vec2(0.75, 0.25);

        // Where is this blade on screen relative to the swiped path?
        vec4 clip0 = projectionMatrix * viewMatrix * world;
        vec2 ndc = clip0.xy / max(clip0.w, 1e-4);
        vec2 aspectFix = vec2(uAspect, 1.0);
        float dLocal = distToSegment(ndc * aspectFix, uSweepA * aspectFix, uSweepB * aspectFix);
        float localFall = 1.0 - smoothstep(uRadiusNdc * 0.12, uRadiusNdc, dLocal);

        // Very slow idle sway, a travelling meadow breeze, and the local gust.
        float ambientSway =
          uStrength * (0.85 + 0.15 * sin(uTime * 0.43 + world.x * 0.035 + world.z * 0.028));
        float idleAngle =
          sin(uTime * 1.15 + aPhase + world.x * 0.30) * 0.018 +
          sin(uTime * 0.47 + aPhase * 1.75 + world.z * 0.42) * 0.011 +
          ambientSway * 0.070;

        float localRipple =
          0.82 +
          0.12 * sin(uTime * 1.25 + aPhase * 1.9 + dLocal * 12.0) +
          0.06 * sin(uTime * 0.63 + aPhase * 2.4);

        float localAngle =
          uLocalStrength * localFall * localRipple * (0.54 + 0.035 * sin(uTime * 0.9 + aPhase)) *
          (0.70 + 0.30 * aShade);

        vec2 localDir = uLocalWind + vec2(sin(aPhase * 2.3), cos(aPhase * 1.7)) * 0.09;
        localDir = length(localDir) > 1e-4 ? normalize(localDir) : vec2(0.7, 0.3);

        vec2 bendVec = wdir * idleAngle + localDir * localAngle;
        float angle = length(bendVec);
        vec2 bendDir = angle > 1e-5 ? bendVec / angle : vec2(0.0, 0.0);

        // Bend as an arc around the fixed root instead of shearing the whole
        // ribbon sideways. The roots stay put; only the upper blade curves.
        vec3 wind3 = vec3(bendDir.x, 0.0, bendDir.y);
        vec3 axis = vec3(0.0, 0.0, -1.0);
        if (dot(wind3, wind3) > 1e-8) axis = normalize(cross(vec3(0.0, 1.0, 0.0), wind3));
        float rot = angle * pow(h, 1.45);
        float rc = cos(rot);
        float rs = sin(rot);
        vec3 rel = world.xyz - root;
        vec3 bent = rel * rc + cross(axis, rel) * rs + axis * dot(axis, rel) * (1.0 - rc);
        world.xyz = root + bent;

        vec4 mv = viewMatrix * world;
        float dist = -mv.z;

        vec3 col = mix(uBase, uMid, smoothstep(0.0, 0.62, h));
        col = mix(col, uTip, smoothstep(0.55, 1.0, h));
        col *= 0.82 + aShade * 0.28;

        // per-blade diffuse response: randomly turned ribbons catch the sun
        vec3 bx = normalize(instanceMatrix[0].xyz);
        vec3 by = normalize(instanceMatrix[1].xyz);
        vec3 bladeNormal = normalize(cross(bx, by));
        float sunFacing = abs(dot(bladeNormal, uSunDir));
        col *= 0.85 + 0.15 * sunFacing;

        // sunlit tips + a little translucent backglow
        float tipMask = smoothstep(0.38, 1.0, h);
        col += uSun * tipMask * (0.042 + 0.03 * sunFacing) * smoothstep(-2.0, 26.0, world.x);

        // matching slow cloud shade over the field
        float dapple = 0.955 + 0.045 * sin(world.x * 0.045 + uTime * 0.05)
                              * sin(world.z * 0.062 - uTime * 0.035);
        col *= dapple;

        float haze = smoothstep(uFadeNear, uFadeFar, dist);
        col = mix(col, uHaze, haze * 0.94);

        vColor = col;
        vH = h;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vH;

      void main() {
        gl_FragColor = vec4(vColor, 1.0);
        #include <colorspace_fragment>
      }
    `
  });

  const dummy = new THREE.Object3D();
  const placements = [];
  let guard = 0;

  while (placements.length < count && guard < count * 6) {
    guard++;

    let x;
    let z;
    if (layout === 'radial') {
      const a = Math.random() * Math.PI * 2;
      const u = Math.random();
      const rr = minRadius > 0
        ? Math.sqrt(minRadius * minRadius +
          (radius * radius - minRadius * minRadius) * u)
        : radius * Math.pow(u, 0.58);
      x = Math.sin(a) * rr;
      z = Math.cos(a) * rr;
      if (x * x + z * z < 1.1 * 1.1 || onTrail(x, z)) continue;
    } else {
      // Uniform field, slightly denser towards the camera.
      const depth = Math.random();
      z = 8.0 - depth * 34.0;
      x = (Math.random() * 2 - 1) * (16 + Math.abs(z) * 0.55);
    }

    const y = heightAt(x, z);
    if (layout === 'radial') {
      if (y > maxHeight) continue;
      if (slopeAt && slopeAt(x, z) > maxSlope) continue;
    }
    const distance = Math.hypot(x, z);
    const foreground = layout === 'radial'
      ? distance < 12 && Math.random() < 0.16
      : z > 2.0 && Math.random() < 0.09;

    const height = foreground
      ? 0.8 + Math.random() * 0.6
      : 0.34 + Math.random() * 0.6;
    const widthScale = foreground
      ? 1.2 + Math.random() * 0.5
      : 0.7 + Math.random() * 0.8;

    placements.push({
      x,
      y,
      z,
      height,
      widthScale,
      rotX: (Math.random() - 0.5) * 0.18,
      rotY: Math.random() * Math.PI * 2,
      rotZ: (Math.random() - 0.5) * 0.2,
      phase: Math.random() * Math.PI * 2,
      shade: Math.random()
    });
  }

  const mesh = new THREE.InstancedMesh(geometry, mat, placements.length);
  mesh.frustumCulled = false;
  mesh.renderOrder = 0;

  const phases = new Float32Array(placements.length);
  const shades = new Float32Array(placements.length);

  for (let i = 0; i < placements.length; i++) {
    const e = placements[i];
    dummy.position.set(e.x, e.y, e.z);
    dummy.rotation.set(e.rotX, e.rotY, e.rotZ);
    dummy.scale.set(e.widthScale, e.height, e.widthScale);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    phases[i] = e.phase;
    shades[i] = e.shade;
  }

  geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
  geometry.setAttribute('aShade', new THREE.InstancedBufferAttribute(shades, 1));
  mesh.instanceMatrix.needsUpdate = true;

  return { mesh, material: mat, count: placements.length };
}

/* ------------------------------------------------------------------ */
/* floating pollen                                                     */
/* ------------------------------------------------------------------ */

function moteTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,253,240,0.95)');
  grad.addColorStop(0.35, 'rgba(255,248,222,0.5)');
  grad.addColorStop(1, 'rgba(255,246,216,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createMotes({ heightAt = terrainHeight } = {}) {
  const count = 90;
  const positions = new Float32Array(count * 3);
  const seeds = [];

  for (let i = 0; i < count; i++) {
    const x = (Math.random() * 2 - 1) * 13;
    const z = -10 + Math.random() * 17;
    const ground = heightAt(x, z);
    const y = ground + 0.35 + Math.random() * 4.6;
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    seeds.push({
      x, y, z,
      ground,
      phase: Math.random() * Math.PI * 2,
      speed: 0.2 + Math.random() * 0.55,
      radius: 0.2 + Math.random() * 0.5
    });
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    map: moteTexture(),
    size: 0.055,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.65,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    color: 0xfff3ce,
    toneMapped: false
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 1;

  return { points, seeds, positions, geometry };
}

/* ------------------------------------------------------------------ */

function buildHills() {
  return [
    createHillLayer({
      radius: 150,
      width: 760,
      base: 14.0,
      amp: 8.5,
      phase: 1.6,
      low: '#b4c1c2',
      high: '#dbe0d9',
      haze: '#e9e2cb',
      mist: 0.62,
      segments: 300
    }),
    createHillLayer({
      radius: 95,
      width: 500,
      base: 8.0,
      amp: 5.0,
      phase: 2.1,
      low: '#83988d',
      high: '#b1c0b1',
      haze: '#e2decf',
      mist: 0.44,
      segments: 260
    }),
    createHillLayer({
      radius: 55,
      width: 300,
      base: 3.6,
      amp: 3.4,
      phase: 4.7,
      low: '#5f7651',
      high: '#8fa773',
      haze: '#d8d2b9',
      mist: 0.3
    })
  ];
}

export function createWorld(scene, { camera } = {}) {
  const group = new THREE.Group();
  scene.add(group);

  const terrain = createTerrain();
  group.add(terrain.mesh);

  const hills = buildHills();
  hills.forEach((hill) => group.add(hill));

  const treeline = createTreeline();
  group.add(treeline);

  const valleyMist = createValleyMist();
  group.add(valleyMist);

  // The old flat CSS cloud bank is gone; these are real depth-sorted planes
  // sitting behind the ridges, so the light on them agrees with the ridges.
  const clouds = createClouds({
    scene: group,
    camera,
    coarse: window.matchMedia('(pointer: coarse)').matches
  });

  const meadow = createAssetMeadow({
    coarse: window.matchMedia('(pointer: coarse)').matches
  });
  group.add(meadow.group);

  const motes = createMotes();
  group.add(motes.points);

  const birds = createBirds({
    scene: group,
    params: { gapMin: 18, gapMax: 42 }
  });

  const fireflies = createFireflies();
  // Rendered in a separate transparent overlay above the night veil,
  // otherwise the CSS night tint dims them almost to nothing.

  let lastSky = { night: 0, day: 1 };

  const moteAir = new THREE.Vector3();
  const motePos = new THREE.Vector3();

  return {
    group,
    ground: terrain.mesh,
    terrain,
    hills,
    treeline,
    valleyMist,
    clouds,
    meadow,
    motes,
    birds,
    fireflies,
    params: {
      translucency: 0.16,
      rootAo: 0.22,
      haze: 1.0,
      cloudShadow: 0.9
    },
    setTime({ sunColor, sunDir, sunStrength = 1, haze, moteColor, moteOpacity, night = 0, golden = 0, day = 1 }) {
      meadow.material.uniforms.uSun.value.copy(sunColor);
      meadow.material.uniforms.uSunDir.value.copy(sunDir);
      terrain.material.uniforms.uSun.value.copy(sunColor);
      terrain.material.uniforms.uSunDir.value.copy(sunDir);
      meadow.material.uniforms.uSunStrength.value = sunStrength;
      terrain.material.uniforms.uSunStrength.value = sunStrength;
      if (haze) {
        meadow.material.uniforms.uHaze.value.copy(haze);
        terrain.material.uniforms.uHaze.value.copy(haze);
      }
      for (const hill of hills) {
        hill.material.uniforms.uNight.value = night;
        hill.material.uniforms.uWarm.value = golden;
        if (haze) {
          hill.material.uniforms.uHaze.value
            .copy(hill.userData.baseHaze)
            .lerp(haze, 0.45);
        }
      }
      motes.points.material.color.copy(moteColor);
      motes.points.material.opacity = moteOpacity;
      fireflies.setNight(night);

      // Far field follows the same light: same haze tint, same night falloff.
      const tru = treeline.material.uniforms;
      tru.uNight.value = night;
      if (haze) tru.uHaze.value.copy(treeline.userData.baseHaze).lerp(haze, 0.4);
      const vmu = valleyMist.material.uniforms;
      if (haze) vmu.uColor.value.copy(haze);
      vmu.uOpacity.value = 0.38 * (1 - night * 0.35);
      clouds.setTime({ golden, night, haze });

      birds.setTime({ night, day });
      lastSky = { night, day };
    },
    update(t, dt, wind) {
      terrain.material.uniforms.uTime.value = t;
      for (const hill of hills) hill.material.uniforms.uTime.value = t;
      treeline.material.uniforms.uTime.value = t;
      valleyMist.material.uniforms.uTime.value = t;
      clouds.update(t, dt);
      const mu = meadow.material.uniforms;
      mu.uTime.value = t;
      mu.uStrength.value = wind.breezePower;
      mu.uWind.value.set(wind.breezeDir.x, 0, wind.breezeDir.y);
      mu.uLocalStrength.value = Math.min(1, wind.grassStrength * wind.params.grassShaderGain);
      mu.uBendScale.value = wind.params.grassBendScale;
      mu.uTranslucency.value = this.params.translucency;
      mu.uRootAo.value = this.params.rootAo;
      mu.uHazeAmount.value = this.params.haze;
      terrain.material.uniforms.uHazeAmount.value = this.params.haze;
      mu.uCloudShadow.value = this.params.cloudShadow;
      terrain.material.uniforms.uCloudShadow.value = this.params.cloudShadow;
      mu.uLocalWind.value.copy(wind.grassDirSmooth);
      mu.uSweepA.value.copy(wind.grassA);
      mu.uSweepB.value.copy(wind.grassB);
      mu.uRadiusNdc.value = wind.grassRadiusNdc;
      mu.uAspect.value = wind.aspect;

      fireflies.update(t, dt, wind);
      birds.update(t, dt, lastSky);

      const pos = motes.positions;
      for (let i = 0; i < motes.points.geometry.attributes.position.count; i++) {
        const m = motes.seeds[i];
        motePos.set(m.x, m.y, m.z);
        wind.airAtWorld(motePos, moteAir);
        const twinkle = Math.sin(t * m.speed + m.phase);
        m.x += (moteAir.x * 0.16 + twinkle * 0.012) * dt;
        m.y += (moteAir.y * 0.07 + 0.012 + Math.cos(t * m.speed * 1.3 + m.phase) * 0.012) * dt;
        m.z += (moteAir.z * 0.1 + Math.sin(t * 0.2 + m.phase) * 0.008) * dt;

        if (m.x > 16) m.x = -16;
        if (m.x < -16) m.x = 16;
        if (m.y > m.ground + 5.2) m.y = m.ground + 0.25;
        if (m.z > 9) m.z = -11;
        if (m.z < -12) m.z = 8;

        pos[i * 3] = m.x + Math.sin(t * 0.4 + m.phase) * 0.12;
        pos[i * 3 + 1] = m.y;
        pos[i * 3 + 2] = m.z;
      }
      motes.geometry.attributes.position.needsUpdate = true;
    }
  };
}

/* ------------------------------------------------------------------ */
/* complete valley: one continuous terrain, no billboard ridges        */
/* used by labs/valley.html                                            */
/* ------------------------------------------------------------------ */

// Cloud planes sit entirely outside the terrain disc (radius 345), so they
// can be occluded by the mountain silhouette but never intersect its faces.
const VALLEY_CLOUD_LAYERS = [
  { radius: 396, y: 96, w: 560, h: 120, haze: 0.46, opacity: 0.78, speed: 1.5, count: 3, phase: -0.35 },
  { radius: 486, y: 150, w: 460, h: 105, haze: 0.30, opacity: 0.72, speed: 2.8, count: 3, phase: 0.55 },
  { radius: 596, y: 210, w: 380, h: 92, haze: 0.18, opacity: 0.62, speed: 4.2, count: 2, phase: -0.15 }
];

export function createValleyWorld(scene, { camera, quality = 'auto' } = {}) {
  const coarse = quality === 'coarse' ||
    quality === 'low' ||
    window.matchMedia('(pointer: coarse)').matches;

  const group = new THREE.Group();
  scene.add(group);

  const terrain = createValleyTerrain({ coarse });
  group.add(terrain.mesh);

  // Grass is split into two LOD rings. The inner 54 m gets a much higher
  // density; the ring out to 108 m is cheaper and mostly carries colour.
  // Beyond that the terrain shader's tuft and flower fields take over.
  const NEAR_RADIUS = 58;
  const MID_RADIUS = 110;

  const nearPatches = getValleyPatches({ maxRadius: NEAR_RADIUS });
  const midPatches = getValleyPatches({
    minRadius: NEAR_RADIUS,
    maxRadius: MID_RADIUS
  });

  // L0 · detailed inner disc
  const nearCarpet = createGrassCarpet({
    coarse,
    count: coarse ? 15000 : 36000,
    layout: 'radial',
    heightAt: valleyHeight,
    slopeAt: valleySlope,
    radius: NEAR_RADIUS,
    maxHeight: 25,
    maxSlope: 0.56,
    fadeNear: 42,
    fadeFar: 140,
    baseColor: '#2f451e',
    midColor: '#5f7a3c',
    tipColor: '#9db263'
  });
  group.add(nearCarpet.mesh);

  const nearMeadow = createAssetMeadow({
    coarse,
    layout: 'valley',
    heightAt: valleyHeight,
    slopeAt: valleySlope,
    radius: NEAR_RADIUS,
    maxHeight: 25,
    maxSlope: 0.56,
    count: coarse ? 10000 : 18000,
    patches: nearPatches
  });
  group.add(nearMeadow.group);

  // L1 · cheap middle ring; shared material so uniforms update once
  const midCarpet = createGrassCarpet({
    coarse,
    count: coarse ? 13000 : 30000,
    layout: 'radial',
    heightAt: valleyHeight,
    slopeAt: valleySlope,
    radius: MID_RADIUS,
    minRadius: 50,
    maxHeight: 28,
    maxSlope: 0.58,
    fadeNear: 42,
    fadeFar: 170,
    baseColor: '#2f451e',
    midColor: '#5f7a3c',
    tipColor: '#9db263',
    material: nearCarpet.material
  });
  group.add(midCarpet.mesh);

  const midMeadow = createAssetMeadow({
    coarse,
    layout: 'valley',
    heightAt: valleyHeight,
    slopeAt: valleySlope,
    radius: MID_RADIUS,
    minRadius: 50,
    maxHeight: 28,
    maxSlope: 0.58,
    count: coarse ? 2000 : 4000,
    patches: midPatches,
    material: nearMeadow.material
  });
  group.add(midMeadow.group);

  const carpetMaterial = nearCarpet.material;
  const meadowMaterial = nearMeadow.material;

  const mists = [
    createValleyMist({ radius: 126, height: 26, opacity: 0.18 }),
    createValleyMist({ radius: 190, height: 48, opacity: 0.14 }),
    createValleyMist({ radius: 268, height: 84, opacity: 0.11 })
  ];
  for (const mist of mists) group.add(mist);

  const motes = createMotes({ heightAt: valleyHeight });
  group.add(motes.points);

  const clouds = createClouds({
    scene: group,
    camera,
    coarse,
    layers: VALLEY_CLOUD_LAYERS
  });
  const birds = createBirds({
    scene: group,
    params: {
      style: 'soaring',
      heightAt: valleyHeight,
      gapMin: 18,
      gapMax: 42,
      speed: 16,
      scale: 2.25,
      radiusMin: 78,
      radiusMax: 138,
      altitudeMin: 26,
      altitudeMax: 44,
      clearance: 10
    }
  });

  const fireflies = createFireflies({
    count: coarse ? 300 : 520,
    heightAt: valleyHeight,
    radius: 150,
    minRadius: 8,
    heightMin: 1.8,
    heightMax: 15.5,
    sizeScale: 1.55,
    speedScale: 0.82
  });
  // Rendered in a transparent overlay canvas, like the main scene.

  let lastSky = { night: 0, day: 1 };

  const moteAir = new THREE.Vector3();
  const motePos = new THREE.Vector3();

  return {
    group,
    ground: terrain.mesh,
    terrain,
    hills: [],
    carpet: nearCarpet,
    carpets: [nearCarpet, midCarpet],
    meadow: nearMeadow,
    meadows: [nearMeadow, midMeadow],
    lod: { near: true, mid: true },
    mists,
    clouds,
    motes,
    birds,
    fireflies,
    heightAt: valleyHeight,
    slopeAt: valleySlope,
    params: {
      translucency: 0.16,
      rootAo: 0.22,
      haze: 1.0,
      cloudShadow: 0.9
    },

    setTime({
      sunColor,
      sunDir,
      sunStrength = 1,
      haze,
      moteColor,
      moteOpacity,
      night = 0,
      golden = 0,
      day = 1
    }) {
      const tu = terrain.material.uniforms;
      tu.uSun.value.copy(sunColor);
      tu.uSunDir.value.copy(sunDir);
      tu.uSunStrength.value = sunStrength;
      if (haze) tu.uHaze.value.copy(haze);

      const cu = carpetMaterial.uniforms;
      cu.uSun.value.copy(sunColor);
      cu.uSunDir.value.copy(sunDir);
      if (haze) cu.uHaze.value.copy(haze);

      const mu = meadowMaterial.uniforms;
      mu.uSun.value.copy(sunColor);
      mu.uSunDir.value.copy(sunDir);
      mu.uSunStrength.value = sunStrength;
      if (haze) mu.uHaze.value.copy(haze);

      for (const mist of mists) {
        const u = mist.material.uniforms;
        if (haze) u.uColor.value.copy(haze);
        u.uOpacity.value = mist.userData.baseOpacity * (1 - night * 0.35);
      }

      motes.points.material.color.copy(moteColor);
      motes.points.material.opacity = moteOpacity;
      fireflies.setNight(night);
      clouds.setTime({ golden, night, haze });
      birds.setTime({ night, day });
      lastSky = { night, day };
    },

    update(t, dt, wind) {
      terrain.material.uniforms.uTime.value = t;
      terrain.material.uniforms.uHazeAmount.value = this.params.haze;
      terrain.material.uniforms.uCloudShadow.value = this.params.cloudShadow;

      // Progressive LOD: the camera orbits the valley centre, so its
      // distance from the origin tells us whether the detailed disc is
      // still worth drawing. When it is too far, the thick terrain colour
      // and flower drifts carry the meadow instead.
      if (camera) {
        const camR = Math.hypot(camera.position.x, camera.position.z);
        if (camR < 88) this.lod.near = true;
        else if (camR > 98) this.lod.near = false;
        if (camR < 150) this.lod.mid = true;
        else if (camR > 160) this.lod.mid = false;
        nearMeadow.group.visible = this.lod.near;
        nearCarpet.mesh.visible = this.lod.near;
        midMeadow.group.visible = this.lod.mid;
        midCarpet.mesh.visible = this.lod.mid;
      }

      const cu = carpetMaterial.uniforms;
      cu.uTime.value = t;
      cu.uStrength.value = wind.breezePower;
      cu.uWind.value.set(wind.breezeDir.x, 0, wind.breezeDir.y);
      cu.uLocalStrength.value = Math.min(
        1,
        wind.grassStrength * wind.params.grassShaderGain
      );
      cu.uLocalWind.value.copy(wind.grassDirSmooth);
      cu.uSweepA.value.copy(wind.grassA);
      cu.uSweepB.value.copy(wind.grassB);
      cu.uRadiusNdc.value = wind.grassRadiusNdc;
      cu.uAspect.value = wind.aspect;

      const mu = meadowMaterial.uniforms;
      mu.uTime.value = t;
      mu.uStrength.value = wind.breezePower;
      mu.uWind.value.set(wind.breezeDir.x, 0, wind.breezeDir.y);
      mu.uLocalStrength.value = Math.min(
        1,
        wind.grassStrength * wind.params.grassShaderGain
      );
      mu.uBendScale.value = wind.params.grassBendScale;
      mu.uTranslucency.value = this.params.translucency;
      mu.uRootAo.value = this.params.rootAo;
      mu.uHazeAmount.value = this.params.haze;
      mu.uCloudShadow.value = this.params.cloudShadow;
      mu.uLocalWind.value.copy(wind.grassDirSmooth);
      mu.uSweepA.value.copy(wind.grassA);
      mu.uSweepB.value.copy(wind.grassB);
      mu.uRadiusNdc.value = wind.grassRadiusNdc;
      mu.uAspect.value = wind.aspect;

      for (const mist of mists) mist.material.uniforms.uTime.value = t;
      clouds.update(t, dt);
      fireflies.update(t, dt, wind);
      birds.update(t, dt, lastSky);

      const pos = motes.positions;
      for (let i = 0; i < motes.points.geometry.attributes.position.count; i++) {
        const m = motes.seeds[i];
        motePos.set(m.x, m.y, m.z);
        wind.airAtWorld(motePos, moteAir);
        const twinkle = Math.sin(t * m.speed + m.phase);
        m.x += (moteAir.x * 0.16 + twinkle * 0.012) * dt;
        m.y += (moteAir.y * 0.07 + 0.012 + Math.cos(t * m.speed * 1.3 + m.phase) * 0.012) * dt;
        m.z += (moteAir.z * 0.1 + Math.sin(t * 0.2 + m.phase) * 0.008) * dt;

        if (m.x > 16) m.x = -16;
        if (m.x < -16) m.x = 16;
        if (m.y > m.ground + 5.2) m.y = m.ground + 0.25;
        if (m.z > 9) m.z = -11;
        if (m.z < -12) m.z = 8;

        pos[i * 3] = m.x + Math.sin(t * 0.4 + m.phase) * 0.12;
        pos[i * 3 + 1] = m.y;
        pos[i * 3 + 2] = m.z;
      }
      motes.geometry.attributes.position.needsUpdate = true;
    }
  };
}

/* ------------------------------------------------------------------ */
/* far field only: terrain silhouette + ridges + birds                  */
/* used by distant.html to study the horizon without the meadow        */
/* ------------------------------------------------------------------ */

export function createDistantWorld(scene, { camera } = {}) {
  const group = new THREE.Group();
  scene.add(group);

  const terrain = createTerrain();
  group.add(terrain.mesh);

  const hills = buildHills();
  hills.forEach((hill) => group.add(hill));

  const treeline = createTreeline();
  group.add(treeline);

  const valleyMist = createValleyMist();
  group.add(valleyMist);

  const clouds = createClouds({
    scene: group,
    camera,
    coarse: window.matchMedia('(pointer: coarse)').matches
  });

  const birds = createBirds({
    scene: group,
    params: { gapMin: 18, gapMax: 42 }
  });
  let lastSky = { night: 0, day: 1 };

  return {
    group,
    terrain,
    hills,
    treeline,
    valleyMist,
    clouds,
    birds,
    params: { haze: 1, cloudShadow: 0.9 },
    setTime({ sunColor, sunDir, sunStrength = 1, haze, night = 0, golden = 0, day = 1 }) {
      const tu = terrain.material.uniforms;
      tu.uSun.value.copy(sunColor);
      tu.uSunDir.value.copy(sunDir);
      tu.uSunStrength.value = sunStrength;
      if (haze) tu.uHaze.value.copy(haze);

      for (const hill of hills) {
        hill.material.uniforms.uNight.value = night;
        hill.material.uniforms.uWarm.value = golden;
        if (haze) {
          hill.material.uniforms.uHaze.value
            .copy(hill.userData.baseHaze)
            .lerp(haze, 0.45);
        }
      }
      birds.setTime({ night, day });
      clouds.setTime({ golden, night, haze });
      const tru = treeline.material.uniforms;
      tru.uNight.value = night;
      if (haze) tru.uHaze.value.copy(treeline.userData.baseHaze).lerp(haze, 0.4);
      const vmu = valleyMist.material.uniforms;
      if (haze) vmu.uColor.value.copy(haze);
      vmu.uOpacity.value = 0.38 * (1 - night * 0.35);
      lastSky = { night, day };
    },
    update(t, dt) {
      terrain.material.uniforms.uTime.value = t;
      terrain.material.uniforms.uHazeAmount.value = this.params.haze;
      terrain.material.uniforms.uCloudShadow.value = this.params.cloudShadow;
      for (const hill of hills) hill.material.uniforms.uTime.value = t;
      treeline.material.uniforms.uTime.value = t;
      valleyMist.material.uniforms.uTime.value = t;
      clouds.update(t, dt);
      birds.update(t, dt, lastSky);
    }
  };
}