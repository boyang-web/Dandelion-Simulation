/* ------------------------------------------------------------------ */
/*  Sky painter · the one place where sky state becomes pixels         */
/*                                                                     */
/*  The engine emits a plain paint snapshot every frame. Binding it to  */
/*  CSS custom properties (instead of a reactive object) keeps the      */
/*  60 fps path out of Vue's scheduler: the DOM stays declarative, the  */
/*  per-frame writes stay cheap.                                        */
/* ------------------------------------------------------------------ */

const fmt = (value, digits = 3) => Number(value).toFixed(digits);
const pct = (value) => `${(Number(value) * 100).toFixed(2)}%`;

export function createSkyPainter({
  root = document.documentElement,
  themeMeta = null,
  atmosphere = null,
  foreSky = null,
  glow = null,
  goldenVeil = null,
  nightVeil = null,
  stars = null,
  rays = null,
  arc = null,
  arcPath = null,
  arcLower = null,
  sun = null,
  moon = null
}) {
  const cache = new WeakMap();

  const remember = (el, key, value) => {
    if (!el) return true;
    let map = cache.get(el);
    if (!map) {
      map = new Map();
      cache.set(el, map);
    }
    if (map.get(key) === value) return true;
    map.set(key, value);
    return false;
  };

  const style = (el, name, value) => {
    if (!el || remember(el, `s:${name}`, value)) return;
    el.style.setProperty(name, value);
  };

  const opacity = (el, value) => {
    if (!el || remember(el, 'opacity', value)) return;
    el.style.opacity = value;
  };

  const attr = (el, name, value) => {
    if (!el || remember(el, `a:${name}`, value)) return;
    el.setAttribute(name, value);
  };

  const cls = (el, name, on) => {
    if (!el || remember(el, `c:${name}`, on)) return;
    el.classList.toggle(name, !!on);
  };

  return function paint(state) {
    if (!state) return;

    // --- celestial bodies -------------------------------------------
    const paintBody = (body, refs) => {
      if (!refs) return;
      style(refs.root, 'left', `${fmt(body.x, 2)}px`);
      style(refs.root, 'top', `${fmt(body.y, 2)}px`);
      opacity(refs.disc, fmt(body.disc));
      opacity(refs.halo, fmt(body.halo));
      style(refs.root, '--halo-color', body.haloColor || '');
      cls(refs.root, 'is-golden', body.golden);
      cls(refs.root, 'is-active', body.active);
      cls(refs.root, 'is-pressing', body.pressing);
      cls(refs.root, 'is-tipped', body.tipped);
      cls(refs.root, 'is-below', body.below);
      cls(refs.root, 'is-hidden', body.hidden);
      style(refs.root, 'pointer-events', body.pointerEvents ? 'auto' : 'none');
      attr(refs.root, 'aria-valuenow', String(state.time.pct));
      attr(refs.root, 'aria-valuetext', `时间 ${state.time.pct}%，${state.time.label}`);
    };

    paintBody(state.bodies.sun, sun);
    paintBody(state.bodies.moon, moon);

    // --- overlays ----------------------------------------------------
    opacity(nightVeil, fmt(state.night));
    opacity(stars, fmt(state.stars));
    opacity(goldenVeil, fmt(state.golden));
    if (goldenVeil) {
      style(goldenVeil, '--golden-x', pct(state.goldenX));
      style(goldenVeil, '--golden-y', pct(state.goldenY));
    }
    if (glow) {
      style(glow, '--glow-x', pct(state.glow.x));
      style(glow, '--glow-y', pct(state.glow.y));
      opacity(glow, fmt(state.glow.opacity));
    }
    if (rays) {
      style(rays, '--ray-x', pct(state.rays.x));
      style(rays, '--ray-y', pct(state.rays.y));
      style(rays, '--ray-rgb', state.rays.rgb);
      opacity(rays, fmt(state.rays.opacity));
    }

    for (const el of [atmosphere, foreSky]) {
      if (!el) continue;
      style(el, '--cloud-hi', state.clouds.hi);
      style(el, '--cloud-lo', state.clouds.lo);
      style(el, '--cloud-warm', state.clouds.warm);
    }

    // --- ink + theme -------------------------------------------------
    style(root, '--ink', state.ink.ink);
    style(root, '--ink-soft', state.ink.soft);
    style(root, '--ink-faint', state.ink.faint);
    style(root, '--ink-line', state.ink.line);
    attr(themeMeta, 'content', state.theme);

    // --- arc ---------------------------------------------------------
    if (arc) {
      attr(arc, 'viewBox', `0 0 ${state.viewWidth || 0} ${state.viewHeight || 0}`);
    }
    attr(arcPath, 'd', state.arc.above);
    attr(arcLower, 'd', state.arc.below);
    cls(arc, 'is-visible', state.arc.visible);
  };
}