// DeepSeek Harness Host 插件入口：零硬编码路径，自动复用 DSH 内置 Node 运行时挂载 MCP 与 Skill
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BUNDLE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const AGENT_ENTRY = path.join(BUNDLE_ROOT, 'runtime', 'bin', 'biz-design-agent.mjs');
const SKILLS_DIR = path.join(BUNDLE_ROOT, 'skills');

async function loadDshPackage(pkgName) {
  try {
    const mod = await import(pkgName);
    return mod.default || mod;
  } catch {
    // 回退到当前运行中的 DSH 进程入口目录解析内置包（兼容本地目录安装、.tgz 安装与 --patch 加载）
    const anchors = [];
    if (process.argv[1]) {
      try { anchors.push(fs.realpathSync(process.argv[1])); } catch { anchors.push(process.argv[1]); }
    }
    if (process.env.DSH_INSTALL_DIR) {
      anchors.push(path.join(process.env.DSH_INSTALL_DIR, 'package.json'));
    }
    for (const anchor of anchors) {
      try {
        const req = createRequire(anchor);
        const resolved = req.resolve(pkgName);
        const mod = await import(pathToFileURL(resolved).href);
        return mod.default || mod;
      } catch {
        // try next anchor
      }
    }
    return null;
  }
}

const mcpClientPlugin = await loadDshPackage('@deepseek-ai/dsh-mcp-client');
const skillFsPlugin = await loadDshPackage('@deepseek-ai/dsh-skill-filesystem');

export const name = 'biz-design-agent';

export function apply(ctx) {
  // 1) 挂载本地 stdio MCP Server（自动复用 DSH 自身的 Node 二进制，用户无需单独装 Node）
  if (mcpClientPlugin) {
    ctx.plugin(mcpClientPlugin, {
      serverName: 'bizdesign',
      transport: 'stdio',
      command: process.execPath,
      args: [AGENT_ENTRY, 'mcp'],
      failOnStartupError: false,
    });
  } else {
    ctx.logger?.warn?.('[biz-design-agent] 未能解析 @deepseek-ai/dsh-mcp-client，跳过 MCP 挂载');
  }

  // 2) 挂载随包携带的 biz-design-agent Skill（含五模式主菜单与工作流细则）
  if (skillFsPlugin) {
    ctx.plugin(skillFsPlugin, {
      providerName: 'biz-design-agent',
      includeDefaultRoots: false,
      bundledSkillDir: SKILLS_DIR,
      watch: false,
    });
  } else {
    ctx.logger?.warn?.('[biz-design-agent] 未能解析 @deepseek-ai/dsh-skill-filesystem，跳过 Skill 挂载');
  }
}
