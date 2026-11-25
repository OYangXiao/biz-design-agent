# DeepSeek Harness 的 Agent 分发机制

> **本文用途**：给另一个 AI 或工程师做二次规划的输入材料。
> **依据**：本机安装的 DSH `0.2.2-rc.5`（profile `web`）自带的 `dsh-doc` skill 参考文档，以及 `plugin_manager` 运行时查询结果。
> **关键区别**：DSH **没有** Antigravity/Claude/Codex 那种「一个插件目录装 skill+MCP+hooks」的形态。它有自己的四层组合模型。

---

## 0. 一句话结论

DSH 里一个「agent」由四层正交单元组成：

| 层 | 单元 | 作用 | 分发载体 |
|---|---|---|---|
| 1 | **Bundle**（npm 包 + `dsh.bundle.patch`） | 唯一的投递载体 | `plugin_manager install_bundle` |
| 2 | **Plugin row**（Host 侧 Cordis 插件） | 提供工具与服务 | bundle patch 的 `insert` 行 |
| 3 | **Agent preset**（`@deepseek-ai/dsh-agent-preset`） | 定义「这个 agent 由哪些能力组合而成」 | 同样是 bundle patch 里的一条声明 |
| 4 | **Skill**（`<name>/SKILL.md`） | 流程知识与操作手册 | 文件系统发现，或 bundle 注入目录 |

**不存在「纯插件目录」的安装方式**——一切都要经过 bundle。

---

## 1. 与另三家 harness 的根本差异

| 维度 | Antigravity / Claude / Codex | DeepSeek Harness |
|---|---|---|
| 分发单元 | 一个目录（含 manifest + 组件） | **npm 包**（bundle）+ Loader patch |
| 安装动作 | 复制/链接目录、或从 marketplace 拉 | `plugin_manager install_bundle`（会跑 pnpm 安装） |
| MCP 挂载 | 写插件内配置文件 | 插入 `@deepseek-ai/dsh-mcp-client` 一行配置 |
| 作用域 | 工作区级（可提交进仓库共享） | **profile 级**（全工作区、全会话共享，重启仍在） |
| Agent 定义 | `agents/<name>.md` 子代理 | **preset** 组合声明（可含 persona + 工具子集 + 策略） |
| skill 发现 | `skills/` 目录 | 文件系统根（见 §4） |
| 配置层级 | 插件内自带 | Host 级 vs preset 级（见 §3） |

> **重要推论**：本项目现有的 `harness-setup.mjs`（逐客户端写 `.mcp.json` / skill 目录）在 DSH 里是**多余的一层**，因为 DSH 的 MCP 挂载是 profile 级一次安装。但它在 Antigravity/Claude/Codex 的**非插件模式下仍然有效**。

---

## 2. 四层详解

### 2.1 Bundle（投递载体）

一个 bundle 就是一个带 `dsh.bundle.patch` 字段的 npm 包：

```json
{
  "name": "@yangxiao/dsh-biz-design-agent",
  "version": "1.5.1",
  "private": true,
  "type": "module",
  "exports": { "./locale/*.json": "./locale/*.json", "./icon": "./icon.svg" },
  "files": ["cordis.patch.yml", "locale/*.json", "docs", "icon.svg"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

- **配置型 bundle**（config-only）：只挂已有插件行，不含任何插件代码。没有 Host/Client 入口文件要求。
- 安装：`plugin_manager` 的 `install_bundle`，`target` 为 bundle 的**绝对路径**。它会自己跑包安装与 bundle 选择，**不要用 shell 手动 pnpm install**。
- 影响范围：**该 profile 下所有会话**，且重启后保留。
- 安装会在 Host 进程执行插件代码，需要 Full access 或审批。
- **不要去写 profile 的 `package.json` / `cordis.patch.yml`，不要在 `$DSH_HOME` 下手工建包。**

### 2.2 Plugin row（Host 侧）

Patch 的形状（来自官方 MCP 模板）：

```yaml
- insert:
    - id: demo-mcp
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: demo
        transport: streamable-http
        url: http://127.0.0.1:3000/mcp
        failOnStartupError: true
```

stdio 形态：

```yaml
- insert:
    - id: biz-design-agent-mcp
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: bizdesign
        transport: stdio
        command: node
        args: ['/abs/path/to/bin/biz-design-agent.mjs', 'mcp']
        failOnStartupError: true
```

工具名会变成 `mcp__bizdesign__<tool>`。

**`dsh-mcp-client` 的配置字段**（节选）：`transport`（必填，`stdio` | `streamable-http`）、`serverName`（必填，`[A-Za-z0-9_-]{1,32}`）、`command`/`args`/`env`/`cwd`、`url`/`headers`。

> **关键限制**：`env` 会**清洗环境变量**。需要密钥时必须用 Loader 的 `!!js` 表达式引用，例如 `GITHUB_TOKEN: !!js process.env.GITHUB_TOKEN`，不能指望继承 ambient env。

### 2.3 Agent preset（「是不是一个专门 agent」）

Preset 就是一条 `@deepseek-ai/dsh-agent-preset` 声明。官方四份 preset（`standard`/`ptc`/`minimal`/`cordis`）位于 `@deepseek-ai/dsh-web-app/presets/*.patch.yml`，`minimal.patch.yml` 最短，可作模板。

声明字段：

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | 小写字母、数字、连字符 |
| `plugins` | 是 | Cordis 入口列表 |
| `name` | 否 | 显示名 |
| `description` | 否 | 描述 |
| `order` | 否 | 名册位置 |

Loader 行 id 惯例为 `preset-<id>`。

示例（用 persona 定身份 + 挂工具）：

```yaml
- insert:
    - id: preset-bizdesign
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: bizdesign
        name: 业务设计 Agent
        description: 五模式业务设计协作：PRD、原型、高保真视觉、研发联调、QA 验收
        order: 20
        plugins:
          - id: persona
            name: '@deepseek-ai/dsh-persona'
            config:
              prefix: |
                你是业务设计 Agent。用户未指定具体任务时展示五模式主菜单……
          - id: tool-bash
            name: '@deepseek-ai/dsh-tool-bash'
```

**改动已存在的 preset 必须用 override，且 `config` 是整体替换而非深合并**——需要把原字段全量重述。

### 2.4 Skill（流程知识）

- 格式：`<name>/SKILL.md` 目录包，或根目录平铺的 `<name>.md`。
- frontmatter 必须含 `name` + `description`；可选 `whenToUse`、`metadata`、`disable-model-invocation`、`user-invocable`。
- **`**/SKILL.md` 嵌套不会被发现**，必须在一级目录。

---

## 3. 放 Host 还是放 preset？（最容易踩的坑）

来自 `compositions.md` 的规则：

> Host plugins supply shared services: tools and prompt registries, the Agent loop, sessions, persistence, settings, sandbox policy, model routes, and subagent backends.
> Preset plugins contribute scoped tools, persona, prompt sections, and policies to those registries.
> **A preset plugin that supplies a service must isolate the provider and all its consumers in the same realm.**
> A service consumed by Host plugins belongs in the Host configuration.

实务建议（保守）：

| 能力 | 放哪 | 理由 |
|---|---|---|
| `dsh-mcp-client` | **Host** | 官方模板即如此；避免 realm 隔离问题 |
| persona / 身份 | preset | 本就是 preset 职责 |
| 工具子集裁剪 | preset | 属策略 |

**代价**：MCP 工具会出现在所有 preset 里。若要做到「只有 bizdesign 这个 agent 才有这些工具」，属工具作用域问题，**需要实测验证**，不能仅凭文档推断。

---

## 4. Skill 发现路径

来自 `@deepseek-ai/dsh-skill-filesystem`：

| 优先级 | 来源 | 路径 |
|---|---|---|
| 100 | `project-dsh` | `<projectRoot>/.dsh/skills` |
| 200 | `project-agents` | `<projectRoot>/.agents/skills` |
| 300 | `custom` | `Config.customSkillDirs` |
| 400 | `user-dsh` | `<dshHome>/skills` |
| 500 | `user-agents` | `<agentsHome>/skills` |
| 600 | bundled | `$DSH_BUNDLED_SKILL_DIR` |

- `projectRoot` = **最近的含 `.git` 的祖先目录**；无 git 时用 cwd。
- 目录被 watch，新增/改名/删除无需重启。
- 若要让 skill 随 bundle 走而非随用户仓库，可覆盖 `dsh-skill-filesystem` 行的 `customSkillDirs`。

> **注意**：`.agents/skills` 这个路径 **Antigravity 和 Codex 也读**（见跨 harness 文档）。这是四家唯一的天然交集。

---

## 5. 本机运行时事实（可复现）

```bash
DSH_PROFILE=web
DSH_INSTALL_DIR=/Users/oyx/.nvm/versions/node/v26.13.1/lib/node_modules/@deepseek-ai/dsh
DSH_PROFILE_DIR=/Users/oyx/.dsh/profiles/web
# CLI 包版本：@deepseek-ai/dsh 0.2.2-rc.5
```

- profile 目录当前只有 `cordis.patch.yml`、`cordis.yml`、`package.json`、`pnpm-workspace.yaml`。
- **尚未安装任何第三方 bundle**（`node_modules` 无 `@local` 包）。
- 已启用的 bundle：`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`。
- `mcp-manager` 行已存在于 web-app bundle（`include:mcp-manager`），但当前无 MCP server 配置。

### 已挂载的 preset（web-app bundle 内）

`preset-standard`、`preset-ptc`、`preset-minimal`、`preset-cordis`。

---

## 6. 与另三家合并的可能性

**结论：DSH 无法与三家共用同一份 manifest，但可以共用同一批源资产。**

| 资产 | 四家能否共用 | 说明 |
|---|---|---|
| MCP server 本体（`bin/` + `src/`） | ✅ 完全共用 | 都是 stdio JSON-RPC |
| skill 的 `SKILL.md` 内容 | ✅ 共用 | frontmatter 要求一致（`name`+`description`） |
| skill 的**放置路径** | 🔶 部分共用 | `.agents/skills` 被 Antigravity/Codex/DSH 读；Claude 读 `.claude/skills`（插件内则是 `skills/`） |
| manifest | ❌ 完全不同 | DSH 用 npm 包 + `cordis.patch.yml`；三家用 JSON manifest |
| hooks | ❌ 不同 | DSH 是 Cordis 插件拦截缝；三家是 `hooks.json` |
| agent 定义 | ❌ 不同 | DSH 用 preset 组合；三家用 `agents/*.md` |

**可执行的合并策略**：建一个 `packaging/` 构建脚本，产出两份产物：

```
packaging/
├── build-harness-plugin.mjs   → dist/plugin/   （Antigravity + Claude + Codex 共用）
└── build-dsh-bundle.mjs       → dist/dsh/      （DSH bundle）
```

两者共享同一份 `skills/biz-design-agent/SKILL.md` 源文件与同一份 `bin/`+`src/`。

---

## 7. 迁移遗留与迁移路径

来自 `compositions.md` 的 legacy preset 说明：

> Before declaration rows, a user preset was a directory `$DSH_HOME/.agent-presets/<id>/` holding `preset.yml` and `agent.cordis.yml`. **Nothing reads that directory any more.**

若本项目将来引入 DSH preset，**必须用新格式**（bundle patch 里的声明），不要参考旧目录结构。

---

## 8. 待确认事项

1. `dsh-mcp-client` 能否放进 preset 以限制工具作用域？需实测。
2. preset 级 `isolate` 对 MCP client 的影响？需读 `host-plugin.md` 深挖。
3. 本项目是否需要在 DSH 里做 `persona`，还是保持 CLI + skill 就够了？
4. `dist/` 目前承载接入引导，DSH bundle 产物放 `dist/dsh/` 是否合适，还是另起目录？

---

## 9. 参考来源

本机安装的 `dsh-doc` skill 参考文件（**不在本仓库内**，路径基于当前安装）：

```
$DSH_INSTALL_DIR/node_modules/@deepseek-ai/dsh-agent-preset/skills/dsh-doc/
├── references/compositions.md      # preset 声明格式（§3 依据）
├── references/mcp-bundle.md        # MCP bundle 最小形态（§2.2 依据）
├── references/plugin-development.md# bundle 编写与安装流程
├── references/packages.md          # 全部可挂载插件包清单（生成自 manifest）
├── references/configuration.md     # 配置与凭据
└── templates/mcp/                  # 配置型 bundle 模板
    ├── package.json
    ├── cordis.patch.yml
    ├── locale/
    ├── docs/DETAIL.md
    └── icon.svg
```

官方 preset 实例：

```
$DSH_INSTALL_DIR/node_modules/@deepseek-ai/dsh-web-app/presets/
├── standard.patch.yml
├── ptc.patch.yml
├── minimal.patch.yml   # 最短，适合当模板
└── cordis.patch.yml
```

> **重要**：这些路径属于本机 DSH 安装，不在 biz-design-agent 仓库内，随 DSH 版本升级会变化。二次规划时若在其他机器上，请用 `references/locate-docs.md` 的方法重新定位。
