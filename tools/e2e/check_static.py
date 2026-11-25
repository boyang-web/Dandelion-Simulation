#!/usr/bin/env python3
"""Static consistency checks (no browser, negligible CPU).

Verifies:
  * every relative import in src/ resolves to a real file
  * bare imports are only three / vue (declared in the importmap)
  * vendor + entry assets referenced by game.html exist
  * labs pages still point at existing scripts/styles
  * the scene layer contains no DOM queries
  * the deck has no missing image references and every slide has a title
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "src"

IMPORT_RE = re.compile(r"""^\s*import\s+(?:[^'"]+?\s+from\s+)?['"]([^'"]+)['"]""", re.MULTILINE)
EXPORT_RE = re.compile(r"""^\s*export\s+(?:[^'"]+?\s+from\s+)['"]([^'"]+)['"]""", re.MULTILINE)
DOM_QUERY_RE = re.compile(r"document\.(getElementById|querySelector|querySelectorAll)|document\.body\.(appendChild|classList)")
COMMENT_RE = re.compile(r"/\*.*?\*/|//[^\n]*", re.S)

results = []


def check(name, ok, detail=""):
    results.append({"test": name, "ok": bool(ok), "detail": str(detail)})
    print(("PASS  " if ok else "FAIL  ") + name + ("" if ok else f"   ← {detail}"))


def main():
    js_files = sorted(SRC.rglob("*.js")) + sorted((ROOT / "prototype/js").glob("*.js"))
    missing = []
    bare = set()
    for path in js_files:
        if path.name.startswith("bundle"):
            continue
        text = path.read_text(encoding="utf-8")
        if len(text) > 400_000:  # generated bundles already excluded above
            continue
        for spec in IMPORT_RE.findall(text) + EXPORT_RE.findall(text):
            if spec.startswith("."):
                target = (path.parent / spec.split("?")[0]).resolve()
                if not target.exists():
                    missing.append(f"{path.relative_to(ROOT)} → {spec}")
            else:
                bare.add(spec.split("?")[0])

    check("相对导入全部可解析", not missing, missing[:6])
    check("裸导入仅 three / vue", bare <= {"three", "vue"}, sorted(bare))

    catalog = (ROOT / "index.html").read_text()
    pages = ["game.html", "dev.html", "prototype/index.html", "labs/vegetation.html",
             "labs/landmarks.html", "labs/distant.html", "labs/valley.html"]
    check("Demo 目录覆盖全部展项", all(f'href="{path}"' in catalog and
          (ROOT / path).is_file() for path in pages))
    check("Windows 启动器使用共用服务", "serve_local.py --launch" in (ROOT / "Start.cmd").read_text())

    # importmap
    index = (ROOT / "game.html").read_text(encoding="utf-8")
    map_match = re.search(r"<script type=\"importmap\">\s*(\{.*?\})\s*</script>", index, re.S)
    mapping = json.loads(map_match.group(1))["imports"] if map_match else {}
    check("importmap 存在", bool(mapping), mapping)
    check("importmap 目标文件存在",
          all((ROOT / target.lstrip("./")).exists() for target in mapping.values()), mapping)

    # shell assets
    css = re.search(r'<link rel="stylesheet" href="\./([^"?]+)', index)
    entry = re.search(r'<script type="module" src="\./([^"?]+)', index)
    check("入口样式存在", bool(css) and (ROOT / css.group(1)).exists(), css.group(1) if css else None)
    check("入口模块存在", bool(entry) and (ROOT / entry.group(1)).exists(), entry.group(1) if entry else None)
    check("game.html 有挂载点", 'id="app"' in index)

    # scene layer must not query the DOM (dev console and labs previews are exempt)
    exempt = {
        "dev-console.js", "capture.js",  # dev overlay + temporary download anchor
        "distant.js", "landmarks-preview.js", "valley-preview.js", "vegetation-preview.js"
    }
    offenders = []
    for path in (SRC / "engine").glob("*.js"):
        if path.name in exempt or path.name.startswith("bundle"):
            continue
        source = COMMENT_RE.sub("", path.read_text(encoding="utf-8"))
        for hit in DOM_QUERY_RE.finditer(source):
            offenders.append(f"{path.name}:{hit.group(0)}")
    check("场景层无 DOM 查询", not offenders, offenders[:5])

    # store contract: every ui.<field> must exist in the reactive shape
    store_src = (SRC / "app" / "state" / "ui.js").read_text(encoding="utf-8")
    block = store_src[store_src.index("reactive({"):]
    block = block[:block.index("});")]
    fields = set(re.findall(r"^\s{4}([a-zA-Z][a-zA-Z0-9]*)\s*:", block, re.MULTILINE))
    unknown = set()
    for path in list((SRC / "app").rglob("*.js")) + list((SRC / "engine").glob("*.js")):
        if path.name.startswith("bundle"):
            continue
        source = COMMENT_RE.sub("", path.read_text(encoding="utf-8"))
        for name in re.findall(r"(?<![./\w])ui\.([a-zA-Z][a-zA-Z0-9]*)", source):
            if name not in fields:
                unknown.add(f"{path.name}: ui.{name}")
    check("ui 字段均在 store 中定义", not unknown, sorted(unknown)[:6])

    # click-to-run launcher
    launcher = ROOT / "启动.command"
    check("双击启动器存在", launcher.exists(), launcher.name)
    check("双击启动器可执行", launcher.exists() and os.access(launcher, os.X_OK))
    if launcher.exists():
        text = launcher.read_text(encoding="utf-8")
        check("启动器调用本地服务器", "tools/serve_local.py" in text)
        check("启动器可禁用自动开窗（便于自测）", "NO_OPEN" in (ROOT / "tools/serve_local.py").read_text())
    check("file:// 提示指向启动器", "启动.command" in index)

    # labs pages
    lab_problems = []
    for page in sorted((ROOT / "labs").glob("*.html")):
        text = page.read_text(encoding="utf-8")
        for match in re.finditer(r'(?:href|src)="\.\./([^"?]+)', text):
            target = ROOT / match.group(1)
            if not target.exists():
                lab_problems.append(f"{page.name} → {match.group(1)}")
    check("labs 资源引用有效", not lab_problems, lab_problems[:5])

    # deck
    deck = ROOT / "docs" / "presentation.html"
    if deck.exists():
        html = deck.read_text(encoding="utf-8")
        slides = re.findall(r'<section class="slide[^"]*"[^>]*data-title="([^"]*)"', html)
        check("演示文稿页数 ≥ 30", len(slides) >= 30, len(slides))
        check("每页都有标题", all(title.strip() for title in slides))
        missing_imgs = [src for src in re.findall(r'<img[^>]+src="([^"]+)"', html)
                        if not (deck.parent / src).exists()]
        check("演示文稿无缺失图片", not missing_imgs, missing_imgs)
        check("演示文稿可用键盘翻页", "ArrowRight" in html and "ArrowLeft" in html)
        check("演示文稿含演讲备注", html.count('data-notes=') >= 10, html.count('data-notes='))

    passed = sum(1 for item in results if item["ok"])
    total = len(results)
    print(f"\n{passed}/{total} static checks passed")

    report_path = ROOT / "docs" / "static-report.json"
    report_path.write_text(json.dumps({
        "passed": passed,
        "total": total,
        "results": results
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())