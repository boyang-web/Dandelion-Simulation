import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/*  Distant birds                                                      */
/*                                                                     */
/*  A small flock crosses the sky every so often. They are real 3D      */
/*  silhouettes, not screen-space sprites, so the ridge line can hide    */
/*  them when they dip below the horizon. Wings flap in the vertex       */
/*  shader; the whole flock shares one InstancedMesh and one draw call. */
/* ------------------------------------------------------------------ */

const BIRD_COUNT = 7;
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

export function createBirds({ scene, params: initial = {} } = {}) {
  const params = {
    gapMin: 28,
    gapMax: 64,
    speed: 6.4,
    scale: 1.0,
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
      uColor: { value: new THREE.Color('#2c3439') },
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
    const row = Math.ceil(i / 3) - 1;
    offsets.push({
      side: i * 0.95 - 2.6 + (i > 3 ? 0.5 : 0),
      lift: Math.sin(i * 1.7) * 0.32 + row * 0.22,
      depth: Math.sin(i * 2.3) * 1.6,
      scale: 0.82 + Math.random() * 0.4
    });
  }

  const state = {
    active: false,
    timer: 14 + Math.random() * 12,
    elapsed: 0,
    dir: -1,
    speed: params.speed
  };

  function spawn() {
    state.active = true;
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
    mesh.visible = true;
  }

  function rest() {
    state.active = false;
    mesh.visible = false;
    state.timer = params.gapMin + Math.random() * Math.max(1, params.gapMax - params.gapMin);
  }

  function update(t, dt, sky = {}) {
    material.uniforms.uTime.value = t;

    const daylight = 1 - Math.min(1, Math.max(0, sky.night || 0));
    const visible = daylight * (0.75 + 0.25 * (sky.day || 0));
    material.uniforms.uOpacity.value = 0.62 * visible;

    if (!state.active) {
      state.timer -= dt;
      if (state.timer <= 0) spawn();
      return;
    }

    state.elapsed += dt;
    const k = Math.min(1, state.elapsed / state.duration);
    const ease = k * k * (3 - 2 * k);
    const leadX = state.xStart + (state.xEnd - state.xStart) * ease;
    const leadZ = state.zNear + (state.zFar - state.zNear) * ease;
    const leadY = state.yNear + (state.yFar - state.yNear) * ease;

    if (k >= 1) {
      rest();
      return;
    }

    material.uniforms.uOpacity.value = 0.62 * daylight * (0.75 + 0.25 * (sky.day || 0)) * (1 - 0.35 * ease);

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
    mesh.instanceMatrix.needsUpdate = true;
  }

  return {
    mesh,
    material,
    params,
    state,
    spawn,
    update,
    setTime({ night = 0, day = 1 } = {}) {
      material.uniforms.uOpacity.value = 0.62 * (1 - night) * (0.75 + 0.25 * day);
    }
  };
}