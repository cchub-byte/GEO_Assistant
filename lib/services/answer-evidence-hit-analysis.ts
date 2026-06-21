import { prisma } from "@/lib/db";
import { parseAnswerAnalysisOutput } from "@/lib/services/answer-analysis";
import { buildEvidenceSubmodules, type EvidenceSubmodule } from "@/lib/services/evidence-submodules";
import { assertUsableLlmConfig } from "@/lib/services/llm-models";
import { requestChatCompletion } from "@/lib/services/llm-chat";
import { hashText } from "@/lib/utils";

const brandAdvantageLabel = "提及品牌优点";

export type AnswerEvidenceHitResult = {
  runId: string;
  analysisLabel: string;
  analysisText: string;
  analysisTextHash: string;
  matched: boolean;
  evidenceSubmoduleId: string | null;
  evidenceParentModuleId: string | null;
  evidenceText: string | null;
  evidenceTitle: string | null;
  evidenceLocationPath: string | null;
  reason: string | null;
  modelName: string | null;
  analyzedAt: Date;
};

type AdvantageAnalysisItem = {
  itemKey: string;
  runId: string;
  projectId: string;
  platformName: string;
  queryText: string;
  analysisLabel: typeof brandAdvantageLabel;
  analysisText: string;
  analysisTextHash: string;
};

type EvidenceOption = EvidenceSubmodule & {
  assetTitle: string;
};

type LlmMatch = {
  itemKey?: unknown;
  matched?: unknown;
  evidenceSubmoduleId?: unknown;
  reason?: unknown;
};

export function answerEvidenceHitKey(runId: string, analysisLabel: string, analysisText: string) {
  return `${runId}:${analysisLabel}:${hashText(analysisText).slice(0, 24)}`;
}

export async function analyzeAnswerEvidenceHits(input: {
  projectId: string;
  clusterIds?: string[];
  batchIds?: string[];
  queryIntentTypes?: string[];
}) {
  await ensureAnswerEvidenceHitTable();
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    include: {
      llmConfig: true,
      answerRuns: {
        include: {
          query: true,
          engineConfig: true
        },
        orderBy: [{ runAt: "desc" }, { id: "desc" }]
      },
      contentAssets: {
        include: {
          snapshots: {
            include: { evidenceModules: true },
            orderBy: { snapshotAt: "desc" },
            take: 1
          }
        }
      }
    }
  });
  if (!project) throw new Error("项目不存在");

  const config = assertUsableLlmConfig(project.llmConfig, "answerEvidenceHitAnalysis");
  const clusterFilter = new Set((input.clusterIds || []).filter(Boolean));
  const batchFilter = new Set((input.batchIds || []).filter(Boolean));
  const queryIntentFilter = new Set((input.queryIntentTypes || []).map(normalizeQueryIntentType).filter(Boolean));
  const answerRuns = project.answerRuns.filter((run) => {
    if (clusterFilter.size > 0 && !clusterFilter.has(run.query.clusterId)) return false;
    if (batchFilter.size > 0 && !batchFilter.has(run.samplingBatchId || "")) return false;
    if (queryIntentFilter.size > 0 && !queryIntentFilter.has(normalizeQueryIntentType(run.query.intentType))) return false;
    return true;
  });
  const evidenceOptions = buildProjectEvidenceOptions(project.contentAssets);
  if (evidenceOptions.length === 0) throw new Error("当前内容资产没有可用于对比的句级证据");

  const items: AdvantageAnalysisItem[] = answerRuns.flatMap((run) =>
    parseAnswerAnalysisOutput(run.answerAnalysis || "")
      .filter((section) => section.label === brandAdvantageLabel && section.status === "是")
      .flatMap((section) =>
        section.timings.map((analysisText): AdvantageAnalysisItem => ({
          itemKey: answerEvidenceHitKey(run.id, brandAdvantageLabel, analysisText),
          runId: run.id,
          projectId: project.id,
          platformName: run.engineConfig.displayName,
          queryText: run.query.queryText,
          analysisLabel: brandAdvantageLabel,
          analysisText,
          analysisTextHash: hashText(analysisText)
        }))
      )
  );

  if (items.length === 0) {
    await cleanupStaleHits(answerRuns.map((run) => run.id), new Map());
    return { analyzedCount: 0, matchedCount: 0, evidenceCount: evidenceOptions.length };
  }

  const matchByItemKey = new Map<string, LlmMatch>();
  for (const chunk of chunkArray(items, 16)) {
    const matches = await requestEvidenceHitMatches({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      modelName: config.modelName,
      items: chunk,
      evidenceOptions
    });
    for (const match of matches) {
      if (typeof match.itemKey === "string") matchByItemKey.set(match.itemKey, match);
    }
  }

  const evidenceById = new Map(evidenceOptions.map((evidence) => [evidence.id, evidence]));
  let matchedCount = 0;
  for (const item of items) {
    const rawMatch = matchByItemKey.get(item.itemKey);
    const evidenceId = typeof rawMatch?.evidenceSubmoduleId === "string" ? rawMatch.evidenceSubmoduleId : "";
    const evidence = evidenceId ? evidenceById.get(evidenceId) : null;
    const matched = Boolean(rawMatch?.matched) && Boolean(evidence);
    if (matched) matchedCount += 1;

    await upsertAnswerEvidenceHit({
      item,
      matched,
      evidence,
      reason: typeof rawMatch?.reason === "string" ? rawMatch.reason.slice(0, 500) : null,
      modelName: config.modelName
    });
  }

  await cleanupStaleHits(answerRuns.map((run) => run.id), groupCurrentHashesByRun(items));
  return { analyzedCount: items.length, matchedCount, evidenceCount: evidenceOptions.length };
}

export async function getAnswerEvidenceHitResultMap(projectId: string) {
  await ensureAnswerEvidenceHitTable();
  const rows = await prisma.$queryRaw<Array<AnswerEvidenceHitResult>>`
    SELECT
      "runId",
      "analysisLabel",
      "analysisText",
      "analysisTextHash",
      "matched",
      "evidenceSubmoduleId",
      "evidenceParentModuleId",
      "evidenceText",
      "evidenceTitle",
      "evidenceLocationPath",
      "reason",
      "modelName",
      "analyzedAt"
    FROM "AnswerEvidenceHit"
    WHERE "projectId" = ${projectId}
  `;
  return new Map(rows.map((row) => [`${row.runId}:${row.analysisLabel}:${row.analysisTextHash.slice(0, 24)}`, normalizeHitRow(row)]));
}

export async function getEvidenceSubmoduleHitCounts(projectId: string) {
  await ensureAnswerEvidenceHitTable();
  const rows = await prisma.$queryRaw<Array<{ evidenceSubmoduleId: string; count: bigint | number }>>`
    SELECT "evidenceSubmoduleId", COUNT(*) AS count
    FROM "AnswerEvidenceHit"
    WHERE "projectId" = ${projectId}
      AND "matched" = 1
      AND "evidenceSubmoduleId" IS NOT NULL
    GROUP BY "evidenceSubmoduleId"
  `;
  return new Map(rows.map((row) => [row.evidenceSubmoduleId, Number(row.count)]));
}

async function requestEvidenceHitMatches(input: {
  baseUrl: string;
  apiKey: string;
  modelName: string;
  items: AdvantageAnalysisItem[];
  evidenceOptions: EvidenceOption[];
}) {
  const raw = await requestChatCompletion({
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    modelName: input.modelName,
    temperature: 0,
    responseFormat: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "你是 GEO 内容证据核验助手。请判断每条“品牌优点解析”是否被内容资产中的某一条句级证据明确支持。\n" +
          "判定要求：\n" +
          "1. 只处理品牌优点解析，不评价品牌缺点。\n" +
          "2. matched=true 仅当证据句与优点解析在核心事实、能力或场景上语义一致；只出现同一品牌名但事实不一致时必须为 false。\n" +
          "3. 每条优点最多选择一条最直接的 evidenceSubmoduleId。\n" +
          "4. 如果没有明确证据，matched=false，evidenceSubmoduleId=null。\n" +
          "5. 只返回 JSON，格式为 {\"matches\":[{\"itemKey\":\"...\",\"matched\":true,\"evidenceSubmoduleId\":\"...\",\"reason\":\"...\"}]}。"
      },
      {
        role: "user",
        content: JSON.stringify({
          advantages: input.items.map((item) => ({
            itemKey: item.itemKey,
            platform: item.platformName,
            query: item.queryText,
            advantage: item.analysisText
          })),
          evidenceOptions: input.evidenceOptions.map((evidence) => ({
            evidenceSubmoduleId: evidence.id,
            assetTitle: evidence.assetTitle,
            moduleTitle: evidence.parentTitle,
            moduleType: evidence.moduleType,
            locationPath: evidence.locationPath,
            evidence: evidence.body
          }))
        })
      }
    ]
  });

  const parsed = parseJsonObject(raw) as { matches?: LlmMatch[] };
  return Array.isArray(parsed.matches) ? parsed.matches : [];
}

function buildProjectEvidenceOptions(
  contentAssets: Array<{
    title: string;
    snapshots: Array<{
      evidenceModules: Array<{
        id: string;
        moduleType: string;
        title: string;
        body: string;
        locationPath: string;
        confidence: number;
      }>;
    }>;
  }>
) {
  return contentAssets.flatMap((asset) =>
    (asset.snapshots[0]?.evidenceModules || []).flatMap((module) =>
      buildEvidenceSubmodules(module).map((submodule) => ({
        ...submodule,
        assetTitle: asset.title
      }))
    )
  );
}

async function upsertAnswerEvidenceHit(input: {
  item: AdvantageAnalysisItem;
  matched: boolean;
  evidence: EvidenceOption | null | undefined;
  reason: string | null;
  modelName: string;
}) {
  await prisma.$executeRaw`
    INSERT INTO "AnswerEvidenceHit" (
      "id",
      "projectId",
      "runId",
      "analysisLabel",
      "analysisText",
      "analysisTextHash",
      "matched",
      "evidenceSubmoduleId",
      "evidenceParentModuleId",
      "evidenceText",
      "evidenceTitle",
      "evidenceLocationPath",
      "reason",
      "modelName",
      "analyzedAt"
    )
    VALUES (
      ${crypto.randomUUID()},
      ${input.item.projectId},
      ${input.item.runId},
      ${input.item.analysisLabel},
      ${input.item.analysisText},
      ${input.item.analysisTextHash},
      ${input.matched ? 1 : 0},
      ${input.matched ? input.evidence?.id || null : null},
      ${input.matched ? input.evidence?.parentModuleId || null : null},
      ${input.matched ? input.evidence?.body || null : null},
      ${input.matched ? input.evidence?.parentTitle || null : null},
      ${input.matched ? input.evidence?.locationPath || null : null},
      ${input.reason},
      ${input.modelName},
      ${new Date()}
    )
    ON CONFLICT("runId", "analysisLabel", "analysisTextHash") DO UPDATE SET
      "analysisText" = excluded."analysisText",
      "matched" = excluded."matched",
      "evidenceSubmoduleId" = excluded."evidenceSubmoduleId",
      "evidenceParentModuleId" = excluded."evidenceParentModuleId",
      "evidenceText" = excluded."evidenceText",
      "evidenceTitle" = excluded."evidenceTitle",
      "evidenceLocationPath" = excluded."evidenceLocationPath",
      "reason" = excluded."reason",
      "modelName" = excluded."modelName",
      "analyzedAt" = excluded."analyzedAt"
  `;
}

async function cleanupStaleHits(runIds: string[], currentHashesByRun: Map<string, Set<string>>) {
  for (const runId of runIds) {
    const currentHashes = currentHashesByRun.get(runId) || new Set<string>();
    const rows = await prisma.$queryRaw<Array<{ analysisTextHash: string }>>`
      SELECT "analysisTextHash"
      FROM "AnswerEvidenceHit"
      WHERE "runId" = ${runId}
        AND "analysisLabel" = ${brandAdvantageLabel}
    `;
    for (const row of rows) {
      if (currentHashes.has(row.analysisTextHash)) continue;
      await prisma.$executeRaw`
        DELETE FROM "AnswerEvidenceHit"
        WHERE "runId" = ${runId}
          AND "analysisLabel" = ${brandAdvantageLabel}
          AND "analysisTextHash" = ${row.analysisTextHash}
      `;
    }
  }
}

function groupCurrentHashesByRun(items: AdvantageAnalysisItem[]) {
  const grouped = new Map<string, Set<string>>();
  for (const item of items) {
    const hashes = grouped.get(item.runId) || new Set<string>();
    hashes.add(item.analysisTextHash);
    grouped.set(item.runId, hashes);
  }
  return grouped;
}

async function ensureAnswerEvidenceHitTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "AnswerEvidenceHit" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "projectId" TEXT NOT NULL,
      "runId" TEXT NOT NULL,
      "analysisLabel" TEXT NOT NULL,
      "analysisText" TEXT NOT NULL,
      "analysisTextHash" TEXT NOT NULL,
      "matched" BOOLEAN NOT NULL DEFAULT false,
      "evidenceSubmoduleId" TEXT,
      "evidenceParentModuleId" TEXT,
      "evidenceText" TEXT,
      "evidenceTitle" TEXT,
      "evidenceLocationPath" TEXT,
      "reason" TEXT,
      "modelName" TEXT,
      "analyzedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "AnswerEvidenceHit_runId_analysisLabel_analysisTextHash_key"
    ON "AnswerEvidenceHit" ("runId", "analysisLabel", "analysisTextHash")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "AnswerEvidenceHit_projectId_evidenceSubmoduleId_idx"
    ON "AnswerEvidenceHit" ("projectId", "evidenceSubmoduleId")
  `);
}

function parseJsonObject(content: string) {
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return {};
    try {
      return JSON.parse(match[0]);
    } catch {
      return {};
    }
  }
}

function normalizeHitRow(row: AnswerEvidenceHitResult): AnswerEvidenceHitResult {
  return {
    ...row,
    matched: Boolean(row.matched),
    analyzedAt: row.analyzedAt instanceof Date ? row.analyzedAt : new Date(row.analyzedAt)
  };
}

function normalizeQueryIntentType(value: string | null | undefined) {
  return String(value || "").trim() || "未设置意图";
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
