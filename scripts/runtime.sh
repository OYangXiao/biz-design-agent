#!/usr/bin/env bash
# 解析纯 Node 运行时路径（被其他脚本 source）
#
# 全栈已收敛为纯 Node.js（>= 18），零 Python 依赖。
# 自动探测顺序：NODE_BIN > 便携版 Node (~/.biz-design-agent/runtime/node) > PATH > Homebrew > Volta > ~/.nvm 最高 >=18 版本 > DSH 内置运行时。

DSH_RUNTIME_ROOT="${DSH_RUNTIME_ROOT:-$HOME/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies}"
DSH_NODE="$DSH_RUNTIME_ROOT/node/bin/node"
PORTABLE_NODE_REC=""
if [ -f "$HOME/.biz-design-agent/runtime/node-path.txt" ]; then
  PORTABLE_NODE_REC="$(tr -d '\r\n' < "$HOME/.biz-design-agent/runtime/node-path.txt" 2>/dev/null || true)"
fi

_node_ok() {
  [ -n "$1" ] && [ -x "$1" ] || return 1
  "$1" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)' 2>/dev/null
}

resolve_node() {
  local c
  for c in "${NODE_BIN:-}" "$PORTABLE_NODE_REC" "$HOME/.biz-design-agent/runtime/node/bin/node" "$(command -v node 2>/dev/null || true)" /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.volta/bin/node" "$DSH_NODE"; do
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
  echo "  请通过分发引导下载便携版 Node（~/.biz-design-agent/runtime/node）、安装官方 Node LTS，或设置 NODE_BIN=/path/to/node" >&2
  return 1
}

NODE="$(resolve_node)" || exit 1
export NODE

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export REPO_ROOT
