/**
 * Model-facing tools registered on `ctx.tools` for @oxmumu3/dot-memory.
 * Optional properties omit `required` (never `required: false`).
 * Tool outputs are bounded with explicit truncation hints.
 */

import {
  connectAgent,
  connectAllInstalled,
  detectAgentConnections,
  disconnectAgent,
} from '../core/index.mjs';

const textOut = (value) => [{ type: 'text', text: String(value ?? '') }];
const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const num = (description, extra = {}) => ({ type: 'number', description, ...extra });

const MAX_OUTPUT_CHARS = 3500;
function capText(text, hint = '') {
  const s = String(text ?? '');
  if (s.length <= MAX_OUTPUT_CHARS) return s;
  return `${s.slice(0, MAX_OUTPUT_CHARS)}\n\n[已截断，超出 ${MAX_OUTPUT_CHARS} 字符${hint ? `；${hint}` : ''}]`;
}

export function createDotMemoryTools({ store }) {
  return [
    {
      name: 'dot_memory_search',
      description: '零向量混合检索本机活体记忆、实体档案 Wiki 与跨 Agent（Antigravity/Claude Code/Codex/DSH）交接流。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['query'],
        properties: {
          query: str('主检索词'),
          alternates: { type: 'array', items: { type: 'string' }, description: '最多 6 个同义词或英文别名' },
          limit: num('返回条数上限（默认 8）'),
        },
      },
      output: { schema: { type: 'string' }, render: (_a, v) => textOut(v) },
      execute: async (args = {}) => {
        const res = store.search({
          query: args.query,
          alternates: args.alternates,
          limit: Math.min(Math.max(Number(args.limit) || 8, 1), 20),
        });
        if (res.hits.length === 0) return `未在 Dot 记忆总线中找到与「${args.query}」相关的记录。`;
        return capText(
          res.hits.map((h, i) => `${i + 1}. [${h.kind}] ${h.title} (${h.score})\n   ${h.summary || ''}`).join('\n'),
          '可用 dot_memory_wiki_read 读取指定实体页原文',
        );
      },
    },
    {
      name: 'dot_memory_wiki_read',
      description: '列出全部实体档案 Wiki，或按 key（如 project/dot-memory、topic/active-focus）读取完整档案。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          key: str('实体页 key；留空则列出全部实体档案目录'),
          type: str('列出目录时按类型过滤：project | topic | session | contact | client'),
        },
      },
      output: { schema: { type: 'string' }, render: (_a, v) => textOut(v) },
      execute: async (args = {}) => {
        if (!args.key) {
          const pages = store.wiki.listPages({ type: args.type || null });
          if (pages.length === 0) return '当前尚无实体档案页。';
          return capText(pages.map((p) => `- ${p.key} · ${p.title}（事实 ${p.facts.length} · 待决 ${p.openItems.length}）`).join('\n'));
        }
        const page = store.wiki.readPage(args.key);
        return page ? capText(page.raw, '档案过长已截断') : `未找到实体档案：${args.key}`;
      },
    },
    {
      name: 'dot_memory_propose',
      description: '提交一条记忆候选供用户审核入库。必须携带用户在原始来源中的原话 quote 进行防编造核验。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['bucket', 'text', 'quote', 'quoteSource'],
        properties: {
          bucket: str('记忆分栏：rules | style | focus'),
          text: str('提炼后的记忆正文（<= 260 字）'),
          topic: str('可选主题标识（用于 focus 同主题代谢覆盖）'),
          quote: str('支撑该记忆的原始逐字原话'),
          quoteSource: str('来源标识（如当前会话 ID 或文件路径）'),
          sourceText: str('包含 quote 的原始上下文片段（用于确定性子串核验）'),
        },
      },
      output: { schema: { type: 'string' }, render: (_a, v) => textOut(v) },
      execute: async (args = {}) => {
        const res = store.proposeMemory({
          bucket: args.bucket,
          text: args.text,
          topic: args.topic,
          quote: args.quote,
          quoteSource: args.quoteSource,
          sourceText: args.sourceText || args.quote,
          sourceKind: 'chat',
          provenance: 'DSH 会话提案',
        });
        if (!res.candidate) {
          return `候选未通过：${res.rejectedReason || (res.duplicate ? '与已有记忆重复' : '校验未通过')}。请确保 quote 为用户真实原话。`;
        }
        return `已提交待审候选 ${res.candidate.id}（分栏 ${res.candidate.bucket}，原话校验通过），用户可在左侧「Dot 记忆总线」面板采纳。`;
      },
    },
    {
      name: 'dot_memory_handoffs',
      description: '查看 Antigravity、Claude Code、Codex、Hermes、WorkBuddy、Cursor 与 DSH 最近的跨端交接动态与卡点。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          agent: str('过滤来源：antigravity | claude-code | codex | hermes | workbuddy | cursor | dsh'),
          workspace: str('过滤工作区名称'),
          status: str('过滤状态：done | blocked | error | waiting'),
          limit: num('返回条数（默认 10）'),
        },
      },
      output: { schema: { type: 'string' }, render: (_a, v) => textOut(v) },
      execute: async (args = {}) => {
        const rows = store.listHandoffs({
          agent: args.agent || null,
          workspace: args.workspace || null,
          status: args.status || null,
          limit: Math.min(Math.max(Number(args.limit) || 10, 1), 30),
        });
        if (rows.length === 0) return '暂无跨端交接记录。';
        return capText(rows.map((h) => `- [${h.ts.slice(0, 16)}] [${h.agent}/${h.status}] ${h.workspace} :: ${h.title}\n  ${h.summary}`).join('\n'));
      },
    },
    {
      name: 'dot_memory_flashback',
      description: '触发一次零 LLM 的实体图谱一跳联想（Flashback），回忆可能遗忘的关联历史或未决项。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['text'],
        properties: {
          text: str('当前讨论文本或关键词'),
          sessionKey: str('会话标识（用于防打扰冷却）'),
        },
      },
      output: { schema: { type: 'string' }, render: (_a, v) => textOut(v) },
      execute: async (args = {}) => {
        const res = store.flashback.suggest({
          text: args.text,
          sessionKey: args.sessionKey || 'dsh-tool',
          recordHit: true,
        });
        if (!res.suggestion) return `本次未触发关联联想（${res.reason}）。`;
        const s = res.suggestion;
        return `联想命中：${s.title}（${s.date}，线索「${s.cue.title}」）\n背景：${s.situation}\n未决项：${s.openItems.join('；') || '无'}`;
      },
    },
    {
      name: 'dot_memory_manage_connections',
      description: '检测本机已安装的其他 Agent（Antigravity/Claude Code/Codex/Hermes/WorkBuddy/Cursor）并一键接入或断开 Stop Hook 与 stdio MCP，绝不改写规则 MD。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['action'],
        properties: {
          action: str('操作类型：status | connect | disconnect'),
          agent: str('目标 Agent：all（默认，仅操作本机已安装项）| antigravity | claude-code | codex | hermes | workbuddy | cursor'),
        },
      },
      output: { schema: { type: 'string' }, render: (_a, v) => textOut(v) },
      execute: async (args = {}) => {
        const action = String(args.action || 'status').trim().toLowerCase();
        const target = String(args.agent || 'all').trim().toLowerCase();
        const dmHome = store.homeDir;

        if (action === 'status') {
          const snap = detectAgentConnections({ dotMemoryHome: dmHome });
          const lines = [
            `本机 Agent 探测：已安装 ${snap.summary.installedCount} / ${snap.summary.total}，已完全接通 ${snap.summary.connectedCount} 个`,
            ...snap.agents.map((a) => {
              const inst = a.installed ? '已安装' : '未检测到';
              const hookTxt = a.hookSupported ? (a.hookConnected ? 'Hook已接' : 'Hook未接') : '无独立Hook';
              const mcpTxt = a.mcpConnected ? 'MCP已接' : 'MCP未接';
              return `- ${a.label} (${a.id}) [${inst}]：${hookTxt} · ${mcpTxt}`;
            }),
          ];
          return capText(lines.join('\n'));
        }

        if (action === 'connect') {
          try {
            if (target === 'all') {
              const res = connectAllInstalled({ dotMemoryHome: dmHome });
              if (res.connectedAgents.length === 0) {
                return '未检测到本机已安装的其他 Agent 目录（~/.gemini / ~/.claude / ~/.codex / ~/.hermes / ~/.workbuddy / ~/.cursor），未写入任何文件。';
              }
              const modified = res.results.flatMap((r) => r.modified || []);
              const backups = res.results.flatMap((r) => r.backups || []);
              return capText([
                `已一键接入 ${res.connectedAgents.length} 个本机 Agent：${res.connectedAgents.join(', ')}`,
                `修改文件：${modified.join('；')}`,
                backups.length ? `原配置已备份至：${backups.join('；')}` : '无原有配置需备份（新建配置）。',
                '提示：若对应 Agent 当前已打开，重启它即可加载最新 MCP 与 Hook（Codex 首次触发 Stop Hook 需点允许一次）。',
              ].join('\n'));
            }
            const res = connectAgent({ agent: target, dotMemoryHome: dmHome });
            return capText([
              `已接入 ${target}（Hook=${res.hookAdded ? '已写' : '不适用'}, MCP=${res.mcpConfigured ? '已写' : '未写'}）`,
              `修改文件：${(res.modified || []).join('；')}`,
              res.backups?.length ? `已备份原配置：${res.backups.join('；')}` : '无旧文件需备份。',
              res.note || '重启对应客户端后生效。',
            ].join('\n'));
          } catch (err) {
            return `接入失败（请核对参数后重试）：${err?.message || String(err)}`;
          }
        }

        if (action === 'disconnect') {
          try {
            if (target === 'all') {
              const snap = detectAgentConnections({ dotMemoryHome: dmHome });
              const active = snap.agents.filter((a) => a.hookConnected || a.mcpConnected);
              if (active.length === 0) return '当前没有已接入的外部 Agent，未改动任何文件。';
              const results = active.map((a) => disconnectAgent({ agent: a.id, dotMemoryHome: dmHome }));
              return `已断开 ${results.map((r) => r.agent).join(', ')} 的 dot-memory Hook 与 MCP（原配置已备份）。`;
            }
            const res = disconnectAgent({ agent: target, dotMemoryHome: dmHome });
            return `已断开 ${target} 的 dot-memory 接线（修改 ${(res.modified || []).length} 处，原配置已备份）。`;
          } catch (err) {
            return `断开失败（请核对参数后重试）：${err?.message || String(err)}`;
          }
        }

        return `未知 action「${action}」（未发生文件写入，请使用 status / connect / disconnect 重试）。`;
      },
    },
  ];
}

export function installDotMemoryTools(ctx, { store }, log = () => {}) {
  const registered = [];
  const disposeAll = () => {
    while (registered.length) {
      const off = registered.pop();
      try { off?.(); } catch {}
    }
  };

  try {
    ctx.inject(['tools'], (scope) => {
      try {
        const registry = scope?.tools ?? scope?.get?.('tools', false) ?? null;
        if (!registry || typeof registry.register !== 'function') return undefined;
        const tools = createDotMemoryTools({ store });
        for (const tool of tools) {
          const off = registry.register(tool);
          if (typeof off === 'function') registered.push(off);
        }
        log(`tools registered: ${tools.map((t) => t.name).join(', ')}`);
        return disposeAll;
      } catch (err) {
        log(`tools registration failed: ${err?.message || err}`);
        return undefined;
      }
    });
  } catch (err) {
    log(`tools inject unavailable: ${err?.message || err}`);
  }

  return disposeAll;
}
