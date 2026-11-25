import { defineComponent, onMounted, watch } from 'vue';
import AtmosphereLayer from './components/AtmosphereLayer.js';
import CelestialLayer from './components/CelestialLayer.js';
import SceneStage from './components/SceneStage.js';
import Masthead from './components/hud/Masthead.js';
import HintBar from './components/hud/HintBar.js';
import WindMeter from './components/hud/WindMeter.js';
import AbilityPanel from './components/hud/AbilityPanel.js';
import SoundToggle from './components/hud/SoundToggle.js';
import ContextHint from './components/hud/ContextHint.js';
import Toast from './components/hud/Toast.js';
import RecBadge from './components/hud/RecBadge.js';
import PostcardStrip from './components/hud/PostcardStrip.js';
import FilmButton from './components/hud/FilmButton.js';
import FilmPanel from './components/hud/FilmPanel.js';
import JourneyEnd from './components/hud/JourneyEnd.js';
import TouchPad from './components/hud/TouchPad.js';
import DebugPanel from './components/hud/DebugPanel.js';
import NoWebglNotice from './components/hud/NoWebglNotice.js';
import { createSkyPainter } from './lib/sky-painter.js';
import { runtime, callApi } from './runtime.js';

/* ------------------------------------------------------------------ */
/*  Root shell                                                         */
/*                                                                     */
/*  Owns the layer order (backdrop → canvas → sky → HUD), mirrors a few */
/*  shell flags onto <body> for the existing CSS, and wires the sky     */
/*  paint sink once every layer has mounted.                            */
/* ------------------------------------------------------------------ */

const BODY_FLAGS = [
  ['ready', 'ready'],
  ['interacted', 'interacted'],
  ['clean', 'clean'],
  ['noWebgl', 'no-webgl'],
  ['sky3d', 'sky-3d'],
  ['still', 'still'],
  ['orbitDragging', 'orbit-dragging']
];

export default defineComponent({
  name: 'App',
  components: {
    AtmosphereLayer,
    CelestialLayer,
    SceneStage,
    Masthead,
    HintBar,
    WindMeter,
    AbilityPanel,
    SoundToggle,
    ContextHint,
    Toast,
    RecBadge,
    PostcardStrip,
    FilmButton,
    FilmPanel,
    JourneyEnd,
    TouchPad,
    DebugPanel,
    NoWebglNotice
  },
  setup() {
    const ui = runtime.ui;

    for (const [key, className] of BODY_FLAGS) {
      watch(
        () => ui[key],
        (value) => document.body.classList.toggle(className, !!value),
        { immediate: true }
      );
    }

    onMounted(() => {
      // Children have mounted, so every sky ref is registered by now.
      const paint = createSkyPainter(runtime.host.skyRefs);
      runtime.host.paintSky = paint;
      runtime.api.value?.bindSkyPainter(paint);
    });

    function restart() {
      if (window.confirm('从头开始？旅程进度和明信片收集将重置，已存入胶片卷的照片会保留。')) {
        callApi('restartJourney');
      }
    }
    return { ui, restart };
  },
  template: `
    <AtmosphereLayer />
    <SceneStage />
    <CelestialLayer />

    <Masthead />
    <HintBar />
    <WindMeter />
    <AbilityPanel />
    <SoundToggle />
    <button v-if="ui.ready && !ui.clean" class="restart-button" type="button" @click.stop="restart">从头开始</button>

    <ContextHint />
    <Toast />
    <RecBadge />

    <PostcardStrip />
    <FilmButton />
    <FilmPanel />
    <JourneyEnd />

    <TouchPad />

    <NoWebglNotice />
    <DebugPanel />
  `
});