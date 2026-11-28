#!/usr/bin/env node
/**
 * dot-memory CLI — unified local memory bus, Entity Wiki, Dreaming metabolism,
 * and cross-agent hook installer for Antigravity, Claude Code & Codex.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DotMemoryStore,
  SUPPORTED_AGENTS,
  connectAgent,
  connectAllInstalled,
  detectAgentConnections,
  disconnectAgent,
  extractHandoffFromStopPayload,
  resolveRuntimePaths,
  shellQuote,
} from '../src/core/index.mjs';

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
  const rt = resolveRuntimePaths({ repoRoot: REPO_ROOT });
  return {
    mcpServer: {
      command: rt.nodeBin,
      args: [rt.mcpPath],
    },
    claudeCodeHook: {
      Stop: [{
        type: 'command',
        command: `${shellQuote(rt.nodeBin)} ${shellQuote(rt.cliPath)} handoffs ingest-stdin --agent claude-code`,
        timeout: 10,
      }],
    },
    antigravityHook: {
      Stop: [{
        type: 'command',
        command: `${shellQuote(rt.nodeBin)} ${shellQuote(rt.cliPath)} handoffs ingest-stdin --agent antigravity`,
        timeout: 10,
      }],
    },
    codexHook: {
      command: `${shellQuote(rt.nodeBin)} ${shellQuote(rt.cliPath)} handoffs ingest-stdin --agent codex`,
    },
  };
}

export function installAgentHook({ agent, dryRun = false, homeDir = os.homedir(), dotMemoryHome } = {}) {
  const rt = resolveRuntimePaths({ repoRoot: REPO_ROOT });
  return connectAgent({ agent, dryRun, homeDir, dotMemoryHome, runtime: rt });
}

async function main() {
  const homeOverride = argOf('--home');
  const store = new DotMemoryStore({ homeDir: homeOverride }).ensureInitialized();
  const rt = resolveRuntimePaths({ repoRoot: REPO_ROOT });

  if (cmd === 'status' || cmd === 'doctor') {
    const snap = store.getSnapshot();
    const conn = detectAgentConnections({ dotMemoryHome: store.homeDir, runtime: rt });
    const out = {
      ok: true,
      homeDir: snap.homeDir,
      budget: snap.budget,
      pendingCandidates: snap.memory.candidates.length,
      lastDreamAt: snap.memory.lastDreamAt,
      handoffsCount: snap.handoffs.length,
      wikiPagesCount: snap.wikiPages.length,
      connections: conn.summary,
    };
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (cmd === 'connections') {
    console.log(JSON.stringify(detectAgentConnections({ dotMemoryHome: store.homeDir, runtime: rt }), null, 2));
    return;
  }

  if (cmd === 'connect') {
    const target = argOf('--agent') || positional(1)[0] || 'all';
    const dryRun = has('--dry-run');
    const res = target === 'all'
      ? connectAllInstalled({ dotMemoryHome: store.homeDir, dryRun, runtime: rt })
      : connectAgent({ agent: target, dotMemoryHome: store.homeDir, dryRun, runtime: rt });
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (cmd === 'disconnect') {
    const target = argOf('--agent') || positional(1)[0];
    if (!target) {
      console.error(`Missing --agent <${SUPPORTED_AGENTS.map((a) => a.id).join('|')}|all>`);
      process.exit(1);
    }
    const dryRun = has('--dry-run');
    if (target === 'all') {
      const snap = detectAgentConnections({ dotMemoryHome: store.homeDir, runtime: rt });
      const results = snap.agents
        .filter((a) => a.hookConnected || a.mcpConnected)
        .map((a) => disconnectAgent({ agent: a.id, dotMemoryHome: store.homeDir, dryRun }));
      console.log(JSON.stringify({ ok: true, dryRun, disconnected: results.map((r) => r.agent), results }, null, 2));
      return;
    }
    console.log(JSON.stringify(disconnectAgent({ agent: target, dotMemoryHome: store.homeDir, dryRun }), null, 2));
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
    const res = installAgentHook({ agent, dryRun: has('--dry-run'), dotMemoryHome: store.homeDir });
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
