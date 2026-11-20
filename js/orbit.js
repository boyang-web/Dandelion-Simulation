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
    this.lastCentroid = { x: 0, y: 0 };
    this.onDragStart = null;
    this.onDragEnd = null;

    this._bind();
  }

  _bind() {
    const down = (e) => {
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
      } else if (this.pointers.size === 2) {
        this.pending = false;
        this._beginDrag();
        const pts = [...this.pointers.values()];
        this.pinchStart = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        this.pinchRadius = this.radius;
        this.lastCentroid = {
          x: (pts[0].x + pts[1].x) * 0.5,
          y: (pts[0].y + pts[1].y) * 0.5
        };
        e.preventDefault();
      }
    };

    const move = (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
        type: e.pointerType
      });

      if (this.pointers.size >= 2) {
        e.preventDefault();
        const pts = [...this.pointers.values()];
        const centroid = {
          x: (pts[0].x + pts[1].x) * 0.5,
          y: (pts[0].y + pts[1].y) * 0.5
        };
        if (!this.pinchStart) {
          this._beginDrag();
          this.pinchStart = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
          this.pinchRadius = this.radius;
          this.lastCentroid = centroid;
        }

        const dx = centroid.x - this.lastCentroid.x;
        const dy = centroid.y - this.lastCentroid.y;
        this.lastCentroid = centroid;
        if (dx || dy) {
          this.yaw = THREE.MathUtils.clamp(this.yaw - dx * 0.0032, -this.maxYaw, this.maxYaw);
          this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0030, this.minPitch, this.maxPitch);
          this.hasView = true;
        }

        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (this.pinchStart > 1 && dist > 1) {
          this.radius = THREE.MathUtils.clamp(
            this.pinchRadius * (this.pinchStart / dist),
            this.minRadius,
            this.maxRadius
          );
          this.hasView = true;
        }
        this._apply();
        return;
      }

      // One touch is wind, not camera. The wind field owns that gesture.
      if (e.pointerType === 'touch') return;

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
      this.yaw = THREE.MathUtils.clamp(this.yaw - dx * 0.0032, -this.maxYaw, this.maxYaw);
      this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0030, this.minPitch, this.maxPitch);
      this.hasView = true;
      this._apply();
    };

    const up = (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      try { this.canvas.releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }

      if (this.dragging && this.pointers.size < 2) this._endDrag();
      if (this.pointers.size === 0) {
        this.pending = false;
        this.pinchStart = 0;
      } else {
        this.pinchStart = 0;
      }
    };

    const wheel = (e) => {
      if (e.target !== this.canvas) return;
      e.preventDefault();
      if (!this.hasView) this.syncFromCamera();
      this.radius = THREE.MathUtils.clamp(
        this.radius * Math.exp(e.deltaY * 0.0012),
        this.minRadius,
        this.maxRadius
      );
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

  _beginDrag() {
    if (this.dragging) return;
    if (!this.hasView) this.syncFromCamera();
    this.dragging = true;
    document.body.classList.add('orbit-dragging');
    this.onDragStart?.();
  }

  _endDrag() {
    if (!this.dragging) return;
    this.dragging = false;
    document.body.classList.remove('orbit-dragging');
    this.onDragEnd?.();
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
