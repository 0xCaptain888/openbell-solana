import test from 'node:test';
import assert from 'node:assert/strict';
import handler, { paginateTasks } from '../api/openbell.mjs';

function responseRecorder() {
  return {
    headers: {},
    statusCode: 0,
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('Vercel API exposes a public, secret-free configuration status', async () => {
  const res = responseRecorder();
  await handler({ method: 'GET', query: { action: 'status' }, headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.service, 'openbell-task-api');
  assert.equal(res.body.persistence, 'PERSISTENCE_NOT_CONFIGURED');
  assert.equal(Object.hasOwn(res.body, 'token'), false);
});

test('Vercel API fails closed when durable persistence is absent', async () => {
  const res = responseRecorder();
  await handler({ method: 'GET', query: { action: 'tasks' }, headers: {} }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, 'PERSISTENCE_NOT_CONFIGURED');
});

test('task pagination is bounded, stable, and cursor based', () => {
  const tasks = [
    { taskId: 'old', updatedAt: '2026-09-14T01:00:00.000Z' },
    { taskId: 'new', updatedAt: '2026-09-14T03:00:00.000Z' },
    { taskId: 'middle', updatedAt: '2026-09-14T02:00:00.000Z' }
  ];
  const first = paginateTasks(tasks, { limit: 2 });
  assert.deepEqual(first.values.map((task) => task.taskId), ['new', 'middle']);
  assert.ok(first.nextCursor);
  const second = paginateTasks(tasks, { limit: 2, cursor: first.nextCursor });
  assert.deepEqual(second.values.map((task) => task.taskId), ['old']);
  assert.equal(second.nextCursor, null);
});
