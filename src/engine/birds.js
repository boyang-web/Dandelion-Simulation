import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/*  Distant birds                                                      */
/*                                                                     */
/*  Two flight styles share one InstancedMesh and one draw call:        */
/*                                                                     */
/*  · crossing  — the old shallow pass across the skyline.              */
/*  · soaring   — a flock wheels around the whole valley in 3D. Each    */
/*                bird sits on its own point of the same curve, so the  */
/*                formation banks, stretches and turns together.        */
/*                                                                     */
/*  Wings flap in the vertex shader. Real depth means the mountain      */
/*  ridge can hide birds as they pass behind it.                        */
/* ------------------------------------------------------------------ */

const BIRD_COUNT = 9;
const TAU = Math.PI * 2;

function birdGeometry() {
  // A shallow V: body at the origin, two swept wings and a short tail.
  const vertices = new Float32Array([
    0.0, 0.10, 0.02,   // 0 body / head
    -0.68, 0.03, 0.08, // 1 left wing tip
    -0.46, 0.0, -0.10, // 2 left trailing
    0.0, 0.02, -0.16,  // 3 tail
    0.46, 0.0, -0.10,  // 4 right trailing
    0.68, 0.03, 0.08   // 5 right wing tip
  ]);
  const indices = [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function smoothstep(min, max, x) {
  const t = Math.max(0, Math.min(1, (x - min) / (max - min)));
  return t * t * (3 - 2 * t);
}

export function createBirds({ scene, params: initial = {} } = {}) {
  const params = {
    gapMin: 28,
    gapMax: 64,
    speed: 6.4,
    scale: 1.0,
    style: 'crossing',
    // Soaring parameters. `heightAt` makes the flock climb over the
    // foothills instead of cutting through them.
    heightAt: null,
    radiusMin: 85,
    radiusMax: 135,
    altitudeMin: 27,
    altitudeMax: 43,
    clearance: 11,
    ...initial
  };

  const geometry = birdGeometry();
  const phases = new Float32Array(BIRD_COUNT);
  const speeds = new Float32Array(BIRD_COUNT);
  for (let i = 0; i < BIRD_COUNT; i++) {
    phases[i] = Math.random() * TAU;
    speeds[i] = 7.5 + Math.random() * 3.5;
  }
  geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
  geometry.setAttribute('aSpeed', new THREE.InstancedBufferAttribute(speeds, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color('#242c30') },
      uOpacity: { value: 0.0 },
      uFlap: { value: 0.52 }
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uFlap;
      attribute float aPhase;
      attribute float aSpeed;

      void main() {
        vec3 p = position;
        float wing = abs(p.x);
        float flap = sin(uTime * aSpeed + aPhase);
        p.y += wing * flap * uFlap;
        p.z += wing * abs(flap) * 0.12;

        vec4 world = modelMatrix * instanceMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      void main() {
        gl_FragColor = vec4(uColor, uOpacity);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false
  });

  const mesh = new THREE.InstancedMesh(geometry, material, BIRD_COUNT);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.visible = false;
  if (scene) scene.add(mesh);

  const dummy = new THREE.Object3D();
  const offsets = [];
  for (let i = 0; i < BIRD_COUNT; i++) {
    const rank = Math.ceil(i / 2);
    const side = i === 0 ? 0 : (i % 2 === 1 ? -1 : 1);
    const row = Math.ceil(i / 3) - 1;
    offsets.push({
      // old crossing formation
      side: i * 0.95 - 2.6 + (i > 3 ? 0.5 : 0),
      lift: Math.sin(i * 1.7) * 0.32 + row * 0.22,
      depth: Math.sin(i * 2.3) * 1.6,
      // soaring V: behind the leader along the curve + lateral spread
      behind: i === 0 ? 0 : rank * 2.7 + (Math.random() - 0.5) * 0.6,
      lateral: side * rank * 2.25 + (Math.random() - 0.5) * 0.45,
      soarLift: (i === 0 ? 1.1 : 0.35) + Math.sin(i * 1.4) * 0.55 - rank * 0.08,
      scale: 0.82 + Math.random() * 0.4
    });
  }

  const state = {
    active: false,
    timer: 10 + Math.random() * 14,
    elapsed: 0,
    dir: -1,
    speed: params.speed,
    style: params.style
  };

  function setFlockAlpha(alpha) {
    material.uniforms.uOpacity.value = Math.max(0, Math.min(1, alpha));
  }

  function spawnCrossing() {
    state.style = 'crossing';
    state.elapsed = 0;
    state.dir = Math.random() < 0.5 ? -1 : 1;
    // Start closer and drift away: perspective plus a small scale ramp
    // makes the flock visibly recede into the haze.
    state.zNear = -26 - Math.random() * 10;
    state.zFar = state.zNear - (55 + Math.random() * 38);
    state.yNear = 7.6 + Math.random() * 2.4;
    state.yFar = state.yNear + 3.4 + Math.random() * 3.2;
    state.xStart = -state.dir * (19 + Math.random() * 9);
    state.xEnd = state.dir * (17 + Math.random() * 9);
    const path = Math.hypot(
      state.xEnd - state.xStart,
      state.zFar - state.zNear
    );
    state.duration = Math.max(6, path / Math.max(2, params.speed));
  }

  function spawnSoaring() {
    state.style = 'soaring';
    state.elapsed = 0;
    state.dir = Math.random() < 0.5 ? -1 : 1;
    state.angle0 = Math.random() * TAU;
    state.angleSpan = state.dir * (0.78 + Math.random() * 0.52) * TAU;
    state.radius = params.radiusMin +
      Math.random() * Math.max(1, params.radiusMax - params.radiusMin);
    state.centerX = (Math.random() - 0.5) * 16;
    state.centerZ = (Math.random() - 0.5) * 20;
    state.baseY = params.altitudeMin +
      Math.random() * Math.max(1, params.altitudeMax - params.altitudeMin);
    state.phase = Math.random() * TAU;
    const path = Math.abs(state.angleSpan) * state.radius;
    state.duration = Math.max(22, path / Math.max(8, params.speed));
  }

  function spawn() {
    state.active = true;
    if (params.style === 'soaring') spawnSoaring();
    else spawnCrossing();
    mesh.visible = true;
  }

  function rest() {
    state.active = false;
    mesh.visible = false;
    setFlockAlpha(0);
    state.timer = params.gapMin +
      Math.random() * Math.max(1, params.gapMax - params.gapMin);
  }

  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const worldUp = new THREE.Vector3(0, 1, 0);
  const basis = new THREE.Matrix4();

  function updateSoaring(t, k, daylight, sky) {
    const eased = k * k * (3 - 2 * k);
    const angle = state.angle0 + state.angleSpan * eased;
    const fadeIn = smoothstep(0, 0.10, k);
    const fadeOut = 1 - smoothstep(0.88, 1, k);
    const alpha = daylight * (0.78 + 0.22 * (sky.day || 0)) * fadeIn * fadeOut;

    for (let i = 0; i < BIRD_COUNT; i++) {
      const o = offsets[i];
      // Each bird follows its own angle on the same circular course. The
      // result is a formation that naturally compresses and banks in turns.
      const radius = Math.max(18, state.radius + o.lateral);
      const a = angle - state.dir * (o.behind / radius);
      const x = state.centerX + Math.cos(a) * radius;
      const z = state.centerZ + Math.sin(a) * radius;

      // A slow thermal-like rise and fall; the terrain clamp keeps the
      // flock above the foothills while it circles the bowl.
      const wave = Math.sin(a * 1.7 + state.phase + i * 0.37) * 1.8;
      let y = state.baseY + o.soarLift + wave;
      if (params.heightAt) {
        y = Math.max(y, params.heightAt(x, z) + params.clearance);
      }

      dummy.position.set(x, y, z);

      // Tangent of the circle at this bird's angle. The bird's local +Z is
      // its beak, so the basis aligns forward with the tangent.
      forward.set(-Math.sin(a) * state.dir, 0, Math.cos(a) * state.dir).normalize();
      right.crossVectors(worldUp, forward).normalize();
      up.crossVectors(forward, right).normalize();
      basis.makeBasis(right, up, forward);
      dummy.quaternion.setFromRotationMatrix(basis);

      // Bank into the turn, with a tiny individual wobble.
      const bank = state.dir * (0.24 + Math.sin(a * 2 + i * 0.8) * 0.045);
      dummy.rotateZ(bank);

      const s = params.scale * o.scale;
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }

    setFlockAlpha(0.68 * alpha);
    mesh.instanceMatrix.needsUpdate = true;
  }

  function updateCrossing(t, k, daylight, sky) {
    const ease = k * k * (3 - 2 * k);
    const leadX = state.xStart + (state.xEnd - state.xStart) * ease;
    const leadZ = state.zNear + (state.zFar - state.zNear) * ease;
    const leadY = state.yNear + (state.yFar - state.yNear) * ease;
    const fadeIn = smoothstep(0, 0.06, k);
    const fadeOut = 1 - smoothstep(0.94, 1, k);

    for (let i = 0; i < BIRD_COUNT; i++) {
      const o = offsets[i];
      const along = -state.dir * o.side;
      const bob = Math.sin(t * 0.9 + i * 1.3) * 0.18;
      dummy.position.set(
        leadX + along,
        leadY + o.lift + bob,
        leadZ + o.depth - o.side * 0.4
      );
      dummy.rotation.set(0, state.dir > 0 ? 0.1 : -0.1, 0);
      // perspective already shrinks them; this small extra ramp makes the
      // recede read even against a flat sky.
      const s = params.scale * o.scale * (1.12 - 0.38 * ease);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }

    const alpha = daylight * (0.76 + 0.24 * (sky.day || 0)) * fadeIn * fadeOut;
    setFlockAlpha(0.64 * alpha);
    mesh.instanceMatrix.needsUpdate = true;
  }

  function update(t, dt, sky = {}) {
    material.uniforms.uTime.value = t;

    const daylight = 1 - Math.min(1, Math.max(0, sky.night || 0));

    if (daylight < 0.045) {
      if (state.active) rest();
      else mesh.visible = false;
      setFlockAlpha(0);
      return;
    }

    if (!state.active) {
      state.timer -= dt;
      if (state.timer <= 0) spawn();
      return;
    }

    state.elapsed += dt;
    const k = Math.min(1, state.elapsed / state.duration);

    if (state.style === 'soaring') updateSoaring(t, k, daylight, sky);
    else updateCrossing(t, k, daylight, sky);

    if (k >= 1) {
      rest();
      return;
    }
  }

  return {
    mesh,
    material,
    params,
    state,
    spawn,
    update,
    setTime({ night = 0, day = 1 } = {}) {
      material.uniforms.uOpacity.value = 0;
      if (night < 0.955) {
        material.uniforms.uOpacity.value = 0.62 * (1 - night) * (0.75 + 0.25 * day);
        mesh.visible = state.active;
      } else {
        mesh.visible = false;
      }
    }
  };
}