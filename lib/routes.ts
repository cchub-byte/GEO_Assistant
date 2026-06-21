export function safeRedirectPath(value: FormDataEntryValue | null, fallback = "/sampling") {
  const path = typeof value === "string" ? value.trim() : "";
  if (!path || !path.startsWith("/") || path.startsWith("//")) return fallback;
  return path;
}
