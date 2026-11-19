import { readFileSync } from 'node:fs';
import { Response, SidecarApp } from 'sidecar_sdk';
import { createMarketManager, MarketError } from './market.mjs';

const dataDir = process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR;
if (!dataDir || !process.env.ANTIGRAVITY_SIDECAR_UI_TOKEN) {
  throw new Error('Start plugin-market from the Antigravity sidecar host.');
}

const manager = createMarketManager({ dataDir });
const app = new SidecarApp();
const page = new URL('./index.html', import.meta.url);

app.page('/', () => new Response(readFileSync(page, 'utf8'), { contentType: 'text/html; charset=utf-8' }));

const actions = {
  state: ({ force = false } = {}) => manager.state({ force }),
  install: (req) => manager.installPlugin(req),
  'update-all': () => manager.updateAll(),
  'open-dir': ({ name }) => manager.openPluginDir(name),
  enable: ({ name }) => manager.togglePlugin(name, true),
  disable: ({ name }) => manager.togglePlugin(name, false),
  uninstall: ({ name }) => manager.uninstallPlugin(name),
  'source-add': ({ repo }) => manager.addSource(repo),
  'source-remove': ({ repo, branch }) => manager.removeSource(repo, branch),
};

for (const [name, action] of Object.entries(actions)) {
  app.api(`/api/${name}`, async (request) => {
    try {
      return await action(request || {});
    } catch (err) {
      if (!(err instanceof MarketError)) console.error(err);
      return { error: err instanceof MarketError ? err.message : '操作失败，请稍后重试。' };
    }
  });
}

app.run();
