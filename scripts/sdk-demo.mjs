import { generateKeyPairSync } from 'node:crypto';
import { demoFixtures } from '../src/openbell.mjs';
import { createPolicy, signPolicy } from '../src/policy.mjs';
import { createOpenBell } from '../src/sdk.mjs';

const { privateKey } = generateKeyPairSync('ed25519');
const wallet = 'DemoWallet111111111111111111111111111111111';
const policyEnvelope = signPolicy(createPolicy({
  subject: wallet,
  allowedAssets: ['AAPLx', 'TSLAx', 'NVDAx'],
  maxOrderNotionalUsd: 100,
  maxPremiumBps: 50,
  minLiquidityUsd: 10000,
  maxQuoteAgeSeconds: 15,
  permissions: { evaluate: true, settle: false, recover: true },
  expiresAt: '2027-09-13T00:00:00.000Z',
  nonce: 'sdk-demo-2026-09-13'
}), privateKey);

const sdk = createOpenBell({ trustedPolicyKeys: [policyEnvelope.publicKey] });
for (const [name, observation] of Object.entries({
  verified: demoFixtures.verified,
  blocked: demoFixtures.blocked,
  frozen: demoFixtures.frozen
})) {
  const taskId = `sdk-${name}`;
  await sdk.createTask({
    taskId,
    intent: {
      wallet,
      asset: observation.asset,
      mint: observation.mint,
      issuer: observation.issuer,
      orderNotionalUsd: observation.orderNotionalUsd
    },
    policyEnvelope
  });
  const task = await sdk.evaluateTask(taskId, observation);
  console.log(JSON.stringify({ taskId, state: task.state, reasons: task.receipt.reasons, policyHash: task.policyHash, evidenceHash: task.receipt.evidenceHash }, null, 2));
}

console.log(JSON.stringify({ notifications: (await sdk.listNotifications()).length }, null, 2));
