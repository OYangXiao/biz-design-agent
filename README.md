# 业务设计 Agent · dev

目标是让不同团队用自己的设计资产、业务规则和评审方式，完成原型、设计稿、演示和页面验收。**本分支处于架构验证阶段，不是五项能力均可安装使用的产品。**

| 你要做什么 | 从哪里开始 |
|---|---|
| 在内网服务器启动分发服务（贴 `/bootstrap.md` 给 AI 全自动配 Node/nvm、npm 源、Harness 与 Figma 桥） | `./fimg serve-dist --port 8790 --registry <内网npm源>`（源码见 [dist-server.mjs](server/dist-server.mjs)） |
| 作为业务设计人员编写或更新 PRD（双端输出 Figma 单页 + Word，纯 Node 零 Python） | [模式 1：PRD 迭代工作流](docs/PRD-WORKFLOW.md) · [样例数据源](examples/app-delivery/prd-source.json) |
| 紧接 PRD 生成可点击跳转预览的 Figma 线稿原型图（含 PRD 映射与设计理由说明卡） | [模式 2：可交互原型工作流](docs/PROTOTYPE-WORKFLOW.md) · [原型样例数据源](examples/app-delivery/prototype-source.json) |
| 作为美工 / UI 设计师制作高保真视觉源稿（团队规范/样式组件/全状态基准图） | [模式 3：高保真视觉工作流](docs/VISUAL-DESIGN-WORKFLOW.md) · [视觉样例数据源](examples/app-delivery/visual-source.json) |
| 作为前端 / 研发人员从 Figma 提取规格、联调并生成提测单 | [模式 4：研发联调工作流](docs/DEV-HANDOFF-WORKFLOW.md) |
| 作为测试 / 美工走查执行隔离浏览器功能验收与设计还原像素对图 | [模式 5：功能验收与对图工作流](docs/QA-VERIFY-WORKFLOW.md) |
| 查看全流程四角色真机演练验证报告（真实 Figma + 真实 Headless Chrome） | [四角色模拟验证报告](docs/ROLE-SIMULATION-REPORT.md) |
| 第一次参加 App 需求，想知道四个岗位各交什么 | [阅读 App「收藏文章」培训手册](examples/app-delivery/index.html)：业务设计交 PRD 与原型、美工交视觉稿、开发交测试页、测试跑流程并找美工对图 |
| 评审架构、能力边界和建设顺序 | [架构决策与试点](docs/DESIGN-AGENT.md) |
| 作为设计师提供团队规范或发起一单 | [团队规范与任务卡](docs/TEAM-INTAKE.md) |
| 查看已经验证了什么 | [验证记录](docs/ARCH-VALIDATION.md) |
| 重跑全角色纯 Node 契约与分发实验 | `node --test test/design-contract.test.mjs test/prd-workflow.test.mjs test/distribution.test.mjs test/all-roles.test.mjs` |
| 查历史原型读写能力与真机记录 | [能力手册](docs/CAPABILITIES.md)、[验证记录](docs/ROADMAP.md) |

`plugin/`、`bridge/`、`tools/`、`specs/`、参考图及旧技术手册是上一代原型实验材料；其中的金融示例、页面命名和命令提示不构成新产品默认规范。
