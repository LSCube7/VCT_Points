import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { invalidatePublishedCache } from "@/lib/publish-cache";

export async function POST() {
  try {
    await requireAdmin();
    invalidatePublishedCache();
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "PUBLISH_CACHE_REFRESH_FAILED";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") return NextResponse.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });
    if (message === "DATABASE_NOT_CONFIGURED") return NextResponse.json({ ok: false, code: "DATABASE_NOT_CONFIGURED" }, { status: 503 });
    console.error("[admin.publish.revalidate] " + JSON.stringify({ errorName: error instanceof Error ? error.name : "UnknownError" }));
    return NextResponse.json({ ok: false, code: "PUBLISH_CACHE_REFRESH_FAILED" }, { status: 500 });
  }
}
