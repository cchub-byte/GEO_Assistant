const imageExtensionPattern = /\.(?:png|jpe?g|webp|gif|svg|ico|bmp|avif|heic|heif|tiff?)(?:$|[?#])/i;
const mediaContentTypePattern = /^(?:image|audio|video)\//i;
const redirectParamNames = ["target", "url", "u"];

export type ReferenceUrlResolution = {
  url: string;
  decodedFromProxy?: string;
  rejectedReason?: string;
};

export function normalizeReferenceSourceUrl(value: string) {
  const resolution = resolveReferenceUrl(value);
  if (!resolution.rejectedReason) return resolution.url;
  return resolution.decodedFromProxy ? resolution.url : "";
}

export function resolveReferenceFetchUrl(value: string): ReferenceUrlResolution {
  return resolveReferenceUrl(value);
}

export function describeNonHtmlReferenceTarget(url: string, contentType: string) {
  if (isKnownSearchImageProxyUrl(url)) {
    const decodedTarget = decodeKnownSearchImageProxyTarget(url);
    if (decodedTarget) {
      return `该 URL 是搜索结果图片代理，解码后目标是图片资源（${decodedTarget}），不是正文 HTML 页面。`;
    }
    return "该 URL 是搜索结果图片代理，不是正文 HTML 页面。";
  }

  if (mediaContentTypePattern.test(contentType.trim().toLowerCase())) {
    return `目标返回的是图片或媒体资源（${contentType}），不是 HTML 正文页面。`;
  }

  return `目标返回的不是 HTML 页面：${contentType}`;
}

export function isLikelyMediaUrl(value: string) {
  try {
    const parsed = new URL(value.trim());
    return imageExtensionPattern.test(parsed.pathname);
  } catch {
    return imageExtensionPattern.test(String(value || ""));
  }
}

function resolveReferenceUrl(value: string): ReferenceUrlResolution {
  const normalizedUrl = unwrapRedirectUrl(value);
  if (!normalizedUrl) return { url: "" };

  if (isKnownSearchImageProxyUrl(normalizedUrl)) {
    const decodedTarget = decodeKnownSearchImageProxyTarget(normalizedUrl);
    if (decodedTarget && /^https?:\/\//i.test(decodedTarget)) {
      const targetUrl = unwrapRedirectUrl(decodedTarget);
      if (isLikelyMediaUrl(targetUrl)) {
        return {
          url: targetUrl,
          decodedFromProxy: normalizedUrl,
          rejectedReason: `该 URL 是搜索结果图片代理，解码后目标是图片资源（${targetUrl}），不是正文 HTML 页面。`
        };
      }
      return { url: targetUrl, decodedFromProxy: normalizedUrl };
    }
    return {
      url: normalizedUrl,
      rejectedReason: "该 URL 是搜索结果图片代理，不是正文 HTML 页面。"
    };
  }

  if (isLikelyMediaUrl(normalizedUrl)) {
    return {
      url: normalizedUrl,
      rejectedReason: `该 URL 指向图片资源（${normalizedUrl}），不是正文 HTML 页面。`
    };
  }

  return { url: normalizedUrl };
}

function unwrapRedirectUrl(value: string) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";

  try {
    const parsed = new URL(trimmed);
    const redirected = redirectParamNames
      .map((name) => parsed.searchParams.get(name))
      .find((candidate): candidate is string => Boolean(candidate && /^https?:\/\//i.test(candidate)));
    if (redirected) return decodeUrlComponentSafely(redirected);
    return decodeUriSafely(parsed.toString());
  } catch {
    return trimmed;
  }
}

function isKnownSearchImageProxyUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.hostname.replace(/^www\./, "").toLowerCase() === "s2.zimgs.cn" && parsed.pathname === "/ims";
  } catch {
    return false;
  }
}

function decodeKnownSearchImageProxyTarget(value: string) {
  try {
    const parsed = new URL(value);
    if (!isKnownSearchImageProxyUrl(parsed.toString())) return "";
    const key = parsed.searchParams.get("key");
    if (!key) return "";
    const decoded = decodeBase64Url(key);
    return /^https?:\/\//i.test(decoded) ? decoded : "";
  } catch {
    return "";
  }
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64").toString("utf8").trim();
}

function decodeUrlComponentSafely(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function decodeUriSafely(value: string) {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}
