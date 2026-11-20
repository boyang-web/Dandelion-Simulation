import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/*  Orbit camera rig for mode 3                                        */
/*                                                                     */
/*  A small, art-directed orbit: enough yaw/pitch and dolly to feel    */
/*  the meadow in three dimensions without turning the painted sky     */
/*  into a spinning backdrop.                                           */
/* ------------------------------------------------------------------ */

export class OrbitRig {
  constructor(camera, canvas, {
    target = new THREE.Vector3(0, 2.3, 0.02),
    minRadius = 6.8,
    maxRadius = 15.5,
    minPitch = 0.02,
    maxPitch = 0.38,
    maxYaw = 0.85
  } = {}) {
    this.camera = camera;
    this.canvas = canvas;
    this.target = target.clone();
    this.minRadius = minRadius;
    this.maxRadius = maxRadius;
    this.minPitch = minPitch;
    this.maxPitch = maxPitch;
    this.maxYaw = maxYaw;

    this.radius = 9.4;
    this.yaw = 0;
    this.pitch = 0.02;
    this.active = false;
    this.dragging = false;
    this.pointers = new Map();
    this.lastX = 0;
    this.lastY = 0;
    this.pinchStart = 0;
    this.pinchRadius = this.radius;
    this._bound = false;

    this._bind();
  }

  _bind() {
    const down = (e) => {
      if (!this.active || e.target !== this.canvas) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }

      if (this.pointers.size === 1) {
        this.dragging = true;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        document.body.classList.add('orbit-dragging');
      } else if (this.pointers.size === 2) {
        const pts = [...this.pointers.values()];
        this.pinchStart = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        this.pinchRadius = this.radius;
      }
    };

    const move = (e) => {
      if (!this.active || !this.pointers.has(e.pointerId)) return;
      e.preventDefault();
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this.pointers.size >= 2) {
        const pts = [...this.pointers.values()];
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (this.pinchStart > 1 && dist > 1) {
          this.radius = THREE.MathUtils.clamp(
            this.pinchRadius * (this.pinchStart / dist),
            this.minRadius,
            this.maxRadius
          );
          this._apply();
        }
        return;
      }

      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.yaw = THREE.MathUtils.clamp(this.yaw - dx * 0.0032, -this.maxYaw, this.maxYaw);
      this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0030, this.minPitch, this.maxPitch);
      this._apply();
    };

    const up = (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      try { this.canvas.releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }
      if (this.pointers.size === 0) {
        this.dragging = false;
        document.body.classList.remove('orbit-dragging');
      } else if (this.pointers.size === 1) {
        const p = [...this.pointers.values()][0];
        this.lastX = p.x;
        this.lastY = p.y;
      }
    };

    const wheel = (e) => {
      if (!this.active) return;
      e.preventDefault();
      this.radius = THREE.MathUtils.clamp(
        this.radius * Math.exp(e.deltaY * 0.0012),
        this.minRadius,
        this.maxRadius
      );
      this._apply();
    };

    this.canvas.addEventListener('pointerdown', down);
    this.canvas.addEventListener('pointermove', move);
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
    this.canvas.addEventListener('lostpointercapture', up);
    this.canvas.addEventListener('wheel', wheel, { passive: false });
    this._bound = true;
  }

  setActive(on) {
    this.active = !!on;
    if (this.active) {
      this.syncFromCamera();
      this._apply();
    } else {
      this.pointers.clear();
      this.dragging = false;
      document.body.classList.remove('orbit-dragging');
    }
  }

  syncFromCamera() {
    const dx = this.camera.position.x - this.target.x;
    const dy = this.camera.position.y - this.target.y;
    const dz = this.camera.position.z - this.target.z;
    this.radius = THREE.MathUtils.clamp(Math.hypot(dx, dy, dz), this.minRadius, this.maxRadius);
    this.yaw = THREE.MathUtils.clamp(Math.atan2(dx, dz), -this.maxYaw, this.maxYaw);
    this.pitch = THREE.MathUtils.clamp(
      Math.asin(THREE.MathUtils.clamp(dy / this.radius, -1, 1)),
      this.minPitch,
      this.maxPitch
    );
  }

  apply() {
    this._apply();
  }

  _apply() {
    const cp = Math.cos(this.pitch);
    this.camera.position.set(
      this.target.x + this.radius * Math.sin(this.yaw) * cp,
      this.target.y + this.radius * Math.sin(this.pitch),
      this.target.z + this.radius * Math.cos(this.yaw) * cp
    );
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }
}