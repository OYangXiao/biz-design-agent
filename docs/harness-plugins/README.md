# 多 Harness 插件打包：架构对比与方案

> **本文用途**：给另一个 AI 或工程师做二次规划的输入材料。
> **依据**：Antigravity / Claude Code / Codex 三家的官方插件文档，原文归档在同目录 [`raw/`](raw/)。
> **抓取日期**：2026-11-25。
> **结论先行**：可以做**一份源码、一次构建、产出三家可装**的插件，因为 Codex 原生兼容 Claude 的插件格式。

---

## 0. 一句话结论

三家的 `skills/` 目录约定**完全一致**，Codex 又**直接支持** `.claude-plugin/plugin.json`。
因此只需要：

- **2 份 manifest**（Claude/Codex 共用一份，Antigravity 单独一份）
- **2 份 MCP 配置**（文件名和路径变量名不同，无法合并）
- **其余全部共享**（skills、agents、scripts、bin）

---

## 1. 三家结构对比

| 维度 | Antigravity | Claude Code | Codex |
|---|---|---|---|
| manifest 路径 | `plugin.json` 或 `.antigravity-plugin/plugin.json` | `.claude-plugin/plugin.json` | `.codex-plugin/plugin.json`，**或复用 `.claude-plugin/plugin.json`** |
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

## 4. 未验证的技术风险（**请重点评估**）

这几项在文档中没有明确答案，是方案落地的真实风险，二次规划时必须覆盖。

### 风险 1：Codex 的 MCP 配置是否做路径变量替换？

- Claude 文档明确：`${CLAUDE_PLUGIN_ROOT}` 在 `command`、`args`、`env` 中替换。
- Antigravity 文档明确：`${PLUGIN_ROOT}` 在 `args`、`cwd`、自定义 `env` 中替换。
- **Codex 文档只说明 hooks 会设置 `PLUGIN_ROOT` / `PLUGIN_DATA` / `CLAUDE_PLUGIN_ROOT` / `CLAUDE_PLUGIN_DATA` 环境变量，没有说明 `.mcp.json` 的 `args` 是否替换。**

**兜底方案**：`command` 用 `node`，`args` 指向 npm 全局包（如 `-y @scope/biz-design-agent mcp`），彻底绕开路径变量。

### 风险 2：`npx` / 全局包的可用性

若走 npm 方案，插件安装后仍需能解析到 CLI。需确认内网 registry 是否可达、是否允许 `npx -y`。

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

### 风险 6：Antigravity / Claude / Codex 的 CLI 本机均未安装

实测本机 `PATH`：

| CLI | 状态 |
|---|---|
| `agy`（Antigravity） | ❌ 未安装 |
| `claude`（Claude Code） | ❌ 未安装 |
| `codex`（Codex） | ❌ 未安装 |
| `cursor`（Cursor） | ❌ 未安装 |
| `dsh`（DeepSeek Harness） | ✅ 已安装（`~/.nvm/.../bin/dsh`） |

**含义**：`agy plugin validate` 与 `claude plugin validate` **在当前机器上都无法执行**。
二次规划若要在本机验证，需先安装相应 CLI；否则只能靠文档对照 + 结构审查，无法做真实的加载测试。

这一条对方案影响最大：**「三家可装」目前是文档层面的结论，尚未经过任何一家的实际加载验证。**

---

## 5. 目标产物结构

```text
dist/plugin/                          # 构建产物（一条命令生成，不手工维护）
├── .claude-plugin/
│   └── plugin.json                   # → Claude Code + Codex
├── .antigravity-plugin/
│   └── plugin.json                   # → Antigravity
├── .agents/
│   └── plugins/
│       └── marketplace.json          # 可选：Codex 本地市场入口
├── skills/
│   └── biz-design-agent/
│       └── SKILL.md                  # ★ 三家共用
├── agents/                           # 可选
├── .mcp.json                         # Claude + Codex
├── mcp_config.json                   # Antigravity
├── bin/                              # CLI + MCP server 入口
├── src/                              # MCP server 依赖模块（必需）
├── plugin/                           # Figma 插件（需人工导入，无法自动安装）
└── README.md
```

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
| 一致性测试 | `test/consistency.test.mjs` | ✅ 应扩展：校验生成的两份 manifest 与源 package.json 版本一致 |

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
