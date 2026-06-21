import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { getPersistentBrowserContext } from "@/lib/connectors/browser-session";
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
  try {
    const context = await getPersistentBrowserContext({ engineType, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.goto(engine.baseUrl, { waitUntil: "domcontentloaded" });
  } catch (error) {
    console.error("connector_login_failed", error);
    if (contentType.includes("application/json")) {
      return NextResponse.json(
        { ok: false, error: error instanceof Error ? error.message : "unknown_connector_login_error" },
        { status: 500 }
      );
    }
  }
  if (!contentType.includes("application/json")) {
    redirect("/sampling");
  }
  return NextResponse.json({ ok: true, message: "浏览器登录窗口已打开。登录完成后可关闭窗口，profile 会保留在本地。" });
}
