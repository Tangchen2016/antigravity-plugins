#!/usr/bin/env bash
set -euo pipefail

RUNTIME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$RUNTIME_DIR"

REAL_USER="${SUDO_USER:-$USER}"
REAL_HOME="$(eval echo "~$REAL_USER" 2>/dev/null || echo "$HOME")"

export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/opt/local/bin:$PATH"
for p in "$REAL_HOME/.volta/bin" "$REAL_HOME/.asdf/shims" "$REAL_HOME/.local/share/mise/shims" "$REAL_HOME/.local/bin" "$REAL_HOME/.fnm/current/bin" "$REAL_HOME/.local/share/fnm/aliases/default/bin" "$REAL_HOME/Library/Application Support/fnm/aliases/default/bin"; do
  [ -d "$p" ] && export PATH="$p:$PATH"
done
for p in "$REAL_HOME"/.nvm/versions/node/*/bin /opt/homebrew/opt/node@*/bin /usr/local/opt/node@*/bin; do
  [ -d "$p" ] && export PATH="$p:$PATH"
done

if [ "$(uname -s)" = "Darwin" ] && [ "$EUID" -ne 0 ]; then
  echo "提示：macOS 修改 /Applications/Antigravity.app 需要管理员权限，请输入开机密码："
  exec sudo env "PATH=$PATH" "SUDO_USER=$USER" bash "$0" "$@"
fi

if ! command -v node >/dev/null 2>&1; then
  echo "错误：未检测到 Node.js，请先安装 Node.js (LTS) 后重试。" >&2
  exit 1
fi

HAS_BRAND=false
for arg in "$@"; do
  [[ "$arg" == --brand-title* ]] && HAS_BRAND=true
done

EXTRA_ARGS=()
if [ "$HAS_BRAND" = false ]; then
  EXTRA_ARGS+=("--brand-title=english")
fi

mkdir -p "$RUNTIME_DIR/active"
echo "正在安装 Antigravity 语言包注入运行时（监听目录：$RUNTIME_DIR/active）..."
if [ "${#EXTRA_ARGS[@]}" -gt 0 ]; then
  node "$RUNTIME_DIR/localization_engine.js" --apply "${EXTRA_ARGS[@]}" ${1+"$@"}
else
  node "$RUNTIME_DIR/localization_engine.js" --apply ${1+"$@"}
fi
echo "✔ 注入运行时安装完成。重启 Antigravity 后生效，之后可在「语言包管理」侧边栏实时切换中/英文或导入词库。"
