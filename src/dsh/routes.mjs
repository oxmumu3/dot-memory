/**
 * Authenticated Host HTTP routes for @oxmumu3/dot-memory.
 * Registered via `connection.fetch.register` under `/api/dot_memory/*`:
 *   - GET  /api/dot_memory/view
 *   - POST /api/dot_memory/action
 * Enforces cross-site write checks, JSON Content-Type, and 256KB body caps.
 */

import { buildIntegrationSnippets } from '../../bin/dot-memory.mjs';
import {
  connectAgent,
  connectAllInstalled,
  detectAgentConnections,
  disconnectAgent,
} from '../core/index.mjs';

const MAX_BODY_BYTES = 256 * 1024;
const BASE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

const jsonReply = (payload, status = 200) => Response.json(payload, { status, headers: BASE_HEADERS });

export function isCrossSiteWrite(request) {
  const fetchSite = request.headers?.get?.('sec-fetch-site') || '';
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return true;
  const origin = request.headers?.get?.('origin') || '';
  if (origin) {
    try {
      const u = new URL(origin);
      if (!['127.0.0.1', 'localhost', '::1'].includes(u.hostname) && !['dsh-app:', 'app:', 'file:'].includes(u.protocol)) {
        return true;
      }
    } catch {
      return true;
    }
  }
  return false;
}

async function readJsonBody(request) {
  const ct = request.headers?.get?.('content-type') || '';
  if (!ct.toLowerCase().includes('application/json')) {
    return { errorStatus: 415, error: 'Content-Type must be application/json' };
  }
  const lenHeader = Number(request.headers?.get?.('content-length') || '0');
  if (Number.isFinite(lenHeader) && lenHeader > MAX_BODY_BYTES) {
    return { errorStatus: 413, error: 'Payload exceeds 256KB limit' };
  }
  const text = await request.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
    return { errorStatus: 413, error: 'Payload exceeds 256KB limit' };
  }
  try {
    const body = text ? JSON.parse(text) : {};
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { errorStatus: 400, error: 'JSON body must be an object' };
    }
    return { body };
  } catch {
    return { errorStatus: 400, error: 'Invalid JSON body' };
  }
}

export async function handleViewRequest({ store, homeDir } = {}) {
  return jsonReply({
    ok: true,
    snapshot: store.getSnapshot(),
    integrations: buildIntegrationSnippets(),
    connections: detectAgentConnections({ homeDir, dotMemoryHome: store.homeDir }),
  });
}

export async function handleActionRequest({ request, store, homeDir } = {}) {
  if (isCrossSiteWrite(request)) {
    return jsonReply({ ok: false, error: 'Cross-site write rejected' }, 403);
  }
  const parsed = await readJsonBody(request);
  if (parsed.errorStatus) return jsonReply({ ok: false, error: parsed.error }, parsed.errorStatus);

  const body = parsed.body;
  const action = String(body.action || '').trim();
  if (!action) return jsonReply({ ok: false, error: 'Missing action field' }, 400);

  try {
    if (action === 'add_memory') {
      const res = store.addMemory({
        bucket: body.bucket || 'style',
        topic: body.topic,
        text: body.text,
        sourceKind: 'manual',
        provenance: body.provenance || '面板手动添加',
        quote: body.quote || body.text,
        quoteSource: 'manual',
      });
      return jsonReply({ ok: true, action, item: res.item, snapshot: store.getSnapshot() });
    }
    if (action === 'toggle_memory') {
      const res = store.toggleMemoryActive(body.id);
      return jsonReply({ ok: true, action, item: res.item, snapshot: store.getSnapshot() });
    }
    if (action === 'remove_memory') {
      store.removeMemory(body.id);
      return jsonReply({ ok: true, action, snapshot: store.getSnapshot() });
    }
    if (action === 'review_candidate') {
      const res = store.reviewCandidate(body.id, body.decision === 'reject' ? 'reject' : 'approve');
      return jsonReply({ ok: true, action, item: res.item, snapshot: store.getSnapshot() });
    }
    if (action === 'record_handoff') {
      const res = store.recordHandoff(body.payload || body);
      const wiki = store.syncWiki();
      return jsonReply({ ok: true, action, ...res, wiki, snapshot: store.getSnapshot() });
    }
    if (action === 'sync_wiki') {
      const wiki = store.syncWiki();
      return jsonReply({ ok: true, action, wiki, snapshot: store.getSnapshot() });
    }
    if (action === 'run_dream') {
      const dream = store.dream({ force: true });
      return jsonReply({ ok: true, action, ran: dream.ran, metabolized: dream.metabolized, snapshot: store.getSnapshot() });
    }
    if (action === 'search') {
      const result = store.search({ query: body.query, alternates: body.alternates, limit: body.limit || 12 });
      return jsonReply({ ok: true, action, result });
    }
    if (action === 'refresh_connections') {
      const connections = detectAgentConnections({ homeDir, dotMemoryHome: store.homeDir });
      return jsonReply({ ok: true, action, connections });
    }
    if (action === 'connect_agent') {
      const result = connectAgent({ agent: body.agent, homeDir, dotMemoryHome: store.homeDir });
      return jsonReply({ ok: true, action, result, connections: result.connections, snapshot: store.getSnapshot() });
    }
    if (action === 'connect_all_installed') {
      const result = connectAllInstalled({ homeDir, dotMemoryHome: store.homeDir });
      return jsonReply({ ok: true, action, result, connections: result.connections, snapshot: store.getSnapshot() });
    }
    if (action === 'disconnect_agent') {
      const result = disconnectAgent({ agent: body.agent, homeDir, dotMemoryHome: store.homeDir });
      return jsonReply({ ok: true, action, result, connections: result.connections, snapshot: store.getSnapshot() });
    }
    return jsonReply({ ok: false, error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    return jsonReply({ ok: false, error: err?.message || String(err) }, 400);
  }
}

export function registerDotMemoryRoutes(scope, { store }) {
  const conn = scope?.connection ?? scope?.get?.('connection', false) ?? null;
  if (!conn?.fetch?.register) return undefined;

  const offView = conn.fetch.register({
    path: '/api/dot_memory/view',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: () => handleViewRequest({ store }),
  });

  const offAction = conn.fetch.register({
    path: '/api/dot_memory/action',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: (request) => handleActionRequest({ request, store }),
  });

  return () => {
    try { offView?.(); } catch {}
    try { offAction?.(); } catch {}
  };
}
