import { prisma } from "@/lib/db";
import { parseAnswer, extractEvidenceModules, classifySource } from "@/lib/ai/evaluator";
import { aggregateRates, scoreRun } from "@/lib/metrics/scoring";
import { normalizeReferenceSourceUrl } from "@/lib/services/reference-url";
import { containsAny, domainFromUrl, hashText, nowWindow, splitCsv } from "@/lib/utils";

export async function analyzeAnswerRun(runId: string) {
  const run = await prisma.answerRun.findUnique({
    where: { id: runId },
    include: {
      query: { include: { cluster: true } },
      project: { include: { brandProfile: { include: { competitors: true } }, llmConfig: true } },
      sources: true,
      citations: true,
      competitorOccurrences: true
    }
  });
  if (!run) throw new Error(`Answer run not found: ${runId}`);

  // 回答解析是可重复执行的派生计算；重建前先清理旧结构化结果，避免重复引用和过期提及残留。
  await prisma.source.deleteMany({ where: { runId } });
  await prisma.citation.deleteMany({ where: { runId } });
  await prisma.mention.deleteMany({ where: { runId } });
  await prisma.competitorOccurrence.deleteMany({ where: { runId } });

  const brandTerms = [
    ...splitCsv(run.project.brandProfile?.brandNames),
    ...splitCsv(run.project.brandProfile?.productNames),
    ...splitCsv(run.project.brandProfile?.aliases)
  ];
  const competitorNames = run.project.brandProfile?.competitors.map((competitor) => competitor.name) || [];
  // 已经抓取过的正文和元数据需要按 URL 回填，防止重新解析答案时丢失引用详情。
  const existingSourceDetails = new Map(
    run.sources.map((source) => [
      source.url,
      {
        fetchedUrl: source.fetchedUrl,
        bodyText: source.bodyText,
        author: source.author,
        publishedAt: source.publishedAt,
        content: source.content,
        fetchMode: source.fetchMode,
        fetchError: source.fetchError,
        fetchedAt: source.fetchedAt
      }
    ])
  );
  // 连接器若没有返回结构化引用，则从答案文本中抽取 URL，保证后续引用分析仍有最小输入。
  const rawSources = run.sources.length
    ? run.sources.map((source) => ({
        url: source.url,
        title: source.title,
        sourceType: source.sourceType,
        position: source.position,
        summary: source.summary || undefined,
        keyword: source.keyword || undefined,
        siteName: source.siteName || undefined
      }))
    : extractUrls(run.answerText).map((url, index) => ({
        url,
        title: domainFromUrl(url),
        sourceType: classifySource(url),
        position: index + 1
      }));
  const parsed = await parseAnswer(run.answerText, rawSources, brandTerms, competitorNames, run.project.llmConfig);
  const createdSources = await Promise.all(
    parsed.sources.map((source) => {
      const url = normalizeStoredReferenceUrl(source.url);
      const details = existingSourceDetails.get(source.url) || existingSourceDetails.get(url);
      return prisma.source.create({
        data: {
          runId,
          url,
          domain: domainFromUrl(url),
          title: source.title || domainFromUrl(url),
          sourceType: source.sourceType || classifySource(url, source.title),
          position: source.position || 0,
          summary: source.summary || null,
          keyword: source.keyword || null,
          siteName: source.siteName || null,
          fetchedUrl: details?.fetchedUrl || null,
          bodyText: details?.bodyText || null,
          author: details?.author || null,
          publishedAt: details?.publishedAt || null,
          content: details?.content || null,
          fetchMode: details?.fetchMode || null,
          fetchError: details?.fetchError || null,
          fetchedAt: details?.fetchedAt || null
        }
      })
    })
  );
  const sourceByUrl = new Map(createdSources.map((source) => [source.url, source.id]));
  const validCitations = parsed.citations.filter((citation) => citation.claimText.trim() && citation.claimLocation.trim());
  await Promise.all(
    validCitations.map((citation) =>
      prisma.citation.create({
        data: {
          runId,
          sourceId: citation.sourceUrl ? sourceByUrl.get(normalizeStoredReferenceUrl(citation.sourceUrl)) : undefined,
          claimText: citation.claimText.trim(),
          claimLocation: citation.claimLocation.trim(),
          citationMarker: citation.citationMarker,
          supportStatus: citation.supportStatus
        }
      })
    )
  );
  await Promise.all(
    parsed.mentions.map((mention) =>
      prisma.mention.create({
        data: {
          runId,
          entityType: mention.entityType,
          entityName: mention.entityName,
          canonicalName: mention.canonicalName,
          location: mention.location,
          sentiment: mention.sentiment,
          positionType: mention.positionType
        }
      })
    )
  );
  const competitors = run.project.brandProfile?.competitors || [];
  for (const competitor of competitors) {
    if (containsAny(run.answerText, [competitor.name, ...splitCsv(competitor.aliases)])) {
      await prisma.competitorOccurrence.create({
        data: {
          runId,
          competitorId: competitor.id,
          competitorName: competitor.name,
          recommendationReason: "答案中出现该竞品，需与品牌出现和推荐理由共同评估。"
        }
      });
    }
  }
  await computeRunMetric(runId);
}

export async function analyzeContentAsset(assetId: string, textContent?: string) {
  const asset = await prisma.contentAsset.findUnique({
    where: { id: assetId },
    include: { project: { include: { llmConfig: true } } }
  });
  if (!asset) throw new Error(`Content asset not found: ${assetId}`);
  const text = textContent || asset.title;
  const snapshot = await prisma.contentSnapshot.create({
    data: {
      assetId,
      textContent: text,
      contentHash: hashText(text),
      crawlStatus: "crawled",
      structure: {
        create: {
          h1Count: (text.match(/^#\s/gm) || []).length || 1,
          headingDepth: Math.min((text.match(/^#{1,5}\s/gm) || []).length || 3, 5),
          paragraphCount: text.split(/\n{2,}/).length,
          listCount: (text.match(/^\s*[-*]\s/gm) || []).length,
          tableCount: (text.match(/\|.+\|/g) || []).length,
          wordCount: text.length,
          schemaTypes: asset.assetType === "product_page" ? "Product,FAQPage" : "Article"
        }
      }
    }
  });
  const modules = await extractEvidenceModules(text, asset.project.llmConfig);
  const evidenceModules = modules
    .map((module, index) => ({
      snapshotId: snapshot.id,
      moduleType: module.moduleType || "definition",
      title: module.title || `证据模块 ${index + 1}`,
      body: module.body.trim(),
      locationPath: module.locationPath || `block:${index + 1}`,
      confidence: Number.isFinite(module.confidence) ? module.confidence : 0.75
    }))
    .filter((module) => module.body);
  if (evidenceModules.length > 0) {
    await prisma.evidenceModule.createMany({ data: evidenceModules });
  }
  return snapshot;
}

export async function computeRunMetric(runId: string) {
  const run = await prisma.answerRun.findUnique({
    where: { id: runId },
    include: {
      sources: true,
      citations: true,
      competitorOccurrences: true,
      project: { include: { brandProfile: true, contentAssets: { include: { snapshots: { include: { evidenceModules: true } } } } } }
    }
  });
  if (!run) throw new Error(`Answer run not found: ${runId}`);
  const modules = run.project.contentAssets.flatMap((asset) => asset.snapshots.flatMap((snapshot) => snapshot.evidenceModules));
  const score = scoreRun(run, run.project.brandProfile, modules);
  await prisma.runMetric.upsert({
    where: { runId },
    update: score,
    create: { runId, ...score }
  });
  return score;
}

export async function computeProjectMetrics(projectId: string) {
  const { windowStart, windowEnd } = nowWindow(30);
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      queryClusters: { include: { queries: { include: { answerRuns: { include: { metrics: true } } } } } },
      answerRuns: { include: { metrics: true } }
    }
  });
  if (!project) throw new Error(`Project not found: ${projectId}`);

  // 项目、Query 集和 Query 指标以窗口快照形式追加，历史趋势由下游按 windowEnd 读取。
  for (const cluster of project.queryClusters) {
    const runScores = cluster.queries.flatMap((query) => query.answerRuns.map((run) => run.metrics).filter(Boolean));
    const rates = aggregateMetricRows(runScores);
    await prisma.clusterMetric.create({
      data: {
        clusterId: cluster.id,
        windowStart,
        windowEnd,
        ...rates,
        worstQueryScore: rates.vair,
        negativeImpactRate: Math.max(0, 1 - rates.stabilityScore)
      }
    });
    for (const query of cluster.queries) {
      const queryRates = aggregateMetricRows(query.answerRuns.map((run) => run.metrics).filter(Boolean));
      await prisma.queryMetric.create({ data: { queryId: query.id, windowStart, windowEnd, ...queryRates } });
    }
  }
  const projectRates = aggregateMetricRows(project.answerRuns.map((run) => run.metrics).filter(Boolean));
  await prisma.projectMetric.create({ data: { projectId, windowStart, windowEnd, ...projectRates } });
  return projectRates;
}

function aggregateMetricRows(rows: Array<{ sourceSelection: boolean; citationCoverage: boolean; brandMentioned: boolean; validAnswerInfluence: boolean; absorptionScore: number; citationFaithfulness: number; errorDescriptionScore: number; competitorSubstitution: boolean; stabilitySignal: number } | null>) {
  return aggregateRates(
    rows.filter(Boolean).map((row) => ({
      sourceSelection: row!.sourceSelection,
      citationCoverage: row!.citationCoverage,
      brandMentioned: row!.brandMentioned,
      validAnswerInfluence: row!.validAnswerInfluence,
      absorptionScore: row!.absorptionScore,
      citationFaithfulness: row!.citationFaithfulness,
      errorDescriptionScore: row!.errorDescriptionScore,
      competitorSubstitution: row!.competitorSubstitution,
      stabilitySignal: row!.stabilitySignal,
      evidenceJson: "{}"
    }))
  );
}

function extractUrls(text: string) {
  return Array.from(text.matchAll(/https?:\/\/[^\s)]+/g)).map((match) => match[0]);
}

function normalizeStoredReferenceUrl(url: string) {
  return normalizeReferenceSourceUrl(url) || url;
}
