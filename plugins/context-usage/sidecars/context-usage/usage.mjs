import { randomUUID } from 'node:crypto';

const path = '/exa.language_server_pb.LanguageServerService/StreamAgentStateUpdates';
const maxFrameBytes = 4 * 1024 * 1024;

function readUsage(usage) {
  if (!usage) return null;
  const { estimatedTokensUsed: used, maxContextTokens: limit, tokenGroups } = usage;
  if (!Number.isSafeInteger(used) || used < 0 || !Number.isSafeInteger(limit) || limit <= 0) {
    return null;
  }
  const groups = Array.isArray(tokenGroups) ? tokenGroups : [];
  return {
    used,
    limit,
    groups: groups
      .filter((group) => Number.isSafeInteger(group?.numTokens) && group.numTokens > 0)
      .map(({ type, name, numTokens }) => ({ type, name, tokens: numTokens })),
  };
}

export async function contextUsage(conversationId, address, csrf) {
  const base = new URL(address.includes('://') ? address : `http://${address}`);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) {
    throw new Error('Expected a local language server');
  }

  const page = { start_index: 0, end_index_exclusive: 0 };
  const payload = Buffer.from(JSON.stringify({
    conversation_id: conversationId,
    subscriber_id: randomUUID(),
    disable_rehydration: true,
    trajectory_verbosity: 'CLIENT_TRAJECTORY_VERBOSITY_PROD_UI',
    initial_steps_page_bounds: page,
    initial_generator_metadatas_page_bounds: page,
    initial_executor_metadatas_page_bounds: page,
  }));
  const header = Buffer.alloc(5);
  header.writeUInt32BE(payload.length, 1);
  const response = await fetch(new URL(path, base), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/connect+json',
      'Connect-Protocol-Version': '1',
      'x-codeium-csrf-token': csrf,
    },
    body: Buffer.concat([header, payload]),
    redirect: 'error',
    signal: AbortSignal.timeout(3500),
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`Language server HTTP ${response.status}`);
  }

  // The initial snapshot contains the usage. Close the subscription after reading it.
  const reader = response.body.getReader();
  let buffer = Buffer.alloc(0);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error('Incomplete agent state snapshot');
      buffer = Buffer.concat([buffer, value]);
      if (buffer.length < 5) continue;
      const flags = buffer[0];
      const length = buffer.readUInt32BE(1);
      if (length > maxFrameBytes) throw new Error('Agent state snapshot is too large');
      if (buffer.length < length + 5) continue;
      const frame = JSON.parse(buffer.subarray(5, length + 5).toString('utf8'));
      if (flags === 2 && !frame.error) return null;
      if (flags !== 0) throw new Error('Unexpected agent state snapshot');
      return readUsage(frame.update?.contextWindowUsage);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}
