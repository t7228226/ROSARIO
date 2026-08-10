import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_UI_THEME,
  normalizeUiTheme,
  readStoredUiTheme,
  storeUiTheme,
  UI_THEME_STORAGE_KEY,
} from "./uiTheme";

test("normalizes unknown theme values to the default", () => {
  assert.equal(normalizeUiTheme("graphite"), "graphite");
  assert.equal(normalizeUiTheme("unknown"), DEFAULT_UI_THEME);
  assert.equal(normalizeUiTheme(null), DEFAULT_UI_THEME);
});

test("reads and stores a valid theme without depending on window", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  storeUiTheme("jade", storage);
  assert.equal(values.get(UI_THEME_STORAGE_KEY), "jade");
  assert.equal(readStoredUiTheme(storage), "jade");
});
