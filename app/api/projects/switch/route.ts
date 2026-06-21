import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { projectCookieName } from "@/lib/services/read";

export async function POST(request: Request) {
  const formData = await request.formData();
  const projectId = String(formData.get("projectId") || "");
  const redirectTo = String(formData.get("redirectTo") || "/");
  if (projectId) {
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
    if (project) {
      const store = await cookies();
      store.set(projectCookieName, project.id, { path: "/", maxAge: 60 * 60 * 24 * 365 });
    }
  }
  redirect(redirectTo);
}
