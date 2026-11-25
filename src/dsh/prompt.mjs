/**
 * Static byte-budgeted systemPrompt guidance for @oxmumu3/dot-memory.
 * Never injects dynamic memory text into systemPrompt so prompt KV Cache stays intact.
 */

export const DOT_MEMORY_PROMPT_MAX_BYTES = 600;

export const DOT_MEMORY_SYSTEM_PROMPT = [
  '[Dot 记忆总线 | 跨工具共享记忆]',
  '1. 当用户问及过往偏好、其他工具（Antigravity/Claude Code/Codex）里的进展、或项目历史决定时，优先调用 dot_memory_search / dot_memory_wiki_read / dot_memory_handoffs 查证。',
  '2. 仅当用户明确纠正偏好、反复强调规范或要求记住时，调用 dot_memory_propose 提交候选（必须附用户原话 quote），切勿静默臆测。',
  '3. 日历、邮件、实时余额等易变事实仍须调用对应实时工具，不以静态记忆替代。',
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
