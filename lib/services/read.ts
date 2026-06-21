import { prisma } from "@/lib/db";
import { cookies } from "next/headers";

export const projectCookieName = "geo_project_id";

export async function getProjectOptions() {
  const selectedProjectId = await getCookieProjectId();
  const projects = await prisma.project.findMany({
    include: { brandProfile: true },
    orderBy: { createdAt: "asc" }
  });
  const selectedExists = projects.some((project) => project.id === selectedProjectId);
  return {
    projects,
    selectedProjectId: selectedExists ? selectedProjectId : projects[0]?.id || null
  };
}

export async function getDefaultProjectId() {
  const selectedProjectId = await getCookieProjectId();
  if (selectedProjectId) {
    const selected = await prisma.project.findUnique({ where: { id: selectedProjectId }, select: { id: true } });
    if (selected) return selected.id;
  }
  const project = await prisma.project.findFirst({ orderBy: { createdAt: "asc" } });
  return project?.id || null;
}

export async function getDashboard(projectId?: string | null) {
  const id = projectId || (await getDefaultProjectId());
  if (!id) return null;
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      brandProfile: { include: { competitors: true } },
      llmConfig: true,
      queryClusters: {
        include: {
          queries: { orderBy: { createdAt: "asc" } },
          metrics: { orderBy: { windowEnd: "desc" }, take: 1 }
        },
        orderBy: [{ priority: "asc" }, { createdAt: "asc" }]
      },
      engineConfigs: true,
      samplingBatches: {
        include: {
          answerRuns: {
            select: { id: true }
          }
        },
        orderBy: [{ batchDate: "desc" }, { sequence: "desc" }, { createdAt: "desc" }]
      },
      samplingPlans: {
        include: {
          engines: { include: { engineConfig: true } },
          jobs: {
            include: {
              answerRuns: {
                include: { query: true, engineConfig: true },
                orderBy: [{ runAt: "asc" }, { id: "asc" }]
              }
            },
            orderBy: { scheduledAt: "desc" },
            take: 3
          }
        },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]
      },
      answerRuns: {
        include: {
          query: true,
          engineConfig: true,
          sources: { orderBy: [{ position: "asc" }, { id: "asc" }] },
          citations: { include: { source: true } },
          metrics: true
        },
        orderBy: [{ runAt: "desc" }, { id: "desc" }]
      },
      contentAssets: { include: { snapshots: { include: { structure: true, evidenceModules: true }, orderBy: { snapshotAt: "desc" }, take: 1 } } }
    }
  });
  if (!project) return null;
  const latestMetric = await prisma.projectMetric.findFirst({ where: { projectId: id }, orderBy: { windowEnd: "desc" } });
  return { project, latestMetric };
}

async function getCookieProjectId() {
  try {
    const store = await cookies();
    return store.get(projectCookieName)?.value || null;
  } catch {
    return null;
  }
}

export async function getRunDetail(runId: string) {
  return prisma.answerRun.findUnique({
    where: { id: runId },
    include: {
      query: { include: { cluster: true } },
      engineConfig: true,
      sources: { orderBy: [{ position: "asc" }, { id: "asc" }] },
      citations: { include: { source: true } },
      mentions: true,
      competitorOccurrences: true,
      metrics: true
    }
  });
}
