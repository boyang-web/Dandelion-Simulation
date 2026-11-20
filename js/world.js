import * as THREE from 'three';
import { createTerrain, createAssetMeadow, terrainHeight } from './meadow.js';
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

function createTreeline({ z = -50, width = 200, segments = 440 } = {}) {
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
  const indices = [];
  for (let i = 0; i <= segments; i++) {
    const x = -width / 2 + (i / segments) * width;
    const y = terrainHeight(x, z) + 0.08 + crown(x);
    positions.push(x, y, 0, x, -6, 0);
    grads.push(1, 0);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    indices.push(a, a + 2, a + 1, a + 2, a + 3, a + 1);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aGrad', new THREE.Float32BufferAttribute(grads, 1));
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
      varying float vGrad;
      varying vec2 vLocal;
      void main() {
        vGrad = aGrad;
        vLocal = position.xy;
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
    `
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.z = z;
  mesh.userData.baseHaze = new THREE.Color('#ddd7bf');
  return mesh;
}

/* ------------------------------------------------------------------ */
/* valley mist between the near and middle ridges                      */
/* ------------------------------------------------------------------ */

function createValleyMist({ z = -74, width = 460, height = 26 } = {}) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color('#e7dfc3') },
      uOpacity: { value: 0.38 },
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

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.position.set(0, 10, z);
  mesh.renderOrder = 1;
  return mesh;
}

/* ------------------------------------------------------------------ */
/* layered hills                                                       */
/* ------------------------------------------------------------------ */

function createHillLayer({
  z,
  width,
  base,
  amp,
  phase,
  low,
  high,
  haze,
  mist,
  segments = 190
}) {
  const positions = [];
  const gradients = [];
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
    const x = -width * 0.5 + (i / segments) * width;
    const y = heightAt(x);
    positions.push(x, y, 0, x, -6, 0);
    gradients.push(1, 0);
  }

  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    indices.push(a, a + 2, a + 1, a + 2, a + 3, a + 1);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aGrad', new THREE.Float32BufferAttribute(gradients, 1));
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
      varying float vGrad;
      varying vec2 vLocal;
      void main() {
        vGrad = aGrad;
        vLocal = position.xy;
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

      ${NOISE_GLSL}

      void main() {
        float n = vnoise(vLocal * vec2(0.35, 1.1));
        float fine = vnoise(vLocal * 2.6);

        vec3 col = mix(uLow, uHigh, smoothstep(0.05, 1.0, vGrad));
        col *= 0.965 + (n - 0.5) * 0.08 + (fine - 0.5) * 0.025;

        // Valley haze at the foot of each ridge, thinning toward the crest. The
      // colour keeps a slow noise so the band never reads as a flat cut-out.
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
        col += vec3(0.026, 0.018, 0.0) * smoothstep(-18.0, 32.0, vLocal.x);

        // Keep the ridges in the same night air as the meadow: the CSS veil
        // still darkens everything, this only removes the daylight haze.
        col = mix(col, col * vec3(0.30, 0.37, 0.52), uNight * 0.72);

        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.z = z;
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

function createMeadow() {
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const count = coarse ? 3800 : 6800;

  const geometry = bladeGeometry();
  const material = new THREE.ShaderMaterial({
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
      uBase: { value: new THREE.Color('#35491f') },
      uMid: { value: new THREE.Color('#6d8644') },
      uTip: { value: new THREE.Color('#a6b96a') },
      uSun: { value: new THREE.Color('#f0e0ad') },
      uSunDir: { value: new THREE.Vector3(5.5, 8.5, 4.5).normalize() },
      uHaze: { value: new THREE.Color('#e3ddc2') }
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

        // Very slow idle sway + a smoothed, smaller local gust.
        float idleAngle =
          sin(uTime * 1.15 + aPhase + world.x * 0.30) * 0.018 +
          sin(uTime * 0.47 + aPhase * 1.75 + world.z * 0.42) * 0.011;

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

        vec3 base = uBase;
        vec3 mid = uMid;
        vec3 tip = uTip;
        vec3 col = mix(base, mid, smoothstep(0.0, 0.62, h));
        col = mix(col, tip, smoothstep(0.55, 1.0, h));
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

        float haze = smoothstep(13.0, 44.0, dist);
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

  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  mesh.renderOrder = 0;

  const phases = new Float32Array(count);
  const shades = new Float32Array(count);

  const dummy = new THREE.Object3D();

  for (let i = 0; i < count; i++) {
    // Uniform field, slightly denser towards the camera.
    const depth = Math.random();
    const z = 8.0 - depth * 34.0;
    const x = (Math.random() * 2 - 1) * (16 + Math.abs(z) * 0.55);

    // A handful of taller blades frame the very front of the shot.
    const foreground = z > 2.0 && Math.random() < 0.09;

    const height = foreground
      ? 0.8 + Math.random() * 0.6
      : 0.34 + Math.random() * 0.6;
    const widthScale = foreground
      ? 1.2 + Math.random() * 0.5
      : 0.7 + Math.random() * 0.8;

    dummy.position.set(x, 0, z);
    dummy.rotation.set(
      (Math.random() - 0.5) * 0.18,
      Math.random() * Math.PI * 2,
      (Math.random() - 0.5) * 0.2
    );
    dummy.scale.set(widthScale, height, widthScale);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);

    phases[i] = Math.random() * Math.PI * 2;
    shades[i] = Math.random();

  }

  geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
  geometry.setAttribute('aShade', new THREE.InstancedBufferAttribute(shades, 1));
  mesh.instanceMatrix.needsUpdate = true;

  return mesh;
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

function createMotes() {
  const count = 90;
  const positions = new Float32Array(count * 3);
  const seeds = [];

  for (let i = 0; i < count; i++) {
    const x = (Math.random() * 2 - 1) * 13;
    const z = -10 + Math.random() * 17;
    const ground = terrainHeight(x, z);
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
      z: -150,
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
      z: -95,
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
      z: -55,
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

export function createWorld(scene) {
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
/* far field only: terrain silhouette + ridges + birds                  */
/* used by distant.html to study the horizon without the meadow        */
/* ------------------------------------------------------------------ */

export function createDistantWorld(scene) {
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