import { ROUTE } from './wind-route.js';
import * as THREE from 'three';
import { ABILITY_LABELS } from './abilities.js';

/* ------------------------------------------------------------------ */
/*  Anchors · capability gates                                         */
/*                                                                     */
/*  Five stops over the valley: old tree, windmill, updraft, spring    */
/*  and sundial. Rules, proximity checks, unlock + save states live    */
/*  here; the physical set pieces are built by journey-assets.js.      */
/* ------------------------------------------------------------------ */

const UP = new THREE.Vector3(0, 1, 0);

const ANCHOR_DEFS = [
  {
    id: 'oldTree',
    story: '老树的花盏空着。在树根旁种蒲公英，等白绒长好，再朝树洞滚过花旁。',
    label: '老树',
    sub: '第一阵风',
    ...ROUTE.oldTree,
    radius: 9,
    action: 'plant',
    requires: null,
    unlock: 'camera',
    verb: '唤醒老树',
    color: '#d8b98a',
    toast: '老树醒了。拿上相机，给它拍一张。',
    solveToast: '老树醒了。拿上相机，给它拍一张。',
    real: true,
    postcard: 'tree',
    cardTitle: '树下的风'
  },
  {
    id: 'windmill',
    story: '顺着路边的白花去磨坊。三只风铃依次亮起，从亮着的那只开始送种。',
    label: '风车',
    sub: '三只风铃',
    ...ROUTE.windmill,
    radius: 10,
    action: 'windmill',
    requires: 'camera',
    unlock: 'multiPlant',
    verb: '吹响三只风铃',
    color: '#b7c3cf',
    toast: '现在可以同时种三株花了。',
    solveToast: '风车转起来了。现在可以同时种三株花。',
    real: true,
    postcard: 'windmill',
    cardTitle: '风车的回声'
  },
  {
    id: 'updraft',
    story: '苗圃有三块种床，每块种一株。让每株花各送四粒种子到中间的花盏。',
    label: '三床苗圃',
    sub: '借风升起',
    ...ROUTE.updraft,
    radius: 8,
    action: 'key',
    requires: 'multiPlant',
    requiresAnchor: 'windmill',
    unlock: 'lift',
    verb: '借风升起',
    color: '#cfe0ec',
    toast: '你能飞了。按住升空，松开落地。',
    solveToast: '你能飞了。按住升空，松开落地。',
    postcard: 'tower',
    cardTitle: '三块种床'
  },
  {
    id: 'skyGarden', label: '云圃', sub: '登岛播种', ...ROUTE.skyGarden,
    radius: 8, action: 'plant', requires: 'lift', real: true, color: '#bfe3bc',
    story: '从最低的一座开始，每座岩台都落一次脚。最后在顶上种花，把种子吹进花盏。',
    solveToast: '顶上的花开了。下一站去枯泉。'
  },
  {
    id: 'spring',
    story: '泉边一高一低两只花盏，各收十粒。低处贴地滚，高处要飞起来，从花旁掠过。',
    label: '枯泉',
    sub: '回种',
    ...ROUTE.spring,
    radius: 10,
    action: 'spring',
    requires: 'lift',
    unlock: 'restore',
    verb: '复苏枯泉',
    color: '#a9c7a7',
    toast: '泉里有水了。现在可以同时养六株花。',
    solveToast: '泉里有水了。现在可以同时养六株花。',
    real: true,
    postcard: 'spring',
    cardTitle: '泉水回来了'
  },
  {
    id: 'sundial',
    story: '在日晷旁留下四株活花，往花盏送满十八粒种子。拖动太阳或月亮，让影子对准石盘上的刻痕。',
    label: '山脊日晷',
    sub: '日落刻度',
    ...ROUTE.sundial,
    radius: 10,
    action: 'sundial',
    requires: 'restore',
    unlock: 'time',
    verb: '触摸日种',
    color: '#e6c98d',
    toast: '日种入手 · 拖动日月对准刻痕',
    solveToast: '日影对齐 · 山谷的尽头',
    real: true,
    postcard: 'sundial',
    cardTitle: '山谷的尽头'
  }
];

function makeLabelTexture(title, subtitle, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 192;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 512, 192);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255, 248, 230, 0.96)';
  ctx.font = '600 52px "PingFang SC", "Noto Sans SC", sans-serif';
  ctx.fillText(title, 256, 74);

  ctx.fillStyle = color;
  ctx.font = '400 28px "PingFang SC", "Noto Sans SC", sans-serif';
  ctx.fillText(subtitle, 256, 132);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function terrainNormal(world, x, z) {
  const e = 0.7;
  const ground = world.heightAt(x, z);
  const hx = (world.heightAt(x + e, z) - world.heightAt(x - e, z)) / (2 * e);
  const hz = (world.heightAt(x, z + e) - world.heightAt(x, z - e)) / (2 * e);
  return {
    ground,
    normal: new THREE.Vector3(-hx, 1, -hz).normalize()
  };
}

export class Anchors {
  constructor({ scene, world, abilities, onUnlock, onSolve, onToast }) {
    this.scene = scene;
    this.world = world;
    this.abilities = abilities;
    this.onUnlock = onUnlock;
    this.onSolve = onSolve;
    this.onToast = onToast;
    this.items = [];
    this.nearby = null;
    this.prompt = '';
    this.group = new THREE.Group();
    scene.add(this.group);

    for (const def of ANCHOR_DEFS) {
      this.items.push(this._createItem(def));
    }

    // Reconcile saved ability state with anchor visuals.
    for (const item of this.items) {
      const solved = this.abilities.getAnchorState(item.def.id) === 'solved';
      if (solved) {
        item.solved = true;
        this._applySolvedVisual(item);
      }
    }
  }

  _createItem(def) {
    const { ground, normal } = terrainNormal(this.world, def.x, def.z);
    const item = {
      def,
      solved: false,
      ground,
      normal,
      pulse: Math.random() * Math.PI * 2
    };

  

    item.label = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeLabelTexture(def.label, def.sub, def.color),
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        opacity: 0.92
      })
    );
    item.label.position.set(def.x, ground + 3.55, def.z);
    item.label.scale.set(5.0, 1.9, 1);
    item.label.renderOrder = 3;
    this.group.add(item.label);

    item.label.visible = false;
    return item;
  }

  _applySolvedVisual(item) {
    item.label.visible = false;
  }

  _buildPrompt(item) {
    if (!item || item.solved) return '';
    if (item.def.requires && !this.abilities.has(item.def.requires)) {
      return `需要先解锁【${ABILITY_LABELS[item.def.requires]}】`;
    }
    if (item.def.requiresAnchor &&
        this.abilities.getAnchorState(item.def.requiresAnchor) !== 'solved') {
      return '需要先让风车转动';
    }
    if (item.def.id === 'sundial' && this.abilities.has('time')) return '拖动日月，让日影对准刻痕';
    return '在发光花盏旁种花，再朝花盏滚过花旁';
  }

  update(dt, elapsed, playerPos) {
    let nearest = null;
    let nearestDist = Infinity;

    for (const item of this.items) {
      if (item.solved) continue;
      if (item.def.requiresAnchor && !this.isSolved(item.def.requiresAnchor)) continue;

      const dx = playerPos.x - item.def.x;
      const dz = playerPos.z - item.def.z;
      const dist = Math.hypot(dx, dz);
      if (dist <= item.def.radius && dist < nearestDist) {
        nearest = item;
        nearestDist = dist;
      }
    }

    this.nearby = nearest;
    this.prompt = this._buildPrompt(nearest);
  }

  interact() {
    const item = this.nearby;
    if (!item) return false;

    this.onToast?.(this._buildPrompt(item));
    return false;
  }

  _solve(item, silent = false) {
    if (item.solved) return false;
    item.solved = true;

    if (item.def.unlock && !this.abilities.has(item.def.unlock)) {
      this.abilities.unlock(item.def.unlock);
      this.onUnlock?.(item.def.unlock, item.def);
    }
    this.abilities.setAnchorState(item.def.id, 'solved');
    this._applySolvedVisual(item);

    this.prompt = '';
    this.nearby = null;
    this.onSolve?.(item.def.id, item.def);
    if (!silent) {
      this.onToast?.(
        item.def.solveToast ||
        item.def.toast ||
        `解锁 · ${ABILITY_LABELS[item.def.unlock] || item.def.label}`
      );
    }
    return true;
  }

  solveById(id, silent = false) {
    const item = this.items.find((entry) => entry.def.id === id);
    if (!item) return false;
    return this._solve(item, silent);
  }

  isSolved(id) {
    const item = this.items.find((entry) => entry.def.id === id);
    return !!(item && item.solved);
  }

  getPhotoTarget(playerPos) {
    let best = null;
    let bestDistance = Infinity;
    for (const item of this.items) {
      if (!item.solved || !item.def.postcard) continue;
      const dist = Math.hypot(
        playerPos.x - item.def.x,
        playerPos.z - item.def.z
      );
      if (dist <= item.def.radius + 2.5 && dist < bestDistance) {
        best = item;
        bestDistance = dist;
      }
    }
    return best;
  }
}