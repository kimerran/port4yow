---
title: "HiveBase"
tagline: "Self-hosted knowledge & work management for multi-company teams"
summary: "One workspace instead of four tools, self-hosted so the data stays yours \u2014 and a built-in MCP server lets Claude query the team's real SOPs and tasks."
category: "Infrastructure & tooling"
sequence: 5
cover: ../../assets/projects/hivebase.jpg
coverAlt: "A HiveBase kanban board for a Product space, with task cards in columns beside a multi-company workspace sidebar."
stack:
  - "Next.js 16"
  - "React 19"
  - "TypeScript"
  - "Tailwind v4"
  - "Prisma 7"
  - "PostgreSQL"
  - "JWT + bcrypt auth"
  - "Redis"
  - "S3/MinIO"
  - "Resend"
  - "TipTap"
  - "dnd-kit"
  - "Zod"
  - "MCP SDK"
  - "Vitest"
  - "Playwright"
  - "Docker"
  - "Railway"
---

## What it is

A self-hosted "Notion + Jira hybrid" for a small team running several companies at once. SOPs,
cross-company tasks and daily/weekly updates live in one workspace organised as
Company → Space → Area. A built-in MCP server exposes the same knowledge base to Claude.

## Value

- One tool instead of four — docs, tasks, standups and search in one workspace.
- Multi-company without leakage — every row org-scoped, permissions enforced in the data layer.
- Your data stays yours — self-hosted on Postgres, S3 and Redis; no per-seat SaaS bill.
- AI-native — Claude queries the team's real SOPs and tasks over MCP.

## Technology highlights

- **Built-in MCP server** — the knowledge base is a first-class, org-scoped Claude integration.
- **Security in the data-access layer** — one Prisma-only layer applies tenant scoping to every
  query.
