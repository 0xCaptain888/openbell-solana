import test from 'node:test';
import assert from 'node:assert/strict';
import { RedisRestTaskStore, createRedisRestTaskStoreFromEnv } from '../src/redis-rest-task-store.mjs';

function fakeRedis() {
  const values = new Map();
  const sets = new Map();
  const lists = new Map();
  const execute = (command) => {
    const [name, key, ...args] = command;
    if (name === 'GET') return values.get(key) ?? null;
    if (name === 'SET') { values.set(key, args[0]); return 'OK'; }
    if (name === 'SADD') { const set = sets.get(key) ?? new Set(); set.add(args[0]); sets.set(key, set); return 1; }
    if (name === 'SMEMBERS') return [...(sets.get(key) ?? [])];
    if (name === 'MGET') return [key, ...args].filter(Boolean).map((item) => values.get(item) ?? null);
    if (name === 'LPUSH') { const list = lists.get(key) ?? []; list.unshift(args[0]); lists.set(key, list); return list.length; }
    if (name === 'LTRIM') { lists.set(key, (lists.get(key) ?? []).slice(Number(args[0]), Number(args[1]) + 1)); return 'OK'; }
    if (name === 'LRANGE') return (lists.get(key) ?? []).slice(Number(args[0]), Number(args[1]) + 1);
    throw new Error(`Unsupported command ${name}`);
  };
  return async (url, options) => {
    const body = JSON.parse(options.body);
    const payload = url.endsWith('/pipeline') || url.endsWith('/multi-exec') ? body.map((command) => ({ result: execute(command) })) : { result: execute(body) };
    return { ok: true, status: 200, json: async () => payload };
  };
}

test('Redis REST store persists tasks and notification history', async () => {
  const store = new RedisRestTaskStore({ url: 'https://redis.invalid', token: 'test', fetchImpl: fakeRedis() });
  const task = { taskId: 'task-1', state: 'VERIFIED' };
  await store.putTask(task);
  assert.deepEqual(await store.getTask('task-1'), task);
  assert.deepEqual(await store.listTasks(), [task]);
  await store.addNotification({ notificationId: 'n-1', topic: 'task.verified' });
  await store.addNotification({ notificationId: 'n-2', topic: 'task.frozen' });
  assert.deepEqual((await store.listNotifications({ limit: 1 })).map((entry) => entry.notificationId), ['n-2']);
});

test('environment factory stays explicitly unconfigured without credentials', () => {
  assert.equal(createRedisRestTaskStoreFromEnv({}), null);
  assert.ok(createRedisRestTaskStoreFromEnv({ OPENBELL_REDIS_REST_URL: 'https://redis.invalid', OPENBELL_REDIS_REST_TOKEN: 'token' }, { fetchImpl: fakeRedis() }));
});
