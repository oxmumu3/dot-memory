/**
 * Cross-Agent Handoff Bus (`handoffs/YYYY-MM-DD.jsonl`).
 * Records significant turn completions, blocks, and errors from Antigravity,
 * Claude Code, Codex, and DeepSeek Harness while filtering short trivial Q&A.
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ensurePrivateDir, isGoogleProtected, isoDate, readSafeText, storageError } from './storage.mjs';

const VALID_AGENTS = new Set([
  'dsh',
  'antigravity',
  'claude-code',
  'codex',
  'hermes',
  'workbuddy',
  'cursor',
  'custom',
]);
const VALID_STATUSES = new Set(['done', 'blocked', 'error', 'waiting']);

const squash = (s, max = 400) => String(s ?? '').replace(/\s+/gu, ' ').trim().slice(0, max);

export function isSignificantTurn({
  status = 'done',
  durationSec = 0,
  toolCalls = 0,
  mutatedFiles = 0,
  explicit = false,
} = {}) {
  if (explicit) return true;
  if (status === 'error' || status === 'blocked' || status === 'waiting') return true;
  if (Number(durationSec) >= 30) return true;
  if (Number(mutatedFiles) >= 1 && Number(toolCalls) >= 2) return true;
  if (Number(toolCalls) >= 4) return true;
  return false;
}

export function normalizeHandoff(input = {}, { now = new Date() } = {}) {
  if (isGoogleProtected(input)) {
    throw storageError('HANDOFF_PRIVACY_BLOCKED', '受保护的 Google 隔离会话禁止写入本地交接流');
  }
  const ts = isoDate(input.ts ?? now, new Date().toISOString());
  const rawAgent = String(input.agent || 'custom').trim().toLowerCase();
  const agent = VALID_AGENTS.has(rawAgent) ? rawAgent : 'custom';
  const rawStatus = String(input.status || 'done').trim().toLowerCase();
  const status = VALID_STATUSES.has(rawStatus) ? rawStatus : 'done';
  const workspacePath = typeof input.workspacePath === 'string' ? input.workspacePath.trim() : '';
  const workspace = squash(
    input.workspace || (workspacePath ? path.basename(workspacePath) : '') || 'default',
    80,
  );
  const title = squash(input.title || input.prompt || input.summary || `${agent} ${status}`, 160);
  const summary = squash(input.summary || input.title || '', 500);
  if (!summary) {
    throw storageError('HANDOFF_INVALID', '交接记录缺少 summary 摘要');
  }
  const artifacts = Array.isArray(input.artifacts)
    ? [...new Set(input.artifacts.map((a) => squash(a, 240)).filter(Boolean))].slice(0, 16)
    : [];
  const nextSteps = Array.isArray(input.nextSteps)
    ? [...new Set(input.nextSteps.map((s) => squash(s, 220)).filter(Boolean))].slice(0, 10)
    : [];

  const sessionId = squash(input.sessionId || input.conversationId || 'unknown', 120);
  const dedupKey = squash(input.dedupKey || `${agent}:${sessionId}:${ts.slice(0, 16)}:${title.slice(0, 48)}`, 200);

  return {
    id: squash(input.id || `hoff-${randomUUID().slice(0, 12)}`, 72),
    dedupKey,
    ts,
    agent,
    sessionId,
    workspace,
    workspacePath,
    status,
    title,
    summary,
    artifacts,
    nextSteps,
    durationSec: Math.max(0, Number(input.durationSec) || 0),
    toolCalls: Math.max(0, Number(input.toolCalls) || 0),
    mutatedFiles: Math.max(0, Number(input.mutatedFiles) || 0),
    sourceRef: squash(input.sourceRef || `${agent}:${sessionId}`, 180),
  };
}

/**
 * Extracts a normalized handoff from Stop-hook JSON payloads across Antigravity,
 * Claude Code, and Codex (gracefully falling back across field names).
 */
export function extractHandoffFromStopPayload(agent, payload = {}, { now = new Date() } = {}) {
  if (!payload || typeof payload !== 'object') return { skipped: true, reason: 'empty_payload' };
  if (payload.fullyIdle === false) return { skipped: true, reason: 'not_idle' };
  if (payload.terminationReason === 'USER_CANCELED' || payload.stop_reason === 'user_canceled') {
    return { skipped: true, reason: 'user_canceled' };
  }
  if (isGoogleProtected(payload)) return { skipped: true, reason: 'privacy_blocked' };

  const workspacePath = String(
    payload.cwd || payload.workspacePath ||
    (Array.isArray(payload.workspacePaths) ? payload.workspacePaths[0] : '') ||
    (Array.isArray(payload.workspace_roots) ? payload.workspace_roots[0] : '') ||
    '',
  ).trim();
  const workspace = squash(payload.workspace || (workspacePath ? path.basename(workspacePath) : '') || payload.platform || agent, 80);
  const sessionId = squash(
    payload.conversationId || payload.sessionId || payload.session_id || payload.thread_id || payload.session_key || payload.chat_id || 'unknown',
    120,
  );
  const isError = payload.terminationReason === 'ERROR' || payload.status === 'error' || Boolean(payload.error);
  const isBlocked = payload.status === 'blocked' || payload.status === 'waiting' || payload.needsUserInput === true;
  const status = isError ? 'error' : (isBlocked ? 'blocked' : 'done');

  let durationSec = Number(payload.turnDurationSec ?? payload.durationSec ?? 0) || 0;
  let toolCalls = Number(payload.toolCallCount ?? payload.toolCalls ?? 0) || 0;
  let mutatedFiles = Number(payload.mutatedCount ?? payload.mutatedFiles ?? 0) || 0;
  const rawHermesReply = agent === 'hermes'
    ? String(payload.response || payload.lastReply || payload.summary || '').trim()
    : '';
  const explicit = Boolean(
    payload.explicit ||
    payload.forceHandoff ||
    (agent === 'hermes' && payload.explicit !== false && Buffer.byteLength(rawHermesReply, 'utf8') >= 160),
  );

  let transcriptPrompt = '';
  let transcriptReply = '';
  const transcriptPath = payload.transcriptPath || payload.transcript_path;
  if (typeof transcriptPath === 'string' && transcriptPath) {
    try {
      if (fs.existsSync(transcriptPath)) {
        const stat = fs.statSync(transcriptPath);
        const start = Math.max(0, stat.size - 65536);
        const fd = fs.openSync(transcriptPath, 'r');
        let lastUserTs = 0;
        let lastStepTs = 0;
        try {
          const buf = Buffer.alloc(stat.size - start);
          fs.readSync(fd, buf, 0, buf.length, start);
          const lines = buf.toString('utf8').split('\n').filter((l) => l.trim());
          for (const line of lines) {
            try {
              const row = JSON.parse(line);
              const tsMs = Date.parse(row?.created_at || row?.timestamp || '');
              if (Number.isFinite(tsMs)) lastStepTs = Math.max(lastStepTs, tsMs);
              const rType = String(row?.type || '').toUpperCase();
              if (rType === 'USER_INPUT' || row?.role === 'user') {
                const t = row.text || row.content || '';
                if (typeof t === 'string' && t.trim()) transcriptPrompt = t.trim();
                if (Number.isFinite(tsMs)) {
                  lastUserTs = tsMs;
                  toolCalls = 0;
                  mutatedFiles = 0;
                }
              } else if (rType === 'PLANNER_RESPONSE' || row?.role === 'assistant' || row?.role === 'model') {
                const t = row.response || row.text || row.content || '';
                if (typeof t === 'string' && t.trim()) transcriptReply = t.trim();
                const calls = Array.isArray(row.tool_calls) ? row.tool_calls : (Array.isArray(row.toolCalls) ? row.toolCalls : []);
                if (calls.length > 0) {
                  toolCalls += calls.length;
                  for (const c of calls) {
                    const cname = String(c?.name || c?.toolName || c?.function?.name || '');
                    if (/write|edit|replace|run_command|bash/i.test(cname)) mutatedFiles += 1;
                  }
                }
              } else if (rType === 'TOOL_CALL' || row?.toolName) {
                toolCalls += 1;
                if (/write|edit|replace|run_command|bash/i.test(String(row.toolName || row.name || ''))) mutatedFiles += 1;
              }
            } catch {}
          }
          if (durationSec === 0 && lastUserTs > 0 && lastStepTs > lastUserTs) {
            durationSec = Math.round((lastStepTs - lastUserTs) / 1000);
          }
        } finally {
          fs.closeSync(fd);
        }
      }
    } catch {}
  }

  if (!isSignificantTurn({ status, durationSec, toolCalls, mutatedFiles, explicit })) {
    return { skipped: true, reason: 'below_significance_threshold' };
  }

  const rawPrompt = squash(
    payload.lastUserInput || payload.prompt || payload.topicPrompt || payload.user_message || payload.message || transcriptPrompt,
    160,
  );
  const rawReply = squash(
    payload.lastReply || payload.summary || payload.last_assistant_message || payload.response || payload.assistant_message || payload.error || transcriptReply,
    460,
  );
  const title = squash(payload.title || rawPrompt || `${workspace} ${status}`, 140);
  const summary = rawReply || `${title}（${status}）`;

  const stepTag = payload.stepKey || payload.executionNum || payload.turnId || tsMinuteKey(now);
  const dedupKey = `${agent}:${sessionId}:${stepTag}`;

  return {
    skipped: false,
    handoff: normalizeHandoff({
      agent,
      sessionId,
      workspace,
      workspacePath,
      status,
      title,
      summary,
      artifacts: Array.isArray(payload.artifacts) ? payload.artifacts : [],
      nextSteps: Array.isArray(payload.nextSteps) ? payload.nextSteps : [],
      durationSec,
      toolCalls,
      mutatedFiles,
      dedupKey,
      sourceRef: payload.transcriptPath ? `${agent}:${path.basename(String(payload.transcriptPath))}` : `${agent}:${sessionId}`,
    }, { now }),
  };
}

function tsMinuteKey(now) {
  return (now instanceof Date ? now : new Date(now)).toISOString().slice(0, 16);
}

export class HandoffBus {
  constructor(rootDir) {
    this.rootDir = path.resolve(rootDir);
    this.handoffsDir = path.join(this.rootDir, 'handoffs');
  }

  #fileForDay(dayKey) {
    return path.join(this.handoffsDir, `${dayKey}.jsonl`);
  }

  list({ limit = 50, agent = null, workspace = null, status = null, sinceDays = 14 } = {}) {
    if (!fs.existsSync(this.handoffsDir)) return [];
    const cutoffMs = Date.now() - Math.max(1, Number(sinceDays) || 14) * 86_400_000;
    const files = fs.readdirSync(this.handoffsDir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/u.test(f))
      .sort()
      .reverse();

    const rows = [];
    for (const f of files) {
      const dayMs = Date.parse(`${f.slice(0, 10)}T23:59:59Z`);
      if (Number.isFinite(dayMs) && dayMs < cutoffMs) break;
      const content = readSafeText(this.rootDir, path.join(this.handoffsDir, f));
      if (!content) continue;
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        try {
          const item = JSON.parse(line);
          if (!item || isGoogleProtected(item)) continue;
          if (agent && item.agent !== agent) continue;
          if (workspace && String(item.workspace || '').toLowerCase() !== String(workspace).toLowerCase()) continue;
          if (status && item.status !== status) continue;
          rows.push(item);
        } catch {
          // Ignore malformed line safely
        }
      }
    }
    rows.sort((a, b) => Date.parse(b.ts || 0) - Date.parse(a.ts || 0));
    return rows.slice(0, Math.max(1, Math.min(Number(limit) || 50, 200)));
  }

  append(input, { now = new Date() } = {}) {
    const entry = normalizeHandoff(input, { now });
    ensurePrivateDir(this.rootDir);
    ensurePrivateDir(this.handoffsDir);
    const recent = this.list({ limit: 80, sinceDays: 3 });
    const existing = recent.find((r) => r.dedupKey === entry.dedupKey);
    if (existing) return { appended: false, duplicate: true, handoff: existing };

    const dayKey = entry.ts.slice(0, 10);
    const file = this.#fileForDay(dayKey);
    fs.appendFileSync(file, JSON.stringify(entry) + '\n', { encoding: 'utf8', mode: 0o600 });
    return { appended: true, duplicate: false, handoff: entry };
  }
}
