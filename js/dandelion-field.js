import * as THREE from 'three';
import { Dandelion } from './dandelion.js';

/* ------------------------------------------------------------------ */
/*  Wild dandelions                                                    */
/*                                                                     */
/*  Mode 2 plants are deliberately not copies of the hero: they have    */
/*  fewer seeds, never regrow, release their seeds slowly on their own, */
/*  and let their stem fade after a short life.                         */
/* ------------------------------------------------------------------ */

const WILD_SLOTS = 120;
const WILD_SEEDS = 200;

export class DandelionField {
  constructor({ scene, camera, renderer, wind, maxPlants = 8 }) {
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
      autoRegrow: false,
      transient: true,
      position: point.clone(),
      rotationY: Math.random() * Math.PI * 2
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