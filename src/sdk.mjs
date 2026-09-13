import { randomUUID } from 'node:crypto';
import { DECISIONS, evaluateExecution, hashEvidence } from './openbell.mjs';
import { NotificationCenter } from './notifications.mjs';
import { authorizeIntent, verifyPolicyEnvelope } from './policy.mjs';
import { MemoryTaskStore } from './task-store.mjs';
import { attachTransactionProof } from './transaction-proof.mjs';

export const TASK_STATES = Object.freeze({
  PENDING: 'PENDING',
  VERIFIED: DECISIONS.VERIFIED,
  BLOCKED: DECISIONS.BLOCKED,
  FROZEN: DECISIONS.FROZEN,
  SETTLED: 'SETTLED',
  CANCELLED: 'CANCELLED'
});

export class OpenBellError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'OpenBellError';
    this.code = code;
    this.details = details;
  }
}

const unique = (values) => [...new Set(values)];

export class OpenBellSDK {
  constructor({ store = new MemoryTaskStore(), notifications = new NotificationCenter(), clock = () => new Date(), trustedPolicyKeys = [], requireTrustedPolicyKey = true } = {}) {
    this.store = store;
    this.notifications = notifications;
    this.clock = clock;
    this.trustedPolicyKeys = trustedPolicyKeys;
    this.requireTrustedPolicyKey = requireTrustedPolicyKey;
  }

  timestamp() { return this.clock().toISOString(); }

  async emit(task, topic, severity, payload = {}) {
    const notification = {
      notificationVersion: 'openbell.notification.v1',
      notificationId: randomUUID(),
      taskId: task.taskId,
      topic,
      severity,
      createdAt: this.timestamp(),
      payload
    };
    await this.store.addNotification(notification);
    notification.deliveries = await this.notifications.publish(notification);
    return notification;
  }

  event(task, type, message, details = {}) {
    task.events.push({ eventId: randomUUID(), type, message, details, createdAt: this.timestamp() });
    task.updatedAt = this.timestamp();
  }

  async createTask({ taskId = randomUUID(), intent, policyEnvelope }) {
    if (!intent) throw new OpenBellError('INTENT_REQUIRED', 'Task intent is required');
    const authorization = authorizeIntent(policyEnvelope, intent, { now: this.clock(), trustedPublicKeys: this.trustedPolicyKeys, requireTrustedPolicyKey: this.requireTrustedPolicyKey });
    const now = this.timestamp();
    const task = {
      taskVersion: 'openbell.task.v1',
      taskId,
      state: authorization.authorized ? TASK_STATES.PENDING : TASK_STATES.BLOCKED,
      intent: structuredClone(intent),
      policyEnvelope: structuredClone(policyEnvelope),
      policyHash: authorization.policyHash,
      authorization: { authorized: authorization.authorized, reasons: authorization.reasons },
      receipt: null,
      transactionReceipt: null,
      events: [],
      createdAt: now,
      updatedAt: now
    };
    this.event(task, authorization.authorized ? 'TASK_CREATED' : 'TASK_BLOCKED', authorization.authorized
      ? 'Signed policy authorized the task intent.'
      : 'Task failed closed because policy authorization was rejected.', { reasons: authorization.reasons });
    await this.store.putTask(task);
    await this.emit(task, authorization.authorized ? 'task.created' : 'task.blocked', authorization.authorized ? 'info' : 'critical', { reasons: authorization.reasons });
    return task;
  }

  async requireTask(taskId) {
    const task = await this.store.getTask(taskId);
    if (!task) throw new OpenBellError('TASK_NOT_FOUND', `Task ${taskId} was not found`);
    return task;
  }

  async evaluateTask(taskId, observation) {
    const task = await this.requireTask(taskId);
    if ([TASK_STATES.CANCELLED, TASK_STATES.SETTLED].includes(task.state)) {
      throw new OpenBellError('TASK_TERMINAL', `Task ${taskId} is already ${task.state}`);
    }
    const authorization = authorizeIntent(task.policyEnvelope, task.intent, { now: this.clock(), trustedPublicKeys: this.trustedPolicyKeys, requireTrustedPolicyKey: this.requireTrustedPolicyKey });
    const policy = task.policyEnvelope?.payload ?? {};
    let receipt = evaluateExecution({
      ...task.intent,
      ...observation,
      taskId,
      maxPremiumBps: policy.maxPremiumBps,
      minLiquidityUsd: policy.minLiquidityUsd,
      maxQuoteAgeSeconds: policy.maxQuoteAgeSeconds,
      maxOrderNotionalUsd: policy.maxOrderNotionalUsd,
      observedAt: observation?.observedAt ?? this.timestamp()
    });
    if (!authorization.authorized) {
      const body = { ...receipt, decision: DECISIONS.BLOCKED, reasons: unique([...receipt.reasons, ...authorization.reasons]) };
      delete body.evidenceHash;
      receipt = { ...body, evidenceHash: hashEvidence(body) };
    }
    task.authorization = { authorized: authorization.authorized, reasons: authorization.reasons };
    task.state = receipt.decision;
    task.receipt = receipt;
    this.event(task, `TASK_${receipt.decision}`, `Execution verifier returned ${receipt.decision}.`, { reasons: receipt.reasons, evidenceHash: receipt.evidenceHash });
    await this.store.putTask(task);
    await this.emit(task, `task.${receipt.decision.toLowerCase()}`, receipt.decision === DECISIONS.VERIFIED ? 'info' : receipt.decision === DECISIONS.BLOCKED ? 'warning' : 'critical', { reasons: receipt.reasons, evidenceHash: receipt.evidenceHash });
    return task;
  }

  async recoverTask(taskId, observation) {
    const task = await this.requireTask(taskId);
    if (![TASK_STATES.BLOCKED, TASK_STATES.FROZEN].includes(task.state)) {
      throw new OpenBellError('RECOVERY_NOT_ALLOWED', `Task ${taskId} is not BLOCKED or FROZEN`);
    }
    if (!task.policyEnvelope?.payload?.permissions?.recover) {
      throw new OpenBellError('RECOVERY_PERMISSION_MISSING', 'Signed policy does not allow recovery');
    }
    this.event(task, 'RECOVERY_REQUESTED', 'Task was submitted for re-verification.');
    await this.store.putTask(task);
    return this.evaluateTask(taskId, observation);
  }

  async settleTask(taskId, transactionProof) {
    const task = await this.requireTask(taskId);
    if (task.state !== TASK_STATES.VERIFIED || !task.receipt) {
      throw new OpenBellError('SETTLEMENT_NOT_RELEASED', 'Only a VERIFIED task can settle');
    }
    const verification = verifyPolicyEnvelope(task.policyEnvelope, { now: this.clock(), trustedPublicKeys: this.trustedPolicyKeys, requireTrustedPolicyKey: this.requireTrustedPolicyKey });
    if (!verification.valid || !task.policyEnvelope.payload.permissions?.settle) {
      throw new OpenBellError('SETTLEMENT_PERMISSION_MISSING', 'A valid signed settlement permission is required', { reasons: verification.reasons });
    }
    task.transactionReceipt = await attachTransactionProof(task.receipt, transactionProof);
    task.state = TASK_STATES.SETTLED;
    this.event(task, 'TASK_SETTLED', 'Verified transaction proof was attached to the task.', { signature: transactionProof.signature, evidenceHash: task.transactionReceipt.evidenceHash });
    await this.store.putTask(task);
    await this.emit(task, 'task.settled', 'info', { signature: transactionProof.signature, evidenceHash: task.transactionReceipt.evidenceHash });
    return task;
  }

  async cancelTask(taskId, reason = 'cancelled_by_owner') {
    const task = await this.requireTask(taskId);
    if (task.state === TASK_STATES.SETTLED) throw new OpenBellError('TASK_TERMINAL', 'Settled tasks cannot be cancelled');
    task.state = TASK_STATES.CANCELLED;
    this.event(task, 'TASK_CANCELLED', 'Task was cancelled before settlement.', { reason });
    await this.store.putTask(task);
    await this.emit(task, 'task.cancelled', 'warning', { reason });
    return task;
  }

  async getTask(taskId) { return this.requireTask(taskId); }
  async listTasks() { return this.store.listTasks(); }
  async listNotifications(options) { return this.store.listNotifications(options); }
}

export function createOpenBell(options) { return new OpenBellSDK(options); }
