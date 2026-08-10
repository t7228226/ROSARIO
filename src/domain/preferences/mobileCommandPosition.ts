export interface MobileCommandPosition {
  x: number;
  y: number;
}

export interface MobileCommandViewport {
  width: number;
  height: number;
}

export const MOBILE_COMMAND_POSITION_STORAGE_KEY = "rosario-mobile-command-position";
export const MOBILE_COMMAND_SIZE = 58;
export const MOBILE_COMMAND_MARGIN = 12;

export function clampMobileCommandPosition(
  position: MobileCommandPosition,
  viewport: MobileCommandViewport,
): MobileCommandPosition {
  const maxX = Math.max(MOBILE_COMMAND_MARGIN, viewport.width - MOBILE_COMMAND_SIZE - MOBILE_COMMAND_MARGIN);
  const maxY = Math.max(MOBILE_COMMAND_MARGIN, viewport.height - MOBILE_COMMAND_SIZE - MOBILE_COMMAND_MARGIN);
  return {
    x: Math.min(maxX, Math.max(MOBILE_COMMAND_MARGIN, Math.round(position.x))),
    y: Math.min(maxY, Math.max(MOBILE_COMMAND_MARGIN, Math.round(position.y))),
  };
}

export function getDefaultMobileCommandPosition(viewport: MobileCommandViewport): MobileCommandPosition {
  return clampMobileCommandPosition({
    x: viewport.width - MOBILE_COMMAND_SIZE - MOBILE_COMMAND_MARGIN,
    y: viewport.height * 0.58 - MOBILE_COMMAND_SIZE / 2,
  }, viewport);
}

export function readStoredMobileCommandPosition(
  storage: Pick<Storage, "getItem"> | undefined,
  viewport: MobileCommandViewport,
): MobileCommandPosition {
  if (!storage) return getDefaultMobileCommandPosition(viewport);
  try {
    const parsed = JSON.parse(storage.getItem(MOBILE_COMMAND_POSITION_STORAGE_KEY) || "null") as Partial<MobileCommandPosition> | null;
    if (!parsed || typeof parsed.x !== "number" || typeof parsed.y !== "number" || !Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) {
      return getDefaultMobileCommandPosition(viewport);
    }
    return clampMobileCommandPosition({ x: parsed.x, y: parsed.y }, viewport);
  } catch {
    return getDefaultMobileCommandPosition(viewport);
  }
}

export function storeMobileCommandPosition(
  position: MobileCommandPosition,
  storage?: Pick<Storage, "setItem">,
) {
  if (!storage) return;
  try {
    storage.setItem(MOBILE_COMMAND_POSITION_STORAGE_KEY, JSON.stringify(position));
  } catch {
    // The button remains movable for this page even if storage is unavailable.
  }
}
