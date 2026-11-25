/* ------------------------------------------------------------------ */
/*  UI store · the single source of truth for everything on screen     */
/*                                                                     */
/*  The engine writes plain data here (never DOM). Vue components read  */
/*  it. This is the one seam between the simulation and the interface.  */
/* ------------------------------------------------------------------ */

import { reactive } from 'vue';

const MOUSE_HINT = 'WASD · 移动　·　拖动 · 环绕/俯仰　·　滚轮 · 缩放　·　点击 · 种植';
const TOUCH_HINT = '左摇杆 · 移动　·　右侧拖动 · 环视　·　轻点 · 种植';

export function createUiState() {
  const ui = reactive({
    ready: false,
    interacted: false,
    clean: false,
    noWebgl: false,
    sky3d: false,
    still: false,
    orbitDragging: false,

    wind: 0.04,
    hint: { mouse: MOUSE_HINT, touch: TOUCH_HINT },

    abilities: {
      total: 5,
      count: 0,
      items: [
        { label: '地面', base: true },
        { label: '1 株', base: true }
      ]
    },

    context: '',
    route: '',
    trialAction: '',
    trialStatus: '',
    story: '',
    memory: null,
    memories: [],
    windGuide: null,

    toast: { text: '', visible: false },

    postcards: [],

    film: { items: [], open: false, count: 0 },

    journeyEnd: { visible: false, cards: [] },

    record: { visible: false, time: 0 },

    sound: { on: true, supported: true },

    mobile: { enabled: false },

    sky: {
      time: { pct: 40, label: '午后' },
      interactive: false,
      visibleBody: 'sun'
    },

    camera: { active: false, placing: false, placed: false },

    debug: { visible: false, text: '' }
  });

  let toastTimer = 0;
  let contextValue = '';

  const actions = {
    showToast(text, ms = 2800) {
      ui.toast.text = String(text);
      ui.toast.visible = true;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { ui.toast.visible = false; }, ms);
    },

    setContext(text) {
      const value = text || '';
      if (value === contextValue) return;
      contextValue = value;
      ui.context = value;
    },

    setWind(value) {
      ui.wind = value;
    },

    markInteracted() {
      if (ui.interacted) return;
      ui.interacted = true;
    },

    setReady() {
      ui.ready = true;
    },

    dispose() {
      clearTimeout(toastTimer);
    }
  };

  return { ui, ...actions };
}