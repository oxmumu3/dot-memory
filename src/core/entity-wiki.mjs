/**
 * Lightweight local Entity Wiki (zero vector DB, zero Docker).
 * Stores typed entity pages (`project`, `contact`, `client`, `topic`, `session`)
 * as deterministic JSON-frontmatter Markdown files with ID-locked lists,
 * summary citation conservation (`LOST_CITATIONS`), and deterministic Change Logs.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { rankHybridLexical } from './hybrid-search.mjs';
import { writeFileAtomic } from './storage.mjs';

export const ENTITY_TYPES = Object.freeze(['project', 'contact', 'client', 'topic', 'session']);
export const TRACKED_LIST_KEYS = Object.freeze(['facts', 'openItems', 'decisions']);
export const HASH_PREFIX_CHARS = 16;

const MAX_LIST_ITEMS = 20;
const MAX_SUMMARY_CHARS = 3000;
const MAX_ITEM_CHARS = 500;
const MAX_CHANGELOG_LINES = 20;
const REF_MARKER_RE = /\[\[ref:([A-Za-z0-9_.:/-]{1,80})\]\]/gu;
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const ITEM_ID_RE = /^i[1-9]\d*$/u;
const HEX_HASH_RE = /^[a-f0-9]+$/u;

export function computeContentHash(raw) {
  return createHash('sha256').update(String(raw ?? ''), 'utf8').digest('hex');
}

export function hashPrefix(hash) {
  return String(hash ?? '').slice(0, HASH_PREFIX_CHARS);
}

export function hashMatches(actual, expected) {
  const clean = String(expected ?? '').trim().toLowerCase();
  if (clean.length < HASH_PREFIX_CHARS || clean.length > 64 || !HEX_HASH_RE.test(clean)) {
    throw new EntityWikiValidationError('INVALID_EXPECTED_HASH', `expectedHash 必须为完整 64 位或其前 ${HASH_PREFIX_CHARS}+ 位小写十六进制哈希`);
  }
  return String(actual ?? '').toLowerCase().startsWith(clean);
}

function normalizeTriggers(triggers) {
  if (!Array.isArray(triggers)) return [];
  return [...new Set(triggers.map((i) => squash(i)).filter((i) => i.length >= 2 && i.length <= 60))].slice(0, 12);
}

function runIsolatedGit(rootDir, args, { timeout = 3000 } = {}) {
  const gitDir = path.join(rootDir, '.git');
  const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  return execFileSync(
    'git',
    [
      '--no-pager',
      `--git-dir=${gitDir}`,
      `--work-tree=${rootDir}`,
      '-c', 'core.hooksPath=/dev/null',
      '-c', 'core.fsmonitor=false',
      '-c', 'core.splitIndex=false',
      '-c', 'core.sparseCheckout=false',
      '-c', 'gc.auto=0',
      '-c', 'maintenance.auto=false',
      ...args,
    ],
    {
      cwd: rootDir,
      encoding: 'utf8',
      timeout,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...cleanEnv,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_TERMINAL_PROMPT: '0',
        GIT_AUTHOR_NAME: 'Dot Memory',
        GIT_AUTHOR_EMAIL: 'dot-memory@local',
        GIT_COMMITTER_NAME: 'Dot Memory',
        GIT_COMMITTER_EMAIL: 'dot-memory@local',
      },
    },
  ).trimEnd();
}

function commitWikiCheckpoint(rootDir, { message, relPaths = [] } = {}) {
  if (process.env.DOT_WIKI_NO_GIT === '1') return { committed: false, reason: 'disabled' };
  try {
    const gitDir = path.join(rootDir, '.git');
    if (!fs.existsSync(gitDir)) {
      fs.mkdirSync(rootDir, { recursive: true, mode: 0o700 });
      runIsolatedGit(rootDir, ['init', '-q']);
    }
    if (relPaths.length > 0) runIsolatedGit(rootDir, ['add', '-A', '--', ...relPaths]);
    else runIsolatedGit(rootDir, ['add', '-A']);
    const status = runIsolatedGit(rootDir, ['status', '--porcelain']);
    if (!status) return { committed: false, reason: 'unchanged' };
    runIsolatedGit(rootDir, ['commit', '-q', '-m', String(message || 'wiki checkpoint').slice(0, 140)]);
    const sha = runIsolatedGit(rootDir, ['rev-parse', '--short=12', 'HEAD']);
    return { committed: true, sha };
  } catch (err) {
    return { committed: false, reason: String(err?.code || err?.message || 'git_unavailable').slice(0, 120) };
  }
}

export class EntityWikiValidationError extends Error {
  constructor(code, message, issues = []) {
    super(message);
    this.name = 'EntityWikiValidationError';
    this.code = code;
    this.issues = issues;
  }
}

function squash(text) {
  return String(text ?? '').replace(/\s+/gu, ' ').trim();
}

function extractRefs(text) {
  const refs = [];
  for (const match of String(text ?? '').matchAll(REF_MARKER_RE)) refs.push(match[1]);
  return refs;
}

function normalizeSlug(raw) {
  const clean = String(raw ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]+/gu, '-').replace(/^-+|-+$/gu, '');
  if (!clean || !SLUG_RE.test(clean)) {
    throw new EntityWikiValidationError('INVALID_SLUG', '实体 slug 必须为 1–64 位小写字母、数字、连字符或下划线');
  }
  return clean;
}

function validateType(raw) {
  const clean = String(raw ?? '').trim().toLowerCase();
  if (!ENTITY_TYPES.includes(clean)) {
    throw new EntityWikiValidationError('INVALID_ENTITY_TYPE', `实体类型必须为 ${ENTITY_TYPES.join(' / ')}`);
  }
  return clean;
}

function normalizeAliases(aliases) {
  if (!Array.isArray(aliases)) return [];
  return [...new Set(aliases.map((i) => squash(i)).filter((i) => i.length > 0 && i.length <= 80))].slice(0, 20);
}

function normalizeRelations(relations) {
  if (!Array.isArray(relations)) return [];
  const valid = [];
  const seen = new Set();
  for (const rel of relations) {
    const target = typeof rel === 'string' ? rel.trim() : '';
    const [type, slug] = target.split('/');
    if (!type || !slug || !ENTITY_TYPES.includes(type) || !SLUG_RE.test(slug)) continue;
    const key = `${type}/${slug}`;
    if (!seen.has(key)) {
      seen.add(key);
      valid.push(key);
    }
  }
  return valid.slice(0, 40);
}

function normalizeSources(sources) {
  if (!sources || typeof sources !== 'object' || Array.isArray(sources)) return {};
  const out = {};
  for (const [id, label] of Object.entries(sources)) {
    if (!/^[A-Za-z0-9_.:/-]{1,80}$/u.test(id)) continue;
    const clean = squash(label);
    if (clean) out[id] = clean.slice(0, 240);
  }
  return out;
}

function parseMarkdownPage(raw) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/u.exec(String(raw ?? ''));
  if (!match) return null;
  let meta;
  try { meta = JSON.parse(match[1]); } catch { return null; }
  if (!meta || typeof meta !== 'object') return null;

  const body = match[2];
  const sectionMap = {};
  const headings = [...body.matchAll(/^##\s+(.+?)\s*$/gmu)];
  for (let i = 0; i < headings.length; i += 1) {
    const h = headings[i];
    sectionMap[h[1]] = body.slice(h.index + h[0].length, headings[i + 1]?.index ?? body.length).trim();
  }

  const readItems = (heading, ids = []) => {
    const text = sectionMap[heading] ?? '';
    if (!text || text === 'None observed.') return [];
    return text.split('\n').filter((l) => l.startsWith('- ')).map((l, idx) => ({
      id: ids[idx] ?? `i${idx + 1}`,
      text: l.slice(2).trim(),
    }));
  };

  const changeLog = (sectionMap['Change Log'] ?? '').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('- '));

  const contentHash = computeContentHash(raw);
  return {
    type: meta.type,
    slug: meta.slug,
    key: `${meta.type}/${meta.slug}`,
    title: meta.title,
    aliases: Array.isArray(meta.aliases) ? meta.aliases : [],
    triggers: Array.isArray(meta.triggers) ? meta.triggers : [],
    relations: Array.isArray(meta.relations) ? meta.relations : [],
    date: meta.date ?? null,
    sources: meta.sources && typeof meta.sources === 'object' ? meta.sources : {},
    summary: sectionMap.Summary ?? '',
    facts: readItems('Facts', meta.itemIds?.facts),
    openItems: readItems('Open Items', meta.itemIds?.openItems),
    decisions: readItems('Decisions', meta.itemIds?.decisions),
    changeLog,
    updatedAt: meta.updatedAt ?? null,
    nextId: Number.isInteger(meta.nextId) && meta.nextId > 0 ? meta.nextId : 1,
    contentHash,
    hashPrefix: hashPrefix(contentHash),
  };
}

function renderMarkdownPage(page) {
  const frontmatter = {
    version: 1,
    type: page.type,
    slug: page.slug,
    title: page.title,
    aliases: page.aliases,
    ...(Array.isArray(page.triggers) && page.triggers.length > 0 ? { triggers: page.triggers } : {}),
    relations: page.relations,
    ...(page.date ? { date: page.date } : {}),
    sources: page.sources,
    itemIds: {
      facts: page.facts.map((i) => i.id),
      openItems: page.openItems.map((i) => i.id),
      decisions: page.decisions.map((i) => i.id),
    },
    nextId: page.nextId,
    updatedAt: page.updatedAt,
  };
  const renderList = (items) => (items.length > 0 ? items.map((i) => `- ${i.text}`).join('\n') : 'None observed.');
  const changeLogText = page.changeLog.length > 0 ? page.changeLog.join('\n') : '- Initialized.';

  return [
    '---',
    JSON.stringify(frontmatter, null, 2),
    '---',
    '',
    `# ${page.title}`,
    '',
    '## Summary',
    '',
    page.summary || 'None observed.',
    '',
    '## Facts',
    '',
    renderList(page.facts),
    '',
    '## Open Items',
    '',
    renderList(page.openItems),
    '',
    '## Decisions',
    '',
    renderList(page.decisions),
    '',
    '## Change Log',
    '',
    changeLogText,
    '',
  ].join('\n');
}

function reconcileTrackedList(listKey, priorItems, operations, nextIdRef, changes, writtenRefs) {
  if (operations === undefined) return priorItems.map((i) => ({ ...i }));
  if (!Array.isArray(operations)) throw new EntityWikiValidationError('INVALID_LIST_OPS', `${listKey} 必须是操作数组`);

  const knownIds = new Set(priorItems.map((i) => i.id));
  const claimed = new Map();
  const added = [];
  const mergedTarget = new Map();

  const validateItemText = (rawText) => {
    const clean = squash(rawText);
    if (!clean) throw new EntityWikiValidationError('EMPTY_ITEM', `${listKey} 条目文本不能为空`);
    if (clean.length > MAX_ITEM_CHARS) throw new EntityWikiValidationError('ITEM_TOO_LONG', `${listKey} 单条内容超长`);
    return clean;
  };

  const claimId = (id, op) => {
    if (typeof id !== 'string' || !ITEM_ID_RE.test(id) || !knownIds.has(id) || claimed.has(id)) {
      throw new EntityWikiValidationError('UNKNOWN_OR_DUPLICATE_ITEM_ID', `${listKey} 条目 ID ${String(id)} 无效或重复`);
    }
    claimed.set(id, op);
  };

  for (const op of operations) {
    if (!op || typeof op !== 'object' || Array.isArray(op)) {
      throw new EntityWikiValidationError('INVALID_ITEM_OP', `${listKey} 存在无效操作对象`);
    }
    if (Array.isArray(op.merge)) {
      if (op.merge.length < 2) throw new EntityWikiValidationError('INVALID_MERGE', `${listKey} merge 至少需要 2 个 ID`);
      const uniq = [...new Set(op.merge)];
      if (uniq.length !== op.merge.length) throw new EntityWikiValidationError('DUPLICATE_MERGE_ID', `${listKey} merge 含重复 ID`);
      uniq.forEach((id) => claimId(id, op));
      const mergedItem = { id: `i${nextIdRef.value++}`, text: validateItemText(op.text) };
      mergedTarget.set(uniq[0], mergedItem);
      extractRefs(mergedItem.text).forEach((ref) => writtenRefs.add(ref));
      changes.push(`Merged ${uniq.join(', ')} in ${listKey} -> ${mergedItem.id}`);
    } else if (op.id === undefined) {
      const addedItem = { id: `i${nextIdRef.value++}`, text: validateItemText(op.text) };
      added.push(addedItem);
      extractRefs(addedItem.text).forEach((ref) => writtenRefs.add(ref));
    } else if (typeof op.retracted === 'string') {
      const reason = squash(op.retracted);
      if (!reason) throw new EntityWikiValidationError('MISSING_RETRACT_REASON', `${listKey} 撤回条目必须说明原因`);
      claimId(op.id, { ...op, retracted: reason });
    } else if (typeof op.text === 'string') {
      claimId(op.id, { id: op.id, text: validateItemText(op.text) });
    } else {
      throw new EntityWikiValidationError('INVALID_ITEM_OP', `${listKey} 条目 ${op.id} 缺少 text 或 retracted`);
    }
  }

  const nextItems = [];
  for (const item of priorItems) {
    const op = claimed.get(item.id);
    if (!op) nextItems.push(item);
    else if (Array.isArray(op.merge)) {
      if (mergedTarget.has(item.id)) nextItems.push(mergedTarget.get(item.id));
    } else if (typeof op.retracted === 'string') {
      changes.push(`Retracted ${item.id} from ${listKey}: ${item.text.slice(0, 80)} (${op.retracted})`);
    } else {
      if (squash(item.text) !== squash(op.text)) changes.push(`Updated ${item.id} in ${listKey}`);
      extractRefs(op.text).forEach((ref) => writtenRefs.add(ref));
      nextItems.push({ id: item.id, text: op.text });
    }
  }
  for (const item of added) {
    nextItems.push(item);
    changes.push(`Added ${item.id} to ${listKey}: ${item.text.slice(0, 90)}`);
  }
  if (nextItems.length > MAX_LIST_ITEMS) {
    throw new EntityWikiValidationError('LIST_CAPACITY_EXCEEDED', `${listKey} 最多保留 ${MAX_LIST_ITEMS} 条`);
  }
  return nextItems;
}

export class EntityWiki {
  constructor(wikiDir) {
    this.wikiDir = path.resolve(wikiDir);
  }

  #pagePath(type, slug) {
    return path.join(this.wikiDir, type === 'session' ? 'sessions' : `${type}s`, `${slug}.md`);
  }

  readPage(typeOrKey, maybeSlug) {
    const [rawType, rawSlug] = maybeSlug !== undefined ? [typeOrKey, maybeSlug] : String(typeOrKey ?? '').split('/');
    if (!rawType || !rawSlug) return null;
    const type = validateType(rawType);
    const slug = normalizeSlug(rawSlug);
    const file = this.#pagePath(type, slug);
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = parseMarkdownPage(raw);
    return parsed ? { ...parsed, filePath: file, raw } : null;
  }

  listPages({ type = null } = {}) {
    if (!fs.existsSync(this.wikiDir)) return [];
    const types = type ? [validateType(type)] : ENTITY_TYPES;
    const pages = [];
    for (const t of types) {
      const dir = path.join(this.wikiDir, t === 'session' ? 'sessions' : `${t}s`);
      if (!fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
        const parsed = parseMarkdownPage(fs.readFileSync(path.join(dir, name), 'utf8'));
        if (parsed) pages.push({ ...parsed, filePath: path.join(dir, name) });
      }
    }
    return pages.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) || a.key.localeCompare(b.key));
  }

  upsertPage(input = {}, { now = new Date(), gitCheckpoint = true } = {}) {
    const type = validateType(input.type);
    const slug = normalizeSlug(input.slug);
    const title = squash(input.title);
    if (!title || title.length > 120) {
      throw new EntityWikiValidationError('INVALID_TITLE', '实体标题不能为空且不超过 120 字符');
    }

    const prior = this.readPage(type, slug);
    if (input.expectedHash !== undefined && input.expectedHash !== null) {
      if (!prior) {
        if (String(input.expectedHash).trim().toLowerCase() !== 'new') {
          throw new EntityWikiValidationError('HASH_MISMATCH', `目标档案 ${type}/${slug} 尚不存在，expectedHash 不匹配`);
        }
      } else if (!hashMatches(prior.contentHash, input.expectedHash)) {
        throw new EntityWikiValidationError('HASH_MISMATCH', `实体档案 ${type}/${slug} 已被并发更新（当前 hash 前缀 ${prior.hashPrefix}）`);
      }
    }
    const nextIdRef = { value: prior?.nextId ?? 1 };
    const changes = [];
    const writtenRefs = new Set();

    let nextSummary = prior?.summary ?? '';
    if (prior) {
      if (input.summary === undefined || input.summary === null) {
        throw new EntityWikiValidationError('MISSING_SUMMARY_DIRECTIVE', '更新既有档案时必须提供 summary: { keep: true } 或 { text, reason }');
      }
      if (!input.summary.keep) {
        const text = squash(input.summary.text);
        const reason = squash(input.summary.reason);
        if (!text || !reason) throw new EntityWikiValidationError('SUMMARY_REWRITE_NEEDS_REASON', '改写 Summary 必须提供 text 与 reason');
        if (text.length > MAX_SUMMARY_CHARS) throw new EntityWikiValidationError('SUMMARY_TOO_LONG', 'Summary 超长');
        nextSummary = text;
        extractRefs(nextSummary).forEach((r) => writtenRefs.add(r));
        changes.push(`Updated Summary (${reason})`);
      }
    } else if (typeof input.summary === 'string' && squash(input.summary)) {
      nextSummary = squash(input.summary);
      extractRefs(nextSummary).forEach((r) => writtenRefs.add(r));
    } else if (input.summary && typeof input.summary.text === 'string' && squash(input.summary.text)) {
      nextSummary = squash(input.summary.text);
      extractRefs(nextSummary).forEach((r) => writtenRefs.add(r));
    } else {
      throw new EntityWikiValidationError('MISSING_INITIAL_SUMMARY', '新建实体档案必须提供 Summary');
    }

    const nextFacts = reconcileTrackedList('facts', prior?.facts ?? [], input.facts, nextIdRef, changes, writtenRefs);
    const nextOpenItems = reconcileTrackedList('openItems', prior?.openItems ?? [], input.openItems, nextIdRef, changes, writtenRefs);
    const nextDecisions = reconcileTrackedList('decisions', prior?.decisions ?? [], input.decisions, nextIdRef, changes, writtenRefs);

    if (prior && input.summary && !input.summary.keep) {
      const priorRefs = new Set(extractRefs(prior.summary));
      const keptRefs = new Set([
        ...extractRefs(nextSummary),
        ...nextFacts.flatMap((i) => extractRefs(i.text)),
        ...nextOpenItems.flatMap((i) => extractRefs(i.text)),
        ...nextDecisions.flatMap((i) => extractRefs(i.text)),
      ]);
      const removedRefs = new Set(Array.isArray(input.summary.removedRefs) ? input.summary.removedRefs : []);
      const lost = [...priorRefs].filter((r) => !keptRefs.has(r) && !removedRefs.has(r));
      if (lost.length > 0) {
        throw new EntityWikiValidationError('LOST_CITATIONS', `改写 Summary 丢失了既有出处引用：${lost.join(', ')}`);
      }
    }

    const mergedSources = { ...(prior?.sources ?? {}), ...normalizeSources(input.sources) };
    const missingSources = [...writtenRefs].filter((r) => !Object.hasOwn(mergedSources, r));
    if (missingSources.length > 0) {
      throw new EntityWikiValidationError('UNDECLARED_REFS', `存在未在 sources 登记的引用 ID：${missingSources.join(', ')}`);
    }

    const isoNow = (now instanceof Date ? now : new Date(now)).toISOString();
    const day = isoNow.slice(0, 10);
    const newLogs = prior
      ? (changes.length > 0 ? changes.map((c) => `- ${day}: ${c}`) : [])
      : [`- ${day}: Created ${type}/${slug} (${changes.length} tracked entries).`];

    const page = {
      type,
      slug,
      key: `${type}/${slug}`,
      title,
      aliases: normalizeAliases(input.aliases ?? prior?.aliases),
      triggers: normalizeTriggers(input.triggers ?? prior?.triggers),
      relations: normalizeRelations(input.relations ?? prior?.relations),
      date: input.date ?? prior?.date ?? null,
      sources: mergedSources,
      summary: nextSummary,
      facts: nextFacts,
      openItems: nextOpenItems,
      decisions: nextDecisions,
      changeLog: [...newLogs, ...(prior?.changeLog ?? [])].slice(0, MAX_CHANGELOG_LINES),
      nextId: nextIdRef.value,
      updatedAt: isoNow,
    };

    const filePath = this.#pagePath(type, slug);
    const rendered = renderMarkdownPage(page);
    const contentHash = computeContentHash(rendered);
    writeFileAtomic(this.wikiDir, filePath, rendered);
    const relPath = path.relative(this.wikiDir, filePath);
    const checkpoint = gitCheckpoint
      ? commitWikiCheckpoint(this.wikiDir, { message: `${!prior ? 'create' : 'update'} ${type}/${slug}`, relPaths: [relPath] })
      : { committed: false, reason: 'skipped' };
    return {
      created: !prior,
      page: { ...page, filePath, contentHash, hashPrefix: hashPrefix(contentHash) },
      checkpoint,
    };
  }

  deriveTimeline(typeOrKey, { handoffs = [], limit = 20 } = {}) {
    const page = this.readPage(typeOrKey);
    if (!page) return null;
    const entries = [];
    const seen = new Set();
    const pushItem = (date, kind, summary, sourceRef = null) => {
      const cleanDate = String(date || '').slice(0, 10);
      const cleanSummary = squash(summary).slice(0, 220);
      if (!cleanDate || !cleanSummary) return;
      const sig = `${cleanDate}|${kind}|${cleanSummary.slice(0, 80)}`;
      if (seen.has(sig)) return;
      seen.add(sig);
      entries.push({ date: cleanDate, kind, summary: cleanSummary, ...(sourceRef ? { sourceRef } : {}) });
    };
    for (const line of page.changeLog ?? []) {
      const m = /^-\s+(\d{4}-\d{2}-\d{2}):?\s+(.+)$/u.exec(line);
      if (m) pushItem(m[1], 'change', m[2], page.key);
    }
    const needles = [page.title, page.slug, ...(page.aliases ?? [])]
      .map((s) => String(s || '').trim().toLowerCase())
      .filter((s) => s.length >= 2);
    for (const other of this.listPages()) {
      if (other.key === page.key) continue;
      const linked = (other.relations ?? []).includes(page.key) || (page.relations ?? []).includes(other.key);
      const mentioned = other.type === 'session' && needles.some((n) => `${other.title}\n${other.summary}`.toLowerCase().includes(n));
      if (!linked && !mentioned) continue;
      const dt = other.date || String(other.updatedAt || '').slice(0, 10);
      pushItem(dt, other.type === 'session' ? 'session' : 'relation', `${other.title}：${other.summary.slice(0, 140)}`, other.key);
    }
    for (const h of Array.isArray(handoffs) ? handoffs : []) {
      const hay = `${h?.workspace || ''} ${h?.title || ''} ${h?.summary || ''}`.toLowerCase();
      if (!needles.some((n) => hay.includes(n))) continue;
      pushItem(String(h?.ts || '').slice(0, 10), 'handoff', `[${h.agent || 'agent'}] ${h.title || ''}${h.summary ? ` — ${h.summary}` : ''}`, h.id || null);
    }
    entries.sort((a, b) => b.date.localeCompare(a.date) || a.kind.localeCompare(b.kind));
    return { key: page.key, title: page.title, hashPrefix: page.hashPrefix, items: entries.slice(0, Math.max(1, Math.min(limit, 50))) };
  }

  history(key = null, { limit = 10 } = {}) {
    if (!fs.existsSync(path.join(this.wikiDir, '.git'))) return [];
    try {
      const max = Math.max(1, Math.min(Number(limit) || 10, 50));
      const args = ['log', `-n${max}`, '--format=%H%x09%aI%x09%s'];
      if (key) {
        const [rawType, rawSlug] = String(key).split('/');
        const rel = path.relative(this.wikiDir, this.#pagePath(validateType(rawType), normalizeSlug(rawSlug)));
        args.push('--', rel);
      }
      const out = runIsolatedGit(this.wikiDir, args);
      if (!out) return [];
      return out.split('\n').filter(Boolean).map((line) => {
        const [commit, at, subject] = line.split('\t');
        return { commit: commit.slice(0, 12), at, subject };
      });
    } catch {
      return [];
    }
  }

  archiveDormantPages({ maxIdleDays = 30, now = new Date(), keepKeys = [], gitCheckpoint = true } = {}) {
    const nowMs = now instanceof Date ? now.getTime() : Date.parse(now) || Date.now();
    const cutoffMs = nowMs - Math.max(1, Number(maxIdleDays) || 30) * 86_400_000;
    const pinned = new Set(keepKeys);
    const archived = [];
    const archiveDir = path.join(this.wikiDir, '_archive', 'sessions');
    for (const page of this.listPages({ type: 'session' })) {
      if (pinned.has(page.key)) continue;
      if (Array.isArray(page.openItems) && page.openItems.length > 0) continue;
      const activityMs = Math.max(Date.parse(page.updatedAt || '') || 0, page.date ? (Date.parse(`${page.date}T00:00:00Z`) || 0) : 0);
      if (!activityMs || activityMs > cutoffMs) continue;
      fs.mkdirSync(archiveDir, { recursive: true, mode: 0o700 });
      fs.renameSync(this.#pagePath('session', page.slug), path.join(archiveDir, `${page.slug}.md`));
      archived.push({ key: page.key, slug: page.slug, title: page.title });
    }
    if (archived.length > 0 && gitCheckpoint) {
      commitWikiCheckpoint(this.wikiDir, { message: `archive ${archived.length} dormant session page(s)` });
    }
    return { archivedCount: archived.length, archived };
  }

  restoreArchivedPage(slug, { gitCheckpoint = true } = {}) {
    const cleanSlug = normalizeSlug(slug);
    const archivedPath = path.join(this.wikiDir, '_archive', 'sessions', `${cleanSlug}.md`);
    if (!fs.existsSync(archivedPath)) return { ok: false, error: '未找到可恢复的归档会话档案' };
    const targetPath = this.#pagePath('session', cleanSlug);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true, mode: 0o700 });
    fs.renameSync(archivedPath, targetPath);
    if (gitCheckpoint) commitWikiCheckpoint(this.wikiDir, { message: `restore session/${cleanSlug}` });
    return { ok: true, page: this.readPage('session', cleanSlug) };
  }

  searchPages({ query, alternates = [], limit = 8, type = null } = {}) {
    const pages = this.listPages({ type });
    if (pages.length === 0) return [];
    const docs = pages.map((page) => ({
      id: page.key,
      title: [page.title, ...page.aliases].join(' '),
      text: [page.summary, ...page.facts.map((i) => i.text), ...page.openItems.map((i) => i.text), ...page.decisions.map((i) => i.text)].join('\n'),
      timestampMs: Date.parse(page.updatedAt || '') || 0,
      value: page,
    }));
    const { matches } = rankHybridLexical(docs, { query, alternates, limit });
    return matches.map((hit) => ({
      key: hit.value.key,
      type: hit.value.type,
      slug: hit.value.slug,
      title: hit.value.title,
      date: hit.value.date,
      updatedAt: hit.value.updatedAt,
      summary: hit.value.summary,
      openItems: hit.value.openItems.slice(0, 4).map((i) => i.text),
      facts: hit.value.facts.slice(0, 4).map((i) => i.text),
      decisions: hit.value.decisions.slice(0, 3).map((i) => i.text),
      score: Number(hit.rrfScore.toFixed(6)),
    }));
  }
}
