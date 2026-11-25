# R-17 双轮 QA 证据

首轮两项问题在第二轮均未复现。输入：[业务预期](../brief.html)、[默认主管待审设计参考](../design.html)。测试使用官方 Chrome DevTools MCP，两个版本分别启动隔离 Chrome；在任何批准操作之前先打开四个带 `role` 和 `state` 的入口。随后真实点击，并在同一配置中仅传 `role` 重开，未强制指定 `done`。

|业务预期|首轮 build-v1|二轮 build-v2|
|---|---|---|
|客服待审：可查，无按钮|[失败：显示禁用按钮](v1/service-pending.json)|[通过：无按钮](v2/service-pending.json)|
|客服已处理：可查，无按钮|[通过](v1/service-done.json)|[通过](v2/service-done.json)|
|主管待审：可点「批准退款」|[通过](v1/manager-pending.txt)|[通过](v2/manager-pending.txt)|
|主管已处理：无按钮|[通过](v1/manager-done.json)|[通过](v2/manager-done.json)|
|批准后：显示已处理，无再次批准入口|[通过](v1/after-click.png)|[通过](v2/after-click.png)|
|同一单重开：两种身份均已处理，无按钮|通过：[主管](v1/reopen-manager.json)、[客服](v1/reopen-service.json)|通过：[主管](v2/reopen-manager.json)、[客服](v2/reopen-service.json)|
|默认首屏与设计逐像素比较|[按钮下移 20 CSS px](v1/diff.png)，13,983 个不同像素|[0 个不同像素](v2/diff.png)|

R-17、青禾路店、¥28.00 和退款原因在两轮各业务状态均未变化。这里验证的是本地模拟页面的可见行为和浏览器持久状态；不是服务端并发幂等测试，也不代表真实退款或人工签收。

**原始材料。** [首轮详报](v1/report.md)；[首轮设计](v1/design.png)与[首轮实际](v1/default.png)；[二轮设计](v2/design.png)与[二轮实际](v2/default.png)。两轮均为 Chrome 158.0.8127.36、MCP 1.14.0、1280 × 800 CSS px、DPR 1。浅色、顶部、字体就绪后截图，逐 RGBA 像素精确比较，不遮罩；每张默认图的连续复拍均为零波动。两轮设计 PNG 的 SHA-256 相同。差异图仅着色不同像素，因此二轮只有淡色底图。

每轮的 `*.txt` 是无障碍树快照，同名 `*.json` 是页面实际文本、可见按钮与位置；[v1/run.json](v1/run.json)、[v2/run.json](v2/run.json) 列出输入 SHA-256、时间和差异统计。另附交接脚本的独立复跑记录：[v1 断言](replay-v1-1795540259310/run.json)、[v2 断言](replay-v2-1795540259310/run.json)。

## 复跑

在仓库根目录执行。需要 Node 22.12+ 或 Node 24、已安装的桌面 Chrome；非 macOS 默认安装路径请设置 `CHROME_BIN` 为实际浏览器可执行文件。严格复现历史截图还需相同 Chrome、系统和字体。

```sh
QA_TOOLS=$(mktemp -d)
npm install --prefix "$QA_TOOLS" chrome-devtools-mcp@1.14.0 pngjs@7.0.0
export NODE_PATH="$QA_TOOLS/node_modules"
export MCP_BIN="$QA_TOOLS/node_modules/.bin/chrome-devtools-mcp"
node examples/refund-delivery/evidence/replay.mjs v1
node examples/refund-delivery/evidence/replay.mjs v2
```

[脚本](replay.mjs)每次新建 `evidence/replay-版本-时间戳/`，不覆盖原始材料。v1 预期退出码 **1**（已知功能和视觉不符）；v2 预期 **0**。先查 `run.json` 中的 `checks`、`visual`、`sourcesUnchanged` 和截图稳定性，再打开对应快照与 PNG。若中途报工具错误且没有 `run.json`，该次不作验收结论。
