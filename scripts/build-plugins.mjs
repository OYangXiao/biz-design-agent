#!/usr/bin/env node
// 从单一源码构建多 Harness 插件产物（dist/harness-plugin + dist/dsh-bundle + 双击安装器）
// 零第三方依赖，纯 Node 生成，产物随仓库提交，支持 GitHub clone / ZIP / 内网独立网站多种分发形态。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

export const HARNESS_PLUGIN_DIR = path.join(ROOT, 'dist', 'harness-plugin');
export const DSH_BUNDLE_DIR = path.join(ROOT, 'dist', 'dsh-bundle');
export const INSTALLERS_DIR = path.join(ROOT, 'dist', 'installers');

const WORKFLOW_DOCS = [
  'DESIGN-AGENT.md',
  'PRD-WORKFLOW.md',
  'PROTOTYPE-WORKFLOW.md',
  'VISUAL-DESIGN-WORKFLOW.md',
  'DEV-HANDOFF-WORKFLOW.md',
  'QA-VERIFY-WORKFLOW.md',
  'TEAM-INTAKE.md',
];

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none">
  <rect x="8" y="8" width="112" height="112" rx="28" fill="#1D4ED8"/>
  <rect x="28" y="30" width="32" height="32" rx="8" fill="#FFFFFF"/>
  <rect x="68" y="30" width="32" height="32" rx="16" fill="#93C5FD"/>
  <rect x="28" y="68" width="32" height="32" rx="16" fill="#60A5FA"/>
  <path d="M68 76C68 71.5817 71.5817 68 76 68H92C96.4183 68 100 71.5817 100 76V92C100 96.4183 96.4183 100 92 100H76C71.5817 100 68 96.4183 68 92V76Z" fill="#FFFFFF"/>
  <circle cx="84" cy="84" r="6" fill="#1D4ED8"/>
</svg>
`;

const LICENSE_TEXT = `MIT License

Copyright (c) 2026 Biz Design Agent Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

function writeFile(filePath, content, mode = null) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  if (mode !== null) {
    fs.chmodSync(filePath, mode);
  }
}

function copyDir(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (['.DS_Store', 'node_modules'].includes(entry.name)) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDir(from, to);
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
      const st = fs.statSync(from);
      if ((st.mode & 0o111) !== 0) {
        fs.chmodSync(to, 0o755);
      }
    }
  }
}

/** 将完整纯 Node 运行时打入目标 runtime/ 目录（确保脱离源仓库后 100% 自包含运行） */
function copyRuntime(targetRoot) {
  const runtimeDir = path.join(targetRoot, 'runtime');
  fs.mkdirSync(runtimeDir, { recursive: true });

  // 写入精简版 package.json（供 src/mcp-server.mjs 与 server/dist-server.mjs 读取版本号）
  const runtimePkg = {
    name: PKG.name,
    version: PKG.version,
    private: true,
    type: 'module',
    engines: PKG.engines || { node: '>=18' },
  };
  writeFile(path.join(runtimeDir, 'package.json'), `${JSON.stringify(runtimePkg, null, 2)}\n`);

  for (const sub of ['bin', 'src', 'bridge', 'server', 'tools', 'plugin']) {
    copyDir(path.join(ROOT, sub), path.join(runtimeDir, sub));
  }
}

/** 将统一 SKILL.md 与工作流参考文档打入目标 skills/ 目录 */
function copySkillBundle(targetRoot) {
  const skillDst = path.join(targetRoot, 'skills', 'biz-design-agent');
  fs.mkdirSync(path.join(skillDst, 'references'), { recursive: true });
  fs.copyFileSync(
    path.join(ROOT, 'skills', 'biz-design-agent', 'SKILL.md'),
    path.join(skillDst, 'SKILL.md'),
  );
  for (const docName of WORKFLOW_DOCS) {
    const srcDoc = path.join(ROOT, 'docs', docName);
    if (fs.existsSync(srcDoc)) {
      fs.copyFileSync(srcDoc, path.join(skillDst, 'references', docName));
    }
  }
}

/** POSIX 启动器：自动扫描便携版 Node / Homebrew / /usr/local / Volta / DSH 内置运行时 / NVM 中的 Node >= 18，彻底解决 macOS GUI 客户端丢失 PATH 问题 */
function renderPosixRunMcp() {
  return `#!/bin/sh
set -e
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
AGENT_ENTRY="$SCRIPT_DIR/../runtime/bin/biz-design-agent.mjs"

find_node() {
  PORTABLE_REC=""
  if [ -f "$HOME/.biz-design-agent/runtime/node-path.txt" ]; then
    PORTABLE_REC=$(tr -d '\\r\\n' < "$HOME/.biz-design-agent/runtime/node-path.txt" 2>/dev/null || true)
  fi
  for cand in \\
    "$PORTABLE_REC" \\
    "$HOME/.biz-design-agent/runtime/node/bin/node" \\
    "$(command -v node 2>/dev/null || true)" \\
    /opt/homebrew/bin/node \\
    /usr/local/bin/node \\
    "$HOME/.volta/bin/node" \\
    "$HOME/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node" \\
    "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node"
  do
    if [ -n "$cand" ] && [ -x "$cand" ]; then
      ver=$("$cand" -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)
      if [ "$ver" -ge 18 ] 2>/dev/null; then
        printf '%s\\n' "$cand"
        return 0
      fi
    fi
  done

  NVM_ROOT="\${NVM_DIR:-$HOME/.nvm}/versions/node"
  if [ -d "$NVM_ROOT" ]; then
    best=""
    best_major=0
    for d in "$NVM_ROOT"/*; do
      if [ -x "$d/bin/node" ]; then
        ver=$("$d/bin/node" -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)
        if [ "$ver" -ge 18 ] 2>/dev/null && [ "$ver" -ge "$best_major" ]; then
          best="$d/bin/node"
          best_major="$ver"
        fi
      fi
    done
    if [ -n "$best" ]; then
      printf '%s\\n' "$best"
      return 0
    fi
  fi
  return 1
}

NODE_BIN=$(find_node) || {
  echo "biz-design-agent: 未检测到 Node.js >= 18，请先安装 Node LTS 或通过分发引导下载便携版 Node（~/.biz-design-agent/runtime/node）。" >&2
  exit 1
}

exec "$NODE_BIN" "$AGENT_ENTRY" mcp "$@"
`;
}

/** Windows 启动器：扫描便携版 Node / PATH / NVM_SYMLINK / Program Files / LocalAppData / DSH 内置 Node */
function renderWindowsRunMcp() {
  return `@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "AGENT_ENTRY=%SCRIPT_DIR%..\\runtime\\bin\\biz-design-agent.mjs"

if exist "%USERPROFILE%\\.biz-design-agent\\runtime\\node\\node.exe" (
  "%USERPROFILE%\\.biz-design-agent\\runtime\\node\\node.exe" "%AGENT_ENTRY%" mcp %*
  exit /b %ERRORLEVEL%
)
if exist "%NVM_SYMLINK%\\node.exe" (
  "%NVM_SYMLINK%\\node.exe" "%AGENT_ENTRY%" mcp %*
  exit /b %ERRORLEVEL%
)
if exist "C:\\Program Files\\nodejs\\node.exe" (
  "C:\\Program Files\\nodejs\\node.exe" "%AGENT_ENTRY%" mcp %*
  exit /b %ERRORLEVEL%
)
if exist "%LOCALAPPDATA%\\Programs\\nodejs\\node.exe" (
  "%LOCALAPPDATA%\\Programs\\nodejs\\node.exe" "%AGENT_ENTRY%" mcp %*
  exit /b %ERRORLEVEL%
)
if exist "%USERPROFILE%\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\node\\node.exe" (
  "%USERPROFILE%\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\node\\node.exe" "%AGENT_ENTRY%" mcp %*
  exit /b %ERRORLEVEL%
)
where node >nul 2>nul
if %ERRORLEVEL%==0 (
  node "%AGENT_ENTRY%" mcp %*
  exit /b %ERRORLEVEL%
)

echo biz-design-agent: Node.js ^>= 18 not found. Please install Node LTS or portable Node. 1>&2
exit /b 1
`;
}

function buildHarnessPlugin() {
  fs.rmSync(HARNESS_PLUGIN_DIR, { recursive: true, force: true });
  fs.mkdirSync(HARNESS_PLUGIN_DIR, { recursive: true });

  const description = '纯 Node 多角色业务设计协作插件：涵盖 PRD 双端同源生成、可点击原型图、高保真视觉稿、研发规格提取与隔离浏览器 QA 验收对图。';

  // 1) Antigravity 原生 manifest + mcp_config.json
  writeFile(
    path.join(HARNESS_PLUGIN_DIR, '.antigravity-plugin', 'plugin.json'),
    `${JSON.stringify({
      $schema: 'https://antigravity.google/schemas/v1/plugin.json',
      name: 'biz-design-agent',
      displayName: 'Biz Design Agent',
      version: PKG.version,
      description,
      logo: 'assets/logo.svg',
      author: { name: 'Biz Design Team' },
      license: 'MIT',
      suggestedPrompts: [
        '打开 biz-design-agent 主菜单，查看五种工作模式',
        '进入模式 1，帮我编写或更新一份产品 PRD',
        '运行环境自检并检查 Figma 桌面插件连通状态',
      ],
    }, null, 2)}\n`,
  );

  writeFile(
    path.join(HARNESS_PLUGIN_DIR, 'mcp_config.json'),
    `${JSON.stringify({
      mcpServers: {
        'biz-design-agent': {
          command: '/bin/sh',
          args: ['${PLUGIN_ROOT}/scripts/run-mcp'],
        },
      },
    }, null, 2)}\n`,
  );

  // 2) Claude Code / Cowork manifest（内联 mcpServers，根目录不放 .mcp.json 避免触发 Antigravity 告警）
  writeFile(
    path.join(HARNESS_PLUGIN_DIR, '.claude-plugin', 'plugin.json'),
    `${JSON.stringify({
      name: 'biz-design-agent',
      displayName: 'Biz Design Agent',
      version: PKG.version,
      description,
      author: { name: 'Biz Design Team' },
      license: 'MIT',
      mcpServers: {
        'biz-design-agent': {
          command: '${CLAUDE_PLUGIN_ROOT}/scripts/run-mcp',
          args: [],
        },
      },
    }, null, 2)}\n`,
  );

  // 3) Codex manifest + .codex-mcp.json（实测 Codex 不展开 ${CLAUDE_PLUGIN_ROOT}，用 cwd: "." 自动解析到插件缓存根）
  writeFile(
    path.join(HARNESS_PLUGIN_DIR, '.codex-plugin', 'plugin.json'),
    `${JSON.stringify({
      name: 'biz-design-agent',
      version: PKG.version,
      description,
      mcpServers: './.codex-mcp.json',
    }, null, 2)}\n`,
  );

  writeFile(
    path.join(HARNESS_PLUGIN_DIR, '.codex-mcp.json'),
    `${JSON.stringify({
      mcpServers: {
        'biz-design-agent': {
          command: './scripts/run-mcp',
          args: [],
          cwd: '.',
        },
      },
    }, null, 2)}\n`,
  );

  // 4) Cursor manifest（内联 mcpServers，避免根目录放 mcp.json 触发 Antigravity 校验告警）
  writeFile(
    path.join(HARNESS_PLUGIN_DIR, '.cursor-plugin', 'plugin.json'),
    `${JSON.stringify({
      name: 'biz-design-agent',
      displayName: 'Biz Design Agent',
      version: PKG.version,
      description,
      author: { name: 'Biz Design Team' },
      license: 'MIT',
      mcpServers: {
        'biz-design-agent': {
          command: '${CURSOR_PLUGIN_ROOT}/scripts/run-mcp',
          args: [],
        },
      },
    }, null, 2)}\n`,
  );

  // 5) 跨平台 Node 寻址启动器 + 图标 + 文档 + LICENSE
  writeFile(path.join(HARNESS_PLUGIN_DIR, 'scripts', 'run-mcp'), renderPosixRunMcp(), 0o755);
  writeFile(path.join(HARNESS_PLUGIN_DIR, 'scripts', 'run-mcp.cmd'), renderWindowsRunMcp());
  writeFile(path.join(HARNESS_PLUGIN_DIR, 'assets', 'logo.svg'), LOGO_SVG);
  writeFile(path.join(HARNESS_PLUGIN_DIR, 'LICENSE'), LICENSE_TEXT);
  writeFile(
    path.join(HARNESS_PLUGIN_DIR, 'README.md'),
    `# Biz Design Agent (v${PKG.version})

Multi-role business design workflow plugin for Antigravity, Claude Code / Cowork, Codex, and Cursor. It bundles a zero-dependency Node.js MCP server (18 tools), workflow skills, and the Figma Desktop bridge plugin for PRD authoring, clickable wireframes, visual design specs, developer handoff extraction, and isolated browser QA verification with pixel diffing.

## Quick Install

- **Antigravity (Gemini App / CLI)**: \`agy plugin install ./dist/harness-plugin\` (or double-click \`Install-Mac.command\` / \`Install-Windows.bat\`).
- **Claude Code / Cowork**: Copy this folder to \`~/.claude/skills/biz-design-agent/\` for automatic loading in every session, or run \`claude --plugin-dir ./dist/harness-plugin\`.
- **Figma Desktop (One-time Step)**: Ask the agent to run \`figma_install_plugin\`, then in Figma Desktop choose \`Plugins → Development → Import plugin from manifest...\` and select \`~/Documents/BizDesignAgent-FigmaPlugin/manifest.json\`.
`,
  );

  // 6) Skill 与完整自包含 runtime/（严禁使用顶层 bin/，确保 Claude Desktop Cowork 允许安装）
  copySkillBundle(HARNESS_PLUGIN_DIR);
  copyRuntime(HARNESS_PLUGIN_DIR);
}

function buildDshBundle() {
  fs.rmSync(DSH_BUNDLE_DIR, { recursive: true, force: true });
  fs.mkdirSync(DSH_BUNDLE_DIR, { recursive: true });

  const dshPkg = {
    name: '@biz-design/dsh-plugin',
    version: PKG.version,
    private: true,
    type: 'module',
    description: '业务设计 Agent（PRD 双端同源、可点击原型、高保真视觉、研发联调与 QA 验收对图）',
    exports: {
      '.': './index.mjs',
      './locale/*.json': './locale/*.json',
      './icon': './icon.svg',
    },
    files: [
      'index.mjs',
      'cordis.patch.yml',
      'icon.svg',
      'locale/*.json',
      'docs',
      'skills',
      'runtime',
    ],
    dsh: {
      bundle: {
        patch: './cordis.patch.yml',
      },
    },
  };
  writeFile(path.join(DSH_BUNDLE_DIR, 'package.json'), `${JSON.stringify(dshPkg, null, 2)}\n`);

  writeFile(
    path.join(DSH_BUNDLE_DIR, 'cordis.patch.yml'),
    `- insert:
    - id: biz-design-agent
      name: '@biz-design/dsh-plugin'
      config: {}
`,
  );

  // 零硬编码路径 Host 插件入口：
  // 1) 顶层按 DSH 安装位置解析内置包（避免 bundle 目录外缺少 node_modules/@deepseek-ai/*）；
  // 2) 同步 export function apply(ctx) 确保在 Agent 会话启动前完成 MCP 与 Skill 注册；
  // 3) 直接复用 DSH 内置 Node (process.execPath) 与自身安装目录 (import.meta.url)。
  writeFile(
    path.join(DSH_BUNDLE_DIR, 'index.mjs'),
    `// DeepSeek Harness Host 插件入口：零硬编码路径，自动复用 DSH 内置 Node 运行时挂载 MCP 与 Skill
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BUNDLE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const AGENT_ENTRY = path.join(BUNDLE_ROOT, 'runtime', 'bin', 'biz-design-agent.mjs');
const SKILLS_DIR = path.join(BUNDLE_ROOT, 'skills');

async function loadDshPackage(pkgName) {
  try {
    const mod = await import(pkgName);
    return mod.default || mod;
  } catch {
    // 回退到当前运行中的 DSH 进程入口目录解析内置包（兼容本地目录安装、.tgz 安装与 --patch 加载）
    const anchors = [];
    if (process.argv[1]) {
      try { anchors.push(fs.realpathSync(process.argv[1])); } catch { anchors.push(process.argv[1]); }
    }
    if (process.env.DSH_INSTALL_DIR) {
      anchors.push(path.join(process.env.DSH_INSTALL_DIR, 'package.json'));
    }
    for (const anchor of anchors) {
      try {
        const req = createRequire(anchor);
        const resolved = req.resolve(pkgName);
        const mod = await import(pathToFileURL(resolved).href);
        return mod.default || mod;
      } catch {
        // try next anchor
      }
    }
    return null;
  }
}

const mcpClientPlugin = await loadDshPackage('@deepseek-ai/dsh-mcp-client');
const skillFsPlugin = await loadDshPackage('@deepseek-ai/dsh-skill-filesystem');

export const name = 'biz-design-agent';

export function apply(ctx) {
  // 1) 挂载本地 stdio MCP Server（自动复用 DSH 自身的 Node 二进制，用户无需单独装 Node）
  if (mcpClientPlugin) {
    ctx.plugin(mcpClientPlugin, {
      serverName: 'bizdesign',
      transport: 'stdio',
      command: process.execPath,
      args: [AGENT_ENTRY, 'mcp'],
      failOnStartupError: false,
    });
  } else {
    ctx.logger?.warn?.('[biz-design-agent] 未能解析 @deepseek-ai/dsh-mcp-client，跳过 MCP 挂载');
  }

  // 2) 挂载随包携带的 biz-design-agent Skill（含五模式主菜单与工作流细则）
  if (skillFsPlugin) {
    ctx.plugin(skillFsPlugin, {
      providerName: 'biz-design-agent',
      includeDefaultRoots: false,
      bundledSkillDir: SKILLS_DIR,
      watch: false,
    });
  } else {
    ctx.logger?.warn?.('[biz-design-agent] 未能解析 @deepseek-ai/dsh-skill-filesystem，跳过 Skill 挂载');
  }
}
`,
  );

  writeFile(path.join(DSH_BUNDLE_DIR, 'icon.svg'), LOGO_SVG);

  writeFile(
    path.join(DSH_BUNDLE_DIR, 'locale', 'zh.json'),
    `${JSON.stringify({
      meta: {
        title: '业务设计 Agent',
        description: '五模式多角色业务设计协作：PRD 双端生成、可点击原型、高保真视觉、研发规格提取与 QA 像素对图。',
        detail: 'docs/DETAIL.md',
      },
    }, null, 2)}\n`,
  );

  writeFile(
    path.join(DSH_BUNDLE_DIR, 'locale', 'en.json'),
    `${JSON.stringify({
      meta: {
        title: 'Biz Design Agent',
        description: 'Multi-role business design workflow for PRD, clickable wireframes, visual design, dev handoff, and QA verification.',
        detail: 'docs/DETAIL.md',
      },
    }, null, 2)}\n`,
  );

  writeFile(
    path.join(DSH_BUNDLE_DIR, 'docs', 'DETAIL.md'),
    `# 业务设计 Agent (v${PKG.version})

一套覆盖业务设计、UI 视觉、前端研发与 QA 验收的全流程协作插件，直接复用 DeepSeek Harness 内置 Node 运行时，**无需单独安装 Node.js 或 Python**。

## 安装后如何使用

1. 启用本插件后，直接对 AI 说：**「打开 biz-design-agent 主菜单」**，即可在五种角色模式中自由切换。
2. 如需读写 Figma 画布（模式 1~3），首次使用时让 AI 调用 \`figma_install_plugin\` 把 Figma 桌面插件复制到 \`~/Documents/BizDesignAgent-FigmaPlugin/\`（或你指定的目录），在 Figma Desktop 中通过 \`Plugins → Development → Import plugin from manifest...\` 导入一次即可。
3. 纯文档（Word PRD / JSON / 规格提取）与浏览器 QA 验收无需连接 Figma。
`,
  );

  copySkillBundle(DSH_BUNDLE_DIR);
  copyRuntime(DSH_BUNDLE_DIR);
}

/** 生成面向非专业程序员的双击安装器（Mac .command + Windows .bat） */
function buildInstallers() {
  fs.rmSync(INSTALLERS_DIR, { recursive: true, force: true });
  fs.mkdirSync(INSTALLERS_DIR, { recursive: true });

  const macInstaller = `#!/bin/bash
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
echo "  Biz Design Agent (v${PKG.version}) · macOS 一键安装向导"
echo "============================================================"
echo ""

# 1. 检测可用 Node >= 18（含便携版 Node）
FOUND_NODE=""
PORTABLE_REC=""
if [ -f "$HOME/.biz-design-agent/runtime/node-path.txt" ]; then
  PORTABLE_REC="$(tr -d '\\r\\n' < "$HOME/.biz-design-agent/runtime/node-path.txt" 2>/dev/null || true)"
fi
for cand in \\
  "$PORTABLE_REC" \\
  "$HOME/.biz-design-agent/runtime/node/bin/node" \\
  "$(command -v node 2>/dev/null || true)" \\
  /opt/homebrew/bin/node \\
  /usr/local/bin/node \\
  "$HOME/.volta/bin/node" \\
  "$HOME/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node" \\
  "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node" \\
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
  TARGET_FIGMA_DIR="\${USER_FIGMA_DIR:-$DEFAULT_FIGMA_DIR}"
  TARGET_FIGMA_DIR="\${TARGET_FIGMA_DIR/#\\~/$HOME}"
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
`;

  const winInstaller = `@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
if exist "%SCRIPT_DIR%..\\harness-plugin\\.claude-plugin\\plugin.json" (
  for %%I in ("%SCRIPT_DIR%..\\harness-plugin") do set "PLUGIN_SRC=%%~fI"
  for %%I in ("%SCRIPT_DIR%..\\dsh-bundle") do set "DSH_SRC=%%~fI"
) else if exist "%SCRIPT_DIR%harness-plugin\\.claude-plugin\\plugin.json" (
  set "PLUGIN_SRC=%SCRIPT_DIR%harness-plugin"
  set "DSH_SRC=%SCRIPT_DIR%dsh-bundle"
) else (
  echo [ERROR] 未找到 harness-plugin 目录，请完整解压安装包后再双击运行。
  pause
  exit /b 1
)

set "FIGMA_SRC=%PLUGIN_SRC%\\runtime\\plugin"
set "DEFAULT_FIGMA_DIR=%USERPROFILE%\\Documents\\BizDesignAgent-FigmaPlugin"

echo ============================================================
echo   Biz Design Agent (v${PKG.version}) - Windows 一键安装向导
echo ============================================================
echo.

if exist "%USERPROFILE%\\.biz-design-agent\\runtime\\node\\node.exe" (
  for /f "delims=" %%v in ('"%USERPROFILE%\\.biz-design-agent\\runtime\\node\\node.exe" -v') do echo [OK] 已检测到便携版 Node.js: %%v
) else (
  where node >nul 2>nul
  if !ERRORLEVEL!==0 (
    for /f "delims=" %%v in ('node -v') do echo [OK] 已检测到 Node.js: %%v
  ) else (
    echo [WARN] 未检测到 Node.js，请确保已安装 Node ^>= 18（若仅使用 DeepSeek Harness 桌面端可跳过）。
  )
)
echo.

if exist "%USERPROFILE%\\.gemini" (
  echo [INFO] 正在安装到 Antigravity (%USERPROFILE%\\.gemini\\config\\plugins\\biz-design-agent)...
  if not exist "%USERPROFILE%\\.gemini\\config\\plugins" mkdir "%USERPROFILE%\\.gemini\\config\\plugins"
  if exist "%USERPROFILE%\\.gemini\\config\\plugins\\biz-design-agent" rmdir /s /q "%USERPROFILE%\\.gemini\\config\\plugins\\biz-design-agent"
  xcopy /E /I /Y /Q "%PLUGIN_SRC%" "%USERPROFILE%\\.gemini\\config\\plugins\\biz-design-agent" >nul
  > "%USERPROFILE%\\.gemini\\config\\plugins\\biz-design-agent\\mcp_config.json" (
    echo {
    echo   "mcpServers": {
    echo     "biz-design-agent": {
    echo       "command": "cmd.exe",
    echo       "args": ["/c", "\${PLUGIN_ROOT}\\scripts\\run-mcp.cmd"]
    echo     }
    echo   }
    echo }
  )
  echo [OK] Antigravity 插件安装完成（已自动适配 Windows 启动器）
)

if exist "%USERPROFILE%\\.claude" (
  echo [INFO] 正在安装到 Claude Code (%USERPROFILE%\\.claude\\skills\\biz-design-agent)...
  if not exist "%USERPROFILE%\\.claude\\skills" mkdir "%USERPROFILE%\\.claude\\skills"
  if exist "%USERPROFILE%\\.claude\\skills\\biz-design-agent" rmdir /s /q "%USERPROFILE%\\.claude\\skills\\biz-design-agent"
  xcopy /E /I /Y /Q "%PLUGIN_SRC%" "%USERPROFILE%\\.claude\\skills\\biz-design-agent" >nul
  echo [OK] Claude Code 插件安装完成（新开会话自动生效）
)

if exist "%USERPROFILE%\\.cursor" (
  echo [INFO] 正在安装到 Cursor (%USERPROFILE%\\.cursor\\plugins\\biz-design-agent)...
  if not exist "%USERPROFILE%\\.cursor\\plugins" mkdir "%USERPROFILE%\\.cursor\\plugins"
  if exist "%USERPROFILE%\\.cursor\\plugins\\biz-design-agent" rmdir /s /q "%USERPROFILE%\\.cursor\\plugins\\biz-design-agent"
  xcopy /E /I /Y /Q "%PLUGIN_SRC%" "%USERPROFILE%\\.cursor\\plugins\\biz-design-agent" >nul
  echo [OK] Cursor 插件目录已就绪
)

if exist "%USERPROFILE%\\.dsh" (
  echo.
  echo [INFO] 检测到 DeepSeek Harness！
  echo        请在左侧点击「Plugins -^> Add plugin」，粘贴以下目录回车即可启用：
  echo        %DSH_SRC%
)

echo.
echo ------------------------------------------------------------
echo 第二步：复制 Figma 桌面端桥接插件（全局仅需导入一次）
echo 默认可见目录：%DEFAULT_FIGMA_DIR%
set "USER_FIGMA_DIR="
set /p "USER_FIGMA_DIR=直接按回车使用默认目录，或输入自定义路径（输入 skip 跳过）: "

if /i not "%USER_FIGMA_DIR%"=="skip" (
  if "%USER_FIGMA_DIR%"=="" (
    set "TARGET_FIGMA_DIR=%DEFAULT_FIGMA_DIR%"
  ) else (
    set "TARGET_FIGMA_DIR=%USER_FIGMA_DIR%"
  )
  if not exist "!TARGET_FIGMA_DIR!" mkdir "!TARGET_FIGMA_DIR!"
  copy /Y "%FIGMA_SRC%\\manifest.json" "!TARGET_FIGMA_DIR!\\" >nul
  copy /Y "%FIGMA_SRC%\\code.js" "!TARGET_FIGMA_DIR!\\" >nul
  copy /Y "%FIGMA_SRC%\\ui.html" "!TARGET_FIGMA_DIR!\\" >nul
  echo [OK] Figma 插件已复制到：!TARGET_FIGMA_DIR!
  explorer /select,"!TARGET_FIGMA_DIR!\\manifest.json"
  echo.
  echo 接下来请在 Figma Desktop 中完成 3 步：
  echo   1. 打开任意设计稿
  echo   2. 菜单：Plugins -^> Development -^> Import plugin from manifest...
  echo   3. 选中刚高亮的 manifest.json，然后运行 Biz Design Agent 插件即可！
)

echo.
echo 全部完成！重启或新开 AI 客户端后，发送「打开 biz-design-agent 主菜单」即可使用。
pause
`;

  writeFile(path.join(INSTALLERS_DIR, 'Install-Mac.command'), macInstaller, 0o755);
  writeFile(path.join(INSTALLERS_DIR, 'Install-Windows.bat'), winInstaller);
}

export function buildAllPlugins() {
  buildHarnessPlugin();
  buildDshBundle();
  buildInstallers();
  return {
    version: PKG.version,
    harnessPluginDir: HARNESS_PLUGIN_DIR,
    dshBundleDir: DSH_BUNDLE_DIR,
    installersDir: INSTALLERS_DIR,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const res = buildAllPlugins();
  console.log(`已构建多 Harness 插件产物（v${res.version}）：`);
  console.log(`  通用插件包：${path.relative(ROOT, res.harnessPluginDir)}`);
  console.log(`  DSH 插件包：${path.relative(ROOT, res.dshBundleDir)}`);
  console.log(`  一键安装器：${path.relative(ROOT, res.installersDir)}`);
}
