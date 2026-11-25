/**
 * Captures significant DSH main-session turns on `agent/turn-stopping`
 * into the cross-agent Handoff Bus and triggers throttled Wiki sync.
 */

import path from 'node:path';
import { isSignificantTurn } from '../core/index.mjs';
import { isExcludedSession } from './injection.mjs';

function extractTextFromContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((b) => (b?.type === 'text' && typeof b.text === 'string' ? b.text : ''))
    .join('\n')
    .trim();
}

function summarizeSessionTurn(session, turn) {
  const events = typeof session?.events === 'function'
    ? session.events()
    : (Array.isArray(session?.log) ? session.log : []);

  let lastUser = '';
  let lastAssistant = '';
  let toolCalls = 0;

  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i];
    if (!ev) continue;
    const type = ev.type || '';
    if (!lastAssistant && (type === 'assistant/message' || type === 'assistant/text')) {
      lastAssistant = extractTextFromContent(ev.data?.content ?? ev.data);
    }
    if (type === 'tool/call') toolCalls += 1;
    if (!lastUser && type === 'user/message' && ev.data?.source?.kind !== 'dot-memory' && ev.data?.source?.kind !== 'engramory') {
      lastUser = extractTextFromContent(ev.data?.content ?? ev.data);
      break;
    }
  }

  return {
    title: lastUser.slice(0, 120) || `DSH turn ${turn ?? ''}`.trim(),
    summary: lastAssistant.slice(0, 420) || lastUser.slice(0, 220),
    toolCalls,
  };
}

export function registerTurnCapture(ctx, store, log = () => {}) {
  let lastSyncMs = 0;

  const off = ctx?.on?.('agent/turn-stopping', async (payload) => {
    try {
      const session = payload?.agent?.session;
      if (isExcludedSession(session)) return;
      if (session?.header?.parentSession != null) return; // Skip subagents

      const cwd = String(session?.header?.cwd || '').trim();
      const workspace = cwd ? path.basename(cwd) : 'dsh';
      const { title, summary, toolCalls } = summarizeSessionTurn(session, payload?.turn);
      if (!summary) return;
      if (!isSignificantTurn({ status: 'done', toolCalls, durationSec: toolCalls >= 3 ? 35 : 0 })) return;

      const res = store.recordHandoff({
        agent: 'dsh',
        sessionId: String(session?.id || 'dsh-session'),
        workspace,
        workspacePath: cwd,
        status: 'done',
        title,
        summary,
        toolCalls,
        dedupKey: `dsh:${session?.id || 's'}:turn-${payload?.turn ?? 0}`,
      });

      if (res.appended && Date.now() - lastSyncMs > 15_000) {
        lastSyncMs = Date.now();
        store.syncWiki();
      }
    } catch (err) {
      log(`turn capture skipped: ${err?.message || err}`);
    }
  });

  return () => {
    try { typeof off === 'function' && off(); } catch {}
  };
}
