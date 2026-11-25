import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { installAgentHook } from '../bin/dot-memory.mjs';

const CLI = path.resolve('bin/dot-memory.mjs');
const MCP = path.resolve('bin/dot-memory-mcp.mjs');

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dot-mem-cli-'));
}

test('CLI lifecycle: status, memory add, handoffs ingest-stdin noise gate, dream & search', () => {
  const home = makeTempHome();
  try {
    const env = { ...process.env, DOT_MEMORY_HOME: home };

    // 1. Short trivial Q&A should be filtered by noise gate
    const noisy = spawnSync(process.execPath, [CLI, 'handoffs', 'ingest-stdin', '--agent', 'antigravity', '--json'], {
      input: JSON.stringify({ conversationId: 'c-short', lastUserInput: 'ok', lastReply: '收到', turnDurationSec: 4, toolCallCount: 0 }),
      env,
      encoding: 'utf8',
    });
    assert.equal(noisy.status, 0);
    assert.equal(JSON.parse(noisy.stdout).skipped, true);

    // 2. Significant Antigravity turn should record handoff + sync wiki
    const sig = spawnSync(process.execPath, [CLI, 'handoffs', 'ingest-stdin', '--agent', 'antigravity', '--json'], {
      input: JSON.stringify({
        conversationId: 'c-voice',
        workspacePath: '/tmp/voice-clone',
        lastUserInput: '帮我重训 Shan-Pro',
        lastReply: '卡在声纹核验，需要去 ElevenLabs 读短句',
        turnDurationSec: 55,
        toolCallCount: 4,
        mutatedCount: 1,
        status: 'blocked',
      }),
      env,
      encoding: 'utf8',
    });
    assert.equal(sig.status, 0);
    const sigJson = JSON.parse(sig.stdout);
    assert.equal(sigJson.appended, true);
    assert.ok(sigJson.wiki.created >= 1);

    // 3. CLI dream & search
    const dream = spawnSync(process.execPath, [CLI, 'dream', '--force'], { env, encoding: 'utf8' });
    assert.equal(dream.status, 0);
    assert.equal(JSON.parse(dream.stdout).ran, true);

    const search = spawnSync(process.execPath, [CLI, 'search', '声纹核验'], { env, encoding: 'utf8' });
    assert.equal(search.status, 0);
    const hits = JSON.parse(search.stdout).hits;
    assert.ok(hits.length >= 1);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('installAgentHook writes clean isolated configs for claude-code and antigravity', () => {
  const fakeUserHome = makeTempHome();
  try {
    fs.mkdirSync(path.join(fakeUserHome, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(fakeUserHome, '.claude', 'settings.json'), JSON.stringify({ theme: 'dark' }, null, 2));

    const r1 = installAgentHook({ agent: 'claude-code', homeDir: fakeUserHome });
    assert.equal(r1.ok, true);
    assert.equal(r1.hookAdded, true);
    const claudeCfg = JSON.parse(fs.readFileSync(path.join(fakeUserHome, '.claude', 'settings.json'), 'utf8'));
    assert.ok(claudeCfg.mcpServers['dot-memory']);
    assert.ok(JSON.stringify(claudeCfg.hooks.Stop).includes('dot-memory.mjs'));

    const r2 = installAgentHook({ agent: 'antigravity', homeDir: fakeUserHome });
    assert.equal(r2.ok, true);
    assert.ok(fs.existsSync(path.join(fakeUserHome, '.gemini', 'config', 'plugins', 'dot-memory-bridge', 'hooks.json')));
  } finally {
    fs.rmSync(fakeUserHome, { recursive: true, force: true });
  }
});

test('MCP stdio server handles initialize, tools/list, record_handoff, propose & search', async () => {
  const home = makeTempHome();
  try {
    const child = spawn(process.execPath, [MCP], {
      env: { ...process.env, DOT_MEMORY_HOME: home },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const lines = [];
    child.stdout.setEncoding('utf8');
    let buf = '';
    const waiters = [];
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (line) {
          const msg = JSON.parse(line);
          lines.push(msg);
          const w = waiters.shift();
          if (w) w(msg);
        }
      }
    });

    const rpc = (id, method, params = {}) => new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`RPC timeout ${method}`)), 5000);
      waiters.push((msg) => { clearTimeout(t); resolve(msg); });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });

    const init = await rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {} });
    assert.equal(init.result.serverInfo.name, 'dot-memory');

    const list = await rpc(2, 'tools/list');
    assert.equal(list.result.tools.length, 7);

    const rec = await rpc(3, 'tools/call', {
      name: 'dot_memory_record_handoff',
      arguments: { agent: 'codex', workspace: 'dot-memory', summary: 'Completed MCP stdio server' },
    });
    assert.equal(JSON.parse(rec.result.content[0].text).ok, true);

    const search = await rpc(4, 'tools/call', {
      name: 'dot_memory_search',
      arguments: { query: 'MCP stdio' },
    });
    assert.match(search.result.content[0].text, /dot-memory/);

    child.stdin.end();
    await new Promise((resolve) => child.once('exit', resolve));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('CLI handoffs ingest-stdin parses Antigravity uppercase transcript entries and supports --dry-run', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dot-mem-ag-hook-'));
  try {
    const home = path.join(tmp, 'home');
    const transcript = path.join(tmp, 'transcript.jsonl');
    fs.writeFileSync(transcript, [
      JSON.stringify({ type: 'USER_INPUT', created_at: '2026-11-25T10:00:00Z', content: '克隆 Shan-Pro 声纹并完成试听' }),
      JSON.stringify({
        type: 'PLANNER_RESPONSE',
        created_at: '2026-11-25T10:01:15Z',
        response: '已完成 eleven_v4 训练与试听核验。',
        tool_calls: [{ name: 'run_command' }, { name: 'edit_file' }],
      }),
    ].join('\n') + '\n');

    const payload = JSON.stringify({
      conversationId: 'ag-voice-conv-1',
      workspace_roots: ['/Users/shan/Repos/voice-clone'],
      transcript_path: transcript,
      fullyIdle: true,
    });

    const dry = spawnSync(process.execPath, [CLI, 'handoffs', 'ingest-stdin', '--agent', 'antigravity', '--dry-run', '--json'], {
      input: payload,
      env: { ...process.env, DOT_MEMORY_HOME: home },
      encoding: 'utf8',
    });
    assert.equal(dry.status, 0, dry.stderr);
    const out = JSON.parse(dry.stdout.trim());
    assert.equal(out.dryRun, true);
    assert.equal(out.skipped, false);
    assert.equal(out.handoff.agent, 'antigravity');
    assert.equal(out.handoff.workspace, 'voice-clone');
    assert.equal(out.handoff.durationSec, 75);
    assert.equal(out.handoff.toolCalls, 2);
    assert.equal(out.handoff.mutatedFiles, 2);
    assert.equal(fs.existsSync(path.join(home, 'handoffs', '2026-11-25.jsonl')), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
