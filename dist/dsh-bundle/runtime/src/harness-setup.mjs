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

function loadCanonicalSkillMarkdown() {
  const candidates = [
    path.join(PKG_ROOT, 'skills', 'biz-design-agent', 'SKILL.md'),
    path.resolve(PKG_ROOT, '..', 'skills', 'biz-design-agent', 'SKILL.md'),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      return fs.readFileSync(file, 'utf8');
    }
  }
  return `---
name: biz-design-agent
description: 多角色业务开发全流程技能（PRD、原型、高保真视觉、研发联调、QA 验收，含 0 退出主菜单）。
---

# biz-design-agent · 多角色全流程对话菜单
`;
}

const PRD_SKILL_MD = loadCanonicalSkillMarkdown();

const WORKSPACE_AGENTS_SNIPPET = `# biz-design-agent 工作区协作入口

当用户提出使用 \`biz-design-agent\`（或从任一子模式输入 \`0\` 退出当前模式）时，展示**顶层五模式主菜单**：
1. 业务设计 · 开发或更新产品 PRD（Figma 单页 + Word）
2. 业务设计 · 生成或迭代可操作预览原型图（Figma 点击跳转 + 线稿细节样式 + PRD 映射与设计理由卡）
3. 美工 / UI 设计师 · 制作高保真视觉稿（团队规范/组件/样式 + 全状态源稿 + 1x 基准图）
4. 前端 / 研发人员 · 承接设计稿联调与提测（Figma dump 规格提取 + 定稿文案 + 提测单）
5. 测试 & 美工走查 · 页面功能验收与设计还原对图（隔离 Chrome 功能验收 + Figma 像素对图 + 退回复验）

- **所有五个子模式菜单**每轮均保留 \`0. 退出当前模式（保存进度，返回主菜单切换角色/任务）\`。
- 工具调用优先使用已配置的 \`biz-design-agent\` MCP 工具（\`figma_*\` / \`prd_*\` / \`proto_*\` / \`visual_*\` / \`dev_*\` / \`qa_*\` / \`visual_diff_png\`）；未重载 MCP 时也可直接运行 CLI \`biz-design-agent <子命令>\`。
`;

export function configureHarness({
  workspaceDir = process.cwd(),
  harness = 'auto',
  nodeBin = process.execPath,
  agentEntry = path.join(PKG_ROOT, 'bin', 'biz-design-agent.mjs'),
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
    writtenFiles.push(mergeJsonMcp(path.join(ws, '.mcp.json'), 'biz-design-agent', mcpServerDef));
    const skillPath = path.join(ws, '.claude', 'skills', 'biz-design-agent-prd', 'SKILL.md');
    fs.mkdirSync(path.dirname(skillPath), { recursive: true });
    fs.writeFileSync(skillPath, PRD_SKILL_MD, 'utf8');
    writtenFiles.push(skillPath);

    const claudeMd = path.join(ws, 'CLAUDE.md');
    if (!fs.existsSync(claudeMd)) {
      fs.writeFileSync(claudeMd, '@AGENTS.md\n', 'utf8');
      writtenFiles.push(claudeMd);
    }
  } else if (chosen === 'cursor') {
    writtenFiles.push(mergeJsonMcp(path.join(ws, '.cursor', 'mcp.json'), 'biz-design-agent', mcpServerDef));
    const rulePath = path.join(ws, '.cursor', 'rules', 'biz-design-agent.mdc');
    fs.mkdirSync(path.dirname(rulePath), { recursive: true });
    fs.writeFileSync(rulePath, `---\ndescription: biz-design-agent 多角色协作与 PRD 迭代规范\nalwaysApply: true\n---\n\n${WORKSPACE_AGENTS_SNIPPET}`, 'utf8');
    writtenFiles.push(rulePath);
  } else if (chosen === 'antigravity') {
    writtenFiles.push(mergeJsonMcp(path.join(ws, '.mcp.json'), 'biz-design-agent', mcpServerDef));
    const skillPath = path.join(ws, '.agents', 'skills', 'biz-design-agent-prd', 'SKILL.md');
    fs.mkdirSync(path.dirname(skillPath), { recursive: true });
    fs.writeFileSync(skillPath, PRD_SKILL_MD, 'utf8');
    writtenFiles.push(skillPath);
  } else if (chosen === 'trae' || chosen === 'windsurf') {
    writtenFiles.push(mergeJsonMcp(path.join(ws, `.${chosen}`, 'mcp.json'), 'biz-design-agent', mcpServerDef));
  } else {
    writtenFiles.push(mergeJsonMcp(path.join(ws, '.mcp.json'), 'biz-design-agent', mcpServerDef));
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
