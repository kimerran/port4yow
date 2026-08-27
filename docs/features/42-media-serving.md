# #42 — `GET /api/media/[...key]`: key validation and presigned redirect

## Done

Exercised end to end against a real MinIO bucket, not mocked.

| Criterion                       | Result                                                    |
| ------------------------------- | --------------------------------------------------------- |
| Valid key                       | **302** with `X-Amz-Expires=300` — SPEC §9's 5-minute TTL |
| Redirect target works           | following it returns **200** and the real bytes           |
| `Cache-Control` on the redirect | `public, max-age=3600`                                    |
| Unknown key                     | **404** — never a presigned URL                           |
| `../../etc/passwd`              | **404**                                                   |
| `/etc/passwd`                   | **404**                                                   |
| `projects/../../etc/passwd`     | **404**                                                   |
| Bucket private                  | direct `GET` to MinIO → **403**                           |

`typecheck` 0/0/0 · `lint` PASS · **101 tests** · `build` PASS · `audit` PASS

**`isSafeKey` is mutation-checked**, because a shape check that silently accepted `../` would
be worse than none:

| Mutation                       | Tests failing |
| ------------------------------ | ------------- |
| traversal guard removed        | **4**         |
| key pattern loosened to `/.*/` | **5**         |

## SPEC §9 contains a contradiction worth resolving

Two sentences, one line apart:

> …then **302s to a presigned URL** with a 5-minute TTL … **Storage host never reaches the
> browser.**

A 302 _is_ the browser being handed the storage host — it receives the `Location` and fetches
it. The two cannot both be literally true.

Implemented as specified (302, since that is the explicit instruction) and verified the
defensible reading holds: **the storage host appears nowhere in page markup** — 0 references to
the MinIO origin in the served HTML. Images are referenced as `/api/media/…`, and the redirect
target is an implementation detail rather than something in the DOM.

**Worth amending SPEC §9** to say what it means: _the storage host never appears in page
markup_. If the stricter reading was intended, the route has to **proxy the bytes** rather than
redirect — a real design change with real cost (every image flows through the app server), so
it should be a deliberate decision rather than something inferred here.

## Decisions

- **The `MediaAsset` lookup is the authorisation**, not `isSafeKey`. Knowing a key is not
  enough; a key with no row 404s. The shape check exists so traversal is rejected _before_
  anything reaches the S3 client, and so the rejection is cheap (AGENT §3).
- **The same 404 for a malformed key, an unknown key, and an unregistered object.** No variant
  reveals whether an object exists in the bucket.
- **`Cache-Control: public, max-age=3600` sits on the 302**, not the object. The presigned
  target expires in five minutes; the redirect pointing at it is what a browser reuses.
- **`src/lib/storage.ts` is server-only** — it holds credentials and must never be imported
  from a client script (AGENT §4).

## Blocked

Nothing. Note the endpoint currently has no producer: **#28** (upload pipeline) creates
`MediaAsset` rows and puts objects in the bucket. This slice was verified by placing an object
with `mc` and inserting the row by hand, which is what the issue anticipated.

## Next

**#17 — responsive image rendering**, which is what this endpoint exists for. It should use the
**375px iframe technique** from #15 rather than `--window-size` for narrow-viewport checks.

## Content TODOs

None.
