const fallbackGasEndpoint =
  "https://script.google.com/macros/s/AKfycby5fl0fRqY7gPjLSaVlyEGBkAYUMd0CgF8-WwWkwpALYJhTESryOE-Jdbh2SbarF1OD8A/exec";

const explicitEnvironment = String(import.meta.env.VITE_APP_ENV || "")
  .trim()
  .toLowerCase();
const isPreview = explicitEnvironment
  ? explicitEnvironment !== "production"
  : import.meta.env.DEV;

export const appEnvironment = {
  name: isPreview ? "preview" : "production",
  isPreview,
  writesEnabled:
    !isPreview || String(import.meta.env.VITE_ENABLE_WRITES || "").toLowerCase() === "true",
  gasEndpoint: String(import.meta.env.VITE_GAS_API_URL || fallbackGasEndpoint).trim(),
  version: String(
    import.meta.env.VITE_APP_VERSION ||
      (isPreview ? "2026-08-02-v2-preview.4" : "2026-07-01-004")
  ).trim(),
} as const;
