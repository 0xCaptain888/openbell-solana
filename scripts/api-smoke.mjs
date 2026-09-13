import { generateKeyPairSync } from 'node:crypto';
import { createPolicy, signPolicy } from '../src/policy.mjs';

const baseUrl = process.env.OPENBELL_API_URL ?? 'http://127.0.0.1:8787';
const taskId = `api-smoke-${Date.now()}`;
const wallet = 'ApiSmokeWallet11111111111111111111111111111';
const { privateKey } = generateKeyPairSync('ed25519');
const policyEnvelope = signPolicy(createPolicy({
  subject: wallet,
  allowedAssets: ['AAPLx'],
  allowedMints: ['aaplx-mint'],
  maxOrderNotionalUsd: 100,
  maxPremiumBps: 50,
  minLiquidityUsd: 10000,
  maxQuoteAgeSeconds: 15,
  permissions: { evaluate: true, settle: false, recover: true },
  expiresAt: '2027-09-13T00:00:00.000Z',
  nonce: taskId
}), privateKey);

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...options.headers }
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${payload.error}: ${payload.message}`);
  return payload;
}

await request('/v1/tasks', {
  method: 'POST',
  body: JSON.stringify({
    taskId,
    intent: { wallet, asset: 'AAPLx', mint: 'aaplx-mint', issuer: 'Backed', orderNotionalUsd: 20 },
    policyEnvelope
  })
});
const evaluated = await request(`/v1/tasks/${encodeURIComponent(taskId)}/evaluate`, {
  method: 'POST',
  body: JSON.stringify({ underlyingOpen: false, referencePrice: 210, executablePrice: 210.5, quoteAgeSeconds: 2, liquidityUsd: 50000 })
});
const persisted = await request(`/v1/tasks/${encodeURIComponent(taskId)}`);
console.log(JSON.stringify({
  status: 'API_SMOKE_PASS',
  taskId,
  state: evaluated.state,
  persistedState: persisted.state,
  policyHash: persisted.policyHash,
  evidenceHash: persisted.receipt?.evidenceHash
}, null, 2));
