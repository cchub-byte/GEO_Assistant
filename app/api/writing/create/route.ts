import { redirect } from "next/navigation";
import { createContentWriting } from "@/lib/services/content-writing";

export async function POST(request: Request) {
  const formData = await request.formData();
  const projectId = String(formData.get("projectId") || "").trim();
  const title = String(formData.get("title") || "").trim();
  const body = String(formData.get("textContent") || formData.get("body") || "").trim();
  if (projectId && title) {
    await createContentWriting({ projectId, title, body });
  }
  redirect("/writing");
}
