---
title: "EMBER"
tagline: "Milestone-based crowdfunding on Morph L2"
summary: "Backers cannot get burned: funds sit in a per-project escrow contract and release only on an on-chain vote, with no upgrade key and no human override."
category: "Systems & backend"
sequence: 14
cover: ../../assets/projects/ember.jpg
coverAlt: "An EMBER project detail page \u2014 live funding progress against target, the USDT contribution panel, and a milestone timeline showing each milestone's vote and claim state."
stack:
  - "Next.js 16 (App Router)"
  - "React 19"
  - "TypeScript"
  - "Tailwind CSS 4"
  - "Node.js 22"
  - "PostgreSQL"
  - "Prisma 7"
  - "Redis"
  - "BullMQ"
  - "Better Auth"
  - "SIWE"
  - "wagmi 3"
  - "viem"
  - "Reown AppKit"
  - "Solidity ^0.8.28"
  - "Foundry"
  - "OpenZeppelin 5"
  - "Morph L2"
  - "React Email"
  - "Resend"
  - "pnpm workspaces"
  - "Turborepo"
  - "Vitest"
  - "Docker"
badge: "Hackathon Winner"
---

## What it is

Ember is a milestone-based crowdfunding dApp on Morph L2 where backers contribute USDT into a
per-project escrow contract and receive an ERC-721 position NFT. Funds release only after backers
approve each milestone in an on-chain vote weighted by their contribution. An indexer service
mirrors every on-chain event into Postgres, keeping the blockchain the source of truth for all
value movement.

## Value

- **Backers don't get burned.** Money sits in escrow, not a founder's wallet — a project that
  stalls at milestone 2 can never claim milestone 5's funding.
- **Creators get credible funding.** Verified orgs raise against a public, bps-weighted milestone
  plan; trust comes from the contract, not platform reputation.
- **No human discretion in the loop.** Code decides fund release. No support ticket overrules a
  vote, and no upgrade key exists on the deployed escrow.

## Technology highlights

- **Non-custodial milestone escrow on Morph L2** — a ProjectFactory deploys an immutable
  ProjectEscrow and PositionNFT pair per project. The app only builds calldata; the user's wallet
  signs every value-moving transaction.
- **Event-sourced indexer with a milestone keeper** — watches chain events with confirmation depth
  and idempotent backfill, sweeps expired voting windows to resolve milestones, and drives the email
  queue off the same lifecycle.
