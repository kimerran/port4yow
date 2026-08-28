---
title: "Project CIG"
tagline: "Contorr Image Gen \u2014 AI human models and virtual try-on"
summary: "Replaces studio photo shoots for apparel catalogs: on-model imagery across body types and settings in minutes, with winning looks reproducible by parameter."
category: "Product & client work"
sequence: 8
cover: ../../assets/projects/project-cig.jpg
coverAlt: "The Human Models gallery \u2014 a grid of AI-generated model images, each stored with the parameters that produced it."
stack:
  - "Next.js 16 (App Router)"
  - "React 19"
  - "TypeScript"
  - "Tailwind CSS v4"
  - "Prisma"
  - "PostgreSQL"
  - "Redis"
  - "BullMQ"
  - "MinIO/S3"
  - "Fal.AI"
  - "ComfyUI"
  - "Express"
  - "Zod"
  - "argon2"
  - "Docker"
  - "Railway"
  - "pnpm"
  - "Vitest"
---

## What it is

A full-stack app that generates hyper-realistic human models with AI, then dresses them in real
apparel photos via virtual try-on. A guided prompt builder and per-model parameter forms drive
every render, and each output is stored with its model and parameters.

## Value

Replaces studio photo shoots for apparel catalogs: on-model product imagery across body types,
skin tones and settings in minutes instead of days, at a fraction of the cost. Stored parameters
make winning looks reproducible across a whole product line.

## Technology highlights

- **Async AI pipeline** — a BullMQ/Redis worker submits jobs to Fal.AI (or a self-hosted ComfyUI
  proxy), polls to completion and streams results into S3/MinIO, keeping the web tier responsive.
- **Type-safe pluggable model registry** — declarative model specs render the parameter forms
  dynamically and are Zod-validated end to end, so new AI models need no UI changes.
