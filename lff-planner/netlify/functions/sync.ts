/**
 * Cross-device selections sync, backed by Netlify Blobs.
 *
 *   GET  /api/sync?year=2025   → { doc: SelectionsFile | null }
 *   POST /api/sync             → merges the posted doc with the stored one
 *                                (per-film last-write-wins) and returns
 *                                { doc: <merged> }
 *
 * Access control: the site-wide basic-auth edge function runs in front of
 * every path including this one, so requests arriving here have already
 * authenticated. Browsers attach the credentials automatically, which means
 * a device that can open the app can sync — no extra token to manage.
 */
import { getStore } from "@netlify/blobs";
import { SelectionsFileSchema, type SelectionsFile } from "../../shared/schemas.ts";
import { mergeSelections } from "../../shared/selections.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export default async (request: Request): Promise<Response> => {
  const store = getStore({ name: "selections", consistency: "strong" });
  const url = new URL(request.url);

  if (request.method === "GET") {
    const year = url.searchParams.get("year");
    if (!year || !/^\d{4}$/.test(year)) return json({ error: "year required" }, 400);
    const doc = (await store.get(`selections-${year}`, { type: "json" })) as SelectionsFile | null;
    return json({ doc });
  }

  if (request.method === "POST") {
    let incoming: SelectionsFile;
    try {
      incoming = SelectionsFileSchema.parse(await request.json());
    } catch {
      return json({ error: "body is not a valid selections document" }, 400);
    }
    const key = `selections-${incoming.festivalYear}`;
    const stored = (await store.get(key, { type: "json" })) as SelectionsFile | null;
    const merged = stored ? mergeSelections(stored, incoming) : incoming;
    await store.setJSON(key, merged);
    return json({ doc: merged });
  }

  if (request.method === "DELETE") {
    const year = url.searchParams.get("year");
    if (!year || !/^\d{4}$/.test(year)) return json({ error: "year required" }, 400);
    await store.delete(`selections-${year}`);
    return json({ ok: true });
  }

  return json({ error: "method not allowed" }, 405);
};

export const config = { path: "/api/sync" };
