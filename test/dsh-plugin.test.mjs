import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { apply } from '../index.js';
import { DOT_MEMORY_PROMPT_MAX_BYTES, DOT_MEMORY_SYSTEM_PROMPT } from '../src/dsh/prompt.mjs';
import { handleActionRequest, handleViewRequest, isCrossSiteWrite } from '../src/dsh/routes.mjs';

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dot-mem-dsh-'));
}

test('systemPrompt protocol is static and strictly within byte budget', () => {
  const bytes = Buffer.byteLength(DOT_MEMORY_SYSTEM_PROMPT, 'utf8');
  assert.ok(bytes > 50 && bytes <= DOT_MEMORY_PROMPT_MAX_BYTES, `Prompt ${bytes}B exceeds ${DOT_MEMORY_PROMPT_MAX_BYTES}B`);
});

test('zh.json and en.json locales share identical key sets', () => {
  const zh = JSON.parse(fs.readFileSync(path.resolve('locale/zh.json'), 'utf8'));
  const en = JSON.parse(fs.readFileSync(path.resolve('locale/en.json'), 'utf8'));
  const flattenKeys = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) => (
    v && typeof v === 'object' ? flattenKeys(v, `${prefix}${k}.`) : [`${prefix}${k}`]
  )).sort();
  assert.deepEqual(flattenKeys(zh), flattenKeys(en));
});

test('DSH host entry enforces double-mount guard, pre-step KV-cache delta injection, and turn capture', async () => {
  const home = makeTempHome();
  try {
    const events = new Map();
    const tools = [];
    const services = new Map();
    const disposers = [];

    const ctx = {
      logger: { info: () => {} },
      effect: (fn) => { disposers.push(fn); return fn; },
      provide: (k, v) => services.set(k, v),
      get: (k) => services.get(k),
      on: (ev, fn) => {
        if (!events.has(ev)) events.set(ev, []);
        events.get(ev).push(fn);
        return () => {};
      },
      inject: (deps, cb) => {
        if (deps.includes('tools')) cb({ tools: { register: (t) => { tools.push(t); return () => {}; }, get: (n) => tools.find((x) => x.name === n) } });
        if (deps.includes('systemPrompt')) cb({ systemPrompt: { section: () => () => {} } });
      },
    };

    const dispose1 = apply(ctx, { homeDir: home });
    const dispose2 = apply(ctx, { homeDir: home });
    assert.equal(tools.length, 6);
    assert.equal(services.get('dotMemory').version, '0.2.0');
    assert.ok(services.get('dotMemory').features.includes('agent-connectors'));
    assert.equal(typeof dispose2, 'function');

    const manageTool = tools.find((t) => t.name === 'dot_memory_manage_connections');
    assert.ok(manageTool);
    const statusText = await manageTool.execute({ action: 'status' });
    assert.match(statusText, /本机 Agent 探测/);

    // Add 1 living memory item
    services.get('dotMemory').store.addMemory({ bucket: 'style', text: '回答直击重点', sourceKind: 'manual' });

    const preStep = events.get('agent/pre-step')[0];
    const normalSession = { id: 'ses-1', header: { id: 'ses-1', cwd: '/tmp/proj' } };

    // Turn 1 Step 1 -> injects once
    const d1 = await preStep({ agent: { session: normalSession }, signal: new AbortController().signal }, async () => ({
      kind: 'continue',
      extraFlag: 'preserved',
      messages: [{ role: 'user', content: 'hi' }],
    }));
    assert.equal(d1.extraFlag, 'preserved');
    assert.equal(d1.messages.length, 2);
    assert.match(d1.messages[1].content[0].text, /<dot_memory_context/);

    // Turn 1 Step 2 (no change, no compaction) -> ZERO injection (KV cache safe!)
    const d2 = await preStep({ agent: { session: normalSession }, signal: new AbortController().signal }, async () => ({
      kind: 'continue',
      messages: d1.messages,
    }));
    assert.equal(d2.messages.length, 2);

    // Internal dot-butler-* session -> skipped completely
    const butlerSession = { id: 'dot-butler-abc', header: { id: 'dot-butler-abc' } };
    const dButler = await preStep({ agent: { session: butlerSession }, signal: new AbortController().signal }, async () => ({
      kind: 'continue',
      messages: [{ role: 'user', content: 'hi' }],
    }));
    assert.equal(dButler.messages.length, 1);

    // Turn stopping captures significant DSH session
    const turnStop = events.get('agent/turn-stopping')[0];
    await turnStop({
      turn: 1,
      agent: {
        session: {
          id: 'ses-dsh-1',
          header: { cwd: '/tmp/my-dsh-proj' },
          events: () => [
            { type: 'user/message', data: { content: '帮我重构记忆模块' } },
            { type: 'tool/call', data: { name: 'edit' } },
            { type: 'tool/call', data: { name: 'edit' } },
            { type: 'tool/call', data: { name: 'bash' } },
            { type: 'tool/call', data: { name: 'bash' } },
            { type: 'assistant/message', data: { content: '已完成记忆模块重构并通过单测。' } },
          ],
        },
      },
    });
    assert.equal(services.get('dotMemory').store.listHandoffs().length, 1);

    dispose1();
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('Host routes block cross-site POST writes and handle memory/handoff/connection actions safely', async () => {
  const home = makeTempHome();
  const fakeUserHome = makeTempHome();
  try {
    fs.mkdirSync(path.join(fakeUserHome, '.cursor'), { recursive: true });
    const store = new (await import('../src/core/index.mjs')).DotMemoryStore({ homeDir: home }).ensureInitialized();

    const evilReq = new Request('http://127.0.0.1/api/dot_memory/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' },
      body: JSON.stringify({ action: 'connect_all_installed' }),
    });
    assert.equal(isCrossSiteWrite(evilReq), true);
    const evilRes = await handleActionRequest({ request: evilReq, store, homeDir: fakeUserHome });
    assert.equal(evilRes.status, 403);

    const goodReq = new Request('http://127.0.0.1/api/dot_memory/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:3080', 'Sec-Fetch-Site': 'same-origin' },
      body: JSON.stringify({ action: 'add_memory', bucket: 'rules', text: '测试规则条目' }),
    });
    const goodRes = await handleActionRequest({ request: goodReq, store, homeDir: fakeUserHome });
    assert.equal(goodRes.status, 200);

    const connAllReq = new Request('http://127.0.0.1/api/dot_memory/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:3080', 'Sec-Fetch-Site': 'same-origin' },
      body: JSON.stringify({ action: 'connect_all_installed' }),
    });
    const connAllRes = await handleActionRequest({ request: connAllReq, store, homeDir: fakeUserHome });
    assert.equal(connAllRes.status, 200);
    const connAllJson = await connAllRes.json();
    assert.deepEqual(connAllJson.result.connectedAgents, ['cursor']);

    const viewRes = await handleViewRequest({ store, homeDir: fakeUserHome });
    const viewJson = await viewRes.json();
    assert.equal(viewJson.snapshot.memory.items.length, 1);
    assert.equal(viewJson.connections.summary.connectedCount, 1);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(fakeUserHome, { recursive: true, force: true });
  }
});
