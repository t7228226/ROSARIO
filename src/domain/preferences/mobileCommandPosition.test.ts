import assert from "node:assert/strict";
import test from "node:test";
import {
  clampMobileCommandPosition,
  getDefaultMobileCommandPosition,
  MOBILE_COMMAND_POSITION_STORAGE_KEY,
  readStoredMobileCommandPosition,
  storeMobileCommandPosition,
} from "./mobileCommandPosition";

test("clamps the movable command button inside the viewport", () => {
  assert.deepEqual(clampMobileCommandPosition({ x: -20, y: 999 }, { width: 390, height: 844 }), { x: 12, y: 774 });
  assert.deepEqual(clampMobileCommandPosition({ x: 220, y: 360 }, { width: 390, height: 844 }), { x: 220, y: 360 });
});

test("uses a stable default and restores a stored position", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  assert.deepEqual(getDefaultMobileCommandPosition({ width: 390, height: 844 }), { x: 320, y: 461 });
  assert.deepEqual(getDefaultMobileCommandPosition({ width: 375, height: 844 }), { x: 305, y: 461 });
  storeMobileCommandPosition({ x: 48, y: 180 }, storage);
  assert.equal(values.get(MOBILE_COMMAND_POSITION_STORAGE_KEY), '{"x":48,"y":180}');
  assert.deepEqual(readStoredMobileCommandPosition(storage, { width: 390, height: 844 }), { x: 48, y: 180 });
});

test("falls back safely when stored position data is invalid", () => {
  const storage = { getItem: () => "not-json" };
  assert.deepEqual(
    readStoredMobileCommandPosition(storage, { width: 390, height: 844 }),
    getDefaultMobileCommandPosition({ width: 390, height: 844 }),
  );
});
