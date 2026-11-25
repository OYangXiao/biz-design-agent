#!/usr/bin/env node
// 零第三方依赖内网分发服务：托管动态 /bootstrap.md、引导首页、版本元数据及离线 .tgz 包下载
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeZip } from '../src/zip.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
export const DEFAULT_PORTABLE_NODE_DIR = path.join(ROOT, 'portable-node');
export const DEFAULT_NODE_LTS_VERSION = '26.13.1';

const PORTABLE_ARCHIVE_RE = /^node-v(\d+)\.(\d+)\.(\d+)-(darwin-arm64|darwin-x64|win-x64|win-arm64|linux-x64|linux-arm64)\.(tar\.gz|zip)$/i;
const PORTABLE_ALIAS_RE = /^(darwin-arm64|darwin-x64|win-x64|win-arm64|linux-x64|linux-arm64)\.(tar\.gz|zip)$/i;

export function listPortableNodeFiles(dir = DEFAULT_PORTABLE_NODE_DIR) {
  if (!dir || !fs.existsSync(dir)) return [];
  const items = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const m = PORTABLE_ARCHIVE_RE.exec(entry.name);
    if (!m) continue;
    const fullPath = path.join(dir, entry.name);
    const st = fs.statSync(fullPath);
    items.push({
      file: entry.name,
      version: `v${m[1]}.${m[2]}.${m[3]}`,
      major: Number(m[1]),
      minor: Number(m[2]),
      patch: Number(m[3]),
      target: m[4].toLowerCase(),
      ext: m[5].toLowerCase(),
      alias: `${m[4].toLowerCase()}.${m[5].toLowerCase()}`,
      size: st.size,
    });
  }
  items.sort((a, b) => (b.major - a.major) || (b.minor - a.minor) || (b.patch - a.patch));
  return items;
}

export function resolvePortableNodeFile(dir, requestedName) {
  if (!dir || !fs.existsSync(dir)) return null;
  const base = path.basename(String(requestedName || ''));
  if (!base || base === '.' || base === '..') return null;

  const exact = path.join(dir, base);
  if (fs.existsSync(exact) && fs.statSync(exact).isFile()) {
    return { fullPath: exact, downloadName: base };
  }

  const aliasMatch = PORTABLE_ALIAS_RE.exec(base);
  if (!aliasMatch) return null;
  const target = aliasMatch[1].toLowerCase();
  const ext = aliasMatch[2].toLowerCase();
  const matched = listPortableNodeFiles(dir).find((item) => item.target === target && item.ext === ext);
  if (!matched) return null;
  return { fullPath: path.join(dir, matched.file), downloadName: matched.file };
}

export function renderBootstrapMarkdown({
  baseUrl,
  packageName = PKG.name || 'biz-design-agent',
  version = PKG.version || '1.0.0',
  npmRegistry = '',
  npmScope = '',
  nodeMirror = '',
  nodeLtsVersion = DEFAULT_NODE_LTS_VERSION,
} = {}) {
  const registryConfigured = Boolean(npmRegistry && !npmRegistry.includes('<待填'));
  const registryDisplay = registryConfigured ? npmRegistry : '<待配置内网 npm registry 地址>';
  const registryCmd = npmScope
    ? `"$NPM_BIN" config set "${npmScope}:registry" "${registryDisplay}"`
    : `"$NPM_BIN" config set registry "${registryDisplay}"`;

  const installCmd = registryConfigured
    ? `"$NPM_BIN" install -g "${packageName}" --registry="${registryDisplay}"`
    : `"$NPM_BIN" install -g "${baseUrl}/packages/biz-design-agent.tgz"`;

  const fallbackBase = (nodeMirror || 'https://nodejs.org/dist').replace(/\/+$/, '');

  return `# biz-design-agent 内网自动化配置与就绪引导（v${version}）

> **给 AI 助手的执行指令**：你正在协助用户在当前工作区完成 \`biz-design-agent\` 的全自动环境检测、安装与 Figma 画布连通性验收。
> 请严格按 **Step 1 → Step 5** 顺序执行：**每一步必须先真实检测，不通过时给出明确选项或修复操作，并允许用户在对话中反复回复「继续 / 复测」直到该步通过**；严禁跳过校验谎报就绪。

- 分发服务地址：\`${baseUrl}\`
- 便携版 Node 下载入口：\`${baseUrl}/portable-node/index.json\`
- 目标包名：\`${packageName}\`（版本 \`v${version}\`）
- 内网 npm registry：\`${registryDisplay}\`

---

## Step 1：检测 Node.js（要求 >= 18），无可用环境时自动下载便携版 Node

### 1.1 先深度扫描本机已有 Node（优先含已记录的便携版 Node，避免 GUI 客户端丢失 Shell PATH 导致误报）
请在本机终端执行探测（macOS/Linux 用 zsh/bash，Windows 用 PowerShell）：

\`\`\`bash
# macOS / Linux：扫描便携版 Node、PATH、Homebrew、Volta 及 ~/.nvm 下全部 node，选最高 >= 18 版本
PORTABLE_REC="$(cat "$HOME/.biz-design-agent/runtime/node-path.txt" 2>/dev/null || true)"
for cand in "$PORTABLE_REC" "$HOME/.biz-design-agent/runtime/node/bin/node" "$(command -v node 2>/dev/null || true)" /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.volta/bin/node" "$HOME/.nvm/versions/node"/*/bin/node; do
  [ -x "$cand" ] && echo "$cand => $("$cand" -v 2>/dev/null)"
done
\`\`\`

\`\`\`powershell
# Windows PowerShell：扫描便携版 Node、PATH、Program Files 与 nvm-windows
$PortableRec = if (Test-Path "$HOME\\.biz-design-agent\\runtime\\node-path.txt") { (Get-Content "$HOME\\.biz-design-agent\\runtime\\node-path.txt" -Raw).Trim() } else { $null }
foreach ($cand in @($PortableRec, "$HOME\\.biz-design-agent\\runtime\\node\\node.exe", (Get-Command node -ErrorAction SilentlyContinue).Source, "$env:NVM_SYMLINK\\node.exe", "C:\\Program Files\\nodejs\\node.exe")) {
  if ($cand -and (Test-Path $cand)) { Write-Output "$cand => $(& $cand -v)" }
}
\`\`\`

- **若已找到 \`>= 18\` 的 \`node\`**：记录其绝对路径为 \`NODE_BIN\`（以及同目录下的 \`NPM_BIN\`），**无需重装**，直接进入 Step 2。
- **若未找到或版本 \`< 18\`**：向用户展示以下两个选项，由用户选择后再执行：
  1. **选项 A（推荐，免装 nvm、免管理员权限）**：由 AI 通过命令行直接从分发服务 \`${baseUrl}/portable-node/\` 下载官方便携版 Node.js LTS 并解压到 \`~/.biz-design-agent/runtime/node\`（终端下载不带浏览器隔离标记，可避免 macOS Gatekeeper 拦截），同时记录路径到本地并全程使用该便携版 Node。
  2. **选项 B**：用户自行安装官方 Node.js LTS 安装包（macOS \`.pkg\` / Windows \`.msi\`），装完后回复「继续」由 AI 复测。

### 1.2 当用户选择「选项 A：自动下载便携版 Node」时执行

- **macOS / Linux**：
  \`\`\`bash
  RUNTIME_DIR="$HOME/.biz-design-agent/runtime"
  NODE_DIR="$RUNTIME_DIR/node"
  mkdir -p "$RUNTIME_DIR"
  OS_TAG="$(uname -s | tr '[:upper:]' '[:lower:]')"
  RAW_ARCH="$(uname -m)"
  case "$RAW_ARCH" in
    arm64|aarch64) ARCH_TAG="arm64" ;;
    x86_64|amd64)  ARCH_TAG="x64" ;;
    *) echo "不支持的架构：$RAW_ARCH" >&2; exit 1 ;;
  esac
  ARCHIVE="$RUNTIME_DIR/node-portable.tar.gz"
  PORTABLE_URL="${baseUrl}/portable-node/\${OS_TAG}-\${ARCH_TAG}.tar.gz"
  FALLBACK_URL="${fallbackBase}/v${nodeLtsVersion}/node-v${nodeLtsVersion}-\${OS_TAG}-\${ARCH_TAG}.tar.gz"
  curl -fsSL "$PORTABLE_URL" -o "$ARCHIVE" || curl -fsSL "$FALLBACK_URL" -o "$ARCHIVE"
  rm -rf "$NODE_DIR" && mkdir -p "$NODE_DIR"
  tar -xzf "$ARCHIVE" -C "$NODE_DIR" --strip-components=1
  rm -f "$ARCHIVE"
  NODE_BIN="$NODE_DIR/bin/node"
  NPM_BIN="$NODE_DIR/bin/npm"
  printf '%s\\n' "$NODE_BIN" > "$RUNTIME_DIR/node-path.txt"
  echo "已就绪便携版 Node，本地路径已记录到 $RUNTIME_DIR/node-path.txt："
  echo "NODE_BIN=$NODE_BIN ($("$NODE_BIN" -v))"
  \`\`\`

- **Windows PowerShell**：
  \`\`\`powershell
  $RuntimeDir = Join-Path $HOME ".biz-design-agent\\runtime"
  $NodeDir = Join-Path $RuntimeDir "node"
  New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
  $Archive = Join-Path $RuntimeDir "node-portable.zip"
  $PortableUrl = "${baseUrl}/portable-node/win-x64.zip"
  $FallbackUrl = "${fallbackBase}/v${nodeLtsVersion}/node-v${nodeLtsVersion}-win-x64.zip"
  try { Invoke-WebRequest -Uri $PortableUrl -OutFile $Archive } catch { Invoke-WebRequest -Uri $FallbackUrl -OutFile $Archive }
  $TmpExtract = Join-Path $RuntimeDir "tmp-extract"
  if (Test-Path $TmpExtract) { Remove-Item -Recurse -Force $TmpExtract }
  Expand-Archive -Path $Archive -DestinationPath $TmpExtract -Force
  $InnerDir = Get-ChildItem -Path $TmpExtract -Directory | Select-Object -First 1
  if (Test-Path $NodeDir) { Remove-Item -Recurse -Force $NodeDir }
  Move-Item -Path $InnerDir.FullName -Destination $NodeDir
  Remove-Item -Recurse -Force $TmpExtract, $Archive
  $NODE_BIN = Join-Path $NodeDir "node.exe"
  $NPM_BIN = Join-Path $NodeDir "npm.cmd"
  Set-Content -Path (Join-Path $RuntimeDir "node-path.txt") -Value $NODE_BIN -Encoding UTF8
  Write-Output "已就绪便携版 Node，本地路径已记录到 $RuntimeDir\\node-path.txt："
  Write-Output "NODE_BIN=$NODE_BIN ($(& $NODE_BIN -v))"
  \`\`\`

  下载完成后，请明确告知用户：*“已将便携版 Node 下载到 \`~/.biz-design-agent/runtime/node\` 并记录在本地，后续安装与 MCP 运行都会自动使用该便携版 Node，无需额外安装系统环境。”*

---

## Step 2：配置内网 npm registry 并验证连通性

${registryConfigured ? `1. 使用 Step 1 锁定的 \`NPM_BIN\` 写入内网源（不破坏用户其他无关凭证）：
\`\`\`bash
${registryCmd}
"$NPM_BIN" ping --registry="${registryDisplay}"
\`\`\`
2. 若报证书错误（\`UNABLE_TO_GET_ISSUER_CERT_LOCALLY\`）、认证错误（\`401/403\`）或超时，向用户说明具体原因并引导配置内网 CA / 登录凭证，回复「继续」后复测，直至通过。` : `1. 当前分发服务尚未绑定正式内网 npm registry（可在服务端启动时传入 \`FIGMA_AGENT_REGISTRY=http://<内网源>\`）。
2. 如用户此刻提供了内网 registry 地址，先执行 \`"$NPM_BIN" config set registry <用户提供的地址>\` 并 \`npm ping\` 验证；若暂未提供，Step 3 可直接从本分发服务 \`${baseUrl}/packages/biz-design-agent.tgz\` 安装离线包。`}

---

## Step 3：安装 \`biz-design-agent\` 与飞书 CLI（\`@larksuite/cli\`），并自动配置当前 Harness

1. 安装纯 Node 版 \`biz-design-agent\`（零 Python 依赖、零原生 C++ 编译）：
\`\`\`bash
${installCmd}
\`\`\`
2. 安装飞书官方 CLI（用于将 PRD 同步到飞书云文档或从飞书读取需求文档，参考 [飞书 CLI 官方文档](https://open.feishu.cn/document/mcp_open_tools/feishu-cli-let-ai-actually-do-your-work-in-feishu)）：
\`\`\`bash
PATH="$(dirname "$NODE_BIN"):$PATH" "$NPM_BIN" install -g @larksuite/cli
\`\`\`
（若内网 registry 尚未同步 \`@larksuite/cli\`，可提示用户先切公共源安装或暂时跳过、后续再装。）
3. 结合你当前运行的 AI 客户端身份，执行 \`setup\` 自动生成对应 Harness（Antigravity / Claude Code / Cursor / Trae / Windsurf / 通用）的原生 MCP（绑定绝对路径 \`NODE_BIN\`，避免 GUI 客户端丢 PATH）、工作区 Skills 与 \`AGENTS.md\`，同时把 Figma 插件解出到用户可见目录 \`~/Documents/BizDesignAgent-FigmaPlugin/\`（也可传入 \`--plugin-dir <自定义目录>\`）：
\`\`\`bash
FIGMA_AGENT_BIN="$(dirname "$NODE_BIN")/biz-design-agent"
"$NODE_BIN" "$FIGMA_AGENT_BIN" setup --workspace "$(pwd)" --harness auto --node "$NODE_BIN"
\`\`\`
（若自动识别结果为 \`generic\` 且你明确知道当前客户端类型，请传入具体 \`--harness antigravity|claude-code|cursor|trae|windsurf\`。）

---

## Step 4：检查飞书 CLI 初始化授权 + 启动共享 Figma Bridge 并完成插件握手

1. 执行完整体检（同时探测 \`feishu\`、\`bridge.reachable\` 与 \`bridge.pluginOnline\`）：
\`\`\`bash
"$NODE_BIN" "$FIGMA_AGENT_BIN" doctor --json
\`\`\`
2. **飞书 CLI 登录授权引导（检查 \`feishu.installed\` 与 \`feishu.authenticated\`）**：
   - 若 \`feishu.installed\` 为 true 但 \`feishu.authenticated\` 为 false，**直接由 AI 执行 \`lark-cli auth login\`**（或在需要交互时自动弹出终端窗口运行，无需用户自己找终端）：
     - **直接执行（优先，会自动输出/拉起浏览器授权链接）**：
       \`\`\`bash
       PATH="$(dirname "$NODE_BIN"):$PATH" lark-cli auth login
       \`\`\`
       *(仅当提示尚未绑定应用配置时，再执行 \`lark-cli config init --new\` 在浏览器一键建应用并重试 \`lark-cli auth login\`。)*
     - **macOS 自动打开 Terminal 运行（若需独立终端交互）**：
       \`\`\`bash
       osascript -e 'tell application "Terminal" to do script "export PATH=\\"'$(dirname "$NODE_BIN")':$PATH\\"; lark-cli auth login && lark-cli auth status"' -e 'tell application "Terminal" to activate'
       \`\`\`
     - **Windows 自动打开 PowerShell 运行**：
       \`\`\`powershell
       Start-Process powershell -ArgumentList '-NoExit','-Command','lark-cli auth login; lark-cli auth status'
       \`\`\`
   - 引导用户在打开的浏览器页面点「确认授权」（官方文档：\`https://open.feishu.cn/document/mcp_open_tools/feishu-cli-let-ai-actually-do-your-work-in-feishu\`）。
   - 提示用户：*“在浏览器确认授权后回复『继续』，我立刻复测登录状态；如果本次暂不需要同步飞书文档，也可以回复『跳过飞书』继续。”*
3. **Figma Bridge 与桌面端插件握手（检查 \`bridge.reachable\` 与 \`bridge.pluginOnline\`）**：
   - **若 \`bridge.reachable\` 为 false**：运行 \`"$NODE_BIN" "$FIGMA_AGENT_BIN" bridge-ensure\` 拉起后台共享桥后复测。
   - **若 \`bridge.pluginOnline\` 为 false**：
     1. 提示用户：本地免费账号读写画布依赖 **Figma Desktop 桌面客户端**加载插件（默认位于用户可见目录 \`~/Documents/BizDesignAgent-FigmaPlugin/manifest.json\`，全局只需导入一次；如需放其他目录可调用 \`figma_install_plugin\` 指定）。
     2. 自动帮用户在系统文件管理器高亮插件目录（macOS：\`open -R "$HOME/Documents/BizDesignAgent-FigmaPlugin/manifest.json"\`；Windows：\`explorer /select,"%USERPROFILE%\\Documents\\BizDesignAgent-FigmaPlugin\\manifest.json"\`）。
     3. 给出 3 步指引：在 Figma Desktop 打开任意设计稿 → 顶部菜单 \`Plugins → Development → Import plugin from manifest...\` 选中该 \`manifest.json\` → 运行 \`Biz Design Agent\` 看到面板显示已连接。
     4. 提示用户：**“在 Figma 点开插件后回复『好了』，我立刻做真机握手验证。”**
   - 用户回复后，执行真机往返验证：
     \`\`\`bash
     "$NODE_BIN" "$FIGMA_AGENT_BIN" ping
     \`\`\`
   - 重复确认直到 \`ping\` 返回当前打开的 Figma 文件名与页面列表。

---

## Step 5：完全就绪，转入业务角色入口

全部检查项均通过后，向用户汇报简明就绪清单（Node 版本、npm 源、飞书 CLI 授权状态、已配置的 Harness、已连接的 Figma 文件名；如首次写入 MCP 配置则顺便提醒“重载一次窗口即可原生调用 MCP，当前会话也已可直接开工”），并立刻发起业务入口提问：

> “✅ \`biz-design-agent\` 环境、飞书文档能力与 Figma 画布桥已全部准备就绪！
> 这次想进入哪个工作模式？
> 1. 业务设计 · 开发或更新 PRD（Figma 单页 + Word + 飞书文档同步）
> 2. 业务设计 · 生成可操作预览原型图（点击跳转 + PRD 说明卡）
> 3. 美工 / UI · 制作高保真视觉稿
> 4. 前端 / 研发 · 提取视觉规格联调与提测
> 5. 测试 & 美工走查 · 页面功能验收与视觉还原对图”
`;
}

export function renderIndexHtml(baseUrl) {
  const promptText = `请用 curl 读取 ${baseUrl}/bootstrap.md 并按步骤帮我检测环境、配置并连接 biz-design-agent`;
  const dshTgzUrl = `${baseUrl}/packages/dsh-biz-design-agent.tgz`;
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>biz-design-agent 插件与内网安装中心</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#f4f6fa;color:#0f172a;font:15px/1.65 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;padding:36px 20px}
main{max-width:860px;margin:auto;background:#fff;border:1px solid #e2e8f0;border-radius:18px;padding:32px;box-shadow:0 8px 28px rgba(15,23,42,.05)}
h1{margin:0 0 6px;font-size:26px;letter-spacing:-.01em}
.badge{display:inline-block;background:#eff6ff;color:#1d4ed8;font-size:12px;font-weight:600;padding:2px 10px;border-radius:999px;vertical-align:middle;margin-left:8px}
p.sub{margin:0 0 24px;color:#475569}
.hero{background:linear-gradient(135deg,#1d4ed8,#2563eb);color:#fff;border-radius:14px;padding:22px 24px;margin-bottom:24px}
.hero h2{margin:0 0 6px;font-size:18px}
.hero p{margin:0 0 16px;font-size:14px;opacity:.92}
.btn-row{display:flex;gap:12px;flex-wrap:wrap;align-items:center}
.btn{display:inline-block;text-decoration:none;background:#1d4ed8;color:#fff;border:none;border-radius:9px;padding:10px 18px;font-size:14px;font-weight:600;cursor:pointer}
.btn-white{background:#fff;color:#1d4ed8}
.btn-ghost{background:rgba(255,255,255,.16);color:#fff;border:1px solid rgba(255,255,255,.35)}
.tabs{display:flex;gap:8px;flex-wrap:wrap;border-bottom:1px solid #e2e8f0;padding-bottom:10px;margin:22px 0 16px}
.tab{background:#f1f5f9;color:#334155;border:none;border-radius:8px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer}
.tab.active{background:#0f172a;color:#fff}
.panel{display:none;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:18px 20px}
.panel.active{display:block}
.box{background:#0f172a;color:#f8fafc;border-radius:9px;padding:13px 15px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;word-break:break-all;margin:10px 0}
.card{margin-top:22px;border:1px solid #e2e8f0;border-radius:12px;padding:18px 20px;background:#fff}
.card h3{margin:0 0 8px;font-size:16px}
ol{margin:8px 0 0;padding-left:20px;color:#334155}
.links{margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;display:flex;gap:16px;flex-wrap:wrap;font-size:13px}
a{color:#1d4ed8}
.tip{font-size:13px;color:#64748b;margin-top:8px}
</style></head><body><main>
<h1>biz-design-agent 插件安装中心 <span class="badge">v${PKG.version}</span></h1>
<p class="sub">面向业务设计、产品经理、UI 设计师、前端研发与 QA 的零门槛安装门户。全程无需手工改 JSON，支持 macOS（主力）与 Windows。</p>

<section class="hero">
  <h2>推荐给非程序员：下载一键安装包（Mac / Windows 通用）</h2>
  <p>解压后双击 <strong>Install-Mac.command</strong>（macOS）或 <strong>Install-Windows.bat</strong>（Windows），自动识别并安装到本机已装 AI 客户端，并把 Figma 插件复制到可见的「文稿」目录并自动高亮。</p>
  <div class="btn-row">
    <a class="btn btn-white" href="/downloads/biz-design-agent-installer.zip">下载一键安装包 (.zip)</a>
  </div>
</section>

<div class="tabs" role="tablist">
  <button class="tab active" onclick="showTab('dsh',this)">DeepSeek Harness（免装 Node）</button>
  <button class="tab" onclick="showTab('agy',this)">Antigravity / Gemini App</button>
  <button class="tab" onclick="showTab('claude',this)">Claude Code / Cowork</button>
  <button class="tab" onclick="showTab('ai',this)">Cursor / 其它（AI 一句话装）</button>
</div>

<div id="panel-dsh" class="panel active">
  <strong>DeepSeek Harness 图形化直装（无需安装 Node.js）</strong>
  <ol>
    <li>打开 <strong>DeepSeek Harness</strong> 桌面端，点击左侧 <strong>Plugins → Add plugin</strong>。</li>
    <li>粘贴下方插件包地址并回车，安装完成后点 <strong>Enable now</strong> 即可：</li>
  </ol>
  <div class="box" id="dsh-url">${dshTgzUrl}</div>
  <button class="btn" onclick="copyText('dsh-url',this)">复制 DSH 插件包地址</button>
</div>

<div id="panel-agy" class="panel">
  <strong>Antigravity / Gemini App 安装方式</strong>
  <ol>
    <li>点击上方「下载一键安装包」，解压后双击 <code>Install-Mac.command</code>（首次若提示未验证开发者，右键点「打开」即可）。</li>
    <li>安装完成后，在 Gemini App 左侧 <strong>Customizations → Installed</strong> 中即可看到 <strong>Biz Design Agent</strong> 及其 3 个快捷启动气泡。</li>
  </ol>
</div>

<div id="panel-claude" class="panel">
  <strong>Claude Code / Claude Desktop Cowork 安装方式</strong>
  <ol>
    <li><strong>零配置全局生效</strong>：运行上方「一键安装包」自动写入 <code>~/.claude/skills/biz-design-agent/</code>，无需配置任何 Marketplace，新开会话即自动加载。</li>
    <li><strong>Claude Desktop (Cowork)</strong>：如需单独导入，可下载 <a href="/downloads/biz-design-agent-plugin.zip">纯插件包 (.zip)</a> 直接导入。</li>
  </ol>
</div>

<div id="panel-ai" class="panel">
  <strong>把下面这句话粘贴给任意 AI 客户端（自动体检并接入）</strong>
  <div class="box" id="cmd">${promptText}</div>
  <button class="btn" onclick="copyText('cmd',this)">复制给 AI 的引导口令</button>
</div>

<section class="card">
  <h3>第二步（如需操作 Figma 画布，全局仅需导入一次）</h3>
  <ol>
    <li>运行安装向导（或在 AI 对话里说「帮我安装 Figma 插件」），插件会复制到你电脑的 <code>Documents/BizDesignAgent-FigmaPlugin/manifest.json</code> 并自动打开文件夹高亮。</li>
    <li>打开 <strong>Figma Desktop 桌面版</strong> 和任意设计稿，点顶部菜单 <code>Plugins → Development → Import plugin from manifest...</code>，选中刚才高亮的 <code>manifest.json</code>。</li>
    <li>运行 <strong>Biz Design Agent</strong>，面板显示「已连接」即可在 AI 中直接画 PRD、原型与高保真稿。</li>
  </ol>
  <p class="tip">注：仅生成 Word PRD、提取规格或执行 QA 浏览器验收时，不需要连接 Figma。</p>
</section>

<div class="links">
  <a href="/bootstrap.md">查看原始 bootstrap.md</a>
  <a href="/portable-node/index.json">便携版 Node 下载清单</a>
  <a href="/api/config.json">查看服务配置 JSON</a>
  <a href="/packages/dsh-biz-design-agent.tgz">下载 DSH Bundle (.tgz)</a>
  <a href="/health">健康检查</a>
</div>
</main>
<script>
function showTab(id, btn){
  document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('panel-'+id).classList.add('active');
}
function copyText(id, btn){
  var txt = document.getElementById(id).textContent;
  navigator.clipboard.writeText(txt).then(function(){
    var old = btn.textContent;
    btn.textContent = '已复制，直接粘贴即可';
    setTimeout(function(){ btn.textContent = old; }, 2200);
  });
}
</script>
</body></html>`;
}

let cachedTarballPath = null;
let cachedDshTarballPath = null;

function packNpmDir(cwd) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-design-agent-pack-'));
  const binDir = path.dirname(process.execPath);
  const npmBin = path.join(binDir, process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const env = { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}` };
  const out = execFileSync(npmBin, ['pack', '--pack-destination', tmpDir], { cwd, encoding: 'utf8', env }).trim();
  const fname = out.split(/\r?\n/).pop().trim();
  return path.join(tmpDir, fname);
}

function ensureTarball() {
  if (cachedTarballPath && fs.existsSync(cachedTarballPath)) return cachedTarballPath;
  cachedTarballPath = packNpmDir(ROOT);
  return cachedTarballPath;
}

function ensureDshTarball() {
  if (cachedDshTarballPath && fs.existsSync(cachedDshTarballPath)) return cachedDshTarballPath;
  const dshDir = path.join(ROOT, 'dist', 'dsh-bundle');
  if (!fs.existsSync(path.join(dshDir, 'package.json'))) {
    throw new Error('缺少 dist/dsh-bundle 产物，请先运行 npm run build:plugins');
  }
  cachedDshTarballPath = packNpmDir(dshDir);
  return cachedDshTarballPath;
}

function collectZipEntries(srcDir, prefix = '', out = []) {
  if (!fs.existsSync(srcDir)) return out;
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (['.DS_Store', 'node_modules'].includes(entry.name)) continue;
    const full = path.join(srcDir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      collectZipEntries(full, rel, out);
    } else if (entry.isFile()) {
      const st = fs.statSync(full);
      const isExec = (st.mode & 0o111) !== 0 || rel.endsWith('.command') || rel.endsWith('/run-mcp');
      out.push({
        name: rel,
        data: fs.readFileSync(full),
        mode: isExec ? 0o755 : 0o644,
      });
    }
  }
  return out;
}

function buildInstallerZipBuffer() {
  const entries = [];
  const installersDir = path.join(ROOT, 'dist', 'installers');
  const harnessDir = path.join(ROOT, 'dist', 'harness-plugin');
  const dshDir = path.join(ROOT, 'dist', 'dsh-bundle');
  if (!fs.existsSync(harnessDir)) {
    throw new Error('缺少 dist/harness-plugin 产物，请先运行 npm run build:plugins');
  }
  collectZipEntries(installersDir, 'BizDesignAgent-Installer', entries);
  collectZipEntries(harnessDir, 'BizDesignAgent-Installer/harness-plugin', entries);
  if (fs.existsSync(dshDir)) {
    collectZipEntries(dshDir, 'BizDesignAgent-Installer/dsh-bundle', entries);
  }
  return writeZip(entries);
}

function buildHarnessPluginZipBuffer() {
  const harnessDir = path.join(ROOT, 'dist', 'harness-plugin');
  if (!fs.existsSync(harnessDir)) {
    throw new Error('缺少 dist/harness-plugin 产物，请先运行 npm run build:plugins');
  }
  return writeZip(collectZipEntries(harnessDir, ''));
}

function buildFigmaPluginZipBuffer() {
  const pluginDir = path.join(ROOT, 'plugin');
  const entries = [];
  for (const fname of ['manifest.json', 'code.js', 'ui.html']) {
    const full = path.join(pluginDir, fname);
    if (fs.existsSync(full)) {
      entries.push({ name: `BizDesignAgent-FigmaPlugin/${fname}`, data: fs.readFileSync(full), mode: 0o644 });
    }
  }
  return writeZip(entries);
}

export function createDistServer(options = {}) {
  const npmRegistry = options.npmRegistry ?? process.env.FIGMA_AGENT_REGISTRY ?? '';
  const npmScope = options.npmScope ?? process.env.FIGMA_AGENT_SCOPE ?? '';
  const nodeMirror = options.nodeMirror ?? process.env.FIGMA_AGENT_NODE_MIRROR ?? '';
  const downloadsDir = options.downloadsDir ?? process.env.FIGMA_AGENT_DOWNLOADS_DIR ?? null;
  const portableNodeDir = options.portableNodeDir
    ? path.resolve(options.portableNodeDir)
    : (process.env.BIZ_DESIGN_PORTABLE_NODE_DIR ? path.resolve(process.env.BIZ_DESIGN_PORTABLE_NODE_DIR) : DEFAULT_PORTABLE_NODE_DIR);

  return http.createServer((req, res) => {
    const urlObj = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const baseUrl = options.publicUrl || `http://${req.headers.host || 'localhost'}`;

    if (urlObj.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, name: PKG.name, version: PKG.version }));
      return;
    }

    if (urlObj.pathname === '/api/config.json') {
      const portableFiles = listPortableNodeFiles(portableNodeDir).map((item) => ({
        ...item,
        url: `${baseUrl}/portable-node/${item.file}`,
        aliasUrl: `${baseUrl}/portable-node/${item.alias}`,
      }));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        ok: true,
        packageName: PKG.name,
        version: PKG.version,
        baseUrl,
        npmRegistry: npmRegistry || null,
        npmScope: npmScope || null,
        nodeMirror: nodeMirror || null,
        bootstrapUrl: `${baseUrl}/bootstrap.md`,
        tarballUrl: `${baseUrl}/packages/biz-design-agent.tgz`,
        dshBundleUrl: `${baseUrl}/packages/dsh-biz-design-agent.tgz`,
        installerZipUrl: `${baseUrl}/downloads/biz-design-agent-installer.zip`,
        pluginZipUrl: `${baseUrl}/downloads/biz-design-agent-plugin.zip`,
        figmaPluginZipUrl: `${baseUrl}/downloads/figma-plugin.zip`,
        portableNodeIndexUrl: `${baseUrl}/portable-node/index.json`,
        portableNodeFiles: portableFiles,
      }, null, 2));
      return;
    }

    if (urlObj.pathname === '/portable-node/index.json') {
      const files = listPortableNodeFiles(portableNodeDir).map((item) => ({
        ...item,
        url: `${baseUrl}/portable-node/${item.file}`,
        aliasUrl: `${baseUrl}/portable-node/${item.alias}`,
      }));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        ok: true,
        defaultLtsVersion: DEFAULT_NODE_LTS_VERSION,
        files,
      }, null, 2));
      return;
    }

    if (urlObj.pathname.startsWith('/portable-node/')) {
      const reqName = urlObj.pathname.slice('/portable-node/'.length);
      const resolved = resolvePortableNodeFile(portableNodeDir, reqName);
      if (resolved) {
        const contentType = resolved.downloadName.endsWith('.tar.gz')
          ? 'application/gzip'
          : resolved.downloadName.endsWith('.zip')
            ? 'application/zip'
            : resolved.downloadName.endsWith('.txt')
              ? 'text/plain; charset=utf-8'
              : 'application/octet-stream';
        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="${resolved.downloadName}"`,
        });
        fs.createReadStream(resolved.fullPath).pipe(res);
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        ok: false,
        error: `未找到便携版 Node 文件：${reqName}`,
        hint: '请将对应平台的官方 Node LTS 压缩包放入服务器 portable-node/ 目录（详见 portable-node/README.txt）。',
      }));
      return;
    }

    if (urlObj.pathname === '/bootstrap.md') {
      const md = renderBootstrapMarkdown({ baseUrl, npmRegistry, npmScope, nodeMirror });
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
      res.end(md);
      return;
    }

    if (urlObj.pathname === '/packages/biz-design-agent.tgz') {
      try {
        const tgz = ensureTarball();
        res.writeHead(200, {
          'Content-Type': 'application/gzip',
          'Content-Disposition': `attachment; filename="${path.basename(tgz)}"`,
        });
        fs.createReadStream(tgz).pipe(res);
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
      return;
    }

    if (urlObj.pathname === '/packages/dsh-biz-design-agent.tgz') {
      try {
        const tgz = ensureDshTarball();
        res.writeHead(200, {
          'Content-Type': 'application/gzip',
          'Content-Disposition': `attachment; filename="${path.basename(tgz)}"`,
        });
        fs.createReadStream(tgz).pipe(res);
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
      return;
    }

    if (urlObj.pathname === '/downloads/biz-design-agent-installer.zip') {
      try {
        const buf = buildInstallerZipBuffer();
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="BizDesignAgent-Installer-v${PKG.version}.zip"`,
        });
        res.end(buf);
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
      return;
    }

    if (urlObj.pathname === '/downloads/biz-design-agent-plugin.zip') {
      try {
        const buf = buildHarnessPluginZipBuffer();
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="biz-design-agent-plugin-v${PKG.version}.zip"`,
        });
        res.end(buf);
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
      return;
    }

    if (urlObj.pathname === '/downloads/figma-plugin.zip') {
      try {
        const buf = buildFigmaPluginZipBuffer();
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="BizDesignAgent-FigmaPlugin-v${PKG.version}.zip"`,
        });
        res.end(buf);
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
      return;
    }

    if (downloadsDir && urlObj.pathname.startsWith('/downloads/')) {
      const rel = path.basename(urlObj.pathname);
      const target = path.join(downloadsDir, rel);
      if (fs.existsSync(target) && fs.statSync(target).isFile()) {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        fs.createReadStream(target).pipe(res);
        return;
      }
    }

    if (urlObj.pathname === '/' || urlObj.pathname === '/index.html') {
      if ((req.headers.accept || '').includes('text/markdown')) {
        const md = renderBootstrapMarkdown({ baseUrl, npmRegistry, npmScope, nodeMirror });
        res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
        res.end(md);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderIndexHtml(baseUrl));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: `Not found: ${urlObj.pathname}` }));
  });
}

export function startDistServer(options = {}) {
  const port = Number(options.port ?? process.env.FIGMA_AGENT_DIST_PORT ?? 8790);
  const host = options.host || process.env.FIGMA_AGENT_DIST_HOST || '0.0.0.0';
  const portableNodeDir = options.portableNodeDir
    ? path.resolve(options.portableNodeDir)
    : (process.env.BIZ_DESIGN_PORTABLE_NODE_DIR ? path.resolve(process.env.BIZ_DESIGN_PORTABLE_NODE_DIR) : DEFAULT_PORTABLE_NODE_DIR);
  const server = createDistServer({ ...options, portableNodeDir });
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const addr = server.address();
      resolve({ server, port: addr.port, host, portableNodeDir });
    });
  });
}
