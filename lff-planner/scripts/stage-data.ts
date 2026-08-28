/**
 * Stage a dataset into the app's public directory:
 *   npm run stage-data -- sample | 2025 | 2026
 *
 * Copies data/<year>/films.json (+ images/ when present) into
 * app/public/data/, validating the dataset against the schema first, and
 * generates placeholder images for sample films that declare image paths.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FilmsFileSchema } from "../shared/schemas.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const year = process.argv[2] ?? "sample";
const srcDir = join(root, "data", year);
const outDir = join(root, "app", "public", "data");

const filmsPath = join(srcDir, "films.json");
if (!existsSync(filmsPath)) {
  console.error(`No dataset at ${filmsPath}`);
  process.exit(1);
}

const parsed = FilmsFileSchema.safeParse(JSON.parse(readFileSync(filmsPath, "utf-8")));
if (!parsed.success) {
  console.error(`data/${year}/films.json failed schema validation:`);
  console.error(parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n"));
  process.exit(1);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "films.json"), JSON.stringify(parsed.data));

const imagesDir = join(srcDir, "images");
if (existsSync(imagesDir)) {
  cpSync(imagesDir, join(outDir, "images"), { recursive: true });
} else if (year === "sample") {
  // Generate flat-colour placeholder JPEGs for sample films that declare images.
  const { default: sharp } = await import("sharp");
  const palette = [0x4a6fa5, 0x9a5b8f, 0xc4763a, 0x3f8f6b, 0x8f4040, 0x54658d];
  let i = 0;
  for (const film of parsed.data.films) {
    if (!film.image) continue;
    const colour = palette[i++ % palette.length]!;
    const rgb = { r: (colour >> 16) & 0xff, g: (colour >> 8) & 0xff, b: colour & 0xff };
    for (const [variant, width, height] of [
      ["thumb", 160, 100],
      ["detail", 640, 400],
    ] as const) {
      const rel = film.image[variant];
      const target = join(outDir, rel);
      mkdirSync(dirname(target), { recursive: true });
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
        <rect width="100%" height="100%" fill="rgb(${rgb.r},${rgb.g},${rgb.b})"/>
        <text x="50%" y="52%" font-family="sans-serif" font-size="${width / 14}" fill="#ffffffcc"
          text-anchor="middle">${film.title.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>
      </svg>`;
      await sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toFile(target);
    }
  }
}

// The app needs the venue config for display names and (later) travel maths.
cpSync(join(root, "pipeline", "venues.json"), join(outDir, "venues.json"));
cpSync(join(root, "data", "constraints.json"), join(outDir, "constraints.json"));

writeFileSync(join(outDir, "meta.json"), JSON.stringify({ dataset: year, stagedAt: new Date().toISOString() }));
console.log(`Staged data/${year} → app/public/data (${parsed.data.films.length} films)`);
