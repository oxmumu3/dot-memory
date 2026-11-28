/**
 * Static byte-budgeted systemPrompt guidance for @oxmumu3/dot-memory.
 * Never injects dynamic memory text into systemPrompt so prompt KV Cache stays intact.
 */

export const DOT_MEMORY_PROMPT_MAX_BYTES = 600;

export const DOT_MEMORY_SYSTEM_PROMPT = [
  '[Dot 记忆总线 | 跨工具共享记忆]',
  '1. 查跨工具历史决定、偏好或进展，先调 dot_memory_search / wiki_read / handoffs。',
  '2. 用户明确纠正偏好或规范时才调 dot_memory_propose（须带原话 quote），禁臆测。',
  '3. 用户要求检测或接入本机其他 Agent 时，先调 dot_memory_manage_connections(status) 列清单，确认后再 connect。',
  '4. 日历、邮件等易变实时信息仍调对应实时工具。',
].join('\n');

export function registerDotMemoryPrompt(ctx, log = () => {}) {
  let disposePrompt;
  const unregister = () => {
    try { disposePrompt?.(); } catch {}
    disposePrompt = undefined;
  };

  try {
    ctx.inject(['systemPrompt'], (scope) => {
      try {
        const sp = scope?.systemPrompt ?? scope?.get?.('systemPrompt', false) ?? null;
        if (!sp || typeof sp.section !== 'function') return undefined;
        if (disposePrompt) return undefined;
        disposePrompt = sp.section({
          name: 'dot-memory:protocol',
          order: 5220,
          text: ({ scope: turnScope } = {}) => {
            const tools = ctx?.get?.('tools', false);
            if (tools && typeof tools.get === 'function' && turnScope) {
              if (!tools.get('dot_memory_search', turnScope)) return '';
            }
            return DOT_MEMORY_SYSTEM_PROMPT;
          },
        });
        log('systemPrompt section registered');
        return unregister;
      } catch (err) {
        log(`systemPrompt error: ${err?.message || err}`);
        return undefined;
      }
    });
  } catch (err) {
    log(`systemPrompt inject unavailable: ${err?.message || err}`);
  }

  return unregister;
}
