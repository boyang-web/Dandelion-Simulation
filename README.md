# 等风来 · Dandelion Demo

想玩主线，打开目录选「风灵山谷」。如果只是想吹一朵蒲公英，选「风的试验田」：点草地，等花头变白，再用鼠标轻轻一扫。目录里还能找到山谷用到的草木、风车和调光工具。

## 打开试玩

双击根目录的 index.html，在首页点选游戏、原型或展厅即可。演示文稿里点「退出演示」或按 Esc 回首页。

## 用本地服务器打开（可选）

安装 Python 3 后，Windows 双击 **Start.cmd**，macOS 双击 **启动.command**。启动器会用默认浏览器打开 Demo 目录，并在终端显示本地地址。关闭终端即可停止。三维场景需要支持 WebGL 的桌面浏览器；游戏素材和依赖都在仓库里。

也可以在仓库目录运行 `python3 tools/serve_local.py 8000 .`（Windows 用 `py -3` 替换 `python3`），然后打开 <http://127.0.0.1:8000/>。保存进度和照片按浏览器与站点地址区分，下次想接着玩，请用上次的浏览器、地址和端口。

## Demo 目录

| 入口 | 内容 |
| --- | --- |
| [展示首页](index.html) | 选择试玩、原型、展厅或控制台 |
| [风灵山谷](game.html) | 六章主线。WASD 移动，点击种植，滚过花旁送种；解锁飞行后长按空格登岛 |
| [风的试验田](prototype/index.html) | 固定机位，自由点击草地种植，滑过成熟花头释放种子 |
| [场景控制台](dev.html) | 在当前游戏里直接打开开发面板，调整环境参数 |
| [植物](labs/vegetation.html) · [地标](labs/landmarks.html) · [远景](labs/distant.html) · [山谷全景](labs/valley.html) | 单独转动一棵树，或到山谷里看整片草地 |
| [项目演示文稿](docs/presentation.html) | 设计与技术背景，可用方向键翻页 |

## 仓库结构

- `src/app/` 与 `src/engine/` 分别存放 Vue 界面和 Three.js 场景代码。主线从老树开始，依次经过磨坊、苗圃、云圃、枯泉和日晷。拍照会存入本机胶片卷，玩家可以按张下载。
- `prototype/` 独立保留了远端 [21dc3ea](https://github.com/boyang-web/Dandelion-Simulation/commit/21dc3eae08de458661cd9d74caf338c1dc62ba9b) 的种植、风场和种子实现。展出版本固定了镜头，并复用根目录的 Three.js。
- `labs/` 为资产陈列入口，`assets/` 为本地场景贴图，`vendor/` 为离线依赖。
- [引擎与界面结构](docs/ARCHITECTURE.md) · [游戏设计记录](docs/WIND_PASSING.md) · [发布说明](docs/PUBLISHING.md)。

## 验证

运行 `python3 tools/e2e/check_static.py` 检查模块和页面资源。macOS 上的 Chrome 浏览器测试见 [验证说明](docs/TESTING.md)，完整主线可用 `python3 tools/e2e/test_levels.py` 验证。
