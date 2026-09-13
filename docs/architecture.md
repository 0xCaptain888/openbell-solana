# OpenBell architecture

```mermaid
flowchart LR
  W[Solflare / Wallet] --> I[Intent Builder]
  I --> Q[Quote & Reference Adapter]
  Q --> V[Fair Execution Verifier]
  V --> D{Decision}
  D -->|VERIFIED| S[Jupiter / Solana Settlement]
  D -->|BLOCKED| B[Explain + Re-price / Queue]
  D -->|FROZEN| F[Hold intent during corporate action]
  S --> R[Fair Execution Receipt]
  B --> R
  F --> R
  R --> E[Independent Evidence Verification]
```

The protocol separates **market observability** from **execution authority**. An agent can propose an action, but only the verifier can release it. `VERIFIED` means the quote is fresh, within the user's premium/slippage policy, liquid enough, correctly identified, and correctly handles raw/scaled amounts. `BLOCKED` is a recoverable policy refusal. `FROZEN` is a temporary asset-state halt for corporate-action transitions.
