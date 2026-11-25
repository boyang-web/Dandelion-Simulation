import * as THREE from 'three';

/* ================================================================== */
/*  Dandelion                                                          */
/*  Every seed is a camera-facing image of a hand-drawn pappus +       */
/*  achene. The seeds share one InstancedMesh, but each one carries    */
/*  its own little life: grow on the receptacle, hesitate in the       */
/*  breeze, tear loose, tumble, and finally dissolve into the meadow.  */
/* ================================================================== */

const HEAD_ORIGIN = new THREE.Vector3(0, 2.56, 0.02);
const HEAD_CENTER = HEAD_ORIGIN.clone().add(new THREE.Vector3(0, 0.42, 0));
const HEAD_SLOTS = 220;
const MAX_SEEDS = 700;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

// Shared by every dandelion planted in the meadow. Sky writes these once
// per time change; each plant reads them every frame.
export const dandelionAtmosphere = {
  fluffTint: new THREE.Color('#fffaf0'),
  coreTint: new THREE.Color('#fff6df'),
  coreOpacity: 1,
  shadowFactor: 1
};

export const DANDELION_PARAMS = {
  seedResponseBase: 0.34,
  seedResponseGain: 1.55,
  regrowMin: 0.30,
  regrowVar: 0.16,
  seedLifeMin: 11,
  seedLifeVar: 9,
  quiverBase: 0.011,
  quiverGain: 0.085,
  // Wild dandelions push up out of the ground in under a second, then
  // stand for 50-70 seconds before their stem fades. Their seeds also
  // animate their own opening on the head.
  wildEmergeMin: 0.62,
  wildEmergeVar: 0.28,
  // A fully stripped wild head refills over about 20 seconds. One slot is
  // reattached at a steady rate, so a partly blown head recovers sooner.
  wildRecoveryTime: 20,
  wildLifeMin: 50,
  wildLifeVar: 20,
  wildFadeTime: 2.6
};

let seedTexture = null;
let coreTexture = null;
function getSeedTexture(renderer) {
  if (!seedTexture) seedTexture = createSeedTexture(renderer);
  return seedTexture;
}
function getCoreTexture(renderer) {
  if (!coreTexture) coreTexture = createCoreTexture(renderer);
  return coreTexture;
}

const STATE_HEAD = 1;
const STATE_FLY = 2;

/* ------------------------------------------------------------------ */
/* seed illustration, drawn once to a canvas texture                   */
/* ------------------------------------------------------------------ */

function createSeedTexture(renderer) {
  const W = 512;
  const H = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const hubX = W / 2;
  const hubY = 428;

  // A very soft halo keeps the fine hairs from disappearing on pale skies.
  const halo = ctx.createRadialGradient(hubX, hubY - 40, 10, hubX, hubY - 40, 330);
  halo.addColorStop(0, 'rgba(255, 252, 240, 0.16)');
  halo.addColorStop(0.5, 'rgba(255, 250, 236, 0.07)');
  halo.addColorStop(1, 'rgba(255, 250, 236, 0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, W, H);

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const hairCount = 30;

  for (let i = 0; i < hairCount; i++) {
    const u = hairCount === 1 ? 0.5 : i / (hairCount - 1);
    const angle = (u * 2 - 1) * 1.0 + (Math.random() - 0.5) * 0.06;
    const len = 220 + Math.random() * 58 + Math.sin(u * Math.PI) * 26;
    const side = Math.sin(angle);
    const up = Math.cos(angle);

    const tipX = hubX + side * len * 0.95;
    const tipY = hubY - up * len * 1.02;
    const cpX = hubX + side * len * 0.42;
    const cpY = hubY - up * len * 0.62 - Math.random() * 12;

    // soft outer glow
    ctx.beginPath();
    ctx.moveTo(hubX, hubY);
    ctx.quadraticCurveTo(cpX, cpY, tipX, tipY);
    ctx.strokeStyle = `rgba(255, 250, 234, ${0.1 + Math.random() * 0.08})`;
    ctx.lineWidth = 9;
    ctx.stroke();

    // fine, bright hair (thick enough to survive the sprite being small on screen)
    ctx.beginPath();
    ctx.moveTo(hubX, hubY);
    ctx.quadraticCurveTo(cpX, cpY, tipX, tipY);
    ctx.strokeStyle = `rgba(255, 249, 229, ${0.55 + Math.random() * 0.3})`;
    ctx.lineWidth = 2.6 + Math.random() * 1.6;
    ctx.stroke();

    // a bright core line catches the light
    ctx.beginPath();
    ctx.moveTo(hubX, hubY);
    ctx.quadraticCurveTo(cpX, cpY, tipX, tipY);
    ctx.strokeStyle = `rgba(255, 252, 240, ${0.28 + Math.random() * 0.3})`;
    ctx.lineWidth = 1.1;
    ctx.stroke();

    // little feathery side-branches
    if (i % 2 === 0) {
      const tt = 0.55 + Math.random() * 0.12;
      const px = (1 - tt) * (1 - tt) * hubX + 2 * (1 - tt) * tt * cpX + tt * tt * tipX;
      const py = (1 - tt) * (1 - tt) * hubY + 2 * (1 - tt) * tt * cpY + tt * tt * tipY;
      for (let k = 0; k < 2; k++) {
        const dir = k === 0 ? 1 : -1;
        const len2 = 18 + Math.random() * 20;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.quadraticCurveTo(
          px + dir * len2 * 0.6,
          py - len2 * 0.1,
          px + dir * len2,
          py - len2 * 0.55
        );
        ctx.strokeStyle = 'rgba(252, 247, 232, 0.3)';
        ctx.lineWidth = 2.2;
        ctx.stroke();
      }
    }
  }

  // a shorter, inner row of hairs for density
  for (let i = 0; i < 16; i++) {
    const u = i / 15;
    const angle = (u * 2 - 1) * 0.92;
    const len = 125 + Math.random() * 75;
    const side = Math.sin(angle);
    const up = Math.cos(angle);
    ctx.beginPath();
    ctx.moveTo(hubX, hubY);
    ctx.quadraticCurveTo(
      hubX + side * len * 0.35,
      hubY - up * len * 0.6,
      hubX + side * len * 0.82,
      hubY - up * len * 0.85
    );
    ctx.strokeStyle = 'rgba(252, 246, 230, 0.28)';
    ctx.lineWidth = 2.6;
    ctx.stroke();
  }

  // the tiny crown where the hairs meet
  ctx.beginPath();
  ctx.ellipse(hubX, hubY, 7, 10, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(224, 207, 168, 0.7)';
  ctx.fill();

  // long, almost invisible filament
  ctx.beginPath();
  ctx.moveTo(hubX, hubY + 4);
  ctx.bezierCurveTo(hubX - 5, 590, hubX + 6, 780, hubX, 896);
  ctx.strokeStyle = 'rgba(242, 234, 212, 0.28)';
  ctx.lineWidth = 6;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(hubX, hubY + 6);
  ctx.bezierCurveTo(hubX - 5, 590, hubX + 6, 780, hubX, 896);
  ctx.strokeStyle = 'rgba(255, 252, 241, 0.72)';
  ctx.lineWidth = 2.1;
  ctx.stroke();

  // achene / seed body at the bottom
  ctx.save();
  ctx.translate(hubX, 940);
  const seedGrad = ctx.createLinearGradient(-8, 0, 9, 0);
  seedGrad.addColorStop(0, 'rgba(175, 155, 123, 0.84)');
  seedGrad.addColorStop(0.45, 'rgba(209, 188, 152, 0.96)');
  seedGrad.addColorStop(0.75, 'rgba(190, 168, 132, 0.94)');
  seedGrad.addColorStop(1, 'rgba(155, 137, 108, 0.8)');
  ctx.fillStyle = seedGrad;
  ctx.beginPath();
  ctx.moveTo(0, -47);
  ctx.bezierCurveTo(7, -26, 9, 18, 0, 47);
  ctx.bezierCurveTo(-9, 18, -7, -26, 0, -47);
  ctx.fill();

  ctx.strokeStyle = 'rgba(236, 220, 184, 0.3)';
  ctx.lineWidth = 0.8;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 3.2, -35);
    ctx.quadraticCurveTo(i * 4.6, 4, i * 2.4, 36);
    ctx.stroke();
  }
  ctx.restore();

  // tiny neck joining seed and filament
  ctx.beginPath();
  ctx.moveTo(hubX, 880);
  ctx.lineTo(hubX, 902);
  ctx.strokeStyle = 'rgba(192, 168, 126, 0.7)';
  ctx.lineWidth = 2.2;
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

/* ------------------------------------------------------------------ */
/* soft inner fluff, so the head reads as a volume, not a flat rosette */
/* ------------------------------------------------------------------ */

function createCoreTexture(renderer) {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2;
  const cy = size / 2;

  // a very faint cloudy base
  const glow = ctx.createRadialGradient(cx, cy, 8, cx, cy, size * 0.47);
  glow.addColorStop(0, 'rgba(255, 251, 238, 0.72)');
  glow.addColorStop(0.3, 'rgba(255, 249, 232, 0.46)');
  glow.addColorStop(0.62, 'rgba(255, 247, 226, 0.16)');
  glow.addColorStop(1, 'rgba(255, 247, 226, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  ctx.lineCap = 'round';

  // a dense cloud of short, feathery filaments
  for (let i = 0; i < 720; i++) {
    const a = Math.random() * Math.PI * 2;
    const r0 = 8 + Math.pow(Math.random(), 0.6) * 190;
    const len = 18 + Math.random() * 65;
    const r1 = Math.min(246, r0 + len);
    const bend = (Math.random() - 0.5) * 0.5;

    const x0 = cx + Math.cos(a) * r0;
    const y0 = cy + Math.sin(a) * r0;
    const x1 = cx + Math.cos(a + bend) * r1;
    const y1 = cy + Math.sin(a + bend) * r1;

    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(
      cx + Math.cos(a + bend * 0.5) * ((r0 + r1) * 0.5),
      cy + Math.sin(a + bend * 0.5) * ((r0 + r1) * 0.5),
      x1,
      y1
    );
    ctx.strokeStyle = `rgba(255, 250, 234, ${0.06 + Math.random() * 0.12})`;
    ctx.lineWidth = 2.4 + Math.random() * 2.2;
    ctx.stroke();
  }

  // a few tiny soft motes of pappus
  for (let i = 0; i < 90; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 225;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0.7 + Math.random() * 1.5, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 251, 238, ${0.08 + Math.random() * 0.14})`;
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  return texture;
}

/* ------------------------------------------------------------------ */
/* stem                                                                */
/* ------------------------------------------------------------------ */

function taperedStem(curve, baseRadius, topRadius, segments = 64, radial = 8) {
  const frames = curve.computeFrenetFrames(segments, false);
  const positions = [];
  const colors = [];
  const uvs = [];
  const indices = [];

  const baseColor = new THREE.Color('#789050');
  const topColor = new THREE.Color('#a4b874');
  const c = new THREE.Color();

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = curve.getPointAt(t);
    const radius = THREE.MathUtils.lerp(baseRadius, topRadius, Math.pow(t, 0.72));

    const normal = frames.normals[i];
    const binormal = frames.binormals[i];

    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const sin = Math.sin(a);
      const cos = Math.cos(a);
      const nx = normal.x * cos + binormal.x * sin;
      const ny = normal.y * cos + binormal.y * sin;
      const nz = normal.z * cos + binormal.z * sin;

      positions.push(p.x + nx * radius, p.y + ny * radius, p.z + nz * radius);
      uvs.push(j / radial, t);

      c.copy(baseColor).lerp(topColor, Math.pow(t, 0.7));
      colors.push(c.r, c.g, c.b);
    }
  }

  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j;
      const b = i * radial + ((j + 1) % radial);
      const c2 = (i + 1) * radial + j;
      const d = (i + 1) * radial + ((j + 1) % radial);
      indices.push(a, c2, b, b, c2, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function makePlant() {
  const group = new THREE.Group();
  // Everything above the ground hangs off this pivot so the stem can lean
  // as one piece. The contact shadows stay in `group` and remain planted.
  const sway = new THREE.Group();
  group.add(sway);

  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.18, -0.06, 0.2),
    new THREE.Vector3(0.13, 0.72, 0.17),
    new THREE.Vector3(0.04, 1.46, 0.06),
    new THREE.Vector3(-0.02, 2.08, 0.01),
    new THREE.Vector3(0.0, 2.43, 0.02)
  ]);

  const stemGeometry = taperedStem(curve, 0.052, 0.023);
  const stemMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.72,
    metalness: 0.0,
    flatShading: false
  });
  const stem = new THREE.Mesh(stemGeometry, stemMaterial);
  sway.add(stem);

  // receptacle
  const cupMaterial = new THREE.MeshStandardMaterial({
    color: '#7b934f',
    roughness: 0.8,
    metalness: 0
  });
  const cup = new THREE.Mesh(new THREE.SphereGeometry(0.12, 22, 16), cupMaterial);
  cup.scale.set(1.15, 0.72, 1.15);
  cup.position.set(0, 2.44, 0.02);
  sway.add(cup);

  // reflexed green bracts under the head
  const bractGeometry = (() => {
    const rows = 4;
    const pos = [];
    const idx = [];
    for (let i = 0; i <= rows; i++) {
      const t = i / rows;
      const w = 0.048 * Math.pow(1 - t, 0.75) + 0.0015;
      const y = -t * t * 0.13;
      const z = t * 0.23;
      pos.push(-w, y, z, w, y, z);
    }
    for (let i = 0; i < rows; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  })();

  const bractMaterial = new THREE.MeshStandardMaterial({
    color: '#6d8747',
    roughness: 0.85,
    metalness: 0,
    side: THREE.DoubleSide
  });

  const bracts = new THREE.InstancedMesh(bractGeometry, bractMaterial, 11);
  const bractDummy = new THREE.Object3D();
  for (let i = 0; i < 11; i++) {
    const az = (i / 11) * Math.PI * 2 + 0.2;
    bractDummy.position.set(Math.sin(az) * 0.05, 2.435, Math.cos(az) * 0.05 + 0.02);
    bractDummy.rotation.set(0, az, 0);
    bractDummy.updateMatrix();
    bracts.setMatrixAt(i, bractDummy.matrix);
  }
  bracts.instanceMatrix.needsUpdate = true;
  sway.add(bracts);

  // soft contact shadow
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = shadowCanvas.height = 128;
  const sctx = shadowCanvas.getContext('2d');
  const grad = sctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(26, 38, 18, 0.52)');
  grad.addColorStop(0.55, 'rgba(31, 44, 21, 0.26)');
  grad.addColorStop(1, 'rgba(33, 46, 23, 0)');
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, 128, 128);

  const shadowTex = new THREE.CanvasTexture(shadowCanvas);
  shadowTex.colorSpace = THREE.SRGBColorSpace;
  const longShadowGeo = new THREE.PlaneGeometry(3.25, 1.4);
  longShadowGeo.rotateZ(0.24);
  const longShadow = new THREE.Mesh(
    longShadowGeo,
    new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.42,
      toneMapped: false
    })
  );
  longShadow.rotation.x = -Math.PI / 2;
  longShadow.position.set(-0.32, 0.011, 0.2);
  longShadow.userData.isShadow = true;
  longShadow.userData.baseOpacity = 0.42;
  group.add(longShadow);

  const contact = new THREE.Mesh(
    new THREE.PlaneGeometry(1.2, 0.72),
    new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.62,
      toneMapped: false
    })
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.set(0.02, 0.012, 0.14);
  contact.userData.isShadow = true;
  contact.userData.baseOpacity = 0.62;
  group.add(contact);

  return {
    group,
    sway,
    fadeMaterials: [stemMaterial, cupMaterial, bractMaterial],
    shadowMaterials: [longShadow.material, contact.material]
  };
}

/* ------------------------------------------------------------------ */
/* small helpers                                                       */
/* ------------------------------------------------------------------ */

function easeOutCubic(x) {
  return 1 - Math.pow(1 - x, 3);
}

function smoothstep(min, max, x) {
  const t = THREE.MathUtils.clamp((x - min) / (max - min), 0, 1);
  return t * t * (3 - 2 * t);
}

/* ------------------------------------------------------------------ */

export class Dandelion {
  constructor({
    scene,
    camera,
    renderer,
    wind,
    headSlots = HEAD_SLOTS,
    maxSeeds = MAX_SEEDS,
    autoRegrow = true,
    transient = false,
    position = null,
    rotationY = 0,
    sizeScale = 1
  }) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.wind = wind;
    this.headSlots = headSlots;
    this.maxSeeds = maxSeeds;
    this.autoRegrow = autoRegrow;
    this.transient = transient;
    this.enabled = true;
    this.finished = false;

    const plant = makePlant();
    this.group = plant.group;
    this.swayGroup = plant.sway;
    this._fadeMaterials = plant.fadeMaterials;
    if (position) this.group.position.copy(position);
    this.group.rotation.y = rotationY;
    // Wild dandelions vary a little in overall size. Scaling the root group
    // also scales the contact shadows; seed sprites are scaled separately
    // below because they live outside this group.
    this.sizeScale = sizeScale;
    this.group.scale.setScalar(sizeScale);
    scene.add(this.group);
    // Seed cleanup bounds are relative to the plant, not to the origin.
    // Wild dandelions can be planted anywhere in the valley (including the
    // foothills), so world-space x/z/y limits would cull their seeds on the
    // very first flight frame.
    this.basePosition = this.group.position.clone();
    this._baseY = this.basePosition.y;
    this._emergeDur = DANDELION_PARAMS.wildEmergeMin +
      Math.random() * DANDELION_PARAMS.wildEmergeVar;
    this._emergeT = transient ? 0.001 : 1;
    this._emergeMix = transient ? 0.001 : 1;
    if (transient) {
      // Start buried just below the soil and grow straight up out of it.
      // The root stays fixed, so this reads as an emergence, not a pop-in.
      this.group.position.y = this._baseY - 0.35;
      this.swayGroup.scale.setScalar(this._emergeMix);
      for (const m of this._fadeMaterials) {
        m.transparent = true;
        m.opacity = 1;
      }
    }

    this.shadows = [];
    this.group.traverse((obj) => {
      if (obj.userData.isShadow) this.shadows.push(obj);
    });
    this._timeCoreOpacity = 1;
    this._shadowFactor = 1;
    this._stemOpacity = 1;
    this._stemFading = false;
    this._stemGone = false;
    this._life = 0;
    this._stemLinger = transient
      ? DANDELION_PARAMS.wildLifeMin + Math.random() * DANDELION_PARAMS.wildLifeVar
      : Infinity;

    // The head is carried by the same pivot as the stem, so its anchor and
    // every seed sitting on it move together as the stem sways.
    this.headOrigin = HEAD_ORIGIN.clone();
    this.headCenter = HEAD_CENTER.clone();
    this._swayRotX = 0;
    this._swayRotZ = 0;
    this.headLocalAir = new THREE.Vector3();
    this.headLocalSpeed = 0;
    this.sunDir = new THREE.Vector3(5.5, 8.5, 4.5).normalize();
    this._sunTint = new THREE.Color();

    this.group.updateMatrixWorld(true);
    this.swayGroup.updateMatrixWorld(true);
    this.headOrigin.copy(HEAD_ORIGIN).applyMatrix4(this.swayGroup.matrixWorld);
    this.headCenter.copy(HEAD_CENTER).applyMatrix4(this.swayGroup.matrixWorld);

    this.texture = getSeedTexture(renderer);

    const geometry = new THREE.PlaneGeometry(0.5, 1);
    const material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 1,
      alphaTest: 0.015,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false
    });

    this.mesh = new THREE.InstancedMesh(geometry, material, this.maxSeeds);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);

    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.maxSeeds; i++) this.mesh.setMatrixAt(i, this._zero);

    this.core = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: getCoreTexture(renderer),
        transparent: true,
        depthWrite: false,
        depthTest: false,
        opacity: 0.95,
        toneMapped: false
      })
    );
    this.core.position.copy(this.headOrigin).add(new THREE.Vector3(0, 0.02, 0));
    this.core.renderOrder = 1;
    this.core.frustumCulled = false;
    if (transient) {
      // The first animation frame decides the real head fill; avoid a
      // one-frame full-size fluff flash while the plant is still buried.
      this.core.visible = false;
      this.core.scale.setScalar(0.001);
    }
    scene.add(this.core);

    // A whisper of per-seed warmth so the head isn't a flat white ball.
    const tint = new THREE.Color();
    for (let i = 0; i < this.maxSeeds; i++) {
      const v = 0.95 + Math.random() * 0.05;
      tint.setRGB(v, v * 0.995, v * 0.955);
      this.mesh.setColorAt(i, tint);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;

    this.slots = this._makeSlots();
    this.freeSlots = [];

    this.seeds = [];
    this.freeSeedIndices = [];
    for (let i = 0; i < this.maxSeeds; i++) {
      this.seeds.push({
        index: i,
        active: false,
        state: 0,
        slot: -1,
        dir: new THREE.Vector3(0, 1, 0),
        center: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        up: new THREE.Vector3(0, 1, 0),
        scale: 0.9,
        flightFrom: 0.9,
        flightScale: 0.9,
        grow: 0,
        growDur: 1,
        delay: 0,
        age: 0,
        life: 0,
        swing: 0,
        phase: Math.random() * Math.PI * 2
      });
      this.freeSeedIndices.push(i);
    }

    this.regrowTimer = 0;
    this.headCount = 0;
    this.everDetached = false;

    for (let i = 0; i < this.headSlots; i++) {
      const seed = this._takeSeed();
      if (!seed) break;
      this._attachSeed(seed, i, true);
      // The plant is already full size; only its seeds grow out on the head.
      seed.delay = 0.2 + Math.random() * 1.15;
      seed.growDur = 1.0 + Math.random() * 0.5;
    }

    // scratch vectors
    this._pos = new THREE.Vector3();
    this._zAxis = new THREE.Vector3();
    this._yAxis = new THREE.Vector3();
    this._xAxis = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._quat = new THREE.Quaternion();
    this._basis = new THREE.Matrix4();
    this._scale = new THREE.Vector3();
    this._matrix = new THREE.Matrix4();
    this._air = new THREE.Vector3();

    this.params = DANDELION_PARAMS;
  }

  _makeSlots() {
    const slots = [];
    const cap = 1.94; // a little more than a hemisphere, so the head sits on the stem
    const cosMin = Math.cos(cap);

    for (let i = 0; i < this.headSlots; i++) {
      const u = (i + 0.5) / this.headSlots;
      const z = 1 - (1 - cosMin) * u;
      const r = Math.sqrt(Math.max(0, 1 - z * z));
      const a = i * GOLDEN_ANGLE;

      const dir = new THREE.Vector3(Math.cos(a) * r, z, Math.sin(a) * r);
      dir.x += (Math.random() - 0.5) * 0.055;
      dir.y += (Math.random() - 0.5) * 0.045;
      dir.z += (Math.random() - 0.5) * 0.055;
      dir.normalize();

      slots.push({
        dir,
        scale: 0.84 + Math.random() * 0.23,
        seed: null
      });
    }

    return slots;
  }

  _takeSeed() {
    if (this.freeSeedIndices.length === 0) return null;
    const index = this.freeSeedIndices.pop();
    const seed = this.seeds[index];
    seed.active = true;
    seed.state = 0;
    seed.slot = -1;
    seed.grow = 0;
    seed.delay = 0;
    seed.age = 0;
    seed.life = 0;
    seed.swing = Math.random() * Math.PI * 2;
    seed.phase = Math.random() * Math.PI * 2;
    return seed;
  }

  _releaseSeed(seed) {
    seed.windEye = null;
    if (!seed.active) return;
    seed.active = false;
    seed.state = 0;
    seed.slot = -1;
    this.freeSeedIndices.push(seed.index);
  }

  _attachSeed(seed, slotIndex, intro = false) {
    const slot = this.slots[slotIndex];
    seed.state = STATE_HEAD;
    seed.slot = slotIndex;
    seed.dir.copy(slot.dir);
    seed.scale = slot.scale;
    seed.grow = 0;
    seed.delay = intro ? seed.delay : 0;
    seed.growDur = intro ? seed.growDur : 1.6 + Math.random() * 0.7;
    seed.age = 0;
    seed.life = 0;
    seed.vel.set(0, 0, 0);
    slot.seed = seed;
    this.headCount++;

    // bake a gentle sun/shade difference into the fluff: seeds facing the
    // key light are a touch warmer and brighter than the shadow side
    const lit = 0.5 + 0.5 * slot.dir.dot(this.sunDir);
    const v = 0.88 + 0.12 * lit;
    this._sunTint.setRGB(v * 1.02, v, v * 0.94);
    this.mesh.setColorAt(seed.index, this._sunTint);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  _detachSeed(seed) {
    const e = easeOutCubic(seed.grow);
    seed.center
      .copy(this.headOrigin)
      .addScaledVector(seed.dir, seed.scale * e * this.sizeScale * this._emergeMix * 0.5);

    // Match the size it had on the head at the instant of release, then let
    // it settle into its own flight size. A slight ±10% spread makes the
    // drifting group read as a volume instead of a flat sheet of clones.
    seed.flightFrom = seed.scale * e * this.sizeScale * this._emergeMix;
    seed.flightScale = this.sizeScale * (0.90 + Math.random() * 0.18);

    seed.state = STATE_FLY;
    seed.age = 0;
    seed.life = this.params.seedLifeMin + Math.random() * this.params.seedLifeVar;
    seed.swing = 0;

    const slot = this.slots[seed.slot];
    if (slot) slot.seed = null;
    this.freeSlots.push(seed.slot);
    seed.slot = -1;
    this.headCount--;
    this.everDetached = true;
  }

  get hasFlowerHead() { return !this._stemGone; }

  get canBlow() {
    return this.seeds.some(seed => seed.active && seed.state === STATE_HEAD && seed.delay <= 0 && seed.grow >= .18);
  }

  blow(direction, eye) {
    let released = 0;
    for (const seed of this.seeds) {
      if (!seed.active || seed.state !== STATE_HEAD || seed.delay > 0 || seed.grow < .18) continue;
      this._detachSeed(seed);
      seed.vel.copy(direction).multiplyScalar(5);
      seed.vel.y += .7;
      seed.windEye = eye;
      seed.enteredMouth = false;
      if (++released >= 7) break;
    }
    return released;
  }

  _regrowOne() {
    if (this.freeSlots.length === 0) return;
    const seed = this._takeSeed();
    if (!seed) return;

    const pick = Math.floor(Math.random() * this.freeSlots.length);
    const slotIndex = this.freeSlots.splice(pick, 1)[0];
    if (this.slots[slotIndex].seed) {
      // Defensive: the slot was refilled already.
      this._releaseSeed(seed);
      return;
    }
    this._attachSeed(seed, slotIndex, false);
  }

  _writeBillboard(pos, up, scale, roll) {
    const cam = this.camera.position;

    this._zAxis.set(cam.x - pos.x, cam.y - pos.y, cam.z - pos.z).normalize();

    this._yAxis.copy(up).addScaledVector(this._zAxis, -up.dot(this._zAxis));
    if (this._yAxis.lengthSq() < 1e-5) {
      this._yAxis.set(0, 1, 0);
      if (Math.abs(this._zAxis.y) > 0.94) this._yAxis.set(1, 0, 0);
      this._yAxis.addScaledVector(this._zAxis, -this._yAxis.dot(this._zAxis));
    }
    this._yAxis.normalize();
    this._xAxis.crossVectors(this._yAxis, this._zAxis).normalize();

    if (roll) {
      const cos = Math.cos(roll);
      const sin = Math.sin(roll);
      this._up.copy(this._yAxis);
      this._yAxis.multiplyScalar(cos).addScaledVector(this._xAxis, sin);
      this._xAxis.multiplyScalar(cos).addScaledVector(this._up, -sin);
    }

    this._basis.makeBasis(this._xAxis, this._yAxis, this._zAxis);
    this._quat.setFromRotationMatrix(this._basis);
    this._scale.set(scale, scale, scale);
    this._matrix.compose(pos, this._quat, this._scale);
  }

  setTime({ fluffTint, coreTint, coreOpacity, shadowFactor }) {
    this.mesh.material.color.copy(fluffTint);
    this.core.material.color.copy(coreTint);
    this._timeCoreOpacity = coreOpacity;
    this._shadowFactor = shadowFactor;
    for (const shadow of this.shadows) {
      shadow.material.opacity =
        shadow.userData.baseOpacity * shadowFactor * this._stemOpacity * this._emergeMix;
    }
  }

  setEnabled(on) {
    this.enabled = !!on;
    this.group.visible = this.enabled && !this._stemGone;
    this.mesh.visible = this.enabled;
    this.core.visible = this.enabled && this.headCount > 0;
  }

  _clearHeadSeeds() {
    for (const seed of this.seeds) {
      if (!seed.active || seed.state !== STATE_HEAD) continue;
      const slot = this.slots[seed.slot];
      if (slot) slot.seed = null;
      this.freeSlots.push(seed.slot);
      this.headCount--;
      this._releaseSeed(seed);
    }
  }

  _updateTransient(dt) {
    this._life += dt;

    if (!this._stemFading) {
      if (this._life > this._stemLinger) {
        this._stemFading = true;
      }
    }

    if (this._stemFading) {
      this._stemOpacity = Math.max(0, this._stemOpacity - dt / this.params.wildFadeTime);
      for (const m of this._fadeMaterials) m.opacity = this._stemOpacity;
      for (const shadow of this.shadows) {
        shadow.material.opacity =
          shadow.userData.baseOpacity * this._shadowFactor * this._stemOpacity * this._emergeMix;
      }
      if (this._stemOpacity <= 0.001) {
        this._stemGone = true;
        this._clearHeadSeeds();
        this.group.visible = false;
        this.core.visible = false;
      }
    }
  }

  dispose() {
    this.finished = true;
    this.scene.remove(this.group);
    this.scene.remove(this.mesh);
    this.scene.remove(this.core);
    const geometries = new Set();
    const materials = new Set();
    this.group.traverse((obj) => {
      if (obj.geometry) geometries.add(obj.geometry);
      if (obj.material) materials.add(obj.material);
    });
    geometries.add(this.mesh.geometry);
    materials.add(this.mesh.material);
    geometries.add(this.core.geometry);
    materials.add(this.core.material);
    for (const g of geometries) g.dispose();
    // Textures are shared by every plant; only the materials are per plant.
    for (const m of materials) m.dispose();
  }

  update(dt, t) {
    if (!this.enabled) return;

    const at = dandelionAtmosphere;
    this.mesh.material.color.copy(at.fluffTint);
    this.core.material.color.copy(at.coreTint);
    this._timeCoreOpacity = at.coreOpacity;
    this._shadowFactor = at.shadowFactor;
    for (const shadow of this.shadows) {
      shadow.material.opacity =
        shadow.userData.baseOpacity * at.shadowFactor * this._stemOpacity * this._emergeMix;
    }

    const wind = this.wind;

    if (this.transient && this._emergeT < 1) {
      this._emergeT = Math.min(
        1,
        this._emergeT + dt / Math.max(0.01, this._emergeDur)
      );
      this._emergeMix = Math.max(0.001, easeOutCubic(this._emergeT));
      this.swayGroup.scale.setScalar(this._emergeMix);
      this.group.position.y = this._baseY - 0.35 * (1 - this._emergeMix);
      this.group.updateMatrixWorld(true);
    }

    // How much air is actually moving over the head right now?
    const headMag = wind.localFactorAtWorld(this.headCenter, this.headLocalAir);
    this.headLocalSpeed = headMag * wind.maxAirSpeed;
    const headAir = this.headLocalAir;

    // Stem sway. The whole plant leans from the ground, and the head anchor
    // is taken from that same pivot, so every seed on the head follows it.
    // A slow idle drift keeps the stem alive when there is no gesture, and
    // the local gust adds a little more lean on top.
    const airLen = Math.hypot(headAir.x, headAir.z);
    // At rest the stem leans with the ambient wind direction plus a very
    // slow wobble; a real gust at the head takes over when there is one.
    let swayX = Math.sin(t * 0.17) * 0.16;
    let swayZ = Math.cos(t * 0.13) * 0.16;
    if (wind.grassDirSmooth) {
      swayX += wind.grassDirSmooth.x;
      swayZ += wind.grassDirSmooth.y;
    } else {
      swayX += wind.dir.x;
      swayZ += wind.dir.z;
    }
    const idleLen = Math.hypot(swayX, swayZ) || 1;
    swayX /= idleLen;
    swayZ /= idleLen;
    if (airLen > 1e-4) {
      swayX = headAir.x / airLen;
      swayZ = headAir.z / airLen;
    }
    const idle = 0.004 + 0.004 * (0.5 + 0.5 * Math.sin(t * 0.41 + 0.6));
    const amplitude = idle + 0.028 * Math.min(1, headMag) +
      (wind.breezePower || 0) * 0.012;
    const targetRotX = swayZ * amplitude;
    const targetRotZ = -swayX * amplitude;
    const follow = 1 - Math.exp(-3.2 * dt);
    this._swayRotX += (targetRotX - this._swayRotX) * follow;
    this._swayRotZ += (targetRotZ - this._swayRotZ) * follow;
    this.swayGroup.rotation.set(this._swayRotX, 0, this._swayRotZ);
    this.swayGroup.updateMatrixWorld(true);
    this.headOrigin.copy(HEAD_ORIGIN).applyMatrix4(this.swayGroup.matrixWorld);
    this.headCenter.copy(HEAD_CENTER).applyMatrix4(this.swayGroup.matrixWorld);

    if (this.transient && !this._stemGone) this._updateTransient(dt);

    let openHead = 0;

    for (let i = 0; i < this.seeds.length; i++) {
      const seed = this.seeds[i];

      if (!seed.active) {
        this.mesh.setMatrixAt(i, this._zero);
        continue;
      }

      if (seed.state === STATE_HEAD) {
        if (seed.delay > 0) {
          seed.delay -= dt;
          if (seed.delay > 0) {
            this.mesh.setMatrixAt(i, this._zero);
            continue;
          }
        }

        if (seed.grow < 1) {
          seed.grow = Math.min(1, seed.grow + dt / seed.growDur);
        }

        const e = easeOutCubic(seed.grow);
        if (e < 0.004) {
          this.mesh.setMatrixAt(i, this._zero);
          continue;
        }
        openHead += e;

        const scale = seed.scale * e * this._stemOpacity * this.sizeScale * this._emergeMix;
        const half = scale * 0.5;

        // the seed is rooted at the receptacle; its fluff points outward
        this._pos
          .copy(this.headOrigin)
          .addScaledVector(seed.dir, half)
          .addScaledVector(headAir, 0.008 * (0.3 + seed.grow));

        this._up.copy(seed.dir);
        const quiver = this.params.quiverBase + wind.strength * headMag * this.params.quiverGain;
        this._up.x += Math.sin(t * 1.35 + seed.phase * 2.1) * quiver;
        this._up.z += Math.cos(t * 1.62 + seed.phase * 1.6) * quiver;
        this._up.x += headAir.x * 0.022;
        this._up.z += headAir.z * 0.022;
        this._up.normalize();

        const roll = Math.sin(t * 0.7 + seed.phase) * 0.05;
        this._writeBillboard(this._pos, this._up, scale, roll);
        this.mesh.setMatrixAt(i, this._matrix);
      } else if (seed.state === STATE_FLY) {
        seed.age += dt;

        // Air is only felt where the gust (or its short wake) actually is.
        const localMag = wind.airAtWorld(seed.center, this._air);
        const exposure = THREE.MathUtils.clamp(localMag / wind.maxAirSpeed, 0, 1);

        // Strong response inside the gust, very light drag outside it:
        // the seed keeps its momentum between gusts.
        const response = this.params.seedResponseBase + this.params.seedResponseGain * exposure;
        const k = 1 - Math.exp(-response * dt);

        seed.vel.x += (this._air.x - seed.vel.x) * k;
        seed.vel.y += (this._air.y - seed.vel.y) * k;
        seed.vel.z += (this._air.z - seed.vel.z) * k;

        // a parachute is never perfectly still
        seed.vel.x += Math.cos(seed.age * 1.45 + seed.phase) * 0.09 * dt;
        seed.vel.y += Math.sin(seed.age * 1.9 + seed.phase * 1.3) * 0.07 * dt;
        seed.vel.z += Math.sin(seed.age * 1.15 + seed.phase) * 0.06 * dt;
        seed.vel.y -= 0.05 * dt;

        if (seed.vel.lengthSq() > 56) seed.vel.setLength(7.5);

        // A correctly aimed gust enters the receiver's current, which also
        // carries it vertically to hanging eyes. Only delivery lights the ring.
        if (seed.windEye) {
          const eye = seed.windEye;
          const delta = this._pos.copy(eye.position);
          delta.y += seed.enteredMouth ? .65 : -.65;
          delta.sub(seed.center);
          if (!seed.enteredMouth && delta.lengthSq()<.035) seed.enteredMouth=true;
          const step = Math.min(5*dt,delta.length());
          const crosses = seed.enteredMouth && seed.center.y <= eye.position.y &&
            seed.center.y + delta.y / Math.max(.001,delta.length())*step >= eye.position.y;
          if (crosses && Math.hypot(seed.center.x-eye.position.x,seed.center.z-eye.position.z)<.56) {
            eye.userData.total++;
            eye.userData.pulse=1;
            if (eye.userData.recordSource) eye.userData.recordSource(this);
            this.mesh.setMatrixAt(i, this._zero);
            this._releaseSeed(seed);
            continue;
          }
          seed.vel.copy(delta.normalize()).multiplyScalar(5);
        }
        seed.center.addScaledVector(seed.vel, dt);

        const remain = seed.life - seed.age;
        let fade = 1;
        if (remain < 2.2) fade = smoothstep(0, 2.2, remain);
        const baseY = this.basePosition.y;
        if (seed.center.y < baseY + 0.3) {
          fade *= smoothstep(baseY + 0.02, baseY + 0.3, seed.center.y);
        }
        if (!seed.windEye && fade <= 0.01) {
          this.mesh.setMatrixAt(i, this._zero);
          this._releaseSeed(seed);
          continue;
        }

        if (
          !seed.windEye && (seed.center.y < baseY - 0.8 ||
          Math.abs(seed.center.x - this.basePosition.x) > 34 ||
          seed.center.z - this.basePosition.z > 7 ||
          seed.center.z - this.basePosition.z < -40 ||
          seed.center.y > baseY + 16)
        ) {
          this.mesh.setMatrixAt(i, this._zero);
          this._releaseSeed(seed);
          continue;
        }

        seed.swing += dt * (1.0 + (seed.phase % 0.7));
        this._up.set(
          seed.vel.x * 0.045 + Math.sin(seed.swing * 1.7 + seed.phase) * 0.2,
          1,
          seed.vel.z * 0.045 + Math.cos(seed.swing * 1.3 + seed.phase) * 0.2
        ).normalize();

        const roll = Math.sin(seed.age * 1.25 + seed.phase) * 0.16;
        const settle = smoothstep(0, 0.45, seed.age);
        const flightSize = seed.flightFrom + (seed.flightScale - seed.flightFrom) * settle;
        const scale = flightSize * Math.max(0.02, fade) * (seed.windEye ? 1.8 : 1);
        this._writeBillboard(seed.center, this._up, scale, roll);
        this.mesh.setMatrixAt(i, this._matrix);
      } else {
        this.mesh.setMatrixAt(i, this._zero);
      }
    }

    // ---- seeds quietly grow back on the head ------------------------
    if (this.autoRegrow && this.freeSlots.length > 0 && !this._stemFading) {
      this.regrowTimer -= dt;
      const interval = this.transient
        ? this.params.wildRecoveryTime / Math.max(1, this.headSlots)
        : this.params.regrowMin + Math.random() * this.params.regrowVar;
      // Carry the overshoot instead of resetting to a full interval, so a
      // 30 fps / 60 fps frame cadence still refills the head in ~20 s.
      while (this.regrowTimer <= 0 && this.freeSlots.length > 0) {
        const before = this.freeSlots.length;
        this._regrowOne();
        if (this.freeSlots.length === before) break;
        this.regrowTimer += interval;
      }
    } else {
      this.regrowTimer = 0.2;
    }

    this.mesh.instanceMatrix.needsUpdate = true;

    if (this.transient && this._stemGone && !this.seeds.some((s) => s.active)) {
      this.finished = true;
    }

    // The soft inner fluff follows the seeds that have actually opened,
    // not the slot count, so the head fills gradually as the seeds grow.
    const fill = openHead / this.headSlots;
    if (fill > 0.015) {
      this.core.visible = true;
      this.core.quaternion.copy(this.camera.quaternion);
      this.core.position.copy(this.headOrigin);
      this.core.position.y += 0.02;
      this.core.position.addScaledVector(this.headLocalAir, 0.006);
      const size = (1.18 + fill * 0.28) * this.sizeScale * this._emergeMix;
      this.core.scale.setScalar(Math.max(0.001, size));
      this.core.material.opacity = (0.32 + fill * 0.5) * this._timeCoreOpacity *
        this._stemOpacity * this._emergeMix;
    } else {
      this.core.visible = false;
    }
  }
}