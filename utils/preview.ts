export const PREVIEW_CHAR_LIMIT = 200;

export function normalizePreviewText(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function createPreviewText(value: unknown, centerOffset?: number): string {
  const normalized = normalizePreviewText(value);
  if (normalized.length <= PREVIEW_CHAR_LIMIT) return normalized;

  const contentLimit = PREVIEW_CHAR_LIMIT - 3;
  const requestedOffset = typeof centerOffset === "number"
    ? Math.max(0, Math.min(normalized.length, centerOffset))
    : 0;
  const centeredStart = requestedOffset - Math.floor(contentLimit * 0.35);
  const start = Math.max(0, Math.min(centeredStart, normalized.length - contentLimit));
  return `${normalized.slice(start, start + contentLimit).trimEnd()}...`;
}
