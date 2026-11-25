#!/usr/bin/env node
// biz-design-agent 统一纯 Node CLI / MCP / 内网分发入口（零 Python 依赖）
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  PKG_ROOT,
  ensureBridgeRunning,
  installLocalPlugin,
  revealInFileManager,
  runDoctor,
} from '../src/env-doctor.mjs';
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

/** 把 doctor 的结构化结果渲染成人类可读报告，浏览器问题单列并附解决步骤。 */
function formatDoctorReport(info) {
  const mark = (ok) => (ok ? '✓' : '✗');
  const lines = [];
  lines.push('biz-design-agent 环境自检');
  lines.push('─'.repeat(52));
  lines.push(`${mark(info.node?.ok)} Node          ${info.node?.recommended?.path || '未找到可用 Node'}${info.node?.recommended?.version ? ` (${String(info.node.recommended.version).replace(/^v/, 'v')})` : ''}`);
  lines.push(`${mark(info.figma?.desktopInstalled)} Figma 客户端   ${info.figma?.desktopInstalled ? info.figma.desktopPath : '未安装（读写画布需要 Figma Desktop）'}`);
  lines.push(`${mark(info.figma?.localPluginInstalled)} 本地插件       ${info.figma?.localPluginInstalled ? info.figma.localManifestPath : `未安装，运行 biz-design-agent setup 解出到 ${info.figma?.localManifestPath || ''}`}`);
  lines.push(`${mark(info.bridge?.reachable)} 本地桥         ${info.bridge?.url || ''}${info.bridge?.reachable ? '' : '（未连通，运行 biz-design-agent bridge-ensure）'}`);
  lines.push(`${mark(info.bridge?.pluginOnline)} 插件在线       ${info.bridge?.pluginOnline ? '已握手' : '未握手，请在 Figma Desktop 中打开插件'}`);

  const b = info.browser;
  if (b) {
    // 跳过探测用「-」而非 ✓，避免让用户误以为浏览器已验证可用
    const stateMark = b.ok === null ? '-' : b.ok ? '✓' : '✗';
    const state = b.ok === null ? '未探测（--no-browser，模式五可用性未知）' : b.ok ? '可用' : '不可用';
    const reason = b.ok === false && b.reason && b.reason !== 'ok' ? `（${b.reason}）` : '';
    lines.push(`${stateMark} 浏览器         ${b.path || '未找到'} → ${state}${reason}`);
    if (b.ok === false) {
      lines.push('');
      lines.push('⚠ 浏览器不可用会影响「模式五：QA 功能验收与视觉对图」。');
      lines.push('  QA 步骤将被标为「未测」，而不是判定为产品缺陷。');
      lines.push('');
      lines.push('  原因：' + String(b.detail || '').trim());
      lines.push('');
      lines.push(String(b.hint || '').split('\n').map((l) => '  ' + l).join('\n'));
    }
  }

  lines.push('─'.repeat(52));
  lines.push(info.ok ? '核心链路就绪（Node + 桥 + 插件在线）' : '核心链路未完全就绪，请按上方提示处理');
  return lines.join('\n');
}

function printHelp() {
  console.log(`biz-design-agent — 纯 Node 多角色业务设计 Agent（全栈零 Python）

用法:
  biz-design-agent doctor [--json] [--no-browser]     检测 Node/便携版 Node、npm 源、Figma 客户端、共享桥与隔离浏览器可用性
                                                  浏览器不可用时给出可选解决方案（QA 验收依赖它）
  biz-design-agent setup [--workspace <dir>] [--harness auto|antigravity|claude-code|cursor|trae|windsurf|generic] [--plugin-dir <dir>]
                                                  解出 Figma 本地插件到 ~/Documents/BizDesignAgent-FigmaPlugin（或指定目录）并配置当前 Harness
  biz-design-agent install-figma-plugin [--dir <dir>] [--reveal]
                                                  仅解出 Figma Desktop 插件到可见目录，并可选在文件管理器中高亮 manifest.json
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

  biz-design-agent serve-dist [--port 8790] [--registry <url>] [--scope <@org>] [--node-mirror <url>] [--portable-node-dir <dir>]
                                                  启动内网分发服务（托管 /、动态 /bootstrap.md 与 /portable-node/）

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
    const asJson = rest.includes('--json');
    const info = await runDoctor({ probeChrome: !rest.includes('--no-browser') });
    if (asJson) {
      console.log(JSON.stringify(info, null, 2));
    } else {
      console.log(formatDoctorReport(info));
    }
    if (info.browser && info.browser.ok === false) process.exitCode = 1;
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
    const pluginTargetDir = flag(rest, 'plugin-dir', null);
    const agentEntry = fileURLToPath(import.meta.url);
    const result = configureHarness({ workspaceDir: ws, harness, nodeBin, agentEntry, pluginTargetDir });
    const bridge = await ensureBridgeRunning({ nodeBin });
    console.log(JSON.stringify({ ...result, bridge }, null, 2));
    return;
  }

  if (cmd === 'install-figma-plugin') {
    const targetDir = flag(rest, 'dir', null);
    const info = installLocalPlugin(targetDir);
    const reveal = rest.includes('--reveal') ? revealInFileManager(info.manifestPath) : null;
    console.log(JSON.stringify({ ok: true, ...info, ...(reveal ? { reveal } : {}) }, null, 2));
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
      // 环境问题导致的「未测」必须在 stderr 明确提示，避免用户误以为产品本身有问题
      if (res.ok === false) {
        console.error('');
        console.error('⚠ 本次验收未能真实执行（所有步骤标记为「未测」，不代表产品缺陷）：');
        console.error('  原因：' + String(res.error || '').trim());
        if (res.hint) {
          console.error('');
          console.error(String(res.hint).split('\n').map((l) => '  ' + l).join('\n'));
        }
        console.error('');
        console.error('  运行 biz-design-agent doctor 可查看完整环境自检与修复建议。');
        process.exitCode = 1;
      }
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
    const portableNodeDir = flag(rest, 'portable-node-dir', process.env.BIZ_DESIGN_PORTABLE_NODE_DIR || null);
    const info = await startDistServer({ port, npmRegistry, npmScope, nodeMirror, publicUrl, downloadsDir, portableNodeDir });
    console.log(`biz-design-agent 内网分发服务已启动：http://${info.host}:${info.port}`);
    console.log(`在线引导文档：http://localhost:${info.port}/bootstrap.md`);
    console.log(`便携版 Node 目录：${info.portableNodeDir}（下载清单：http://localhost:${info.port}/portable-node/index.json）`);
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
