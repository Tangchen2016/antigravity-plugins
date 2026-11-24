import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { compareVersions, createMarketManager, parseRepoInput } from '../sidecars/plugin-market/market.mjs';

test('compareVersions handles semver comparisons accurately', () => {
  assert.equal(compareVersions('1.0.2', '1.0.1'), 1);
  assert.equal(compareVersions('0.2.0', '0.1.9'), 1);
  assert.equal(compareVersions('v1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('0.1.0', '0.2.0'), -1);
});

test('parseRepoInput accepts shorthand and GitHub URLs', () => {
  assert.deepEqual(parseRepoInput('owner/repo'), { repo: 'owner/repo', branch: 'main' });
  assert.deepEqual(parseRepoInput('https://github.com/owner/repo.git'), { repo: 'owner/repo', branch: 'main' });
  assert.deepEqual(parseRepoInput('owner/repo@dev'), { repo: 'owner/repo', branch: 'dev' });
  assert.throws(() => parseRepoInput('not a repo'), /有效的 GitHub/);
});

test('state merges local plugins and remote catalog and detects updates', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'agy-market-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const pluginsDir = join(root, 'plugins');
  const dataDir = join(root, 'data');
  mkdirSync(join(pluginsDir, 'language-packs'), { recursive: true });
  writeFileSync(
    join(pluginsDir, 'language-packs', 'plugin.json'),
    JSON.stringify({ name: 'language-packs', displayName: '语言包管理', version: '0.1.0' }),
  );

  const mockFetch = async () => ({
    ok: true,
    json: async () => ({
      plugins: [
        { name: 'language-packs', displayName: '语言包管理', version: '0.2.0', type: '侧边栏扩展', description: '新版' },
        { name: 'progress-updates', displayName: '进度播报', version: '0.1.0', type: '全局规则', description: '规则' },
      ],
    }),
  });

  const manager = createMarketManager({
    pluginsDir,
    dataDir,
    agyBin: '/nonexistent/agy',
    fetchImpl: mockFetch,
  });

  const st = await manager.state({ force: true });
  assert.equal(st.updateCount, 1);
  const lp = st.market.find((p) => p.name === 'language-packs');
  assert.equal(lp.installed, true);
  assert.equal(lp.hasUpdate, true);
  const pu = st.market.find((p) => p.name === 'progress-updates');
  assert.equal(pu.installed, false);
  assert.equal(pu.hasUpdate, false);

  await assert.rejects(() => manager.togglePlugin('plugin-market', false), /自身/);
  await assert.rejects(() => manager.uninstallPlugin('plugin-market'), /自身/);
});

test('plugin-market updates are separated from regular plugins and handled via updateSelf', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'agy-market-self-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const pluginsDir = join(root, 'plugins');
  const dataDir = join(root, 'data');
  const repoRoot = join(root, 'repo-archive');

  mkdirSync(join(pluginsDir, 'plugin-market'), { recursive: true });
  writeFileSync(
    join(pluginsDir, 'plugin-market', 'plugin.json'),
    JSON.stringify({ name: 'plugin-market', displayName: '插件市场', version: '0.1.1' }),
  );
  mkdirSync(join(pluginsDir, 'language-packs'), { recursive: true });
  writeFileSync(
    join(pluginsDir, 'language-packs', 'plugin.json'),
    JSON.stringify({ name: 'language-packs', displayName: '语言包管理', version: '0.1.0' }),
  );

  // Build a local tar.gz archive containing updated versions of both plugins
  mkdirSync(join(repoRoot, 'repo-main', 'plugins', 'plugin-market'), { recursive: true });
  writeFileSync(
    join(repoRoot, 'repo-main', 'plugins', 'plugin-market', 'plugin.json'),
    JSON.stringify({ name: 'plugin-market', displayName: '插件市场', version: '0.1.2' }),
  );
  mkdirSync(join(repoRoot, 'repo-main', 'plugins', 'language-packs'), { recursive: true });
  writeFileSync(
    join(repoRoot, 'repo-main', 'plugins', 'language-packs', 'plugin.json'),
    JSON.stringify({ name: 'language-packs', displayName: '语言包管理', version: '0.2.0' }),
  );
  const fixtureTar = join(root, 'fixture.tar.gz');
  execFileSync('tar', ['-czf', fixtureTar, '-C', repoRoot, 'repo-main']);

  const mockFetch = async () => ({
    ok: true,
    json: async () => ({
      plugins: [
        { name: 'plugin-market', displayName: '插件市场', version: '0.1.2', type: '侧边栏扩展', description: '市场' },
        { name: 'language-packs', displayName: '语言包管理', version: '0.2.0', type: '侧边栏扩展', description: '新版' },
      ],
    }),
  });

  const updateOrder = [];
  const manager = createMarketManager({
    pluginsDir,
    dataDir,
    agyBin: '/nonexistent/agy',
    fetchImpl: mockFetch,
    downloadArchive: async ({ tarPath, name }) => {
      updateOrder.push(name);
      writeFileSync(tarPath, readFileSync(fixtureTar));
    },
  });

  const before = await manager.state({ force: true });
  assert.equal(before.updateCount, 1);
  assert.equal(before.selfUpdate?.remoteVersion, '0.1.2');
  assert.equal(before.selfInfo?.hasUpdate, true);
  assert.equal(before.selfInfo?.sourceUrl, 'https://github.com/Tangchen2016/antigravity-plugins/tree/main/plugins/plugin-market');
  assert.equal(before.installed.some((p) => p.name === 'plugin-market'), false);
  assert.equal(before.market.some((p) => p.name === 'plugin-market'), false);
  assert.equal(
    before.market.find((p) => p.name === 'language-packs')?.sourceUrl,
    'https://github.com/Tangchen2016/antigravity-plugins/tree/main/plugins/language-packs',
  );

  const afterAll = await manager.updateAll();
  assert.deepEqual(updateOrder, ['language-packs']);
  assert.equal(afterAll.updateCount, 0);
  assert.equal(afterAll.selfUpdate?.remoteVersion, '0.1.2');

  const afterSelf = await manager.updateSelf();
  assert.deepEqual(updateOrder, ['language-packs', 'plugin-market']);
  assert.equal(afterSelf.selfUpdate, null);
  assert.equal(afterSelf.selfInfo?.hasUpdate, false);
  assert.equal(afterSelf.selfInfo?.localVersion, '0.1.2');
  const updatedSelf = JSON.parse(readFileSync(join(pluginsDir, 'plugin-market', 'plugin.json'), 'utf8'));
  assert.equal(updatedSelf.version, '0.1.2');
});

test('resolves local logo data URIs and remote logo URLs safely', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'agy-market-logo-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const pluginsDir = join(root, 'plugins');
  const dataDir = join(root, 'data');

  mkdirSync(join(pluginsDir, 'language-packs', 'assets'), { recursive: true });
  writeFileSync(
    join(pluginsDir, 'language-packs', 'assets', 'logo.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"></svg>',
  );
  writeFileSync(
    join(pluginsDir, 'language-packs', 'plugin.json'),
    JSON.stringify({ name: 'language-packs', displayName: '语言包管理', version: '0.2.6', logo: 'assets/logo.svg' }),
  );

  mkdirSync(join(pluginsDir, 'bad-logo'), { recursive: true });
  writeFileSync(
    join(pluginsDir, 'bad-logo', 'plugin.json'),
    JSON.stringify({ name: 'bad-logo', displayName: 'Bad', version: '0.1.0', logo: '../escape.svg' }),
  );

  const mockFetch = async () => ({
    ok: true,
    json: async () => ({
      plugins: [
        { name: 'language-packs', displayName: '语言包管理', version: '0.2.6', logo: 'assets/logo.svg' },
        { name: 'desktop-context', displayName: '上下文用量', version: '1.0.8', logo: 'assets/logo.svg' },
      ],
    }),
  });

  const manager = createMarketManager({
    pluginsDir,
    dataDir,
    agyBin: '/nonexistent/agy',
    fetchImpl: mockFetch,
  });

  const st = await manager.state({ force: true });
  const lpInstalled = st.installed.find((p) => p.name === 'language-packs');
  assert.match(lpInstalled.logoUrl || '', /^data:image\/svg\+xml;base64,/);

  const badInstalled = st.installed.find((p) => p.name === 'bad-logo');
  assert.equal(badInstalled.logoUrl, null);

  const dcMarket = st.market.find((p) => p.name === 'desktop-context');
  assert.equal(
    dcMarket.logoUrl,
    'https://raw.githubusercontent.com/Tangchen2016/antigravity-plugins/main/plugins/desktop-context/assets/logo.svg',
  );
});
