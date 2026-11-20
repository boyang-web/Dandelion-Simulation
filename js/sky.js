import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/* Sky & time of day                                                   */
/*                                                                     */
/* The sun and the moon share one elliptical arc across the sky. They  */
/* sit on opposite sides of it: when the sun reaches the western        */
/* horizon the moon rises in the east. There is no vertical scrubbing;  */
/* a long press on either body lets the pointer travel along that arc.  */
/* ------------------------------------------------------------------ */

const TAU = Math.PI * 2;

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
  constructor({ wind, world, dandelion, keyLight, hemi, fill, rim, initial = 0.4 }) {
    this.wind = wind;
    this.world = world;
    this.dandelion = dandelion;
    this.keyLight = keyLight;
    this.hemi = hemi;
    this.fill = fill;
    this.rim = rim;

    this.rootEl = document.documentElement;
    this.themeMeta = document.querySelector('meta[name="theme-color"]');
    this.nightVeil = document.getElementById('nightVeil');
    this.goldenVeil = document.getElementById('goldenVeil');
    this.starsEl = document.getElementById('stars');
    this.skyGlow = document.querySelector('.sky-glow');
    this.atmosphere = document.querySelector('.atmosphere');
    this.foreSky = document.querySelector('.fore-sky');
    this.raysEl = document.getElementById('sunRays');

    this.sunBody = document.getElementById('sunBody');
    this.moonBody = document.getElementById('moonBody');
    this.sunHalo = this.sunBody.querySelector('.celestial__halo');
    this.moonHalo = this.moonBody.querySelector('.celestial__halo');
    this.sunDisc = this.sunBody.querySelector('.celestial__disc--sun');
    this.moonDisc = this.moonBody.querySelector('.celestial__disc--moon');
    this.arc = document.getElementById('celestialArc');
    this.arcPath = document.getElementById('celestialArcPath');
    this.arcLower = document.getElementById('celestialArcBelow');

    this.time = clamp01(initial);
    // One full day (sun + moon) takes two minutes. The DOM and every shader
    // are updated in small steps so the arc glides instead of ticking.
    this.timeCycle = 120;
    this.flowAccum = 0;
    this.flowPause = 0;
    this.flowEnabled = true;
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

    this._buildStars();
    this._bind();
    this._layout();
    this.set(this.time);
    this._firstHint();
  }

  /* ---------------- geometry --------------------------------------- */

  _layout() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    // A phone held sideways is very short: keep the noon body inside the top
    // edge instead of letting it slide under the notch, and flatten the arc
    // so sunrise/sunset still sit on the horizon.
    const phoneLandscape =
      window.matchMedia('(pointer: coarse)').matches &&
      H <= 560 && W / H >= 1.2;
    this.cx = W * 0.5;
    this.cy = H * (phoneLandscape ? 0.56 : 0.53);
    this.rx = W * (phoneLandscape ? 0.36 : 0.4);
    this.ry = H * (phoneLandscape ? 0.30 : 0.375);

    if (this.arc && this.arcPath) {
      this.arc.setAttribute('viewBox', `0 0 ${W} ${H}`);
      this.arcPath.setAttribute(
        'd',
        `M ${(this.cx - this.rx).toFixed(2)} ${this.cy.toFixed(2)} ` +
        `A ${this.rx.toFixed(2)} ${this.ry.toFixed(2)} 0 0 1 ` +
        `${(this.cx + this.rx).toFixed(2)} ${this.cy.toFixed(2)}`
      );
      this.arcLower?.setAttribute(
        'd',
        `M ${(this.cx - this.rx).toFixed(2)} ${this.cy.toFixed(2)} ` +
        `A ${this.rx.toFixed(2)} ${this.ry.toFixed(2)} 0 0 0 ` +
        `${(this.cx + this.rx).toFixed(2)} ${this.cy.toFixed(2)}`
      );
    }
  }

  resize() {
    this._layout();
    this.set(this.time);
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

  /* ---------------- stars ----------------------------------------- */

  _buildStars() {
    if (!this.starsEl) return;
    const c = document.createElement('canvas');
    c.width = 1600;
    c.height = 900;
    const ctx = c.getContext('2d');

    for (let i = 0; i < 320; i++) {
      const x = Math.random() * c.width;
      const y = Math.pow(Math.random(), 0.9) * c.height * 0.86;
      const big = Math.random() > 0.92;
      const r = big ? 1.2 + Math.random() * 1.1 : 0.35 + Math.random() * 0.9;
      const a = big ? 0.55 + Math.random() * 0.4 : 0.2 + Math.random() * 0.55;
      ctx.beginPath();
      ctx.fillStyle = `rgba(255, 249, 234, ${a})`;
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }

    for (let i = 0; i < 16; i++) {
      const x = Math.random() * c.width;
      const y = Math.random() * c.height * 0.75;
      const g = ctx.createRadialGradient(x, y, 0, x, y, 7 + Math.random() * 8);
      g.addColorStop(0, 'rgba(255, 250, 238, 0.5)');
      g.addColorStop(1, 'rgba(255, 250, 238, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - 20, y - 20, 40, 40);
    }

    this.starsEl.style.backgroundImage = `url(${c.toDataURL('image/png')})`;
  }

  /* ---------------- interaction ---------------------------------- */

  _bind() {
    const begin = (type) => (e) => this._beginPress(e, type);
    this.sunBody.addEventListener('pointerdown', begin('sun'));
    this.moonBody.addEventListener('pointerdown', begin('moon'));

    for (const body of [this.sunBody, this.moonBody]) {
      body.addEventListener('pointermove', (e) => this._movePress(e));
      body.addEventListener('pointerup', (e) => this._endPress(e));
      body.addEventListener('pointercancel', (e) => this._endPress(e));
      body.addEventListener('lostpointercapture', (e) => this._endPress(e));
      body.addEventListener('keydown', (e) => this._key(e));
    }
  }

  _beginPress(e, type) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (this.active) return;

    e.preventDefault();
    e.stopPropagation();
    this.wind.cancelGesture();

    const body = type === 'sun' ? this.sunBody : this.moonBody;
    this.pressType = type;
    this.pressBody = body;
    this.pressPointerId = e.pointerId;
    this.pressStartAngle = this._bodyAngle(type);
    this.pressPointerAngle = this._pointerAngle(e.clientX, e.clientY);
    this.dragPointerRaw = this.pressPointerAngle;
    this.dragAngleAccum = 0;
    this.pressStartX = e.clientX;
    this.pressStartY = e.clientY;
    this.pressing = true;
    this.interactedWithSky = true;

    body.classList.remove('is-tipped');
    body.classList.add('is-pressing');

    try { body.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }

    this._clearPressTimer();
    this.pressTimer = setTimeout(() => {
      this.active = true;
      this.pressing = true;
      this.pressTimer = 0;
      body.classList.add('is-active');
      if (this.arc) this.arc.classList.add('is-visible');
    }, this.params.holdDelay);
  }

  _movePress(e) {
    e.stopPropagation();
    if (!this.pressing) return;

    if (!this.active) {
      if (Math.hypot(e.clientX - this.pressStartX, e.clientY - this.pressStartY) > 12) {
        this._clearPressTimer();
        this.pressing = false;
        if (this.pressBody) this.pressBody.classList.remove('is-pressing');
      }
      return;
    }

    e.preventDefault();

    const raw = this._pointerAngle(e.clientX, e.clientY);
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
  }

  _endPress(e) {
    e.stopPropagation();
    this._clearPressTimer();
    this.pressing = false;
    this.active = false;
    this.pressType = null;

    if (this.pressBody) {
      this.pressBody.classList.remove('is-pressing', 'is-active');
      if (this.pressPointerId !== null) {
        try { this.pressBody.releasePointerCapture(this.pressPointerId); } catch (err) { /* noop */ }
      }
    }
    this.pressPointerId = null;
    this.pressBody = null;
    if (this.arc) this.arc.classList.remove('is-visible');
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

  _key(e) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      this.flowPause = 1.5;
      this.set(this.time + (e.key === 'ArrowRight' ? 0.04 : -0.04));
    } else if (e.key === 'Home') {
      e.preventDefault();
      this.flowPause = 1.5;
      this.set(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      this.flowPause = 1.5;
      this.set(0.75);
    }
  }

  _firstHint() {
    setTimeout(() => {
      if (!this.interactedWithSky && !this.active) {
        const target = this.visibleBody === 'moon' ? this.moonBody : this.sunBody;
        if (!target) return;
        target.classList.add('is-tipped');
        setTimeout(() => target.classList.remove('is-tipped'), 7200);
      }
    }, 1500);
  }

  /* ---------------- the actual time change ------------------------ */

  set(t) {
    this.time = clamp01(t);
    const { sun, moon } = this._angles();

    const W = window.innerWidth;
    const H = window.innerHeight;

    const sunX = this.cx + this.rx * Math.cos(sun);
    const sunY = this.cy - this.ry * Math.sin(sun);
    const moonX = this.cx + this.rx * Math.cos(moon);
    const moonY = this.cy - this.ry * Math.sin(moon);

    const sunAlt = Math.sin(sun);
    const moonAlt = -sunAlt;

    const day = smooth01(0.07, 0.5, sunAlt);
    const night = 1 - smooth01(-0.36, 0.08, sunAlt);
    const golden = Math.max(0, 1 - Math.abs(sunAlt) / 0.24);
    const sunA = smooth01(-0.08, 0.1, sunAlt);
    const moonA = smooth01(-0.1, 0.06, moonAlt);

    this.visibleBody = sunA >= moonA ? 'sun' : 'moon';

    /* --- bodies --------------------------------------------------- */
    this._placeBody(this.sunBody, sunX, sunY, sunA);
    this._placeBody(this.moonBody, moonX, moonY, moonA);

    const sunGhost = this.pressBody === this.sunBody && this.pressing && sunA < 0.02 ? 0.14 : 0;
    const moonGhost = this.pressBody === this.moonBody && this.pressing && moonA < 0.02 ? 0.12 : 0;

    this.sunDisc.style.opacity = (sunA * 0.92 + sunGhost).toFixed(3);
    this.moonDisc.style.opacity = (moonA * 0.84 + moonGhost).toFixed(3);
    this.sunHalo.style.opacity = (sunA * 0.7 + sunGhost * 0.45).toFixed(3);
    this.moonHalo.style.opacity = (moonA * 0.55 + moonGhost * 0.45).toFixed(3);

    const sunHalo = mixRgb(mixRgb(HALO_NIGHT, HALO_GOLDEN, golden), HALO_DAY, day);
    this.sunBody.style.setProperty('--halo-color', rgbCss(sunHalo, 0.6));
    this.moonBody.style.setProperty(
      '--halo-color',
      rgbCss(mixRgb(HALO_NIGHT, [190, 210, 244], 0.45), 0.42)
    );

    this.sunBody.classList.toggle('is-golden', golden > 0.32);
    this.moonBody.classList.toggle('is-golden', golden > 0.32);

    /* --- overlays & UI ------------------------------------------- */
    this.nightVeil.style.opacity = (night * 0.78).toFixed(3);
    this.goldenVeil.style.opacity = (golden * 0.72).toFixed(3);
    this.goldenVeil.style.setProperty('--golden-x', `${((sunX / W) * 100).toFixed(2)}%`);
    this.goldenVeil.style.setProperty('--golden-y', `${((sunY / H) * 100).toFixed(2)}%`);

    this.starsEl.style.opacity = (0.92 * Math.pow(night, 1.25)).toFixed(3);

    if (this.skyGlow) {
      const activeX = sunAlt >= 0 ? sunX : moonX;
      const activeY = sunAlt >= 0 ? sunY : moonY;
      this.skyGlow.style.setProperty('--glow-x', `${((activeX / W) * 100).toFixed(2)}%`);
      this.skyGlow.style.setProperty('--glow-y', `${((activeY / H) * 100).toFixed(2)}%`);
      this.skyGlow.style.opacity = (0.05 + 0.5 * day + 0.12 * golden).toFixed(3);
    }

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
    const cloudWarm = `rgba(255, 176, 118, ${(0.42 * golden).toFixed(3)})`;
    for (const el of [this.atmosphere, this.foreSky]) {
      if (!el) continue;
      el.style.setProperty('--cloud-hi', rgbCss(cloudHi));
      el.style.setProperty('--cloud-lo', rgbCss(cloudLo));
      el.style.setProperty('--cloud-warm', cloudWarm);
    }

    const ink = mixRgb(INK_DAY, INK_NIGHT, night);
    this.rootEl.style.setProperty('--ink', rgbCss(ink));
    this.rootEl.style.setProperty('--ink-soft', rgbCss(ink, 0.62));
    this.rootEl.style.setProperty('--ink-faint', rgbCss(ink, 0.34));
    this.rootEl.style.setProperty('--ink-line', rgbCss(ink, 0.20));

    if (this.themeMeta) {
      this.themeMeta.setAttribute(
        'content',
        rgbCss(mixRgb([224, 224, 198], [10, 18, 31], night))
      );
    }

    const phase = this.time > 0.995 ? 0 : this.time;
    const label =
      phase < 0.05 ? '黎明' :
      phase < 0.22 ? '清晨' :
      phase < 0.34 ? '正午' :
      phase < 0.47 ? '午后' :
      phase < 0.56 ? '黄昏' :
      phase < 0.72 ? '入夜' : '深夜';

    const pct = Math.round(this.time * 100);
    for (const body of [this.sunBody, this.moonBody]) {
      body.setAttribute('aria-valuenow', String(pct));
      body.setAttribute('aria-valuetext', `时间 ${pct}%，${label}`);
    }

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

    // Direction follows the body's altitude and screen azimuth. At noon it
    // comes from high above, at dusk it rakes in from the horizon side.
    const hTan = Math.tan((33 * Math.PI) / 360) * (W / H);
    const az = Math.atan(((activeX / W) * 2 - 1) * hTan);
    const elev = Math.min(Math.asin(Math.min(1, activeAlt)), 1.2);
    const ce = Math.cos(elev);
    const dx = Math.sin(az) * ce;
    const dy = Math.max(0.06, Math.sin(elev));
    const dz = -Math.cos(az) * ce;
    const dLen = Math.hypot(dx, dy, dz);
    scratch.sunDir.set(dx / dLen, dy / dLen, dz / dLen);
    this.keyLight.position.set(
      scratch.sunDir.x * 24,
      scratch.sunDir.y * 24,
      scratch.sunDir.z * 24
    );

    const activeY = useSun ? sunY : moonY;
    const sunStrength = useSun
      ? 0.12 + 0.92 * Math.pow(Math.max(0, sunAlt), 0.62) + 0.28 * horizonGlow
      : 0.12 + 0.42 * Math.max(0, moonAlt);
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

    /* --- crepuscular rays ----------------------------------------- */
    // Keep the sun disc untouched; the shafts live on their own layer behind
    // it, so the foreground CSS cloud can pass between them.
    if (this.raysEl) {
      const strength = Math.max(0, sunA) * (0.22 + 0.78 * golden);
      this.raysEl.style.opacity = (strength * 0.62).toFixed(3);
      this.raysEl.style.setProperty('--ray-x', `${((sunX / W) * 100).toFixed(2)}%`);
      this.raysEl.style.setProperty('--ray-y', `${((sunY / H) * 100).toFixed(2)}%`);
      const rayRgb = mixRgb([255, 236, 205], [255, 190, 128], golden);
      this.raysEl.style.setProperty(
        '--ray-rgb',
        `${rayRgb[0]}, ${rayRgb[1]}, ${rayRgb[2]}`
      );
    }

    /* --- fluff, seeds, shadows, pollen ----------------------------- */
    mixLight(PALETTE.fluffNight, PALETTE.fluffGolden, PALETTE.fluffDay, { golden, day }, scratch.fluff);
    mixLight(PALETTE.coreNight, PALETTE.coreGolden, PALETTE.coreDay, { golden, day }, scratch.core);
    mixLight(PALETTE.moteNight, PALETTE.moteGolden, PALETTE.moteDay, { golden, day }, scratch.mote);

    this.dandelion.setTime({
      fluffTint: scratch.fluff,
      coreTint: scratch.core,
      coreOpacity: 0.80 + 0.20 * day,
      shadowFactor: 0.38 + 0.62 * day
    });

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
  }

  _placeBody(body, x, y, alpha) {
    if (!body) return;
    body.style.left = `${x.toFixed(2)}px`;
    body.style.top = `${y.toFixed(2)}px`;

    const below = alpha < 0.015;
    // While a body is being scrubbed it must keep receiving the captured
    // pointer even after it passes under the horizon.
    const keep = this.pressBody === body && this.pressing;
    body.classList.toggle('is-below', below);

    if (below && !keep) {
      body.classList.add('is-hidden');
      body.style.pointerEvents = 'none';
    } else {
      body.classList.remove('is-hidden');
      body.style.pointerEvents = 'auto';
    }
  }
}

function mixLight(night, goldenColor, dayColor, f, out) {
  out.copy(night).lerp(goldenColor, f.golden).lerp(dayColor, f.day);
}