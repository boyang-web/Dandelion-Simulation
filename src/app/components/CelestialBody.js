import { defineComponent, ref } from 'vue';
import { runtime } from '../runtime.js';
import { callApi } from '../runtime.js';

/* ------------------------------------------------------------------ */
/*  A single celestial body (sun or moon)                              */
/*                                                                     */
/*  Rendered by Vue, positioned by the sky painter. All gestures are    */
/*  forwarded to the engine; the component only owns the pointer       */
/*  capture lifecycle and keyboard access.                             */
/* ------------------------------------------------------------------ */

export default defineComponent({
  name: 'CelestialBody',
  props: {
    type: { type: String, required: true },
    label: { type: String, default: '' }
  },
  setup(props) {
    const root = ref(null);
    const halo = ref(null);
    const disc = ref(null);

    runtime.host.skyRefs[props.type] = null;

    const register = () => {
      const slot = runtime.host.skyRefs;
      slot[props.type] = {
        root: root.value,
        halo: halo.value,
        disc: disc.value
      };
      // The painter may already exist (App mounted first) — repaint the body.
      if (runtime.host.paintSky && runtime.api.value) {
        runtime.api.value.bindSkyPainter(runtime.host.paintSky);
      }
    };

    const onPointerDown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const started = callApi('skyBeginPress', props.type, e);
      if (started && root.value) {
        try { root.value.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
      }
    };

    const onPointerMove = (e) => {
      e.stopPropagation();
      callApi('skyMovePress', e);
    };

    const onPointerUp = (e) => {
      e.stopPropagation();
      callApi('skyEndPress');
      if (root.value && root.value.hasPointerCapture?.(e.pointerId)) {
        try { root.value.releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }
      }
    };

    const onKeyDown = (e) => {
      const handled = callApi('skyNudge', e.key);
      if (handled) e.preventDefault();
    };

    return { root, halo, disc, register, onPointerDown, onPointerMove, onPointerUp, onKeyDown };
  },
  mounted() {
    this.register();
  },
  template: `
    <div
      class="celestial is-hidden"
      :class="'celestial--' + type"
      ref="root"
      role="slider"
      tabindex="0"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-label="label"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @lostpointercapture="onPointerUp"
      @keydown="onKeyDown"
    >
      <div class="celestial__halo" ref="halo"></div>
      <div class="celestial__disc" :class="'celestial__disc--' + type" ref="disc"></div>
      <div class="celestial__hint">拖动 · 拨动时间</div>
    </div>
  `
});