/**
 * Deterministic zero-LLM Entity Wiki incremental synchronizer.
 * Aggregates non-Google local workspaces, cross-agent handoffs, workspace
 * progress documents, non-Google session dossiers, and active focus memories.
 */

import crypto from 'node:crypto';
import path from 'node:path';
import { isGoogleProtected } from './storage.mjs';

const FIXTURE_ROOT_RE = /\/output\/[^/]*fixtures\//i;
const MAX_SAFE_LIST_ITEMS = 18;

const squash = (text, max = 360) => String(text ?? '').replace(/\s+/gu, ' ').trim().slice(0, max);

function slugifyEntity(raw, prefix = 'ent') {
  const ascii = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, '-')
    .replace(/^[^a-z0-9]+|-+$/gu, '')
    .slice(0, 48);
  if (ascii && /^[a-z0-9][a-z0-9_-]{0,63}$/u.test(ascii)) return ascii;
  const digest = crypto.createHash('sha256').update(String(raw ?? '')).digest('hex').slice(0, 12);
  return `${prefix}-${digest}`;
}

function safeRefId(prefix, raw) {
  const cleaned = String(raw ?? '').replace(/[^A-Za-z0-9_.:/-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 56);
  if (cleaned) return `${prefix}:${cleaned}`.slice(0, 80);
  const digest = crypto.createHash('sha256').update(String(raw ?? '')).digest('hex').slice(0, 12);
  return `${prefix}:${digest}`;
}

function isoDay(raw, fallbackDate) {
  const ms = Date.parse(String(raw ?? ''));
  if (Number.isFinite(ms)) return new Date(ms).toISOString().slice(0, 10);
  return (fallbackDate instanceof Date ? fallbackDate : new Date(fallbackDate || Date.now())).toISOString().slice(0, 10);
}

const stripRefs = (text) => squash(String(text ?? '').replace(/\[\[ref:[^\]]+\]\]/gu, ''), 500).toLowerCase();

function buildIncrementalOps(priorItems = [], candidateTexts = []) {
  const existingNorm = new Set(priorItems.map((item) => stripRefs(item.text)));
  const remaining = Math.max(0, MAX_SAFE_LIST_ITEMS - priorItems.length);
  if (remaining === 0) return [];
  const ops = [];
  for (const rawText of candidateTexts) {
    if (ops.length >= remaining) break;
    const clean = squash(rawText, 460);
    const norm = stripRefs(clean);
    if (!clean || !norm || existingNorm.has(norm)) continue;
    existingNorm.add(norm);
    ops.push({ text: clean });
  }
  return ops;
}

export function syncEntityWikiIncremental({
  entityWiki,
  workspaces = [],
  handoffs = [],
  workspaceDocs = [],
  dossiers = [],
  memoryItems = [],
  trackingItems = [],
  aliases = {},
  isAllowedSession = () => true,
  now = new Date(),
} = {}) {
  if (!entityWiki || typeof entityWiki.upsertPage !== 'function') {
    return { created: 0, updated: 0, totalPages: 0 };
  }

  let created = 0;
  let updated = 0;

  const aliasMap = new Map(
    Object.entries(aliases && typeof aliases === 'object' ? aliases : {}).map(([k, v]) => [
      k.toLowerCase(),
      Array.isArray(v) ? v : [],
    ]),
  );

  const safeWorkspaces = (Array.isArray(workspaces) ? workspaces : [])
    .filter((ws) => ws && typeof ws.root === 'string' && !FIXTURE_ROOT_RE.test(ws.root));

  const safeHandoffs = (Array.isArray(handoffs) ? handoffs : [])
    .filter((h) => h && !isGoogleProtected(h) && squash(h.summary || h.title, 120).length > 0);

  const safeDocs = (Array.isArray(workspaceDocs) ? workspaceDocs : [])
    .filter((d) => d && !isGoogleProtected(d) && squash(d.summary || d.title, 120).length > 0);

  const safeDossiers = (Array.isArray(dossiers) ? dossiers : [])
    .filter((d) => d && !isGoogleProtected(d) && !String(d.id || '').startsWith('dot-butler-') && isAllowedSession(d.id) && squash(d.title, 120).length > 0)
    .sort((a, b) => (Date.parse(b.updatedAt || '') || 0) - (Date.parse(a.updatedAt || '') || 0))
    .slice(0, 30);

  const safeFocusMemories = (Array.isArray(memoryItems) ? memoryItems : [])
    .filter((i) => i && i.active !== false && !isGoogleProtected(i) && (i.bucket === 'focus' || i.category === 'active_focus'));

  const safeTracking = (Array.isArray(trackingItems) ? trackingItems : [])
    .filter((t) => t && t.scope !== 'google_isolated' && t.status !== 'done' && squash(t.content, 240).length > 0);

  // Discover implicit project names from handoffs & workspaceDocs even if workspaces[] wasn't explicitly listed
  const projectMap = new Map();
  for (const ws of safeWorkspaces.slice(0, 20)) {
    const label = squash(ws.label || path.basename(ws.root), 80);
    if (label) projectMap.set(label.toLowerCase(), { label, rootName: path.basename(ws.root) });
  }
  for (const h of safeHandoffs) {
    const label = squash(h.workspace, 80);
    if (label && !projectMap.has(label.toLowerCase())) {
      projectMap.set(label.toLowerCase(), { label, rootName: label });
    }
  }
  for (const d of safeDocs) {
    const label = squash(d.workspace || d.project, 80);
    if (label && !projectMap.has(label.toLowerCase())) {
      projectMap.set(label.toLowerCase(), { label, rootName: label });
    }
  }

  // 1. Sync `project/*` pages
  for (const { label, rootName } of projectMap.values()) {
    const slug = slugifyEntity(label, 'ws');
    const key = `project/${slug}`;
    const wsRefId = safeRefId('ws', slug);
    const prior = entityWiki.readPage(key);
    const sources = { [wsRefId]: `本地工作区 ${label}` };

    const relatedDossiers = safeDossiers.filter((d) => {
      const wsTitle = squash(d.workspaceTitle || '', 80).toLowerCase();
      return wsTitle && (wsTitle === label.toLowerCase() || wsTitle === rootName.toLowerCase());
    });
    const relatedHandoffs = safeHandoffs.filter((h) => {
      const hw = squash(h.workspace || '', 80).toLowerCase();
      return hw === label.toLowerCase() || hw === rootName.toLowerCase();
    });
    const relatedDocs = safeDocs.filter((d) => {
      const dw = squash(d.workspace || d.project || '', 80).toLowerCase();
      return dw === label.toLowerCase() || dw === rootName.toLowerCase();
    });

    const knownAliases = aliasMap.get(label.toLowerCase()) || aliasMap.get(rootName.toLowerCase()) || [];
    const mergedAliases = [...new Set([...(prior?.aliases || []), label, rootName, ...knownAliases].filter((a) => a && a !== label))].slice(0, 16);

    const openCandidates = [];
    for (const d of relatedDossiers.filter((d) => !d.archived && ['wait', 'stuck', 'run'].includes(d.status)).slice(0, 4)) {
      openCandidates.push(`${squash(d.title, 140)}（${d.statusLabel || d.status}）[[ref:${wsRefId}]]`);
    }
    for (const h of relatedHandoffs.filter((h) => h.status === 'blocked' || h.status === 'error' || h.status === 'waiting').slice(0, 4)) {
      const hRef = safeRefId('hoff', h.id);
      sources[hRef] = `${h.agent} 交接 (${isoDay(h.ts, now)})`;
      openCandidates.push(`[${h.agent}/${h.status}] ${squash(h.summary, 180)} [[ref:${hRef}]]`);
    }
    for (const h of relatedHandoffs.slice(0, 3)) {
      const hRef = safeRefId('hoff', h.id);
      sources[hRef] = `${h.agent} 交接 (${isoDay(h.ts, now)})`;
      for (const step of h.nextSteps || []) {
        openCandidates.push(`${squash(step, 160)} [[ref:${hRef}]]`);
      }
    }

    const factCandidates = [];
    for (const d of relatedDossiers.slice(0, 3)) {
      factCandidates.push(`近期会话：${squash(d.title, 120)}（${isoDay(d.updatedAt, now)}）[[ref:${wsRefId}]]`);
    }
    for (const h of relatedHandoffs.slice(0, 5)) {
      const hRef = safeRefId('hoff', h.id);
      sources[hRef] = `${h.agent} 交接 (${isoDay(h.ts, now)})`;
      factCandidates.push(`[${h.agent} · ${isoDay(h.ts, now)}] ${squash(h.summary, 180)} [[ref:${hRef}]]`);
    }
    for (const doc of relatedDocs.slice(0, 3)) {
      const docRef = safeRefId('doc', doc.id || `${slug}-${isoDay(doc.updatedAt, now)}`);
      sources[docRef] = squash(doc.sourceLabel || `${label} 文档`, 120);
      factCandidates.push(`${squash(doc.summary, 200)} [[ref:${docRef}]]`);
    }

    const openOps = buildIncrementalOps(prior?.openItems, openCandidates);
    const factOps = buildIncrementalOps(prior?.facts, factCandidates);
    const aliasesChanged = prior && JSON.stringify(mergedAliases) !== JSON.stringify(prior.aliases || []);

    if (prior && openOps.length === 0 && factOps.length === 0 && !aliasesChanged) continue;

    const res = entityWiki.upsertPage({
      type: 'project',
      slug,
      title: label,
      aliases: mergedAliases,
      sources,
      summary: prior
        ? { keep: true }
        : { text: `本地工作区「${label}」实体档案，持续聚合跨 Agent 交接、会话进展与待办。[[ref:${wsRefId}]]`, reason: '自动初始化项目档案' },
      ...(factOps.length ? { facts: factOps } : {}),
      ...(openOps.length ? { openItems: openOps } : {}),
    }, { now });
    if (res.created) created += 1;
    else updated += 1;
  }

  // 2. Sync non-Google dossiers -> `session/*`
  for (const dossier of safeDossiers) {
    const slug = slugifyEntity(`ses-${dossier.id}`, 'ses');
    const key = `session/${slug}`;
    const refId = safeRefId('dos', dossier.id);
    const prior = entityWiki.readPage(key);
    const wsLabel = squash(dossier.workspaceTitle || '通用会话', 80);
    const title = squash(dossier.title, 120);
    const day = isoDay(dossier.updatedAt, now);
    const checklist = Array.isArray(dossier.checklist) ? dossier.checklist : [];

    const openCandidates = [];
    if (!dossier.archived) {
      for (const s of checklist.filter((x) => x && !x.checked).slice(0, 5)) {
        openCandidates.push(`${squash(s.text, 200)} [[ref:${refId}]]`);
      }
      if (openCandidates.length === 0 && ['wait', 'stuck'].includes(dossier.status)) {
        openCandidates.push(`待拍板：${title} [[ref:${refId}]]`);
      }
    }
    const decisionCandidates = checklist.filter((x) => x && x.checked).slice(0, 4).map((s) => `已完成：${squash(s.text, 200)} [[ref:${refId}]]`);
    if (dossier.archived && decisionCandidates.length === 0) decisionCandidates.push(`会话已归档（${day}）[[ref:${refId}]]`);

    const factCandidates = [];
    const summarySnippet = squash(dossier.summary, 240);
    if (summarySnippet) factCandidates.push(`进展摘要：${summarySnippet} [[ref:${refId}]]`);

    const openOps = buildIncrementalOps(prior?.openItems, openCandidates);
    const decisionOps = buildIncrementalOps(prior?.decisions, decisionCandidates);
    const factOps = buildIncrementalOps(prior?.facts, factCandidates);
    if (prior && openOps.length === 0 && decisionOps.length === 0 && factOps.length === 0) continue;

    const summaryText = `工作区「${wsLabel}」会话「${title}」（状态：${dossier.statusLabel || dossier.status}）。${summarySnippet ? `${summarySnippet} ` : ''}[[ref:${refId}]]`;
    const res = entityWiki.upsertPage({
      type: 'session',
      slug,
      title,
      date: day,
      sources: { [refId]: `本地工作会话 ${title} (${wsLabel})` },
      summary: prior ? { keep: true } : { text: summaryText.slice(0, 2800), reason: '从本地会话同步归档' },
      ...(factOps.length ? { facts: factOps } : {}),
      ...(openOps.length ? { openItems: openOps } : {}),
      ...(decisionOps.length ? { decisions: decisionOps } : {}),
    }, { now });
    if (res.created) created += 1;
    else updated += 1;
  }

  // 3. Sync active focus + tracking + blocked handoffs -> `topic/active-focus`
  const blockedHandoffs = safeHandoffs.filter((h) => h.status === 'blocked' || h.status === 'error' || h.status === 'waiting').slice(0, 6);
  if (safeFocusMemories.length > 0 || safeTracking.length > 0 || blockedHandoffs.length > 0) {
    const key = 'topic/active-focus';
    const prior = entityWiki.readPage(key);
    const sources = {};
    const factCandidates = [];
    const openCandidates = [];

    for (const mem of safeFocusMemories.slice(0, 8)) {
      const refId = safeRefId('mem', mem.id || mem.text.slice(0, 24));
      sources[refId] = squash(mem.provenance || '活体记忆', 120);
      factCandidates.push(`${squash(mem.text, 240)} [[ref:${refId}]]`);
    }
    for (const trk of safeTracking.slice(0, 8)) {
      const refId = safeRefId('trk', trk.id || trk.idempotencyKey || trk.content.slice(0, 24));
      sources[refId] = `追踪账本 (${trk.kind || 'todo'})`;
      openCandidates.push(`${squash(trk.content, 240)} [[ref:${refId}]]`);
    }
    for (const h of blockedHandoffs) {
      const refId = safeRefId('hoff', h.id);
      sources[refId] = `${h.agent} 阻塞/待处理 (${isoDay(h.ts, now)})`;
      openCandidates.push(`[${h.agent}/${h.workspace}] ${squash(h.summary, 180)} [[ref:${refId}]]`);
    }

    const factOps = buildIncrementalOps(prior?.facts, factCandidates);
    const openOps = buildIncrementalOps(prior?.openItems, openCandidates);
    if (!prior || factOps.length > 0 || openOps.length > 0) {
      const firstRef = Object.keys(sources)[0] || 'mem:active-focus';
      if (!sources[firstRef]) sources[firstRef] = '本地活体记忆与交接总线';
      const res = entityWiki.upsertPage({
        type: 'topic',
        slug: 'active-focus',
        title: '近期主线与跨端待跟进',
        aliases: ['当前焦点', '近期主线', 'active focus'],
        sources,
        summary: prior ? { keep: true } : { text: `聚合活体记忆、跨端交接卡点与本地待跟进事项。[[ref:${firstRef}]]`, reason: '自动同步近期主线' },
        ...(factOps.length ? { facts: factOps } : {}),
        ...(openOps.length ? { openItems: openOps } : {}),
      }, { now });
      if (res.created) created += 1;
      else updated += 1;
    }
  }

  return { created, updated, totalPages: entityWiki.listPages().length };
}
