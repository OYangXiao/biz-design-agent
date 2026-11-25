# 多 Harness 插件打包：架构对比与方案

> **本文用途**：给另一个 AI 或工程师做二次规划的输入材料。
> **依据**：Antigravity / Claude Code / Codex 三家的官方插件文档（原文归档在同目录 [`raw/`](raw/)），以及对 `agy` 插件管理面的**实测验证**。
> **抓取日期**：2026-11-25。
> **结论先行**：可以做**一份源码、一次构建、产出三家可装**的插件。Codex 原生兼容 Claude 格式；Antigravity 经实测**也会在安装时自动转换** Claude 格式。

---

## 0. 一句话结论

三家的 `skills/` 目录约定一致，Codex **直接支持** `.claude-plugin/plugin.json`，Antigravity 经实测**安装时自动转换**同格式。
因此只需要：

- **1 份 manifest**（`.claude-plugin/plugin.json`，三家共用；Antigravity 如需 Marketplace 展示再补原生一份）
- **2 份 MCP 配置**（文件名和路径变量名不同，无法合并）
- **其余全部共享**（skills、agents、scripts、bin）

> 状态标记：本节结论中，「1 份 manifest 可装三家」的 Antigravity 部分**已实测**（见 §2 发现 D）；
> Claude Code 与 Codex 两侧仍为**文档层面结论**，未做真机加载（见风险 7）。

---

## 1. 三家结构对比

| 维度 | Antigravity | Claude Code | Codex |
|---|---|---|---|
| manifest 路径 | `plugin.json` 或 `.antigravity-plugin/plugin.json`；<br>**也可直接吃 `.claude-plugin/plugin.json`（安装时自动转换，已实测）** | `.claude-plugin/plugin.json` | `.codex-plugin/plugin.json`，**或复用 `.claude-plugin/plugin.json`** |
| skills | `skills/<name>/SKILL.md` | `skills/<name>/SKILL.md` | 支持插件内 skill（**目录名未公开**，见风险 5） |
| agents | `agents/<name>.md` | `agents/<name>.md` | 兼容 Claude 布局 |
| MCP 配置 | **`mcp_config.json`** | **`.mcp.json`** | 同 Claude（`.mcp.json`） |
| hooks | **`hooks.json`**（根目录） | **`hooks/hooks.json`** | `hooks/hooks.json`（可用 manifest 覆盖） |
| 插件根变量 | `${PLUGIN_ROOT}`、`${PLUGIN_DATA}` | `${CLAUDE_PLUGIN_ROOT}`、`${CLAUDE_PLUGIN_DATA}` | 两个都设（含 `PLUGIN_ROOT`） |
| 校验命令 | `agy plugin validate [--strict]` | `claude plugin validate .` | 无公开本地校验 |
| 分发渠道 | 本地目录 / Git 仓库 / Marketplace | 本地目录 / marketplace | marketplace（`.agents/plugins/marketplace.json` 或 `.claude-plugin/marketplace.json`） |
| 工具名空间 | `<plugin>_<server>` | `mcp__plugin_<plugin>_<server>__<tool>` | 沿用 Claude 规则 |

### 1.1 目录骨架的差异点

Antigravity（[`raw/antigravity-build-plugins.md`](raw/antigravity-build-plugins.md)）：

```text
plugins/<plugin-name>/
├── plugin.json               # 或 .antigravity-plugin/plugin.json
├── README.md
├── assets/logo.svg
├── scripts/
├── mcp_config.json
├── hooks.json
├── skills/<skill-name>/SKILL.md
├── agents/<agent-name>.md
└── rules/
    ├── AGENTS.md
    └── <rule-name>.md
```

Claude Code（[`raw/claude-code-plugin-components.md`](raw/claude-code-plugin-components.md)）：

```text
my-plugin/
├── .claude-plugin/plugin.json    # 只有 plugin.json 放这里
├── skills/<name>/SKILL.md
├── commands/                     # 旧格式，新写用 skills
├── agents/<name>.md
├── hooks/hooks.json
├── .mcp.json
├── output-styles/
├── themes/
└── workflows/
```

---

## 2. 三个关键发现（决定方案可行性）

### 发现 A：Codex 直接复用 Claude 格式

来自 [`raw/codex-marketplace-sync.md`](raw/codex-marketplace-sync.md) 原文：

> The selected directory must contain one of these files:
>
> | `.agents/plugins/marketplace.json` | A Codex marketplace with a `plugins` array. |
> | `.claude-plugin/marketplace.json` | A Claude-compatible marketplace with a `plugins` array. |
> | `.claude-plugin/plugin.json` | A standalone Claude plugin, **when no marketplace manifest is present**. |

> In a marketplace, entries can reference native plugins with `.codex-plugin/plugin.json`, **Claude-compatible plugins**, Agent Plugins 1.0 packages, or supported skill packages.

**含义**：不需要为 Codex 单独写 manifest。一份 `.claude-plugin/plugin.json` 同时服务两家。

### 发现 B：Antigravity 官方支持「多 provider 仓库」

来自 [`raw/antigravity-build-plugins.md`](raw/antigravity-build-plugins.md)：

> Place `plugin.json` at `<plugin-root>/plugin.json` for standalone Antigravity plugins, or inside `<plugin-root>/.antigravity-plugin/plugin.json` **for multi-provider repositories that also ship `.claude-plugin/plugin.json` or `.cursor-plugin/plugin.json`** (`.antigravity-plugin/plugin.json` takes precedence over root `plugin.json`).

并且专门列了一张「别家文件被安全忽略」的表：

| 文件 | Antigravity 行为 |
|---|---|
| `.mcp.json`、`mcp.json` | 安全忽略（Antigravity 只读 `mcp_config.json`）；打包 Marketplace 时自动排除 `.mcp.json` |
| 根 `plugin.json` | 有 `.antigravity-plugin/plugin.json` 时被安全遮蔽 |
| 根 `AGENTS.md` | 安全忽略（Antigravity 只从 `rules/` 读规则） |

**含义**：三家文件共存是**设计内**行为，不是 hack。CI 里可用 `agy plugin validate`（不带 `--strict`）避免多工具告警导致失败。

### 发现 C：`skills/` 路径在 Antigravity 与 Claude 一致

skill 写一次，Antigravity 与 Claude 都从 `skills/<name>/SKILL.md` 读，frontmatter 都要求 `name` + `description`。

**Codex 侧的证据强度不同**：文档确认「插件可包含一个或多个 skill」「bundled skills 在安装后开新会话即可用」，但**未在已抓取页面中公开插件内 skill 的目录名**。可能沿用 Claude 布局（因为它兼容 `.claude-plugin/`），但这是**推断而非文档明确**，列入风险 5。

### 发现 D：Antigravity 的 `plugin install` 会自动转换 Claude 格式（**已实测**）

这一条推翻了「必须为 Antigravity 单独准备 manifest」的假设，是本次调研中唯一经过真机验证的结论。

**实测环境**：`agy` 1.5.1（Gemini App 内置版本，`/Applications/Gemini.app/Contents/Helpers/agy`）。全部为本地操作，未产生模型调用。

#### D-1. 原生格式校验通过

最小插件（`plugin.json` + `skills/<name>/SKILL.md`）：

```console
$ agy plugin validate . --strict
Validating probe-test (plugin.json)
  · plugin.json: no logo: the plugin shows a generic icon. Add "logo": "assets/logo.svg" ...
  skills 1 · agents 0 · rules 0 · hooks 0 · mcpServers 0 · sidecars 0
✔ Validation passed
```

`--strict` 下通过，唯一提示是缺 logo——即 **logo 属 Marketplace 展示要求，不阻断本地加载**。

#### D-2. 安装落盘路径

```console
$ agy plugin install .
  [ok]    probe-test
          ✔ skills      : 1 installed (probe)
          Installed to /Users/oyx/.gemini/config/plugins/probe-test
$ agy plugin list
Installed plugins:
- probe-test (enabled, 1.0.0)
    Source:     antigravity
    Components: 1 skill
```

`plugin list` 会报告 `Source` 与组件统计，可作为 CI 中的落地校验手段。

#### D-3. 纯 Claude 格式：`validate` 拒绝，`install` 自动转换（关键结论）

只放 `.claude-plugin/plugin.json`（无根 manifest）时：

```console
$ agy plugin validate .
  ✗ plugin.json: no plugin.json found at the plugin root or in .antigravity-plugin or .gemini-plugin.
    This looks like a Claude Code plugin: `plugin install` converts it, but it doesn't load as is
Error: validation failed: 1 error, 0 warnings
```

但 `install` 照常成功，并**自动生成根 `plugin.json`**：

```console
$ agy plugin install .
  [ok]    probe-claude-fmt
          ✔ skills      : 1 installed (probe2)
          Installed to /Users/oyx/.gemini/config/plugins/probe-claude-fmt
$ agy plugin list
- probe-claude-fmt (enabled, 1.0.0)
    Source:     claude-code          ← 识别为 Claude 来源
    Components: 1 skill
```

生成的根 manifest 只搬运了三个字段：

```json
{
  "description": "Claude-format plugin to verify Antigravity compatibility.",
  "name": "probe-claude-fmt",
  "version": "1.0.0"
}
```

#### D-4. 对打包方案的影响

| 原假设 | 实测结论 |
|---|---|
| 必须写 `.antigravity-plugin/plugin.json` 才能装 | ❌ 不必。`install` 会转换 `.claude-plugin/` 格式 |
| 三份 manifest 变两份 | ✅ 可进一步收敛为**一份 Claude 格式首发** |
| Antigravity 专有字段能否保留 | ⚠️ 转换只搬 `name`/`version`/`description`，**`logo`、`suggestedPrompts`、`author` 等会丢失** |

**建议**：
- **首发用统一 Claude 格式**，Antigravity 用户 `agy plugin install` 即可，路径最短；
- 若后续要上 Marketplace 或重视详情页展示，再补原生 `.antigravity-plugin/plugin.json`（含 logo 与 suggestedPrompts）；
- CI 中对 Antigravity 侧用 `agy plugin validate`（**不带 `--strict`**），因为纯 Claude 格式在 `--strict` 下会报错但 `install` 可用。

#### D-5. 本次未覆盖的部分

`plugin validate` / `install` / `list` / `uninstall` 属于管理面操作，**全部本地完成**。
但插件在真实会话中是否被正确注入（skill 是否进入 context、MCP 工具是否出现）需要一次模型调用，**本次未验证**，仍列在风险章节。

---

## 3. 唯一无法共享的部分：MCP 配置

MCP 定义结构相同（`mcpServers` 对象），**但文件名与路径变量名不同**。

Claude + Codex 用 `.mcp.json`：

```json
{
  "mcpServers": {
    "biz-design-agent": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/bin/biz-design-agent.mjs", "mcp"]
    }
  }
}
```

Antigravity 用 `mcp_config.json`：

```json
{
  "mcpServers": {
    "biz-design-agent": {
      "command": "node",
      "args": ["${PLUGIN_ROOT}/bin/biz-design-agent.mjs", "mcp"]
    }
  }
}
```

---

## 3.5 实测：Claude Code 插件链路（**已验证，含真实项目 MCP**）

**环境**：`codex-cli` 无关；本节用的是 `claude` 2.1.332（`~/.local/bin/claude`）。
**验证方式**：`claude plugin validate` + `claude -p ... --plugin-dir <dir>`。
**结论**：四类组件全部可用，且**本项目真实的 MCP server 成功在插件内被调起**。

### E-1. 组件验证矩阵

| 组件 | 验证方式 | 结果 |
|---|---|---|
| manifest | `claude plugin validate` | ✅ 通过 |
| skills | 让模型按 skill 指示作答 | ✅ 返回预期标记（证明 skill 进入上下文） |
| agents | 调用子代理 | ✅ 正确识别为 `<plugin>:<agent>` |
| MCP server（自建） | 调用 echo 工具 | ✅ 回传参数 |
| **MCP server（本项目真实）** | 调用 `figma_status` | ✅ **返回真实桥状态 JSON** |

最后一项最关键：把 `~/Projects/biz-design-agent` 的 `bin/` 与 `src/` 挂进插件目录，用 `${CLAUDE_PLUGIN_ROOT}` 定位，模型真实调起了 `figma_status` 并拿到桥接数据（`reachable: true`, `port: 8787`）。

### E-2. 关键确认：`${CLAUDE_PLUGIN_ROOT}` 在 `.mcp.json` 中确实生效

这一条消除了原先的「风险 1」。实测可用的形态：

```json
{
  "mcpServers": {
    "biz-design-agent": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/bin/biz-design-agent.mjs", "mcp"]
    }
  }
}
```

工具名被正确命名空间化为 `mcp__plugin_<plugin>_<server>__<tool>`，与文档描述一致。

**含义**：**不需要**走「发 npm 全局包」的兜底路线，插件自包含即可。

### E-3. 插件目录校验强制要求 README 与 LICENSE

首次 `validate` 直接被拒：

```console
✘ README.md: README missing (README_MISSING)
✘ LICENSE: License missing (LICENSE_MISSING)
```

补齐后才 `✔ Validation passed`。补充要求：

- README **至少 40 词**，建议包含一行 marketplace 安装指令（否则只给 Advice）
- LICENSE 文件，或在 `plugin.json` 里写 `license`（SPDX id）
- 图标为 **warning 非 error**：`plugin.json` 的 `icon` 或 `.claude-plugin/icon.png`，要求方形 PNG/JPEG、512–2048 px、< 2 MB（**不接受 SVG/WebP**）

### E-4. `claude plugin install` 不支持本地目录（与 Antigravity 的关键差异）

| | Antigravity | Claude Code |
|---|---|---|
| 装本地目录 | `agy plugin install <dir>` ✅ | ❌ **不支持** |
| 本地目录加载方式 | 直接 install | 只能 `claude --plugin-dir <dir>` 临时加载 |
| 永久安装 | `install` | **必须经 marketplace**（`/plugin install <name>@<mp>`） |

`claude plugin install` 的帮助明确写着「Install a plugin from available marketplaces」。
所以 Claude Code 的分发**必须**配一个 marketplace，否则用户体验只能是每次带 `--plugin-dir`。

### E-5. 对交付方式的影响

| Harness | 推荐分发路径 |
|---|---|
| Antigravity | `agy plugin install <dir>` —— 最短路径 |
| **Claude Code** | 建 marketplace（`.claude-plugin/marketplace.json`），用户 `/plugin install biz-design-agent@<mp>` |
| Codex | 与 Claude 共用 marketplace 体系（待验证，见风险 8） |

> 因此 `dist/plugin/` **必须同时产出 marketplace 清单**，不能只有 plugin.json。

### E-6. Codex 实测：登录**可以**绕过，但协议层挡住（本次唯一实测结论）

好消息是：Codex **不强制 OpenAI 登录**。用 `[model_providers.<id>]` + `env_key` 即可跳过登录直接跑，实测已跑通到网络层：

```toml
model = "<model-id>"
model_provider = "company"

[model_providers.company]
name = "Company Gateway"
base_url = "http://<gateway>/v1"
env_key = "COMPANY_API_KEY"
```

`codex login status` 显示 `Not logged in`，但 `codex exec` 仍会发起请求——**登录不是硬门槛**。

坏消息是请求被网关拒绝：

```
ERROR: {"code":812,"msg":"当前模型不支持responses接口"}
```

尝试改协议时收到明确报错：

```console
$ # 在 provider 配置里加 wire_api = "chat"
Error loading config.toml: `wire_api = "chat"` is no longer supported.
How to fix: set `wire_api = "responses"` in your provider config.
```

即 **`chat` 协议在 Codex 中已被移除**，只剩 `responses`。这与官方文档一致：
> A working Chat Completions or Anthropic Messages endpoint doesn't establish Responses compatibility.

**结论**：公司网关（Chat Completions 协议）**无法**直接接 Codex。要在 Codex 侧落地，必须满足其一：

1. **网关侧支持 `/v1/responses`**（最干净，需基础设施配合）
2. **加一层 Chat Completions → Responses 转换代理**（可自建，工程量为一个中间服务）
3. **用真实 OpenAI API key**（需 Platform 账号，按 API 价计费，与订阅额度无关）
4. **Codex 侧暂不支持**，先交付 Antigravity + Claude Code 两家

> 在 Codex 接入打通前，其插件兼容性只能依据文档推断（它读 `.claude-plugin/` 布局）。
> 代码层面的插件产物无需为 Codex 单独准备——等接入通了直接复用 Claude 那份。

---

---

## 4. 风险清单（含已消除项，保留以便追溯）

下表记录全部待评估项及其当前状态。**已标记「已消除」的项不必再投入调研**；剩余真实风险集中在 Codex 侧。

### 风险 1：路径变量替换 —— **Claude Code 已消除，Codex 仍未知**

| Harness | 状态 |
|---|---|
| Claude Code | ✅ **已实测**：`${CLAUDE_PLUGIN_ROOT}` 在 `.mcp.json` 的 `args` 中生效（见 §3.5 E-2） |
| Antigravity | ✅ 文档明确：`${PLUGIN_ROOT}` 在 `args`、`cwd`、自定义 `env` 中替换 |
| **Codex** | ❓ **未知**：文档只说明 hooks 会设置 `PLUGIN_ROOT` / `CLAUDE_PLUGIN_ROOT` 环境变量，未说明 `.mcp.json` 的 `args` 是否替换 |

**影响**：因 Claude Code 已验证，主路径可用路径变量，**不需要** npm 全局包兜底。
Codex 若将来接入，其 MCP 配置是否需改写仍待验证。

### 风险 2：~~`npx` / 全局包的可用性~~ → **不再是阻塞项**

原本作为风险 1 的兜底方案。既然 Claude Code 的路径变量已实测可用，插件可自包含，**无需强制走 npm 分发**。
若将来仍要发 npm（如内网统一分发），才需要确认 registry 可达性与 `npx -y` 权限。

### 风险 3：hooks 路径约定不一致

Antigravity 的 hook 命令**自动以插件根为 cwd**，文档建议用相对路径（`node ./scripts/policy.mjs`）而非 `${PLUGIN_ROOT}`。
Claude 用 `${CLAUDE_PLUGIN_ROOT}/scripts/...`。若本项目要用 hooks，需分别写。

**当前项目暂未使用 hooks**，可先不处理。

### 风险 4：「Agent Plugins 1.0」标准无公开规范

Codex 文档提到可引用 "Agent Plugins 1.0 packages"，但未给出规范定义，`agent-plugins.org/spec/1.0` 返回 404。
**结论**：不要依赖这个标准，按 Claude 兼容格式走。

### 风险 5：Codex 插件内 skill 的目录名未公开

- Claude 明确：`skills/<name>/SKILL.md`
- Antigravity 明确：`skills/<name>/SKILL.md`
- **Codex 只说明「plugins can include one or more skills」「bundled skills become available when you start a new chat or CLI session」，未公开插件内 skill 的目录名。**

若 Codex 复用 `.claude-plugin/plugin.json` 时也沿用 `skills/` 布局（合理解推断，但未获文档确认），则三者天然统一。
**验证方法**：构造一个含 `skills/` 的最小插件，装进 Codex 后用 `@` 菜单看 skill 是否出现。

### 风险 6：~~Antigravity CLI 未安装~~ → **已消除**

`agy plugin validate` / `install` / `list` / `uninstall` 已实测通过（管理面），见「发现 D」。
运行时（真实会话中的加载行为）**仍未验证**。

### 风险 7：~~Claude Code CLI 未安装~~ → **已消除**

`claude plugin validate` 与 `--plugin-dir` 加载均已实测，**含本项目真实 MCP server**，见 §3.5。

当前 CLI 状态：

| CLI | 状态 | 验证程度 |
|---|---|---|
| `agy`（Antigravity） | ✅ 已装 | 管理面 + 格式转换已验证；运行时未验证 |
| `claude`（Claude Code） | ✅ 已装 | **完整链路已验证**（skill/agent/MCP 全部跑通） |
| `codex`（Codex） | ✅ 已装 0.172.0 | ❌ 卡在登录，**未能验证** |
| `cursor`（Cursor） | ❌ 未装 | 文档未抓取 |
| `dsh`（DeepSeek Harness） | ✅ 已装 | 分发机制已梳理 |

### 风险 8：Codex 侧完全未验证

`codex` CLI 已安装（0.172.0），但**未能登录**，因此 Codex 的插件加载路径**没有任何实测**。

Codex 的认证方式（据 [`raw/codex-plugins.md`](raw/codex-plugins.md) 与 llms-full 抽取）：

| 方式 | 命令 / 配置 | 前提 |
|---|---|---|
| API key | `printenv OPENAI_API_KEY \| codex login --with-api-key` | 需 OpenAI Platform 账号 |
| Access token | `codex login --with-access-token` | 需已有 token |
| ChatGPT 登录 | 浏览器 OAuth | 账号需符合地区要求 |
| **自定义 provider** | `[model_providers.<id>]` + `env_key` | **provider 必须支持 Responses API** |

**关键阻塞点**：`wire_api` 的**唯一受支持值是 `responses`**。

**该风险已实测确认**，详见 §3.5 的「E-6」：登录确实可以绕过，但协议层挡住，`wire_api = "chat"` 已被移除。


## 5. 目标产物结构

### 5.1 首发方案（推荐）：统一 Claude 格式

依据「发现 D」实测结论，Antigravity 的 `install` 会自动转换 Claude 格式，因此首发只需一份 manifest：

```text
dist/plugin/                          # 构建产物（一条命令生成，不手工维护）
├── .claude-plugin/
│   ├── plugin.json                   # ★ 三家共用（Antigravity 安装时自动转换）
│   └── marketplace.json              # ★ 必需：Claude Code 只能经 marketplace 安装
├── .agents/
│   └── plugins/
│       └── marketplace.json          # 可选：Codex 本地市场入口
├── skills/
│   └── biz-design-agent/
│       └── SKILL.md                  # ★ 三家共用
├── agents/                           # 可选
├── .mcp.json                         # Claude + Codex
├── mcp_config.json                   # Antigravity（MCP 文件名无法共用，仍需单独一份）
├── bin/                              # CLI + MCP server 入口
├── src/                              # MCP server 依赖模块（必需）
├── plugin/                           # Figma 插件（需人工导入，无法自动安装）
├── LICENSE                           # ★ 必需：claude plugin validate 强制
└── README.md                         # ★ 必需：≥40 词，建议含 marketplace 安装指令
```

> **上表中标 ★ 的三项（`marketplace.json`、`LICENSE`、`README.md`）来自实测**：
> 缺 README/LICENSE 会让 `claude plugin validate` 直接失败；缺 marketplace 则 Claude Code 用户无法永久安装（见 §3.5 E-3、E-4）。

### 5.2 增强方案（上 Marketplace 时）：补原生 manifest

```text
├── .antigravity-plugin/
│   └── plugin.json                   # 含 logo / suggestedPrompts / author
```

自动转换只会搬 `name`/`version`/`description` 三个字段，**Logo 与 starter prompts 会丢失**。
如果需要 Antigravity 详情页的展示效果，才值得为它单独维护一份原生 manifest。

> 注意：`.antigravity-plugin/plugin.json` 存在时**优先于**根 `plugin.json`，而 `install` 的自动转换生成的是根 `plugin.json`，两者可共存不冲突。

### 为什么 `bin/` + `src/` 都要打包

本项目的 MCP server（`bin/biz-design-agent.mjs mcp`）不是单文件，依赖 `src/` 下 10 个模块：
`prd.mjs`、`prototype.mjs`、`visual-design.mjs`、`dev-handoff.mjs`、`qa-verify.mjs`、`env-doctor.mjs`、`harness-setup.mjs`、`mcp-server.mjs`、`visual-diff.mjs`、`zip.mjs`。

**注意**：`dist/` 已用于存放接入引导（`bootstrap.md` 等），插件产物建议放 `dist/plugin/` 以避免混淆，或另起 `build/plugin/`。

---

## 6. 与本项目现状的对照

| 现状 | 文件 | 处理建议 |
|---|---|---|
| MCP server，17 个工具 | `bin/biz-design-agent.mjs`、`src/mcp-server.mjs` | ✅ 直接作为插件 MCP 后端 |
| 五模式菜单硬编码在代码字符串里 | `src/harness-setup.mjs` 的 `PRD_SKILL_MD` | ⚠️ 应抽成 `skills/biz-design-agent/SKILL.md`，三家共用 |
| 按客户端分别写配置 | `src/harness-setup.mjs` 的 `configureHarness()` | 🔶 插件化后对新三家不再需要；保留作为「其它 harness」兜底 |
| Figma 插件 | `plugin/manifest.json`、`code.js`、`ui.html` | ❌ 三家 harness 插件**都无法**自动安装它，必须人工 Import |
| 接入引导 | `dist/bootstrap.md`、`docs/SETUP.md` | 🔶 插件化后 SETUP 增加插件安装路径，bootstrap 保留给非插件场景 |
| 一致性测试 | `test/consistency.test.mjs` | ✅ 应扩展：校验生成的 manifest 与源 package.json 版本一致 |

---

## 7. 待决策事项（给二次规划的输入）

1. **MCP server 定位方式**
   - A：内联进插件，靠 `${PLUGIN_ROOT}` / `${CLAUDE_PLUGIN_ROOT}`
   - B：发内网 npm，`args: ["-y", "@scope/biz-design-agent", "mcp"]`
   - 影响：A 体积约 +500KB 且依赖风险 1 的结论；B 需先发版

2. **Codex 是否需要 marketplace 入口**
   - 只有 `.claude-plugin/plugin.json` 时可被当作 standalone plugin
   - 若要团队分发，需 `.agents/plugins/marketplace.json`

3. **是否同时支持 Cursor**
   - Antigravity 文档提到 `.cursor-plugin/plugin.json` 也是可共存的 manifest 位置
   - 但本轮未抓取 Cursor 官方文档，**属未验证项**

4. **skill 拆分粒度**
   - 单个 `biz-design-agent` skill 承载五模式？
   - 还是拆成 5 个 skill（prd / prototype / visual / dev-handoff / qa）分别按需加载？
   - 后者更省 context，但主菜单逻辑需要额外落点

---

## 8. 文档索引（原始归档）

| 文件 | 来源 |
|---|---|
| [`raw/antigravity-build-plugins.md`](raw/antigravity-build-plugins.md) | https://antigravity.google/docs/build-plugins/ |
| [`raw/antigravity-plugins.md`](raw/antigravity-plugins.md) | https://antigravity.google/docs/plugins/ |
| [`raw/antigravity-skills.md`](raw/antigravity-skills.md) | https://antigravity.google/docs/skills/ |
| [`raw/claude-code-create-plugin.md`](raw/claude-code-create-plugin.md) | https://code.claude.com/docs/en/plugins/create |
| [`raw/claude-code-plugin-components.md`](raw/claude-code-plugin-components.md) | https://code.claude.com/docs/en/plugins/components |
| [`raw/claude-code-manifest-reference.md`](raw/claude-code-manifest-reference.md) | https://code.claude.com/docs/en/plugins/manifest-reference |
| [`raw/codex-plugins.md`](raw/codex-plugins.md) | https://learn.chatgpt.com/docs/plugins |
| [`raw/codex-build-plugins.md`](raw/codex-build-plugins.md) | https://learn.chatgpt.com/docs/plugins（Build plugins 段） |
| [`raw/codex-marketplace-sync.md`](raw/codex-marketplace-sync.md) | https://learn.chatgpt.com/docs/import-plugins-from-github |

> **抓取限制说明**：
> - `developers.openai.com/plugins/build/plugins` 返回 403，未能获取，故 Codex 侧以 `learn.chatgpt.com` 的 `llms-full.txt` 抽取为准。
> - 未抓取 Cursor 官方插件文档。
> - 所有原文以 markdown twin（URL 加 `.md`）形式获取，可能略去站点内的交互式目录树组件。

---

## 附：验证环境说明

本文件中的实测结论（「发现 D」）在如下环境取得，供复现参考：

| 项 | 值 |
|---|---|
| `agy` 版本 | 1.5.1（Gemini App 内置：`/Applications/Gemini.app/Contents/Helpers/agy`） |
| `agy` 验证范围 | `plugin validate` / `install` / `list` / `uninstall` |
| `agy` 是否消耗模型额度 | **否**，全部为本地管理面操作 |
| `claude` 版本 | 2.1.332（`~/.local/bin/claude`） |
| `claude` 验证范围 | `plugin validate` + `-p --plugin-dir` 运行时加载 |
| `claude` 是否消耗模型额度 | **是**，4 次极短会话（提示词均在 100 token 内） |
| `codex` 版本 | 0.172.0，**未登录，未验证** |
| 测试产物 | 全部临时目录已删除；`claude plugin list` 无残留；源仓库 `git status` 干净 |

**模型来源说明**：`claude` 的实测会话走的是自定义网关（`ANTHROPIC_BASE_URL` 指向第三方端点），非 Anthropic 官方 API。
这不影响插件加载链路的结论——插件解析、组件注册、MCP 挂载都在客户端侧完成，与模型供应商无关。

**`agy` 版本差异提醒**：Gemini App 内置的 `agy` 与独立安装的 CLI 版本可能不同（本次分别为 1.5.1 与 1.5.16）。
两者的 `plugin` 子命令行为可能随版本演进，复现时请以实际 `agy plugin --help` 输出为准。

