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
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export const SELF_PLUGIN = 'plugin-market';
export const DEFAULT_SOURCES = [
  { repo: 'Tangchen2016/antigravity-plugins', branch: 'main', label: '官方合集', builtin: true },
];

export class MarketError extends Error {}

export function compareVersions(a = '0.0.0', b = '0.0.0') {
  const pa = String(a).replace(/^v/i, '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/i, '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

export function parseRepoInput(raw) {
  const trimmed = String(raw || '').trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');
  const match = trimmed.match(/^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(?:@([A-Za-z0-9_./-]+))?$/);
  if (!match) {
    throw new MarketError('请输入有效的 GitHub 仓库地址，格式如 owner/repo 或 owner/repo@branch。');
  }
  return { repo: match[1], branch: match[2] || 'main' };
}

function runCmd(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 60000, maxBuffer: 8 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) {
        const msg = String(stderr || stdout || err.message || '').trim();
        return reject(new MarketError(msg || `命令执行失败: ${cmd}`));
      }
      resolve(String(stdout || ''));
    });
  });
}

export function findAgyBinary() {
  const home = homedir();
  const candidates = [
    process.env.ANTIGRAVITY_CLI_PATH,
    join(home, '.local', 'bin', 'agy'),
    join(home, '.gemini', 'bin', 'agy'),
    '/opt/homebrew/bin/agy',
    '/usr/local/bin/agy',
  ].filter(Boolean);
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return 'agy';
}

function readJsonSafe(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

export function createMarketManager({
  pluginsDir = join(homedir(), '.gemini', 'config', 'plugins'),
  dataDir,
  agyBin = findAgyBinary(),
  fetchImpl = globalThis.fetch,
  downloadArchive,
}) {
  const sourcesPath = join(dataDir, 'sources.json');
  const catalogCachePath = join(dataDir, 'catalog-cache.json');

  function loadSources() {
    const saved = readJsonSafe(sourcesPath);
    const custom = Array.isArray(saved) ? saved.filter((s) => s?.repo && !s.builtin) : [];
    const seen = new Set(DEFAULT_SOURCES.map((s) => `${s.repo}@${s.branch}`));
    const result = [...DEFAULT_SOURCES];
    for (const s of custom) {
      const key = `${s.repo}@${s.branch || 'main'}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push({ repo: s.repo, branch: s.branch || 'main', label: s.label || s.repo, builtin: false });
      }
    }
    return result;
  }

  function saveCustomSources(sources) {
    mkdirSync(dataDir, { recursive: true });
    const custom = sources.filter((s) => !s.builtin);
    writeFileSync(sourcesPath, JSON.stringify(custom, null, 2) + '\n', 'utf8');
  }

  function readLocalManifest(pluginPath, fallbackName) {
    const manifest = readJsonSafe(join(pluginPath, 'plugin.json')) || {};
    const hasSidecars = existsSync(join(pluginPath, 'sidecars'));
    const hasRules = existsSync(join(pluginPath, 'rules'));
    const hasSkills = existsSync(join(pluginPath, 'skills'));
    const hasMcp = existsSync(join(pluginPath, 'mcp_config.json'));
    const type = hasSidecars ? '侧边栏扩展' : hasRules ? '全局规则' : hasSkills ? '技能包' : hasMcp ? 'MCP 扩展' : '插件';
    return {
      name: manifest.name || fallbackName,
      displayName: manifest.displayName || manifest.title || manifest.name || fallbackName,
      description: manifest.description || '',
      version: manifest.version || '0.0.0',
      type,
    };
  }

  async function listInstalled() {
    let cliList = null;
    try {
      const out = await runCmd(agyBin, ['plugin', 'list', '--json']);
      const parsed = JSON.parse(out);
      if (Array.isArray(parsed)) cliList = parsed;
    } catch {
      cliList = null;
    }

    if (cliList) {
      return cliList.map((item) => {
        const meta = item.path ? readLocalManifest(item.path, item.name) : {};
        return {
          name: item.name,
          displayName: meta.displayName || item.name,
          description: meta.description || '',
          version: item.version || meta.version || '0.0.0',
          enabled: item.enabled !== false,
          path: item.path || join(pluginsDir, item.name),
          type: meta.type || '插件',
          isSelf: item.name === SELF_PLUGIN,
        };
      });
    }

    if (!existsSync(pluginsDir)) return [];
    const entries = readdirSync(pluginsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'));
    return entries.map((d) => {
      const fullPath = join(pluginsDir, d.name);
      const meta = readLocalManifest(fullPath, d.name);
      return {
        name: d.name,
        displayName: meta.displayName,
        description: meta.description,
        version: meta.version,
        enabled: true,
        path: fullPath,
        type: meta.type,
        isSelf: d.name === SELF_PLUGIN,
      };
    });
  }

  async function fetchCatalog({ force = false } = {}) {
    const sources = loadSources();
    const cached = readJsonSafe(catalogCachePath);
    if (!force && cached && Array.isArray(cached.items) && Date.now() - (cached.fetchedAt || 0) < 60_000) {
      return { items: cached.items, errors: cached.errors || [], fetchedAt: cached.fetchedAt, fromCache: true };
    }

    const items = [];
    const errors = [];
    const seen = new Set();

    async function fetchSourceManifest(src) {
      const apiUrl = `https://api.github.com/repos/${src.repo}/contents/marketplace.json?ref=${encodeURIComponent(src.branch)}`;
      const rawUrl = `https://raw.githubusercontent.com/${src.repo}/${src.branch}/marketplace.json`;
      const attempts = force
        ? [
            { url: apiUrl, headers: { Accept: 'application/vnd.github.raw', 'User-Agent': 'antigravity-plugin-market', 'Cache-Control': 'no-cache' } },
            { url: rawUrl, headers: { 'Cache-Control': 'no-cache' } },
          ]
        : [
            { url: rawUrl, headers: { 'Cache-Control': 'no-cache' } },
            { url: apiUrl, headers: { Accept: 'application/vnd.github.raw', 'User-Agent': 'antigravity-plugin-market', 'Cache-Control': 'no-cache' } },
          ];
      let lastErr;
      for (const { url, headers } of attempts) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);
        try {
          const res = await fetchImpl(url, { signal: controller.signal, headers });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return await res.json();
        } catch (err) {
          lastErr = err;
        } finally {
          clearTimeout(timer);
        }
      }
      throw lastErr || new Error('拉取失败');
    }

    for (const src of sources) {
      try {
        const data = await fetchSourceManifest(src);
        const plugins = Array.isArray(data?.plugins) ? data.plugins : [];
        for (const p of plugins) {
          if (!p?.name || seen.has(p.name)) continue;
          seen.add(p.name);
          items.push({
            name: p.name,
            displayName: p.displayName || p.name,
            version: p.version || '0.1.0',
            type: p.type || '插件',
            description: p.description || '',
            path: p.path || `plugins/${p.name}`,
            tags: Array.isArray(p.tags) ? p.tags : [],
            repo: src.repo,
            branch: src.branch,
          });
        }
      } catch (err) {
        errors.push(`${src.repo}: ${err.message || '拉取失败'}`);
      }
    }

    const fetchedAt = Date.now();
    if (items.length > 0) {
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(catalogCachePath, JSON.stringify({ items, errors, fetchedAt }, null, 2), 'utf8');
      return { items, errors, fetchedAt, fromCache: false };
    }
    if (cached && Array.isArray(cached.items)) {
      return { items: cached.items, errors, fetchedAt: cached.fetchedAt, fromCache: true };
    }
    return { items: [], errors, fetchedAt, fromCache: false };
  }

  async function state({ force = false } = {}) {
    const [installed, catalog] = await Promise.all([listInstalled(), fetchCatalog({ force })]);
    const installedMap = new Map(installed.map((p) => [p.name, p]));
    const catalogMap = new Map(catalog.items.map((p) => [p.name, p]));

    const selfLocal = installedMap.get(SELF_PLUGIN);
    const selfRemote = catalogMap.get(SELF_PLUGIN);
    const selfHasUpdate = Boolean(selfLocal && selfRemote && compareVersions(selfRemote.version, selfLocal.version) > 0);
    const selfRepo = selfRemote?.repo || DEFAULT_SOURCES[0].repo;
    const selfBranch = selfRemote?.branch || DEFAULT_SOURCES[0].branch;
    const selfPath = selfRemote?.path || `plugins/${SELF_PLUGIN}`;
    const cleanSelfPath = String(selfPath || '').replace(/^\/+|\/+$/g, '');
    const selfSourceUrl = selfRepo
      ? (cleanSelfPath
          ? `https://github.com/${selfRepo}/tree/${encodeURIComponent(selfBranch)}/${cleanSelfPath}`
          : `https://github.com/${selfRepo}`)
      : null;
    const selfInfo = selfLocal
      ? {
          name: SELF_PLUGIN,
          displayName: selfLocal.displayName || selfRemote?.displayName || '插件市场',
          localVersion: selfLocal.version,
          remoteVersion: selfRemote?.version || null,
          hasUpdate: selfHasUpdate,
          repo: selfRepo,
          branch: selfBranch,
          path: selfPath,
          sourceUrl: selfSourceUrl,
        }
      : null;
    const selfUpdate = selfHasUpdate
      ? {
          name: SELF_PLUGIN,
          localVersion: selfLocal.version,
          remoteVersion: selfRemote.version,
          repo: selfRemote.repo,
          branch: selfRemote.branch,
          path: selfRemote.path,
        }
      : null;

    const market = catalog.items
      .filter((item) => item.name !== SELF_PLUGIN)
      .map((item) => {
        const local = installedMap.get(item.name);
        const hasUpdate = Boolean(local && compareVersions(item.version, local.version) > 0);
        const cleanPath = String(item.path || '').replace(/^\/+|\/+$/g, '');
        const sourceUrl = item.repo
          ? (cleanPath
              ? `https://github.com/${item.repo}/tree/${encodeURIComponent(item.branch || 'main')}/${cleanPath}`
              : `https://github.com/${item.repo}`)
          : null;
        return {
          ...item,
          sourceUrl,
          installed: Boolean(local),
          installedVersion: local?.version || null,
          enabled: local ? local.enabled : false,
          hasUpdate,
        };
      });

    const localList = installed
      .filter((item) => item.name !== SELF_PLUGIN)
      .map((item) => {
        const remote = catalogMap.get(item.name);
        const hasUpdate = Boolean(remote && compareVersions(remote.version, item.version) > 0);
        const displayName = item.displayName && item.displayName !== item.name
          ? item.displayName
          : (remote?.displayName || item.displayName || item.name);
        const cleanRemotePath = String(remote?.path || '').replace(/^\/+|\/+$/g, '');
        const sourceUrl = remote?.repo
          ? (cleanRemotePath
              ? `https://github.com/${remote.repo}/tree/${encodeURIComponent(remote.branch || 'main')}/${cleanRemotePath}`
              : `https://github.com/${remote.repo}`)
          : null;
        return {
          ...item,
          displayName,
          remoteVersion: remote?.version || null,
          hasUpdate,
          repo: remote?.repo || null,
          branch: remote?.branch || null,
          remotePath: remote?.path || null,
          sourceUrl,
        };
      });

    return {
      sources: loadSources(),
      installed: localList,
      market,
      selfInfo,
      selfUpdate,
      errors: catalog.errors,
      fetchedAt: catalog.fetchedAt,
      updateCount: localList.filter((p) => p.hasUpdate).length,
    };
  }

  async function installPlugin({ name, repo, branch = 'main', path: subPath }) {
    if (!name) throw new MarketError('缺少插件名称。');
    const targetRepo = repo || DEFAULT_SOURCES[0].repo;
    const targetSubPath = subPath || `plugins/${name}`;
    const url = `https://github.com/${targetRepo}/archive/refs/heads/${branch}.tar.gz`;

    const tmp = mkdtempSync(join(tmpdir(), 'agy-market-'));
    try {
      const tarPath = join(tmp, 'archive.tar.gz');
      if (downloadArchive) {
        await downloadArchive({ url, tarPath, name, repo: targetRepo, branch, subPath: targetSubPath });
      } else {
        await runCmd('curl', ['-fsSL', '-o', tarPath, url]);
      }
      await runCmd('tar', ['-xzf', tarPath, '-C', tmp]);
      const extracted = readdirSync(tmp, { withFileTypes: true })
        .find((d) => d.isDirectory());
      if (!extracted) throw new MarketError('解压仓库压缩包失败。');
      const srcDir = join(tmp, extracted.name, targetSubPath);
      if (!existsSync(join(srcDir, 'plugin.json'))) {
        throw new MarketError(`仓库中未找到插件清单：${targetSubPath}/plugin.json`);
      }
      mkdirSync(pluginsDir, { recursive: true });
      const destDir = join(pluginsDir, name);
      const stamp = `${process.pid}-${Date.now()}`;
      const stageDir = join(pluginsDir, `.${name}.staging-${stamp}`);
      const backupDir = join(pluginsDir, `.${name}.backup-${stamp}`);
      try {
        cpSync(srcDir, stageDir, { recursive: true });
        if (existsSync(destDir)) {
          renameSync(destDir, backupDir);
        }
        renameSync(stageDir, destDir);
        rmSync(backupDir, { recursive: true, force: true });
      } catch (err) {
        if (!existsSync(destDir) && existsSync(backupDir)) {
          try { renameSync(backupDir, destDir); } catch {}
        }
        rmSync(stageDir, { recursive: true, force: true });
        throw err;
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    return state({ force: false });
  }

  async function togglePlugin(name, enable) {
    if (!name) throw new MarketError('缺少插件名称。');
    if (name === SELF_PLUGIN && !enable) {
      throw new MarketError('不能在插件市场内部停用插件市场自身。');
    }
    await runCmd(agyBin, ['plugin', enable ? 'enable' : 'disable', name]);
    return state({ force: false });
  }

  async function uninstallPlugin(name) {
    if (!name) throw new MarketError('缺少插件名称。');
    if (name === SELF_PLUGIN) {
      throw new MarketError('不能在插件市场内部卸载插件市场自身。');
    }
    try {
      await runCmd(agyBin, ['plugin', 'uninstall', name]);
    } catch {
      const target = join(pluginsDir, name);
      if (existsSync(target)) rmSync(target, { recursive: true, force: true });
      else throw new MarketError(`未找到已安装的插件：${name}`);
    }
    return state({ force: false });
  }

  async function addSource(rawRepo) {
    const parsed = parseRepoInput(rawRepo);
    const current = loadSources();
    if (current.some((s) => s.repo === parsed.repo && s.branch === parsed.branch)) {
      throw new MarketError(`源 ${parsed.repo}@${parsed.branch} 已存在。`);
    }
    saveCustomSources([...current, { ...parsed, label: parsed.repo, builtin: false }]);
    return state({ force: true });
  }

  async function removeSource(repo, branch = 'main') {
    const current = loadSources();
    const target = current.find((s) => s.repo === repo && s.branch === branch);
    if (!target) throw new MarketError('未找到该插件源。');
    if (target.builtin) throw new MarketError('默认内置源不可删除。');
    saveCustomSources(current.filter((s) => !(s.repo === repo && s.branch === branch)));
    return state({ force: true });
  }

  async function updateAll() {
    const current = await state({ force: true });
    const targets = current.installed.filter((p) => p.repo && p.hasUpdate);
    if (!targets.length) {
      return current;
    }
    for (const p of targets) {
      await installPlugin({ name: p.name, repo: p.repo, branch: p.branch || 'main', path: p.remotePath });
    }
    return state({ force: false });
  }

  async function updateSelf() {
    const current = await state({ force: true });
    const target = current.selfUpdate || current.selfInfo || {
      name: SELF_PLUGIN,
      repo: DEFAULT_SOURCES[0].repo,
      branch: DEFAULT_SOURCES[0].branch,
      path: `plugins/${SELF_PLUGIN}`,
    };
    return installPlugin({
      name: SELF_PLUGIN,
      repo: target.repo,
      branch: target.branch || 'main',
      path: target.path || `plugins/${SELF_PLUGIN}`,
    });
  }

  async function openPluginDir(name) {
    if (!name) throw new MarketError('缺少插件名称。');
    const list = await listInstalled();
    const target = list.find((p) => p.name === name);
    const dir = target?.path || join(pluginsDir, name);
    if (!existsSync(dir)) throw new MarketError(`未找到插件目录：${dir}`);
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
    await runCmd(cmd, [dir]);
    return state({ force: false });
  }

  async function openUrl(url) {
    let parsed;
    try {
      parsed = new URL(String(url || ''));
    } catch {
      throw new MarketError('无效的源码链接。');
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new MarketError('仅支持打开 http/https 链接。');
    }
    if (process.platform === 'darwin') {
      await runCmd('open', [parsed.toString()]);
    } else if (process.platform === 'win32') {
      await runCmd('cmd', ['/c', 'start', '', parsed.toString()]);
    } else {
      await runCmd('xdg-open', [parsed.toString()]);
    }
    return state({ force: false });
  }

  return {
    state,
    installPlugin,
    updateAll,
    updateSelf,
    openPluginDir,
    openUrl,
    togglePlugin,
    uninstallPlugin,
    addSource,
    removeSource,
  };
}
