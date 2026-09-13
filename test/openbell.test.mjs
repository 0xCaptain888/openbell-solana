import test from 'node:test';
import assert from 'node:assert/strict';
import { DECISIONS, demoFixtures, evaluateExecution, hashEvidence } from '../src/openbell.mjs';
import { assertTransactionProof, attachTransactionProof } from '../src/transaction-proof.mjs';

test('fair off-hours quote is VERIFIED', () => {
  const receipt = evaluateExecution(demoFixtures.verified);
  assert.equal(receipt.decision, DECISIONS.VERIFIED);
  assert.equal(receipt.premiumBps, 26);
  assert.equal(receipt.checks.quoteFresh, true);
  assert.match(receipt.evidenceHash, /^[a-f0-9]{64}$/);
});

test('off-hours premium is BLOCKED before settlement', () => {
  const receipt = evaluateExecution(demoFixtures.blocked);
  assert.equal(receipt.decision, DECISIONS.BLOCKED);
  assert.ok(receipt.reasons.includes('off_hours_premium_exceeded'));
});

test('corporate action transition is FROZEN even when quote is fair', () => {
  const receipt = evaluateExecution(demoFixtures.frozen);
  assert.equal(receipt.decision, DECISIONS.FROZEN);
  assert.deepEqual(receipt.reasons, ['corporate_action_transition']);
});

test('scaled UI amount cannot be used as raw transfer amount', () => {
  const receipt = evaluateExecution(demoFixtures.scaledMismatch);
  assert.equal(receipt.decision, DECISIONS.BLOCKED);
  assert.ok(receipt.reasons.includes('scaled_amount_used_as_raw_amount'));
  assert.equal(receipt.expectedRawAmount, 10);
});

test('evidence hash is deterministic', () => {
  assert.equal(hashEvidence({ b: 2, a: 1 }), hashEvidence({ a: 1, b: 2 }));
});

test('transaction proof requires a found successful transaction', () => {
  const proof = { found: true, success: true, signature: 'demo', slot: 42, preTokenBalances: [], postTokenBalances: [] };
  assert.equal(assertTransactionProof(proof), proof);
  assert.throws(() => assertTransactionProof({ found: false }), /not found/);
  assert.throws(() => assertTransactionProof({ found: true, success: false, error: { InstructionError: [0, 'Custom'] } }), /Transaction failed/);
});

test('transaction proof can be attached to a receipt with a new evidence hash', async () => {
  const receipt = { taskId: 'demo', decision: 'VERIFIED' };
  const attached = await attachTransactionProof(receipt, { found: true, success: true, signature: 'sig', slot: 9, blockTime: 1, feeLamports: 5000, preBalances: [1], postBalances: [2], preTokenBalances: [], postTokenBalances: [] });
  assert.equal(attached.transactionProof.signature, 'sig');
  assert.match(attached.evidenceHash, /^[a-f0-9]{64}$/);
  assert.notEqual(attached.evidenceHash, undefined);
});
