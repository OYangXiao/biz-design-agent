<!--
  本文件由 scripts/build-dist.mjs 自动生成，请勿手工编辑。
  内容与 `biz-design-agent serve-dist` 在 http://localhost:8790 动态渲染的一致。
  如需更新：node scripts/build-dist.mjs
-->

# biz-design-agent 内网自动化配置与就绪引导（v1.5.1）

> **给 AI 助手的执行指令**：你正在协助用户在当前工作区完成 `biz-design-agent` 的全自动环境检测、安装与 Figma 画布连通性验收。
> 请严格按 **Step 1 → Step 5** 顺序执行：**每一步必须先真实检测，不通过时给出明确选项或修复操作，并允许用户在对话中反复回复「继续 / 复测」直到该步通过**；严禁跳过校验谎报就绪。

- 分发服务地址：`http://localhost:8790`
- 目标包名：`biz-design-agent`（版本 `v1.5.1`）
- 内网 npm registry：`<待配置内网 npm registry 地址>`

---

## Step 1：检测 Node.js（要求 >= 18），支持自动配置 `nvm` 并安装最新 LTS

### 1.1 先深度扫描本机已有 Node（避免 GUI 客户端丢失 Shell PATH 导致误报）
请在本机终端执行探测（macOS/Linux 用 zsh/bash，Windows 用 PowerShell）：

```bash
# macOS / Linux：扫描 PATH、Homebrew、Volta 及 ~/.nvm 下全部 node，选最高 >= 18 版本
for cand in "$(command -v node 2>/dev/null || true)" /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.volta/bin/node" "$HOME/.nvm/versions/node"/*/bin/node; do
  [ -x "$cand" ] && echo "$cand => $("$cand" -v 2>/dev/null)"
done
```

```powershell
# Windows PowerShell：扫描 PATH、Program Files 与 nvm-windows
foreach ($cand in @((Get-Command node -ErrorAction SilentlyContinue).Source, "$env:NVM_SYMLINK\node.exe", "C:\Program Files\nodejs\node.exe")) {
  if ($cand -and (Test-Path $cand)) { Write-Output "$cand => $(& $cand -v)" }
}
```

- **若已找到 `>= 18` 的 `node`**：记录其绝对路径为 `NODE_BIN`（以及同目录下的 `NPM_BIN`），**无需重装**，直接进入 Step 2。
- **若未找到或版本 `< 18`**：向用户展示以下两个选项，由用户选择后再执行：
  1. **选项 A（推荐）：由 AI 自动配置 `nvm` 并安装最新 Node LTS**
  2. **选项 B：用户自行安装 Node LTS**（从官网或内网 `http://localhost:8790/downloads/` 安装包安装，装完后回复「继续」由 AI 复测）

### 1.2 当用户选择「选项 A：自动配置 nvm 并安装 LTS」时执行

- **macOS / Linux（`nvm-sh`）**：
  ```bash
  export NVM_DIR="$HOME/.nvm"
  # 若内网访问外网受限，可在此指定内网/镜像源：
# export NVM_NODEJS_ORG_MIRROR="https://npmmirror.com/mirrors/node"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh" | PROFILE=/dev/null bash
  fi
  # 幂等写入 ~/.zshrc 与 ~/.bashrc，确保新开终端生效
  for rc in "$HOME/.zshrc" "$HOME/.bashrc"; do
    touch "$rc"
    grep -q 'NVM_DIR="$HOME/.nvm"' "$rc" || printf '\nexport NVM_DIR="$HOME/.nvm"\n[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"\n' >> "$rc"
  done
  . "$NVM_DIR/nvm.sh"
  nvm install --lts
  nvm alias default 'lts/*'
  nvm use default
  NODE_BIN="$(nvm which current)"
  NPM_BIN="$(dirname "$NODE_BIN")/npm"
  echo "NODE_BIN=$NODE_BIN ($("$NODE_BIN" -v))"
  ```

- **Windows（`nvm-windows`）**：
  ```powershell
  if (-not (Get-Command nvm -ErrorAction SilentlyContinue)) {
    winget install -e --id CoreyButler.NVMforWindows --accept-source-agreements --accept-package-agreements
  }
  nvm install lts
  nvm use lts
  ```
  （若 Windows 刚装完 `nvm-windows` 需要刷新环境变量或管理员权限确认，请提示用户完成后回复「继续」，再重新执行 Step 1.1 复测直至拿到 `NODE_BIN >= 18`。）

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
3. 结合你当前运行的 AI 客户端身份，执行 `setup` 自动生成对应 Harness（Antigravity / Claude Code / Cursor / Trae / Windsurf / 通用）的原生 MCP（绑定绝对路径 `NODE_BIN`，避免 GUI 客户端丢 PATH）、工作区 Skills 与 `AGENTS.md`，同时把 Figma 插件解出到本机固定目录 `~/.biz-design-agent/plugin/`：
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
     1. 提示用户：本地免费账号读写画布依赖 **Figma Desktop 桌面客户端**加载插件（位于 `~/.biz-design-agent/plugin/manifest.json`，全局只需导入一次）。
     2. 自动帮用户在系统文件管理器高亮插件目录（macOS：`open -R "$HOME/.biz-design-agent/plugin/manifest.json"`；Windows：`explorer /select,"$HOME\.biz-design-agent\plugin\manifest.json"`）。
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
