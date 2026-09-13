import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createHmac } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NotificationCenter, WebhookNotifier } from '../src/notifications.mjs';
import { authorizeIntent, createPolicy, signPolicy, verifyPolicyEnvelope } from '../src/policy.mjs';
import { TASK_STATES, createOpenBell } from '../src/sdk.mjs';
import { JsonFileTaskStore, MemoryTaskStore } from '../src/task-store.mjs';

const now = () => new Date('2026-09-13T12:00:00.000Z');
const wallet = 'Wallet111111111111111111111111111111111111';

function signedPolicy(overrides = {}) {
  const { privateKey } = generateKeyPairSync('ed25519');
  const payload = createPolicy({
    subject: wallet,
    allowedAssets: ['AAPLx', 'NVDAx'],
    allowedMints: ['aaplx-mint', 'nvdax-mint'],
    maxOrderNotionalUsd: 100,
    maxPremiumBps: 50,
    minLiquidityUsd: 10000,
    maxQuoteAgeSeconds: 15,
    permissions: { evaluate: true, settle: true, recover: true },
    expiresAt: '2026-09-14T12:00:00.000Z',
    nonce: 'test-policy',
    ...overrides
  });
  return signPolicy(payload, privateKey);
}

const intent = { wallet, asset: 'AAPLx', mint: 'aaplx-mint', issuer: 'Backed', orderNotionalUsd: 20 };
const fairObservation = { underlyingOpen: false, referencePrice: 210, executablePrice: 210.5, quoteAgeSeconds: 2, liquidityUsd: 50000 };

test('Ed25519 policy authorizes only the signed scope', () => {
  const envelope = signedPolicy();
  assert.equal(verifyPolicyEnvelope(envelope, { now: now() }).valid, true);
  assert.equal(authorizeIntent(envelope, intent, { now: now() }).authorized, true);
  assert.equal(authorizeIntent(envelope, { ...intent, asset: 'TSLAx' }, { now: now() }).authorized, false);
  const tampered = structuredClone(envelope);
  tampered.payload.maxOrderNotionalUsd = 1000000;
  assert.equal(verifyPolicyEnvelope(tampered, { now: now() }).valid, false);
});

test('SDK fails closed, persists decisions, and emits notifications', async () => {
  const store = new MemoryTaskStore();
  const policyEnvelope = signedPolicy();
  const sdk = createOpenBell({ store, clock: now, trustedPolicyKeys: [policyEnvelope.publicKey] });
  await sdk.createTask({ taskId: 'fair-task', intent, policyEnvelope });
  const verified = await sdk.evaluateTask('fair-task', fairObservation);
  assert.equal(verified.state, TASK_STATES.VERIFIED);
  assert.match(verified.receipt.evidenceHash, /^[a-f0-9]{64}$/);
  assert.equal((await sdk.listNotifications()).some((entry) => entry.topic === 'task.verified'), true);

  const denied = await sdk.createTask({ taskId: 'denied-task', intent: { ...intent, asset: 'TSLAx' }, policyEnvelope });
  assert.equal(denied.state, TASK_STATES.BLOCKED);
  assert.ok(denied.authorization.reasons.includes('asset_not_allowed'));
});

test('FROZEN task requires an allowed recovery transition', async () => {
  const policyEnvelope = signedPolicy();
  const sdk = createOpenBell({ clock: now, trustedPolicyKeys: [policyEnvelope.publicKey] });
  await sdk.createTask({ taskId: 'recovery-task', intent, policyEnvelope });
  const frozen = await sdk.evaluateTask('recovery-task', { ...fairObservation, corporateActionPending: true });
  assert.equal(frozen.state, TASK_STATES.FROZEN);
  const recovered = await sdk.recoverTask('recovery-task', fairObservation);
  assert.equal(recovered.state, TASK_STATES.VERIFIED);
  assert.equal(recovered.events.some((event) => event.type === 'RECOVERY_REQUESTED'), true);
});

test('SETTLED requires VERIFIED state and signed settlement permission', async () => {
  const policyEnvelope = signedPolicy();
  const sdk = createOpenBell({ clock: now, trustedPolicyKeys: [policyEnvelope.publicKey] });
  await sdk.createTask({ taskId: 'settlement-task', intent, policyEnvelope });
  await assert.rejects(() => sdk.settleTask('settlement-task', {}), /Only a VERIFIED task/);
  await sdk.evaluateTask('settlement-task', fairObservation);
  const settled = await sdk.settleTask('settlement-task', {
    found: true, success: true, signature: 'devnet-signature', slot: 42, blockTime: 1,
    feeLamports: 5000, preBalances: [10], postBalances: [9], preTokenBalances: [], postTokenBalances: []
  });
  assert.equal(settled.state, TASK_STATES.SETTLED);
  assert.equal(settled.transactionReceipt.transactionProof.signature, 'devnet-signature');
});

test('JSON store survives a new SDK instance', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'openbell-store-'));
  const filePath = join(directory, 'tasks.json');
  try {
    const policyEnvelope = signedPolicy();
    const trust = { clock: now, trustedPolicyKeys: [policyEnvelope.publicKey] };
    const first = createOpenBell({ store: new JsonFileTaskStore(filePath), ...trust });
    await first.createTask({ taskId: 'persistent-task', intent, policyEnvelope });
    await first.evaluateTask('persistent-task', fairObservation);
    const second = createOpenBell({ store: new JsonFileTaskStore(filePath), ...trust });
    assert.equal((await second.getTask('persistent-task')).state, TASK_STATES.VERIFIED);
    assert.equal(JSON.parse(await readFile(filePath, 'utf8')).storeVersion, 'openbell.store.v1');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('SDK strict mode rejects a valid signature from an untrusted key', async () => {
  const policyEnvelope = signedPolicy();
  const sdk = createOpenBell({ clock: now });
  const task = await sdk.createTask({ taskId: 'untrusted-task', intent, policyEnvelope });
  assert.equal(task.state, TASK_STATES.BLOCKED);
  assert.ok(task.authorization.reasons.includes('untrusted_policy_signer'));
});

test('webhook notifications support an HMAC signature', async () => {
  let request;
  const fetchImpl = async (url, options) => { request = { url, ...options }; return { ok: true, status: 200 }; };
  const adapter = new WebhookNotifier({ url: 'https://example.invalid/openbell', secret: 'test-secret', fetchImpl });
  const notification = { topic: 'task.blocked', taskId: 'task-1' };
  await new NotificationCenter([adapter]).publish(notification);
  assert.equal(request.headers['x-openbell-signature'], createHmac('sha256', 'test-secret').update(JSON.stringify(notification)).digest('hex'));
});
