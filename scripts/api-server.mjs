import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { NotificationCenter, WebhookNotifier } from '../src/notifications.mjs';
import { OpenBellError, createOpenBell } from '../src/sdk.mjs';
import { JsonFileTaskStore } from '../src/task-store.mjs';

const port = Number(process.env.OPENBELL_API_PORT ?? 8787);
const host = process.env.OPENBELL_API_HOST ?? '127.0.0.1';
const storePath = resolve(process.env.OPENBELL_TASK_STORE ?? '.openbell/tasks.json');
const policyMode = process.env.OPENBELL_POLICY_MODE ?? 'strict';
const trustedPolicyKeys = process.env.OPENBELL_TRUSTED_POLICY_KEYS_JSON
  ? JSON.parse(process.env.OPENBELL_TRUSTED_POLICY_KEYS_JSON)
  : [];
const adapters = [];
if (process.env.OPENBELL_WEBHOOK_URL) adapters.push(new WebhookNotifier({
  url: process.env.OPENBELL_WEBHOOK_URL,
  secret: process.env.OPENBELL_WEBHOOK_SECRET
}));
const sdk = createOpenBell({
  store: new JsonFileTaskStore(storePath),
  notifications: new NotificationCenter(adapters),
  trustedPolicyKeys,
  requireTrustedPolicyKey: policyMode !== 'development'
});

function send(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': process.env.ALLOWED_ORIGIN ?? 'http://localhost:4173',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS'
  });
  res.end(`${JSON.stringify(body, null, 2)}\n`);
}

async function readBody(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 1_000_000) throw new OpenBellError('PAYLOAD_TOO_LARGE', 'Request body exceeds 1 MB');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const url = new URL(req.url, `http://${req.headers.host ?? `${host}:${port}`}`);
  const segments = url.pathname.split('/').filter(Boolean);
  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      return send(res, 200, { status: 'ok', service: 'openbell-api', apiVersion: 'v1', store: storePath, policyMode, trustedPolicyKeyCount: trustedPolicyKeys.length });
    }
    if (req.method === 'GET' && url.pathname === '/v1/tasks') return send(res, 200, { tasks: await sdk.listTasks() });
    if (req.method === 'POST' && url.pathname === '/v1/tasks') return send(res, 201, await sdk.createTask(await readBody(req)));
    if (req.method === 'GET' && url.pathname === '/v1/notifications') {
      return send(res, 200, { notifications: await sdk.listNotifications({ limit: Number(url.searchParams.get('limit') ?? 100) }) });
    }
    if (segments[0] === 'v1' && segments[1] === 'tasks' && segments[2]) {
      const taskId = decodeURIComponent(segments[2]);
      if (req.method === 'GET' && segments.length === 3) return send(res, 200, await sdk.getTask(taskId));
      if (req.method === 'POST' && segments[3] === 'evaluate') return send(res, 200, await sdk.evaluateTask(taskId, await readBody(req)));
      if (req.method === 'POST' && segments[3] === 'recover') return send(res, 200, await sdk.recoverTask(taskId, await readBody(req)));
      if (req.method === 'POST' && segments[3] === 'cancel') {
        const body = await readBody(req); return send(res, 200, await sdk.cancelTask(taskId, body.reason));
      }
      if (req.method === 'POST' && segments[3] === 'settle') return send(res, 200, await sdk.settleTask(taskId, await readBody(req)));
    }
    return send(res, 404, { error: 'NOT_FOUND', message: 'Route not found' });
  } catch (error) {
    const status = error instanceof OpenBellError
      ? error.code === 'TASK_NOT_FOUND' ? 404 : error.code === 'PAYLOAD_TOO_LARGE' ? 413 : 422
      : error instanceof SyntaxError ? 400 : 500;
    return send(res, status, { error: error.code ?? 'INTERNAL_ERROR', message: error.message, details: error.details ?? {} });
  }
});

server.listen(port, host, () => {
  console.log(`OpenBell API: http://${host}:${port}`);
  console.log(`Persistent store: ${storePath}`);
});
