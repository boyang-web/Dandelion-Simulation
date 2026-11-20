# 发布与性能估算

## 结论

- **单文件发布可行**：生成一个约 **1.51 MB** 的 `dist/dandelion.html`，CSS、
  three.js 和业务代码全部内联，无外部请求，双击即可运行。
- **GitHub Pages 更适合长期发布**：纯静态、无需构建服务；首屏可以缓存各个
  JS/CSS 文件，后续更新不会让用户每次重下 1.5 MB。
- **托管方式不影响帧率**：性能只取决于设备的 WebGL / GPU。GitHub Pages 只负责
  把静态文件送出去。

## 单文件

```bash
python3 tools/build-classic-bundle.py   # 先更新经典包
python3 tools/build-single-file.py      # 再烘焙单文件
```

输出：`dist/dandelion.html`

- 内联 `vendor/three.global.js` + `js/bundle.js` + `css/style.css`；
- 用户启动无控制台、无 `localStorage` 依赖；
- `?dev=1` 仍然可以打开开发者控制台（单文件里保留了控制台代码）；
- 适合直接发给别人、放 U 盘、或作为邮件/网盘附件；
- 缺点：每次更新都是完整的 1.5 MB，无法按文件复用缓存。

## GitHub Pages

1. 把仓库推到 GitHub；
2. Settings → Pages → Build and deployment → **Deploy from a branch**；
3. Branch 选 `main`，目录选 `/ (root)`；
4. 仓库根目录已放 `.nojekyll`，避免 Jekyll 处理静态资源；
5. 用户入口：`https://<user>.github.io/<repo>/`
6. 开发者入口：`https://<user>.github.io/<repo>/dev.html`（跳转到 `?dev=1`）。

发布时 `index.html` 在 http(s) 下走 ES module + importmap；`file://` 下自动切到
经典包。若需要兼容不支持 importmap 的旧浏览器，直接发布 `dist/dandelion.html`
（经典脚本、单文件），或把入口改成固定经典包。

## 体积与运行成本

| 项目 | 数值 |
| --- | --- |
| 单文件 | 1.51 MB（未压缩） |
| three.js 经典包 | 1.25 MB |
| 业务经典包 | 266 KB |
| CSS | 21 KB |
| 桌面场景 | 约 2.7 M 三角形 / 58 draw calls |
| 手机 coarse 档 | 约 1.58 M 三角形 / 55 draw calls |
| 手机渲染像素比 | 上限 1.6（390 × 844 → 624 × 1350；844 × 390 → 1350 × 624） |

> 三角形和 draw calls 是关闭后处理时测得的场景本体数据；后处理（泛光、散射）
> 会再增加若干全屏 pass，估算流畅度时已把它算进去。

手机 coarse 档已经自动做了这些降级：

- 草簇 9000 → 5000；
- 云层 6 片 → 3 片；
- 设备像素比上限 1.6；
- 竖屏相机后移到 `z = 11.7`，避免横向裁切；
- 横屏（coarse 且高度 ≤ 560）相机改为 `fov 35 / z 9.9`，日月弧线压平，标题/提示/天体控件同步缩小，并避开刘海安全区。

**流畅度估算**：现代中高端手机（A14 / 骁龙 865 及更新）在 1.6 M 三角形、
55 draw calls 的负载下，通常可以维持 30–60 fps；较老的入门机可能落在
20–30 fps。真正的帧率请在目标手机上用 `?debug=1` 看 `fps` 字段确认。
如果低端机仍然吃力，优先把 `js/meadow.js` 里 coarse 的草簇数量继续下调，
或对 coarse 设备关闭后处理泛光。

## 发布前检查

```bash
python3 tools/build-single-file.py
```

- `dist/dandelion.html` 约 1.5 MB，`file://` 双击应正常渲染；
- `index.html` 用户启动不应出现 `DEV` 按钮；
- `index.html?dev=1` 或 `dev.html` 应出现开发者面板；
- 手机竖屏下确认相机为竖屏机位（`camera.position.z = 11.7`）、草簇 5000、
  云 3 片；
- 手机横屏（844 × 390 / 667 × 375）下确认 `camera.fov = 35`、`camera.position.z = 9.9`，
  正午太阳顶端仍在视口内，WIND 条隐藏。