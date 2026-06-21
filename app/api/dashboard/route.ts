import { NextResponse } from "next/server";
import { getDashboard } from "@/lib/services/read";

export async function GET() {
  const dashboard = await getDashboard();
  return NextResponse.json(dashboard);
}

