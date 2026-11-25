import * as THREE from 'three';

/**
 * WindField
 *
 * The pointer is a small moving object in the meadow, not a global weather
 * system. Only air near the pointer's recent path is disturbed. We keep a
 * short trail of screen-space segments; each carries the air velocity that
 * existed when it was made. A point samples the strongest nearby segment,
 * which gives a local gust with a wake that fades over ~0.45 s.
 *
 * This single field is shared by:
 *   - the dandelion head (does it get hit? does it let go?)
 *   - every airborne seed (its own local air, with momentum)
 *   - the instanced grass (a ripple that follows the swipe)
 *   - floating pollen motes
 */

const MAX_AIR_SPEED = 6.2;
const TRAIL_AGE = 0.45;
const MAX_TRAIL = 24;

function smoothstep(edge0, edge1, x) {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function segmentDistance(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  let t = 0;
  if (lenSq > 1e-8) {
    t = THREE.MathUtils.clamp(((px - ax) * abx + (py - ay) * aby) / lenSq, 0, 1);
  }
  const dx = px - (ax + abx * t);
  const dy = py - (ay + aby * t);
  return Math.hypot(dx, dy);
}

export class WindField {
  constructor(camera) {
    this.camera = camera;
    this.enabled = true;

    this.strength = 0;      // 0..1 smoothed speed of the pointer
    this.energy = 0;        // 0..1 slower-decaying speed, drives grass wake
    this.airSpeed = 0;      // world units / second at the centre of the gust
    this.maxAirSpeed = MAX_AIR_SPEED;
    // Live-tunable interaction parameters (dev console + persisted settings).
    this.params = {
      maxAirSpeed: MAX_AIR_SPEED,
      radiusFactor: 0.34,
      speedFloor: 70,
      speedRange: 1400,
      grassRadiusFactor: 0.70,
      grassAnchorRate: 4.5,
      grassTipRate: 5.5,
      grassPowerScale: 0.95,
      grassAttack: 4.0,
      grassRelease: 1.2,
      grassCoherenceThreshold: 0.55,
      grassCoherenceCut: 0.85,
      grassCoherenceRecovery: 1.8,
      grassAngleRateLow: 0.50,
      grassAngleRateHigh: 2.00,
      grassAngleThreshold: 0.30,
      grassShaderGain: 1.05,
      grassBendScale: 1.0
    };
    this.dir = new THREE.Vector3(1, 0.02, 0.1).normalize();
    // Natural meadow breeze. It is deliberately much weaker than a hand
    // gust, but it is always present and has slow periodicity, a slowly
    // turning direction, and occasional random soft gusts.
    this.ambient = new THREE.Vector3(0.35, 0, 0.1);
    this.breezeDir = new THREE.Vector2(1, 0.28).normalize();
    this.breezePower = 0.18;
    this.breezeSpeed = 0.5;
    this._breeze = {
      baseAngle: Math.random() * Math.PI * 2,
      phaseA: Math.random() * Math.PI * 2,
      phaseB: Math.random() * Math.PI * 2,
      phaseC: Math.random() * Math.PI * 2,
      phaseD: Math.random() * Math.PI * 2,
      phaseE: Math.random() * Math.PI * 2,
      gustTimer: 5 + Math.random() * 10,
      gustAge: 999,
      gustDur: 0,
      gustPeak: 0
    };

    this.pointerNorm = new THREE.Vector2(0, 0);
    this.pointerPx = new THREE.Vector2(window.innerWidth / 2, window.innerHeight * 0.42);
    this.prevPx = this.pointerPx.clone();
    this.everMoved = false;

    this.radiusPx = 300;
    this.radiusNdc = 0.5;
    this.aspect = window.innerWidth / window.innerHeight;

    // NDC endpoints used by the grass shader
    this.grassA = new THREE.Vector2();
    this.grassB = new THREE.Vector2();
    this.grassDir = new THREE.Vector2(0.7, 0.3);
    this.grassDirSmooth = new THREE.Vector2(0.7, 0.3);
    // Keep the direction as an unwrapped angle so a 180° reversal rotates
    // slowly instead of the smoothed vector snapping through zero.
    this.grassAngleSmooth = Math.atan2(0.3, 0.7);
    // 1 when the hand sweeps coherently, near 0 when it keeps reversing.
    this.grassCoherence = 1;
    this.lastDirAngle = Math.atan2(0.1, 1);
    this.grassAnchor = new THREE.Vector2(this.pointerPx.x, this.pointerPx.y);
    this.grassTip = new THREE.Vector2(this.pointerPx.x, this.pointerPx.y);
    this.grassPower = 0;
    this.grassRadiusPx = 210;
    this.grassRadiusNdc = 0.5;
    this.grassStrength = 0;

    this.trail = [];

    this._accum = new THREE.Vector2();
    this._accumDt = 0;
    this._down = false;
    this._lastX = 0;
    this._lastY = 0;
    this._lastT = 0;
    this._hasLast = false;
    this._trailAnchorX = this.pointerPx.x;
    this._trailAnchorY = this.pointerPx.y;
    this._trailClock = 0;

    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._dirWorld = new THREE.Vector3();
    this._proj = new THREE.Vector3();
    this._sampleAir = new THREE.Vector3();
    this._forced = null;

    // A second, world-space source: the tumbleweed itself. It is kept
    // separate from the pointer trail so movement can coexist with a hand
    // gust (the strongest source at a sample wins).
    this._playerSource = null;
    this._playerScreen = new THREE.Vector2();
    this._playerAir = new THREE.Vector3();
    this.playerStrength = 0;

    this._bind();
  }

  _bind() {
    const move = (e) => {
      if (!this.enabled) return;
      if (e.target && e.target.closest && e.target.closest('[data-no-wind]')) return;
      const isTouch = e.pointerType === 'touch' || e.pointerType === 'pen';
      if (isTouch && !this._down) return;

      const x = e.clientX;
      const y = e.clientY;
      const now = performance.now();

      this.pointerPx.set(x, y);
      this.pointerNorm.set(
        (x / window.innerWidth) * 2 - 1,
        (y / window.innerHeight) * 2 - 1
      );

      if (!this._hasLast) {
        this._lastX = x;
        this._lastY = y;
        this._lastT = now;
        this._hasLast = true;
        this._resetTrail(x, y);
        return;
      }

      const dt = (now - this._lastT) / 1000;

      // Re-entry after a pause is not a teleporting gust.
      if (dt > 0.5 || dt < 0) {
        this._lastX = x;
        this._lastY = y;
        this._lastT = now;
        this._accum.set(0, 0);
        this._accumDt = 0;
        this._resetTrail(x, y);
        return;
      }

      let dx = x - this._lastX;
      let dy = y - this._lastY;

      const jump = Math.hypot(dx, dy);
      if (jump > 300) {
        dx = (dx / jump) * 300;
        dy = (dy / jump) * 300;
      }

      this._accum.x += dx;
      this._accum.y += dy;
      this._accumDt += Math.max(dt, 1 / 1000);
      this._lastX = x;
      this._lastY = y;
      this._lastT = now;

      if (Math.abs(dx) + Math.abs(dy) > 2) this.everMoved = true;
    };

    const down = (e) => {
      if (!this.enabled) return;
      if (e.target && e.target.closest && e.target.closest('[data-no-wind]')) return;
      this._down = true;
      this._hasLast = false;
      this._accum.set(0, 0);
      this._accumDt = 0;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
      this._lastT = performance.now();
      this.pointerPx.set(e.clientX, e.clientY);
      this._resetTrail(e.clientX, e.clientY);
    };

    const up = () => {
      this._down = false;
      this._hasLast = false;
    };

    const onResize = () => {
      this.aspect = window.innerWidth / window.innerHeight;
      this.radiusPx = THREE.MathUtils.clamp(Math.min(window.innerWidth, window.innerHeight) * 0.34, 165, 520);
      this.radiusNdc = this.radiusPx / (window.innerHeight * 0.5);
      this._resetTrail(this.pointerPx.x, this.pointerPx.y);
    };

    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerdown', down, { passive: true });
    window.addEventListener('pointerup', up, { passive: true });
    window.addEventListener('pointercancel', up, { passive: true });
    window.addEventListener('blur', up);
    window.addEventListener('resize', onResize);
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (!this.enabled) {
      this._down = false;
      this._hasLast = false;
      this.strength = 0;
      this.energy = 0;
      this.airSpeed = 0;
      this.grassStrength = 0;
      this.trail.length = 0;
    }
  }

  _resetTrail(x, y) {
    this.trail.length = 0;
    this._trailAnchorX = x;
    this._trailAnchorY = y;
    this._trailClock = 0;
    this.prevPx.set(x, y);
    this.grassAnchor.set(x, y);
    this.grassTip.set(x, y);
  }

  update(dt, t) {
    const W = window.innerWidth;
    const H = window.innerHeight;
    this.aspect = W / H;
    this.radiusPx = THREE.MathUtils.clamp(Math.min(W, H) * this.params.radiusFactor, 165, 520);
    this.radiusNdc = this.radiusPx / (H * 0.5);

    const forced = this._forced;
    let currX;
    let currY;
    let vx;
    let vy;

    if (forced) {
      currX = forced.x;
      currY = forced.y;
      vx = forced.vx;
      vy = forced.vy;
      this.pointerPx.set(currX, currY);
      this.pointerNorm.set((currX / W) * 2 - 1, (currY / H) * 2 - 1);
    } else {
      currX = this.pointerPx.x;
      currY = this.pointerPx.y;
      const eventDt = Math.max(this._accumDt, 1 / 240);
      vx = this._accum.x / eventDt;
      vy = this._accum.y / eventDt;
    }

    const prevX = this.prevPx.x;
    const prevY = this.prevPx.y;
    const moved = Math.hypot(currX - prevX, currY - prevY);

    const speed = Math.hypot(vx, vy);

    // screen movement -> world direction
    if (speed > 12) {
      this._right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
      this._up.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
      this._dirWorld
        .copy(this._right).multiplyScalar(vx)
        .addScaledVector(this._up, -vy);

      if (this._dirWorld.lengthSq() > 1e-6) {
        this._dirWorld.normalize();
        // A fast flick must be able to define the direction immediately;
        // a slow drag is smoothed so the field doesn't jitter.
        const k = speed > 500 ? 1 : 1 - Math.exp(-12 * dt);
        this.dir.lerp(this._dirWorld, k).normalize();
      }
    }

    // speed -> strength
    // Rapid shaking is not a coherent gust: if the hand keeps reversing,
    // drop the grass coherence so it stops chasing the pointer.
    const dirAngle = Math.atan2(this.dir.z, this.dir.x);
    let dirDelta = dirAngle - this.lastDirAngle;
    if (dirDelta > Math.PI) dirDelta -= Math.PI * 2;
    if (dirDelta < -Math.PI) dirDelta += Math.PI * 2;
    this.lastDirAngle = dirAngle;
    const reversal = Math.min(1, Math.abs(dirDelta) / 1.3);
    const targetCoherence = 1 - reversal * this.params.grassCoherenceCut;
    if (reversal > this.params.grassCoherenceThreshold) {
      // Only a real, fast reversal cuts the grass force; ordinary direction
      // changes must still produce a visible sweep.
      this.grassCoherence = Math.min(this.grassCoherence, targetCoherence);
    } else {
      this.grassCoherence +=
        (1 - this.grassCoherence) * (1 - Math.exp(-this.params.grassCoherenceRecovery * dt));
    }

    const raw = THREE.MathUtils.clamp(
      (speed - this.params.speedFloor) / this.params.speedRange,
      0,
      1
    );
    const attack = raw > this.strength ? 16 : 2.0;
    this.strength += (raw - this.strength) * (1 - Math.exp(-attack * dt));
    if (this.strength < 0.002) this.strength = 0;

    // A single fast pointer event can still be a real gust. The energy
    // keeps the instantaneous spike alive briefly for the local field.
    this.energy = Math.max(
      this.strength,
      raw * 0.96,
      this.energy * Math.exp(-1.9 * dt)
    );
    if (this.energy < 0.002) this.energy = 0;

    this.airSpeed = this.energy * this.params.maxAirSpeed;
    this.maxAirSpeed = this.params.maxAirSpeed;

    // ---- natural breeze ------------------------------------------------
    // Three slow periods (roughly 60 s / 26 s / 11 s) give the meadow a
    // breathing rhythm; random soft gust events break the regularity.
    const b = this._breeze;
    b.gustTimer -= dt;
    if (b.gustTimer <= 0) {
      b.gustAge = 0;
      b.gustDur = 2.8 + Math.random() * 4.2;
      b.gustPeak = 0.10 + Math.random() * 0.16;
      b.gustTimer = 8 + Math.random() * 15;
    }

    let gust = 0;
    if (b.gustAge < b.gustDur) {
      b.gustAge += dt;
      const u = THREE.MathUtils.clamp(b.gustAge / Math.max(0.01, b.gustDur), 0, 1);
      const env = Math.sin(Math.PI * u);
      gust = b.gustPeak * env * env;
    }

    const swell = 0.5 + 0.5 * Math.sin(t * 0.105 + b.phaseA);
    const breath = 0.5 + 0.5 * Math.sin(t * 0.237 + b.phaseB);
    const rustle = 0.5 + 0.5 * Math.sin(t * 0.552 + b.phaseC);
    const handCalm = 1 - 0.36 * this.energy;

    // Keep the breeze subordinate to a real hand gust, but never switch it
    // completely off: the grass should keep breathing after a swipe too.
    this.breezePower = THREE.MathUtils.clamp(
      (0.16 + 0.20 * swell + 0.10 * breath + 0.035 * rustle + gust) * handCalm,
      0,
      0.85
    );
    // Keep the real air velocity below the dandelion's natural-release
    // threshold, so a soft breeze sways and drifts things without stripping
    // the whole head. The grass has its own stronger visual amplitude.
    this.breezeSpeed = 0.12 + this.breezePower * 0.55;

    // The heading wanders on two slow, coprime periods so the meadow does
    // not look like it is pinned to one direction.
    const angle =
      b.baseAngle +
      0.52 * Math.sin(t * 0.041 + b.phaseD) +
      0.18 * Math.sin(t * 0.119 + b.phaseE);
    this.breezeDir.set(Math.cos(angle), Math.sin(angle));
    this.ambient.set(
      this.breezeDir.x * this.breezeSpeed,
      0.04 * Math.sin(t * 0.21 + b.phaseC) +
        0.02 * Math.sin(t * 0.43 + b.phaseB),
      this.breezeDir.y * this.breezeSpeed
    );

    // ---- age trail, then record the new path segment -------------------
    for (let i = this.trail.length - 1; i >= 0; i--) {
      this.trail[i].age += dt;
      if (this.trail[i].age > TRAIL_AGE) this.trail.splice(i, 1);
    }

    this._trailClock += dt;
    const shouldStamp =
      moved > 1.5 &&
      (this._trailClock > 0.022 || moved > 45);

    if (shouldStamp) {
      const ax = this._trailAnchorX;
      const ay = this._trailAnchorY;
      this.trail.push({
        ax, ay, bx: currX, by: currY,
        age: 0,
        airX: this.dir.x * this.airSpeed,
        airY: this.dir.y * this.airSpeed,
        airZ: this.dir.z * this.airSpeed
      });
      if (this.trail.length > MAX_TRAIL) this.trail.shift();
      this._trailAnchorX = currX;
      this._trailAnchorY = currY;
      this._trailClock = 0;
    }

    // ---- data for the grass shader -------------------------------------
    // The grass gets its own softer, lagging field: a small patch that
    // trails the hand instead of a whole-meadow sheet being dragged around.
    this.grassRadiusPx = THREE.MathUtils.clamp(
      this.radiusPx * this.params.grassRadiusFactor,
      120,
      330
    );
    this.grassRadiusNdc = this.grassRadiusPx / (H * 0.5);

    const anchorK = 1 - Math.exp(-this.params.grassAnchorRate * dt);
    this.grassAnchor.x += (currX - this.grassAnchor.x) * anchorK;
    this.grassAnchor.y += (currY - this.grassAnchor.y) * anchorK;

    // The front of the grass gust lags too; otherwise a fast back-and-forth
    // sweep makes the local patch snap left/right and the blades chatter.
    const tipK = 1 - Math.exp(-this.params.grassTipRate * dt);
    this.grassTip.x += (currX - this.grassTip.x) * tipK;
    this.grassTip.y += (currY - this.grassTip.y) * tipK;

    const grassTarget =
      Math.min(1, this.energy * this.params.grassPowerScale) * this.grassCoherence;
    const grassRate =
      grassTarget > this.grassPower ? this.params.grassAttack : this.params.grassRelease;
    this.grassPower += (grassTarget - this.grassPower) * (1 - Math.exp(-grassRate * dt));

    this.grassA.set(
      (this.grassAnchor.x / W) * 2 - 1,
      1 - (this.grassAnchor.y / H) * 2
    );
    this.grassB.set((this.grassTip.x / W) * 2 - 1, 1 - (this.grassTip.y / H) * 2);

    this.grassDir.set(this.dir.x, this.dir.z);
    if (this.grassDir.lengthSq() < 0.01) this.grassDir.set(0.35, 0.94);
    this.grassDir.normalize();
    // Heavy low-pass on direction: a fast reversal is absorbed instead of
    // turning the whole patch around in one frame.
    const targetAngle = Math.atan2(this.grassDir.y, this.grassDir.x);
    let angleDelta = targetAngle - this.grassAngleSmooth;
    if (angleDelta > Math.PI) angleDelta -= Math.PI * 2;
    if (angleDelta < -Math.PI) angleDelta += Math.PI * 2;
    const angleRate =
      this.grassCoherence < this.params.grassAngleThreshold
        ? this.params.grassAngleRateLow
        : this.params.grassAngleRateHigh;
    this.grassAngleSmooth += angleDelta * (1 - Math.exp(-angleRate * dt));
    this.grassDirSmooth.set(
      Math.cos(this.grassAngleSmooth),
      Math.sin(this.grassAngleSmooth)
    );

    this.grassStrength = this.grassPower;

    // The tumbleweed's local patch wins over the pointer patch while it is
    // moving: grass bends around the player, in the direction of travel.
    if (this._playerSource) {
      const ps = this._playerSource;
      this.grassRadiusPx = Math.max(this.grassRadiusPx, ps.radiusPx * 1.05);
      this.grassRadiusNdc = this.grassRadiusPx / (H * 0.5);

      this.grassAnchor.set(ps.x, ps.y);
      this.grassTip.set(ps.x, ps.y);
      this.grassA.set(
        (ps.x / W) * 2 - 1,
        1 - (ps.y / H) * 2
      );
      this.grassB.copy(this.grassA);

      if (ps.horizontalSpeed > 0.08) {
        const targetAngle = Math.atan2(ps.horizontal.y, ps.horizontal.x);
        let angleDelta = targetAngle - this.grassAngleSmooth;
        if (angleDelta > Math.PI) angleDelta -= Math.PI * 2;
        if (angleDelta < -Math.PI) angleDelta += Math.PI * 2;
        this.grassAngleSmooth += angleDelta * (1 - Math.exp(-5 * dt));
        this.grassDirSmooth.set(
          Math.cos(this.grassAngleSmooth),
          Math.sin(this.grassAngleSmooth)
        );
      }

      this.grassPower +=
        (ps.grassPower - this.grassPower) * (1 - Math.exp(-7 * dt));
      this.grassStrength = this.grassPower;
    }

    this.prevPx.set(currX, currY);
    this._accum.set(0, 0);
    this._accumDt = 0;
  }

  /**
   * Air velocity (world units / s) at a point on the screen. Includes the
   * current gust at the pointer and any still-warm segments along its trail.
   */
  sampleAtScreen(x, y, out) {
    let best = 0;
    out.set(0, 0, 0);

    // current position of the moving object
    const dCur = Math.hypot(x - this.pointerPx.x, y - this.pointerPx.y);
    const wCur = 1 - smoothstep(this.radiusPx * 0.12, this.radiusPx, dCur);
    const magCur = this.airSpeed * wCur;
    if (magCur > best) {
      best = magCur;
      out.copy(this.dir).multiplyScalar(magCur);
    }

    // The tumbleweed's own world-space wind.
    const ps = this._playerSource;
    if (ps && ps.strength > 0) {
      const dPlayer = Math.hypot(x - ps.x, y - ps.y);
      const wPlayer = 1 - smoothstep(ps.radiusPx * 0.12, ps.radiusPx, dPlayer);
      if (wPlayer > 0) {
        const magPlayer = ps.airSpeed * wPlayer;
        if (magPlayer > best) {
          best = magPlayer;
          out.copy(ps.air).multiplyScalar(wPlayer);
        }
      }
    }

    // wake left along the recent path
    for (let i = 0; i < this.trail.length; i++) {
      const seg = this.trail[i];
      const fade = 1 - seg.age / TRAIL_AGE;
      if (fade <= 0) continue;

      const d = segmentDistance(x, y, seg.ax, seg.ay, seg.bx, seg.by);
      const spatial = 1 - smoothstep(this.radiusPx * 0.12, this.radiusPx, d);
      if (spatial <= 0) continue;

      const w = spatial * fade;
      const mag = Math.hypot(seg.airX, seg.airY, seg.airZ) * w;
      if (mag > best) {
        best = mag;
        out.set(seg.airX * w, seg.airY * w, seg.airZ * w);
      }
    }

    out.add(this.ambient);
    // Include the breeze in the returned magnitude, so slow-moving things
    // such as the dandelion head can feel it without a pointer gesture.
    const total = Math.hypot(out.x, out.y, out.z);
    return Math.max(best, total);
  }

  projectToScreen(pos, out) {
    this._proj.copy(pos).project(this.camera);
    out.set(
      (this._proj.x * 0.5 + 0.5) * window.innerWidth,
      (-this._proj.y * 0.5 + 0.5) * window.innerHeight
    );
    return this._proj.z > -1 && this._proj.z < 1;
  }

  airAtWorld(pos, out) {
    this._proj.copy(pos).project(this.camera);
    if (this._proj.z < -1 || this._proj.z > 1) {
      out.copy(this.ambient);
      return 0;
    }

    const x = (this._proj.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-this._proj.y * 0.5 + 0.5) * window.innerHeight;
    return this.sampleAtScreen(x, y, out);
  }

  /** Screen point used by the dandelion's own wind checks. */
  sampleAtHead(pos, out) {
    return this.airAtWorld(pos, out);
  }

  /**
   * Local gust factor (0..1) used for head detaching and tremble.
   */
  localFactorAtWorld(pos, out) {
    const mag = this.airAtWorld(pos, out);
    return THREE.MathUtils.clamp(mag / MAX_AIR_SPEED, 0, 1);
  }

  /** Stop the current pointer gesture (used when grabbing the sun/moon). */
  cancelGesture() {
    this._down = false;
    this._hasLast = false;
    this._accum.set(0, 0);
    this._accumDt = 0;
  }

  /**
   * Feed the tumbleweed's world-space motion into the field. The source is
   * local to the player's projected screen position, so the existing grass
   * shader, dandelions, seeds, pollen and fireflies all respond without
   * needing a separate particle system.
   */
  setPlayerSource(position, velocity, camera = null) {
    if (camera) this.camera = camera;
    const speed = velocity.length();
    if (speed < 0.12 || !this.camera) {
      this.clearPlayerSource();
      return false;
    }

    if (!this.projectToScreen(position, this._playerScreen)) {
      this.clearPlayerSource();
      return false;
    }

    const W = window.innerWidth;
    const H = window.innerHeight;
    const strength = THREE.MathUtils.clamp(speed / MAX_AIR_SPEED, 0, 1);
    const airSpeed = Math.min(MAX_AIR_SPEED, speed * 1.1);
    this._playerAir.copy(velocity).normalize().multiplyScalar(airSpeed);

    const horizontalSpeed = Math.hypot(velocity.x, velocity.z);
    const hx = horizontalSpeed > 1e-4 ? velocity.x / horizontalSpeed : 0;
    const hz = horizontalSpeed > 1e-4 ? velocity.z / horizontalSpeed : 0;

    this._playerSource = {
      x: this._playerScreen.x,
      y: this._playerScreen.y,
      radiusPx: THREE.MathUtils.clamp(Math.min(W, H) * 0.34 * 1.1, 190, 560),
      air: this._playerAir,
      airSpeed,
      strength,
      horizontal: new THREE.Vector2(hx, hz),
      horizontalSpeed,
      grassPower: THREE.MathUtils.clamp(
        strength * (0.55 + 0.45 * Math.min(1, horizontalSpeed / MAX_AIR_SPEED)),
        0,
        1
      )
    };
    this.playerStrength = strength;
    return true;
  }

  clearPlayerSource() {
    this._playerSource = null;
    this.playerStrength = 0;
  }

  /**
   * Synthetic control used by the optional auto demo and the still-frame
   * test harness. x/y is the screen position of the moving source.
   */
  force(vx, vy, x, y) {
    if ((!vx && !vy) || x === undefined || y === undefined) {
      this._forced = null;
      return;
    }

    if (!this._forced) {
      this._resetTrail(x, y);
      this.pointerPx.set(x, y);
    }
    this._forced = { vx, vy, x, y };
  }
}