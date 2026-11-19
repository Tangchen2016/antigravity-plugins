#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "$SCRIPT_DIR/uninstall-runtime.sh"
echo ""
echo "按回车键关闭窗口…"
read -r
