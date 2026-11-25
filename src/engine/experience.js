import { createValleyTrials } from './valley-trials.js';
import { createValleyLevels, SEED_GOALS } from './valley-levels.js';
import { START, WALK_MARKER, FIRST_BED } from './wind-route.js';
import * as THREE from 'three';
import { WindField } from './wind.js';
import { createValleyWorld } from './world.js';
import { DANDELION_PARAMS } from './dandelion.js';
import { DandelionField } from './dandelion-field.js';
import { OrbitRig } from './orbit.js';
import { Tumbleweed } from './player.js';
import { Sky } from './sky.js';
import { createPostPipeline } from './post.js';
import { createDevConsole } from './dev-console.js';
import { Abilities, ABILITY_LABELS, ABILITY_ORDER } from './abilities.js';
import { Anchors } from './anchors.js';
import { FilmCamera } from './film-camera.js';
import { capturePlaceholderPhoto, createVideoRecorder } from './capture.js';
import { createJourneyAssets } from './journey-assets.js';
import { MobileControls } from './mobile-controls.js';
import { Ambience } from './audio.js';
import { FilmArchive } from './film-archive.js';

/* ------------------------------------------------------------------ */
/*  The valley experience                                              */
/*                                                                     */
/*  Framework refactor note: this module used to be main.js and also    */
/*  scrolled through a dozen `getElementById` calls. It is now a pure   */
/*  engine: scene, input and progression. Everything visual is pushed  */
/*  into the reactive store (`ui`) or the sky paint sink, and the Vue   */
/*  components render it. No `document.querySelector` lives here.       */
/* ------------------------------------------------------------------ */

const MAX_WILD_PLANTS = 15;
const SOUND_KEY = 'dandelion.sound';

const isTypingTarget = (target) => {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
};

export function createExperience({
  canvas,
  fireflyCanvas,
  store,
  params = new URLSearchParams(window.location.search),
  host = {}
}) {
  const ui = store.ui;

  const isDebug = params.has('debug');
  const isAuto = params.has('auto');
  const isDev = params.has('dev');
  const isClean = params.has('clean');
  const timeParam = parseFloat(params.get('time') ?? '');
  const initialTime = Number.isFinite(timeParam)
    ? Math.max(0, Math.min(1, timeParam))
    : 0.4;
  const coarse = window.matchMedia('(pointer: coarse)').matches;

  ui.clean = isClean;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
  } catch (err) {
    ui.noWebgl = true;
    console.error('[dandelion] WebGL unavailable', err);
    return createFailedExperience({ ui, params });
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.6 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    54,
    window.innerWidth / window.innerHeight,
    0.1,
    1400
  );

  // A small three-light setup: warm key from the sun, cool sky fill, and a
  // soft rim from behind so the meadow and stems have some shape.
  const hemi = new THREE.HemisphereLight(0xfff6e5, 0x5a6742, 1.0);
  const keyLight = new THREE.DirectionalLight(0xffddb0, 1.9);
  keyLight.position.set(5.5, 8.5, 4.5);
  const fill = new THREE.DirectionalLight(0xcfe4e8, 0.35);
  fill.position.set(-6, 3.2, 4.0);
  const rim = new THREE.DirectionalLight(0xffe4bd, 0.55);
  rim.position.set(-2.5, 4.5, -6.0);
  scene.add(hemi, keyLight, fill, rim);

  const wind = new WindField(camera);
  const quality = params.get('quality') || 'auto';
  const world = createValleyWorld(scene, { camera, quality });

  /* ---------------- progression ---------------- */

  world.levels = createValleyLevels(scene,world);
  const levels = world.levels;
  const abilities = new Abilities();
  if (params.has('reset')) abilities.reset();
  const trials=createValleyTrials(scene,world,abilities,text=>store.showToast(text));

  const memories = {
    oldTree: ['老树的约定', '树洞里响起一个熟悉的声音：“等花长出白绒，你还来吗？”去年也是这个孩子，蹲在这里等你送种子。'],
    windmill: ['磨坊的铃声', '磨坊主探出窗来：“听见第一声，大伙儿就下地。第二声，我去开闸。”他把最短的铃推到你跟前：“这只归你。”'],
    updraft: ['浮岛的来信', '岛下的树根挂着一张旧纸条。你认得自己的字：“山下的花谢了。要留种，去上头找。”'],
    skyGarden: ['云圃的种箱','最高的岩台上搁着上一任风灵的种箱。箱子见了底，你才看清木板上的小字：“有多的，给山下留一把。”'],
    spring: ['泉边的脚印', '那年泉水快干了。孩子把手里的种子分成两把，指了指对岸：“那边也得有。”'],
    sundial: ['归期', '一粒种子卡在日晷的细槽里。你记得这道划痕。去年你送完种子回来，石针的影子刚好落在这儿。']
  };
  function refreshMemories() {
    ui.memories = Object.keys(memories).filter(id => abilities.state.settings['memory-' + id]).map(id => memories[id]);
  }
  refreshMemories();
  let moved = !!abilities.state.settings.walked || abilities.has('camera');
  let memoryUntil = 0;

  const field = new DandelionField({
    scene,
    camera,
    renderer,
    wind,
    maxPlants: abilities.maxPlants
  });

  const player = new Tumbleweed({
    scene,
    world,
    position: new THREE.Vector3(START.x, 0, START.z)
  });

  const journey = createJourneyAssets({ scene, world, onTexturesReady() {
    if (ui.still) renderScene();
  } });

  const anchors = new Anchors({
    scene,
    world,
    abilities,
    onUnlock: handleAbilityUnlock,
    onSolve: handleAnchorSolved,
    onToast: (text) => store.showToast(text)
  });

  for (const item of anchors.items) {
    if (item.solved) journey.onAnchorSolved(item.def.id, false);
  }

  const filmCamera = new FilmCamera({
    scene,
    camera,
    canvas,
    world,
    getFocus: () => player.focusPoint(),
    onPlace: placeFilmCamera,
    onToast: (text) => store.showToast(text)
  });

  const orbit = new OrbitRig(camera, canvas, {
    target: player.focusPoint(),
    minRadius: 4,
    maxRadius: 180,
    minPitch: 0.01,
    maxPitch: Math.PI / 2 - 0.02,
    touchOrbit: coarse,
    // Third-person orbit: drag revolves the camera around the vertical axis
    // through the tumbleweed. Free-look (turning in place) made the valley
    // swing past the camera and feel disorienting.
    freeLook: false,
    groundAt: world.heightAt,
    clearance: 1.8
  });
  orbit.radius = coarse ? 15 : 13.5;
  orbit.pitch = coarse ? 0.22 : 0.16;
  orbit.yaw = 0.8;
  orbit.onDragStart = () => { if (!coarse) wind.setEnabled(false); };
  orbit.onDragEnd = () => { if (!coarse) wind.setEnabled(true); };
  orbit.onDraggingChange = (on) => { ui.orbitDragging = !!on; };
  if (coarse) wind.setEnabled(false);

  const mobileControls = new MobileControls({
    player,
    onCamera: () => toggleFilmCamera(),
    onShutter: () => requestPhoto(),
    onRecord: () => toggleVideo(),
    onInteract: () => anchors.interact()
  });
  mobileControls.setEnabled(coarse);

  /* ---------------- ambience ---------------- */

  let soundOn = true;
  try { soundOn = localStorage.getItem(SOUND_KEY) !== 'off'; } catch (err) { /* private mode */ }

  const ambience = new Ambience({ enabled: soundOn });
  ui.sound.on = ambience.enabled;
  ui.sound.supported = ambience.supported;

  function setSound(on) {
    ui.sound.on = !!on;
    try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off'); } catch (err) { /* ignore */ }
  }

  function toggleSound() {
    if (!ambience.ctx) ambience.start();
    const on = ambience.toggle();
    setSound(on);
    if (on) ambience.play('place');
    return on;
  }

  // Browsers only allow audio after a gesture; the first tap or key press
  // creates the context, and later ones just resume it if it was suspended.
  function unlockAudio() {
    ambience.start();
  }
  window.addEventListener('pointerdown', unlockAudio, { capture: true });
  window.addEventListener('keydown', unlockAudio, { capture: true });

  /* ---------------- camera follow ---------------- */

  function followPlayer() {
    player.focusPoint(orbit.target);
    orbit.apply();
  }

  const sky = new Sky({
    wind,
    world,
    keyLight,
    hemi,
    fill,
    rim,
    initial: initialTime,
    camera,
    celestial3D: true,
    coarse
  });

  let activeCamera = camera;
  player.setLiftEnabled(abilities.has('lift'));
  field.setMaxPlants(abilities.maxPlants);
  sky.setInteractive(abilities.has('time'));
  ui.sky3d = true;

  const post = createPostPipeline({
    renderer,
    scene,
    camera,
    enabled: params.get('post') !== '0'
  });

  sky.post = post;

  function renderScene() {
    post.setTime(sky.lightState, sky.lightState.sunDir);
    post.render(activeCamera);
  }

  /* ---------------- fireflies layer ---------------- */

  let fireflyRenderer = null;
  const fireflyScene = new THREE.Scene();
  const fireflyCamera = new THREE.PerspectiveCamera(
    54,
    window.innerWidth / window.innerHeight,
    0.1,
    1400
  );

  if (fireflyCanvas) {
    try {
      fireflyRenderer = new THREE.WebGLRenderer({
        canvas: fireflyCanvas,
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance'
      });
      fireflyRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.6 : 2));
      fireflyRenderer.setSize(window.innerWidth, window.innerHeight);
      fireflyRenderer.outputColorSpace = THREE.SRGBColorSpace;
      fireflyRenderer.toneMapping = THREE.NoToneMapping;
      fireflyRenderer.setClearColor(0x000000, 0);
      fireflyScene.add(world.fireflies.points);
    } catch (err) {
      fireflyRenderer = null;
    }
  }

  function renderFireflies() {
    if (!fireflyRenderer) return;
    fireflyCamera.copy(activeCamera);
    fireflyCamera.updateMatrixWorld();
    fireflyRenderer.render(fireflyScene, fireflyCamera);
  }

  let devConsole = null;
  if (isDev) {
    devConsole = createDevConsole({
      wind,
      dandelion: { params: DANDELION_PARAMS },
      sky,
      world,
      fireflies: world.fireflies,
      birds: world.birds,
      post
    });
  }

  /* ---------------- framing ---------------- */

  function frameCamera() {
    const aspect = window.innerWidth / window.innerHeight;
    const portrait = aspect < 0.8;
    camera.fov = portrait ? 58 : 54;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();

    if (!orbit.hasView) {
      orbit.radius = portrait ? (coarse ? 18 : 16) : (coarse ? 15 : 13.5);
      orbit.pitch = portrait ? 0.22 : 0.16;
      orbit.fov = camera.fov;
    }
    if (activeCamera === camera) orbit.apply();
    camera.updateMatrixWorld();
    filmCamera.setAspect(aspect);

    fireflyCamera.fov = camera.fov;
    fireflyCamera.aspect = aspect;
    fireflyCamera.updateProjectionMatrix();

    sky.sync(activeCamera);
  }
  frameCamera();

  /* ---------------- HUD ---------------- */

  function updateAbilityPanel() {
    const unlocked = ABILITY_ORDER.filter((name) => abilities.has(name));
    ui.abilities.count = unlocked.length;
    ui.abilities.total = ABILITY_ORDER.length;

    const labels = ['地面', `${field.maxPlants} 株`];
    for (const name of unlocked) labels.push(ABILITY_LABELS[name]);
    ui.abilities.items = labels.map((label, index) => ({
      label,
      base: index < 2
    }));
  }

  function updateHint() {
    const mouse = ['WASD · 移动'];
    const touch = ['左摇杆 · 移动'];
    if (moved) { mouse.push('点击草地 · 种花'); touch.push('轻点草地 · 种花'); }
    if (abilities.has('camera') || ui.memories.length) { mouse.push('滚过花旁 · 送种'); touch.push('滚过花旁 · 送种'); }
    if (abilities.has('camera')) {
      mouse.push('C · 相机', 'P · 拍照', 'V · 录像');
      touch.push('相机/快门');
    }
    if (abilities.has('lift')) {
      mouse.push('Space · 升空');
      touch.push('升空');
    }
    if (abilities.has('time')) mouse.push('拖动日月 · 调时间');
    ui.hint.mouse = mouse.join('　·　');
    ui.hint.touch = touch.join('　·　');
  }

  function refreshHUD() {
    updateAbilityPanel();
    updateHint();
  }

  /* ---------------- film archive ---------------- */

  const filmArchive = new FilmArchive({
    abilities,
    ui,
    onReadError: () => store.showToast('暂时无法读取本机相册'),
    onJourneyComplete: () => store.showToast('五张明信片收齐了')
  });

  function refreshPostcards() {
    filmArchive.refreshPostcards(anchors);
  }

  function checkJourneyEnd() {
    filmArchive.checkJourneyEnd(anchors);
  }

  /* ---------------- video ---------------- */

  let videoTarget = null;

  const videoRecorder = createVideoRecorder({
    duration: 5,
    onDone: handleVideoDone,
    onEmpty: () => {
      ui.record.visible = false;
      videoTarget = null;
      store.showToast('这段短片没录成，改拍一张照片。');
      takePhoto();
    },
    onUnsupported: () => store.showToast('这个浏览器暂不支持录制视频')
  });

  function handleVideoDone(filename, blob, duration) {
    ui.record.visible = false;
    const target = videoTarget;
    videoTarget = null;

    filmArchive.addCapture(blob, filename, {
      type: 'video',
      anchor: target?.def.id,
      cardTitle: target?.def.cardTitle,
      duration
    });

    let postcardAdded = false;
    if (target && blob) {
      postcardAdded = abilities.addPostcard(target.def.postcard);
      refreshPostcards();
    }

    if (window.__dandy) {
      window.__dandy.lastCapture = {
        filename,
        size: blob ? blob.size : 0,
        postcard: target?.def.postcard || null,
        type: 'video',
        duration
      };
    }

    if (postcardAdded && target) {
      store.showToast(`明信片 · ${target.def.cardTitle}`);
      checkJourneyEnd();
    } else {
      store.showToast('短片已保存');
    }
  }

  function startVideo() {
    if (!abilities.has('camera') || filmCamera.isPlacing) {
      store.showToast(filmCamera.isPlacing ? '先选一处草地安放相机' : '先去老树那里拿相机');
      return;
    }
    if (!videoRecorder) {
      store.showToast('这个浏览器暂不支持录制视频');
      return;
    }
    if (videoRecorder.active) {
      stopVideo();
      return;
    }

    videoTarget = anchors.getPhotoTarget(player.root.position);
    if (!videoRecorder.start()) {
      store.showToast('视频录制启动失败');
      return;
    }
    ambience.play('recordStart');
    // Paint one frame right away so the encoder always receives a first frame,
    // even when the render loop is running slowly on a weak device.
    videoRecorder.frame({ renderer, fireflyCanvas, sky });
    ui.record.visible = true;
    ui.record.time = 0;
    store.showToast(`录制 ${videoRecorder.duration} 秒 · V 停止`);
  }

  function stopVideo() {
    if (!videoRecorder || !videoRecorder.active) return;
    videoRecorder.stop();
    ambience.play('recordStop');
    ui.record.visible = false;
    store.showToast('正在生成短片…');
  }

  function toggleVideo() {
    if (videoRecorder?.active) stopVideo();
    else startVideo();
  }

  /* ---------------- progression callbacks ---------------- */

  function handleAnchorSolved(id) {
    journey.onAnchorSolved(id);
    abilities.state.settings.checkpoint = id;
    abilities.save();
    if (id === 'sundial') {
      ui.journeyEnd.cards = anchors.items.map(item => item.def.label);
      ui.journeyEnd.visible = true;
      ui.journeyEnd.album = false;
    }
    if (id === 'oldTree') {
      // The first offering becomes the tree's bloom; free the single plant
      // slot for the three windmill eyes.
      field.removeNearest(journey.oldTree.group.position.x, journey.oldTree.group.position.z, 10);
    }
  }

  function handleAbilityUnlock(name) {
    ambience.play('unlock');
    if (name === 'multiPlant' || name === 'restore' || name === 'time') {
      field.setMaxPlants(abilities.maxPlants);
    }
    if (name === 'lift') {
      player.setLiftEnabled(true);
    }
    if (name === 'time') {
      sky.setInteractive(true);
    }
    refreshHUD();
    refreshPostcards();
  }

  /* ---------------- film camera controls ---------------- */

  let liftHintShown = false;

  function enterFilmView(message) {
    activeCamera = filmCamera.camera;
    orbit.setEnabled(false);
    wind.setEnabled(false);
    filmCamera.activate();
    filmCamera.setAspect(window.innerWidth / window.innerHeight);
    sky.sync(activeCamera);
    store.setContext(coarse ? '拖动瞄准 · 点快门拍照 · 点退出返回' : '拖动瞄准 · P 拍照 · Esc 返回');
    if (message) store.showToast(message);
  }

  function placeFilmCamera() {
    ambience.play('place');
    enterFilmView('相机已安放 · 拖动瞄准 · P 拍照 · V 录制');
  }

  function activateFilmCamera() {
    if (!filmCamera.placed) return;
    enterFilmView('相机已就位 · P 拍照 · V 录制');
  }

  function deactivateFilmCamera(silent = false) {
    if (videoRecorder?.active) stopVideo();
    filmCamera.deactivate();
    activeCamera = camera;
    orbit.setEnabled(true);
    wind.setEnabled(!coarse);
    followPlayer();
    sky.sync(camera);
    store.setContext('');
    if (!silent) store.showToast('回到风滚草视角');
  }

  function beginFilmPlacement() {
    if (!abilities.has('camera')) {
      store.showToast('相机在老树那里。先把种子送进树洞。');
      return;
    }
    if (filmCamera.isActive) deactivateFilmCamera(true);
    orbit.setEnabled(false);
    wind.setEnabled(false);
    filmCamera.beginPlacement();
    store.setContext('点击草地安放相机　·　Esc 取消');
    store.showToast('点击草地安放相机');
  }

  function cancelFilmPlacement() {
    filmCamera.cancelPlacement();
    orbit.setEnabled(true);
    wind.setEnabled(!coarse);
    store.setContext('');
    store.showToast('已取消安放');
  }

  function toggleFilmCamera() {
    if (!abilities.has('camera')) {
      store.showToast('相机在老树那里。先把种子送进树洞。');
      return;
    }
    if (filmCamera.isPlacing) {
      cancelFilmPlacement();
      return;
    }
    if (filmCamera.isActive) {
      deactivateFilmCamera();
      return;
    }
    if (filmCamera.placed) {
      activateFilmCamera();
      return;
    }
    beginFilmPlacement();
  }

  function repositionFilmCamera() {
    if (!abilities.has('camera')) {
      store.showToast('相机在老树那里。先把种子送进树洞。');
      return;
    }
    if (filmCamera.isPlacing) {
      cancelFilmPlacement();
      return;
    }
    beginFilmPlacement();
  }

  function takePhoto() {
    const target = anchors.getPhotoTarget(player.root.position);
    const shot = capturePlaceholderPhoto({
      renderer,
      fireflyCanvas,
      sky,
      onDone: async (filename, blob) => {
        if (!blob) { store.showToast('没拍下来，请再试一次。'); return; }
        const photo = await filmArchive.addCapture(blob, filename, {
          type: 'photo',
          anchor: target?.def.id,
          cardTitle: target?.def.cardTitle
        });

        if (!photo) return;
        let postcardAdded = false;
        if (target && blob) {
          postcardAdded = abilities.addPostcard(target.def.postcard);
          refreshPostcards();
        }

        if (window.__dandy) {
          window.__dandy.lastCapture = {
            filename,
            size: blob ? blob.size : 0,
            postcard: target?.def.postcard || null
          };
        }

        if (postcardAdded && target) {
          checkJourneyEnd();
        }
        store.showToast(photo.saved
          ? (postcardAdded ? `明信片 · ${target.def.cardTitle} · 已存入胶片卷` : '照片已存入胶片卷')
          : '本机存储不可用 · 请在离开前到胶片卷下载照片');
      }
    });
    if (shot) ambience.play('shutter');
    else store.showToast('没拍下来，请再试一次。');
  }

  function captureNow() {
    renderScene();
    renderFireflies();
    takePhoto();
  }

  function requestPhoto() {
    if (!abilities.has('camera') || filmCamera.isPlacing) {
      store.showToast(filmCamera.isPlacing ? '先选一处草地安放相机' : '先去老树那里拿相机');
      return;
    }
    if (videoRecorder?.active) stopVideo();
    store.showToast('正在拍照…');
    // Render the active camera immediately, then copy the frame. This keeps
    // the shutter independent of the animation loop's next tick.
    captureNow();
  }

  /* ---------------- keyboard ---------------- */

  function onKeyDown(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (isTypingTarget(e.target)) return;

    if (e.code === 'KeyG' && !e.repeat) { trials.toggle(elapsed);return; }
    if (e.code === 'KeyC') {
      e.preventDefault();
      toggleFilmCamera();
      return;
    }
    if (e.code === 'KeyX') {
      e.preventDefault();
      repositionFilmCamera();
      return;
    }
    if (e.code === 'KeyP') {
      e.preventDefault();
      requestPhoto();
      return;
    }
    if (e.code === 'KeyV') {
      e.preventDefault();
      toggleVideo();
      return;
    }
    if (e.code === 'KeyE') {
      e.preventDefault();
      anchors.interact();
      return;
    }
    if (e.code === 'Escape') {
      if (filmCamera.isPlacing) {
        e.preventDefault();
        cancelFilmPlacement();
      } else if (filmCamera.isActive) {
        e.preventDefault();
        deactivateFilmCamera();
      }
      return;
    }
    if (e.code === 'Space') {
      e.preventDefault();
      if (abilities.has('lift')) {
        player.setLiftHeld(true);
      } else if (!liftHintShown) {
        liftHintShown = true;
        store.showToast('先去苗圃，让三株花各送进四粒种子，就能起飞了。');
      }
    }
  }

  function onKeyUp(e) {
    if (e.code === 'Space') player.setLiftHeld(false);
  }

  function onBlur() {
    player.setLiftHeld(false);
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  refreshHUD();
  refreshPostcards();

  /* ---------------- wind meter + intro state ---------------- */

  let lastShownWind = -1;

  function updateUI() {
    const shown = Math.min(
      1,
      0.04 + Math.max(wind.strength, wind.energy, wind.playerStrength, wind.breezePower * 0.55) * 0.96
    );
    if (Math.abs(shown - lastShownWind) > 0.012) {
      store.setWind(shown);
      lastShownWind = shown;
    }

    if (!ui.interacted && (wind.strength > 0.12 || field.count > 0 || orbit.hasView)) {
      store.markInteracted();
    }
  }

  /* ---------------- planting (tap) ---------------- */

  const planterRay = new THREE.Raycaster();
  const planterNdc = new THREE.Vector2();
  const taps = new Map();
  let tapMulti = false;

  function onCanvasPointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (taps.size > 0) tapMulti = true;
    taps.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
      // Event timestamps, not handler time: a heavy frame can delay the
      // pointerup handler by several hundred milliseconds even for a short tap.
      time: e.timeStamp,
      moved: false
    });
  }

  function onCanvasPointerMove(e) {
    const tap = taps.get(e.pointerId);
    if (!tap) return;
    if (Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 8) tap.moved = true;
  }

  function finishTap(e) {
    const tap = taps.get(e.pointerId);
    if (!tap) return;
    const multi = tapMulti;
    taps.delete(e.pointerId);
    if (taps.size === 0) tapMulti = false;

    // The film camera owns the canvas while framing / aiming; a click there
    // must not also plant a dandelion.
    if (filmCamera.isActive || filmCamera.isPlacing) return;

    if (multi || tap.moved) return;
    if (e.timeStamp - tap.time > 650) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    if (!moved) { store.showToast(coarse ? '先推动左摇杆，试着滚动' : '先按 WASD，试着滚动'); return; }

    planterNdc.set(
      (e.clientX / window.innerWidth) * 2 - 1,
      -(e.clientY / window.innerHeight) * 2 + 1
    );
    planterRay.setFromCamera(planterNdc, camera);
    const hits = planterRay.intersectObjects([world.ground,...levels.islands.map(i=>i.cap)],false);
    if (!hits.length) return;

    const point = hits[0].point;
    const guide=ui.windGuide;
    if(guide && Math.abs(e.clientX-guide.x)<55 && e.clientY>=guide.y-45 && e.clientY<=guide.y+12){
      if(guide.text==='点这里种花') point.copy(firstBed);
      if(guide.bedIndex!=null){
        const bed=levels.beds[guide.bedIndex];
        point.set(bed.x,world.heightAt(bed.x,bed.z),bed.z);
      }
    }
    const r = Math.hypot(point.x, point.z);
    // Keep planting in the meadow and lower foothills; the high mountain
    // faces are intentionally left to grass and rock.
    if (r > 118 || (hits[0].object === world.ground && point.y > 30)) return;
    const deck=levels.islands.find(i=>i.cap===hits[0].object);
    if(deck && (player.airborne || levels.islandAt(player.root.position.x,player.root.position.z)!==deck ||
        Math.abs(player.root.position.y-deck.top-.64)>.4 || Math.abs(point.y-deck.top)>.08)) {
      store.showToast('先落在岩台草面上，再播下种子'); return;
    }
    if (!deck && world.slopeAt && world.slopeAt(point.x, point.z) > 0.44) return;
    if(levels.blocked(point.x,point.z,point.y+.64)){store.showToast('在露出的泥土上播种');return;}
    if (!anchors.isSolved('oldTree') && !abilities.state.settings['memory-oldTree'] && Math.hypot(player.root.position.x-firstBed.x, player.root.position.z-firstBed.z)>5) {
      store.showToast('沿花径走到记忆土旁，再点泥土播种'); return;
    }
    if (!anchors.isSolved('oldTree') && !abilities.state.settings['memory-oldTree'] &&
        Math.hypot(point.x-firstBed.x, point.z-firstBed.z)>2.5) {
      store.showToast('第一株种在老树前。找找树根旁的标记。');
      return;
    }
    const plant = field.spawnAt(point);
    if (plant) {
      ambience.play('plant');
      const site = anchors.items.find(({def}) => def.id === 'skyGarden' ? deck === levels.islands[2] : def.id === 'oldTree'
        ? Math.hypot(point.x-firstBed.x, point.z-firstBed.z) <= 2.5
        : Math.hypot(point.x-def.x, point.z-def.z) <= def.radius);
      if (site && !abilities.state.settings['memory-' + site.def.id]) {
        abilities.state.settings['memory-' + site.def.id] = true;
        abilities.save();
        refreshMemories();
        ui.memory = memories[site.def.id];
        memoryUntil = elapsed + 10;
        updateHint();
      }
    }
  }

  function onCanvasPointerCancel(e) {
    taps.delete(e.pointerId);
    if (taps.size === 0) tapMulti = false;
  }

  canvas.addEventListener('pointerdown', onCanvasPointerDown);
  canvas.addEventListener('pointermove', onCanvasPointerMove);
  canvas.addEventListener('pointerup', finishTap);
  canvas.addEventListener('pointercancel', onCanvasPointerCancel);

  /* ---------------- optional auto-demo (?auto) ---------------- */

  let autoClock = 0;
  const autoHead = new THREE.Vector2();
  const AUTO_ANCHOR = new THREE.Vector3(0, 4.6, -4);

  // The auto demo drags an invisible 'hand' across the middle of the valley.
  function driveAuto(dt) {
    autoClock += dt;
    const cycle = autoClock % 11.0;
    const W = window.innerWidth;
    wind.projectToScreen(AUTO_ANCHOR, autoHead);

    if (cycle > 2.2 && cycle < 2.9) {
      const k = (cycle - 2.2) / 0.7;
      const x = W * (0.16 + 0.68 * k);
      wind.force((W * 0.68) / 0.7, 0, x, autoHead.y);
    } else if (cycle > 6.4 && cycle < 7.1) {
      const k = (cycle - 6.4) / 0.7;
      const x = W * (0.84 - 0.68 * k);
      wind.force(-(W * 0.68) / 0.7, 0, x, autoHead.y);
    } else {
      wind.force(0, 0);
    }
  }

  /* ---------------- main loop ---------------- */

  const clock = new THREE.Clock();
  let elapsed = 0;
  let frameCount = 0;
  let ready = false;
  let wasAirborne = false;
  let debugTimer = 0;
  let fps = 60;

  const stillSeconds = parseFloat(params.get('still') || '0');
  const gustAt = parseFloat(params.get('gust') || '-1');
  const gustX = params.has('gustx') ? parseFloat(params.get('gustx')) : null;
  const gustY = params.has('gusty') ? parseFloat(params.get('gusty')) : null;
  const headScreen = new THREE.Vector2();
  const playerWindPos = new THREE.Vector3();
  const playerWindVel = new THREE.Vector3();
  const eyeSets = journey.habitat.eyes;
  const plantCredits = new WeakMap();
  const bedPlants = () => levels.beds.map(b => field.plants.find(f => f.hasFlowerHead &&
    Math.hypot(f.basePosition.x-b.x,f.basePosition.z-b.z)<1.65));
  const islandStep = () => Number(abilities.state.settings.islandStep) || 0;
  const aboveSummit = () => levels.islandAt(player.root.position.x,player.root.position.z)===levels.islands[2] &&
    !player.airborne && Math.abs(player.root.position.y-levels.islands[2].top-.64)<.35;
  eyeSets.updraft[0].userData.recordSource = flower => {
    if (bedPlants().every(Boolean)) plantCredits.set(flower, Math.min(4,(plantCredits.get(flower)||0)+1));
  };
  // Existing completed campaigns keep their ending; new island tasks start after flight.
  if (anchors.isSolved('spring') && !anchors.isSolved('skyGarden')) {
    const islandChapter=anchors.items.find(item=>item.def.id==='skyGarden');
    islandChapter.solved=true;
    abilities.setAnchorState('skyGarden','solved');
    abilities.state.settings.islandStep=3;
    abilities.save();
  }
  const checkpoint = anchors.items.find(item=>item.def.id===abilities.state.settings.checkpoint && item.solved);
  if(checkpoint) {
    player.snapTo(checkpoint.def.x+4,checkpoint.def.z+5);
    followPlayer();
  }
  for (const item of anchors.items) {
    const saved = abilities.getAnchorState(item.def.id);
    const mask = Number(saved?.split(':')[1]) || 0;
    eyeSets[item.def.id].forEach((eye, i) => {
      eye.userData.lit = item.solved || !!(mask & (1 << i));
      const counts = saved?.split(':')[2]?.split(',') || [];
      eye.userData.total = eye.userData.lit ? SEED_GOALS[item.def.id] : (Number(counts[i]) || 0);
      eye.userData.bloom = eye.userData.lit ? 2 : -1;
      if(eye.userData.lit) eye.userData.update(0,0,1);
      eye.visible = eye.userData.lit;
      eye.material.color.set(eye.userData.lit ? '#a4f6bd' : '#ffc66d');
    });
  }

  journey.windmill.setPrimed(eyeSets.windmill.filter(eye => eye.userData.lit).length);
  if (!anchors.isSolved('spring') && eyeSets.spring.some(eye => eye.userData.lit)) journey.spring.setRestored(.4);

  const gustDirection = new THREE.Vector3();
  const eyeOffset = new THREE.Vector3();
  const aimArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), 2.6, '#ffdc97', .62, .38);
  aimArrow.visible = false;
  scene.add(aimArrow);

  function nearestFlower() {
    const origin = player.root.position;
    let flower = null, distance = 7;
    for (const plant of field.plants) {
      const pos = plant.group.position;
      const d = Math.hypot(pos.x - origin.x, pos.z - origin.z);
      if (d < distance && Math.abs(player.root.position.y-pos.y)<4.5 && plant.hasFlowerHead && !plant.finished) { flower = plant; distance = d; }
    }
    return flower;
  }

  function aimedEye(flower, direction) {
    const station = anchors.items.find(item => !item.solved);
    if (!station) return null;
    const id=station.def.id;
    if (id==='windmill' && !abilities.hasPostcard('tree')) return null;
    if (id==='updraft') {
      const plants=bedPlants();
      if (!plants.every(Boolean) || !plants.includes(flower)) return null;
    }
    if (id==='skyGarden' && (!aboveSummit() || islandStep()<3 ||
        Math.abs(flower.basePosition.y-levels.islands[2].top)>.2)) return null;
    if (id==='sundial' && field.plants.filter(f=>f.hasFlowerHead &&
        Math.hypot(f.basePosition.x-station.def.x,f.basePosition.z-station.def.z)<9).length<4) return null;
    let target = null, best = .68;
    const soundingEye = station?.def.id === 'windmill' && eyeSets.windmill.find(eye => !eye.userData.lit);
    for (const eye of station ? eyeSets[station.def.id] : []) {
      if (eye.userData.bloom>=0 || eye.userData.lit || (soundingEye && eye !== soundingEye)) continue;
      if (station.def.id === 'spring' && eye === eyeSets.spring[1] && !player.airborne) continue;
      const offset = eyeOffset.copy(eye.position).sub(flower.group.position);
      offset.y = 0;
      const reach = offset.length();
      const alignment = reach < .9 ? 1 : offset.normalize().dot(direction);
      if (reach <= 8 && alignment > best) { best = alignment; target = eye; }
    }
    return target;
  }

  let delivery = null;
  let lastRelease = -1;
  function carrySeeds(flower, direction) {
    if (elapsed-lastRelease < .45 || !flower.canBlow) return;
    const target = aimedEye(flower, direction);
    if (!flower.blow(direction, target)) return;
    lastRelease = elapsed;
    ambience.play('gust');
    if (target && !anchors.isSolved('oldTree')) delivery = { flower, target };
  }
  const walkMarker=new THREE.Vector3(WALK_MARKER.x,world.heightAt(WALK_MARKER.x,WALK_MARKER.z)+.16,WALK_MARKER.z);
  const firstBed = new THREE.Vector3(FIRST_BED.x, world.heightAt(FIRST_BED.x,FIRST_BED.z)+.08, FIRST_BED.z);
  function guideAt(point, text, bedIndex=null) {
    const projected = point.clone().project(camera);
    const p = projected.z >= -1 && projected.z <= 1 && {
      x: (projected.x+1)*canvas.clientWidth/2, y: (1-projected.y)*canvas.clientHeight/2
    };
    if (!p || p.x < 40 || p.x > canvas.clientWidth-40 || p.y < 48 || p.y > canvas.clientHeight-30) {
      ui.windGuide = null;
      return;
    }
    const x = Math.round(p.x), y = Math.round(p.y);
    if (ui.windGuide?.x !== x || ui.windGuide.y !== y || ui.windGuide.text !== text) ui.windGuide = { x, y, text, bedIndex };
  }

  function updateWindEyes(t,dt) {
    const station = anchors.items.find(item => !item.solved);
    if (!station) return;
    const id = station.def.id, eyes = eyeSets[id];
    let changed = false;
    const soundingEye = id === 'windmill' && eyes.find(eye => !eye.userData.lit);
    eyes.forEach((eye, i) => {
      eye.visible = true;
      const state=eye.userData, goal=SEED_GOALS[id];
      if(id==='updraft'){
        const plants=bedPlants();
        if(!state.lit) state.total=plants.reduce((n,f)=>n+(f ? plantCredits.get(f)||0 : 0),0);
        if(!state.lit && (!plants.every(Boolean) || state.total<goal)) state.bloom=-1;
        levels.beds.forEach((bed,j)=>bed.soil.material.emissive.setHex(plants[j]?0x365e36:0x392515));
      }
      state.total=Math.min(state.total,goal);
      if (!state.lit && state.total>=goal && state.bloom<0) state.bloom=0;
      state.update(t,dt,state.total/goal);
      if (id==='windmill' && !state.lit) eye.material.color.set(eye===soundingEye?'#ffda96':'#725d49');
      if(state.savedCount!==state.total && !state.lit){
        state.savedCount=state.total;
        if(id!=='updraft') changed=true;
      }
      if(state.lit || state.bloom<1.65) return;
      if(id==='windmill') ambience.chime(i);
      eye.userData.lit = true;
      eye.material.color.set('#a4f6bd');
      changed = true;
    });
    if (!changed) return;
    if (id === 'oldTree' && eyes[0].userData.lit) delivery = null;
    const mask = eyes.reduce((m, eye, i) => m | (Number(!!eye.userData.lit) << i), 0);
    const saved='eyes:'+mask+':'+eyes.map(e=>e.userData.total).join(',');
    if(abilities.getAnchorState(id)!==saved) abilities.setAnchorState(id,saved);
    if (eyes.some(eye => !eye.userData.lit)) {
      if (id === 'windmill') journey.windmill.setPrimed(eyes.filter(eye => eye.userData.lit).length);
      if (id === 'spring' && mask) journey.spring.setRestored(.4);
      if (eyes.some(e=>e.userData.lit && e.userData.bloom<1.75)) store.showToast('这盏开了，去下一盏。');
    } else if (id === 'sundial') {
      if (abilities.unlock('time')) handleAbilityUnlock('time');
      store.showToast('拖动太阳或月亮，让影子落在刻痕上。');
    } else {
      anchors.solveById(id);
    }
  }
  let lastStateKey = '';
  let lastSkyKey = '';

  function updateDebug() {
    const stats = field.stats();
    const meadows = world.meadows || [world.meadow];
    const carpets = world.carpets || [world.carpet];
    const clumps = meadows.reduce((n, m) => n + m.grassCount, 0);
    const flowers = meadows.reduce((n, m) => n + m.flowerCount, 0);
    const blades = carpets.reduce((n, c) => n + c.count, 0);
    const lod = world.lod || { near: true, mid: true };
    const birds = world.birds ? world.birds.state : {};
    ui.debug.visible = true;
    ui.debug.text =
      `fps ${fps.toFixed(0)}\n` +
      `plants ${String(stats.plants).padStart(2)}/${field.maxPlants}  head ${String(stats.head).padStart(4)}  flying ${String(stats.flying).padStart(3)}\n` +
      `grass ${clumps} clumps + ${blades} blades · flowers ${flowers}\n` +
      `lod near ${lod.near ? 'on' : 'off'}  mid ${lod.mid ? 'on' : 'off'}\n` +
      `birds ${birds.active ? 'flying' : 'resting'}  fireflies ${world.fireflies.level.toFixed(2)}\n` +
      `wind ${wind.strength.toFixed(2)}  pwind ${wind.playerStrength.toFixed(2)}  breeze ${wind.breezeSpeed.toFixed(2)}  time ${sky.time.toFixed(2)}\n` +
      `player ${player.root.position.x.toFixed(1)}, ${player.root.position.z.toFixed(1)}  speed ${player.speed.toFixed(2)}  alt ${player.altitude.toFixed(2)}\n` +
      `abilities ${ABILITY_ORDER.filter((name) => abilities.has(name)).join(',') || 'none'}  anchors ${anchors.items.filter((item) => item.solved).length}/${anchors.items.length}  camera ${filmCamera.isActive ? 'active' : filmCamera.placed ? 'placed' : 'none'}\n` +
      `v_avg ${stats.avgSpeed.toFixed(2)}  calls ${renderer.info.render.calls}  tris ${renderer.info.render.triangles}`;
  }

  function syncShellState() {
    ui.camera.active = filmCamera.isActive;
    ui.camera.placing = filmCamera.isPlacing;
    ui.camera.placed = filmCamera.placed;

    const skyKey = `${sky.paint.time.pct}|${sky.visibleBody}|${sky.interactive}`;
    if (skyKey !== lastSkyKey) {
      lastSkyKey = skyKey;
      ui.sky.time.pct = sky.paint.time.pct;
      ui.sky.time.label = sky.paint.time.label;
      ui.sky.visibleBody = sky.visibleBody;
      ui.sky.interactive = sky.interactive;
    }

    const mobile = mobileControls.describe({
      liftEnabled: abilities.has('lift'),
      cameraEnabled: abilities.has('camera'),
      cameraActive: filmCamera.isActive,
      placing: filmCamera.isPlacing,
      canInteract: false,
      recording: !!videoRecorder?.active
    });
    const mobileKey = JSON.stringify(mobile);
    if (mobileKey !== lastStateKey) {
      lastStateKey = mobileKey;
      ui.mobile = mobile;
    }
  }

  function stepScene(dt) {
    elapsed += dt;

    if (isAuto) {
      driveAuto(dt);
    } else if (gustAt >= 0) {
      const active = elapsed >= gustAt && elapsed < gustAt + 0.55;

      if (active) {
        const W = window.innerWidth;
        const H = window.innerHeight;
        wind.projectToScreen(AUTO_ANCHOR, headScreen);

        const baseX = gustX === null ? headScreen.x : W * gustX;
        const baseY = gustY === null ? headScreen.y : H * gustY;
        const k = THREE.MathUtils.clamp((elapsed - gustAt) / 0.55, 0, 1);
        const x = baseX + (k - 0.5) * 150;

        wind.force(W * 0.98, -H * 0.02, x, baseY);
      } else {
        wind.force(0, 0);
      }
    }

    // Movement follows whichever camera is active. In film mode the player
    // still performs while the placed camera stays fixed.
    const driveYaw = filmCamera.isActive ? filmCamera.getYaw() : orbit.yaw;
    const beforeX = player.root.position.x, beforeZ = player.root.position.z;
    player.update(dt, elapsed, driveYaw);
    const stepX = player.root.position.x-beforeX, stepZ = player.root.position.z-beforeZ;
    if (!moved && player.speed > .1 && Math.hypot(player.root.position.x-walkMarker.x,player.root.position.z-walkMarker.z) < 2.5) {
      moved = true;
      abilities.state.settings.walked = true;
      abilities.save();
      updateHint();
    }
    if (ui.memory && elapsed >= memoryUntil) ui.memory = null;
    if (!filmCamera.isActive) followPlayer();

    // The tumbleweed is the primary wind source. Feed its world velocity into
    // the field after the follow camera has settled, so the grass patch and
    // the player's screen position agree.
    wind.camera = activeCamera;
    playerWindPos.copy(player.root.position);
    // While gathering for a lift, a small updraft starts before take-off so
    // the wind visibly gathers around the tumbleweed.
    const gatherWind = player.liftChargeProgress * 1.4;
    playerWindVel.set(
      player.velocity.x,
      player.verticalSpeed + gatherWind,
      player.velocity.z
    );
    if (playerWindVel.lengthSq() > 0.02) {
      wind.setPlayerSource(playerWindPos, playerWindVel, activeCamera);
    } else {
      wind.clearPlayerSource();
    }

    wind.update(dt, elapsed);
    world.update(elapsed, dt, wind);
    field.update(elapsed, dt);
    journey.update(elapsed, dt, wind, sky);

    const platform=levels.islandAt(player.root.position.x,player.root.position.z);
    if(abilities.has('lift') && platform && platform===levels.islands[islandStep()] &&
        !player.airborne && Math.abs(player.root.position.y-platform.top-.64)<.35){
      abilities.state.settings.islandStep=islandStep()+1;
      abilities.save();
      ambience.chime(islandStep()-1);
      store.showToast('岩台石碑已点亮 · '+islandStep()+'/3');
    }
    levels.islands.forEach((island,i)=>{
      island.beacon.material.color.set(i<islandStep()?'#98ffca':i===islandStep()?'#ffda86':'#9387a8');
      island.beacon.rotation.y=elapsed*.55;
    });
    trials.update(elapsed,player,ui);
    updateWindEyes(elapsed,dt);
    for(const item of anchors.items){
      if(!item.solved) continue;
      for(const eye of eyeSets[item.def.id]){
        if(eye.userData.bloom<2.1) eye.userData.update(elapsed,dt,1);
      }
    }
    const flower = filmCamera.isActive || filmCamera.isPlacing ? null : nearestFlower();
    aimArrow.visible = false;
    if (flower && moved && !ui.journeyEnd.visible && Math.hypot(stepX,stepZ) > dt*.4) {
      gustDirection.set(stepX, 0, stepZ).normalize();
      aimArrow.visible = true;
      aimArrow.position.copy(flower.headCenter);
      aimArrow.setDirection(gustDirection);
      aimArrow.setColor(aimedEye(flower,gustDirection) ? 0xa4f6bd : 0xffdc97);
      const pos = flower.group.position;
      if (Math.hypot(pos.x-player.root.position.x,pos.z-player.root.position.z) <= 2.3) {
        carrySeeds(flower, gustDirection);
      }
    }

    // Sundial puzzle: set the sun to the notch time while standing nearby.
    if (!anchors.isSolved('sundial') && abilities.has('time') && eyeSets.sundial.every(eye => eye.userData.lit)) {
      const dist = Math.hypot(
        player.root.position.x - journey.sundial.group.position.x,
        player.root.position.z - journey.sundial.group.position.z
      );
      if (dist < 12 && (sky.pressing || sky.flowPause > 0) && sky.time > 0.455 && sky.time < 0.525) {
        anchors.solveById('sundial');
      }
    }

    filmCamera.update(dt, elapsed);

    anchors.update(dt, elapsed, player.root.position);
    const photoSpot = anchors.getPhotoTarget(player.root.position);
    const canCollect = photoSpot && !abilities.hasPostcard(photoSpot.def.postcard);
    const next = anchors.items.find(item => !item.solved);
    const missing = !next && anchors.items.find(item => item.def.postcard && !abilities.hasPostcard(item.def.postcard));
    const needsPhoto = next?.def.id==='windmill' && !abilities.hasPostcard('tree');
    const destination = needsPhoto ? anchors.items[0] : next || missing;
    if (next?.def.id !== 'oldTree') ui.windGuide = null;
    if (destination) {
      const waypoint=next?.def.id==='skyGarden' && islandStep()<3 ? levels.islands[islandStep()] : destination.def;
      const dx = waypoint.x - player.root.position.x;
      const dz = waypoint.z - player.root.position.z;
      const angle = Math.atan2(dx, dz) - orbit.yaw - Math.PI;
      const arrows = ['↑','↖','←','↙','↓','↘','→','↗'];
      ui.route = arrows[(Math.round(angle / (Math.PI / 4)) + 8) % 8] + ' ' + destination.def.label + ' · '+ Math.round(Math.hypot(dx,dz))+' 米';
      ui.story = next ? next.def.story : '这里还缺一张明信片。到地标旁拍张照吧。';
      if (next?.def.id === 'oldTree') {
        const eye = eyeSets.oldTree[0];
        const planted = field.plants.find(plant => !plant.finished && plant.hasFlowerHead);
        if (delivery && (!field.plants.includes(delivery.flower) || !delivery.flower.seeds.some(seed => seed.active && seed.windEye === delivery.target))) delivery = null;
        if (!moved) {
          ui.route = '风灵醒来';
          ui.story = coarse ? '你是来送种子的风灵。推左摇杆下坡，穿过路边那两堆石头。' : '你是来送种子的风灵。按 WASD 下坡，穿过路边那两堆石头。';
          guideAt(walkMarker,'滚到这里');
        } else if (delivery) {
          ui.story = '看树洞边的花盏。五粒种子穿过去，老树就醒了。';
          const seed = delivery.flower.seeds.find(seed => seed.active && seed.windEye === eye);
          if (seed) guideAt(seed.center, '飞向树洞的种子');
        } else if (!planted || Math.hypot(planted.group.position.x-eye.position.x,planted.group.position.z-eye.position.z)>8) {
          ui.story = planted ? '离树洞远了点。到标记旁再种一株。' : '点树根前那块土，种下第一株蒲公英。';
          const nearby=Math.hypot(player.root.position.x-firstBed.x,player.root.position.z-firstBed.z)<=5;
          if (!nearby) ui.story='顺着小路去老树。走到树根前那块土旁边再播种。';
          guideAt(firstBed, nearby ? '点这里种花' : '走到树根旁');
        } else if (!planted.canBlow) {
          ui.story = '趁白绒还没长齐，先绕到花后面。往前看，花在近处，花盏在远处。';
          guideAt(planted.headCenter, '等花头变白');
        } else {
          ui.story = '对准树洞边的花盏，贴着花滚过去。种子会顺着你滚动的方向飞。';
          guideAt(planted.headCenter, '对准花盏，贴着花滚');
        }
      } else if (next?.def.id === 'windmill') {
        const bells = Math.min(2,eyeSets.windmill.filter(eye => eye.userData.lit).length);
        ui.story = needsPhoto ? (coarse?'在老树旁点快门':'在老树旁按 P')+'，拍下第一张明信片，再去磨坊。' : ['先找最长的那只风铃，把种子送进去。','第一只响了。转到第二只亮着的风铃旁边。','还剩最短的那只。朝它送种，风车就能转起来。'][bells];
      } else if(next?.def.id==='updraft'){
        const plants=bedPlants();
        ui.story='三块种床各留一株花。轮流从花旁滚过，让每株都有 4 粒种子飞进中间的花盏。';
        if(Math.hypot(dx,dz)<18){
          const i=plants.findIndex(f=>!f);
          if(i>=0) guideAt(levels.beds[i].soil.position,'种床 '+(i+1)+' · 点泥土种花',i);
          else {
            const j=plants.findIndex(f=>(plantCredits.get(f)||0)<4);
            if(j>=0) guideAt(plants[j].headCenter,'从这株朝花盏滚动');
          }
        }
        ui.story+=' 三床：'+plants.map(f=>f ? (plantCredits.get(f)||0)+'/4' : '待种').join(' · ');
      } else if(next?.def.id==='skyGarden'){
        ui.story=islandStep()<3 ? '贴着岩台外侧往上飞。高过草面后飞到岛上，松开升空键落地。已着陆 '+islandStep()+'/3。'
          : '就在最高这座岛上种花，再朝花盏滚过花旁。';
      } else if(next?.def.id==='sundial'){
        ui.story=abilities.has('time')?'拖动日月，让日影对准刻痕。':'日晷旁要留四株活花。种齐以后，再往花盏里送种子。';
      }
    } else {
      ui.route = '自由漫游';
      ui.story = '五张明信片都收齐了。还想在哪儿拍一张？';
    }
    if(next?.def.id==='oldTree' && moved) {
      ui.route=abilities.state.settings['memory-oldTree'] ? '第三课 · 滚过花旁' : '第二课 · 在树根旁种花';
    } else if(next?.def.id==='oldTree') ui.route='第一课 · 滚下山坡';
    if(next?.def.id==='oldTree' && !abilities.state.settings['memory-oldTree']) {
      const goal=moved ? firstBed : walkMarker;
      const dx=goal.x-player.root.position.x, dz=goal.z-player.root.position.z;
      const angle=Math.atan2(dx,dz)-orbit.yaw-Math.PI;
      const arrow=['↑','↖','←','↙','↓','↘','→','↗'][(Math.round(angle/(Math.PI/4))+8)%8];
      ui.route+=' · '+arrow+' '+Math.round(Math.hypot(dx,dz))+' 米';
    }
    const activeEye=next && eyeSets[next.def.id].find(e=>!e.userData.lit);
    if(activeEye && !needsPhoto && (next.def.id!=='oldTree' || abilities.state.settings['memory-oldTree'])) {
      ui.story+='　入盏 '+activeEye.userData.total+'/'+SEED_GOALS[next.def.id]+' 粒';
      if(activeEye.userData.bloom>=0) ui.story+=' · 花瓣正在打开';
    }
    if (filmCamera.isActive || filmCamera.isPlacing || ui.journeyEnd.visible) ui.windGuide = null;
    if (filmCamera.isPlacing) {
      store.setContext(coarse ? '轻点草地安放相机 · 点取消返回' : '点击草地安放相机 · Esc 取消');
    } else if (filmCamera.isActive) {
      store.setContext(coarse ? '拖动瞄准 · 点快门拍照 · 点退出返回' : '拖动瞄准 · P 拍照 · Esc 返回');
    } else if (next?.def.id === 'oldTree') {
      store.setContext('');
    } else if (next && anchors.nearby === next && !(next.def.id === 'sundial' && eyeSets.sundial[0].userData.lit)) {
      const eyes = eyeSets[next.def.id];
      store.setContext((next.def.id === 'spring' && eyeSets.spring[0].userData.lit ? '升空后，朝高处花盏掠过花旁' : '朝发亮的花盏滚过花旁') + '　' + eyes.filter(e => e.userData.lit).length + '/' + eyes.length);
    } else {
      const prompt = coarse ? anchors.prompt.replace(/^E · /, '点交互 · ') : anchors.prompt;
      store.setContext(prompt || (canCollect ? (coarse ? '点快门' : '按 P') + ' · 留下《' + photoSpot.def.cardTitle + '》' : ''));
    }

    syncShellState();
  }

  function animate() {
    requestAnimationFrame(animate);
    frameCount++;

    const rawDt = clock.getDelta();
    const dt = Math.min(rawDt, 1 / 30);
    if (!dt) return;
    fps += ((1 / dt) - fps) * 0.05;

    // The day cycle follows wall-clock time even when a heavy frame is clamped
    // for the physics step.
    sky.update(rawDt);
    stepScene(dt);
    sky.sync(activeCamera);
    updateUI();
    renderScene();
    renderFireflies();

    if (videoRecorder && videoRecorder.active) {
      videoRecorder.frame({ renderer, fireflyCanvas, sky });
      const tenths = Math.round(videoRecorder.elapsed * 10) / 10;
      if (tenths !== ui.record.time) ui.record.time = tenths;
    }

    const airborne = player.altitude > 0.35;
    if (airborne && !wasAirborne) ambience.play('lift');
    else if (!airborne && wasAirborne) ambience.play('land');
    wasAirborne = airborne;

    ambience.update({
      speed: Math.min(1, player.speed / 6.2),
      altitude: Math.min(1, player.altitude / 8),
      breeze: Math.min(1, wind.breezePower),
      gust: Math.min(1, wind.strength)
    });

    if (!ready) {
      ready = true;
      store.setReady();
    }

    if (isDebug) {
      debugTimer += dt;
      if (debugTimer > 0.25) {
        debugTimer = 0;
        updateDebug();
      }
    }
  }

  if (stillSeconds > 0) {
    // Headless still-frame mode: simulate a few seconds, then paint one frame.
    ui.still = true;
    const dt = 1 / 60;
    const steps = Math.round(stillSeconds * 60);
    for (let i = 0; i < steps; i++) stepScene(dt);
    sky.sync(activeCamera);
    updateUI();
    store.setReady();
    renderScene();
    renderFireflies();
    if (isDebug) updateDebug();
  } else {
    animate();
  }

  function onResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.6 : 2));
    renderer.setSize(width, height);
    if (fireflyRenderer) {
      fireflyRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.6 : 2));
      fireflyRenderer.setSize(width, height);
    }
    frameCamera();
    post.resize();
  }
  window.addEventListener('resize', onResize);

  /* ---------------- sky bridge ---------------- */

  function bindSkyPainter(painter) {
    host.paintSky = painter;
    sky.onPaint = (paint) => host.paintSky?.(paint);
    if (typeof painter === 'function') painter(sky.paint);
  }
  sky.onPaint = (paint) => host.paintSky?.(paint);
  if (typeof host.paintSky === 'function') host.paintSky(sky.paint);

  /* ---------------- public API ---------------- */

  const api = {
    /* engine objects (tests + dev console) */
    store,
    objects: {
      scene, camera, renderer, wind, world, field, player, orbit, sky, post,
      fireflyRenderer, fireflyScene, devConsole, abilities, anchors,
      filmCamera, journey, mobileControls, videoRecorder, ambience, filmArchive
    },
    get activeCamera() { return activeCamera; },
    bindSkyPainter,

    /* ui actions */
    restartJourney() {
      abilities.reset();
      const url = new URL(window.location.href);
      url.searchParams.delete('reset');
      window.history.replaceState(window.history.state, '', url);
      window.location.reload();
    },
    toggleTrial: () => trials.toggle(elapsed),
    toggleSound,
    toggleFilmCamera,
    beginFilmPlacement,
    cancelFilmPlacement,
    activateFilmCamera,
    deactivateFilmCamera,
    requestPhoto,
    captureNow,
    toggleVideo,
    startVideo,
    stopVideo,

    /* overlays */
    toggleFilmPanel: () => filmArchive.togglePanel(),
    closeFilmPanel: () => filmArchive.closePanel(),
    dismissJourneyEnd: () => filmArchive.dismissJourneyEnd(),

    /* sky input (called by <CelestialBody>) */
    skyBeginPress: (type, e) => sky.beginPress({
      type,
      pointerId: e.pointerId,
      clientX: e.clientX,
      clientY: e.clientY,
      pointerType: e.pointerType,
      button: e.button
    }),
    skyMovePress: (e) => sky.movePress({ clientX: e.clientX, clientY: e.clientY }),
    skyEndPress: () => sky.endPress(),
    skyNudge: (key) => sky.nudge(key),

    /* touch input (called by <TouchPad>) */
    joystick: (x, y) => mobileControls.setJoystick(x, y),
    releaseJoystick: () => mobileControls.resetJoystick(),
    liftHeld: (on) => mobileControls.setLiftHeld(on),
    mobileCamera: () => mobileControls.camera(),
    mobileShutter: () => mobileControls.shutter(),
    mobileRecord: () => mobileControls.record(),
    mobileInteract: () => mobileControls.interact(),

    /* misc */
    interact: () => anchors.interact(),
    nudgePlayer: (code, down) => {
      // Test hook: mirror the keyboard gesture without a real key event.
      if (code === 'Space') player.setLiftHeld(!!down);
      else if (code === 'KeyW') player.setMoveInput(0, down ? 1 : 0);
      else if (code === 'KeyS') player.setMoveInput(0, down ? -1 : 0);
      else if (code === 'KeyA') player.setMoveInput(down ? -1 : 0, 0);
      else if (code === 'KeyD') player.setMoveInput(down ? 1 : 0, 0);
    },

    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointerdown', unlockAudio, { capture: true });
      window.removeEventListener('keydown', unlockAudio, { capture: true });
      canvas.removeEventListener('pointerdown', onCanvasPointerDown);
      canvas.removeEventListener('pointermove', onCanvasPointerMove);
      canvas.removeEventListener('pointerup', finishTap);
      canvas.removeEventListener('pointercancel', onCanvasPointerCancel);
      sky.dispose();
      filmArchive.clear();
      store.dispose();
      Object.assign(ui, { ready: false });
    }
  };

  // A tiny console handle for tinkering, kept from the original build.
  window.__dandy = {
    ...api.objects,
    ...api,
    filmItems: filmArchive.items,
    get activeCamera() { return activeCamera; },
    get frames() { return frameCount; },
    lastCapture: null,
    dandelionParams: DANDELION_PARAMS,
    maxWildPlants: MAX_WILD_PLANTS
  };

  return api;
}

function createFailedExperience({ ui, params }) {
  ui.noWebgl = true;
  return {
    objects: {},
    bindSkyPainter() {},
    dispose() { ui.noWebgl = false; },
    toggleSound() {},
    toggleFilmCamera() {},
    requestPhoto() {},
    toggleVideo() {},
    toggleFilmPanel() {},
    closeFilmPanel() {},
    dismissJourneyEnd() {},
    skyBeginPress() {},
    skyMovePress() {},
    skyEndPress() {},
    skyNudge() {},
    joystick() {},
    releaseJoystick() {},
    liftHeld() {},
    isFailed: true
  };
}