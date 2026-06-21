import { redirect } from "next/navigation";
import { deleteContentWriting } from "@/lib/services/content-writing";

export async function POST(request: Request) {
  const formData = await request.formData();
  const writingId = String(formData.get("writingId") || "").trim();
  if (writingId) await deleteContentWriting(writingId);
  redirect("/writing");
}
