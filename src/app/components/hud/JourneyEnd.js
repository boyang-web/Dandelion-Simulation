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
      <p class="journey-end__kicker">{{ ui.journeyEnd.album ? '明信片' : '山脊日晷' }}</p>
      <h2>{{ ui.journeyEnd.album ? '五张都在这儿了' : '今年的种子送到了' }}</h2>
      <p>{{ ui.journeyEnd.album ? '打开胶片卷，可以挑一张喜欢的照片下载。' : '石针的影子压住了去年的划痕。泉的两岸都有了蒲公英，孩子分给你的两把种子，都有了着落。' }}</p>
      <div class="journey-end__cards">
        <span v-for="card in ui.journeyEnd.cards" :key="card">{{ card }}</span>
      </div>
      <button class="journey-end__button" type="button" @click="continueJourney">回山谷看看</button>
    </section>
  `
});