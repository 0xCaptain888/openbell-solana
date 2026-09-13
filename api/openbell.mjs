import { NotificationCenter, WebhookNotifier } from '../src/notifications.mjs';
import { createRedisRestTaskStoreFromEnv } from '../src/redis-rest-task-store.mjs';
import { OpenBellError, createOpenBell } from '../src/sdk.mjs';

export const config = { runtime: 'nodejs' };

function trustedKeysFromEnv(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((entry) => typeof entry === 'string') ? parsed : [];
  } catch {
    return [];
  }
}

const policyMode = process.env.OPENBELL_POLICY_MODE ?? 'strict';
const trustedPolicyKeys = trustedKeysFromEnv(process.env.OPENBELL_TRUSTED_POLICY_KEYS_JSON);
const store = createRedisRestTaskStoreFromEnv();
const adapters = [];
if (process.env.OPENBELL_WEBHOOK_URL) adapters.push(new WebhookNotifier({
  url: process.env.OPENBELL_WEBHOOK_URL,
  secret: process.env.OPENBELL_WEBHOOK_SECRET
}));
const sdk = store ? createOpenBell({
  store,
  notifications: new NotificationCenter(adapters),
  trustedPolicyKeys,
  requireTrustedPolicyKey: policyMode !== 'development'
}) : null;

function send(res, status, body) {
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('access-control-allow-origin', process.env.ALLOWED_ORIGIN ?? '*');
  res.setHeader('access-control-allow-headers', 'authorization, content-type');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  return res.status(status).json(body);
}

function bearerToken(req) {
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

function requireService() {
  if (!store || !sdk) {
    throw new OpenBellError('PERSISTENCE_NOT_CONFIGURED', 'Remote task persistence is not configured for this deployment');
  }
}

function requireAuthorization(req) {
  const expected = process.env.OPENBELL_API_BEARER_TOKEN;
  if (!expected) throw new OpenBellError('WRITE_AUTH_NOT_CONFIGURED', 'Task API authorization is not configured');
  if (bearerToken(req) !== expected) throw new OpenBellError('UNAUTHORIZED', 'A valid API bearer token is required');
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const action = String(req.query?.action ?? 'status');
  try {
    if (req.method === 'GET' && action === 'status') {
      return send(res, 200, {
        status: 'ok',
        service: 'openbell-task-api',
        apiVersion: 'v1',
        persistence: store ? 'REMOTE_CONFIGURED' : 'PERSISTENCE_NOT_CONFIGURED',
        policyMode,
        trustedPolicyKeyCount: trustedPolicyKeys.length,
        writeAuthorization: process.env.OPENBELL_API_BEARER_TOKEN ? 'CONFIGURED' : 'NOT_CONFIGURED',
        capabilities: ['signed-policy-gate', 'task-state-machine', 'notification-outbox', 'transaction-proof-binding']
      });
    }

    requireService();
    requireAuthorization(req);
    if (req.method === 'GET' && action === 'tasks') return send(res, 200, { tasks: await sdk.listTasks() });
    if (req.method === 'GET' && action === 'task') return send(res, 200, await sdk.getTask(String(req.query.taskId ?? '')));
    if (req.method === 'GET' && action === 'notifications') {
      return send(res, 200, { notifications: await sdk.listNotifications({ limit: Number(req.query.limit ?? 100) }) });
    }
    if (req.method === 'POST' && action === 'create') return send(res, 201, await sdk.createTask(req.body ?? {}));
    const taskId = String(req.query.taskId ?? req.body?.taskId ?? '');
    if (req.method === 'POST' && action === 'evaluate') return send(res, 200, await sdk.evaluateTask(taskId, req.body?.observation ?? req.body ?? {}));
    if (req.method === 'POST' && action === 'recover') return send(res, 200, await sdk.recoverTask(taskId, req.body?.observation ?? req.body ?? {}));
    if (req.method === 'POST' && action === 'cancel') return send(res, 200, await sdk.cancelTask(taskId, req.body?.reason));
    if (req.method === 'POST' && action === 'settle') return send(res, 200, await sdk.settleTask(taskId, req.body?.transactionProof ?? req.body ?? {}));
    return send(res, 404, { error: 'NOT_FOUND', message: 'Action not found' });
  } catch (error) {
    const status = error.code === 'UNAUTHORIZED' ? 401
      : ['PERSISTENCE_NOT_CONFIGURED', 'WRITE_AUTH_NOT_CONFIGURED'].includes(error.code) ? 503
        : error.code === 'TASK_NOT_FOUND' ? 404
          : error instanceof OpenBellError ? 422 : 500;
    return send(res, status, { error: error.code ?? 'INTERNAL_ERROR', message: error.message, details: error.details ?? {} });
  }
}
