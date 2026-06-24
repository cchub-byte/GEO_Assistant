import { lookup } from "node:dns/promises";
import net from "node:net";
import * as cheerio from "cheerio";
import type { AnyNode, Cheerio, CheerioAPI } from "cheerio";
import { describeNonHtmlReferenceTarget, resolveReferenceFetchUrl } from "@/lib/services/reference-url";

const appUserAgent =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const maxRedirects = 5;
const maxResponseBytes = 5 * 1024 * 1024;
const requestTimeoutMs = 15000;

export type ReferenceFetchDetail = {
  url: string;
  bodyText: string;
  title: string;
  author: string;
  publishedAt: string;
  content: string;
  fetchMode: "fetch";
  fallbackReason?: string;
};

export class ReferenceFetchError extends Error {
  retryable: boolean;

  constructor(message: string, options: { retryable?: boolean } = {}) {
    super(message);
    this.name = "ReferenceFetchError";
    this.retryable = options.retryable ?? true;
  }
}

export async function fetchReferenceDetail(url: string): Promise<ReferenceFetchDetail> {
  const urlResolution = resolveReferenceFetchUrl(url);
  if (urlResolution.rejectedReason) {
    throw new ReferenceFetchError(urlResolution.rejectedReason, { retryable: false });
  }
  const targetUrl = urlResolution.url;

  try {
    const { html, finalUrl } = await fetchHtml(targetUrl);
    const article = extractArticle(html, finalUrl);
    ensureArticleContent(article, "fetch");
    return { ...article, fetchMode: "fetch" };
  } catch (error) {
    if (error instanceof ReferenceFetchError && !error.retryable) throw error;
    throw new ReferenceFetchError(`fetch 未能提取正文：${errorMessage(error)}`, { retryable: false });
  }
}

function buildRequestHeaders() {
  return {
    "User-Agent": appUserAgent,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Cache-Control": "no-cache",
    Pragma: "no-cache"
  };
}

async function fetchHtml(inputUrl: string) {
  let currentUrl = await validatePublicHttpUrl(inputUrl);

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const response = await fetch(currentUrl, {
      headers: buildRequestHeaders(),
      redirect: "manual",
      signal: AbortSignal.timeout(requestTimeoutMs)
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("Location");
      if (!location) {
        throw new ReferenceFetchError("页面返回重定向，但缺少 Location。");
      }
      // 每一次重定向都重新校验目标 URL，防止公开地址跳转到内网或本机地址。
      currentUrl = await validatePublicHttpUrl(new URL(location, currentUrl).toString());
      continue;
    }

    const blockedMessage = describeBlockedResponse(response.status);
    if (blockedMessage) {
      throw new ReferenceFetchError(blockedMessage);
    }

    if (!response.ok) {
      throw new ReferenceFetchError(`fetch HTTP 请求失败：${response.status}`);
    }

    const contentType = response.headers.get("Content-Type") || "";
    if (contentType && !/html|xml/i.test(contentType)) {
      throw new ReferenceFetchError(describeNonHtmlReferenceTarget(currentUrl, contentType), { retryable: false });
    }

    const contentLength = Number(response.headers.get("Content-Length") || 0);
    if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) {
      throw new ReferenceFetchError("页面内容超过 5MB 限制。", { retryable: false });
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > maxResponseBytes) {
      throw new ReferenceFetchError("页面内容超过 5MB 限制。", { retryable: false });
    }
    const html = decodeHtml(bytes, contentType);

    const verificationMessage = detectVerificationPage(html, currentUrl);
    if (verificationMessage) {
      throw new ReferenceFetchError(verificationMessage);
    }

    return { html, finalUrl: currentUrl };
  }

  throw new ReferenceFetchError("重定向次数过多。");
}

function decodeHtml(bytes: Buffer, contentType: string) {
  const charset = extractDeclaredCharset(contentType, bytes);
  try {
    return new TextDecoder(normalizeCharset(charset)).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function extractDeclaredCharset(contentType: string, bytes: Buffer) {
  const headerMatch = contentType.match(/charset\s*=\s*["']?([a-z0-9._-]+)/i);
  if (headerMatch?.[1]) return headerMatch[1];

  const preview = bytes.subarray(0, 4096).toString("latin1");
  const metaMatch =
    preview.match(/<meta[^>]+charset\s*=\s*["']?\s*([a-z0-9._-]+)/i) ||
    preview.match(/<meta[^>]+content\s*=\s*["'][^"']*charset\s*=\s*([a-z0-9._-]+)/i);
  return metaMatch?.[1] || "utf-8";
}

function normalizeCharset(charset: string) {
  const normalized = charset.trim().toLowerCase().replace(/^["']|["']$/g, "");
  if (normalized === "utf8") return "utf-8";
  if (normalized === "gb2312" || normalized === "gbk" || normalized === "gb_2312-80" || normalized === "x-gbk") {
    return "gb18030";
  }
  return normalized || "utf-8";
}

async function validatePublicHttpUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch (error) {
    throw new ReferenceFetchError("URL 格式无效。", { retryable: false });
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ReferenceFetchError("仅支持 http 或 https 地址。", { retryable: false });
  }
  if (!parsed.hostname) {
    throw new ReferenceFetchError("URL 缺少有效主机名。", { retryable: false });
  }
  if (parsed.username || parsed.password) {
    throw new ReferenceFetchError("URL 不应包含用户名或密码。", { retryable: false });
  }

  // DNS 解析后的每个地址都要检查，避免域名解析到私网、保留地址或本机地址。
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(parsed.hostname, { all: true, verbatim: true });
  } catch (error) {
    throw new ReferenceFetchError("无法解析该 URL 的主机名。", { retryable: false });
  }

  for (const item of addresses) {
    if (isBlockedIp(item.address)) {
      throw new ReferenceFetchError("出于安全原因，不能抓取内网、保留地址或本机地址。", { retryable: false });
    }
  }

  return parsed.toString();
}

function isBlockedIp(address: string) {
  const version = net.isIP(address);
  if (version === 4) {
    const parts = address.split(".").map((part) => Number(part));
    const [a, b, c] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113)
    );
  }

  if (version === 6) {
    const lower = address.toLowerCase();
    if (lower.startsWith("::ffff:")) {
      return isBlockedIp(lower.slice(7));
    }
    return lower === "::" || lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80:");
  }

  return true;
}

function describeBlockedResponse(statusCode: number) {
  const messages: Record<number, string> = {
    401: "目标站点要求登录或授权，服务端请求无法直接获取该页面正文。",
    403: "目标站点拒绝了服务端请求。常见原因包括反爬策略、登录态要求、Cookie 校验或 JavaScript 风控校验。",
    429: "目标站点触发了频率限制，请降低请求频率后重试。"
  };
  return messages[statusCode] || null;
}

function detectVerificationPage(html: string, finalUrl: string) {
  const $ = cheerio.load(html);
  const parsed = new URL(finalUrl);
  const normalizedUrl = finalUrl.toLowerCase();
  const title = $("title").first().text().toLowerCase();
  const bodyText = $("body").text().toLowerCase();

  const urlSignals =
    normalizedUrl.includes("captcha") ||
    parsed.hostname.toLowerCase().includes("wappass.baidu.com") ||
    parsed.pathname.toLowerCase().includes("/captcha/");
  const pageSignals = [
    "captcha",
    "security verification",
    "human verification",
    "verify you are human",
    "checking your browser",
    "安全验证",
    "访问验证",
    "验证码",
    "人机验证",
    "百度安全验证",
    "just a moment",
    "attention required",
    "网络不给力",
    "请稍后重试"
  ];

  const titleSignals = pageSignals.some((signal) => title.includes(signal));
  const bodySignals = pageSignals.some((signal) => bodyText.includes(signal));
  const likelyVerificationBody = bodySignals && bodyText.length <= 2500;

  // 仅在正文较短且命中验证信号时判定为风控页，降低长文章误含“验证码”等词的误杀概率。
  if (urlSignals || titleSignals || likelyVerificationBody) {
    return "目标站点返回的是安全验证、验证码或风控页面，而不是正文 HTML。";
  }

  return null;
}

function extractArticle(
  html: string,
  sourceUrl: string,
  metadataOverride: Partial<Pick<ReferenceFetchDetail, "title" | "author" | "publishedAt">> = {}
): Omit<ReferenceFetchDetail, "fetchMode" | "fallbackReason"> {
  const $ = cheerio.load(html);
  const fallbackMetadata = collectHtmlMetadata($);

  // 清除导航、脚本和布局噪音后再评分正文区域，减少菜单和页脚进入引用正文。
  $("script, style, noscript, iframe, svg, nav, header, footer, aside, form").remove();

  const bodyText = extractReadableText($);
  const title = metadataOverride.title || fallbackMetadata.title || $("title").first().text().trim();
  const author = metadataOverride.author || fallbackMetadata.author || "";
  const publishedAt = metadataOverride.publishedAt || fallbackMetadata.publishedAt || "";

  return {
    url: sourceUrl,
    bodyText,
    title: normalizeMetadataText(title) || "",
    author: normalizeMetadataText(author) || "",
    publishedAt: normalizeMetadataText(publishedAt) || "",
    content: bodyText
  };
}

function ensureArticleContent(article: { content: string }, mode: string) {
  if (!article.content.trim()) {
    throw new ReferenceFetchError(`${mode} 已获取页面，但未能提取正文。`);
  }
}

function collectHtmlMetadata($: CheerioAPI) {
  const jsonLdMetadata = collectJsonLdMetadata($);
  return {
    title:
      metaContent($, "og:title", "twitter:title", "title") ||
      jsonLdMetadata.title ||
      normalizeMetadataText($("title").first().text()) ||
      "",
    author:
      metaContent(
        $,
        "author",
        "article:author",
        "parsely-author",
        "byline",
        "dc.creator",
        "dcterms.creator",
        "twitter:creator"
      ) ||
      jsonLdMetadata.author ||
      "",
    publishedAt:
      metaContent(
        $,
        "article:published_time",
        "article:modified_time",
        "pubdate",
        "publishdate",
        "date",
        "datepublished",
        "dc.date",
        "dcterms.created",
        "og:published_time"
      ) ||
      jsonLdMetadata.publishedAt ||
      ""
  };
}

function collectJsonLdMetadata($: CheerioAPI) {
  const candidates: Array<Record<string, unknown>> = [];

  // JSON-LD 常包含比页面可见文本更稳定的标题、作者和发布时间。
  $("script[type*='ld+json']").each((_, element) => {
    const raw = $(element).text();
    if (!raw.trim()) return;
    try {
      candidates.push(...collectJsonLdNodes(JSON.parse(raw)));
    } catch {
      return;
    }
  });

  const metadata = { title: "", author: "", publishedAt: "" };
  for (const item of candidates) {
    metadata.title = metadata.title || firstText(item.headline) || firstText(item.name) || "";
    metadata.author = metadata.author || firstText(item.author) || firstText(item.creator) || "";
    metadata.publishedAt =
      metadata.publishedAt ||
      firstText(item.datePublished) ||
      firstText(item.dateCreated) ||
      firstText(item.dateModified) ||
      "";

    if (metadata.title && metadata.author && metadata.publishedAt) break;
  }

  return metadata;
}

function collectJsonLdNodes(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.flatMap((item) => collectJsonLdNodes(item));
  if (!value || typeof value !== "object") return [];

  const objectValue = value as Record<string, unknown>;
  const graph = Array.isArray(objectValue["@graph"]) ? collectJsonLdNodes(objectValue["@graph"]) : [];
  return [objectValue, ...graph];
}

function firstText(value: unknown): string {
  if (typeof value === "string") return normalizeMetadataText(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = firstText(item);
      if (text) return text;
    }
  }
  if (value && typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    for (const key of ["name", "headline", "title", "@id"]) {
      const text = firstText(objectValue[key]);
      if (text) return text;
    }
  }
  return "";
}

function metaContent($: CheerioAPI, ...names: string[]) {
  const expected = new Set(names.map((name) => name.toLowerCase()));
  for (const element of $("meta[content]").toArray()) {
    const keys = [$(element).attr("name"), $(element).attr("property"), $(element).attr("itemprop"), $(element).attr("http-equiv")];
    if (keys.some((key) => key && expected.has(key.toLowerCase()))) {
      const value = normalizeMetadataText($(element).attr("content") || "");
      if (value) return value;
    }
  }
  return "";
}

function extractReadableText($: CheerioAPI) {
  const selectors = [
    "article",
    "main",
    "[role='main']",
    ".article",
    ".article-content",
    ".post-content",
    ".entry-content",
    ".content",
    "#article",
    "#content"
  ];
  let bestText = "";
  let bestScore = 0;

  // 优先评估常见正文容器；若容器太短或得分低，再回退到完整 body。
  for (const selector of selectors) {
    $(selector).each((_, element) => {
      const text = extractTextFromSelection($, $(element));
      const score = scoreArticleText(text);
      if (score > bestScore) {
        bestText = text;
        bestScore = score;
      }
    });
  }

  const bodyText = extractTextFromSelection($, $("body"));
  if (scoreArticleText(bodyText) > bestScore || bestText.length < 120) return bodyText;
  return bestText;
}

function extractTextFromSelection($: CheerioAPI, selection: Cheerio<AnyNode>) {
  const structuredParts = selection
    .find("h1, h2, h3, h4, p, li, blockquote")
    .map((_, element) => $(element).text())
    .get();
  const parts = structuredParts.length > 0 ? structuredParts : [selection.text()];
  return normalizeArticleText(parts.join("\n"));
}

function scoreArticleText(text: string) {
  const lineCount = text.split(/\n+/).filter((line) => line.trim().length > 20).length;
  return text.length + lineCount * 80;
}

function normalizeArticleText(text: string) {
  const seen = new Set<string>();
  return text
    .replace(/\u00a0/g, " ")
    .split(/\r?\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => {
      if (!line) return false;
      if (seen.has(line)) return false;
      seen.add(line);
      return true;
    })
    .join("\n");
}

function normalizeMetadataText(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}
