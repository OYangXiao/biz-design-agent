# dev 分支协作入口

用户在工作区明确使用 `biz-design-agent`（或从任一子模式选择 `0. 退出当前模式`）而未指定具体任务时，展示**顶层五模式主菜单**询问：“这次想进入哪个工作模式？1. 业务设计 · 开发或更新 PRD　2. 业务设计 · 生成或迭代可操作预览原型图　3. 美工 / UI · 制作高保真视觉稿　4. 前端 / 研发 · 提取视觉规格联调与提测　5. 测试 & 走查 · 页面功能验收与设计还原对图”：
- **模式 1（开发/更新 PRD）**：进入[角色一 · 编写 PRD](docs/PRD-WORKFLOW.md)，固定菜单 `1~6 + 0. 退出当前模式`，同源输出美观易读的 **Figma 单页 PRD** 与可编辑 **`.docx`**；完成后主动提供一键转入模式 2 的衔接选项。
- **模式 2（生成/迭代可操作预览原型图）**：进入[角色一（第二棒）· 生成可操作原型图](docs/PROTOTYPE-WORKFLOW.md)，固定菜单 `1~5 + 0. 退出当前模式`，产出以线稿为主、辅以必要细节样式、带原生 `reactions` 点击跳转、`flowStartingPoints` 预览起点及屏外「PRD 依据与设计理由」说明卡的可操作原型。
- **模式 3（美工 / UI 高保真视觉稿）**：进入[角色二 · 高保真视觉源稿](docs/VISUAL-DESIGN-WORKFLOW.md)，固定菜单 `1~5 + 0. 退出当前模式`，校验团队规范（缺规范显式标探索草案）、创建本地样式与组件、补齐全状态高保真屏并导出 1x/2x 基准图。
- **模式 4（前端研发联调与提测）**：进入[角色三 · 开发交接与提测](docs/DEV-HANDOFF-WORKFLOW.md)，固定菜单 `1~5 + 0. 退出当前模式`，从真实 Figma `dump` 与 PRD 提取色板/字阶/定稿文案，自查后冻结 `build_id` 生成提测单。
- **模式 5（测试 & 美工走查验收）**：进入[角色四 · 功能验收与视觉对图](docs/QA-VERIFY-WORKFLOW.md)，固定菜单 `1~5 + 0. 退出当前模式`，用隔离 Headless Chrome 实测点击与快照断言（严分通过/失败/未测），结合纯 Node `visual-diff` 对图并保留多轮审计证据。
- 各角色均可按需独立进入，不强制先写 PRD。

先读 [架构方案](docs/DESIGN-AGENT.md)。本仓库不提供默认业务团队、品牌、流程或发布页命名；不从旧截图、生成器或历史说明中推断团队偏好。缺团队规范时可做标明假设的探索稿，不能声称符合其规范。

全栈均已纯 Node 化（零 Python 依赖），统一入口为 `bin/biz-design-agent.mjs`（或 `./fimg prd` / `./fimg proto` / `./fimg visual` / `./fimg dev-handoff` / `./fimg qa` / `./fimg visual-diff` / `./fimg setup` / `./fimg mcp` / `./fimg serve-dist`）。契约与全角色测试运行 `node --test test/design-contract.test.mjs test/prd-workflow.test.mjs test/distribution.test.mjs test/all-roles.test.mjs test/browser-fallback.test.mjs test/consistency.test.mjs`；若修改插件，运行 `./fimg test` 并在目标文件的测试副本做真机验证。不要把合约测试、模拟数据、真实工具调用和设计师签收混为一种证据。
