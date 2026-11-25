#!/usr/bin/env node
/**
 * dot-memory CLI — unified local memory bus, Entity Wiki, Dreaming metabolism,
 * and cross-agent hook installer for Antigravity, Claude Code & Codex.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DotMemoryStore, extractHandoffFromStopPayload } from '../src/core/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const cmd = argv[0] || 'status';

function argOf(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}
const has = (flag) => argv.includes(flag);

function positional(startIndex = 1) {
  const valueFlags = new Set(['--home', '--agent', '--bucket', '--topic', '--quote', '--quote-source', '--workspace', '--status', '--title', '--alternates', '--limit', '--id']);
  const out = [];
  for (let i = startIndex; i < argv.length; i += 1) {
    const a = argv[i];
    if (valueFlags.has(a)) { i += 1; continue; }
    if (a.startsWith('--')) continue;
    out.push(a);
  }
  return out;
}

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    let buf = '';
    const done = () => resolve(buf);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { buf += c; });
    process.stdin.on('end', done);
    process.stdin.on('error', done);
    if (process.stdin.readableEnded) done();
    setTimeout(done, 2500);
  });
}

export function buildIntegrationSnippets() {
  const mcpPath = path.join(REPO_ROOT, 'bin', 'dot-memory-mcp.mjs');
  const cliPath = path.join(REPO_ROOT, 'bin', 'dot-memory.mjs');
  return {
    mcpServer: {
      command: process.execPath,
      args: [mcpPath],
    },
    claudeCodeHook: {
      Stop: [{
        type: 'command',
        command: `${process.execPath} ${cliPath} handoffs ingest-stdin --agent claude-code`,
        timeout: 10,
      }],
    },
    antigravityHook: {
      Stop: [{
        type: 'command',
        command: `${process.execPath} ${cliPath} handoffs ingest-stdin --agent antigravity`,
        timeout: 10,
      }],
    },
    codexHook: {
      command: `${process.execPath} ${cliPath} handoffs ingest-stdin --agent codex`,
    },
  };
}

export function installAgentHook({ agent, dryRun = false, homeDir = os.homedir() } = {}) {
  const snippets = buildIntegrationSnippets();
  if (agent === 'claude-code') {
    const settingsPath = path.join(homeDir, '.claude', 'settings.json');
    let current = {};
    if (fs.existsSync(settingsPath)) {
      current = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    }
    const mcpServers = { ...(current.mcpServers || {}), 'dot-memory': snippets.mcpServer };
    const hooks = { ...(current.hooks || {}) };
    const existingStop = Array.isArray(hooks.Stop) ? hooks.Stop : [];
    const cmdStr = snippets.claudeCodeHook.Stop[0].command;
    const already = JSON.stringify(existingStop).includes('dot-memory.mjs');
    if (!already) {
      hooks.Stop = [...existingStop, { hooks: [snippets.claudeCodeHook.Stop[0]] }];
    }
    const next = { ...current, mcpServers, hooks };
    if (!dryRun) {
      fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
      fs.writeFileSync(settingsPath, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
    }
    return { ok: true, agent, target: settingsPath, dryRun, hookAdded: !already, mcpConfigured: true };
  }

  if (agent === 'antigravity') {
    const pluginDir = path.join(homeDir, '.gemini', 'config', 'plugins', 'dot-memory-bridge');
    const hooksJsonPath = path.join(pluginDir, 'hooks.json');
    const pluginJsonPath = path.join(pluginDir, 'plugin.json');
    const hooksDoc = { 'dot-memory-stop': snippets.antigravityHook };
    const pluginDoc = {
      name: 'dot-memory-bridge',
      version: '0.1.0',
      description: 'Record significant Antigravity turn handoffs into @oxmumu3/dot-memory',
    };
    if (!dryRun) {
      fs.mkdirSync(pluginDir, { recursive: true });
      fs.writeFileSync(pluginJsonPath, JSON.stringify(pluginDoc, null, 2) + '\n');
      fs.writeFileSync(hooksJsonPath, JSON.stringify(hooksDoc, null, 2) + '\n');
    }
    return { ok: true, agent, target: hooksJsonPath, dryRun, hookAdded: true };
  }

  if (agent === 'codex') {
    return {
      ok: true,
      agent,
      dryRun: true,
      note: 'Add the MCP server & notify hook to ~/.codex/config.toml',
      mcpToml: `[mcp_servers.dot-memory]\ncommand = "${snippets.mcpServer.command}"\nargs = ["${snippets.mcpServer.args[0]}"]`,
      hookCommand: snippets.codexHook.command,
    };
  }

  throw new Error(`Unsupported agent: ${agent}. Expected antigravity | claude-code | codex.`);
}

async function main() {
  const store = new DotMemoryStore({ homeDir: argOf('--home') }).ensureInitialized();

  if (cmd === 'status' || cmd === 'doctor') {
    const snap = store.getSnapshot();
    const out = {
      ok: true,
      homeDir: snap.homeDir,
      budget: snap.budget,
      pendingCandidates: snap.memory.candidates.length,
      lastDreamAt: snap.memory.lastDreamAt,
      handoffsCount: snap.handoffs.length,
      wikiPagesCount: snap.wikiPages.length,
    };
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (cmd === 'memory') {
    const sub = argv[1] || 'list';
    if (sub === 'list') {
      const mem = store.getLivingMemory();
      console.log(JSON.stringify(mem, null, 2));
      return;
    }
    if (sub === 'add') {
      const text = positional(2).join(' ');
      const res = store.addMemory({
        bucket: argOf('--bucket') || 'focus',
        topic: argOf('--topic') || undefined,
        text,
        sourceKind: argOf('--quote-source') ? 'chat' : 'manual',
        quote: argOf('--quote') || text,
        quoteSource: argOf('--quote-source') || 'manual',
        sourceText: argOf('--quote') || text,
      });
      console.log(JSON.stringify({ ok: Boolean(res.item), ...res }, null, 2));
      return;
    }
    if (sub === 'approve' || sub === 'reject') {
      const id = argOf('--id') || positional(2)[0];
      const res = store.reviewCandidate(id, sub);
      console.log(JSON.stringify({ ok: true, ...res }, null, 2));
      return;
    }
    if (sub === 'remove') {
      const id = argOf('--id') || positional(2)[0];
      const res = store.removeMemory(id);
      console.log(JSON.stringify({ ok: true, ...res }, null, 2));
      return;
    }
  }

  if (cmd === 'search') {
    const query = positional(1).join(' ');
    const alternates = (argOf('--alternates') || '').split(',').map((s) => s.trim()).filter(Boolean);
    const limit = Number(argOf('--limit')) || 10;
    console.log(JSON.stringify(store.search({ query, alternates, limit }), null, 2));
    return;
  }

  if (cmd === 'wiki') {
    const sub = argv[1] || 'list';
    if (sub === 'list') {
      console.log(JSON.stringify(store.wiki.listPages().map((p) => ({ key: p.key, title: p.title, updatedAt: p.updatedAt })), null, 2));
      return;
    }
    if (sub === 'read') {
      const key = positional(2)[0];
      const page = store.wiki.readPage(key);
      if (!page) { console.error(`Not found: ${key}`); process.exit(1); }
      console.log(page.raw);
      return;
    }
    if (sub === 'sync') {
      console.log(JSON.stringify(store.syncWiki(), null, 2));
      return;
    }
  }

  if (cmd === 'handoffs') {
    const sub = argv[1] || 'list';
    if (sub === 'list') {
      console.log(JSON.stringify(store.listHandoffs({
        agent: argOf('--agent'),
        workspace: argOf('--workspace'),
        status: argOf('--status'),
        limit: Number(argOf('--limit')) || 20,
      }), null, 2));
      return;
    }
    if (sub === 'record') {
      const summary = positional(2).join(' ');
      const res = store.recordHandoff({
        agent: argOf('--agent') || 'custom',
        workspace: argOf('--workspace') || path.basename(process.cwd()),
        workspacePath: process.cwd(),
        status: argOf('--status') || 'done',
        title: argOf('--title') || summary.slice(0, 80),
        summary,
      });
      const wiki = store.syncWiki();
      console.log(JSON.stringify({ ok: true, ...res, wiki }, null, 2));
      return;
    }
    if (sub === 'ingest-stdin') {
      const agent = argOf('--agent') || 'antigravity';
      const dryRun = has('--dry-run');
      const raw = await readStdin();
      if (!raw.trim()) {
        if (has('--json')) console.log(JSON.stringify({ ok: true, dryRun, skipped: true, reason: 'empty_stdin' }));
        return;
      }
      let payload;
      try { payload = JSON.parse(raw); } catch {
        if (has('--json')) console.log(JSON.stringify({ ok: true, dryRun, skipped: true, reason: 'invalid_json' }));
        return;
      }
      if (has('--force') && payload && typeof payload === 'object') payload.forceHandoff = true;
      const extracted = extractHandoffFromStopPayload(agent, payload);
      if (extracted.skipped) {
        if (has('--json')) console.log(JSON.stringify({ ok: true, dryRun, ...extracted }));
        return;
      }
      if (dryRun) {
        if (has('--json')) console.log(JSON.stringify({ ok: true, dryRun: true, appended: false, ...extracted }));
        return;
      }
      const res = store.recordHandoff(extracted.handoff);
      const wiki = res.appended ? store.syncWiki() : { created: 0, updated: 0 };
      if (has('--json')) console.log(JSON.stringify({ ok: true, appended: res.appended, handoff: res.handoff, wiki }));
      return;
    }
  }

  if (cmd === 'dream') {
    const res = store.dream({ force: has('--force') });
    console.log(JSON.stringify({ ok: true, ran: res.ran, metabolized: res.metabolized, lastDreamAt: res.memory.lastDreamAt }, null, 2));
    return;
  }

  if (cmd === 'mcp-config') {
    console.log(JSON.stringify(buildIntegrationSnippets(), null, 2));
    return;
  }

  if (cmd === 'install-hooks') {
    const agent = argOf('--agent') || 'antigravity';
    const res = installAgentHook({ agent, dryRun: has('--dry-run') });
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  process.exit(1);
}

let isCli = false;
try {
  isCli = Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
} catch {
  isCli = Boolean(process.argv[1]?.endsWith('dot-memory.mjs'));
}
if (isCli) {
  main().catch((err) => {
    console.error(err?.message || String(err));
    process.exit(1);
  });
}
