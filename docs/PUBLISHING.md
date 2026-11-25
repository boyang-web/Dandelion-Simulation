# 发布与性能估算

## 发布方式

项目现在只发布 **GitHub Pages 静态站点**，不再生成单文件包。

- 用户入口：`index.html`（Demo 目录）
- 开发者入口：`dev.html` → `game.html?dev=1`
- 预览页集中在 `labs/`，不占用根目录
- 根目录有 `.nojekyll`，不需要构建服务

### GitHub Pages

仓库已经带有 `.github/workflows/deploy-pages.yml`，推送到 `main` 会自动发布：

1. Settings → Pages → Build and deployment → Source 选 **GitHub Actions**；
2. push 到 `main`，工作流会 checkout 整仓并上传 Pages artifact；
3. 用户访问 `https://<user>.github.io/<repo>/`；
4. 开发者访问 `https://<user>.github.io/<repo>/dev.html`。

http(s) 下加载 ES module + importmap；`file://` 下自动切换到
`vendor/three.global.js + js/bundle.js` 经典包。修改 `js/*.js` 后要重建经典包：

```bash
python3 tools/build-classic-bundle.py
```

## 体积与运行成本

| 项目 | 数值 |
| --- | --- |
| three.js 经典包 | 1.25 MB |
| 业务经典包 | 约 289 KB |
| CSS | 约 25 KB |
| 桌面场景 | 约 2.7 M 三角形 / 50 draw calls |
| 手机 coarse 档 | 约 1.59 M 三角形 / 48 draw calls |
| 手机渲染像素比 | 上限 1.6（390 × 844 → 624 × 1350；844 × 390 → 1350 × 624） |

> 三角形和 draw calls 是关闭后处理时测得的场景本体数据；后处理（泛光、散射）
> 会再增加若干全屏 pass，估算流畅度时已把它算进去。

手机 coarse 档已经自动做了这些降级：

- 草簇 9000 → 5000；
- 云层 8 片 → 6 片；
- 设备像素比上限 1.6；
- 竖屏相机后移到 `z = 11.7`，避免横向裁切；
- 横屏（coarse 且高度 ≤ 560）相机改为 `fov 35 / z 9.9`，日月弧线压平，标题/提示/天体控件同步缩小，并避开刘海安全区。

**流畅度估算**：现代中高端手机（A14 / 骁龙 865 及更新）在约 1.6 M 三角形、
55 draw calls 的负载下，通常可以维持 30–60 fps；较老的入门机可能落在
20–30 fps。真正的帧率请在目标手机上用 `?debug=1` 看 `fps` 字段确认。
如果低端机仍然吃力，优先把 `js/meadow.js` 里 coarse 的草簇数量继续下调，
或对 coarse 设备关闭后处理泛光。

## 发布前检查

- `index.html` 用户启动不应出现 `DEV` 按钮；
- `game.html?dev=1` 或 `dev.html` 应出现开发者面板；
- 手机竖屏下确认相机为竖屏机位（`camera.position.z = 11.7`）、草簇 5000、
  云 6 片；
- 手机横屏（844 × 390 / 667 × 375）下确认 `camera.fov = 35`、`camera.position.z = 9.9`，
  正午太阳顶端仍在视口内，WIND 条隐藏；
- 鼠标滑过/单指滑过能起风；点击或轻点草地能种下一株野生蒲公英；拖动/滚轮/双指能改变视角；
- 同一地点先起风、再种下、再旋转视角，状态都保留；
- 野蒲公英茎约 12–14 秒后淡出，种子约 35–40 秒后散尽；
- 水平旋转 360°、垂直 0–90°、缩放 2.5–32；旋转后山脊/树线/云仍是连续背景，风场和种植点仍按新视角工作。