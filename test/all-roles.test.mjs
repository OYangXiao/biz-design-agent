// 全流程五模式对话菜单（含 0 退出当前模式）、角色二视觉、角色三研发提取、角色四隔离浏览器验收与全量 MCP 工具验证
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createFigma, loadPlugin, send } from './figma-stub.mjs';
import { computeMenuState } from '../src/prd.mjs';
import { computePrototypeMenuState } from '../src/prototype.mjs';
import { computeVisualMenuState, deriveVisualFromPrototype, exportVisualBundle } from '../src/visual-design.mjs';
import { computeDevMenuState, exportDevHandoff } from '../src/dev-handoff.mjs';
import { computeQaMenuState, evaluateAssertion, findChromeBinary, probeBrowser, runChromeAudit } from '../src/qa-verify.mjs';
import { handleJsonRpc, MCP_TOOLS } from '../src/mcp-server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const VALIDATOR = path.join(ROOT, 'specs', 'validate-spec.mjs');
const EXAMPLES = path.join(ROOT, 'examples', 'app-delivery');
const SAMPLE_PRD = path.join(EXAMPLES, 'prd-source.json');
const SAMPLE_PROTO = path.join(EXAMPLES, 'prototype-source.json');
const SAMPLE_VISUAL = path.join(EXAMPLES, 'visual-source.json');

// 只在浏览器「真的能跑起来」时才做真实画布验收；仅检查文件存在会把
// 「装了 Edge 但起不来」这类环境误判为可测，导致等待 CDP 握手而长时间挂起。
const BROWSER = await probeBrowser({ timeoutMs: 15000 }).catch(() => ({ ok: false, reason: 'unknown', detail: '探测异常' }));
const SKIP_BROWSER = BROWSER.ok ? false : `浏览器不可用（${BROWSER.reason}）：${String(BROWSER.detail || '').slice(0, 120)}`;

test('所有五个工作模式对话菜单均提供「0. 退出当前模式」及明确的跨角色衔接选项', () => {
  const m1 = computeMenuState(JSON.parse(fs.readFileSync(SAMPLE_PRD, 'utf8')));
  const m2 = computePrototypeMenuState(JSON.parse(fs.readFileSync(SAMPLE_PROTO, 'utf8')));
  const m3 = computeVisualMenuState(JSON.parse(fs.readFileSync(SAMPLE_VISUAL, 'utf8')));
  const m4 = computeDevMenuState({ title: '测试联调', build_id: 'b1', test_url: 'http://127.0.0.1/test' });
  const m5 = computeQaMenuState({ title: '测试验收', build_id: 'b1', test_url: 'http://127.0.0.1/test' });

  for (const menu of [m1, m2, m3, m4, m5]) {
    const exitOpt = menu.options.find((o) => o.id === 0);
    assert.ok(exitOpt, `模式 ${menu.mode} 缺少 0 退出选项`);
    assert.equal(exitOpt.enabled, true);
    assert.match(exitOpt.label, /退出当前/);
  }
  assert.equal(m3.has_approved_team_profile, false, '未提供已批准团队卡时不得宣称品牌签收');
  assert.match(m3.signoff_label, /探索草案/);

  // 缺设计基准图时仅阻塞视觉对图（选项 3），不阻塞功能验收（选项 2）
  const qaOpt2 = m5.options.find((o) => o.id === 2);
  const qaOpt3 = m5.options.find((o) => o.id === 3);
  assert.equal(qaOpt2.enabled, true);
  assert.equal(qaOpt3.enabled, false);
});

test('角色二（美工高保真）+ 角色三（研发提取）：视觉导出通过静态校验与插件桩渲染，并能从真实 dump 提取规格包', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roles-2-3-'));
  try {
    // 1) 从原型自动推导视觉草稿
    const protoRaw = JSON.parse(fs.readFileSync(SAMPLE_PROTO, 'utf8'));
    const derived = deriveVisualFromPrototype(protoRaw, { protoPath: SAMPLE_PROTO });
    assert.equal(derived.screens.length, 4);
    assert.equal(derived.team_profile.approved_by, null);

    // 2) 导出高保真视觉源稿 + 静态校验 0 问题
    const vOut = path.join(tmp, 'visual');
    const vRes = exportVisualBundle(SAMPLE_VISUAL, vOut);
    assert.equal(vRes.ok, true);
    assert.equal(vRes.stats.screens, 4);
    assert.equal(vRes.stats.links, 8);

    const checkOut = execFileSync(process.execPath, [VALIDATOR, vRes.figma_spec], { cwd: ROOT, encoding: 'utf8' });
    assert.match(checkOut, /问题数:\s*0/);

    // 3) 在真实 plugin/code.js 桩上渲染高保真视觉页 + 验证可点击连线 + dump
    const spec = JSON.parse(fs.readFileSync(vRes.figma_spec, 'utf8'));
    const figma = createFigma({ fileName: '全角色测试稿' });
    await loadPlugin(figma);
    const rr = await send(figma, 'render', { spec, pageName: '03 视觉稿' });
    assert.equal(rr.ok, true, rr.error);
    assert.equal(rr.data.linksApplied, 8);
    assert.equal(rr.data.flowStartingPoints, 1);

    const dumped = await send(figma, 'dump', { pageName: '03 视觉稿', all: true, maxDepth: 8, maxNodes: 2000 });
    assert.equal(dumped.ok, true);
    const dumpPath = path.join(tmp, 'visual-dump.json');
    fs.writeFileSync(dumpPath, JSON.stringify(dumped.data, null, 2), 'utf8');

    // 4) 角色三从 dump + PRD 提取前端交付包
    const devOut = path.join(tmp, 'dev');
    const devRes = exportDevHandoff(dumpPath, devOut, { prdPath: SAMPLE_PRD, designPage: '03 视觉稿' });
    assert.equal(devRes.ok, true);
    assert.equal(devRes.summary.screen_count, 4);
    assert.ok(devRes.summary.color_count >= 5);
    assert.ok(devRes.summary.typography_count >= 4);

    const devMd = fs.readFileSync(devRes.handoff_markdown, 'utf8');
    assert.match(devMd, /给自己留十分钟/);
    assert.match(devMd, /#203D34/i);
    assert.match(devMd, /AC-01/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('角色四（QA 功能验收）：严格区分 通过 / 失败 / 未测，并在真实隔离 Headless Chrome 中拦截 v1 缺陷与放行 v2 修复', async (t) => {
  // 1) 契约三态校验
  assert.equal(evaluateAssertion({ mustContain: ['已收藏'] }, { evidence: 'a.txt', buildId: 'b2', visibleText: '按钮：已收藏' }, 'b2').status, '通过');
  assert.equal(evaluateAssertion({ mustContain: ['已收藏'] }, { evidence: 'a.txt', buildId: 'b2', visibleText: '按钮：收藏' }, 'b2').status, '失败');
  assert.equal(evaluateAssertion({ mustContain: ['已收藏'] }, { evidence: 'a.txt', buildId: 'b1', visibleText: '按钮：已收藏' }, 'b2').status, '未测');
  assert.equal(evaluateAssertion({ mustContain: ['已收藏'] }, null, 'b2').status, '未测');

  // 2) 浏览器环境不可用时，必须快速降级为「未测」并带回可操作指引，而不是挂起或冒充产品缺陷
  if (!BROWSER.ok) {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'role4-degraded-'));
    const startedAt = Date.now();
    const degraded = await runChromeAudit({
      buildId: 'v1',
      url: 'http://127.0.0.1:1/none.html',
      outDir,
      steps: [{ id: 'save', label: '点击收藏', expected: '显示已收藏' }],
      chromeBin: BROWSER.bin || findChromeBinary(),
      launchTimeoutMs: 12000,
    });
    const cost = Date.now() - startedAt;
    fs.rmSync(outDir, { recursive: true, force: true });

    assert.equal(degraded.ok, false, '浏览器不可用时不得声称验收成功');
    assert.equal(degraded.functional.untested, 1, '环境问题应标记为未测，而非失败或通过');
    assert.equal(degraded.functional.failed, 0, '不得把环境问题伪装成产品缺陷');
    assert.equal(degraded.steps[0].status, '未测');
    assert.ok(degraded.error_kind && degraded.error_kind !== 'unknown', '应给出可归类的原因');
    assert.ok(typeof degraded.hint === 'string' && degraded.hint.length > 0, '应给出解决建议');
    assert.ok(cost < 60000, `降级应在合理时间内返回，实际耗时 ${cost}ms`);
    t.diagnostic(`浏览器不可用，已按「未测」降级并给出指引：${degraded.error_kind}，耗时 ${cost}ms`);
    return;
  }

  // 3) 浏览器可用：实测真实隔离浏览器对 build-v1（失败）与 build-v2（通过）给出相反结论
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'role4-chrome-'));
  const server = http.createServer((req, res) => {
    const rel = new URL(req.url || '/', 'http://127.0.0.1').pathname.replace(/^\/+/, '');
    const fp = path.join(EXAMPLES, rel);
    if (!fs.existsSync(fp)) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(fp).pipe(res);
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const steps = [
    { id: 'save', label: '点击收藏', action: 'click_selector', selector: '#save', expected: '显示已收藏', mustContain: ['已收藏'] },
    { id: 'list', label: '进列表查条目', action: 'click_selector', selector: '#nav', expected: '显示文章标题', mustContain: ['给自己留十分钟'], mustNotContain: ['还没有收藏'] },
  ];

  try {
    const r1 = await runChromeAudit({ buildId: 'v1', url: `${baseUrl}/build-v1.html`, outDir: path.join(tmp, 'v1'), steps });
    assert.equal(r1.ok, true);
    assert.equal(r1.functional.failed, 1, 'build-v1 列表缺文章应如期判失败');

    const r2 = await runChromeAudit({ buildId: 'v2', url: `${baseUrl}/build-v2.html`, outDir: path.join(tmp, 'v2'), steps });
    assert.equal(r2.ok, true);
    assert.equal(r2.functional.passed, 2, 'build-v2 列表正常显示文章应如期通过');
    assert.equal(r2.functional.failed, 0);
  } finally {
    await new Promise((r) => server.close(r));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('MCP Server 注册全部跨角色工具（17 项）并可执行角色二/三/四工具调用', async () => {
  const list = await handleJsonRpc({ jsonrpc: '2.0', id: 10, method: 'tools/list' });
  const names = list.result.tools.map((t) => t.name);
  assert.equal(names.length, MCP_TOOLS.length);
  for (const t of [
    'figma_status', 'figma_command',
    'prd_inspect_docx', 'prd_menu_state', 'prd_export_bundle', 'prd_sync_feishu',
    'proto_from_prd', 'proto_menu_state', 'proto_export_bundle',
    'visual_from_proto', 'visual_menu_state', 'visual_export_bundle',
    'dev_extract_handoff', 'dev_menu_state',
    'qa_menu_state', 'qa_run_audit', 'visual_diff_png',
  ]) {
    assert.ok(names.includes(t), `缺少跨角色 MCP 工具：${t}`);
  }

  const vMenu = await handleJsonRpc({
    jsonrpc: '2.0',
    id: 11,
    method: 'tools/call',
    params: { name: 'visual_menu_state', arguments: { visualPath: SAMPLE_VISUAL } },
  });
  assert.equal(vMenu.result.isError, false);
  assert.equal(JSON.parse(vMenu.result.content[0].text).mode, 'visual-design');

  const dMenu = await handleJsonRpc({ jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: 'dev_menu_state', arguments: {} } });
  assert.equal(JSON.parse(dMenu.result.content[0].text).mode, 'dev-handoff');

  const qMenu = await handleJsonRpc({ jsonrpc: '2.0', id: 13, method: 'tools/call', params: { name: 'qa_menu_state', arguments: {} } });
  assert.equal(JSON.parse(qMenu.result.content[0].text).mode, 'qa-verify');
});
