import { prisma } from "@/lib/db";
import { parseAnswer, extractEvidenceModules, classifySource } from "@/lib/ai/evaluator";
import { aggregateRates, scoreRun } from "@/lib/metrics/scoring";
import { normalizeReferenceSourceUrl } from "@/lib/services/reference-url";
import { brandTerms, containsAny, domainFromUrl, hashText, nowWindow, splitCsv } from "@/lib/utils";
import { dispatchProjectEvent } from "@/lib/integrations/delivery";

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

export async function generateFindings(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      queryClusters: { include: { metrics: { orderBy: { windowEnd: "desc" }, take: 1 }, queries: { include: { answerRuns: { include: { metrics: true, sources: true } } } } } },
      contentAssets: { include: { snapshots: { include: { structure: true, evidenceModules: true }, orderBy: { snapshotAt: "desc" }, take: 1 } } }
    }
  });
  if (!project) throw new Error(`Project not found: ${projectId}`);
  const created = [];
  for (const cluster of project.queryClusters) {
    const metric = cluster.metrics[0];
    const answerRuns = cluster.queries.flatMap((query) => query.answerRuns);
    if (!metric || metric.sourceSelectionRate < 0.35) {
      created.push(
        await upsertFinding(projectId, cluster.id, "selected", "目标品牌较少进入候选来源", "source_selection_low", "P1", "SEO / 公关 / 内容", "识别 Top 第三方来源，补充品牌覆盖，并增强目标页面语义覆盖。", answerRuns[0]?.id)
      );
    }
    if (!metric || metric.absorptionScore < 0.3) {
      created.push(
        await upsertFinding(projectId, cluster.id, "absorbed", "引用或提及未转化为答案吸收", "absorption_low", "P1", "内容 / 产品", "重构证据模块，补充定义、对比、价格/规格、限制条件和更新时间。", answerRuns[0]?.id)
      );
    }
    if (metric && metric.competitorSubstitutionRate > 0.25) {
      created.push(
        await upsertFinding(projectId, cluster.id, "stable", "竞品替代率偏高", "competitor_substitution", "P1", "产品 / 公关", "分析竞品推荐理由，建立差异化证据和外部权威覆盖。", answerRuns[0]?.id)
      );
    }
  }
  const weakAsset = project.contentAssets.find((asset) => {
    const snapshot = asset.snapshots[0];
    return !snapshot?.structure || snapshot.structure.schemaScore < 70 || snapshot.evidenceModules.length < 4;
  });
  if (weakAsset) {
    created.push(
      await upsertFinding(projectId, null, "discoverable", "内容资产结构化程度不足", "content_structure_weak", "P2", "SEO / 内容", `页面 ${weakAsset.title} 需要补 schema、标题层级和证据模块。`)
    );
  }
  return created.filter(Boolean);
}

export async function createTasksFromFindings(projectId: string) {
  const findings = await prisma.finding.findMany({ where: { projectId, status: { in: ["open", "triaged"] } } });
  for (const finding of findings) {
    const exists = await prisma.task.findFirst({ where: { findingId: finding.id } });
    if (exists) continue;
    await prisma.task.create({
      data: {
        projectId,
        findingId: finding.id,
        targetClusterId: finding.clusterId,
        taskType: taskTypeForStage(finding.stage),
        title: `处理：${finding.title}`,
        description: finding.recommendation,
        ownerTeam: finding.ownerTeam,
        expectedMetricImpact: "提升 VAIR、吸收得分或引用忠实度",
        timeline: { create: { status: "todo", note: "由 finding 自动创建任务" } }
      }
    });
  }
}

export async function refreshAuthority(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { brandProfile: true }
  });
  const terms = brandTerms(project?.brandProfile);
  const sources = await prisma.source.findMany({ where: { run: { projectId } } });
  const grouped = new Map<string, typeof sources>();
  for (const source of sources) {
    grouped.set(source.domain, [...(grouped.get(source.domain) || []), source]);
  }
  await prisma.authoritySource.deleteMany({ where: { projectId } });
  await prisma.authorityOpportunity.deleteMany({ where: { projectId } });
  for (const [domain, items] of grouped) {
    const brandCovered = terms.length > 0 && items.some((item) => containsAny(`${item.url} ${item.title}`, terms));
    await prisma.authoritySource.create({
      data: {
        projectId,
        domain,
        sourceType: items[0].sourceType,
        topicCoverage: "项目管理、协作工具、B2B SaaS",
        citationCount: items.length,
        competitorMentions: 0,
        brandCovered,
        authorityScore: Math.min(95, 50 + items.length * 8)
      }
    });
    if (!brandCovered) {
      await prisma.authorityOpportunity.create({
        data: {
          projectId,
          sourceDomain: domain,
          clusterName: "B2B SaaS 推荐与替代方案",
          opportunityType: items[0].sourceType === "评测" ? "review_site" : "media_pitch",
          priority: items.length > 2 ? 1 : 2,
          score: Math.min(100, 60 + items.length * 8),
          reason: `${domain} 在答案中被引用 ${items.length} 次，但未稳定覆盖本品牌。`
        }
      });
    }
  }
}

export async function generateAlerts(projectId: string) {
  const latest = await prisma.projectMetric.findFirst({ where: { projectId }, orderBy: { windowEnd: "desc" } });
  if (!latest) return [];
  const alerts = [];
  if (latest.vair < 0.5) {
    const alert = await prisma.alert.create({
        data: {
          projectId,
          title: "VAIR 低于目标阈值",
          message: `当前 VAIR 为 ${Math.round(latest.vair * 100)}%，需要复查核心 Query集。`,
          severity: "P1"
        }
      });
    alerts.push(alert);
    await dispatchProjectEvent(projectId, "alert.triggered", alert);
  }
  if (latest.errorDescriptionRate > 0.1) {
    const alert = await prisma.alert.create({
        data: {
          projectId,
          title: "错误描述率偏高",
          message: `错误描述率为 ${Math.round(latest.errorDescriptionRate * 100)}%，建议进入合规审核。`,
          severity: "P0"
        }
      });
    alerts.push(alert);
    await dispatchProjectEvent(projectId, "alert.triggered", alert);
  }
  return alerts;
}

export async function generateReport(projectId: string, type: "weekly" | "monthly" = "weekly") {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      queryClusters: { include: { metrics: { orderBy: { windowEnd: "desc" }, take: 1 } } },
      findings: { orderBy: { createdAt: "desc" }, take: 8 },
      tasks: { orderBy: { createdAt: "desc" }, take: 8 },
      alerts: { orderBy: { createdAt: "desc" }, take: 5 }
    }
  });
  if (!project) throw new Error(`Project not found: ${projectId}`);
  const latest = await prisma.projectMetric.findFirst({ where: { projectId }, orderBy: { windowEnd: "desc" } });
  const markdown = [
    `# ${project.name} GEO ${type === "weekly" ? "周报" : "月报"}`,
    "",
    `- VAIR: ${Math.round((latest?.vair || 0) * 100)}%`,
    `- 来源选择率: ${Math.round((latest?.sourceSelectionRate || 0) * 100)}%`,
    `- 吸收得分: ${Math.round((latest?.absorptionScore || 0) * 100)}%`,
    `- 竞品替代率: ${Math.round((latest?.competitorSubstitutionRate || 0) * 100)}%`,
    "",
    "## 关键 Finding",
    ...project.findings.map((finding) => `- [${finding.severity}] ${finding.title}: ${finding.recommendation}`),
    "",
    "## 待处理任务",
    ...project.tasks.map((task) => `- ${task.status} / ${task.ownerTeam}: ${task.title}`),
    "",
    "## 告警",
    ...project.alerts.map((alert) => `- [${alert.severity}] ${alert.title}: ${alert.message}`)
  ].join("\n");
  const report = await prisma.report.create({
    data: {
      projectId,
      type,
      title: `${project.name} GEO ${type === "weekly" ? "周报" : "月报"}`,
      markdown
    }
  });
  await dispatchProjectEvent(projectId, "report.generated", { title: report.title, markdown: report.markdown });
  return report;
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

async function upsertFinding(projectId: string, clusterId: string | null, stage: string, title: string, rootCause: string, severity: string, ownerTeam: string, recommendation: string, runId?: string) {
  const existing = await prisma.finding.findFirst({ where: { projectId, clusterId, stage, rootCause, status: { in: ["open", "triaged", "in_progress"] } } });
  if (existing) return existing;
  return prisma.finding.create({
    data: {
      projectId,
      clusterId,
      stage,
      title,
      description: `${title}，需要按 ${stage} 阶段修复。`,
      rootCause,
      severity,
      ownerTeam,
      recommendation,
      evidence: { create: { runId, evidence: recommendation } }
    }
  });
}

function taskTypeForStage(stage: string) {
  if (stage === "discoverable") return "technical_seo";
  if (stage === "selected") return "external_authority";
  if (stage === "attributed") return "compliance_review";
  return "content_update";
}

function extractUrls(text: string) {
  return Array.from(text.matchAll(/https?:\/\/[^\s)]+/g)).map((match) => match[0]);
}

function normalizeStoredReferenceUrl(url: string) {
  return normalizeReferenceSourceUrl(url) || url;
}
