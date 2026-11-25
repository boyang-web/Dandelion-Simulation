import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/*  D · post light pipeline                                            */
/*                                                                     */
/*  Everything is rendered into a linear HDR target, then:             */
/*    1. a soft bright-pass keeps only the highlights (fluff, rim)     */
/*    2. two blurred octaves are added back as a wide, low bloom       */
/*    3. a gentle filmic shoulder + split-tone grade finishes the frame */
/*    4. atmospheric in-scattering warms the view toward the sun       */
/*                                                                     */
/*  The sky is painted in CSS behind the canvas, so the composite keeps */
/*  the original alpha and only lets bloom spill a little over it.      */
/* ------------------------------------------------------------------ */

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const BRIGHT_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D tSrc;
  uniform vec2 uTexel;
  uniform float uThreshold;
  uniform float uKnee;
  varying vec2 vUv;

  void main() {
    vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
    c += texture2D(tSrc, vUv + uTexel * vec2( 1.0, -1.0)).rgb;
    c += texture2D(tSrc, vUv + uTexel * vec2(-1.0,  1.0)).rgb;
    c += texture2D(tSrc, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
    c *= 0.25;

    float lum = max(c.r, max(c.g, c.b));
    float soft = clamp((lum - uThreshold + uKnee) / max(2.0 * uKnee, 1e-4), 0.0, 1.0);
    soft = soft * soft * (2.0 - soft);
    float w = max(lum - uThreshold, 0.0) / max(lum, 1e-4) * soft;
    gl_FragColor = vec4(c * w, 1.0);
  }
`;

const BLUR_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D tSrc;
  uniform vec2 uStep;
  varying vec2 vUv;

  void main() {
    vec3 c = texture2D(tSrc, vUv).rgb * 0.227027;
    c += texture2D(tSrc, vUv + uStep * 1.384615).rgb * 0.316216;
    c += texture2D(tSrc, vUv - uStep * 1.384615).rgb * 0.316216;
    c += texture2D(tSrc, vUv + uStep * 3.230769).rgb * 0.070270;
    c += texture2D(tSrc, vUv - uStep * 3.230769).rgb * 0.070270;
    gl_FragColor = vec4(c, 1.0);
  }
`;

const COPY_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D tSrc;
  varying vec2 vUv;
  void main() {
    gl_FragColor = vec4(texture2D(tSrc, vUv).rgb, 1.0);
  }
`;

const COMPOSITE_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D tScene;
  uniform sampler2D tBloom;
  uniform sampler2D tWide;
  uniform vec2 uSunUV;
  uniform vec3 uSunColor;
  uniform vec3 uSunDirView;
  uniform float uAspect;
  uniform float uTanHalf;
  uniform float uExposure;
  uniform float uBloom;
  uniform float uScatter;
  uniform float uShoulder;
  uniform float uSaturation;
  uniform float uGrade;
  varying vec2 vUv;

  vec3 linearToSrgb(vec3 c) {
    c = max(c, vec3(0.0));
    vec3 lo = c * 12.92;
    vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
    return mix(lo, hi, step(vec3(0.0031308), c));
  }

  void main() {
    vec4 base = texture2D(tScene, vUv);          // premultiplied linear
    vec3 nearBloom = texture2D(tBloom, vUv).rgb;
    vec3 wideBloom = texture2D(tWide, vUv).rgb;

    float a = base.a;
    vec3 straight = base.rgb / max(a, 1e-4);

    vec3 bloom = nearBloom * 0.62 + wideBloom * 0.46;
    float bloomLum = dot(bloom, vec3(0.2126, 0.7152, 0.0722));
    float bloomA = clamp(bloomLum * 0.55, 0.0, 0.55);

    // --- atmospheric in-scatter, physically the same view term as haze ---
    vec2 ndc = vUv * 2.0 - 1.0;
    vec3 ray = normalize(vec3(ndc.x * uTanHalf * uAspect, ndc.y * uTanHalf, -1.0));
    float mu = max(dot(ray, normalize(uSunDirView)), 0.0);
    float scatter = pow(mu, 5.0) * uScatter;
    // a slightly tighter halo right around the disc helps it read as air
    vec2 d = (vUv - uSunUV) * vec2(uAspect, 1.0);
    float halo = exp(-dot(d, d) * 9.0) * uScatter * 0.55;
    scatter = min(scatter + halo, 1.0);

    vec3 air = uSunColor * scatter * 0.085;

    // --- additive light (premultiplied so the CSS sky stays clean) ------ */
    float outA = 1.0 - (1.0 - a) * (1.0 - bloomA);
    vec3 outRgb = straight * a + bloom * bloomA + air * max(a, 0.22);
    outA = clamp(outA + scatter * 0.06 * (1.0 - a), 0.0, 1.0);
    vec3 col = outRgb / max(outA, 1e-4);

    col *= uExposure;

    // filmic highlight shoulder: only the last stop gets compressed
    float peak = max(col.r, max(col.g, col.b));
    float over = max(peak - 0.80, 0.0);
    col -= col * (over / max(peak, 1e-4)) * uShoulder * 0.55;

    // split-tone grade: cool shadows, warm highlights, a touch of saturation
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(lum), col, uSaturation);
    float hiMask = smoothstep(0.45, 1.05, lum);
    float loMask = 1.0 - smoothstep(0.02, 0.42, lum);
    col += vec3(0.012, 0.006, -0.004) * hiMask * uGrade;
    col += vec3(-0.005, -0.001, 0.010) * loMask * uGrade;

    gl_FragColor = vec4(linearToSrgb(col) * outA, outA);
  }
`;

function makeRT(width, height, samples = 0, depth = false) {
  const rt = new THREE.WebGLRenderTarget(Math.max(1, width), Math.max(1, height), {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: depth,
    stencilBuffer: false,
    samples
  });
  rt.texture.generateMipmaps = false;
  return rt;
}

function passMaterial(fragmentShader, uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
    transparent: false,
    blending: THREE.NoBlending,
    toneMapped: false
  });
}

export function createPostPipeline({ renderer, scene, camera, enabled = true }) {
  const coarse = window.matchMedia('(pointer: coarse)').matches;

  const state = {
    enabled,
    width: 1,
    height: 1,
    timeState: {
      sunUV: new THREE.Vector2(0.5, 0.75),
      sunColor: new THREE.Color('#ffddb0'),
      sunDirView: new THREE.Vector3(0, 1, 0),
      sunDirWorld: new THREE.Vector3(0, 1, 0),
      bloomMul: 1,
      exposureMul: 1,
      scatterMul: 1
    },
    grade: { bloom: 0.72, exposure: 1.0, scatter: 0.42, shoulder: 0.34, saturation: 1.035 }
  };

  const quad = new THREE.Mesh(new THREE.BufferGeometry());
  const positions = new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]);
  const uvs = new Float32Array([0, 0, 2, 0, 0, 2]);
  quad.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  quad.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene();
  quadScene.add(quad);
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  let sceneRT = null;
  let brightRT = null;
  let blurA = null;
  let blurB = null;
  let wideA = null;
  let wideB = null;
  let ready = false;

  const brightMat = passMaterial(BRIGHT_FRAG, {
    tSrc: { value: null },
    uTexel: { value: new THREE.Vector2() },
    uThreshold: { value: 0.72 },
    uKnee: { value: 0.26 }
  });

  const blurMat = passMaterial(BLUR_FRAG, {
    tSrc: { value: null },
    uStep: { value: new THREE.Vector2() }
  });

  const copyMat = passMaterial(COPY_FRAG, { tSrc: { value: null } });

  const compositeMat = passMaterial(COMPOSITE_FRAG, {
    tScene: { value: null },
    tBloom: { value: null },
    tWide: { value: null },
    uSunUV: { value: new THREE.Vector2(0.5, 0.75) },
    uSunColor: { value: new THREE.Color('#ffddb0') },
    uSunDirView: { value: new THREE.Vector3(0, 1, 0) },
    uAspect: { value: 1 },
    uTanHalf: { value: Math.tan((camera.fov * Math.PI) / 360) },
    uExposure: { value: 1 },
    uBloom: { value: state.grade.bloom },
    uScatter: { value: state.grade.scatter },
    uShoulder: { value: state.grade.shoulder },
    uSaturation: { value: state.grade.saturation },
    uGrade: { value: 1 }
  });

  function disposeTargets() {
    for (const rt of [sceneRT, brightRT, blurA, blurB, wideA, wideB]) rt?.dispose();
  }

  function resize() {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(2, Math.round(size.x));
    const h = Math.max(2, Math.round(size.y));
    if (w === state.width && h === state.height && ready) return;

    state.width = w;
    state.height = h;
    disposeTargets();

    const samples = renderer.capabilities.isWebGL2 && !coarse ? 4 : 0;
    const halfW = Math.max(1, Math.round(w / 2));
    const halfH = Math.max(1, Math.round(h / 2));
    const quarterW = Math.max(1, Math.round(w / 4));
    const quarterH = Math.max(1, Math.round(h / 4));

    sceneRT = makeRT(w, h, samples, true);
    brightRT = makeRT(halfW, halfH);
    blurA = makeRT(halfW, halfH);
    blurB = makeRT(halfW, halfH);
    wideA = makeRT(quarterW, quarterH);
    wideB = makeRT(quarterW, quarterH);

    compositeMat.uniforms.uAspect.value = w / h;
    compositeMat.uniforms.uTanHalf.value = Math.tan((camera.fov * Math.PI) / 360);
    ready = true;
  }

  function draw(material, target) {
    quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(quadScene, quadCamera);
  }

  function setTime(lightState, sunDirWorld) {
    const ts = state.timeState;
    if (lightState) {
      if (lightState.x !== undefined) ts.sunUV.set(lightState.x, lightState.y);
      if (lightState.color) ts.sunColor.copy(lightState.color);
      ts.bloomMul = 0.85 + 0.35 * (lightState.golden || 0);
      ts.exposureMul = 1 + 0.05 * (lightState.golden || 0) - 0.06 * (lightState.night || 0);
      ts.scatterMul = 0.45 + 0.75 * (lightState.golden || 0) + 0.18 * (lightState.day || 0);
    }
    if (sunDirWorld) ts.sunDirWorld.copy(sunDirWorld);
  }

  function render(cameraOverride) {
    const cam = cameraOverride || camera;
    cam.updateMatrixWorld();
    compositeMat.uniforms.uTanHalf.value = Math.tan((cam.fov * Math.PI) / 360);
    state.timeState.sunDirView
      .copy(state.timeState.sunDirWorld)
      .transformDirection(cam.matrixWorldInverse)
      .normalize();

    if (!state.enabled) {
      renderer.setRenderTarget(null);
      renderer.render(scene, cam);
      return;
    }
    if (!ready) resize();
    if (!sceneRT) {
      renderer.setRenderTarget(null);
      renderer.render(scene, cam);
      return;
    }

    const g = state.grade;
    compositeMat.uniforms.uExposure.value = g.exposure * state.timeState.exposureMul;
    compositeMat.uniforms.uBloom.value = g.bloom * state.timeState.bloomMul;
    compositeMat.uniforms.uScatter.value = g.scatter * state.timeState.scatterMul;
    compositeMat.uniforms.uShoulder.value = g.shoulder;
    compositeMat.uniforms.uSaturation.value = g.saturation;
    compositeMat.uniforms.uSunUV.value.copy(state.timeState.sunUV);
    compositeMat.uniforms.uSunColor.value.copy(state.timeState.sunColor);
    compositeMat.uniforms.uSunDirView.value.copy(state.timeState.sunDirView);

    // 1. scene -> linear HDR target
    renderer.setRenderTarget(sceneRT);
    renderer.render(scene, cam);

    // 2. bright pass at half resolution
    brightMat.uniforms.tSrc.value = sceneRT.texture;
    brightMat.uniforms.uTexel.value.set(1 / state.width, 1 / state.height);
    draw(brightMat, brightRT);

    // 3. half-res blur (tight halo)
    const halfW = brightRT.width;
    const halfH = brightRT.height;
    blurMat.uniforms.tSrc.value = brightRT.texture;
    blurMat.uniforms.uStep.value.set(1 / halfW, 0);
    draw(blurMat, blurA);
    blurMat.uniforms.tSrc.value = blurA.texture;
    blurMat.uniforms.uStep.value.set(0, 1 / halfH);
    draw(blurMat, blurB);

    // 4. quarter-res copy + wide blur (soft atmospheric halo)
    copyMat.uniforms.tSrc.value = blurB.texture;
    draw(copyMat, wideA);
    const wideW = wideA.width;
    const wideH = wideA.height;
    blurMat.uniforms.tSrc.value = wideA.texture;
    blurMat.uniforms.uStep.value.set(1 / wideW, 0);
    draw(blurMat, wideB);
    blurMat.uniforms.tSrc.value = wideB.texture;
    blurMat.uniforms.uStep.value.set(0, 1 / wideH);
    draw(blurMat, wideA);

    // 5. composite straight to the canvas
    compositeMat.uniforms.tScene.value = sceneRT.texture;
    compositeMat.uniforms.tBloom.value = blurB.texture;
    compositeMat.uniforms.tWide.value = wideA.texture;
    draw(compositeMat, null);
    renderer.setRenderTarget(null);
  }

  resize();

  return {
    state,
    grade: state.grade,
    get enabled() { return state.enabled; },
    set enabled(v) { state.enabled = !!v; },
    resize,
    setTime,
    render
  };
}