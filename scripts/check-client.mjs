import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(rootDir, 'dist', 'client.js'), 'utf8');

if (/^\s*export\s+/m.test(code) || /^\s*import\s+/m.test(code)) {
  throw new Error('dist/client.js contains ESM import/export syntax');
}
if (!code.includes("id: '@oxmumu3/dot-memory'")) {
  throw new Error('dist/client.js missing @oxmumu3/dot-memory ModuleLoader id');
}
if (code.includes('@deepseek-ai/dsh-client-ui-primitives') || code.includes('position:absolute;inset:0')) {
  throw new Error('dist/client.js violates DSH client lesson rules');
}

let loaded = null;
const sandbox = {
  window: {
    __ModuleLoader__: {
      load(entry) { loaded = entry; },
    },
  },
  document: undefined,
  navigator: undefined,
  fetch: async () => ({ ok: true, json: async () => ({}) }),
};
vm.runInNewContext(code, sandbox, { filename: 'dist/client.js' });
if (!loaded || loaded.id !== '@oxmumu3/dot-memory' || typeof loaded.factory !== 'function') {
  throw new Error('window.__ModuleLoader__.load did not register valid factory');
}
const mod = loaded.factory(() => ({ createElement: () => null, useState: (v) => [v, () => {}], useEffect: () => {}, useRef: () => ({}), useMemo: (f) => f(), Fragment: 'fragment' }));
if (typeof mod.apply !== 'function') {
  throw new Error('Client factory did not export apply(ctx)');
}
console.log('Client bundle check PASSED');
