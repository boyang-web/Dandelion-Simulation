import { defineComponent } from 'vue';
import { runtime, callApi } from '../../runtime.js';

export default defineComponent({
  name: 'SoundToggle',
  setup() {
    const toggle = (e) => {
      e.preventDefault();
      e.stopPropagation();
      callApi('toggleSound');
    };
    return { ui: runtime.ui, toggle };
  },
  template: `
    <button
      class="sound-button"
      type="button"
      :aria-pressed="ui.sound.on"
      @click="toggle"
    >{{ ui.sound.on ? '声音 开' : '声音 关' }}</button>
  `
});