import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { Providers } from "@/components/Providers";
import type { Locale } from "@/lib/types";

const locales: Locale[] = ["zh-CN", "en"];

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!locales.includes(locale as Locale)) notFound();
  const selectedLocale = locale as Locale;
  return (
    <Providers locale={selectedLocale}>
      <AppShell locale={selectedLocale}>{children}</AppShell>
    </Providers>
  );
}
