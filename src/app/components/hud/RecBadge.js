import { defineComponent } from 'vue';
import { runtime } from '../../runtime.js';

export default defineComponent({
  name: 'RecBadge',
  setup() {
    return { ui: runtime.ui };
  },
  template: `
    <div class="rec-badge" v-if="ui.record.visible" aria-hidden="true">
      <i></i><span>REC</span><b>{{ ui.record.time.toFixed(1) }}s</b>
    </div>
  `
});