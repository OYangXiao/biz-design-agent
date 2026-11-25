#!/usr/bin/env node
// 零第三方依赖内网分发服务：托管动态 /bootstrap.md、引导首页、版本元数据及离线 .tgz 包下载
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

export function renderBootstrapMarkdown({
  baseUrl,
  packageName = PKG.name || 'fimg-agent-plugin',
  version = PKG.version || '1.0.0',
  npmRegistry = '',
  npmScope = '',
  nvmInstallUrl = 'https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh',
  nodeMirror = '',
} = {}) {
  const registryConfigured = Boolean(npmRegistry && !npmRegistry.includes('<待填'));
  const registryDisplay = registryConfigured ? npmRegistry : '<待配置内网 npm registry 地址>';
  const registryCmd = npmScope
    ? `"$NPM_BIN" config set "${npmScope}:registry" "${registryDisplay}"`
    : `"$NPM_BIN" config set registry "${registryDisplay}"`;

  const installCmd = registryConfigured
    ? `"$NPM_BIN" install -g "${packageName}" --registry="${registryDisplay}"`
    : `"$NPM_BIN" install -g "${baseUrl}/packages/biz-design-agent.tgz"`;

  const mirrorLine = nodeMirror
    ? `export NVM_NODEJS_ORG_MIRROR="${nodeMirror}"\n`
    : `# 若内网访问外网受限，可在此指定内网/镜像源：\n# export NVM_NODEJS_ORG_MIRROR="https://npmmirror.com/mirrors/node"\n`;

  return `# biz-design-agent 内网自动化配置与就绪引导（v${version}）

> **给 AI 助手的执行指令**：你正在协助用户在当前工作区完成 \`biz-design-agent\` 的全自动环境检测、安装与 Figma 画布连通性验收。
> 请严格按 **Step 1 → Step 5** 顺序执行：**每一步必须先真实检测，不通过时给出明确选项或修复操作，并允许用户在对话中反复回复「继续 / 复测」直到该步通过**；严禁跳过校验谎报就绪。

- 分发服务地址：\`${baseUrl}\`
- 目标包名：\`${packageName}\`（版本 \`v${version}\`）
- 内网 npm registry：\`${registryDisplay}\`

---

## Step 1：检测 Node.js（要求 >= 18），支持自动配置 \`nvm\` 并安装最新 LTS

### 1.1 先深度扫描本机已有 Node（避免 GUI 客户端丢失 Shell PATH 导致误报）
请在本机终端执行探测（macOS/Linux 用 zsh/bash，Windows 用 PowerShell）：

\`\`\`bash
# macOS / Linux：扫描 PATH、Homebrew、Volta 及 ~/.nvm 下全部 node，选最高 >= 18 版本
for cand in "$(command -v node 2>/dev/null || true)" /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.volta/bin/node" "$HOME/.nvm/versions/node"/*/bin/node; do
  [ -x "$cand" ] && echo "$cand => $("$cand" -v 2>/dev/null)"
done
\`\`\`

\`\`\`powershell
# Windows PowerShell：扫描 PATH、Program Files 与 nvm-windows
foreach ($cand in @((Get-Command node -ErrorAction SilentlyContinue).Source, "$env:NVM_SYMLINK\\node.exe", "C:\\Program Files\\nodejs\\node.exe")) {
  if ($cand -and (Test-Path $cand)) { Write-Output "$cand => $(& $cand -v)" }
}
\`\`\`

- **若已找到 \`>= 18\` 的 \`node\`**：记录其绝对路径为 \`NODE_BIN\`（以及同目录下的 \`NPM_BIN\`），**无需重装**，直接进入 Step 2。
- **若未找到或版本 \`< 18\`**：向用户展示以下两个选项，由用户选择后再执行：
  1. **选项 A（推荐）：由 AI 自动配置 \`nvm\` 并安装最新 Node LTS**
  2. **选项 B：用户自行安装 Node LTS**（从官网或内网 \`${baseUrl}/downloads/\` 安装包安装，装完后回复「继续」由 AI 复测）

### 1.2 当用户选择「选项 A：自动配置 nvm 并安装 LTS」时执行

- **macOS / Linux（\`nvm-sh\`）**：
  \`\`\`bash
  export NVM_DIR="$HOME/.nvm"
  ${mirrorLine}if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    curl -fsSL "${nvmInstallUrl}" | PROFILE=/dev/null bash
  fi
  # 幂等写入 ~/.zshrc 与 ~/.bashrc，确保新开终端生效
  for rc in "$HOME/.zshrc" "$HOME/.bashrc"; do
    touch "$rc"
    grep -q 'NVM_DIR="\$HOME/.nvm"' "$rc" || printf '\\nexport NVM_DIR="$HOME/.nvm"\\n[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"\\n' >> "$rc"
  done
  . "$NVM_DIR/nvm.sh"
  nvm install --lts
  nvm alias default 'lts/*'
  nvm use default
  NODE_BIN="$(nvm which current)"
  NPM_BIN="$(dirname "$NODE_BIN")/npm"
  echo "NODE_BIN=$NODE_BIN ($("$NODE_BIN" -v))"
  \`\`\`

- **Windows（\`nvm-windows\`）**：
  \`\`\`powershell
  if (-not (Get-Command nvm -ErrorAction SilentlyContinue)) {
    winget install -e --id CoreyButler.NVMforWindows --accept-source-agreements --accept-package-agreements
  }
  nvm install lts
  nvm use lts
  \`\`\`
  （若 Windows 刚装完 \`nvm-windows\` 需要刷新环境变量或管理员权限确认，请提示用户完成后回复「继续」，再重新执行 Step 1.1 复测直至拿到 \`NODE_BIN >= 18\`。）

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
3. 结合你当前运行的 AI 客户端身份，执行 \`setup\` 自动生成对应 Harness（Antigravity / Claude Code / Cursor / Trae / Windsurf / 通用）的原生 MCP（绑定绝对路径 \`NODE_BIN\`，避免 GUI 客户端丢 PATH）、工作区 Skills 与 \`AGENTS.md\`，同时把 Figma 插件解出到本机固定目录 \`~/.biz-design-agent/plugin/\`：
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
     1. 提示用户：本地免费账号读写画布依赖 **Figma Desktop 桌面客户端**加载插件（位于 \`~/.biz-design-agent/plugin/manifest.json\`，全局只需导入一次）。
     2. 自动帮用户在系统文件管理器高亮插件目录（macOS：\`open -R "$HOME/.biz-design-agent/plugin/manifest.json"\`；Windows：\`explorer /select,"$HOME\\.biz-design-agent\\plugin\\manifest.json"\`）。
     3. 给出 3 步指引：在 Figma Desktop 打开任意设计稿 → 顶部菜单 \`Plugins → Development → Import plugin from manifest...\` 选中该 \`manifest.json\` → 运行 \`FIMG Agent Plugin\` 看到面板显示已连接。
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

function renderIndexHtml(baseUrl) {
  const promptText = `请用 curl 读取 ${baseUrl}/bootstrap.md 并按步骤帮我检测环境、配置并连接 biz-design-agent`;
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>biz-design-agent 内网分发引导</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f4f6fa;color:#0f172a;font:15px/1.7 system-ui,"PingFang SC",sans-serif;padding:40px 20px}
main{max-width:760px;margin:auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:32px}
h1{margin:0 0 8px;font-size:26px}p.sub{margin:0 0 24px;color:#475569}
.box{background:#0f172a;color:#f8fafc;border-radius:10px;padding:16px 18px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;word-break:break-all}
button{margin-top:12px;background:#1d4ed8;color:#fff;border:none;border-radius:8px;padding:10px 18px;font-size:14px;font-weight:600;cursor:pointer}
.links{margin-top:24px;display:flex;gap:14px;flex-wrap:wrap;font-size:13px}a{color:#1d4ed8}
</style></head><body><main>
<h1>biz-design-agent 内网一键接入</h1>
<p class="sub">在新机器的 AI 客户端（Antigravity / Claude Code / Cursor / Trae / Windsurf）中打开你的工作区，把下面这句话发给 AI 即可自动完成 Node/nvm 检测、内网源配置、客户端适配与 Figma 桥连通验收。</p>
<div class="box" id="cmd">${promptText}</div>
<button onclick="navigator.clipboard.writeText(document.getElementById('cmd').textContent);this.textContent='已复制，直接粘贴给 AI 即可'">复制给 AI 的引导口令</button>
<div class="links"><a href="/bootstrap.md">查看原始 bootstrap.md</a><a href="/api/config.json">查看服务配置 JSON</a><a href="/health">健康检查</a></div>
</main></body></html>`;
}

let cachedTarballPath = null;
function ensureTarball() {
  if (cachedTarballPath && fs.existsSync(cachedTarballPath)) return cachedTarballPath;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-design-agent-pack-'));
  const binDir = path.dirname(process.execPath);
  const npmBin = path.join(binDir, process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const env = { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}` };
  const out = execFileSync(npmBin, ['pack', '--pack-destination', tmpDir], { cwd: ROOT, encoding: 'utf8', env }).trim();
  const fname = out.split(/\r?\n/).pop().trim();
  cachedTarballPath = path.join(tmpDir, fname);
  return cachedTarballPath;
}

export function createDistServer(options = {}) {
  const npmRegistry = options.npmRegistry ?? process.env.FIGMA_AGENT_REGISTRY ?? '';
  const npmScope = options.npmScope ?? process.env.FIGMA_AGENT_SCOPE ?? '';
  const nvmInstallUrl = options.nvmInstallUrl ?? process.env.FIGMA_AGENT_NVM_INSTALL_URL ?? 'https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh';
  const nodeMirror = options.nodeMirror ?? process.env.FIGMA_AGENT_NODE_MIRROR ?? '';
  const downloadsDir = options.downloadsDir ?? process.env.FIGMA_AGENT_DOWNLOADS_DIR ?? null;

  return http.createServer((req, res) => {
    const urlObj = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const baseUrl = options.publicUrl || `http://${req.headers.host || 'localhost'}`;

    if (urlObj.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, name: PKG.name, version: PKG.version }));
      return;
    }

    if (urlObj.pathname === '/api/config.json') {
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
      }, null, 2));
      return;
    }

    if (urlObj.pathname === '/bootstrap.md') {
      const md = renderBootstrapMarkdown({ baseUrl, npmRegistry, npmScope, nvmInstallUrl, nodeMirror });
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
        const md = renderBootstrapMarkdown({ baseUrl, npmRegistry, npmScope, nvmInstallUrl, nodeMirror });
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
  const port = Number(options.port || process.env.FIGMA_AGENT_DIST_PORT || 8790);
  const host = options.host || process.env.FIGMA_AGENT_DIST_HOST || '0.0.0.0';
  const server = createDistServer(options);
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const addr = server.address();
      resolve({ server, port: addr.port, host });
    });
  });
}
