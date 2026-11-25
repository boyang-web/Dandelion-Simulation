import * as THREE from 'three';
import { terrainHeight } from './meadow.js';

/* ------------------------------------------------------------------ */
/* Night fireflies                                                     */
/*                                                                     */
/*  · fade in slowly as the sky reaches deeper night                    */
/*  · drift on their own (slow orbit + bob + spring)                    */
/*  · are pushed by the same local wind field as grass and seeds        */
/* ------------------------------------------------------------------ */

const TAU = Math.PI * 2;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export function createFireflies({
  count = 110,
  heightAt = terrainHeight,
  xRange = 11.0,
  zNear = 1.0,
  zFar = -22.0,
  // Valley-scale fields can use a broad radial footprint instead of the
  // little camera-facing rectangle used by the old close-up meadow.
  radius = null,
  minRadius = 0,
  heightMin = 0.90,
  heightMax = 2.60,
  sizeScale = 1.0,
  speedScale = 1.0
} = {}) {
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const speeds = new Float32Array(count);
  const sizes = new Float32Array(count);
  const flies = [];

  for (let i = 0; i < count; i++) {
    let ax;
    let az;
    if (radius != null) {
      const a = Math.random() * TAU;
      // sqrt keeps the population evenly spread over the disc rather than
      // bunching every firefly near the middle.
      const rr = Math.sqrt(
        minRadius * minRadius +
        Math.max(0, radius * radius - minRadius * minRadius) * Math.random()
      );
      ax = Math.cos(a) * rr;
      az = Math.sin(a) * rr;
    } else {
      ax = (Math.random() * 2 - 1) * xRange;
      az = zNear - Math.random() * (zNear - zFar);
    }
    const ay = heightAt(ax, az) +
      heightMin + Math.random() * Math.max(0.01, heightMax - heightMin);
    const phase = Math.random() * TAU;
    const speed = (0.65 + Math.random() * 0.95) * speedScale;

    flies.push({
      ax, ay, az,
      x: ax,
      y: ay,
      z: az,
      vx: 0, vy: 0, vz: 0,
      phase,
      speed,
      orbit: 0.12 + Math.random() * (radius != null ? 0.95 : 0.55),
      bob: 0.06 + Math.random() * (radius != null ? 0.45 : 0.22),
      spring: 0.30 + Math.random() * 0.35,
      damp: 0.85 + Math.random() * 0.9,
      wind: 0.30 + Math.random() * 0.55
    });

    positions[i * 3] = ax;
    positions[i * 3 + 1] = ay;
    positions[i * 3 + 2] = az;
    phases[i] = phase;
    speeds[i] = speed;
    sizes[i] = 0.60 + Math.random() * 0.35;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

  const uniforms = {
    uTime: { value: 0 },
    uGlow: { value: 0 },
    uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
    uColor: { value: new THREE.Color('#ffd36e') },
    uBreathMin: { value: 0.04 },
    uBreathMax: { value: 1.0 },
    uBreathPower: { value: 2.2 },
    uSpeedScale: { value: speedScale },
    uSizeScale: { value: sizeScale }
  };

  const params = {
    fadeRate: 0.60,
    breathMin: 0.04,
    breathMax: 1.0,
    breathPower: 2.2,
    speedScale,
    sizeScale,
    windScale: 1.0
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aPhase;
      attribute float aSpeed;
      attribute float aSize;
      uniform float uTime;
      uniform float uGlow;
      uniform float uPixelRatio;
      uniform float uBreathMin;
      uniform float uBreathMax;
      uniform float uBreathPower;
      uniform float uSpeedScale;
      uniform float uSizeScale;
      varying float vAlpha;

      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uSizeScale * uPixelRatio * (240.0 / max(-mv.z, 1.0));
        float breath = uBreathMin + (uBreathMax - uBreathMin) *
          pow(0.5 + 0.5 * sin(uTime * aSpeed * uSpeedScale + aPhase), uBreathPower);
        vAlpha = uGlow * breath;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vAlpha;

      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv);
        if (d > 0.5) discard;
        float halo = pow(smoothstep(0.5, 0.0, d), 1.2);
        float core = smoothstep(0.20, 0.0, d);
        vec3 col = uColor * (1.55 + 1.05 * halo) + vec3(0.36, 0.18, 0.0) * core;
        float alpha = (halo * 0.90 + core * 0.50) * vAlpha;
        gl_FragColor = vec4(col, alpha);
        #include <colorspace_fragment>
      }
    `
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 3;

  let glow = 0;
  let target = 0;
  const air = new THREE.Vector3();
  const probe = new THREE.Vector3();

  function setNight(night) {
    target = smoothstep(0.22, 0.82, night);
  }

  function update(t, dt, wind) {
    // Slow, deliberate fade rather than a switch.
    glow += (target - glow) * (1 - Math.exp(-dt * params.fadeRate));
    uniforms.uGlow.value = glow;
    uniforms.uTime.value = t;
    uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio || 1, 2);
    uniforms.uBreathMin.value = params.breathMin;
    uniforms.uBreathMax.value = params.breathMax;
    uniforms.uBreathPower.value = params.breathPower;
    uniforms.uSpeedScale.value = params.speedScale;
    uniforms.uSizeScale.value = params.sizeScale;

    if (glow < 0.002) return;

    for (let i = 0; i < count; i++) {
      const f = flies[i];

      const wantX =
        f.ax +
        Math.sin(t * f.speed + f.phase) * f.orbit +
        Math.sin(t * f.speed * 2.3 + f.phase * 1.7) * f.orbit * 0.28;
      const wantZ =
        f.az +
        Math.cos(t * f.speed * 0.83 + f.phase * 1.4) * f.orbit +
        Math.sin(t * f.speed * 1.9 + f.phase * 2.1) * f.orbit * 0.22;
      const wantY =
        f.ay +
        Math.sin(t * f.speed * 0.7 + f.phase * 2.1) * f.bob;

      probe.set(f.x, f.y, f.z);
      wind.airAtWorld(probe, air);

      f.vx += (wantX - f.x) * f.spring * dt + air.x * f.wind * params.windScale * dt;
      f.vy += (wantY - f.y) * f.spring * dt + air.y * f.wind * 0.7 * params.windScale * dt;
      f.vz += (wantZ - f.z) * f.spring * dt + air.z * f.wind * params.windScale * dt;

      const damp = Math.exp(-f.damp * dt);
      f.vx *= damp;
      f.vy *= damp;
      f.vz *= damp;

      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.z += f.vz * dt;

      const floor = heightAt(f.x, f.z) + 0.18;
      if (f.y < floor) {
        f.y = floor;
        f.vy = Math.abs(f.vy) * 0.25;
      }

      positions[i * 3] = f.x;
      positions[i * 3 + 1] = f.y;
      positions[i * 3 + 2] = f.z;
    }

    geometry.attributes.position.needsUpdate = true;
  }

  return {
    points,
    material,
    geometry,
    params,
    setNight,
    update,
    get level() { return glow; }
  };
}