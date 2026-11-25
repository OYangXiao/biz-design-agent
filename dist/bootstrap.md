<!--
  本文件由 scripts/build-dist.mjs 自动生成，请勿手工编辑。
  内容与 `biz-design-agent serve-dist` 在 http://localhost:8790 动态渲染的一致。
  如需更新：node scripts/build-dist.mjs
-->

# biz-design-agent 内网自动化配置与就绪引导（v1.5.1）

> **给 AI 助手的执行指令**：你正在协助用户在当前工作区完成 `biz-design-agent` 的全自动环境检测、安装与 Figma 画布连通性验收。
> 请严格按 **Step 1 → Step 5** 顺序执行：**每一步必须先真实检测，不通过时给出明确选项或修复操作，并允许用户在对话中反复回复「继续 / 复测」直到该步通过**；严禁跳过校验谎报就绪。

- 分发服务地址：`http://localhost:8790`
- 便携版 Node 下载入口：`http://localhost:8790/portable-node/index.json`
- 目标包名：`biz-design-agent`（版本 `v1.5.1`）
- 内网 npm registry：`<待配置内网 npm registry 地址>`

---

## Step 1：检测 Node.js（要求 >= 18），无可用环境时自动下载便携版 Node

### 1.1 先深度扫描本机已有 Node（优先含已记录的便携版 Node，避免 GUI 客户端丢失 Shell PATH 导致误报）
请在本机终端执行探测（macOS/Linux 用 zsh/bash，Windows 用 PowerShell）：

```bash
# macOS / Linux：扫描便携版 Node、PATH、Homebrew、Volta 及 ~/.nvm 下全部 node，选最高 >= 18 版本
PORTABLE_REC="$(cat "$HOME/.biz-design-agent/runtime/node-path.txt" 2>/dev/null || true)"
for cand in "$PORTABLE_REC" "$HOME/.biz-design-agent/runtime/node/bin/node" "$(command -v node 2>/dev/null || true)" /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.volta/bin/node" "$HOME/.nvm/versions/node"/*/bin/node; do
  [ -x "$cand" ] && echo "$cand => $("$cand" -v 2>/dev/null)"
done
```

```powershell
# Windows PowerShell：扫描便携版 Node、PATH、Program Files 与 nvm-windows
$PortableRec = if (Test-Path "$HOME\.biz-design-agent\runtime\node-path.txt") { (Get-Content "$HOME\.biz-design-agent\runtime\node-path.txt" -Raw).Trim() } else { $null }
foreach ($cand in @($PortableRec, "$HOME\.biz-design-agent\runtime\node\node.exe", (Get-Command node -ErrorAction SilentlyContinue).Source, "$env:NVM_SYMLINK\node.exe", "C:\Program Files\nodejs\node.exe")) {
  if ($cand -and (Test-Path $cand)) { Write-Output "$cand => $(& $cand -v)" }
}
```

- **若已找到 `>= 18` 的 `node`**：记录其绝对路径为 `NODE_BIN`（以及同目录下的 `NPM_BIN`），**无需重装**，直接进入 Step 2。
- **若未找到或版本 `< 18`**：向用户展示以下两个选项，由用户选择后再执行：
  1. **选项 A（推荐，免装 nvm、免管理员权限）**：由 AI 通过命令行直接从分发服务 `http://localhost:8790/portable-node/` 下载官方便携版 Node.js LTS 并解压到 `~/.biz-design-agent/runtime/node`（终端下载不带浏览器隔离标记，可避免 macOS Gatekeeper 拦截），同时记录路径到本地并全程使用该便携版 Node。
  2. **选项 B**：用户自行安装官方 Node.js LTS 安装包（macOS `.pkg` / Windows `.msi`），装完后回复「继续」由 AI 复测。

### 1.2 当用户选择「选项 A：自动下载便携版 Node」时执行

- **macOS / Linux**：
  ```bash
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
  PORTABLE_URL="http://localhost:8790/portable-node/${OS_TAG}-${ARCH_TAG}.tar.gz"
  FALLBACK_URL="https://nodejs.org/dist/v26.13.1/node-v26.13.1-${OS_TAG}-${ARCH_TAG}.tar.gz"
  curl -fsSL "$PORTABLE_URL" -o "$ARCHIVE" || curl -fsSL "$FALLBACK_URL" -o "$ARCHIVE"
  rm -rf "$NODE_DIR" && mkdir -p "$NODE_DIR"
  tar -xzf "$ARCHIVE" -C "$NODE_DIR" --strip-components=1
  rm -f "$ARCHIVE"
  NODE_BIN="$NODE_DIR/bin/node"
  NPM_BIN="$NODE_DIR/bin/npm"
  printf '%s\n' "$NODE_BIN" > "$RUNTIME_DIR/node-path.txt"
  echo "已就绪便携版 Node，本地路径已记录到 $RUNTIME_DIR/node-path.txt："
  echo "NODE_BIN=$NODE_BIN ($("$NODE_BIN" -v))"
  ```

- **Windows PowerShell**：
  ```powershell
  $RuntimeDir = Join-Path $HOME ".biz-design-agent\runtime"
  $NodeDir = Join-Path $RuntimeDir "node"
  New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
  $Archive = Join-Path $RuntimeDir "node-portable.zip"
  $PortableUrl = "http://localhost:8790/portable-node/win-x64.zip"
  $FallbackUrl = "https://nodejs.org/dist/v26.13.1/node-v26.13.1-win-x64.zip"
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
  Write-Output "已就绪便携版 Node，本地路径已记录到 $RuntimeDir\node-path.txt："
  Write-Output "NODE_BIN=$NODE_BIN ($(& $NODE_BIN -v))"
  ```

  下载完成后，请明确告知用户：*“已将便携版 Node 下载到 `~/.biz-design-agent/runtime/node` 并记录在本地，后续安装与 MCP 运行都会自动使用该便携版 Node，无需额外安装系统环境。”*

---

## Step 2：配置内网 npm registry 并验证连通性

1. 当前分发服务尚未绑定正式内网 npm registry（可在服务端启动时传入 `FIGMA_AGENT_REGISTRY=http://<内网源>`）。
2. 如用户此刻提供了内网 registry 地址，先执行 `"$NPM_BIN" config set registry <用户提供的地址>` 并 `npm ping` 验证；若暂未提供，Step 3 可直接从本分发服务 `http://localhost:8790/packages/biz-design-agent.tgz` 安装离线包。

---

## Step 3：安装 `biz-design-agent` 与飞书 CLI（`@larksuite/cli`），并自动配置当前 Harness

1. 安装纯 Node 版 `biz-design-agent`（零 Python 依赖、零原生 C++ 编译）：
```bash
"$NPM_BIN" install -g "http://localhost:8790/packages/biz-design-agent.tgz"
```
2. 安装飞书官方 CLI（用于将 PRD 同步到飞书云文档或从飞书读取需求文档，参考 [飞书 CLI 官方文档](https://open.feishu.cn/document/mcp_open_tools/feishu-cli-let-ai-actually-do-your-work-in-feishu)）：
```bash
PATH="$(dirname "$NODE_BIN"):$PATH" "$NPM_BIN" install -g @larksuite/cli
```
（若内网 registry 尚未同步 `@larksuite/cli`，可提示用户先切公共源安装或暂时跳过、后续再装。）
3. 结合你当前运行的 AI 客户端身份，执行 `setup` 自动生成对应 Harness（Antigravity / Claude Code / Cursor / Trae / Windsurf / 通用）的原生 MCP（绑定绝对路径 `NODE_BIN`，避免 GUI 客户端丢 PATH）、工作区 Skills 与 `AGENTS.md`，同时把 Figma 插件解出到用户可见目录 `~/Documents/BizDesignAgent-FigmaPlugin/`（也可传入 `--plugin-dir <自定义目录>`）：
```bash
FIGMA_AGENT_BIN="$(dirname "$NODE_BIN")/biz-design-agent"
"$NODE_BIN" "$FIGMA_AGENT_BIN" setup --workspace "$(pwd)" --harness auto --node "$NODE_BIN"
```
（若自动识别结果为 `generic` 且你明确知道当前客户端类型，请传入具体 `--harness antigravity|claude-code|cursor|trae|windsurf`。）

---

## Step 4：检查飞书 CLI 初始化授权 + 启动共享 Figma Bridge 并完成插件握手

1. 执行完整体检（同时探测 `feishu`、`bridge.reachable` 与 `bridge.pluginOnline`）：
```bash
"$NODE_BIN" "$FIGMA_AGENT_BIN" doctor --json
```
2. **飞书 CLI 登录授权引导（检查 `feishu.installed` 与 `feishu.authenticated`）**：
   - 若 `feishu.installed` 为 true 但 `feishu.authenticated` 为 false，**直接由 AI 执行 `lark-cli auth login`**（或在需要交互时自动弹出终端窗口运行，无需用户自己找终端）：
     - **直接执行（优先，会自动输出/拉起浏览器授权链接）**：
       ```bash
       PATH="$(dirname "$NODE_BIN"):$PATH" lark-cli auth login
       ```
       *(仅当提示尚未绑定应用配置时，再执行 `lark-cli config init --new` 在浏览器一键建应用并重试 `lark-cli auth login`。)*
     - **macOS 自动打开 Terminal 运行（若需独立终端交互）**：
       ```bash
       osascript -e 'tell application "Terminal" to do script "export PATH=\"'$(dirname "$NODE_BIN")':$PATH\"; lark-cli auth login && lark-cli auth status"' -e 'tell application "Terminal" to activate'
       ```
     - **Windows 自动打开 PowerShell 运行**：
       ```powershell
       Start-Process powershell -ArgumentList '-NoExit','-Command','lark-cli auth login; lark-cli auth status'
       ```
   - 引导用户在打开的浏览器页面点「确认授权」（官方文档：`https://open.feishu.cn/document/mcp_open_tools/feishu-cli-let-ai-actually-do-your-work-in-feishu`）。
   - 提示用户：*“在浏览器确认授权后回复『继续』，我立刻复测登录状态；如果本次暂不需要同步飞书文档，也可以回复『跳过飞书』继续。”*
3. **Figma Bridge 与桌面端插件握手（检查 `bridge.reachable` 与 `bridge.pluginOnline`）**：
   - **若 `bridge.reachable` 为 false**：运行 `"$NODE_BIN" "$FIGMA_AGENT_BIN" bridge-ensure` 拉起后台共享桥后复测。
   - **若 `bridge.pluginOnline` 为 false**：
     1. 提示用户：本地免费账号读写画布依赖 **Figma Desktop 桌面客户端**加载插件（默认位于用户可见目录 `~/Documents/BizDesignAgent-FigmaPlugin/manifest.json`，全局只需导入一次；如需放其他目录可调用 `figma_install_plugin` 指定）。
     2. 自动帮用户在系统文件管理器高亮插件目录（macOS：`open -R "$HOME/Documents/BizDesignAgent-FigmaPlugin/manifest.json"`；Windows：`explorer /select,"%USERPROFILE%\Documents\BizDesignAgent-FigmaPlugin\manifest.json"`）。
     3. 给出 3 步指引：在 Figma Desktop 打开任意设计稿 → 顶部菜单 `Plugins → Development → Import plugin from manifest...` 选中该 `manifest.json` → 运行 `Biz Design Agent` 看到面板显示已连接。
     4. 提示用户：**“在 Figma 点开插件后回复『好了』，我立刻做真机握手验证。”**
   - 用户回复后，执行真机往返验证：
     ```bash
     "$NODE_BIN" "$FIGMA_AGENT_BIN" ping
     ```
   - 重复确认直到 `ping` 返回当前打开的 Figma 文件名与页面列表。

---

## Step 5：完全就绪，转入业务角色入口

全部检查项均通过后，向用户汇报简明就绪清单（Node 版本、npm 源、飞书 CLI 授权状态、已配置的 Harness、已连接的 Figma 文件名；如首次写入 MCP 配置则顺便提醒“重载一次窗口即可原生调用 MCP，当前会话也已可直接开工”），并立刻发起业务入口提问：

> “✅ `biz-design-agent` 环境、飞书文档能力与 Figma 画布桥已全部准备就绪！
> 这次想进入哪个工作模式？
> 1. 业务设计 · 开发或更新 PRD（Figma 单页 + Word + 飞书文档同步）
> 2. 业务设计 · 生成可操作预览原型图（点击跳转 + PRD 说明卡）
> 3. 美工 / UI · 制作高保真视觉稿
> 4. 前端 / 研发 · 提取视觉规格联调与提测
> 5. 测试 & 美工走查 · 页面功能验收与视觉还原对图”
