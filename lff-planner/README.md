# LFF Planner

Personal BFI London Film Festival planner: browse the programme, flag films
(Tristan / Amy / Priority / Maybe), then build an optimised festival schedule
across every screening, venue, and travel time.

**Currently living inside `kumori-cache` temporarily** — it is fully
self-contained in this directory and will move to its own repository.

## Layout

| Path | Purpose |
|---|---|
| `shared/` | Zod data contracts (single source of truth), festival-time maths, venue/travel lookup, selection merge logic |
| `pipeline/` | `fetch.ts` (Playwright, **run on your own machine** — the BFI site blocks cloud IPs), `parse.ts` (raw HTML → `films.json`, runs anywhere) |
| `data/sample/` | Ten fictional films for development |
| `data/<year>/` | Raw page snapshots (committed ground truth) + parsed `films.json` + images |
| `app/` | Vite + Preact PWA: Browse (triage), Detail (write-ups), Schedule |
| `scheduler/` | Exact branch-and-bound schedule optimiser + CLI |
| `netlify/` | Basic-auth edge function; selections-sync function (Blobs) |

## Commands

```sh
npm install
npm run dev                # stage sample data + dev server
npm test                   # contract tests + scheduler toy cases + 500-instance fuzz oracle
npm run e2e                # Playwright UI smoke test (needs `npx vite preview app --port 4173` running)
node scripts/e2e-schedule.mjs   # scheduler-in-app e2e (same preview server)
node scripts/e2e-offline.mjs    # offline e2e (runs its own server on 4174 and kills it mid-test)
npm run stage-data -- 2025 # stage a real dataset into the app (also: LFF_YEAR=2025 npm run build)
npm run fetch -- discover --year 2025   # LOCAL MACHINE ONLY: crawl the programme (docs/getting-real-data.md)
npm run parse -- --year 2025            # raw HTML → films.json + images + parse-report
npm run schedule -- --year 2025 --selections my-selections.json   # optimiser CLI
```

## Deployment

Netlify site `lff-planner-c5fb6233` (created from this project). The whole
site — including `/api/sync` — sits behind HTTP basic auth enforced by
`netlify/edge-functions/auth.ts` (user `lff`, password in the site's
`LFF_PASSWORD` env var, non-secret scope so the edge runtime can read it)
plus `X-Robots-Tag: noindex`. Selections sync across devices via
`netlify/functions/sync.ts` + Netlify Blobs (per-film last-write-wins on
`updatedAt`). The service worker (`app/src/sw.ts`) precaches the shell and
data at install, keeps `films.json` network-first, and images cache-first;
"Download for offline" in the sync menu warms the full image cache.

## Docs

- `docs/getting-real-data.md` — running the fetcher on your machine (2025 test data)
- `docs/rerun-2026.md` — the September 2026 go-live playbook

## Principles

- Programme data, selections, and scheduling logic are three separate JSON
  contracts (`schema/`); the UI owns none of them.
- Selections are keyed by stable film slugs and survive programme refreshes;
  anything orphaned is surfaced, never dropped.
- Every screening of every film is data — the scheduler considers them all
  simultaneously.
- The deployed site carries BFI copyrighted text/images: keep the repo
  private, keep the basic-auth gate (`LFF_PASSWORD` env var) on.
