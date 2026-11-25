import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/*  Tumbleweed · third-person protagonist                              */
/*                                                                     */
/*  A procedurally tangled ball of dry twigs that rolls across the     */
/*  valley. Desktop only: WASD moves it relative to the camera yaw.    */
/*  The orbit rig still owns the camera; this module only supplies a   */
/*  focus point for it to follow, so look / zoom / planting gestures   */
/*  stay exactly as they were before.                                  */
/* ------------------------------------------------------------------ */

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD']);

const BALL_RADIUS = 0.64;     // ground-contact radius used by the roll
const CENTER_HEIGHT = 0.64;   // root sits this far above the terrain
const FOCUS_LIFT = 0.45;      // camera looks slightly above the centre
const MAX_SPEED = 6.2;        // m/s
const ACCEL = 9.0;
const BRAKE = 5.5;
const MAX_RADIUS = 118;       // keep inside the meadow / lower foothills
const MAX_HEIGHT = 30;
const MAX_SLOPE = 0.44;

// M1 lift: a gentle, stamina-free updraft. Values are deliberately soft so
// the camera can follow without sudden vertical jumps.
const MAX_ALTITUDE = 25;
const LIFT_CHARGE = 0.4;
const LIFT_ACCEL = 7;
const MAX_RISE = 3.6;
const GRAVITY = 3.8;
const MAX_FALL = 7;

const TWIG_COUNT = 150;
const TWIG_COLORS = ['#8a6b40', '#9c7c4c', '#75552f', '#a98a5c', '#6b4d2c'];

function makeTwigGeometry() {
  const half = 0.38;
  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-half, 0.05, 0),
    new THREE.Vector3(0, 0.19, 0.02),
    new THREE.Vector3(half, 0, -0.03)
  );
  return new THREE.TubeGeometry(curve, 8, 0.016, 4, false);
}

function makeShadowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(44, 35, 20, 0.58)');
  grad.addColorStop(0.55, 'rgba(44, 35, 20, 0.30)');
  grad.addColorStop(1, 'rgba(44, 35, 20, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class Tumbleweed {
  constructor({ scene, world, position = new THREE.Vector3(0, 0, 1.2) }) {
    this.world = world;
    this.keys = new Set();
    this.externalMove = new THREE.Vector2();
    this.velocity = new THREE.Vector3();
    this.speed = 0;
    this.baseY = 0;
    this.started = false;
    this.liftEnabled = false;
    this.liftHeld = false;
    this.liftCharge = 0;
    this.verticalVelocity = 0;
    this.airborne = false;
    this._rollAxis = new THREE.Vector3();
    this._shadowNormal = new THREE.Vector3();

    this.root = new THREE.Group();
    this.spin = new THREE.Group();
    this.root.add(this.spin);
    scene.add(this.root);

    this._buildBody();
    this._buildShadow(scene);
    this._buildGust(scene);
    this._bindKeys();

    this.snapTo(position.x, position.z);
  }

  _buildBody() {
    const geometry = makeTwigGeometry();
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.94,
      metalness: 0,
      flatShading: false
    });

    const mesh = new THREE.InstancedMesh(geometry, material, TWIG_COUNT);
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    mesh.frustumCulled = false;

    const dummy = new THREE.Object3D();
    const dir = new THREE.Vector3();
    const color = new THREE.Color();

    for (let i = 0; i < TWIG_COUNT; i++) {
      // Spread the twigs through a thick shell rather than a solid ball,
      // so the silhouette stays open and the valley shows through it.
      const u = Math.random() * 2 - 1;
      const phi = Math.random() * TAU;
      const s = Math.sqrt(1 - u * u);
      dir.set(s * Math.cos(phi), u, s * Math.sin(phi));
      const shell = 0.14 + Math.random() * 0.34;
      dummy.position.copy(dir).multiplyScalar(shell);
      dummy.rotation.set(Math.random() * TAU, Math.random() * TAU, Math.random() * TAU);
      const scale = 0.62 + Math.random() * 0.62;
      dummy.scale.set(scale * (0.9 + Math.random() * 0.25), scale, scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      color.set(TWIG_COLORS[i % TWIG_COLORS.length]);
      color.offsetHSL(0, 0, (Math.random() - 0.5) * 0.08);
      mesh.setColorAt(i, color);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.spin.add(mesh);
    this.body = mesh;
  }

  _buildShadow(scene) {
    const geometry = new THREE.PlaneGeometry(2.1, 2.1);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      map: makeShadowTexture(),
      transparent: true,
      depthWrite: false,
      opacity: 0.52,
      toneMapped: false
    });
    material.polygonOffset = true;
    material.polygonOffsetFactor = -2;
    material.polygonOffsetUnits = -2;

    this.shadow = new THREE.Mesh(geometry, material);
    this.shadow.renderOrder = 2;
    scene.add(this.shadow);
  }

  _buildGust(scene) {
    const geometry = new THREE.RingGeometry(0.35, 0.5, 48);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      color: '#d9c7a2',
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.visible = false;
    mesh.renderOrder = 2;
    scene.add(mesh);
    this.gust = { mesh, age: 0, life: 0.9, active: false };
  }

  _spawnGust() {
    if (!this.gust) return;
    const x = this.root.position.x;
    const z = this.root.position.z;
    const ground = this._groundAt(x, z);
    const g = this.gust;
    g.mesh.position.set(x, ground + 0.035, z);
    g.mesh.scale.setScalar(0.65);
    g.mesh.material.opacity = 0.55;
    g.mesh.visible = true;
    g.age = 0;
    g.active = true;
  }

  _updateGust(dt) {
    const g = this.gust;
    if (!g || !g.active) return;
    g.age += dt;
    const t = Math.min(1, g.age / g.life);
    g.mesh.scale.setScalar(0.65 + t * 2.4);
    g.mesh.material.opacity = 0.55 * (1 - t);
    if (t >= 1) {
      g.active = false;
      g.mesh.visible = false;
    }
  }

  _bindKeys() {
    const isTyping = (target) => {
      if (!target) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
    };

    this._onKeyDown = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target)) return;
      if (!MOVE_KEYS.has(e.code)) return;
      e.preventDefault();
      this.keys.add(e.code);
    };

    this._onKeyUp = (e) => {
      if (!MOVE_KEYS.has(e.code)) return;
      this.keys.delete(e.code);
    };

    this._clearKeys = () => this.keys.clear();

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._clearKeys);
    document.addEventListener('visibilitychange', this._clearKeys);
  }

  _groundAt(x, z) {
    if(this.world.levels) return this.world.levels.floor(x,z,this.root.position.y-CENTER_HEIGHT);
    return this.world.heightAt ? this.world.heightAt(x, z) : 0;
  }

  _walkable(x, z) {
    if (Math.hypot(x, z) > MAX_RADIUS) return false;
    if (this.world.levels?.blocked(x,z,this.root.position.y)) return false;
    const height = this.world.heightAt(x,z);
    if (height > MAX_HEIGHT) return false;
    if (!this.airborne && this.world.slopeAt && this.world.slopeAt(x, z) > MAX_SLOPE) {
      return false;
    }
    return true;
  }

  /** Place the tumbleweed on the terrain without any smoothing. */
  snapTo(x, z) {
    this.baseY = this._groundAt(x, z) + CENTER_HEIGHT;
    this.root.position.set(x, this.baseY, z);
    this.velocity.set(0, 0, 0);
    this.speed = 0;
    this.verticalVelocity = 0;
    this.airborne = false;
    this.liftCharge = 0;
    this.started = true;
    this._updateShadow();
  }

  setLiftEnabled(on) {
    this.liftEnabled = !!on;
    if (!this.liftEnabled) {
      this.liftHeld = false;
      this.liftCharge = 0;
    }
  }

  setLiftHeld(on) {
    this.liftHeld = !!on && this.liftEnabled;
    if (!this.liftHeld) this.liftCharge = 0;
  }

  get altitude() {
    const ground = this._groundAt(this.root.position.x, this.root.position.z);
    return Math.max(0, this.root.position.y - (ground + CENTER_HEIGHT));
  }

  /** Point the third-person camera should orbit. */
  focusPoint(out = new THREE.Vector3()) {
    return out.set(
      this.root.position.x,
      this.root.position.y + FOCUS_LIFT,
      this.root.position.z
    );
  }

  setMoveInput(x, z) {
    this.externalMove.set(x, z);
    const len = this.externalMove.length();
    if (len > 1) this.externalMove.divideScalar(len);
  }

  _move(dt, cameraYaw) {
    let forward = this.externalMove.y;
    let strafe = this.externalMove.x;
    if (this.keys.has('KeyW')) forward += 1;
    if (this.keys.has('KeyS')) forward -= 1;
    if (this.keys.has('KeyD')) strafe += 1;
    if (this.keys.has('KeyA')) strafe -= 1;

    // Camera-relative basis, flattened onto the ground plane.
    const fx = -Math.sin(cameraYaw);
    const fz = -Math.cos(cameraYaw);
    const rx = Math.cos(cameraYaw);
    const rz = -Math.sin(cameraYaw);

    let dx = fx * forward + rx * strafe;
    let dz = fz * forward + rz * strafe;
    const inputLen = Math.hypot(dx, dz);
    const moving = inputLen > 1e-4;
    if (moving) {
      dx /= inputLen;
      dz /= inputLen;
    }

    const control = this.airborne ? 0.72 : 1;
    const targetSpeed = MAX_SPEED * control;
    const response = moving
      ? ACCEL * (this.airborne ? 0.58 : 1)
      : BRAKE * (this.airborne ? 0.48 : 1);
    const k = 1 - Math.exp(-response * dt);
    this.velocity.x += (dx * targetSpeed - this.velocity.x) * k;
    this.velocity.z += (dz * targetSpeed - this.velocity.z) * k;
    if (!moving && Math.hypot(this.velocity.x, this.velocity.z) < 0.02) {
      this.velocity.x = 0;
      this.velocity.z = 0;
    }

    const x = this.root.position.x;
    const z = this.root.position.z;
    let nx = x + this.velocity.x * dt;
    let nz = z + this.velocity.z * dt;

    // Try to slide along the boundary instead of stopping dead when the
    // tumbleweed reaches a steep face or the edge of the meadow.
    if (!this._walkable(nx, nz)) {
      if (this._walkable(nx, z)) {
        nz = z;
        this.velocity.z = 0;
      } else if (this._walkable(x, nz)) {
        nx = x;
        this.velocity.x = 0;
      } else {
        nx = x;
        nz = z;
        this.velocity.x = 0;
        this.velocity.z = 0;
      }
    }

    const stepX = nx - x;
    const stepZ = nz - z;
    const distance = Math.hypot(stepX, stepZ);
    this.root.position.x = nx;
    this.root.position.z = nz;

    if (distance > 1e-5) {
      // Roll around the axis perpendicular to travel; the sign follows
      // the right-hand rule so the top of the ball moves forward.
      const ax = this.velocity.z;
      const az = -this.velocity.x;
      this._rollAxis.set(ax, 0, az).normalize();
      this.spin.rotateOnWorldAxis(this._rollAxis, distance / BALL_RADIUS);
    }

    this.speed = Math.hypot(this.velocity.x, this.velocity.z);
  }

  _updateShadow() {
    if (!this.shadow) return;
    const x = this.root.position.x;
    const z = this.root.position.z;
    const e = 0.7;
    const ground = this._groundAt(x, z);
    const hx = (this._groundAt(x + e, z) - this._groundAt(x - e, z)) / (2 * e);
    const hz = (this._groundAt(x, z + e) - this._groundAt(x, z - e)) / (2 * e);
    const normal = this._shadowNormal.set(-hx, 1, -hz).normalize();

    this.shadow.position.set(x, ground + 0.02, z).addScaledVector(normal, 0.01);
    this.shadow.quaternion.setFromUnitVectors(UP, normal);

    const altitude = Math.max(0, this.root.position.y - (ground + CENTER_HEIGHT));
    const fade = THREE.MathUtils.clamp(1 - altitude / (MAX_ALTITUDE * 1.5), 0.08, 1);
    this.shadow.material.opacity = 0.52 * fade;
    this.shadow.scale.setScalar(1 + altitude * 0.012);
  }

  update(dt, elapsed, cameraYaw = 0) {
    this._move(dt, cameraYaw);

    const ground = this._groundAt(this.root.position.x, this.root.position.z);
    const targetY = ground + CENTER_HEIGHT;

    if (this.liftEnabled && this.liftHeld && !this.airborne) {
      this.liftCharge += dt;
      if (this.liftCharge >= LIFT_CHARGE) {
        this.airborne = true;
        this.verticalVelocity = 2.2;
        this._spawnGust();
      }
    } else if (!this.liftHeld) {
      this.liftCharge = 0;
    }

    if (!this.airborne && this.root.position.y-targetY>1) {
      this.airborne=true;
      this.verticalVelocity=0;
    }
    if (this.airborne) {
      if (this.liftEnabled && this.liftHeld) {
        this.verticalVelocity = Math.min(
          MAX_RISE,
          this.verticalVelocity + LIFT_ACCEL * dt
        );
      } else {
        this.verticalVelocity = Math.max(
          -MAX_FALL,
          this.verticalVelocity - GRAVITY * dt
        );
      }

      const altitude = this.root.position.y - targetY;
      if (altitude >= MAX_ALTITUDE && this.verticalVelocity > 0) {
        this.verticalVelocity = 0;
      }

      const ceiling=this.world.levels?.ceiling(this.root.position.x,this.root.position.z,this.root.position.y) ?? Infinity;
      this.root.position.y += this.verticalVelocity * dt;
      if(this.root.position.y>ceiling){this.root.position.y=ceiling;this.verticalVelocity=0;}

      // A gentle spin while airborne keeps the tumbleweed alive without
      // turning the lift into a jetpack.
      const airSpin =
        1.3 +
        Math.min(
          2.4,
          Math.abs(this.verticalVelocity) * 0.35 + this.speed * 0.18
        );
      this.spin.rotateOnWorldAxis(UP, airSpin * dt);

      if (this.root.position.y <= targetY) {
        this.root.position.y = targetY;
        this.baseY = targetY;
        this.verticalVelocity = 0;
        this.airborne = false;
        this.liftCharge = 0;
        this._spawnGust();
      }
      this.started = true;
    } else {
      const yK = this.started ? 1 - Math.exp(-14 * dt) : 1;
      this.baseY += (targetY - this.baseY) * yK;
      this.started = true;

      // A small bounce makes the ball read as light dry brush rather than
      // a rigid sphere, and fades out as soon as it stops.
      const bob = Math.sin(elapsed * 9) * 0.025 * Math.min(1, this.speed / MAX_SPEED);
      this.root.position.y = this.baseY + bob;
    }

    this._updateShadow();
    this._updateGust(dt);
  }

  get verticalSpeed() {
    return this.verticalVelocity;
  }

  get liftChargeProgress() {
    if (!this.liftEnabled || this.airborne || !this.liftHeld) return 0;
    return Math.min(1, this.liftCharge / LIFT_CHARGE);
  }
}