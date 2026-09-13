# OpenBell

**Fair execution for 24/7 tokenized stock markets on Solana.**

> **Live Demo:** [openbell-solana-live.vercel.app](https://openbell-solana-live.vercel.app/) · **Repository:** [github.com/0xCaptain888/openbell-solana](https://github.com/0xCaptain888/openbell-solana)

OpenBell protects users and trading agents from stale prices, thin liquidity, off-hours premiums, and Token-2022 raw/scaled amount mistakes. Solana makes tokenized equities composable and continuously tradeable; OpenBell answers the missing question before every order: **is this quote fair enough to execute now?**

## The 3-minute judge path

1. Open the static Demo in `site/index.html` (or the deployed Pages URL).
2. Connect is intentionally a mock wallet action for the public demo; no private key is stored.
3. Click **Run Judge Demo** to execute `VERIFIED → BLOCKED → FROZEN`.
4. Change **Max premium** and **Min liquidity** to see the decision change.
5. Expand the receipt and click **Verify evidence**.
6. Inspect the raw/scaled amount guard in the fourth scenario.
7. Click **Verify Devnet proof** to independently check the committed Solana transaction evidence.
8. Select `FROZEN` in Judge Mode and use the recovery controls to re-verify or cancel without signing.
9. Switch between **Strict**, **Balanced**, and **Flexible** policy presets to show that the same quote can produce a different decision under a user-owned policy.
10. Refresh the page and confirm the browser-local policy, latest task, receipt, wallet replay state, and audit trail are restored.
11. Open **Integration Status** and click **Check deployment**. The public API reports its real configuration state; without a remote store it says `PERSISTENCE_NOT_CONFIGURED` instead of pretending that Vercel's ephemeral filesystem is durable.
12. Download the latest portable receipt as JSON.

## Local verification

```bash
npm test
npm run demo
npm run sdk:demo
```

## Integrate OpenBell

OpenBell v0.3 exposes an embeddable SDK, Ed25519-signed policy envelopes, pluggable task stores, persistent audit history, an optional HMAC-signed Webhook notifier, a local REST API, and a fail-closed Vercel task API:

```bash
OPENBELL_POLICY_MODE=development npm run api
```

Development mode is limited to local evaluation. The API defaults to strict mode, where policies must be signed by a configured trusted public key. The default local durable store is `.openbell/tasks.json`; it is appropriate for local evaluation and persistent single-server deployments. The browser replay now uses clearly labeled device-local persistence. The Vercel task function supports a Redis REST store, but remains fail-closed until remote persistence, write authorization, and trusted policy keys are configured. See [`docs/integration.md`](docs/integration.md) for the SDK example, API routes, permission model, production database boundary, and notification configuration.

To verify the funded Devnet wallet without exposing credentials in the repository:

```bash
OPENBELL_SOLANA_RPC_URL="<your Alchemy Devnet endpoint>" \
OPENBELL_WALLET_ADDRESS="2oWxc6Tw4tYukaYoFVPzEB3D7LK95ccFQmNwALuoPgSm" \
npm run devnet:check
```

The endpoint is read only from the process environment. Never commit it to `.env`, source code, screenshots, or the public repository.

Once a wallet has explicitly signed and broadcast a test transaction, independently verify it with:

```bash
OPENBELL_SOLANA_RPC_URL="<your Alchemy Devnet endpoint>" \
OPENBELL_TX_SIGNATURE="<signature>" \
npm run devnet:verify-tx
```

This command only calls Solana `getTransaction`; it never signs, broadcasts, or moves funds.

`attachTransactionProof()` can bind that read-only result into a receipt and recompute its evidence hash. This is the final verification step after a user has explicitly broadcast a transaction; OpenBell itself does not broadcast from this command.

### Recorded Devnet plumbing proof

The repository includes one explicitly authorized Devnet self-transfer proof at
`evidence/devnet-self-transfer-proof.json`. It is intentionally a 0.001 SOL
self-transfer: it proves wallet signing, RPC broadcast, confirmation, and
independent `getTransaction` verification, but it is **not** presented as a
tokenized-stock trade. The guarded runner is:

```bash
OPENBELL_ALLOW_BROADCAST=1 \
OPENBELL_SOLANA_RPC_URL="<your Devnet endpoint>" \
npm run devnet:broadcast-proof
```

To re-check an existing signature without broadcasting again:

```bash
OPENBELL_TX_SIGNATURE="<signature>" \
OPENBELL_SOLANA_RPC_URL="<your Devnet endpoint>" \
npm run devnet:broadcast-proof
```

The runner refuses transfers above 0.001 SOL, defaults to a self-transfer, and
uses HTTP status polling so it also works with RPC providers that do not expose
WebSocket `signatureSubscribe`.

### Mainnet tokenized-stock observation

OpenBell also includes a read-only Mainnet verifier for the public AAPLx Mint
(Apple xStock). It checks the account owner, Token-2022 Mint shape, decimals,
embedded token metadata, and the scaled-UI multiplier without signing or
submitting a transaction:

```bash
OPENBELL_MAINNET_RPC_URL="<your Mainnet endpoint>" \
OPENBELL_STOCK_MINT="XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp" \
npm run mainnet:verify-mint
```

The observed public metadata is recorded in
`evidence/mainnet-aaplx-mint.json`. This is a Mainnet observation only; it is
not a claim that the Devnet plumbing proof traded a real equity token.

`npm run mainnet:quote` uses Jupiter's current quote adapter and returns
`QUOTED`, `NO_ROUTE`, or `UNAVAILABLE` rather than manufacturing a price when
the provider or route is unavailable. A Jupiter API key, when required by the
provider, is read only from `JUPITER_API_KEY` and is never written to the repo.
For local repeatability, place it in the ignored `.env.local` file; the npm
script loads that file automatically. Use `.env.local.example` as the template.

The repository includes one read-only `QUOTED` observation in
`evidence/mainnet-aaplx-jupiter-quote.json`: SOL → AAPLx, one route, zero
reported price impact at the recorded context slot. It is evidence of quote
discovery only; no swap was signed or broadcast.

### Optional live quote proxy

Static GitHub Pages must not receive a Jupiter secret. For a live browser
integration, deploy `api/jupiter-quote.mjs` to a serverless host and configure
`JUPITER_API_KEY` there. The proxy accepts only read-only `GET` requests,
strips the provider's raw payload, sets `Cache-Control: no-store`, and maps
provider/network failures to explicit `NO_ROUTE` or `UNAVAILABLE` states:

```text
GET /api/jupiter-quote?inputMint=<mint>&outputMint=<mint>&amount=<base-units>
```

The committed Pages Demo intentionally continues to use proof files so judges
can run it without a hosted secret. `vercel.json` contains the minimal
function configuration for a Vercel deployment.

The core engine has no runtime dependencies and is deterministic. `src/openbell.mjs` is designed so a live Solana adapter can replace the fixture quote/reference adapters without changing the verifier contract.

### Optional persistent Vercel task API

`GET /api/openbell?action=status` is public and returns configuration metadata only. All task and notification reads/writes require a server-side bearer token. The endpoint refuses task operations until a remote Redis REST store is configured, and strict mode rejects policies that are not signed by a configured trusted key.

Supported actions are `tasks`, `task`, `notifications`, `create`, `evaluate`, `recover`, `cancel`, and `settle`. Secrets are server-side environment variables only; the public browser never receives the database token, API bearer token, trusted signer configuration, or notification secret. Exact setup and request examples are in [`docs/integration.md`](docs/integration.md).

## What is real vs. demo-scoped

- The decision engine, receipts, evidence hashes, market-state transitions, raw/scaled amount checks, and test matrix are implemented.
- The public demo uses deterministic fixtures so judges can reproduce every state without wallet credentials.
- The browser also exposes a read-only Devnet proof verifier; it checks the committed signature, success flag, and explorer link without broadcasting anything.
- The evaluator console records a local activity trail and exports the current receipt; neither feature uploads user data or stores signing credentials.
- Browser-local persistence is explicitly labeled and survives refresh on the same device. It is not claimed as shared cloud persistence.
- The deployed task API exposes a public configuration check while task operations remain fail-closed behind remote storage, bearer authorization, and trusted policy signer configuration.
- A production adapter must provide live issuer/mint metadata, oracle/reference prices, DEX/RFQ quotes, and Solana transaction signatures.
- Tokenized-stock availability and eligibility vary by jurisdiction and issuer. This prototype does not bypass KYC, transfer controls, or regional restrictions.

## Why this is not another stock dashboard

24/7 secondary trading does not guarantee 24/7 fair price discovery. During nights and weekends, a tokenized-stock quote can be executable but economically unreasonable. OpenBell turns that hidden risk into a visible, independently verifiable execution decision.

## Repository map

- `src/openbell.mjs` — verifier, decision states, deterministic evidence receipt
- `src/sdk.mjs` — embeddable task lifecycle SDK and fail-closed settlement gate
- `src/policy.mjs` — Ed25519 policy signing, verification, and scoped permissions
- `src/task-store.mjs` — memory and atomic JSON persistence adapters
- `src/redis-rest-task-store.mjs` — remote Redis REST persistence adapter for serverless deployments
- `src/notifications.mjs` — notification center and HMAC-signed Webhook adapter
- `src/demo.mjs` — CLI judge fixtures
- `scripts/api-server.mjs` — local persistent REST service
- `api/openbell.mjs` — fail-closed Vercel task API and public deployment-status endpoint
- `site/` — evaluator-facing browser demo
- `test/` — verified, blocked, frozen, and raw/scaled regression tests
- `docs/architecture.md` — one-page architecture
- `docs/integration.md` — SDK/API integration and operations guide
