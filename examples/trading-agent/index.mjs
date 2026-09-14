import { generateKeyPairSync } from 'node:crypto';
import { createOpenBell } from '../../src/sdk.mjs';
import { createPolicy, signPolicy } from '../../src/policy.mjs';

const wallet = 'PartnerAgent1111111111111111111111111111111';
const aaplxMint = 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp';
const { privateKey } = generateKeyPairSync('ed25519');
const policyEnvelope = signPolicy(createPolicy({
  subject: wallet,
  allowedAssets: ['AAPLx'],
  allowedMints: [aaplxMint],
  maxOrderNotionalUsd: 25,
  maxPremiumBps: 50,
  minLiquidityUsd: 10_000,
  maxQuoteAgeSeconds: 15,
  permissions: { evaluate: true, settle: false, recover: true },
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  nonce: 'partner-agent-example'
}), privateKey);

const openbell = createOpenBell({ trustedPolicyKeys: [policyEnvelope.publicKey] });
await openbell.createTask({
  taskId: 'partner-agent-aaplx-001',
  intent: { wallet, asset: 'AAPLx', mint: aaplxMint, issuer: 'Backed / xStocks', orderNotionalUsd: 20 },
  policyEnvelope
});
const task = await openbell.evaluateTask('partner-agent-aaplx-001', {
  underlyingOpen: false,
  referencePrice: 210,
  executablePrice: 210.42,
  quoteAgeSeconds: 2,
  liquidityUsd: 50_000,
  route: 'Partner trading agent → OpenBell → execution adapter'
});

console.log(JSON.stringify({
  integration: 'third-party-trading-agent',
  state: task.state,
  policyHash: task.policyHash,
  evidenceHash: task.receipt.evidenceHash,
  settlementReleased: false,
  nextStep: task.state === 'VERIFIED' ? 'Ask the user wallet to sign outside OpenBell.' : 'Do not build a transaction.'
}, null, 2));
