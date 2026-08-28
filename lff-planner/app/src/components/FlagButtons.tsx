import type { Flags } from "@shared/schemas.ts";
import { getSelection, toggleFlag } from "../state/selections.ts";

const FLAGS: { key: keyof Flags; letter: string; label: string }[] = [
  { key: "tristan", letter: "T", label: "Tristan" },
  { key: "amy", letter: "A", label: "Amy" },
  { key: "priority", letter: "P", label: "Priority" },
  { key: "maybe", letter: "M", label: "Maybe" },
];

export function FlagButtons({ filmId, size = "normal" }: { filmId: string; size?: "normal" | "large" }) {
  const sel = getSelection(filmId);
  return (
    <div class={`flag-buttons ${size}`} role="group" aria-label="Selection flags">
      {FLAGS.map(({ key, letter, label }) => {
        const on = sel?.[key] ?? false;
        return (
          <button
            type="button"
            class={`flag flag-${key} ${on ? "on" : "off"}`}
            title={`${label}${on ? " ✓" : ""}`}
            aria-pressed={on}
            onClick={(e) => {
              e.stopPropagation();
              toggleFlag(filmId, key);
            }}
          >
            {size === "large" ? label : letter}
          </button>
        );
      })}
    </div>
  );
}
