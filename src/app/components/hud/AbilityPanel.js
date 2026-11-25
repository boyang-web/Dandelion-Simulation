import { defineComponent } from 'vue';
import { runtime } from '../../runtime.js';

export default defineComponent({
  name: 'AbilityPanel',
  setup() {
    return { ui: runtime.ui };
  },
  template: `
    <div class="ability-panel" aria-label="已解锁能力">
      <span class="ability-panel__title">能力</span>
      <span class="ability-panel__count">{{ ui.abilities.count }}/{{ ui.abilities.total }}</span>
      <span class="ability-panel__list">
        <span
          v-for="(item, index) in ui.abilities.items"
          :key="item.label + index"
          class="ability-pill"
          :class="{ 'ability-pill--base': item.base }"
        >{{ item.label }}</span>
      </span>
    </div>
  `
});