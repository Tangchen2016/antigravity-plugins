#!/usr/bin/env bash
set -euo pipefail

REPO="${ANTIGRAVITY_PLUGINS_REPO:-Tangchen2016/antigravity-plugins}"
BRANCH="${ANTIGRAVITY_PLUGINS_BRANCH:-main}"
DEST_DIR="${ANTIGRAVITY_PLUGINS_DIR:-$HOME/.gemini/config/plugins}"

TMP_DIR=""
cleanup() {
  if [ -n "$TMP_DIR" ] && [ -d "$TMP_DIR" ]; then
    rm -rf "$TMP_DIR"
  fi
}
trap cleanup EXIT

usage() {
  cat <<EOF
用法:
  ./install.sh                     安装全部插件
  ./install.sh <plugin> [...]      安装指定插件
  ./install.sh --list              列出可用插件

远程一键安装:
  curl -fsSL https://raw.githubusercontent.com/${REPO}/${BRANCH}/install.sh | bash
  curl -fsSL https://raw.githubusercontent.com/${REPO}/${BRANCH}/install.sh | bash -s -- progress-updates
EOF
}

resolve_source_dir() {
  local script_dir=""
  if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  fi
  if [ -n "$script_dir" ] && [ -d "$script_dir/plugins" ]; then
    echo "$script_dir/plugins"
    return
  fi

  TMP_DIR="$(mktemp -d)"
  local url="https://github.com/${REPO}/archive/refs/heads/${BRANCH}.tar.gz"
  echo "正在下载 ${REPO}@${BRANCH} ..." >&2
  curl -fsSL "$url" | tar -xz -C "$TMP_DIR"
  local extracted
  extracted="$(find "$TMP_DIR" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  if [ -z "$extracted" ] || [ ! -d "$extracted/plugins" ]; then
    echo "错误：未在压缩包中找到 plugins/ 目录。" >&2
    exit 1
  fi
  echo "$extracted/plugins"
}

list_plugins() {
  local src_dir="$1"
  for dir in "$src_dir"/*/; do
    [ -f "${dir}plugin.json" ] && basename "$dir"
  done
}

main() {
  if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
    usage
    exit 0
  fi

  local src_dir
  src_dir="$(resolve_source_dir)"

  if [ "${1:-}" = "--list" ]; then
    list_plugins "$src_dir"
    exit 0
  fi

  local targets=()
  if [ "$#" -eq 0 ]; then
    while IFS= read -r name; do
      [ -n "$name" ] && targets+=("$name")
    done < <(list_plugins "$src_dir")
  else
    targets=("$@")
  fi

  if [ "${#targets[@]}" -eq 0 ]; then
    echo "错误：没有可安装的插件。" >&2
    exit 1
  fi

  mkdir -p "$DEST_DIR"

  local installed=()
  for name in "${targets[@]}"; do
    local src="$src_dir/$name"
    if [ ! -f "$src/plugin.json" ]; then
      echo "错误：未找到插件 '$name'。可用插件：" >&2
      list_plugins "$src_dir" | sed 's/^/  - /' >&2
      exit 1
    fi
    rm -rf "$DEST_DIR/$name"
    cp -R "$src" "$DEST_DIR/$name"
    installed+=("$name")
    echo "✔ 已安装 $name -> $DEST_DIR/$name"
  done

  echo ""
  echo "完成（共 ${#installed[@]} 个插件）。打开 Antigravity「个性化定制 → 已安装」即可管理；规则类插件下一轮对话即生效，侧边栏扩展如未刷新请关闭旧面板标签后重开。"
}

main "$@"
