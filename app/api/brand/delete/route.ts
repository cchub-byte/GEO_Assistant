import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { projectCookieName } from "@/lib/services/read";

export async function POST(request: Request) {
  const formData = await request.formData();
  const projectId = String(formData.get("projectId") || "");
  const brandProfileId = String(formData.get("brandProfileId") || "");
  if (brandProfileId) {
    const brand = await prisma.brandProfile.findUnique({ where: { id: brandProfileId }, select: { projectId: true } });
    const resolvedProjectId = projectId || brand?.projectId || "";
    const projectCount = await prisma.project.count();
    if (resolvedProjectId && projectCount > 1) {
      await prisma.project.delete({ where: { id: resolvedProjectId } });
      const nextProject = await prisma.project.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
      const store = await cookies();
      if (nextProject) store.set(projectCookieName, nextProject.id, { path: "/", maxAge: 60 * 60 * 24 * 365 });
      else store.delete(projectCookieName);
    } else {
      await prisma.brandProfile.delete({ where: { id: brandProfileId } });
    }
  }
  redirect("/settings");
}
