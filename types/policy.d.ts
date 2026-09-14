import type { Intent, Policy, PolicyEnvelope } from './index.js';

export function createPolicy(input: {
  subject: string;
  allowedAssets?: string[];
  allowedMints?: string[];
  maxOrderNotionalUsd?: number;
  maxPremiumBps?: number;
  minLiquidityUsd?: number;
  maxQuoteAgeSeconds?: number;
  permissions?: Partial<Policy['permissions']>;
  expiresAt: string;
  nonce?: string;
}): Policy;
export function hashPolicy(payload: Policy): string;
export function signPolicy(payload: Policy, privateKey: unknown): PolicyEnvelope;
export function verifyPolicyEnvelope(envelope: PolicyEnvelope, options?: { now?: Date; trustedPublicKeys?: string[]; requireTrustedPolicyKey?: boolean }): { valid: boolean; reasons: string[]; policyHash: string | null; signatureValid: boolean };
export function authorizeIntent(envelope: PolicyEnvelope, intent: Intent, options?: { now?: Date; trustedPublicKeys?: string[]; requireTrustedPolicyKey?: boolean }): { authorized: boolean; reasons: string[]; policy: Policy; policyHash: string | null };
