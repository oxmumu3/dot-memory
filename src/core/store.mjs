/**
 * Unified local store facade (`DotMemoryStore`) shared by the DSH plugin,
 * stdio MCP server, CLI hooks, and optional external consumers such as DSH.dot.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { EntityWiki } from './entity-wiki.mjs';
import { FlashbackEngine } from './flashback.mjs';
import { HandoffBus } from './handoff-bus.mjs';
import { rankHybridLexical } from './hybrid-search.mjs';
import {
  hasRetrospectiveRecallIntent,
  renderTriggeredWikiBlock,
  selectTriggeredWikiPages,
} from './trigger-recall.mjs';
import {
  LIVING_MEMORY_BUCKETS,
  LIVING_MEMORY_MAX_BYTES,
  activeMemoryBytes,
  buildFirstTurnMemoryEnvelope,
  emptyLivingMemory,
  normalizeLivingMemory,
  proposeCandidate,
  renderLivingMemoryMarkdown,
  reviewCandidate,
  runDreaming,
  updateLivingMemory,
} from './living-memory.mjs';
import { ensurePrivateDir, readSafeJson, resolveDotMemoryHome, writeFileAtomic } from './storage.mjs';
import { syncEntityWikiIncremental } from './wiki-sync.mjs';

export class DotMemoryStore {
  constructor({ homeDir } = {}) {
    this.homeDir = resolveDotMemoryHome(homeDir);
    this.livingJsonPath = path.join(this.homeDir, 'living-memory.json');
    this.livingMdPath = path.join(this.homeDir, 'LIVING-MEMORY.md');
    this.configPath = path.join(this.homeDir, 'config.json');
    this.wiki = new EntityWiki(path.join(this.homeDir, 'wiki'));
    this.handoffs = new HandoffBus(this.homeDir);
    this.flashback = new FlashbackEngine(this.wiki, path.join(this.homeDir, 'flashback-history.json'));
  }

  ensureInitialized() {
    ensurePrivateDir(this.homeDir);
    ensurePrivateDir(path.join(this.homeDir, 'handoffs'));
    ensurePrivateDir(path.join(this.homeDir, 'wiki'));
    if (!fs.existsSync(this.livingJsonPath)) {
      this.#saveLiving(emptyLivingMemory());
    }
    if (!fs.existsSync(this.configPath)) {
      writeFileAtomic(this.homeDir, this.configPath, JSON.stringify({
        version: 1,
        staleFocusDays: 7,
        workspaceAliases: {},
        workspaces: [],
      }, null, 2) + '\n');
    }
    return this;
  }

  getConfig() {
    const raw = readSafeJson(this.homeDir, this.configPath, {});
    return {
      version: 1,
      staleFocusDays: Number(raw?.staleFocusDays) > 0 ? Number(raw.staleFocusDays) : 7,
      workspaceAliases: raw?.workspaceAliases && typeof raw.workspaceAliases === 'object' ? raw.workspaceAliases : {},
      workspaces: Array.isArray(raw?.workspaces) ? raw.workspaces : [],
    };
  }

  saveConfig(patch = {}) {
    this.ensureInitialized();
    const next = { ...this.getConfig(), ...patch, version: 1 };
    writeFileAtomic(this.homeDir, this.configPath, JSON.stringify(next, null, 2) + '\n');
    return next;
  }

  getLivingMemory() {
    const raw = readSafeJson(this.homeDir, this.livingJsonPath, null);
    return normalizeLivingMemory(raw);
  }

  #saveLiving(memory, now = new Date()) {
    const clean = normalizeLivingMemory(memory);
    writeFileAtomic(this.homeDir, this.livingJsonPath, JSON.stringify(clean, null, 2) + '\n');
    writeFileAtomic(this.homeDir, this.livingMdPath, renderLivingMemoryMarkdown(clean, now));
    return clean;
  }

  livingMemoryHash() {
    const mem = this.getLivingMemory();
    const active = mem.items.filter((i) => i.active && i.quotedInVerified).map((i) => `${i.id}:${i.bucket}:${i.text}`);
    return createHash('sha256').update(active.join('\n')).digest('hex').slice(0, 16);
  }

  buildFirstTurnEnvelope(opts) {
    return buildFirstTurnMemoryEnvelope(this.getLivingMemory(), opts);
  }

  addMemory(input, opts = {}) {
    this.ensureInitialized();
    const res = updateLivingMemory(this.getLivingMemory(), input, opts);
    if (res.item || input?.remove) {
      this.#saveLiving(res.memory, opts.now);
    }
    return res;
  }

  toggleMemoryActive(id) {
    this.ensureInitialized();
    const mem = this.getLivingMemory();
    const target = mem.items.find((i) => i.id === id);
    if (!target) throw new Error('找不到该记忆条目');
    return this.addMemory({ id, active: !target.active });
  }

  removeMemory(id) {
    return this.addMemory({ id, remove: true });
  }

  proposeMemory(input, opts = {}) {
    this.ensureInitialized();
    const res = proposeCandidate(this.getLivingMemory(), input, opts);
    if (res.candidate) {
      this.#saveLiving(res.memory, opts.now);
    }
    return res;
  }

  reviewCandidate(id, decision = 'approve', opts = {}) {
    this.ensureInitialized();
    const res = reviewCandidate(this.getLivingMemory(), { id, decision, ...opts });
    this.#saveLiving(res.memory, opts.now);
    return res;
  }

  recordHandoff(input, opts = {}) {
    this.ensureInitialized();
    return this.handoffs.append(input, opts);
  }

  listHandoffs(opts = {}) {
    return this.handoffs.list(opts);
  }

  syncWiki({ workspaces, workspaceDocs, dossiers, trackingItems, now = new Date() } = {}) {
    this.ensureInitialized();
    const cfg = this.getConfig();
    const mem = this.getLivingMemory();
    return syncEntityWikiIncremental({
      entityWiki: this.wiki,
      workspaces: workspaces ?? cfg.workspaces,
      handoffs: this.handoffs.list({ limit: 80, sinceDays: 14 }),
      workspaceDocs: workspaceDocs ?? [],
      dossiers: dossiers ?? [],
      memoryItems: mem.items,
      trackingItems: trackingItems ?? [],
      aliases: cfg.workspaceAliases,
      now,
    });
  }

  dream({ observations = [], workspaceProgress = [], force = false, now = new Date() } = {}) {
    this.ensureInitialized();
    const cfg = this.getConfig();
    const recentHandoffs = this.handoffs.list({ limit: 80, sinceDays: 14 });
    const res = runDreaming({
      memory: this.getLivingMemory(),
      observations,
      handoffs: recentHandoffs,
      workspaceProgress,
      now,
      force,
      staleFocusDays: cfg.staleFocusDays,
    });
    if (res.ran) {
      this.#saveLiving(res.memory, now);
      this.syncWiki({ now });
      try { this.wiki.archiveDormantPages({ maxIdleDays: 30, now }); } catch {}
    }
    return res;
  }

  getWikiTimeline(key, { limit = 20 } = {}) {
    this.ensureInitialized();
    const handoffs = this.handoffs.list({ limit: 100, sinceDays: 90 });
    return this.wiki.deriveTimeline(key, { handoffs, limit });
  }

  recall(message, { limit = 3, now = new Date() } = {}) {
    this.ensureInitialized();
    const matches = selectTriggeredWikiPages(message, this.wiki.listPages(), { limit, now });
    return {
      matches,
      retrospectiveIntent: hasRetrospectiveRecallIntent(message),
      envelope: renderTriggeredWikiBlock(matches),
    };
  }

  archiveDormantWiki({ maxIdleDays = 30, now = new Date(), keepKeys = [] } = {}) {
    this.ensureInitialized();
    return this.wiki.archiveDormantPages({ maxIdleDays, now, keepKeys });
  }

  search({ query, alternates = [], limit = 10 } = {}) {
    const mem = this.getLivingMemory();
    const docs = [];

    for (const it of mem.items.filter((i) => i.active)) {
      docs.push({
        id: `mem:${it.id}`,
        title: `${it.bucket} ${it.topic || ''}`,
        text: `${it.text}\n${it.quote}`,
        timestampMs: Date.parse(it.updatedAt || '') || 0,
        value: { kind: 'living_memory', id: it.id, bucket: it.bucket, title: it.text, summary: it.provenance, quote: it.quote, updatedAt: it.updatedAt },
      });
    }
    for (const page of this.wiki.listPages()) {
      docs.push({
        id: `wiki:${page.key}`,
        title: [page.title, ...page.aliases].join(' '),
        text: [page.summary, ...page.facts.map((f) => f.text), ...page.openItems.map((o) => o.text), ...page.decisions.map((d) => d.text)].join('\n'),
        timestampMs: Date.parse(page.updatedAt || '') || 0,
        value: {
          kind: 'wiki',
          key: page.key,
          type: page.type,
          title: page.title,
          summary: page.summary,
          openItems: page.openItems.slice(0, 3).map((o) => o.text),
          updatedAt: page.updatedAt,
        },
      });
    }
    for (const h of this.handoffs.list({ limit: 80, sinceDays: 30 })) {
      docs.push({
        id: `handoff:${h.id}`,
        title: `${h.workspace} ${h.agent} ${h.title}`,
        text: `${h.summary}\n${(h.nextSteps || []).join('\n')}\n${(h.artifacts || []).join('\n')}`,
        timestampMs: Date.parse(h.ts || '') || 0,
        value: {
          kind: 'handoff',
          id: h.id,
          agent: h.agent,
          workspace: h.workspace,
          status: h.status,
          title: h.title,
          summary: h.summary,
          ts: h.ts,
        },
      });
    }

    const { matches, wordings } = rankHybridLexical(docs, { query, alternates, limit });
    return {
      wordings,
      hits: matches.map((m) => ({
        ...m.value,
        score: Number(m.rrfScore.toFixed(6)),
      })),
    };
  }

  getSnapshot() {
    this.ensureInitialized();
    const memory = this.getLivingMemory();
    const usedBytes = activeMemoryBytes(memory.items);
    const handoffs = this.handoffs.list({ limit: 50, sinceDays: 14 });
    const wikiPages = this.wiki.listPages();
    const counts = {
      rules: memory.items.filter((i) => i.bucket === 'rules').length,
      style: memory.items.filter((i) => i.bucket === 'style').length,
      focus: memory.items.filter((i) => i.bucket === 'focus').length,
    };
    return {
      homeDir: this.homeDir,
      budget: { usedBytes, maxBytes: LIVING_MEMORY_MAX_BYTES, bucketLimits: LIVING_MEMORY_BUCKETS, counts },
      memory,
      handoffs,
      wikiPages: wikiPages.map((p) => ({
        key: p.key,
        type: p.type,
        slug: p.slug,
        title: p.title,
        aliases: p.aliases,
        date: p.date,
        summary: p.summary,
        facts: p.facts,
        openItems: p.openItems,
        decisions: p.decisions,
        changeLog: p.changeLog,
        sources: p.sources,
        updatedAt: p.updatedAt,
      })),
      config: this.getConfig(),
    };
  }
}
