import { defineComponent } from 'vue';

import { runtime, callApi } from '../../runtime.js';

export default defineComponent({
  name: 'Masthead',
  setup: () => ({ ui: runtime.ui, toggleTrial: () => callApi('toggleTrial') }),
  template: `
    <header class="masthead">
      <h1 class="masthead__title">等风来</h1>
      <div v-if="ui.route && !ui.camera.active && !ui.camera.placing" class="route-note"><strong>{{ ui.route }}</strong><p>{{ ui.story }}</p></div>
      <div v-if="ui.memory && !ui.camera.active" class="route-note" role="status"><strong>{{ ui.memory[0] }}</strong><p>{{ ui.memory[1] }}</p></div>
      <div v-if="ui.trialAction && !ui.camera.active && !ui.camera.placing" class="route-note trial-note">
        <button type="button" @click.stop="toggleTrial">{{ ui.trialAction }}</button>
        <p v-if="ui.trialStatus">{{ ui.trialStatus }}</p>
      </div>
      <details v-if="ui.memories.length && !ui.memory && !ui.camera.active && !ui.camera.placing" class="memory-book">
        <summary>风灵手记 · {{ ui.memories.length }}</summary>
        <article v-for="entry in ui.memories" :key="entry[0]"><strong>{{ entry[0] }}</strong><p>{{ entry[1] }}</p></article>
      </details>
    </header>
    <div v-if="ui.windGuide && !ui.clean" class="wind-guide" :style="{ left: ui.windGuide.x+'px', top: ui.windGuide.y+'px' }">
      <span>{{ ui.windGuide.text }}</span><i></i>
    </div>
  `
});