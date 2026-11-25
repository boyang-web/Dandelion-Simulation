import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/*  Always-on orbit / zoom rig                                         */
/*                                                                     */
/*  Desktop: hover is wind, left-drag is camera, wheel is zoom.         */
/*  Touch: one finger is wind, two fingers are camera + pinch.          */
/*  A short click/tap is left to the planting tap detector.             */
/* ------------------------------------------------------------------ */

export class OrbitRig {
  constructor(camera, canvas, {
    target = new THREE.Vector3(0, 2.0, 0.02),
    minRadius = 2.5,
    maxRadius = 32,
    minPitch = 0,
    maxPitch = Math.PI / 2 - 0.02,
    freeLook = false,
    lookPitchMin = -1.35,
    lookPitchMax = 1.35,
    lookPitch = 0,
    lookYaw = 0,
    touchOrbit = false,
    groundAt = null,
    clearance = 1.8,
    fov = null,
    fovMin = 24,
    fovMax = 78
  } = {}) {
    this.camera = camera;
    this.canvas = canvas;
    this.target = target.clone();
    this.minRadius = minRadius;
    this.maxRadius = maxRadius;
    this.minPitch = minPitch;
    this.maxPitch = maxPitch;
    this.freeLook = !!freeLook;
    this.enabled = true;
    this.touchOrbit = !!touchOrbit;
    this.lookPitchMin = lookPitchMin;
    this.lookPitchMax = lookPitchMax;
    this.lookPitch = THREE.MathUtils.clamp(lookPitch, lookPitchMin, lookPitchMax);
    this.lookYaw = lookYaw;
    this.groundAt = groundAt;
    this.clearance = clearance;
    this.fov = fov == null ? camera.fov : fov;
    this.fovMin = fovMin;
    this.fovMax = fovMax;

    this.radius = 9.4;
    this.yaw = 0;
    this.pitch = 0.02;
    this.hasView = false;
    this.dragging = false;
    this.pointers = new Map();
    this.pending = false;
    this.startX = 0;
    this.startY = 0;
    this.lastX = 0;
    this.lastY = 0;
    this.pinchStart = 0;
    this.pinchRadius = this.radius;
    this.pinchFov = this.fov;
    this.lastCentroid = { x: 0, y: 0 };
    this.onDragStart = null;
    this.onDragEnd = null;

    this._bind();
  }

  _bind() {
    const down = (e) => {
      if (!this.enabled) return;
      if (e.target !== this.canvas) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;

      this.pointers.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
        type: e.pointerType
      });
      try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }

      if (this.pointers.size === 1) {
        this.pending = true;
        this.startX = e.clientX;
        this.startY = e.clientY;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
      } else {
        // Two or more fingers revolve / pinch together. Resetting the
        // baseline on every finger-count change keeps a third finger from
        // making the camera jump when another finger lifts.
        this.pending = false;
        this._beginDrag();
        this.pinchStart = 0;
        this.lastCentroid = null;
        e.preventDefault();
      }
    };

    const move = (e) => {
      if (!this.enabled) return;
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
        type: e.pointerType
      });

      if (this.pointers.size >= 2) {
        e.preventDefault();
        const g = this._gesture();
        if (!this.pinchStart) {
          this._beginDrag();
          this.pinchStart = Math.max(g.spread, 1);
          this.pinchRadius = this.radius;
          this.pinchFov = this.fov;
          this.lastCentroid = { x: g.cx, y: g.cy };
        }

        const dx = g.cx - this.lastCentroid.x;
        const dy = g.cy - this.lastCentroid.y;
        this.lastCentroid = { x: g.cx, y: g.cy };
        if (dx || dy) {
          if (this.freeLook) {
            this.lookYaw -= dx * 0.0032;
            if (this.lookYaw > Math.PI) this.lookYaw -= Math.PI * 2;
            else if (this.lookYaw < -Math.PI) this.lookYaw += Math.PI * 2;
            this.lookPitch = THREE.MathUtils.clamp(
              this.lookPitch - dy * 0.0030, this.lookPitchMin, this.lookPitchMax
            );
          } else {
            this.yaw -= dx * 0.0032;
            if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
            else if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
            this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0030, this.minPitch, this.maxPitch);
          }
          this.hasView = true;
        }

        // Average distance from the finger centroid: works the same for
        // two fingers and stays smooth when a third one joins or leaves.
        if (this.pinchStart > 1 && g.spread > 1) {
          const ratio = this.pinchStart / g.spread;
          if (this.freeLook) {
            this.fov = THREE.MathUtils.clamp(
              this.pinchFov * ratio,
              this.fovMin,
              this.fovMax
            );
          } else {
            this.radius = THREE.MathUtils.clamp(
              this.pinchRadius * ratio,
              this.minRadius,
              this.maxRadius
            );
          }
          this.hasView = true;
        }
        this._apply();
        return;
      }

      // On mobile with the joystick UI, one finger owns the camera; desktop
      // still gives one-finger wind to the wind field.
      if (e.pointerType === 'touch' && !this.touchOrbit) return;

      if (this.pending) {
        if (Math.hypot(e.clientX - this.startX, e.clientY - this.startY) < 10) return;
        this.pending = false;
        this._beginDrag();
        // Keep lastX/lastY at the press point: this first event should apply
        // the movement that crossed the drag threshold.
      }
      if (!this.dragging) return;

      e.preventDefault();
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      if (this.freeLook) {
        this.lookYaw -= dx * 0.0032;
        if (this.lookYaw > Math.PI) this.lookYaw -= Math.PI * 2;
        else if (this.lookYaw < -Math.PI) this.lookYaw += Math.PI * 2;
        this.lookPitch = THREE.MathUtils.clamp(
          this.lookPitch - dy * 0.0030, this.lookPitchMin, this.lookPitchMax
        );
      } else {
        this.yaw -= dx * 0.0032;
        if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
        else if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
        this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0030, this.minPitch, this.maxPitch);
      }
      this.hasView = true;
      this._apply();
    };

    const up = (e) => {
      if (!this.enabled) return;
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      try { this.canvas.releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }

      if (this.dragging && this.pointers.size < 2) this._endDrag();
      // If two or more fingers remain, the next move re-samples the centroid
      // and spread before applying rotation, so lifting one of three fingers
      // does not snap the camera sideways.
      this.pinchStart = 0;
      this.lastCentroid = null;
      if (this.pointers.size === 0) this.pending = false;
    };

    const wheel = (e) => {
      if (!this.enabled) return;
      if (e.target !== this.canvas) return;
      e.preventDefault();
      if (!this.hasView) this.syncFromCamera();
      if (this.freeLook) {
        this.fov = THREE.MathUtils.clamp(
          this.fov * Math.exp(e.deltaY * 0.0012),
          this.fovMin,
          this.fovMax
        );
      } else {
        this.radius = THREE.MathUtils.clamp(
          this.radius * Math.exp(e.deltaY * 0.0012),
          this.minRadius,
          this.maxRadius
        );
      }
      this.hasView = true;
      this._apply();
    };

    this.canvas.addEventListener('pointerdown', down);
    this.canvas.addEventListener('pointermove', move);
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
    this.canvas.addEventListener('lostpointercapture', up);
    this.canvas.addEventListener('wheel', wheel, { passive: false });
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (!this.enabled) {
      this.pointers.clear();
      this.pending = false;
      this.pinchStart = 0;
      this.lastCentroid = null;
      this._endDrag();
    }
  }

  _gesture() {
    const pts = [...this.pointers.values()];
    const count = pts.length;
    let cx = 0;
    let cy = 0;
    for (const p of pts) {
      cx += p.x;
      cy += p.y;
    }
    cx /= count;
    cy /= count;
    let spread = 0;
    for (const p of pts) {
      spread += Math.hypot(p.x - cx, p.y - cy);
    }
    return { cx, cy, spread: spread / count, count };
  }

  _beginDrag() {
    if (this.dragging) return;
    if (!this.hasView) this.syncFromCamera();
    this.dragging = true;
    this.onDraggingChange?.(true);
    this.onDragStart?.();
  }

  _endDrag() {
    if (!this.dragging) return;
    this.dragging = false;
    this.onDraggingChange?.(false);
    this.onDragEnd?.();
  }

  syncFromCamera() {
    const dx = this.camera.position.x - this.target.x;
    const dy = this.camera.position.y - this.target.y;
    const dz = this.camera.position.z - this.target.z;
    this.radius = THREE.MathUtils.clamp(Math.hypot(dx, dy, dz), this.minRadius, this.maxRadius);
    this.yaw = Math.atan2(dx, dz);
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
    if (this.freeLook && this.camera.fov !== this.fov) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
    const cp = Math.cos(this.pitch);
    this.camera.position.set(
      this.target.x + this.radius * Math.sin(this.yaw) * cp,
      this.target.y + this.radius * Math.sin(this.pitch),
      this.target.z + this.radius * Math.cos(this.yaw) * cp
    );
    if (this.groundAt) {
      const ground = this.groundAt(this.camera.position.x, this.camera.position.z);
      const floor = ground + this.clearance;
      if (this.camera.position.y < floor) this.camera.position.y = floor;
    }
    this.camera.lookAt(this.target);
    if (this.freeLook) {
      // Look around from the current standpoint instead of orbiting the
      // camera around the valley while the view is tilted. The position is
      // fixed by yaw/pitch above; this adds the view yaw and elevation.
      if (this.lookYaw) this.camera.rotateY(this.lookYaw);
      if (this.lookPitch) this.camera.rotateX(this.lookPitch);
    }
    this.camera.updateMatrixWorld();
  }
}
