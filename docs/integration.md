# OpenBell SDK and API integration

OpenBell v0.4 turns the verifier into an embeddable execution-control layer with a typed package surface and a hosted HTTP client. The SDK remains fail-closed: a task cannot reach `SETTLED` unless a valid Ed25519 policy authorizes settlement, the quote reaches `VERIFIED`, and a successful transaction proof is attached.

## Installation status

OpenBell is not currently published to npm. Install the GitHub source or pin a reviewed commit:

```bash
npm install github:0xCaptain888/openbell-solana#main
```

The package exports `openbell-solana`, `openbell-solana/policy`, and `openbell-solana/api-client`, with TypeScript declarations for the SDK and HTTP client.

## SDK quick start

```js
import { generateKeyPairSync } from 'node:crypto';
import { createOpenBell } from 'openbell-solana';
import { createPolicy, signPolicy } from 'openbell-solana/policy';

const { privateKey } = generateKeyPairSync('ed25519');
const policyEnvelope = signPolicy(createPolicy({
  subject: walletAddress,
  allowedAssets: ['AAPLx'],
  allowedMints: [aaplxMint],
  maxOrderNotionalUsd: 100,
  maxPremiumBps: 50,
  minLiquidityUsd: 10_000,
  maxQuoteAgeSeconds: 15,
  permissions: { evaluate: true, settle: true, recover: true },
  expiresAt: '2026-09-14T12:00:00.000Z',
  nonce: 'user-policy-1'
}), privateKey);

const openbell = createOpenBell({
  trustedPolicyKeys: [policyEnvelope.publicKey]
});
await openbell.createTask({
  taskId: 'order-123',
  intent: {
    wallet: walletAddress,
    asset: 'AAPLx',
    mint: aaplxMint,
    issuer: 'Backed / xStocks',
    orderNotionalUsd: 20
  },
  policyEnvelope
});

const task = await openbell.evaluateTask('order-123', {
  underlyingOpen: false,
  referencePrice: 210,
  executablePrice: 210.5,
  quoteAgeSeconds: 2,
  liquidityUsd: 50_000
});

if (task.state === 'VERIFIED') {
  // Ask the wallet owner to sign outside OpenBell, broadcast, then read the
  // transaction through an independent RPC before calling settleTask().
}
```

Run the complete SDK example:

```bash
npm run sdk:demo
npm run partner:demo
```

## Hosted API client

Use the API client only from a trusted backend because the general task API requires an operator token:

```js
import { createOpenBellApiClient } from 'openbell-solana/api-client';

const client = createOpenBellApiClient({
  baseUrl: 'https://openbell-solana-live.vercel.app/api/openbell',
  token: process.env.OPENBELL_API_BEARER_TOKEN
});

const created = await client.createTask({ intent, policyEnvelope }, {
  idempotencyKey: `partner-order:${orderId}`
});
const evaluated = await client.evaluateTask(created.taskId, observation);
```

Never place `OPENBELL_API_BEARER_TOKEN` in browser JavaScript. Browser demos may call only the fixed-scope `/api/judge-run` route, which accepts no trade parameters and has no settlement permission.

## Persistent task service

The local REST service uses `JsonFileTaskStore`, serializes writes, and replaces the database file atomically. Its default database is `.openbell/tasks.json`, which is ignored by Git.

```bash
OPENBELL_POLICY_MODE=development npm run api
```

Development mode accepts any cryptographically valid test signer. The API defaults to strict mode. In strict mode, configure the trusted signer public keys as a JSON array through `OPENBELL_TRUSTED_POLICY_KEYS_JSON`; an otherwise valid policy signed by an unknown key fails closed with `untrusted_policy_signer`.

Available routes:

```text
GET  /health
GET  /v1/tasks
POST /v1/tasks
GET  /v1/tasks/:taskId
POST /v1/tasks/:taskId/evaluate
POST /v1/tasks/:taskId/recover
POST /v1/tasks/:taskId/cancel
POST /v1/tasks/:taskId/settle
GET  /v1/notifications
```

`JsonFileTaskStore` is durable for one local process or a persistent server volume. Vercel function filesystems are ephemeral, so a production deployment should implement the same store interface with Postgres, SQLite on a persistent volume, or another transactional database. The public Vercel Demo does not pretend to provide durable server-side storage.

## Serverless remote persistence

`RedisRestTaskStore` implements the same store interface using an Upstash-compatible Redis REST API. It stores tasks by ID, atomically updates the task index through `/multi-exec`, and keeps the latest 1,000 notification outbox records. Configure the Vercel deployment with either the OpenBell-specific names or common Redis/KV REST aliases:

```text
OPENBELL_REDIS_REST_URL=<server-side REST endpoint>
OPENBELL_REDIS_REST_TOKEN=<server-side REST token>
OPENBELL_REDIS_NAMESPACE=openbell:v1
OPENBELL_API_BEARER_TOKEN=<long random operator token>
OPENBELL_TRUSTED_POLICY_KEYS_JSON=["<PEM public key>"]
OPENBELL_POLICY_MODE=strict
```

The public configuration probe contains no secret and performs no write:

```text
GET /api/openbell?action=status
```

Task operations use the same endpoint and require `Authorization: Bearer <OPENBELL_API_BEARER_TOKEN>`:

```text
GET  /api/openbell?action=tasks
GET  /api/openbell?action=task&taskId=<id>
GET  /api/openbell?action=notifications&limit=100
POST /api/openbell?action=create
POST /api/openbell?action=evaluate&taskId=<id>
POST /api/openbell?action=recover&taskId=<id>
POST /api/openbell?action=cancel&taskId=<id>
POST /api/openbell?action=settle&taskId=<id>
```

`GET action=tasks` accepts `limit` (1-100) and an opaque `cursor`, returning `nextCursor`. `POST action=create` accepts an optional `x-idempotency-key` (8-96 safe characters); a repeated key returns the existing task instead of creating a duplicate.

The machine-readable contract is [`openapi.yaml`](openapi.yaml).

## Restricted Live Judge Run

The deployed Demo uses a distinct credential-free proof route:

```text
POST /api/judge-run
x-idempotency-key: judge-browser-<uuid>
content-type: application/json

{"consent":true}
```

Its scope is immutable: AAPLx only, $10 maximum, evaluate permission only, five-minute policy expiry, no recovery or settlement permission, no transaction construction, and no wallet signing. It binds a live read-only Jupiter route observation into a strict signed-policy evaluation, then returns the Redis read-back and task-specific notification records. The response explicitly separates route price-impact normalization from an equity fair-value claim.

If remote storage is absent, task operations return `503 PERSISTENCE_NOT_CONFIGURED`. If the operator bearer token is absent, they return `503 WRITE_AUTH_NOT_CONFIGURED`. A wrong token returns `401 UNAUTHORIZED`. No endpoint silently falls back to process memory or the Vercel filesystem.

## Notifications and operations

Every state transition is stored in the task audit history and an outbox-style notification record. Optional Webhook delivery is configured only through server environment variables:

```bash
OPENBELL_WEBHOOK_URL="https://operator.example/webhooks/openbell" \
OPENBELL_WEBHOOK_SECRET="replace-with-a-secret" \
npm run api
```

When a secret is configured, OpenBell adds `x-openbell-signature`, an HMAC-SHA256 signature of the exact JSON request body. Delivery failures are recorded by the SDK result and never convert a `BLOCKED` or `FROZEN` task into a successful settlement.

Suggested operational topics:

- `task.created`
- `task.verified`
- `task.blocked`
- `task.frozen`
- `task.settled`
- `task.cancelled`

## Permission model

The signed policy binds:

- the wallet subject;
- allowed asset symbols and Mint addresses;
- maximum order notional;
- maximum premium;
- minimum liquidity;
- maximum quote age;
- separate `evaluate`, `settle`, and `recover` permissions;
- expiration and nonce.

Changing any signed field invalidates both the policy hash and Ed25519 signature. The SDK also requires the signing public key to belong to its configured trust root by default; embedding an arbitrary public key inside an envelope is not sufficient authorization. Settlement additionally requires a successful transaction proof, and the SDK never signs or broadcasts a transaction itself.
