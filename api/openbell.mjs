import { createHash } from 'node:crypto';
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
  res.setHeader('access-control-allow-headers', 'authorization, content-type, x-idempotency-key');
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

export function paginateTasks(items, { limit: requestedLimit = 50, cursor } = {}) {
  const limit = Math.max(1, Math.min(Number(requestedLimit) || 50, 100));
  const decoded = cursor ? Number(Buffer.from(String(cursor), 'base64url').toString('utf8')) : 0;
  const offset = Number.isSafeInteger(decoded) && decoded >= 0 ? decoded : 0;
  const sorted = [...items].sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
  const values = sorted.slice(offset, offset + limit);
  const nextOffset = offset + values.length;
  return { values, nextCursor: nextOffset < sorted.length ? Buffer.from(String(nextOffset)).toString('base64url') : null };
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
        capabilities: ['signed-policy-gate', 'task-state-machine', 'notification-outbox', 'transaction-proof-binding', 'idempotent-create', 'cursor-pagination', 'restricted-live-judge-run']
      });
    }

    requireService();
    requireAuthorization(req);
    if (req.method === 'GET' && action === 'tasks') {
      const result = paginateTasks(await sdk.listTasks(), req.query);
      return send(res, 200, { tasks: result.values, nextCursor: result.nextCursor });
    }
    if (req.method === 'GET' && action === 'task') return send(res, 200, await sdk.getTask(String(req.query.taskId ?? '')));
    if (req.method === 'GET' && action === 'notifications') {
      return send(res, 200, { notifications: await sdk.listNotifications({ limit: Number(req.query.limit ?? 100) }) });
    }
    if (req.method === 'POST' && action === 'create') {
      const input = structuredClone(req.body ?? {});
      const idempotencyKey = String(req.headers?.['x-idempotency-key'] ?? '');
      if (idempotencyKey && !/^[A-Za-z0-9._:-]{8,96}$/.test(idempotencyKey)) {
        throw new OpenBellError('IDEMPOTENCY_KEY_INVALID', 'x-idempotency-key must contain 8-96 safe characters');
      }
      if (idempotencyKey && !input.taskId) input.taskId = `api-${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 32)}`;
      if (idempotencyKey && input.taskId) {
        const existing = await store.getTask(input.taskId);
        if (existing) return send(res, 200, existing);
      }
      return send(res, 201, await sdk.createTask(input));
    }
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
