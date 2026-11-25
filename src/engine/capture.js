/* ------------------------------------------------------------------ */
/*  Frame compositor · photos & short clips                            */
/*                                                                     */
/*  Paints the sky gradient, sun/moon bloom, stars, the WebGL scene,    */
/*  the firefly layer, colour veils and a vignette into one canvas.     */
/*  Photos export as PNG; clips are recorded with MediaRecorder from a  */
/*  composited canvas stream.                                          */
/* ------------------------------------------------------------------ */

function colorStyle(color, fallback) {
  if (!color) return fallback;
  if (typeof color.getStyle === 'function') return color.getStyle();
  return fallback;
}

function drawSky(ctx, width, height, sky) {
  const state = sky?.lightState || {};
  const night = state.night || 0;
  const golden = state.golden || 0;
  const day = state.day ?? 1;

  const top = night > 0.55
    ? '#17233a'
    : golden > 0.35
      ? '#d9a36f'
      : '#b9d4dc';
  const horizon = colorStyle(state.haze, '#dfe0c6');

  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, top);
  gradient.addColorStop(0.64, horizon);
  gradient.addColorStop(1, horizon);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Sun/moon glow. lightState.x/y are normalized screen coordinates with
  // the origin at the bottom, so the canvas y is inverted.
  const sx = state.x;
  const sy = state.y;
  if (sx > -0.2 && sx < 1.2 && sy > -0.2 && sy < 1.2) {
    const px = sx * width;
    const py = (1 - sy) * height;
    const color = colorStyle(state.color, '#ffddb0');
    const radius = Math.max(width, height) * (0.08 + 0.05 * (state.golden || 0));
    const glow = ctx.createRadialGradient(px, py, 0, px, py, radius);
    glow.addColorStop(0, color);
    glow.addColorStop(0.18, color);
    glow.addColorStop(1, 'rgba(255, 230, 190, 0)');
    ctx.globalAlpha = 0.55 + 0.35 * day;
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = 1;
  }

  if (night > 0.15) {
    // A deterministic star field; enough for a placeholder.
    ctx.fillStyle = 'rgba(255, 246, 220, 0.82)';
    for (let i = 1; i <= 90; i++) {
      const x = ((i * 9301 + 49297) % 233280) / 233280 * width;
      const y = ((i * 4423 + 7919) % 233280) / 233280 * height * 0.55;
      const r = 0.5 + (i % 4) * 0.35;
      ctx.globalAlpha = night * (0.25 + (i % 5) * 0.12);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

function drawVeils(ctx, width, height, sky) {
  const state = sky?.lightState || {};
  const night = state.night || 0;
  const golden = state.golden || 0;

  if (night > 0) {
    ctx.fillStyle = `rgba(19, 28, 48, ${night * 0.34})`;
    ctx.fillRect(0, 0, width, height);
  }
  if (golden > 0) {
    ctx.fillStyle = `rgba(255, 181, 105, ${golden * 0.08})`;
    ctx.fillRect(0, 0, width, height);
  }
}

function drawVignette(ctx, width, height) {
  const vignette = ctx.createRadialGradient(
    width * 0.5,
    height * 0.5,
    Math.min(width, height) * 0.22,
    width * 0.5,
    height * 0.5,
    Math.max(width, height) * 0.72
  );
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vignette.addColorStop(1, 'rgba(16, 14, 10, 0.34)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
}

export function capturePlaceholderPhoto({
  renderer,
  fireflyCanvas,
  sky,
  width = 1920,
  height = 1080,
  onDone
}) {
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d');
  if (!ctx) return null;

  drawSky(ctx, width, height, sky);

  // The WebGL canvas is drawn immediately after the frame was rendered, so
  // its drawing buffer is still valid even without preserveDrawingBuffer.
  try {
    ctx.drawImage(renderer.domElement, 0, 0, width, height);
  } catch (err) {
    console.warn('capture: could not draw scene canvas', err);
  }

  if (fireflyCanvas) {
    try {
      ctx.drawImage(fireflyCanvas, 0, 0, width, height);
    } catch (err) {
      /* the overlay may be missing on low-end devices */
    }
  }

  drawVeils(ctx, width, height, sky);
  drawVignette(ctx, width, height);

  const filename = `wind-photo-${Date.now()}.png`;
  out.toBlob((blob) => {
    onDone?.(filename, blob);
  }, 'image/png');

  return { canvas: out, filename };
}
/* ------------------------------------------------------------------ */
/*  Short video · 5 s composited clip                                  */
/* ------------------------------------------------------------------ */

function paintVideoFrame(ctx, width, height, { renderer, fireflyCanvas, sky }) {
  drawSky(ctx, width, height, sky);

  try {
    ctx.drawImage(renderer.domElement, 0, 0, width, height);
  } catch (err) {
    console.warn('capture: could not draw scene canvas', err);
  }

  if (fireflyCanvas) {
    try {
      ctx.drawImage(fireflyCanvas, 0, 0, width, height);
    } catch (err) {
      /* overlay may be missing */
    }
  }

  drawVeils(ctx, width, height, sky);
  drawVignette(ctx, width, height);
}

function supportedMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4'
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

export function createVideoRecorder({
  width = 1280,
  height = 720,
  fps = 30,
  duration = 5,
  onDone,
  onEmpty,
  onUnsupported
}) {
  const mime = supportedMime();
  if (!mime || !HTMLCanvasElement.prototype.captureStream) {
    onUnsupported?.();
    return null;
  }

  let canvas = null;
  let ctx = null;
  let stream = null;
  let recorder = null;
  let chunks = [];
  let active = false;
  let startedAt = 0;
  let resolvedDuration = duration;
  let painted = 0;
  const extension = mime.includes('mp4') ? 'mp4' : 'webm';

  function cleanup() {
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
    }
    stream = null;
    recorder = null;
    chunks = [];
  }

  function stop() {
    if (!active || !recorder) return;
    active = false;
    resolvedDuration = Math.min(duration, (performance.now() - startedAt) / 1000);
    try {
      recorder.stop();
    } catch (err) {
      cleanup();
    }
  }

  function start() {
    if (active) return false;
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    ctx = canvas.getContext('2d');
    if (!ctx) return false;

    stream = canvas.captureStream(fps);
    try {
      recorder = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: 3_500_000
      });
    } catch (err) {
      cleanup();
      onUnsupported?.();
      return false;
    }

    chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size) chunks.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mime.split(';')[0] });
      const filename = `wind-clip-${Date.now()}.${extension}`;
      cleanup();
      // Very slow devices can end a clip with fewer encoded frames than the
      // container needs. Treat a header-only blob (a few hundred bytes) as a
      // failed take so the caller can fall back to a still photo.
      if (!blob.size || blob.size < 1200) {
        onEmpty?.(resolvedDuration);
        return;
      }
      onDone?.(filename, blob, resolvedDuration);
    };

    recorder.start(250);
    active = true;
    startedAt = performance.now();
    resolvedDuration = duration;
    painted = 0;
    return true;
  }

  function frame(deps) {
    if (!active || !ctx) return;
    paintVideoFrame(ctx, width, height, deps);
    painted += 1;
    const elapsed = (performance.now() - startedAt) / 1000;
    if (elapsed >= duration) stop();
  }

  return {
    start,
    stop,
    frame,
    get active() { return active; },
    get elapsed() {
      return active ? (performance.now() - startedAt) / 1000 : resolvedDuration;
    },
    get duration() { return duration; },
    get frames() { return painted; }
  };
}
