import * as THREE from 'three';
import { terrainHeight } from './meadow.js';
import { buildTreeGeometry, createTreeMaterial } from './tree-assets.js';
import { buildWindmillAsset } from './windmill-asset.js';

/* ------------------------------------------------------------------ */
/*  Far landmarks: stream + plane trees + windmill + falling leaves    */
/*  Everything is placed on the real heightfield and tinted into the   */
/*  same haze / light / night as the rest of the distant scene.        */
/* ------------------------------------------------------------------ */

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

const STREAM_Z_START = 6;
const STREAM_Z_END = -44;
const STREAM_CENTER_X = -3.4;
const STREAM_HALF = 1.05;

function streamX(z) {
  return STREAM_CENTER_X + Math.sin(z * 0.105 + 0.7) * 3.0 + Math.sin(z * 0.31) * 0.45;
}

/* ------------------------------------------------------------------ */
/* stream                                                              */
/* ------------------------------------------------------------------ */

function createStream() {
  const segments = 110;
  const positions = [];
  const uvs = [];
  const indices = [];

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const z = STREAM_Z_START + (STREAM_Z_END - STREAM_Z_START) * t;
    const x = streamX(z);
    const y = terrainHeight(x, z) + 0.06;

    const z2 = z - 0.4;
    const x2 = streamX(z2);
    const tx = x2 - x;
    const tz = z2 - z;
    const len = Math.hypot(tx, tz) || 1;
    const sx = -tz / len;
    const sz = tx / len;

    positions.push(x + sx * STREAM_HALF, y, z + sz * STREAM_HALF);
    positions.push(x - sx * STREAM_HALF, y, z - sz * STREAM_HALF);
    uvs.push(0, t, 1, t);

    if (i < segments) {
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 2, a + 3, a + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uDeep: { value: new THREE.Color('#26484b') },
      uSky: { value: new THREE.Color('#cfd9d0') },
      uSunColor: { value: new THREE.Color('#ffddb0') },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunStrength: { value: 1 },
      uHaze: { value: new THREE.Color('#e7dfc3') },
      uTime: { value: 0 }
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vWorld;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec3 p = position;
        p.y += sin(uv.y * 34.0 - uTime * 2.1 + uv.x * 2.4) * 0.035;
        vec4 world = modelMatrix * vec4(p, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uDeep;
      uniform vec3 uSky;
      uniform vec3 uSunColor;
      uniform vec3 uSunDir;
      uniform vec3 uHaze;
      uniform float uSunStrength;
      uniform float uTime;
      varying vec3 vWorld;
      varying vec2 vUv;

      ${NOISE_GLSL}

      void main() {
        vec3 V = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - clamp(V.y, 0.0, 1.0), 3.0);
        vec3 col = mix(uDeep, uSky, 0.28 + 0.68 * fres);

        float flow = uTime;
        float s1 = vnoise(vec2(vUv.x * 5.0, vUv.y * 34.0 + flow * 1.4));
        float s2 = vnoise(vec2(vUv.x * 11.0, vUv.y * 88.0 + flow * 2.7));
        float band = sin(vUv.y * 58.0 + flow * 3.4 + vUv.x * 3.5);

        col *= 0.92 + 0.12 * s1;
        col += uSky * pow(s2, 7.0) * 0.16;
        col += uSunColor * smoothstep(0.82, 1.0, band) * 0.055 * uSunStrength;

        vec3 R = reflect(-V, vec3(0.0, 1.0, 0.0));
        float glint = pow(max(dot(R, normalize(uSunDir)), 0.0), 90.0);
        col += uSunColor * glint * (0.55 + 0.65 * s1) * 1.35 * uSunStrength;

        float edge = 1.0 - smoothstep(0.0, 0.16, vUv.x) + smoothstep(0.84, 1.0, vUv.x);
        col += uSky * edge * 0.05 * (0.4 + 0.6 * s2);

        float d = length(vWorld - cameraPosition);
        float fog = smoothstep(18.0, 88.0, d) * 0.55;
        col = mix(col, uHaze, fog);

        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 1;
  return { mesh, material };
}

/* ------------------------------------------------------------------ */
/* contact shadows                                                     */
/* ------------------------------------------------------------------ */

function makeShadowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(30, 40, 24, 0.55)');
  g.addColorStop(0.55, 'rgba(32, 43, 26, 0.26)');
  g.addColorStop(1, 'rgba(32, 43, 26, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ------------------------------------------------------------------ */
/* falling leaves                                                      */
/* ------------------------------------------------------------------ */

function createFallingLeaves() {
  const count = 18;
  const geometry = new THREE.PlaneGeometry(0.34, 0.46);
  const material = new THREE.MeshBasicMaterial({
    color: '#7f8b48',
    side: THREE.DoubleSide
  });

  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;

  const pool = [];
  for (let i = 0; i < count; i++) {
    pool.push({
      active: false,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      spin: new THREE.Vector3(),
      life: 0,
      size: 1,
      phase: 0
    });
  }

  const dummy = new THREE.Object3D();
  let timer = 1.4;

  function spawn(trees, breeze) {
    if (!trees.length) return;
    const leaf = pool.find((l) => !l.active);
    if (!leaf) return;
    const tree = trees[Math.floor(Math.random() * trees.length)];
    leaf.active = true;
    leaf.pos.set(
      tree.x + (Math.random() - 0.5) * 2.2 * tree.scale,
      tree.y + (3.8 + Math.random() * 1.2) * tree.scale,
      tree.z + (Math.random() - 0.5) * 2.2 * tree.scale
    );
    leaf.vel.set(
      breeze.dir.x * breeze.strength * 0.55 + (Math.random() - 0.5) * 0.16,
      -0.12 - Math.random() * 0.1,
      breeze.dir.y * breeze.strength * 0.55 + (Math.random() - 0.5) * 0.16
    );
    leaf.spin.set(Math.random() * 3.5, Math.random() * 3.5, Math.random() * 3.5);
    leaf.size = 0.75 + Math.random() * 0.5;
    leaf.life = 4.5 + Math.random() * 4;
    leaf.phase = Math.random() * Math.PI * 2;
  }

  function update(t, dt, breeze, trees) {
    timer -= dt;
    if (timer <= 0) {
      if (breeze.strength > 0.14) spawn(trees, breeze);
      timer = 1.0 + Math.random() * 2.4;
    }

    for (let i = 0; i < pool.length; i++) {
      const leaf = pool[i];
      if (!leaf.active) {
        dummy.position.set(0, -100, 0);
        dummy.scale.setScalar(0.0001);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        continue;
      }

      leaf.life -= dt;
      leaf.vel.y -= 0.24 * dt;
      leaf.vel.x += breeze.dir.x * breeze.strength * 0.35 * dt;
      leaf.vel.z += breeze.dir.y * breeze.strength * 0.35 * dt;
      leaf.pos.addScaledVector(leaf.vel, dt);
      leaf.pos.x += Math.sin(t * 3.1 + leaf.phase) * 0.14 * dt;
      leaf.pos.z += Math.cos(t * 2.6 + leaf.phase) * 0.1 * dt;

      const ground = terrainHeight(leaf.pos.x, leaf.pos.z) + 0.04;
      if (leaf.life <= 0 || leaf.pos.y <= ground) {
        leaf.active = false;
        dummy.position.set(0, -100, 0);
        dummy.scale.setScalar(0.0001);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        continue;
      }

      const fade = Math.min(1, leaf.life / 0.7);
      const s = leaf.size * fade;
      dummy.position.copy(leaf.pos);
      dummy.rotation.set(t * leaf.spin.x + leaf.phase, t * leaf.spin.y, t * leaf.spin.z);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  return { mesh, material, update };
}

/* ------------------------------------------------------------------ */
/* assembly                                                            */
/* ------------------------------------------------------------------ */

export function createLandmarks() {
  const group = new THREE.Group();

  const stream = createStream();
  group.add(stream.mesh);

  const treeMaterial = createTreeMaterial();
  const treeSpecs = [
    { x: -3.6, z: -28, scale: 0.82, seed: 7, variant: 0 },
    { x: 1.9, z: -33, scale: 0.74, seed: 23, variant: 1 },
    { x: 5.3, z: -38, scale: 0.70, seed: 41, variant: 2 }
  ];

  const trees = [];
  for (const spec of treeSpecs) {
    const geo = buildTreeGeometry(spec.seed, spec.variant);
    const mesh = new THREE.Mesh(geo, treeMaterial);
    const y = terrainHeight(spec.x, spec.z);
    mesh.position.set(spec.x, y, spec.z);
    mesh.scale.setScalar(spec.scale);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    group.add(mesh);
    trees.push({
      mesh,
      x: spec.x,
      y,
      z: spec.z,
      scale: spec.scale
    });
  }

  const windmill = buildWindmillAsset();
  const windmillScale = 0.50;
  const windmillX = 0.6;
  const windmillZ = -47;
  windmill.group.position.set(
    windmillX,
    terrainHeight(windmillX, windmillZ),
    windmillZ
  );
  windmill.group.scale.setScalar(windmillScale);
  windmill.group.rotation.y = 0.15;
  group.add(windmill.group);

  const shadowTexture = makeShadowTexture();
  const shadowGeo = new THREE.CircleGeometry(1, 24);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowTexture,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    toneMapped: false
  });

  const shadows = [];
  for (const tree of trees) {
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(tree.x, tree.y + 0.02, tree.z);
    shadow.scale.setScalar(2.0 * tree.scale);
    group.add(shadow);
    shadows.push(shadow);
  }
  const windmillShadow = new THREE.Mesh(shadowGeo, shadowMat);
  windmillShadow.rotation.x = -Math.PI / 2;
  windmillShadow.position.set(
    windmillX,
    terrainHeight(windmillX, windmillZ) + 0.02,
    windmillZ
  );
  windmillShadow.scale.setScalar(1.25);
  group.add(windmillShadow);
  shadows.push(windmillShadow);

  const leaves = createFallingLeaves();
  group.add(leaves.mesh);

  const breeze = {
    strength: 0.24,
    dir: new THREE.Vector2(0.9, 0.24).normalize()
  };
  const params = { wind: 1.0 };

  const windmillBase = new Map();
  for (const mat of Object.values(windmill.materials)) {
    windmillBase.set(mat, mat.color.clone());
  }
  const leafBase = new THREE.Color('#7f8b48');

  function setTime({ haze, sunColor, sunDir, sunStrength = 1, night = 0 }) {
    if (sunColor) {
      stream.material.uniforms.uSunColor.value.copy(sunColor);
      treeMaterial.uniforms.uSunColor.value.copy(sunColor);
    }
    if (sunDir) {
      stream.material.uniforms.uSunDir.value.copy(sunDir);
      treeMaterial.uniforms.uSunDir.value.copy(sunDir);
    }
    if (haze) {
      stream.material.uniforms.uHaze.value.copy(haze);
      stream.material.uniforms.uSky.value.copy(haze).lerp(sunColor || haze, 0.12);
      treeMaterial.uniforms.uHaze.value.copy(haze);
      for (const [mat, base] of windmillBase) {
        mat.color.copy(base).lerp(haze, 0.16).multiplyScalar(1 - night * 0.4);
      }
      leaves.material.color.copy(leafBase).lerp(haze, 0.3).multiplyScalar(1 - night * 0.45);
      shadowMat.opacity = 0.32 * (1 - night * 0.5);
    }
    stream.material.uniforms.uSunStrength.value = sunStrength;
    treeMaterial.uniforms.uSunStrength.value = sunStrength;
    treeMaterial.uniforms.uNight.value = night;
    treeMaterial.uniforms.uHazeAmount.value = 1;
  }

  function update(t, dt) {
    const base = 0.14 + 0.08 * Math.sin(t * 0.13 + 0.4) + 0.05 * Math.sin(t * 0.41 + 1.7);
    const gust = Math.pow(Math.max(0, Math.sin(t * 0.085 + 0.7)), 5) * 0.26;
    breeze.strength = (base + gust) * params.wind;
    breeze.dir.set(
      0.9 + 0.06 * Math.sin(t * 0.05),
      0.24 + 0.06 * Math.cos(t * 0.07)
    ).normalize();

    treeMaterial.uniforms.uTime.value = t;
    treeMaterial.uniforms.uWindStrength.value = breeze.strength;
    treeMaterial.uniforms.uWindDir.value.copy(breeze.dir);

    stream.material.uniforms.uTime.value = t;
    windmill.rotor.rotation.z -= dt * (0.1 + breeze.strength * 0.55);
    leaves.update(t, dt, breeze, trees);
  }

  return {
    group,
    stream,
    trees,
    windmill,
    leaves,
    shadows,
    treeMaterial,
    breeze,
    params,
    setTime,
    update
  };
}