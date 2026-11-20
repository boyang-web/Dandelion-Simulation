import * as THREE from 'three';
import { createDistantWorld } from './world.js';
import { Sky } from './sky.js';
import { createPostPipeline } from './post.js';
import { createDevConsole } from './dev-console.js';

/* ------------------------------------------------------------------ */
/*  Distant-field study page                                          */
/*  Only the sky, sun/moon arc, far ridges, birds and the plain        */
/*  terrain silhouette. No dandelion, grass, flowers or fireflies.     */
/* ------------------------------------------------------------------ */

const params = new URLSearchParams(window.location.search);
const isDebug = params.has('debug');
if (params.has('clean')) document.body.classList.add('clean');

const timeParam = parseFloat(params.get('time') ?? '');
const initialTime = Number.isFinite(timeParam)
  ? Math.max(0, Math.min(1, timeParam))
  : 0.42;

const canvas = document.getElementById('stage');
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
const camera = new THREE.PerspectiveCamera(33, window.innerWidth / window.innerHeight, 0.08, 460);

function frameCamera() {
  const aspect = window.innerWidth / window.innerHeight;
  const portrait = aspect < 0.78;
  camera.fov = portrait ? 42 : 33;
  camera.position.set(0, portrait ? 2.5 : 2.3, portrait ? 17.5 : 12.5);
  camera.lookAt(0, portrait ? 6.4 : 5.1, -55);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}
frameCamera();

const hemi = new THREE.HemisphereLight(0xfff6e5, 0x5a6742, 1.0);
const keyLight = new THREE.DirectionalLight(0xffddb0, 1.9);
keyLight.position.set(5.5, 8.5, 4.5);
const fill = new THREE.DirectionalLight(0xcfe4e8, 0.35);
fill.position.set(-6, 3.2, 4.0);
const rim = new THREE.DirectionalLight(0xffe4bd, 0.55);
rim.position.set(-2.5, 4.5, -6.0);
scene.add(hemi, keyLight, fill, rim);

const world = createDistantWorld(scene, { camera });

const windStub = { params: {}, cancelGesture() {} };
const dandelionStub = { setTime() {} };
const farConsoleStub = {
  params: {},
  points: { geometry: { attributes: { position: { count: 0 } } } }
};

const sky = new Sky({
  wind: windStub,
  world,
  dandelion: dandelionStub,
  keyLight,
  hemi,
  fill,
  rim,
  initial: initialTime
});

const post = createPostPipeline({
  renderer,
  scene,
  camera,
  enabled: params.get('post') !== '0'
});

sky.post = post;

const devConsole = createDevConsole({
  wind: windStub,
  dandelion: dandelionStub,
  sky,
  world,
  fireflies: farConsoleStub,
  birds: world.birds,
  post,
  mode: 'distant'
});

/* ------------------------------------------------------------------ */
/* loop                                                                */
/* ------------------------------------------------------------------ */

const clock = new THREE.Clock();
let elapsed = 0;
let ready = false;
let debugTimer = 0;

function renderScene() {
  post.setTime(sky.lightState, sky.lightState.sunDir);
  post.render();
}

function updateDebug() {
  debugEl.hidden = false;
  debugEl.textContent =
    `time ${sky.time.toFixed(2)}\n` +
    `birds ${world.birds.state.active ? '7 flying' : 'resting'}\n` +
    `haze ${world.params.haze.toFixed(2)}  sun ${sky.lightState.sunStrength.toFixed(2)}\n` +
    `calls ${renderer.info.render.calls}  tris ${renderer.info.render.triangles}`;
}

function animate() {
  requestAnimationFrame(animate);

  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 1 / 30);
  if (!dt) return;

  elapsed += dt;
  sky.update(rawDt);
  world.update(elapsed, dt);
  renderScene();

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
  for (let i = 0; i < steps; i++) {
    elapsed += dt;
    world.update(elapsed, dt);
  }
  document.body.classList.add('ready');
  renderScene();
  if (isDebug) updateDebug();
} else {
  animate();
}

window.addEventListener('resize', () => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.6 : 2));
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  frameCamera();
  sky.resize();
  post.resize();
});

window.__dandy = { scene, camera, renderer, world, sky, post, devConsole, mode: 'distant' };