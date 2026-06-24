import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { engineCatalog } from "@/lib/domain";

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  const body =
    contentType.includes("application/json")
      ? await request.json().catch(() => ({}))
      : Object.fromEntries((await request.formData()).entries());
  const engineType = String(body.engineType || "");
  const engine = engineCatalog.find((item) => item.engineType === engineType);
  if (!engine) return NextResponse.json({ error: "unknown_engine" }, { status: 400 });
  const error = "browser_collection_unavailable";
  if (contentType.includes("application/json")) {
    return NextResponse.json({ ok: false, error }, { status: 503 });
  }
  redirect("/sampling");
}
