import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Response, SidecarApp } from 'sidecar_sdk';
import { createPackManager, PackError } from './packs.mjs';

const dataDirectory = process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR;
if (!dataDirectory || !process.env.ANTIGRAVITY_SIDECAR_UI_TOKEN) {
  throw new Error('Start language-packs from the Antigravity sidecar host.');
}

const directory = process.env.ANTIGRAVITY_HOT_DICTIONARY_DIR
  || join(homedir(), 'Mine', 'antigravity2-cn', 'dicts');
const manager = createPackManager({
  directory,
  dataDirectory,
  bundledDirectory: fileURLToPath(new URL('../../dictionaries/', import.meta.url)),
});

const app = new SidecarApp();
const page = new URL('./index.html', import.meta.url);
app.page('/', () => new Response(readFileSync(page, 'utf8'), { contentType: 'text/html; charset=utf-8' }));

const actions = {
  state: () => manager.state(),
  activate: ({ locale }) => manager.activate(locale),
  deactivate: () => manager.deactivate(),
  update: ({ locale, dictionary }) => manager.update(locale, dictionary),
  reset: ({ locale } = {}) => manager.reset(locale),
};
for (const [name, action] of Object.entries(actions)) {
  app.api(`/api/${name}`, (request) => {
    try {
      return action(request);
    } catch (error) {
      if (!(error instanceof PackError)) console.error(error);
      return { error: error instanceof PackError ? error.message : '无法保存或读取语言包，请检查文件权限后重试。' };
    }
  });
}

app.run();
