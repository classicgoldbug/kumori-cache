# Getting real programme data (the part that runs on your machine)

The BFI's whatson site sits behind a Cloudflare browser check that blocks
cloud/datacenter IPs, so the **fetch step runs on your own computer**. It
drives a visible Chrome window; everything downstream (parsing, the app, the
scheduler) works from the files it saves and can run anywhere.

## One-time setup

```sh
git clone <this repo> && cd lff-planner
npm install
npx playwright install chromium
```

## Step 1 — bootstrap sample pages (do this first)

The parser doesn't exist until it has real pages to learn from. Run:

```sh
npm run fetch -- discover --year 2025
npm run fetch -- fetch --year 2025 --limit 1
```

- A Chrome window opens. If Cloudflare shows a "checking your browser" page,
  just wait (or tick the box) — the clearance cookie is kept in `.pw-profile/`
  so this rarely repeats.
- `discover` saves the programme listing page(s) and writes
  `data/2025/raw/film-urls.json`. If the listing is spread across several
  pages (A–Z pages, strand pages), pass each one with
  `--url "<listing page url>"` — you can re-run discover as often as you like;
  it accumulates unique film URLs.
- Then commit and push everything under `data/2025/raw/` and say so in the
  Claude session — the parser gets written against those pages.

After the first parser round, fetch a *diverse* sample (~8 films) so the
parser sees the edge cases. Good picks: a headline gala at the Royal Festival
Hall, an ordinary single-screening film, a Treasures/archive title, a shorts
programme, something with a huge cast list, a non-English title. Fetch them
by slug (slugs are in film-urls.json):

```sh
npm run fetch -- fetch --year 2025 --slugs slug-one,slug-two,slug-three
```

Commit and push again.

## Step 2 — the full crawl

```sh
npm run fetch -- fetch --year 2025
```

~250 pages at a polite 2.5–4.5 s per page ≈ 20 minutes. It is resumable —
interrupt it whenever; re-running skips what's already saved. When it
finishes, commit `data/2025/raw/` (yes, all of it — the raw HTML is the
project's ground truth and lets the parser be re-run and improved forever
without re-crawling).

Then parsing (runs anywhere, including the Claude session):

```sh
npm run parse -- --year 2025      # → data/2025/films.json + images + parse-report.json
```

## If 2025 pages have been unpublished

The site is already branded for LFF 2026, and 2025 film pages may 404. In
that case skip straight to the 2026 programme when it's revealed (expected
around 3 September) — same commands with `--year 2026` — or ask Claude to add
the Wayback Machine fetch variant.

## If Cloudflare blocks even the headed browser

Save pages manually from your normal browser: open the film page, Cmd/Ctrl-S
→ "Webpage, HTML Only" → save into `data/<year>/raw/pages/<slug>.html`. The
parser cannot tell the difference.
