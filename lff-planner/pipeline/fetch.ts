/**
 * Programme fetcher — RUN THIS ON YOUR OWN MACHINE, not in a cloud session.
 * The BFI's whatson site sits behind a Cloudflare browser check that blocks
 * datacenter IPs; a real, headed browser on a residential connection passes.
 *
 *   npm run fetch -- discover --year 2025 [--url <extra listing url>...]
 *   npm run fetch -- fetch    --year 2025 [--limit N] [--slugs a,b] [--force]
 *
 * `discover` opens the festival programme entry page(s), saves their rendered
 * HTML into data/<year>/raw/listing/, and collects every film-article URL it
 * can see into data/<year>/raw/film-urls.json.
 *
 * `fetch` then visits each film URL, saves the rendered page into
 * data/<year>/raw/pages/<slug>.html, downloads the film's own page image into
 * data/<year>/raw/images-src/, and records everything in fetch-manifest.json.
 * It is resumable: pages already fetched are skipped unless --force.
 *
 * A visible browser window opens (headless browsers get challenged far more
 * often). If Cloudflare shows a challenge, just solve it in the window — the
 * persistent profile in .pw-profile/ remembers the clearance for next time.
 *
 * If automation is ever completely defeated, save pages manually from your
 * browser (Cmd/Ctrl-S, "HTML only") into raw/pages/<slug>.html — the parser
 * cannot tell the difference.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const DEFAULT_ENTRY_POINTS = ["https://whatson.bfi.org.uk/lff/Online/default.asp"];

interface ManifestEntry {
  slug: string;
  url: string;
  status: "ok" | "challenge" | "queue" | "error";
  fetchedAt: string;
  bytes: number;
  imageUrl: string | null;
  imageFile: string | null;
  note?: string;
}

interface Args {
  command: string;
  year: string;
  limit: number;
  slugs: string[];
  force: boolean;
  urls: string[];
}

function parseArgs(argv: string[]): Args {
  const args: Args = { command: "", year: "", limit: Infinity, slugs: [], force: false, urls: [] };
  const rest = [...argv];
  args.command = rest.shift() ?? "";
  while (rest.length > 0) {
    const arg = rest.shift()!;
    if (arg === "--year") args.year = rest.shift() ?? "";
    else if (arg === "--limit") args.limit = Number(rest.shift() ?? "0") || Infinity;
    else if (arg === "--slugs") args.slugs = (rest.shift() ?? "").split(",").filter(Boolean);
    else if (arg === "--force") args.force = true;
    else if (arg === "--url") args.urls.push(rest.shift() ?? "");
    else console.warn(`ignoring unknown argument: ${arg}`);
  }
  if (!["discover", "fetch"].includes(args.command) || !args.year) {
    console.error("usage: npm run fetch -- discover|fetch --year <year> [--limit N] [--slugs a,b] [--force] [--url ...]");
    process.exit(1);
  }
  return args;
}

function slugFromUrl(url: string): string | null {
  const match = /permalink=([^&#]+)/i.exec(url);
  if (!match) return null;
  return decodeURIComponent(match[1]!).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function classifyPage(html: string, url: string): ManifestEntry["status"] {
  if (/just a moment|challenge-platform|cf_chl/i.test(html)) return "challenge";
  if (/queue-it|queue_it|softblock/i.test(html) || /queue-it\.net/i.test(url)) return "queue";
  return "ok";
}

const jitter = (min: number, max: number) => new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rawDir = join(root, "data", args.year, "raw");
  for (const sub of ["listing", "pages", "images-src"]) mkdirSync(join(rawDir, sub), { recursive: true });

  const { chromium } = await import("playwright");
  const context = await chromium.launchPersistentContext(join(root, ".pw-profile"), {
    headless: false,
    viewport: { width: 1280, height: 900 },
  });
  const page = context.pages()[0] ?? (await context.newPage());

  if (args.command === "discover") {
    const entryPoints = [...DEFAULT_ENTRY_POINTS, ...args.urls];
    const found = new Map<string, { url: string; text: string }>();
    let listingIndex = 0;
    for (const entry of entryPoints) {
      console.log(`→ ${entry}`);
      await page.goto(entry, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
      const html = await page.content();
      const status = classifyPage(html, page.url());
      if (status !== "ok") {
        console.log(`  ${status} page — solve it in the browser window, then press Enter here to retry…`);
        await new Promise<void>((resolve) => process.stdin.once("data", () => resolve()));
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
      }
      writeFileSync(join(rawDir, "listing", `listing-${listingIndex++}.html`), await page.content());
      const links = await page.$$eval("a[href*='loadArticle']", (anchors) =>
        anchors.map((a) => ({ url: (a as HTMLAnchorElement).href, text: a.textContent?.trim() ?? "" })),
      );
      for (const link of links) {
        const slug = slugFromUrl(link.url);
        if (slug && !found.has(slug)) found.set(slug, { url: link.url, text: link.text });
      }
      console.log(`  saved listing, ${links.length} article links (${found.size} unique so far)`);
      await jitter(1500, 3000);
    }
    const urls = [...found.entries()].map(([slug, { url, text }]) => ({ slug, url, text }));
    writeFileSync(join(rawDir, "film-urls.json"), JSON.stringify(urls, null, 2));
    console.log(`\nWrote ${urls.length} candidate film URLs to data/${args.year}/raw/film-urls.json`);
    console.log("NOTE: listing pages may include non-film articles (news, info pages) — the parser filters those.");
  }

  if (args.command === "fetch") {
    const urlsPath = join(rawDir, "film-urls.json");
    if (!existsSync(urlsPath)) {
      console.error(`No ${urlsPath} — run discover first.`);
      process.exit(1);
    }
    const manifestPath = join(rawDir, "fetch-manifest.json");
    const manifest: Record<string, ManifestEntry> = existsSync(manifestPath)
      ? JSON.parse(readFileSync(manifestPath, "utf-8"))
      : {};
    const saveManifest = () => writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    let targets: { slug: string; url: string }[] = JSON.parse(readFileSync(urlsPath, "utf-8"));
    if (args.slugs.length > 0) targets = targets.filter((t) => args.slugs.includes(t.slug));
    let fetched = 0;
    for (const target of targets) {
      if (fetched >= args.limit) break;
      const pagePath = join(rawDir, "pages", `${target.slug}.html`);
      if (!args.force && existsSync(pagePath) && manifest[target.slug]?.status === "ok") continue;
      console.log(`→ [${fetched + 1}] ${target.slug}`);
      try {
        await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
        await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
        let html = await page.content();
        let status = classifyPage(html, page.url());
        if (status === "challenge") {
          console.log("  Cloudflare challenge — solve it in the window, then press Enter here…");
          await new Promise<void>((resolve) => process.stdin.once("data", () => resolve()));
          await page.reload({ waitUntil: "domcontentloaded" });
          await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
          html = await page.content();
          status = classifyPage(html, page.url());
        }
        let imageUrl: string | null = null;
        let imageFile: string | null = null;
        if (status === "ok") {
          writeFileSync(pagePath, html);
          // The film's own page image only — provenance by construction.
          imageUrl = await page
            .$eval("meta[property='og:image']", (el) => (el as HTMLMetaElement).content)
            .catch(() => null);
          if (!imageUrl) {
            imageUrl = await page
              .$eval("main img, .article img, img", (el) => (el as HTMLImageElement).src)
              .catch(() => null);
          }
          if (imageUrl) {
            try {
              const response = await context.request.get(imageUrl);
              if (response.ok()) {
                const ext = (/\.(jpe?g|png|webp|avif)(\?|$)/i.exec(imageUrl)?.[1] ?? "jpg").toLowerCase();
                imageFile = `${target.slug}.${ext}`;
                writeFileSync(join(rawDir, "images-src", imageFile), await response.body());
              }
            } catch (err) {
              console.warn(`  image download failed: ${err}`);
            }
          }
        } else {
          console.warn(`  ${status} page — recorded, not saved as a film page`);
        }
        manifest[target.slug] = {
          slug: target.slug,
          url: target.url,
          status,
          fetchedAt: new Date().toISOString(),
          bytes: status === "ok" ? html.length : 0,
          imageUrl,
          imageFile,
        };
      } catch (err) {
        manifest[target.slug] = {
          slug: target.slug,
          url: target.url,
          status: "error",
          fetchedAt: new Date().toISOString(),
          bytes: 0,
          imageUrl: null,
          imageFile: null,
          note: String(err),
        };
        console.warn(`  error: ${err}`);
      }
      saveManifest();
      fetched += 1;
      await jitter(2500, 4500);
    }
    const ok = Object.values(manifest).filter((m) => m.status === "ok").length;
    const bad = Object.values(manifest).filter((m) => m.status !== "ok");
    console.log(`\nDone. ${ok} pages saved, ${bad.length} problems.`);
    for (const b of bad) console.log(`  ${b.status}: ${b.slug}${b.note ? ` (${b.note})` : ""}`);
  }

  await context.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
