import { defineComponent } from 'vue';
import { runtime } from '../../runtime.js';

export default defineComponent({
  name: 'ContextHint',
  setup() {
    return { ui: runtime.ui };
  },
  template: `
    <div class="context-hint" :class="{ 'is-visible': !!ui.context }" role="status">{{ ui.context }}</div>
  `
});