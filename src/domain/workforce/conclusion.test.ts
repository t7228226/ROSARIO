import assert from "node:assert/strict";
import test from "node:test";
import { coverageConclusion } from "./conclusion";
test("missing or loading demand never looks fully covered", () => {
  assert.equal(coverageConclusion(0, 0).state, "unconfigured");
  assert.equal(coverageConclusion(4, 0, true).state, "loading");
  assert.equal(coverageConclusion(Number.NaN, 0).state, "unconfigured");
});
test("coverage conclusions distinguish real shortage and invalid results", () => {
  assert.equal(coverageConclusion(4, 0).state, "covered");
  assert.equal(coverageConclusion(4, 1).state, "shortage");
  assert.equal(coverageConclusion(4, Number.NaN).state, "invalid");
  assert.equal(coverageConclusion(4, 5).state, "invalid");
});
