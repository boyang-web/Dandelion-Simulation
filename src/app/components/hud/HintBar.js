import { defineComponent } from 'vue';
import { runtime } from '../../runtime.js';

/* Two hint lines live in the same node; CSS picks mouse or touch copy. */
export default defineComponent({
  name: 'HintBar',
  setup() {
    return { ui: runtime.ui };
  },
  template: `
    <div class="hint" role="status">
      <span class="hint__rule" aria-hidden="true"></span>
      <span class="hint__text hint__text--mouse">{{ ui.hint.mouse }}</span>
      <span class="hint__text hint__text--touch">{{ ui.hint.touch }}</span>
    </div>
  `
});