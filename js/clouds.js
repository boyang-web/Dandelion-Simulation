import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/*  Distant clouds                                                     */
/*                                                                     */
/*  The CSS clouds were white-on-white and had no depth. These are      */
/*  real transparent planes far behind the ridges: procedural fBm       */
/*  textures, three distance bands, drifting sideways at their own     */
/*  speed. Their tops are lit warm and their undersides stay grey, so   */
/*  they read against the pale sky.                                    */
/* ------------------------------------------------------------------ */

const TAU = Math.PI * 2;

function hash2(x, y, seed) {
  const s = Math.sin(x * 127.1 + y * 311.7 + seed * 17.3) * 43758.5453;
  return s - Math.floor(s);
}

function valueNoise(x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v;
}

function fbm(x, y, seed) {
  let value = 0;
  let amp = 0.55;
  let freq = 1;
  for (let i = 0; i < 4; i++) {
    value += amp * valueNoise(x * freq, y * freq, seed);
    freq *= 2.03;
    amp *= 0.5;
  }
  return value;
}

function smooth01(t) {
  return t * t * (3 - 2 * t);
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function cloudTexture(seed, w = 384, h = 192) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(w, h);
  const data = image.data;

  for (let y = 0; y < h; y++) {
    const v = y / (h - 1);
    const envY = smooth01(clamp01(v / 0.26)) * (1 - smooth01(clamp01((v - 0.66) / 0.32)));

    for (let x = 0; x < w; x++) {
      const u = x / (w - 1);
      const envX = smooth01(clamp01(u / 0.1)) * (1 - smooth01(clamp01((u - 0.9) / 0.1)));

      let n = fbm(u * 5.2 + seed * 3.7, v * 3.1 + seed * 7.9, seed);
      n = clamp01((n - 0.28) * 1.55);

      let alpha = smooth01(clamp01((n - 0.30) / 0.4));
      alpha = Math.pow(alpha, 0.9) * envX * envY;

      // Canvas y=0 is the top row, and the canvas texture is flipped on upload,
      // so brighten the canvas top to get a lit cloud top on the plane.
      const shade = clamp01(
        0.38 + 0.62 * smooth01(clamp01(1.0 - v + (n - 0.5) * 0.35))
      );

      const i = (y * w + x) * 4;
      const c = Math.round(shade * 255);
      data[i] = c;
      data[i + 1] = c;
      data[i + 2] = c;
      data[i + 3] = Math.round(clamp01(alpha) * 255);
    }
  }

  ctx.putImageData(image, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  return tex;
}

function cloudMaterial(texture) {
  return new THREE.ShaderMaterial({
    uniforms: {
      tMap: { value: texture },
      uTop: { value: new THREE.Color('#fffaf0') },
      uShadow: { value: new THREE.Color('#aab8bd') },
      uOpacity: { value: 0.85 }
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tMap;
      uniform vec3 uTop;
      uniform vec3 uShadow;
      uniform float uOpacity;
      varying vec2 vUv;

      void main() {
        vec4 t = texture2D(tMap, vUv);
        if (t.a < 0.004) discard;
        float shade = smoothstep(0.22, 0.92, t.r);
        vec3 col = mix(uShadow, uTop, shade);
        gl_FragColor = vec4(col, t.a * uOpacity);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    toneMapped: false
  });
}

export function createClouds({ scene, camera, coarse = false }) {
  const textures = [cloudTexture(1.3), cloudTexture(4.7), cloudTexture(9.1)];
  const entries = [];
  const group = new THREE.Group();
  group.frustumCulled = false;
  if (scene) scene.add(group);

  // Distance bands. The near band sits just above the ridge line, the far
  // band is huge and soft behind everything.
  const layers = [
    {
      z: -335,
      y: 30,
      w: 520,
      h: 86,
      haze: 0.46,
      opacity: 0.85,
      speed: 1.6,
      count: coarse ? 1 : 2
    },
    {
      z: -252,
      y: 55,
      w: 300,
      h: 92,
      haze: 0.3,
      opacity: 0.95,
      speed: 3.1,
      count: coarse ? 1 : 2
    },
    {
      z: -186,
      y: 46,
      w: 210,
      h: 70,
      haze: 0.16,
      opacity: 0.95,
      speed: 5.0,
      count: coarse ? 1 : 2
    }
  ];

  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li];
    for (let i = 0; i < layer.count; i++) {
      const mat = cloudMaterial(textures[(li + i) % textures.length]);
      mat.uniforms.uOpacity.value = layer.opacity;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      const width = layer.w * (0.82 + Math.random() * 0.45);
      const height = layer.h * (0.8 + Math.random() * 0.5);
      mesh.scale.set(width, height, 1);
      mesh.position.set(
        (i - (layer.count - 1) / 2) * layer.w * 0.45 + (Math.random() - 0.5) * 40,
        layer.y + (Math.random() - 0.5) * height * 0.35,
        layer.z + (Math.random() - 0.5) * 14
      );
      // Draw with the other far transparent layers, before the seeds and
      // birds, so a rising seed is never painted over by a distant cloud.
      mesh.renderOrder = 0;
      mesh.frustumCulled = false;
      group.add(mesh);
      entries.push({
        mesh,
        mat,
        layer,
        baseY: mesh.position.y,
        speed: layer.speed * (0.85 + Math.random() * 0.3),
        phase: Math.random() * TAU,
        haze: layer.haze,
        opacity: layer.opacity
      });
    }
  }

  const topDay = new THREE.Color('#fffdf6');
  const topGolden = new THREE.Color('#ffe3bd');
  const topNight = new THREE.Color('#5b6b88');
  const shadowDay = new THREE.Color('#a3b2b8');
  const shadowGolden = new THREE.Color('#c39886');
  const shadowNight = new THREE.Color('#26324a');
  const scratchTop = new THREE.Color();
  const scratchShadow = new THREE.Color();
  const params = { opacity: 1 };
  let lastNight = 0;

  function setTime({ golden = 0, night = 0, haze } = {}) {
    scratchTop.copy(topDay).lerp(topGolden, golden).lerp(topNight, night * 0.85);
    scratchShadow.copy(shadowDay).lerp(shadowGolden, golden).lerp(shadowNight, night * 0.85);
    for (const e of entries) {
      const u = e.mat.uniforms;
      if (haze) {
        u.uTop.value.copy(scratchTop).lerp(haze, e.haze * 0.7);
        u.uShadow.value.copy(scratchShadow).lerp(haze, e.haze * 0.5);
      } else {
        u.uTop.value.copy(scratchTop);
        u.uShadow.value.copy(scratchShadow);
      }
      u.uOpacity.value = e.opacity * (1 - night * 0.45) * params.opacity;
    }
    lastNight = night;
  }

  function update(t, dt) {
    const fade = (1 - lastNight * 0.45) * params.opacity;
    for (const e of entries) {
      const m = e.mesh;
      e.mat.uniforms.uOpacity.value = e.opacity * fade;
      m.position.x += e.speed * dt;
      if (m.position.x > 620) m.position.x = -620;
      m.position.y = e.baseY + Math.sin(t * 0.05 + e.phase) * 1.2;
    }
  }

  return { group, entries, params, setTime, update };
}