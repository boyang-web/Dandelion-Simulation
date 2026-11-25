import * as THREE from 'three';
import { buildTreeGeometry, createTreeMaterial } from './tree-assets.js?v=7';
import { buildWindmillAsset } from './windmill-asset.js?v=7';

/* ------------------------------------------------------------------ */
/*  Far-asset preview: trees + windmill                                */
/* ------------------------------------------------------------------ */

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
/* assets                                                              */
/* ------------------------------------------------------------------ */

const TREE_ASSETS = [
  {
    id: 'tree-a',
    kind: 'tree',
    index: '01',
    label: '梧桐 A',
    en: 'Plane tree · A',
    accent: '#7f9957',
    seed: 7,
    variant: 0,
    seeds: [7, 23, 41],
    height: [5.8, 6.4],
    stat: '2.7 m 直干 · 4 主枝 · 掌状叶',
    note: '顺着浅色的树皮往上看，主干高处分出四根粗枝，撑起一顶圆树冠。每片叶子都有五个裂尖。'
  },
  {
    id: 'tree-b',
    kind: 'tree',
    index: '02',
    label: '梧桐 B',
    en: 'Plane tree · B',
    accent: '#6f8b4c',
    seed: 23,
    variant: 1,
    seeds: [23, 41, 7],
    height: [5.9, 6.5],
    stat: '更宽冠 · 主枝更长',
    note: '这棵伸枝最远，树冠也宽。单独放在远坡上就能看清它的轮廓。'
  },
  {
    id: 'tree-c',
    kind: 'tree',
    index: '03',
    label: '梧桐 C',
    en: 'Plane tree · C',
    accent: '#8a9a55',
    seed: 41,
    variant: 2,
    seeds: [41, 11, 31],
    height: [5.6, 6.2],
    stat: '窄冠 · 主枝更向上',
    note: '枝条向上收拢，树冠窄一些。几棵并排种，或放在风车旁都合适。'
  }
];

const WINDMILL_ASSET = {
  id: 'windmill',
  kind: 'windmill',
  index: '04',
  label: '风车',
  en: 'Smock mill',
  accent: '#b07a55',
  height: [7.5, 11.4],
  stat: '砖塔 6.7 m · 叶轮 9.2 m',
  note: '木廊围着八角砖塔。数一数正面的四片风叶，再转到背面看尾杆和小尾轮。塔顶可以转向迎风。'
};

const ASSETS = [...TREE_ASSETS, WINDMILL_ASSET];
const GROUPS = [
  { label: '树 · TREE', assets: TREE_ASSETS },
  { label: '风车 · WINDMILL', assets: [WINDMILL_ASSET] }
];

/* ------------------------------------------------------------------ */
/* renderer / scene                                                    */
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
const camera = new THREE.PerspectiveCamera(33, 1, 0.05, 120);

const hemi = new THREE.HemisphereLight(0xfff5df, 0x55613e, 1.3);
scene.add(hemi);

const key = new THREE.DirectionalLight(0xffddb0, 2.5);
key.position.set(4.2, 7.4, 4.8);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -12;
key.shadow.camera.right = 12;
key.shadow.camera.top = 13;
key.shadow.camera.bottom = -3;
key.shadow.camera.near = 0.5;
key.shadow.camera.far = 40;
key.shadow.bias = -0.0005;
key.shadow.normalBias = 0.025;
key.shadow.radius = 4;
scene.add(key);

const fill = new THREE.DirectionalLight(0xd6e4e9, 0.55);
fill.position.set(-5.5, 4.0, 3.0);
scene.add(fill);

const rim = new THREE.DirectionalLight(0xffe1b8, 0.85);
rim.position.set(-2.0, 5.0, -6.0);
scene.add(rim);

const groundMat = new THREE.MeshStandardMaterial({
  color: '#c6c4a6',
  roughness: 0.97,
  metalness: 0
});
const ground = new THREE.Mesh(new THREE.CircleGeometry(24, 120), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.012;
ground.receiveShadow = true;
scene.add(ground);

const rimRing = new THREE.Mesh(
  new THREE.RingGeometry(23.85, 24, 120),
  new THREE.MeshBasicMaterial({
    color: '#9da184',
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
    toneMapped: false
  })
);
rimRing.rotation.x = -Math.PI / 2;
rimRing.position.y = -0.006;
scene.add(rimRing);

const items = new THREE.Group();
scene.add(items);
const labels = new THREE.Group();
scene.add(labels);
const shadows = new THREE.Group();
scene.add(shadows);

/* ------------------------------------------------------------------ */
/* shared tree material + contact shadow                               */
/* ------------------------------------------------------------------ */

const treeMaterial = createTreeMaterial();
treeMaterial.uniforms.uSunColor.value.set('#ffe2b6');
treeMaterial.uniforms.uSunDir.value.set(0.42, 0.74, 0.52).normalize();
treeMaterial.uniforms.uSunStrength.value = 1.15;
treeMaterial.uniforms.uHaze.value.set('#e9e4d2');
treeMaterial.uniforms.uHazeAmount.value = 0.6;

function makeShadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(32, 42, 24, 0.52)');
  g.addColorStop(0.55, 'rgba(34, 45, 26, 0.26)');
  g.addColorStop(1, 'rgba(34, 45, 26, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const shadowTexture = makeShadowTexture();
const shadowGeo = new THREE.CircleGeometry(1.7, 32);
const shadowMat = new THREE.MeshBasicMaterial({
  map: shadowTexture,
  transparent: true,
  depthWrite: false,
  toneMapped: false
});

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

function makeLabel(text, accent = '#6f8f55') {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);

  roundedRect(ctx, 18, 20, 476, 88, 20);
  ctx.fillStyle = 'rgba(246, 241, 228, 0.88)';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(62, 71, 51, 0.12)';
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(50, 64, 5, 0, Math.PI * 2);
  ctx.fillStyle = accent;
  ctx.fill();

  ctx.font = '500 30px "Songti SC", "Noto Serif SC", "STSong", serif';
  ctx.fillStyle = 'rgba(55, 64, 46, 0.88)';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 72, 65);

  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.0, 0.25, 1);
  sprite.renderOrder = 60;
  return sprite;
}

/* ------------------------------------------------------------------ */
/* camera                                                              */
/* ------------------------------------------------------------------ */

const view = {
  az: 0.42,
  el: 0.22,
  radius: 7,
  wantRadius: 7,
  targetY: 2.4,
  wantTargetY: 2.4
};

function portrait() {
  return camera.aspect < 0.9;
}

function applyCameraForMode() {
  const p = portrait();
  if (allMode) {
    view.wantRadius = p ? 34 : 26;
    view.wantTargetY = 4.8;
  } else if (currentId === WINDMILL_ASSET.id) {
    view.wantRadius = p ? 24 : 20;
    view.wantTargetY = 5.7;
  } else if (showVariants) {
    view.wantRadius = p ? 28 : 20;
    view.wantTargetY = 3.0;
  } else {
    view.wantRadius = p ? 20 : 15;
    view.wantTargetY = 3.0;
  }
}

function updateCamera(dt) {
  const ease = Math.min(1, dt * 7.5);
  view.radius += (view.wantRadius - view.radius) * ease;
  view.targetY += (view.wantTargetY - view.targetY) * ease;
  const cosEl = Math.cos(view.el);
  camera.position.set(
    Math.sin(view.az) * cosEl * view.radius,
    view.targetY + Math.sin(view.el) * view.radius,
    Math.cos(view.az) * cosEl * view.radius
  );
  camera.lookAt(0, view.targetY, 0);
}

/* ------------------------------------------------------------------ */
/* layout state                                                        */
/* ------------------------------------------------------------------ */

const params = new URLSearchParams(window.location.search);
let currentId = params.get('asset') || TREE_ASSETS[0].id;
if (!ASSETS.some((a) => a.id === currentId)) currentId = TREE_ASSETS[0].id;
let allMode = params.get('all') === '1';
let showVariants = !allMode && params.get('variants') === '1';
let seedSalt = 0;
let currentWindmill = null;

/* ------------------------------------------------------------------ */
/* building                                                            */
/* ------------------------------------------------------------------ */

function disposeWindmill(windmill) {
  if (!windmill) return;
  windmill.group.traverse((obj) => {
    if (!obj.isMesh) return;
    if (obj.geometry) obj.geometry.dispose();
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) {
      if (!mat) continue;
      if (mat.map) mat.map.dispose();
      mat.dispose();
    }
  });
}

function clearAll() {
  for (const group of [items, labels, shadows]) {
    for (const child of [...group.children]) {
      group.remove(child);
      if (!child.isSprite && child.geometry && child.geometry !== shadowGeo) {
        child.geometry.dispose();
      }
      if (child.material && child.material !== treeMaterial && child.material !== shadowMat) {
        if (child.material.map) child.material.map.dispose();
        child.material.dispose();
      }
    }
  }
  disposeWindmill(currentWindmill);
  currentWindmill = null;
}

function addTree(asset, seed, x, z, labelText, scale = 1) {
  const geometry = buildTreeGeometry(seed, asset.variant);
  const mesh = new THREE.Mesh(geometry, treeMaterial);
  mesh.position.set(x, 0, z);
  mesh.scale.setScalar(scale);
  items.add(mesh);

  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(x, 0.01, z + 0.1);
  shadow.scale.setScalar(scale * 1.8);
  shadows.add(shadow);

  const label = makeLabel(labelText, asset.accent);
  label.scale.multiplyScalar(0.92);
  label.position.set(x, 6.2 * scale, z + 0.4);
  labels.add(label);
  return mesh;
}

function addWindmill(x = 0, z = 0) {
  const windmill = buildWindmillAsset();
  windmill.group.position.set(x, 0, z);
  windmill.group.rotation.y = 0.12;
  items.add(windmill.group);
  currentWindmill = windmill;

  const label = makeLabel('风车 / Windmill', WINDMILL_ASSET.accent);
  label.scale.multiplyScalar(1.15);
  label.position.set(x, 9.6, z + 0.4);
  labels.add(label);

  return windmill;
}

function focusLayout(asset) {
  if (asset.kind === 'windmill') {
    addWindmill();
    return;
  }

  if (showVariants) {
    const xs = [-4.4, 0, 4.4];
    const seeds = asset.seeds.map((s) => s + seedSalt);
    const names = ['变体 A', '主株', '变体 B'];
    for (let i = 0; i < 3; i++) {
      addTree(asset, seeds[i], xs[i], 0, names[i], 0.92);
    }
  } else {
    addTree(asset, asset.seeds[0] + seedSalt, 0, 0, asset.label, 1);
  }
}

function allLayout() {
  const xs = [-7.2, -2.2, 2.8];
  for (let i = 0; i < TREE_ASSETS.length; i++) {
    const asset = TREE_ASSETS[i];
    addTree(asset, asset.seeds[0] + seedSalt, xs[i], 0, asset.label, 0.95);
  }
  addWindmill(8.2, -3.2);
}

function updateCaption() {
  if (allMode) {
    capIndex.textContent = 'ALL / 04';
    capName.textContent = '全部远景资产';
    capEn.textContent = 'TREES & WINDMILL';
    capNote.textContent = '三棵不同形态的阔叶树，加一座带画廊和格栅叶片的风车。树与风车都可以单独放大检查。';
    capMeta.textContent = '03 棵树 + 01 座风车 · 合并几何 / 材质';
    return;
  }

  const asset = ASSETS.find((a) => a.id === currentId) || TREE_ASSETS[0];
  capIndex.textContent = `${asset.index} / ${asset.kind.toUpperCase()}`;
  capName.textContent = asset.label;
  capEn.textContent = asset.en;
  capNote.textContent = asset.note;

  if (asset.kind === 'tree') {
    const seedList = asset.seeds.map((s) => s + seedSalt).join(' / ');
    capMeta.textContent =
      `高度 ${asset.height[0].toFixed(1)}–${asset.height[1].toFixed(1)} m · ` +
      `${asset.stat} · 种子 ${seedList}`;
  } else {
    capMeta.textContent = `高度 ${asset.height[0].toFixed(1)}–${asset.height[1].toFixed(1)} m · ${asset.stat}`;
  }
}

function refreshUI() {
  for (const btn of assetList.querySelectorAll('.asset-item')) {
    btn.classList.toggle('is-active', !allMode && btn.dataset.id === currentId);
  }
  allBtn.classList.toggle('is-active', allMode);

  const asset = ASSETS.find((a) => a.id === currentId);
  const isWindmill = !allMode && asset && asset.kind === 'windmill';

  variantsBtn.disabled = allMode || isWindmill;
  variantsBtn.setAttribute('aria-pressed', String(showVariants && !allMode && !isWindmill));
  variantsBtn.textContent = showVariants && !allMode && !isWindmill ? '只看主株' : '显示 3 个变体';
  reseedBtn.textContent = isWindmill ? '换一个朝向' : '重新播种';
}

function rebuild() {
  clearAll();
  if (allMode) allLayout();
  else {
    const asset = ASSETS.find((a) => a.id === currentId) || TREE_ASSETS[0];
    focusLayout(asset);
  }
  applyCameraForMode();
  updateCaption();
  refreshUI();
}

/* ------------------------------------------------------------------ */
/* list                                                                */
/* ------------------------------------------------------------------ */

function buildList() {
  for (const group of GROUPS) {
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
  allMode = !allMode;
  if (allMode) showVariants = false;
  rebuild();
});

variantsBtn.addEventListener('click', () => {
  if (allMode) return;
  showVariants = !showVariants;
  rebuild();
});

reseedBtn.addEventListener('click', () => {
  if (!allMode && currentId === WINDMILL_ASSET.id && currentWindmill) {
    currentWindmill.group.rotation.y += 1.1 + Math.random() * 1.6;
    currentWindmill.rotor.rotation.z += Math.random() * Math.PI * 2;
    return;
  }
  seedSalt += 97;
  rebuild();
});

let wind = Number(windInput.value);
windInput.addEventListener('input', () => {
  wind = Number(windInput.value);
  windVal.textContent = wind.toFixed(2);
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
  view.az -= dx * 0.006;
  view.el = THREE.MathUtils.clamp(view.el + dy * 0.004, 0.04, 1.05);
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
    40
  );
}, { passive: false });

/* ------------------------------------------------------------------ */
/* size / loop                                                         */
/* ------------------------------------------------------------------ */

function resize() {
  const w = viewEl.clientWidth || window.innerWidth;
  const h = viewEl.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(h, 1);
  camera.fov = camera.aspect < 0.9 ? 42 : 33;
  camera.updateProjectionMatrix();
  applyCameraForMode();
}

window.addEventListener('resize', resize);

const clock = new THREE.Clock();
let time = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 1 / 20);
  time += dt;

  const strength = 0.08 + wind * 0.95;
  treeMaterial.uniforms.uTime.value = time;
  treeMaterial.uniforms.uWindStrength.value = strength;

  if (currentWindmill) {
    currentWindmill.rotor.rotation.z -= dt * (0.15 + wind * 1.05);
  }

  updateCamera(dt);
  renderer.render(scene, camera);
}

/* ------------------------------------------------------------------ */

buildList();
windVal.textContent = wind.toFixed(2);
resize();
view.radius = view.wantRadius;
view.targetY = view.wantTargetY;
rebuild();
animate();

window.__landmarks = {
  scene,
  camera,
  renderer,
  items,
  labels,
  shadows,
  treeMaterial,
  view,
  rebuild,
  get windmill() { return currentWindmill; }
};