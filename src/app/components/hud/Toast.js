import { defineComponent } from 'vue';
import { runtime } from '../../runtime.js';

export default defineComponent({
  name: 'Toast',
  setup() {
    return { ui: runtime.ui };
  },
  template: `
    <div class="toast" :class="{ 'is-visible': ui.toast.visible }" role="status" aria-live="polite">{{ ui.toast.text }}</div>
  `
});