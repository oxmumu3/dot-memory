#!/usr/bin/env node
/**
 * dot-memory-mcp — stdio JSON-RPC 2.0 MCP server for @oxmumu3/dot-memory.
 * Exposes the unified local Living Memory, Entity Wiki, and Cross-Agent
 * Handoff Bus to Claude Code, Codex CLI, Antigravity, Cursor, and other clients.
 */

import readline from 'node:readline';
import { DotMemoryStore } from '../src/core/index.mjs';

const SERVER_INFO = { name: 'dot-memory', version: '0.2.0' };
const PROTOCOL = '2025-06-18';
const store = new DotMemoryStore().ensureInitialized();

const TOOLS = [
  {
    name: 'dot_memory_living',
    description: 'Read the active 4KB Living Memory (rules, working style, active focus) and pending candidate count.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        includeCandidates: { type: 'boolean', description: 'Include pending candidate entries awaiting review' },
      },
    },
  },
  {
    name: 'dot_memory_search',
    description: 'Zero-vector hybrid bilingual search (Han bigrams + RRF) across Living Memory, Entity Wiki, and Cross-Agent Handoffs.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Primary search query' },
        alternates: {
          type: 'array',
          items: { type: 'string' },
          description: 'Up to 6 synonyms or cross-lingual alternate queries',
        },
        limit: { type: 'number', description: 'Max hits to return (default 8)' },
      },
    },
  },
  {
    name: 'dot_memory_wiki_read',
    description: 'List Entity Wiki pages or read a specific page by key (e.g. "project/dot-memory"), optionally with derived timeline.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        key: { type: 'string', description: 'Page key like "project/dot-memory". Omit to list all pages.' },
        type: { type: 'string', description: 'Optional filter when listing: project | topic | session | contact | client' },
        includeTimeline: { type: 'boolean', description: 'Append derived chronological timeline from handoffs and related sessions' },
      },
    },
  },
  {
    name: 'dot_memory_recall',
    description: 'Zero-LLM active trigger recall (Lane 1) matching Entity Wiki dossiers against a user message in <5ms.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['message'],
      properties: {
        message: { type: 'string', description: 'User message to match against Entity Wiki triggers, titles, and aliases' },
        limit: { type: 'number', description: 'Max pages to recall (default 3)' },
      },
    },
  },
  {
    name: 'dot_memory_handoffs',
    description: 'List recent cross-agent work handoffs from Antigravity, Claude Code, Codex, Hermes, WorkBuddy, Cursor, and DeepSeek Harness.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        agent: { type: 'string', description: 'Optional agent filter: antigravity | claude-code | codex | hermes | workbuddy | cursor | dsh' },
        workspace: { type: 'string', description: 'Optional workspace name filter' },
        status: { type: 'string', description: 'Optional status filter: done | blocked | error | waiting' },
        limit: { type: 'number', description: 'Max entries (default 12)' },
      },
    },
  },
  {
    name: 'dot_memory_propose',
    description: 'Stage a candidate living-memory item for user review. Requires verbatim `quote` present in `sourceText` to prevent hallucination.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['bucket', 'text', 'quote', 'quoteSource'],
      properties: {
        bucket: { type: 'string', description: 'rules | style | focus' },
        text: { type: 'string', description: 'Concise distilled memory statement (<= 260 chars)' },
        topic: { type: 'string', description: 'Optional topic key for focus deduplication/replacement' },
        quote: { type: 'string', description: 'Verbatim quote supporting this memory' },
        quoteSource: { type: 'string', description: 'Source identifier (e.g. conversation/file id)' },
        sourceText: { type: 'string', description: 'Original source snippet containing `quote` for deterministic verification' },
      },
    },
  },
  {
    name: 'dot_memory_record_handoff',
    description: 'Record a structured cross-agent handoff into the shared local bus and incrementally refresh the Entity Wiki.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['agent', 'workspace', 'summary'],
      properties: {
        agent: { type: 'string', description: 'antigravity | claude-code | codex | hermes | workbuddy | cursor | dsh | custom' },
        workspace: { type: 'string', description: 'Workspace or project name' },
        workspacePath: { type: 'string', description: 'Absolute workspace directory path' },
        status: { type: 'string', description: 'done | blocked | error | waiting (default done)' },
        title: { type: 'string', description: 'Short task title' },
        summary: { type: 'string', description: 'Concise factual summary of work done or blocker hit' },
        artifacts: { type: 'array', items: { type: 'string' }, description: 'Produced files or URLs' },
        nextSteps: { type: 'array', items: { type: 'string' }, description: 'Concrete next steps' },
      },
    },
  },
];

export function handleMcpToolCall(name, args = {}, targetStore = store) {
  if (name === 'dot_memory_living') {
    const snap = targetStore.getSnapshot();
    const lines = [
      `# Dot Living Memory (${snap.budget.usedBytes}/${snap.budget.maxBytes} bytes · ${snap.memory.candidates.length} pending candidates)`,
    ];
    for (const bucket of ['rules', 'style', 'focus']) {
      const items = snap.memory.items.filter((i) => i.active && i.bucket === bucket);
      lines.push('', `## ${bucket} (${items.length}/${snap.budget.bucketLimits[bucket]})`);
      if (items.length === 0) lines.push('- (none)');
      else for (const it of items) lines.push(`- ${it.text} [${it.provenance}]`);
    }
    if (args.includeCandidates && snap.memory.candidates.length > 0) {
      lines.push('', '## pending candidates');
      for (const c of snap.memory.candidates) {
        lines.push(`- ${c.id} [${c.bucket}] ${c.text} (quote: "${c.quote.slice(0, 80)}")`);
      }
    }
    return lines.join('\n');
  }

  if (name === 'dot_memory_search') {
    const res = targetStore.search({
      query: args.query,
      alternates: args.alternates,
      limit: Math.min(Math.max(Number(args.limit) || 8, 1), 24),
    });
    if (res.hits.length === 0) return `No matches for "${args.query}".`;
    return res.hits.map((h, i) => `${i + 1}. [${h.kind}] ${h.title} (score=${h.score})\n   ${h.summary || ''}`).join('\n');
  }

  if (name === 'dot_memory_wiki_read') {
    if (!args.key) {
      const pages = targetStore.wiki.listPages({ type: args.type || null });
      if (pages.length === 0) return 'Entity Wiki is empty.';
      return pages.map((p) => `- ${p.key} [#${p.hashPrefix}] · ${p.title} (facts:${p.facts.length}, open:${p.openItems.length}, updated:${String(p.updatedAt || '').slice(0, 10)})`).join('\n');
    }
    const page = targetStore.wiki.readPage(args.key);
    if (!page) return `Wiki page not found: ${args.key}`;
    if (args.includeTimeline) {
      const tl = targetStore.getWikiTimeline(args.key);
      const tlLines = tl?.items?.length
        ? ['', '## Derived Timeline', '', ...tl.items.map((it) => `- [${it.date}] (${it.kind}) ${it.summary}`)]
        : [];
      return `${page.raw}${tlLines.join('\n')}`;
    }
    return page.raw;
  }

  if (name === 'dot_memory_recall') {
    const res = targetStore.recall(args.message, { limit: Math.min(Math.max(Number(args.limit) || 3, 1), 5) });
    if (res.matches.length === 0) {
      return res.retrospectiveIntent
        ? 'No direct trigger hits, but retrospective recall intent detected — run dot_memory_search.'
        : 'No direct trigger hits.';
    }
    return res.envelope;
  }

  if (name === 'dot_memory_handoffs') {
    const rows = targetStore.listHandoffs({
      agent: args.agent || null,
      workspace: args.workspace || null,
      status: args.status || null,
      limit: Math.min(Math.max(Number(args.limit) || 12, 1), 50),
    });
    if (rows.length === 0) return 'No handoffs recorded yet.';
    return rows.map((h) => `- [${h.ts.slice(0, 16)}] [${h.agent}] (${h.status}) ${h.workspace} :: ${h.title}\n  ${h.summary}`).join('\n');
  }

  if (name === 'dot_memory_propose') {
    const res = targetStore.proposeMemory({
      bucket: args.bucket,
      text: args.text,
      topic: args.topic,
      quote: args.quote,
      quoteSource: args.quoteSource,
      sourceText: args.sourceText || args.quote,
      sourceKind: 'chat',
      provenance: 'MCP agent proposal',
    });
    if (!res.candidate) {
      return JSON.stringify({ ok: false, reason: res.rejectedReason || (res.duplicate ? 'DUPLICATE' : 'REJECTED') });
    }
    return JSON.stringify({ ok: true, candidateId: res.candidate.id, status: 'pending_review', quotedInVerified: true });
  }

  if (name === 'dot_memory_record_handoff') {
    const res = targetStore.recordHandoff({
      agent: args.agent,
      workspace: args.workspace,
      workspacePath: args.workspacePath || '',
      status: args.status || 'done',
      title: args.title || args.summary.slice(0, 80),
      summary: args.summary,
      artifacts: args.artifacts || [],
      nextSteps: args.nextSteps || [],
    });
    const wikiRes = targetStore.syncWiki();
    return JSON.stringify({ ok: true, appended: res.appended, id: res.handoff.id, wikiUpdated: wikiRes.updated + wikiRes.created });
  }

  throw new Error(`Unknown tool: ${name}`);
}

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function handleLine(line) {
  if (!line.trim()) return;
  let req;
  try { req = JSON.parse(line); } catch { return; }
  const { id, method, params } = req;
  if (id === undefined) return; // JSON-RPC notification

  try {
    if (method === 'initialize') {
      return send({
        jsonrpc: '2.0',
        id,
        result: { protocolVersion: PROTOCOL, serverInfo: SERVER_INFO, capabilities: { tools: {} } },
      });
    }
    if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
    if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    if (method === 'tools/call') {
      const text = handleMcpToolCall(params?.name, params?.arguments || {}, store);
      return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } });
    }
    return send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
  } catch (err) {
    return send({ jsonrpc: '2.0', id, error: { code: -32000, message: err?.message || String(err) } });
  }
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''));
if (isMain || process.argv[1]?.endsWith('dot-memory-mcp.mjs')) {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', handleLine);
}
