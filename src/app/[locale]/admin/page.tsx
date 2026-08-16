import { AdminPanel } from "@/components/AdminPanel";
import type { Locale } from "@/lib/types";

export default async function AdminPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  return <AdminPanel locale={locale} />;
}
