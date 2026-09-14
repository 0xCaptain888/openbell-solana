import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createJudgeRunHandler } from '../api/judge-run.mjs';
import { MemoryTaskStore } from '../src/task-store.mjs';

function responseRecorder() {
  return {
    headers: {}, statusCode: 0, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

const quote = {
  provider: 'jupiter', status: 'QUOTED', inputMint: 'SOL', outputMint: 'AAPLx', amount: 10_000_000,
  outAmount: '302834', priceImpactPct: '0.12', contextSlot: 123, routePlan: [{ swapInfo: { label: 'test' } }]
};

test('Live Judge Run creates, evaluates, reads back, and emits notifications without settlement', async () => {
  const store = new MemoryTaskStore();
  const handler = createJudgeRunHandler({
    store,
    quoteFetcher: async () => quote,
    limiter: async () => {},
    keyPair: generateKeyPairSync('ed25519'),
    clock: () => new Date('2026-09-14T08:00:00.000Z')
  });
  const res = responseRecorder();
  await handler({ method: 'POST', headers: { 'x-idempotency-key': 'judge-run-test-1' }, body: { consent: true } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.task.state, 'VERIFIED');
  assert.equal(res.body.persistence.readBack, 'VERIFIED');
  assert.equal(res.body.persistence.receiptHashMatch, true);
  assert.equal(res.body.persistence.notificationCount, 2);
  assert.equal(res.body.safety.settlementAllowed, false);
  assert.equal(res.body.safety.fundsMoved, false);
  assert.equal(JSON.stringify(res.body).includes('PRIVATE KEY'), false);
});

test('Live Judge Run is idempotent and fails closed without consent', async () => {
  const store = new MemoryTaskStore();
  const handler = createJudgeRunHandler({ store, quoteFetcher: async () => quote, limiter: async () => {}, keyPair: generateKeyPairSync('ed25519') });
  const denied = responseRecorder();
  await handler({ method: 'POST', headers: { 'x-idempotency-key': 'judge-run-test-2' }, body: {} }, denied);
  assert.equal(denied.statusCode, 422);
  assert.equal(denied.body.error, 'CONSENT_REQUIRED');

  const first = responseRecorder();
  await handler({ method: 'POST', headers: { 'x-idempotency-key': 'judge-run-test-2' }, body: { consent: true } }, first);
  const replay = responseRecorder();
  await handler({ method: 'POST', headers: { 'x-idempotency-key': 'judge-run-test-2' }, body: { consent: true } }, replay);
  assert.equal(replay.body.idempotentReplay, true);
  assert.equal((await store.listTasks()).length, 1);
});
