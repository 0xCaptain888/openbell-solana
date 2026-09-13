import { createHash, createPublicKey, sign, verify } from 'node:crypto';

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashPolicy(payload) {
  return createHash('sha256').update(stable(payload)).digest('hex');
}

export function createPolicy({
  subject,
  allowedAssets = [],
  allowedMints = [],
  maxOrderNotionalUsd = 100,
  maxPremiumBps = 50,
  minLiquidityUsd = 10000,
  maxQuoteAgeSeconds = 15,
  permissions = { evaluate: true, settle: false, recover: true },
  expiresAt,
  nonce = 'openbell-policy-v1'
} = {}) {
  if (!subject) throw new Error('Policy subject is required');
  if (!expiresAt) throw new Error('Policy expiration is required');
  return {
    policyVersion: 'openbell.policy.v1',
    subject,
    allowedAssets: [...new Set(allowedAssets)].sort(),
    allowedMints: [...new Set(allowedMints)].sort(),
    maxOrderNotionalUsd,
    maxPremiumBps,
    minLiquidityUsd,
    maxQuoteAgeSeconds,
    permissions: {
      evaluate: permissions.evaluate !== false,
      settle: permissions.settle === true,
      recover: permissions.recover !== false
    },
    expiresAt,
    nonce
  };
}

export function signPolicy(payload, privateKey) {
  const message = Buffer.from(stable(payload));
  const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
  return {
    envelopeVersion: 'openbell.signed-policy.v1',
    algorithm: 'Ed25519',
    payload,
    policyHash: hashPolicy(payload),
    publicKey,
    signature: sign(null, message, privateKey).toString('base64')
  };
}

export function verifyPolicyEnvelope(envelope, { now = new Date(), trustedPublicKeys = [], requireTrustedPolicyKey = false } = {}) {
  const reasons = [];
  if (!envelope || envelope.envelopeVersion !== 'openbell.signed-policy.v1') reasons.push('invalid_envelope_version');
  if (envelope?.algorithm !== 'Ed25519') reasons.push('unsupported_signature_algorithm');
  const payload = envelope?.payload;
  const calculatedHash = payload ? hashPolicy(payload) : null;
  if (!payload || calculatedHash !== envelope?.policyHash) reasons.push('policy_hash_mismatch');
  let signatureValid = false;
  try {
    signatureValid = Boolean(payload && envelope?.publicKey && envelope?.signature && verify(
      null,
      Buffer.from(stable(payload)),
      envelope.publicKey,
      Buffer.from(envelope.signature, 'base64')
    ));
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) reasons.push('policy_signature_invalid');
  const expiration = payload?.expiresAt ? new Date(payload.expiresAt).getTime() : NaN;
  if (!Number.isFinite(expiration)) reasons.push('policy_expiration_invalid');
  else if (expiration <= now.getTime()) reasons.push('policy_expired');
  if (requireTrustedPolicyKey && !trustedPublicKeys.includes(envelope?.publicKey)) reasons.push('untrusted_policy_signer');
  return { valid: reasons.length === 0, reasons, policyHash: calculatedHash, signatureValid };
}

export function authorizeIntent(envelope, intent, options = {}) {
  const verification = verifyPolicyEnvelope(envelope, options);
  const reasons = [...verification.reasons];
  const policy = envelope?.payload ?? {};
  if (!policy.permissions?.evaluate) reasons.push('evaluate_permission_missing');
  if (intent?.wallet !== policy.subject) reasons.push('wallet_not_policy_subject');
  if (policy.allowedAssets?.length && !policy.allowedAssets.includes(intent?.asset)) reasons.push('asset_not_allowed');
  if (policy.allowedMints?.length && !policy.allowedMints.includes(intent?.mint)) reasons.push('mint_not_allowed');
  if (Number(intent?.orderNotionalUsd ?? 0) > Number(policy.maxOrderNotionalUsd ?? 0)) reasons.push('order_notional_exceeded');
  return { authorized: reasons.length === 0, reasons, policy, policyHash: verification.policyHash };
}
