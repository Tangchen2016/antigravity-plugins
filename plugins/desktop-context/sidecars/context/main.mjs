// Sidecar backend for the Context Usage panel.
//
// Serves the panel and a /api/report endpoint that runs context_report.py (the
// same parser as the /context skill) on the open conversation's database. The
// model's context window and display name come from the app's live model
// catalog (GetAvailableModels), like the agy CLI.

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Response, SidecarApp } from 'sidecar_sdk';
import { createSelfUpdater } from './self_update.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = resolve(HERE, '..', '..');
const updater = createSelfUpdater({ pluginDir: PLUGIN_DIR });
const SCRIPT = join(HERE, 'context_report.py');
const GEMINI_DIR = process.env.ANTIGRAVITY_GEMINI_DIR || join(homedir(), '.gemini');
const CONVERSATIONS = join(GEMINI_DIR, 'antigravity', 'conversations');
const DATA_DIR = process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR || join(HERE, '.data');
const CATALOG_PATH = join(DATA_DIR, 'model-catalog.json');
const CATALOG_TTL_MS = 10 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const app = new SidecarApp();

// --- python -------------------------------------------------------------------

const PYTHON_CANDIDATES = process.platform === 'win32'
  ? [['python', []], ['py', ['-3']], ['python3', []]]
  : [['python3', []], ['python', []]];
let python = null;

function run(cmd, args, timeout = 20000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, {
      timeout,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      windowsHide: true,
    }, (err, stdout, stderr) => (err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout)));
  });
}

async function findPython() {
  if (python) return python;
  for (const [cmd, pre] of PYTHON_CANDIDATES) {
    try {
      const out = await run(cmd, [...pre, '--version'], 5000);
      if (/^Python 3\./.test(out.trim())) {
        python = { cmd, pre };
        return python;
      }
    } catch { /* try the next candidate */ }
  }
  throw new Error('Python 3 not found. Install it from python.org and restart Antigravity.');
}

// --- live model catalog -------------------------------------------------------

let catalogFetchedAt = 0;

function lsRequest(method, body) {
  const addr = (process.env.ANTIGRAVITY_LS_ADDRESS || '').trim();
  const csrf = (process.env.ANTIGRAVITY_CSRF_TOKEN || '').trim();
  if (!addr || !csrf) return Promise.reject(new Error('no language server address'));
  const base = new URL(addr.startsWith('http') ? addr : `http://${addr}`);
  const data = JSON.stringify(body);
  const transport = base.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request({
      hostname: base.hostname,
      port: base.port,
      path: `/exa.language_server_pb.LanguageServerService/${method}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
        'x-codeium-csrf-token': csrf,
        'Content-Length': Buffer.byteLength(data),
      },
      timeout: 5000,
      rejectUnauthorized: false,
    }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`${method}: HTTP ${res.statusCode}`));
          return;
        }
        try { resolve(JSON.parse(text)); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error(`${method}: timeout`)));
    req.on('error', reject);
    req.end(data);
  });
}

async function refreshCatalog() {
  if (Date.now() - catalogFetchedAt < CATALOG_TTL_MS && existsSync(CATALOG_PATH)) return;
  catalogFetchedAt = Date.now();
  try {
    const resp = await lsRequest('GetAvailableModels', { metadata: { ideName: 'antigravity', extensionName: 'antigravity' } });
    const models = resp?.response?.models || resp?.models || {};
    const catalog = {};
    for (const [id, m] of Object.entries(models)) {
      const maxTokens = Number(m?.maxTokens) || 0;
      if (maxTokens > 0) catalog[id] = { maxTokens, displayName: m.displayName || '' };
    }
    if (Object.keys(catalog).length) {
      mkdirSync(DATA_DIR, { recursive: true });
      writeFileSync(CATALOG_PATH, JSON.stringify(catalog));
    }
  } catch (err) {
    console.error('[context] model catalog unavailable, using built-in limits:', err.message);
  }
}

// --- report -------------------------------------------------------------------

const cache = new Map(); // conversationId -> { key, report }

function workspacePath(uri) {
  if (!uri || !uri.startsWith('file:')) return '';
  let p = decodeURIComponent(uri.replace(/^file:\/\//, ''));
  if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
  return p;
}

function fileStamp(path) {
  try {
    const s = statSync(path);
    return `${s.mtimeMs}:${s.size}`;
  } catch {
    return '-';
  }
}

async function report(conversationId, workspaceUri) {
  if (!UUID.test(conversationId || '')) {
    return { error: 'no-conversation' };
  }
  const db = join(CONVERSATIONS, `${conversationId}.db`);
  if (!existsSync(db)) {
    return { error: 'no-database' };
  }
  await refreshCatalog();
  const workspace = workspacePath(workspaceUri);
  const cfgStamps = [
    fileStamp(join(GEMINI_DIR, 'config', 'config.json')),
    fileStamp(join(GEMINI_DIR, 'config', 'mcp_config.json')),
    fileStamp(join(GEMINI_DIR, 'config', 'skills.json')),
    fileStamp(join(GEMINI_DIR, 'settings.json')),
  ];
  const key = [fileStamp(db), fileStamp(`${db}-wal`), workspace, fileStamp(CATALOG_PATH), ...cfgStamps].join('|');
  const cached = cache.get(conversationId);
  if (cached && cached.key === key) return cached.report;

  const { cmd, pre } = await findPython();
  const args = [...pre, SCRIPT, '--db', db, '--json'];
  if (existsSync(CATALOG_PATH)) args.push('--model-catalog', CATALOG_PATH);
  if (workspace) args.push('--workspace', workspace);
  const out = await run(cmd, args);
  const result = { ...JSON.parse(out), updatedAt: new Date().toISOString() };
  cache.set(conversationId, { key, report: result });
  return result;
}

// --- toggle helpers -----------------------------------------------------------

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writeJsonFile(filePath, data) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function isAllowedMcpConfig(filePath) {
  const name = basename(filePath);
  return name === 'mcp_config.json' || name === 'settings.json' || name === '.mcp.json';
}

function togglePlugin(pluginName, enabled) {
  if (!pluginName) throw new Error('缺少插件名称。');
  const cfgPath = join(GEMINI_DIR, 'config', 'config.json');
  const data = existsSync(cfgPath) ? readJsonFile(cfgPath) : {};
  if (!data.plugins || typeof data.plugins !== 'object') data.plugins = {};
  const prev = (data.plugins[pluginName] && typeof data.plugins[pluginName] === 'object') ? data.plugins[pluginName] : {};
  data.plugins[pluginName] = { ...prev, enabled: Boolean(enabled) };
  writeJsonFile(cfgPath, data);
  cache.clear();
  return { ok: true, enabled: Boolean(enabled) };
}

function toggleMcp({ name, configPath, toggleKind, pluginName, enabled }) {
  if (toggleKind === 'plugin') return togglePlugin(pluginName, enabled);
  if (toggleKind !== 'mcp_config' || !name || !configPath) {
    throw new Error('该 MCP 服务暂不支持在面板中直接切换。');
  }
  const abs = resolve(configPath);
  if (!isAllowedMcpConfig(abs) || !existsSync(abs)) {
    throw new Error('未找到对应的 MCP 配置文件。');
  }
  const data = readJsonFile(abs);
  if (!data?.mcpServers || typeof data.mcpServers[name] !== 'object') {
    throw new Error(`配置文件中未找到 MCP 服务「${name}」。`);
  }
  const entry = { ...data.mcpServers[name] };
  delete entry.enabled;
  if (enabled) {
    delete entry.disabled;
  } else {
    entry.disabled = true;
  }
  data.mcpServers[name] = entry;
  writeJsonFile(abs, data);
  cache.clear();
  return { ok: true, enabled: Boolean(enabled) };
}

function toggleSkill({ dirName, toggleKind, configPath, entryIndex, skillDir, pluginName, enabled }) {
  if (toggleKind === 'plugin') return togglePlugin(pluginName, enabled);
  if (toggleKind === 'skills_json') {
    const abs = resolve(configPath || '');
    if (basename(abs) !== 'skills.json' || !existsSync(abs)) {
      throw new Error('未找到 skills.json 配置文件。');
    }
    const data = readJsonFile(abs);
    const entry = Array.isArray(data?.entries) ? data.entries[Number(entryIndex)] : null;
    if (!entry || !dirName) throw new Error('未找到对应的技能配置项。');
    const prev = Array.isArray(entry.exclude) ? entry.exclude.filter((x) => typeof x === 'string') : [];
    const exact = `^${escapeRegex(dirName)}$`;
    let next;
    if (enabled) {
      next = prev.filter((pat) => {
        if (pat === exact || pat === dirName) return false;
        try {
          return !new RegExp(pat).test(dirName);
        } catch {
          return true;
        }
      });
    } else {
      const already = prev.some((pat) => {
        try {
          return new RegExp(pat).test(dirName);
        } catch {
          return false;
        }
      });
      next = already ? prev : [...prev, exact];
    }
    if (next.length) {
      entry.exclude = next;
    } else {
      delete entry.exclude;
    }
    writeJsonFile(abs, data);
    cache.clear();
    return { ok: true, enabled: Boolean(enabled) };
  }
  if (toggleKind === 'skill_file') {
    const absDir = resolve(skillDir || '');
    if (!absDir || basename(dirname(absDir)) !== 'skills' || !existsSync(absDir)) {
      throw new Error('未找到对应的技能目录。');
    }
    const activeFile = join(absDir, 'SKILL.md');
    const disabledFile = join(absDir, 'SKILL.md.disabled');
    if (enabled) {
      if (!existsSync(activeFile) && existsSync(disabledFile)) {
        renameSync(disabledFile, activeFile);
      }
    } else if (existsSync(activeFile)) {
      renameSync(activeFile, disabledFile);
    }
    cache.clear();
    return { ok: true, enabled: Boolean(enabled) };
  }
  throw new Error('内置技能或会话临时技能不支持停用。');
}

app.page('/', () => new Response(readFileSync(join(HERE, 'index.html'), 'utf8'), { contentType: 'text/html' }));

app.api('/api/report', async (data) => {
  try {
    return await report(data.conversationId, data.workspace);
  } catch (err) {
    return { error: 'failed', message: err.message };
  }
}, 'GET');

app.api('/api/toggle-mcp', async (data) => {
  try {
    return toggleMcp(data || {});
  } catch (err) {
    return { error: err.message || '切换 MCP 状态失败。' };
  }
}, 'POST');

app.api('/api/toggle-skill', async (data) => {
  try {
    return toggleSkill(data || {});
  } catch (err) {
    return { error: err.message || '切换技能状态失败。' };
  }
}, 'POST');

app.api('/api/version', async (data) => {
  try {
    return await updater.check({ force: Boolean(data?.force) });
  } catch (err) {
    return { error: err.message || '检查版本失败。' };
  }
}, 'POST');

app.api('/api/self-update', async () => {
  try {
    return await updater.update();
  } catch (err) {
    return { error: err.message || '更新插件失败。' };
  }
}, 'POST');

app.run();
refreshCatalog();
