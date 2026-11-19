import { execFile } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const DEFAULT_REPO = 'Tangchen2016/antigravity-plugins';
const DEFAULT_BRANCH = 'main';
const CACHE_TTL_MS = 5 * 60 * 1000;

function compareVersions(a = '0.0.0', b = '0.0.0') {
  const pa = String(a).replace(/^v/i, '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/i, '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

function runCmd(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 60000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(String(stderr || stdout || err.message || `命令执行失败: ${cmd}`).trim()));
      resolve(String(stdout || ''));
    });
  });
}

function readManifest(pluginDir) {
  try {
    return JSON.parse(readFileSync(join(pluginDir, 'plugin.json'), 'utf8')) || {};
  } catch {
    return {};
  }
}

async function fetchMarketplace(repo, branch, force) {
  const apiUrl = `https://api.github.com/repos/${repo}/contents/marketplace.json?ref=${encodeURIComponent(branch)}`;
  const rawUrl = `https://raw.githubusercontent.com/${repo}/${branch}/marketplace.json`;
  const attempts = force
    ? [
        { url: apiUrl, headers: { Accept: 'application/vnd.github.raw', 'User-Agent': 'antigravity-plugin-updater', 'Cache-Control': 'no-cache' } },
        { url: rawUrl, headers: { 'Cache-Control': 'no-cache' } },
      ]
    : [
        { url: rawUrl, headers: { 'Cache-Control': 'no-cache' } },
        { url: apiUrl, headers: { Accept: 'application/vnd.github.raw', 'User-Agent': 'antigravity-plugin-updater', 'Cache-Control': 'no-cache' } },
      ];
  let lastErr;
  for (const { url, headers } of attempts) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(url, { signal: controller.signal, headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error('拉取远端版本信息失败');
}

export function createSelfUpdater({ pluginDir, repo = DEFAULT_REPO, branch = DEFAULT_BRANCH }) {
  let cachedRemote = null;
  let cachedAt = 0;

  function localInfo() {
    const manifest = readManifest(pluginDir);
    return {
      name: manifest.name || '',
      localVersion: manifest.version || '0.0.0',
    };
  }

  async function check({ force = false } = {}) {
    const { name, localVersion } = localInfo();
    if (!name) {
      return { name: '', localVersion, remoteVersion: null, hasUpdate: false, repo, branch, path: '' };
    }
    if (!force && cachedRemote && Date.now() - cachedAt < CACHE_TTL_MS) {
      const hasUpdate = Boolean(cachedRemote.version && compareVersions(cachedRemote.version, localVersion) > 0);
      return {
        name,
        localVersion,
        remoteVersion: cachedRemote.version || null,
        hasUpdate,
        repo,
        branch,
        path: cachedRemote.path || `plugins/${name}`,
      };
    }
    try {
      const data = await fetchMarketplace(repo, branch, force);
      const plugins = Array.isArray(data?.plugins) ? data.plugins : [];
      const found = plugins.find((p) => p?.name === name) || null;
      cachedRemote = found;
      cachedAt = Date.now();
      const remoteVersion = found?.version || null;
      const hasUpdate = Boolean(remoteVersion && compareVersions(remoteVersion, localVersion) > 0);
      return {
        name,
        localVersion,
        remoteVersion,
        hasUpdate,
        repo,
        branch,
        path: found?.path || `plugins/${name}`,
      };
    } catch {
      return { name, localVersion, remoteVersion: null, hasUpdate: false, repo, branch, path: `plugins/${name}` };
    }
  }

  async function update() {
    const info = await check({ force: true });
    if (!info.name) throw new Error('未读取到插件名称。');
    const url = `https://github.com/${info.repo}/archive/refs/heads/${info.branch}.tar.gz`;
    const tmp = mkdtempSync(join(tmpdir(), 'agy-plugin-update-'));
    try {
      const tarPath = join(tmp, 'archive.tar.gz');
      await runCmd('curl', ['-fsSL', '-o', tarPath, url]);
      await runCmd('tar', ['-xzf', tarPath, '-C', tmp]);
      const extracted = readdirSync(tmp, { withFileTypes: true }).find((d) => d.isDirectory());
      if (!extracted) throw new Error('解压更新包失败。');
      const srcDir = join(tmp, extracted.name, info.path || `plugins/${info.name}`);
      if (!existsSync(join(srcDir, 'plugin.json'))) {
        throw new Error(`未在远端仓库找到 ${info.path}/plugin.json`);
      }
      const parentDir = dirname(pluginDir);
      mkdirSync(parentDir, { recursive: true });
      const stamp = `${process.pid}-${Date.now()}`;
      const stageDir = join(parentDir, `.${info.name}.staging-${stamp}`);
      const backupDir = join(parentDir, `.${info.name}.backup-${stamp}`);
      try {
        cpSync(srcDir, stageDir, { recursive: true });
        if (existsSync(pluginDir)) renameSync(pluginDir, backupDir);
        renameSync(stageDir, pluginDir);
        rmSync(backupDir, { recursive: true, force: true });
      } catch (err) {
        if (!existsSync(pluginDir) && existsSync(backupDir)) {
          try { renameSync(backupDir, pluginDir); } catch {}
        }
        rmSync(stageDir, { recursive: true, force: true });
        throw err;
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    return check({ force: false });
  }

  return { localInfo, check, update };
}
