// 零第三方依赖标准 MCP Server（stdio JSON-RPC 2.0），供各 Harness 复用 Figma Bridge、PRD 与视觉对图能力
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { DEFAULT_BRIDGE_URL, checkBridgeStatus, ensureBridgeRunning } from './env-doctor.mjs';
import { computeMenuState, exportPrdBundle, inspectWordDocument, syncPrdToFeishu } from './prd.mjs';
import { computePrototypeMenuState, derivePrototypeFromPrd, exportPrototypeBundle } from './prototype.mjs';
import { computeVisualMenuState, deriveVisualFromPrototype, exportVisualBundle } from './visual-design.mjs';
import { computeDevMenuState, exportDevHandoff } from './dev-handoff.mjs';
import { computeQaMenuState, runChromeAudit } from './qa-verify.mjs';
import { visualDiffPng } from './visual-diff.mjs';

const SERVER_INFO = { name: 'biz-design-agent', version: '2.0.0' };
const PROTOCOL_VERSION = '2024-11-05';

export const MCP_TOOLS = [
  {
    name: 'figma_status',
    description: '检查本地共享 Figma Bridge（:8787）是否在线、Figma 插件是否已连接，以及当前打开的文件与页面信息。如桥未运行会自动拉起。',
    inputSchema: {
      type: 'object',
      properties: {
        autoStart: { type: 'boolean', description: '桥未运行时是否自动在后台拉起（默认 true）' },
      },
    },
  },
  {
    name: 'figma_command',
    description: '通过共享本地桥向 Figma 插件下发任意画布读写/导出命令（全角色通用：ping/list/stats/dump/render/patch/insert/rm/components/instance/swap/styles/link/reactions/export/page）。',
    inputSchema: {
      type: 'object',
      properties: {
        cmd: { type: 'string', description: '插件指令名，例如 ping、list、dump、render、patch、export、page' },
        payload: { type: 'object', description: '传递给插件的 JSON 参数对象' },
      },
      required: ['cmd'],
    },
  },
  {
    name: 'prd_inspect_docx',
    description: '解析用户提供的 Word 需求原稿或参考 PRD 范本（.docx/.doc），提取章节大纲、正文、表格、评审批注及内嵌现状截图。',
    inputSchema: {
      type: 'object',
      properties: {
        docPath: { type: 'string', description: '本地 .docx 或 .doc 文件路径' },
        extractDir: { type: 'string', description: '可选：解出内嵌图片的目录路径' },
      },
      required: ['docPath'],
    },
  },
  {
    name: 'prd_menu_state',
    description: '检查当前 PRD 结构化草稿的完整度与五选项迭代菜单状态（含选项 3 线上搜索与思考是否满足解锁条件）。',
    inputSchema: {
      type: 'object',
      properties: {
        sourcePath: { type: 'string', description: 'prd-source.json 路径' },
      },
      required: ['sourcePath'],
    },
  },
  {
    name: 'prd_export_bundle',
    description: '从统一结构化 PRD 数据源同源生成美观易读的 Figma 单页看板规格（PRD.figma.json）、可编辑 Word 文档（PRD.docx）与飞书同步用 PRD.md。',
    inputSchema: {
      type: 'object',
      properties: {
        sourcePath: { type: 'string', description: 'prd-source.json 路径' },
        outDir: { type: 'string', description: '输出目录路径' },
      },
      required: ['sourcePath', 'outDir'],
    },
  },
  {
    name: 'prd_sync_feishu',
    description: '将同源生成的 PRD.md 同步到飞书云文档（调用 lark-cli docs +create 或 docs +update）。若尚未安装或未初始化飞书 CLI，会返回安装与授权引导。',
    inputSchema: {
      type: 'object',
      properties: {
        mdPath: { type: 'string', description: 'PRD.md 文件路径' },
        title: { type: 'string', description: '可选：飞书文档标题（新建时使用）' },
        docUrl: { type: 'string', description: '可选：已有飞书文档 URL 或 Token（传入则更新原文档，不新建）' },
      },
      required: ['mdPath'],
    },
  },
  {
    name: 'proto_from_prd',
    description: '从已完成的 PRD 数据源自动继承并生成可交互线稿原型草稿（含屏幕、初始点击跳转连线、PRD 依据映射与设计考量说明）。',
    inputSchema: {
      type: 'object',
      properties: {
        prdPath: { type: 'string', description: 'prd-source.json 路径' },
        outProtoPath: { type: 'string', description: '输出的 prototype-source.json 路径' },
      },
      required: ['prdPath', 'outProtoPath'],
    },
  },
  {
    name: 'proto_menu_state',
    description: '检查可交互原型草稿的菜单状态、点击跳转闭环及断链检查（含选项 0 退出当前模式）。',
    inputSchema: {
      type: 'object',
      properties: {
        protoPath: { type: 'string', description: 'prototype-source.json 路径' },
      },
      required: ['protoPath'],
    },
  },
  {
    name: 'proto_export_bundle',
    description: '构建支持 Figma 点击跳转预览（reactions + flowStartingPoints）且附带屏外「PRD 对应关系与设计理由说明卡」的线稿原型规格（Prototype.figma.json + Prototype-Guide.md）。',
    inputSchema: {
      type: 'object',
      properties: {
        protoPath: { type: 'string', description: 'prototype-source.json 路径' },
        outDir: { type: 'string', description: '输出目录路径' },
      },
      required: ['protoPath', 'outDir'],
    },
  },
  {
    name: 'visual_from_proto',
    description: '角色二（美工/UI）：从已确认原型图推导高保真视觉草稿（自动标明团队规范签收态，绝不冒充品牌签收）。',
    inputSchema: {
      type: 'object',
      properties: {
        protoPath: { type: 'string', description: 'prototype-source.json 路径' },
        outVisualPath: { type: 'string', description: '输出的 visual-source.json 路径' },
      },
      required: ['protoPath', 'outVisualPath'],
    },
  },
  {
    name: 'visual_menu_state',
    description: '角色二（美工/UI）：检查高保真视觉模式对话菜单状态（含团队规范状态、全状态覆盖度与 0 退出模式）。',
    inputSchema: {
      type: 'object',
      properties: { visualPath: { type: 'string', description: 'visual-source.json 路径' } },
      required: ['visualPath'],
    },
  },
  {
    name: 'visual_export_bundle',
    description: '角色二（美工/UI）：生成可编辑高保真源稿（Visual.figma.json）、本地样式注册清单（Visual-Styles.json）及规格文档。',
    inputSchema: {
      type: 'object',
      properties: {
        visualPath: { type: 'string', description: 'visual-source.json 路径' },
        outDir: { type: 'string', description: '输出目录路径' },
      },
      required: ['visualPath', 'outDir'],
    },
  },
  {
    name: 'dev_extract_handoff',
    description: '角色三（研发）：从真实 Figma dump 节点树与 PRD 自动提取色值、字阶、圆角、交互热区与定稿文案，输出开发交付包。',
    inputSchema: {
      type: 'object',
      properties: {
        dumpPath: { type: 'string', description: 'Figma dump JSON 路径' },
        outDir: { type: 'string', description: '输出目录路径' },
        prdPath: { type: 'string', description: '可选：关联 prd-source.json 路径' },
      },
      required: ['dumpPath', 'outDir'],
    },
  },
  {
    name: 'dev_menu_state',
    description: '角色三（研发）：检查研发联调模式对话菜单状态（含提测就绪度与 0 退出模式）。',
    inputSchema: {
      type: 'object',
      properties: { statePath: { type: 'string', description: '可选：dev-state.json 路径' } },
    },
  },
  {
    name: 'qa_menu_state',
    description: '角色四（QA & 走查）：检查页面功能验收与视觉对图对话菜单状态（含轮次计数与 0 退出模式）。',
    inputSchema: {
      type: 'object',
      properties: { statePath: { type: 'string', description: '可选：qa-state.json 路径' } },
    },
  },
  {
    name: 'qa_run_audit',
    description: '角色四（QA & 走查）：启动隔离 Headless Chrome 执行声明式页面功能验收、无障碍快照取证与双拍稳定截屏。',
    inputSchema: {
      type: 'object',
      properties: {
        planPath: { type: 'string', description: '验收计划 JSON 路径' },
        outDir: { type: 'string', description: '证据输出目录' },
      },
      required: ['planPath', 'outDir'],
    },
  },
  {
    name: 'visual_diff_png',
    description: '视觉还原对图（全纯 Node，零 Pillow）：比对 Figma 导出的基准 PNG 与浏览器实测 PNG，校验尺寸一致、支持动态区域遮罩并输出差异热力图。',
    inputSchema: {
      type: 'object',
      properties: {
        baselinePath: { type: 'string', description: '已签收设计基准 PNG 路径' },
        actualPath: { type: 'string', description: '实际页面截图 PNG 路径' },
        outDiffPath: { type: 'string', description: '可选：输出差异热力图 PNG 路径' },
        threshold: { type: 'number', description: '单通道像素容差（默认 8）' },
        masks: {
          type: 'array',
          description: '可选：忽略比对的动态区域矩形列表 [{x,y,w,h,reason}]',
          items: { type: 'object' },
        },
      },
      required: ['baselinePath', 'actualPath'],
    },
  },
];

async function callBridgeCmd(cmd, payload = {}) {
  const ensured = await ensureBridgeRunning({ bridgeUrl: DEFAULT_BRIDGE_URL });
  if (!ensured.status?.reachable) {
    return { ok: false, error: `无法连接本地桥 ${DEFAULT_BRIDGE_URL}，请检查端口占用或日志 ${ensured.logFile || ''}` };
  }
  if (!ensured.status.pluginOnline) {
    return {
      ok: false,
      pluginOnline: false,
      error: '本地桥已在线，但 Figma 插件尚未连接。请在 Figma Desktop 中运行 Plugins → Development → FIMG Agent Plugin。',
    };
  }
  const res = await fetch(`${DEFAULT_BRIDGE_URL}/cmd`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmd, payload }),
  });
  return res.json();
}

export async function handleToolCall(name, args = {}) {
  if (name === 'figma_status') {
    const autoStart = args.autoStart !== false;
    const res = autoStart
      ? await ensureBridgeRunning({ bridgeUrl: DEFAULT_BRIDGE_URL })
      : { started: false, reused: false, status: await checkBridgeStatus(DEFAULT_BRIDGE_URL) };
    return res;
  }

  if (name === 'figma_command') {
    return callBridgeCmd(String(args.cmd || ''), args.payload || {});
  }

  if (name === 'prd_inspect_docx') {
    return inspectWordDocument(String(args.docPath), { extractDir: args.extractDir || null });
  }

  if (name === 'prd_menu_state') {
    const raw = JSON.parse(fs.readFileSync(path.resolve(String(args.sourcePath)), 'utf8'));
    return computeMenuState(raw);
  }

  if (name === 'prd_export_bundle') {
    return exportPrdBundle(String(args.sourcePath), String(args.outDir));
  }

  if (name === 'prd_sync_feishu') {
    return syncPrdToFeishu({
      mdPath: String(args.mdPath),
      title: args.title || null,
      docUrl: args.docUrl || null,
    });
  }

  if (name === 'proto_from_prd') {
    const prdAbs = path.resolve(String(args.prdPath));
    const outAbs = path.resolve(String(args.outProtoPath));
    const prdRaw = JSON.parse(fs.readFileSync(prdAbs, 'utf8'));
    const derived = derivePrototypeFromPrd(prdRaw, { prdPath: prdAbs });
    fs.mkdirSync(path.dirname(outAbs), { recursive: true });
    fs.writeFileSync(outAbs, `${JSON.stringify(derived, null, 2)}\n`, 'utf8');
    return { ok: true, proto_source: outAbs, menu_state: computePrototypeMenuState(derived) };
  }

  if (name === 'proto_menu_state') {
    const raw = JSON.parse(fs.readFileSync(path.resolve(String(args.protoPath)), 'utf8'));
    return computePrototypeMenuState(raw);
  }

  if (name === 'proto_export_bundle') {
    return exportPrototypeBundle(String(args.protoPath), String(args.outDir));
  }

  if (name === 'visual_from_proto') {
    const pAbs = path.resolve(String(args.protoPath));
    const oAbs = path.resolve(String(args.outVisualPath));
    const derived = deriveVisualFromPrototype(JSON.parse(fs.readFileSync(pAbs, 'utf8')), { protoPath: pAbs });
    fs.mkdirSync(path.dirname(oAbs), { recursive: true });
    fs.writeFileSync(oAbs, `${JSON.stringify(derived, null, 2)}\n`, 'utf8');
    return { ok: true, visual_source: oAbs, menu_state: computeVisualMenuState(derived) };
  }

  if (name === 'visual_menu_state') {
    const raw = JSON.parse(fs.readFileSync(path.resolve(String(args.visualPath)), 'utf8'));
    return computeVisualMenuState(raw);
  }

  if (name === 'visual_export_bundle') {
    return exportVisualBundle(String(args.visualPath), String(args.outDir));
  }

  if (name === 'dev_extract_handoff') {
    return exportDevHandoff(String(args.dumpPath), String(args.outDir), { prdPath: args.prdPath || null });
  }

  if (name === 'dev_menu_state') {
    const st = args.statePath && fs.existsSync(path.resolve(String(args.statePath)))
      ? JSON.parse(fs.readFileSync(path.resolve(String(args.statePath)), 'utf8'))
      : {};
    return computeDevMenuState(st);
  }

  if (name === 'qa_menu_state') {
    const st = args.statePath && fs.existsSync(path.resolve(String(args.statePath)))
      ? JSON.parse(fs.readFileSync(path.resolve(String(args.statePath)), 'utf8'))
      : {};
    return computeQaMenuState(st);
  }

  if (name === 'qa_run_audit') {
    const plan = JSON.parse(fs.readFileSync(path.resolve(String(args.planPath)), 'utf8'));
    return runChromeAudit({ ...plan, outDir: String(args.outDir) });
  }

  if (name === 'visual_diff_png') {
    return visualDiffPng({
      baselinePath: String(args.baselinePath),
      actualPath: String(args.actualPath),
      outDiffPath: args.outDiffPath || null,
      threshold: typeof args.threshold === 'number' ? args.threshold : 8,
      masks: Array.isArray(args.masks) ? args.masks : [],
    });
  }

  throw new Error(`未知工具：${name}`);
}

export async function handleJsonRpc(msg) {
  const { id, method, params } = msg || {};

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      },
    };
  }
  if (method === 'notifications/initialized') return null;
  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };
  if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: MCP_TOOLS } };

  if (method === 'tools/call') {
    try {
      const data = await handleToolCall(params?.name, params?.arguments || {});
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
          isError: data?.ok === false && !data?.dimensionMismatch ? true : false,
        },
      };
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: `Error: ${err.message}` }],
          isError: true,
        },
      };
    }
  }

  if (id === undefined) return null;
  return {
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  };
}

export function startMcpStdioServer() {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      return;
    }
    const resp = await handleJsonRpc(msg);
    if (resp) {
      process.stdout.write(`${JSON.stringify(resp)}\n`);
    }
  });
}
