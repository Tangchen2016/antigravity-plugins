import { execFile } from 'node:child_process';
import { existsSync, openSync, readFileSync, readSync, closeSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Response, SidecarApp } from 'sidecar_sdk';
import { createPackManager, PackError } from './packs.mjs';

const require = createRequire(import.meta.url);
const { readAsarLayout } = require('../../runtime/src/asar_patcher.js');

const dataDirectory = process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR;
if (!dataDirectory || !process.env.ANTIGRAVITY_SIDECAR_UI_TOKEN) {
  throw new Error('Start language-packs from the Antigravity sidecar host.');
}

const runtimeDir = fileURLToPath(new URL('../../runtime/', import.meta.url));
const directory = process.env.ANTIGRAVITY_HOT_DICTIONARY_DIR
  || join(runtimeDir, 'active');
const installScript = join(runtimeDir, 'install-runtime.sh');
const uninstallScript = join(runtimeDir, 'uninstall-runtime.sh');
const installCommand = join(runtimeDir, 'install-runtime.command');
const uninstallCommand = join(runtimeDir, 'uninstall-runtime.command');

const manager = createPackManager({
  directory,
  dataDirectory,
  bundledDirectory: fileURLToPath(new URL('../../dictionaries/', import.meta.url)),
});

function readAsarEntry(asarPath, relPath) {
  const layout = readAsarLayout(asarPath);
  const parts = relPath.split('/');
  let node = layout.header;
  for (const part of parts) {
    node = node?.files?.[part];
    if (!node) return null;
  }
  if (node.offset === undefined || !node.size) return null;
  const fd = openSync(asarPath, 'r');
  try {
    const buf = Buffer.alloc(node.size);
    readSync(fd, buf, 0, node.size, layout.dataStartOffset + Number(node.offset));
    return buf.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

function getRuntimeStatus() {
  const isMac = process.platform === 'darwin';
  const resourcesDir = '/Applications/Antigravity.app/Contents/Resources';
  const asarPath = join(resourcesDir, 'app.asar');
  const appFound = isMac && existsSync(asarPath);
  let installed = false;
  if (appFound) {
    try {
      const preload = readAsarEntry(asarPath, 'dist/preload.js') || '';
      const utils = readAsarEntry(asarPath, 'dist/utils.js') || '';
      const normalizedDir = directory.replace(/\/+$/, '');
      installed = preload.includes('ANTIGRAVITY CHINESE LOCALIZATION START')
        && (utils.includes(normalizedDir) || utils.includes(JSON.stringify(normalizedDir)));
    } catch {
      installed = false;
    }
  }
  return {
    supported: isMac,
    appFound,
    installed,
    installCmd: `bash "${installScript}"`,
    uninstallCmd: `bash "${uninstallScript}"`,
  };
}

function launchInTerminal(commandFile) {
  if (process.platform !== 'darwin') {
    throw new PackError('当前平台暂不支持自动唤起终端，请手动执行安装脚本。');
  }
  if (!existsSync(commandFile)) {
    throw new PackError('未找到运行时脚本，请重新安装语言包扩展。');
  }
  return new Promise((resolve, reject) => {
    execFile('open', ['-a', 'Terminal', commandFile], { timeout: 15000 }, (err, _stdout, stderr) => {
      if (err) {
        return reject(new PackError(String(stderr || err.message || '无法唤起系统终端。').trim()));
      }
      resolve();
    });
  });
}

function openAppManagementSettings() {
  if (process.platform !== 'darwin') {
    throw new PackError('仅 macOS 支持自动打开系统设置。');
  }
  return new Promise((resolve, reject) => {
    execFile('open', ['x-apple.systempreferences:com.apple.preference.security?Privacy_AppBundles'], (err) => {
      if (err) return reject(new PackError('无法自动打开系统设置，请手动前往 系统设置 → 隐私与安全性 → App 管理。'));
      resolve();
    });
  });
}

function fullState() {
  return { ...manager.state(), runtime: getRuntimeStatus() };
}

const app = new SidecarApp();
const page = new URL('./index.html', import.meta.url);
app.page('/', () => new Response(readFileSync(page, 'utf8'), { contentType: 'text/html; charset=utf-8' }));

const actions = {
  state: () => fullState(),
  activate: ({ locale }) => { manager.activate(locale); return fullState(); },
  deactivate: () => { manager.deactivate(); return fullState(); },
  update: ({ locale, dictionary }) => { manager.update(locale, dictionary); return fullState(); },
  reset: ({ locale } = {}) => { manager.reset(locale); return fullState(); },
  'runtime-install': async () => {
    await launchInTerminal(installCommand);
    return fullState();
  },
  'runtime-uninstall': async () => {
    await launchInTerminal(uninstallCommand);
    return fullState();
  },
  'open-app-management': async () => {
    await openAppManagementSettings();
    return fullState();
  },
};

for (const [name, action] of Object.entries(actions)) {
  app.api(`/api/${name}`, async (request) => {
    try {
      return await action(request || {});
    } catch (error) {
      if (!(error instanceof PackError)) console.error(error);
      return { error: error instanceof PackError ? error.message : '操作失败，请检查文件权限后重试。' };
    }
  });
}

app.run();
