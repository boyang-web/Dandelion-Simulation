import { defineComponent, ref } from 'vue';
import { runtime, callApi } from '../../runtime.js';

/* ------------------------------------------------------------------ */
/*  TouchPad · joystick + contextual action buttons                    */
/*                                                                     */
/*  The button set is derived entirely from `ui.mobile` (engine side),  */
/*  so the touch HUD and the desktop HUD can never disagree.            */
/*  Props/state → markup only; all gestures call the engine API.        */
/* ------------------------------------------------------------------ */

export default defineComponent({
  name: 'TouchPad',
  setup() {
    const pad = ref(null);
    const knob = ref(null);
    const knobActive = ref(false);
    const liftActive = ref(false);

    let pointerId = null;

    const setFromEvent = (e) => {
      if (!pad.value || !knob.value) return;
      const rect = pad.value.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const max = rect.width * 0.32;
      let dx = e.clientX - cx;
      let dy = e.clientY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > max) {
        dx = (dx / dist) * max;
        dy = (dy / dist) * max;
      }
      knob.value.style.transform =
        `translate(-50%, -50%) translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
      callApi('joystick', dx / max, -dy / max);
    };

    const resetKnob = () => {
      if (knob.value) knob.value.style.transform = 'translate(-50%, -50%)';
      knobActive.value = false;
      callApi('releaseJoystick');
    };

    const onPadDown = (e) => {
      if (!runtime.ui.mobile.enabled) return;
      e.preventDefault();
      e.stopPropagation();
      pointerId = e.pointerId;
      try { pad.value.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
      knobActive.value = true;
      setFromEvent(e);
    };

    const onPadMove = (e) => {
      if (e.pointerId !== pointerId) return;
      e.preventDefault();
      e.stopPropagation();
      setFromEvent(e);
    };

    const onPadUp = (e) => {
      if (e.pointerId !== pointerId) return;
      e.preventDefault();
      e.stopPropagation();
      try { pad.value.releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }
      pointerId = null;
      resetKnob();
    };

    const onLiftDown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      liftActive.value = true;
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
      callApi('liftHeld', true);
    };

    const onLiftUp = (e) => {
      e.preventDefault();
      e.stopPropagation();
      liftActive.value = false;
      callApi('liftHeld', false);
    };

    const tap = (method) => (e) => {
      e.preventDefault();
      e.stopPropagation();
      callApi(method);
    };

    return {
      ui: runtime.ui,
      pad,
      knob,
      knobActive,
      liftActive,
      onPadDown,
      onPadMove,
      onPadUp,
      onLiftDown,
      onLiftUp,
      onCamera: tap('mobileCamera'),
      onShutter: tap('mobileShutter'),
      onRecord: tap('mobileRecord'),
      onInteract: tap('mobileInteract')
    };
  },
  template: `
    <div class="touch-ui" v-if="ui.mobile.enabled">
      <div
        class="joystick"
        :class="{ 'is-active': knobActive }"
        ref="pad"
        aria-label="移动摇杆"
        @pointerdown="onPadDown"
        @pointermove="onPadMove"
        @pointerup="onPadUp"
        @pointercancel="onPadUp"
        @lostpointercapture="onPadUp"
      >
        <div class="joystick__knob" ref="knob"></div>
      </div>

      <div class="touch-actions">
        <button
          v-if="ui.mobile.showInteract"
          class="touch-btn touch-btn--small"
          type="button"
          @click="onInteract"
        >交互</button>
        <button
          v-if="ui.mobile.cameraEnabled"
          class="touch-btn touch-btn--small"
          type="button"
          @click="onCamera"
        >{{ ui.mobile.cameraLabel }}</button>
        <button
          v-if="ui.mobile.showRecord"
          class="touch-btn touch-btn--small"
          type="button"
          @click="onRecord"
        >{{ ui.mobile.recordLabel }}</button>
        <button
          v-if="ui.mobile.liftEnabled"
          class="touch-btn touch-btn--lift"
          :class="{ 'is-active': liftActive }"
          type="button"
          @pointerdown="onLiftDown"
          @pointerup="onLiftUp"
          @pointercancel="onLiftUp"
          @lostpointercapture="onLiftUp"
        >升空</button>
        <button
          v-if="ui.mobile.showShutter"
          class="touch-btn touch-btn--shutter"
          type="button"
          @click="onShutter"
        >快门</button>
      </div>
    </div>
  `
});