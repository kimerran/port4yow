---
title: "Centient"
tagline: "Train AI, cent by cent"
summary: "Pays contributors in emerging markets real USDC from a phone for AI preference data, with quality engineered in and every payout verifiable on-ledger."
category: "Product & client work"
sequence: 12
cover: ../../assets/projects/centient.jpg
coverAlt: "The Centient core loop on mobile \u2014 one prompt, two AI responses to compare, and the USDC micro-reward for choosing the better one."
stack:
  - "Next.js 16"
  - "React 19"
  - "TypeScript"
  - "Tailwind CSS 4"
  - "PostgreSQL"
  - "Prisma 7"
  - "Stellar SDK"
  - "Freighter"
  - "USDC on Stellar"
  - "Node.js workers"
  - "Redis"
  - "JWT/JOSE"
  - "Resend"
  - "Recharts"
  - "Sentry"
  - "PostHog"
  - "Vitest"
  - "Docker"
  - "Railway"
liveUrl: "https://centient.work/"
badge: "Hackathon Project"
---

## What it is

A two-sided data-labeling marketplace that pays people in USDC on Stellar to teach AI what "better"
looks like. A contributor compares two AI responses, picks the better one with a one-line reason,
and earns a micro-reward (0.05 USDC); AI labs fund campaigns and export clean, quality-controlled
datasets.

## Value

- AI labs get neutral human preference data — the RLHF fuel worth $1–10 a datapoint — with quality
  engineered in.
- Contributors in emerging markets earn real dollars from a phone, cashable to local currency via
  Stellar anchors.
- Stellar gains a non-speculative flow: net-new wallets, real USDC velocity, every payout verifiable
  on-ledger.

## Technology highlights

- **Stellar micropayments, accumulate-then-withdraw** — sub-cent fees make paying five cents at a
  time viable; earnings settle on-chain once at cash-out via a payout worker and reconciler.
- **Engineered quality and anti-fraud** — hidden gold-standard tasks, inter-annotator agreement,
  reason-spam and bias guards, prepaid campaign budgets.
