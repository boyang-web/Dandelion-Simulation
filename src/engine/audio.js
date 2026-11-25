/* ------------------------------------------------------------------ */
/*  Ambience · procedural wind bed + UI sounds                         */
/*                                                                     */
/*  No audio files: a looping brown-noise bed follows the wind, and     */
/*  short synthesised voices answer actions (shutter, record, unlock).  */
/*  The context is created on the first user gesture, as browsers block */
/*  audio before interaction.                                          */
/* ------------------------------------------------------------------ */

function makeBrownNoise(ctx, seconds = 2.4) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    last = 0.985 * last + 0.015 * white;
    data[i] = last * 3.4;
  }
  return buffer;
}

export class Ambience {
  constructor({ enabled = true } = {}) {
    this.enabled = !!enabled;
    this.ctx = null;
    this.master = null;
    this.bed = null;
    this.bedGain = null;
    this.bedFilter = null;
    this.hiss = null;
    this.hissGain = null;
    this.noise = null;
    this.started = false;
  }

  get supported() {
    return typeof window !== 'undefined' &&
      !!(window.AudioContext || window.webkitAudioContext);
  }

  start() {
    if (!this.supported) return;
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && this.enabled) this.ctx.resume().catch(() => {});
      return;
    }

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    const master = ctx.createGain();
    master.gain.value = this.enabled ? 1 : 0;
    master.connect(ctx.destination);

    const noise = makeBrownNoise(ctx);

    // Low wind body: brown noise through a slow low-pass.
    const bedSrc = ctx.createBufferSource();
    bedSrc.buffer = noise;
    bedSrc.loop = true;
    const bedFilter = ctx.createBiquadFilter();
    bedFilter.type = 'lowpass';
    bedFilter.frequency.value = 480;
    bedFilter.Q.value = 0.7;
    const bedGain = ctx.createGain();
    bedGain.gain.value = 0;
    bedSrc.connect(bedFilter);
    bedFilter.connect(bedGain);
    bedGain.connect(master);
    bedSrc.start();

    // Airy hiss that opens up while flying.
    const hissSrc = ctx.createBufferSource();
    hissSrc.buffer = noise;
    hissSrc.loop = true;
    const hissFilter = ctx.createBiquadFilter();
    hissFilter.type = 'bandpass';
    hissFilter.frequency.value = 1900;
    hissFilter.Q.value = 1.2;
    const hissGain = ctx.createGain();
    hissGain.gain.value = 0;
    hissSrc.connect(hissFilter);
    hissFilter.connect(hissGain);
    hissGain.connect(master);
    hissSrc.start();

    this.ctx = ctx;
    this.master = master;
    this.noise = noise;
    this.bed = bedSrc;
    this.bedFilter = bedFilter;
    this.bedGain = bedGain;
    this.hiss = hissSrc;
    this.hissGain = hissGain;
    this.started = true;

    if (ctx.state === 'suspended' && this.enabled) ctx.resume().catch(() => {});
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const gain = this.master.gain;
    gain.cancelScheduledValues(now);

    if (this.enabled) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      // Fade back in from silence to avoid a click.
      gain.value = 0.0001;
      gain.setValueAtTime(0.0001, now);
      gain.exponentialRampToValueAtTime(1, now + 0.25);
      return;
    }

    // A suspended context freezes automation, so hard-zero the intrinsic
    // value as well; otherwise a muted tab could keep gain at 1.
    if (this.ctx.state !== 'running') {
      gain.value = 0;
      gain.setValueAtTime(0, now);
      return;
    }

    // Quick fade, then hard-zero and suspend so muted devices stop paying
    // for the audio graph.
    gain.setTargetAtTime(0.0001, now, 0.05);
    setTimeout(() => {
      if (this.enabled || !this.ctx) return;
      const t = this.ctx.currentTime;
      gain.cancelScheduledValues(t);
      gain.setValueAtTime(0, t);
      if (this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
    }, 220);
  }

  toggle() {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  /**
   * Follow the local weather. Values are already normalised by the caller.
   * speed: 0..1 rolling speed, altitude: 0..1 height, breeze: 0..1 natural wind.
   */
  update({ speed = 0, altitude = 0, breeze = 0, gust = 0 } = {}) {
    if (!this.ctx || !this.bedGain) return;
    const now = this.ctx.currentTime;
    const target = Math.min(
      0.26,
      0.035 + breeze * 0.1 + speed * 0.13 + gust * 0.08 + altitude * 0.05
    );
    this.bedGain.gain.setTargetAtTime(target, now, 0.25);
    this.bedFilter.frequency.setTargetAtTime(
      360 + speed * 420 + gust * 260 + altitude * 180,
      now,
      0.3
    );
    this.hissGain.gain.setTargetAtTime(altitude * 0.045, now, 0.3);
    this.hiss?.playbackRate?.setTargetAtTime?.(0.9 + speed * 0.3, now, 0.3);
  }

  _tone({ freq, type = 'sine', dur = 0.3, gain = 0.07, slide = 0, delay = 0 }) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(35, freq + slide),
        t + dur
      );
    }
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(env);
    env.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.04);
  }

  _burst({ dur = 0.12, freq = 1200, q = 0.9, gain = 0.1, type = 'bandpass', delay = 0 }) {
    if (!this.ctx || !this.enabled || !this.noise) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter);
    filter.connect(env);
    env.connect(this.master);
    src.start(t, Math.random() * 0.6);
    src.stop(t + dur + 0.03);
  }

  chime(index) {
    if (!this.ctx || !this.enabled) return;
    const freq = [392, 494, 587][index];
    this._tone({ freq, dur: .82, gain: .07 });
    this._tone({ freq: freq * 2.01, dur: .36, gain: .024 });
  }

  play(name) {
    if (!this.ctx || !this.enabled) return;
    switch (name) {
      case 'shutter':
        this._burst({ dur: 0.07, freq: 2600, q: 1.4, gain: 0.12 });
        this._tone({ freq: 1500, type: 'square', dur: 0.03, gain: 0.025 });
        break;
      case 'recordStart':
        this._tone({ freq: 660, dur: 0.09, gain: 0.06 });
        this._tone({ freq: 990, dur: 0.12, gain: 0.06, delay: 0.1 });
        break;
      case 'recordStop':
        this._tone({ freq: 720, dur: 0.09, gain: 0.05 });
        this._tone({ freq: 480, dur: 0.15, gain: 0.05, delay: 0.09 });
        break;
      case 'unlock':
        this._tone({ freq: 523.25, type: 'triangle', dur: 0.22, gain: 0.055 });
        this._tone({ freq: 659.25, type: 'triangle', dur: 0.22, gain: 0.05, delay: 0.09 });
        this._tone({ freq: 783.99, type: 'triangle', dur: 0.34, gain: 0.045, delay: 0.18 });
        break;
      case 'gust':
        this._burst({ dur: .32, freq: 1350, q: .65, gain: .075, type: 'bandpass' });
        break;
      case 'plant':
        this._tone({ freq: 392, type: 'triangle', dur: 0.16, gain: 0.04 });
        this._burst({ dur: 0.06, freq: 900, q: 0.8, gain: 0.03 });
        break;
      case 'place':
        this._tone({ freq: 330, type: 'triangle', dur: 0.14, gain: 0.05 });
        break;
      case 'lift':
        this._burst({ dur: 0.45, freq: 700, q: 0.6, gain: 0.05, type: 'lowpass' });
        this._tone({ freq: 196, dur: 0.5, gain: 0.04, slide: 90 });
        break;
      case 'land':
        this._tone({ freq: 96, dur: 0.26, gain: 0.09, slide: -34 });
        this._burst({ dur: 0.18, freq: 320, q: 0.7, gain: 0.05, type: 'lowpass' });
        break;
      default:
        break;
    }
  }
}