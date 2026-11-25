import * as THREE from 'three';
import {
  VEGETATION_ASSETS,
  ASSET_GROUPS,
  getVegetationAsset,
  createVegetationMaterial
} from './vegetation.js';

const canvas = document.getElementById('stage');
const viewEl = document.querySelector('.view');
const assetList = document.getElementById('assetList');
const allBtn = document.getElementById('allBtn');
const variantsBtn = document.getElementById('variantsBtn');
const reseedBtn = document.getElementById('reseedBtn');
const windInput = document.getElementById('wind');
const windVal = document.getElementById('windVal');
const capIndex = document.getElementById('capIndex');
const capName = document.getElementById('capName');
const capEn = document.getElementById('capEn');
const capNote = document.getElementById('capNote');
const capMeta = document.getElementById('capMeta');

/* ------------------------------------------------------------------ */
/* renderer & scene                                                    */
/* ------------------------------------------------------------------ */

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  powerPreference: 'high-performance'
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0x000000, 0);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(31, 1, 0.02, 80);

const hemi = new THREE.HemisphereLight(0xfff5df, 0x55613e, 1.25);
scene.add(hemi);

const key = new THREE.DirectionalLight(0xffddb0, 2.35);
key.position.set(3.4, 6.2, 4.2);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -4.4;
key.shadow.camera.right = 4.4;
key.shadow.camera.top = 4.8;
key.shadow.camera.bottom = -2.6;
key.shadow.camera.near = 0.5;
key.shadow.camera.far = 20;
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.02;
key.shadow.radius = 3;
scene.add(key);

const fill = new THREE.DirectionalLight(0xd6e4e9, 0.48);
fill.position.set(-4.2, 3.4, 2.0);
scene.add(fill);

const rim = new THREE.DirectionalLight(0xffe1b8, 0.75);
rim.position.set(-1.0, 4.0, -5.0);
scene.add(rim);

const groundMat = new THREE.MeshStandardMaterial({
  color: '#c6c4a6',
  roughness: 0.96,
  metalness: 0
});
const ground = new THREE.Mesh(new THREE.CircleGeometry(3.6, 96), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.012;
ground.receiveShadow = true;
scene.add(ground);

const rimGeo = new THREE.RingGeometry(3.55, 3.6, 96);
const rimMat = new THREE.MeshBasicMaterial({
  color: '#9da184',
  transparent: true,
  opacity: 0.55,
  side: THREE.DoubleSide,
  toneMapped: false
});
const rimRing = new THREE.Mesh(rimGeo, rimMat);
rimRing.rotation.x = -Math.PI / 2;
rimRing.position.y = -0.006;
scene.add(rimRing);

const plants = new THREE.Group();
scene.add(plants);

const labels = new THREE.Group();
scene.add(labels);

const plantMaterial = createVegetationMaterial();

/* ------------------------------------------------------------------ */
/* camera state                                                        */
/* ------------------------------------------------------------------ */

const view = {
  az: 0.36,
  el: 0.24,
  radius: 4.6,
  wantRadius: 4.6,
  targetY: 0.6,
  wantTargetY: 0.6
};

const params = new URLSearchParams(window.location.search);
let currentId = VEGETATION_ASSETS[0].id;
const requestedAsset = params.get('asset');
if (requestedAsset && VEGETATION_ASSETS.some((asset) => asset.id === requestedAsset)) {
  currentId = requestedAsset;
}
let allMode = params.get('all') === '1';
let showVariants = !allMode && params.get('variants') === '1';
let seedSalt = 0;

function updateCamera(dt) {
  const ease = Math.min(1, dt * 7.5);
  view.radius += (view.wantRadius - view.radius) * ease;
  view.targetY += (view.wantTargetY - view.targetY) * ease;
  const cy = view.targetY;
  const cosEl = Math.cos(view.el);
  camera.position.set(
    Math.sin(view.az) * cosEl * view.radius,
    cy + Math.sin(view.el) * view.radius,
    Math.cos(view.az) * cosEl * view.radius
  );
  camera.lookAt(0, cy, 0);
}

/* ------------------------------------------------------------------ */
/* labels                                                              */
/* ------------------------------------------------------------------ */

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function makeLabel(text, accent = '#8fa85c') {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);

  roundedRect(ctx, 18, 20, 476, 88, 20);
  ctx.fillStyle = 'rgba(246, 241, 228, 0.86)';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(62, 71, 51, 0.12)';
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(50, 64, 5, 0, Math.PI * 2);
  ctx.fillStyle = accent;
  ctx.fill();

  ctx.font = '500 30px "Songti SC", "Noto Serif SC", "STSong", serif';
  ctx.fillStyle = 'rgba(55, 64, 46, 0.86)';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 72, 65);

  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.9, 0.225, 1);
  sprite.renderOrder = 50;
  sprite.userData.texture = texture;
  return sprite;
}

/* ------------------------------------------------------------------ */
/* building the shelf                                                  */
/* ------------------------------------------------------------------ */

function clearPlants() {
  for (const child of [...plants.children, ...labels.children]) {
    if (child.parent) child.parent.remove(child);
    if (child.geometry) child.geometry.dispose();
    if (child.material && child.material !== plantMaterial) {
      if (child.material.map) child.material.map.dispose();
      child.material.dispose();
    }
  }
}

function addPlant(asset, seed, x, z, labelText, labelScale = 1) {
  const geometry = asset.build(seed);
  const mesh = new THREE.Mesh(geometry, plantMaterial);
  mesh.position.set(x, 0, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  plants.add(mesh);

  const label = makeLabel(labelText, asset.accent);
  label.scale.multiplyScalar(labelScale);
  label.position.set(x, 0.085, z + 0.38);
  labels.add(label);
}

function focusLayout(asset) {
  const salts = [seedSalt, seedSalt, seedSalt];
  if (showVariants) {
    const xs = [-0.8, 0, 0.8];
    const seeds = [asset.seeds[1] + salts[0], asset.seeds[0] + salts[1], asset.seeds[2] + salts[2]];
    const names = ['变体 A', '主株', '变体 B'];
    for (let i = 0; i < 3; i++) {
      addPlant(asset, seeds[i], xs[i], 0, names[i], 0.84);
    }
    view.wantRadius = Math.max(4.1, asset.height[1] * 2.7 + 1.5);
  } else {
    addPlant(asset, asset.seeds[0] + seedSalt, 0, 0, '单株', 1);
    view.wantRadius = Math.max(2.9, asset.height[1] * 2.8 + 1.0);
  }
  view.wantTargetY = asset.height[1] * 0.46;
}

function allLayout() {
  const xs = [-1.36, 0, 1.36];
  const zs = [0.94, 0, -0.94];
  let i = 0;
  for (const asset of VEGETATION_ASSETS) {
    const col = i % 3;
    const row = Math.floor(i / 3);
    addPlant(asset, asset.seeds[0] + seedSalt, xs[col], zs[row], `${asset.index}  ${asset.label}`, 0.78);
    i++;
  }
  view.wantRadius = 6.25;
  view.wantTargetY = 0.62;
}

function updateCaption() {
  if (allMode) {
    capIndex.textContent = 'ALL / 09';
    capName.textContent = '全部资产';
    capEn.textContent = 'NINE SINGLE PLANTS';
    capNote.textContent = '5 种草、4 种花，每种 3 个种子变体。所有单株都由同一套程序化几何规则生成，可直接进入下一步的草地装配。';
    capMeta.textContent = '03 × 03 陈列 · 顶点色 · 可实例化';
    return;
  }

  const asset = getVegetationAsset(currentId);
  capIndex.textContent = `${asset.index} / ${asset.kind.toUpperCase()}`;
  capName.textContent = asset.label;
  capEn.textContent = asset.en;
  capNote.textContent = asset.note;
  const seedList = asset.seeds.map((s) => s + seedSalt).join(' / ');
  capMeta.textContent =
    `高度 ${asset.height[0].toFixed(2)}–${asset.height[1].toFixed(2)} m · ` +
    `${asset.stat} · 种子 ${seedList}`;
}

function refreshList() {
  for (const btn of assetList.querySelectorAll('.asset-item')) {
    btn.classList.toggle('is-active', !allMode && btn.dataset.id === currentId);
  }
  allBtn.classList.toggle('is-active', allMode);
  variantsBtn.disabled = allMode;
  variantsBtn.setAttribute('aria-pressed', String(showVariants && !allMode));
  variantsBtn.textContent = showVariants && !allMode ? '只看主株' : '显示 3 个变体';
}

function rebuild() {
  clearPlants();
  if (allMode) allLayout();
  else focusLayout(getVegetationAsset(currentId));
  updateCaption();
  refreshList();
}

/* ------------------------------------------------------------------ */
/* ui                                                                  */
/* ------------------------------------------------------------------ */

function buildList() {
  for (const group of ASSET_GROUPS) {
    const label = document.createElement('p');
    label.className = 'group-label';
    label.textContent = group.label;
    assetList.appendChild(label);

    for (const asset of group.assets) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'asset-item';
      btn.dataset.id = asset.id;
      btn.innerHTML =
        `<span class="asset-item__idx">${asset.index}</span>` +
        `<span class="asset-item__body">` +
        `<span class="asset-item__name">${asset.label}</span>` +
        `<span class="asset-item__en">${asset.en}</span>` +
        `</span>` +
        `<span class="asset-item__dot" style="--accent:${asset.accent}"></span>`;
      btn.addEventListener('click', () => {
        allMode = false;
        currentId = asset.id;
        rebuild();
      });
      assetList.appendChild(btn);
    }
  }
}

allBtn.addEventListener('click', () => {
  if (allMode) {
    allMode = false;
  } else {
    allMode = true;
    showVariants = false;
  }
  rebuild();
});

variantsBtn.addEventListener('click', () => {
  if (allMode) return;
  showVariants = !showVariants;
  rebuild();
});

reseedBtn.addEventListener('click', () => {
  seedSalt += 137;
  rebuild();
});

windInput.addEventListener('input', () => {
  const v = Number(windInput.value);
  plantMaterial.userData.uniforms.uWind.value = v;
  windVal.textContent = v.toFixed(2);
});

/* ------------------------------------------------------------------ */
/* orbit / zoom                                                        */
/* ------------------------------------------------------------------ */

let dragging = false;
let lastX = 0;
let lastY = 0;
let pointerId = null;

canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  dragging = true;
  pointerId = e.pointerId;
  lastX = e.clientX;
  lastY = e.clientY;
  canvas.classList.add('is-dragging');
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
});

canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;
  view.az -= dx * 0.0065;
  view.el = THREE.MathUtils.clamp(view.el + dy * 0.0045, 0.06, 1.05);
});

function endOrbit(e) {
  dragging = false;
  canvas.classList.remove('is-dragging');
  if (pointerId !== null) {
    try { canvas.releasePointerCapture(pointerId); } catch (err) { /* noop */ }
    pointerId = null;
  }
  if (e) e.preventDefault();
}
canvas.addEventListener('pointerup', endOrbit);
canvas.addEventListener('pointercancel', endOrbit);
canvas.addEventListener('lostpointercapture', endOrbit);

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  view.wantRadius = THREE.MathUtils.clamp(
    view.wantRadius * Math.exp(e.deltaY * 0.0011),
    1.5,
    14
  );
}, { passive: false });

/* ------------------------------------------------------------------ */
/* size & loop                                                         */
/* ------------------------------------------------------------------ */

function resize() {
  const w = viewEl.clientWidth || window.innerWidth;
  const h = viewEl.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
}

window.addEventListener('resize', resize);

const clock = new THREE.Clock();
let time = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 1 / 20);
  time += dt;

  plantMaterial.userData.uniforms.uTime.value = time;
  updateCamera(dt);
  renderer.render(scene, camera);
}

buildList();
plantMaterial.userData.uniforms.uWind.value = Number(windInput.value);
windVal.textContent = Number(windInput.value).toFixed(2);
view.wantRadius = 2.9;
view.radius = 2.9;
view.wantTargetY = 0.6;
view.targetY = 0.6;
rebuild();
resize();
animate();

window.__veg = { scene, camera, renderer, plants, labels, plantMaterial, view, rebuild };