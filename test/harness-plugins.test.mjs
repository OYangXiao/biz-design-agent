// 多 Harness 插件产物（dist/harness-plugin + dist/dsh-bundle + 双击安装器 + 内网打包端点）契约与独立运行验证
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readZip } from '../src/zip.mjs';
import { handleJsonRpc } from '../src/mcp-server.mjs';
import { startDistServer } from '../server/dist-server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const HARNESS_DIR = path.join(ROOT, 'dist', 'harness-plugin');
const DSH_DIR = path.join(ROOT, 'dist', 'dsh-bundle');
const INSTALLERS_DIR = path.join(ROOT, 'dist', 'installers');

test('dist/harness-plugin 结构合规：四家 manifest 版本一致、无顶层 bin/、无根目录 .mcp.json 冲突、启动脚本可执行', () => {
  assert.ok(fs.existsSync(HARNESS_DIR), '缺少 dist/harness-plugin，请运行 npm run build:dist');
  // Claude Desktop Cowork 拒绝包含顶层 bin/ 的插件
  assert.equal(fs.existsSync(path.join(HARNESS_DIR, 'bin')), false, '插件根目录不应存在 bin/（避免 Cowork 拒装）');
  // Antigravity 会对根目录 .mcp.json / mcp.json 发出告警
  assert.equal(fs.existsSync(path.join(HARNESS_DIR, '.mcp.json')), false, '根目录不应存在 .mcp.json');
  assert.equal(fs.existsSync(path.join(HARNESS_DIR, 'mcp.json')), false, '根目录不应存在 mcp.json');

  for (const rel of [
    '.antigravity-plugin/plugin.json',
    '.claude-plugin/plugin.json',
    '.codex-plugin/plugin.json',
    '.cursor-plugin/plugin.json',
  ]) {
    const m = JSON.parse(fs.readFileSync(path.join(HARNESS_DIR, rel), 'utf8'));
    assert.equal(m.name, 'biz-design-agent', `${rel} name 不一致`);
    assert.equal(m.version, PKG.version, `${rel} version 与 package.json 不一致`);
  }

  for (const reqFile of [
    'mcp_config.json',
    '.codex-mcp.json',
    'scripts/run-mcp',
    'scripts/run-mcp.cmd',
    'skills/biz-design-agent/SKILL.md',
    'skills/biz-design-agent/references/PRD-WORKFLOW.md',
    'assets/logo.svg',
    'LICENSE',
    'README.md',
    'runtime/package.json',
    'runtime/bin/biz-design-agent.mjs',
    'runtime/src/mcp-server.mjs',
    'runtime/bridge/server.mjs',
    'runtime/server/dist-server.mjs',
    'runtime/tools/figma.mjs',
    'runtime/plugin/manifest.json',
  ]) {
    assert.ok(fs.existsSync(path.join(HARNESS_DIR, reqFile)), `缺少插件产物文件：${reqFile}`);
  }

  if (process.platform !== 'win32') {
    const mode = fs.statSync(path.join(HARNESS_DIR, 'scripts', 'run-mcp')).mode;
    assert.ok((mode & 0o111) !== 0, 'scripts/run-mcp 必须具备可执行权限');
  }
});

test('dist/harness-plugin 脱离源仓库完全自包含：复制到 /tmp 后通过 scripts/run-mcp 完成 MCP initialize 与 tools/list', () => {
  if (process.platform === 'win32') return;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bda-isolated-plugin-'));
  try {
    const copied = path.join(tmp, 'biz-design-agent');
    fs.cpSync(HARNESS_DIR, copied, { recursive: true });
    const runner = path.join(copied, 'scripts', 'run-mcp');

    const rpcInput = [
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    ].join('\n') + '\n';

    // 刻意用极简 PATH（模拟 macOS GUI 客户端丢失 PATH 的真实场景）验证 run-mcp 自动寻址 Node！
    const res = spawnSync('/bin/sh', [runner], {
      input: rpcInput,
      encoding: 'utf8',
      timeout: 10000,
      env: {
        HOME: os.homedir(),
        PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      },
    });
    assert.equal(res.status, 0, `隔离运行 run-mcp 失败：${res.stderr}`);
    const lines = res.stdout.trim().split(/\r?\n/).map((l) => JSON.parse(l));
    assert.equal(lines[0].result.serverInfo.name, 'biz-design-agent');
    assert.equal(lines[0].result.serverInfo.version, PKG.version);
    const toolNames = lines[1].result.tools.map((t) => t.name);
    assert.ok(toolNames.includes('figma_status'));
    assert.ok(toolNames.includes('figma_install_plugin'));
    assert.ok(toolNames.includes('prd_export_bundle'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('dist/dsh-bundle 结构合规：含 dsh.bundle.patch、零硬编码 Host 入口与双语 locale', () => {
  const dshPkg = JSON.parse(fs.readFileSync(path.join(DSH_DIR, 'package.json'), 'utf8'));
  assert.equal(dshPkg.version, PKG.version);
  assert.equal(dshPkg.dsh?.bundle?.patch, './cordis.patch.yml');

  for (const rel of [
    'cordis.patch.yml',
    'index.mjs',
    'icon.svg',
    'locale/zh.json',
    'locale/en.json',
    'docs/DETAIL.md',
    'skills/biz-design-agent/SKILL.md',
    'runtime/bin/biz-design-agent.mjs',
  ]) {
    assert.ok(fs.existsSync(path.join(DSH_DIR, rel)), `缺少 DSH Bundle 文件：${rel}`);
  }

  // 校验 index.mjs 语法有效且不含硬编码用户路径
  execFileSync(process.execPath, ['--check', path.join(DSH_DIR, 'index.mjs')]);
  const indexSrc = fs.readFileSync(path.join(DSH_DIR, 'index.mjs'), 'utf8');
  assert.ok(!indexSrc.includes('/Users/'), 'index.mjs 不得包含硬编码绝对路径');
  assert.ok(indexSrc.includes('process.execPath'), 'index.mjs 应复用 DSH 内置 Node');

  const zh = JSON.parse(fs.readFileSync(path.join(DSH_DIR, 'locale', 'zh.json'), 'utf8'));
  const en = JSON.parse(fs.readFileSync(path.join(DSH_DIR, 'locale', 'en.json'), 'utf8'));
  assert.ok(zh.meta?.title && en.meta?.title);
});

test('双击安装器存在且 macOS 脚本语法正确', () => {
  const mac = path.join(INSTALLERS_DIR, 'Install-Mac.command');
  const win = path.join(INSTALLERS_DIR, 'Install-Windows.bat');
  assert.ok(fs.existsSync(mac));
  assert.ok(fs.existsSync(win));
  if (process.platform !== 'win32') {
    execFileSync('bash', ['-n', mac]);
  }
});

test('MCP figma_install_plugin 可将 Figma 插件复制到用户指定目录', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bda-figma-install-'));
  try {
    const target = path.join(tmp, 'MyFigmaPlugin');
    const resp = await handleJsonRpc({
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: {
        name: 'figma_install_plugin',
        arguments: { targetDir: target, reveal: false },
      },
    });
    assert.equal(resp.result.isError, false);
    const data = JSON.parse(resp.result.content[0].text);
    assert.equal(data.ok, true);
    assert.equal(data.pluginDir, target);
    assert.ok(fs.existsSync(path.join(target, 'manifest.json')));
    assert.ok(fs.existsSync(path.join(target, 'code.js')));
    assert.ok(fs.existsSync(path.join(target, 'ui.html')));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('内网分发服务新增下载端点：一键安装包 ZIP、纯插件 ZIP、Figma 插件 ZIP 与 DSH .tgz', async () => {
  const { server, port } = await startDistServer({ port: 0, host: '127.0.0.1' });
  try {
    const base = `http://127.0.0.1:${port}`;

    const cfg = await (await fetch(`${base}/api/config.json`)).json();
    assert.ok(cfg.installerZipUrl.endsWith('/downloads/biz-design-agent-installer.zip'));
    assert.ok(cfg.dshBundleUrl.endsWith('/packages/dsh-biz-design-agent.tgz'));

    const installerRes = await fetch(`${base}/downloads/biz-design-agent-installer.zip`);
    assert.equal(installerRes.status, 200);
    const installerFiles = readZip(Buffer.from(await installerRes.arrayBuffer()));
    assert.ok(installerFiles.has('BizDesignAgent-Installer/Install-Mac.command'));
    assert.ok(installerFiles.has('BizDesignAgent-Installer/Install-Windows.bat'));
    assert.ok(installerFiles.has('BizDesignAgent-Installer/harness-plugin/.antigravity-plugin/plugin.json'));
    assert.ok(installerFiles.has('BizDesignAgent-Installer/dsh-bundle/cordis.patch.yml'));

    const pluginRes = await fetch(`${base}/downloads/biz-design-agent-plugin.zip`);
    assert.equal(pluginRes.status, 200);
    const pluginFiles = readZip(Buffer.from(await pluginRes.arrayBuffer()));
    assert.ok(pluginFiles.has('.claude-plugin/plugin.json'));
    assert.ok(pluginFiles.has('scripts/run-mcp'));

    const figmaRes = await fetch(`${base}/downloads/figma-plugin.zip`);
    assert.equal(figmaRes.status, 200);
    const figmaFiles = readZip(Buffer.from(await figmaRes.arrayBuffer()));
    assert.ok(figmaFiles.has('BizDesignAgent-FigmaPlugin/manifest.json'));

    const dshRes = await fetch(`${base}/packages/dsh-biz-design-agent.tgz`);
    assert.equal(dshRes.status, 200);
    const dshBuf = Buffer.from(await dshRes.arrayBuffer());
    assert.ok(dshBuf.length > 1000, 'DSH .tgz 包体不应为空');
  } finally {
    await new Promise((r) => server.close(r));
  }
});
