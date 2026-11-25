/**
 * Zero-LLM associative recall ("Flashback") over EntityWiki.
 * Excludes the directly named topic and walks 1 hop via non-session bridges
 * to surface forgotten older sessions/episodes with decaying relevance & budgets.
 */

import fs from 'node:fs';
import path from 'node:path';
import { writeFileAtomic } from './storage.mjs';

export const DEFAULT_FLASHBACK_SETTINGS = Object.freeze({
  forgetDays: 14,
  threshold: 0.2,
  sessionCooldownMinutes: 30,
  episodeRepeatDays: 7,
  dailyLimit: 3,
  cueCooldownHours: 24,
  nativeLinkStrength: 1.0,
  mentionLinkStrength: 0.65,
  sameTopicStrength: 0.95,
  historyRetentionDays: 30,
});

const DAY_MS = 86_400_000;
const escapeRegExp = (t) => t.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

function buildEntityMatchers(pages) {
  const matchers = [];
  for (const page of pages) {
    if (page.type === 'session') continue;
    const names = [page.title, ...(page.aliases ?? [])].map((i) => String(i || '').trim()).filter((i) => i.length >= 2);
    if (names.length === 0) continue;
    const patterns = names.map((name) => {
      const escaped = escapeRegExp(name);
      return /^[A-Za-z0-9 _.-]+$/u.test(name)
        ? new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, 'iu')
        : new RegExp(escaped, 'iu');
    });
    matchers.push({ key: page.key, page, patterns });
  }
  return matchers;
}

function pageFullText(page) {
  return [
    page.title,
    page.summary,
    ...(page.facts ?? []).map((i) => i.text),
    ...(page.openItems ?? []).map((i) => i.text),
    ...(page.decisions ?? []).map((i) => i.text),
  ].join('\n');
}

function buildGraphTies(pages, matchers, settings) {
  const ties = new Map();
  const addTie = (from, to, strength, kind) => {
    if (from === to) return;
    if (!ties.has(from)) ties.set(from, new Map());
    const neighbors = ties.get(from);
    const existing = neighbors.get(to);
    if (!existing) neighbors.set(to, { strength, kinds: [kind] });
    else {
      existing.strength = Math.max(existing.strength, strength);
      if (!existing.kinds.includes(kind)) existing.kinds.push(kind);
    }
  };
  const validKeys = new Set(pages.map((p) => p.key));
  for (const page of pages) {
    for (const target of page.relations ?? []) {
      if (!validKeys.has(target)) continue;
      addTie(page.key, target, settings.nativeLinkStrength, 'link');
      addTie(target, page.key, settings.nativeLinkStrength, 'link');
    }
    const text = pageFullText(page);
    for (const m of matchers) {
      if (m.key === page.key) continue;
      if (m.patterns.some((re) => re.test(text))) {
        addTie(page.key, m.key, settings.mentionLinkStrength, 'mention');
        addTie(m.key, page.key, settings.mentionLinkStrength, 'mention');
      }
    }
  }
  return ties;
}

export function suggestFlashbackFromPages({
  pages = [],
  text = '',
  sessionKey = 'main',
  now = new Date(),
  history = [],
  settings: overrides = {},
} = {}) {
  const settings = { ...DEFAULT_FLASHBACK_SETTINGS, ...overrides };
  if (!Array.isArray(pages) || pages.length === 0 || typeof text !== 'string' || !text.trim()) {
    return { reason: 'no_graph', suggestion: null };
  }
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const since = (r) => nowMs - Date.parse(r.at);

  if (sessionKey && history.some((r) => r.sessionKey === sessionKey && since(r) < settings.sessionCooldownMinutes * 60_000)) {
    return { reason: 'session_cooldown', suggestion: null };
  }
  if (history.filter((r) => since(r) < DAY_MS).length >= settings.dailyLimit) {
    return { reason: 'daily_limit', suggestion: null };
  }

  const byKey = new Map(pages.map((p) => [p.key, p]));
  const matchers = buildEntityMatchers(pages);
  const cues = new Map();
  for (const m of matchers) {
    if (m.patterns.some((re) => re.test(text))) cues.set(m.key, { strength: 1.0, via: 'name' });
  }
  for (const r of history) {
    if (r.cue && since(r) < settings.cueCooldownHours * 3_600_000) cues.delete(r.cue);
  }
  if (cues.size === 0) return { reason: 'no_cue', suggestion: null };

  const recentlyRecalled = new Set(history.filter((r) => since(r) < settings.episodeRepeatDays * DAY_MS).map((r) => r.episode));
  const ties = buildGraphTies(pages, matchers, settings);
  const fanDamping = (k) => Math.min(1, 2 / Math.log(1 + Math.max(1, ties.get(k)?.size ?? 1)));

  const currentTopic = new Set(cues.keys());
  for (const ck of cues.keys()) {
    for (const [neighbor, tie] of ties.get(ck) ?? []) {
      if (tie.strength >= settings.sameTopicStrength) currentTopic.add(neighbor);
    }
  }

  const bestByEpisode = new Map();
  const offer = (ep, cand) => {
    const prev = bestByEpisode.get(ep);
    if (!prev || cand.strength > prev.strength) bestByEpisode.set(ep, cand);
  };

  for (const [ck, cueMeta] of cues) {
    const bridges = [
      { key: ck, strength: 1.0 },
      ...[...(ties.get(ck) ?? [])]
        .filter(([nk]) => byKey.get(nk)?.type !== 'session')
        .map(([nk, tie]) => ({ key: nk, strength: tie.strength * fanDamping(nk) })),
    ];
    for (const bridge of bridges) {
      for (const [tk, tie] of ties.get(bridge.key) ?? []) {
        const tp = byKey.get(tk);
        if (!tp || tp.type !== 'session') continue;
        if (currentTopic.has(tk) || recentlyRecalled.has(tk)) continue;
        offer(tk, { cue: ck, bridge: bridge.key, strength: cueMeta.strength * bridge.strength * tie.strength, ties: tie.kinds });
      }
    }
  }

  let chosen = null;
  for (const [ep, cand] of bestByEpisode) {
    const page = byKey.get(ep);
    const date = page?.date || String(page?.updatedAt || '').slice(0, 10);
    if (!date) continue;
    const days = Math.max(0, (nowMs - Date.parse(`${date}T00:00:00Z`)) / DAY_MS);
    const forgotten = 1 - Math.exp(-days / settings.forgetDays);
    const openItems = (page.openItems ?? []).map((i) => i.text);
    const decisions = (page.decisions ?? []).map((i) => i.text);
    const score = cand.strength * forgotten * (openItems.length > 0 ? 1.5 : 1.0);
    if (chosen && score <= chosen.score) continue;
    chosen = {
      episode: ep,
      title: page.title,
      date,
      cue: { key: cand.cue, title: byKey.get(cand.cue)?.title ?? cand.cue, via: 'name' },
      ...(cand.bridge !== cand.cue ? { bridge: { key: cand.bridge, title: byKey.get(cand.bridge)?.title ?? cand.bridge } } : {}),
      ties: cand.ties,
      strength: Number(cand.strength.toFixed(4)),
      score: Number(score.toFixed(4)),
      situation: page.summary,
      decisions: decisions.slice(0, 4),
      openItems: openItems.slice(0, 4),
    };
  }

  if (!chosen) return { reason: 'no_candidate', suggestion: null };
  if (chosen.score < settings.threshold) return { reason: 'below_threshold', suggestion: null };
  return { reason: 'suggested', suggestion: chosen };
}

export class FlashbackEngine {
  constructor(wiki, historyPath, settings = {}) {
    this.wiki = wiki;
    this.historyPath = path.resolve(historyPath);
    this.settings = { ...DEFAULT_FLASHBACK_SETTINGS, ...settings };
  }

  #readHistory() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.historyPath, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  #writeHistory(history, nowMs) {
    const cutoff = nowMs - this.settings.historyRetentionDays * DAY_MS;
    const trimmed = history.filter((r) => Date.parse(r.at) >= cutoff);
    writeFileAtomic(path.dirname(this.historyPath), this.historyPath, JSON.stringify(trimmed, null, 2) + '\n');
  }

  suggest({ text = '', sessionKey = 'main', now = new Date(), recordHit = true } = {}) {
    const pages = this.wiki.listPages();
    const history = this.#readHistory();
    const result = suggestFlashbackFromPages({ pages, text, sessionKey, now, history, settings: this.settings });
    if (recordHit && result.suggestion) {
      const nowDate = now instanceof Date ? now : new Date(now);
      history.push({
        at: nowDate.toISOString(),
        sessionKey,
        cue: result.suggestion.cue.key,
        episode: result.suggestion.episode,
      });
      this.#writeHistory(history, nowDate.getTime());
    }
    return result;
  }
}
