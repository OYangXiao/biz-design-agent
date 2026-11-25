// 角色四（QA 测试 & 美工走查验收）纯 Node 验收引擎：模式五菜单、零依赖隔离 Headless Chrome CDP 功能验收、稳定度双拍校验、视觉对图、Figma 走查反馈板与 HTML 验收报告
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { visualDiffPng } from './visual-diff.mjs';
import { probeImageSize } from './prd.mjs';

/* ============================================================================
 * 1. 模式五（QA 功能验收与美工设计还原对图）对话菜单状态机（含 0. 退出当前模式）
 * ========================================================================== */

export function computeQaMenuState(state = {}) {
  const hasTarget = Boolean(state.test_url && state.build_id);
  const hasBaseline = Boolean(state.baseline_png || state.approved_figma_frame);
  const rounds = state.rounds || [];
  const latest = rounds[rounds.length - 1] || null;
  const funcStatus = latest ? `${latest.functional?.passed || 0}/${latest.functional?.total || 0} 通过` : '尚未执行';
  const visualStatus = latest?.visual
    ? (latest.visual.dimensionMismatch ? '尺寸不匹配' : `差异像素 ${latest.visual.diffPixels}`)
    : '尚未执行';

  const options = [
    {
      id: 1,
      label: '配置验收基准（测试 URL、构建号 Build ID、可复位数据及已签收 Figma 基准屏）',
      enabled: true,
      status: hasTarget
        ? `当前构建：${state.build_id}（${state.test_url}）`
        : '请先指定待测地址与构建号（可独立验收，不强制先走 PRD）',
    },
    {
      id: 2,
      label: '执行隔离浏览器功能验收（真实点击 + 无障碍快照断言，严格区分 通过/失败/未测）',
      enabled: hasTarget,
      reason_if_disabled: hasTarget ? null : '需先在选项 1 指定测试地址与构建号',
      status: `最近功能实测：${funcStatus}`,
    },
    {
      id: 3,
      label: '执行设计还原像素对图（Figma 基准 PNG vs Chrome 实测图，含双拍稳定检查与热力图）',
      enabled: hasTarget && hasBaseline,
      reason_if_disabled: !hasTarget
        ? '需先指定测试地址'
        : (!hasBaseline ? '缺少已签收设计基准图（仅阻塞视觉对图，不阻塞功能验收）' : null),
      status: `最近视觉对图：${visualStatus}`,
    },
    {
      id: 4,
      label: '生成双轨综合验收报告（HTML + JSON + 可选 Figma 走查副本反馈卡）与退回单',
      enabled: rounds.length > 0,
      status: rounds.length ? `已累计 ${rounds.length} 轮不可覆盖审计记录` : '运行功能或视觉验收后即可生成报告',
    },
    {
      id: 5,
      label: '基于研发新构建号在同一基准上复验（保留旧轮次证据，不覆盖历史）',
      enabled: rounds.length > 0,
      status: '修复后输入新 Build ID 重跑同路径与同视口基准',
    },
    {
      id: 0,
      label: '退出当前验收模式（保存全部证据，返回主菜单切换 PRD、原型、视觉或研发模式）',
      enabled: true,
      status: '随时可切换角色或工作模式',
    },
  ];

  return {
    mode: 'qa-verify',
    title: state.title || '页面功能验收与视觉还原对图',
    build_id: state.build_id || null,
    rounds_count: rounds.length,
    latest_functional_pass: Boolean(latest && latest.functional && latest.functional.failed === 0 && latest.functional.untested === 0 && latest.functional.total > 0),
    options,
    post_verify_options: [
      { id: 1, label: '退回研发定位修复（进入模式 4，附失败步骤快照与差异热区）' },
      { id: 2, label: '按新构建号在同一基准再跑一轮复验' },
      { id: 0, label: '退出当前模式，返回主菜单切换其他角色或任务' },
    ],
  };
}

/* ============================================================================
 * 2. 严格验收判定契约（通过 / 失败 / 未测）
 * ========================================================================== */

export function evaluateAssertion(assertion, observation, expectedBuildId) {
  if (!observation || !observation.evidence || observation.buildId !== expectedBuildId || observation.visibleText == null) {
    return { status: '未测', actual: null, reason: '缺少对应构建号的实测快照证据' };
  }
  const text = String(observation.visibleText);
  if (assertion.mustContain) {
    const missing = assertion.mustContain.filter((s) => !text.includes(s));
    if (missing.length) {
      return { status: '失败', actual: `页面缺少预期内容：${missing.join('、')}`, reason: '实际观测与预期不符' };
    }
  }
  if (assertion.mustNotContain) {
    const unwanted = assertion.mustNotContain.filter((s) => text.includes(s));
    if (unwanted.length) {
      return { status: '失败', actual: `页面出现不应展示的内容：${unwanted.join('、')}`, reason: '实际观测与预期不符' };
    }
  }
  return { status: '通过', actual: assertion.passSummary || '可见文案与状态符合预期', reason: '' };
}

/* ============================================================================
 * 3. 零依赖隔离 Headless Chrome CDP 执行器（使用 Node 原生 WebSocket）
 * ========================================================================== */

export function findChromeBinary() {
  const candidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || null;
}

/** 供 doctor / CLI 展示的浏览器安装指引。 */
export const CHROME_INSTALL_HINT = [
  '安装任一基于 Chromium 的浏览器后重试：',
  '  macOS：brew install --cask google-chrome   （或 chromium / microsoft-edge）',
  '  Linux：sudo apt install chromium-browser   （或 google-chrome-stable）',
  '  Windows：winget install Google.Chrome       （或 Microsoft.Edge）',
  '也可用 CHROME_BIN=/path/to/chrome 指定已有可执行文件。',
].join('\n');

/**
 * 真正启动一次 headless 浏览器做可用性探测（不再只看文件是否存在）。
 * 返回 { ok, bin, reason, detail, hint }，永不抛错、永不悬挂。
 */
export async function probeBrowser({ timeoutMs = 20000 } = {}) {
  const bin = findChromeBinary();
  if (!bin) {
    return {
      ok: false,
      bin: null,
      reason: 'not-found',
      detail: '未找到 Chrome / Chromium / Edge 可执行文件',
      hint: CHROME_INSTALL_HINT,
    };
  }

  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-design-agent-probe-'));
  let child = null;
  try {
    const launched = await launchIsolatedChrome(bin, profileDir, { timeoutMs });
    child = launched.child;
    const cdp = new CdpSession(launched.pageWsUrl, { defaultTimeoutMs: timeoutMs });
    await cdp.connect({ timeoutMs });
    try {
      await cdp.send('Runtime.enable', {}, { timeoutMs });
    } finally {
      cdp.close();
    }
    return { ok: true, bin, reason: 'ok', detail: '隔离 Headless 会话可正常建立并完成 CDP 握手', hint: null };
  } catch (err) {
    const msg = String(err?.message || err);
    return { ok: false, bin, reason: classifyBrowserFailure(msg), detail: msg, hint: browserFailureHint(msg) };
  } finally {
    if (child) {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
    }
    try {
      fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch { /* ignore */ }
  }
}

/** 把底层报错归类成可操作的原因，便于 CLI / 报告中给出精准建议。 */
export function classifyBrowserFailure(message = '') {
  const m = String(message);
  if (/未找到|not found|ENOENT/i.test(m)) return 'not-found';
  if (/sandbox initialization failed|Operation not permitted|Failed to initialize sandbox/i.test(m)) return 'sandbox-blocked';
  if (/CDP WebSocket 连接失败|WebSocket.*1006|CLOSE code=1006|CDP 连接已关闭/i.test(m)) return 'ws-blocked';
  if (/提前退出|exit code|SIGTRAP|SIGSEGV|code=null/i.test(m)) return 'crashed';
  if (/超时|timeout/i.test(m)) return 'timeout';
  return 'unknown';
}

/** 针对不同失败原因给出可直接照做的解决建议。 */
export function browserFailureHint(message = '') {
  switch (classifyBrowserFailure(message)) {
    case 'not-found':
      return CHROME_INSTALL_HINT;
    case 'sandbox-blocked':
      return [
        '浏览器进程被沙箱策略阻止（sandbox initialization failed）。',
        '常见解法：',
        '  1) 在具备完整权限的终端直接运行本命令（不要套在受限沙箱 / 容器内）；',
        '  2) 容器或 CI 中可用 CHROME_BIN 指向带 --no-sandbox 的包装脚本；',
        '  3) 确认 /Applications 下浏览器的可执行位未被安全策略剥离。',
      ].join('\n');
    case 'ws-blocked':
      return [
        '浏览器能启动，但页面级 DevTools WebSocket 被立即断开（code 1006）。',
        '常见解法：',
        '  1) 检查是否有代理 / 安全软件拦截 127.0.0.1 的随机高位端口；',
        '  2) 关闭占用同一 user-data-dir 的其他浏览器实例后重试；',
        '  3) 换用官方 Google Chrome（Edge 在某些环境对 CDP 支持不完整）。',
      ].join('\n');
    case 'crashed':
      return [
        '浏览器进程启动后立即崩溃退出。',
        '常见解法：',
        '  1) 升级或重装浏览器；',
        '  2) 清理临时 profile 目录（系统临时目录下的 biz-design-agent-* 与 figma-qa-chrome-*）；',
        '  3) 用 CHROME_BIN 指向另一个已知可用的 Chromium 内核浏览器。',
      ].join('\n');
    case 'timeout':
      return [
        '浏览器在限定时间内未完成握手，可能是启动过慢或端口被拦截。',
        '常见解法：换用更轻量的 Chromium，或检查本机负载与安全软件拦截。',
      ].join('\n');
    default:
      return CHROME_INSTALL_HINT;
  }
}

class CdpSession {
  constructor(wsUrl, { defaultTimeoutMs = 30000 } = {}) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.seq = 0;
    this.pending = new Map();
    this.eventWaiters = new Map();
    this.defaultTimeoutMs = defaultTimeoutMs;
    this.closed = false;
    this.closeReason = null;
  }

  /** 连接断开时立刻让所有在途请求与事件等待失败，避免 Promise 永久悬挂。 */
  #failAllPending(reason) {
    this.closed = true;
    this.closeReason = reason;
    for (const [id, { rej, timer }] of this.pending) {
      clearTimeout(timer);
      rej(new Error(reason));
      this.pending.delete(id);
    }
    for (const [method, list] of this.eventWaiters) {
      for (const { rej, timer } of list) {
        clearTimeout(timer);
        rej(new Error(`${reason}（等待事件 ${method} 期间连接中断）`));
      }
      this.eventWaiters.delete(method);
    }
  }

  async connect({ timeoutMs = 15000 } = {}) {
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, arg) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(arg);
      };
      const timer = setTimeout(
        () => finish(reject, new Error(`CDP WebSocket 连接超时（${timeoutMs}ms 内未建立）`)),
        timeoutMs,
      );
      let ws;
      try {
        ws = new WebSocket(this.wsUrl);
      } catch (e) {
        finish(reject, new Error(`CDP WebSocket 连接失败：${e.message || e}`));
        return;
      }
      this.ws = ws;
      ws.addEventListener('open', () => finish(resolve));
      ws.addEventListener('error', (e) => {
        const raw = e?.message || e?.error?.message || e?.type || 'unknown';
        // 浏览器对连接失败常只给 "error"，补充目标地址便于定位端口/代理拦截
        const msg = `CDP WebSocket 连接失败：${raw === 'error' ? `握手失败（目标 ${this.wsUrl}）` : raw}`;
        this.#failAllPending(msg);
        finish(reject, new Error(msg));
      });
      ws.addEventListener('close', (ev) => {
        const msg = `CDP 连接已关闭（code=${ev?.code ?? '?'}${ev?.reason ? `, reason=${ev.reason}` : ''}）`;
        this.#failAllPending(msg);
        finish(reject, new Error(msg));
      });
      ws.addEventListener('message', (ev) => {
        let msg;
        try {
          msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'));
        } catch {
          return;
        }
        if (msg.id && this.pending.has(msg.id)) {
          const { res, rej, timer } = this.pending.get(msg.id);
          clearTimeout(timer);
          this.pending.delete(msg.id);
          if (msg.error) rej(new Error(`CDP ${msg.error.message}`));
          else res(msg.result);
        } else if (msg.method && this.eventWaiters.has(msg.method)) {
          const list = this.eventWaiters.get(msg.method);
          this.eventWaiters.delete(msg.method);
          for (const { res, timer } of list) { clearTimeout(timer); res(msg.params); }
        }
      });
    });
  }

  send(method, params = {}, { timeoutMs = this.defaultTimeoutMs } = {}) {
    if (this.closed) {
      return Promise.reject(new Error(`CDP 连接不可用，无法发送 ${method}：${this.closeReason || '已关闭'}`));
    }
    const id = ++this.seq;
    return new Promise((res, rej) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rej(new Error(`CDP 调用 ${method} 超时（${timeoutMs}ms 未返回）`));
      }, timeoutMs);
      this.pending.set(id, { res, rej, timer });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        rej(new Error(`CDP 调用 ${method} 发送失败：${e.message || e}`));
      }
    });
  }

  waitForEvent(method, timeoutMs = 10000) {
    if (this.closed) {
      return Promise.reject(new Error(`CDP 连接不可用，无法等待事件 ${method}：${this.closeReason || '已关闭'}`));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`等待事件 ${method} 超时`)), timeoutMs);
      const list = this.eventWaiters.get(method) || [];
      list.push({ res: resolve, rej: reject, timer });
      this.eventWaiters.set(method, list);
    });
  }

  close() {
    this.closed = true;
    try { this.ws?.close(); } catch { /* ignore */ }
  }
}

async function launchIsolatedChrome(chromeBin, userDataDir, { timeoutMs = 12000 } = {}) {
  const child = spawn(chromeBin, [
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-background-networking',
    '--hide-scrollbars',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  // 子进程自身出错（二进制不可执行等）时，避免 Promise 永远等不到 stderr/exit
  child.on('error', () => { /* 由下方 exit/timeout 分支统一兜底 */ });

  const wsBrowserUrl = await new Promise((resolve, reject) => {
    let stderrBuf = '';
    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(arg);
    };
    const timer = setTimeout(
      () => finish(reject, new Error(`启动 Headless 浏览器超时（${timeoutMs}ms）：${stderrBuf.slice(-300)}`)),
      timeoutMs,
    );
    child.stderr.on('data', (chunk) => {
      stderrBuf += chunk.toString('utf8');
      const m = /DevTools listening on (ws:\/\/[^\s]+)/.exec(stderrBuf);
      if (m) finish(resolve, m[1]);
    });
    child.on('error', (e) => {
      finish(reject, new Error(`启动 Headless 浏览器失败：${e.message || e}`));
    });
    child.on('exit', (code, signal) => {
      finish(reject, new Error(`Headless 浏览器提前退出 (code=${code}, signal=${signal || '-'})：${stderrBuf.slice(-300)}`));
    });
  });

  const u = new URL(wsBrowserUrl);
  const targets = await (await fetch(`http://${u.host}/json/list`, {
    signal: AbortSignal.timeout(Math.min(timeoutMs, 10000)),
  })).json();
  const pageTarget = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl) || targets[0];
  if (!pageTarget?.webSocketDebuggerUrl) throw new Error('未能获取浏览器页面调试目标');
  return { child, pageWsUrl: pageTarget.webSocketDebuggerUrl };
}

/**
 * 在隔离 Headless Chrome 中按声明式步骤执行功能验收与截屏取证。
 */
export async function runChromeAudit({
  buildId,
  url,
  outDir,
  viewport = { width: 390, height: 844, dpr: 1, mobile: true },
  steps = [],
  chromeBin = findChromeBinary(),
  launchTimeoutMs = 20000,
}) {
  const absOut = path.resolve(outDir);
  fs.mkdirSync(absOut, { recursive: true });

  const untestedResult = (error, extra = {}) => ({
    ok: false,
    build_id: buildId,
    url,
    error,
    error_kind: classifyBrowserFailure(error),
    hint: browserFailureHint(error),
    ...extra,
    steps: steps.map((s) => ({
      id: s.id,
      label: s.label,
      precondition: s.precondition || '',
      expected: s.expected || '',
      actual: null,
      status: '未测',
      evidence: null,
    })),
    functional: { total: steps.length, passed: 0, failed: 0, untested: steps.length },
  });

  if (!chromeBin) {
    return untestedResult('本机未找到 Chrome/Chromium/Edge 浏览器，全部步骤标记为「未测」');
  }

  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'figma-qa-chrome-'));
  let chromeProc = null;
  let cdp = null;

  try {
    const launched = await launchIsolatedChrome(chromeBin, profileDir, { timeoutMs: launchTimeoutMs });
    chromeProc = launched.child;
    cdp = new CdpSession(launched.pageWsUrl, { defaultTimeoutMs: 30000 });
    await cdp.connect({ timeoutMs: launchTimeoutMs });

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Accessibility.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.dpr || 1,
      mobile: viewport.mobile !== false,
    });

    const evalJs = async (expression) => {
      const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || '页面脚本执行异常');
      return r.result?.value;
    };

    const navigateAndSettle = async (targetUrl) => {
      const loaded = cdp.waitForEvent('Page.loadEventFired', 10000);
      await cdp.send('Page.navigate', { url: targetUrl });
      await loaded;
      await new Promise((r) => setTimeout(r, 150));
    };

    const capturePng = async (filename) => {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const filePath = path.join(absOut, filename);
      fs.writeFileSync(filePath, Buffer.from(data, 'base64'));
      return filePath;
    };

    const captureSnapshot = async (filename) => {
      const visibleText = await evalJs('document.body ? document.body.innerText : ""');
      const ax = await cdp.send('Accessibility.getFullAXTree');
      const axLines = (ax.nodes || [])
        .filter((n) => !n.ignored && n.role?.value && n.name?.value)
        .map((n) => `[${n.role.value}] ${n.name.value}`);
      const content = `URL: ${await evalJs('location.href')}\nBUILD: ${buildId}\n--- VISIBLE TEXT ---\n${visibleText}\n--- AX SUMMARY ---\n${axLines.join('\n')}\n`;
      const snapPath = path.join(absOut, filename);
      fs.writeFileSync(snapPath, content, 'utf8');
      return { visibleText, snapPath, axCount: axLines.length };
    };

    await navigateAndSettle(url);
    await evalJs('try { localStorage.clear(); sessionStorage.clear(); } catch {}');
    await navigateAndSettle(url);

    const stepResults = [];
    const screenshots = {};
    let stability = null;

    for (let i = 0; i < steps.length; i++) {
      const st = steps[i];
      const prefix = `${String(i + 1).padStart(2, '0')}-${st.id}`;

      if (st.action === 'click_selector') {
        const clicked = await evalJs(`(() => {
          const el = document.querySelector(${JSON.stringify(st.selector)});
          if (!el || el.hidden || getComputedStyle(el).display === 'none') return false;
          el.click();
          return true;
        })()`);
        if (!clicked) {
          stepResults.push({
            id: st.id,
            label: st.label,
            precondition: st.precondition || '',
            expected: st.expected || '',
            actual: `未找到可见目标元素 ${st.selector}`,
            status: '失败',
            evidence: null,
          });
          continue;
        }
        await new Promise((r) => setTimeout(r, 120));
      } else if (st.action === 'reload') {
        const loaded = cdp.waitForEvent('Page.loadEventFired', 10000);
        await cdp.send('Page.reload', { ignoreCache: true });
        await loaded;
        await new Promise((r) => setTimeout(r, 150));
      } else if (st.action === 'goto' && st.url) {
        await navigateAndSettle(st.url);
      }

      const snap = await captureSnapshot(`${prefix}.txt`);
      let shotPath = null;
      if (st.screenshot) {
        shotPath = await capturePng(`${st.screenshot}.png`);
        screenshots[st.screenshot] = shotPath;
        if (st.stabilityCheck) {
          await new Promise((r) => setTimeout(r, 120));
          const repeatPath = await capturePng(`${st.screenshot}-repeat.png`);
          const stabDiff = visualDiffPng({ baselinePath: shotPath, actualPath: repeatPath, threshold: 0 });
          stability = {
            stable: stabDiff.ok && stabDiff.diffPixels === 0,
            diffPixels: stabDiff.diffPixels,
            first: shotPath,
            second: repeatPath,
          };
        }
      }

      const verdict = evaluateAssertion(
        { mustContain: st.mustContain, mustNotContain: st.mustNotContain, passSummary: st.passSummary },
        { evidence: snap.snapPath, buildId, visibleText: snap.visibleText },
        buildId,
      );

      stepResults.push({
        id: st.id,
        label: st.label,
        precondition: st.precondition || '',
        expected: st.expected || '',
        actual: verdict.actual,
        status: verdict.status,
        evidence: snap.snapPath,
        screenshot: shotPath,
      });
    }

    const passed = stepResults.filter((r) => r.status === '通过').length;
    const failed = stepResults.filter((r) => r.status === '失败').length;
    const untested = stepResults.filter((r) => r.status === '未测').length;

    return {
      ok: true,
      build_id: buildId,
      url,
      viewport,
      executed_at: new Date().toISOString(),
      stability,
      screenshots,
      steps: stepResults,
      functional: { total: stepResults.length, passed, failed, untested },
    };
  } catch (err) {
    // 浏览器不可用 / 启动失败 / 连接中断等环境问题：降级为「未测」并给出可操作指引，
    // 不把环境问题伪装成产品缺陷，也不再让调用方永久等待。
    return untestedResult(`隔离 Headless 浏览器无法执行验收：${err?.message || err}`);
  } finally {
    cdp?.close();
    if (chromeProc) {
      await new Promise((resolve) => {
        if (chromeProc.exitCode !== null) { resolve(); return; }
        const killer = setTimeout(() => { try { chromeProc.kill('SIGKILL'); } catch {} resolve(); }, 1800);
        chromeProc.once('exit', () => { clearTimeout(killer); resolve(); });
        try { chromeProc.kill('SIGTERM'); } catch { clearTimeout(killer); resolve(); }
      });
    }
    try {
      fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 });
    } catch { /* ignore late chrome lock cleanup */ }
  }
}

/* ============================================================================
 * 4. 生成 Figma 走查副本反馈板（不改动已签收视觉页）与独立 HTML 验收报告
 * ========================================================================== */

function imgPreviewNode(title, imgPath, cardW = 340) {
  const previewW = cardW - 24;
  if (imgPath && fs.existsSync(imgPath)) {
    const bytes = fs.readFileSync(imgPath);
    const { width, height, mime } = probeImageSize(bytes);
    const previewH = Math.max(180, Math.min(460, Math.round(previewW * (height / Math.max(1, width)))));
    return {
      type: 'FRAME',
      name: `图像卡 · ${title}`,
      layout: 'V',
      w: cardW,
      h: 'hug',
      pad: 12,
      gap: 8,
      radius: 12,
      fill: '#FFFFFF',
      stroke: '#CBD5E1',
      children: [
        { type: 'TEXT', text: `${title}（${width}×${height}）`, size: 12, weight: 700, color: '#0F172A', w: 'fill' },
        {
          type: 'RECT',
          name: `图片 · ${title}`,
          w: previewW,
          h: previewH,
          radius: 6,
          fill: { image: `data:${mime};base64,${bytes.toString('base64')}`, scaleMode: 'FIT' },
          stroke: '#E2E8F0',
        },
      ],
    };
  }
  return {
    type: 'FRAME',
    name: `缺图卡 · ${title}`,
    layout: 'V',
    w: cardW,
    h: 140,
    pad: 16,
    main: 'CENTER',
    cross: 'CENTER',
    radius: 12,
    fill: '#F8FAFC',
    stroke: '#CBD5E1',
    dash: [4, 4],
    children: [{ type: 'TEXT', text: `${title}（暂无图像）`, size: 12, color: '#64748B' }],
  };
}

export function buildQaFigmaFeedbackSpec({ title, rounds = [] }) {
  const roundCards = rounds.map((rd, idx) => {
    const f = rd.functional || { passed: 0, failed: 0, untested: 0, total: 0 };
    const funcPass = f.failed === 0 && f.untested === 0 && f.total > 0;
    const badgeBg = funcPass ? '#DCFCE7' : '#FFE4E6';
    const badgeFg = funcPass ? '#166534' : '#9F1239';
    const badgeText = funcPass ? `功能通过 (${f.passed}/${f.total})` : `退回修复 (${f.passed}/${f.total} 通过，${f.failed} 失败)`;

    const stepNodes = (rd.steps || []).map((st) => ({
      type: 'FRAME',
      name: `步骤 · ${st.id}`,
      layout: 'H',
      w: 'fill',
      h: 'hug',
      pad: [8, 12],
      gap: 12,
      radius: 8,
      fill: st.status === '通过' ? '#F0FDF4' : (st.status === '失败' ? '#FFF1F2' : '#F8FAFC'),
      stroke: st.status === '通过' ? '#BBF7D0' : (st.status === '失败' ? '#FECDD3' : '#E2E8F0'),
      cross: 'CENTER',
      children: [
        { type: 'TEXT', text: `[${st.status}]`, size: 12, weight: 700, color: st.status === '通过' ? '#15803D' : '#BE123C' },
        { type: 'TEXT', text: `${st.label}｜预期：${st.expected}｜实际：${st.actual || '未测'}`, size: 12, color: '#1E293B', w: 'fill', lineHeight: 18 },
      ],
    }));

    const vCards = [];
    if (rd.visual_compare?.baselinePath) vCards.push(imgPreviewNode('基准图（Figma/设计）', rd.visual_compare.baselinePath, 310));
    if (rd.visual_compare?.actualPath) vCards.push(imgPreviewNode(`实测截图（${rd.build_id}）`, rd.visual_compare.actualPath, 310));
    if (rd.visual_compare?.diffPath) vCards.push(imgPreviewNode('像素差异热区（diff.png）', rd.visual_compare.diffPath, 310));

    return {
      type: 'FRAME',
      name: `第 ${idx + 1} 轮验收 · ${rd.build_id}`,
      layout: 'V',
      w: 'fill',
      h: 'hug',
      pad: 24,
      gap: 14,
      radius: 16,
      fill: '#FFFFFF',
      stroke: '#CBD5E1',
      children: [
        {
          type: 'FRAME',
          name: '轮次头',
          layout: 'H',
          w: 'fill',
          h: 'hug',
          main: 'SPACE_BETWEEN',
          cross: 'CENTER',
          fill: null,
          children: [
            { type: 'TEXT', text: `第 ${idx + 1} 轮 · 构建 ${rd.build_id}`, size: 20, weight: 700, color: '#0F172A' },
            {
              type: 'FRAME',
              name: '结果徽章',
              layout: 'H',
              w: 'hug',
              h: 'hug',
              pad: [5, 12],
              radius: 6,
              fill: badgeBg,
              children: [{ type: 'TEXT', text: badgeText, size: 12, weight: 700, color: badgeFg }],
            },
          ],
        },
        ...(rd.visual_summary ? [{ type: 'TEXT', text: `视觉对图实测：${rd.visual_summary}`, size: 13, weight: 600, color: '#334155', w: 'fill', lineHeight: 20 }] : []),
        ...stepNodes,
        ...(vCards.length
          ? [{
              type: 'FRAME',
              name: '三图对照区',
              layout: 'H',
              wrap: true,
              w: 'fill',
              h: 'hug',
              gap: 16,
              fill: null,
              children: vCards,
            }]
          : []),
      ],
    };
  });

  return {
    frames: [
      {
        type: 'FRAME',
        name: `QA 走查与设计对图报告 · ${title}`,
        layout: 'V',
        w: 1120,
        h: 'hug',
        pad: 40,
        gap: 28,
        radius: 20,
        fill: '#F1F5F9',
        clip: false,
        children: [
          {
            type: 'FRAME',
            name: '00 走查报告头卡',
            layout: 'V',
            w: 'fill',
            h: 'hug',
            pad: [28, 32],
            gap: 10,
            radius: 16,
            fill: '#142033',
            children: [
              { type: 'TEXT', text: `QA 功能验收与美工走查对图记录 · ${title}`, size: 26, weight: 700, color: '#FFFFFF', w: 'fill' },
              {
                type: 'TEXT',
                text: '重要原则：功能通过不自动等于视觉通过；所有轮次证据均独立留存不覆盖；发布签字仍由业务/设计负责人人工判定。',
                size: 13,
                color: '#CBD5E1',
                w: 'fill',
                lineHeight: 20,
              },
            ],
          },
          ...roundCards,
        ],
      },
    ],
  };
}

export function renderQaHtmlReport({ title, rounds = [], reportDir }) {
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const rel = (p) => (p ? path.relative(reportDir, p).split(path.sep).join('/') : '');

  const sections = rounds.map((rd, idx) => {
    const f = rd.functional || { passed: 0, failed: 0, untested: 0, total: 0 };
    const pass = f.failed === 0 && f.untested === 0 && f.total > 0;
    const rows = (rd.steps || []).map((st) => `
      <tr class="${st.status === '通过' ? 'ok' : (st.status === '失败' ? 'fail' : 'skip')}">
        <td><strong>${esc(st.id)}</strong></td>
        <td>${esc(st.label)}</td>
        <td>${esc(st.expected)}</td>
        <td>${esc(st.actual || '未测')}</td>
        <td><span class="pill">${esc(st.status)}</span></td>
      </tr>`).join('');

    const imgs = [];
    if (rd.visual_compare?.baselinePath) imgs.push(`<figure><figcaption>基准图（${esc(rd.visual_compare.baselineLabel || '设计基准')}）</figcaption><img src="${esc(rel(rd.visual_compare.baselinePath))}" alt="baseline"></figure>`);
    if (rd.visual_compare?.actualPath) imgs.push(`<figure><figcaption>实测页面（${esc(rd.build_id)}）</figcaption><img src="${esc(rel(rd.visual_compare.actualPath))}" alt="actual"></figure>`);
    if (rd.visual_compare?.diffPath) imgs.push(`<figure><figcaption>像素差异热区（diff.png）</figcaption><img src="${esc(rel(rd.visual_compare.diffPath))}" alt="diff"></figure>`);

    return `
      <section class="round">
        <div class="round-head">
          <h2>第 ${idx + 1} 轮验收 · 构建 <code>${esc(rd.build_id)}</code></h2>
          <span class="badge ${pass ? 'badge-ok' : 'badge-fail'}">${pass ? `功能通过 ${f.passed}/${f.total}` : `退回修复（${f.passed}/${f.total} 通过，${f.failed} 失败）`}</span>
        </div>
        <p class="meta">测试地址：<code>${esc(rd.url)}</code> ｜ 视口：<code>${rd.viewport?.width || 390}×${rd.viewport?.height || 844}</code> ｜ 双拍稳定：<strong>${rd.stability?.stable ? '稳定（连续两张 0 像素差异）' : '未检或存在波动'}</strong></p>
        ${rd.visual_summary ? `<p class="vsummary"><strong>视觉对图结果：</strong>${esc(rd.visual_summary)}</p>` : ''}
        <table>
          <thead><tr><th>步骤</th><th>场景</th><th>预期结果</th><th>实际观测</th><th>结论</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${imgs.length ? `<div class="trio">${imgs.join('')}</div>` : ''}
      </section>`;
  }).join('\n');

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>QA 功能验收与视觉对图报告 · ${esc(title)}</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f4f6fa;color:#0f172a;font:14px/1.65 system-ui,"PingFang SC",sans-serif;padding:32px 20px}
main{max-width:1120px;margin:auto}header{background:#142033;color:#fff;padding:28px 32px;border-radius:16px;margin-bottom:24px}
header h1{margin:0 0 8px;font-size:24px}header p{margin:0;color:#cbd5e1}
.round{background:#fff;border:1px solid #cbd5e1;border-radius:16px;padding:24px;margin-bottom:24px}
.round-head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
.round-head h2{margin:0;font-size:19px}.meta{color:#475569;margin:8px 0 12px}
.vsummary{background:#fffbeb;border-left:4px solid #f59e0b;padding:10px 14px;border-radius:6px;margin:12px 0}
.badge{padding:5px 12px;border-radius:999px;font-weight:700;font-size:12px}
.badge-ok{background:#dcfce7;color:#166534}.badge-fail{background:#ffe4e6;color:#9f1239}
table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #e2e8f0;padding:8px 10px;text-align:left;vertical-align:top}
th{background:#f8fafc}tr.ok .pill{background:#dcfce7;color:#166534;padding:2px 8px;border-radius:4px;font-weight:700}
tr.fail .pill{background:#ffe4e6;color:#9f1239;padding:2px 8px;border-radius:4px;font-weight:700}
tr.skip .pill{background:#f1f5f9;color:#475569;padding:2px 8px;border-radius:4px;font-weight:700}
.trio{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;margin-top:18px}
figure{margin:0;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px}
figcaption{font-size:12px;font-weight:700;margin-bottom:8px;color:#334155}
figure img{width:100%;height:auto;border:1px solid #cbd5e1;border-radius:6px;display:block}
</style></head><body><main>
<header><h1>QA 功能验收与视觉对图综合报告 · ${esc(title)}</h1><p>本报告严格区分自动化实测证据与人工发布签字；历史轮次全部留存不覆盖。</p></header>
${sections}
</main></body></html>`;
}
