---
title: "Back2You"
tagline: "Intelligent lost-and-found — multi-tenant, white-label deployments"
summary: "Turns a shoebox of found items into a searchable inventory: owners self-serve by text or photo, and one config file provisions a whole new institution."
category: "Product & client work"
sequence: 4
cover: ../../assets/projects/back2you.jpg
coverAlt: "A lost-and-found search for the word backpack returning two confidence-ranked matches, each with its photo withheld behind a photo-hidden-until-verified placeholder."
stack:
  - "Next.js 16"
  - "React 19"
  - "TypeScript"
  - "Tailwind 4"
  - "Prisma 7"
  - "PostgreSQL 17 + pgvector"
  - "Redis"
  - "Voyage AI"
  - "S3/MinIO"
  - "MapLibre"
  - "Capacitor 8"
  - "Meta Graph API"
  - "Playwright"
  - "Railway"
liveUrl: "https://back2you.xyz/"
---

## What it is

Staff log found items with photos, location and metadata. Owners find them by typing a description
or uploading a photo — matched with multimodal AI embeddings and vector similarity. QR "trackers"
pre-tag ownership so a tagged item notifies its owner the moment it is logged, and a
Messenger/WhatsApp bot lets anyone search with nothing installed.

## Value

- Turns a shoebox into a searchable inventory with a full claim audit trail.
- Owners self-serve from web, mobile, kiosk or chat — no front-desk queue.
- Privacy by design: photos stay hidden until staff verify identity in person.
- One config file provisions a new institution — branding, roster, isolation.

## Technology highlights

- **Multimodal AI search** — Voyage multimodal-3.5 embeddings in Postgres + pgvector (HNSW): one
  vector space for text and image queries, guarded by a recall@k / MRR eval that fails the build on
  regression.
- **Server-enforced multi-tenancy** — every read and write passes a Next.js 16 Data Access Layer
  that checks the role and injects `tenantId`. Middleware is never the security boundary.
