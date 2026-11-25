import { defineComponent } from 'vue';
import { runtime } from '../../runtime.js';

export default defineComponent({
  name: 'PostcardStrip',
  setup() {
    return { ui: runtime.ui };
  },
  template: `
    <div class="postcard-strip" aria-label="明信片">
      <span
        v-for="card in ui.postcards"
        :key="card.id"
        class="postcard-chip"
        :class="{ 'is-on': card.on }"
        :title="card.title"
      >{{ card.title }}</span>
    </div>
  `
});