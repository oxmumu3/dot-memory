/**
 * KV-cache-safe memory context injection on `agent/pre-step`.
 * - Strictly awaits `next()` first and appends to `decision.messages` (never replaces).
 * - Never injects into `dot-butler-*` or Google-protected sessions.
 * - Injects `<dot_memory_context>` as a user-turn message ONLY when:
 *   1) first injection for this session, OR
 *   2) living-memory hash changed since last injection in this session, OR
 *   3) session history shrank (compaction summary occurred).
 */

import { randomUUID } from 'node:crypto';
import { isGoogleProtected } from '../core/index.mjs';

const INJECT_KIND = 'dot-memory';

export function isExcludedSession(session) {
  if (!session || typeof session !== 'object') return true;
  const id = String(session.id || session.header?.id || '');
  if (id.startsWith('dot-butler-')) return true;
  if (isGoogleProtected(session) || isGoogleProtected(session.header)) return true;
  return false;
}

export function createMemoryMessage(text) {
  return Object.freeze({
    role: 'user',
    content: Object.freeze([Object.freeze({ type: 'text', text })]),
    source: Object.freeze({
      kind: INJECT_KIND,
      speaker: Object.freeze({ role: 'none' }),
    }),
    id: randomUUID(),
  });
}

export function registerMemoryPreStep(ctx, store, log = () => {}) {
  const sessionState = new WeakMap();

  const off = ctx?.on?.('agent/pre-step', async (step, next) => {
    const decision = await next();
    if (!decision || decision.kind === 'reject' || step?.signal?.aborted || !Array.isArray(decision.messages)) {
      return decision;
    }

    const session = step?.agent?.session;
    if (isExcludedSession(session)) return decision;

    try {
      const currentHash = store.livingMemoryHash();
      const msgCount = decision.messages.length;
      const prev = sessionState.get(session);
      const compacted = Boolean(prev && msgCount < prev.msgCount);
      const changed = !prev || prev.hash !== currentHash || compacted;
      if (!changed) {
        sessionState.set(session, { hash: currentHash, msgCount });
        return decision;
      }

      const envelope = store.buildFirstTurnEnvelope();
      if (!envelope) {
        sessionState.set(session, { hash: currentHash, msgCount });
        return decision;
      }

      const injected = createMemoryMessage(envelope);
      sessionState.set(session, { hash: currentHash, msgCount: msgCount + 1 });
      return { ...decision, messages: [...decision.messages, injected] };
    } catch (err) {
      log(`pre-step injection skipped: ${err?.message || err}`);
      return decision;
    }
  }, { prepend: true });

  return () => {
    try { typeof off === 'function' && off(); } catch {}
  };
}
