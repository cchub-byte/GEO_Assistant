import { prisma } from "@/lib/db";
import { domainFromUrl } from "@/lib/utils";
import { fetchReferenceDetail } from "@/lib/services/reference-fetcher";
import { normalizeReferenceSourceUrl } from "@/lib/services/reference-url";

const fetchConcurrency = 2;

export type ReferenceSourceDto = {
  id: string;
  position: number;
  title: string;
  summary: string;
  url: string;
  siteName: string;
  domain: string;
  fetchedUrl: string;
  bodyText: string;
  author: string;
  publishedAt: string;
  content: string;
  fetchMode: string;
  fetchError: string;
  fetchedAt: string;
  referenceFeatureAnalysis: string;
  referenceFeatureAnalysisAt: string;
  referenceFeatureAnalysisError: string;
  competitorReferenceFeatureAnalysis: string;
  competitorReferenceFeatureAnalysisAt: string;
  competitorReferenceFeatureAnalysisError: string;
};

type SourceRecord = Awaited<ReturnType<typeof loadRunSources>>[number];

export async function fetchReferenceDetailsForRun(runId: string) {
  const sources = await loadRunSources(runId);
  const updatedSources = await mapWithConcurrency(sources, fetchConcurrency, async (source) => {
    if (!source.url) {
      return prisma.source.update({
        where: { id: source.id },
        data: {
          fetchError: "引用缺少 URL。",
          fetchedAt: new Date()
        }
      });
    }

    try {
      const detail = await fetchReferenceDetail(source.url);
      return prisma.source.update({
        where: { id: source.id },
        data: {
          fetchedUrl: detail.url,
          title: detail.title || source.title,
          author: detail.author || null,
          publishedAt: detail.publishedAt || null,
          bodyText: detail.bodyText || null,
          content: detail.content || null,
          fetchMode: detail.fallbackReason ? `${detail.fetchMode}; fallback: ${detail.fallbackReason}` : detail.fetchMode,
          fetchError: null,
          fetchedAt: new Date(),
          domain: domainFromUrl(detail.url || source.url)
        }
      });
    } catch (error) {
      const fallbackContent = source.bodyText || source.content || source.summary || "";
      return prisma.source.update({
        where: { id: source.id },
        data: {
          fetchedUrl: normalizeStoredReferenceUrl(source.fetchedUrl || source.url),
          bodyText: fallbackContent || source.bodyText,
          content: fallbackContent || source.content,
          fetchMode: fallbackContent ? "source_summary_fallback" : source.fetchMode,
          fetchError: error instanceof Error ? error.message.slice(0, 1000) : "unknown_reference_fetch_error",
          fetchedAt: new Date()
        }
      });
    }
  });

  return updatedSources.sort((left, right) => sourcePosition(left) - sourcePosition(right) || left.id.localeCompare(right.id));
}

export async function loadRunSources(runId: string) {
  return prisma.source.findMany({
    where: { runId },
    orderBy: [{ position: "asc" }, { id: "asc" }]
  });
}

export function serializeReferenceSource(source: SourceRecord): ReferenceSourceDto {
  return {
    id: source.id,
    position: source.position,
    title: source.title,
    summary: source.summary || "",
    url: normalizeStoredReferenceUrl(source.url),
    siteName: source.siteName || "",
    domain: source.domain || "",
    fetchedUrl: source.fetchedUrl ? normalizeStoredReferenceUrl(source.fetchedUrl) : "",
    bodyText: source.bodyText || "",
    author: source.author || "",
    publishedAt: source.publishedAt || "",
    content: source.content || "",
    fetchMode: source.fetchMode || "",
    fetchError: source.fetchError || "",
    fetchedAt: source.fetchedAt?.toISOString() || "",
    referenceFeatureAnalysis: source.referenceFeatureAnalysis || "",
    referenceFeatureAnalysisAt: source.referenceFeatureAnalysisAt?.toISOString() || "",
    referenceFeatureAnalysisError: source.referenceFeatureAnalysisError || "",
    competitorReferenceFeatureAnalysis: source.competitorReferenceFeatureAnalysis || "",
    competitorReferenceFeatureAnalysisAt: source.competitorReferenceFeatureAnalysisAt?.toISOString() || "",
    competitorReferenceFeatureAnalysisError: source.competitorReferenceFeatureAnalysisError || ""
  };
}

function normalizeStoredReferenceUrl(url: string) {
  return normalizeReferenceSourceUrl(url) || url;
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>) {
  const results: R[] = [];
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function sourcePosition(source: { position: number }) {
  return Number.isFinite(source.position) && source.position > 0 ? source.position : Number.MAX_SAFE_INTEGER;
}
