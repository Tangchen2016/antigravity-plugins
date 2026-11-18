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
  const directory = join(root, 'hot');
  const dataDirectory = join(root, 'data');
  const bundledDirectory = join(root, 'bundled');
  mkdirSync(directory);
  mkdirSync(bundledDirectory);
  const baseFile = join(directory, 'base.json');
  writeFileSync(baseFile, '{"Settings":"设置"}');
  writeFileSync(join(bundledDirectory, 'zh-CN.json'), '{"Settings":"设置"}');
  writeFileSync(join(bundledDirectory, 'zh-TW.json'), '{"Settings":"設定"}');
  const manager = createPackManager({ directory, dataDirectory, bundledDirectory });
  const overlay = join(directory, activeFile);
  return { manager, overlay, baseFile, directory };
}

test('switch and update language packs without modifying the base files', (t) => {
  const { manager, overlay, baseFile } = setup(t);
  assert.equal(manager.state().activeLocale, null);
  const base = readFileSync(baseFile, 'utf8');

  assert.equal(manager.activate('zh-TW').activeLocale, 'zh-TW');
  assert.equal(JSON.parse(readFileSync(overlay, 'utf8')).Settings, '設定');
  assert.throws(() => manager.update('zh-TW', { Settings: null }), /字符串/);
  assert.equal(JSON.parse(readFileSync(overlay, 'utf8')).Settings, '設定');

  const { packs } = manager.update('zh-TW', { Settings: '偏好設定' });
  assert.equal(packs.find(({ locale }) => locale === 'zh-TW').source, 'imported');
  assert.equal(JSON.parse(readFileSync(overlay, 'utf8')).Settings, '偏好設定');

  manager.update('zh-CN', { Settings: '偏好设置' });
  assert.equal(JSON.parse(readFileSync(overlay, 'utf8')).Settings, '偏好設定');
  assert.equal(manager.activate('zh-CN').activeLocale, 'zh-CN');
  assert.equal(JSON.parse(readFileSync(overlay, 'utf8')).Settings, '偏好设置');

  assert.equal(manager.deactivate().activeLocale, null);
  assert.throws(() => readFileSync(overlay), { code: 'ENOENT' });
  assert.equal(readFileSync(baseFile, 'utf8'), base);
  manager.activate('zh-TW');
  assert.equal(JSON.parse(readFileSync(overlay, 'utf8')).Settings, '偏好設定');
});

test('leave a foreign overlay intact and report a missing base directory', (t) => {
  const { manager, overlay, directory } = setup(t);
  writeFileSync(overlay, '{"Settings":"我的词库"}');
  assert.equal(manager.state().ready, false);
  assert.throws(() => manager.deactivate(), /不属于此扩展/);
  assert.throws(() => manager.activate('zh-CN'), /不属于此扩展/);
  assert.equal(readFileSync(overlay, 'utf8'), '{"Settings":"我的词库"}');

  rmSync(directory, { recursive: true });
  assert.equal(manager.state().ready, false);
  assert.throws(() => manager.activate('zh-CN'), /找不到热更新/);
});
