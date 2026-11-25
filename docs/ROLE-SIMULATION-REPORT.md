# 全流程四角色真机模拟验证报告 · 2026-11-25

本轮以虚构训练需求「日间阅读 App · 文章收藏与我的收藏夹」贯穿 **5 个工作模式（4 个业务研发岗位）**，在**真实 Figma Desktop 测试文件（`Untitled`）**与**真实隔离 Headless Chrome（`Google Chrome 158.0.8127.36`）**上完成了端到端角色模拟演练。

> **证据分层声明（严格不混淆证据等级）**：
> - **已实测**：纯 Node 契约与插件单元测试、真实 Figma 客户端画布渲染/样式注册/交互连线读回/1x PNG 导出、真实隔离 Headless Chrome 点击断言与双拍像素对图。
> - **未测 / 待人工**：本轮为虚构阅读 App 演练数据，**不代表真实业务团队规范接入或真人设计师/业务负责人签收**；内网多台新机器上的 `bootstrap.md` 实装待填入正式内网 npm registry 地址后实地复验。

---

## 一、四角色真机演练实测结果总览

| 阶段与角色 | 对应工作模式 | 真实落盘与工具调用结果 | 关键核验指标 |
|---|---|---|---|
| **角色一 A · 业务设计（PRD）** | 模式 1：[PRD 工作流](PRD-WORKFLOW.md) | 同步生成 `PRD.docx` 与单页 `PRD.figma.json`，真机写入 Figma 页 **`01 PRD · 文章收藏`** | 静态校验 `问题数: 0`；Figma 真机渲染 **275 个节点**，内嵌 2 张真实基准图，`.docx` 经 macOS `textutil` 与纯 Node `inspect` 双重回读通过；目视审查后修复 Screen 02 按钮折行裁切 |
| **角色一 B · 业务设计（可交互原型）** | 模式 2：[原型工作流](PROTOTYPE-WORKFLOW.md) | 真机写入 Figma 页 **`02 原型 · 可点击预览线稿`**（4 张 `390×844` 顶层设备屏 + 4 张屏外 PRD 依据与设计理由说明卡 + 顶部预览总览） | 静态连线校验 `0 问题`；真机挂载并通过 `reactions` 读回 **10/10 条 `ON_CLICK` 点击跳转**与 **1 个 `flowStartingPoints`（`▶` 入口）**；真机联调期间捕获并修复了 Figma 原生 `DirectionalTransition`（`PUSH`）缺 `direction` 字段的真实插件缺陷 |
| **角色二 · 美工 / UI 设计师** | 模式 3：[视觉工作流](VISUAL-DESIGN-WORKFLOW.md) | 登记 7 个本地 Paint/Text Styles（`DaylightReading/*`），真机写入 Figma 页 **`03 视觉稿 · 高保真源稿`**（标明「探索草案 · 未宣称品牌签收」），导出 4 张真实 1x `390×844` 基准 PNG | 真机渲染 **207 个节点**、**8 条**高保真点击跳转；目视审图修复了 `Menlo` 字体丢失中文「篇」字以及彩色 Emoji 破坏版式统一两处视觉瑕疵 |
| **角色三 · 前端 / 研发人员** | 模式 4：[研发交接工作流](DEV-HANDOFF-WORKFLOW.md) | 直接消费真机 `03 视觉稿` 页的 `live-visual-dump.json` + PRD，自动生成开发规格包 `Dev-Handoff.md` / `.json` 及两轮提测单（`sim-build-v1` / `sim-build-v2`） | 自动抽出 **4 屏视口、10 个精确色值、23 组字阶排版**与全部定稿正文文案 |
| **角色四 · QA 测试 & 美工走查** | 模式 5：[验收与对图工作流](QA-VERIFY-WORKFLOW.md) | 零依赖启动隔离 Headless Chrome（`390×844 @1x`）跑两轮 7 步功能实测 + 连续双拍稳定度验证 + 纯 Node 像素对图，并把走查对比板写入独立副本页 **`04 走查记录 · 功能与对图报告`**（不改动已签收 `03 视觉稿`） | **Round 1（`sim-build-v1`）**：功能 **6/7**（成功拦截第 3 步列表缺文章故障），双拍稳定 0 抖动，同基准视觉差异 **20,549 px**（红区精准命中按钮右移 8px 与旧样文正文）→ 退回研发；<br>**Round 2（`sim-build-v2`）**：功能 **7/7 全部通过**，同基准视觉差异降至 **0 px（0.00%）**；跨引擎对照 Figma 1x 导出图差异由 39,540 px 降至 35,063 px（诚实保留 Figma 与 Chrome 字体/SVG 细微光栅化差异记录） |

---

## 二、真机演练产物索引

> **注意**：以下产物均生成在 `out/live-simulation/` 下，而 `out/` 已被 `.gitignore` 忽略、不随仓库分发。
> 因此在克隆后的仓库中这些链接**不可点击**属于预期行为——它们记录的是当次真机演练的落盘位置，
> 需在本机重新执行对应角色流程后才会实际存在。本文的文字结论不依赖这些文件。

- 演练汇总数据：[simulation-summary.json](../out/live-simulation/simulation-summary.json)
- 角色一（PRD）：[PRD.docx](../out/live-simulation/01-prd/PRD.docx) · [Figma 单页导图](../out/live-simulation/01-prd/figma-exports/PRD_单页看板_·_日间阅读_App_·_文章收藏与我的收藏夹_PRD.png)
- 角色一（可交互线稿原型）：[Prototype-Guide.md](../out/live-simulation/02-prototype/Prototype-Guide.md) · [首屏线稿导图](../out/live-simulation/02-prototype/figma-exports/01_文章详情页_·_未收藏.png) · [屏外 PRD 与设计理由卡](../out/live-simulation/02-prototype/figma-exports/PRD映射与设计说明_·_01_文章详情页_·_未收藏.png)
- 角色二（高保真视觉）：[Visual-Spec.md](../out/live-simulation/03-visual/Visual-Spec.md) · [1x 基准首屏](../out/live-simulation/03-visual/figma-baselines-1x/01_高保真详情_·_未收藏.png) · [1x 列表页](../out/live-simulation/03-visual/figma-baselines-1x/03_高保真列表_·_含_1_篇收藏.png)
- 角色三（研发交接）：[Dev-Handoff.md](../out/live-simulation/04-dev-handoff/Dev-Handoff.md)
- 角色四（两轮 QA 与视觉对图）：[交互式 HTML 验收报告](../out/live-simulation/05-qa-verify/qa-report.html) · [Figma 走查看板导图](../out/live-simulation/05-qa-verify/figma-exports/QA_走查与设计对图报告_·_日间阅读_·_文章收藏.png)

---

## 三、复跑方式

- 重跑全部离线契约、纯 Node 分发、隔离 Chrome 与插件单元测试：
  ```bash
  node --test test/design-contract.test.mjs test/prd-workflow.test.mjs test/distribution.test.mjs test/all-roles.test.mjs
  ./fimg test
  ```
- 连接空白 Figma 测试文件后重跑全流程真机模拟：
  ```bash
  node scripts/run-live-role-simulation.mjs
  ```
