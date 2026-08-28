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
npm test                   # contract & logic tests
npm run e2e                # Playwright smoke test (needs `npx vite preview app --port 4173` running)
npm run stage-data -- 2025 # stage a real dataset into the app
npm run fetch -- discover --year 2025   # LOCAL MACHINE ONLY: crawl the programme
npm run parse -- --year 2025            # raw HTML → films.json
npm run schedule -- --year 2025 --selections my-selections.json
```

## Principles

- Programme data, selections, and scheduling logic are three separate JSON
  contracts (`schema/`); the UI owns none of them.
- Selections are keyed by stable film slugs and survive programme refreshes;
  anything orphaned is surfaced, never dropped.
- Every screening of every film is data — the scheduler considers them all
  simultaneously.
- The deployed site carries BFI copyrighted text/images: keep the repo
  private, keep the basic-auth gate (`LFF_PASSWORD` env var) on.
