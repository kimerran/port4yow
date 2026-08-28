---
title: "Paiflow"
tagline: "Zaps for money \u2014 a visual builder for programmable payments on Stellar"
summary: "Ships on-chain payment logic in about ninety seconds without a Soroban developer, and non-custodially \u2014 the user's own wallet signs every deploy."
category: "Systems & backend"
sequence: 13
cover: ../../assets/projects/paiflow.jpg
coverAlt: "The Paiflow visual canvas \u2014 a trigger wired through a condition into a split action, ready to deploy live to Stellar."
stack:
  - "Next.js 15"
  - "React 19"
  - "TypeScript"
  - "Tailwind 4"
  - "shadcn/ui"
  - "framer-motion"
  - "@xyflow/react"
  - "zustand"
  - "TanStack Query"
  - "Zod"
  - "Auth.js v5"
  - "SimpleWebAuthn"
  - "PostgreSQL 16"
  - "Prisma 6"
  - "Redis 7"
  - "MinIO"
  - "Resend"
  - "Groq (Whisper + Llama)"
  - "Stellar SDK"
  - "Stellar Wallets Kit"
  - "Soroban"
  - "Rust 1.88"
  - "soroban-sdk 22"
  - "Node.js 22"
  - "pnpm 10"
  - "Playwright"
  - "Vitest"
  - "Sentry"
  - "pino"
  - "Docker"
  - "Railway"
liveUrl: "https://paiflow.xyz/"
badge: "Hackathon Winner"
---

## What it is

Drag triggers (On Receive USDC, On Schedule, Webhook, Subscription) onto a canvas, wire them to
actions (Pay, Split, Stream, Payroll, Cash out), and deploy the flow as a live Soroban smart
contract in under a minute. Deploys are non-custodial — the backend only prepares and simulates the
transaction; the user's own wallet signs it.

## Value

Programmable payouts today need a rare Soroban/Rust developer or a closed SaaS that owns your rails
and fees. Paiflow removes both: creators splitting revenue, MSMEs paying contractor pools, and OFWs
automating remittances ship their own on-chain payment logic in around 90 seconds — keeping their
keys, their funds, and audit-grade transparency.

## Technology highlights

- **Atomic factory deploys** — deterministic CAP-46 child addresses; one `deploy_pipeline` call
  deploys and wires the whole flow graph from pre-audited Rust/WASM templates.
- **Raft Log voice AI** — Groq Whisper and Llama turn plain English ("change Alice to 55%") into a
  validated JSON patch applied to the canvas.
