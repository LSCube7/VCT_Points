import { AdminPanel } from "@/components/AdminPanel";
import type { Locale } from "@/lib/types";
import { loadDraft } from "./actions";

export default async function AdminPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  const draft = await loadDraft();
  return <AdminPanel locale={locale} initialDraft={draft.ok ? draft.payload : undefined} />;
}
