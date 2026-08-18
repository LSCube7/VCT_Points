import { AdminPanel } from "@/components/AdminPanel";
import type { Locale } from "@/lib/types";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { loadDraft } from "./actions";

export default async function AdminPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  await connection();
  const draft = await loadDraft();
  if (!draft.ok && draft.code === "UNAUTHORIZED") redirect("/api/auth/login");
  return <AdminPanel locale={locale} initialDraft={draft.ok ? draft.payload : undefined} draftLoadError={draft.ok ? undefined : { code: draft.code, message: draft.message }} />;
}
