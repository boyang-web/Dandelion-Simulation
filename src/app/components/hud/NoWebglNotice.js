import { defineComponent } from 'vue';
import { runtime } from '../../runtime.js';

export default defineComponent({
  name: 'NoWebglNotice',
  setup() {
    return { ui: runtime.ui };
  },
  template: `
    <div class="no-webgl" :class="{ 'is-shown': ui.noWebgl }">
      <p>浏览器没能显示 3D 场景。</p>
      <p class="no-webgl__sub">请开启浏览器的硬件加速并刷新，或换用支持 WebGL 的浏览器。</p>
    </div>
  `
});