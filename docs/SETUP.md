# 接入指南（给 AI 助手）

本文件是**给 AI 助手读的接入说明书**。如果你是被用户要求「接入 biz-design-agent」的 AI，按本文顺序执行即可，**不要跳过验证步骤，不要谎报成功**。

两种接入方式，按场景选一种：

| 场景 | 用哪种 | 入口 |
|---|---|---|
| 有内网分发服务（HTTP 可达） | **在线方式** | 让用户访问 `http://<服务器>:8790/` |
| 已 clone 本仓库 / 没有分发服务 | **本地方式** | 本文「方式 B」 |
| 只有仓库、但想让别人也接入 | 用仓库内预渲染的 `dist/` | [`dist/bootstrap.md`](../dist/bootstrap.md) |

> `dist/` 下的内容是分发服务网页的**预渲染快照**，与 `biz-design-agent serve-dist` 动态生成的内容一致。所以即使没有服务器，clone 仓库后也能拿到完整的接入引导。

---

## 方式 A：通过分发服务接入（有内网服务器）

1. 向用户确认分发服务地址（形如 `http://10.x.x.x:8790`）。
2. 用 curl 读取在线引导：

   ```bash
   curl -fsSL http://<服务器地址>:8790/bootstrap.md
   ```

3. **严格按该文档的 Step 1 → Step 5 执行**，每步都要真实检测；不通过时给出选项让用户选，不要自动跳过。

若服务未启动，由维护者在服务器上执行：

```bash
cd <仓库目录>
./fimg serve-dist --port 8790 --registry <内网npm源>
```

---

## 方式 B：clone 仓库后本地接入（推荐用于单机/开发）

### B1. 前置检查

```bash
node -v      # 需要 >= 18
```

若 `node` 不存在或版本过低，先让用户决策：自动装 nvm + LTS，还是自行安装。**不要擅自替用户安装系统级软件**。

### B2. 安装并自检（关键步骤，不可省略）

在**仓库根目录**执行：

```bash
cd <仓库目录>
node bin/biz-design-agent.mjs doctor
```

`doctor` 会真实检测：Node、Figma Desktop、本地插件、共享桥、隔离浏览器。

**判定标准**：

| 检查项 | 必须达到 | 未达标时怎么办 |
|---|---|---|
| `node.ok` | `true` | 回到 B1，先解决 Node |
| `figma.desktopInstalled` | `true` | 提示用户安装 Figma Desktop；**没有它无法读写画布** |
| `figma.localPluginInstalled` | `true` | 执行 B3 的 `setup` 解出插件 |
| `bridge.reachable` | `true` | 执行 `node bin/biz-design-agent.mjs bridge-ensure` |
| `bridge.pluginOnline` | `true` | 引导用户在 Figma 里手动运行插件（见 B4） |
| `browser.ok` | `true` | 仅影响「模式五 QA 验收」；按 `doctor` 输出的 `hint` 修复即可，**不阻塞其他四种模式** |

`doctor` 退出码：浏览器不可用时为 `1`，属预期行为，不代表整体不可用。

只想看机器可读结果：

```bash
node bin/biz-design-agent.mjs doctor --json
```

只检查 Node/Figma/桥、跳过浏览器探测（如 CI 环境）：

```bash
node bin/biz-design-agent.mjs doctor --no-browser
```

### B3. 配置当前 AI 客户端（Harness）

```bash
# 自动识别 Harness
node bin/biz-design-agent.mjs setup --workspace <你的工作区目录>

# 或显式指定
node bin/biz-design-agent.mjs setup --workspace <你的工作区目录> --harness claude-code
```

`--harness` 可选值：`auto`（默认）| `antigravity` | `claude-code` | `cursor` | `trae` | `windsurf` | `generic`

**这条命令会做三件事**：

1. 把工作区里对应客户端的 MCP 配置写入（`biz-design-agent` 服务项，绑定 `node` 绝对路径）；
2. 写入该客户端专属的规则/Skill（五模式主菜单的调用约定）；
3. 把 Figma 插件解出到 `~/.biz-design-agent/plugin/`，供 Figma Desktop 导入。

各 Harness 的落盘位置：

| Harness | MCP 配置 | 规则 / Skill |
|---|---|---|
| claude-code | `.mcp.json` | `.claude/skills/biz-design-agent-prd/SKILL.md` + `CLAUDE.md` |
| cursor | `.cursor/mcp.json` | `.cursor/rules/biz-design-agent.mdc` |
| antigravity | `.mcp.json` | `.agents/skills/biz-design-agent-prd/SKILL.md` |
| trae | `.trae/mcp.json` | — |
| windsurf | `.windsurf/mcp.json` | — |
| generic | `.mcp.json` | `AGENTS.md` |

> `setup` **不会覆盖**工作区里已存在的 `AGENTS.md` / `CLAUDE.md`，避免破坏用户自有配置。

### B4. 连接 Figma 画布（必须人工一步）

这一步**必须由用户在 Figma 里手动操作**，AI 无法代劳：

1. 打开 **Figma Desktop**（不是浏览器版），打开任意设计稿；
2. 菜单 `Plugins → Development → Import plugin from manifest...`；
3. 选择 `~/.biz-design-agent/plugin/manifest.json`；
4. 运行 `Biz Design Agent`，面板显示「已连接」即成功。

完成后复测：

```bash
node bin/biz-design-agent.mjs doctor
```

确认 `bridge.pluginOnline` 变为 `true`。

### B5. 重载客户端

MCP 配置是启动时读取的，**配置后需要让用户重启或重载 AI 客户端**，否则工具列表里看不到 `figma_*` / `prd_*` 等工具。

重载后验证：询问 AI「列出你可用的 biz-design-agent 工具」，应能看到 17 项。

---

## 接入完成后的验收清单

逐项确认，全部为 `true` 才算接入成功：

```
[ ] node -v >= 18
[ ] doctor: node.ok = true
[ ] doctor: figma.desktopInstalled = true
[ ] doctor: figma.localPluginInstalled = true
[ ] doctor: bridge.reachable = true
[ ] doctor: bridge.pluginOnline = true
[ ] setup 已写入当前 Harness 的 MCP 配置
[ ] Figma Desktop 插件面板显示「已连接」
[ ] 客户端已重载，工具列表可见 17 项
[ ] （可选，模式五需要）doctor: browser.ok = true
```

**除浏览器外，任何一项为 `false` 都不得向用户宣称接入完成。**

---

## 常见问题

**Q：`doctor` 报 `browser.ok = false`，是不是整个 Agent 不能用了？**

不是。浏览器只用于「模式五：QA 功能验收与视觉对图」。其余四种模式（PRD、原型、高保真视觉、研发联调）不受影响。按 `doctor` 输出的 `hint` 修复即可，常见的三类：

- `not-found`：没装 Chrome/Chromium/Edge → 按提示安装，或 `CHROME_BIN=/path/to/chrome`
- `sandbox-blocked`：浏览器被沙箱拦截 → 换到有完整权限的终端运行，不要在受限容器里直接跑
- `ws-blocked`：能启动但 DevTools 连接被断开 → 查代理对 `127.0.0.1` 高位端口的拦截，或改用官方 Chrome

**Q：`setup` 之后客户端里看不到工具？**

MCP 配置在客户端启动时读取。请重载/重启客户端。若仍不可见，检查 `.mcp.json` 里 `biz-design-agent.args[0]` 的绝对路径是否存在。

**Q：`bridge.reachable = true` 但 `pluginOnline = false`？**

桥起来了，但 Figma 插件没连上。回到 B4，确认插件已在 Figma Desktop 中**运行**（不是只导入）。

**Q：能不用 Figma，只跑纯 Node 的部分吗？**

可以。PRD 双端生成、原型数据生成、视觉数据生成、规格提取都支持纯 Node 产出 JSON/Word/HTML，不依赖 Figma。但「真正写入 Figma 画布」和「导出基准图」需要 B4 完成。

**Q：端口 8787 被占用？**

```bash
BRIDGE=http://localhost:8788 node bin/biz-design-agent.mjs bridge-ensure
```

或直接 `node bin/biz-design-agent.mjs doctor` 查看当前实际端口。

---

## 维护者：更新预打包引导

`dist/` 是生成产物，**不要手工编辑**。修改了 `server/dist-server.mjs` 的引导内容或升了版本号后：

```bash
npm run build:dist
```

`npm test` 会校验 `dist/` 是否与当前代码和版本一致，不一致会直接失败——这是为了防止产物与代码脱节。
