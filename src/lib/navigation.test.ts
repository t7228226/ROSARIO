import { test } from "node:test";
import assert from "node:assert/strict";
import { pageFromUrl, pageUrl } from "./navigation";
test("deep links preserve deployment base and reject unknown pages", () => {
  const url = pageUrl("https://example.test/ROSARIO/?review=1", "gap-analysis");
  assert.equal(new URL(url).pathname, "/ROSARIO/");
  assert.equal(pageFromUrl(url), "gap-analysis");
  assert.equal(pageFromUrl("https://example.test/?page=unknown"), "home");
});
