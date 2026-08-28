---
title: "Trexure"
tagline: "Unified treasury API for Stellar"
summary: "Privacy without blindness: competitors see only a proof hash on-chain, while finance and compliance still get an audit-ready, fully reconciled receipt."
category: "Systems & backend"
sequence: 10
cover: ../../assets/projects/trexure.jpg
coverAlt: "The payment lifecycle view \u2014 a shielded payload decrypted in the internal enclave, on-chain and fiat legs matched one to one, and the settled receipt generated."
stack:
  - "Next.js 16"
  - "React 19"
  - "TypeScript"
  - "Node.js 22"
  - "Prisma 7"
  - "PostgreSQL 17"
  - "Redis"
  - "BullMQ"
  - "Stellar SDK"
  - "Soroban (Rust)"
  - "snarkjs / Groth16"
  - "Zod"
  - "Argon2id"
  - "PDFKit"
  - "S3"
  - "Vitest"
  - "Playwright"
  - "Docker"
  - "Railway"
liveUrl: "https://trexure.xyz/"
badge: "Hackathon Winner"
---

## What it is

Trexure makes business payments on Stellar private on the public ledger while staying fully
auditable inside the company. A payroll batch or vendor payout is shielded on-chain as a
zero-knowledge commitment — no sender, recipient, or amount — and only the paying company can
decrypt it with its own view key. The on-chain leg is then auto-reconciled against the fiat payout
into a Stripe-style receipt.

## Value

- **Privacy without blindness** — competitors see only a proof hash; finance and compliance still
  see everything.
- **Audit-ready** — proves "on-chain hash X produced bank deposit Y" for AML/KYC and bookkeeping.
- **Blockchain abstracted away** — accountants get FX, fees and slippage in a familiar receipt
  (JSON + PDF).

## Technology highlights

- **Real Groth16 ZK proofs** verified on-chain by a Rust/Soroban contract (BLS12-381 pairing check).
- **Two-leg auto-reconciliation engine** — BullMQ workers match the on-chain and fiat legs 1:1 by
  `intentId`.
