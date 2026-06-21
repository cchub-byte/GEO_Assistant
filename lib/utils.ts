import crypto from "node:crypto";

export function json(data: unknown) {
  return JSON.stringify(data, null, 2);
}

export function hashText(text: string) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export function domainFromUrl(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

export function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

export function percentage(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function splitCsv(value?: string | null) {
  return (value || "")
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function primaryBrandName(brand?: { brandNames?: string | null; productNames?: string | null; aliases?: string | null } | null) {
  return splitCsv(brand?.brandNames)[0] || splitCsv(brand?.productNames)[0] || splitCsv(brand?.aliases)[0] || "未设置品牌";
}

export function brandTerms(brand?: { brandNames?: string | null; productNames?: string | null; aliases?: string | null } | null) {
  return [...splitCsv(brand?.brandNames), ...splitCsv(brand?.productNames), ...splitCsv(brand?.aliases)];
}

export function containsAny(text: string, terms: string[]) {
  const lower = text.toLowerCase();
  return terms.some((term) => term && lower.includes(term.toLowerCase()));
}

export function nowWindow(days = 30) {
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd);
  windowStart.setDate(windowStart.getDate() - days);
  return { windowStart, windowEnd };
}
