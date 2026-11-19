import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createPackManager } from '../sidecars/language-packs/packs.mjs';

const activeFile = 'zzzz.antigravity-language-packs.json';

function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'agy-language-packs-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, 'active');
  const dataDirectory = join(root, 'data');
  const bundledDirectory = join(root, 'bundled');
  mkdirSync(bundledDirectory);
  writeFileSync(join(bundledDirectory, 'zh-CN.json'), '{"Settings":"设置"}');
  writeFileSync(join(bundledDirectory, 'zh-TW.json'), '{"Settings":"設定"}');
  const manager = createPackManager({ directory, dataDirectory, bundledDirectory });
  const overlay = join(directory, activeFile);
  return { manager, overlay, directory };
}

test('switch, update, and reset language packs with empty directory as English default', (t) => {
  const { manager, overlay } = setup(t);
  assert.equal(manager.state().ready, true);
  assert.equal(manager.state().activeLocale, null);

  assert.equal(manager.activate('zh-TW').activeLocale, 'zh-TW');
  assert.equal(JSON.parse(readFileSync(overlay, 'utf8')).Settings, '設定');
  assert.throws(() => manager.update('zh-TW', { Settings: null }), /字符串/);
  assert.equal(JSON.parse(readFileSync(overlay, 'utf8')).Settings, '設定');

  const { packs } = manager.update('zh-TW', { Settings: '偏好設定' });
  assert.equal(packs.find(({ locale }) => locale === 'zh-TW').source, 'imported');
  assert.equal(JSON.parse(readFileSync(overlay, 'utf8')).Settings, '偏好設定');

  // Reset single locale restores bundled dictionary and refreshes active overlay
  const afterSingleReset = manager.reset('zh-TW');
  assert.equal(afterSingleReset.packs.find(({ locale }) => locale === 'zh-TW').source, 'bundled');
  assert.equal(JSON.parse(readFileSync(overlay, 'utf8')).Settings, '設定');

  manager.update('zh-CN', { Settings: '偏好设置' });
  assert.equal(manager.activate('zh-CN').activeLocale, 'zh-CN');
  assert.equal(JSON.parse(readFileSync(overlay, 'utf8')).Settings, '偏好设置');

  // Reset all clears active overlay (back to English) and imported packs
  const afterResetAll = manager.reset();
  assert.equal(afterResetAll.activeLocale, null);
  assert.equal(afterResetAll.packs.every(({ source }) => source === 'bundled'), true);
  assert.throws(() => readFileSync(overlay), { code: 'ENOENT' });
});

test('leave a foreign overlay intact', (t) => {
  const { manager, overlay } = setup(t);
  manager.state();
  writeFileSync(overlay, '{"Settings":"我的词库"}');
  assert.equal(manager.state().ready, false);
  assert.throws(() => manager.deactivate(), /不属于此扩展/);
  assert.throws(() => manager.activate('zh-CN'), /不属于此扩展/);
  assert.equal(readFileSync(overlay, 'utf8'), '{"Settings":"我的词库"}');
});

test('runtime revision fingerprint detects outdated injected preload', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const { computeRuntimeRev, formatRuntimeRevMarker, extractRuntimeRev } = require('../runtime/src/runtime_rev.js');
  const rev = computeRuntimeRev(new URL('../runtime', import.meta.url).pathname);
  assert.match(rev, /^[a-f0-9]{12}$/);
  assert.equal(extractRuntimeRev(formatRuntimeRevMarker(rev)), rev);
  assert.equal(extractRuntimeRev('/* no marker */'), null);
});
