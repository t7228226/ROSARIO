import type { PageKey } from "../types";

const pages = new Set<PageKey>(["home", "person-query", "station-query", "qualification-review", "gap-analysis", "manual-schedule", "station-rules", "people-management", "permission-admin"]);
export function pageFromUrl(url: string): PageKey {
  const page = new URL(url).searchParams.get("page") as PageKey;
  return pages.has(page) ? page : "home";
}
export function pageUrl(url: string, page: PageKey) {
  const next = new URL(url);
  next.searchParams.set("page", page);
  return next.toString();
}
