import { createHash } from "node:crypto";
import type { Report } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { BrandProfileAnalysisResult } from "@/lib/services/brand-profile-analysis";

export type ProfileAnalysisArchiveScope = "dashboard" | "references";
export type ProfileAnalysisArchiveTarget = "brand" | "competitor";

type ProfileAnalysisArchiveMetadata = {
  version: 1;
  scope: ProfileAnalysisArchiveScope;
  target: ProfileAnalysisArchiveTarget;
  contextKey: string;
  generatedAt: string;
};

const metadataPrefix = "<!-- geo-profile-analysis:";

export function buildProfileAnalysisContextKey(input: {
  scope: ProfileAnalysisArchiveScope;
  projectId: string;
  filters: Record<string, string | string[] | undefined>;
  sourceIds: string[];
}) {
  const stableFilters = Object.fromEntries(
    Object.entries(input.filters)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, Array.isArray(value) ? [...value].sort() : value || ""])
  );
  return createHash("sha256")
    .update(
      JSON.stringify({
        scope: input.scope,
        projectId: input.projectId,
        filters: stableFilters,
        sourceIds: [...input.sourceIds].sort()
      })
    )
    .digest("hex");
}

export function profileAnalysisReportType(target: ProfileAnalysisArchiveTarget) {
  return target === "brand" ? "profile_brand_analysis" : "profile_competitor_analysis";
}

export function profileAnalysisReportTitle(scope: ProfileAnalysisArchiveScope, target: ProfileAnalysisArchiveTarget) {
  const targetLabel = target === "brand" ? "品牌画像分析" : "竞品画像分析";
  const scopeLabel = scope === "dashboard" ? "总览" : "引用查询";
  return `${targetLabel} - ${scopeLabel}`;
}

export function buildProfileAnalysisArchiveMarkdown(input: {
  scope: ProfileAnalysisArchiveScope;
  target: ProfileAnalysisArchiveTarget;
  contextKey: string;
  result: BrandProfileAnalysisResult;
}) {
  const metadata: ProfileAnalysisArchiveMetadata = {
    version: 1,
    scope: input.scope,
    target: input.target,
    contextKey: input.contextKey,
    generatedAt: new Date().toISOString()
  };
  const warning = input.result.warning.trim();
  const warningBlock = warning ? `> ${warning.replace(/\r?\n/g, "\n> ")}\n\n` : "";
  return `${metadataPrefix}${JSON.stringify(metadata)} -->\n${warningBlock}${input.result.report.trim()}`;
}

export async function createProfileAnalysisArchive(input: {
  projectId: string;
  scope: ProfileAnalysisArchiveScope;
  target: ProfileAnalysisArchiveTarget;
  contextKey: string;
  result: BrandProfileAnalysisResult;
}) {
  return prisma.report.create({
    data: {
      projectId: input.projectId,
      type: profileAnalysisReportType(input.target),
      title: profileAnalysisReportTitle(input.scope, input.target),
      markdown: buildProfileAnalysisArchiveMarkdown(input),
      status: input.result.warning ? "generated_with_warning" : "generated"
    }
  });
}

export async function getProfileAnalysisArchive(input: {
  projectId: string;
  scope: ProfileAnalysisArchiveScope;
  target: ProfileAnalysisArchiveTarget;
  contextKey: string;
}): Promise<BrandProfileAnalysisResult | null> {
  const reports = await prisma.report.findMany({
    where: {
      projectId: input.projectId,
      type: profileAnalysisReportType(input.target),
      title: profileAnalysisReportTitle(input.scope, input.target)
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 20
  });
  if (reports.length === 0) return null;

  const exact = reports.find((report) => {
    const parsed = parseProfileAnalysisArchiveMarkdown(report.markdown);
    return (
      parsed.metadata?.scope === input.scope &&
      parsed.metadata.target === input.target &&
      parsed.metadata.contextKey === input.contextKey
    );
  });
  return parseProfileAnalysisArchiveMarkdown(exact?.markdown || reports[0].markdown).result;
}

export function parseProfileAnalysisArchiveMarkdown(markdown: string): {
  metadata: ProfileAnalysisArchiveMetadata | null;
  result: BrandProfileAnalysisResult;
} {
  const { metadata, body } = stripProfileAnalysisMetadata(markdown);
  const { warning, report } = stripLeadingWarning(body);
  return {
    metadata,
    result: {
      report,
      warning,
      reportCount: countProfileAnalysisReports(report)
    }
  };
}

export function toProfileAnalysisArchiveResponse(report: Report) {
  return {
    id: report.id,
    type: report.type,
    title: report.title,
    status: report.status,
    createdAt: report.createdAt
  };
}

function stripProfileAnalysisMetadata(markdown: string) {
  const trimmed = markdown.trim();
  if (!trimmed.startsWith(metadataPrefix)) {
    return { metadata: null, body: trimmed };
  }
  const endIndex = trimmed.indexOf("-->");
  if (endIndex < 0) return { metadata: null, body: trimmed };
  const rawMetadata = trimmed.slice(metadataPrefix.length, endIndex).trim();
  const body = trimmed.slice(endIndex + 3).trimStart();
  try {
    return {
      metadata: JSON.parse(rawMetadata) as ProfileAnalysisArchiveMetadata,
      body
    };
  } catch {
    return { metadata: null, body };
  }
}

function stripLeadingWarning(markdown: string) {
  const lines = markdown.trim().split(/\r?\n/);
  if (!lines[0]?.startsWith(">")) {
    return { warning: "", report: markdown.trim() };
  }

  const warningLines: string[] = [];
  let index = 0;
  while (index < lines.length && lines[index].startsWith(">")) {
    warningLines.push(lines[index].replace(/^>\s?/, ""));
    index += 1;
  }
  while (index < lines.length && lines[index].trim() === "") {
    index += 1;
  }

  return {
    warning: warningLines.join("\n").trim(),
    report: lines.slice(index).join("\n").trim()
  };
}

function countProfileAnalysisReports(report: string) {
  const matches = report.match(/^【.+画像分析报告】$/gm);
  return matches?.length || 0;
}
