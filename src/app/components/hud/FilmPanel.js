import { defineComponent } from 'vue';
import { runtime, callApi } from '../../runtime.js';

/* ------------------------------------------------------------------ */
/*  Film roll panel                                                    */
/*  Items come straight from the store; downloads are plain links so   */
/*  the browser handles blob URLs without engine involvement.          */
/* ------------------------------------------------------------------ */

export default defineComponent({
  name: 'FilmPanel',
  setup() {
    const close = () => callApi('closeFilmPanel');
    return { ui: runtime.ui, close };
  },
  template: `
    <section class="film-panel" v-if="ui.film.open" aria-label="胶片卷">
      <header class="film-panel__head">
        <span>胶片卷</span>
        <button class="film-panel__close" type="button" aria-label="关闭胶片卷" @click="close">×</button>
      </header>

      <div class="film-grid">
        <figure class="film-item" v-for="item in ui.film.items" :key="item.id">
          <video
            v-if="item.type === 'video'"
            :src="item.url"
            controls
            muted
            playsinline
            preload="metadata"
          ></video>
          <img v-else :src="item.url" :alt="item.cardTitle || '风之照片'" />
          <figcaption>
            <span>{{ item.cardTitle || item.filename }}</span>
            <a :href="item.url" :download="item.filename">下载</a>
          </figcaption>
        </figure>
      </div>

      <p class="film-panel__empty" v-if="!ui.film.items.length">胶片卷还是空的。拍下的照片会保存在此，可随时选择下载。</p>
    </section>
  `
});