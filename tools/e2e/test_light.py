#!/usr/bin/env python3
"""Low-impact functional check for the Vue refactor.

Designed for a machine that is in use:
  * 760×480 viewport, ?quality=low (5000 grass clumps)
  * one renderer process, 1× device scale, muted, no background services
  * lowest process priority (nice 15)
  * hard wall-clock cap; the browser is killed when the run ends
  * no 1920×1080 readback, no video encoding, no labs pages

Run:
  python3 tools/e2e/test_light.py
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from wind_puzzle import plant_at_tree, send_tree_seed
from cdp import Chrome, free_port  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
BUDGET = float(os.environ.get("LIGHT_BUDGET", "55"))
ONLY = {name for name in os.environ.get("LIGHT_ONLY", "").split(",") if name}


def want(name):
    return not ONLY or name in ONLY
RESULTS = []
START = time.time()


def elapsed():
    return time.time() - START


def check(name, ok, detail=""):
    RESULTS.append({"test": name, "ok": bool(ok), "detail": str(detail)})
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + ("" if ok else f"   ← {detail}"))


def step(label):
    print(f"\n— {label} · t+{elapsed():.1f}s")


def start_server():
    port = free_port()
    proc = subprocess.Popen(
        [sys.executable, str(ROOT / "tools" / "serve_local.py"), str(port), str(ROOT)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    deadline = time.time() + 10
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/game.html", timeout=1):
                return proc, port
        except Exception:
            time.sleep(0.2)
    proc.terminate()
    raise RuntimeError("static server did not start")


def main():
    server, port = start_server()
    base = f"http://127.0.0.1:{port}"
    chrome = Chrome(760, 480, light=True, nice=15).start()
    killed = {"value": False}

    def hard_stop():
        killed["value"] = True
        try:
            chrome.proc.terminate()
        except Exception:
            pass

    watchdog = threading.Timer(BUDGET + 10, hard_stop)
    watchdog.daemon = True
    watchdog.start()

    try:
        step("加载（低画质 760×480）")
        chrome.connect_existing()
        chrome.send("Emulation.setDeviceMetricsOverride", {
            "width": 760, "height": 480, "deviceScaleFactor": 1, "mobile": False
        })
        chrome.navigate(f"{base}/game.html?reset=1&quality=low&post=0", wait_until_ready=False)
        chrome.wait_for("!!(window.__dandy && document.body.classList.contains('ready'))", timeout=25)
        print(f"   ready at t+{elapsed():.1f}s")
        chrome.wait_frames(2, timeout=25)

        step("Vue 挂载与 HUD")
        check("标题渲染", chrome.eval("document.querySelector('.masthead__title')?.textContent.trim()") == "等风来")
        check("能力面板 2 个基础胶囊", chrome.eval("document.querySelectorAll('.ability-panel .ability-pill').length") == 2)
        check("能力计数 0/5", chrome.eval("document.querySelector('.ability-panel__count')?.textContent.trim()") == "0/5")
        check("明信片条 5 个挂点", chrome.eval("document.querySelectorAll('.postcard-chip').length") == 5)
        check("天体 2 个", chrome.eval("document.querySelectorAll('.celestial').length") == 2)
        check("画布已挂载", chrome.eval("(() => { const c = document.querySelector('#stage'); return !!c && c.width > 100; })()"))
        check("天空变量已写入", bool(chrome.eval("getComputedStyle(document.documentElement).getPropertyValue('--ink').trim()")))
        check("场景资产已构建", chrome.eval("window.__dandy.renderer.info.memory.geometries") > 20,
              chrome.eval("window.__dandy.renderer.info.memory.geometries"))

        if want("wind"):
            step("风场 + 风力计")
            chrome.eval("window.__dandy.wind.force(1200, 0, innerWidth * 0.5, innerHeight * 0.5)")
            peak = 0
            for _ in range(12):
                peak = max(peak, chrome.eval("window.__dandy.wind.strength") or 0)
                if peak > 0.1:
                    break
                time.sleep(0.1)
            check("风速上升", peak > 0.1, round(peak, 3))
            css = chrome.eval("parseFloat(document.querySelector('.meter__fill').style.getPropertyValue('--wind'))")
            store = chrome.eval("window.__dandy.store.ui.wind")
            check("风力计与 store 同步", css is not None and abs(css - store) <= 0.06, f"{css} / {store}")
            check("首屏交互标记", chrome.eval("document.body.classList.contains('interacted')"))
            chrome.eval("window.__dandy.wind.force(0, 0)")

        if want("plant"):
            step("点击种植")
            plant_at_tree(chrome)
            chrome.wait_frames(2, timeout=20)
            check("点击草地 +1 株", chrome.eval("window.__dandy.field.count") == 1,
                  chrome.eval("window.__dandy.field.count"))

        if want("unlock"):
            step("解锁链路")
            send_tree_seed(chrome)
            chrome.wait_frames(1, timeout=15)
            check("解锁相机", chrome.eval("window.__dandy.abilities.has('camera')") is True)
            check("能力计数 1/5", chrome.eval("document.querySelector('.ability-panel__count')?.textContent.trim()") == "1/5")
            check("胶囊包含相机", "相机" in (chrome.eval("document.querySelector('.ability-panel__list').textContent") or ""))
            check("Toast 文案", "解锁" in (chrome.eval("window.__dandy.store.ui.toast.text") or ""),
                  chrome.eval("window.__dandy.store.ui.toast.text"))
            check("提示条加入快捷键", "C · 相机" in (chrome.eval("document.querySelector('.hint__text--mouse').textContent") or ""))

        if want("film"):
            step("胶片卷（轻量缩略图，不触发 1080p 回读）")
            chrome.eval(
                "(() => { const d = window.__dandy;"
                " const bin = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');"
                " const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));"
                " d.filmArchive.addCapture(new Blob([bytes], { type: 'image/png' }), 'light.png',"
                "   { type: 'photo', cardTitle: '树下的风' });"
                " d.filmArchive.setPanelOpen(true); return true; })()"
            )
            time.sleep(0.2)
            check("胶片计数为 1", chrome.eval("document.querySelector('.film-button span')?.textContent.trim()") == "1")
            check("面板渲染缩略图", chrome.eval("document.querySelectorAll('.film-panel .film-item img').length") == 1)
            check("缩略图使用 blob URL", (chrome.eval("document.querySelector('.film-panel img')?.getAttribute('src')") or "").startswith("blob:"))
            check("下载链接存在", chrome.eval("!!document.querySelector('.film-panel a[download]')"))
            chrome.eval("document.querySelector('.film-panel__close')?.click(); true")

        if want("time"):
            step("声音 + 时间（键盘）")
            before = chrome.eval("document.querySelector('.sound-button').getAttribute('aria-pressed')")
            chrome.eval("document.querySelector('.sound-button').click(); true")
            time.sleep(0.15)
            after = chrome.eval("document.querySelector('.sound-button').getAttribute('aria-pressed')")
            check("声音按钮切换", before != after, f"{before} → {after}")
            chrome.eval("document.querySelector('.sound-button').click(); true")

            chrome.eval(
                "(() => { const d = window.__dandy; d.abilities.unlock('time'); d.sky.setInteractive(true);"
                " d.orbit.pitch = 0.02; d.orbit.apply(); d.sky.set(0.34); return true; })()"
            )
            chrome.wait_frames(1, timeout=15)
            t0 = chrome.eval("window.__dandy.sky.time")
            chrome.eval(
                "document.querySelector('.celestial--sun').dispatchEvent("
                " new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); true"
            )
            time.sleep(0.15)
            t1 = chrome.eval("window.__dandy.sky.time")
            check("键盘事件拨动时间", (t1 - t0) >= 0.035, f"{t0} → {t1}")
            check("ARIA 时间文案更新", "时间" in (chrome.eval("document.querySelector('.celestial--sun').getAttribute('aria-valuetext')") or ""))

        if want("errors"):
            step("控制台异常")
            problems = [
                (kind, text) for kind, text in chrome.console_problems()
                if kind in ("error", "exception")
                and "GL Driver Message" not in text
                and "SwiftShader" not in text
            ]
            check("无 JS 异常 / 网络错误", not problems, problems[:2])

    except Exception as exc:
        text = repr(exc)
        if "Connection to remote host was lost" in text or "socket is already closed" in text:
            check(
                "软件渲染环境存活到检查结束",
                False,
                f"{text.splitlines()[0]}（SwiftShader 在长时间运行后会回收 GPU 进程，非应用报错）"
            )
        else:
            check("检查流程未中断", False, text)
            print(chrome.tail_log(12))
    finally:
        watchdog.cancel()
        chrome.close()
        server.terminate()

    passed = sum(1 for item in RESULTS if item["ok"])
    total = len(RESULTS)
    report = Path(os.environ.get("LIGHT_REPORT", ROOT / "docs" / "test-report.json"))
    report.write_text(json.dumps({
        "mode": "light (760×480, quality=low, post=0, nice=15, single load)",
        "durationSeconds": round(elapsed(), 1),
        "passed": passed,
        "total": total,
        "results": RESULTS
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    try:
        where = report.resolve().relative_to(ROOT)
    except ValueError:
        where = report
    print(f"\n{passed}/{total} checks passed · {elapsed():.1f}s · report → {where}")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())