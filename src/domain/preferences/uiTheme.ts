export type UiThemeKey = "precision" | "graphite" | "jade" | "paper" | "contrast";

export interface UiThemeOption {
  key: UiThemeKey;
  label: string;
  description: string;
}

export const UI_THEME_STORAGE_KEY = "rosario-ui-theme";
export const DEFAULT_UI_THEME: UiThemeKey = "precision";

export const UI_THEME_OPTIONS: UiThemeOption[] = [
  { key: "precision", label: "精準藍", description: "明亮清晰，適合日常作業" },
  { key: "graphite", label: "石墨夜", description: "降低夜間環境亮度" },
  { key: "jade", label: "青瓷綠", description: "柔和沉穩，減少視覺疲勞" },
  { key: "paper", label: "暖紙金", description: "溫暖中性，適合長時間閱讀" },
  { key: "contrast", label: "高對比", description: "強化邊界與文字辨識" },
];

export function normalizeUiTheme(value: unknown): UiThemeKey {
  const key = String(value || "").trim();
  return UI_THEME_OPTIONS.some((option) => option.key === key)
    ? key as UiThemeKey
    : DEFAULT_UI_THEME;
}

export function readStoredUiTheme(storage?: Pick<Storage, "getItem">): UiThemeKey {
  if (!storage) return DEFAULT_UI_THEME;
  try {
    return normalizeUiTheme(storage.getItem(UI_THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_UI_THEME;
  }
}

export function storeUiTheme(theme: UiThemeKey, storage?: Pick<Storage, "setItem">) {
  if (!storage) return;
  try {
    storage.setItem(UI_THEME_STORAGE_KEY, theme);
  } catch {
    // Theme selection remains active for this page even if storage is unavailable.
  }
}
