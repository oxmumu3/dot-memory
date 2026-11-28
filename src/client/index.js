// Client bundle source for @oxmumu3/dot-memory (`Dot 记忆总线`).
// Wrapped in window.__ModuleLoader__.load(...) by scripts/build-client.mjs.
// Uses host React via require('react') and strictly avoids host UI component packages.

var VIEW_URL = '/api/dot_memory/view';
var ACTION_URL = '/api/dot_memory/action';
var PANEL_KEY = 'dot-memory';

function loadReact() {
  try {
    var mod = require('react');
    return mod && mod.createElement ? mod : (mod && mod.default) || null;
  } catch (_e) {
    return null;
  }
}

function ensureStyleInjected() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(DM_STYLE_ID)) return;
  var el = document.createElement('style');
  el.id = DM_STYLE_ID;
  el.textContent = DM_CSS;
  (document.head || document.documentElement).appendChild(el);
}

function fetchJson(url, options) {
  return fetch(url, options).then(function (res) {
    return res.json().catch(function () { return {}; }).then(function (data) {
      if (!res.ok || (data && data.ok === false)) {
        throw new Error((data && data.error) || ('HTTP ' + res.status));
      }
      return data;
    });
  });
}

function postAction(action, payload) {
  var body = Object.assign({ action: action }, payload || {});
  return fetchJson(ACTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeSidebarIcon(React) {
  return function DotMemoryIcon(props) {
    var h = React.createElement;
    var size = (props && props.size) || 18;
    var active = !!(props && props.active);
    return h('svg', {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: active ? '2' : '1.75',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
    },
      h('rect', { x: '3', y: '4', width: '18', height: '16', rx: '4' }),
      h('path', { d: 'M7.5 9.25h9M7.5 13h6' }),
      h('circle', { cx: '16.5', cy: '14.5', r: '2.25', fill: 'currentColor' }),
    );
  };
}

function formatDay(iso) {
  if (!iso || typeof iso !== 'string') return '';
  return iso.slice(0, 16).replace('T', ' ');
}

function copyText(text, onDone) {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { if (onDone) onDone(); }).catch(function () {});
      return;
    }
  } catch (_e) {}
  if (onDone) onDone();
}

function makeEvidenceDialog(React) {
  return function EvidenceDialog(props) {
    var h = React.createElement;
    var ref = React.useRef(null);
    var item = props.item;

    React.useEffect(function () {
      var el = ref.current;
      if (!el) return;
      if (item && !el.open && typeof el.showModal === 'function') {
        try { el.showModal(); } catch (_e) {}
      } else if (!item && el.open && typeof el.close === 'function') {
        try { el.close(); } catch (_e) {}
      }
    }, [item]);

    return h('dialog', {
      ref: ref,
      className: 'dm-dialog',
      'data-testid': 'dm-evidence-dialog',
      closedby: 'any',
      onClose: function () { if (props.onClose) props.onClose(); },
    },
      item ? h(React.Fragment, null,
        h('div', { className: 'dm-dlg-head' },
          h('div', null,
            h('div', { className: 'dm-eyebrow' }, '活体记忆原话实证'),
            h('h2', { className: 'dm-dlg-title' }, item.text),
          ),
          h('button', { type: 'button', className: 'dm-btn ghost sm', onClick: props.onClose }, '关闭'),
        ),
        h('div', { className: 'dm-dlg-body' },
          h('div', { className: 'dm-row-meta' },
            h('span', { className: 'dm-tag ok' }, item.quotedInVerified ? '原话已核验' : '未核验'),
            h('span', { className: 'dm-tag' }, item.bucket),
            h('span', { className: 'dm-tag' }, item.provenance || item.sourceKind),
          ),
          h('div', { className: 'dm-quote-box' },
            h('div', { style: { fontWeight: 600, marginBottom: '4px' } }, '原始出处：' + (item.quoteSource || 'manual')),
            '「' + (item.quote || item.text) + '」',
          ),
          item.replacedOld ? h('div', { className: 'dm-quote-box', style: { borderLeftColor: 'var(--dm-wait)' } },
            h('div', { style: { fontWeight: 600, marginBottom: '4px' } }, '已被代谢替换的旧条目'),
            item.replacedOld,
          ) : null,
          h('div', { className: 'dm-subline' }, '最近更新：' + formatDay(item.updatedAt)),
        ),
        h('div', { className: 'dm-dlg-foot' },
          h('button', {
            type: 'button',
            className: 'dm-btn line sm',
            onClick: function () {
              props.onToggle(item.id);
              props.onClose();
            },
          }, item.active ? '暂停生效' : '恢复生效'),
          h('button', {
            type: 'button',
            className: 'dm-btn danger-text sm',
            onClick: function () {
              props.onRemove(item.id);
              props.onClose();
            },
          }, '彻底移除'),
          h('button', { type: 'button', className: 'dm-btn solid sm', onClick: props.onClose }, '完成'),
        ),
      ) : null,
    );
  };
}

function makeAddDialog(React) {
  return function AddMemoryDialog(props) {
    var h = React.createElement;
    var ref = React.useRef(null);
    var open = !!props.open;
    var _bucket = React.useState('style');
    var bucket = _bucket[0];
    var setBucket = _bucket[1];
    var _topic = React.useState('');
    var topic = _topic[0];
    var setTopic = _topic[1];
    var _text = React.useState('');
    var text = _text[0];
    var setText = _text[1];

    React.useEffect(function () {
      var el = ref.current;
      if (!el) return;
      if (open && !el.open && typeof el.showModal === 'function') {
        try { el.showModal(); } catch (_e) {}
      } else if (!open && el.open && typeof el.close === 'function') {
        try { el.close(); } catch (_e) {}
      }
    }, [open]);

    function submit(e) {
      e.preventDefault();
      if (!text.trim()) return;
      props.onSubmit({ bucket: bucket, topic: topic.trim() || undefined, text: text.trim() });
      setText('');
      setTopic('');
      props.onClose();
    }

    return h('dialog', {
      ref: ref,
      className: 'dm-dialog',
      'data-testid': 'dm-add-dialog',
      closedby: 'any',
      onClose: props.onClose,
    },
      open ? h('form', { onSubmit: submit },
        h('div', { className: 'dm-dlg-head' },
          h('h2', { className: 'dm-dlg-title' }, '新增活体记忆'),
          h('button', { type: 'button', className: 'dm-btn ghost sm', onClick: props.onClose }, '取消'),
        ),
        h('div', { className: 'dm-dlg-body' },
          h('label', null,
            h('div', { className: 'dm-eyebrow', style: { marginBottom: '4px' } }, '分栏类别'),
            h('select', {
              className: 'dm-select',
              value: bucket,
              onChange: function (e) { setBucket(e.target.value); },
            },
              h('option', { value: 'rules' }, '规则与边界 (Rules)'),
              h('option', { value: 'style' }, '偏好与品味 (Style)'),
              h('option', { value: 'focus' }, '近期主线焦点 (Active Focus)'),
            ),
          ),
          bucket === 'focus' ? h('label', null,
            h('div', { className: 'dm-eyebrow', style: { marginBottom: '4px' } }, '项目 / 主题标识（同主题自动代谢覆盖）'),
            h('input', {
              className: 'dm-input',
              placeholder: '例如：dot-memory',
              value: topic,
              onChange: function (e) { setTopic(e.target.value); },
            }),
          ) : null,
          h('label', null,
            h('div', { className: 'dm-eyebrow', style: { marginBottom: '4px' } }, '记忆正文（不超过 260 字）'),
            h('textarea', {
              className: 'dm-textarea',
              rows: 3,
              required: true,
              placeholder: '例如：对外代码仓库统一用 oxmumu3，简体中文优先。',
              value: text,
              onChange: function (e) { setText(e.target.value); },
            }),
          ),
        ),
        h('div', { className: 'dm-dlg-foot' },
          h('button', { type: 'button', className: 'dm-btn line sm', onClick: props.onClose }, '取消'),
          h('button', { type: 'submit', className: 'dm-btn solid sm', 'data-testid': 'dm-add-submit' }, '保存进记忆库'),
        ),
      ) : null,
    );
  };
}

function makeWorkbenchComponent(React, ctx, options) {
  var initialData = options && options.initialData;
  var onActionOverride = options && options.onAction;

  return function DotMemoryWorkbench() {
    var h = React.createElement;
    var _snap = React.useState(initialData ? initialData.snapshot : null);
    var snapshot = _snap[0];
    var setSnapshot = _snap[1];
    var _integ = React.useState(initialData ? initialData.integrations : null);
    var integrations = _integ[0];
    var setIntegrations = _integ[1];
    var _conn = React.useState(initialData ? initialData.connections : null);
    var connections = _conn[0];
    var setConnections = _conn[1];
    var _tab = React.useState('living');
    var tab = _tab[0];
    var setTab = _tab[1];
    var _agentFilter = React.useState('all');
    var agentFilter = _agentFilter[0];
    var setAgentFilter = _agentFilter[1];
    var _selectedWiki = React.useState(null);
    var selectedWiki = _selectedWiki[0];
    var setSelectedWiki = _selectedWiki[1];
    var _searchQ = React.useState('');
    var searchQ = _searchQ[0];
    var setSearchQ = _searchQ[1];
    var _searchHits = React.useState(null);
    var searchHits = _searchHits[0];
    var setSearchHits = _searchHits[1];
    var _notice = React.useState(null);
    var notice = _notice[0];
    var setNotice = _notice[1];
    var _evItem = React.useState(null);
    var evItem = _evItem[0];
    var setEvItem = _evItem[1];
    var _addOpen = React.useState(false);
    var addOpen = _addOpen[0];
    var setAddOpen = _addOpen[1];
    var _busy = React.useState(false);
    var busy = _busy[0];
    var setBusy = _busy[1];

    var EvidenceDialog = React.useMemo(function () { return makeEvidenceDialog(React); }, []);
    var AddDialog = React.useMemo(function () { return makeAddDialog(React); }, []);

    function flash(text, tone) {
      setNotice({ text: text, tone: tone || 'ok' });
    }

    function loadView() {
      if (initialData && !onActionOverride) return Promise.resolve();
      return fetchJson(VIEW_URL, { headers: { Accept: 'application/json' } }).then(function (res) {
        if (res.snapshot) setSnapshot(res.snapshot);
        if (res.integrations) setIntegrations(res.integrations);
        if (res.connections) setConnections(res.connections);
      }).catch(function (err) {
        flash('加载记忆总线失败：' + (err && err.message ? err.message : String(err)), 'bad');
      });
    }

    React.useEffect(function () {
      ensureStyleInjected();
      loadView();
    }, []);

    function dispatch(action, payload, okMsg) {
      setBusy(true);
      var runner = onActionOverride ? onActionOverride(action, payload) : postAction(action, payload);
      return Promise.resolve(runner).then(function (res) {
        setBusy(false);
        if (res && res.snapshot) setSnapshot(res.snapshot);
        if (res && res.connections) setConnections(res.connections);
        if (okMsg) flash(okMsg, 'ok');
        return res;
      }).catch(function (err) {
        setBusy(false);
        flash(err && err.message ? err.message : String(err), 'bad');
      });
    }

    var memory = (snapshot && snapshot.memory) || { items: [], candidates: [] };
    var budget = (snapshot && snapshot.budget) || { usedBytes: 0, maxBytes: 4096, bucketLimits: { rules: 15, style: 15, focus: 12 } };
    var handoffs = (snapshot && snapshot.handoffs) || [];
    var wikiPages = (snapshot && snapshot.wikiPages) || [];
    var activeWikiKey = selectedWiki || (wikiPages[0] && wikiPages[0].key) || null;
    var activeWiki = wikiPages.find(function (p) { return p.key === activeWikiKey; }) || wikiPages[0] || null;
    var pct = Math.min(100, Math.round((budget.usedBytes / Math.max(1, budget.maxBytes)) * 100));
    var connList = (connections && connections.agents) || [];
    var connSummary = (connections && connections.summary) || {
      total: connList.length || 6,
      installedCount: 0,
      connectedCount: 0,
      partialCount: 0,
      unconnectedInstalled: [],
    };
    var pendingConnectLabels = connList
      .filter(function (a) { return a.installed && !a.fullyConnected; })
      .map(function (a) { return a.label; });

    var baseFilterAgents = [
      ['all', '全部'],
      ['antigravity', 'Antigravity'],
      ['claude-code', 'Claude Code'],
      ['codex', 'Codex'],
      ['dsh', 'DSH'],
    ];
    var extraFilterMap = { hermes: 'Hermes', workbuddy: 'WorkBuddy', cursor: 'Cursor' };
    Object.keys(extraFilterMap).forEach(function (eid) {
      if (handoffs.some(function (hf) { return hf.agent === eid; })) {
        baseFilterAgents.push([eid, extraFilterMap[eid]]);
      }
    });

    var filteredHandoffs = agentFilter === 'all'
      ? handoffs
      : handoffs.filter(function (x) { return x.agent === agentFilter; });

    function runSearch(e) {
      e.preventDefault();
      if (!searchQ.trim()) { setSearchHits(null); return; }
      dispatch('search', { query: searchQ.trim(), limit: 10 }).then(function (res) {
        if (res && res.result) setSearchHits(res.result.hits || []);
      });
    }

    var mcpSnippetObj = (connections && connections.snippets && connections.snippets.mcpServer)
      || (integrations && integrations.mcpServer)
      || { command: 'dot-memory-mcp' };

    return h('div', { className: 'dm-root', 'data-testid': 'dm-workbench' },
      h('div', { className: 'dm-inner' },
        // Header
        h('header', { className: 'dm-head' },
          h('div', { className: 'dm-head-left' },
            h('div', { className: 'dm-eyebrow' }, '跨 Agent 本地共享大脑 · 零向量 · 原话实证'),
            h('h1', { className: 'dm-h1' }, 'Dot 记忆总线'),
            h('div', { className: 'dm-subline' },
              '4KB 活体记忆 ' + budget.usedBytes + ' / ' + budget.maxBytes + ' B · ' +
              handoffs.length + ' 条跨端交接 · ' + wikiPages.length + ' 页实体档案' +
              (connections ? ' · 已连 ' + connSummary.connectedCount + '/' + connSummary.installedCount + ' 个本机 Agent' : ''),
            ),
          ),
          h('div', { className: 'dm-head-acts' },
            h('button', {
              type: 'button',
              className: 'dm-btn line sm',
              'data-testid': 'dm-btn-sync',
              disabled: busy,
              onClick: function () { dispatch('sync_wiki', {}, '实体档案 Wiki 已增量同步'); },
            }, '刷新档案'),
            h('button', {
              type: 'button',
              className: 'dm-btn line sm',
              'data-testid': 'dm-btn-dream',
              disabled: busy,
              onClick: function () { dispatch('run_dream', {}, '已完成 Dreaming 代谢与焦点去重'); },
            }, '整理代谢 (Dream)'),
            h('button', {
              type: 'button',
              className: 'dm-btn solid sm',
              'data-testid': 'dm-btn-add',
              onClick: function () { setAddOpen(true); },
            }, '手动新增'),
          ),
        ),

        notice ? h('div', { className: 'dm-notice ' + notice.tone },
          h('span', null, notice.text),
          h('button', { type: 'button', className: 'dm-btn ghost xs', onClick: function () { setNotice(null); } }, '关闭'),
        ) : null,

        pendingConnectLabels.length > 0 && tab !== 'connect' ? h('div', { className: 'dm-connect-banner', 'data-testid': 'dm-connect-banner' },
          h('div', { className: 'dm-connect-banner-main' },
            h('div', { className: 'dm-connect-banner-title' },
              '检测到本机还有 ' + pendingConnectLabels.length + ' 个 Agent 未接入共享总线（' + pendingConnectLabels.join('、') + '）',
            ),
            h('div', { className: 'dm-connect-banner-sub' },
              '只配各端的 Stop Hook 与 stdio MCP，写入前自动备份，绝不改写你的 CLAUDE.md / AGENTS.md。',
            ),
          ),
          h('div', { className: 'dm-connect-banner-acts' },
            h('button', {
              type: 'button',
              className: 'dm-btn solid sm',
              'data-testid': 'dm-btn-connect-all-banner',
              disabled: busy,
              onClick: function () {
                dispatch('connect_all_installed', {}, '已一键接入全部检测到的本机 Agent（若已打开客户端请重启生效）');
              },
            }, '一键接入全部'),
            h('button', {
              type: 'button',
              className: 'dm-btn line sm',
              onClick: function () { setTab('connect'); },
            }, '管理连接'),
          ),
        ) : null,

        // Tabs
        h('nav', { className: 'dm-tabs', role: 'tablist' },
          h('button', {
            type: 'button',
            role: 'tab',
            className: 'dm-tab' + (tab === 'living' ? ' active' : ''),
            'data-testid': 'dm-tab-living',
            onClick: function () { setTab('living'); },
          }, '活体记忆', h('span', { className: 'dm-tab-count' }, String(memory.items.length))),
          h('button', {
            type: 'button',
            role: 'tab',
            className: 'dm-tab' + (tab === 'handoffs' ? ' active' : ''),
            'data-testid': 'dm-tab-handoffs',
            onClick: function () { setTab('handoffs'); },
          }, '跨端交接', h('span', { className: 'dm-tab-count' }, String(handoffs.length))),
          h('button', {
            type: 'button',
            role: 'tab',
            className: 'dm-tab' + (tab === 'wiki' ? ' active' : ''),
            'data-testid': 'dm-tab-wiki',
            onClick: function () { setTab('wiki'); },
          }, '实体档案', h('span', { className: 'dm-tab-count' }, String(wikiPages.length))),
          h('button', {
            type: 'button',
            role: 'tab',
            className: 'dm-tab' + (tab === 'connect' ? ' active' : ''),
            'data-testid': 'dm-tab-connect',
            onClick: function () { setTab('connect'); },
          }, '本机连接', h('span', { className: 'dm-tab-count' }, String(connSummary.connectedCount) + '/' + String(connSummary.installedCount))),
        ),

        // Tab 1: Living Memory
        tab === 'living' ? h(React.Fragment, null,
          h('div', { className: 'dm-budget-card' },
            h('div', { className: 'dm-budget-top' },
              h('strong', null, '首轮附注缓存友好预算（绝不篡改 System Prompt）'),
              h('span', { className: 'dm-subline' }, budget.usedBytes + ' / ' + budget.maxBytes + ' 字节 (' + pct + '%)'),
            ),
            h('div', { className: 'dm-meter-track' },
              h('div', { className: 'dm-meter-fill' + (pct > 82 ? ' warn' : ''), style: { width: pct + '%' } }),
            ),
          ),

          memory.candidates && memory.candidates.length > 0 ? h('div', { className: 'dm-cand-box' },
            h('div', { className: 'dm-section-head' },
              h('strong', { className: 'dm-section-title' }, '待审核提案（' + memory.candidates.length + ' 条 · 原话校验已通过）'),
            ),
            memory.candidates.map(function (c) {
              return h('div', { key: c.id, className: 'dm-cand-row' },
                h('div', { className: 'dm-row-main' },
                  h('div', { className: 'dm-row-title' }, c.text),
                  h('div', { className: 'dm-row-meta' },
                    h('span', { className: 'dm-tag wait' }, c.bucket),
                    h('span', null, '原话：「' + c.quote.slice(0, 72) + '」'),
                  ),
                ),
                h('div', { className: 'dm-row-acts' },
                  h('button', {
                    type: 'button',
                    className: 'dm-btn solid xs',
                    onClick: function () { dispatch('review_candidate', { id: c.id, decision: 'approve' }, '已采纳入库'); },
                  }, '采纳入库'),
                  h('button', {
                    type: 'button',
                    className: 'dm-btn line xs',
                    onClick: function () { dispatch('review_candidate', { id: c.id, decision: 'reject' }, '已忽略候选'); },
                  }, '忽略'),
                ),
              );
            }),
          ) : null,

          [
            ['focus', '近期主线焦点 (Active Focus)'],
            ['style', '偏好与品味 (Working Style)'],
            ['rules', '规则与边界 (Rules)'],
          ].map(function (pair) {
            var bucketKey = pair[0];
            var bucketLabel = pair[1];
            var rows = (memory.items || []).filter(function (i) { return i.bucket === bucketKey; });
            return h('section', { key: bucketKey, className: 'dm-section' },
              h('div', { className: 'dm-section-head' },
                h('h2', { className: 'dm-section-title' }, bucketLabel),
                h('span', { className: 'dm-subline' }, rows.length + ' / ' + ((budget.bucketLimits && budget.bucketLimits[bucketKey]) || 15) + ' 条'),
              ),
              rows.length === 0
                ? h('div', { className: 'dm-empty' }, '该分栏暂无条目')
                : h('div', { className: 'dm-list' },
                  rows.map(function (it) {
                    return h('div', { key: it.id, className: 'dm-row' + (it.active ? '' : ' paused') },
                      h('div', { className: 'dm-row-main' },
                        h('div', { className: 'dm-row-title' }, it.text),
                        h('div', { className: 'dm-row-meta' },
                          h('span', { className: 'dm-tag ok' }, it.quotedInVerified ? '原话可核' : '待核'),
                          it.replacedOld ? h('span', { className: 'dm-tag run' }, '已代谢更新') : null,
                          !it.active ? h('span', { className: 'dm-tag wait' }, '已暂停') : null,
                          h('span', null, it.provenance || it.sourceKind),
                          h('span', null, formatDay(it.updatedAt)),
                        ),
                      ),
                      h('div', { className: 'dm-row-acts' },
                        h('button', {
                          type: 'button',
                          className: 'dm-btn line xs',
                          onClick: function () { setEvItem(it); },
                        }, '看原话'),
                        h('button', {
                          type: 'button',
                          className: 'dm-btn ghost xs',
                          onClick: function () { dispatch('toggle_memory', { id: it.id }, it.active ? '已暂停' : '已恢复'); },
                        }, it.active ? '暂停' : '恢复'),
                      ),
                    );
                  }),
                ),
            );
          }),
        ) : null,

        // Tab 2: Cross-Agent Handoffs
        tab === 'handoffs' ? h('section', { className: 'dm-section' },
          h('div', { className: 'dm-section-head' },
            h('h2', { className: 'dm-section-title' }, '跨 Agent 交接时间线'),
            h('div', { className: 'dm-filter-bar' },
              baseFilterAgents.map(function (pair) {
                return h('button', {
                  key: pair[0],
                  type: 'button',
                  className: 'dm-chip' + (agentFilter === pair[0] ? ' active' : ''),
                  onClick: function () { setAgentFilter(pair[0]); },
                }, pair[1]);
              }),
            ),
          ),
          filteredHandoffs.length === 0
            ? h('div', { className: 'dm-empty' }, '暂无匹配的跨端交接记录。')
            : h('div', { className: 'dm-list' },
              filteredHandoffs.map(function (hf) {
                var statusCls = (hf.status === 'error' || hf.status === 'blocked') ? 'bad' : (hf.status === 'waiting' ? 'wait' : 'ok');
                return h('div', { key: hf.id, className: 'dm-row' },
                  h('div', { className: 'dm-row-main' },
                    h('div', { className: 'dm-row-meta' },
                      h('span', { className: 'dm-tag run' }, hf.agent),
                      h('span', { className: 'dm-tag ' + statusCls }, hf.status),
                      h('span', { className: 'dm-tag' }, hf.workspace),
                      h('span', null, formatDay(hf.ts)),
                    ),
                    h('div', { className: 'dm-row-title' }, hf.title),
                    h('div', { className: 'dm-subline' }, hf.summary),
                  ),
                );
              }),
            ),
        ) : null,

        // Tab 3: Entity Wiki & Connect
        tab === 'wiki' ? h(React.Fragment, null,
          h('form', { className: 'dm-search-box', onSubmit: runSearch },
            h('input', {
              className: 'dm-input',
              placeholder: '零向量混合检索活体记忆、实体档案与跨端交接…',
              value: searchQ,
              onChange: function (e) { setSearchQ(e.target.value); },
            }),
            h('button', { type: 'submit', className: 'dm-btn solid sm' }, '检索'),
            searchHits ? h('button', {
              type: 'button',
              className: 'dm-btn line sm',
              onClick: function () { setSearchHits(null); setSearchQ(''); },
            }, '清除') : null,
          ),

          searchHits ? h('section', { className: 'dm-section' },
            h('div', { className: 'dm-section-head' },
              h('h2', { className: 'dm-section-title' }, '混合检索结果（' + searchHits.length + ' 条）'),
            ),
            searchHits.length === 0
              ? h('div', { className: 'dm-empty' }, '未命中任何相关记忆或实体档案')
              : h('div', { className: 'dm-list' },
                searchHits.map(function (hit, idx) {
                  return h('div', { key: String(idx), className: 'dm-row' },
                    h('div', { className: 'dm-row-main' },
                      h('div', { className: 'dm-row-meta' },
                        h('span', { className: 'dm-tag run' }, hit.kind),
                        h('span', null, 'score ' + hit.score),
                      ),
                      h('div', { className: 'dm-row-title' }, hit.title),
                      hit.summary ? h('div', { className: 'dm-subline' }, hit.summary) : null,
                    ),
                  );
                }),
              ),
          ) : null,

          h('div', { className: 'dm-wiki-grid' },
            h('div', { className: 'dm-wiki-nav' },
              wikiPages.length === 0
                ? h('div', { className: 'dm-empty' }, '暂无实体档案')
                : wikiPages.map(function (p) {
                  return h('button', {
                    key: p.key,
                    type: 'button',
                    className: 'dm-wiki-item' + (activeWiki && activeWiki.key === p.key ? ' active' : ''),
                    onClick: function () { setSelectedWiki(p.key); },
                  },
                    h('div', { className: 'dm-wiki-item-t' }, p.title),
                    h('div', { className: 'dm-wiki-item-k' }, p.key),
                  );
                }),
            ),
            activeWiki ? h('article', { className: 'dm-wiki-detail' },
              h('div', { className: 'dm-head' },
                h('div', null,
                  h('div', { className: 'dm-eyebrow' }, activeWiki.key),
                  h('h2', { className: 'dm-section-title', style: { fontSize: '17px' } }, activeWiki.title),
                ),
                h('span', { className: 'dm-subline' }, formatDay(activeWiki.updatedAt)),
              ),
              h('p', null, activeWiki.summary),
              activeWiki.openItems && activeWiki.openItems.length > 0 ? h('div', null,
                h('div', { className: 'dm-eyebrow', style: { marginBottom: '4px' } }, '待决事项 (Open Items)'),
                h('ul', { style: { paddingLeft: '18px' } },
                  activeWiki.openItems.map(function (it) { return h('li', { key: it.id }, it.text); }),
                ),
              ) : null,
              activeWiki.facts && activeWiki.facts.length > 0 ? h('div', null,
                h('div', { className: 'dm-eyebrow', style: { marginBottom: '4px' } }, '近期事实 (Facts)'),
                h('ul', { style: { paddingLeft: '18px' } },
                  activeWiki.facts.map(function (it) { return h('li', { key: it.id }, it.text); }),
                ),
              ) : null,
            ) : h('div', { className: 'dm-empty' }, '点击左侧实体档案查看详情与溯源'),
          ),
        ) : null,

        // Tab 4: Local Agent Connections
        tab === 'connect' ? h(React.Fragment, null,
          h('section', { className: 'dm-section' },
            h('div', { className: 'dm-section-head', style: { flexWrap: 'wrap' } },
              h('div', null,
                h('h2', { className: 'dm-section-title' }, '本机 Agent 自动写入 & 主动读取接线'),
                h('div', { className: 'dm-subline' }, '自动写靠各端 Stop Hook（0 Token）；主动查靠标准 stdio MCP；写入前自动备份，绝不改写你的 CLAUDE.md / AGENTS.md。'),
              ),
              h('div', { className: 'dm-head-acts' },
                h('button', {
                  type: 'button',
                  className: 'dm-btn line sm',
                  'data-testid': 'dm-btn-rescan',
                  disabled: busy,
                  onClick: function () { dispatch('refresh_connections', {}, '已重新扫描本机 Agent 状态'); },
                }, '重新扫描'),
                h('button', {
                  type: 'button',
                  className: 'dm-btn solid sm',
                  'data-testid': 'dm-btn-connect-all',
                  disabled: busy || connSummary.installedCount === 0,
                  onClick: function () {
                    dispatch('connect_all_installed', {}, '已接入全部本机已安装的 Agent（若客户端已打开请重启）');
                  },
                }, '一键接入全部已装'),
              ),
            ),
            connList.length === 0
              ? h('div', { className: 'dm-empty' }, '暂未加载到本机 Agent 状态，请点「重新扫描」。')
              : h('div', { className: 'dm-list' },
                connList.map(function (ag) {
                  var anyConn = !!(ag.hookConnected || ag.mcpConnected);
                  return h('div', {
                    key: ag.id,
                    className: 'dm-conn-row' + (ag.installed ? '' : ' uninstalled'),
                    'data-testid': 'dm-conn-row-' + ag.id,
                  },
                    h('div', { className: 'dm-row-main' },
                      h('div', { className: 'dm-conn-head' },
                        h('span', { className: 'dm-row-title' }, ag.label),
                        h('span', { className: 'dm-tag ' + (ag.installed ? 'ok' : '') }, ag.installed ? '本机已安装' : '未检测到'),
                        ag.hookSupported
                          ? h('span', { className: 'dm-tag ' + (ag.hookConnected ? 'ok' : 'wait') }, ag.hookConnected ? '自动写 Hook 已接' : '自动写 Hook 未接')
                          : h('span', { className: 'dm-tag' }, '无独立 Hook'),
                        ag.mcpSupported
                          ? h('span', { className: 'dm-tag ' + (ag.mcpConnected ? 'ok' : 'wait') }, ag.mcpConnected ? '主动读 MCP 已接' : '主动读 MCP 未接')
                          : null,
                      ),
                      h('div', { className: 'dm-subline' }, ag.note),
                    ),
                    h('div', { className: 'dm-row-acts' },
                      ag.fullyConnected ? h(React.Fragment, null,
                        h('button', {
                          type: 'button',
                          className: 'dm-btn line xs',
                          'data-testid': 'dm-btn-connect-' + ag.id,
                          disabled: busy,
                          onClick: function () { dispatch('connect_agent', { agent: ag.id }, '已刷新 ' + ag.label + ' 的 Hook 与 MCP 路径'); },
                        }, '更新路径'),
                        h('button', {
                          type: 'button',
                          className: 'dm-btn danger-text xs',
                          'data-testid': 'dm-btn-disconnect-' + ag.id,
                          disabled: busy,
                          onClick: function () { dispatch('disconnect_agent', { agent: ag.id }, '已断开 ' + ag.label + ' 的接入（原配置已备份）'); },
                        }, '断开'),
                      ) : h(React.Fragment, null,
                        h('button', {
                          type: 'button',
                          className: ag.installed ? 'dm-btn solid xs' : 'dm-btn soft xs',
                          'data-testid': 'dm-btn-connect-' + ag.id,
                          disabled: busy,
                          onClick: function () { dispatch('connect_agent', { agent: ag.id }, '已接入 ' + ag.label + '（重启客户端后生效）'); },
                        }, ag.installed ? '一键接入' : '预写入'),
                        anyConn ? h('button', {
                          type: 'button',
                          className: 'dm-btn danger-text xs',
                          'data-testid': 'dm-btn-disconnect-' + ag.id,
                          disabled: busy,
                          onClick: function () { dispatch('disconnect_agent', { agent: ag.id }, '已断开 ' + ag.label + ' 的接入（原配置已备份）'); },
                        }, '断开') : null,
                      ),
                    ),
                  );
                }),
              ),
          ),

          h('details', { className: 'dm-details' },
            h('summary', null,
              h('span', null, '其他 MCP 客户端手动配置（Windsurf / Cline / Cherry Studio 等）'),
              h('span', { className: 'dm-subline' }, '展开查看 JSON 与 CLI 命令'),
            ),
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
              h('div', { className: 'dm-section-head' },
                h('span', { className: 'dm-subline' }, '标准 stdio MCP 片段（自动锁定本机稳定 Node 路径）'),
                h('button', {
                  type: 'button',
                  className: 'dm-btn line xs',
                  onClick: function () {
                    var snippet = JSON.stringify({ mcpServers: { 'dot-memory': mcpSnippetObj } }, null, 2);
                    copyText(snippet, function () { flash('已复制 MCP 配置 JSON', 'ok'); });
                  },
                }, '复制 MCP JSON'),
              ),
              h('pre', { className: 'dm-code' },
                '# 终端一键扫描与接入全部本机 Agent\n' +
                'npx @oxmumu3/dot-memory connect --agent all\n' +
                'npx @oxmumu3/dot-memory connections\n\n' +
                '# 标准 stdio MCP 入口\n' +
                JSON.stringify({ mcpServers: { 'dot-memory': mcpSnippetObj } }, null, 2),
              ),
            ),
          ),
        ) : null,
      ),
      h(EvidenceDialog, {
        item: evItem,
        onClose: function () { setEvItem(null); },
        onToggle: function (id) { dispatch('toggle_memory', { id: id }, '已切换生效状态'); },
        onRemove: function (id) { dispatch('remove_memory', { id: id }, '已移除记忆条目'); },
      }),
      h(AddDialog, {
        open: addOpen,
        onClose: function () { setAddOpen(false); },
        onSubmit: function (payload) { dispatch('add_memory', payload, '已保存至活体记忆'); },
      }),
    );
  };
}

exports.inject = ['slots', 'layout'];
exports.apply = function apply(ctx) {
  var React = loadReact();
  if (!React) return function () {};
  ensureStyleInjected();

  var Workbench = makeWorkbenchComponent(React, ctx, {});
  var Icon = makeSidebarIcon(React);

  return ctx.effect(function () {
    var cleanups = [];
    try {
      var offMain = ctx.slots.inject('main', function () {
        return ctx.slots.register({ name: 'main', key: PANEL_KEY }, Workbench);
      });
      if (typeof offMain === 'function') cleanups.push(offMain);
    } catch (_e) {}

    try {
      var offSide = ctx.slots.inject('sidebar.panellist', function () {
        return ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_KEY,
          order: 94,
          label: function () { return 'Dot 记忆总线'; },
        }, Icon);
      });
      if (typeof offSide === 'function') cleanups.push(offSide);
    } catch (_e2) {}

    return function () {
      while (cleanups.length) {
        var fn = cleanups.pop();
        try { fn(); } catch (_e3) {}
      }
    };
  });
};
