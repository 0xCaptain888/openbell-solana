# Partner trading-agent example

This example shows the intended integration boundary: another agent submits a limited AAPLx intent, OpenBell evaluates it under an Ed25519 policy, and the partner receives a portable decision receipt. The example deliberately grants no settlement permission and does not build, sign, or broadcast a transaction.

Run from the repository root:

```bash
npm run partner:demo
```

For a hosted backend integration, use `OpenBellApiClient` from `openbell-solana/api-client` and keep the operator token on the partner server. Browser clients may call only the restricted `/api/judge-run` proof, which has fixed scope and no settlement capability.
