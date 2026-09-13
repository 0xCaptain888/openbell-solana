# OpenBell

**Fair execution for 24/7 tokenized stock markets on Solana.**

OpenBell protects users and trading agents from stale prices, thin liquidity, off-hours premiums, and Token-2022 raw/scaled amount mistakes. Solana makes tokenized equities composable and continuously tradeable; OpenBell answers the missing question before every order: **is this quote fair enough to execute now?**

## The 3-minute judge path

1. Open the static Demo in `site/index.html` (or the deployed Pages URL).
2. Connect is intentionally a mock wallet action for the public demo; no private key is stored.
3. Click **Run Judge Demo** to execute `VERIFIED → BLOCKED → FROZEN`.
4. Change **Max premium** and **Min liquidity** to see the decision change.
5. Expand the receipt and click **Verify evidence**.
6. Inspect the raw/scaled amount guard in the fourth scenario.

## Local verification

```bash
npm test
npm run demo
```

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

The core engine has no runtime dependencies and is deterministic. `src/openbell.mjs` is designed so a live Solana adapter can replace the fixture quote/reference adapters without changing the verifier contract.

## What is real vs. demo-scoped

- The decision engine, receipts, evidence hashes, market-state transitions, raw/scaled amount checks, and test matrix are implemented.
- The public demo uses deterministic fixtures so judges can reproduce every state without wallet credentials.
- A production adapter must provide live issuer/mint metadata, oracle/reference prices, DEX/RFQ quotes, and Solana transaction signatures.
- Tokenized-stock availability and eligibility vary by jurisdiction and issuer. This prototype does not bypass KYC, transfer controls, or regional restrictions.

## Why this is not another stock dashboard

24/7 secondary trading does not guarantee 24/7 fair price discovery. During nights and weekends, a tokenized-stock quote can be executable but economically unreasonable. OpenBell turns that hidden risk into a visible, independently verifiable execution decision.

## Repository map

- `src/openbell.mjs` — verifier, decision states, deterministic evidence receipt
- `src/demo.mjs` — CLI judge fixtures
- `site/` — evaluator-facing browser demo
- `test/` — verified, blocked, frozen, and raw/scaled regression tests
- `docs/architecture.md` — one-page architecture
