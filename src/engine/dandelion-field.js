import * as THREE from 'three';
import { Dandelion } from './dandelion.js';

/* ------------------------------------------------------------------ */
/*  Wild dandelions                                                    */
/*                                                                     */
/*  Planted dandelions have fewer seeds, release them slowly on their   */
/*  own, and regrow a stripped head over about 20 seconds. Their stem   */
/*  fades after a short life. They are never created automatically.     */
/* ------------------------------------------------------------------ */

const WILD_SLOTS = 120;
const WILD_SEEDS = 200;

export class DandelionField {
  constructor({ scene, camera, renderer, wind, maxPlants = 15 }) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.wind = wind;
    this.maxPlants = maxPlants;
    this.plants = [];
    this.ripples = [];
  }

  get count() {
    return this.plants.length;
  }

  setMaxPlants(maxPlants) {
    this.maxPlants = Math.max(1, Math.floor(maxPlants) || 1);
    while (this.plants.length > this.maxPlants) {
      this._remove(this.plants.shift());
    }
  }

  /** Remove the nearest plant inside a radius; used when the old tree
   *  consumes its first offering and turns it into a bloom. */
  removeNearest(x, z, radius) {
    let best = null;
    let bestDist = radius;
    for (const plant of this.plants) {
      const p = plant.group.position;
      const dist = Math.hypot(p.x - x, p.z - z);
      if (dist <= bestDist) {
        best = plant;
        bestDist = dist;
      }
    }
    if (best) {
      this._remove(best);
      return true;
    }
    return false;
  }

  stats() {
    let head = 0;
    let flying = 0;
    let speed = 0;
    for (const plant of this.plants) {
      head += plant.headCount;
      for (const seed of plant.seeds) {
        if (seed.active && seed.state === 2) {
          flying++;
          speed += seed.vel.length();
        }
      }
    }
    return {
      plants: this.plants.length,
      head,
      flying,
      avgSpeed: flying ? speed / flying : 0
    };
  }

  spawnAt(point) {
    for (const plant of this.plants) {
      if (plant.group.position.distanceTo(point) < 0.9) return null;
    }

    const plant = new Dandelion({
      scene: this.scene,
      camera: this.camera,
      renderer: this.renderer,
      wind: this.wind,
      headSlots: WILD_SLOTS,
      maxSeeds: WILD_SEEDS,
      autoRegrow: true,
      transient: true,
      position: point.clone(),
      rotationY: Math.random() * Math.PI * 2,
      sizeScale: 0.8 + Math.random() * 0.4
    });
    this.plants.push(plant);
    this._spawnRipple(point);

    if (this.plants.length > this.maxPlants) {
      this._remove(this.plants.shift());
    }
    return plant;
  }

  _spawnRipple(point) {
    const material = new THREE.MeshBasicMaterial({
      color: '#f4e4b2',
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false
    });
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.24, 40), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(point);
    mesh.position.y += 0.025;
    mesh.renderOrder = 1;
    this.scene.add(mesh);
    this.ripples.push({ mesh, age: 0 });
  }

  _remove(plant) {
    const index = this.plants.indexOf(plant);
    if (index >= 0) this.plants.splice(index, 1);
    plant.dispose();
  }

  update(t, dt) {
    for (let i = this.plants.length - 1; i >= 0; i--) {
      const plant = this.plants[i];
      plant.update(dt, t);
      if (plant.finished) this._remove(plant);
    }

    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const ripple = this.ripples[i];
      ripple.age += dt;
      const life = Math.min(1, ripple.age / 0.9);
      ripple.mesh.scale.setScalar(1 + life * 4.5);
      ripple.mesh.material.opacity = 0.5 * (1 - life);
      if (life >= 1) {
        this.scene.remove(ripple.mesh);
        ripple.mesh.geometry.dispose();
        ripple.mesh.material.dispose();
        this.ripples.splice(i, 1);
      }
    }
  }

  clear() {
    for (const plant of this.plants) plant.dispose();
    this.plants.length = 0;
    for (const ripple of this.ripples) {
      this.scene.remove(ripple.mesh);
      ripple.mesh.geometry.dispose();
      ripple.mesh.material.dispose();
    }
    this.ripples.length = 0;
  }
}