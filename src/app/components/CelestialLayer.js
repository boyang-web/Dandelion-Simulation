import { defineComponent, onMounted, ref } from 'vue';
import CelestialBody from './CelestialBody.js';
import { runtime } from '../runtime.js';

/* ------------------------------------------------------------------ */
/*  Sun + moon + the faint orbit arc                                   */
/*  Arc sits after both bodies so the CSS hover sibling rule still      */
/*  reveals it when a body is hovered.                                  */
/* ------------------------------------------------------------------ */

export default defineComponent({
  name: 'CelestialLayer',
  components: { CelestialBody },
  setup() {
    const arc = ref(null);
    const arcPath = ref(null);
    const arcLower = ref(null);

    onMounted(() => {
      Object.assign(runtime.host.skyRefs, {
        arc: arc.value,
        arcPath: arcPath.value,
        arcLower: arcLower.value
      });
    });

    return { arc, arcPath, arcLower };
  },
  template: `
    <CelestialBody type="sun" label="太阳：拖动调整时间" />
    <CelestialBody type="moon" label="月亮：拖动调整时间" />

    <svg class="celestial-arc" ref="arc" aria-hidden="true" focusable="false">
      <path ref="arcPath"></path>
      <path ref="arcLower" class="celestial-arc__below"></path>
    </svg>
  `
});