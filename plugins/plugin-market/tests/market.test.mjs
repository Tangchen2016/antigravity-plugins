import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
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
