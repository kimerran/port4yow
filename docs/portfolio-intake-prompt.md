# Portfolio intake prompt

Run this with an AI agent **from the root of the project repository you want to write up**. It
returns a filled intake block that maps 1:1 onto the `Project` admin form on mh.neri.ph, plus a
set of screenshots.

Paste it as-is — there is nothing to fill in.

---

You are extracting portfolio material from a codebase. The output feeds a public portfolio
site, so it must be accurate, specific, and safe to publish.

**You are already in the root of the repository to write up.** Work in the current directory —
do not clone anything, do not ask which project this is, and do not go looking for a different
repo on the machine. Confirm where you are with `pwd`, `git remote -v` and `ls`, then begin.

If the current directory is not a repository (no `.git`), say so and stop — everything below
assumes commit history is available.

## Step 0 — Confidentiality gate. Do this FIRST and do not skip it.

Before extracting anything, determine whether this project is **white-label / under NDA**.
White-label means the real client, product, and brand names must never appear in the output.

Search for an explicit signal, from the repo root:

```
grep -rniE "nda|white.?label|confidential|do not disclose|under embargo|anonymi[sz]e|client name" \
  README* CONTRIBUTING* docs/ .github/ LICENSE* package.json 2>/dev/null
```

Also check: a private/internal license, a `PROPRIETARY` notice, a customer name in
`package.json` or the git remote, and any `CLAUDE.md` / `AGENTS.md` note about disclosure.

Then classify into exactly one of three, and **say which one you chose and what evidence
decided it**:

- **PUBLIC** — an OSS licence, a public remote, or an explicit "safe to share". Use real names.
- **WHITE-LABEL** — any explicit NDA/confidential/white-label signal. Apply the redaction rules
  below to everything, including screenshots.
- **UNCLEAR** — no signal either way. **Stop and ask the operator before continuing.** Do not
  guess. A wrong PUBLIC call is an NDA breach that cannot be undone by editing the site later;
  a wrong WHITE-LABEL call costs one message to correct.

### Redaction rules when WHITE-LABEL

- Never write the client, product, or brand name. Not in prose, not in a URL, not in a file
  path you quote, not in a screenshot, not in an image filename or alt text.
- Refer to it by sector and shape instead: "a logistics SaaS", "a regional bank's onboarding
  flow", "an internal admin console for a healthcare provider".
- Set `liveUrl` and `repoUrl` to **null**. A private repo URL still leaks the name.
- Do not quote code comments, commit messages, or docs verbatim if they contain the name —
  paraphrase.
- Scale numbers stay (they are the value: "cut p95 from 4.1s to 380ms", "12k daily active
  users"), but drop anything that identifies alongside them.
- Screenshots: see the scrubbing rules in Step 2. If a screen cannot be scrubbed, omit it and
  say so rather than shipping a blurred logo.

## Step 1 — Extract these fields, and only these

These are the exact fields and limits the site enforces. Respect every limit; text over a limit
is rejected on save.

| Field      | Limit                 | What it is                                                                                                    |
| ---------- | --------------------- | ------------------------------------------------------------------------------------------------------------- |
| `title`    | 1–120 chars           | Project name. Under WHITE-LABEL, a generic descriptor: "Logistics dispatch platform".                         |
| `slug`     | 1–96, lowercase kebab | URL segment. **Immutable once published**, so pick carefully. Must not leak a name under WHITE-LABEL.         |
| `category` | one of four           | Pick the closest: `Product & client work` · `Systems & backend` · `Open source` · `Infrastructure & tooling`  |
| `summary`  | ≤180 chars            | **One line, and it must state an outcome, not a description.** This is the only text on the grid tile.        |
| `role`     | ≤120 chars            | e.g. "Lead engineer", "Sole maintainer", "Backend, 4-person team". Be honest about scope.                     |
| `timeline` | ≤120 chars            | e.g. "Mar 2025 – Jan 2026". Derive from first/last commit dates and say that is what you did.                 |
| `problem`  | ≤5000, 2–3 sentences  | What was wrong before. Concrete, with the constraint that made it hard.                                       |
| `body`     | ≤50000, Markdown      | The main case study. See structure below.                                                                     |
| `outcome`  | ≤5000                 | What changed, **with numbers where numbers exist**.                                                           |
| `liveUrl`  | URL or null           | null under WHITE-LABEL.                                                                                       |
| `repoUrl`  | URL or null           | null under WHITE-LABEL, and null for any private repo.                                                        |
| `stack`    | list of names         | Technologies. Return plain names ("PostgreSQL", "Astro"); they are matched to existing stack entries by hand. |

### How to find each thing, and how not to make it up

Read, in this order: `README`, `docs/`, ADRs / design docs, `package.json` + lockfile, the
CI config, `docker-compose` / infra files, the migration history, then the commit log
(`git log --oneline --reverse | head -50` and `git log --oneline | head -50` for first and
latest work).

**Evidence rule: every factual claim must trace to something you read.** After each of
`problem`, `outcome`, and each `body` section, add a line:

> _Source: `path/to/file` (and/or commit `abc1234`)_

If you cannot source a claim, do not write it. Instead list it under **Open questions** at the
end, phrased as a question for the developer. Unsourced achievements are the single most
common failure here — "improved performance by 40%" with no benchmark behind it is worse than
saying nothing, because the developer may have to defend it in an interview.

Numbers specifically: take them from benchmarks, test output, migration sizes, dependency
counts, CI timings, or load-test results committed to the repo. Do not estimate. If the repo
has no numbers, say so and put it in Open questions — do not substitute adjectives.

### `body` structure

Markdown, rendered and sanitized server-side. Use `##` headings only (there is already an
`h1`), plus prose, lists, and fenced code. No inline HTML — it will be stripped.

Suggested shape, adapt to the project:

1. `## Context` — the system as it stood, and the constraint.
2. `## Approach` — the two or three decisions that mattered, and what you traded away for each.
   Name the alternative you rejected and why; a decision with no rejected alternative reads as
   a default, not a decision.
3. `## Hard parts` — the genuinely difficult problem, and how it was solved. This is the section
   a reader judges the engineer by. Prefer one problem in depth over four in passing.
4. `## Results` — what shipped, what it does now, what you would change.

Include a short code excerpt **only** where it carries the point (an unusual algorithm, a
tricky invariant). Keep it under ~20 lines and never paste config or boilerplate.

### Voice — this site rejects the usual register

Plain, specific, slightly dry. Precision is the personality.

- Banned: "passionate about", "crafting digital experiences", "leveraged cutting-edge", "robust
  and scalable solution", "seamless". Anything a press release would say.
- State the problem and the outcome, with numbers where numbers exist.
- Sentence case for headings. Nouns, not gerunds: "Context", not "Setting the context".
- Write in past tense about the work, present tense about the system as it stands.
- Do not sell. A reader who knows the domain should find nothing to roll their eyes at.

## Step 2 — Generate screenshots

Produce a cover image plus 3–6 supporting shots.

**Constraints the upload pipeline enforces** (violating these fails the upload):

- Format: **JPEG, PNG, WebP or AVIF only.** No SVG, no GIF, no PDF.
- Max **8 MB** per file.
- Source width **≥ 1920px** where possible — derivatives are generated at 480/960/1440/1920,
  and only widths the source can fill get generated. A 900px screenshot yields a soft cover.
- Every image needs **alt text, 1–500 chars, never empty.** Describe what the screen _shows_,
  not "screenshot of dashboard". Under WHITE-LABEL, alt text must not name the client either.

**How to capture.** Get the app running first — read the README for the real command; typically
a `docker compose up` for services then the dev server. If it cannot be run (no seed data, no
credentials, missing external services), **say so and stop** rather than shipping mock-ups:
fabricated UI presented as a real product is worse than no screenshot. Then capture headless
at a 2× device scale factor for a sharp result:

```bash
mkdir -p portfolio
npx playwright screenshot --viewport-size=1440,900 --device-scale-factor=2 \
  --wait-for-timeout=2000 <url> portfolio/01-cover.png
```

Shot list, in priority order:

1. **Cover** — the single screen that best says what this is. Landscape, 1440×900 or wider.
2. The primary workflow, mid-task, with realistic data.
3. A screen showing the hard part from `body` — the thing you claimed was difficult.
4. Any admin/internal view, if it shows real engineering.
5. A mobile viewport (375px) **only** if the project is genuinely responsive.

Skip: login screens, empty states, 404s, settings pages. They show nothing.

**Seed realistic data first.** Lorem ipsum and `test test` rows make a product look unfinished.
Use the repo's own seed script if there is one.

**Scrubbing — required under WHITE-LABEL, good practice always:**

- Replace the client logo/wordmark with a neutral block or a generic name. Do not blur it —
  a blurred logo is still recognisable and reads as an NDA breach in progress.
- Replace real names, emails, phone numbers, addresses, and account numbers with plausible
  fakes. Never leave a real customer record on screen.
- Check the browser chrome: the URL bar, tab title, and any bookmarks bar. Capture with a clean
  profile, or crop the chrome entirely.
- Check for a name in: page `<title>`, breadcrumbs, footer copyright, avatars, sample PDFs,
  chart legends, and error toasts.
- After capture, re-read every image before delivering and confirm each is clean. State that
  you did.

**Everything you produce goes in one directory: `portfolio/` in the repo root.** Create it if it
does not exist. Screenshots are named `01-cover.png`, `02-<what-it-shows>.png`, … and the write-up
goes beside them as `portfolio/intake.md` (Step 3). Under WHITE-LABEL a filename must not carry
the client or product name either.

`portfolio/` is a deliverable for a different site, not part of this project, so do not commit
it: add `portfolio/` to `.git/info/exclude` — a local ignore that does not modify the repo's
tracked `.gitignore`. Leave the repository's own files unchanged otherwise. This is an
extraction task; `portfolio/` is the only thing you create.

## Step 3 — Output format

Write the block below to **`portfolio/intake.md`**, so the whole hand-off is one directory:

```
portfolio/
  intake.md          <- the block below
  01-cover.png
  02-….png
```

Then print the same content in your reply, and nothing else after it. Writing it to a file is what
matters — a reply gets lost in scrollback, and the screenshots are on disk regardless, so the text
that describes them belongs on disk too.

```markdown
## Confidentiality

Classification: PUBLIC | WHITE-LABEL
Evidence: <what you found, and where>

## Fields

title: <…>
slug: <…>
category: <Product & client work | Systems & backend | Open source | Infrastructure & tooling>
summary: <≤180 chars, an outcome>
role: <…>
timeline: <…>
liveUrl: <url or null>
repoUrl: <url or null>
stack: <comma-separated names>

## problem

<2–3 sentences>
_Source: …_

## body

<Markdown, ## headings, each section sourced>

## outcome

<with numbers where numbers exist>
_Source: …_

## Assets

| file         | alt text      | what it shows | scrubbed? |
| ------------ | ------------- | ------------- | --------- |
| 01-cover.png | <1–500 chars> | …             | yes/n-a   |

## Open questions

- <every claim you could not source, as a question for the developer>

## What I could not do

- <anything skipped, and why — e.g. "app would not boot without a Stripe key">
```

Report honestly. An intake that says "the repo has no benchmarks, so there are no performance
numbers" is useful. One that invents them is not, and the developer will find out in an
interview rather than here.
