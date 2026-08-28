import { signal } from "@preact/signals";

export type Route = { view: "browse" } | { view: "film"; id: string } | { view: "schedule" };

function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/");
  if (parts[0] === "film" && parts[1]) return { view: "film", id: decodeURIComponent(parts.slice(1).join("/")) };
  if (parts[0] === "schedule") return { view: "schedule" };
  return { view: "browse" };
}

export const route = signal<Route>(parse(location.hash));

window.addEventListener("hashchange", () => {
  route.value = parse(location.hash);
});

export function navigate(to: Route): void {
  const hash = to.view === "film" ? `#/film/${encodeURIComponent(to.id)}` : `#/${to.view}`;
  if (location.hash === hash) route.value = parse(hash);
  else location.hash = hash;
}
