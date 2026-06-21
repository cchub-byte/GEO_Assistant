export const QUERY_INTENT_OPTIONS = ["场景模糊", "场景明确", "意图明确"] as const;

export const DEFAULT_QUERY_INTENT_TYPE = "意图明确";

export function normalizeQueryIntentType(value: unknown, fallbackIndex?: number) {
  const normalized = String(value || "").trim();
  if (QUERY_INTENT_OPTIONS.includes(normalized as (typeof QUERY_INTENT_OPTIONS)[number])) {
    return normalized;
  }
  return typeof fallbackIndex === "number" ? fallbackQueryIntentType(fallbackIndex) : DEFAULT_QUERY_INTENT_TYPE;
}

export function fallbackQueryIntentType(index: number) {
  if (index < 3) return "场景模糊";
  if (index < 6) return "场景明确";
  return DEFAULT_QUERY_INTENT_TYPE;
}
