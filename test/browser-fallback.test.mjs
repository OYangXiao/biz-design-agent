// 浏览器不可用时的降级与自检契约：任何环境问题都必须快速返回「未测」+ 可操作指引，绝不允许挂起
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  browserFailureHint,
  classifyBrowserFailure,
  findChromeBinary,
  probeBrowser,
  runChromeAudit,
} from '../src/qa-verify.mjs';

const STEPS = [
  { id: 'save', label: '点击收藏', expected: '显示已收藏' },
  { id: 'list', label: '进列表查条目', expected: '显示文章标题' },
];

test('失败原因可归类：未找到 / 沙箱拦截 / WebSocket 断连 / 崩溃 / 超时', () => {
  assert.equal(classifyBrowserFailure('本机未找到 Chrome/Chromium/Edge 浏览器'), 'not-found');
  assert.equal(classifyBrowserFailure('Failed to initialize sandbox: Operation not permitted'), 'sandbox-blocked');
  assert.equal(classifyBrowserFailure('CDP WebSocket 连接失败：握手失败'), 'ws-blocked');
  assert.equal(classifyBrowserFailure('CDP 连接已关闭（code=1006）'), 'ws-blocked');
  assert.equal(classifyBrowserFailure('Headless 浏览器提前退出 (code=null, signal=SIGTRAP)'), 'crashed');
  assert.equal(classifyBrowserFailure('启动 Headless 浏览器超时（12000ms）'), 'timeout');
  assert.equal(classifyBrowserFailure('完全未知的错误'), 'unknown');
});

test('每种失败原因都给出非空且可照做的解决建议', () => {
  for (const msg of [
    '本机未找到浏览器',
    'Failed to initialize sandbox',
    'CDP WebSocket 连接失败：握手失败',
    'Headless 浏览器提前退出 (code=null, signal=SIGTRAP)',
    '超时',
    '其它',
  ]) {
    const hint = browserFailureHint(msg);
    assert.equal(typeof hint, 'string');
    assert.ok(hint.trim().length > 20, `「${msg}」的建议过短，不足以指导用户`);
  }
});

test('指定不存在的浏览器时可快速降级，不抛错也不挂起', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-fallback-'));
  const startedAt = Date.now();
  try {
    const res = await runChromeAudit({
      buildId: 'v1',
      url: 'http://127.0.0.1:1/none.html',
      outDir,
      steps: STEPS,
      chromeBin: '/nonexistent/browser-binary',
      launchTimeoutMs: 8000,
    });
    const cost = Date.now() - startedAt;

    assert.equal(res.ok, false);
    assert.equal(res.functional.untested, STEPS.length, '环境不可用时全部步骤应为「未测」');
    assert.equal(res.functional.failed, 0, '不得把环境问题计为产品失败');
    assert.equal(res.functional.passed, 0);
    assert.deepEqual(res.steps.map((s) => s.status), ['未测', '未测']);
    assert.ok(res.error_kind, '应给出可归类的原因');
    assert.ok(res.hint && res.hint.length > 0, '应给出解决建议');
    assert.ok(cost < 30000, `降级耗时过长：${cost}ms`);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test('probeBrowser 永不抛错，且返回结构化结论与指引', async () => {
  const probe = await probeBrowser({ timeoutMs: 15000 });
  assert.equal(typeof probe.ok, 'boolean');
  assert.ok(probe.reason, '应给出 reason');

  if (probe.ok) {
    assert.ok(probe.bin, '可用时应返回可执行路径');
    assert.equal(probe.reason, 'ok');
  } else {
    assert.ok(probe.detail, '不可用时应说明具体原因');
    assert.ok(probe.hint && probe.hint.length > 0, '不可用时应给出修复指引');
  }
});

test('浏览器不可用时的 doctor 报告包含专门提示，指引用户如何解决', async () => {
  const { runDoctor } = await import('../src/env-doctor.mjs');
  const info = await runDoctor({ bridgeUrl: 'http://127.0.0.1:1/never', probeChrome: true });

  assert.ok(info.browser, 'doctor 必须输出 browser 一节');
  assert.equal(typeof info.browser.ok, 'boolean');
  assert.ok(info.browser.requiredFor.includes('模式五'), '应说明浏览器服务于哪个模式');

  if (!info.browser.ok) {
    assert.ok(info.browser.detail, '应说明不可用的具体原因');
    assert.ok(info.browser.hint && info.browser.hint.length > 0, '应包含解决步骤');
  }
});

test('跳过浏览器探测时 doctor 不阻塞，并把状态标为 skipped', async () => {
  const { runDoctor } = await import('../src/env-doctor.mjs');
  const startedAt = Date.now();
  const info = await runDoctor({ bridgeUrl: 'http://127.0.0.1:1/never', probeChrome: false });
  const cost = Date.now() - startedAt;

  assert.equal(info.browser.ok, null);
  assert.equal(info.browser.reason, 'skipped');
  assert.ok(cost < 5000, `--no-browser 应跳过探测，实际耗时 ${cost}ms`);
});

test('findChromeBinary 在无可用浏览器时返回 null 而非抛错', () => {
  const bin = findChromeBinary();
  assert.ok(bin === null || typeof bin === 'string');
  if (typeof bin === 'string') assert.ok(bin.length > 0);
});
