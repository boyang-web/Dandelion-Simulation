/* ------------------------------------------------------------------ */
/*  Dev console                                                        */
/*  Live, persisted tuning for every interaction parameter.            */
/*  Values are written directly into the runtime objects.              */
/* ------------------------------------------------------------------ */

const STORAGE_BASE = 'dandelion.dev';

function fmt(v, step) {
  const n = Number(v);
  const digits = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
  return n.toFixed(digits);
}

function row(group, label, obj, key, min, max, step, unit = '', only = 'both') {
  return { group, label, obj, key, min, max, step, unit, only, id: `${group}::${key}` };
}

export function createDevConsole({ wind, dandelion, sky, world, fireflies, post, birds, mode = 'full' }) {
  const distant = mode === 'distant';
  const STORAGE_KEY = distant ? `${STORAGE_BASE}.distant.v2` : `${STORAGE_BASE}.v2`;

  // Only the controls that visibly change the picture are kept. Gesture
  // smoothing, thresholds and low-pass internals stay at their defaults.
  const allGroups = [
    {
      label: '画面 · LOOK',
      rows: [
        row('画面', '曝光', post.grade, 'exposure', 0.6, 1.6, 0.01),
        row('画面', '泛光', post.grade, 'bloom', 0, 1.6, 0.01),
        row('画面', '空气散射', post.grade, 'scatter', 0, 1, 0.01),
        row('画面', '饱和度', post.grade, 'saturation', 0.8, 1.3, 0.005),
        row('画面', '远景雾化', world.params, 'haze', 0, 1.6, 0.01),
        row('画面', '云影强度', world.params, 'cloudShadow', 0, 1.2, 0.01),
        row('画面', '草叶透光', world.params, 'translucency', 0, 0.5, 0.01, '', 'main'),
        row('画面', '根部阴影', world.params, 'rootAo', 0, 0.6, 0.01, '', 'main')
      ]
    },
    {
      label: '远景 · DISTANCE',
      rows: [
        ...(world.clouds
          ? [row('远景', '云层浓度', world.clouds.params, 'opacity', 0, 1.6, 0.01)]
          : []),
        row('远景', '鸟群最小间隔', birds.params, 'gapMin', 8, 120, 1, 's'),
        row('远景', '鸟群最大间隔', birds.params, 'gapMax', 14, 180, 1, 's'),
        row('远景', '鸟群体型', birds.params, 'scale', 0.4, 2.5, 0.05)
      ]
    },
    {
      label: '草地与风 · MEADOW',
      rows: [
        row('草地', '最大风速', wind.params, 'maxAirSpeed', 1, 16, 0.1, '', 'main'),
        row('草地', '草弯曲幅度', wind.params, 'grassBendScale', 0.2, 3, 0.05, '', 'main'),
        row('草地', '草受力增益', wind.params, 'grassShaderGain', 0.2, 2.5, 0.05, '', 'main'),
        row('草地', '草风范围', wind.params, 'grassRadiusFactor', 0.25, 1.2, 0.01, '', 'main')
      ]
    },
    {
      label: '蒲公英 · DANDELION',
      rows: [
        row('蒲公英', '种子响应', dandelion.params, 'seedResponseGain', 0.2, 4, 0.05, '', 'main'),
        row('蒲公英', '种子寿命', dandelion.params, 'seedLifeMin', 4, 30, 1, '', 'main')
      ]
    },
    {
      label: '萤火虫 · FIREFLIES',
      rows: [
        row('萤火虫', '呼吸最高亮度', fireflies.params, 'breathMax', 0.1, 1.2, 0.01, '', 'main'),
        row('萤火虫', '光点大小', fireflies.params, 'sizeScale', 0.2, 4, 0.05, '', 'main'),
        row('萤火虫', '风力响应', fireflies.params, 'windScale', 0, 4, 0.05, '', 'main')
      ]
    }
  ];

  const groups = allGroups
    .map((g) => ({
      ...g,
      rows: g.rows.filter((r) => (distant ? r.only !== 'main' : true))
    }))
    .filter((g) => g.rows.length);

  // Capture the shipped defaults before applying a saved session.
  const defaults = new Map();
  for (const g of groups) for (const r of g.rows) defaults.set(r.id, r.obj[r.key]);

  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; } catch (err) { saved = {}; }
  if (saved.values) {
    for (const g of groups) {
      for (const r of g.rows) {
        const v = saved.values[r.id];
        if (Number.isFinite(v)) r.obj[r.key] = v;
      }
    }
  }

  let log = Array.isArray(saved.log) ? saved.log.slice(0, 20) : [];
  const inputs = new Map();

  const toggle = document.createElement('button');
  toggle.className = 'dev-toggle';
  toggle.type = 'button';
  toggle.textContent = 'DEV';
  toggle.setAttribute('data-no-wind', '');
  document.body.appendChild(toggle);

  const panel = document.createElement('aside');
  panel.className = 'dev-panel';
  panel.setAttribute('data-no-wind', '');
  panel.setAttribute('aria-label', '开发参数控制台');
  panel.hidden = true;
  panel.innerHTML = `
    <header class="dev-head">
      <div>
        <p class="dev-kicker">LIVE TUNING</p>
        <h2>画面参数</h2>
      </div>
      <button class="dev-close" type="button" aria-label="关闭">×</button>
    </header>
    <div class="dev-scroll"></div>
    <footer class="dev-foot">
      <div class="dev-actions">
        <button type="button" class="dev-reset">重置</button>
        <button type="button" class="dev-copy">复制参数</button>
      </div>
      <p class="dev-status" role="status"></p>
      <p class="dev-note"></p>
      <div class="dev-log">
        <p class="dev-log__title">最近修改</p>
        <ol></ol>
      </div>
    </footer>
  `;
  document.body.appendChild(panel);

  const scroll = panel.querySelector('.dev-scroll');
  const status = panel.querySelector('.dev-status');
  const note = panel.querySelector('.dev-note');
  const logList = panel.querySelector('.dev-log ol');

  note.textContent = world.meadow
    ? `草地 ${world.meadow.grassCount} 簇 · 花 ${world.meadow.flowerCount} 朵 · ` +
      `云 ${world.clouds ? world.clouds.entries.length : 0} 片 · ` +
      `萤火虫 ${fireflies.points.geometry.attributes.position.count}`
    : `远景 ${world.hills ? world.hills.length : 3} 层山脊 · ` +
      `云 ${world.clouds ? world.clouds.entries.length : 0} 片 · 鸟群 ${birds && birds.mesh ? birds.mesh.count : 0} 只`;

  if (distant) {
    const title = panel.querySelector('.dev-head h2');
    if (title) title.textContent = '远景参数';
  }

  function save() {
    const values = {};
    for (const g of groups) for (const r of g.rows) values[r.id] = r.obj[r.key];
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ values, log: log.slice(0, 20) }));
    } catch (err) { /* storage disabled */ }
  }

  function renderLog() {
    logList.innerHTML = '';
    for (const entry of log.slice(0, 8)) {
      const li = document.createElement('li');
      li.textContent = `${entry.time}  ${entry.label} = ${entry.value}`;
      logList.appendChild(li);
    }
  }

  function setStatus(text) {
    status.textContent = text;
    if (text) {
      clearTimeout(setStatus._t);
      setStatus._t = setTimeout(() => { status.textContent = ''; }, 2200);
    }
  }

  function record(r, value) {
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    log.unshift({ time, label: r.label, value: `${fmt(value, r.step)}${r.unit}` });
    log = log.slice(0, 20);
    renderLog();
    save();
  }

  function syncInputs() {
    for (const [id, input] of inputs) {
      const r = input.row;
      const v = r.obj[r.key];
      input.range.value = String(v);
      input.value.textContent = `${fmt(v, r.step)}${r.unit}`;
    }
  }

  for (const group of groups) {
    const section = document.createElement('section');
    section.className = 'dev-group';
    const title = document.createElement('h3');
    title.textContent = group.label;
    section.appendChild(title);

    for (const r of group.rows) {
      const rowEl = document.createElement('div');
      rowEl.className = 'dev-row';

      const label = document.createElement('label');
      const name = document.createElement('span');
      name.textContent = r.label;
      const value = document.createElement('span');
      value.className = 'dev-value';
      value.textContent = `${fmt(r.obj[r.key], r.step)}${r.unit}`;
      label.append(name, value);

      const range = document.createElement('input');
      range.type = 'range';
      range.min = String(r.min);
      range.max = String(r.max);
      range.step = String(r.step);
      range.value = String(r.obj[r.key]);

      const onChange = () => {
        const v = Number(range.value);
        r.obj[r.key] = v;
        value.textContent = `${fmt(v, r.step)}${r.unit}`;
        record(r, v);
      };
      range.addEventListener('input', onChange);

      rowEl.append(label, range);
      section.appendChild(rowEl);
      inputs.set(r.id, { row: r, range, value });
    }
    scroll.appendChild(section);
  }

  renderLog();

  function openPanel(open) {
    panel.hidden = !open;
    toggle.classList.toggle('is-open', open);
    if (open) syncInputs();
  }

  toggle.addEventListener('click', () => openPanel(panel.hidden));
  panel.querySelector('.dev-close').addEventListener('click', () => openPanel(false));

  if (birds) {
    const summon = document.createElement('button');
    summon.type = 'button';
    summon.textContent = '召唤鸟群';
    summon.title = '立即放一群鸟从远处飞过';
    summon.addEventListener('click', () => {
      birds.spawn();
      setStatus('鸟群已出发');
    });
    panel.querySelector('.dev-actions').appendChild(summon);
  }

  if (sky && typeof sky.setFlow === 'function') {
    const flowBtn = document.createElement('button');
    flowBtn.type = 'button';
    flowBtn.textContent = sky.flowEnabled ? '暂停时间' : '继续时间';
    flowBtn.title = '暂停或继续 240 秒一轮的日月循环';
    flowBtn.addEventListener('click', () => {
      sky.setFlow(!sky.flowEnabled);
      flowBtn.textContent = sky.flowEnabled ? '暂停时间' : '继续时间';
      setStatus(sky.flowEnabled ? '时间继续流动' : '时间已暂停');
    });
    panel.querySelector('.dev-actions').appendChild(flowBtn);
  }

  panel.querySelector('.dev-reset').addEventListener('click', () => {
    for (const g of groups) for (const r of g.rows) r.obj[r.key] = defaults.get(r.id);
    log = [];
    save();
    syncInputs();
    renderLog();
    setStatus('已恢复默认值');
  });

  panel.querySelector('.dev-copy').addEventListener('click', async () => {
    const payload = {
      values: Object.fromEntries(
        [...inputs.values()].map(({ row }) => [
          row.id,
          { group: row.group, label: row.label, value: row.obj[row.key] }
        ])
      ),
      scene: world.meadow
        ? {
            grassClumps: world.meadow.grassCount,
            flowers: world.meadow.flowerCount,
            meshes: world.meadow.meshes.length,
            fireflies: fireflies.points.geometry.attributes.position.count
          }
        : {
            mode: 'distant',
            ridges: world.hills ? world.hills.length : 0,
            clouds: world.clouds ? world.clouds.entries.length : 0,
            birds: birds ? 7 : 0
          }
    };
    const text = JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setStatus('参数已复制到剪贴板');
    } catch (err) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); setStatus('参数已复制'); }
      catch (e) { setStatus('复制失败，请手动记录'); }
      ta.remove();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) openPanel(false);
  });

  const params = new URLSearchParams(window.location.search);
  if (params.has('dev')) openPanel(true);

  return {
    panel,
    toggle,
    open: () => openPanel(true),
    close: () => openPanel(false),
    defaults,
    groups
  };
}