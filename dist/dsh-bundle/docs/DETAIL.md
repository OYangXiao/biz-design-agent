# 业务设计 Agent (v1.5.1)

一套覆盖业务设计、UI 视觉、前端研发与 QA 验收的全流程协作插件，直接复用 DeepSeek Harness 内置 Node 运行时，**无需单独安装 Node.js 或 Python**。

## 安装后如何使用

1. 启用本插件后，直接对 AI 说：**「打开 biz-design-agent 主菜单」**，即可在五种角色模式中自由切换。
2. 如需读写 Figma 画布（模式 1~3），首次使用时让 AI 调用 `figma_install_plugin` 把 Figma 桌面插件复制到 `~/Documents/BizDesignAgent-FigmaPlugin/`（或你指定的目录），在 Figma Desktop 中通过 `Plugins → Development → Import plugin from manifest...` 导入一次即可。
3. 纯文档（Word PRD / JSON / 规格提取）与浏览器 QA 验收无需连接 Figma。
