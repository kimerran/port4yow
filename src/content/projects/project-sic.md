---
title: "Project SIC"
tagline: "Self-improving content engine, multi-tenant SaaS"
summary: "Turns guess-and-post content marketing into a measurable feedback loop: the strategy is a living document that converges on what actually resonates."
category: "Systems & backend"
sequence: 7
cover: ../../assets/projects/project-sic.jpg
coverAlt: "The SIC cycle pipeline showing eight stages from queue to synthesis, generated slideshow posts, and a live webhook event log."
stack:
  - "Next.js 16"
  - "React 19"
  - "TypeScript"
  - "Tailwind 4"
  - "Drizzle ORM"
  - "PostgreSQL 17"
  - "Redis"
  - "BullMQ"
  - "Better Auth"
  - "n8n"
  - "Anthropic Claude"
  - "Fal.AI"
  - "Metricool"
  - "S3/MinIO"
  - "Docker"
  - "Vitest"
  - "Playwright"
---

## What it is

A platform that runs closed-loop content cycles for social accounts: generate → publish → harvest →
synthesize. An LLM writes and illustrates posts, schedules them via Metricool, pulls back real
engagement metrics, then rewrites the brand's strategy for the next cycle.

## Value

Turns guess-and-post content marketing into a measurable feedback system — the strategy is a living
document that converges on what actually resonates, while approval gates and editable strategy
diffs keep humans in control.

## Technology highlights

- **Closed-loop LLM strategy synthesis** — Claude rewrites the next cycle's strategy from measured
  engagement plus human feedback, with versioned prompts and auditable diffs.
- **Durable multi-tenant orchestration** — an 8-stage cycle state machine on BullMQ/Redis and n8n,
  with per-brand encrypted credentials and live webhook streaming.
