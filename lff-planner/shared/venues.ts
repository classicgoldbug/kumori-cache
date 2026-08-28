/**
 * Venue resolution and travel-time lookup over a VenuesFile.
 * Pure functions shared by the parser, the app, and the scheduler.
 */
import type { VenuesFile } from "./schemas.ts";

export interface ResolvedVenue {
  venue: string;
  screen: string | null;
  /** False when the raw name matched no alias and a slug pass-through was used. */
  known: boolean;
}

function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalise(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Resolve a raw venue string ("Southbank Centre, Royal Festival Hall",
 * "BFI Southbank NFT1") to a canonical venue id plus optional screen.
 * Matching: exact alias first, then longest alias prefix with the remainder
 * captured as the screen name. Unknown venues fall through to a slug so the
 * app keeps working while an alias gets added.
 */
export function resolveVenue(venuesFile: VenuesFile, raw: string): ResolvedVenue {
  const norm = normalise(raw);
  let best: { id: string; aliasLen: number; screen: string | null } | null = null;
  for (const venue of venuesFile.venues) {
    for (const alias of venue.aliases) {
      const aliasNorm = normalise(alias);
      if (norm === aliasNorm) {
        return { venue: venue.id, screen: null, known: true };
      }
      if (norm.startsWith(aliasNorm)) {
        const rest = raw.trim().replace(/\s+/g, " ").slice(aliasNorm.length).replace(/^[\s,:–-]+/, "");
        if (!best || aliasNorm.length > best.aliasLen) {
          best = { id: venue.id, aliasLen: aliasNorm.length, screen: rest || null };
        }
      }
    }
  }
  if (best) return { venue: best.id, screen: best.screen, known: true };
  return { venue: slugify(raw), screen: null, known: false };
}

/**
 * Travel minutes between two canonical venue ids (buffer NOT included).
 * Most specific rule wins: same venue → pair override → zone pair →
 * intra-zone → default. Returns `known: false` when either venue is not in
 * the file (so callers can surface a warning).
 */
export function travelMinutes(venuesFile: VenuesFile, a: string, b: string): { minutes: number; known: boolean } {
  if (a === b) return { minutes: 0, known: true };
  for (const p of venuesFile.pairOverrides) {
    if ((p.a === a && p.b === b) || (p.a === b && p.b === a)) return { minutes: p.minutes, known: true };
  }
  const va = venuesFile.venues.find((v) => v.id === a);
  const vb = venuesFile.venues.find((v) => v.id === b);
  if (!va || !vb) return { minutes: venuesFile.defaultTravelMinutes, known: false };
  if (va.zone === vb.zone) {
    const zone = venuesFile.zones[va.zone];
    return { minutes: zone ? zone.intraMinutes : venuesFile.defaultTravelMinutes, known: !!zone };
  }
  for (const zt of venuesFile.zoneTravel) {
    if ((zt.a === va.zone && zt.b === vb.zone) || (zt.a === vb.zone && zt.b === va.zone)) {
      return { minutes: zt.minutes, known: true };
    }
  }
  return { minutes: venuesFile.defaultTravelMinutes, known: false };
}

export function venueName(venuesFile: VenuesFile, id: string): string {
  const v = venuesFile.venues.find((venue) => venue.id === id);
  if (v) return v.name;
  // Slug pass-through: display something readable rather than the slug.
  return id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
