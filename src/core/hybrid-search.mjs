/**
 * Zero-dependency bilingual lexical + RRF ranking engine for local workspace
 * files, memories, handoffs, and entity dossiers. Combines Han bigrams,
 * query-term quarter-bucket coverage reranking, title boosts, and RRF fusion.
 */

export const DEFAULT_RRF_K = 60;
export const MAX_ALTERNATES = 6;
const MAX_WORDING_LENGTH = 240;

export function tokenizeBilingual(input) {
  if (typeof input !== 'string' || !input) return [];
  const normalized = input
    .normalize('NFKC')
    .toLowerCase()
    .replace(/([\p{Script=Han}])([\p{Script=Latin}\p{N}_])/gu, '$1 $2')
    .replace(/([\p{Script=Latin}\p{N}_])([\p{Script=Han}])/gu, '$1 $2');
  const rawTokens = normalized.split(/[^\p{L}\p{N}_]+/u).filter(Boolean);
  const tokens = [...rawTokens];
  for (const hanRun of normalized.match(/[\p{Script=Han}]+/gu) ?? []) {
    const chars = [...hanRun];
    if (chars.length === 1) {
      tokens.push(chars[0]);
      continue;
    }
    for (let i = 0; i + 1 < chars.length; i += 1) {
      tokens.push(`${chars[i]}${chars[i + 1]}`);
    }
  }
  return tokens;
}

export function sanitizeAlternates(alternates) {
  if (!Array.isArray(alternates)) return [];
  const seen = new Set();
  const out = [];
  for (const item of alternates) {
    if (typeof item !== 'string') continue;
    const clean = item.trim().slice(0, MAX_WORDING_LENGTH);
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= MAX_ALTERNATES) break;
  }
  return out;
}

function scoreSingleWording(preparedDocs, averageLength, wording) {
  const uniqueTerms = [...new Set(tokenizeBilingual(wording))];
  if (uniqueTerms.length === 0 || preparedDocs.length === 0 || averageLength <= 0) return [];

  const docCount = preparedDocs.length;
  const idfMap = new Map();
  for (const term of uniqueTerms) {
    let df = 0;
    for (const doc of preparedDocs) {
      if (doc.frequencies.has(term)) df += 1;
    }
    idfMap.set(term, Math.log(1 + (docCount - df + 0.5) / (df + 0.5)));
  }

  const hits = [];
  for (const doc of preparedDocs) {
    let bm25 = 0;
    let matchedTerms = 0;
    for (const term of uniqueTerms) {
      const tf = doc.frequencies.get(term) ?? 0;
      if (tf === 0) continue;
      matchedTerms += 1;
      const idf = idfMap.get(term) ?? 0;
      bm25 += (idf * (tf * 2.2)) / (tf + 1.2 * (1 - 0.75 + (0.75 * doc.length) / averageLength));
    }
    if (bm25 <= 0) continue;

    let titleHits = 0;
    for (const term of uniqueTerms) {
      if (doc.titleTokenSet.has(term)) titleHits += 1;
    }
    const coverage = Math.min(1, matchedTerms / uniqueTerms.length);
    const bucket = Math.floor(coverage * 4);
    const boosted = bm25 * (1 + titleHits / uniqueTerms.length);
    hits.push({
      id: doc.id,
      value: doc.value,
      bm25,
      score: boosted,
      coverage,
      bucket,
      matchedTerms,
      timestampMs: doc.timestampMs,
    });
  }

  hits.sort((a, b) => b.bucket - a.bucket || b.score - a.score);
  return hits;
}

export function rankHybridLexical(documents, {
  query,
  alternates = [],
  limit = 24,
  k = DEFAULT_RRF_K,
  timeFromMs = null,
  timeToMs = null,
} = {}) {
  const cleanQuery = typeof query === 'string' ? query.trim().slice(0, MAX_WORDING_LENGTH) : '';
  if (!cleanQuery || !Array.isArray(documents) || documents.length === 0) {
    return { matches: [], wordings: [] };
  }

  const cleanAlts = sanitizeAlternates(alternates).filter(
    (item) => item.toLowerCase() !== cleanQuery.toLowerCase(),
  );
  const wordings = [cleanQuery, ...cleanAlts];

  const preparedDocs = documents.map((doc, idx) => {
    const title = typeof doc.title === 'string' ? doc.title : '';
    const body = typeof doc.text === 'string' ? doc.text : '';
    const titleTokens = tokenizeBilingual(title);
    const combinedTokens = [...titleTokens, ...tokenizeBilingual(body)];
    const frequencies = new Map();
    for (const token of combinedTokens) {
      frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
    }
    const ts = Number(doc.timestampMs);
    return {
      id: doc.id ?? `doc-${idx}`,
      value: doc.value ?? doc,
      frequencies,
      length: combinedTokens.length,
      titleTokenSet: new Set(titleTokens),
      timestampMs: Number.isFinite(ts) && ts > 0 ? ts : null,
    };
  });

  const nonEmptyDocs = preparedDocs.filter((doc) => doc.length > 0);
  if (nonEmptyDocs.length === 0) return { matches: [], wordings };

  const averageLength = nonEmptyDocs.reduce((sum, doc) => sum + doc.length, 0) / nonEmptyDocs.length;
  const fused = new Map();

  const addChannel = (rankedList, channelWeight = 1) => {
    rankedList.forEach((hit, index) => {
      const rank = index + 1;
      const contrib = channelWeight / (k + rank);
      const current = fused.get(hit.id);
      if (!current) {
        fused.set(hit.id, {
          id: hit.id,
          value: hit.value,
          rrfScore: contrib,
          bestLexicalScore: hit.score,
          bestCoverage: hit.coverage,
          channelHits: 1,
        });
      } else {
        current.rrfScore += contrib;
        current.bestLexicalScore = Math.max(current.bestLexicalScore, hit.score);
        current.bestCoverage = Math.max(current.bestCoverage, hit.coverage);
        current.channelHits += 1;
      }
    });
  };

  wordings.forEach((wording) => {
    const ranked = scoreSingleWording(nonEmptyDocs, averageLength, wording);
    if (ranked.length === 0) return;
    addChannel(ranked, 1.0);

    if (Number.isFinite(timeFromMs) || Number.isFinite(timeToMs)) {
      const inWindow = ranked.filter((hit) => {
        if (hit.timestampMs === null) return false;
        if (Number.isFinite(timeFromMs) && hit.timestampMs < timeFromMs) return false;
        if (Number.isFinite(timeToMs) && hit.timestampMs > timeToMs) return false;
        return true;
      });
      if (inWindow.length > 0) addChannel(inWindow, 0.85);
    }
  });

  const matches = [...fused.values()]
    .sort((a, b) => b.rrfScore - a.rrfScore || b.bestCoverage - a.bestCoverage || b.bestLexicalScore - a.bestLexicalScore)
    .slice(0, Math.max(1, limit));

  return { matches, wordings };
}
