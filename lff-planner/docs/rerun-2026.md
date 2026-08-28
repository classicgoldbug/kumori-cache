# LFF 2026 go-live playbook

Festival: **7–18 October 2026**. Programme reveal expected ~3 September 2026
(competition titles possibly earlier). Amy is away **13–15 October** — already
encoded in `data/constraints.json`; the scheduler treats those as hard
no-Amy days.

## When the programme drops

1. On your machine:
   ```sh
   npm run fetch -- discover --year 2026
   npm run fetch -- fetch --year 2026 --limit 3
   ```
   Commit `data/2026/raw/` and push. (The site's DOM may have changed since
   2025 — these three pages are the drift check. If `npm run parse -- --year 2026`
   already produces clean output, carry straight on.)
2. Full crawl: `npm run fetch -- fetch --year 2026` (~20 min), commit, push.
3. Parse and stage:
   ```sh
   npm run parse -- --year 2026
   npm run stage-data -- 2026        # or: LFF_YEAR=2026 npm run build
   ```
   Triage `data/2026/parse-report.json` — every anomaly is listed there;
   unknown venue names get aliases added in `pipeline/venues.json`.
4. Deploy (set `LFF_YEAR=2026` in the Netlify environment so builds stage
   the right year), and start flagging films.

Selections are stored per year (`lff-selections-2026`), so the 2025 dry run
never contaminates the real thing.

## Mid-festival programme changes

Added screenings, venue swaps, and extra dates happen. Re-run
`fetch --year 2026 --force` (or with `--slugs` for specific films), parse,
stage, deploy. Film ids are permalink slugs, so your flags, pins, and notes
survive untouched; a film genuinely removed shows up in the app's orphan
banner rather than silently vanishing.

## The Surprise Film

Not in the programme data by design. Add it in the app: Browse → **+ Event**
(title "Surprise Film", its date/time, Royal Festival Hall, your flags). The
scheduler treats it exactly like a real film.

## Remember

- The deployed site carries the BFI's copyrighted write-ups and images. Keep
  the repo private and the basic-auth gate on (`LFF_PASSWORD` env var on the
  Netlify site).
- Amy's day-shape targets and the objective weights are in
  `data/constraints.json` — tune freely; the scheduler and app read them at
  run time.
- Travel times and venue aliases live in `pipeline/venues.json`.
