/**
 * Zero-LLM Active Trigger Recall (Lane 1) for @oxmumu3/dot-memory.
 * Mirrors DSH.dot Bridge's trigger-recall so every local agent (Antigravity / Claude Code / Codex / DSH)
 * can surface exact matching Entity Wiki dossiers in <5ms without LLM round-trips.
 */

export const STRONG_TRIGGER_MATCH_SCORE = 0.65;
export const TRIGGER_INJECTION_LIMIT = 3;
export const MAX_TRIGGER_CONTEXT_CHARS = 1800;

const WORD_RE = /[\p{L}\p{N}_-]+/gu;
const UNSPACED_SCRIPT_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const GENERIC_PHRASES = new Set([
  'agent', 'project', 'topic', 'session', 'note', 'notes', 'todo', 'task', 'work',
  '项目', '工作', '任务', '文档', '笔记', '待办', '今天', '最近', '系统',
]);

const RETROSPECTIVE_EN_RE = [
  /\b(?:previously|earlier|last time|used to)\b/iu,
  /\b(?:do|can|could|would)\s+you\s+(?:remember|recall)\b/iu,
  /\b(?:remember|recall)\s+(?:when|what|which|who|where|why|how)\b/iu,
  /\b(?:we|you|i)\s+(?:discussed|decided|agreed|said|talked about|chose)\b/iu,
  /\b(?:previous|earlier|past)\s+(?:decision|conversation|chat|discussion)\b/iu,
  /\b(?:yesterday|the other day|last (?:week|month|year))\b/iu,
  /\bremind\s+(?:me|us)\s+(?:what|which|who|where|why|how)\b/iu,
];

const RETROSPECTIVE_ZH_INTENT_RE =
  /[还還][记記]得|[记記]得(?=.{0,24}(?:[吗嗎]|[?？]))|(?:[之以]前|上(?:次|回)|曾[经經]|昨(?:天|日))[\s,，、:：]{0,4}(?:(?:我们|我們|我|你|您)?(?:(?:聊|[说說]|[谈談]|[讨討][论論]|提)(?:[过過]|了|的)|[决決]定(?:[过過]|了)|[记記][录錄](?:[过過]|了))|(?:的)?(?:聊天|[对對][话話])[记記][录錄]|的[资資]料)/u;

const FUTURE_ZH_RE =
  /明(?:天|日|晚|年|早)|今(?:晚|夜|后|後)|[后後](?:天|日)|下(?:周|週|星期|(?:个|個)?月|次|回|礼拜|禮拜)|以(?:后|後)|之(?:后|後)|将来|將來|未来|未來|稍(?:后|後|晚)|待(?:会|會)|等(?:会|會|下)|tomorrow|next\s+(?:week|month|year)/iu;

const RETROSPECTIVE_ZH_PAST_RE =
  /(?:上(?:次|回|周|週|星期|(?:个|個)?月)|曾[经經]|昨(?:天|日))[\s,，、:：]{0,4}(?:我们|我們|我|你|您)?[\s,，、:：]{0,4}(?:聊|[说說]|[谈談]|[讨討][论論]|提|[决決]定|[记記][录錄])/u;

function splitWords(lowercased) {
  return (lowercased.match(WORD_RE) ?? []).filter((word) => word.length > 1);
}

function splitTriggerPhrases(raw) {
  if (Array.isArray(raw)) return raw.flatMap((entry) => splitTriggerPhrases(entry));
  return String(raw ?? '')
    .split(/[\n;|,，]+/u)
    .map((phrase) => phrase.trim())
    .filter((phrase) => phrase.length >= 2 && !GENERIC_PHRASES.has(phrase.toLowerCase()));
}

function prepareTriggerScorer(message) {
  const messageText = String(message ?? '').toLowerCase();
  const messageWordSet = new Set(splitWords(messageText));

  const messageHas = (word) => {
    if (!word || word.length < 2) return false;
    if (UNSPACED_SCRIPT_RE.test(word)) return messageText.includes(word);
    return messageWordSet.has(word);
  };

  const scorePhrase = (phrase) => {
    const clean = phrase.toLowerCase().trim();
    if (!clean || clean.length < 2) return 0;
    if (UNSPACED_SCRIPT_RE.test(clean) && !/\s/u.test(clean)) {
      return messageText.includes(clean) ? 0.85 : 0;
    }
    const triggerWords = [...new Set(splitWords(clean))];
    if (triggerWords.length === 0) return 0;
    if (triggerWords.length === 1) return messageHas(triggerWords[0]) ? 0.85 : 0;
    const overlap = triggerWords.filter(messageHas).length;
    if (overlap === 0) return 0;
    const coverage = overlap / triggerWords.length;
    return coverage * 0.8 + Math.min(1, overlap / 2) * 0.2;
  };

  return (page, nowMs) => {
    const explicitTriggers = splitTriggerPhrases(page.triggers ?? []);
    const identityPhrases = page.type === 'session'
      ? []
      : splitTriggerPhrases([page.title, ...(page.aliases ?? [])]);
    const phrases = [...new Set([...explicitTriggers, ...identityPhrases])];
    if (phrases.length === 0) return { score: 0, matchedPhrase: null };

    let bestScore = 0;
    let bestPhrase = null;
    for (const phrase of phrases) {
      const s = scorePhrase(phrase);
      if (s > bestScore) {
        bestScore = s;
        bestPhrase = phrase;
      }
    }
    if (bestScore === 0) return { score: 0, matchedPhrase: null };

    const updatedMs = Date.parse(page.updatedAt || '') || 0;
    const recencyBoost = updatedMs > 0 && nowMs - updatedMs <= 14 * 86_400_000 ? 0.05 : 0;
    const openItemBoost = Array.isArray(page.openItems) && page.openItems.length > 0 ? 0.04 : 0;
    return {
      score: Math.min(1, Number((bestScore + recencyBoost + openItemBoost).toFixed(4))),
      matchedPhrase: bestPhrase,
    };
  };
}

export function hasRetrospectiveRecallIntent(message) {
  const normalized = String(message ?? '').replace(/\s+/gu, ' ').trim();
  if (!normalized) return false;
  if (RETROSPECTIVE_EN_RE.some((re) => re.test(normalized))) {
    if (FUTURE_ZH_RE.test(normalized) && !/\b(?:yesterday|last\s+(?:week|month|year)|previously|earlier|discussed|decided|agreed)\b/iu.test(normalized)) {
      return false;
    }
    return true;
  }
  if (RETROSPECTIVE_ZH_INTENT_RE.test(normalized)) {
    return !FUTURE_ZH_RE.test(normalized) || RETROSPECTIVE_ZH_PAST_RE.test(normalized);
  }
  return false;
}

export function selectTriggeredWikiPages(
  message,
  pages = [],
  {
    limit = TRIGGER_INJECTION_LIMIT,
    minScore = STRONG_TRIGGER_MATCH_SCORE,
    excludeKeys = [],
    now = new Date(),
  } = {},
) {
  const cleanMsg = String(message ?? '').trim();
  if (!cleanMsg || !Array.isArray(pages) || pages.length === 0) return [];
  const excluded = new Set(excludeKeys);
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now) || Date.now();
  const scorePage = prepareTriggerScorer(cleanMsg);

  const hits = [];
  for (const page of pages) {
    if (!page || !page.key || excluded.has(page.key)) continue;
    if (page.privacyScope === 'google_isolated') continue;
    const { score, matchedPhrase } = scorePage(page, nowMs);
    if (score >= minScore) {
      hits.push({
        key: page.key,
        type: page.type,
        title: page.title,
        hashPrefix: page.hashPrefix || null,
        score,
        matchedPhrase,
        summary: String(page.summary || '').trim(),
        openItems: Array.isArray(page.openItems) ? page.openItems.slice(0, 3).map((i) => i.text || String(i)) : [],
        decisions: Array.isArray(page.decisions) ? page.decisions.slice(0, 2).map((i) => i.text || String(i)) : [],
        updatedAt: page.updatedAt || null,
      });
    }
  }

  hits.sort((a, b) => b.score - a.score || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) || a.key.localeCompare(b.key));
  return hits.slice(0, Math.max(1, Math.min(limit, 5)));
}

export function renderTriggeredWikiBlock(matches = [], { maxChars = MAX_TRIGGER_CONTEXT_CHARS } = {}) {
  if (!Array.isArray(matches) || matches.length === 0) return '';
  const lines = [
    '<dot_recalled_wiki mode="readonly_context">',
    '以下是与当前提及实体直接命中的本机档案摘要（仅作只读背景参考）：',
  ];
  let budget = maxChars - 120;
  for (const hit of matches) {
    const parts = [
      `- [${hit.key}${hit.hashPrefix ? ` #${hit.hashPrefix.slice(0, 8)}` : ''}] ${hit.title}（触发词: ${hit.matchedPhrase}）`,
    ];
    if (hit.summary) parts.push(`  摘要: ${hit.summary.slice(0, 260)}`);
    if (hit.openItems?.length) parts.push(`  未决项: ${hit.openItems.join('；').slice(0, 240)}`);
    if (hit.decisions?.length) parts.push(`  关键决策: ${hit.decisions.join('；').slice(0, 200)}`);
    const block = parts.join('\n');
    if (block.length > budget) break;
    lines.push(block);
    budget -= block.length + 1;
  }
  if (lines.length <= 2) return '';
  lines.push('</dot_recalled_wiki>');
  return lines.join('\n');
}
