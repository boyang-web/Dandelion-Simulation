/* ------------------------------------------------------------------ */
/*  Runtime · the object shared by the Vue shell and the engine         */
/*                                                                     */
/*  - ui      : reactive store (engine → Vue)                          */
/*  - api     : the live experience instance (Vue → engine)            */
/*  - host    : non-reactive sinks (sky paint, refs) for 60 fps paths  */
/* ------------------------------------------------------------------ */

import { shallowRef } from 'vue';
import { createUiState } from './state/ui.js';

const store = createUiState();

export const runtime = {
  store,
  ui: store.ui,
  api: shallowRef(null),
  host: {
    paintSky: null,
    skyRefs: {}
  }
};

export function callApi(method, ...args) {
  const api = runtime.api.value;
  if (!api || typeof api[method] !== 'function') return undefined;
  return api[method](...args);
}