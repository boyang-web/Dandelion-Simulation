/* ------------------------------------------------------------------ */
/*  Mobile input · joystick + lift + camera + shutter + interact       */
/*                                                                     */
/*  Framework refactor: this module no longer owns DOM nodes. The Vue  */
/*  <TouchPad> component renders the thumb stick and the action buttons */
/*  and forwards normalised input here; the experience derives the      */
/*  visible button set in `ui.mobile`, so the engine and the UI stay    */
/*  in one direction only (engine → store → markup).                    */
/* ------------------------------------------------------------------ */

export class MobileControls {
  constructor({
    player,
    onCamera,
    onShutter,
    onRecord,
    onInteract
  }) {
    this.player = player;
    this.onCamera = onCamera;
    this.onShutter = onShutter;
    this.onRecord = onRecord;
    this.onInteract = onInteract;

    this.enabled = false;
    this.joystickActive = false;
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (!this.enabled) {
      this.resetJoystick();
      this.player.setMoveInput(0, 0);
      this.player.setLiftHeld(false);
    }
  }

  /** Normalised stick vector, x/y in -1..1 (y is up). */
  setJoystick(x, y) {
    if (!this.enabled) return;
    this.joystickActive = x !== 0 || y !== 0;
    this.player.setMoveInput(x, y);
  }

  resetJoystick() {
    this.joystickActive = false;
    this.player.setMoveInput(0, 0);
  }

  setLiftHeld(on) {
    if (!this.enabled) return;
    this.player.setLiftHeld(on);
  }

  camera() {
    if (this.enabled) this.onCamera?.();
  }

  shutter() {
    if (this.enabled) this.onShutter?.();
  }

  record() {
    if (this.enabled) this.onRecord?.();
  }

  interact() {
    if (this.enabled) this.onInteract?.();
  }

  /**
   * Derive everything the touch HUD needs to show, from the current
   * progression / camera / anchor state.
   */
  describe({
    liftEnabled,
    cameraEnabled,
    cameraActive,
    placing,
    canInteract,
    recording
  }) {
    if (!this.enabled) return { enabled: false };
    return {
      enabled: true,
      liftEnabled: !!liftEnabled,
      cameraEnabled: !!cameraEnabled,
      cameraLabel: cameraActive ? '退出' : placing ? '取消' : '相机',
      showShutter: !!cameraEnabled && !placing,
      showRecord: !!cameraActive,
      recordLabel: recording ? '停止' : '录制',
      showInteract: !!canInteract && !cameraActive && !placing
    };
  }
}