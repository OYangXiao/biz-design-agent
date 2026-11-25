// 本机 Node/NVM 环境扫描、npm 源检查、Figma 客户端与共享本地桥（:8787）状态管理
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PKG_ROOT = path.resolve(HERE, '..');
export const AGENT_HOME = path.join(os.homedir(), '.biz-design-agent');
export const DEFAULT_BRIDGE_URL = process.env.BRIDGE || `http://localhost:${process.env.DSH_FIGMA_PORT || 8787}`;

function parseMajor(ver) {
  const m = /v?(\d+)\.(\d+)\.(\d+)/.exec(String(ver || ''));
  return m ? { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), raw: `v${m[1]}.${m[2]}.${m[3]}` } : null;
}

function probeNodeBinary(binPath) {
  if (!binPath) return null;
  try {
    if (!fs.existsSync(binPath)) return null;
    const out = execFileSync(binPath, ['-v'], { encoding: 'utf8', timeout: 3000 }).trim();
    const parsed = parseMajor(out);
    if (!parsed) return null;
    return { path: binPath, version: parsed.raw, major: parsed.major, minor: parsed.minor, patch: parsed.patch, ok: parsed.major >= 18 };
  } catch {
    return null;
  }
}

export function discoverNodeCandidates() {
  const home = os.homedir();
  const isWin = process.platform === 'win32';
  const exe = isWin ? 'node.exe' : 'node';
  const candidates = new Set();

  if (process.execPath) candidates.add(process.execPath);
  if (process.env.NODE_BIN) candidates.add(process.env.NODE_BIN);

  // 扫描 PATH
  for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    candidates.add(path.join(dir, exe));
  }

  if (isWin) {
    if (process.env.NVM_SYMLINK) candidates.add(path.join(process.env.NVM_SYMLINK, exe));
    candidates.add('C:\\Program Files\\nodejs\\node.exe');
    candidates.add(path.join(home, 'AppData', 'Local', 'Programs', 'nodejs', exe));
  } else {
    candidates.add('/opt/homebrew/bin/node');
    candidates.add('/usr/local/bin/node');
    candidates.add(path.join(home, '.volta', 'bin', 'node'));
    candidates.add(path.join(home, '.dsh', 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'node', 'bin', 'node'));

    // 扫描 ~/.nvm/versions/node/*
    const nvmRoot = path.join(process.env.NVM_DIR || path.join(home, '.nvm'), 'versions', 'node');
    if (fs.existsSync(nvmRoot)) {
      for (const verDir of fs.readdirSync(nvmRoot)) {
        candidates.add(path.join(nvmRoot, verDir, 'bin', 'node'));
      }
    }
  }

  const found = [];
  for (const c of candidates) {
    const info = probeNodeBinary(c);
    if (info) found.push(info);
  }
  found.sort((a, b) => (b.major - a.major) || (b.minor - a.minor) || (b.patch - a.patch));
  return found;
}

export function detectNvmInstalled() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    const nvmHome = process.env.NVM_HOME || path.join(home, 'AppData', 'Roaming', 'nvm');
    return { installed: fs.existsSync(path.join(nvmHome, 'nvm.exe')), type: 'nvm-windows', dir: nvmHome };
  }
  const nvmDir = process.env.NVM_DIR || path.join(home, '.nvm');
  return { installed: fs.existsSync(path.join(nvmDir, 'nvm.sh')), type: 'nvm-sh', dir: nvmDir };
}

export function detectNpmRegistry(nodeBin) {
  const binDir = nodeBin ? path.dirname(nodeBin) : '';
  const npmBin = binDir ? path.join(binDir, process.platform === 'win32' ? 'npm.cmd' : 'npm') : 'npm';
  const env = binDir
    ? { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}` }
    : process.env;
  try {
    const registry = execFileSync(npmBin, ['config', 'get', 'registry'], { encoding: 'utf8', timeout: 5000, env }).trim();
    return { ok: true, npmBin, registry };
  } catch (e) {
    return { ok: false, npmBin, registry: null, error: e.message };
  }
}

export function detectFigmaDesktop() {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    const paths = ['/Applications/Figma.app', path.join(home, 'Applications', 'Figma.app')];
    const hit = paths.find((p) => fs.existsSync(p));
    return { installed: Boolean(hit), path: hit || null };
  }
  if (process.platform === 'win32') {
    const p = path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Figma', 'Figma.exe');
    return { installed: fs.existsSync(p), path: fs.existsSync(p) ? p : null };
  }
  return { installed: false, path: null };
}

export const FEISHU_DOC_URL = 'https://open.feishu.cn/document/mcp_open_tools/feishu-cli-let-ai-actually-do-your-work-in-feishu';

export function detectFeishuCli(nodeBin = null, { explicitBin = null } = {}) {
  const home = os.homedir();
  const isWin = process.platform === 'win32';
  const exe = isWin ? 'lark-cli.cmd' : 'lark-cli';
  const binDir = nodeBin ? path.dirname(nodeBin) : '';
  const candidates = new Set();

  if (explicitBin) candidates.add(explicitBin);
  if (process.env.LARK_CLI_BIN) candidates.add(process.env.LARK_CLI_BIN);
  if (binDir) candidates.add(path.join(binDir, exe));
  for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    candidates.add(path.join(dir, exe));
  }
  if (!isWin) {
    candidates.add('/opt/homebrew/bin/lark-cli');
    candidates.add('/usr/local/bin/lark-cli');
    candidates.add(path.join(home, '.volta', 'bin', 'lark-cli'));
    const nvmRoot = path.join(process.env.NVM_DIR || path.join(home, '.nvm'), 'versions', 'node');
    if (fs.existsSync(nvmRoot)) {
      for (const verDir of fs.readdirSync(nvmRoot)) {
        candidates.add(path.join(nvmRoot, verDir, 'bin', 'lark-cli'));
      }
    }
  }

  const foundBin = [...candidates].find((c) => c && fs.existsSync(c)) || null;
  if (!foundBin) {
    return {
      installed: false,
      bin: null,
      version: null,
      authenticated: false,
      statusText: '未安装 @larksuite/cli（如需将 PRD 同步到飞书云文档，请先安装并登录授权）',
      installCmd: 'npm install -g @larksuite/cli',
      initCmd: 'lark-cli auth login',
      fallbackConfigCmd: 'lark-cli config init --new',
      docUrl: FEISHU_DOC_URL,
    };
  }

  const execDir = path.dirname(foundBin);
  const env = {
    ...process.env,
    PATH: [binDir, execDir, process.env.PATH || ''].filter(Boolean).join(path.delimiter),
  };

  let version = null;
  try {
    version = execFileSync(foundBin, ['--version'], { encoding: 'utf8', timeout: 4000, env }).trim().split(/\r?\n/)[0];
  } catch { /* ignore */ }

  let authenticated = false;
  let statusText = '';
  try {
    const out = execFileSync(foundBin, ['auth', 'status'], { encoding: 'utf8', timeout: 5000, env }).trim();
    authenticated = !/not logged in|unauthenticated|请先登录|未登录|config init/i.test(out);
    statusText = out || '已登录飞书';
  } catch (e) {
    const msg = String(e.stderr || e.stdout || e.message || '').trim();
    authenticated = false;
    statusText = msg || '尚未登录飞书账号，请执行 lark-cli auth login';
  }

  return {
    installed: true,
    bin: foundBin,
    version,
    authenticated,
    statusText,
    installCmd: 'npm install -g @larksuite/cli',
    initCmd: 'lark-cli auth login',
    fallbackConfigCmd: 'lark-cli config init --new',
    docUrl: FEISHU_DOC_URL,
  };
}

export async function checkBridgeStatus(bridgeUrl = DEFAULT_BRIDGE_URL) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(`${bridgeUrl}/status`, { signal: ctrl.signal });
    clearTimeout(timer);
    const data = await res.json();
    return { reachable: true, ...data };
  } catch (e) {
    return { reachable: false, pluginOnline: false, error: e.message };
  }
}

export async function ensureBridgeRunning({ bridgeUrl = DEFAULT_BRIDGE_URL, nodeBin = process.execPath } = {}) {
  const current = await checkBridgeStatus(bridgeUrl);
  if (current.reachable) return { started: false, reused: true, status: current };

  fs.mkdirSync(AGENT_HOME, { recursive: true });
  const logFile = path.join(AGENT_HOME, 'bridge.log');
  const outFd = fs.openSync(logFile, 'a');
  const bridgeScript = path.join(PKG_ROOT, 'bridge', 'server.mjs');
  const child = spawn(nodeBin, [bridgeScript], {
    detached: true,
    stdio: ['ignore', outFd, outFd],
    env: { ...process.env },
  });
  child.unref();
  fs.closeSync(outFd);
  fs.writeFileSync(path.join(AGENT_HOME, 'bridge.pid'), `${child.pid}\n`, 'utf8');

  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
    const st = await checkBridgeStatus(bridgeUrl);
    if (st.reachable) return { started: true, reused: false, pid: child.pid, logFile, status: st };
  }
  return { started: false, reused: false, pid: child.pid, logFile, status: { reachable: false, pluginOnline: false } };
}

export function installLocalPlugin(targetDir = path.join(AGENT_HOME, 'plugin')) {
  const srcDir = path.join(PKG_ROOT, 'plugin');
  fs.mkdirSync(targetDir, { recursive: true });
  for (const fname of ['manifest.json', 'code.js', 'ui.html']) {
    const src = path.join(srcDir, fname);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(targetDir, fname));
    }
  }
  return {
    pluginDir: targetDir,
    manifestPath: path.join(targetDir, 'manifest.json'),
  };
}

export async function runDoctor({ bridgeUrl = DEFAULT_BRIDGE_URL } = {}) {
  const nodes = discoverNodeCandidates();
  const bestNode = nodes.find((n) => n.ok) || nodes[0] || null;
  const nvm = detectNvmInstalled();
  const npmInfo = detectNpmRegistry(bestNode?.path);
  const figmaApp = detectFigmaDesktop();
  const feishu = detectFeishuCli(bestNode?.path);
  const localManifest = path.join(AGENT_HOME, 'plugin', 'manifest.json');
  const bridge = await checkBridgeStatus(bridgeUrl);

  return {
    ok: Boolean(bestNode?.ok && bridge.reachable && bridge.pluginOnline),
    platform: process.platform,
    arch: process.arch,
    node: {
      ok: Boolean(bestNode?.ok),
      recommended: bestNode,
      allFound: nodes,
    },
    nvm,
    npm: npmInfo,
    feishu,
    figma: {
      desktopInstalled: figmaApp.installed,
      desktopPath: figmaApp.path,
      localPluginInstalled: fs.existsSync(localManifest),
      localManifestPath: localManifest,
    },
    bridge: {
      url: bridgeUrl,
      reachable: bridge.reachable,
      pluginOnline: Boolean(bridge.pluginOnline),
      pluginInfo: bridge.pluginInfo || null,
    },
  };
}
