import { defineComponent } from 'vue';
import { runtime } from '../../runtime.js';

export default defineComponent({
  name: 'NoWebglNotice',
  setup() {
    return { ui: runtime.ui };
  },
  template: `
    <div class="no-webgl" :class="{ 'is-shown': ui.noWebgl }">
      <p>这片草地需要 WebGL 才能生长。</p>
      <p class="no-webgl__sub">请换一个支持 WebGL 的浏览器，或开启硬件加速后再来。</p>
    </div>
  `
});