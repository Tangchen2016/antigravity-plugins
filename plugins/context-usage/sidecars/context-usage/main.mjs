import { readFileSync } from 'node:fs';
import { Response, SidecarApp } from 'sidecar_sdk';
import { contextUsage } from './usage.mjs';

const app = new SidecarApp();
const page = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const { ANTIGRAVITY_LS_ADDRESS: address, ANTIGRAVITY_CSRF_TOKEN: csrf } = process.env;

app.page('/', () => new Response(page, { contentType: 'text/html; charset=utf-8' }));
app.api('/api/usage', async ({ conversationId }) => {
  if (typeof conversationId !== 'string' || !uuid.test(conversationId)) {
    return { state: 'no-conversation' };
  }
  try {
    const usage = await contextUsage(conversationId, address, csrf);
    return usage ? { state: 'ready', ...usage } : { state: 'pending' };
  } catch {
    return { state: 'unavailable' };
  }
});
app.run();
