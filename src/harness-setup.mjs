// 自动识别当前 AI Harness 并生成对应的原生 MCP、Skill 与工作区规则配置（绝对路径绑定 NODE_BIN）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PKG_ROOT, installLocalPlugin } from './env-doctor.mjs';

export const SUPPORTED_HARNESSES = ['antigravity', 'claude-code', 'cursor', 'trae', 'windsurf', 'generic'];

export function detectHarness({ workspaceDir = process.cwd(), env = process.env, explicit = null } = {}) {
  if (explicit && explicit !== 'auto' && SUPPORTED_HARNESSES.includes(explicit)) {
    return { harness: explicit, confidence: 'explicit', signals: [`--harness=${explicit}`] };
  }

  const signals = [];
  const home = os.homedir();
  const ws = path.resolve(workspaceDir);

  const checks = [
    {
      name: 'antigravity',
      envKeys: ['ANTIGRAVITY_SESSION', 'ANTIGRAVITY_CLI', 'AGY_SESSION', 'AGY_ACCOUNT'],
      wsPaths: ['.agents', '.gemini'],
      homePaths: [path.join(home, '.gemini', 'antigravity')],
    },
    {
      name: 'claude-code',
      envKeys: ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SESSION'],
      wsPaths: ['.claude', 'CLAUDE.md'],
      homePaths: [path.join(home, '.claude')],
    },
    {
      name: 'cursor',
      envKeys: ['CURSOR_TRACE_ID', 'CURSOR_SESSION_ID'],
      wsPaths: ['.cursor', '.cursorrules'],
      homePaths: [path.join(home, '.cursor')],
    },
    {
      name: 'trae',
      envKeys: ['TRAE_SESSION', 'TRAE_IDE'],
      wsPaths: ['.trae'],
      homePaths: [path.join(home, '.trae')],
    },
    {
      name: 'windsurf',
      envKeys: ['WINDSURF_SESSION', 'CODEIUM_ENV'],
      wsPaths: ['.windsurf', '.windsurfrules'],
      homePaths: [path.join(home, '.codeium', 'windsurf')],
    },
  ];

  // 1) 强信号：当前运行环境变量
  for (const c of checks) {
    const hitEnv = c.envKeys.filter((k) => Boolean(env[k]));
    if (hitEnv.length) {
      return { harness: c.name, confidence: 'high', signals: hitEnv.map((k) => `env:${k}`) };
    }
  }

  // 2) 中信号：工作区内已有专属配置目录
  for (const c of checks) {
    const hitWs = c.wsPaths.filter((p) => fs.existsSync(path.join(ws, p)));
    if (hitWs.length) {
      return { harness: c.name, confidence: 'medium', signals: hitWs.map((p) => `workspace:${p}`) };
    }
  }

  // 3) 弱信号：用户主目录已安装客户端
  const homeHits = [];
  for (const c of checks) {
    const hit = c.homePaths.find((p) => fs.existsSync(p));
    if (hit) homeHits.push({ name: c.name, path: hit });
  }
  if (homeHits.length === 1) {
    return { harness: homeHits[0].name, confidence: 'low', signals: [`home:${homeHits[0].path}`] };
  }

  for (const h of homeHits) signals.push(`home:${h.name}`);
  return { harness: 'generic', confidence: 'fallback', signals };
}

function mergeJsonMcp(filePath, serverName, serverDef) {
  let current = {};
  if (fs.existsSync(filePath)) {
    try {
      current = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      current = {};
    }
  }
  if (!current.mcpServers || typeof current.mcpServers !== 'object') {
    current.mcpServers = {};
  }
  current.mcpServers[serverName] = serverDef;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
  return filePath;
}

const PRD_SKILL_MD = `---
name: figma-agent-workflow
description: 多角色业务开发全流程技能（业务设计 PRD & 可点击原型、美工高保真视觉、研发规格提取与提测、QA 功能验收与像素对图，所有模式均带 0 退出切换主菜单）。
---

# figma-agent · 多角色全流程对话菜单

## 顶层主菜单（进入工作区或从任意子模式输入 0 退出时展示）
1. **业务设计 · 开发或更新产品 PRD**（双端输出 Figma 单页看板 + 可编辑 Word）
2. **业务设计 · 生成或迭代可操作预览原型图**（Figma 点击跳转预览 + 线稿细节样式 + 屏外 PRD 映射与设计理由卡）
3. **美工 / UI 设计师 · 制作高保真视觉稿**（团队规范校验 + 本地样式/组件 + 全状态源稿 + 1x 基准图导出）
4. **前端 / 研发人员 · 承接设计稿联调与提测**（从 Figma dump 提取精确规格/定稿文案 + 本地自查 + 提测单）
5. **测试 & 美工走查 · 页面功能验收与设计还原对图**（隔离 Headless Chrome 功能实测 + Figma 基准像素对图 + 退回复验闭环）

## 模式 1 · PRD 编写菜单（含 0 退出）
- 1. 设定/修改需求目标 ｜ 2. 补充资料/截图/外部反馈/内部评审 ｜ 3. 【有目标后解锁】线上搜索与思考补细节 ｜ 4. 提供 PRD 范本 ｜ 5. 手动输入修改 ｜ 6. 预览并输出双端 PRD（完成后可一键衔接模式 2 生成原型图） ｜ **0. 退出当前模式返回主菜单**

## 模式 2 · 可操作原型图菜单（含 0 退出）
- 1. 从 PRD 继承同步（\`proto_from_prd\`） ｜ 2. 增改屏幕与线稿细节样式 ｜ 3. 配置 Figma 点击跳转与预览起点 ｜ 4. 补充屏外 PRD 依据与设计理由说明卡 ｜ 5. 输出到 Figma 原型页（\`proto_export_bundle\`） ｜ **0. 退出当前模式返回主菜单**

## 模式 3 · 美工高保真视觉菜单（含 0 退出）
- 1. 接入/核对团队设计规范（缺规范显式标探索草案） ｜ 2. 从原型导入全状态屏（\`visual_from_proto\`） ｜ 3. 创建/复用 Figma 本地样式与主组件 ｜ 4. 核对真实文案与防裁切自检 ｜ 5. 输出高保真源稿并导出 1x 基准图（\`visual_export_bundle\`） ｜ **0. 退出当前模式返回主菜单**

## 模式 4 · 前端研发联调菜单（含 0 退出）
- 1. 从 Figma dump + PRD 提取开发规格与定稿文案（\`dev_extract_handoff\`） ｜ 2. 对照 PRD 与 QA 退回单梳理改动 ｜ 3. 实现或修改代码 ｜ 4. 本地功能与像素自查 ｜ 5. 锁定 Build ID 生成提测单 ｜ **0. 退出当前模式返回主菜单**

## 模式 5 · QA 功能验收与视觉对图菜单（含 0 退出）
- 1. 配置测试 URL / Build ID 与设计基准屏 ｜ 2. 隔离 Chrome 功能实测（\`qa_run_audit\`，严分 通过/失败/未测） ｜ 3. Figma 基准图 vs 实测图视觉对图（\`visual_diff_png\`） ｜ 4. 生成双轨报告与退回单（可选写 Figma 走查副本页） ｜ 5. 按新 Build ID 同基准复验（保留历史轮次） ｜ **0. 退出当前模式返回主菜单**
`;

const WORKSPACE_AGENTS_SNIPPET = `# figma-agent 工作区协作入口

当用户提出使用 \`figma-agent\`（或从任一子模式输入 \`0\` 退出当前模式）时，展示**顶层五模式主菜单**：
1. 业务设计 · 开发或更新产品 PRD（Figma 单页 + Word）
2. 业务设计 · 生成或迭代可操作预览原型图（Figma 点击跳转 + 线稿细节样式 + PRD 映射与设计理由卡）
3. 美工 / UI 设计师 · 制作高保真视觉稿（团队规范/组件/样式 + 全状态源稿 + 1x 基准图）
4. 前端 / 研发人员 · 承接设计稿联调与提测（Figma dump 规格提取 + 定稿文案 + 提测单）
5. 测试 & 美工走查 · 页面功能验收与设计还原对图（隔离 Chrome 功能验收 + Figma 像素对图 + 退回复验）

- **所有五个子模式菜单**每轮均保留 \`0. 退出当前模式（保存进度，返回主菜单切换角色/任务）\`。
- 工具调用优先使用已配置的 \`figma-agent\` MCP 工具（\`figma_*\` / \`prd_*\` / \`proto_*\` / \`visual_*\` / \`dev_*\` / \`qa_*\` / \`visual_diff_png\`）；未重载 MCP 时也可直接运行 CLI \`figma-agent <子命令>\`。
`;

export function configureHarness({
  workspaceDir = process.cwd(),
  harness = 'auto',
  nodeBin = process.execPath,
  agentEntry = path.join(PKG_ROOT, 'bin', 'figma-agent.mjs'),
  pluginTargetDir = null,
} = {}) {
  const ws = path.resolve(workspaceDir);
  fs.mkdirSync(ws, { recursive: true });

  const detected = detectHarness({ workspaceDir: ws, explicit: harness });
  const chosen = detected.harness;
  const mcpServerDef = {
    command: nodeBin,
    args: [agentEntry, 'mcp'],
  };

  const writtenFiles = [];
  const pluginInfo = pluginTargetDir ? installLocalPlugin(pluginTargetDir) : installLocalPlugin();

  if (chosen === 'claude-code') {
    writtenFiles.push(mergeJsonMcp(path.join(ws, '.mcp.json'), 'figma-agent', mcpServerDef));
    const skillPath = path.join(ws, '.claude', 'skills', 'figma-agent-prd', 'SKILL.md');
    fs.mkdirSync(path.dirname(skillPath), { recursive: true });
    fs.writeFileSync(skillPath, PRD_SKILL_MD, 'utf8');
    writtenFiles.push(skillPath);

    const claudeMd = path.join(ws, 'CLAUDE.md');
    if (!fs.existsSync(claudeMd)) {
      fs.writeFileSync(claudeMd, '@AGENTS.md\n', 'utf8');
      writtenFiles.push(claudeMd);
    }
  } else if (chosen === 'cursor') {
    writtenFiles.push(mergeJsonMcp(path.join(ws, '.cursor', 'mcp.json'), 'figma-agent', mcpServerDef));
    const rulePath = path.join(ws, '.cursor', 'rules', 'figma-agent.mdc');
    fs.mkdirSync(path.dirname(rulePath), { recursive: true });
    fs.writeFileSync(rulePath, `---\ndescription: figma-agent 多角色协作与 PRD 迭代规范\nalwaysApply: true\n---\n\n${WORKSPACE_AGENTS_SNIPPET}`, 'utf8');
    writtenFiles.push(rulePath);
  } else if (chosen === 'antigravity') {
    writtenFiles.push(mergeJsonMcp(path.join(ws, '.mcp.json'), 'figma-agent', mcpServerDef));
    const skillPath = path.join(ws, '.agents', 'skills', 'figma-agent-prd', 'SKILL.md');
    fs.mkdirSync(path.dirname(skillPath), { recursive: true });
    fs.writeFileSync(skillPath, PRD_SKILL_MD, 'utf8');
    writtenFiles.push(skillPath);
  } else if (chosen === 'trae' || chosen === 'windsurf') {
    writtenFiles.push(mergeJsonMcp(path.join(ws, `.${chosen}`, 'mcp.json'), 'figma-agent', mcpServerDef));
  } else {
    writtenFiles.push(mergeJsonMcp(path.join(ws, '.mcp.json'), 'figma-agent', mcpServerDef));
  }

  // 所有 Harness 均确保工作区有 AGENTS.md（已存在则不覆盖用户仓库自有入口）
  const agentsMd = path.join(ws, 'AGENTS.md');
  if (!fs.existsSync(agentsMd)) {
    fs.writeFileSync(agentsMd, WORKSPACE_AGENTS_SNIPPET, 'utf8');
    writtenFiles.push(agentsMd);
  }

  return {
    ok: true,
    harness: chosen,
    detection: detected,
    workspace: ws,
    nodeBin,
    agentEntry,
    mcpServer: mcpServerDef,
    plugin: pluginInfo,
    writtenFiles,
  };
}
