#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "$SCRIPT_DIR/install-runtime.sh" --brand-title=english
echo ""
echo "按回车键关闭窗口…"
read -r
