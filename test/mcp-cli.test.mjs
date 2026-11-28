import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { installAgentHook } from '../bin/dot-memory.mjs';
import {
  connectAgent,
  connectAllInstalled,
  detectAgentConnections,
  disconnectAgent,
  extractHandoffFromStopPayload,
  resolveRuntimePaths,
} from '../src/core/index.mjs';

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
  const dmHome = makeTempHome();
  try {
    fs.mkdirSync(path.join(fakeUserHome, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(fakeUserHome, '.claude', 'settings.json'), JSON.stringify({ theme: 'dark' }, null, 2));

    const r1 = installAgentHook({ agent: 'claude-code', homeDir: fakeUserHome, dotMemoryHome: dmHome });
    assert.equal(r1.ok, true);
    assert.equal(r1.hookAdded, true);
    assert.equal(r1.mcpConfigured, true);
    const claudeCfg = JSON.parse(fs.readFileSync(path.join(fakeUserHome, '.claude', 'settings.json'), 'utf8'));
    const claudeJson = JSON.parse(fs.readFileSync(path.join(fakeUserHome, '.claude.json'), 'utf8'));
    assert.ok(claudeJson.mcpServers['dot-memory']);
    assert.ok(JSON.stringify(claudeCfg.hooks.Stop).includes('dot-memory.mjs'));

    const r2 = installAgentHook({ agent: 'antigravity', homeDir: fakeUserHome, dotMemoryHome: dmHome });
    assert.equal(r2.ok, true);
    assert.equal(r2.mcpConfigured, true);
    assert.ok(fs.existsSync(path.join(fakeUserHome, '.gemini', 'config', 'plugins', 'dot-memory-bridge', 'hooks.json')));
    const agMcp = JSON.parse(fs.readFileSync(path.join(fakeUserHome, '.gemini', 'config', 'mcp_config.json'), 'utf8'));
    assert.ok(agMcp.mcpServers['dot-memory']);
  } finally {
    fs.rmSync(fakeUserHome, { recursive: true, force: true });
    fs.rmSync(dmHome, { recursive: true, force: true });
  }
});

test('resolveRuntimePaths never returns Electron binary when running under Electron', () => {
  const rt = resolveRuntimePaths({
    execPath: '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness',
    isElectron: true,
  });
  assert.equal(rt.nodeBin.includes('DeepSeek Harness.app/Contents/MacOS/'), false);
  assert.ok(rt.cliPath.endsWith(path.join('bin', 'dot-memory.mjs')));
  assert.ok(rt.mcpPath.endsWith(path.join('bin', 'dot-memory-mcp.mjs')));
});

test('connectAgent / connectAllInstalled / disconnectAgent work safely across all 6 agents with backups & idempotency', () => {
  const fakeHome = makeTempHome();
  const dmHome = makeTempHome();
  const rt = { nodeBin: '/opt/homebrew/bin/node', cliPath: '/tmp/dm/bin/dot-memory.mjs', mcpPath: '/tmp/dm/bin/dot-memory-mcp.mjs' };

  try {
    // Seed existing configs for installed agents (keep cursor uninstalled to verify selective connectAllInstalled)
    fs.mkdirSync(path.join(fakeHome, '.gemini', 'config'), { recursive: true });
    fs.writeFileSync(path.join(fakeHome, '.gemini', 'config', 'mcp_config.json'), JSON.stringify({
      mcpServers: { other_tool: { command: 'node', args: ['other.js'] } },
    }, null, 2));

    fs.mkdirSync(path.join(fakeHome, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(fakeHome, '.claude', 'settings.json'), JSON.stringify({
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo existing' }] }] },
    }, null, 2));
    fs.writeFileSync(path.join(fakeHome, '.claude.json'), JSON.stringify({
      mcpServers: { existing_mcp: { command: 'python3', args: ['a.py'] } },
    }, null, 2));

    fs.mkdirSync(path.join(fakeHome, '.codex'), { recursive: true });
    fs.writeFileSync(path.join(fakeHome, '.codex', 'hooks.json'), JSON.stringify({
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: 'echo start' }] }],
        Stop: [{ hooks: [{ type: 'command', command: 'echo core-stop' }] }],
      },
    }, null, 2));
    fs.writeFileSync(path.join(fakeHome, '.codex', 'config.toml'), [
      'model = "gpt-5"',
      '',
      '[mcp_servers.other]',
      'command = "echo"',
      'args = ["hi"]',
      '',
    ].join('\n'));

    fs.mkdirSync(path.join(fakeHome, '.hermes'), { recursive: true });
    // Crucial: contains indented `  mcp:` inside model block — must NOT be mistaken for top-level `mcp_servers:`
    fs.writeFileSync(path.join(fakeHome, '.hermes', 'config.yaml'), [
      'model:',
      '  default: deepseek-v4-pro',
      '  mcp:',
      '    provider: auto',
      'mcp_servers:',
      '  filesystem:',
      '    command: "npx"',
      '    args:',
      '      - "fs-mcp"',
      '',
    ].join('\n'));

    fs.mkdirSync(path.join(fakeHome, '.workbuddy-ai'), { recursive: true });
    fs.writeFileSync(path.join(fakeHome, '.workbuddy-ai', 'mcp.json'), JSON.stringify({
      mcpServers: { builtin: { command: 'wb-tool' } },
    }, null, 2));

    const before = detectAgentConnections({ homeDir: fakeHome, dotMemoryHome: dmHome, runtime: rt });
    assert.equal(before.summary.installedCount, 5);
    assert.equal(before.summary.connectedCount, 0);

    const allRes = connectAllInstalled({ homeDir: fakeHome, dotMemoryHome: dmHome, runtime: rt });
    assert.deepEqual(allRes.connectedAgents.sort(), ['antigravity', 'claude-code', 'codex', 'hermes', 'workbuddy']);
    assert.deepEqual(allRes.skippedAgents, ['cursor']);
    assert.equal(allRes.connections.summary.connectedCount, 5);

    // Verify existing configs & backups preserved
    const agMcp = JSON.parse(fs.readFileSync(path.join(fakeHome, '.gemini', 'config', 'mcp_config.json'), 'utf8'));
    assert.ok(agMcp.mcpServers.other_tool);
    assert.ok(agMcp.mcpServers['dot-memory']);

    const codexToml = fs.readFileSync(path.join(fakeHome, '.codex', 'config.toml'), 'utf8');
    assert.match(codexToml, /\[mcp_servers\.other\]/);
    assert.match(codexToml, /\[mcp_servers\.dot-memory\]/);

    const hermesYaml = fs.readFileSync(path.join(fakeHome, '.hermes', 'config.yaml'), 'utf8');
    assert.match(hermesYaml, /  mcp:\n    provider: auto/);
    assert.match(hermesYaml, /  filesystem:/);
    assert.match(hermesYaml, /  dot-memory:/);

    const wbMcp = JSON.parse(fs.readFileSync(path.join(fakeHome, '.workbuddy-ai', 'mcp.json'), 'utf8'));
    assert.ok(wbMcp.mcpServers.builtin);
    assert.equal(wbMcp.mcpServers['dot-memory'].type, 'stdio');

    const backupFiles = fs.readdirSync(path.join(dmHome, 'backups'));
    assert.ok(backupFiles.length >= 5);

    // Verify Hermes handler.py syntax compiles cleanly
    const handlerPy = path.join(fakeHome, '.hermes', 'hooks', 'dot-memory-handoff', 'handler.py');
    const pyCheck = spawnSync('python3', ['-m', 'py_compile', handlerPy], { encoding: 'utf8' });
    assert.equal(pyCheck.status, 0, pyCheck.stderr);

    // Idempotency check
    connectAgent({ agent: 'claude-code', homeDir: fakeHome, dotMemoryHome: dmHome, runtime: rt });
    const claudeCfg2 = JSON.parse(fs.readFileSync(path.join(fakeHome, '.claude', 'settings.json'), 'utf8'));
    assert.equal(claudeCfg2.hooks.Stop.length, 2);

    // Explicitly connect Cursor even before ~/.cursor exists
    const curRes = connectAgent({ agent: 'cursor', homeDir: fakeHome, dotMemoryHome: dmHome, runtime: rt });
    assert.equal(curRes.hookAdded, false);
    assert.equal(curRes.mcpConfigured, true);

    // Clean disconnect preserves all original entries
    disconnectAgent({ agent: 'codex', homeDir: fakeHome, dotMemoryHome: dmHome });
    disconnectAgent({ agent: 'hermes', homeDir: fakeHome, dotMemoryHome: dmHome });
    disconnectAgent({ agent: 'claude-code', homeDir: fakeHome, dotMemoryHome: dmHome });

    const afterCodexHooks = JSON.parse(fs.readFileSync(path.join(fakeHome, '.codex', 'hooks.json'), 'utf8'));
    assert.equal(afterCodexHooks.hooks.Stop.length, 1);
    assert.match(JSON.stringify(afterCodexHooks.hooks.Stop), /core-stop/);
    const afterHermesYaml = fs.readFileSync(path.join(fakeHome, '.hermes', 'config.yaml'), 'utf8');
    assert.equal(afterHermesYaml.includes('dot-memory:'), false);
    assert.match(afterHermesYaml, /filesystem:/);
    assert.match(afterHermesYaml, /  mcp:\n    provider: auto/);
  } finally {
    fs.rmSync(fakeHome, { recursive: true, force: true });
    fs.rmSync(dmHome, { recursive: true, force: true });
  }
});

test('extractHandoffFromStopPayload supports hermes agent:end payloads while filtering short chat', () => {
  const shortHermes = extractHandoffFromStopPayload('hermes', {
    session_key: 'feishu:123',
    platform: 'feishu',
    user_message: '你好',
    response: '你好，我在。',
  });
  assert.equal(shortHermes.skipped, true);

  const longHermes = extractHandoffFromStopPayload('hermes', {
    session_key: 'feishu:123',
    platform: 'feishu',
    workspace: 'workbuddy-ops',
    user_message: '帮我整理本周发布清单并核对风险项',
    response: '已完成本周发布清单整理与风险核对：1. 核查了全部核心依赖与签名状态；2. 梳理出 3 项待确认环境配置并生成对照表；3. 建议优先在隔离环境验证后推进灰度上线，避免直接覆盖线上运行配置。',
  });
  assert.equal(longHermes.skipped, false);
  assert.equal(longHermes.handoff.agent, 'hermes');
  assert.equal(longHermes.handoff.workspace, 'workbuddy-ops');
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
