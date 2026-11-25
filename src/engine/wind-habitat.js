import { createShrine } from './seed-shrine.js';
import { createPlantBatch } from './trail-garden.js';
import * as THREE from 'three';
import { ROUTE, onTrail } from './wind-route.js';

export function createWindHabitat(scene, world, loader) {
  const batches = new Map();
  const geometries = {
    rock: new THREE.IcosahedronGeometry(1, 0),
    leaf: new THREE.SphereGeometry(1, 7, 4),
    stem: new THREE.CylinderGeometry(.68, 1, 1, 7),
    cone: new THREE.ConeGeometry(1, 1, 9)
  };
  let state = 517;
  const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
  const pose = new THREE.Object3D();
  function part(shape, color, x, y, z, sx, sy, sz, yaw = 0, lean = 0) {
    if (!batches.has(shape)) batches.set(shape, []);
    pose.position.set(x, y, z);
    pose.rotation.set(0, yaw, lean);
    pose.scale.set(sx, sy, sz);
    pose.updateMatrix();
    batches.get(shape).push([pose.matrix.clone(), new THREE.Color(color)]);
  }
  const pineCenters = [], pineSizes = [];
  function pine(x, y, z, h) {
    pineCenters.push(x,y,z);
    pineSizes.push(h);
  }
  const eyes = {};
  const butterflies = [];
  for (const [id, stop] of Object.entries(ROUTE)) {
    eyes[id] = stop.eyes.map(([dx, dz, h], index) => {
      const x = stop.x + dx, z = stop.z + dz;
      const y = id === 'skyGarden' ? world.levels.islands[2].top : world.heightAt(x,z);
      const ring = createShrine(id);
      ring.position.set(x, y + h, z);
      scene.add(ring);
      if (id === 'windmill') {
        const metal = new THREE.MeshStandardMaterial({ color: '#bd9257', metalness: .45, roughness: .48 });
        const length = 1.0 - index * .22;
        for (let k = -1; k <= 1; k++) {
          const bell = new THREE.Mesh(new THREE.CylinderGeometry(.07,.11,length,10,1,true),metal);
          bell.position.set(k*.25,-.74-length/2-.09*Math.cos(k),0);
          ring.add(bell);
        }
      }
      if (h < 4) part('stem', '#8d7354', x, y + (h - .8) / 2, z, .08, h - .8, .08);
      return ring;
    });
    for (let k = 0; k < 27; k++) {
      const a = random() * 6.28, r = 8 + random() * 7;
      const x = stop.x + Math.cos(a) * r, z = stop.z + Math.sin(a) * r;
      if (onTrail(x,z)) continue;
      const y = world.heightAt(x, z);
      if (id === 'updraft' || id === 'sundial') {
        if (k % 3 === 0 && r > 11.5) pine(x, y, z, 3 + random() * 4);
      } else if (id === 'spring') {
        for (let n = 0; n < 4; n++) {
          const h = .9 + random() * 1.4, rx = x + random(), rz = z + random();
          part('stem', '#83915d', rx, y + h / 2, rz, .045, h, .045);
          part('leaf', '#966b49', rx, y + h, rz, .11, .34, .11);
        }
      } else {
        const r = .3 + random() * .8;
        part('rock', '#8b8872', x, y + .10, z, r, r*.52, r*.74, a);
        part('leaf', '#73905b', x-.04, y+r*.39, z, r*.74, r*.12, r*.53, a);
      }
    }
    if (id === 'spring' || id === 'oldTree') {
      for (let k = 0; k < 5; k++) butterflies.push([stop.x + random()*7-3, stop.z + random()*6-3, random()*6]);
    }
  }
  // Discontinuous groves anchor the foothills; gaps leave the valley exits legible.
  for (let grove = 0; grove < 22; grove++) {
    const angle = grove*2.4, radius = 60 + random()*48;
    for (let k = 0; k < 13; k++) {
      const x = Math.sin(angle)*radius + (random()-.5)*18;
      const z = Math.cos(angle)*radius + (random()-.5)*12;
      if(Object.values(ROUTE).some(stop=>Math.hypot(stop.x-x,stop.z-z)<11)) continue;
      pine(x,world.heightAt(x,z),z,3.5 + random()*5.5);
    }
  }
  for(const deck of world.levels.islands) {
    pine(deck.x+deck.r*.62,deck.top,deck.z-deck.r*.46,3.6);
    pine(deck.x+deck.r*.48,deck.top,deck.z-deck.r*.64,2.2);
  }
  const updatePines = createPlantBatch(scene, loader, pineCenters, pineSizes.map(() => 0), pineSizes,
    new URL('../../assets/valley-spruce.webp', import.meta.url), 1, .66, .33);
  for (const [shape, instances] of batches) {
    const mesh = new THREE.InstancedMesh(geometries[shape], new THREE.MeshStandardMaterial({ roughness: 1 }), instances.length);
    instances.forEach(([matrix, color], i) => { mesh.setMatrixAt(i, matrix); mesh.setColorAt(i, color); });
    scene.add(mesh);
  }
  const wings = new THREE.InstancedMesh(geometries.leaf, new THREE.MeshBasicMaterial({ color: '#ffbd70' }), butterflies.length * 2);
  wings.frustumCulled = false;
  scene.add(wings);
  return { eyes, update(t, night) {
    updatePines(t*.28, night);
    butterflies.forEach(([bx,bz,phase], i) => {
      const a = t *.75 + phase, x = bx + Math.cos(a)*1.3, z = bz + Math.sin(a)*.9;
      const y = world.heightAt(bx,bz) + 1.6 + Math.sin(2*a)*.35;
      for (let k = 0; k < 2; k++) {
        const sign = k ? 1 : -1;
        pose.position.set(x + sign*.1,y,z);
        pose.rotation.set(0, -a, sign*(.65 + Math.sin(t*15+phase)*.55));
        pose.scale.set(.2,.034,.13);
        pose.updateMatrix();
        wings.setMatrixAt(i*2+k,pose.matrix);
      }
    });
    wings.instanceMatrix.needsUpdate = true;
  }};
}
