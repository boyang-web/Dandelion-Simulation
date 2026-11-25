import { defineComponent, onBeforeUnmount, onMounted, ref } from 'vue';
import { createExperience } from '../../engine/experience.js';
import { runtime } from '../runtime.js';

/* ------------------------------------------------------------------ */
/*  SceneStage · owns the two WebGL canvases and the engine lifecycle   */
/*  The component is intentionally thin: mount → boot, unmount → stop.  */
/* ------------------------------------------------------------------ */

export default defineComponent({
  name: 'SceneStage',
  setup() {
    const stage = ref(null);
    const fireflies = ref(null);

    onMounted(() => {
      runtime.api.value = createExperience({
        canvas: stage.value,
        fireflyCanvas: fireflies.value,
        store: runtime.store,
        host: runtime.host
      });
    });

    onBeforeUnmount(() => {
      runtime.api.value?.dispose?.();
      runtime.api.value = null;
      delete window.__dandy;
    });

    return { stage, fireflies };
  },
  template: `
    <canvas
      id="stage"
      ref="stage"
      aria-label="环山谷地，拖动环视，滑过草地制造风"
    ></canvas>
    <canvas id="fireflies" ref="fireflies" aria-hidden="true"></canvas>
  `
});