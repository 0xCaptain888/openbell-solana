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
