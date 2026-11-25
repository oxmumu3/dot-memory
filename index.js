/**
 * @oxmumu3/dot-memory — Host Cordis entry for DeepSeek Harness.
 * Wires unified local storage, KV-cache-safe user-turn injection,
 * turn-stopping handoff capture, 5 model tools, authenticated routes,
 * and a versioned `dotMemory` host service seam.
 */

import { DotMemoryStore } from './src/core/index.mjs';
import { registerTurnCapture } from './src/dsh/capture.mjs';
import { registerMemoryPreStep } from './src/dsh/injection.mjs';
import { registerDotMemoryPrompt } from './src/dsh/prompt.mjs';
import { registerDotMemoryRoutes } from './src/dsh/routes.mjs';
import { installDotMemoryTools } from './src/dsh/tools.mjs';

export const name = 'dot-memory';
export const inject = [];

const MOUNTED_CTX = new WeakSet();

export function apply(ctx, config = {}) {
  if (ctx && typeof ctx === 'object') {
    if (MOUNTED_CTX.has(ctx)) return () => {};
    MOUNTED_CTX.add(ctx);
  }

  const log = (message) => {
    try { ctx?.logger?.info?.(`[dot-memory] ${message}`); } catch {}
  };

  const store = new DotMemoryStore({ homeDir: config?.homeDir }).ensureInitialized();
  log(`loaded; home=${store.homeDir}`);

  // Publish versioned capability seam for peer plugins (e.g. DSH.dot)
  const service = Object.freeze({
    version: '0.1.0',
    features: Object.freeze(['living-memory', 'entity-wiki', 'handoff-bus', 'hybrid-search', 'flashback']),
    store,
  });
  try {
    if (typeof ctx?.provide === 'function') ctx.provide('dotMemory', service);
    else if (typeof ctx?.set === 'function') ctx.set('dotMemory', service);
  } catch {}

  const disposePrompt = registerDotMemoryPrompt(ctx, log);
  const disposeTools = installDotMemoryTools(ctx, { store }, log);
  const disposePreStep = registerMemoryPreStep(ctx, store, log);
  const disposeCapture = registerTurnCapture(ctx, store, log);

  let disposeRoutes;
  try {
    ctx.inject(['connection'], (scope) => {
      try {
        const off = registerDotMemoryRoutes(scope, { store });
        if (typeof off === 'function') {
          disposeRoutes = off;
          log('routes registered: /api/dot_memory/view, /api/dot_memory/action');
          return () => {
            try { off(); } catch {}
            if (disposeRoutes === off) disposeRoutes = undefined;
          };
        }
        return undefined;
      } catch (err) {
        log(`route registration failed: ${err?.message || err}`);
        return undefined;
      }
    });
  } catch (err) {
    log(`connection inject unavailable: ${err?.message || err}`);
  }

  const dispose = () => {
    try { disposeRoutes?.(); } catch {}
    try { disposeCapture?.(); } catch {}
    try { disposePreStep?.(); } catch {}
    try { disposeTools?.(); } catch {}
    try { disposePrompt?.(); } catch {}
    if (ctx && typeof ctx === 'object') MOUNTED_CTX.delete(ctx);
  };

  if (typeof ctx?.effect === 'function') {
    ctx.effect(() => dispose);
  }
  return dispose;
}
