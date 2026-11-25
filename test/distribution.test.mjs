// 纯 Node 视觉对图、多 Harness 自动配置、标准 MCP Server 与内网自举分发服务（含 nvm+LTS 引导）验证
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { visualDiffPng, encodePng } from '../src/visual-diff.mjs';
import { configureHarness, detectHarness } from '../src/harness-setup.mjs';
import { handleJsonRpc, MCP_TOOLS } from '../src/mcp-server.mjs';
import { startDistServer } from '../server/dist-server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SAMPLE_SOURCE = path.join(ROOT, 'examples', 'app-delivery', 'prd-source.json');
const ROUND2 = path.join(ROOT, 'examples', 'app-delivery', 'evidence', 'round2');

test('纯 Node 视觉对图：相同屏 0 差异、不同屏精准定位热区、遮罩区域忽略、不同尺寸拒绝拉伸', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'figma-vdiff-'));
  try {
    const designDetail = path.join(ROUND2, 'detail-design.png');
    const buildDetail = path.join(ROUND2, 'detail-build.png');
    const savedDetail = path.join(ROUND2, 'saved-design.png');

    // 1) 同尺寸同画面：0 像素差异
    const same = visualDiffPng({ baselinePath: designDetail, actualPath: buildDetail });
    assert.equal(same.ok, true);
    assert.equal(same.diffPixels, 0);
    assert.equal(same.diffBoundingBox, null);

    // 2) 同尺寸不同状态（未收藏 vs 已收藏）：检出差异并写出合法 diff.png
    const diffOut = path.join(tmp, 'diff.png');
    const changed = visualDiffPng({ baselinePath: designDetail, actualPath: savedDetail, outDiffPath: diffOut });
    assert.equal(changed.ok, true);
    assert.ok(changed.diffPixels > 0, '应检出按钮状态变化像素');
    assert.ok(changed.diffBoundingBox && changed.diffBoundingBox.w > 0);
    assert.ok(fs.existsSync(diffOut));

    // 3) 用遮罩覆盖整个差异包围盒后，差异像素归零
    const masked = visualDiffPng({
      baselinePath: designDetail,
      actualPath: savedDetail,
      masks: [{ ...changed.diffBoundingBox, reason: '动态状态按钮区' }],
    });
    assert.equal(masked.ok, true);
    assert.equal(masked.diffPixels, 0);
    assert.ok(masked.maskedPixels > 0);

    // 4) 尺寸不一致时报错，绝不强行拉伸
    const smallPng = path.join(tmp, 'small.png');
    fs.writeFileSync(smallPng, encodePng(10, 10, Buffer.alloc(10 * 10 * 4, 255)));
    const mismatch = visualDiffPng({ baselinePath: designDetail, actualPath: smallPng });
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.dimensionMismatch, true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('多 Harness 自动检测与落盘：绝对路径绑定 NODE_BIN、写入原生 MCP 与 Skills，并解出固定插件目录', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'figma-harness-'));
  try {
    // 1) 环境变量强信号识别
    assert.equal(detectHarness({ workspaceDir: tmp, env: { CLAUDECODE: '1' } }).harness, 'claude-code');
    assert.equal(detectHarness({ workspaceDir: tmp, env: { CURSOR_TRACE_ID: 'abc' } }).harness, 'cursor');
    assert.equal(detectHarness({ workspaceDir: tmp, env: { ANTIGRAVITY_SESSION: '1' } }).harness, 'antigravity');

    const pluginDir = path.join(tmp, 'home-plugin');

    // 2) Claude Code 配置落盘
    const wsClaude = path.join(tmp, 'ws-claude');
    const resClaude = configureHarness({
      workspaceDir: wsClaude,
      harness: 'claude-code',
      nodeBin: '/custom/nvm/v24/bin/node',
      pluginTargetDir: pluginDir,
    });
    assert.equal(resClaude.harness, 'claude-code');
    const claudeMcp = JSON.parse(fs.readFileSync(path.join(wsClaude, '.mcp.json'), 'utf8'));
    assert.equal(claudeMcp.mcpServers['figma-agent'].command, '/custom/nvm/v24/bin/node');
    assert.equal(claudeMcp.mcpServers['figma-agent'].args[1], 'mcp');
    assert.ok(fs.existsSync(path.join(wsClaude, '.claude', 'skills', 'figma-agent-prd', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(pluginDir, 'manifest.json')));

    // 3) Cursor 配置落盘
    const wsCursor = path.join(tmp, 'ws-cursor');
    configureHarness({
      workspaceDir: wsCursor,
      harness: 'cursor',
      nodeBin: '/custom/nvm/v24/bin/node',
      pluginTargetDir: pluginDir,
    });
    const cursorMcp = JSON.parse(fs.readFileSync(path.join(wsCursor, '.cursor', 'mcp.json'), 'utf8'));
    assert.equal(cursorMcp.mcpServers['figma-agent'].command, '/custom/nvm/v24/bin/node');
    assert.ok(fs.existsSync(path.join(wsCursor, '.cursor', 'rules', 'figma-agent.mdc')));

    // 4) Antigravity 配置落盘
    const wsAgy = path.join(tmp, 'ws-agy');
    configureHarness({
      workspaceDir: wsAgy,
      harness: 'antigravity',
      nodeBin: '/custom/nvm/v24/bin/node',
      pluginTargetDir: pluginDir,
    });
    assert.ok(fs.existsSync(path.join(wsAgy, '.agents', 'skills', 'figma-agent-prd', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(wsAgy, 'AGENTS.md')));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('内网分发服务：动态生成 /bootstrap.md（含自动配置 nvm + 安装 LTS、内网 registry、Harness 识别与 Bridge 握手）', async () => {
  const { server, port } = await startDistServer({
    port: 0,
    host: '127.0.0.1',
    npmRegistry: 'http://npm.intranet.local:4873',
    npmScope: '@team',
    nodeMirror: 'http://mirror.intranet.local/node',
  });
  try {
    const base = `http://127.0.0.1:${port}`;

    const health = await (await fetch(`${base}/health`)).json();
    assert.equal(health.ok, true);

    const cfg = await (await fetch(`${base}/api/config.json`)).json();
    assert.equal(cfg.npmRegistry, 'http://npm.intranet.local:4873');
    assert.equal(cfg.npmScope, '@team');
    assert.equal(cfg.nodeMirror, 'http://mirror.intranet.local/node');

    const md = await (await fetch(`${base}/bootstrap.md`)).text();
    assert.match(md, /自动配置 `nvm` 并安装最新 Node LTS/);
    assert.match(md, /nvm install --lts/);
    assert.match(md, /CoreyButler\.NVMforWindows/);
    assert.match(md, /http:\/\/mirror\.intranet\.local\/node/);
    assert.match(md, /@team:registry.*http:\/\/npm\.intranet\.local:4873/);
    assert.match(md, /setup --workspace/);
    assert.match(md, /doctor --json/);
    assert.match(md, /FIMG Agent Plugin/);

    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /bootstrap\.md/);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('标准 MCP Server：完整支持 initialize、tools/list 及无外部依赖工具调用（prd_menu_state / visual_diff_png）', async () => {
  const init = await handleJsonRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.equal(init.result.serverInfo.name, 'figma-agent');

  const list = await handleJsonRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.equal(list.result.tools.length, MCP_TOOLS.length);
  const names = list.result.tools.map((t) => t.name);
  for (const required of ['figma_status', 'figma_command', 'prd_inspect_docx', 'prd_menu_state', 'prd_export_bundle', 'visual_diff_png']) {
    assert.ok(names.includes(required), `缺少 MCP 工具：${required}`);
  }

  const menuResp = await handleJsonRpc({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'prd_menu_state', arguments: { sourcePath: SAMPLE_SOURCE } },
  });
  assert.equal(menuResp.result.isError, false);
  const menuData = JSON.parse(menuResp.result.content[0].text);
  assert.equal(menuData.has_goal, true);
  assert.equal(menuData.options.find((o) => o.id === 3).enabled, true);

  const diffResp = await handleJsonRpc({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'visual_diff_png',
      arguments: {
        baselinePath: path.join(ROUND2, 'detail-design.png'),
        actualPath: path.join(ROUND2, 'detail-build.png'),
      },
    },
  });
  assert.equal(diffResp.result.isError, false);
  const diffData = JSON.parse(diffResp.result.content[0].text);
  assert.equal(diffData.diffPixels, 0);
});
