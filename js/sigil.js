/* ------------------------------------------------------------------ */
/*  Sky sigil / mode switcher                                          */
/*                                                                     */
/*  Long-press the glowing mark in the sky to open the three-mode       */
/*  selector, then tap a mode. A short press intentionally does         */
/*  nothing so it cannot fire while someone is just looking around.     */
/* ------------------------------------------------------------------ */

const LABELS = { wind: '风', plant: '种植', orbit: '视角' };

export class SigilUI {
  constructor({ onMode, initial = 'wind' } = {}) {
    this.onMode = onMode;
    this.mode = initial;
    this.longPressTimer = 0;
    this.openedAt = 0;
    this.startX = 0;
    this.startY = 0;

    this.wrap = document.getElementById('sigilWrap');
    this.sigil = document.getElementById('sigil');
    this.menu = document.getElementById('modeMenu');
    this.label = document.getElementById('sigilMode');
    this.buttons = [...document.querySelectorAll('[data-mode]')];

    this._bind();
    this.set(initial, { silent: true });
  }

  _bind() {
    this.sigil.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.mode-menu')) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      this.startX = e.clientX;
      this.startY = e.clientY;
      this.clearTimer();
      this.longPressTimer = setTimeout(() => {
        this.longPressTimer = 0;
        this.openedAt = performance.now();
        this.openMenu();
      }, 600);
    });

    const cancel = () => this.clearTimer();
    this.sigil.addEventListener('pointerup', cancel);
    this.sigil.addEventListener('pointercancel', cancel);
    this.sigil.addEventListener('pointerleave', cancel);
    this.sigil.addEventListener('pointermove', (e) => {
      if (!this.longPressTimer) return;
      if (Math.hypot(e.clientX - this.startX, e.clientY - this.startY) > 12) {
        cancel();
      }
    });

    this.sigil.addEventListener('click', (e) => {
      e.preventDefault();
      if (!this.menu.hidden) return;
      if (performance.now() - this.openedAt < 500) return;
      // A short click is a quiet hint, not a mode change.
      this.sigil.classList.remove('is-pulse');
      void this.sigil.offsetWidth;
      this.sigil.classList.add('is-pulse');
    });

    for (const button of this.buttons) {
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        this.set(button.dataset.mode);
        this.closeMenu();
      });
    }

    document.addEventListener('pointerdown', (e) => {
      if (this.menu.hidden) return;
      if (this.wrap.contains(e.target)) return;
      this.closeMenu();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeMenu();
    });

    this.sigil.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.openMenu();
        const active = this.buttons.find((b) => b.dataset.mode === this.mode);
        (active || this.buttons[0]).focus();
      }
    });
  }

  clearTimer() {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = 0;
    }
  }

  openMenu() {
    this.menu.hidden = false;
    this.wrap.classList.add('is-open');
    this.sigil.setAttribute('aria-expanded', 'true');
    this.sigil.classList.add('is-lit');
  }

  closeMenu() {
    this.menu.hidden = true;
    this.wrap.classList.remove('is-open');
    this.sigil.setAttribute('aria-expanded', 'false');
    this.sigil.classList.remove('is-lit');
  }

  set(mode, { silent = false } = {}) {
    if (!LABELS[mode]) return;
    this.mode = mode;
    if (this.label) this.label.textContent = LABELS[mode];
    for (const button of this.buttons) {
      const active = button.dataset.mode === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    if (!silent) this.onMode?.(mode);
  }
}