import { defineComponent } from 'vue';
import { runtime, callApi } from '../../runtime.js';

export default defineComponent({
  name: 'FilmButton',
  setup() {
    const toggle = (e) => {
      e.preventDefault();
      e.stopPropagation();
      callApi('toggleFilmPanel');
    };
    return { ui: runtime.ui, toggle };
  },
  template: `
    <button class="film-button" type="button" @click="toggle">
      胶片卷 <span>{{ ui.film.count }}</span>
    </button>
  `
});