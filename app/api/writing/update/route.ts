import { redirect } from "next/navigation";
import { updateContentWriting } from "@/lib/services/content-writing";

export async function POST(request: Request) {
  const formData = await request.formData();
  const writingId = String(formData.get("writingId") || "").trim();
  const title = String(formData.get("title") || "").trim();
  const body = String(formData.get("textContent") || formData.get("body") || "").trim();
  if (writingId && title) {
    await updateContentWriting({ id: writingId, title, body });
  }
  redirect("/writing");
}
