import { Empty } from "@/components/ui";
import { ContentAssetWorkbench, type ContentAssetListItem } from "@/app/content/content-asset-workbench";
import { contentAnalysisNoticeCookieName, isContentAnalysisNotice } from "@/lib/services/content-analysis-notice";
import { getEvidenceSubmoduleHitCounts } from "@/lib/services/answer-evidence-hit-analysis";
import { getContentAiFeatureGroups } from "@/lib/services/content-ai";
import { buildEvidenceSubmodules } from "@/lib/services/evidence-submodules";
import { getDashboard } from "@/lib/services/read";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export default async function ContentPage() {
  const data = await getDashboard();
  if (!data) return <Empty title="没有内容资产" body="请先运行 seed。" />;
  const store = await cookies();
  const analysisNoticeValue = store.get(contentAnalysisNoticeCookieName)?.value;
  const analysisNotice = isContentAnalysisNotice(analysisNoticeValue) ? analysisNoticeValue : "";

  const [aiFeatureGroups, evidenceHitCounts] = await Promise.all([
    getContentAiFeatureGroups(data.project.id),
    getEvidenceSubmoduleHitCounts(data.project.id)
  ]);

  const assets: ContentAssetListItem[] = data.project.contentAssets.map((asset) => {
    const snapshot = asset.snapshots[0] || null;
    const structure = snapshot?.structure;
    const structureScore = structure
      ? (structure.headingScore + structure.extractabilityScore + structure.evidenceDensityScore + structure.freshnessScore + structure.schemaScore) / 500
      : 0;

    return {
      id: asset.id,
      title: asset.title,
      status: asset.status,
      createdAt: asset.createdAt.toISOString(),
      updatedAt: asset.updatedAt.toISOString(),
      snapshot: snapshot
        ? {
            crawlStatus: snapshot.crawlStatus,
            snapshotAt: snapshot.snapshotAt.toISOString(),
            textContent: snapshot.textContent,
            structureScore,
            evidenceModules: snapshot.evidenceModules.map((module) => ({
              id: module.id,
              moduleType: module.moduleType,
              title: module.title,
              body: module.body,
              locationPath: module.locationPath,
              submodules: buildEvidenceSubmodules(module).map((submodule) => ({
                id: submodule.id,
                body: submodule.body,
                locationPath: submodule.locationPath,
                sentenceIndex: submodule.sentenceIndex,
                hitCount: evidenceHitCounts.get(submodule.id) || 0
              }))
            }))
          }
        : null
    };
  });

  return (
    <ContentAssetWorkbench
      projectId={data.project.id}
      featureGroups={aiFeatureGroups}
      assets={assets}
      analysisNotice={analysisNotice}
    />
  );
}
