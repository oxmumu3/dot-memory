#!/usr/bin/env node
/**
 * Isolated Official Signed DeepSeek Harness.app (0.2.3-alpha.2) CLI + Desktop E2E verification.
 * Strictly NEVER modifies /Applications/DeepSeek Harness.app or ~/.dsh/profiles/desktop.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const SRC_APP = '/Applications/DeepSeek Harness.app';
const TARBALL = '/Users/shan/Repos/dot-memory/dist-pack/oxmumu3-dot-memory-0.2.0.tgz';
const OUT_SHOT = '/Users/shan/Library/Mobile Documents/com~apple~CloudDocs/Agent/output/dot-memory-v020-2026-11-28/screenshots/09-dsh-023-live-desktop-connect.png';

const LIVE_PROFILE = path.join(os.homedir(), '.dsh', 'profiles', 'desktop');
const LIVE_PKG = path.join(LIVE_PROFILE, 'package.json');
const DIAG_DIR = path.join(os.homedir(), 'Library', 'Logs', 'DiagnosticReports');
const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

const startMs = Date.now();
const livePkgBefore = fs.existsSync(LIVE_PKG) ? sha256(LIVE_PKG) : null;
const diagBefore = new Set(fs.existsSync(DIAG_DIR) ? fs.readdirSync(DIAG_DIR) : []);

assert.ok(fs.existsSync(SRC_APP), 'Missing /Applications/DeepSeek Harness.app');
assert.ok(fs.existsSync(TARBALL), `Missing tarball: ${TARBALL}`);

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'dot-memory-dsh-023-'));
const APP = path.join(TMP_ROOT, 'DeepSeek Harness.app');
const FIX = path.join(TMP_ROOT, 'fix');
const DSH_HOME = path.join(FIX, '.dsh');
const WORK = path.join(FIX, 'workspace');
const DOT_MEMORY_HOME = path.join(FIX, 'dot-memory');
const PROFILE = path.join(DSH_HOME, 'profiles', 'desktop');

const cpRes = spawnSync('cp', ['-Rp', SRC_APP, APP], { encoding: 'utf8' });
assert.equal(cpRes.status, 0, cpRes.stderr);
const csRes = spawnSync('/usr/bin/codesign', ['--verify', '--strict', APP], { encoding: 'utf8' });
assert.equal(csRes.status, 0, `Isolated app codesign failed: ${csRes.stderr}`);

// Seed initial dot-memory handoffs & wiki so the UI has rich state for wheel-scroll & E2E
fs.mkdirSync(path.join(DOT_MEMORY_HOME, 'handoffs'), { recursive: true });
fs.mkdirSync(path.join(DOT_MEMORY_HOME, 'wiki', 'projects'), { recursive: true });
fs.writeFileSync(
  path.join(DOT_MEMORY_HOME, 'handoffs', '2026-11-25.jsonl'),
  [
    JSON.stringify({
      id: 'hoff-e2e-1',
      agent: 'antigravity',
      workspace: 'voice-clone',
      status: 'done',
      title: 'Shan-Pro eleven_v4 训练完成 100%',
      summary: '声纹核验已通过并放行重训，eleven_v4 完成度 100%，下支科普片可直接使用。',
      ts: '2026-11-25T14:02:28Z',
    }),
    JSON.stringify({
      id: 'hoff-e2e-2',
      agent: 'codex',
      workspace: 'dot-memory',
      status: 'done',
      title: '完成零向量双语混合检索与 Wiki 增量同步',
      summary: '实现 Han-Bigram RRF 与 1-hop Flashback。',
      ts: '2026-11-25T15:10:00Z',
    }),
  ].join('\n') + '\n',
);
const initialMemItems = [];
for (let i = 1; i <= 6; i += 1) {
  initialMemItems.push({
    id: `rule-seed-${i}`,
    bucket: i <= 3 ? 'rules' : (i <= 5 ? 'style' : 'focus'),
    topic: i === 6 ? 'dot-memory' : undefined,
    text: `实测预置条目 #${i}：用于验证桌面面板滚动与活体记忆持久化闭环（跨 Agent 共享大脑）。`,
    active: true,
    sourceKind: 'manual',
    provenance: 'E2E 预置基线',
    effect: '首轮附注生效',
    quote: `实测预置条目 #${i}`,
    quoteSource: 'seed',
    quotedInVerified: true,
    updatedAt: '2026-11-25T15:00:00Z',
  });
}
fs.writeFileSync(
  path.join(DOT_MEMORY_HOME, 'living-memory.json'),
  JSON.stringify({ version: 1, items: initialMemItems, candidates: [], clues: [], removedRules: [], lastDreamAt: '2026-11-25T15:00:00Z' }, null, 2),
);

// Seed isolated fake Claude Code + Hermes configs inside FIX (never touches real HOME!)
fs.mkdirSync(path.join(FIX, '.claude'), { recursive: true });
fs.writeFileSync(path.join(FIX, '.claude', 'settings.json'), JSON.stringify({ theme: 'dark' }, null, 2));
fs.mkdirSync(path.join(FIX, '.hermes'), { recursive: true });
fs.writeFileSync(path.join(FIX, '.hermes', 'config.yaml'), 'model:\n  default: deepseek-v4-pro\n  mcp:\n    provider: auto\nmcp_servers: {}\n');

let hangServer;
const proxySockets = new Set();
const hangPort = await new Promise((resolve) => {
  hangServer = net.createServer((sock) => {
    proxySockets.add(sock);
    sock.on('error', () => {});
    sock.on('close', () => proxySockets.delete(sock));
  });
  hangServer.listen(0, '127.0.0.1', () => resolve(hangServer.address().port));
});
const PROXY = `http://127.0.0.1:${hangPort}`;

const llmServer = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
});
const llmPort = await new Promise((resolve) => llmServer.listen(0, '127.0.0.1', () => resolve(llmServer.address().port)));
const LLM_BASE = `http://127.0.0.1:${llmPort}`;

const baseEnv = {
  PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
  USER: 'shan',
  LANG: 'en_US.UTF-8',
  CFFIXED_USER_HOME: FIX,
  HOME: FIX,
  TMPDIR: path.join(FIX, 'tmp'),
  DSH_HOME,
  DOT_MEMORY_HOME,
  DSH_AGENTS_HOME: path.join(FIX, 'agents'),
  XDG_CONFIG_HOME: path.join(FIX, 'xdg-config'),
  XDG_DATA_HOME: path.join(FIX, 'xdg-data'),
  XDG_CACHE_HOME: path.join(FIX, 'xdg-cache'),
  DSH_TELEMETRY_DISABLED: '1',
  HTTP_PROXY: PROXY,
  HTTPS_PROXY: PROXY,
  ALL_PROXY: PROXY,
  NODE_USE_ENV_PROXY: '1',
  NO_PROXY: 'localhost,127.0.0.1',
  DEEPSEEK_API_KEY: 'sk-dotmem-isolated-mock-key',
  DEEPSEEK_BASE_URL: LLM_BASE,
};

for (const dir of [DSH_HOME, WORK, path.join(FIX, 'tmp'), path.join(FIX, 'xdg-config'),
  path.join(FIX, 'xdg-data'), path.join(FIX, 'xdg-cache'), path.join(FIX, 'agents'), PROFILE]) {
  fs.mkdirSync(dir, { recursive: true });
}
fs.writeFileSync(path.join(PROFILE, 'package.json'), JSON.stringify({
  name: 'dsh-profile-desktop',
  private: true,
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
}, null, 2));
fs.writeFileSync(path.join(PROFILE, 'cordis.yml'), '[]\n');
fs.writeFileSync(path.join(PROFILE, 'cordis.patch.yml'), '[]\n');
fs.writeFileSync(path.join(PROFILE, 'pnpm-workspace.yaml'), 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n');

const CLI = path.join(APP, 'Contents', 'Resources', 'runtime', 'cli', 'bin', 'dsh');
const addRes = spawnSync(CLI, ['plugin', '--profile', 'desktop', 'add', TARBALL, '--offline'], {
  env: { ...baseEnv, npm_config_offline: 'true' },
  cwd: WORK,
  encoding: 'utf8',
  timeout: 60000,
});
assert.equal(addRes.status, 0, `dsh plugin add failed:\n${addRes.stderr}\n${addRes.stdout}`);

const listRes = spawnSync(CLI, ['plugin', '--profile', 'desktop', 'list'], {
  env: { ...baseEnv, npm_config_offline: 'true' },
  cwd: WORK,
  encoding: 'utf8',
  timeout: 30000,
});
assert.equal(listRes.status, 0, `dsh plugin list failed:\n${listRes.stderr}`);
assert.match(listRes.stdout, /@oxmumu3\/dot-memory/, 'dsh plugin list must include @oxmumu3/dot-memory');

// Ensure bundle enabled in profile if CLI add did not auto-enable
const profPath = path.join(PROFILE, 'package.json');
const prof = JSON.parse(fs.readFileSync(profPath, 'utf8'));
if (!prof.dsh.profile.bundles.includes('@oxmumu3/dot-memory')) {
  prof.dsh.profile.bundles.push('@oxmumu3/dot-memory');
  fs.writeFileSync(profPath, JSON.stringify(prof, null, 2) + '\n');
}

function openApp(label) {
  const userData = path.join(FIX, `electron-${label}`);
  fs.mkdirSync(userData, { recursive: true });
  fs.rmSync(path.join(userData, 'DevToolsActivePort'), { force: true });
  const child = spawn(path.join(APP, 'Contents', 'MacOS', 'DeepSeek Harness'), [
    `--user-data-dir=${userData}`,
    `--log-file=${path.join(FIX, `electron-${label}.log`)}`,
    `--proxy-server=${PROXY}`,
    '--remote-debugging-port=0',
    '--remote-debugging-address=127.0.0.1',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=CalculateNativeWinOcclusion',
  ], { cwd: WORK, env: baseEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => { log = (log + d).slice(-40000); });
  child.stderr.on('data', (d) => { log = (log + d).slice(-40000); });
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  async function waitFor(what, fn, budget = 120000) {
    const end = Date.now() + budget;
    let last = null;
    while (Date.now() < end) {
      if (child.exitCode !== null) throw new Error(`app exited before ${what}: ${log.slice(-2000)}`);
      try { const v = await fn(); if (v) return v; } catch (e) { last = e; }
      await delay(250);
    }
    throw new Error(`timeout waiting for ${what}${last ? `: ${last.message}` : ''}`);
  }
  return { child, exited, waitFor, log: () => log, userData, label };
}

async function attachApp(app, exceptions) {
  const devtools = async (p) => (await fetch(`http://127.0.0.1:${app.port}${p}`, { signal: AbortSignal.timeout(5000) })).json();
  async function attach(endpoint) {
    const socket = new WebSocket(endpoint);
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('ws timeout')), 8000);
      socket.addEventListener('open', () => { clearTimeout(t); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(t); reject(new Error('ws error')); }, { once: true });
    });
    let next = 0;
    const pending = new Map();
    const listeners = new Map();
    socket.addEventListener('message', ({ data }) => {
      const ev = JSON.parse(data);
      if (ev.id !== undefined && pending.has(ev.id)) {
        const resolve = pending.get(ev.id);
        pending.delete(ev.id);
        resolve(ev);
        return;
      }
      if (ev.method) for (const fn of listeners.get(ev.method) ?? []) fn(ev.params);
    });
    return {
      close: () => socket.close(),
      on(m, fn) { listeners.set(m, [...(listeners.get(m) ?? []), fn]); },
      command(method, params = {}) {
        return new Promise((resolve, reject) => {
          const id = ++next;
          const t = setTimeout(() => { pending.delete(id); reject(new Error(`cdp timeout ${method}`)); }, 25000);
          pending.set(id, (ev) => {
            clearTimeout(t);
            if (ev.error) reject(new Error(`${method}: ${ev.error.message}`));
            else resolve(ev.result);
          });
          socket.send(JSON.stringify({ id, method, params }));
        });
      },
    };
  }
  app.port = await app.waitFor('devtools', () => {
    const file = path.join(app.userData, 'DevToolsActivePort');
    if (!fs.existsSync(file)) return 0;
    const value = Number(fs.readFileSync(file, 'utf8').split('\n')[0]);
    return value > 0 ? value : 0;
  }, 45000);
  const target = await app.waitFor('renderer', async () => (await devtools('/json/list')).find((r) => r.type === 'page' && r.url === 'dsh-app://app/'), 90000);
  const page = await attach(target.webSocketDebuggerUrl);
  page.on('Runtime.exceptionThrown', (p) => {
    exceptions.push(String(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text ?? '').slice(0, 1200));
  });
  await page.command('Runtime.enable').catch(() => {});
  await page.command('Page.enable').catch(() => {});
  await page.command('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  const evaluate = async (expression) => {
    const r = await page.command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`evaluate: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? ''}`);
    return r.result.value;
  };
  async function close() {
    try { page.close(); } catch {}
    try {
      const browser = await attach((await devtools('/json/version')).webSocketDebuggerUrl);
      await browser.command('Browser.close');
      browser.close();
    } catch { app.child.kill('SIGTERM'); }
    let ended = await Promise.race([app.exited, delay(20000).then(() => null)]);
    if (!ended) {
      app.child.kill('SIGKILL');
      ended = await Promise.race([app.exited, delay(5000)]);
    }
    return ended;
  }
  return { evaluate, command: page.command, close, waitFor: app.waitFor };
}

async function openDotMemoryPanel(ui) {
  const boot = await ui.waitFor('__DSH_BOOT__', () => ui.evaluate(`(() => {
    const entries = globalThis.__DSH_BOOT__?.entries ?? [];
    const hit = entries.find(r => r.id === '@oxmumu3/dot-memory');
    return hit ? { count: entries.filter(r => r.id === '@oxmumu3/dot-memory').length, release: globalThis.__DSH_BOOT__?.release?.version } : null;
  })()`), 45000);
  assert.equal(boot.count, 1, 'Expected @oxmumu3/dot-memory booted once');

  let lastClick = 0;
  await ui.waitFor('dot-memory workbench mounted', async () => {
    const mounted = await ui.evaluate(`Boolean(document.querySelector('[data-testid="dm-workbench"] .dm-h1'))`);
    if (mounted) return true;
    if (Date.now() - lastClick > 800) {
      lastClick = Date.now();
      await ui.evaluate(`(() => {
        const el = [...document.querySelectorAll('button,[role=button],a')].find(n => {
          const r = n.getBoundingClientRect();
          return r.height > 0 && (n.getAttribute('aria-label') === 'Dot 记忆总线' || n.textContent?.trim() === 'Dot 记忆总线');
        });
        if (el) el.click();
      })()`);
    }
    return false;
  }, 30000);
  await ui.waitFor('initial view loaded', () => ui.evaluate(`document.querySelector('[data-testid="dm-workbench"]')?.innerText.includes('实测预置条目')`), 15000);
  return boot;
}

const exceptions = [];
const receipt = {
  ok: false,
  livePkgIntact: false,
  release: null,
  scrollTop: 0,
  connectedInDesktop: false,
  persistedAcrossRestart: false,
  exceptions: [],
  newCrashLogs: [],
};
let app = null;
let ui = null;

try {
  // Boot 1
  app = openApp('boot1');
  ui = await attachApp(app, exceptions);
  const boot1 = await openDotMemoryPanel(ui);
  receipt.release = boot1.release;

  await ui.command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
  await delay(250);

  const layoutCheck = await ui.evaluate(`({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  })`);
  assert.ok(layoutCheck.scrollWidth <= layoutCheck.innerWidth, `Desktop overflow: ${layoutCheck.scrollWidth} > ${layoutCheck.innerWidth}`);

  const shot = await ui.command('Page.captureScreenshot', { format: 'png', fromSurface: true });
  fs.mkdirSync(path.dirname(OUT_SHOT), { recursive: true });
  fs.writeFileSync(OUT_SHOT, Buffer.from(shot.data, 'base64'));

  // Test mouseWheel scroll on .dm-root
  const box = await ui.evaluate(`(() => {
    const r = document.querySelector('.dm-root').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, canScroll: document.querySelector('.dm-root').scrollHeight > document.querySelector('.dm-root').clientHeight };
  })()`);
  await ui.command('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.x, y: box.y, deltaX: 0, deltaY: 360 });
  await delay(180);
  receipt.scrollTop = await ui.evaluate(`document.querySelector('.dm-root').scrollTop`);
  if (box.canScroll) assert.ok(receipt.scrollTop > 0, `Expected .dm-root scrollTop > 0, got ${receipt.scrollTop}`);

  // Add a live memory rule via UI dialog
  await ui.evaluate(`document.querySelector('[data-testid="dm-btn-add"]').click()`);
  await ui.waitFor('add dialog open', () => ui.evaluate(`Boolean(document.querySelector('[data-testid="dm-add-dialog"][open] textarea'))`), 5000);
  await ui.evaluate(`(() => {
    const ta = document.querySelector('[data-testid="dm-add-dialog"] textarea');
    ta.focus();
  })()`);
  const ADDED_TEXT = 'E2E 持久化验证条目：Desktop 0.2.3-alpha.2 隔离验真写入';
  await ui.command('Input.insertText', { text: ADDED_TEXT });
  await delay(100);
  await ui.evaluate(`document.querySelector('[data-testid="dm-add-submit"]').click()`);
  await ui.waitFor('added item visible in Boot 1', () => ui.evaluate(`document.body.innerText.includes(${JSON.stringify(ADDED_TEXT)})`), 10000);

  // Switch to Connect tab and click Connect All inside the real Electron app
  await ui.evaluate(`document.querySelector('[data-testid="dm-tab-connect"]').click()`);
  await ui.waitFor('connect tab mounted', () => ui.evaluate(`Boolean(document.querySelector('[data-testid="dm-btn-connect-all"]'))`), 8000);
  await ui.evaluate(`document.querySelector('[data-testid="dm-btn-connect-all"]').click()`);
  await ui.waitFor('claude & hermes connected in UI', () => ui.evaluate(`(() => {
    const c = document.querySelector('[data-testid="dm-conn-row-claude-code"]')?.innerText || '';
    const h = document.querySelector('[data-testid="dm-conn-row-hermes"]')?.innerText || '';
    return c.includes('自动写 Hook 已接') && c.includes('主动读 MCP 已接') && h.includes('自动写 Hook 已接') && h.includes('主动读 MCP 已接');
  })()`), 10000);

  // Verify real isolated files, non-Electron node command, and automatic backups
  const isolatedClaude = JSON.parse(fs.readFileSync(path.join(FIX, '.claude.json'), 'utf8'));
  const isolatedClaudeSettings = JSON.parse(fs.readFileSync(path.join(FIX, '.claude', 'settings.json'), 'utf8'));
  const isolatedHermes = fs.readFileSync(path.join(FIX, '.hermes', 'config.yaml'), 'utf8');
  assert.ok(isolatedClaude.mcpServers['dot-memory']?.command, 'Missing claude-code mcpServers entry');
  assert.equal(isolatedClaude.mcpServers['dot-memory'].command.includes('DeepSeek Harness.app/Contents/MacOS/'), false, 'Electron binary leaked into MCP command!');
  assert.ok(JSON.stringify(isolatedClaudeSettings.hooks?.Stop || []).includes('dot-memory.mjs'), 'Missing claude-code Stop hook');
  assert.match(isolatedHermes, /dot-memory:/, 'Missing hermes mcp_servers entry');
  assert.ok(fs.existsSync(path.join(FIX, '.hermes', 'hooks', 'dot-memory-handoff', 'handler.py')), 'Missing hermes handler.py');
  assert.ok(fs.readdirSync(path.join(DOT_MEMORY_HOME, 'backups')).length >= 2, 'Expected automatic backups before editing configs');
  receipt.connectedInDesktop = true;

  const shotConnect = await ui.command('Page.captureScreenshot', { format: 'png', fromSurface: true });
  fs.writeFileSync(OUT_SHOT, Buffer.from(shotConnect.data, 'base64'));

  await ui.close();
  ui = null;
  app = null;

  // Boot 2: Cold restart persistence check
  app = openApp('boot2');
  ui = await attachApp(app, exceptions);
  await openDotMemoryPanel(ui);
  const persisted = await ui.waitFor('added item persisted in Boot 2', () => ui.evaluate(`document.body.innerText.includes('E2E 持久化验证条目：Desktop 0.2.3-alpha.2 隔离验真写入')`), 15000);
  receipt.persistedAcrossRestart = Boolean(persisted);
  assert.equal(receipt.persistedAcrossRestart, true, 'Memory item did not persist across cold restart');

  await ui.close();
  ui = null;
  app = null;

  // Official CLI remove check
  const rmRes = spawnSync(CLI, ['plugin', '--profile', 'desktop', 'remove', '@oxmumu3/dot-memory'], {
    env: { ...baseEnv, npm_config_offline: 'true' },
    cwd: WORK,
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(rmRes.status, 0, `dsh plugin remove failed: ${rmRes.stderr}\n${rmRes.stdout}`);

  assert.equal(exceptions.length, 0, `Unexpected renderer exceptions: ${exceptions.join(' | ')}`);
  receipt.ok = true;
} finally {
  if (ui) await ui.close().catch(() => {});
  else if (app) { try { app.child.kill('SIGKILL'); } catch {} }
  llmServer.close();
  for (const s of proxySockets) s.destroy();
  hangServer.close();

  const livePkgAfter = fs.existsSync(LIVE_PKG) ? sha256(LIVE_PKG) : null;
  receipt.livePkgIntact = livePkgAfter === livePkgBefore;
  const diagAfter = fs.existsSync(DIAG_DIR) ? fs.readdirSync(DIAG_DIR) : [];
  receipt.newCrashLogs = diagAfter.filter((f) => !diagBefore.has(f) && /DeepSeek|Chrome|Electron|Crash|headless/i.test(f) && fs.statSync(path.join(DIAG_DIR, f)).mtimeMs >= startMs - 2000);

  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
}

assert.equal(receipt.livePkgIntact, true, 'CRITICAL: ~/.dsh/profiles/desktop/package.json was modified!');
assert.equal(receipt.newCrashLogs.length, 0, `New crash logs detected: ${receipt.newCrashLogs.join(', ')}`);
console.log(JSON.stringify(receipt, null, 2));
