import { defineComponent } from 'vue';
import { runtime } from '../../runtime.js';

export default defineComponent({
  name: 'WindMeter',
  setup() {
    return { ui: runtime.ui };
  },
  template: `
    <div class="meter" aria-hidden="true">
      <span class="meter__label">WIND</span>
      <span class="meter__track"><i class="meter__fill" :style="{ '--wind': ui.wind.toFixed(3) }"></i></span>
    </div>
  `
});