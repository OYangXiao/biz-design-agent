// 一致性地基：版本号与产品标识必须全仓一致，防止再次出现改名/改版本后的漂移
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

/** 递归收集源码文件，跳过依赖、构建产物与历史取证快照。 */
function collectSources(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'out', 'examples'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectSources(full, acc);
    else if (/\.(mjs|js|json|md|sh|html)$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

const SOURCES = collectSources(ROOT);

test('插件 VERSION 与 package.json version 保持一致', () => {
  const code = fs.readFileSync(path.join(ROOT, 'plugin', 'code.js'), 'utf8');
  const m = /const VERSION = '([^']+)'/.exec(code);
  assert.ok(m, '应能在 plugin/code.js 中找到 VERSION 常量');
  assert.equal(m[1], PKG.version, `plugin VERSION=${m[1]} 与 package.json=${PKG.version} 不一致`);
});

test('MCP Server 报出的版本取自 package.json，而非硬编码', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'mcp-server.mjs'), 'utf8');
  assert.ok(/version:\s*PKG\.version/.test(src), 'SERVER_INFO.version 应引用 PKG.version');
  assert.ok(!/version:\s*'\d+\.\d+\.\d+'/.test(src), 'SERVER_INFO 不应硬编码版本号');
});

test('文档中声明的「当前版本」与 package.json 一致', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'CAPABILITIES.md'), 'utf8');
  const m = /当前插件版本 \*\*v([\d.]+)\*\*/.exec(doc);
  if (!m) return; // 文档未声明当前版本时跳过，避免绑死文案
  assert.equal(m[1], PKG.version, `文档当前版本 v${m[1]} 与 package.json ${PKG.version} 不一致`);
});

test('全仓不再残留旧产品标识 figma-agent / fimg-agent-plugin', () => {
  const self = path.join(ROOT, 'test', 'consistency.test.mjs');
  const offenders = [];
  for (const file of SOURCES) {
    if (file === self) continue; // 本文件的正则本身包含旧标识，需排除自身
    const text = fs.readFileSync(file, 'utf8');
    if (/figma-agent|fimg-agent-plugin/i.test(text)) {
      offenders.push(path.relative(ROOT, file));
    }
  }
  assert.deepEqual(offenders, [], `以下文件仍残留旧标识：\n${offenders.join('\n')}`);
});

test('插件 manifest 的 id 与 name 已统一为新品牌', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugin', 'manifest.json'), 'utf8'));
  assert.equal(manifest.name, 'Biz Design Agent');
  assert.equal(manifest.id, 'biz-design-agent-local');
});

test('package.json 的 bin 指向存在的 CLI 入口', () => {
  for (const [name, rel] of Object.entries(PKG.bin || {})) {
    assert.equal(name, 'biz-design-agent', 'bin 键应为新命令名');
    const target = path.join(ROOT, rel);
    assert.ok(fs.existsSync(target), `bin 入口不存在：${rel}`);
  }
});

test('package.json test 脚本覆盖全部测试文件', () => {
  const script = PKG.scripts?.test || '';
  const dedicated = PKG.scripts?.['test:plugin'] || '';
  // plugin.test.mjs 依赖真实 Figma 环境，由 test:plugin 单独执行，不并入主套件
  const testFiles = fs.readdirSync(path.join(ROOT, 'test'))
    .filter((f) => f.endsWith('.test.mjs'))
    .filter((f) => f !== 'plugin.test.mjs')
    .map((f) => `test/${f}`);
  const missing = testFiles.filter((f) => !script.includes(f));
  assert.deepEqual(missing, [], `test 脚本漏掉了：${missing.join(', ')}`);
  assert.ok(dedicated.includes('plugin.test.mjs'), 'test:plugin 脚本应包含 plugin.test.mjs');
});

test('dist/ 预打包引导存在且与当前版本一致（供 clone 后直接接入）', () => {
  const distDir = path.join(ROOT, 'dist');
  for (const f of ['bootstrap.md', 'index.html', 'meta.json']) {
    const full = path.join(distDir, f);
    assert.ok(fs.existsSync(full), `缺少预打包产物：dist/${f}（运行 npm run build:dist 生成）`);
  }

  const meta = JSON.parse(fs.readFileSync(path.join(distDir, 'meta.json'), 'utf8'));
  assert.equal(meta.version, PKG.version, `dist/meta.json 版本 ${meta.version} 与 package.json ${PKG.version} 不一致`);

  const bootstrap = fs.readFileSync(path.join(distDir, 'bootstrap.md'), 'utf8');
  assert.ok(
    bootstrap.includes(`v${PKG.version}`),
    `dist/bootstrap.md 未包含当前版本 v${PKG.version}，产物已过期，请运行 npm run build:dist`,
  );
});

test('dist/ 产物与 serve-dist 动态渲染保持一致', async () => {
  const { renderBootstrapMarkdown } = await import('../server/dist-server.mjs');
  const expected = renderBootstrapMarkdown({ baseUrl: 'http://localhost:8790' });
  const actual = fs.readFileSync(path.join(ROOT, 'dist', 'bootstrap.md'), 'utf8');
  assert.ok(
    actual.includes(expected.trim()),
    'dist/bootstrap.md 与 renderBootstrapMarkdown 输出不一致，产物已过期，请运行 npm run build:dist',
  );
});

test('package.json files 包含 dist/，确保打包时代入预渲染引导', () => {
  assert.ok((PKG.files || []).includes('dist/'), 'files 应包含 dist/');
});
