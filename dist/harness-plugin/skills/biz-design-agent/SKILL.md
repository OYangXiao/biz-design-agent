---
name: biz-design-agent
description: 多角色业务开发全流程技能（业务设计 PRD & 可点击原型、美工高保真视觉、研发规格提取与提测、QA 功能验收与像素对图，所有模式均带 0 退出切换主菜单）。当用户提到 biz-design-agent、写 PRD、画可点击原型、做高保真视觉稿、提取 Figma 开发规格、或做页面功能/视觉走查验收时触发。
---

# biz-design-agent · 多角色全流程对话菜单

## 首次使用：Figma 桌面插件引导（仅在 `figma_status` 提示未安装或未连接时触发）

当需要使用 Figma 画布读写能力且 `figma_status` 返回 `pluginOnline: false` 时：
1. 若本机尚未解出 Figma 桌面插件（`figmaPlugin.installed === false`），先向用户确认落盘位置：
   - **默认目录（推荐，Finder / 资源管理器直接可见）**：`~/Documents/BizDesignAgent-FigmaPlugin/`
   - **自定义目录**：用户可指定任意本机目录
2. 确认后调用 `figma_install_plugin`（可传 `targetDir` 与 `reveal: true`），把 `manifest.json`、`code.js`、`ui.html` 复制到目标目录并在系统文件管理器中高亮选中 `manifest.json`。
3. 引导用户在 **Figma Desktop** 完成一次性导入：打开任意设计稿 → 菜单 `Plugins → Development → Import plugin from manifest...` → 选中刚高亮的 `manifest.json` → 运行 `Biz Design Agent` 看到面板显示「已连接」后回复「好了」，再调用 `figma_status` 复测握手。
4. 若用户仅做纯 Node 产物（Word PRD、JSON 草稿、规格提取、QA 浏览器验收或本地 PNG 对图），无需强制连接 Figma。

---

## 顶层主菜单（进入工作区或从任意子模式输入 `0` 退出时展示）

当用户明确使用 `biz-design-agent`（或从任一子模式选择 `0. 退出当前模式`）而未指定具体任务时，展示以下五模式主菜单：

1. **业务设计 · 开发或更新产品 PRD**（同源输出 Figma 单页看板 + 可编辑 Word + 同步飞书文档）→ 细则见 `references/PRD-WORKFLOW.md`
2. **业务设计 · 生成或迭代可操作预览原型图**（Figma 点击跳转预览 + 线稿细节样式 + 屏外 PRD 映射与设计理由卡）→ 细则见 `references/PROTOTYPE-WORKFLOW.md`
3. **美工 / UI 设计师 · 制作高保真视觉稿**（团队规范校验 + 本地样式/组件 + 全状态源稿 + 1x 基准图导出）→ 细则见 `references/VISUAL-DESIGN-WORKFLOW.md`
4. **前端 / 研发人员 · 承接设计稿联调与提测**（从 Figma dump 提取精确规格/定稿文案 + 本地自查 + 提测单）→ 细则见 `references/DEV-HANDOFF-WORKFLOW.md`
5. **测试 & 美工走查 · 页面功能验收与设计还原对图**（隔离 Headless Chrome 功能实测 + Figma 基准像素对图 + 退回复验闭环）→ 细则见 `references/QA-VERIFY-WORKFLOW.md`

- 各角色均可按需独立进入，不强制先写 PRD。
- 不预设团队风格、品牌或命名；缺团队规范时显式标明探索草案，不冒充符合规范。
- 优先调用已挂载的 `biz-design-agent` MCP 工具（`figma_*` / `prd_*` / `proto_*` / `visual_*` / `dev_*` / `qa_*` / `visual_diff_png`）。

---

## 模式 1 · PRD 编写菜单（含 `0` 退出）
- `1.` 设定/修改需求目标 ｜ `2.` 补充资料/截图/飞书文档/外部反馈/内部评审 ｜ `3.` 【有目标后解锁】线上搜索与思考补细节 ｜ `4.` 提供 PRD 范本 ｜ `5.` 手动输入修改 ｜ `6.` 预览并输出三端 PRD（Figma 单页 + Word + 调用 `prd_sync_feishu` 同步飞书云文档，完成后可一键衔接模式 2 生成原型图） ｜ **`0.` 退出当前模式返回主菜单**

## 模式 2 · 可操作原型图菜单（含 `0` 退出）
- `1.` 从 PRD 继承同步（`proto_from_prd`） ｜ `2.` 增改屏幕与线稿细节样式 ｜ `3.` 配置 Figma 点击跳转与预览起点 ｜ `4.` 补充屏外 PRD 依据与设计理由说明卡 ｜ `5.` 输出到 Figma 原型页（`proto_export_bundle`） ｜ **`0.` 退出当前模式返回主菜单**

## 模式 3 · 美工高保真视觉菜单（含 `0` 退出）
- `1.` 接入/核对团队设计规范（缺规范显式标探索草案） ｜ `2.` 从原型导入全状态屏（`visual_from_proto`） ｜ `3.` 创建/复用 Figma 本地样式与主组件 ｜ `4.` 核对真实文案与防裁切自检 ｜ `5.` 输出高保真源稿并导出 1x 基准图（`visual_export_bundle`） ｜ **`0.` 退出当前模式返回主菜单**

## 模式 4 · 前端研发联调菜单（含 `0` 退出）
- `1.` 从 Figma dump + PRD 提取开发规格与定稿文案（`dev_extract_handoff`） ｜ `2.` 对照 PRD 与 QA 退回单梳理改动 ｜ `3.` 实现或修改代码 ｜ `4.` 本地功能与像素自查 ｜ `5.` 锁定 Build ID 生成提测单 ｜ **`0.` 退出当前模式返回主菜单**

## 模式 5 · QA 功能验收与视觉对图菜单（含 `0` 退出）
- `1.` 配置测试 URL / Build ID 与设计基准屏 ｜ `2.` 隔离 Chrome 功能实测（`qa_run_audit`，严分 通过/失败/未测） ｜ `3.` Figma 基准图 vs 实测图视觉对图（`visual_diff_png`） ｜ `4.` 生成双轨报告与退回单（可选写 Figma 走查副本页） ｜ `5.` 按新 Build ID 同基准复验（保留历史轮次） ｜ **`0.` 退出当前模式返回主菜单**
