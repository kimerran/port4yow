---
title: "MyGoal"
tagline: "AI exam & classroom platform"
summary: "Hours of manual exam authoring collapse into minutes: uploaded course material becomes a reusable question bank with AI grading and same-day feedback."
category: "Product & client work"
sequence: 1
cover: ../../assets/projects/mygoal.jpg
coverAlt: "A class page in MyGoal listing a graded A1 German assessment and a vocabulary practice set, each with due date, pass mark and a resume action."
stack:
  - "Next.js 15"
  - "React 19"
  - "TypeScript"
  - "Tailwind CSS"
  - "PostgreSQL"
  - "pgvector"
  - "Prisma 7"
  - "Anthropic Claude API"
  - "OpenAI Embeddings"
  - "AWS S3"
  - "Redis"
  - "iron-session"
  - "Zod"
  - "Sentry"
  - "Vitest"
  - "Docker"
  - "Railway"
---

## What it is

A classroom and examination platform where teachers upload course materials and the system
generates exams from them using AI. Students take timed or practice exams and get instant scoring
with AI-written explanations. Admins, staff, teachers and students share one role-scoped source of
truth.

## Value

Material uploaded once becomes a reusable question bank, graded assessments and per-student
performance data — with essays and drawings AI-graded, and feedback returned immediately instead
of days later.

## Technology highlights

- **RAG exam generation** — materials chunked, embedded and indexed in Postgres/pgvector,
  retrieved as grounded context for Claude.
- **Durable background job pipeline** — resource processing and AI grading run as queued jobs with
  retry and stuck-job recovery.
