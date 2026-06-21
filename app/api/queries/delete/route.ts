import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { safeRedirectPath } from "@/lib/routes";

export async function POST(request: Request) {
  const formData = await request.formData();
  const redirectTo = safeRedirectPath(formData.get("redirectTo"), "/sampling");
  const queryId = String(formData.get("queryId") || "");
  if (queryId) await prisma.query.delete({ where: { id: queryId } });
  redirect(redirectTo);
}
