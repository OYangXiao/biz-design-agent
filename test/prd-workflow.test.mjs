// 角色一（业务设计人员）PRD 五选项迭代与纯 Node 双端（Figma 单页 + Word）同源生成契约及集成验证
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createFigma, loadPlugin, send } from './figma-stub.mjs';
import { syncPrdToFeishu } from '../src/prd.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CLI = path.join(ROOT, 'bin', 'biz-design-agent.mjs');
const VALIDATOR = path.join(ROOT, 'specs', 'validate-spec.mjs');
const SAMPLE_SOURCE = path.join(ROOT, 'examples', 'app-delivery', 'prd-source.json');
const SAMPLE_PROTO_SOURCE = path.join(ROOT, 'examples', 'app-delivery', 'prototype-source.json');

function runCliJson(args) {
  const stdout = execFileSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return JSON.parse(stdout);
}

const walk = (n, fn) => {
  fn(n);
  for (const c of n.children || []) walk(c, fn);
};

test('五选项迭代菜单：未设定需求目标时选项 3（线上搜索与思考补全细节）锁定，设定后自动解锁', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prd-menu-'));
  try {
    const emptyDraft = path.join(tmp, 'empty.json');
    fs.writeFileSync(emptyDraft, JSON.stringify({ title: '新需求探索', goal: {} }), 'utf8');

    const initial = runCliJson(['prd', 'menu-state', emptyDraft]);
    assert.equal(initial.mode, 'prd');
    assert.equal(initial.has_goal, false);
    assert.equal(initial.ready_for_export, false);
    assert.equal(initial.options.length, 7, '应包含 1~6 操作项及 0 退出当前模式项');
    const opt3Locked = initial.options.find((o) => o.id === 3);
    assert.equal(opt3Locked.enabled, false);
    assert.match(opt3Locked.reason_if_disabled, /需求目标/);
    const exitOpt = initial.options.find((o) => o.id === 0);
    assert.equal(exitOpt.enabled, true);
    assert.match(exitOpt.label, /退出当前 PRD 模式/);
    assert.ok(initial.post_export_options.some((o) => o.id === 1 && /飞书/.test(o.label)));
    assert.ok(initial.post_export_options.some((o) => o.id === 2 && /原型图/.test(o.label)));
    assert.ok(initial.post_export_options.some((o) => o.id === 0 && /退出/.test(o.label)));
    for (const id of [1, 2, 4, 5, 6, 0]) {
      assert.equal(initial.options.find((o) => o.id === id).enabled, true);
    }

    const withGoal = runCliJson(['prd', 'menu-state', SAMPLE_SOURCE]);
    assert.equal(withGoal.has_goal, true);
    assert.equal(withGoal.ready_for_export, true);
    const opt3Unlocked = withGoal.options.find((o) => o.id === 3);
    assert.equal(opt3Unlocked.enabled, true);
    assert.equal(opt3Unlocked.reason_if_disabled, null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('纯 Node 双端同源生成：产出合规单页 Figma 看板与内嵌原图的 Word 文档，并在插件桩上完整渲染', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prd-export-'));
  try {
    const summary = runCliJson(['prd', 'export', SAMPLE_SOURCE, tmp]);
    assert.equal(summary.ok, true);
    assert.equal(summary.stats.flow_steps, 4);
    assert.equal(summary.stats.screens, 3);
    assert.equal(summary.stats.embedded_images, 2);
    assert.deepEqual(summary.stats.missing_images, []);

    const figmaSpecPath = path.join(tmp, 'PRD.figma.json');
    const docxPath = path.join(tmp, 'PRD.docx');
    const mdPath = path.join(tmp, 'PRD.md');
    assert.ok(fs.existsSync(figmaSpecPath));
    assert.ok(fs.existsSync(docxPath));
    assert.ok(fs.existsSync(mdPath));
    const mdText = fs.readFileSync(mdPath, 'utf8');
    assert.match(mdText, /# 日间阅读 App · 文章收藏与我的收藏夹 PRD/);
    assert.match(mdText, /## 三、业务流程展示/);
    assert.match(mdText, /AC-01/);

    // 1) 静态校验 Figma 规格：0 问题，且不硬编码 page 字段、顶层仅单页总看板
    const checkOut = execFileSync(process.execPath, [VALIDATOR, figmaSpecPath], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    assert.match(checkOut, /问题数:\s*0/);

    const spec = JSON.parse(fs.readFileSync(figmaSpecPath, 'utf8'));
    assert.equal(spec.page, undefined, '不应硬编码 page 名称');
    assert.equal(spec.frames.length, 1, '整份 PRD 应收敛在单个顶层看板 Frame 内');

    // 2) 在真实 plugin/code.js + figma-stub 上渲染到单个 Figma 页面
    const figma = createFigma({ fileName: '业务设计 PRD 验证稿' });
    await loadPlugin(figma);
    const r = await send(figma, 'render', { spec, pageName: 'PRD · 文章收藏' });
    assert.equal(r.ok, true, r.error);
    const page = figma.root.children.find((p) => p.name === 'PRD · 文章收藏');
    assert.ok(page, '目标 PRD 页面已创建');
    assert.equal(page.children.length, 1, '单页内只有一个总看板根节点');

    const topSectionNames = page.children[0].children.map((c) => c.name);
    assert.deepEqual(topSectionNames, [
      '00 PRD 文档头卡',
      '01 需求目标与范围',
      '02 现状材料与输入溯源',
      '03 业务流程展示',
      '04 产品原型图',
      '05 需求细化与验收标准',
    ]);

    let imagePaintCount = 0;
    const allTexts = [];
    walk(page, (n) => {
      for (const p of n.fills || []) {
        if (p && p.type === 'IMAGE' && p.imageHash) imagePaintCount++;
      }
      if (n.type === 'TEXT') allTexts.push(n.characters);
    });
    assert.equal(imagePaintCount, 2, '两张现状截图均应转为真实 Figma IMAGE 填充');
    assert.ok(allTexts.some((t) => t.includes('阅读详情并收藏')));
    assert.ok(allTexts.some((t) => t.includes('01 文章详情页（未收藏）')));
    assert.ok(allTexts.some((t) => t.includes('Agent 检索与推演')));

    // 3) 纯 Node Word 文档回读校验（同时验证选项 2/4 的 Word 资料与范本读取能力）
    const extractDir = path.join(tmp, 'extracted-media');
    const inspected = runCliJson(['prd', 'inspect', docxPath, '--extract-dir', extractDir]);
    assert.equal(inspected.media.length, 2, 'Word 文档应内嵌两张现状截图');
    for (const m of inspected.media) {
      assert.equal(m.width, 390);
      assert.equal(m.height, 844);
      assert.ok(fs.existsSync(m.saved_path));
    }
    assert.ok(inspected.template_outline.includes('一、需求背景与目标范围'));
    assert.ok(inspected.template_outline.includes('三、业务流程展示'));
    assert.ok(inspected.template_outline.includes('四、产品原型图与关键状态说明'));
    assert.ok(inspected.template_outline.includes('六、验收标准与待确认事项'));
    assert.ok(inspected.table_count >= 6, '应包含元信息、反馈台账、流程表、3 张原型框线表与验收表');

    // 4) macOS 额外用系统 textutil 验证 .docx 兼容性
    if (process.platform === 'darwin') {
      const plain = execFileSync('textutil', ['-convert', 'txt', '-stdout', docxPath], { encoding: 'utf8' });
      assert.match(plain, /日间阅读 App · 文章收藏与我的收藏夹 PRD/);
      assert.match(plain, /阅读详情并收藏/);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('缺失现状截图时诚实标记「待补充」，不伪造图片也不中断双端导出', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prd-missing-img-'));
  try {
    const draftPath = path.join(tmp, 'draft.json');
    fs.writeFileSync(
      draftPath,
      JSON.stringify({
        title: '缺图诚实性检查 PRD',
        status: '草稿',
        goal: { summary: '验证缺现状图时的诚实占位逻辑', objectives: ['不拿原型冒充旧版截图'] },
        images: [{ title: '旧版结算页截图', path: 'not-exist.png', source: '待业务提供线上截图' }],
        flow: [{ step: '01', role: '用户', title: '进入页面', action: '打开页面', result: '看到默认状态' }],
        screens: [{ name: '01 默认页', entry: '首页点击', action: '查看', result: '展示内容', elements: ['内容区'] }],
      }),
      'utf8',
    );

    const res = runCliJson(['prd', 'export', draftPath, tmp]);
    assert.deepEqual(res.stats.missing_images, ['旧版结算页截图']);
    assert.equal(res.stats.embedded_images, 0);

    const specText = fs.readFileSync(path.join(tmp, 'PRD.figma.json'), 'utf8');
    assert.match(specText, /现状截图待补充/);
    assert.doesNotMatch(specText, /data:image\//);

    const inspected = runCliJson(['prd', 'inspect', path.join(tmp, 'PRD.docx')]);
    assert.equal(inspected.media.length, 0);
    assert.ok(inspected.paragraphs.some((p) => p.text.includes('【现状截图待补充】')));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('紧接 PRD 生成可操作预览原型图：支持从 PRD 继承、含退出模式菜单、挂载真实 Figma 点击跳转与屏外 PRD/设计说明卡', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'proto-workflow-'));
  try {
    // 1) 从已完成 PRD 一键继承推导初始原型草稿
    const derivedPath = path.join(tmp, 'derived-proto.json');
    const derivedRes = runCliJson(['proto', 'from-prd', SAMPLE_SOURCE, derivedPath]);
    assert.equal(derivedRes.ok, true);
    assert.equal(derivedRes.menu_state.mode, 'prototype');
    assert.ok(derivedRes.menu_state.screen_count >= 3);
    assert.ok(derivedRes.menu_state.link_count >= 3);
    const protoExit = derivedRes.menu_state.options.find((o) => o.id === 0);
    assert.equal(protoExit.enabled, true);
    assert.match(protoExit.label, /退出当前原型图模式/);

    // 2) 演练样例（4 屏全闭环线稿原型）导出与静态校验
    const outDir = path.join(tmp, 'proto-out');
    const exp = runCliJson(['proto', 'export', SAMPLE_PROTO_SOURCE, outDir]);
    assert.equal(exp.ok, true);
    assert.equal(exp.stats.screens, 4);
    assert.equal(exp.stats.annotation_cards, 4);
    assert.equal(exp.stats.links, 10);
    assert.deepEqual(exp.stats.broken_links, []);

    const protoFigmaPath = path.join(outDir, 'Prototype.figma.json');
    const guidePath = path.join(outDir, 'Prototype-Guide.md');
    assert.ok(fs.existsSync(protoFigmaPath));
    assert.ok(fs.existsSync(guidePath));

    const checkOut = execFileSync(process.execPath, [VALIDATOR, protoFigmaPath], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    assert.match(checkOut, /问题数:\s*0/);

    // 3) 在真实 plugin/code.js + figma-stub 上渲染并验证点击跳转闭环与屏外 PRD 说明卡
    const spec = JSON.parse(fs.readFileSync(protoFigmaPath, 'utf8'));
    const figma = createFigma({ fileName: '业务设计可交互原型验证稿' });
    await loadPlugin(figma);
    const r = await send(figma, 'render', { spec, pageName: '原型 · 文章收藏闭环' });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.data.linksApplied, 10, '10 条点击跳转连线应全部挂载成功');
    assert.equal(r.data.flowStartingPoints, 1, '首屏应自动设置 Figma 播放入口 flowStartingPoints');

    const page = figma.root.children.find((p) => p.name === '原型 · 文章收藏闭环');
    assert.equal(page.children.length, 9, '1 张顶部总览 + 4 张顶层设备屏 + 4 张独立屏外 PRD 说明卡');

    // 验证设备屏保持纯净 390x844 预览视口，而 PRD 依据与设计理由位于屏外配套说明卡
    const firstScreen = page.children.find((n) => n.name === '01 文章详情页 · 未收藏');
    const firstNote = page.children.find((n) => n.name === 'PRD映射与设计说明 · 01 文章详情页 · 未收藏');
    assert.equal(firstScreen.width, 390);
    assert.equal(firstScreen.height, 844);
    assert.equal(firstNote.x, firstScreen.x);
    assert.ok(firstNote.y > firstScreen.y + firstScreen.height, '说明卡应排在设备屏视口正下方，不污染预览画面');

    const noteTexts = [];
    walk(firstNote, (n) => { if (n.type === 'TEXT') noteTexts.push(n.characters); });
    assert.ok(noteTexts.some((t) => t.includes('对应 PRD 1.2 目标 #1')));
    assert.ok(noteTexts.some((t) => t.includes('为什么这么设计')));

    // 读回全部挂载的 Figma reactions，确认关键跳转去向准确无误
    const rx = await send(figma, 'reactions', { pageName: '原型 · 文章收藏闭环', all: true });
    assert.equal(rx.ok, true);
    assert.equal(rx.data.count, 10);
    const jumpPairs = rx.data.nodes.map((n) => `${n.name} => ${n.reactions[0].actions[0].destination.name}`);
    assert.ok(jumpPairs.some((s) => s.includes('收藏 => 02 文章详情页 · 已收藏')));
    assert.ok(jumpPairs.some((s) => s.includes('已收藏 => 01 文章详情页 · 未收藏')));
    assert.ok(jumpPairs.some((s) => s.includes('给自己留十分钟 => 02 文章详情页 · 已收藏')));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('飞书文档同步：未授权时给出初始化指引；已授权时支持新建与更新飞书云文档', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prd-feishu-'));
  try {
    const exp = runCliJson(['prd', 'export', SAMPLE_SOURCE, tmp]);
    const mdPath = exp.markdown;
    const mockLark = path.join(tmp, 'lark-cli');
    const logPath = path.join(tmp, 'lark-calls.log');

    // 1) 模拟未登录态 lark-cli
    fs.writeFileSync(mockLark, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(args) + '\\n');
if (args[0] === '--version') { console.log('0.4.0'); process.exit(0); }
if (args[0] === 'auth' && args[1] === 'status') { console.error('not logged in, please run lark-cli config init'); process.exit(1); }
`, 'utf8');
    fs.chmodSync(mockLark, 0o755);

    const unauth = syncPrdToFeishu({ mdPath, larkBin: mockLark });
    assert.equal(unauth.ok, false);
    assert.equal(unauth.needsAuth, true);
    assert.match(unauth.initCmd, /lark-cli auth login/);
    assert.match(unauth.docUrl, /open\.feishu\.cn\/document\/mcp_open_tools\/feishu-cli-let-ai-actually-do-your-work-in-feishu/);

    // 2) 模拟已授权态 lark-cli：新建文档与更新已有文档
    fs.writeFileSync(mockLark, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(args) + '\\n');
if (args[0] === '--version') { console.log('0.4.0'); process.exit(0); }
if (args[0] === 'auth' && args[1] === 'status') { console.log('✓ Logged in as 测试用户'); process.exit(0); }
if (args[0] === 'docs' && args[1] === '+create') { console.log('Created: https://feishu.cn/docx/mockDocNew123'); process.exit(0); }
if (args[0] === 'docs' && args[1] === '+update') { console.log('Updated: https://feishu.cn/docx/mockDocExisting'); process.exit(0); }
`, 'utf8');
    fs.chmodSync(mockLark, 0o755);

    const created = syncPrdToFeishu({ mdPath, title: '收藏文章 PRD', larkBin: mockLark });
    assert.equal(created.ok, true);
    assert.equal(created.action, 'created');
    assert.equal(created.feishu_doc_url, 'https://feishu.cn/docx/mockDocNew123');

    const updated = syncPrdToFeishu({ mdPath, docUrl: 'https://feishu.cn/docx/mockDocExisting', larkBin: mockLark });
    assert.equal(updated.ok, true);
    assert.equal(updated.action, 'updated');
    assert.equal(updated.feishu_doc_url, 'https://feishu.cn/docx/mockDocExisting');

    const calls = fs.readFileSync(logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.ok(calls.some((c) => c[0] === 'docs' && c[1] === '+create' && c.includes('--doc-format') && c.includes('markdown')));
    assert.ok(calls.some((c) => c[0] === 'docs' && c[1] === '+update' && c.includes('https://feishu.cn/docx/mockDocExisting')));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
