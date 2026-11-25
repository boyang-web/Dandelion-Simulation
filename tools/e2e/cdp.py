"""Minimal Chrome DevTools Protocol driver for functional tests.

No Node/npm needed: Chrome is launched with --remote-debugging-port, and this
module talks to it over WebSocket (websocket-client) and HTTP (stdlib).
"""

from __future__ import annotations

import base64
import json
import os
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request

import websocket

CHROME_CANDIDATES = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    shutil.which("google-chrome") or "",
    shutil.which("chromium") or "",
]


def find_chrome() -> str:
    for path in CHROME_CANDIDATES:
        if path and os.path.exists(path):
            return path
    raise RuntimeError("Chrome/Edge not found")


def free_port() -> int:
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


class Chrome:
    def __init__(self, width=1440, height=900, port=None, light=False, nice=10):
        self.port = port or free_port()
        self.width = width
        self.height = height
        self.light = light
        self.nice = nice
        self.profile = tempfile.mkdtemp(prefix="dandy-chrome-")
        self.proc = None
        self.ws = None
        self._id = 0
        self.events = []

    # ---------------- lifecycle ----------------

    def start(self):
        binary = find_chrome()
        flags = [
            binary,
            "--headless=new",
            f"--remote-debugging-port={self.port}",
            f"--user-data-dir={self.profile}",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-gpu",
            "--enable-unsafe-swiftshader",
            "--no-sandbox",
            "--allow-file-access-from-files",
            "--autoplay-policy=no-user-gesture-required",
            f"--window-size={self.width},{self.height}",
        ]
        if self.light:
            # Low-impact mode for checking on a machine that is in use:
            # one renderer, no extras, fixed 1x scale, smallest sensible frame.
            flags += [
                "--renderer-process-limit=1",
                "--disable-extensions",
                "--disable-background-networking",
                "--disable-component-update",
                "--disable-sync",
                "--mute-audio",
                "--force-device-scale-factor=1",
                "--disable-dev-shm-usage",
                "--disable-features=Translate,BackForwardCache,MediaRouter",
            ]
        flags.append("about:blank")

        def lower_priority():
            try:
                os.nice(self.nice)
            except Exception:
                pass

        self.proc = subprocess.Popen(
            flags,
            stdout=subprocess.DEVNULL,
            stderr=open(os.path.join(self.profile, "chrome.err"), "w"),
            preexec_fn=lower_priority if self.nice else None,
        )
        self._wait_for_port()
        return self

    def _wait_for_port(self, timeout=20):
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{self.port}/json/version", timeout=1):
                    return
            except Exception:
                time.sleep(0.2)
        raise RuntimeError("Chrome did not expose the debugging port")

    def connect_existing(self):
        """Attach to the first page target instead of opening a background tab.

        requestAnimationFrame is throttled for background tabs, so reusing the
        original tab keeps the render loop at full speed.
        """
        with urllib.request.urlopen(f"http://127.0.0.1:{self.port}/json/list", timeout=10) as resp:
            targets = json.loads(resp.read().decode())
        pages = [t for t in targets if t.get("type") == "page"]
        if not pages:
            return self.new_tab()
        info = pages[0]
        self.ws = websocket.create_connection(
            info["webSocketDebuggerUrl"], timeout=12, max_size=200 * 1024 * 1024
        )
        self.target_id = info["id"]
        self.send("Page.enable")
        self.send("Runtime.enable")
        self.send("Log.enable")
        self.send("Emulation.setFocusEmulationEnabled", {"enabled": True})
        return self

    def new_tab(self, url="about:blank"):
        req = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/json/new?{urllib.parse.quote(url, safe='')}",
            method="PUT",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            info = json.loads(resp.read().decode())
        self.ws = websocket.create_connection(
            info["webSocketDebuggerUrl"], timeout=12, max_size=200 * 1024 * 1024
        )
        self.target_id = info["id"]
        self.send("Page.enable")
        self.send("Runtime.enable")
        self.send("Log.enable")
        return self

    def tail_log(self, lines=40):
        path = os.path.join(self.profile, "chrome.err")
        if not os.path.exists(path):
            return ""
        with open(path, "r", errors="ignore") as handle:
            return "".join(handle.readlines()[-lines:])

    def close(self):
        try:
            if self.ws:
                self.ws.close()
        except Exception:
            pass
        if self.proc:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        shutil.rmtree(self.profile, ignore_errors=True)

    # ---------------- protocol ----------------

    def send(self, method, params=None):
        self._id += 1
        payload = {"id": self._id, "method": method}
        if params:
            payload["params"] = params
        self.ws.send(json.dumps(payload))
        while True:
            raw = self.ws.recv()
            if not raw:
                raise RuntimeError("CDP socket closed")
            msg = json.loads(raw)
            if msg.get("id") == self._id:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})
            self._collect(msg)

    def _collect(self, msg):
        method = msg.get("method")
        if method in (
            "Runtime.consoleAPICalled",
            "Runtime.exceptionThrown",
            "Log.entryAdded",
            "Inspector.targetCrashed",
        ):
            self.events.append(msg)

    def drain(self, seconds=0.2):
        end = time.time() + seconds
        self.ws.settimeout(0.1)
        try:
            while time.time() < end:
                try:
                    raw = self.ws.recv()
                except Exception:
                    continue
                if raw:
                    self._collect(json.loads(raw))
        finally:
            self.ws.settimeout(12)

    def navigate(self, url, wait_until_ready=True, timeout=25):
        self.send("Page.navigate", {"url": url})
        if wait_until_ready:
            self.wait_for("document.readyState === 'complete'", timeout=timeout)
        return self

    def wait_for(self, expression, timeout=20, interval=0.2):
        deadline = time.time() + timeout
        last = None
        while time.time() < deadline:
            last = self.eval(expression)
            if last:
                return last
            time.sleep(interval)
        raise TimeoutError(f"wait_for timed out: {expression} (last={last!r})")

    def wait_frames(self, count=2, timeout=15):
        """Wait until the render loop has advanced by N frames."""
        start = self.eval("window.__dandy ? window.__dandy.frames : 0") or 0
        deadline = time.time() + timeout
        while time.time() < deadline:
            now = self.eval("window.__dandy ? window.__dandy.frames : 0") or 0
            if now >= start + count:
                return now
            time.sleep(0.1)
        raise TimeoutError(f"frames did not advance by {count} (start={start}, now={now})")

    def eval(self, expression, await_promise=False):
        result = self.send(
            "Runtime.evaluate",
            {
                "expression": expression,
                "returnByValue": True,
                "awaitPromise": await_promise,
                "userGesture": True,
            },
        )
        if result.get("exceptionDetails"):
            details = result["exceptionDetails"]
            raise RuntimeError(f"JS error: {details.get('text')} {details.get('exception', {}).get('description', '')}")
        return result.get("result", {}).get("value")

    def screenshot(self, path, full_page=False):
        result = self.send(
            "Page.captureScreenshot",
            {"format": "png", "captureBeyondViewport": bool(full_page)},
        )
        with open(path, "wb") as handle:
            handle.write(base64.b64decode(result["data"]))
        return path

    def set_viewport(self, width, height, mobile=False):
        self.width, self.height = width, height
        self.send(
            "Emulation.setDeviceMetricsOverride",
            {
                "width": width,
                "height": height,
                "deviceScaleFactor": 1,
                "mobile": mobile,
                "screenWidth": width,
                "screenHeight": height,
            },
        )
        if mobile:
            self.send(
                "Emulation.setTouchEmulationEnabled",
                {"enabled": True, "maxTouchPoints": 5, "configuration": "mobile"},
            )
            self.send(
                "Emulation.setEmitTouchEventsForMouse",
                {"enabled": True, "configuration": "mobile"},
            )
        else:
            self.send("Emulation.setTouchEmulationEnabled", {"enabled": False})

    # ---------------- input ----------------

    def tap(self, x, y):
        self.send(
            "Input.dispatchMouseEvent",
            {"type": "mousePressed", "x": x, "y": y, "button": "left", "clickCount": 1},
        )
        time.sleep(0.03)
        self.send(
            "Input.dispatchMouseEvent",
            {"type": "mouseReleased", "x": x, "y": y, "button": "left", "clickCount": 1},
        )

    def tap_nowait(self, x, y):
        """Press and release without a round-trip between them.

        The app rejects taps longer than 650 ms (a real finger is faster).
        Waiting for each CDP reply on a software-WebGL machine can stretch a
        synthetic tap past that window, so both events are queued first.
        """
        self.send_nowait(
            "Input.dispatchMouseEvent",
            {"type": "mousePressed", "x": x, "y": y, "button": "left", "clickCount": 1},
        )
        self.send_nowait(
            "Input.dispatchMouseEvent",
            {"type": "mouseReleased", "x": x, "y": y, "button": "left", "clickCount": 1},
        )

    def drag(self, x1, y1, x2, y2, steps=12, step_delay=0.02):
        self.send(
            "Input.dispatchMouseEvent",
            {"type": "mousePressed", "x": x1, "y": y1, "button": "left", "clickCount": 1},
        )
        for i in range(1, steps + 1):
            k = i / steps
            self.send(
                "Input.dispatchMouseEvent",
                {
                    "type": "mouseMoved",
                    "x": x1 + (x2 - x1) * k,
                    "y": y1 + (y2 - y1) * k,
                    "button": "left",
                },
            )
            time.sleep(step_delay)
        self.send(
            "Input.dispatchMouseEvent",
            {"type": "mouseReleased", "x": x2, "y": y2, "button": "left", "clickCount": 1},
        )

    def send_nowait(self, method, params=None):
        """Fire a CDP command without waiting for its reply.

        Needed for realistic fast gestures: awaiting each event round-trips
        through a slow (software WebGL) renderer, which turns a 0.3 s flick
        into a 2 s crawl and trips the app's "hand re-entered after a pause"
        guard.
        """
        self._id += 1
        payload = {"id": self._id, "method": method}
        if params:
            payload["params"] = params
        self.ws.send(json.dumps(payload))

    def move(self, x, y):
        self.send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x, "y": y})

    def hover_path(self, points, step_delay=0.012):
        for index, (x, y) in enumerate(points):
            self.send_nowait("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x, "y": y})
            if step_delay:
                time.sleep(step_delay)

    def press_move_release(self, points, step_delay=0.012):
        x0, y0 = points[0]
        self.send_nowait(
            "Input.dispatchMouseEvent",
            {"type": "mousePressed", "x": x0, "y": y0, "button": "left", "clickCount": 1},
        )
        for x, y in points[1:]:
            self.send_nowait(
                "Input.dispatchMouseEvent",
                {"type": "mouseMoved", "x": x, "y": y, "button": "left"},
            )
            if step_delay:
                time.sleep(step_delay)
        xe, ye = points[-1]
        self.send_nowait(
            "Input.dispatchMouseEvent",
            {"type": "mouseReleased", "x": xe, "y": ye, "button": "left", "clickCount": 1},
        )

    def key(self, code, key=None, key_code=None, modifiers=0):
        params = {
            "type": "keyDown",
            "code": code,
            "key": key or code,
            "windowsVirtualKeyCode": key_code or 0,
            "modifiers": modifiers,
        }
        self.send("Input.dispatchKeyEvent", params)
        time.sleep(0.02)
        self.send("Input.dispatchKeyEvent", {**params, "type": "keyUp"})

    # ---------------- diagnostics ----------------

    def console_problems(self):
        problems = []
        for event in self.events:
            method = event.get("method")
            params = event.get("params", {})
            if method == "Runtime.exceptionThrown":
                details = params.get("exceptionDetails", {})
                text = details.get("exception", {}).get("description") or details.get("text")
                problems.append(("exception", text))
            elif method == "Runtime.consoleAPICalled" and params.get("type") in ("error", "warning"):
                args = [
                    str(arg.get("value") or arg.get("description") or "")
                    for arg in params.get("args", [])
                ]
                problems.append((params["type"], " ".join(args)))
            elif method == "Log.entryAdded":
                entry = params.get("entry", {})
                if entry.get("level") in ("error", "warning"):
                    problems.append((entry["level"], f"{entry.get('text')} {entry.get('url', '')}"))
        return problems