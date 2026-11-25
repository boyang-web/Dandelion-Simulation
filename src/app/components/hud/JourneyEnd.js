import { defineComponent } from 'vue';
import { runtime, callApi } from '../../runtime.js';

export default defineComponent({
  name: 'JourneyEnd',
  setup() {
    const continueJourney = () => callApi('dismissJourneyEnd');
    return { ui: runtime.ui, continueJourney };
  },
  template: `
    <section class="journey-end" v-if="ui.journeyEnd.visible" aria-label="旅程完成">
      <p class="journey-end__kicker">{{ ui.journeyEnd.album ? 'FIVE POSTCARDS' : 'TARAXACUM' }}</p>
      <h2>风经过的地方</h2>
      <p>{{ ui.journeyEnd.album ? '五张明信片收齐了。' : '日影落回约定的刻痕。你把春种送过了两岸，山谷终于又听见了春天的第一阵风。' }}</p>
      <div class="journey-end__cards">
        <span v-for="card in ui.journeyEnd.cards" :key="card">{{ card }}</span>
      </div>
      <button class="journey-end__button" type="button" @click="continueJourney">继续漫游</button>
    </section>
  `
});