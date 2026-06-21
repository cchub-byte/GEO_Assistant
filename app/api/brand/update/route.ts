import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { parseCompetitorInput } from "@/lib/services/brand-profile-input";
import { brandTerms, hashText, primaryBrandName } from "@/lib/utils";

export async function POST(request: Request) {
  const formData = await request.formData();
  const brandProfileId = String(formData.get("brandProfileId") || "");
  const projectId = String(formData.get("projectId") || "");
  const brandNames = String(formData.get("brandNames") || "");
  const productNames = String(formData.get("productNames") || "");
  const aliases = String(formData.get("aliases") || "");
  const customerGroups = String(formData.get("customerGroups") || "");
  const description = String(formData.get("description") || "");
  const brandUrls = String(formData.get("brandUrls") || "");
  const nextBrand = { brandNames, productNames, aliases };
  const competitors = parseCompetitorInput(String(formData.get("competitors") || ""));

  const oldBrand = brandProfileId
    ? await prisma.brandProfile.findUnique({ where: { id: brandProfileId } })
    : null;
  const resolvedProjectId = projectId || oldBrand?.projectId || "";

  if (brandProfileId) {
    await prisma.brandProfile.update({
      where: { id: brandProfileId },
      data: {
        brandNames,
        productNames,
        aliases,
        customerGroups,
        description,
        brandUrls,
        forbiddenClaims: String(formData.get("forbiddenClaims") || ""),
        approvedClaims: String(formData.get("approvedClaims") || ""),
        competitors: {
          deleteMany: {},
          create: competitors
        }
      }
    });
  } else if (resolvedProjectId) {
    await prisma.brandProfile.create({
      data: {
        projectId: resolvedProjectId,
        brandNames,
        productNames,
        aliases,
        customerGroups,
        description,
        brandUrls,
        forbiddenClaims: String(formData.get("forbiddenClaims") || ""),
        approvedClaims: String(formData.get("approvedClaims") || ""),
        competitors: {
          create: competitors
        }
      }
    });
  }

  if (resolvedProjectId) {
    await syncBrandReferences(resolvedProjectId, [...brandTerms(oldBrand), ...legacySeedBrandTerms], primaryBrandName(nextBrand));
  }
  for (const path of ["/", "/settings", "/sampling", "/content", "/findings", "/experiments", "/authority", "/alerts"]) {
    revalidatePath(path);
  }
  redirect("/settings");
}

const legacySeedBrandTerms = [
  "ExampleSaaS Enterprise",
  "Example SaaS",
  "ExampleSaaS",
  "示例协作云",
  "示例SaaS"
];

async function syncBrandReferences(projectId: string, oldTerms: string[], nextPrimaryBrand: string) {
  const replacement = nextPrimaryBrand.trim();
  if (!replacement || replacement === "未设置品牌") return;
  const terms = Array.from(new Set(oldTerms.map((term) => term.trim()).filter((term) => term && term !== replacement)));

  await prisma.project.update({
    where: { id: projectId },
    data: { name: `${replacement} GEO 监测项目` }
  });

  if (!terms.length) return;

  const queries = await prisma.query.findMany({
    where: { cluster: { projectId } },
    select: { id: true, queryText: true, expectedEvidenceTypes: true }
  });
  for (const query of queries) {
    const nextQueryText = replaceTerms(query.queryText, terms, replacement);
    const nextEvidenceTypes = replaceTerms(query.expectedEvidenceTypes || "", terms, replacement);
    if (nextQueryText !== query.queryText || nextEvidenceTypes !== (query.expectedEvidenceTypes || "")) {
      await prisma.query.update({
        where: { id: query.id },
        data: { queryText: nextQueryText, expectedEvidenceTypes: nextEvidenceTypes }
      });
    }
  }

  const assets = await prisma.contentAsset.findMany({
    where: { projectId },
    select: { id: true, title: true }
  });
  for (const asset of assets) {
    const nextTitle = replaceTerms(asset.title, terms, replacement);
    if (nextTitle !== asset.title) {
      await prisma.contentAsset.update({ where: { id: asset.id }, data: { title: nextTitle } });
    }
  }

  const snapshots = await prisma.contentSnapshot.findMany({
    where: { asset: { projectId } },
    select: { id: true, textContent: true }
  });
  for (const snapshot of snapshots) {
    const nextTextContent = replaceTerms(snapshot.textContent, terms, replacement);
    if (nextTextContent !== snapshot.textContent) {
      await prisma.contentSnapshot.update({
        where: { id: snapshot.id },
        data: { textContent: nextTextContent, contentHash: hashText(nextTextContent) }
      });
    }
  }

  const modules = await prisma.evidenceModule.findMany({
    where: { snapshot: { asset: { projectId } } },
    select: { id: true, title: true, body: true, locationPath: true }
  });
  for (const module of modules) {
    const nextTitle = replaceTerms(module.title, terms, replacement);
    const nextBody = replaceTerms(module.body, terms, replacement);
    const nextLocationPath = replaceTerms(module.locationPath, terms, replacement);
    if (nextTitle !== module.title || nextBody !== module.body || nextLocationPath !== module.locationPath) {
      await prisma.evidenceModule.update({
        where: { id: module.id },
        data: { title: nextTitle, body: nextBody, locationPath: nextLocationPath }
      });
    }
  }

  const reports = await prisma.report.findMany({
    where: { projectId },
    select: { id: true, title: true, markdown: true }
  });
  for (const report of reports) {
    const nextTitle = replaceTerms(report.title, terms, replacement);
    const nextMarkdown = replaceTerms(report.markdown, terms, replacement);
    if (nextTitle !== report.title || nextMarkdown !== report.markdown) {
      await prisma.report.update({ where: { id: report.id }, data: { title: nextTitle, markdown: nextMarkdown } });
    }
  }
}

function replaceTerms(text: string, terms: string[], replacement: string) {
  let result = text;
  const sortedTerms = [...terms].sort((a, b) => b.length - a.length);
  for (const term of sortedTerms) {
    result = result.replace(new RegExp(escapeRegExp(term), "gi"), replacement);
  }
  return result;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
