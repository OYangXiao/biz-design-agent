#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# 兼容两种目录布局：1) 在仓库 dist/installers/ 内运行；2) 在解压后的独立安装包根目录运行
if [ -d "$SCRIPT_DIR/../harness-plugin" ]; then
  PLUGIN_SRC="$(cd "$SCRIPT_DIR/../harness-plugin" && pwd)"
  DSH_SRC="$(cd "$SCRIPT_DIR/../dsh-bundle" && pwd)"
elif [ -d "$SCRIPT_DIR/harness-plugin" ]; then
  PLUGIN_SRC="$SCRIPT_DIR/harness-plugin"
  DSH_SRC="$SCRIPT_DIR/dsh-bundle"
else
  echo "❌ 未找到 harness-plugin 目录，请确保完整解压安装包后再双击运行。"
  read -r -p "按回车键退出..."
  exit 1
fi

FIGMA_SRC="$PLUGIN_SRC/runtime/plugin"
DEFAULT_FIGMA_DIR="$HOME/Documents/BizDesignAgent-FigmaPlugin"

echo "============================================================"
echo "  Biz Design Agent (v1.5.1) · macOS 一键安装向导"
echo "============================================================"
echo ""

# 1. 检测可用 Node >= 18（含便携版 Node）
FOUND_NODE=""
PORTABLE_REC=""
if [ -f "$HOME/.biz-design-agent/runtime/node-path.txt" ]; then
  PORTABLE_REC="$(tr -d '\r\n' < "$HOME/.biz-design-agent/runtime/node-path.txt" 2>/dev/null || true)"
fi
for cand in \
  "$PORTABLE_REC" \
  "$HOME/.biz-design-agent/runtime/node/bin/node" \
  "$(command -v node 2>/dev/null || true)" \
  /opt/homebrew/bin/node \
  /usr/local/bin/node \
  "$HOME/.volta/bin/node" \
  "$HOME/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node" \
  "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node" \
  "$HOME/.nvm/versions/node"/*/bin/node
do
  if [ -n "$cand" ] && [ -x "$cand" ]; then
    ver=$("$cand" -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)
    if [ "$ver" -ge 18 ] 2>/dev/null; then
      FOUND_NODE="$cand"
      break
    fi
  fi
done

if [ -n "$FOUND_NODE" ]; then
  echo "✅ 已检测到可用 Node.js：$FOUND_NODE ($("$FOUND_NODE" -v))"
else
  echo "⚠️  未检测到 Node.js >= 18（若你仅使用 DeepSeek Harness 桌面端则无需单独安装；其他客户端需要 Node >= 18）。"
fi
echo ""

INSTALLED_COUNT=0

# 2. 自动安装到 Antigravity (Gemini.app / agy CLI)
AGY_BIN=""
if [ -x "$HOME/.local/bin/agy" ]; then
  AGY_BIN="$HOME/.local/bin/agy"
elif [ -x "/Applications/Gemini.app/Contents/Helpers/agy" ]; then
  AGY_BIN="/Applications/Gemini.app/Contents/Helpers/agy"
elif command -v agy >/dev/null 2>&1; then
  AGY_BIN="$(command -v agy)"
fi

if [ -n "$AGY_BIN" ]; then
  echo "▶ 正在安装到 Antigravity / Gemini App..."
  "$AGY_BIN" plugin install "$PLUGIN_SRC" && echo "✅ Antigravity 插件安装完成" || {
    mkdir -p "$HOME/.gemini/config/plugins"
    rm -rf "$HOME/.gemini/config/plugins/biz-design-agent"
    cp -R "$PLUGIN_SRC" "$HOME/.gemini/config/plugins/biz-design-agent"
    echo "✅ 已写入 ~/.gemini/config/plugins/biz-design-agent"
  }
  INSTALLED_COUNT=$((INSTALLED_COUNT + 1))
elif [ -d "/Applications/Gemini.app" ] || [ -d "$HOME/.gemini" ]; then
  echo "▶ 正在安装到 Antigravity 全局插件目录..."
  mkdir -p "$HOME/.gemini/config/plugins"
  rm -rf "$HOME/.gemini/config/plugins/biz-design-agent"
  cp -R "$PLUGIN_SRC" "$HOME/.gemini/config/plugins/biz-design-agent"
  echo "✅ 已写入 ~/.gemini/config/plugins/biz-design-agent"
  INSTALLED_COUNT=$((INSTALLED_COUNT + 1))
fi

# 3. 自动安装到 Claude Code（写入 ~/.claude/skills/biz-design-agent/，免 marketplace 自动全局生效）
if [ -d "$HOME/.claude" ] || command -v claude >/dev/null 2>&1 || [ -x "$HOME/.local/bin/claude" ]; then
  echo "▶ 正在安装到 Claude Code (~/.claude/skills/biz-design-agent)..."
  mkdir -p "$HOME/.claude/skills"
  rm -rf "$HOME/.claude/skills/biz-design-agent"
  cp -R "$PLUGIN_SRC" "$HOME/.claude/skills/biz-design-agent"
  echo "✅ Claude Code 插件安装完成（新开会话自动以 biz-design-agent@skills-dir 生效）"
  INSTALLED_COUNT=$((INSTALLED_COUNT + 1))
fi

# 4. 自动安装到 Cursor
if [ -d "/Applications/Cursor.app" ] || [ -d "$HOME/.cursor" ]; then
  echo "▶ 正在安装到 Cursor (~/.cursor/plugins/biz-design-agent)..."
  mkdir -p "$HOME/.cursor/plugins"
  rm -rf "$HOME/.cursor/plugins/biz-design-agent"
  cp -R "$PLUGIN_SRC" "$HOME/.cursor/plugins/biz-design-agent"
  echo "✅ Cursor 插件目录已就绪"
  INSTALLED_COUNT=$((INSTALLED_COUNT + 1))
fi

# 5. 检测 DeepSeek Harness（打印一键复制路径并在终端提示 GUI 导入步骤）
if [ -d "/Applications/DeepSeek Harness.app" ] || [ -d "$HOME/.dsh" ]; then
  echo ""
  echo "▶ 检测到 DeepSeek Harness！"
  echo "  请在 DeepSeek Harness 左侧点「Plugins → Add plugin」，粘贴以下目录回车即可启用："
  echo "  $DSH_SRC"
  if command -v pbcopy >/dev/null 2>&1; then
    printf '%s' "$DSH_SRC" | pbcopy
    echo "  （已自动为你复制该路径到剪贴板）"
  fi
  INSTALLED_COUNT=$((INSTALLED_COUNT + 1))
fi

if [ "$INSTALLED_COUNT" -eq 0 ]; then
  echo "ℹ️  未自动探测到已安装的 AI 客户端目录。"
  echo "  - 插件源目录：$PLUGIN_SRC"
  echo "  - DSH 插件目录：$DSH_SRC"
fi

echo ""
echo "------------------------------------------------------------"
echo "第二步：复制 Figma 桌面端桥接插件（全局仅需导入一次）"
echo "默认可见目录：$DEFAULT_FIGMA_DIR"
read -r -p "直接按回车使用默认目录，或输入自定义路径（输入 skip 跳过）: " USER_FIGMA_DIR

if [ "$USER_FIGMA_DIR" != "skip" ]; then
  TARGET_FIGMA_DIR="${USER_FIGMA_DIR:-$DEFAULT_FIGMA_DIR}"
  TARGET_FIGMA_DIR="${TARGET_FIGMA_DIR/#\~/$HOME}"
  mkdir -p "$TARGET_FIGMA_DIR"
  cp "$FIGMA_SRC/manifest.json" "$FIGMA_SRC/code.js" "$FIGMA_SRC/ui.html" "$TARGET_FIGMA_DIR/"
  echo "✅ Figma 插件已复制到：$TARGET_FIGMA_DIR"
  echo "▶ 正在为你打开 Finder 并高亮选中 manifest.json..."
  open -R "$TARGET_FIGMA_DIR/manifest.json" || true
  echo ""
  echo "接下来请在 Figma Desktop 中完成 3 步："
  echo "  1. 打开任意设计稿"
  echo "  2. 顶部菜单：Plugins → Development → Import plugin from manifest..."
  echo "  3. 选中刚高亮的 manifest.json，然后运行 Biz Design Agent 插件即可！"
fi

echo ""
echo "🎉 全部完成！重启或新开 AI 客户端会话后，发送「打开 biz-design-agent 主菜单」即可开始使用。"
read -r -p "按回车键关闭窗口..."
