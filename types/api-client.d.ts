import type { Observation, OpenBellTask, PolicyEnvelope, Intent } from './index.js';
export class OpenBellApiError extends Error { code: string; status: number; details: Record<string, unknown> }
export class OpenBellApiClient {
  constructor(options: { baseUrl: string; token?: string; fetchImpl?: typeof fetch });
  getStatus(): Promise<Record<string, unknown>>;
  listTasks(options?: { limit?: number; cursor?: string }): Promise<{ tasks: OpenBellTask[]; nextCursor?: string | null }>;
  getTask(taskId: string): Promise<OpenBellTask>;
  listNotifications(options?: { limit?: number }): Promise<{ notifications: unknown[] }>;
  createTask(input: { taskId?: string; intent: Intent; policyEnvelope: PolicyEnvelope }, options?: { idempotencyKey?: string }): Promise<OpenBellTask>;
  evaluateTask(taskId: string, observation: Observation): Promise<OpenBellTask>;
  recoverTask(taskId: string, observation: Observation): Promise<OpenBellTask>;
  cancelTask(taskId: string, reason?: string): Promise<OpenBellTask>;
  settleTask(taskId: string, transactionProof: Record<string, unknown>): Promise<OpenBellTask>;
}
export function createOpenBellApiClient(options: ConstructorParameters<typeof OpenBellApiClient>[0]): OpenBellApiClient;
export function runLiveJudgeTask(options: { baseUrl: string; idempotencyKey?: string; fetchImpl?: typeof fetch }): Promise<Record<string, unknown>>;
