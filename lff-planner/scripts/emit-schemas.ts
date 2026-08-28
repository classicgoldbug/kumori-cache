/** Emit JSON Schemas from the zod contracts into schema/ (documentation only). */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  ConstraintsFileSchema,
  FilmsFileSchema,
  ScheduleFileSchema,
  SelectionsFileSchema,
  VenuesFileSchema,
} from "../shared/schemas.ts";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "schema");
mkdirSync(outDir, { recursive: true });

const contracts = {
  "films.schema.json": FilmsFileSchema,
  "selections.schema.json": SelectionsFileSchema,
  "venues.schema.json": VenuesFileSchema,
  "constraints.schema.json": ConstraintsFileSchema,
  "schedule.schema.json": ScheduleFileSchema,
} as const;

for (const [name, schema] of Object.entries(contracts)) {
  writeFileSync(join(outDir, name), JSON.stringify(z.toJSONSchema(schema, { io: "output" }), null, 2) + "\n");
  console.log(`schema/${name}`);
}
