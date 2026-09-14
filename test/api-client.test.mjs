import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenBellApiClient, OpenBellApiError, runLiveJudgeTask } from '../src/api-client.mjs';

test('API client sends auth only to protected OpenBell operations', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), options });
    return new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const client = new OpenBellApiClient({ baseUrl: 'https://openbell.example/api/openbell', token: 'secret', fetchImpl });
  await client.getStatus();
  await client.createTask({ taskId: 't-1' }, { idempotencyKey: 'partner-t-1' });
  assert.equal(requests[0].options.headers.authorization, undefined);
  assert.equal(requests[1].options.headers.authorization, 'Bearer secret');
  assert.equal(requests[1].options.headers['x-idempotency-key'], 'partner-t-1');
});

test('API client surfaces structured errors', async () => {
  const client = new OpenBellApiClient({
    baseUrl: 'https://openbell.example/api/openbell',
    fetchImpl: async () => new Response(JSON.stringify({ error: 'UNAUTHORIZED', message: 'No' }), { status: 401 })
  });
  await assert.rejects(() => client.listTasks(), (error) => error instanceof OpenBellApiError && error.code === 'UNAUTHORIZED' && error.status === 401);
});

test('public Judge Run client never sends an operator bearer token', async () => {
  let request;
  const result = await runLiveJudgeTask({
    baseUrl: 'https://openbell.example',
    idempotencyKey: 'judge-test-1234',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ runVersion: 'openbell.live-judge.v1' }), { status: 200 });
    }
  });
  assert.equal(result.runVersion, 'openbell.live-judge.v1');
  assert.equal(request.options.headers.authorization, undefined);
});
