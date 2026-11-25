#!/usr/bin/env python3
"""Functional tests for the Vue refactor of 等风来 · Dandelion.

Run:  python3 tools/serve_local.py 8124 . &
      python3 tools/e2e/test_experience.py --url http://127.0.0.1:8124

The suite drives a real Chrome (headless + SwiftShader WebGL), uses the same
input events a person would, and checks the Vue-rendered DOM as well as the
engine state exposed on window.__dandy.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from wind_puzzle import plant_at_tree, send_tree_seed
from cdp import Chrome  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
SHOTS = ROOT / "docs" / "shots"

RESULTS = []


def check(name, condition, detail=""):
    ok = bool(condition)
    RESULTS.append({"test": name, "ok": ok, "detail": str(detail)})
    print(("PASS  " if ok else "FAIL  ") + name + ("" if ok else f"   ← {detail}"))
    return ok


def step(label):
    print(f"\n—— {label} ——————————————————————————————")


def close_to(a, b, tol=0.02):
    try:
        return abs(float(a) - float(b)) <= tol
    except (TypeError, ValueError):
        return False


def ground_screen_point(s, dx=3.0, dz=4.0):
    """Project a walkable ground point in front of the player to screen space."""
    return s.js(
        "(() => {"
        " const d = window.__dandy;"
        " const v = d.player.root.position.clone();"
        f" v.x += {dx}; v.z += {dz};"
        " v.y = d.world.heightAt(v.x, v.z);"
        " v.project(d.camera);"
        " return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (0.5 - v.y * 0.5) * innerHeight };"
        "})()"
    )


class Session:
    def __init__(self, base_url):
        self.base = base_url.rstrip("/")
        self.chrome = Chrome(1440, 900).start()
        self.chrome.connect_existing()

    def goto(self, path="/game.html", wait_ready=True, timeout=30, quality="coarse"):
        self.chrome.events.clear()
        self.chrome.send("Page.setDownloadBehavior", {"behavior": "deny"})
        if quality and "quality=" not in path:
            path = path + ("&" if "?" in path else "?") + f"quality={quality}"
        self.chrome.navigate(self.base + path, wait_until_ready=False)
        self.chrome.wait_for("document.readyState === 'complete'", timeout=timeout)
        if wait_ready:
            self.chrome.wait_for("!!(window.__dandy && document.body.classList.contains('ready'))", timeout=timeout)
        return self

    def js(self, expression, await_promise=False):
        return self.chrome.eval(expression, await_promise=await_promise)

    def errors(self):
        found = []
        for kind, text in self.chrome.console_problems():
            # SwiftShader/ANGLE chatter is an artefact of headless rendering,
            # not application behaviour.
            if "GL Driver Message" in text or "SwiftShader" in text:
                continue
            if kind in ("error", "exception"):
                found.append(f"{kind}: {text}")
        return found

    def close(self):
        self.chrome.close()


def test_boot(s):
    step("1 · Vue 挂载与首帧")
    s.goto("/game.html?reset=1", quality=None)
    check("Vue 根组件渲染标题", s.js("document.querySelector('.masthead__title')?.textContent.trim()") == "等风来")
    check("能力面板由 Vue 渲染", s.js("document.querySelectorAll('.ability-panel .ability-pill').length") == 2,
          s.js("document.querySelector('.ability-panel')?.textContent"))
    check("能力计数 0/5", s.js("document.querySelector('.ability-panel__count')?.textContent.trim()") == "0/5")
    check("明信片条渲染 5 个挂点", s.js("document.querySelectorAll('.postcard-strip .postcard-chip').length") == 5)
    check("天体由 Vue 渲染", s.js("document.querySelectorAll('.celestial').length") == 2)
    check("WebGL 画布已挂载且有尺寸", s.js("(() => { const c = document.querySelector('#stage'); return !!c && c.width > 100 && c.height > 100; })()"))
    check("萤火虫画布已挂载", s.js("!!document.querySelector('#fireflies')"))
    check("渲染帧计数在推进", s.chrome.wait_frames(2, timeout=20) > 2)
    check("场景资产已构建（几何体 + 草簇）",
          s.js("window.__dandy.renderer.info.memory.geometries") > 20
          and s.js("window.__dandy.world.meadows.reduce((n, m) => n + m.grassCount, 0)") > 3000,
          (s.js("window.__dandy.renderer.info.memory.geometries"), s.js("window.__dandy.world.meadows.reduce((n, m) => n + m.grassCount, 0)")))
    check("天空 paint 已写入墨色变量",
          bool(s.js("getComputedStyle(document.documentElement).getPropertyValue('--ink').trim()")))
    check("太阳/月亮已定位到视口内",
          s.js("['sun','moon'].every(t => { const el = document.querySelector('.celestial--' + t); if (!el) return false; const l = parseFloat(el.style.left); const top = parseFloat(el.style.top); return Number.isFinite(l) && Number.isFinite(top) && l > 0 && l < innerWidth + 400 && top > -400 && top < innerHeight + 400; })"))
    check("体类 ready/sky-3d 已同步", s.js("document.body.classList.contains('ready') && document.body.classList.contains('sky-3d')"))
    check("无异常", not s.errors(), s.errors())


def test_interaction_shell(s):
    step("2 · 风场、指示条与 UI 阻断")
    s.chrome.set_viewport(1024, 640)
    s.goto("/game.html?reset=1")
    s.js("window.__dandy.wind.force(1500, 0, innerWidth * 0.55, innerHeight * 0.5)")
    peak = 0
    for _ in range(20):
        peak = max(peak, s.js("window.__dandy.wind.strength") or 0)
        if peak > 0.2:
            break
        time.sleep(0.1)
    check("风力场推高风速", peak > 0.2, peak)
    css_wind = s.js("parseFloat(document.querySelector('.meter__fill').style.getPropertyValue('--wind'))")
    store_wind = s.js("window.__dandy.store.ui.wind")
    check("风力计与 store 同步", css_wind is not None and abs(css_wind - store_wind) <= 0.06,
          f"css={css_wind} store={store_wind}")
    check("首次交互后 body.interacted", s.js("document.body.classList.contains('interacted')"))
    # The hint leaves after a 1.6 s hold plus a 1.2 s fade.
    time.sleep(3.2)
    hint_opacity = s.js("parseFloat(getComputedStyle(document.querySelector('.hint')).opacity)")
    check("首屏提示淡出", hint_opacity is not None and hint_opacity < 0.1, hint_opacity)
    s.js("window.__dandy.wind.force(0, 0)")

    # Moving the mouse over the meadow (no button held) is what makes wind;
    # dragging the camera intentionally pauses the field. The hand has to move
    # at a human cadence (the field ignores re-entry after a >0.5 s pause), so
    # events are fired as a burst without a round-trip each.
    s.js("window.__peakTrail = 0; window.__peakStrength = 0;"
         " window.__watch = setInterval(() => {"
         "  window.__peakTrail = Math.max(window.__peakTrail, __dandy.wind.trail.length);"
         "  window.__peakStrength = Math.max(window.__peakStrength, __dandy.wind.strength);"
         " }, 30); true")
    s.chrome.hover_path([(240 + i * 26, 500 + (i % 6) * 6) for i in range(26)])
    s.chrome.wait_frames(3, timeout=25)
    time.sleep(0.3)
    peak_trail = s.js("window.__peakTrail")
    peak_strength = s.js("window.__peakStrength")
    s.js("clearInterval(window.__watch)")
    check("指针悬停驱动风场（风速与 HUD）", peak_strength > 0.02,
          f"trail={peak_trail} strength={peak_strength:.3f}")

    # A click on the sound button must not be treated as a planting tap.
    before = s.js("window.__dandy.field.count")
    box = s.js("(() => { const r = document.querySelector('.sound-button').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()")
    s.chrome.tap(box["x"], box["y"])
    time.sleep(0.5)
    after = s.js("window.__dandy.field.count")
    check("点击 UI 不应误种蒲公英", before == after, f"{before} → {after}")


def test_planting(s):
    step("3 · 点击种植")
    s.goto("/game.html?reset=1")
    point = plant_at_tree(s.chrome)
    s.chrome.wait_frames(2, timeout=20)
    time.sleep(0.3)
    count = s.js("window.__dandy.field.count")
    check("点击草地生成一株蒲公英", count == 1, f"count={count} at {point}")
    check("能力面板仍显示 1 株上限", "1 株" in (s.js("document.querySelector('.ability-panel__list').textContent") or ""))
    stats = s.js("JSON.stringify(window.__dandy.field.stats())")
    check("植株有花头/种子数据", bool(stats) and '"plants":1' in stats, stats)


def test_unlock_ui(s):
    step("4 · 解锁链路：老树 → 相机")
    s.goto("/game.html?reset=1")
    send_tree_seed(s.chrome)
    outcome = s.js("window.__dandy.abilities.has('camera')")
    time.sleep(0.4)
    check("老树被唤醒后解锁相机", outcome is True)
    check("能力面板显示 1/5", s.js("document.querySelector('.ability-panel__count')?.textContent.trim()") == "1/5")
    pills = s.js("Array.from(document.querySelectorAll('.ability-pill')).map(el => el.textContent.trim())")
    check("能力胶囊包含『相机』", "相机" in (pills or []), pills)
    check("提示条出现 C/P/V 快捷键", "C · 相机" in s.js("document.querySelector('.hint__text--mouse').textContent"),
          s.js("document.querySelector('.hint__text--mouse').textContent"))
    check("Toast 已提示解锁", "解锁" in (s.js("window.__dandy.store.ui.toast.text") or ""),
          s.js("window.__dandy.store.ui.toast.text"))


def test_film_camera(s):
    step("5 · 胶片相机：安放 → 快门 → 胶片卷")
    s.goto("/game.html?reset=1")
    s.js(
        "(() => {"
        " const d = window.__dandy;"
        " d.abilities.unlock('camera');"
        " d.field.setMaxPlants(d.abilities.maxPlants);"
        " return true;"
        "})()"
    )
    s.chrome.key("KeyC", "c", 67)
    time.sleep(0.3)
    check("按 C 进入安放模式", s.js("window.__dandy.filmCamera.isPlacing") is True)
    check("安放提示可见", "安放相机" in (s.js("document.querySelector('.context-hint').textContent") or ""),
          s.js("document.querySelector('.context-hint').textContent"))

    point = ground_screen_point(s, 2.5, 5.5)
    s.chrome.tap(point["x"], point["y"])
    s.chrome.wait_frames(2, timeout=20)
    time.sleep(0.2)
    check("点击草地完成安放", s.js("window.__dandy.filmCamera.placed") is True)
    check("进入取景状态", s.js("window.__dandy.filmCamera.isActive") is True)
    check("取景上下文提示", "P · 拍照" in (s.js("document.querySelector('.context-hint').textContent") or ""))

    s.chrome.key("KeyP", "p", 80)
    items = 0
    for _ in range(20):
        time.sleep(0.4)
        items = s.js("window.__dandy.filmArchive.items.length") or 0
        if items:
            break
    check("快门生成一张胶片", items == 1, items)
    check("快门记录本次捕获", bool(s.js("JSON.stringify(window.__dandy.lastCapture)")) and
          s.js("window.__dandy.lastCapture") is not None, s.js("JSON.stringify(window.__dandy.lastCapture)"))
    check("胶片按钮计数为 1", s.js("document.querySelector('.film-button span')?.textContent.trim()") == "1",
          s.js("document.querySelector('.film-button')?.textContent"))

    s.js("window.__dandy.toggleFilmPanel()")
    time.sleep(0.2)
    check("胶片卷面板打开", s.js("!!document.querySelector('.film-panel')"))
    check("面板内有一个缩略图", s.js("document.querySelectorAll('.film-panel .film-item img, .film-panel .film-item video').length") == 1)
    check("缩略图使用 blob URL", (s.js("document.querySelector('.film-panel .film-item img')?.getAttribute('src')") or "").startswith("blob:"),
          s.js("document.querySelector('.film-panel .film-item img')?.getAttribute('src')"))
    check("下载链接存在", s.js("!!document.querySelector('.film-panel .film-item a[download]')"))


def test_time_scrub(s):
    step("6 · 时间：拖动日月与键盘")
    s.goto("/game.html?reset=1")
    # Look up a little so the 3D sun is inside the frame, the way a player
    # tilts the camera skyward before grabbing it.
    s.js("(() => { const d = window.__dandy; d.abilities.unlock('time'); d.sky.setInteractive(true); d.orbit.pitch = 0.05; d.orbit.apply(); d.sky.set(0.35); return true; })()")
    s.chrome.wait_frames(2, timeout=20)
    time.sleep(0.2)
    before = s.js("window.__dandy.sky.time")
    pct_before = s.js("document.querySelector('.ability-panel__count')?.textContent")
    pos = s.js("(() => { const el = document.querySelector('.celestial--sun'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, hidden: el.classList.contains('is-hidden') }; })()")
    if pos["hidden"]:
        check("太阳在视口内（可交互）", False, pos)
    else:
        s.chrome.press_move_release([
            (pos["x"], pos["y"]),
            (pos["x"] + 90, pos["y"] + 6),
            (pos["x"] + 180, pos["y"] + 12),
            (pos["x"] + 260, pos["y"] + 20),
        ])
        s.chrome.wait_frames(2, timeout=20)
        time.sleep(0.2)
        after = s.js("window.__dandy.sky.time")
        check("拖动太阳推进时间", after != before, f"{before} → {after}")
        check("界面时间标签同步",
              s.js("document.querySelector('.celestial--sun').getAttribute('aria-valuetext')") ==
              f"时间 {s.js('window.__dandy.sky.paint.time.pct')}%，{s.js('window.__dandy.sky.paint.time.label')}",
              s.js("document.querySelector('.celestial--sun').getAttribute('aria-valuetext')"))
        check("拖动结束后弧线收起", s.js("!document.querySelector('.celestial-arc').classList.contains('is-visible')"))
        check("能力计数未受影响", s.js("document.querySelector('.ability-panel__count')?.textContent") == pct_before)

    # Keyboard: the body is a real focusable slider (tabindex=0). Pointer
    # presses call preventDefault to own the gesture, so focus it explicitly
    # the way a Tab user would.
    s.js("window.__dandy.sky.set(0.34)")
    s.chrome.wait_frames(1, timeout=20)
    focused = s.js("(() => { const el = document.querySelector('.celestial--sun'); el.focus(); return document.activeElement === el; })()")
    check("天体可被键盘聚焦", focused is True)
    t0 = s.js("window.__dandy.sky.time")
    s.chrome.key("ArrowRight", "ArrowRight", 39)
    time.sleep(0.2)
    t1 = s.js("window.__dandy.sky.time")
    check("←/→ 键盘拨动时间", t1 - t0 >= 0.035, f"{t0} → {t1}")
    s.chrome.key("Home", "Home", 36)
    time.sleep(0.2)
    check("Home 跳到日出", s.js("window.__dandy.sky.time") < 0.02, s.js("window.__dandy.sky.time"))


def test_sound_and_panel(s):
    step("7 · 声音开关与面板交互")
    s.goto("/game.html?reset=1")
    pressed0 = s.js("document.querySelector('.sound-button').getAttribute('aria-pressed')")
    s.js("document.querySelector('.sound-button').click()")
    time.sleep(0.2)
    pressed1 = s.js("document.querySelector('.sound-button').getAttribute('aria-pressed')")
    check("点击声音按钮切换状态", pressed0 != pressed1, f"{pressed0} → {pressed1}")
    check("按钮文案同步", s.js("document.querySelector('.sound-button').textContent.trim()") in ("声音 开", "声音 关"))
    s.js("document.querySelector('.sound-button').click()")
    time.sleep(0.15)

    s.js("document.querySelector('.film-button').click()")
    time.sleep(0.2)
    check("点击胶片卷按钮打开面板", s.js("!!document.querySelector('.film-panel')"))
    check("空卷提示存在", "还没有留下照片" in (s.js("document.querySelector('.film-panel__empty')?.textContent") or ""),
          s.js("document.querySelector('.film-panel')?.textContent"))
    s.js("document.querySelector('.film-panel__close').click()")
    time.sleep(0.2)
    check("关闭按钮收起面板", s.js("!document.querySelector('.film-panel')"))


def test_journey_end(s):
    step("8 · 集齐明信片与结尾卡")
    s.goto("/game.html?reset=1")
    s.js(
        "(() => {"
        " const d = window.__dandy;"
        " for (const id of ['tree','windmill','tower','spring','sundial']) d.abilities.addPostcard(id);"
        " d.filmArchive.refreshPostcards(d.anchors);"
        " d.filmArchive.checkJourneyEnd(d.anchors);"
        " return true;"
        "})()"
    )
    time.sleep(0.4)
    check("五张明信片全部点亮", s.js("document.querySelectorAll('.postcard-chip.is-on').length") == 5,
          s.js("document.querySelectorAll('.postcard-chip.is-on').length"))
    check("结尾卡出现", s.js("!!document.querySelector('.journey-end')"))
    check("结尾卡拉取 5 张卡片", s.js("document.querySelectorAll('.journey-end__cards span').length") == 5)
    s.js("document.querySelector('.journey-end__button').click()")
    time.sleep(0.2)
    check("继续漫游关闭结尾卡", s.js("!document.querySelector('.journey-end')"))


def test_mobile(s):
    step("9 · 移动端：摇杆与上下文按钮")
    s.chrome.set_viewport(390, 844, mobile=True)
    s.goto("/game.html?reset=1")
    check("触屏 UI 显示", s.js("!!document.querySelector('.touch-ui')"))
    check("摇杆尺寸", s.js("(() => { const r = document.querySelector('.joystick')?.getBoundingClientRect(); return !!r && r.width > 90; })()"))
    check("未解锁时升空/相机按钮隐藏", s.js("!document.querySelector('.touch-btn--lift') && !document.querySelector('.touch-btn--shutter')"))

    # Unlock progression, reload, then verify the touch button set.
    s.js("(() => { const d = window.__dandy; d.abilities.unlock('camera'); d.abilities.unlock('lift'); d.abilities.unlock('multiPlant'); return true; })()")
    s.goto("/game.html")
    time.sleep(0.3)
    check("解锁后出现『升空』按钮", s.js("!!document.querySelector('.touch-btn--lift')"))
    check("解锁后出现『相机』按钮", (s.js("document.querySelector('.touch-actions')?.textContent") or "").find("相机") >= 0,
          s.js("document.querySelector('.touch-actions')?.textContent"))

    pos = s.js("(() => { const r = document.querySelector('.joystick').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width }; })()")
    before = s.js("JSON.stringify(window.__dandy.player.root.position.toArray())")
    s.chrome.send_nowait("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": pos["x"], "y": pos["y"], "id": 1, "radiusX": 8, "radiusY": 8, "force": 1}]})
    time.sleep(0.05)
    s.chrome.send_nowait("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": pos["x"], "y": pos["y"] - pos["r"] * 0.3, "id": 1, "radiusX": 8, "radiusY": 8, "force": 1}]})
    s.chrome.wait_frames(2, timeout=25)
    time.sleep(0.4)
    moving = s.js("window.__dandy.player.speed") or 0
    knob = s.js("document.querySelector('.joystick__knob').style.transform") or ""
    check("摇杆推动主角移动", moving > 0.1, f"speed={moving}")
    check("摇杆手柄跟随手指", "translate" in knob, knob)
    s.chrome.send_nowait("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    s.chrome.wait_frames(2, timeout=25)
    time.sleep(0.6)
    after = s.js("JSON.stringify(window.__dandy.player.root.position.toArray())")
    rest_speed = s.js("window.__dandy.player.speed") or 0
    check("松手后主角位置改变并停住", before != after and rest_speed <= max(0.4, moving * 0.6),
          f"{before} → {after} · speed {moving:.2f} → {rest_speed:.2f}")
    s.chrome.set_viewport(1440, 900, mobile=False)


def test_debug_and_still(s):
    step("10 · 调试面板与静态出帧")
    s.goto("/game.html?reset=1&debug")
    s.chrome.wait_for("!!document.querySelector('.debug')", timeout=30)
    text = s.js("document.querySelector('.debug').textContent")
    check("?debug 显示运行指标", bool(text) and "fps" in text, (text or "")[:80])

    s.goto("/game.html?reset=1&still=4&time=0.5")
    time.sleep(0.6)
    check("?still 停止在静态帧", s.js("document.body.classList.contains('still')"))
    check("?still 仍完成首帧", s.js("window.__dandy.renderer.info.memory.geometries") > 20,
          s.js("window.__dandy.renderer.info.memory.geometries"))
    check("?still 不报错", not s.errors(), s.errors())


def test_resize(s):
    step("11 · 响应式尺寸")
    s.goto("/game.html?reset=1")
    s.chrome.set_viewport(820, 620)
    time.sleep(0.6)
    aspect = s.js("window.__dandy.camera.aspect")
    check("竖屏/窄窗相机比例同步", close_to(aspect, 820 / 620, 0.01), aspect)
    s.chrome.set_viewport(1440, 900)
    time.sleep(0.6)
    aspect = s.js("window.__dandy.camera.aspect")
    check("恢复宽窗比例", close_to(aspect, 1440 / 900, 0.01), aspect)
    check("缩放无异常", not s.errors(), s.errors())


def test_labs(s):
    step("12 · 预览页回归（labs）")
    for name in ("valley", "distant", "landmarks", "vegetation"):
        s.goto(f"/labs/{name}.html", wait_ready=False, timeout=25)
        time.sleep(1.2)
        ok = s.js("!!document.querySelector('canvas')")
        check(f"labs/{name}.html 正常加载", ok, s.errors()[:2])


def test_docs_links(s):
    step("13 · 文档入口")
    s.goto("/docs/presentation.html", wait_ready=False, timeout=20)
    check("演示文稿可直接打开", s.js("document.title") not in (None, ""), s.js("document.title"))
    check("演示文稿无脚本错误", not s.errors(), s.errors()[:2])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:8124")
    parser.add_argument("--only", default=None, help="comma separated test names")
    parser.add_argument("--report", default=str(ROOT / "docs" / "test-report.json"))
    args = parser.parse_args()

    SHOTS.mkdir(parents=True, exist_ok=True)
    tests = [
        ("boot", test_boot),
        ("interaction", test_interaction_shell),
        ("planting", test_planting),
        ("unlock", test_unlock_ui),
        ("film", test_film_camera),
        ("time", test_time_scrub),
        ("sound", test_sound_and_panel),
        ("journey", test_journey_end),
        ("mobile", test_mobile),
        ("debug", test_debug_and_still),
        ("resize", test_resize),
        ("labs", test_labs),
    ]
    if (ROOT / "docs" / "presentation.html").exists():
        tests.append(("docs", test_docs_links))

    selected = set(args.only.split(",")) if args.only else None
    # One browser per test: a software-WebGL renderer keeps a lot of memory
    # per page, and isolating each scenario keeps a crash from cascading.
    for name, fn in tests:
        if selected and name not in selected:
            continue
        session = Session(args.url)
        try:
            fn(session)
        except Exception as exc:  # keep going so one failure doesn't hide others
            check(f"{name} 测试执行未中断", False, repr(exc))
        finally:
            session.close()

    passed = sum(1 for item in RESULTS if item["ok"])
    total = len(RESULTS)
    print(f"\n{passed}/{total} checks passed")
    Path(args.report).write_text(
        json.dumps({"passed": passed, "total": total, "results": RESULTS}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())