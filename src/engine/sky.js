import * as THREE from 'three';
import { dandelionAtmosphere } from './dandelion.js';

/* ------------------------------------------------------------------ */
/* Sky & time of day                                                   */
/*                                                                     */
/* The sun and the moon share one elliptical arc across the sky. They  */
/* sit on opposite sides of it: when the sun reaches the western        */
/* horizon the moon rises in the east. There is no vertical scrubbing;  */
/* a long press on either body lets the pointer travel along that arc.  */
/* ------------------------------------------------------------------ */

const TAU = Math.PI * 2;
const SKY_RADIUS = 1000;
const SUN_MAX_ALT = 0.5236; // 30° — the tilted celestial arc

const clamp01 = (v) => Math.max(0, Math.min(1, v));

function smooth01(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function mixRgb(a, b, k) {
  k = clamp01(k);
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k)
  ];
}

function rgbCss(rgb, alpha = 1) {
  return alpha >= 1
    ? `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`
    : `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

const PALETTE = {
  keyNight: new THREE.Color('#a6c2ef'),
  keyGolden: new THREE.Color('#ffb06a'),
  keyEmber: new THREE.Color('#ff8a4d'),
  keyDay: new THREE.Color('#ffddb0'),
  skyNight: new THREE.Color('#263a58'),
  skyGolden: new THREE.Color('#ffd7b0'),
  skyDay: new THREE.Color('#fff6e5'),
  groundNight: new THREE.Color('#131c22'),
  groundGolden: new THREE.Color('#61573f'),
  groundDay: new THREE.Color('#5a6742'),
  fillNight: new THREE.Color('#7f9fc9'),
  fillGolden: new THREE.Color('#e9d6c0'),
  fillDay: new THREE.Color('#cfe4e8'),
  rimNight: new THREE.Color('#9ab2d8'),
  rimGolden: new THREE.Color('#ffd4a2'),
  rimDay: new THREE.Color('#ffe4bd'),
  fluffNight: new THREE.Color('#cfdef4'),
  fluffGolden: new THREE.Color('#ffe3bd'),
  fluffDay: new THREE.Color('#fffdf7'),
  coreNight: new THREE.Color('#bdcde9'),
  coreGolden: new THREE.Color('#ffe0b5'),
  coreDay: new THREE.Color('#fff9ed'),
  moteNight: new THREE.Color('#ffe5ae'),
  moteGolden: new THREE.Color('#ffcf98'),
  moteDay: new THREE.Color('#fff2c8'),
  hazeNight: new THREE.Color('#1e2c42'),
  hazeGolden: new THREE.Color('#f1cf9f'),
  hazeDay: new THREE.Color('#e7dfc3')
};

const INK_DAY = [65, 75, 54];
const INK_NIGHT = [242, 237, 222];
const HALO_NIGHT = [146, 175, 228];
const HALO_GOLDEN = [255, 190, 118];
const HALO_DAY = [255, 228, 170];

const scratch = {
  key: new THREE.Color(),
  sky: new THREE.Color(),
  ground: new THREE.Color(),
  fill: new THREE.Color(),
  rim: new THREE.Color(),
  fluff: new THREE.Color(),
  core: new THREE.Color(),
  mote: new THREE.Color(),
  haze: new THREE.Color(),
  sunDir: new THREE.Vector3()
};

export class Sky {
  constructor({ wind, world, keyLight, hemi, fill, rim, initial = 0.4, camera = null, celestial3D = false, coarse = false }) {
    this.wind = wind;
    this.world = world;
    this.keyLight = keyLight;
    this.hemi = hemi;
    this.fill = fill;
    this.rim = rim;
    this.camera = camera || null;
    this.celestial3D = !!celestial3D;
    this.coarse = !!coarse;
    this.sunDir = new THREE.Vector3(0, Math.sin(SUN_MAX_ALT), -Math.cos(SUN_MAX_ALT));
    this.moonDir = new THREE.Vector3(0, -Math.sin(SUN_MAX_ALT), Math.cos(SUN_MAX_ALT));
    this.sunProj = { x: 0, y: 0, ndcX: 0, ndcY: 0, inFront: false, onScreen: false, visible: false };
    this.moonProj = { x: 0, y: 0, ndcX: 0, ndcY: 0, inFront: false, onScreen: false, visible: false };
    this._sunVisible = false;
    this._moonVisible = false;
    this._sunBaseDisc = 0;
    this._sunBaseHalo = 0;
    this._moonBaseDisc = 0;
    this._moonBaseHalo = 0;
    this._baseGlow = 0;
    this._baseGolden = 0;
    this._baseRays = 0;
    this._arcTick = 0;
    this._bodyScratch = new THREE.Vector3();
    this._viewScratch = new THREE.Vector3();
    this._pathScratch = new THREE.Vector3();
    // No DOM handles here: the class emits a plain paint snapshot and the
    // Vue layer renders it (see src/app/lib/sky-painter.js). This keeps the
    // simulation testable and the markup declarative.
    this.onPaint = null;
    this.paint = {
      bodies: {
        sun: {
          x: 0, y: 0, disc: 0, halo: 0, hidden: true, below: true,
          golden: false, active: false, pressing: false, tipped: false
        },
        moon: {
          x: 0, y: 0, disc: 0, halo: 0, hidden: true, below: true,
          golden: false, active: false, pressing: false, tipped: false
        }
      },
      arc: { above: '', below: '', visible: false },
      night: 0,
      golden: 0,
      stars: 0,
      glow: { x: 0, y: 0, opacity: 0 },
      rays: { x: 0, y: 0, opacity: 0, rgb: '255, 236, 205' },
      clouds: { hi: '#fffdf6', lo: '#c3cccc', warm: 'rgba(255, 180, 120, 0)' },
      ink: { ink: 'rgb(65, 75, 54)', soft: '', faint: '', line: '' },
      theme: '#e0e0c6',
      time: { pct: 0, label: '' },
      sky3d: !!celestial3D,
      viewWidth: window.innerWidth,
      viewHeight: window.innerHeight
    };
    this.tipBody = null;
    this._tipTimers = [];

    this.time = clamp01(initial);
    // One full day (sun + moon) takes two minutes. The DOM and every shader
    // are updated in small steps so the arc glides instead of ticking.
    this.timeCycle = 240;
    this.flowAccum = 0;
    this.flowPause = 0;
    this.flowEnabled = true;
    this.interactive = true; // gated by the 'time' ability in the journey mode
    this.params = { holdDelay: 100 };
    this.lightState = {
      x: 0.8,
      y: 0.35,
      color: new THREE.Color('#ffddb0'),
      strength: 1,
      day: 1,
      golden: 0,
      night: 0
    };
    this.active = false;
    this.pressing = false;
    this.interactedWithSky = false;
    this.pressType = null;
    this.pressBody = null;
    this.pressPointerId = null;
    this.pressTimer = 0;
    this.pressStartAngle = 0;
    this.pressPointerAngle = 0;
    this.pressStartX = 0;
    this.pressStartY = 0;
    this.visibleBody = 'sun';

    this._layout();
    this.set(this.time);
    this._firstHint();
  }

  /** Push the latest paint snapshot to whoever is rendering the sky. */
  emit() {
    if (typeof this.onPaint === 'function') this.onPaint(this.paint);
  }

  /* ---------------- geometry --------------------------------------- */

  _layout() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    // A phone held sideways is very short: keep the noon body inside the top
    // edge instead of letting it slide under the notch, and flatten the arc
    // so sunrise/sunset still sit on the horizon.
    const phoneLandscape = this.coarse && H <= 560 && W / H >= 1.2;
    this.cx = W * 0.5;
    this.cy = H * (phoneLandscape ? 0.56 : 0.53);
    this.rx = W * (phoneLandscape ? 0.36 : 0.4);
    this.ry = H * (phoneLandscape ? 0.30 : 0.375);
    this.paint.viewWidth = W;
    this.paint.viewHeight = H;

    if (this.celestial3D) {
      // The projected 3D celestial circle is written by _updateArc3D().
      this.paint.arc.above = '';
      this.paint.arc.below = '';
    } else {
      this.paint.arc.above =
        `M ${(this.cx - this.rx).toFixed(2)} ${this.cy.toFixed(2)} ` +
        `A ${this.rx.toFixed(2)} ${this.ry.toFixed(2)} 0 0 1 ` +
        `${(this.cx + this.rx).toFixed(2)} ${this.cy.toFixed(2)}`;
      this.paint.arc.below =
        `M ${(this.cx - this.rx).toFixed(2)} ${this.cy.toFixed(2)} ` +
        `A ${this.rx.toFixed(2)} ${this.ry.toFixed(2)} 0 0 0 ` +
        `${(this.cx + this.rx).toFixed(2)} ${this.cy.toFixed(2)}`;
    }
  }

  resize() {
    this._layout();
    this.set(this.time);
  }

  /* ---------------- 3D celestial model --------------------------- */

  _direction(t, out) {
    // A real tilted great circle: sunrise on the east horizon, noon high
    // in the south, sunset on the west horizon. The moon is the opposite
    // point, half a day away.
    const a = (t - 0.25) * TAU;
    const c = Math.cos(a);
    return out.set(
      -Math.sin(a),
      c * Math.sin(SUN_MAX_ALT),
      -c * Math.cos(SUN_MAX_ALT)
    ).normalize();
  }

  _project(dir, state) {
    if (!this.camera) {
      state.visible = false;
      state.onScreen = false;
      state.inFront = false;
      return state;
    }
    const cam = this.camera;
    cam.updateMatrixWorld();
    const W = window.innerWidth;
    const H = window.innerHeight;
    const world = this._bodyScratch.copy(dir).multiplyScalar(SKY_RADIUS).add(cam.position);
    const view = this._viewScratch.copy(world).applyMatrix4(cam.matrixWorldInverse);
    const inFront = view.z < -0.1;
    const ndc = world.project(cam);
    state.x = (ndc.x * 0.5 + 0.5) * W;
    state.y = (0.5 - ndc.y * 0.5) * H;
    state.ndcX = ndc.x;
    state.ndcY = ndc.y;
    state.inFront = inFront;
    state.onScreen = Math.abs(ndc.x) <= 1.12 && Math.abs(ndc.y) <= 1.12;
    state.visible = inFront && state.onScreen;
    return state;
  }

  _isOccluded(dir) {
    const world = this.world;
    const cam = this.camera;
    if (!world || typeof world.heightAt !== 'function' || !cam) return false;
    const maxR = world.terrain?.radius ?? 345;
    const maxR2 = maxR * maxR;
    // March the heightfield instead of raycasting all 74k triangles.
    for (let t = 4; t < SKY_RADIUS; t += 9) {
      const x = cam.position.x + dir.x * t;
      const y = cam.position.y + dir.y * t;
      const z = cam.position.z + dir.z * t;
      if (x * x + z * z > maxR2) break;
      if (y < world.heightAt(x, z) + 0.15) return true;
    }
    return false;
  }

  _updateArc3D() {
    if (!this.celestial3D || !this.camera) return;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const cam = this.camera;
    cam.updateMatrixWorld();

    const projectPoint = (dir) => {
      const world = this._pathScratch.copy(dir).multiplyScalar(SKY_RADIUS).add(cam.position);
      const view = world.clone().applyMatrix4(cam.matrixWorldInverse);
      if (view.z > -0.1) return null;
      const ndc = world.project(cam);
      if (Math.abs(ndc.x) > 1.08 || Math.abs(ndc.y) > 1.08) return null;
      return [
        (ndc.x * 0.5 + 0.5) * W,
        (0.5 - ndc.y * 0.5) * H
      ];
    };

    const build = (above) => {
      let d = '';
      let drawing = false;
      for (let i = 0; i <= 180; i++) {
        const dir = this._direction(i / 180, this._bodyScratch);
        if ((dir.y >= 0) !== above) {
          drawing = false;
          continue;
        }
        const p = projectPoint(dir);
        if (!p) {
          drawing = false;
          continue;
        }
        d += (drawing ? ' L ' : ' M ') +
          p[0].toFixed(1) + ' ' + p[1].toFixed(1);
        drawing = true;
      }
      return d;
    };

    this.paint.arc.above = build(true);
    this.paint.arc.below = build(false);
    this.emit();
  }

  _applyScreenPositions() {
    if (!this.celestial3D) return;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const sun = this._project(this.sunDir, this.sunProj);
    const moon = this._project(this.moonDir, this.moonProj);
    const sunOccluded = sun.visible ? this._isOccluded(this.sunDir) : false;
    const moonOccluded = moon.visible ? this._isOccluded(this.moonDir) : false;
    this._sunVisible = !!(sun.visible && !sunOccluded);
    this._moonVisible = !!(moon.visible && !moonOccluded);

    this._placeBody('sun', sun.x, sun.y, this._sunVisible ? 1 : 0);
    this._placeBody('moon', moon.x, moon.y, this._moonVisible ? 1 : 0);

    const sOn = this._sunVisible ? 1 : 0;
    const mOn = this._moonVisible ? 1 : 0;
    this.paint.bodies.sun.disc = this._sunBaseDisc * sOn;
    this.paint.bodies.sun.halo = this._sunBaseHalo * sOn;
    this.paint.bodies.moon.disc = this._moonBaseDisc * mOn;
    this.paint.bodies.moon.halo = this._moonBaseHalo * mOn;

    const activeIsSun = this.visibleBody === 'sun';
    const active = activeIsSun ? sun : moon;
    this.paint.glow.x = active.x / W;
    this.paint.glow.y = active.y / H;
    this.paint.glow.opacity = this._baseGlow * (active.visible ? 1 : 0);

    this.paint.goldenX = sun.x / W;
    this.paint.goldenY = sun.y / H;
    this.paint.golden = sun.visible ? this._baseGolden : 0;

    this.paint.rays.x = sun.x / W;
    this.paint.rays.y = sun.y / H;
    this.paint.rays.opacity = this._baseRays * sOn;

    // The scatter follows the projected light body while it is on screen,
    // even when the disc itself is hidden behind a ridge.
    if (this.lightState) {
      const light = this._lightBody === 'moon' ? moon : sun;
      this.lightState.x = light.visible ? light.x / W : -2;
      this.lightState.y = light.visible ? 1 - light.y / H : -2;
    }

    this._arcTick = (this._arcTick + 1) % 3;
    if (this._arcTick === 0) {
      this._updateArc3D();
      return;
    }
    this.emit();
  }

  sync(camera) {
    if (!this.celestial3D) return;
    if (camera) this.camera = camera;
    this._applyScreenPositions();
  }

  /* ---------------- time of day ------------------------------------ */

  /**
   * Advance the slow day/night cycle. Paused while the arc is being dragged,
   * for a short beat after a deliberate change, and when the tab is hidden.
   */
  update(dt) {
    dt = Math.min(dt, 0.25);
    if (!this.flowEnabled || dt <= 0 || document.hidden) return;
    if (this.active || this.pressing) {
      this.flowAccum = 0;
      return;
    }
    if (this.flowPause > 0) {
      this.flowPause = Math.max(0, this.flowPause - dt);
      this.flowAccum = 0;
      return;
    }

    this.flowAccum += dt;
    if (this.flowAccum < 1 / 24) return;

    const advance = this.flowAccum;
    this.flowAccum = 0;
    this.set((this.time + advance / this.timeCycle) % 1);
  }

  setInteractive(on) {
    this.interactive = !!on;
    if (!this.interactive) {
      this.active = false;
      this.pressing = false;
      this.pressBody = null;
      this.pressType = null;
      this.paint.arc.visible = false;
      this._paintFlags();
    }
    this.emit();
  }

  /** Body press state is part of the paint snapshot, not a DOM side effect. */
  _paintFlags() {
    for (const type of ['sun', 'moon']) {
      const body = this.paint.bodies[type];
      body.active = this.active && this.pressType === type;
      body.pressing = this.pressing && this.pressType === type;
      body.tipped = this.tipBody === type;
      body.pointerEvents = this.interactive && !body.hidden;
    }
    this.paint.arc.visible = !!this.active;
  }

  setFlow(on) {
    this.flowEnabled = !!on;
    this.flowAccum = 0;
    if (this.flowEnabled) this.flowPause = Math.max(this.flowPause, 1.2);
  }

  _angles() {
    const sun = Math.PI - TAU * this.time;
    const moon = sun + Math.PI;
    return { sun, moon };
  }

  _bodyAngle(type) {
    const a = this._angles()[type];
    const norm = ((a % TAU) + TAU) % TAU;
    return norm;
  }

  _pointerAngle(x, y) {
    // The bodies sit on an ellipse, so compare in normalized ellipse space:
    // on the arc this angle is exactly the parametric angle used for position.
    const nx = (x - this.cx) / this.rx;
    const ny = (this.cy - y) / this.ry;
    return Math.atan2(ny, nx);
  }

/* ---------------- interaction ---------------------------------- */

  // Pointer and keyboard handlers live in the Vue components; they call
  // these methods. The engine never touches an element directly.

  beginPress({ type, pointerId = null, clientX = 0, clientY = 0, pointerType = 'mouse', button = 0 }) {
    if (!this.interactive) return false;
    if (pointerType === 'mouse' && button !== 0) return false;
    if (this.active) return false;
    if (type !== 'sun' && type !== 'moon') return false;

    this.wind.cancelGesture();
    this.pressType = type;
    this.pressBody = type;
    this.pressPointerId = pointerId;
    this.pressStartAngle = this._bodyAngle(type);
    this.pressPointerAngle = this._pointerAngle(clientX, clientY);
    this.dragPointerRaw = this.pressPointerAngle;
    this.dragAngleAccum = 0;
    this.pressStartX = clientX;
    this.pressStartY = clientY;
    this.pressStartTime = this.time;
    this.pressing = true;
    this.interactedWithSky = true;
    this.tipBody = null;

    this._clearPressTimer();

    if (this.celestial3D) {
      // A real celestial body is grabbed directly: no hold gesture and no
      // fixed arc. Dragging horizontally advances/reverses the day.
      this.active = true;
      this._paintFlags();
      this.emit();
      return true;
    }

    this.pressTimer = setTimeout(() => {
      this.active = true;
      this.pressing = true;
      this.pressTimer = 0;
      this._paintFlags();
      this.emit();
    }, this.params.holdDelay);
    this._paintFlags();
    this.emit();
    return true;
  }

  movePress({ clientX = 0, clientY = 0 }) {
    if (!this.pressing) return false;

    if (this.celestial3D) {
      const dx = clientX - this.pressStartX;
      const dy = clientY - this.pressStartY;
      const dayShift = (dx + dy * 0.28) / Math.max(window.innerWidth, 1) * 0.9;
      this.set(this.pressStartTime + dayShift);
      return true;
    }

    if (!this.active) {
      if (Math.hypot(clientX - this.pressStartX, clientY - this.pressStartY) > 12) {
        this._clearPressTimer();
        this.pressing = false;
        this.pressBody = null;
        this._paintFlags();
        this.emit();
      }
      return false;
    }

    const raw = this._pointerAngle(clientX, clientY);
    let delta = raw - this.dragPointerRaw;
    if (delta > Math.PI) delta -= TAU;
    else if (delta < -Math.PI) delta += TAU;
    this.dragPointerRaw = raw;
    this.dragAngleAccum += delta;

    const target = this.pressStartAngle + this.dragAngleAccum;
    const rawT = this.pressType === 'sun'
      ? (Math.PI - target) / TAU
      : (TAU - target) / TAU;
    this.set(((rawT % 1) + 1) % 1);
    return true;
  }

  endPress() {
    this._clearPressTimer();
    this.pressing = false;
    this.active = false;
    this.pressType = null;
    this.pressBody = null;
    this.pressPointerId = null;
    this._paintFlags();
    // Let the chosen moment sit for a beat before the slow cycle resumes.
    this.flowPause = 2.5;
    this.set(this.time);
  }

  _clearPressTimer() {
    if (this.pressTimer) {
      clearTimeout(this.pressTimer);
      this.pressTimer = 0;
    }
  }

  /** Keyboard scrubbing: ← → step the clock, Home/End jump to sunrise/midnight. */
  nudge(key) {
    if (!this.interactive) return false;
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      this.flowPause = 1.5;
      this.set(this.time + (key === 'ArrowRight' ? 0.04 : -0.04));
      return true;
    }
    if (key === 'Home') {
      this.flowPause = 1.5;
      this.set(0);
      return true;
    }
    if (key === 'End') {
      this.flowPause = 1.5;
      this.set(0.75);
      return true;
    }
    return false;
  }

  _firstHint() {
    this._tipTimers.push(setTimeout(() => {
      if (!this.interactive) return;
      if (this.interactedWithSky || this.active) return;
      const target = this.visibleBody === 'moon' ? 'moon' : 'sun';
      if (this.paint.bodies[target].hidden) return;
      this.tipBody = target;
      this._paintFlags();
      this.emit();
      this._tipTimers.push(setTimeout(() => {
        this.tipBody = null;
        this._paintFlags();
        this.emit();
      }, 7200));
    }, 1500));
  }

  /** Release timers (Vue unmount / hot reload). */
  dispose() {
    this._clearPressTimer();
    for (const timer of this._tipTimers) clearTimeout(timer);
    this._tipTimers.length = 0;
    this.onPaint = null;
  }

  /* ---------------- the actual time change ------------------------ */

  set(t) {
    this.time = clamp01(t);

    const W = window.innerWidth;
    const H = window.innerHeight;

    let sunX;
    let sunY;
    let moonX;
    let moonY;
    let sunAlt;
    let moonAlt;

    if (this.celestial3D) {
      // Real world-space directions: a tilted great circle through the
      // east and west horizon. Screen positions are only projections of
      // these bodies, so orbiting the camera can take them out of frame.
      this._direction(this.time, this.sunDir);
      this._direction(this.time + 0.5, this.moonDir);
      sunAlt = this.sunDir.y;
      moonAlt = this.moonDir.y;

      const sp = this._project(this.sunDir, this.sunProj);
      const mp = this._project(this.moonDir, this.moonProj);
      sunX = sp.x;
      sunY = sp.y;
      moonX = mp.x;
      moonY = mp.y;
    } else {
      const { sun, moon } = this._angles();
      sunX = this.cx + this.rx * Math.cos(sun);
      sunY = this.cy - this.ry * Math.sin(sun);
      moonX = this.cx + this.rx * Math.cos(moon);
      moonY = this.cy - this.ry * Math.sin(moon);
      sunAlt = Math.sin(sun);
      moonAlt = -sunAlt;
    }

    const day = smooth01(0.07, 0.5, sunAlt);
    const night = 1 - smooth01(-0.36, 0.08, sunAlt);
    const golden = Math.max(0, 1 - Math.abs(sunAlt) / 0.24);
    const sunA = smooth01(-0.08, 0.1, sunAlt);
    const moonA = smooth01(-0.1, 0.06, moonAlt);

    this.visibleBody = sunA >= moonA ? 'sun' : 'moon';

    /* --- bodies --------------------------------------------------- */
    this.paint.bodies.sun.x = sunX;
    this.paint.bodies.sun.y = sunY;
    this.paint.bodies.moon.x = moonX;
    this.paint.bodies.moon.y = moonY;
    this._placeBody(
      'sun', sunX, sunY,
      this.celestial3D ? (this.sunProj.visible ? 1 : 0) : sunA
    );
    this._placeBody(
      'moon', moonX, moonY,
      this.celestial3D ? (this.moonProj.visible ? 1 : 0) : moonA
    );

    const sunGhost = this.pressBody === 'sun' && this.pressing && sunA < 0.02 ? 0.14 : 0;
    const moonGhost = this.pressBody === 'moon' && this.pressing && moonA < 0.02 ? 0.12 : 0;

    this._sunBaseDisc = sunA * 0.92 + sunGhost;
    this._moonBaseDisc = moonA * 0.84 + moonGhost;
    this._sunBaseHalo = sunA * 0.7 + sunGhost * 0.45;
    this._moonBaseHalo = moonA * 0.55 + moonGhost * 0.45;

    this.paint.bodies.sun.disc = this._sunBaseDisc;
    this.paint.bodies.moon.disc = this._moonBaseDisc;
    this.paint.bodies.sun.halo = this._sunBaseHalo;
    this.paint.bodies.moon.halo = this._moonBaseHalo;

    const sunHalo = mixRgb(mixRgb(HALO_NIGHT, HALO_GOLDEN, golden), HALO_DAY, day);
    this.paint.bodies.sun.haloColor = rgbCss(sunHalo, 0.6);
    this.paint.bodies.moon.haloColor = rgbCss(
      mixRgb(HALO_NIGHT, [190, 210, 244], 0.45), 0.42
    );

    this.paint.bodies.sun.golden = golden > 0.32;
    this.paint.bodies.moon.golden = golden > 0.32;

    /* --- overlays & UI ------------------------------------------- */
    this.paint.night = night * 0.78;
    this._baseGolden = golden * 0.72;
    this._baseGlow = 0.05 + 0.5 * day + 0.12 * golden;
    this.paint.golden = this._baseGolden;
    this.paint.goldenX = sunX / W;
    this.paint.goldenY = sunY / H;

    this.paint.stars = 0.92 * Math.pow(night, 1.25);

    const glowX = sunAlt >= 0 ? sunX : moonX;
    const glowY = sunAlt >= 0 ? sunY : moonY;
    this.paint.glow.x = glowX / W;
    this.paint.glow.y = glowY / H;
    this.paint.glow.opacity = this._baseGlow;

    // Clouds pick up the same air: warm lit tops at golden hour, pale by
    // day, and a cool blue-grey shadow side once the sun is down.
    const cloudHi = mixRgb(
      mixRgb([255, 253, 246], [255, 226, 193], golden),
      [72, 86, 112],
      night * 0.62
    );
    const cloudLo = mixRgb(
      mixRgb([184, 197, 203], [206, 150, 126], golden),
      [34, 45, 64],
      night * 0.70
    );
    this.paint.clouds.hi = rgbCss(cloudHi);
    this.paint.clouds.lo = rgbCss(cloudLo);
    this.paint.clouds.warm = `rgba(255, 176, 118, ${(0.42 * golden).toFixed(3)})`;

    const ink = mixRgb(INK_DAY, INK_NIGHT, night);
    this.paint.ink.ink = rgbCss(ink);
    this.paint.ink.soft = rgbCss(ink, 0.62);
    this.paint.ink.faint = rgbCss(ink, 0.34);
    this.paint.ink.line = rgbCss(ink, 0.20);
    this.paint.theme = rgbCss(mixRgb([224, 224, 198], [10, 18, 31], night));

    const phase = this.time > 0.995 ? 0 : this.time;
    const label =
      phase < 0.05 ? '黎明' :
      phase < 0.22 ? '清晨' :
      phase < 0.34 ? '正午' :
      phase < 0.47 ? '午后' :
      phase < 0.56 ? '黄昏' :
      phase < 0.72 ? '入夜' : '深夜';

    const pct = Math.round(this.time * 100);
    this.paint.time.pct = pct;
    this.paint.time.label = label;

    /* --- lights --------------------------------------------------- */
    // One continuous model driven by the body's altitude, instead of three
    // discrete day / golden / night palettes that had to be cross-faded.
    const dayT = smooth01(-0.02, 0.4, sunAlt);
    const horizonGlow = Math.exp(-Math.pow(sunAlt / 0.2, 2));
    const useSun = sunAlt >= -0.14;
    const activeAlt = Math.max(0, useSun ? sunAlt : moonAlt);
    const activeX = useSun ? sunX : moonX;

    scratch.sky
      .copy(PALETTE.skyNight)
      .lerp(PALETTE.skyDay, dayT)
      .lerp(PALETTE.skyGolden, horizonGlow * 0.55);
    scratch.ground
      .copy(PALETTE.groundNight)
      .lerp(PALETTE.groundDay, dayT)
      .lerp(PALETTE.groundGolden, horizonGlow * 0.4);
    scratch.fill
      .copy(PALETTE.fillNight)
      .lerp(PALETTE.fillDay, dayT)
      .lerp(PALETTE.fillGolden, horizonGlow * 0.35);
    scratch.rim
      .copy(PALETTE.rimNight)
      .lerp(PALETTE.rimDay, dayT)
      .lerp(PALETTE.rimGolden, horizonGlow * 0.45);
    scratch.haze
      .copy(PALETTE.hazeNight)
      .lerp(PALETTE.hazeDay, dayT)
      .lerp(PALETTE.hazeGolden, horizonGlow * 0.9);

    if (useSun) {
      const low = 1 - smooth01(0.08, 0.58, sunAlt);
      const ember = Math.pow(1 - smooth01(-0.01, 0.16, sunAlt), 1.3);
      scratch.key
        .copy(PALETTE.keyDay)
        .lerp(PALETTE.keyGolden, low)
        .lerp(PALETTE.keyEmber, ember * 0.6);
      this.keyLight.intensity = 0.08 + 2.25 * Math.pow(Math.max(0, sunAlt), 0.7);
    } else {
      scratch.key.copy(PALETTE.keyNight);
      const moonFade = smooth01(0.02, 0.3, moonAlt);
      this.keyLight.intensity =
        (0.24 + 0.8 * Math.pow(Math.max(0, moonAlt), 0.8)) * moonFade;
    }

    this.keyLight.color.copy(scratch.key);
    this.hemi.color.copy(scratch.sky);
    this.hemi.groundColor.copy(scratch.ground);
    this.fill.color.copy(scratch.fill);
    this.rim.color.copy(scratch.rim);

    this.hemi.intensity = 0.24 + 0.86 * dayT + 0.16 * horizonGlow;
    this.fill.intensity = 0.06 + 0.32 * dayT;
    this.rim.intensity = 0.10 + 0.36 * dayT + 0.24 * horizonGlow;

    // In 3D mode the light follows the real celestial direction. The old
    // screen-arc approximation is kept for the non-3D pages.
    if (this.celestial3D) {
      scratch.sunDir.copy(useSun ? this.sunDir : this.moonDir);
    } else {
      const hTan = Math.tan((33 * Math.PI) / 360) * (W / H);
      const az = Math.atan(((activeX / W) * 2 - 1) * hTan);
      const elev = Math.min(Math.asin(Math.min(1, activeAlt)), 1.2);
      const ce = Math.cos(elev);
      const dx = Math.sin(az) * ce;
      const dy = Math.max(0.06, Math.sin(elev));
      const dz = -Math.cos(az) * ce;
      const dLen = Math.hypot(dx, dy, dz);
      scratch.sunDir.set(dx / dLen, dy / dLen, dz / dLen);
    }
    this.keyLight.position.set(
      scratch.sunDir.x * 24,
      scratch.sunDir.y * 24,
      scratch.sunDir.z * 24
    );

    const activeY = useSun ? sunY : moonY;
    const sunStrength = useSun
      ? 0.12 + 0.92 * Math.pow(Math.max(0, sunAlt), 0.62) + 0.28 * horizonGlow
      : 0.12 + 0.42 * Math.max(0, moonAlt);
    this._lightBody = useSun ? 'sun' : 'moon';
    this.lightState = {
      x: activeX / W,
      y: 1 - activeY / H,
      color: this.keyLight.color.clone(),
      strength: useSun ? sunA : moonA * 0.75,
      sunDir: scratch.sunDir,
      haze: scratch.haze,
      sunStrength,
      day: dayT,
      golden: horizonGlow,
      night
    };
    if (this.celestial3D) {
      const lp = useSun ? this.sunProj : this.moonProj;
      this.lightState.x = lp.visible ? lp.x / W : -2;
      this.lightState.y = lp.visible ? 1 - lp.y / H : -2;
    }

    /* --- crepuscular rays ----------------------------------------- */
    // Keep the sun disc untouched; the shafts live on their own layer behind
    // it, so the foreground CSS cloud can pass between them.
    const strength = Math.max(0, sunA) * (0.22 + 0.78 * golden);
    this._baseRays = strength * 0.62;
    this.paint.rays.opacity = this._baseRays;
    this.paint.rays.x = sunX / W;
    this.paint.rays.y = sunY / H;
    const rayRgb = mixRgb([255, 236, 205], [255, 190, 128], golden);
    this.paint.rays.rgb = `${rayRgb[0]}, ${rayRgb[1]}, ${rayRgb[2]}`;

    /* --- fluff, seeds, shadows, pollen ----------------------------- */
    mixLight(PALETTE.fluffNight, PALETTE.fluffGolden, PALETTE.fluffDay, { golden, day }, scratch.fluff);
    mixLight(PALETTE.coreNight, PALETTE.coreGolden, PALETTE.coreDay, { golden, day }, scratch.core);
    mixLight(PALETTE.moteNight, PALETTE.moteGolden, PALETTE.moteDay, { golden, day }, scratch.mote);

    dandelionAtmosphere.fluffTint.copy(scratch.fluff);
    dandelionAtmosphere.coreTint.copy(scratch.core);
    dandelionAtmosphere.coreOpacity = 0.80 + 0.20 * day;
    dandelionAtmosphere.shadowFactor = 0.38 + 0.62 * day;

    this.world.setTime({
      sunColor: scratch.key,
      sunDir: scratch.sunDir,
      sunStrength,
      haze: scratch.haze,
      moteColor: scratch.mote,
      moteOpacity: 0.45 + 0.22 * night,
      night,
      golden,
      day
    });

    this._paintFlags();
    if (this.celestial3D) this._applyScreenPositions();
    else this.emit();
  }

  _placeBody(type, x, y, alpha) {
    const body = this.paint.bodies[type];
    if (!body) return;
    body.x = x;
    body.y = y;

    const below = alpha < 0.015;
    // While a body is being scrubbed it must keep receiving the captured
    // pointer even after it passes under the horizon.
    const keep = this.pressBody === type && this.pressing;
    body.below = below;
    body.hidden = below && !keep;
    body.pointerEvents = !body.hidden && this.interactive;
  }
}

function mixLight(night, goldenColor, dayColor, f, out) {
  out.copy(night).lerp(goldenColor, f.golden).lerp(dayColor, f.day);
}