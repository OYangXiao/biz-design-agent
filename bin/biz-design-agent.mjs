#!/usr/bin/env node
// biz-design-agent 统一纯 Node CLI / MCP / 内网分发入口（零 Python 依赖）
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PKG_ROOT, ensureBridgeRunning, runDoctor } from '../src/env-doctor.mjs';
import { configureHarness } from '../src/harness-setup.mjs';
import { startMcpStdioServer } from '../src/mcp-server.mjs';
import { computeMenuState, exportPrdBundle, inspectWordDocument, syncPrdToFeishu } from '../src/prd.mjs';
import { computePrototypeMenuState, derivePrototypeFromPrd, exportPrototypeBundle } from '../src/prototype.mjs';
import { computeVisualMenuState, deriveVisualFromPrototype, exportVisualBundle } from '../src/visual-design.mjs';
import { computeDevMenuState, exportDevHandoff } from '../src/dev-handoff.mjs';
import { computeQaMenuState, runChromeAudit } from '../src/qa-verify.mjs';
import { visualDiffPng } from '../src/visual-diff.mjs';
import { startDistServer } from '../server/dist-server.mjs';

const [, , cmd = 'help', ...rest] = process.argv;

function flag(args, name, def = null) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return def;
  const next = args[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

function positionals(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      if (args[i + 1] && !args[i + 1].startsWith('--')) i++;
      continue;
    }
    out.push(args[i]);
  }
  return out;
}

function printHelp() {
  console.log(`biz-design-agent — 纯 Node 多角色业务设计 Agent（全栈零 Python）

用法:
  biz-design-agent doctor [--json]                     检测 Node/nvm、npm 源、Figma 客户端与共享桥状态
  biz-design-agent setup [--workspace <dir>] [--harness auto|antigravity|claude-code|cursor|trae|windsurf]
                                                  安装本地插件到 ~/.biz-design-agent/plugin 并自动配置当前 Harness
  biz-design-agent bridge-ensure                       后台自启或复用共享 Figma 本地桥（:8787）
  biz-design-agent mcp                                 启动标准 stdio MCP Server（自动管理共享桥）

  biz-design-agent prd export <source.json> <outDir>   同源生成 Figma 单页 PRD.figma.json、PRD.docx 与 PRD.md
  biz-design-agent prd sync-feishu <PRD.md> [--title "<标题>"] [--doc "<飞书文档URL>"]
                                                  同步 PRD 到飞书云文档（新建或就地更新）
  biz-design-agent prd inspect <doc.docx> [--extract-dir <dir>]
                                                  读取 Word 需求原稿或参考 PRD 范本（正文/表格/批注/嵌图）
  biz-design-agent prd menu-state <source.json>        检查 PRD 对话菜单状态（含选项 3 解锁与 0 退出模式）

  biz-design-agent proto from-prd <prd.json> <proto.json>
                                                  从已完成 PRD 自动继承生成可交互原型草稿
  biz-design-agent proto menu-state <proto.json>       检查原型图对话菜单状态（含断链检查与 0 退出模式）
  biz-design-agent proto export <proto.json> <outDir>  生成带 Figma 点击跳转预览与 PRD 说明卡的 Prototype.figma.json

  biz-design-agent visual from-proto <proto.json> <visual.json>
                                                  从线稿原型推导高保真视觉草稿（模式 3）
  biz-design-agent visual menu-state <visual.json>     检查美工高保真对话菜单状态（含 0 退出模式）
  biz-design-agent visual export <visual.json> <outDir>
                                                  生成高保真源稿 Visual.figma.json 与样式指令

  biz-design-agent dev extract <dump.json> <outDir> [--prd <prd.json>]
                                                  从 Figma dump 与 PRD 提取前端开发规格包（模式 4）
  biz-design-agent dev menu-state <dev-state.json>     检查研发联调对话菜单状态（含 0 退出模式）

  biz-design-agent qa menu-state <qa-state.json>       检查 QA 验收与视觉对图对话菜单状态（含 0 退出模式）
  biz-design-agent qa run <plan.json> <outDir>         启动隔离 Headless Chrome 执行功能验收与截屏取证

  biz-design-agent visual-diff <base.png> <actual.png> [--out <diff.png>] [--threshold 8]
                                                  纯 Node 像素级视觉还原对图（零 Pillow）

  biz-design-agent serve-dist [--port 8790] [--registry <url>] [--scope <@org>] [--node-mirror <url>]
                                                  启动内网分发服务（托管 / 与动态 /bootstrap.md）

  biz-design-agent <status|ping|list|dump|render|patch|export|page|link|...>
                                                  透传全部 Figma 画布读写与导出指令`);
}

async function main() {
  if (cmd === 'help' || cmd === '-h' || cmd === '--help') {
    printHelp();
    return;
  }

  if (cmd === 'mcp') {
    startMcpStdioServer();
    return;
  }

  if (cmd === 'doctor') {
    const info = await runDoctor();
    console.log(JSON.stringify(info, null, 2));
    return;
  }

  if (cmd === 'bridge-ensure') {
    const res = await ensureBridgeRunning();
    console.log(JSON.stringify(res, null, 2));
    if (!res.status?.reachable) process.exit(1);
    return;
  }

  if (cmd === 'setup') {
    const ws = flag(rest, 'workspace', process.cwd());
    const harness = flag(rest, 'harness', 'auto');
    const nodeBin = flag(rest, 'node', process.execPath);
    const agentEntry = fileURLToPath(import.meta.url);
    const result = configureHarness({ workspaceDir: ws, harness, nodeBin, agentEntry });
    const bridge = await ensureBridgeRunning({ nodeBin });
    console.log(JSON.stringify({ ...result, bridge }, null, 2));
    return;
  }

  if (cmd === 'prd') {
    const [sub, ...subRest] = rest;
    const pos = positionals(subRest);
    if (sub === 'export') {
      if (pos.length < 2) {
        console.error('用法：biz-design-agent prd export <prd-source.json> <outDir>');
        process.exit(2);
      }
      console.log(JSON.stringify(exportPrdBundle(pos[0], pos[1]), null, 2));
      return;
    }
    if (sub === 'inspect') {
      if (pos.length < 1) {
        console.error('用法：biz-design-agent prd inspect <doc.docx> [--extract-dir <dir>]');
        process.exit(2);
      }
      const extractDir = flag(subRest, 'extract-dir', null);
      console.log(JSON.stringify(inspectWordDocument(pos[0], { extractDir }), null, 2));
      return;
    }
    if (sub === 'menu-state') {
      if (pos.length < 1) {
        console.error('用法：biz-design-agent prd menu-state <prd-source.json>');
        process.exit(2);
      }
      const raw = JSON.parse(fs.readFileSync(path.resolve(pos[0]), 'utf8'));
      console.log(JSON.stringify(computeMenuState(raw), null, 2));
      return;
    }
    if (sub === 'sync-feishu') {
      if (pos.length < 1) {
        console.error('用法：biz-design-agent prd sync-feishu <PRD.md> [--title "<标题>"] [--doc "<飞书文档URL>"]');
        process.exit(2);
      }
      const title = flag(subRest, 'title', null);
      const docUrl = flag(subRest, 'doc', null);
      const res = syncPrdToFeishu({ mdPath: pos[0], title, docUrl });
      console.log(JSON.stringify(res, null, 2));
      if (!res.ok) process.exit(1);
      return;
    }
    console.error(`未知 prd 子命令：${sub || '(空)'}，可选 export | inspect | menu-state | sync-feishu`);
    process.exit(2);
  }

  if (cmd === 'proto') {
    const [sub, ...subRest] = rest;
    const pos = positionals(subRest);
    if (sub === 'from-prd') {
      if (pos.length < 2) {
        console.error('用法：biz-design-agent proto from-prd <prd-source.json> <out-proto.json>');
        process.exit(2);
      }
      const prdRaw = JSON.parse(fs.readFileSync(path.resolve(pos[0]), 'utf8'));
      const derived = derivePrototypeFromPrd(prdRaw, { prdPath: pos[0] });
      const outPath = path.resolve(pos[1]);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, `${JSON.stringify(derived, null, 2)}\n`, 'utf8');
      console.log(JSON.stringify({ ok: true, proto_source: outPath, menu_state: computePrototypeMenuState(derived) }, null, 2));
      return;
    }
    if (sub === 'menu-state') {
      if (pos.length < 1) {
        console.error('用法：biz-design-agent proto menu-state <prototype-source.json>');
        process.exit(2);
      }
      const raw = JSON.parse(fs.readFileSync(path.resolve(pos[0]), 'utf8'));
      console.log(JSON.stringify(computePrototypeMenuState(raw), null, 2));
      return;
    }
    if (sub === 'export') {
      if (pos.length < 2) {
        console.error('用法：biz-design-agent proto export <prototype-source.json> <outDir>');
        process.exit(2);
      }
      console.log(JSON.stringify(exportPrototypeBundle(pos[0], pos[1]), null, 2));
      return;
    }
    console.error(`未知 proto 子命令：${sub || '(空)'}，可选 from-prd | menu-state | export`);
    process.exit(2);
  }

  if (cmd === 'visual') {
    const [sub, ...subRest] = rest;
    const pos = positionals(subRest);
    if (sub === 'from-proto') {
      if (pos.length < 2) {
        console.error('用法：biz-design-agent visual from-proto <proto.json> <out-visual.json>');
        process.exit(2);
      }
      const protoRaw = JSON.parse(fs.readFileSync(path.resolve(pos[0]), 'utf8'));
      const derived = deriveVisualFromPrototype(protoRaw, { protoPath: pos[0] });
      const outPath = path.resolve(pos[1]);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, `${JSON.stringify(derived, null, 2)}\n`, 'utf8');
      console.log(JSON.stringify({ ok: true, visual_source: outPath, menu_state: computeVisualMenuState(derived) }, null, 2));
      return;
    }
    if (sub === 'menu-state') {
      if (pos.length < 1) {
        console.error('用法：biz-design-agent visual menu-state <visual-source.json>');
        process.exit(2);
      }
      const raw = JSON.parse(fs.readFileSync(path.resolve(pos[0]), 'utf8'));
      console.log(JSON.stringify(computeVisualMenuState(raw), null, 2));
      return;
    }
    if (sub === 'export') {
      if (pos.length < 2) {
        console.error('用法：biz-design-agent visual export <visual-source.json> <outDir>');
        process.exit(2);
      }
      console.log(JSON.stringify(exportVisualBundle(pos[0], pos[1]), null, 2));
      return;
    }
    console.error(`未知 visual 子命令：${sub || '(空)'}，可选 from-proto | menu-state | export`);
    process.exit(2);
  }

  if (cmd === 'dev') {
    const [sub, ...subRest] = rest;
    const pos = positionals(subRest);
    if (sub === 'extract') {
      if (pos.length < 2) {
        console.error('用法：biz-design-agent dev extract <figma-dump.json> <outDir> [--prd <prd.json>]');
        process.exit(2);
      }
      const prdPath = flag(subRest, 'prd', null);
      const designPage = flag(subRest, 'page', '');
      const designFile = flag(subRest, 'file', '');
      console.log(JSON.stringify(exportDevHandoff(pos[0], pos[1], { prdPath, designPage, designFile }), null, 2));
      return;
    }
    if (sub === 'menu-state') {
      const state = pos[0] && fs.existsSync(path.resolve(pos[0]))
        ? JSON.parse(fs.readFileSync(path.resolve(pos[0]), 'utf8'))
        : {};
      console.log(JSON.stringify(computeDevMenuState(state), null, 2));
      return;
    }
    console.error(`未知 dev 子命令：${sub || '(空)'}，可选 extract | menu-state`);
    process.exit(2);
  }

  if (cmd === 'qa') {
    const [sub, ...subRest] = rest;
    const pos = positionals(subRest);
    if (sub === 'menu-state') {
      const state = pos[0] && fs.existsSync(path.resolve(pos[0]))
        ? JSON.parse(fs.readFileSync(path.resolve(pos[0]), 'utf8'))
        : {};
      console.log(JSON.stringify(computeQaMenuState(state), null, 2));
      return;
    }
    if (sub === 'run') {
      if (pos.length < 2) {
        console.error('用法：biz-design-agent qa run <qa-plan.json> <outDir>');
        process.exit(2);
      }
      const plan = JSON.parse(fs.readFileSync(path.resolve(pos[0]), 'utf8'));
      const res = await runChromeAudit({ ...plan, outDir: pos[1] });
      console.log(JSON.stringify(res, null, 2));
      return;
    }
    console.error(`未知 qa 子命令：${sub || '(空)'}，可选 menu-state | run`);
    process.exit(2);
  }

  if (cmd === 'visual-diff') {
    const pos = positionals(rest);
    if (pos.length < 2) {
      console.error('用法：biz-design-agent visual-diff <baseline.png> <actual.png> [--out <diff.png>] [--threshold 8]');
      process.exit(2);
    }
    const outDiffPath = flag(rest, 'out', null);
    const threshold = Number(flag(rest, 'threshold', 8));
    const res = visualDiffPng({ baselinePath: pos[0], actualPath: pos[1], outDiffPath, threshold });
    console.log(JSON.stringify(res, null, 2));
    if (!res.ok) process.exit(1);
    return;
  }

  if (cmd === 'serve-dist') {
    const port = Number(flag(rest, 'port', process.env.FIGMA_AGENT_DIST_PORT || 8790));
    const npmRegistry = flag(rest, 'registry', process.env.FIGMA_AGENT_REGISTRY || '');
    const npmScope = flag(rest, 'scope', process.env.FIGMA_AGENT_SCOPE || '');
    const nodeMirror = flag(rest, 'node-mirror', process.env.FIGMA_AGENT_NODE_MIRROR || '');
    const publicUrl = flag(rest, 'public-url', process.env.FIGMA_AGENT_PUBLIC_URL || '');
    const downloadsDir = flag(rest, 'downloads-dir', process.env.FIGMA_AGENT_DOWNLOADS_DIR || null);
    const info = await startDistServer({ port, npmRegistry, npmScope, nodeMirror, publicUrl, downloadsDir });
    console.log(`biz-design-agent 内网分发服务已启动：http://${info.host}:${info.port}`);
    console.log(`在线引导文档：http://localhost:${info.port}/bootstrap.md`);
    return;
  }

  // 透传所有 Figma 画布操作到 tools/figma.mjs（读/写前自动确保桥已启动）
  if (cmd !== 'status') {
    await ensureBridgeRunning();
  }
  const figmaCli = path.join(PKG_ROOT, 'tools', 'figma.mjs');
  const r = spawnSync(process.execPath, [figmaCli, cmd, ...rest], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

main().catch((err) => {
  console.error(`✖ ${err.message}`);
  process.exit(1);
});
