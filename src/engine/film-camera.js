import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/*  Film camera · place, frame, shoot                                  */
/*                                                                     */
/*  One physical tripod camera, a single active view: drag to aim,     */
/*  wheel to zoom. Shutter and clips are composited by capture.js.     */
/* ------------------------------------------------------------------ */

const UP = new THREE.Vector3(0, 1, 0);
const MIN_FOV = 28;
const MAX_FOV = 65;
const TRIPOD_HEIGHT = 1.38;
const MAX_RADIUS = 130;
const MAX_SLOPE = 0.5;
const MAX_GROUND_HEIGHT = 40;

function stick(a, b, radius, material) {
  const dir = b.clone().sub(a);
  const length = dir.length();
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, length, 6),
    material
  );
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
  return mesh;
}

export class FilmCamera {
  constructor({ scene, camera, canvas, world, getFocus, onPlace, onToast }) {
    this.scene = scene;
    this.mainCamera = camera;
    this.canvas = canvas;
    this.world = world;
    this.getFocus = getFocus;
    this.onPlace = onPlace;
    this.onToast = onToast;

    this.camera = new THREE.PerspectiveCamera(
      45,
      window.innerWidth / window.innerHeight,
      0.1,
      1400
    );
    this.camera.rotation.order = 'YXZ';

    this.placed = false;
    this.active = false;
    this.placing = false;
    this.dragging = false;
    this.dragId = null;
    this.lastX = 0;
    this.lastY = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.fov = 45;
    this.lastPoint = null;
    this.ghostValid = false;

    this._raycaster = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();

    this._buildRig();
    this._buildGhost();
    this._bind();
  }

  _buildRig() {
    this.rig = new THREE.Group();

    const metal = new THREE.MeshStandardMaterial({
      color: '#4a4438',
      roughness: 0.72,
      metalness: 0.35
    });
    const dark = new THREE.MeshStandardMaterial({
      color: '#2c2822',
      roughness: 0.9,
      metalness: 0.1
    });
    const glass = new THREE.MeshStandardMaterial({
      color: '#b9c8cc',
      roughness: 0.22,
      metalness: 0.65
    });

    this.rig.add(stick(
      new THREE.Vector3(0, 1.16, 0),
      new THREE.Vector3(0.48, 0, 0.2),
      0.022,
      metal
    ));
    this.rig.add(stick(
      new THREE.Vector3(0, 1.16, 0),
      new THREE.Vector3(-0.36, 0, 0.42),
      0.022,
      metal
    ));
    this.rig.add(stick(
      new THREE.Vector3(0, 1.16, 0),
      new THREE.Vector3(-0.08, 0, -0.55),
      0.022,
      metal
    ));

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.3, 0.52),
      dark
    );
    body.position.set(0, 1.34, 0);
    this.rig.add(body);

    const lens = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.17, 0.3, 14),
      glass
    );
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0, 1.34, -0.36);
    this.rig.add(lens);

    this.rigLight = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 10, 8),
      new THREE.MeshBasicMaterial({ color: '#d95b45', toneMapped: false })
    );
    this.rigLight.position.set(0.13, 1.47, -0.22);
    this.rig.add(this.rigLight);

    this.rig.visible = false;
    this.rig.frustumCulled = false;
    this.scene.add(this.rig);
  }

  _buildGhost() {
    this.ghost = new THREE.Group();

    this.ghostRing = new THREE.Mesh(
      new THREE.RingGeometry(0.75, 1.0, 48),
      new THREE.MeshBasicMaterial({
        color: '#f4dcae',
        transparent: true,
        opacity: 0.65,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false
      })
    );
    this.ghostRing.geometry.rotateX(-Math.PI / 2);
    this.ghostRing.renderOrder = 8;
    this.ghost.add(this.ghostRing);

    this.ghostBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.34, 0.55),
      new THREE.MeshBasicMaterial({
        color: '#f4dcae',
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
        toneMapped: false
      })
    );
    this.ghostBox.position.y = TRIPOD_HEIGHT;
    this.ghostBox.renderOrder = 8;
    this.ghost.add(this.ghostBox);

    this.ghost.visible = false;
    this.scene.add(this.ghost);
  }

  _bind() {
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.target !== this.canvas) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;

      if (this.placing) {
        e.preventDefault();
        // The first click should also work without moving the mouse first.
        if (!this.ghostValid || !this.lastPoint) {
          this._updateGhost(e.clientX, e.clientY);
        }
        if (this.ghostValid && this.lastPoint) {
          this.placeAt(this.lastPoint);
        } else {
          this.onToast?.('把相机放在草地上');
        }
        return;
      }

      if (!this.active) return;
      e.preventDefault();
      this.dragging = true;
      this.dragId = e.pointerId;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (this.placing) {
        this._updateGhost(e.clientX, e.clientY);
      }
      if (!this.dragging || e.pointerId !== this.dragId) return;
      e.preventDefault();
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.yaw -= dx * 0.0032;
      if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
      else if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
      this.pitch = THREE.MathUtils.clamp(
        this.pitch - dy * 0.0030,
        -1.15,
        1.15
      );
      this._applyRotation();
    });

    const endDrag = (e) => {
      if (this.dragging && e.pointerId === this.dragId) {
        this.dragging = false;
        this.dragId = null;
        try { this.canvas.releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }
      }
    };
    this.canvas.addEventListener('pointerup', endDrag);
    this.canvas.addEventListener('pointercancel', endDrag);
    this.canvas.addEventListener('lostpointercapture', endDrag);

    this.canvas.addEventListener('wheel', (e) => {
      if (e.target !== this.canvas || !this.active) return;
      e.preventDefault();
      this.setFov(this.fov * Math.exp(e.deltaY * 0.0012));
    }, { passive: false });
  }

  _updateGhost(clientX, clientY) {
    this._ndc.set(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1
    );
    this._raycaster.setFromCamera(this._ndc, this.mainCamera);
    const hits = this._raycaster.intersectObject(this.world.ground, false);
    if (!hits.length) {
      this.ghost.visible = false;
      this.ghostValid = false;
      this.lastPoint = null;
      return;
    }
    const point = hits[0].point;
    const valid = this._valid(point);
    this.ghost.visible = true;
    this.lastPoint = point.clone();
    this.ghostValid = valid;
    this.ghost.position.set(point.x, point.y + 0.03, point.z);
    const color = valid ? '#f4dcae' : '#d66a5a';
    this.ghostRing.material.color.set(color);
    this.ghostBox.material.color.set(color);
  }

  _valid(point) {
    const r = Math.hypot(point.x, point.z);
    if (r > MAX_RADIUS) return false;
    if (point.y > MAX_GROUND_HEIGHT) return false;
    if (this.world.slopeAt && this.world.slopeAt(point.x, point.z) > MAX_SLOPE) {
      return false;
    }
    return true;
  }

  beginPlacement() {
    this.placing = true;
    this.active = false;
    this.dragging = false;
    this.dragId = null;
    this.rig.visible = false;

    if (this.placed) {
      this.ghost.visible = true;
      this.ghost.position.copy(this.rig.position);
      this.ghost.position.y += 0.03;
      this.lastPoint = new THREE.Vector3(
        this.camera.position.x,
        this.world.heightAt(this.camera.position.x, this.camera.position.z),
        this.camera.position.z
      );
      this.ghostValid = this._valid(this.lastPoint);
    } else {
      this.ghost.visible = false;
      this.ghostValid = false;
      this.lastPoint = null;
    }
  }

  cancelPlacement() {
    this.placing = false;
    this.ghost.visible = false;
    this.ghostValid = false;
    this.lastPoint = null;
    if (this.placed) this.rig.visible = !this.active;
  }

  placeAt(point) {
    if (!point || !this._valid(point)) {
      this.onToast?.('这里放不稳，换一片草地');
      return false;
    }

    const ground = this.world.heightAt(point.x, point.z);
    this.rig.position.set(point.x, ground, point.z);
    this.rig.visible = false;
    this.camera.position.set(point.x, ground + TRIPOD_HEIGHT, point.z);

    this.ghost.visible = false;
    this.ghostValid = false;
    this.lastPoint = point.clone();
    this.placed = true;
    this.placing = false;

    this._lookAtFocus();
    this.onPlace?.(this);
    return true;
  }

  _lookAtFocus() {
    const focus = this.getFocus();
    const dx = focus.x - this.camera.position.x;
    const dy = focus.y - this.camera.position.y;
    const dz = focus.z - this.camera.position.z;
    const length = Math.hypot(dx, dy, dz) || 1;
    this.yaw = Math.atan2(-dx, -dz);
    this.pitch = THREE.MathUtils.clamp(
      Math.asin(THREE.MathUtils.clamp(dy / length, -1, 1)),
      -1.15,
      1.15
    );
    this._applyRotation();
  }

  _applyRotation() {
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.rig.rotation.y = this.yaw;
  }

  activate() {
    if (!this.placed) return false;
    this.active = true;
    this.placing = false;
    this.ghost.visible = false;
    this.rig.visible = false;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    return true;
  }

  deactivate() {
    this.active = false;
    this.dragging = false;
    this.dragId = null;
    this.rig.visible = this.placed;
  }

  setFov(fov) {
    this.fov = THREE.MathUtils.clamp(fov, MIN_FOV, MAX_FOV);
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
  }

  setAspect(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  getYaw() {
    return this.yaw;
  }

  get isActive() {
    return this.active;
  }

  get isPlacing() {
    return this.placing;
  }

  update(dt, elapsed) {
    if (this.placing) {
      const pulse = 0.5 + 0.5 * Math.sin(elapsed * 4.5);
      this.ghostRing.material.opacity = 0.35 + pulse * 0.35;
      this.ghostBox.material.opacity = 0.15 + pulse * 0.18;
    }

    if (this.rigLight) {
      this.rigLight.material.color.setRGB(
        0.85,
        0.18 + (this.active ? 0 : 0.25 * (0.5 + 0.5 * Math.sin(elapsed * 2.2))),
        0.14
      );
    }

    if (this.active) {
      this.camera.updateMatrixWorld();
    }
  }
}