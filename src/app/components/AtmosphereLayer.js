import { defineComponent, onMounted, ref } from 'vue';
import { runtime } from '../runtime.js';

/* ------------------------------------------------------------------ */
/*  Star field                                                         */
/*                                                                     */
/*  Procedurally painted once into a canvas, then handed to CSS as a    */
/*  background image. (Previously drawn by sky.js; moved here because   */
/*  it is decoration, not simulation.)                                 */
/* ------------------------------------------------------------------ */

const TAU = Math.PI * 2;

function paintStars() {
  const c = document.createElement('canvas');
  c.width = 1600;
  c.height = 900;
  const ctx = c.getContext('2d');
  if (!ctx) return '';

  for (let i = 0; i < 320; i++) {
    const x = Math.random() * c.width;
    const y = Math.pow(Math.random(), 0.9) * c.height * 0.86;
    const big = Math.random() > 0.92;
    const r = big ? 1.2 + Math.random() * 1.1 : 0.35 + Math.random() * 0.9;
    const a = big ? 0.55 + Math.random() * 0.4 : 0.2 + Math.random() * 0.55;
    ctx.beginPath();
    ctx.fillStyle = `rgba(255, 249, 234, ${a})`;
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }

  for (let i = 0; i < 16; i++) {
    const x = Math.random() * c.width;
    const y = Math.random() * c.height * 0.75;
    const g = ctx.createRadialGradient(x, y, 0, x, y, 7 + Math.random() * 8);
    g.addColorStop(0, 'rgba(255, 250, 238, 0.5)');
    g.addColorStop(1, 'rgba(255, 250, 238, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 20, y - 20, 40, 40);
  }

  return c.toDataURL('image/png');
}

export default defineComponent({
  name: 'AtmosphereLayer',
  setup() {
    const atmosphere = ref(null);
    const skyGlow = ref(null);
    const nightVeil = ref(null);
    const goldenVeil = ref(null);
    const stars = ref(null);
    const rays = ref(null);
    const foreSky = ref(null);

    const starImage = paintStars();

    onMounted(() => {
      if (stars.value) stars.value.style.backgroundImage = `url(${starImage})`;
      Object.assign(runtime.host.skyRefs, {
        root: document.documentElement,
        themeMeta: document.querySelector('meta[name="theme-color"]'),
        atmosphere: atmosphere.value,
        glow: skyGlow.value,
        nightVeil: nightVeil.value,
        goldenVeil: goldenVeil.value,
        stars: stars.value,
        rays: rays.value,
        foreSky: foreSky.value
      });
    });

    return { atmosphere, skyGlow, nightVeil, goldenVeil, stars, rays, foreSky };
  },
  template: `
    <div class="atmosphere" ref="atmosphere" aria-hidden="true">
      <div class="sky-glow" ref="skyGlow"></div>
    </div>

    <div class="night-veil" ref="nightVeil" aria-hidden="true"></div>
    <div class="golden-veil" ref="goldenVeil" aria-hidden="true"></div>
    <div class="stars" ref="stars" aria-hidden="true"></div>
    <div class="sun-rays" ref="rays" aria-hidden="true"></div>

    <div class="vignette" aria-hidden="true"></div>
    <div class="grain" aria-hidden="true"></div>

    <div class="fore-sky" ref="foreSky" aria-hidden="true">
      <div class="fore-cloud fore-cloud--a"></div>
      <div class="fore-cloud fore-cloud--b"></div>
    </div>
  `
});