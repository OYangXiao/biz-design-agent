# 二次规划简报：把 biz-design-agent 打包成多 Harness 插件

> **给接手规划的人/AI**：先读这份，再按需深入 [`README.md`](README.md)（架构对比）与 [`deepseek-harness.md`](deepseek-harness.md)（DSH 专章），原始官方文档在同目录 `raw/`。
> **写作时间**：2026-11-25 ｜ **依据 DSH 版本**：0.2.2-rc.5

---

## 一、目标

让一个已存在的业务设计 Agent（`biz-design-agent`）能被四类 harness 的用户安装使用：

1. Google Antigravity
2. Claude Code
3. Codex
4. DeepSeek Harness（DSH）

理想状态：**一份源资产，一条构建命令，产出各家可装产物**。

---

## 二、被分发的资产是什么

现有仓库 `~/Projects/biz-design-agent`（dev 分支，v1.5.1）包含：

| 资产 | 位置 | 性质 |
|---|---|---|
| MCP server（17 个工具） | `bin/biz-design-agent.mjs` + `src/mcp-server.mjs` | stdio JSON-RPC，零第三方依赖 |
| 业务逻辑模块 | `src/*.mjs`（10 个：prd / prototype / visual-design / dev-handoff / qa-verify / env-doctor / harness-setup / visual-diff / zip 等） | MCP server 的依赖 |
| 五模式流程知识 | `src/harness-setup.mjs` 内的字符串常量 `PRD_SKILL_MD` | **应抽成 SKILL.md** |
| Figma 插件 | `plugin/`（manifest.json / code.js / ui.html） | 只能在 Figma Desktop 手动 Import，**任何 harness 插件都无法自动安装** |
| 接入引导 | `dist/bootstrap.md`、`docs/SETUP.md` | 面向「读文档的 AI」 |
| 逐客户端配置脚本 | `src/harness-setup.mjs` 的 `configureHarness()` | 非插件模式兜底；插件模式下冗余 |

---

## 三、核心结论（三条）

### 结论 1：三家（Antigravity/Claude/Codex）可合并为一份产物

- **Codex 原生兼容 Claude 格式**：目录下有 `.claude-plugin/plugin.json` 即可（且无 marketplace 清单时按 standalone plugin 处理）。原始引用见 [`raw/codex-marketplace-sync.md`](raw/codex-marketplace-sync.md)。
- **Antigravity 官方支持多 provider 仓库**：`.antigravity-plugin/plugin.json` 与 `.claude-plugin/plugin.json` 可共存，且文档专门列出「别家文件被安全忽略」的表。见 [`raw/antigravity-build-plugins.md`](raw/antigravity-build-plugins.md)。
- **Antigravity 还会自动转换 Claude 格式（已实测）**：纯 `.claude-plugin/plugin.json` 在 `agy plugin validate` 下会报错，但 `agy plugin install` 能成功安装并自动生成根 `plugin.json`，`plugin list` 标记 `Source: claude-code`。详见 [`README.md`](README.md) 的「发现 D」。

→ 首发只需 **1 份 manifest + 2 份 MCP 配置**，其余共享。

> **转换的代价**：自动转换只搬运 `name` / `version` / `description`，`logo`、`suggestedPrompts`、`author` 等 Antigravity 专有字段会丢失。要上 Marketplace 展示时才需要补原生 `.antigravity-plugin/plugin.json`。

### 结论 2：DSH 无法并入同一产物

DSH 没有「插件目录」概念，只有 **npm bundle + Cordis patch**，且是 **profile 级**安装。
但它可以与三家**共享同一批源资产**：MCP server 代码、SKILL.md 内容。

→ 需要**独立的第二个构建目标** `dist/dsh/`。

### 结论 3：验证进度——Antigravity 管理面已验证，其余未验证

| 验证项 | 状态 |
|---|---|
| `agy plugin validate` / `install` / `list` / `uninstall` | ✅ **已实测通过** |
| Antigravity 自动转换 Claude 格式 | ✅ **已实测通过** |
| 插件在**真实模型会话**中被正确加载（skill 进 context、MCP 工具注册） | ❌ 未验证 |
| Claude Code 插件加载 | ❌ 未验证（本机无 `claude` CLI） |
| Codex 插件加载 | ❌ 未验证（本机无 `codex` CLI） |

**关键区分**：已验证的是 Antigravity 的**管理面**（能装、能列、能卸、组件计数正确），**不等于运行时可用**。

规划时仍应把「真实会话验证」作为独立交付物。

---

## 四、唯一无法共享的技术细节

MCP 配置的文件名与路径变量不同：

| Harness | 文件名 | 插件根变量 |
|---|---|---|
| Claude Code / Codex | `.mcp.json` | `${CLAUDE_PLUGIN_ROOT}` |
| Antigravity | `mcp_config.json` | `${PLUGIN_ROOT}` |
| DSH | 不适用（写在 `cordis.patch.yml`） | 绝对路径或 `!!js` 表达式 |

内容结构相同（`mcpServers` 对象）。

---

## 五、需要决策的 6 个问题

### Q1. MCP server 如何定位？（最关键）

| 选项 | 做法 | 优点 | 缺点 |
|---|---|---|---|
| **A. 内联进插件** | `args: ["${CLAUDE_PLUGIN_ROOT}/bin/biz-design-agent.mjs","mcp"]` | 自包含，无需发版 | 依赖各家的路径变量替换；**Codex 是否替换未在文档中确认** |
| **B. 发内网 npm** | `args: ["-y","@scope/biz-design-agent","mcp"]` | 跨 harness 无差异，最稳 | 需先发版；要求 registry 可达 |

> 建议规划时**默认选 B**，A 作为体验优化增量。理由：路径变量是三家中唯一证据不齐的一环。

### Q2. Codex 是否需要 marketplace 入口？

- 只有 `.claude-plugin/plugin.json` → 可作 standalone plugin
- 团队分发 → 需 `.agents/plugins/marketplace.json`

### Q3. 是否纳入 Cursor？

Antigravity 文档提到 `.cursor-plugin/plugin.json` 也是可共存位置，但**本轮未抓取 Cursor 官方文档**，属未验证项。

### Q4. skill 拆分粒度？

- 单个 `biz-design-agent` skill 承载五模式
- 或拆 5 个（prd / prototype / visual / dev-handoff / qa）按需加载

后者省 context，但顶层主菜单逻辑需要额外落点。

### Q5. DSH 侧做到哪一步？

- 仅挂 MCP（`dsh-mcp-client` 一行）——最小可用
- 再加 `agent-preset`（带 persona）——成为「专门的 agent」
- 再加 skill——完整

### Q6. 现有 `harness-setup.mjs` 如何处置？

插件化后对新三家冗余，但仍是非插件场景（其它 harness、纯 CLI 用户）的兜底。建议保留但降级为次要路径。

---

## 六、建议的交付顺序

1. **抽 skill**：把 `PRD_SKILL_MD` 从 `harness-setup.mjs` 移到 `skills/biz-design-agent/SKILL.md`（零风险，纯重构）
2. **写构建脚本**：`packaging/build-harness-plugin.mjs` → `dist/plugin/`
3. **本地静态校验**：JSON schema、路径存在性、版本一致性（可自动化，不需装 CLI）
4. **Antigravity 落地验证**：`agy plugin validate` → `agy plugin install` → `agy plugin list` 确认组件计数（**管理面，已验证可行**）
5. **运行时验证**（需占用一次模型会话）：确认 skill 进入 context、MCP 工具出现在工具表
6. **Claude Code / Codex 验证**（需装对应 CLI）
7. **导出 DSH bundle**：`packaging/build-dsh-bundle.mjs` → `dist/dsh/`
8. **更新文档**：`docs/SETUP.md` 增加四条安装路径

> 第 4 步与第 5 步是两件事：能安装不等于能加载。已实测的只是第 4 步。

---

## 七、验收标准建议

| 项 | 判定 |
|---|---|
| 版本一致 | 生成的 manifest `version` == `package.json` 的 `version` |
| 路径有效 | manifest 引用的每个文件真实存在 |
| Antigravity 可装 | `agy plugin install` 成功且 `plugin list` 显示正确组件数 |
| MCP 可启动 | 插件安装后 MCP server 能完成 `initialize` 握手 |
| 工具可见 | 用户侧能看到全部 17 个工具（或明确说明可见数量） |
| skill 可加载 | `@` 菜单或 `/` 命令能看到该 skill |
| 无静默失败 | 失败时必须给出可操作提示（参考现有 `qa-verify.mjs` 的降级模式） |

---

## 八、已知的坑（摘自本项目历史经验）

1. **`env` 会被清洗**：DSH 的 `dsh-mcp-client` 与 Claude 的 MCP 配置都可能清洗环境变量，密钥必须显式引用。
2. **preset override 是整体替换**，不是深合并。
3. **已存在的会话保留旧插件版本**：改完必须开新会话验证。
4. **Figma 插件永远在 harness 之外**：只能人工 Import，文档要写死这一点。
5. **`dist/` 已被占用**：现用于接入引导，插件产物需另起子目录，避免概念混淆。
6. **命名冲突**：仓库已有的 `plugin/` 目录是 **Figma 插件**，与 harness 插件同名但完全不同，产物目录务必区分。

---

## 九、文档地图

| 文件 | 内容 |
|---|---|
| 本文件 | 决策简报（先读） |
| [`README.md`](README.md) | 三家架构逐项对比、目标结构、7 项风险 |
| [`deepseek-harness.md`](deepseek-harness.md) | DSH 四层模型、bundle/preset/skill 写法、本机运行时事实 |
| [`raw/`](raw/) | 9 份官方文档原文归档（含来源 URL 与抓取日期） |

**抓取限制**（已知）：
- `developers.openai.com/plugins/build/plugins` 返回 403，Codex 侧改用 `learn.chatgpt.com` 的 `llms-full.txt` 抽取
- 未抓取 Cursor 官方文档
