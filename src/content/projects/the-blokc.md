---
title: "The BLOKC"
tagline: "Marketing site for the Philippines' longest-running blockchain education organization"
summary: "A national-scale front door that converts students, universities and enterprise partners into inquiries through one reason-tagged contact pipeline."
category: "Product & client work"
sequence: 9
cover: ../../assets/projects/the-blokc.jpg
coverAlt: "The theblokc.com landing page \u2014 hero, a featured workshop replay, and the Education, Build and Training pillar sections."
stack:
  - "Astro 5.18"
  - "TypeScript"
  - "Tailwind CSS 3.4"
  - "Content Collections + Zod"
  - "Express 4"
  - "@astrojs/node"
  - "@astrojs/sitemap"
  - "Resend"
  - "Cloudflare Turnstile"
  - "sharp"
  - "Node 20"
  - "Docker"
  - "Railway"
  - "Caddy"
liveUrl: "https://theblokc.com/"
---

## What it is

A marketing website presenting the organization's three pillars — Education, Build, Training —
across a landing page and ten detail pages, plus a workshop replay library and a contact flow. All
copy lives in Markdown content collections, so programs are updated without touching components.

## Value delivered

- A credible national-scale digital front door that converts students, universities and enterprise
  partners into inquiries via one reason-tagged contact pipeline.
- Content-first architecture lets non-developers edit program copy safely — no CMS cost, no deploy
  risk.
- Static delivery with a strict security and SEO posture (CSP without inline scripts, canonical
  domain, generated sitemap) protects speed, ranking and trust.

## Technology highlights

- **Astro 5 static-first hybrid** — the whole site pre-renders to HTML while a single Express +
  Node-adapter service serves the one dynamic route (Resend contact API).
- **Spec-driven Material 3 design system** — brand tokens defined once and compiled by Tailwind,
  with vanilla-TS islands instead of a client framework. Zero runtime UI dependencies.
