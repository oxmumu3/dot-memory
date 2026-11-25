#!/usr/bin/env node
/**
 * 6-viewport @2x Headless visual audit for @oxmumu3/dot-memory DSH UI.
 * Uses @shan/hyperframes-runtime's safe chrome-headless-shell (never system Chrome).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const puppeteer = require('/Users/shan/.local/share/hyperframes-runtime/node_modules/puppeteer-core');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const SAFE_SHELL = '/Users/shan/.local/share/hyperframes-runtime/safe-browser/chrome-headless-shell';
const REACT_UMD = '/Users/shan/dsh-finder-scratch/finder-launch-video-20261115/node_modules/react/umd/react.production.min.js';
const REACT_DOM_UMD = '/Users/shan/dsh-finder-scratch/finder-launch-video-20261115/node_modules/react-dom/umd/react-dom.production.min.js';
const CLIENT_JS = path.join(rootDir, 'dist', 'client.js');
const OUT_DIR = '/Users/shan/Library/Mobile Documents/com~apple~CloudDocs/Agent/output/dot-memory-v010-2026-11-25/screenshots';

fs.mkdirSync(OUT_DIR, { recursive: true });

const MOCK_VIEW = {
  ok: true,
  integrations: {
    mcpServer: { command: 'dot-memory-mcp', env: { DOT_MEMORY_HOME: '~/.local/share/dot-memory' } },
  },
  snapshot: {
    budget: {
      usedBytes: 1842,
      maxBytes: 4096,
      bucketLimits: { rules: 15, style: 15, focus: 12 },
    },
    memory: {
      lastDreamAt: '2026-11-25T23:14:00Z',
      items: [
        {
          id: 'rule-privacy-1',
          bucket: 'rules',
          active: true,
          text: 'Google 隔离工作区仅在隔离会话内部阅读，绝不回流至通用活体记忆或 Wiki',
          provenance: '规则底座硬隔离',
          sourceKind: 'manual',
          quote: 'google_isolated 会话禁止跨线写入本地记忆总线',
          quoteSource: 'USER_MANUAL_RULE',
          quotedInVerified: true,
          updatedAt: '2026-11-25T10:15:00Z',
        },
        {
          id: 'style-install-1',
          bucket: 'style',
          active: true,
          text: 'DSH 自研插件安装指南统一采用「创造模式」提示词安装模板，不用终端命令行当主引导',
          provenance: '来自你的写作纠偏',
          sourceKind: 'chat',
          quote: '禁止在教程开头写 dsh plugin add，统一让用户切到创造模式发提示词安装',
          quoteSource: 'dsh-chat:ses-081',
          quotedInVerified: true,
          updatedAt: '2026-11-16T14:20:00Z',
        },
        {
          id: 'focus-voice-1',
          bucket: 'focus',
          topic: 'voice-clone',
          active: true,
          text: 'voice-clone：Shan-Pro eleven_v4 声纹已通过核验并 100% 重训完成，下支科普片可直接使用',
          provenance: '来自 antigravity 跨端交接',
          sourceKind: 'workspace',
          quote: 'eleven_v4 训练已完成 100%，19:43 的网页短句核验已闭环',
          quoteSource: 'hoff-ag-voice-02',
          quotedInVerified: true,
          replacedOld: 'voice-clone：等待用户在 ElevenLabs 网页读短句放行训练',
          updatedAt: '2026-11-25T14:02:28Z',
        },
        {
          id: 'focus-dot-memory-1',
          bucket: 'focus',
          topic: 'dot-memory',
          active: true,
          text: 'dot-memory：开源记忆总线 v0.1.0 完成 4KB 活体记忆、跨端交接流与 Entity Wiki 本地闭环',
          provenance: '工作区 dot-memory progress.md',
          sourceKind: 'workspace',
          quote: '13/13 单测通过 + DeepSeek Harness 0.2.3-alpha.2 隔离验真就绪',
          quoteSource: 'hoff-codex-09',
          quotedInVerified: true,
          updatedAt: '2026-11-25T15:10:00Z',
        },
      ],
      candidates: [
        {
          id: 'cand-1',
          bucket: 'style',
          text: '科普视频成片开场 0–4 秒直接抛真数值或碰撞实例，不做静态标题封皮页',
          provenance: 'Codex 交接自动提炼',
          quote: '前 4 秒直接丢 0.89 GB vs 2.6 TB 反差数字，不要放公告卡',
          quoteSource: 'STORYBOARD-BRIEF.md',
          createdAt: '2026-11-25T12:40:00Z',
        },
      ],
    },
    handoffs: [
      {
        id: 'hoff-ag-2',
        agent: 'antigravity',
        workspace: 'voice-clone',
        status: 'done',
        title: 'Shan-Pro 重训已放行（eleven_v4 完成）',
        summary: '声纹核验已通过，不用再去网页读短句。本机配音实际用的 eleven_v4 已训练完成 100%，下条片子可直接用新音色。',
        durationSec: 185,
        toolCalls: 14,
        mutatedFiles: 3,
        nextSteps: ['生成 15 秒开场试听样本并走 loudness 校准'],
        ts: '2026-11-25T14:02:28Z',
      },
      {
        id: 'hoff-ag-1',
        agent: 'antigravity',
        workspace: 'voice-clone',
        status: 'blocked',
        title: '等待网页声纹朗读核验',
        summary: 'ElevenLabs Instant/PVC 克隆在网页端拦截了声纹核验，需要用户本人打开网页朗读短句才能继续训练。',
        durationSec: 94,
        toolCalls: 9,
        mutatedFiles: 1,
        nextSteps: ['网页核验放行后继续 eleven_v4 重训'],
        ts: '2026-11-25T11:38:57Z',
      },
      {
        id: 'hoff-codex-1',
        agent: 'codex',
        workspace: 'dot-memory',
        status: 'done',
        title: '完成 @oxmumu3/dot-memory 核心检索与 Wiki 同步模块',
        summary: '实现零第三方依赖 Han-Bigram RRF 混合检索、1-hop Flashback 与 6 工具 stdio MCP 服务，全套单测 13/13 通过。',
        durationSec: 210,
        toolCalls: 22,
        mutatedFiles: 8,
        ts: '2026-11-25T13:20:00Z',
      },
      {
        id: 'hoff-claude-1',
        agent: 'claude-code',
        workspace: 'dot-ios-mobile',
        status: 'done',
        title: 'DSH.dot Bridge Stage 10 夜间代谢闭环',
        summary: '将跨端 handoff 与授权 progress.md 接入 runNightlyDreaming 和 Entity Wiki，解决旧焦点长期不代谢问题。',
        durationSec: 142,
        toolCalls: 11,
        mutatedFiles: 4,
        ts: '2026-11-25T14:48:00Z',
      },
    ],
    wikiPages: [
      {
        key: 'project/voice-clone',
        title: 'voice-clone（Shan-Pro 声纹工程）',
        summary: '追踪 Antigravity 侧 ElevenLabs Shan-Pro 声纹克隆阻塞与放行全过程，现已就绪 eleven_v4。',
        updatedAt: '2026-11-25T14:02:28Z',
        openItems: [
          { id: 'oi-1', text: '用新 eleven_v4 音色合成 DSH 记忆原理科普片口播并做 -16 LUFS 响度对齐' },
        ],
        facts: [
          { id: 'fc-1', text: '2026-11-25 19:43 Antigravity Stop Hook 捕捉到网页声纹核验阻塞，DSH.dot 主动推达提醒。' },
          { id: 'fc-2', text: '2026-11-25 22:02 eleven_v4 100% 完成，Dreaming 自动覆盖待核验旧焦点。' },
        ],
      },
      {
        key: 'project/dot-memory',
        title: 'dot-memory（跨 Agent 记忆总线）',
        summary: '开源 MIT 本地记忆协议与 DSH 工作台插件，连接 DeepSeek Harness、Antigravity、Claude Code 与 Codex。',
        updatedAt: '2026-11-25T15:10:00Z',
        openItems: [
          { id: 'oi-2', text: '完成 Milestone 1 视觉与离线隔离桌面端 E2E 验收后推送 GitHub 与 npm' },
        ],
        facts: [
          { id: 'fc-3', text: '4KB 硬上限热工作记忆 + 原话 quotedInVerified + 零向量 Han-Bigram RRF 检索。' },
        ],
      },
      {
        key: 'session/dsh-memory-debate',
        title: 'DeepSeek Harness 记忆方案探讨',
        summary: '调研 engramory / dsh-memento / memory-eternal / deja-vu 后确立「4KB 活体 + Wiki + 跨端交接」自研开源路线。',
        updatedAt: '2026-11-25T09:30:00Z',
        openItems: [],
        facts: [
          { id: 'fc-4', text: '严格规避 AGPLv3 传染源仓，纯 Node.js ESM 零原生编译痛点。' },
        ],
      },
    ],
  },
};

const HTML_PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Dot 记忆总线 · Visual Audit</title>
<style>
:root {
  --dsw-alias-bg-base: #F7F6F2;
  --dsw-alias-bg-layer-1: #EFECE4;
  --dsw-alias-bg-layer-2: #FFFFFF;
  --dsw-alias-label-primary: #17191E;
  --dsw-alias-label-secondary: #434955;
  --dsw-alias-label-tertiary: #69707D;
  --dsw-alias-border-l2: rgba(23,25,30,0.10);
  --dsw-alias-border-l4: rgba(23,25,30,0.18);
  --dsw-alias-interactive-bg-hover: rgba(23,25,30,0.05);
  --dsw-alias-button-primary-fill: #17191E;
  --dsw-alias-label-primary-foreground: #FFFFFF;
  --dsw-alias-link: #3B5CCC;
  --dsw-alias-state-success-primary: #146C43;
  --dsw-alias-state-warn-primary: #9A5B00;
  --dsw-alias-state-error-primary: #B42318;
}
body[data-ds-dark-theme="true"] {
  color-scheme: dark;
  --dsw-alias-bg-base: #141518;
  --dsw-alias-bg-layer-1: #23262F;
  --dsw-alias-bg-layer-2: #1B1D24;
  --dsw-alias-label-primary: #ECEEF2;
  --dsw-alias-label-secondary: #A9AFBC;
  --dsw-alias-label-tertiary: #7D8492;
  --dsw-alias-border-l2: rgba(255,255,255,0.11);
  --dsw-alias-border-l4: rgba(255,255,255,0.19);
  --dsw-alias-interactive-bg-hover: rgba(255,255,255,0.07);
  --dsw-alias-button-primary-fill: #ECEEF2;
  --dsw-alias-label-primary-foreground: #141518;
  --dsw-alias-link: #7B8DFF;
  --dsw-alias-state-success-primary: #4ADE80;
  --dsw-alias-state-warn-primary: #FBBF24;
  --dsw-alias-state-error-primary: #F87171;
}
html, body {
  margin: 0;
  padding: 0;
  height: 100%;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", sans-serif;
}
#app { height: 100vh; display: flex; flex-direction: column; }
</style>
</head>
<body data-ds-dark-theme="false">
<div id="app"></div>
<script src="/react.js"></script>
<script src="/react-dom.js"></script>
<script>
window.__REGISTERED_MAIN__ = null;
window.__ModuleLoader__ = {
  load({ factory }) {
    const exports = factory((name) => {
      if (name === 'react') return window.React;
      throw new Error('Unexpected require: ' + name);
    });
    const ctx = {
      effect(fn) { fn(); return () => {}; },
      slots: {
        inject(_name, fn) { return fn(); },
        register(meta, Comp) {
          if (meta && meta.name === 'main') window.__REGISTERED_MAIN__ = Comp;
          return () => {};
        },
      },
    };
    exports.apply(ctx);
  },
};
</script>
<script src="/client.js"></script>
<script>
const root = window.ReactDOM.createRoot(document.getElementById('app'));
root.render(window.React.createElement(window.__REGISTERED_MAIN__));
</script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML_PAGE);
    return;
  }
  if (req.url === '/react.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
    res.end(fs.readFileSync(REACT_UMD));
    return;
  }
  if (req.url === '/react-dom.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
    res.end(fs.readFileSync(REACT_DOM_UMD));
    return;
  }
  if (req.url === '/client.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
    res.end(fs.readFileSync(CLIENT_JS));
    return;
  }
  if (req.url === '/api/dot_memory/view') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(MOCK_VIEW));
    return;
  }
  if (req.url === '/api/dot_memory/action' && req.method === 'POST') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      if (body.action === 'search') {
        res.end(JSON.stringify({
          ok: true,
          result: {
            hits: [
              { kind: 'wiki', score: 0.96, title: 'voice-clone（Shan-Pro 声纹工程）', summary: 'eleven_v4 已训练完成 100%，19:43 网页核验已闭环' },
              { kind: 'handoff', score: 0.88, title: 'Shan-Pro 重训已放行（eleven_v4 完成）', summary: 'Antigravity -> DSH.dot 自动跨端捕获案例' },
            ],
          },
        }));
        return;
      }
      res.end(JSON.stringify(MOCK_VIEW));
    });
    return;
  }
  res.writeHead(404);
  res.end('Not found');
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}/`;

let browser;
try {
  browser = await puppeteer.launch({
    executablePath: SAFE_SHELL,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();

  const cases = [
    { name: '01-desktop-1440-light-living.png', w: 1440, h: 900, dark: false, tabTestId: 'dm-tab-living' },
    { name: '02-desktop-1440-dark-living.png', w: 1440, h: 900, dark: true, tabTestId: 'dm-tab-living' },
    { name: '03-desktop-1440-light-handoffs.png', w: 1440, h: 900, dark: false, tabTestId: 'dm-tab-handoffs' },
    { name: '04-desktop-1440-dark-wiki.png', w: 1440, h: 900, dark: true, tabTestId: 'dm-tab-wiki', search: '声纹' },
    { name: '05-split-680-light.png', w: 680, h: 820, dark: false, tabTestId: 'dm-tab-living' },
    { name: '06-narrow-390-dark.png', w: 390, h: 844, dark: true, tabTestId: 'dm-tab-living' },
  ];

  const report = [];
  for (const c of cases) {
    await page.setViewport({ width: c.w, height: c.h, deviceScaleFactor: 2 });
    await page.goto(baseUrl, { waitUntil: 'networkidle0' });
    await page.evaluate((dark) => {
      document.body.setAttribute('data-ds-dark-theme', dark ? 'true' : 'false');
    }, c.dark);
    await page.waitForSelector(`[data-testid="${c.tabTestId}"]`);
    if (c.tabTestId !== 'dm-tab-living') {
      await page.click(`[data-testid="${c.tabTestId}"]`);
    }
    if (c.search) {
      await page.waitForSelector('.dm-search-box input.dm-input');
      await page.type('.dm-search-box input.dm-input', c.search);
      await page.click('.dm-search-box button[type="submit"]');
      await page.waitForFunction(() => document.body.innerText.includes('混合检索结果'));
    }
    await new Promise((r) => setTimeout(r, 150));
    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      wbHeight: document.querySelector('[data-testid="dm-workbench"]')?.getBoundingClientRect().height || 0,
    }));
    assert.ok(metrics.scrollWidth <= metrics.innerWidth, `${c.name} horizontal overflow: ${metrics.scrollWidth} > ${metrics.innerWidth}`);
    const outPath = path.join(OUT_DIR, c.name);
    await page.screenshot({ path: outPath });
    report.push({ ...c, ...metrics, outPath });
  }
  console.log(JSON.stringify({ ok: true, screenshots: report }, null, 2));
} finally {
  if (browser) await browser.close();
  server.close();
}
