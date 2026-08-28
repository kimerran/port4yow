---
title: "Artisam Labs"
tagline: "Builder studio site"
summary: "Near-zero run cost: prerendered HTML, one container and no database, with dated project milestones as a browsable record of delivery."
category: "Product & client work"
sequence: 6
cover: ../../assets/projects/artisam-labs.jpg
coverAlt: "The artisam.xyz landing page \u2014 hero headline, dual calls to action, and a live-environment motif above the project directory."
stack:
  - "Astro 5.18.2"
  - "TypeScript"
  - "Tailwind CSS 3.4"
  - "Astro Content Collections"
  - "Zod"
  - "Express 4"
  - "Node 20"
  - "@astrojs/node"
  - "@astrojs/sitemap"
  - "Sharp"
  - "Resend"
  - "Cloudflare Turnstile"
  - "Calendly"
  - "Docker"
  - "Railway"
  - "Caddy"
liveUrl: "https://artisam.xyz/"
---

## What it is

Public studio site for a builder collective working across modern Web, Blockchain and AI. A
static-first Astro 5 site with three pillars — a Project Directory with dated milestones, an
"Intelligence Feed" blog, and a Contact page with embedded scheduling. Every page is prerendered
HTML except one server route that handles the contact form.

## Value delivered

- Credibility surface — dated milestones as browsable proof of delivery.
- Lead capture, no CRM — Turnstile-hardened form to inbox via Resend.
- Near-zero run cost — prerendered HTML, one container, no database.
- Reach out of the box — auto sitemap and an OG card per project and post.

## Technology highlights

- **Static-first Astro 5, one dynamic route** — Node adapter in middleware mode: only
  `POST /api/contact` renders server-side, everything else ships as prerendered HTML.
- **Build-time image pipeline with Sharp** — a prebuild step generates Open Graph cards and
  placeholders from the content collections, so there are no hand-made social assets.
