import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { DotMemoryStore, EntityWikiValidationError } from '../src/core/index.mjs';
import { handleMcpToolCall } from '../bin/dot-memory-mcp.mjs';

test('Stage 11 dot-memory: expectedHash fence, derived handoff timeline, local git checkpoint, trigger-recall MCP & 30d dormant archive', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dot-mem-s11-'));
  const store = new DotMemoryStore({ homeDir }).ensureInitialized();

  const created = store.wiki.upsertPage({
    type: 'project',
    slug: 'dsh-dot',
    title: 'DSH Dot 随身参谋',
    aliases: ['DotMobile', 'DSH.'],
    triggers: ['随身参谋', '唤醒机制'],
    summary: '本地优先个人参谋与双端桥。',
    facts: [{ text: '纯 Node ESM 零数据库架构' }],
  }, { now: '2026-11-20T08:00:00Z' });

  assert.equal(created.page.hashPrefix.length, 16);
  assert.equal(created.checkpoint.committed, true);

  // Hash mismatch rejected
  assert.throws(
    () => store.wiki.upsertPage({
      type: 'project',
      slug: 'dsh-dot',
      title: 'DSH Dot 随身参谋',
      expectedHash: 'ffffffffffffffff',
      summary: { keep: true },
    }),
    (err) => err instanceof EntityWikiValidationError && err.code === 'HASH_MISMATCH',
  );

  // Handoff feeds derived timeline without mutating wiki prose
  store.recordHandoff({
    agent: 'antigravity',
    workspace: 'DSH Dot',
    title: '完成 Stage 11 记忆总线加固',
    summary: '给 DSH Dot 随身参谋补齐了 hash 写栅栏与触发召回',
    ts: '2026-11-26T00:05:00Z',
  });
  const timeline = store.getWikiTimeline('project/dsh-dot');
  assert.ok(timeline.items.some((i) => i.kind === 'handoff'));

  // MCP dot_memory_wiki_read with includeTimeline & dot_memory_recall
  const wikiWithTl = handleMcpToolCall('dot_memory_wiki_read', { key: 'project/dsh-dot', includeTimeline: true }, store);
  assert.match(wikiWithTl, /## Derived Timeline/);
  assert.match(wikiWithTl, /Stage 11/);

  const recalled = handleMcpToolCall('dot_memory_recall', { message: '帮我查一下随身参谋的唤醒机制' }, store);
  assert.match(recalled, /<dot_recalled_wiki mode="readonly_context">/);
  assert.match(recalled, /DSH Dot 随身参谋/);

  // Local git checkpoint history recorded
  const hist = store.wiki.history('project/dsh-dot');
  assert.ok(hist.length >= 1);

  // 30d dormant session archive + restore
  store.wiki.upsertPage({
    type: 'session',
    slug: 'dormant-sep',
    title: '九月旧调试',
    date: '2026-09-10',
    summary: '已结案调试记录',
  }, { now: '2026-09-10T08:00:00Z' });
  const arch = store.archiveDormantWiki({ maxIdleDays: 30, now: '2026-11-26T00:00:00Z' });
  assert.equal(arch.archivedCount, 1);
  assert.equal(store.wiki.readPage('session/dormant-sep'), null);
  assert.equal(store.wiki.restoreArchivedPage('dormant-sep').ok, true);
});
