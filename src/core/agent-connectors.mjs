/**
 * Cross-Agent Connector (`agent-connectors.mjs`).
 * Auto-detects local AI coding/assistant clients (Antigravity, Claude Code, Codex,
 * Hermes Agent, WorkBuddy/CodeBuddy, Cursor) and safely wires/unwires Stop Hooks
 * and stdio MCP servers without mutating user-maintained CLAUDE.md / AGENTS.md files.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensurePrivateDir, resolveDotMemoryHome, writeFileAtomic } from './storage.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(__dirname, '../..');

export const SUPPORTED_AGENTS = Object.freeze([
  Object.freeze({ id: 'antigravity', label: 'Antigravity', hookSupported: true, mcpSupported: true }),
  Object.freeze({ id: 'claude-code', label: 'Claude Code', hookSupported: true, mcpSupported: true }),
  Object.freeze({ id: 'codex', label: 'Codex', hookSupported: true, mcpSupported: true }),
  Object.freeze({ id: 'hermes', label: 'Hermes Agent', hookSupported: true, mcpSupported: true }),
  Object.freeze({ id: 'workbuddy', label: 'WorkBuddy / CodeBuddy', hookSupported: true, mcpSupported: true }),
  Object.freeze({ id: 'cursor', label: 'Cursor', hookSupported: false, mcpSupported: true }),
]);

const AGENT_META = new Map(SUPPORTED_AGENTS.map((a) => [a.id, a]));

export function shellQuote(value) {
  const s = String(value ?? '');
  if (!s) return "''";
  if (/^[A-Za-z0-9_./:-]+$/u.test(s)) return s;
  return `'${s.replace(/'/g, "'\\''")}'`;
}

function isRegularFile(filePath) {
  try {
    return Boolean(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isElectronBinary(filePath) {
  const s = String(filePath || '');
  return s.includes('.app/Contents/MacOS/') || path.basename(s).toLowerCase().includes('electron');
}

function findStablePackageRoot(repoRoot) {
  const base = path.resolve(repoRoot || DEFAULT_REPO_ROOT);
  // If installed inside pnpm `.pnpm/.../node_modules/@oxmumu3/dot-memory`, prefer the
  // hoisted profile symlink `.../node_modules/@oxmumu3/dot-memory` when present.
  const norm = base.replace(/\\/g, '/');
  const pnpmIdx = norm.indexOf('/node_modules/.pnpm/');
  if (pnpmIdx > 0) {
    const profileNodeModules = norm.slice(0, pnpmIdx + '/node_modules'.length);
    const hoisted = path.join(profileNodeModules, '@oxmumu3', 'dot-memory');
    if (isRegularFile(path.join(hoisted, 'bin', 'dot-memory.mjs'))) {
      return hoisted;
    }
  }
  return base;
}

export function resolveRuntimePaths({
  repoRoot = DEFAULT_REPO_ROOT,
  execPath = process.execPath,
  isElectron = Boolean(process.versions?.electron),
  envPath = process.env.PATH || '',
} = {}) {
  const pkgRoot = findStablePackageRoot(repoRoot);
  const cliPath = path.join(pkgRoot, 'bin', 'dot-memory.mjs');
  const mcpPath = path.join(pkgRoot, 'bin', 'dot-memory-mcp.mjs');

  let nodeBin = '';
  if (!isElectron && execPath && !isElectronBinary(execPath)) {
    if (execPath.includes('/Cellar/node/') && isRegularFile('/opt/homebrew/bin/node')) {
      nodeBin = '/opt/homebrew/bin/node';
    } else if (isRegularFile(execPath) || path.isAbsolute(execPath)) {
      nodeBin = execPath;
    }
  }

  if (!nodeBin) {
    const candidates = [
      '/opt/homebrew/bin/node',
      '/usr/local/bin/node',
      '/usr/bin/node',
    ];
    for (const dir of String(envPath || '').split(path.delimiter)) {
      if (dir && dir.trim()) candidates.push(path.join(dir.trim(), 'node'));
    }
    if (execPath) {
      candidates.push(
        path.resolve(path.dirname(execPath), '..', 'Resources', 'runtime', 'bin', 'node'),
        path.resolve(path.dirname(execPath), '..', 'Resources', 'runtime', 'primary-runtime', 'bin', 'node'),
      );
    }
    for (const cand of candidates) {
      if (!isElectronBinary(cand) && isRegularFile(cand)) {
        nodeBin = cand;
        break;
      }
    }
  }

  if (!nodeBin || isElectronBinary(nodeBin)) {
    nodeBin = 'node';
  }

  return {
    nodeBin,
    repoRoot: pkgRoot,
    cliPath,
    mcpPath,
  };
}

function formatStamp(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

export function backupFileBeforeEdit(targetPath, { agent = 'agent', dotMemoryHome, now = new Date() } = {}) {
  if (!targetPath || !fs.existsSync(targetPath)) return null;
  const home = resolveDotMemoryHome(dotMemoryHome);
  const backupDir = ensurePrivateDir(path.join(home, 'backups'));
  const safeAgent = String(agent || 'agent').replace(/[^a-z0-9_-]+/gi, '-');
  const base = path.basename(targetPath).replace(/[^a-z0-9._-]+/gi, '_');
  let backupPath = path.join(backupDir, `${formatStamp(now)}-${safeAgent}-${base}`);
  if (fs.existsSync(backupPath)) {
    backupPath = path.join(backupDir, `${formatStamp(now)}-${Date.now()}-${safeAgent}-${base}`);
  }
  const content = fs.readFileSync(targetPath, 'utf8');
  writeFileAtomic(home, backupPath, content, 0o600);
  return backupPath;
}

function writeExternalFileAtomic(targetPath, content, mode = 0o600) {
  let finalPath = path.resolve(targetPath);
  try {
    if (fs.existsSync(finalPath) && fs.lstatSync(finalPath).isSymbolicLink()) {
      finalPath = fs.realpathSync(finalPath);
    }
  } catch {}
  const dir = path.dirname(finalPath);
  fs.mkdirSync(dir, { recursive: true });
  writeFileAtomic(dir, finalPath, content, mode);
  return finalPath;
}

function readJsonSafe(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function isDotMemoryCommandEntry(entry) {
  const s = JSON.stringify(entry || '');
  return s.includes('dot-memory.mjs') || s.includes('dot-memory handoffs');
}

function makeStopCommand(runtime, agent) {
  return `${shellQuote(runtime.nodeBin)} ${shellQuote(runtime.cliPath)} handoffs ingest-stdin --agent ${agent}`;
}

function upsertClaudeStyleStopHook(hooksObj, commandStr, extraHookFields = {}) {
  const hooks = { ...(hooksObj && typeof hooksObj === 'object' ? hooksObj : {}) };
  const existing = Array.isArray(hooks.Stop) ? [...hooks.Stop] : [];
  const nextHook = { type: 'command', command: commandStr, timeout: 10, ...extraHookFields };

  let replaced = false;
  const updated = existing.map((group) => {
    if (group && Array.isArray(group.hooks) && group.hooks.some(isDotMemoryCommandEntry)) {
      replaced = true;
      return {
        ...group,
        hooks: group.hooks.map((h) => (isDotMemoryCommandEntry(h) ? { ...h, ...nextHook } : h)),
      };
    }
    if (isDotMemoryCommandEntry(group)) {
      replaced = true;
      return { hooks: [nextHook] };
    }
    return group;
  });

  if (!replaced) {
    updated.push({ hooks: [nextHook] });
  }
  hooks.Stop = updated;
  return hooks;
}

function removeClaudeStyleStopHook(hooksObj) {
  if (!hooksObj || typeof hooksObj !== 'object') return hooksObj;
  const hooks = { ...hooksObj };
  if (!Array.isArray(hooks.Stop)) return hooks;
  const nextStop = hooks.Stop.map((group) => {
    if (group && Array.isArray(group.hooks)) {
      const kept = group.hooks.filter((h) => !isDotMemoryCommandEntry(h));
      return kept.length > 0 ? { ...group, hooks: kept } : null;
    }
    return isDotMemoryCommandEntry(group) ? null : group;
  }).filter(Boolean);

  if (nextStop.length > 0) hooks.Stop = nextStop;
  else delete hooks.Stop;
  return hooks;
}

function resolveWorkbuddyRoot(homeDir) {
  for (const name of ['.workbuddy-ai', '.workbuddy', '.codebuddy']) {
    const dir = path.join(homeDir, name);
    if (fs.existsSync(dir)) return { dir, installed: true };
  }
  return { dir: path.join(homeDir, '.codebuddy'), installed: false };
}

function resolveWorkbuddyMcpPath(wbRoot) {
  const dotMcp = path.join(wbRoot, '.mcp.json');
  const plainMcp = path.join(wbRoot, 'mcp.json');
  if (fs.existsSync(dotMcp) && !fs.existsSync(plainMcp)) return dotMcp;
  return plainMcp;
}

function detectCodexMcpConnected(tomlText) {
  return /^\s*\[mcp_servers\.(?:"dot-memory"|dot-memory)\]\s*(?:#.*)?$/m.test(String(tomlText || ''));
}

function upsertCodexMcpToml(tomlText, runtime) {
  const sectionBlock = [
    '[mcp_servers.dot-memory]',
    `command = ${JSON.stringify(runtime.nodeBin)}`,
    `args = [${JSON.stringify(runtime.mcpPath)}]`,
  ];
  const raw = String(tomlText || '');
  if (!raw.trim()) return sectionBlock.join('\n') + '\n';

  const lines = raw.split(/\r?\n/);
  const headerRe = /^\s*\[([^\]]+)\]\s*(?:#.*)?$/;
  const targetHeaderRe = /^\s*\[mcp_servers\.(?:"dot-memory"|dot-memory)\]\s*(?:#.*)?$/;

  let start = -1;
  let end = lines.length;
  for (let i = 0; i < lines.length; i += 1) {
    if (start < 0) {
      if (targetHeaderRe.test(lines[i])) start = i;
    } else if (headerRe.test(lines[i])) {
      end = i;
      break;
    }
  }

  if (start >= 0) {
    const out = [
      ...lines.slice(0, start),
      ...sectionBlock,
      ...(end < lines.length ? [''] : []),
      ...lines.slice(end),
    ];
    return out.join('\n').replace(/\n*$/, '\n');
  }

  return raw.replace(/\s*$/, '\n\n') + sectionBlock.join('\n') + '\n';
}

function removeCodexMcpToml(tomlText) {
  const raw = String(tomlText || '');
  const lines = raw.split(/\r?\n/);
  const headerRe = /^\s*\[([^\]]+)\]\s*(?:#.*)?$/;
  const targetHeaderRe = /^\s*\[mcp_servers\.(?:"dot-memory"|dot-memory)\]\s*(?:#.*)?$/;

  let start = -1;
  let end = lines.length;
  for (let i = 0; i < lines.length; i += 1) {
    if (start < 0) {
      if (targetHeaderRe.test(lines[i])) start = i;
    } else if (headerRe.test(lines[i])) {
      end = i;
      break;
    }
  }
  if (start < 0) return raw;
  const out = [...lines.slice(0, start), ...lines.slice(end)];
  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n*$/, '\n');
}

function findHermesTopMcpServersBlock(lines) {
  const topKeyRe = /^mcp_servers\s*:(.*)$/;
  let start = -1;
  let inlineEmpty = false;
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(topKeyRe);
    if (m) {
      start = i;
      const tail = (m[1] || '').replace(/#.*$/, '').trim();
      inlineEmpty = tail === '{}' || tail === 'null' || tail === '~';
      break;
    }
  }
  if (start < 0) return null;
  if (inlineEmpty) return { start, end: start + 1, inlineEmpty: true };

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line)) continue;
    if (/^[^\s#]/.test(line)) {
      end = i;
      break;
    }
  }
  return { start, end, inlineEmpty: false };
}

function detectHermesMcpConnected(yamlText) {
  const lines = String(yamlText || '').split(/\r?\n/);
  const block = findHermesTopMcpServersBlock(lines);
  if (!block || block.inlineEmpty) return false;
  for (let i = block.start + 1; i < block.end; i += 1) {
    if (/^\s{1,4}["']?dot-memory["']?\s*:/.test(lines[i])) return true;
  }
  return false;
}

function buildHermesDotMemoryLines(runtime) {
  return [
    '  dot-memory:',
    `    command: ${JSON.stringify(runtime.nodeBin)}`,
    '    args:',
    `      - ${JSON.stringify(runtime.mcpPath)}`,
    '    enabled: true',
  ];
}

function upsertHermesMcpYaml(yamlText, runtime) {
  const raw = String(yamlText || '');
  const entryLines = buildHermesDotMemoryLines(runtime);
  if (!raw.trim()) {
    return ['mcp_servers:', ...entryLines].join('\n') + '\n';
  }

  const lines = raw.split(/\r?\n/);
  const block = findHermesTopMcpServersBlock(lines);
  if (!block) {
    return raw.replace(/\s*$/, '\n\n') + ['mcp_servers:', ...entryLines].join('\n') + '\n';
  }
  if (block.inlineEmpty) {
    const out = [
      ...lines.slice(0, block.start),
      'mcp_servers:',
      ...entryLines,
      ...lines.slice(block.end),
    ];
    return out.join('\n').replace(/\n*$/, '\n');
  }

  // Locate existing `  dot-memory:` inside top-level `mcp_servers:`
  let subStart = -1;
  let subEnd = block.end;
  let baseIndent = 2;
  for (let i = block.start + 1; i < block.end; i += 1) {
    const m = lines[i].match(/^(\s+)["']?dot-memory["']?\s*:/);
    if (m) {
      subStart = i;
      baseIndent = m[1].length;
      break;
    }
  }

  if (subStart >= 0) {
    for (let j = subStart + 1; j < block.end; j += 1) {
      const l = lines[j];
      if (!l.trim() || /^\s*#/.test(l)) continue;
      const indent = (l.match(/^(\s*)/) || ['', ''])[1].length;
      if (indent <= baseIndent) {
        subEnd = j;
        break;
      }
    }
    const out = [
      ...lines.slice(0, subStart),
      ...entryLines,
      ...lines.slice(subEnd),
    ];
    return out.join('\n').replace(/\n*$/, '\n');
  }

  // Insert before trailing blank lines of `mcp_servers` block
  let insertAt = block.end;
  while (insertAt > block.start + 1 && !lines[insertAt - 1].trim()) {
    insertAt -= 1;
  }
  const out = [
    ...lines.slice(0, insertAt),
    ...entryLines,
    ...lines.slice(insertAt),
  ];
  return out.join('\n').replace(/\n*$/, '\n');
}

function removeHermesMcpYaml(yamlText) {
  const raw = String(yamlText || '');
  const lines = raw.split(/\r?\n/);
  const block = findHermesTopMcpServersBlock(lines);
  if (!block || block.inlineEmpty) return raw;

  let subStart = -1;
  let subEnd = block.end;
  let baseIndent = 2;
  for (let i = block.start + 1; i < block.end; i += 1) {
    const m = lines[i].match(/^(\s+)["']?dot-memory["']?\s*:/);
    if (m) {
      subStart = i;
      baseIndent = m[1].length;
      break;
    }
  }
  if (subStart < 0) return raw;

  for (let j = subStart + 1; j < block.end; j += 1) {
    const l = lines[j];
    if (!l.trim() || /^\s*#/.test(l)) continue;
    const indent = (l.match(/^(\s*)/) || ['', ''])[1].length;
    if (indent <= baseIndent) {
      subEnd = j;
      break;
    }
  }

  const remainingContent = [...lines.slice(block.start + 1, subStart), ...lines.slice(subEnd, block.end)]
    .some((l) => l.trim() && !/^\s*#/.test(l));

  const out = remainingContent
    ? [...lines.slice(0, subStart), ...lines.slice(subEnd)]
    : [...lines.slice(0, block.start), 'mcp_servers: {}', ...lines.slice(block.end)];
  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n*$/, '\n');
}

function buildHermesHookFiles(runtime) {
  const hookYaml = [
    'name: dot-memory-handoff',
    'description: Record substantive Hermes Agent turns into @oxmumu3/dot-memory handoff bus',
    'events:',
    '  - agent:end',
    '  - session:end',
    '',
  ].join('\n');

  const handlerPy = [
    '"""@oxmumu3/dot-memory Hermes gateway hook (auto-generated)."""',
    '',
    'import json',
    'import subprocess',
    '',
    `NODE_BIN = ${JSON.stringify(runtime.nodeBin)}`,
    `CLI_PATH = ${JSON.stringify(runtime.cliPath)}`,
    '',
    '',
    'async def handle(event_type, context):',
    '    if not isinstance(context, dict):',
    '        return',
    '    try:',
    '        response = str(context.get("response") or context.get("summary") or "").strip()',
    '        if event_type == "session:end" and not response:',
    '            return',
    '        payload = {',
    '            "eventType": str(event_type or "agent:end"),',
    '            "session_key": str(context.get("session_key") or context.get("session_id") or context.get("chat_id") or "hermes"),',
    '            "platform": str(context.get("platform") or "hermes"),',
    '            "workspace": str(context.get("workspace") or context.get("platform") or "hermes"),',
    '            "workspacePath": str(context.get("cwd") or context.get("workspace_path") or ""),',
    '            "user_message": str(context.get("user_message") or context.get("message") or context.get("prompt") or ""),',
    '            "response": response,',
    '            "explicit": len(response.encode("utf-8")) >= 160,',
    '        }',
    '        subprocess.run(',
    '            [NODE_BIN, CLI_PATH, "handoffs", "ingest-stdin", "--agent", "hermes"],',
    '            input=json.dumps(payload, ensure_ascii=False),',
    '            text=True,',
    '            timeout=8,',
    '            stdout=subprocess.DEVNULL,',
    '            stderr=subprocess.DEVNULL,',
    '            check=False,',
    '        )',
    '    except Exception:',
    '        pass',
    '',
  ].join('\n');

  return { hookYaml, handlerPy };
}

export function detectAgentConnections({
  homeDir = os.homedir(),
  dotMemoryHome,
  runtime,
} = {}) {
  const home = path.resolve(homeDir || os.homedir());
  const rt = runtime || resolveRuntimePaths();
  const agents = [];

  // 1. Antigravity
  {
    const hookTarget = path.join(home, '.gemini', 'config', 'plugins', 'dot-memory-bridge', 'hooks.json');
    const mcpTarget = path.join(home, '.gemini', 'config', 'mcp_config.json');
    const altMcpTarget = path.join(home, '.gemini', 'antigravity', 'mcp_config.json');
    const installed = fs.existsSync(path.join(home, '.gemini'));
    const hookConnected = fs.existsSync(hookTarget) && isDotMemoryCommandEntry(fs.readFileSync(hookTarget, 'utf8'));
    const mcpPrimary = readJsonSafe(mcpTarget, {});
    const mcpAlt = readJsonSafe(altMcpTarget, {});
    const mcpConnected = Boolean(mcpPrimary?.mcpServers?.['dot-memory'] || mcpAlt?.mcpServers?.['dot-memory']);
    agents.push({
      id: 'antigravity',
      label: AGENT_META.get('antigravity').label,
      installed,
      hookSupported: true,
      hookConnected,
      mcpSupported: true,
      mcpConnected,
      fullyConnected: hookConnected && mcpConnected,
      hookTarget,
      mcpTarget,
      note: 'Hook 写入 ~/.gemini/config/plugins/dot-memory-bridge/，MCP 写入 ~/.gemini/config/mcp_config.json',
    });
  }

  // 2. Claude Code
  {
    const hookTarget = path.join(home, '.claude', 'settings.json');
    const mcpTarget = path.join(home, '.claude.json');
    const installed = fs.existsSync(path.join(home, '.claude')) || fs.existsSync(mcpTarget);
    const settings = readJsonSafe(hookTarget, {});
    const claudeJson = readJsonSafe(mcpTarget, {});
    const hookConnected = isDotMemoryCommandEntry(settings?.hooks?.Stop || []);
    const mcpConnected = Boolean(claudeJson?.mcpServers?.['dot-memory'] || settings?.mcpServers?.['dot-memory']);
    agents.push({
      id: 'claude-code',
      label: AGENT_META.get('claude-code').label,
      installed,
      hookSupported: true,
      hookConnected,
      mcpSupported: true,
      mcpConnected,
      fullyConnected: hookConnected && mcpConnected,
      hookTarget,
      mcpTarget,
      note: 'Hook 写入 ~/.claude/settings.json，MCP 写入 ~/.claude.json（不改动 CLAUDE.md）',
    });
  }

  // 3. Codex
  {
    const hookTarget = path.join(home, '.codex', 'hooks.json');
    const mcpTarget = path.join(home, '.codex', 'config.toml');
    const installed = fs.existsSync(path.join(home, '.codex'));
    const hooksDoc = readJsonSafe(hookTarget, {});
    const hookConnected = isDotMemoryCommandEntry(hooksDoc?.hooks?.Stop || []);
    const tomlText = fs.existsSync(mcpTarget) ? fs.readFileSync(mcpTarget, 'utf8') : '';
    const mcpConnected = detectCodexMcpConnected(tomlText);
    agents.push({
      id: 'codex',
      label: AGENT_META.get('codex').label,
      installed,
      hookSupported: true,
      hookConnected,
      mcpSupported: true,
      mcpConnected,
      fullyConnected: hookConnected && mcpConnected,
      hookTarget,
      mcpTarget,
      note: '首次触发 Stop Hook 时请在 Codex 点击允许一次；MCP 写入 ~/.codex/config.toml',
    });
  }

  // 4. Hermes Agent
  {
    const hookDir = path.join(home, '.hermes', 'hooks', 'dot-memory-handoff');
    const hookTarget = path.join(hookDir, 'HOOK.yaml');
    const handlerPath = path.join(hookDir, 'handler.py');
    const mcpTarget = path.join(home, '.hermes', 'config.yaml');
    const installed = fs.existsSync(path.join(home, '.hermes'));
    const hookConnected = fs.existsSync(hookTarget) && fs.existsSync(handlerPath);
    const yamlText = fs.existsSync(mcpTarget) ? fs.readFileSync(mcpTarget, 'utf8') : '';
    const mcpConnected = detectHermesMcpConnected(yamlText);
    agents.push({
      id: 'hermes',
      label: AGENT_META.get('hermes').label,
      installed,
      hookSupported: true,
      hookConnected,
      mcpSupported: true,
      mcpConnected,
      fullyConnected: hookConnected && mcpConnected,
      hookTarget,
      mcpTarget,
      note: 'Hook 监听 agent:end / session:end，MCP 写入 ~/.hermes/config.yaml 顶层 mcp_servers',
    });
  }

  // 5. WorkBuddy / CodeBuddy
  {
    const wb = resolveWorkbuddyRoot(home);
    const hookTarget = path.join(wb.dir, 'settings.json');
    const mcpTarget = resolveWorkbuddyMcpPath(wb.dir);
    const settings = readJsonSafe(hookTarget, {});
    const mcpDoc = readJsonSafe(mcpTarget, {});
    const hookConnected = isDotMemoryCommandEntry(settings?.hooks?.Stop || []);
    const mcpConnected = Boolean(mcpDoc?.mcpServers?.['dot-memory']);
    agents.push({
      id: 'workbuddy',
      label: AGENT_META.get('workbuddy').label,
      installed: wb.installed,
      hookSupported: true,
      hookConnected,
      mcpSupported: true,
      mcpConnected,
      fullyConnected: hookConnected && mcpConnected,
      hookTarget,
      mcpTarget,
      note: '兼容 ~/.workbuddy-ai / ~/.workbuddy / ~/.codebuddy（不改动规则 MD）',
    });
  }

  // 6. Cursor
  {
    const mcpTarget = path.join(home, '.cursor', 'mcp.json');
    const installed = fs.existsSync(path.join(home, '.cursor'));
    const mcpDoc = readJsonSafe(mcpTarget, {});
    const mcpConnected = Boolean(mcpDoc?.mcpServers?.['dot-memory']);
    agents.push({
      id: 'cursor',
      label: AGENT_META.get('cursor').label,
      installed,
      hookSupported: false,
      hookConnected: false,
      mcpSupported: true,
      mcpConnected,
      fullyConnected: mcpConnected,
      hookTarget: null,
      mcpTarget,
      note: 'Cursor 通过 ~/.cursor/mcp.json 提供 stdio MCP 读写与主动记录（无独立 Stop Hook）',
    });
  }

  // Sort installed first while preserving canonical order
  const orderIndex = new Map(SUPPORTED_AGENTS.map((a, idx) => [a.id, idx]));
  agents.sort((a, b) => {
    if (a.installed !== b.installed) return a.installed ? -1 : 1;
    return (orderIndex.get(a.id) ?? 99) - (orderIndex.get(b.id) ?? 99);
  });

  const installedAgents = agents.filter((a) => a.installed);
  const connectedCount = installedAgents.filter((a) => a.fullyConnected).length;
  const partialCount = installedAgents.filter((a) => !a.fullyConnected && (a.hookConnected || a.mcpConnected)).length;
  const unconnectedInstalled = installedAgents.filter((a) => !a.fullyConnected).map((a) => a.id);

  return {
    dotMemoryHome: resolveDotMemoryHome(dotMemoryHome),
    agents,
    summary: {
      total: agents.length,
      installedCount: installedAgents.length,
      connectedCount,
      partialCount,
      unconnectedInstalled,
    },
    snippets: {
      mcpServer: {
        command: rt.nodeBin,
        args: [rt.mcpPath],
      },
      cliCommand: `${shellQuote(rt.nodeBin)} ${shellQuote(rt.cliPath)}`,
    },
  };
}

export function connectAgent({
  agent,
  homeDir = os.homedir(),
  dotMemoryHome,
  dryRun = false,
  runtime,
} = {}) {
  const id = String(agent || '').trim().toLowerCase();
  if (!AGENT_META.has(id)) {
    throw new Error(`Unsupported agent: ${agent}. Expected one of: ${SUPPORTED_AGENTS.map((a) => a.id).join(' | ')}`);
  }

  const home = path.resolve(homeDir || os.homedir());
  const dmHome = resolveDotMemoryHome(dotMemoryHome);
  const rt = runtime || resolveRuntimePaths();
  const backups = [];
  const modified = [];

  const doBackup = (filePath) => {
    if (dryRun || !fs.existsSync(filePath)) return;
    const b = backupFileBeforeEdit(filePath, { agent: id, dotMemoryHome: dmHome });
    if (b) backups.push(b);
  };

  if (id === 'antigravity') {
    const pluginDir = path.join(home, '.gemini', 'config', 'plugins', 'dot-memory-bridge');
    const pluginJsonPath = path.join(pluginDir, 'plugin.json');
    const hooksJsonPath = path.join(pluginDir, 'hooks.json');
    const mcpTarget = path.join(home, '.gemini', 'config', 'mcp_config.json');

    const pluginDoc = {
      name: 'dot-memory-bridge',
      version: '0.2.0',
      description: 'Record substantive Antigravity turn handoffs into @oxmumu3/dot-memory',
    };
    const hooksDoc = {
      'dot-memory-stop': {
        Stop: [{
          type: 'command',
          command: makeStopCommand(rt, 'antigravity'),
          timeout: 10,
        }],
      },
    };
    const currentMcp = readJsonSafe(mcpTarget, {});
    const nextMcp = {
      ...currentMcp,
      mcpServers: {
        ...(currentMcp.mcpServers && typeof currentMcp.mcpServers === 'object' ? currentMcp.mcpServers : {}),
        'dot-memory': { command: rt.nodeBin, args: [rt.mcpPath] },
      },
    };

    if (!dryRun) {
      doBackup(hooksJsonPath);
      doBackup(mcpTarget);
      writeExternalFileAtomic(pluginJsonPath, JSON.stringify(pluginDoc, null, 2) + '\n', 0o644);
      writeExternalFileAtomic(hooksJsonPath, JSON.stringify(hooksDoc, null, 2) + '\n', 0o644);
      writeExternalFileAtomic(mcpTarget, JSON.stringify(nextMcp, null, 2) + '\n', 0o600);
    }
    modified.push(hooksJsonPath, mcpTarget);
  } else if (id === 'claude-code') {
    const settingsPath = path.join(home, '.claude', 'settings.json');
    const claudeJsonPath = path.join(home, '.claude.json');

    const currentSettings = readJsonSafe(settingsPath, {});
    const nextHooks = upsertClaudeStyleStopHook(currentSettings.hooks, makeStopCommand(rt, 'claude-code'));
    const nextSettings = { ...currentSettings, hooks: nextHooks };
    if (nextSettings.mcpServers && typeof nextSettings.mcpServers === 'object' && nextSettings.mcpServers['dot-memory']) {
      nextSettings.mcpServers = {
        ...nextSettings.mcpServers,
        'dot-memory': { command: rt.nodeBin, args: [rt.mcpPath] },
      };
    }

    const currentClaude = readJsonSafe(claudeJsonPath, {});
    const nextClaude = {
      ...currentClaude,
      mcpServers: {
        ...(currentClaude.mcpServers && typeof currentClaude.mcpServers === 'object' ? currentClaude.mcpServers : {}),
        'dot-memory': { command: rt.nodeBin, args: [rt.mcpPath] },
      },
    };

    if (!dryRun) {
      doBackup(settingsPath);
      doBackup(claudeJsonPath);
      writeExternalFileAtomic(settingsPath, JSON.stringify(nextSettings, null, 2) + '\n', 0o600);
      writeExternalFileAtomic(claudeJsonPath, JSON.stringify(nextClaude, null, 2) + '\n', 0o600);
    }
    modified.push(settingsPath, claudeJsonPath);
  } else if (id === 'codex') {
    const hooksPath = path.join(home, '.codex', 'hooks.json');
    const tomlPath = path.join(home, '.codex', 'config.toml');

    const currentHooks = readJsonSafe(hooksPath, {});
    const nextHooks = upsertClaudeStyleStopHook(
      currentHooks.hooks,
      makeStopCommand(rt, 'codex'),
      { statusMessage: 'Recording Dot Memory handoff' },
    );
    const nextHooksDoc = { ...currentHooks, hooks: nextHooks };
    const currentToml = fs.existsSync(tomlPath) ? fs.readFileSync(tomlPath, 'utf8') : '';
    const nextToml = upsertCodexMcpToml(currentToml, rt);

    if (!dryRun) {
      doBackup(hooksPath);
      doBackup(tomlPath);
      writeExternalFileAtomic(hooksPath, JSON.stringify(nextHooksDoc, null, 2) + '\n', 0o600);
      writeExternalFileAtomic(tomlPath, nextToml, 0o600);
    }
    modified.push(hooksPath, tomlPath);
  } else if (id === 'hermes') {
    const hookDir = path.join(home, '.hermes', 'hooks', 'dot-memory-handoff');
    const hookYamlPath = path.join(hookDir, 'HOOK.yaml');
    const handlerPyPath = path.join(hookDir, 'handler.py');
    const configYamlPath = path.join(home, '.hermes', 'config.yaml');

    const { hookYaml, handlerPy } = buildHermesHookFiles(rt);
    const currentYaml = fs.existsSync(configYamlPath) ? fs.readFileSync(configYamlPath, 'utf8') : '';
    const nextYaml = upsertHermesMcpYaml(currentYaml, rt);

    if (!dryRun) {
      doBackup(hookYamlPath);
      doBackup(handlerPyPath);
      doBackup(configYamlPath);
      writeExternalFileAtomic(hookYamlPath, hookYaml, 0o644);
      writeExternalFileAtomic(handlerPyPath, handlerPy, 0o644);
      writeExternalFileAtomic(configYamlPath, nextYaml, 0o600);
    }
    modified.push(hookYamlPath, handlerPyPath, configYamlPath);
  } else if (id === 'workbuddy') {
    const wb = resolveWorkbuddyRoot(home);
    const settingsPath = path.join(wb.dir, 'settings.json');
    const mcpPath = resolveWorkbuddyMcpPath(wb.dir);

    const currentSettings = readJsonSafe(settingsPath, {});
    const nextSettings = {
      ...currentSettings,
      hooks: upsertClaudeStyleStopHook(currentSettings.hooks, makeStopCommand(rt, 'workbuddy')),
    };
    const currentMcp = readJsonSafe(mcpPath, {});
    const nextMcp = {
      ...currentMcp,
      mcpServers: {
        ...(currentMcp.mcpServers && typeof currentMcp.mcpServers === 'object' ? currentMcp.mcpServers : {}),
        'dot-memory': { type: 'stdio', command: rt.nodeBin, args: [rt.mcpPath] },
      },
    };

    if (!dryRun) {
      doBackup(settingsPath);
      doBackup(mcpPath);
      writeExternalFileAtomic(settingsPath, JSON.stringify(nextSettings, null, 2) + '\n', 0o600);
      writeExternalFileAtomic(mcpPath, JSON.stringify(nextMcp, null, 2) + '\n', 0o600);
    }
    modified.push(settingsPath, mcpPath);
  } else if (id === 'cursor') {
    const mcpPath = path.join(home, '.cursor', 'mcp.json');
    const currentMcp = readJsonSafe(mcpPath, {});
    const nextMcp = {
      ...currentMcp,
      mcpServers: {
        ...(currentMcp.mcpServers && typeof currentMcp.mcpServers === 'object' ? currentMcp.mcpServers : {}),
        'dot-memory': { command: rt.nodeBin, args: [rt.mcpPath] },
      },
    };
    if (!dryRun) {
      doBackup(mcpPath);
      writeExternalFileAtomic(mcpPath, JSON.stringify(nextMcp, null, 2) + '\n', 0o600);
    }
    modified.push(mcpPath);
  }

  const snapshot = detectAgentConnections({ homeDir: home, dotMemoryHome: dmHome, runtime: rt });
  const status = snapshot.agents.find((a) => a.id === id);

  return {
    ok: true,
    agent: id,
    dryRun,
    hookAdded: Boolean(status?.hookSupported && (dryRun || status?.hookConnected)),
    mcpConfigured: Boolean(status?.mcpSupported && (dryRun || status?.mcpConnected)),
    modified,
    backups,
    target: modified[0],
    note: status?.note || '',
    connections: snapshot,
  };
}

export function connectAllInstalled({
  homeDir = os.homedir(),
  dotMemoryHome,
  dryRun = false,
  runtime,
} = {}) {
  const home = path.resolve(homeDir || os.homedir());
  const dmHome = resolveDotMemoryHome(dotMemoryHome);
  const rt = runtime || resolveRuntimePaths();
  const initial = detectAgentConnections({ homeDir: home, dotMemoryHome: dmHome, runtime: rt });
  const results = [];

  for (const ag of initial.agents) {
    if (!ag.installed) continue;
    results.push(connectAgent({ agent: ag.id, homeDir: home, dotMemoryHome: dmHome, dryRun, runtime: rt }));
  }

  const connections = detectAgentConnections({ homeDir: home, dotMemoryHome: dmHome, runtime: rt });
  return {
    ok: true,
    dryRun,
    connectedAgents: results.map((r) => r.agent),
    skippedAgents: initial.agents.filter((a) => !a.installed).map((a) => a.id),
    results,
    connections,
  };
}

export function disconnectAgent({
  agent,
  homeDir = os.homedir(),
  dotMemoryHome,
  dryRun = false,
} = {}) {
  const id = String(agent || '').trim().toLowerCase();
  if (!AGENT_META.has(id)) {
    throw new Error(`Unsupported agent: ${agent}. Expected one of: ${SUPPORTED_AGENTS.map((a) => a.id).join(' | ')}`);
  }

  const home = path.resolve(homeDir || os.homedir());
  const dmHome = resolveDotMemoryHome(dotMemoryHome);
  const backups = [];
  const modified = [];

  const doBackup = (filePath) => {
    if (dryRun || !fs.existsSync(filePath)) return;
    const b = backupFileBeforeEdit(filePath, { agent: `${id}-disconnect`, dotMemoryHome: dmHome });
    if (b) backups.push(b);
  };

  if (id === 'antigravity') {
    const pluginDir = path.join(home, '.gemini', 'config', 'plugins', 'dot-memory-bridge');
    const hooksPath = path.join(pluginDir, 'hooks.json');
    const mcpTarget = path.join(home, '.gemini', 'config', 'mcp_config.json');
    const altMcpTarget = path.join(home, '.gemini', 'antigravity', 'mcp_config.json');

    if (!dryRun) {
      doBackup(hooksPath);
      if (fs.existsSync(pluginDir)) {
        fs.rmSync(pluginDir, { recursive: true, force: true });
      }
      for (const target of [mcpTarget, altMcpTarget]) {
        if (!fs.existsSync(target)) continue;
        const doc = readJsonSafe(target, {});
        if (doc.mcpServers && Object.prototype.hasOwnProperty.call(doc.mcpServers, 'dot-memory')) {
          doBackup(target);
          const nextServers = { ...doc.mcpServers };
          delete nextServers['dot-memory'];
          writeExternalFileAtomic(target, JSON.stringify({ ...doc, mcpServers: nextServers }, null, 2) + '\n', 0o600);
          modified.push(target);
        }
      }
    }
    modified.push(pluginDir);
  } else if (id === 'claude-code') {
    const settingsPath = path.join(home, '.claude', 'settings.json');
    const claudeJsonPath = path.join(home, '.claude.json');

    if (!dryRun && fs.existsSync(settingsPath)) {
      const settings = readJsonSafe(settingsPath, {});
      let changed = false;
      const next = { ...settings };
      if (settings.hooks && isDotMemoryCommandEntry(settings.hooks.Stop || [])) {
        next.hooks = removeClaudeStyleStopHook(settings.hooks);
        changed = true;
      }
      if (settings.mcpServers && Object.prototype.hasOwnProperty.call(settings.mcpServers, 'dot-memory')) {
        const nextServers = { ...settings.mcpServers };
        delete nextServers['dot-memory'];
        next.mcpServers = nextServers;
        changed = true;
      }
      if (changed) {
        doBackup(settingsPath);
        writeExternalFileAtomic(settingsPath, JSON.stringify(next, null, 2) + '\n', 0o600);
        modified.push(settingsPath);
      }
    }

    if (!dryRun && fs.existsSync(claudeJsonPath)) {
      const claudeDoc = readJsonSafe(claudeJsonPath, {});
      if (claudeDoc.mcpServers && Object.prototype.hasOwnProperty.call(claudeDoc.mcpServers, 'dot-memory')) {
        doBackup(claudeJsonPath);
        const nextServers = { ...claudeDoc.mcpServers };
        delete nextServers['dot-memory'];
        writeExternalFileAtomic(claudeJsonPath, JSON.stringify({ ...claudeDoc, mcpServers: nextServers }, null, 2) + '\n', 0o600);
        modified.push(claudeJsonPath);
      }
    }
  } else if (id === 'codex') {
    const hooksPath = path.join(home, '.codex', 'hooks.json');
    const tomlPath = path.join(home, '.codex', 'config.toml');

    if (!dryRun && fs.existsSync(hooksPath)) {
      const doc = readJsonSafe(hooksPath, {});
      if (doc.hooks && isDotMemoryCommandEntry(doc.hooks.Stop || [])) {
        doBackup(hooksPath);
        writeExternalFileAtomic(hooksPath, JSON.stringify({ ...doc, hooks: removeClaudeStyleStopHook(doc.hooks) }, null, 2) + '\n', 0o600);
        modified.push(hooksPath);
      }
    }
    if (!dryRun && fs.existsSync(tomlPath)) {
      const raw = fs.readFileSync(tomlPath, 'utf8');
      if (detectCodexMcpConnected(raw)) {
        doBackup(tomlPath);
        writeExternalFileAtomic(tomlPath, removeCodexMcpToml(raw), 0o600);
        modified.push(tomlPath);
      }
    }
  } else if (id === 'hermes') {
    const hookDir = path.join(home, '.hermes', 'hooks', 'dot-memory-handoff');
    const hookYamlPath = path.join(hookDir, 'HOOK.yaml');
    const configYamlPath = path.join(home, '.hermes', 'config.yaml');

    if (!dryRun) {
      doBackup(hookYamlPath);
      if (fs.existsSync(hookDir)) {
        fs.rmSync(hookDir, { recursive: true, force: true });
        modified.push(hookDir);
      }
      if (fs.existsSync(configYamlPath)) {
        const raw = fs.readFileSync(configYamlPath, 'utf8');
        if (detectHermesMcpConnected(raw)) {
          doBackup(configYamlPath);
          writeExternalFileAtomic(configYamlPath, removeHermesMcpYaml(raw), 0o600);
          modified.push(configYamlPath);
        }
      }
    }
  } else if (id === 'workbuddy') {
    const wb = resolveWorkbuddyRoot(home);
    const settingsPath = path.join(wb.dir, 'settings.json');
    const mcpTargets = [path.join(wb.dir, 'mcp.json'), path.join(wb.dir, '.mcp.json')];

    if (!dryRun && fs.existsSync(settingsPath)) {
      const settings = readJsonSafe(settingsPath, {});
      if (settings.hooks && isDotMemoryCommandEntry(settings.hooks.Stop || [])) {
        doBackup(settingsPath);
        writeExternalFileAtomic(settingsPath, JSON.stringify({ ...settings, hooks: removeClaudeStyleStopHook(settings.hooks) }, null, 2) + '\n', 0o600);
        modified.push(settingsPath);
      }
    }
    for (const mcpPath of mcpTargets) {
      if (!dryRun && fs.existsSync(mcpPath)) {
        const doc = readJsonSafe(mcpPath, {});
        if (doc.mcpServers && Object.prototype.hasOwnProperty.call(doc.mcpServers, 'dot-memory')) {
          doBackup(mcpPath);
          const nextServers = { ...doc.mcpServers };
          delete nextServers['dot-memory'];
          writeExternalFileAtomic(mcpPath, JSON.stringify({ ...doc, mcpServers: nextServers }, null, 2) + '\n', 0o600);
          modified.push(mcpPath);
        }
      }
    }
  } else if (id === 'cursor') {
    const mcpPath = path.join(home, '.cursor', 'mcp.json');
    if (!dryRun && fs.existsSync(mcpPath)) {
      const doc = readJsonSafe(mcpPath, {});
      if (doc.mcpServers && Object.prototype.hasOwnProperty.call(doc.mcpServers, 'dot-memory')) {
        doBackup(mcpPath);
        const nextServers = { ...doc.mcpServers };
        delete nextServers['dot-memory'];
        writeExternalFileAtomic(mcpPath, JSON.stringify({ ...doc, mcpServers: nextServers }, null, 2) + '\n', 0o600);
        modified.push(mcpPath);
      }
    }
  }

  return {
    ok: true,
    agent: id,
    dryRun,
    modified,
    backups,
    connections: detectAgentConnections({ homeDir: home, dotMemoryHome: dmHome }),
  };
}
