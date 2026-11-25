#!/usr/bin/env node
// 把内网分发服务动态渲染的接入引导，预渲染成静态文件并随仓库分发。
// 目的：clone 仓库的 AI 无需先启动服务，直接读 dist/ 下的文件即可完成接入。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderBootstrapMarkdown, renderIndexHtml } from '../server/dist-server.mjs';
import { buildAllPlugins } from './build-plugins.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT_DIR = path.join(ROOT, 'dist');

// 静态版展示的默认分发地址。真实部署时以 serve-dist 动态渲染为准，
// 这里只是让读文档的 AI 有一个可直接照抄的示例。
const DEFAULT_BASE_URL = process.env.BIZ_DESIGN_AGENT_BASE_URL || 'http://localhost:8790';

const banner = `<!--
  本文件由 scripts/build-dist.mjs 自动生成，请勿手工编辑。
  内容与 \`biz-design-agent serve-dist\` 在 ${DEFAULT_BASE_URL} 动态渲染的一致。
  如需更新：node scripts/build-dist.mjs
-->

`;

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const bootstrap = renderBootstrapMarkdown({ baseUrl: DEFAULT_BASE_URL });
  const bootstrapPath = path.join(OUT_DIR, 'bootstrap.md');
  fs.writeFileSync(bootstrapPath, banner + bootstrap, 'utf8');

  const indexHtml = renderIndexHtml(DEFAULT_BASE_URL);
  const indexPath = path.join(OUT_DIR, 'index.html');
  fs.writeFileSync(indexPath, indexHtml, 'utf8');

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const metaPath = path.join(OUT_DIR, 'meta.json');
  fs.writeFileSync(metaPath, `${JSON.stringify({
    name: pkg.name,
    version: pkg.version,
    generatedAt: new Date().toISOString(),
    sourceBaseUrl: DEFAULT_BASE_URL,
    note: '静态预览产物，接入方式与 serve-dist 动态渲染一致',
  }, null, 2)}\n`, 'utf8');

  console.log(`已生成静态分发产物（v${pkg.version}）：`);
  for (const p of [bootstrapPath, indexPath, metaPath]) {
    console.log(`  ${path.relative(ROOT, p)}  ${fs.statSync(p).size} bytes`);
  }

  const pluginRes = buildAllPlugins();
  console.log(`已同步构建多 Harness 插件产物（v${pluginRes.version}）：`);
  console.log(`  ${path.relative(ROOT, pluginRes.harnessPluginDir)}`);
  console.log(`  ${path.relative(ROOT, pluginRes.dshBundleDir)}`);
  console.log(`  ${path.relative(ROOT, pluginRes.installersDir)}`);
}

main();
