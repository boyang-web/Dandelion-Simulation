import * as THREE from 'three';
import { WindField } from './wind.js';
import { createValleyWorld } from './world.js';
import { DandelionField } from './dandelion-field.js';
import { OrbitRig } from './orbit.js';
import { Sky } from './sky.js';
import { createPostPipeline } from './post.js';

/* ------------------------------------------------------------------ */
/*  Valley study page                                                  */
/*  The whole bowl is real geometry now: meadow floor, foothills and   */
/*  an encircling mountain range in one continuous heightfield.        */
/* ------------------------------------------------------------------ */

const params = new URLSearchParams(window.location.search);
const isDebug = params.has('debug');
if (params.has('clean')) document.body.classList.add('clean');

const timeParam = parseFloat(params.get('time') ?? '');
const initialTime = Number.isFinite(timeParam)
  ? Math.max(0, Math.min(1, timeParam))
  : 0.4;

const canvas = document.getElementById('stage');
const hint = document.getElementById('hint');
const debugEl = document.getElementById('debug');

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

const camera = new THREE.PerspectiveCamera(
  40,
  window.innerWidth / window.innerHeight,
  0.1,
  1400
);

const hemi = new THREE.HemisphereLight(0xfff6e5, 0x5a6742, 1.0);
const keyLight = new THREE.DirectionalLight(0xffddb0, 1.9);
keyLight.position.set(5.5, 8.5, 4.5);
const fill = new THREE.DirectionalLight(0xcfe4e8, 0.35);
fill.position.set(-6, 3.2, 4.0);
const rim = new THREE.DirectionalLight(0xffe4bd, 0.55);
rim.position.set(-2.5, 4.5, -6.0);
scene.add(hemi, keyLight, fill, rim);

const wind = new WindField(camera);
const quality = params.get('quality') || 'auto';
const world = createValleyWorld(scene, { camera, quality });
const field = new DandelionField({ scene, camera, renderer, wind });

const orbit = new OrbitRig(camera, canvas, {
  target: new THREE.Vector3(0, 4.2, -4),
  minRadius: 4,
  maxRadius: 180,
  minPitch: 0.01,
  maxPitch: Math.PI / 2 - 0.02,
  freeLook: true,
  lookPitchMin: -1.35,
  lookPitchMax: 1.35,
  groundAt: world.heightAt,
  clearance: 1.8
});
orbit.radius = coarse ? 54 : 48;
orbit.pitch = 0.04;
orbit.yaw = 0.8;
orbit.onDragStart = () => wind.setEnabled(false);
orbit.onDragEnd = () => wind.setEnabled(true);

const sky = new Sky({
  wind,
  world,
  keyLight,
  hemi,
  fill,
  rim,
  initial: initialTime,
  camera,
  celestial3D: true
});

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
/* fireflies overlay                                                   */
/* ------------------------------------------------------------------ */

const fireflyCanvas = document.getElementById('fireflies');
let fireflyRenderer = null;
const fireflyScene = new THREE.Scene();
const fireflyCamera = new THREE.PerspectiveCamera(
  40,
  window.innerWidth / window.innerHeight,
  0.1,
  1400
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

/* ------------------------------------------------------------------ */
/* framing                                                             */
/* ------------------------------------------------------------------ */

function frameCamera() {
  const aspect = window.innerWidth / window.innerHeight;
  const portrait = aspect < 0.8;
  camera.fov = portrait ? 58 : 54;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();

  if (!orbit.hasView) {
    orbit.radius = portrait ? (coarse ? 66 : 62) : (coarse ? 54 : 48);
    orbit.pitch = portrait ? 0.06 : 0.04;
    orbit.fov = camera.fov;
  }
  orbit.apply();
  camera.updateMatrixWorld();
}
frameCamera();
sky.sync(camera);

/* ------------------------------------------------------------------ */
/* planting                                                            */
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
    // Event timestamps, not handler time: a heavy frame can delay the
    // pointerup handler by several hundred milliseconds even for a short tap.
    time: e.timeStamp,
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
  if (e.timeStamp - tap.time > 650) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;

  planterNdc.set(
    (e.clientX / window.innerWidth) * 2 - 1,
    -(e.clientY / window.innerHeight) * 2 + 1
  );
  planterRay.setFromCamera(planterNdc, camera);
  const hits = planterRay.intersectObject(world.ground, false);
  if (!hits.length) return;

  const point = hits[0].point;
  const r = Math.hypot(point.x, point.z);
  if (r > 78 || point.y > 20) return;
  if (world.slopeAt(point.x, point.z) > 0.42) return;
  field.spawnAt(point);
}

canvas.addEventListener('pointerup', finishTap);
canvas.addEventListener('pointercancel', (e) => {
  taps.delete(e.pointerId);
  if (taps.size === 0) tapMulti = false;
});

/* ------------------------------------------------------------------ */
/* ui                                                                  */
/* ------------------------------------------------------------------ */

const rootStyle = document.documentElement.style;
let lastShownWind = -1;
let interacted = false;

function updateUI() {
  const shown = Math.min(1, 0.04 + Math.max(wind.strength, wind.energy, wind.breezePower * 0.55) * 0.96);
  if (Math.abs(shown - lastShownWind) > 0.012) {
    rootStyle.setProperty('--wind', shown.toFixed(3));
    lastShownWind = shown;
  }

  if (!interacted && (wind.strength > 0.12 || field.count > 0 || orbit.hasView)) {
    interacted = true;
    document.body.classList.add('interacted');
    if (hint) hint.setAttribute('aria-hidden', 'true');
  }
}


/* ------------------------------------------------------------------ */
/* loop                                                                */
/* ------------------------------------------------------------------ */

const clock = new THREE.Clock();
let elapsed = 0;
let ready = false;
let debugTimer = 0;
let fps = 60;

function updateDebug() {
  if (!debugEl) return;
  const stats = field.stats();
  const meadows = world.meadows || [world.meadow];
  const carpets = world.carpets || [world.carpet];
  const clumps = meadows.reduce((n, m) => n + m.grassCount, 0);
  const flowers = meadows.reduce((n, m) => n + m.flowerCount, 0);
  const blades = carpets.reduce((n, c) => n + c.count, 0);
  const lod = world.lod || { near: true, mid: true };
  debugEl.hidden = false;
  debugEl.textContent =
    `fps ${fps.toFixed(0)}\n` +
    `plants ${String(stats.plants).padStart(2)}  flying ${String(stats.flying).padStart(3)}\n` +
    `grass ${clumps} clumps + ${blades} blades · flowers ${flowers}\n` +
    `lod near ${lod.near ? 'on' : 'off'}  mid ${lod.mid ? 'on' : 'off'}\n` +
    `wind ${wind.strength.toFixed(2)}  time ${sky.time.toFixed(2)}\n` +
    `calls ${renderer.info.render.calls}  tris ${renderer.info.render.triangles}`;
}

function stepScene(dt) {
  elapsed += dt;
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

  sky.update(rawDt);
  stepScene(dt);
  sky.sync(camera);
  updateUI();
  renderScene();
  renderFireflies();

  if (!ready) {
    ready = true;
    document.body.classList.add('ready');
  }

  if (isDebug) {
    debugTimer += dt;
    if (debugTimer > 0.25) {
      debugTimer = 0;
      updateDebug();
    }
  }
}

const stillSeconds = parseFloat(params.get('still') || '0');
if (stillSeconds > 0) {
  document.body.classList.add('still');
  const dt = 1 / 60;
  const steps = Math.round(stillSeconds * 60);
  for (let i = 0; i < steps; i++) stepScene(dt);
  sky.sync(camera);
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
  fireflyCamera.aspect = width / height;
  fireflyCamera.updateProjectionMatrix();
  frameCamera();
  sky.resize();
  sky.sync(camera);
  post.resize();
});

window.__valley = {
  scene,
  camera,
  renderer,
  wind,
  world,
  field,
  orbit,
  sky,
  post,
  fireflyRenderer,
  fireflyScene
};