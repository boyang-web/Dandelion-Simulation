#!/bin/bash
# ============================================================
#  等风来 · 本地启动器
#  双击本文件即可：启动本地服务器 → 在浏览器中打开山谷。
#  关闭这个终端窗口（或按 Control + C）即可停止。
# ============================================================

set -u
cd "$(dirname "$0")" || exit 1

if ! command -v python3 >/dev/null 2>&1; then
  echo ""
  echo "没有找到 python3。"
  echo "macOS 请先安装命令行工具：xcode-select --install"
  echo ""
  read -r -n 1 -s -p "按任意键关闭…"
  exit 1
fi

exec python3 tools/serve_local.py --launch
