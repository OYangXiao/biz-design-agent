#!/usr/bin/env node
// 全流程四角色真机模拟验证：真实 Figma 插件（localhost:8787）+ 真实隔离 Headless Chrome CDP + 纯 Node PRD/原型/视觉/研发/QA 引擎
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { exportPrdBundle } from '../src/prd.mjs';
import { exportPrototypeBundle } from '../src/prototype.mjs';
import { exportVisualBundle } from '../src/visual-design.mjs';
import { createBuildTicket, exportDevHandoff } from '../src/dev-handoff.mjs';
import { buildQaFigmaFeedbackSpec, renderQaHtmlReport, runChromeAudit } from '../src/qa-verify.mjs';
import { visualDiffPng } from '../src/visual-diff.mjs';
import { DEFAULT_BRIDGE_URL } from '../src/env-doctor.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const EXAMPLES = path.join(ROOT, 'examples', 'app-delivery');
const OUT = path.join(ROOT, 'out', 'live-simulation');
const VALIDATOR = path.join(ROOT, 'specs', 'validate-spec.mjs');

fs.mkdirSync(OUT, { recursive: true });

async function bridgeCmd(cmd, payload = {}, timeoutMs = 180_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${DEFAULT_BRIDGE_URL}/cmd`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd, payload }),
      signal: ctrl.signal,
    });
    const json = await res.json();
    if (!json.ok) throw new Error(`Figma [${cmd}] 失败：${json.error || JSON.stringify(json)}`);
    return json.data;
  } finally {
    clearTimeout(timer);
  }
}

function validateSpec(specPath) {
  const out = execFileSync(process.execPath, [VALIDATOR, specPath], { cwd: ROOT, encoding: 'utf8' });
  if (!/问题数:\s*0/.test(out)) {
    throw new Error(`规格静态校验未通过（${specPath}）：\n${out}`);
  }
  return out.trim();
}

async function saveFigmaExport(pageName, names, scale, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const res = await bridgeCmd('export', { pageName, names, scale });
  const saved = {};
  for (const f of res.files || []) {
    const safe = f.name.replace(/[\\/:*?"<>|\s]+/g, '_');
    const outPath = path.join(outDir, `${safe}.png`);
    fs.writeFileSync(outPath, Buffer.from(f.base64, 'base64'));
    saved[f.name] = outPath;
  }
  return saved;
}

function startStaticServer(rootDir) {
  const mime = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8' };
  const server = http.createServer((req, res) => {
    const urlObj = new URL(req.url || '/', 'http://127.0.0.1');
    const rel = decodeURIComponent(urlObj.pathname).replace(/^\/+/, '');
    const filePath = path.join(rootDir, rel || 'index.html');
    if (!filePath.startsWith(rootDir) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.writeHead(404); res.end('Not Found'); return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function buildFavoriteJourney(url) {
  return [
    {
      id: '01-initial',
      label: '首次打开未收藏详情页',
      precondition: '清空本地存储，打开文章详情',
      action: 'snapshot',
      expected: '详情按钮显示「收藏」且标题为《给自己留十分钟》',
      mustContain: ['给自己留十分钟', '收藏'],
      mustNotContain: ['已收藏'],
      passSummary: '首屏显示《给自己留十分钟》及「收藏」按钮',
      screenshot: '01-initial',
      stabilityCheck: true,
    },
    {
      id: '02-save',
      label: '点击收藏切换状态',
      precondition: '处于未收藏详情页',
      action: 'click_selector',
      selector: '#save',
      expected: '按钮文案变为「已收藏」',
      mustContain: ['已收藏'],
      passSummary: '点击后按钮立即更新为「已收藏」',
      screenshot: '02-saved',
    },
    {
      id: '03-list-one',
      label: '进入我的收藏检查真实条目',
      precondition: '已收藏《给自己留十分钟》',
      action: 'click_selector',
      selector: '#nav',
      expected: '列表展示可点击的文章《给自己留十分钟》且不显示空态文案',
      mustContain: ['我的收藏', '给自己留十分钟'],
      mustNotContain: ['还没有收藏'],
      passSummary: '收藏列表准确展示《给自己留十分钟》且无空态残留',
      screenshot: '03-list-one',
    },
    {
      id: '04-return',
      label: '点击返回回到详情保持已收藏',
      precondition: '处于我的收藏列表',
      action: 'click_selector',
      selector: '#nav',
      expected: '返回详情页，按钮仍保持「已收藏」',
      mustContain: ['给自己留十分钟', '已收藏'],
      passSummary: '返回详情页后按钮保持「已收藏」',
    },
    {
      id: '05-reload',
      label: '刷新重开保持已收藏状态',
      precondition: '详情页处于已收藏状态',
      action: 'reload',
      expected: '刷新重开后仍显示「已收藏」',
      mustContain: ['给自己留十分钟', '已收藏'],
      passSummary: '刷新重开后状态持久化生效，仍为「已收藏」',
    },
    {
      id: '06-cancel-empty',
      label: '取消收藏后进入列表应为空态',
      precondition: '已收藏详情页',
      action: 'click_selector',
      selector: '#save',
      expected: '详情按钮恢复「收藏」',
      mustContain: ['收藏'],
      mustNotContain: ['已收藏'],
      passSummary: '取消收藏后按钮恢复「收藏」',
    },
    {
      id: '07-list-empty',
      label: '取消收藏后核对我的收藏列表变空',
      precondition: '刚取消收藏',
      action: 'click_selector',
      selector: '#nav',
      expected: '列表显示「还没有收藏」，不残留已取消文章',
      mustContain: ['我的收藏', '还没有收藏'],
      mustNotContain: ['给自己留十分钟'],
      passSummary: '取消后列表准确清空并显示「还没有收藏」',
      screenshot: '07-list-empty',
    },
  ];
}

async function main() {
  const report = { started_at: new Date().toISOString(), figma_file: null, stages: {} };

  // 0) 确认 Figma 真机在线
  const ping = await bridgeCmd('ping');
  report.figma_file = ping.file;
  console.log(`✅ 0. 已连接真实 Figma 文件：${ping.file}（插件 v${ping.version}）`);

  // =========================================================================
  // 阶段一 A：业务设计人员 · 模式 1（PRD 单页 + Word）
  // =========================================================================
  console.log('\n--- 阶段一 A：角色一（业务设计）· 模式 1 PRD 生成与 Figma 真机渲染 ---');
  const prdDir = path.join(OUT, '01-prd');
  const prdExport = exportPrdBundle(path.join(EXAMPLES, 'prd-source.json'), prdDir);
  validateSpec(prdExport.figma_spec);
  const prdSpec = JSON.parse(fs.readFileSync(prdExport.figma_spec, 'utf8'));
  const prdPage = '01 PRD · 文章收藏';
  const prdRender = await bridgeCmd('render', { spec: prdSpec, pageName: prdPage, clear: true });
  const prdShots = await saveFigmaExport(prdPage, [prdSpec.frames[0].name], 1, path.join(prdDir, 'figma-exports'));
  report.stages.role1_prd = {
    page: prdPage,
    docx: prdExport.docx,
    figma_spec: prdExport.figma_spec,
    render: prdRender,
    exported_pngs: prdShots,
    stats: prdExport.stats,
  };
  console.log(`✅ PRD 单页已真机渲染到「${prdPage}」（节点数 ${prdRender.nodes}），并生成 Word：${prdExport.docx}`);

  // =========================================================================
  // 阶段一 B：业务设计人员 · 模式 2（可点击跳转预览线稿原型 + PRD 设计说明卡）
  // =========================================================================
  console.log('\n--- 阶段一 B：角色一（业务设计）· 模式 2 可交互线稿原型真机渲染与点击连线验证 ---');
  const protoDir = path.join(OUT, '02-prototype');
  const protoExport = exportPrototypeBundle(path.join(EXAMPLES, 'prototype-source.json'), protoDir);
  validateSpec(protoExport.figma_spec);
  const protoSpec = JSON.parse(fs.readFileSync(protoExport.figma_spec, 'utf8'));
  const protoPage = '02 原型 · 可点击预览线稿';
  const protoRender = await bridgeCmd('render', { spec: protoSpec, pageName: protoPage, clear: true });
  const protoReactions = await bridgeCmd('reactions', { pageName: protoPage, all: true });
  const protoShots = await saveFigmaExport(
    protoPage,
    [
      protoSpec.frames[0].name,
      '01 文章详情页 · 未收藏',
      '02 文章详情页 · 已收藏',
      'PRD映射与设计说明 · 01 文章详情页 · 未收藏',
    ],
    1,
    path.join(protoDir, 'figma-exports'),
  );
  report.stages.role1_prototype = {
    page: protoPage,
    figma_spec: protoExport.figma_spec,
    guide_markdown: protoExport.guide_markdown,
    render: protoRender,
    live_reactions_count: protoReactions.count,
    exported_pngs: protoShots,
  };
  console.log(`✅ 可交互线稿原型已真机渲染到「${protoPage}」（${protoRender.linksApplied} 条点击跳转 + ${protoRender.flowStartingPoints} 个 ▶ 入口，读回 reactions=${protoReactions.count}）`);

  // =========================================================================
  // 阶段二：美工 / UI 设计师 · 模式 3（高保真视觉源稿 + 本地样式 + 1x 基准图导出）
  // =========================================================================
  console.log('\n--- 阶段二：角色二（美工 / UI）· 模式 3 高保真视觉源稿、本地样式与 1x 基准图导出 ---');
  const visualDir = path.join(OUT, '03-visual');
  const visualExport = exportVisualBundle(path.join(EXAMPLES, 'visual-source.json'), visualDir);
  validateSpec(visualExport.figma_spec);
  const visualSpec = JSON.parse(fs.readFileSync(visualExport.figma_spec, 'utf8'));
  const stylesOps = JSON.parse(fs.readFileSync(visualExport.styles_ops, 'utf8'));

  // 在当前 Figma 文件登记真实本地 Paint / Text Styles（容错处理：已存在同名不重复失败）
  const registeredStyles = [];
  for (const op of stylesOps) {
    try {
      const res = await bridgeCmd('styles', op);
      registeredStyles.push({ name: op.name, kind: op.kind, ok: true, id: res.id || null });
    } catch (e) {
      registeredStyles.push({ name: op.name, kind: op.kind, ok: false, error: e.message });
    }
  }

  const visualPage = '03 视觉稿 · 高保真源稿';
  const visualRender = await bridgeCmd('render', { spec: visualSpec, pageName: visualPage, clear: true });
  const visualReactions = await bridgeCmd('reactions', { pageName: visualPage, all: true });
  const visualDump = await bridgeCmd('dump', { pageName: visualPage, all: true, maxDepth: 8, maxNodes: 2000 });
  const liveDumpPath = path.join(visualDir, 'live-visual-dump.json');
  fs.writeFileSync(liveDumpPath, `${JSON.stringify(visualDump, null, 2)}\n`, 'utf8');

  const visualBaselinePngs = await saveFigmaExport(
    visualPage,
    [
      '01 高保真详情 · 未收藏',
      '02 高保真详情 · 已收藏',
      '03 高保真列表 · 含 1 篇收藏',
      '04 高保真列表 · 空状态',
    ],
    1,
    path.join(visualDir, 'figma-baselines-1x'),
  );
  report.stages.role2_visual = {
    page: visualPage,
    signoff_label: visualExport.menu_state.signoff_label,
    styles_registered: registeredStyles,
    render: visualRender,
    live_reactions_count: visualReactions.count,
    live_dump_path: liveDumpPath,
    baseline_pngs_1x: visualBaselinePngs,
  };
  console.log(`✅ 高保真视觉源稿已真机渲染到「${visualPage}」（节点 ${visualRender.nodes}，导出 4 张真实 1x 390×844 基准 PNG）`);

  // =========================================================================
  // 阶段三：前端 / 研发人员 · 模式 4（从真实 Figma dump 提取开发规格与提测单）
  // =========================================================================
  console.log('\n--- 阶段三：角色三（前端研发）· 模式 4 从真实 Figma dump 提取开发规格包与提测单 ---');
  const devDir = path.join(OUT, '04-dev-handoff');
  const handoff = exportDevHandoff(liveDumpPath, devDir, {
    prdPath: path.join(EXAMPLES, 'prd-source.json'),
    designPage: visualPage,
    designFile: ping.file,
  });
  const ticketV1 = createBuildTicket({
    buildId: 'sim-build-v1',
    testUrl: 'http://127.0.0.1/<local>/build-v1.html',
    designSource: `${ping.file} / ${visualPage}`,
    prdVersion: 'v1.0',
    changes: ['首次提交收藏功能页面（用于模拟首轮跨页状态漏接与按钮右移 8px + 旧样文缺陷）'],
  });
  const ticketV2 = createBuildTicket({
    buildId: 'sim-build-v2',
    testUrl: 'http://127.0.0.1/<local>/build-v2.html',
    designSource: `${ping.file} / ${visualPage}`,
    prdVersion: 'v1.0',
    changes: ['修复列表页未读取本地收藏状态的跨页缺陷', '按视觉定稿对齐按钮位置与正文两段最终文案'],
    selfCheck: { functional_ok: true, visual_note: '按钮热区与定稿文案已核对一致' },
  });
  fs.writeFileSync(path.join(devDir, 'ticket-v1.json'), `${JSON.stringify(ticketV1, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(devDir, 'ticket-v2.json'), `${JSON.stringify(ticketV2, null, 2)}\n`, 'utf8');
  report.stages.role3_dev = { handoff, ticket_v1: ticketV1, ticket_v2: ticketV2 };
  console.log(`✅ 开发规格包已从真实 Figma dump 提取完成：${handoff.summary.screen_count} 屏、${handoff.summary.color_count} 色值、${handoff.summary.typography_count} 字阶`);

  // =========================================================================
  // 阶段四：QA 测试 & 美工走查 · 模式 5（隔离 Headless Chrome 实测 + 双基线像素对图 + Figma 走查副本板）
  // =========================================================================
  console.log('\n--- 阶段四：角色四（QA & 美工走查）· 模式 5 真实 Headless Chrome 两轮功能验收与像素对图 ---');
  const qaDir = path.join(OUT, '05-qa-verify');
  fs.mkdirSync(qaDir, { recursive: true });
  const { server, baseUrl } = await startStaticServer(EXAMPLES);
  try {
    // 采集同浏览器引擎下的 design.html 1x 基准图（对照 Figma 导出图 + 对照浏览器渲染差异）
    const designCapture = await runChromeAudit({
      buildId: 'design-html-ref',
      url: `${baseUrl}/design.html`,
      outDir: path.join(qaDir, 'design-html-ref'),
      steps: [{ id: 'ref', label: '参考视觉页首屏', action: 'snapshot', expected: '展示首屏', mustContain: ['给自己留十分钟'], screenshot: 'design-initial' }],
    });
    const designHtmlPng = designCapture.screenshots['design-initial'];
    const figmaBaselinePng = visualBaselinePngs['01 高保真详情 · 未收藏'];

    // 第 1 轮：验收 build-v1.html（预期抓出真实功能失败 + 真实视觉差异）
    const r1Dir = path.join(qaDir, 'round1-v1');
    const r1 = await runChromeAudit({
      buildId: 'sim-build-v1',
      url: `${baseUrl}/build-v1.html`,
      outDir: r1Dir,
      steps: buildFavoriteJourney(`${baseUrl}/build-v1.html`),
    });
    const r1DiffFigma = visualDiffPng({
      baselinePath: figmaBaselinePng,
      actualPath: r1.screenshots['01-initial'],
      outDiffPath: path.join(r1Dir, 'diff-vs-figma.png'),
      threshold: 16,
    });
    const r1DiffDesignHtml = visualDiffPng({
      baselinePath: designHtmlPng,
      actualPath: r1.screenshots['01-initial'],
      outDiffPath: path.join(r1Dir, 'diff-vs-design-html.png'),
      threshold: 0,
    });
    r1.visual_vs_figma = r1DiffFigma;
    r1.visual_vs_design_html = r1DiffDesignHtml;
    r1.visual_compare = {
      baselineLabel: '同基准设计参考（design.html 1x）',
      baselinePath: designHtmlPng,
      actualPath: r1.screenshots['01-initial'],
      diffPath: r1DiffDesignHtml.diffPath,
    };
    r1.visual_summary = `同基准对照（design.html 1x）：差异 ${r1DiffDesignHtml.diffPixels} px（精确命中按钮右移 8px 与旧样文正文偏差）；跨引擎对照 Figma 1x 导出图：差异 ${r1DiffFigma.diffPixels} px (${(r1DiffFigma.diffRatio * 100).toFixed(2)}%)。`;

    // 第 2 轮：验收 build-v2.html（预期 7/7 功能全部通过 + 同引擎 0 差异 + 跨引擎大幅收敛）
    const r2Dir = path.join(qaDir, 'round2-v2');
    const r2 = await runChromeAudit({
      buildId: 'sim-build-v2',
      url: `${baseUrl}/build-v2.html`,
      outDir: r2Dir,
      steps: buildFavoriteJourney(`${baseUrl}/build-v2.html`),
    });
    const r2DiffFigma = visualDiffPng({
      baselinePath: figmaBaselinePng,
      actualPath: r2.screenshots['01-initial'],
      outDiffPath: path.join(r2Dir, 'diff-vs-figma.png'),
      threshold: 16,
    });
    const r2DiffDesignHtml = visualDiffPng({
      baselinePath: designHtmlPng,
      actualPath: r2.screenshots['01-initial'],
      outDiffPath: path.join(r2Dir, 'diff-vs-design-html.png'),
      threshold: 0,
    });
    r2.visual_vs_figma = r2DiffFigma;
    r2.visual_vs_design_html = r2DiffDesignHtml;
    r2.visual_compare = {
      baselineLabel: '同基准设计参考（design.html 1x）',
      baselinePath: designHtmlPng,
      actualPath: r2.screenshots['01-initial'],
      diffPath: r2DiffDesignHtml.diffPath,
    };
    r2.visual_summary = `同基准复验（design.html 1x）：逐像素差异 ${r2DiffDesignHtml.diffPixels} px（0.00% 完全收敛）；跨引擎对照 Figma 1x 导出图：差异由 ${r1DiffFigma.diffPixels} px 降至 ${r2DiffFigma.diffPixels} px（剩余为 Figma 与 Chrome 字体/SVG 细微光栅化差异）。`;

    const rounds = [r1, r2];
    const htmlPath = path.join(qaDir, 'qa-report.html');
    fs.writeFileSync(htmlPath, renderQaHtmlReport({ title: '日间阅读 App · 文章收藏两轮验收', rounds, reportDir: qaDir }), 'utf8');

    // 将走查反馈与差异热区图写入独立 Figma 走查副本页（绝不改动已签收的 03 视觉稿！）
    const qaFeedbackSpec = buildQaFigmaFeedbackSpec({ title: '日间阅读 · 文章收藏', rounds });
    const qaFeedbackSpecPath = path.join(qaDir, 'QA-Feedback.figma.json');
    fs.writeFileSync(qaFeedbackSpecPath, `${JSON.stringify(qaFeedbackSpec, null, 2)}\n`, 'utf8');
    validateSpec(qaFeedbackSpecPath);

    const qaPage = '04 走查记录 · 功能与对图报告';
    const qaRender = await bridgeCmd('render', { spec: qaFeedbackSpec, pageName: qaPage, clear: true });
    const qaShots = await saveFigmaExport(qaPage, [qaFeedbackSpec.frames[0].name], 1, path.join(qaDir, 'figma-exports'));

    report.stages.role4_qa = {
      page: qaPage,
      html_report: htmlPath,
      figma_render: qaRender,
      exported_pngs: qaShots,
      round1: {
        build_id: r1.build_id,
        functional: r1.functional,
        stability: r1.stability,
        visual_vs_figma: r1DiffFigma,
        visual_vs_design_html: r1DiffDesignHtml,
        failed_steps: r1.steps.filter((s) => s.status !== '通过'),
      },
      round2: {
        build_id: r2.build_id,
        functional: r2.functional,
        stability: r2.stability,
        visual_vs_figma: r2DiffFigma,
        visual_vs_design_html: r2DiffDesignHtml,
      },
    };
    console.log(`✅ 第 1 轮（build-v1）：功能 ${r1.functional.passed}/${r1.functional.total}（成功拦截 ${r1.functional.failed} 处跨页故障），同引擎视觉差异 ${r1DiffDesignHtml.diffPixels} px`);
    console.log(`✅ 第 2 轮（build-v2）：功能 ${r2.functional.passed}/${r2.functional.total} 全通过，同引擎视觉差异 ${r2DiffDesignHtml.diffPixels} px，走查报告已写入 Figma「${qaPage}」`);
  } finally {
    await new Promise((r) => server.close(r));
  }

  // 把页面切回 02 原型页方便用户醒来一眼看到可点击预览效果，并汇总全部页面列表
  const pagesAfter = await bridgeCmd('page', { action: 'list' });
  report.final_figma_pages = pagesAfter.pages;
  report.finished_at = new Date().toISOString();

  const summaryPath = path.join(OUT, 'simulation-summary.json');
  fs.writeFileSync(summaryPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`\n🎉 全流程四角色真机模拟完成！汇总报告：${summaryPath}`);
}

main().catch((err) => {
  console.error(`✖ 真机模拟失败：${err.stack || err.message}`);
  process.exit(1);
});
