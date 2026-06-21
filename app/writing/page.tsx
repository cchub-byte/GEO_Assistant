import { Empty } from "@/components/ui";
import { getContentAiFeatureGroups, type ContentAiEvidenceModuleOption } from "@/lib/services/content-ai";
import { listContentWritings } from "@/lib/services/content-writing";
import { getDashboard } from "@/lib/services/read";
import { WritingWorkbench } from "./writing-workbench";

export const dynamic = "force-dynamic";

export default async function WritingPage() {
  const data = await getDashboard();
  if (!data) return <Empty title="没有内容写作项目" body="请先运行 seed。" />;
  const [featureGroups, writings] = await Promise.all([
    getContentAiFeatureGroups(data.project.id),
    listContentWritings(data.project.id)
  ]);

  return (
    <WritingWorkbench
      projectId={data.project.id}
      featureGroups={featureGroups}
      evidenceModules={data.project.contentAssets.flatMap((asset): ContentAiEvidenceModuleOption[] => {
        const snapshot = asset.snapshots[0];
        if (!snapshot) return [];
        return snapshot.evidenceModules.map((module) => ({
          id: module.id,
          contentAssetId: asset.id,
          contentAssetTitle: asset.title,
          moduleType: module.moduleType,
          moduleTitle: module.title,
          bodyPreview: textPreview(module.body),
          bodyLength: module.body.replace(/\s/g, "").length,
          snapshotAt: snapshot.snapshotAt.toISOString()
        }));
      })}
      writings={writings.map((writing) => ({
        id: writing.id,
        title: writing.title,
        body: writing.body,
        createdAt: writing.createdAt.toISOString(),
        updatedAt: writing.updatedAt.toISOString()
      }))}
    />
  );
}

function textPreview(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "暂无正文";
  return normalized.length > 140 ? `${normalized.slice(0, 140)}...` : normalized;
}
