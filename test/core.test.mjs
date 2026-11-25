import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  DotMemoryStore,
  LIVING_MEMORY_MAX_BYTES,
  activeMemoryBytes,
  buildFirstTurnMemoryEnvelope,
  extractHandoffFromStopPayload,
  quotedIn,
  runDreaming,
} from '../src/core/index.mjs';

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dot-mem-core-'));
}

test('quotedIn enforces verbatim substring verification and rejects hallucinated memories', () => {
  const home = makeTempHome();
  try {
    const store = new DotMemoryStore({ homeDir: home }).ensureInitialized();
    const ok = store.proposeMemory({
      bucket: 'style',
      text: '视频封面只用大白话主标题',
      quote: '封面换成大白话，别用黑话',
      quoteSource: 'chat-1',
      sourceText: '用户说：封面换成大白话，别用黑话，这样大家才点进来。',
    });
    assert.ok(ok.candidate);
    assert.equal(ok.candidate.quotedInVerified, true);

    const bad = store.proposeMemory({
      bucket: 'style',
      text: '用户喜欢紫色渐变按钮',
      quote: '我特别喜欢紫色渐变按钮',
      quoteSource: 'chat-2',
      sourceText: '用户说：帮我把按钮颜色调淡一点。',
    });
    assert.equal(bad.candidate, null);
    assert.equal(bad.rejectedReason, 'QUOTE_NOT_VERIFIED');

    const approved = store.reviewCandidate(ok.candidate.id, 'approve');
    assert.ok(approved.item);
    assert.equal(store.getLivingMemory().items.length, 1);
    assert.ok(fs.existsSync(store.livingMdPath));
    assert.match(fs.readFileSync(store.livingMdPath, 'utf8'), /视频封面只用大白话主标题/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('Dreaming metabolizes superseded active_focus entries and retires stale ones', () => {
  const home = makeTempHome();
  try {
    const store = new DotMemoryStore({ homeDir: home }).ensureInitialized();
    store.addMemory({
      bucket: 'focus',
      topic: 'video-workbench',
      text: '专注 Remotion 视频工作台打磨',
      sourceKind: 'manual',
    }, { now: '2026-11-17T08:00:00Z' });

    store.addMemory({
      bucket: 'focus',
      topic: 'legacy-app',
      text: '准备 11 月旧版本归档',
      sourceKind: 'manual',
    }, { now: '2026-11-10T08:00:00Z' });

    store.recordHandoff({
      agent: 'antigravity',
      workspace: 'video-workbench',
      status: 'done',
      title: '切换 HyperFrames 引擎',
      summary: '已完成从 Remotion 向 HyperFrames 轻底座全面切换并验证 0.ips 渲染',
      durationSec: 120,
    }, { now: '2026-11-25T10:00:00Z' });

    const dream = store.dream({ force: true, now: '2026-11-25T22:30:00Z' });
    assert.equal(dream.ran, true);
    assert.ok(dream.metabolized >= 2);

    const items = store.getLivingMemory().items;
    const wb = items.find((i) => i.topic === 'video-workbench');
    assert.ok(wb);
    assert.match(wb.text, /HyperFrames/);
    assert.equal(wb.replacedOld, '专注 Remotion 视频工作台打磨');
    assert.equal(wb.quotedInVerified, true);

    const stale = items.find((i) => i.topic === 'legacy-app');
    assert.equal(stale.active, false);
    assert.ok(activeMemoryBytes(items) <= LIVING_MEMORY_MAX_BYTES);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('Google isolated payloads are blocked across living memory, handoffs, and wiki', () => {
  const home = makeTempHome();
  try {
    const store = new DotMemoryStore({ homeDir: home }).ensureInitialized();
    assert.throws(() => store.addMemory({
      bucket: 'focus',
      text: 'Gmail 机密邮件',
      privacyScope: 'google_isolated',
      sourceKind: 'manual',
    }), (err) => err?.code === 'MEMORY_PRIVACY_BLOCKED');

    assert.throws(() => store.recordHandoff({
      agent: 'dsh',
      workspace: 'gmail',
      source: 'google_suite',
      summary: 'should never enter',
    }), (err) => err?.code === 'HANDOFF_PRIVACY_BLOCKED');

    const extracted = extractHandoffFromStopPayload('antigravity', {
      conversationId: 'c1',
      privacyScope: 'google_isolated',
      lastReply: 'secret',
      turnDurationSec: 90,
    });
    assert.equal(extracted.skipped, true);
    assert.equal(extracted.reason, 'privacy_blocked');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('Incremental Entity Wiki sync + bilingual RRF search + zero-LLM Flashback work end-to-end', () => {
  const home = makeTempHome();
  try {
    const store = new DotMemoryStore({ homeDir: home }).ensureInitialized();
    store.recordHandoff({
      agent: 'antigravity',
      workspace: 'voice-clone',
      status: 'blocked',
      title: 'Shan-Pro 声纹重训核验',
      summary: 'ElevenLabs 要求网页端朗读短句完成本人声纹核验后才放行训练',
      nextSteps: ['去 ElevenLabs 网页点开 Shan-Pro 朗读核验短句'],
      durationSec: 65,
    }, { now: '2026-11-25T11:38:00Z' });

    const syncRes = store.syncWiki({ now: '2026-11-25T11:39:00Z' });
    assert.ok(syncRes.created >= 1);

    // Seed an older session episode linked to voice-clone for Flashback
    store.wiki.upsertPage({
      type: 'session',
      slug: 'old-voice-align',
      title: '早期音色对齐与降噪测试',
      date: '2026-11-05',
      sources: { 'ses:old-1': '早期记录' },
      summary: 'voice-clone 早期用 92Hz 高通滤波消除底噪。[[ref:ses:old-1]]',
      openItems: [{ text: '核验 105 分钟干声切片是否超限 [[ref:ses:old-1]]' }],
    }, { now: '2026-11-05T10:00:00Z' });

    const searchRes = store.search({
      query: '声纹核验',
      alternates: ['Shan-Pro', 'voice-clone'],
      limit: 5,
    });
    assert.ok(searchRes.hits.length >= 2);

    const fb = store.flashback.suggest({
      text: '看一下 voice-clone 现在的进展',
      sessionKey: 's-fb-1',
      now: '2026-11-25T12:00:00Z',
    });
    assert.equal(fb.reason, 'suggested');
    assert.equal(fb.suggestion.episode, 'session/old-voice-align');

    const env = buildFirstTurnMemoryEnvelope(store.getLivingMemory());
    assert.equal(env, ''); // Empty when no living items yet
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('runDreaming preserves removedRules anti-amnesia invariant', () => {
  const res1 = runDreaming({
    memory: null,
    observations: [{
      kind: 'explicit',
      patternKey: 'no-emoji',
      summary: '回答不用 emoji',
      quote: '回答不要用 emoji',
      quoteSource: 'chat-9',
      sourceText: '以后回答不要用 emoji',
      at: '2026-11-24T10:00:00Z',
    }],
    now: '2026-11-25T01:00:00Z',
  });
  assert.equal(res1.memory.items.length, 1);
  const ruleId = res1.memory.items[0].id;

  const res2 = runDreaming({
    memory: res1.memory,
    removedRules: [ruleId],
    observations: [{
      kind: 'explicit',
      patternKey: 'no-emoji',
      summary: '回答不用 emoji',
      quote: '回答不要用 emoji',
      quoteSource: 'chat-10',
      sourceText: '以后回答不要用 emoji',
      at: '2026-11-25T10:00:00Z',
    }],
    force: true,
    now: '2026-11-25T23:00:00Z',
  });
  assert.equal(res2.memory.items.length, 0);
  assert.ok(res2.memory.removedRules.includes(ruleId));
});
