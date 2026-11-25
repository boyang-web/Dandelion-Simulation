# 架构说明 · 等风来（Vue 重构版）

原来，场景更新和按钮事件都写在约 1200 行的 main.js 里。现在 Three.js 负责模拟，Vue 负责界面，两边通过同一份状态传递风速、能力和照片。查一次按键的效果，可以从组件事件一路跟到引擎。

---

## 1. 目录结构

```
dandelion/
├── 启动.command                # 双击启动器（选端口 + 开浏览器）
├── index.html                  # Demo 目录
├── game.html                   # Vue 应用入口（importmap: three / vue）
├── dev.html                    # 开发者启动页（跳转 ?dev=1）
├── vendor/
│   ├── three.module.js         # three.js（离线）
│   ├── three.global.js         # three.js 经典全局版（file:// 备用）
│   ├── vue.esm-browser.prod.js # Vue 3.5 运行时 + 模板编译器（生产）
│   └── vue.esm-browser.js      # Vue 3.5 开发版
├── src/
│   ├── main.js                 # createApp(App).mount('#app')
│   ├── app/
│   │   ├── App.js              # 根组件：层叠顺序、body 状态类、天空绘制器挂载
│   │   ├── runtime.js          # 共享运行时：ui store / api 引用 / 宿主 sink
│   │   ├── state/ui.js         # 响应式 UI store（唯一事实来源）
│   │   ├── lib/sky-painter.js  # 天空 paint → CSS 变量（60fps 专用通道）
│   │   └── components/
│   │       ├── AtmosphereLayer.js   # 氛围、夜/金纱、星野、光束、暗角、颗粒、云
│   │       ├── SceneStage.js        # 两个 WebGL canvas + 引擎生命周期
│   │       ├── CelestialLayer.js    # 太阳 / 月亮 / 轨道弧线
│   │       ├── CelestialBody.js     # 单个天体：指针捕获、键盘无障碍
│   │       └── hud/
│   │           ├── Masthead.js      HintBar.js      WindMeter.js
│   │           ├── AbilityPanel.js  SoundToggle.js  ContextHint.js
│   │           ├── Toast.js         RecBadge.js     PostcardStrip.js
│   │           ├── FilmButton.js    FilmPanel.js    JourneyEnd.js
│   │           ├── TouchPad.js      DebugPanel.js   NoWebglNotice.js
│   ├── engine/
│   │   ├── experience.js       # 原 main.js → 纯引擎：场景、输入、流程
│   │   ├── film-archive.js     # 胶片卷 / 明信片 / 结尾卡（原 main.js 里的 UI 逻辑）
│   │   ├── sky.js              # 天空与时间（DOM-free，输出 paint 快照）
│   │   ├── wind.js  world.js  dandelion.js  dandelion-field.js
│   │   ├── orbit.js  player.js  sky.js  post.js  clouds.js  birds.js
│   │   ├── anchors.js  abilities.js  journey-assets.js  film-camera.js
│   │   ├── capture.js  audio.js  mobile-controls.js  dev-console.js
│   │   └── …（地形、山脊、草、风车、树等程序化资产）
│   └── styles/
│       ├── style.css           # 主场景样式（沿用原有设计令牌）
│       └── vegetation.css      # 资产陈列页样式
├── labs/                       # 开发预览页（仍可直接打开）
├── tools/
│   ├── build-classic-bundle.py # 生成经典脚本包（file:// 备用）
│   └── e2e/                    # 无头 Chrome 功能测试（零依赖）
└── docs/                       # 说明文档、演示文稿、测试报告、截图
```

---

## 2. 三层职责

| 层 | 位置 | 允许做的事 | 禁止的事 |
|---|---|---|---|
| 引擎层 | `src/engine` | 场景图、着色器、物理/风场、输入采样、进度存储 | 查询 / 修改 DOM（`document.getElementById`、`classList` 等） |
| 状态层 | `src/app/state`、`runtime.js` | 保存 UI 需要的纯数据；提供 `showToast` / `setContext` 等动作 | 持有 three.js 对象、渲染 |
| 视图层 | `src/app/components` | 声明式模板、事件转发、无障碍属性 | 直接写引擎内部状态（只能调 API） |

数据只走一个方向：

```
用户手势 ──► Vue 组件 ──callApi()──► engine（experience / sky / mobile）
                                        │
                                        └──写──► reactive store ──► Vue 重新渲染
```

`runtime.js` 是唯一的连接点：

```js
export const runtime = {
  store,                 // { ui, showToast, setContext, … }
  ui: store.ui,          // reactive(...)
  api: shallowRef(null), // createExperience() 返回的引擎接口
  host: { paintSky: null, skyRefs: {} }
};
```

---

## 3. 关键桥梁一：store（状态 → 视图）

`createUiState()` 里每个字段都有明确归属，例如：

| 字段 | 写入方 | 读取方 | 频率 |
|---|---|---|---|
| `wind` | `experience.updateUI()` | `WindMeter` | 变化 > 0.012 才写 |
| `abilities.items/count` | `refreshHUD()` | `AbilityPanel` | 解锁时 |
| `context` | `stepScene()` | `ContextHint` | 变化才写 |
| `toast.text/visible` | `store.showToast()` | `Toast` | 事件驱动 |
| `postcards` | `filmArchive.refreshPostcards()` | `PostcardStrip` | 取景 / 解锁时 |
| `film.items/open/count` | `FilmArchive` | `FilmButton` / `FilmPanel` | 拍照 / 开合 |
| `record.visible/time` | 录制循环 | `RecBadge` | 0.1 s 节流 |
| `mobile.*` | `mobileControls.describe()` | `TouchPad` | 状态变化才写 |
| `sky.time/visibleBody/interactive` | `syncShellState()` | 天体 ARIA / 时间文案 | 变化才写 |
| `debug.text` | `updateDebug()` | `DebugPanel` | 0.25 s |
| `ready / interacted / clean / noWebgl / sky3d / still / orbitDragging` | 引擎 + `App` watch | `<body>` class | 一次性 |

这样，原来散落在 `main.js` 的 20 多处 `document.getElementById(...).textContent = …`
全部变成了「改一个字段 → Vue 自动更新」。

---

## 4. 关键桥梁二：sky paint（60 fps 性能边界）

太阳/月亮的位置、夜色遮罩、金色光、星野、光束、云色、墨色，每帧都在变。
把它们塞进 `reactive` 会带来不必要的手动追踪开销，也会让 Vue 每帧重渲染整棵组件树。

因此保留一条**显式的、文档化的**渲染旁路：

1. `Sky` 只计算结果，写入一个普通对象 `paint`：
   ```js
   paint = {
     bodies: { sun: {x, y, disc, halo, golden, active, pressing, below, hidden, haloColor}, moon: {...} },
     arc: { above, below, visible },
     night, stars, golden, glow: {x,y,opacity}, rays: {x,y,opacity,rgb},
     clouds: {hi, lo, warm},
     ink: {ink, soft, faint, line},
     theme, time: {pct, label}, viewWidth, viewHeight
   }
   ```
2. `sky.emit()` 只在帧末调用一次；`SkyPainter` 把快照写成 `<html>` 上的
   CSS 变量和 `.celestial` 的 class / `left` / `top`。
3. 写了值才写（内部 WeakMap 去重），避免无谓的样式失效。

结果：DOM 仍是 Vue 渲染的（结构、可访问性、事件都在组件里），
连续数值走 CSS 变量，Vue 的响应式调度器不参与逐帧更新。

---

## 5. 关键桥梁三：输入

| 输入 | 归属 | 说明 |
|---|---|---|
| WASD / Space | `player.js`（引擎） | 与摄像机无关的持续按键状态 |
| C / X / P / V / E / Esc | `experience.js`（引擎） | 全局快捷键，带 `isTypingTarget` 防护 |
| 画布点击种植 | `experience.js` | 只有 canvas 上的短按会种植；UI 点击不会误种 |
| 摇杆 / 触屏按钮 | `TouchPad.vue` → `api.joystick/liftHeld/…` | 组件只负责归一化坐标与指针捕获 |
| 日月拖动 / 键盘拨动 | `CelestialBody.vue` → `api.skyBeginPress/skyMovePress/skyNudge` | 组件负责 `setPointerCapture` 与 ARIA |
| 镜头环绕 / 缩放 | `orbit.js` 与 `film-camera.js`（引擎） | 绑在 canvas 上，不经过 Vue |

---

## 6. 迁移前后对照

| 原来（main.js + 静态 HTML） | 现在 |
|---|---|
| `index.html` 里 100+ 行静态 UI 标记 | `App.js` + 15 个组件，模板即结构 |
| `main.js` 1213 行，包含场景 + UI + 进度 + 录制 | `experience.js`（场景/输入）+ `film-archive.js`（胶片/明信片） |
| `sky.js` 直接改 11 个 DOM 节点的样式与 class | `sky.js` 输出 paint 快照；`sky-painter.js` 写入 CSS 变量 |
| `mobile-controls.js` 查 8 个 DOM id、改 `hidden`/文案 | `mobile-controls.js` 纯状态机；`TouchPad.js` 按 `ui.mobile` 渲染 |
| 能力面板用 `replaceChildren` 手工建 `<span>` | `v-for` 绑定 `ui.abilities.items` |
| 明信片 / 胶片卷用 `createElement` 拼 DOM | `v-for` + `:class` + `:src` 绑定 |
| Toast / context 用 `classList` 开关 | `:class="{ 'is-visible': … }"` |
| `body.ready` 等类由引擎 `classList.add` | `App` watch 一个布尔字段 |
| `orbit` 直接 `document.body.classList` | `onDraggingChange` 回调 → `ui.orbitDragging` |

---

## 7. 运行与构建

```bash
# macOS：双击 启动.command（自动选端口、开浏览器、关窗即停）
# 或手动：
python3 -m http.server 8000
# 打开 http://localhost:8000/

# 经典脚本包（可选，用于 file:// 或 labs 的双击打开）
python3 tools/build-classic-bundle.py
```

依赖全部在 `vendor/`，不需要 npm，不需要联网。

---

## 8. 测试

```bash
python3 tools/serve_local.py 8124 .
python3 tools/e2e/test_experience.py --url http://127.0.0.1:8124
```

`tools/e2e/cdp.py` 是一个 200 行的 CDP 驱动：启动 headless Chrome（SwiftShader WebGL）、
建立 WebSocket、派发真实的鼠标/键盘事件、读取控制台异常、截图。
测试覆盖：启动、风场与风力计、种植、能力解锁、相机安放/快门/胶片卷、
时间拖动与键盘、声音开关、五张明信片结尾、移动端摇杆与按钮、调试面板、
静态出帧、响应式、labs 回归。

报告写入 `docs/test-report.json`，截图写入 `docs/shots/`。

---

## 9. 已知取舍

- **Vue 用浏览器版（含模板编译器）**：项目坚持「零构建、离线、可直接托管」，
  不引入 Vite。组件模板写在 `.js` 文件里，换来的是**无需 npm 安装**即可运行。
  若后续引入构建流程，这些模板可以几乎无改动地迁到 SFC。
- **每帧样式写入仍存在**，但只有一个模块（`sky-painter.js`）和一组 CSS 变量，
  且是显式的性能边界，不是散落各处的 DOM 操作。
- **开发面板 `dev-console.js` 仍自建 DOM**：它是只在 `?dev=1` 下出现的调试覆盖层，
  不属于产品 UI；保留可以让它继续零耦合地挂载/卸载。
- 双击首页时，浏览器读取本地经典脚本包。修改场景或界面代码后，用 `python3 tools/build-classic-bundle.py` 更新离线版本。通过 HTTP 打开时直接加载源码模块。
---

## 10. 低资源验证

为了避免影响正在使用的电脑，验证提供了两种模式：

- `tools/e2e/test_light.py`：760×480、`?quality=low`、`?post=0`、单渲染进程、
  最低进程优先级、单次页面加载、硬性时间上限，跑完立即关闭浏览器。
- `tools/e2e/test_experience.py`：完整套件（多页面、全尺寸、1920×1080 快照），
  建议在机器空闲时运行。

结果与限制见 `docs/TESTING.md` 与 `docs/test-report.json`。
软件 WebGL（SwiftShader）在 40–60 秒后会回收 GPU 进程，这是环境限制，
真实 GPU 上不存在；低资源模式因此不会触发 1920×1080 回读与视频编码。
