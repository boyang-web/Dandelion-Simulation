import { defineComponent } from 'vue';
import { runtime } from '../../runtime.js';

export default defineComponent({
  name: 'DebugPanel',
  setup() {
    return { ui: runtime.ui };
  },
  template: `
    <pre class="debug" v-if="ui.debug.visible">{{ ui.debug.text }}</pre>
  `
});