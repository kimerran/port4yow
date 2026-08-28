---
title: "Ceevee"
tagline: "AI resume optimizer"
summary: "Rewrites a master resume against any posting and deletes every skill it cannot evidence \u2014 the ATS score drops, and the reason is reported on screen."
category: "Product & client work"
sequence: 2
cover: ../../assets/projects/ceevee.jpg
coverAlt: "The Ceevee optimizer showing an ATS score of 76 out of 100, matched and missing keyword chips, and a ranked recommendation list led by the skills the evidence guard removed."
stack:
  - "TypeScript"
  - "Next.js 16"
  - "React 19"
  - "Tailwind v4"
  - "PostgreSQL"
  - "Prisma"
  - "Redis"
  - "LangChain.js"
  - "Claude API"
  - "Zod"
  - "Puppeteer"
  - "html-to-docx"
  - "MinIO"
  - "Docker"
  - "Paddle"
  - "JWT"
---

## What it is

Ceevee rewrites a structured master resume against any job posting — returning an ATS-scored
resume, cover letter, interview prep and salary estimate. Every skill the model claims is checked
against evidence in that record, and anything unsupported is deleted and reported.

**Truthfulness is enforced in code, not in the prompt.**

## Value

- **A higher score never buys a false claim.** Keyword optimizers reward lying. The guard runs on
  every generation: the score goes down, and the reason is on screen.
- **The gaps become the product.** Removals feed missing keywords, ranked recommendations, and
  interview questions that rehearse the weakness.
- **Cost is a design constraint.** Cache breakpoints, a stripped candidate payload and an
  optional-schema cover letter keep spend per run predictable.

## Technology highlights

- **Evidence guard — deterministic, and conservative.** Tokenizes the whole master resume
  recursively. `Node.js` = `NodeJS` = `node-js`, but word boundaries hold — Java is never satisfied
  by JavaScript.
- **Claude pipeline — engineered for cost and failure.** Eight chains, schema bound as a tool
  rather than parsed. A cache breakpoint splits the user message; retries split 3 transport /
  1 validation.
