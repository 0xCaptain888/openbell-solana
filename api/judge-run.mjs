import { createHash, generateKeyPairSync } from 'node:crypto';
import { fetchJupiterQuote } from '../src/jupiter-quote.mjs';
import { createPolicy, signPolicy } from '../src/policy.mjs';
import { createRedisRestTaskStoreFromEnv } from '../src/redis-rest-task-store.mjs';
import { NotificationCenter } from '../src/notifications.mjs';
import { OpenBellError, createOpenBell } from '../src/sdk.mjs';

export const config = { runtime: 'nodejs' };

export const JUDGE_ASSET = Object.freeze({
  symbol: 'AAPLx',
  issuer: 'Backed / xStocks',
  mint: 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp',
  inputMint: 'So11111111111111111111111111111111111111112',
  inputAmountBaseUnits: 10_000_000,
  orderNotionalUsd: 10
});

const signer = generateKeyPairSync('ed25519');

function send(res, status, body) {
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('access-control-allow-origin', process.env.ALLOWED_ORIGIN ?? '*');
  res.setHeader('access-control-allow-headers', 'content-type, x-idempotency-key');
  res.setHeader('access-control-allow-methods', 'POST, OPTIONS');
  return res.status(status).json(body);
}

function safeIdempotencyKey(req) {
  const value = String(req.headers?.['x-idempotency-key'] ?? req.body?.idempotencyKey ?? '');
  if (!/^[A-Za-z0-9._:-]{8,96}$/.test(value)) {
    throw new OpenBellError('IDEMPOTENCY_KEY_REQUIRED', 'Use an 8-96 character x-idempotency-key');
  }
  return value;
}

function fingerprint(req) {
  const forwarded = String(req.headers?.['x-forwarded-for'] ?? '').split(',')[0].trim();
  const agent = String(req.headers?.['user-agent'] ?? 'unknown');
  return createHash('sha256').update(`${forwarded}|${agent}`).digest('hex').slice(0, 24);
}

function sanitizeQuote(quote) {
  return {
    provider: 'jupiter',
    status: quote.status,
    inputMint: quote.inputMint,
    outputMint: quote.outputMint,
    inputAmountBaseUnits: String(quote.amount),
    outputAmountBaseUnits: quote.outAmount ?? null,
    priceImpactPct: quote.priceImpactPct ?? null,
    contextSlot: quote.contextSlot ?? null,
    routeCount: Array.isArray(quote.routePlan) ? quote.routePlan.length : 0,
    observedAt: new Date().toISOString(),
    readOnly: true
  };
}

function observationFromQuote(quote, observedAt) {
  const quoted = quote.status === 'QUOTED' && Array.isArray(quote.routePlan) && quote.routePlan.length > 0;
  const impactPct = Number(quote.priceImpactPct ?? 0);
  const safeImpactPct = Number.isFinite(impactPct) ? Math.abs(impactPct) : 100;
  return {
    underlyingOpen: false,
    referencePrice: 100,
    executablePrice: 100 * (1 + safeImpactPct / 100),
    quoteAgeSeconds: 0,
    liquidityUsd: 0,
    eligible: true,
    routeAvailable: quoted,
    route: quoted
      ? `Jupiter read-only route · ${quote.routePlan.length} hop(s) · slot ${quote.contextSlot ?? 'unknown'}`
      : `Jupiter read-only route · ${quote.status}`,
    observedAt
  };
}

function publicTask(task) {
  return {
    taskId: task.taskId,
    state: task.state,
    policyHash: task.policyHash,
    authorization: task.authorization,
    receipt: task.receipt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    eventCount: task.events?.length ?? 0
  };
}

async function defaultLimiter({ store, req }) {
  const key = `${store.namespace}:judge-rate:${fingerprint(req)}`;
  const reserved = await store.command(['SET', key, '1', 'EX', '20', 'NX']);
  if (reserved !== 'OK') throw new OpenBellError('RATE_LIMITED', 'Wait 20 seconds before starting another new Judge Run');
}

export function createJudgeRunHandler({
  store = createRedisRestTaskStoreFromEnv(),
  quoteFetcher = fetchJupiterQuote,
  limiter = defaultLimiter,
  keyPair = signer,
  clock = () => new Date()
} = {}) {
  const policyPublicKey = keyPair.publicKey.export({ type: 'spki', format: 'pem' });
  const sdk = store ? createOpenBell({
    store,
    notifications: new NotificationCenter(),
    trustedPolicyKeys: [policyPublicKey],
    requireTrustedPolicyKey: true,
    clock
  }) : null;

  return async function handler(req, res) {
    if (req.method === 'OPTIONS') return send(res, 204, {});
    try {
      if (req.method !== 'POST') return send(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Judge Run accepts POST only' });
      if (!store || !sdk) throw new OpenBellError('PERSISTENCE_NOT_CONFIGURED', 'Remote persistence is required for Live Judge Run');
      if (req.body?.consent !== true) throw new OpenBellError('CONSENT_REQUIRED', 'Confirm the read-only Judge Run before creating a task');

      const idempotencyKey = safeIdempotencyKey(req);
      const taskId = `judge-live-${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 24)}`;
      const existing = await store.getTask(taskId);
      if (existing?.receipt) {
        const notifications = (await store.listNotifications({ limit: 100 })).filter((item) => item.taskId === taskId);
        return send(res, 200, {
          runVersion: 'openbell.live-judge.v1',
          idempotentReplay: true,
          safety: { readOnlyMarketData: true, settlementAllowed: false, transactionBuilt: false, fundsMoved: false },
          task: publicTask(existing),
          persistence: { created: true, readBack: existing.state, notificationCount: notifications.length },
          notifications
        });
      }

      await limiter({ store, req, taskId });
      const startedAt = clock();
      const quote = await quoteFetcher({
        inputMint: JUDGE_ASSET.inputMint,
        outputMint: JUDGE_ASSET.mint,
        amount: JUDGE_ASSET.inputAmountBaseUnits,
        slippageBps: 100,
        endpoint: process.env.JUPITER_QUOTE_URL,
        apiKey: process.env.JUPITER_API_KEY
      });
      const observedAt = clock().toISOString();
      const policy = createPolicy({
        subject: `judge-session:${taskId}`,
        allowedAssets: [JUDGE_ASSET.symbol],
        allowedMints: [JUDGE_ASSET.mint],
        maxOrderNotionalUsd: JUDGE_ASSET.orderNotionalUsd,
        maxPremiumBps: 100,
        minLiquidityUsd: 0,
        maxQuoteAgeSeconds: 15,
        permissions: { evaluate: true, settle: false, recover: false },
        expiresAt: new Date(startedAt.getTime() + 5 * 60_000).toISOString(),
        nonce: taskId
      });
      const policyEnvelope = signPolicy(policy, keyPair.privateKey);
      const intent = {
        wallet: policy.subject,
        asset: JUDGE_ASSET.symbol,
        mint: JUDGE_ASSET.mint,
        issuer: JUDGE_ASSET.issuer,
        orderNotionalUsd: JUDGE_ASSET.orderNotionalUsd
      };
      const created = await sdk.createTask({ taskId, intent, policyEnvelope });
      const evaluated = await sdk.evaluateTask(taskId, observationFromQuote(quote, observedAt));
      const persisted = await sdk.getTask(taskId);
      const notifications = (await sdk.listNotifications({ limit: 100 })).filter((item) => item.taskId === taskId);

      return send(res, 200, {
        runVersion: 'openbell.live-judge.v1',
        idempotentReplay: false,
        phases: ['jupiter-route-observed', 'signed-policy-created', 'task-persisted', 'strict-evaluation', 'redis-read-back', 'notifications-read-back'],
        safety: { readOnlyMarketData: true, settlementAllowed: false, transactionBuilt: false, fundsMoved: false },
        interpretation: {
          decisionScope: 'Route availability and Jupiter-reported price impact under a normalized 100-point reference.',
          notClaimed: 'This is not an equity fair-value oracle, wallet signature, swap, or tokenized-stock trade.'
        },
        quote: sanitizeQuote(quote),
        task: publicTask(evaluated),
        persistence: {
          created: created.state === 'PENDING' || created.state === 'BLOCKED',
          readBack: persisted.state,
          receiptHashMatch: persisted.receipt?.evidenceHash === evaluated.receipt?.evidenceHash,
          notificationCount: notifications.length
        },
        notifications,
        durationMs: Math.max(0, clock().getTime() - startedAt.getTime())
      });
    } catch (error) {
      const status = error.code === 'RATE_LIMITED' ? 429
        : error.code === 'PERSISTENCE_NOT_CONFIGURED' ? 503
          : error instanceof OpenBellError ? 422 : 500;
      return send(res, status, { error: error.code ?? 'INTERNAL_ERROR', message: error.message, details: error.details ?? {} });
    }
  };
}

export default createJudgeRunHandler();
