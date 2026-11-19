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

function shellQuote(str) {
  return `'${String(str).replace(/'/g, "'\\''")}'`;
}

function runPrivilegedScript(scriptPath, extraArgs = []) {
  if (process.platform !== 'darwin') {
    throw new PackError('当前平台暂不支持面板内一键提权，请在终端手动执行安装脚本。');
  }
  if (!existsSync(scriptPath)) {
    throw new PackError('未找到运行时脚本，请重新安装语言包扩展。');
  }
  const cmd = ['bash', scriptPath, ...extraArgs].map(shellQuote).join(' ');
  const appleScript = `do shell script ${JSON.stringify(cmd)} with administrator privileges`;
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', appleScript], { timeout: 120000 }, (err, stdout, stderr) => {
      if (!err) return resolve(stdout);
      const msg = String(stderr || err.message || '');
      if (/User canceled|-128/i.test(msg)) {
        return reject(new PackError('已取消管理员授权。'));
      }
      reject(new PackError(msg.trim() || '执行运行时脚本失败，请尝试在终端运行。'));
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
    await runPrivilegedScript(installScript, ['--no-kill', '--brand-title=english']);
    return fullState();
  },
  'runtime-uninstall': async () => {
    await runPrivilegedScript(uninstallScript, ['--no-kill']);
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
