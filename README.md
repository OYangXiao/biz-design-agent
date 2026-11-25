# 业务设计 Agent · dev

让不同团队用自己的设计资产、业务规则和评审方式，完成 PRD、原型、高保真视觉稿、研发联调与页面验收。**本分支处于架构验证阶段，不是五项能力均可安装使用的产品。**

---

## 一、接入（clone 后从这里开始）

**如果你是被要求「接入这个 Agent」的 AI 助手**，请直接读 [**docs/SETUP.md**](docs/SETUP.md)，那里是完整的、带验收清单的接入说明书。

三种接入入口，按你的场景选：

| 你的情况 | 怎么接入 | 读这份 |
|---|---|---|
| 有内网分发服务（HTTP 可达） | 浏览器打开 `http://<服务器>:8790/`，把页面上那句话复制给 AI | [`dist/index.html`](dist/index.html)（预渲染快照） |
| 已 clone 仓库，单机使用 | 三步：`doctor` → `setup` → 在 Figma 里运行插件 | [**docs/SETUP.md**](docs/SETUP.md) |
| 想把接入引导转给别人 | 直接把仓库里预渲染的引导发给他 | [`dist/bootstrap.md`](dist/bootstrap.md) |

### 最短路径（已有 Node ≥ 18）

```bash
cd <本仓库目录>

# 1. 环境自检：会真实检测 Node / Figma / 插件 / 桥 / 浏览器
node bin/biz-design-agent.mjs doctor

# 2. 配置你正在用的 AI 客户端（自动识别 Harness）
node bin/biz-design-agent.mjs setup --workspace <你的工作区目录>

# 3. 在 Figma Desktop 里：Plugins → Development → Import plugin from manifest...
#    选择 ~/Documents/BizDesignAgent-FigmaPlugin/manifest.json，运行 "Biz Design Agent"

# 4. 复测，确认 bridge.pluginOnline = true
node bin/biz-design-agent.mjs doctor
```

> **第 3 步必须人工在 Figma 里操作**，AI 无法代劳。完成后记得**重载 AI 客户端**，MCP 工具才会出现。

### 关于 `dist/`

`dist/` 是分发服务网页的**预渲染快照**，由 `npm run build:dist` 从 `server/dist-server.mjs` 生成并随仓库提交。这样 clone 仓库的 AI 不用先启动服务，读文件就能拿到完整接入引导。

- `dist/bootstrap.md` — 完整接入引导（与在线 `/bootstrap.md` 一致）
- `dist/index.html` — 引导首页（复制口令给 AI）
- `dist/meta.json` — 版本与生成时间

启动真实分发服务（内容与静态版一致，可动态注入内网 npm 源，并自动托管 `portable-node/` 下的便携版 Node 压缩包）：

```bash
./fimg serve-dist --port 8790 --registry <内网npm源>
```

> 部署到内网服务器时，请将官方 Node LTS 便携包放入服务器 `portable-node/` 目录（详见 [`portable-node/README.txt`](portable-node/README.txt)，大体积压缩包已由 `.gitignore` 忽略、不随 Git 提交）。

---

## 二、开始用：五种工作模式

接入完成后，对 AI 说「使用 biz-design-agent」，会看到顶层五模式菜单（各子模式均可用 `0` 退出返回主菜单）：

| 模式 | 角色 | 产出 | 文档 |
|---|---|---|---|
| 1 | 业务设计 | Figma 单页 PRD + 可编辑 Word + 飞书文档同步 | [PRD 工作流](docs/PRD-WORKFLOW.md) |
| 2 | 业务设计 | 可点击跳转的 Figma 线稿原型（含 PRD 映射与设计理由卡） | [原型工作流](docs/PROTOTYPE-WORKFLOW.md) |
| 3 | 美工 / UI | 团队规范校验 + 全状态高保真源稿 + 1x 基准图 | [视觉工作流](docs/VISUAL-DESIGN-WORKFLOW.md) |
| 4 | 前端 / 研发 | Figma 规格与定稿文案提取 + 提测单 | [研发联调工作流](docs/DEV-HANDOFF-WORKFLOW.md) |
| 5 | 测试 / 走查 | 隔离浏览器功能验收 + 设计还原像素对图 | [功能验收工作流](docs/QA-VERIFY-WORKFLOW.md) |

样例数据：[PRD](examples/app-delivery/prd-source.json) · [原型](examples/app-delivery/prototype-source.json) · [视觉](examples/app-delivery/visual-source.json) · [培训手册](examples/app-delivery/index.html)

---

## 三、CLI 速查

```bash
./fimg help                     # 全部命令
node bin/biz-design-agent.mjs doctor [--json] [--no-browser]
node bin/biz-design-agent.mjs setup [--workspace <dir>] [--harness auto|antigravity|claude-code|cursor|trae|windsurf]
node bin/biz-design-agent.mjs bridge-ensure
node bin/biz-design-agent.mjs mcp
./fimg prd export <src.json> <outDir>
./fimg qa run <plan.json> <outDir>
./fimg visual-diff <base.png> <actual.png>
```

`./fimg <子命令>` 是 `node bin/biz-design-agent.mjs` 的便捷包装，两者等价。

---

## 四、开发与验证

```bash
npm test              # 全量单测（契约 + 全角色 + 浏览器降级 + 分发 + 多 Harness 插件 + 一致性）
npm run test:plugin   # 需真实 Figma 环境
npm run build:dist    # 重新生成 dist/ 预打包引导与多 Harness 插件产物
```

`npm test` 会同时校验：版本号与品牌标识全仓一致、`dist/` 产物与代码同步、文档内部链接有效。

---

## 五、其他文档

| 文档 | 内容 |
|---|---|
| [目录与文件结构](docs/STRUCTURE.md) | 仓库目录层级图（Mermaid）、协作链路与各文件功能速查 |
| [接入指南](docs/SETUP.md) | 面向 AI 的完整接入流程与验收清单 |
| [架构决策与试点](docs/DESIGN-AGENT.md) | 设计目标、边界与建设顺序 |
| [能力手册](docs/CAPABILITIES.md) | 能力全表、用法与已知缺口 |
| [画布迭代指南](docs/ITERATING.md) | 在现有稿上迭代的用法 |
| [规格 DSL](docs/SPEC_DSL.md) | 从零生成的规格参考 |
| [团队规范与任务卡](docs/TEAM-INTAKE.md) | 设计师提供规范或发起任务 |
| [四角色真机验证报告](docs/ROLE-SIMULATION-REPORT.md) | 真实 Figma + 真实 Headless Chrome 演练 |
| [多 Harness 插件打包研究](docs/harness-plugins/README.md) | Antigravity / Claude Code / Codex / DSH 的插件架构对比与打包方案 |
| [插件验证交接单](docs/harness-plugins/VERIFICATION-HANDOFF.md) | 已验证 / 待验证项清单与逐条验证方法，供二次复核 |
| [AGENTS.md](AGENTS.md) | 开发者交接（先读这份） |

---

`specs/stock-app.json` 与 `examples/app-delivery/` 仅作引擎测试与流程演练样例，其中的示例产品、页面命名不构成业务默认规范。
