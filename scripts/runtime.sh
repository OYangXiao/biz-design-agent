#!/usr/bin/env bash
# 解析纯 Node 运行时路径（被其他脚本 source）
#
# 全栈已收敛为纯 Node.js（>= 18），不再强制要求 Python / Pillow。
# 自动探测顺序：NODE_BIN > PATH > Homebrew > ~/.nvm 最高 >=18 版本 > DSH 内置运行时。
# 仅在显式调用旧版 `./fimg preview` 时才按需检查 Python。

DSH_RUNTIME_ROOT="${DSH_RUNTIME_ROOT:-$HOME/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies}"
DSH_NODE="$DSH_RUNTIME_ROOT/node/bin/node"
DSH_PY="$DSH_RUNTIME_ROOT/python/bin/python3"

_node_ok() {
  [ -n "$1" ] && [ -x "$1" ] || return 1
  "$1" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)' 2>/dev/null
}

resolve_node() {
  local c
  for c in "${NODE_BIN:-}" "$(command -v node 2>/dev/null || true)" /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.volta/bin/node" "$DSH_NODE"; do
    if _node_ok "$c"; then echo "$c"; return 0; fi
  done
  # 扫描 ~/.nvm/versions/node/*（优先高版本）
  local nvm_dir="${NVM_DIR:-$HOME/.nvm}/versions/node"
  if [ -d "$nvm_dir" ]; then
    for c in $(ls -1 "$nvm_dir" 2>/dev/null | sort -r); do
      if _node_ok "$nvm_dir/$c/bin/node"; then
        echo "$nvm_dir/$c/bin/node"
        return 0
      fi
    done
  fi
  echo "✖ 找不到可用的 node（需要 >= 18）。" >&2
  echo "  可通过 nvm 安装最新 LTS（nvm install --lts），或设置 NODE_BIN=/path/to/node" >&2
  return 1
}

resolve_python() {
  local c
  for c in "${PY_BIN:-}" "$(command -v python3 2>/dev/null || true)" "$DSH_PY"; do
    if [ -n "$c" ] && [ -x "$c" ] && "$c" -c 'import PIL' 2>/dev/null; then
      echo "$c"
      return 0
    fi
  done
  echo "✖ 旧版 preview 需要装有 Pillow 的 python3（新流程与视觉对图已改为纯 Node，无需 Python）。" >&2
  return 1
}

NODE="$(resolve_node)" || exit 1
export NODE

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export REPO_ROOT
