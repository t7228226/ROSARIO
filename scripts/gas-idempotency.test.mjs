import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./helpers/gasFixture.mjs";

function createGasContext() {
  return fixture().context;
}

test("same operationId executes a successful write only once", () => {
  const context = createGasContext();
  let writes = 0;
  const operationId = "OP_createPerson_12345678";
  const first = context.executeReliableWrite_("createPerson", operationId, () => {
    writes += 1;
    return { ok: true, person: { id: "TEST001" } };
  });
  const replay = context.executeReliableWrite_("createPerson", operationId, () => {
    writes += 1;
    return { ok: true };
  });
  const status = context.getOperationStatus_(operationId);

  assert.equal(writes, 1);
  assert.equal(first.operationStatus, "success");
  assert.equal(replay.replayed, true);
  assert.equal(replay.person.id, "TEST001");
  assert.equal(status.status, "success");
  assert.equal(status.result.person.id, "TEST001");
});

test("failed operation is recorded and is not executed again", () => {
  const context = createGasContext();
  let writes = 0;
  const operationId = "OP_updatePerson_12345678";
  assert.throws(() => context.executeReliableWrite_("updatePerson", operationId, () => {
    writes += 1;
    throw new Error("validation failed");
  }), /validation failed/);

  const replay = context.executeReliableWrite_("updatePerson", operationId, () => {
    writes += 1;
    return { ok: true };
  });

  assert.equal(writes, 1);
  assert.equal(replay.ok, false);
  assert.equal(replay.replayed, true);
  assert.match(replay.message, /validation failed/);
});

test("short version names correctly replace the previous v2 names", () => {
  const context = createGasContext();
  assert.ok(context.compareVersion_("2026-08-02-v2-002", "2026-08-02-003") < 0);
  assert.equal(context.compareVersion_("2026-08-02-003", "2026-08-02-003"), 0);
  assert.ok(context.compareVersion_("2026-08-02-004", "2026-08-02-003") > 0);
});
