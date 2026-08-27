# #4 — Local dev services via docker-compose

## Done

All five services from SPEC §12 come up and were verified running, not assumed:

| Check | Result |
|---|---|
| `postgres` | healthy; `pg_isready -U portfolio` → *accepting connections* |
| `minio` | healthy via `/minio/health/live` |
| `createbucket` | **exit 0**; `portfolio-media` created |
| Bucket is private (SPEC §9) | `mc anonymous get` → *`private`*; unauthenticated `GET /portfolio-media/` → **HTTP 403** |
| `mailpit` | healthy; web UI → **HTTP 200** |
| `redis` | `redis-cli ping` → **PONG** |
| `docker compose config` | valid |

## Changed

- `docker-compose.yml` — new, dev only. Production uses Railway managed services (SPEC §13).

No README change: the first-run sequence and `pnpm db:up` were already documented, and #3's
reformat of `README.md` was in flight — editing it here would have conflicted for no gain.

## Decisions

- **Added a `healthcheck` to `minio` and changed `createbucket` to
  `depends_on: {minio: {condition: service_healthy}}`.** This is a deviation from SPEC §12's
  literal YAML, and it is a **bug fix, not a preference**: `depends_on: [minio]` waits for the
  container to *start*, never for it to be *ready*, so `mc` races MinIO and dies with
  `dial tcp: lookup minio on 127.0.0.11:53: server misbehaving`. Observed on the first clean
  run, and **mutation-checked in both directions** — gate removed → `createbucket` exits **1**;
  gate restored → exits **0**. Without this, SPEC §12's own acceptance criterion ("the bucket
  exists and anonymous access is denied") cannot hold on a cold start. **SPEC §12 should be
  amended to match.**

## Blocked

Nothing, but one environment caveat worth recording.

**The SPEC §12 host ports are contended on this machine.** Unrelated `ceevee-*` containers
(another project) hold **5432**, **9000**, **9001** and **6379**. They are not this project's
to stop, so the stack was verified with a **temporary port remap supplied via a second
compose file kept outside the repo** — `55432`, `59000/59001`, `51025/58025`, `56379`.

- The committed `docker-compose.yml` keeps SPEC §12's ports **unchanged**.
- Only *host* ports were remapped; internal service DNS is untouched, so `createbucket`
  reached `minio:9000` exactly as it will in the real file. The verification is faithful.
- Note that `ports` **merges by concatenation** across compose files — the remap only took
  effect with the `!override` tag. Worth knowing before anyone writes a local override.
- If this recurs for whoever runs the stack next, the fix is a local
  `docker-compose.override.yml` (gitignored), not a change to the committed ports.

## Next

**#5 — Prisma 7 schema, first migration, and PrismaClient singleton.** It needs Postgres on
**5432**, so the port contention above has to be resolved before its migration can run.

## Content TODOs

None.
