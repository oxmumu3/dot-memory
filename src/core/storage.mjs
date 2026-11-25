import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
export const count = (value) => Number.isSafeInteger(value) && value >= 0;

export const within = (root, target) => {
  const rel = path.relative(root, target);
  return rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
};

export const isoDate = (value, fallback = null) => {
  if (typeof value !== 'string' && typeof value !== 'number' && !(value instanceof Date)) return fallback;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : fallback;
};

export function storageError(code, message) {
  return Object.assign(new Error(message), { code });
}

export function resolveDotMemoryHome(override) {
  if (typeof override === 'string' && override.trim()) return path.resolve(override.trim());
  if (typeof process.env.DOT_MEMORY_HOME === 'string' && process.env.DOT_MEMORY_HOME.trim()) {
    return path.resolve(process.env.DOT_MEMORY_HOME.trim());
  }
  return path.join(os.homedir(), '.local', 'share', 'dot-memory');
}

export function ensurePrivateDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  return dirPath;
}

export function assertInside(root, file) {
  const absRoot = path.resolve(root);
  const absFile = path.resolve(file);
  if (!within(absRoot, absFile)) {
    throw storageError('DOT_MEMORY_UNSAFE_PATH', '文件路径超出授权存储根目录');
  }
  const realRoot = fs.realpathSync(absRoot);
  const parent = path.dirname(absFile);
  if (fs.existsSync(parent)) {
    const realParent = fs.realpathSync(parent);
    if (!within(realRoot, realParent)) {
      throw storageError('DOT_MEMORY_UNSAFE_PATH', '路径包含越界符号链接');
    }
  }
}

export function writeFileAtomic(root, file, text, mode = 0o600) {
  const absRoot = ensurePrivateDir(path.resolve(root));
  const absFile = path.resolve(file);
  const dir = path.dirname(absFile);
  ensurePrivateDir(dir);
  assertInside(absRoot, absFile);
  const tmp = path.join(dir, `.dm-${randomUUID()}.tmp`);
  const fd = fs.openSync(tmp, 'wx', mode);
  try {
    try {
      fs.writeFileSync(fd, text, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, absFile);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

export function readSafeText(root, file, maxBytes = 8 * 1024 * 1024) {
  let fd;
  try {
    if (!fs.existsSync(root)) return null;
    assertInside(root, file);
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const info = fs.fstatSync(fd);
    if (!info.isFile() || info.nlink !== 1 || info.size > maxBytes) {
      throw storageError('DOT_MEMORY_UNSAFE_READ', '文件无法安全读取');
    }
    return fs.readFileSync(fd, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

export function readSafeJson(root, file, fallback = null) {
  const raw = readSafeText(root, file);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

const GOOGLE_SOURCES = new Set([
  'google_suite', 'finvo_gog', 'gmail', 'calendar', 'drive', 'docs', 'sheets', 'slides',
]);

export function isGoogleProtected(obj) {
  if (!obj || typeof obj !== 'object') return false;
  if (obj.privacyScope === 'google_isolated') return true;
  for (const field of [obj.source, obj.sourceKind, obj.channel, obj.provider, obj.prebakeTrigger?.source]) {
    if (typeof field === 'string' && GOOGLE_SOURCES.has(field.trim().toLowerCase())) return true;
  }
  const id = String(obj.id || obj.sessionId || '');
  if (id.startsWith('google-isolated-') || id.startsWith('dot-butler-google')) return true;
  return false;
}
