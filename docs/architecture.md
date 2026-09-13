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

## Integration and operations layer

```mermaid
flowchart TB
  APP[Wallet / Agent / Trading App] --> SDK[OpenBell SDK]
  API[Authenticated Vercel Task API] --> SDK
  SDK --> AUTH[Ed25519 Policy Authorization]
  AUTH --> ENGINE[Fair Execution Engine]
  ENGINE --> STORE[Local JSON or Redis REST Store]
  ENGINE --> OUTBOX[Persistent Notification Outbox]
  OUTBOX --> WEBHOOK[HMAC-signed Webhook]
  ENGINE --> PROOF[Independent Transaction Proof]
  PROOF --> SETTLED[SETTLED]
  UI[Judge Replay UI] --> LOCAL[Browser-local Replay State]
  UI --> STATUS[Public Configuration Probe]
  STATUS --> API
```

The repository includes in-memory, atomic JSON file, and Upstash-compatible Redis REST adapters. The browser replay is explicitly device-local and contains no signing keys. Anonymous visitors can read only the serverless API's secret-free configuration status; every task operation requires durable remote storage, operator bearer authorization, and a policy signed by the configured trust root. Missing infrastructure produces an explicit `503` instead of an in-memory or ephemeral-filesystem fallback.
