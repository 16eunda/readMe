export const PREVIEW_CHAR_LIMIT = 200;

export function normalizePreviewText(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function createPreviewText(
  value: unknown,
  centerOffset?: number,
  centerRatio = 0.35,
): string {
  const normalized = normalizePreviewText(value);
  if (normalized.length <= PREVIEW_CHAR_LIMIT) return normalized;

  const contentLimit = PREVIEW_CHAR_LIMIT - 3;
  const requestedOffset = typeof centerOffset === "number"
    ? Math.max(0, Math.min(normalized.length, centerOffset))
    : 0;
  const normalizedCenterRatio = Math.min(0.8, Math.max(0.2, centerRatio));
  const centeredStart = requestedOffset - Math.floor(contentLimit * normalizedCenterRatio);
  const start = Math.max(0, Math.min(centeredStart, normalized.length - contentLimit));
  return `${normalized.slice(start, start + contentLimit).trimEnd()}...`;
}

export function createPreviewAroundOffset(value: unknown, centerOffset: number): string {
  const raw = String(value || "");
  if (!raw) return "";

  const center = Math.min(raw.length, Math.max(0, Math.floor(centerOffset)));
  const contextRadius = PREVIEW_CHAR_LIMIT * 4;
  const beforeRaw = raw.slice(Math.max(0, center - contextRadius), center);
  const afterRaw = raw.slice(center, Math.min(raw.length, center + contextRadius));
  const before = normalizePreviewText(beforeRaw);
  const after = normalizePreviewText(afterRaw);
  const boundaryHasWhitespace = /\s/.test(raw.slice(Math.max(0, center - 1), center + 1));
  const separator = before && after && boundaryHasWhitespace ? " " : "";
  const context = `${before}${separator}${after}`;

  return createPreviewText(context, before.length + separator.length, 0.5);
}
