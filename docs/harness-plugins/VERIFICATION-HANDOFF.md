# 验证交接单：多 Harness 插件打包

> **给执行二次验证的 AI（Gemini）**：
> 本文是一份**验证任务清单**，不是设计方案。请按 §4 的验证项逐条独立复核，**不要因为本文写了「已实测」就直接采信**。
> 设计细节见 [`README.md`](README.md)；初始规划见 [`PLANNING-BRIEF.md`](PLANNING-BRIEF.md)；DSH 专章见 [`deepseek-harness.md`](deepseek-harness.md)。
>
> **生成时间**：2026-11-25 ｜ **仓库**：`biz-design-agent` dev 分支 ｜ **Baseline commit**：`e23faf9`

---

## 0. 任务说明

目标：把 `biz-design-agent` 打包成一个插件产物，使其能被 **Antigravity / Claude Code / Codex / DeepSeek Harness** 四家安装使用。

本文件汇总**已完成的工作**与**全部发现**，并列出**需要独立验证的点**。

### 当前结论

| Harness | 打包可行性 | 验证程度 |
|---|---|---|
| Antigravity | ✅ 可行 | 管理面已验证（能装/能列/能卸/格式转换） |
| Claude Code | ✅ 可行 | **完整链路已验证**（含本项目真实 MCP） |
| Codex | ⚠️ 插件格式兼容，但**运行时接不通** | 未验证（协议层阻塞） |
| DeepSeek Harness | ✅ 可行但形态不同 | 分发机制已梳理，未实测安装 |

### 核心阻塞

**Codex 无法接入本项目的模型网关**，因为 Codex 只支持 `responses` 协议，而网关只有 Chat Completions。这是唯一的硬阻塞，与登录无关。

---

## 1. 被分发的资产

| 资产 | 位置 | 说明 |
|---|---|---|
| MCP server | `bin/biz-design-agent.mjs` + `src/mcp-server.mjs` | stdio JSON-RPC，**17 个工具** |
| 业务模块 | `src/*.mjs` | **10 个**，MCP server 的依赖 |
| 流程知识 | `src/harness-setup.mjs` 内的 `PRD_SKILL_MD` 常量 | 应抽成 `SKILL.md` |
| Figma 插件 | `plugin/manifest.json` 等 | **任何 harness 都无法自动安装**，必须人工 Import |
| 接入引导 | `dist/bootstrap.md`、`docs/SETUP.md` | 面向「读文档的 AI」 |

版本：`1.5.1`

---

## 2. 全部发现（按可靠性分级）

### 2.1 已实测证实（高可信）

| 编号 | 发现 | 验证手段 |
|---|---|---|
| **D-1** | `agy plugin validate --strict` 对原生格式通过，仅提示缺 logo | 本地执行 |
| **D-2** | `agy plugin install` 落盘 `~/.gemini/config/plugins/<name>`，`list` 报告 `Source` + 组件计数 | 本地执行 |
| **D-3** | **纯 `.claude-plugin/` 格式：`validate` 报错，但 `install` 自动转换并成功**，标记 `Source: claude-code` | 本地执行 |
| **D-4** | 自动转换只搬 `name`/`version`/`description`，`logo`/`suggestedPrompts`/`author` 会丢失 | 对比转换前后 manifest |
| **E-1** | `claude plugin validate` 通过（需 README + LICENSE） | 本地执行 |
| **E-2** | **`${CLAUDE_PLUGIN_ROOT}` 在 `.mcp.json` 的 `args` 中生效** | 真实会话调起 MCP 工具 |
| **E-3** | Claude Code skill 可加载并被执行 | 模型返回 skill 指定标记 |
| **E-4** | Claude Code agent 可加载，命名为 `<plugin>:<agent>` | 调用子代理 |
| **E-5** | **本项目真实 MCP server 在 Claude Code 插件内成功运行**（`figma_status` 返回真实桥数据） | 真实会话 |
| **E-6** | `claude plugin validate` **强制** README（≥40 词）与 LICENSE，缺则失败 | 首次 validate 被拒 |
| **E-7** | 缺图标是 **warning 非 error**；要求方形 PNG/JPEG、512–2048px、< 2MB。validator 会去找 `icon.svg` 但**不作为 listing icon 接受**（SVG/WebP 不可用于商店展示） | validate 提示信息原文 |
| **E-8** | `claude plugin install` **只支持从 marketplace 安装**，不支持本地目录 | 命令帮助文本 |
| **X-1** | **Codex 不强制 OpenAI 登录**：`[model_providers.<id>]` + `env_key` 可在 `Not logged in` 下发起请求 | 实测跑到网络层 |
| **X-2** | Codex 拒绝 Chat Completions 网关，报 `code: 812, 当前模型不支持responses接口` | 实测报错 |
| **X-3** | `wire_api = "chat"` 已被移除，配置加载即失败 | 实测报错 |

### 2.2 文档明确（中可信，未本地验证）

| 编号 | 发现 | 来源 |
|---|---|---|
| A | Codex 可直接读 `.claude-plugin/plugin.json`（无 marketplace 清单时按 standalone 处理） | Codex 官方文档 |
| B | Antigravity 支持多 provider 仓库，`.antigravity-plugin/` 与 `.claude-plugin/` 可共存 | Antigravity 官方文档 |
| C | Antigravity 的 MCP 配置必须是 `mcp_config.json`，用 `${PLUGIN_ROOT}`；Claude/Codex 用 `.mcp.json`，用 `${CLAUDE_PLUGIN_ROOT}` | 三家官方文档 |
| F | Codex 的 `wire_api` 唯一支持值是 `responses` | Codex 官方文档 |
| G | DSH 的分发单元是 npm bundle + Cordis patch，profile 级安装 | DSH 内置文档 |

### 2.3 推断（低可信，需验证）

| 编号 | 推断 | 为何不确定 |
|---|---|---|
| P-1 | Codex 插件内的 skill 目录名沿用 `skills/` | 文档只说「支持 bundled skills」，**未公开目录名** |
| P-2 | Codex 的 `.mcp.json` 是否替换 `${CLAUDE_PLUGIN_ROOT}` | **文档未说明**（只说明 hooks 会设环境变量） |
| P-3 | Antigravity 装 Claude 格式后，skill 在真实会话中可用 | 只验证了安装，未验证运行时 |
| P-4 | DSH 能用 `dsh-mcp-client` 挂载本项目 MCP | 只读文档，未实际安装 bundle |

---

## 3. 关键结论（供复核）

### 3.1 三家可共用一份 manifest

```
.claude-plugin/plugin.json  ──→ Claude Code（原生）
                            ──→ Codex（原生兼容，文档 A）
                            ──→ Antigravity（install 时自动转换，实测 D-3）
```

**但 Antigravity 会丢字段**（D-4），若要 Marketplace 展示需补原生 `.antigravity-plugin/plugin.json`。

### 3.2 唯一无法共享的是 MCP 配置

| Harness | 文件名 | 路径变量 |
|---|---|---|
| Claude Code / Codex | `.mcp.json` | `${CLAUDE_PLUGIN_ROOT}` |
| Antigravity | `mcp_config.json` | `${PLUGIN_ROOT}` |
| DSH | 写在 `cordis.patch.yml` | 绝对路径或 `!!js` 表达式 |

内容结构相同（`mcpServers` 对象），只是文件名和变量名不同。

### 3.3 分发方式因 Harness 而异

| Harness | 安装方式 | 备注 |
|---|---|---|
| Antigravity | `agy plugin install <dir>` | 支持本地目录 |
| Claude Code | `/plugin install <name>@<mp>` | **必须经 marketplace**（E-8） |
| Codex | marketplace（`.agents/plugins/marketplace.json`） | 未验证 |
| DSH | `plugin_manager install_bundle` | 指向 bundle 目录 |

→ 产物**必须**包含 `.claude-plugin/marketplace.json`。

### 3.4 Codex 的硬阻塞

```
网关（Chat Completions） ──✗──→ Codex（仅 responses）
```

四种解法：

| 方案 | 工作量 | 评价 |
|---|---|---|
| 网关侧支持 `/v1/responses` | 需基础设施配合 | 最干净 |
| Chat→Responses 转换代理 | 一个中间服务 | 可控，需维护 |
| 真实 OpenAI API key | 需 Platform 账号 | 按 API 价计费 |
| Codex 暂不支持 | 零 | **建议先走这条** |

理由：Codex 插件格式与 Claude 兼容，产物无需为它单独准备，等能接入了直接复用。

---

## 4. 待验证清单（**请重点执行**）

按优先级排列，每条给出**验证方法**与**预期结果**。

### V-1（高优先）：Antigravity 运行时是否加载 skill

- **方法**：构造含 `skills/<name>/SKILL.md` 的最小插件 → `agy plugin install` → 在真实会话中触发该 skill
- **预期**：skill 内容进入 context，模型按指示输出
- **风险**：可能因账号资格无法建立会话，此路不通则**无法验证**，请如实报告

### V-2（高优先）：Codex 是否读 `skills/` 目录

- **方法**：若 Codex 可登录，装一个含 `skills/` 的插件，用 `@` 菜单看 skill 是否出现
- **预期**：出现即为 P-1 成立
- **备注**：Codex 登录可能受阻，若不可行请说明

### V-3（中）：Codex 的 MCP 路径变量替换

- **方法**：`.mcp.json` 用 `${CLAUDE_PLUGIN_ROOT}`，观察能否启动 MCP server
- **预期**：能启动则 P-2 成立
- **备选**：若 Codex 不可用，可查阅 Codex 源码或更详细的文档

### V-4（中）：Claude Code marketplace 完整流程

- **方法**：建 `.claude-plugin/marketplace.json` → `claude plugin marketplace add <dir>` → `/plugin install`
- **预期**：能永久安装并在新会话生效
- **备注**：本次只验证了 `--plugin-dir` 临时加载，**marketplace 路径未测**

### V-5（中）：DSH bundle 实际安装

- **方法**：按 [`deepseek-harness.md`](deepseek-harness.md) 的 bundle 格式建包 → `plugin_manager install_bundle` → 新会话确认工具出现
- **预期**：`mcp__<serverName>__*` 工具可用
- **备注**：需要 Full access 或审批

### V-6（低）：Antigravity 自动转换的字段保真度

- **方法**：在 `.claude-plugin/plugin.json` 里放 `logo`、`suggestedPrompts`、`author`，install 后检查转换结果
- **预期**：按 D-4 应丢失，确认是否属实

### V-7（低）：`agy` 版本差异

- **观察**：Gemini App 内置 `agy` 1.5.1 与独立 CLI 1.5.16 版本不同
- **方法**：对比两者 `plugin` 子命令行为是否一致
- **目的**：确认本文结论的适用范围

---

## 5. 验证环境（复现参考）

| 工具 | 版本 | 路径 | 状态 |
|---|---|---|---|
| `claude` | 2.1.332 | `~/.local/bin/claude` | ✅ 可用（走自定义网关） |
| `codex` | 0.172.0 | `~/.local/bin/codex` | ❌ 未登录 |
| `agy`（App） | 1.5.1 | `/Applications/Gemini.app/Contents/Helpers/agy` | ✅ 管理面可用 |
| `agy`（CLI） | 1.5.16 | `~/.local/bin/agy` | 未用于实测 |
| `dsh` | 0.2.2-rc.5 | `~/.nvm/.../bin/dsh` | ✅ 可用 |

**注意**：本机 `claude` 的模型请求走的是**自定义网关**（`ANTHROPIC_BASE_URL` 指向第三方端点），非 Anthropic 官方 API。
插件加载链路的结论不受影响（插件解析、组件注册、MCP 挂载都在客户端侧完成），但请知悉此前提。

---

## 6. 已知的历史误导（本文档的自我修正记录）

为避免二次验证踩同样的坑，记录几处**曾被写错后修正**的内容：

| 曾写错 | 实际 | 原因 |
|---|---|---|
| MCP 工具数 18 | **17** | 误把 `SERVER_INFO` 的 name 计入 |
| 「三家 skills 路径完全一致」 | Antigravity/Claude 一致，**Codex 未公开** | 文档证据不足却下了断言 |
| 「需为 Antigravity 单独准备 manifest」 | **不必**，install 会自动转换 | 当时未实测 |
| 「Codex 需要 OpenAI 登录」 | **不需要**，自定义 provider 可绕过 | 当时未实测 |
| 「各 CLI 都未安装」 | claude/codex/agy 后来均已安装 | 环境变化 |

---

## 7. 文档地图

| 文件 | 内容 | 行数 |
|---|---|---|
| **本文件** | 验证交接单（先读） | 本文 |
| [`README.md`](README.md) | 三家架构逐项对比、全部实测细节、风险清单 | 559 |
| [`PLANNING-BRIEF.md`](PLANNING-BRIEF.md) | 决策简报：待决策问题、交付顺序、验收标准 | 192 |
| [`deepseek-harness.md`](deepseek-harness.md) | DSH 四层模型、bundle/preset/skill 写法 | 281 |
| [`raw/`](raw/) | 9 份官方文档原文归档（带来源 URL 与抓取日期） | — |

---

## 8. 给验证者的提醒

1. **不要只读文档就下结论**。本文标注「已实测」的项，请独立复现；标注「文档明确」的项，是对官方文档的转述，可能有理解偏差。
2. **区分「能安装」与「能加载」**。这两件事在所有 harness 上都不同，混为一谈是本次调研中最大的认知陷阱。
3. **Codex 侧的任何进展都是有价值的**。目前它是唯一完全没跑通的一家，若能突破协议限制或找到可用的 Responses 兼容网关，请务必记录。
4. **若发现本文有错**，请直接指出。本文档是协作输入，不是权威结论。
