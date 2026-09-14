export type Decision = 'VERIFIED' | 'BLOCKED' | 'FROZEN';
export type TaskState = 'PENDING' | Decision | 'SETTLED' | 'CANCELLED';

export interface Intent {
  wallet: string;
  asset: string;
  mint: string;
  issuer: string;
  orderNotionalUsd: number;
}

export interface PolicyPermissions { evaluate: boolean; settle: boolean; recover: boolean }
export interface Policy {
  policyVersion: 'openbell.policy.v1'; subject: string; allowedAssets: string[]; allowedMints: string[];
  maxOrderNotionalUsd: number; maxPremiumBps: number; minLiquidityUsd: number; maxQuoteAgeSeconds: number;
  permissions: PolicyPermissions; expiresAt: string; nonce: string;
}
export interface PolicyEnvelope {
  envelopeVersion: 'openbell.signed-policy.v1'; algorithm: 'Ed25519'; payload: Policy; policyHash: string; publicKey: string; signature: string;
}
export interface Observation {
  underlyingOpen?: boolean; referencePrice: number; executablePrice: number; quoteAgeSeconds?: number;
  liquidityUsd?: number; corporateActionPending?: boolean; eligible?: boolean; routeAvailable?: boolean; route?: string; observedAt?: string;
}
export interface Receipt { taskId: string; decision: Decision; evidenceHash: string; reasons: string[]; checks: Record<string, boolean>; [key: string]: unknown }
export interface OpenBellTask { taskId: string; state: TaskState; intent: Intent; policyEnvelope: PolicyEnvelope; policyHash: string; receipt: Receipt | null; events: unknown[]; createdAt: string; updatedAt: string }

export class OpenBellError extends Error { code: string; details: Record<string, unknown> }
export class OpenBellSDK {
  createTask(input: { taskId?: string; intent: Intent; policyEnvelope: PolicyEnvelope }): Promise<OpenBellTask>;
  evaluateTask(taskId: string, observation: Observation): Promise<OpenBellTask>;
  recoverTask(taskId: string, observation: Observation): Promise<OpenBellTask>;
  settleTask(taskId: string, transactionProof: Record<string, unknown>): Promise<OpenBellTask>;
  cancelTask(taskId: string, reason?: string): Promise<OpenBellTask>;
  getTask(taskId: string): Promise<OpenBellTask>;
  listTasks(): Promise<OpenBellTask[]>;
  listNotifications(options?: { limit?: number }): Promise<unknown[]>;
}
export function createOpenBell(options?: Record<string, unknown>): OpenBellSDK;
export const TASK_STATES: Readonly<Record<string, TaskState>>;
