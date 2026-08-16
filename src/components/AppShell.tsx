import Link from "next/link";
import { Box, Chip, Container, Divider, Stack, Typography } from "@mui/material";
import { getMessages } from "@/lib/i18n/messages";
import type { Locale } from "@/lib/types";

export function AppShell({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const copy = getMessages(locale);
  const otherLocale = locale === "zh-CN" ? "en" : "zh-CN";
  return (
    <Box sx={{ minHeight: "100vh" }}>
      <Box component="header" sx={{ borderBottom: "1px solid var(--vct-border)", backgroundColor: "rgba(9,11,16,.82)", backdropFilter: "blur(14px)", position: "sticky", top: 0, zIndex: 10 }}>
        <Container maxWidth="xl" sx={{ py: 1.5 }}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} justifyContent="space-between" alignItems={{ sm: "center" }}>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Box sx={{ width: 10, height: 34, bgcolor: "primary.main", transform: "skew(-14deg)" }} aria-hidden />
              <Box>
                <Typography variant="subtitle1" fontWeight={800}>{copy.appName}</Typography>
                <Typography variant="caption" color="text.secondary">{copy.subtitle}</Typography>
              </Box>
            </Stack>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Link href={`/${locale}`}><Chip component="span" label={copy.overview} variant="outlined" clickable /></Link>
              <Link href={`/${locale}/methodology`}><Chip component="span" label={copy.methodology} variant="outlined" clickable /></Link>
              <Link href={`/${locale}/admin`}><Chip component="span" label={copy.admin} variant="outlined" clickable /></Link>
              <Link href={`/${otherLocale}`}><Chip component="span" label={otherLocale === "en" ? "EN" : "中文"} color="primary" clickable /></Link>
            </Stack>
          </Stack>
        </Container>
      </Box>
      <Box component="main">{children}</Box>
      <Divider sx={{ borderColor: "var(--vct-border)" }} />
      <Container component="footer" maxWidth="xl" sx={{ py: 3 }}>
        <Typography variant="caption" color="text.secondary">VCT 2026 · {copy.exactModel}</Typography>
      </Container>
    </Box>
  );
}
