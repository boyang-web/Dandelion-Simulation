import * as THREE from 'three';
import { WindField } from './wind.js';
import { createWorld } from './world.js';
import { DANDELION_PARAMS } from './dandelion.js';
import { DandelionField } from './dandelion-field.js';
import { OrbitRig } from './orbit.js';
import { Sky } from './sky.js';
import { createPostPipeline } from './post.js';
import { createDevConsole } from './dev-console.js';

const params = new URLSearchParams(window.location.search);
const isDebug = params.has('debug');
const isAuto = params.has('auto');
// Production boot is deliberately console-free: no DEV button, no saved
// localStorage values. `index.html?dev=1` (or dev.html) is the developer boot.
const isDev = params.has('dev');
if (params.has('clean')) document.body.classList.add('clean');

const canvas = document.getElementById('stage');
const hint = document.getElementById('hint');
const debugEl = document.getElementById('debug');
const timeParam = parseFloat(params.get('time') ?? '');
const initialTime = Number.isFinite(timeParam)
  ? Math.max(0, Math.min(1, timeParam))
  : 0.4;

let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance'
  });
} catch (err) {
  document.body.classList.add('no-webgl');
  throw err;
}

const coarse = window.matchMedia('(pointer: coarse)').matches;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.6 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.setClearColor(0x000000, 0);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(33, window.innerWidth / window.innerHeight, 0.08, 460);
const basePosition = new THREE.Vector3();
const lookAt = new THREE.Vector3();

function frameCamera() {
  const aspect = window.innerWidth / window.innerHeight;
  const phoneLandscape = coarse && window.innerHeight <= 560 && aspect >= 1.2;

  if (aspect < 0.8) {
    // Portrait phone: pull back so the head keeps its width.
    camera.fov = 33;
    basePosition.set(0, 2.28, 11.7);
    lookAt.set(0, 2.56, 0);
  } else if (phoneLandscape) {
    // Landscape phone: a little wider and lower, so the short screen still
    // shows the head, the grass foreground and the ridge line without the
    // masthead/hint crowding the subject.
    camera.fov = 35;
    basePosition.set(0, 2.02, 9.9);
    lookAt.set(0, 2.38, 0);
  } else {
    camera.fov = 33;
    basePosition.set(0, 2.12, 9.4);
    lookAt.set(0, 2.53, 0);
  }
  camera.position.copy(basePosition);
  camera.lookAt(lookAt);
  camera.updateProjectionMatrix();
}
frameCamera();

// A small three-light setup: warm key from the sun, cool sky fill, and a
// soft rim from behind so the stem has some shape instead of flat green.
const hemi = new THREE.HemisphereLight(0xfff6e5, 0x5a6742, 1.0);
const keyLight = new THREE.DirectionalLight(0xffddb0, 1.9);
keyLight.position.set(5.5, 8.5, 4.5);
const fill = new THREE.DirectionalLight(0xcfe4e8, 0.35);
fill.position.set(-6, 3.2, 4.0);
const rim = new THREE.DirectionalLight(0xffe4bd, 0.55);
rim.position.set(-2.5, 4.5, -6.0);
scene.add(hemi, keyLight, fill, rim);

const wind = new WindField(camera);
const world = createWorld(scene, { camera });
const field = new DandelionField({ scene, camera, renderer, wind });
const orbit = new OrbitRig(camera, canvas, {
  target: new THREE.Vector3(0, 2.0, 0.02),
  minRadius: 2.5,
  maxRadius: 32,
  minPitch: 0,
  maxPitch: Math.PI / 2 - 0.02
});
orbit.onDragStart = () => wind.setEnabled(false);
orbit.onDragEnd = () => wind.setEnabled(true);

const sky = new Sky({
  wind,
  world,
  keyLight,
  hemi,
  fill,
  rim,
  initial: initialTime
});

/* ------------------------------------------------------------------ */
/* post light pipeline                                                 */
/* ------------------------------------------------------------------ */

const post = createPostPipeline({
  renderer,
  scene,
  camera,
  enabled: params.get('post') !== '0'
});

sky.post = post;

function renderScene() {
  post.setTime(sky.lightState, sky.lightState.sunDir);
  post.render();
}

/* ------------------------------------------------------------------ */
/* fireflies: a separate transparent layer above the night veil        */
/* ------------------------------------------------------------------ */

const fireflyCanvas = document.getElementById('fireflies');
let fireflyRenderer = null;
const fireflyScene = new THREE.Scene();
const fireflyCamera = new THREE.PerspectiveCamera(
  33,
  window.innerWidth / window.innerHeight,
  0.08,
  240
);

if (fireflyCanvas) {
  try {
    fireflyRenderer = new THREE.WebGLRenderer({
      canvas: fireflyCanvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    fireflyRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.6 : 2));
    fireflyRenderer.setSize(window.innerWidth, window.innerHeight);
    fireflyRenderer.outputColorSpace = THREE.SRGBColorSpace;
    fireflyRenderer.toneMapping = THREE.NoToneMapping;
    fireflyRenderer.setClearColor(0x000000, 0);
    fireflyScene.add(world.fireflies.points);
  } catch (err) {
    fireflyRenderer = null;
  }
}

function renderFireflies() {
  if (!fireflyRenderer) return;
  fireflyCamera.copy(camera);
  fireflyCamera.updateMatrixWorld();
  fireflyRenderer.render(fireflyScene, fireflyCamera);
}

let devConsole = null;
if (isDev) {
  devConsole = createDevConsole({
    wind,
    dandelion: { params: DANDELION_PARAMS },
    sky,
    world,
    fireflies: world.fireflies,
    birds: world.birds,
    post
  });
}

/* ------------------------------------------------------------------ */
/* controls are always-on; only hints live here                       */
/* ------------------------------------------------------------------ */

const hintMouse = document.querySelector('.hint__text--mouse');
const hintTouch = document.querySelector('.hint__text--touch');
if (hintMouse) hintMouse.textContent = '滑过草地 · 起风　·　拖动 · 视角　·　点击 · 种植';
if (hintTouch) hintTouch.textContent = '单指滑过 · 起风　·　双指 · 视角　·　轻点 · 种植';

/* ------------------------------------------------------------------ */
/* ui                                                                  */
/* ------------------------------------------------------------------ */

const rootStyle = document.documentElement.style;
let lastShownWind = -1;
let interacted = false;

function updateUI() {
  const shown = Math.min(1, 0.04 + Math.max(wind.strength, wind.energy) * 0.96);
  if (Math.abs(shown - lastShownWind) > 0.012) {
    rootStyle.setProperty('--wind', shown.toFixed(3));
    lastShownWind = shown;
  }

  if (!interacted && (wind.strength > 0.12 || field.count > 0 || orbit.hasView)) {
    interacted = true;
    document.body.classList.add('interacted');
    hint.setAttribute('aria-hidden', 'true');
  }
}

/* ------------------------------------------------------------------ */
/* planting (tap)                                                      */
/* ------------------------------------------------------------------ */

const planterRay = new THREE.Raycaster();
const planterNdc = new THREE.Vector2();
const taps = new Map();
let tapMulti = false;

canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (taps.size > 0) tapMulti = true;
  taps.set(e.pointerId, {
    x: e.clientX,
    y: e.clientY,
    time: performance.now(),
    moved: false
  });
});

canvas.addEventListener('pointermove', (e) => {
  const tap = taps.get(e.pointerId);
  if (!tap) return;
  if (Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 8) tap.moved = true;
});

function finishTap(e) {
  const tap = taps.get(e.pointerId);
  if (!tap) return;
  const multi = tapMulti;
  taps.delete(e.pointerId);
  if (taps.size === 0) tapMulti = false;

  if (multi || tap.moved) return;
  if (performance.now() - tap.time > 380) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;

  planterNdc.set(
    (e.clientX / window.innerWidth) * 2 - 1,
    -(e.clientY / window.innerHeight) * 2 + 1
  );
  planterRay.setFromCamera(planterNdc, camera);
  const hits = planterRay.intersectObject(world.ground, false);
  if (!hits.length) return;

  const point = hits[0].point;
  if (Math.abs(point.x) > 20 || point.z < -30 || point.z > 12) return;
  field.spawnAt(point);
}

canvas.addEventListener('pointerup', finishTap);
canvas.addEventListener('pointercancel', (e) => {
  taps.delete(e.pointerId);
  if (taps.size === 0) tapMulti = false;
});

/* ------------------------------------------------------------------ */
/* camera drift                                                        */
/* ------------------------------------------------------------------ */
/* camera drift                                                        */
/* ------------------------------------------------------------------ */

function updateCamera(t) {
  if (orbit.hasView) {
    orbit.apply();
    return;
  }

  // The ground should feel planted. No pointer-driven camera parallax:
  // only an almost imperceptible breathing drift over tens of seconds.
  const driftX = Math.sin(t * 0.075) * 0.012;
  const driftY = Math.sin(t * 0.11 + 0.7) * 0.008;
  const driftZ = Math.sin(t * 0.06 + 0.3) * 0.012;

  camera.position.set(
    basePosition.x + driftX,
    basePosition.y + driftY,
    basePosition.z + driftZ
  );
  camera.lookAt(lookAt.x, lookAt.y, lookAt.z);
  camera.updateMatrixWorld();
}

/* ------------------------------------------------------------------ */
/* optional auto-demo (?auto)                                          */
/* ------------------------------------------------------------------ */

let autoClock = 0;
const autoHead = new THREE.Vector2();
const AUTO_ANCHOR = new THREE.Vector3(0, 2.56, 0.02);

// The auto demo drags an invisible 'hand' across the dandelion, then back.
function driveAuto(dt) {
  autoClock += dt;
  const cycle = autoClock % 10.0;
  const W = window.innerWidth;
  wind.projectToScreen(AUTO_ANCHOR, autoHead);

  if (cycle > 2.2 && cycle < 2.9) {
    const k = (cycle - 2.2) / 0.7;
    const x = W * (0.16 + 0.68 * k);
    wind.force((W * 0.68) / 0.7, 0, x, autoHead.y);
  } else if (cycle > 6.2 && cycle < 6.9) {
    const k = (cycle - 6.2) / 0.7;
    const x = W * (0.84 - 0.68 * k);
    wind.force(-(W * 0.68) / 0.7, 0, x, autoHead.y);
  } else {
    wind.force(0, 0);
  }
}

/* ------------------------------------------------------------------ */
/* main loop                                                           */
/* ------------------------------------------------------------------ */

const clock = new THREE.Clock();
let elapsed = 0;
let ready = false;
let debugTimer = 0;
let fps = 60;

const stillSeconds = parseFloat(params.get('still') || '0');
const gustAt = parseFloat(params.get('gust') || '-1');
const gustX = params.has('gustx') ? parseFloat(params.get('gustx')) : null;
const gustY = params.has('gusty') ? parseFloat(params.get('gusty')) : null;
const headScreen = new THREE.Vector2();

function updateDebug() {
  const stats = field.stats();
  debugEl.hidden = false;
  debugEl.textContent =
    `fps ${fps.toFixed(0)}\n` +
    `plants ${String(stats.plants).padStart(2)}  head ${String(stats.head).padStart(4)}  flying ${String(stats.flying).padStart(3)}\n` +
    `wind ${wind.strength.toFixed(2)}  energy ${wind.energy.toFixed(2)}\n` +
    `time ${sky.time.toFixed(2)}  v_avg ${stats.avgSpeed.toFixed(2)}`;
}

function stepScene(dt) {
  elapsed += dt;
  updateCamera(elapsed);

  if (isAuto) {
    driveAuto(dt);
  } else if (gustAt >= 0) {
    const active = elapsed >= gustAt && elapsed < gustAt + 0.55;

    if (active) {
      const W = window.innerWidth;
      const H = window.innerHeight;
      wind.projectToScreen(AUTO_ANCHOR, headScreen);

      const baseX = gustX === null ? headScreen.x : W * gustX;
      const baseY = gustY === null ? headScreen.y : H * gustY;
      const k = THREE.MathUtils.clamp((elapsed - gustAt) / 0.55, 0, 1);
      const x = baseX + (k - 0.5) * 150;

      wind.force(W * 0.98, -H * 0.02, x, baseY);
    } else {
      wind.force(0, 0);
    }
  }

  wind.update(dt, elapsed);
  world.update(elapsed, dt, wind);
  field.update(elapsed, dt);
}

function animate() {
  requestAnimationFrame(animate);

  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 1 / 30);
  if (!dt) return;
  fps += ((1 / dt) - fps) * 0.05;

  // The day cycle follows wall-clock time even when a heavy frame is clamped
  // for the physics step.
  sky.update(rawDt);
  stepScene(dt);
  updateUI();
  renderScene();
  renderFireflies();

  if (!ready) {
    ready = true;
    document.body.classList.add('ready');
  }

  if (isDebug) {
    debugTimer += dt;
    if (debugTimer > 0.2) {
      debugTimer = 0;
      updateDebug();
    }
  }
}

if (stillSeconds > 0) {
  // Headless still-frame mode: simulate a few seconds, then paint one frame.
  document.body.classList.add('still');
  const dt = 1 / 60;
  const steps = Math.round(stillSeconds * 60);
  for (let i = 0; i < steps; i++) stepScene(dt);
  updateUI();
  document.body.classList.add('ready');
  renderScene();
  renderFireflies();
  if (isDebug) updateDebug();
} else {
  animate();
}

window.addEventListener('resize', () => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.6 : 2));
  renderer.setSize(width, height);
  if (fireflyRenderer) {
    fireflyRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.6 : 2));
    fireflyRenderer.setSize(width, height);
  }
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  frameCamera();
  if (orbit.hasView) orbit.apply();
  sky.resize();
  post.resize();
});

// A tiny console handle for tinkering.
window.__dandy = {
  scene, camera, renderer, wind, world, field, orbit,
  sky, post, fireflyRenderer, fireflyScene, devConsole, dandelionParams: DANDELION_PARAMS
};